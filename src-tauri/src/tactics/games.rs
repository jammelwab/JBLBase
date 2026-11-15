//! Tactic search in the own games: every position of the chosen games in
//! which the player was to move is checked for a tactic, whether the player
//! found it or missed it. The games can be narrowed down by account, colour,
//! period, time control and result.
//!
//! It is built for speed: every position is first looked at with one line
//! only (straight from the position store when Insight or an earlier search
//! already evaluated it), and only where the player stood clearly better
//! after a real mistake of the opponent does the engine search two lines.
//! Several engines work side by side, each on its own game.

use std::{
    collections::HashSet,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
    },
};

use serde::{Deserialize, Serialize};
use shakmaty::{Chess, Color, Move, Position};
use specta::Type;

use crate::{
    db::get_duckdb_pool,
    engine::EngineOption,
    error::Error,
    eval_cache::{position_key, EvalCache, PosKey},
    insight::{
        decode_mainline, load_games, source_name, speed, GameInfo, InsightAccount, StoredGame,
        MIN_PLIES,
    },
    progress::update_progress,
    AppState,
};

use super::{
    engine::{Analyzer, Prober},
    examine, finish, lock, progress_reporter,
    rating::RatingModel,
    run_parallel, start_engines,
    store::{self, StoredTactic},
    Criteria, Strictness, Worker,
};

/// Which tactics of the own games to collect.
#[derive(Deserialize, Serialize, Debug, Clone, Copy, PartialEq, Eq, Default, Type)]
#[serde(rename_all = "camelCase")]
pub enum TacticKind {
    /// Only those the player did not see.
    Missed,
    /// Only those the player found.
    Played,
    #[default]
    Both,
}

/// Which games to look at.
#[derive(Deserialize, Debug, Clone, Default, Type)]
#[serde(rename_all = "camelCase")]
pub struct GameFilter {
    pub accounts: Vec<InsightAccount>,
    /// "white" or "black"; both when left out.
    #[serde(default)]
    pub color: Option<String>,
    /// First and last day, "2026-03-14"; open when left out.
    #[serde(default)]
    pub since: Option<String>,
    #[serde(default)]
    pub until: Option<String>,
    /// "bullet", "blitz", "rapid", "classical", "daily"; every one when empty.
    #[serde(default)]
    pub speeds: Vec<String>,
    /// "win", "draw", "loss"; every one when empty.
    #[serde(default)]
    pub results: Vec<String>,
    /// At most this many games, newest first.
    #[serde(default)]
    pub max_games: Option<u32>,
}

impl GameFilter {
    pub fn matches(&self, info: &GameInfo) -> bool {
        match self.color.as_deref() {
            Some("white") if !info.white_side => return false,
            Some("black") if info.white_side => return false,
            _ => {}
        }
        let since = self.since.as_deref().filter(|s| !s.is_empty());
        let until = self.until.as_deref().filter(|s| !s.is_empty());
        if since.is_some() || until.is_some() {
            if info.date.len() < 10 {
                return false;
            }
            let day = &info.date[..10];
            if since.is_some_and(|s| day < s) || until.is_some_and(|u| day > u) {
                return false;
            }
        }
        if !self.speeds.is_empty() && !self.speeds.iter().any(|s| s == speed(&info.time_control)) {
            return false;
        }
        if !self.results.is_empty() && !self.results.iter().any(|r| r == info.outcome()) {
            return false;
        }
        true
    }
}

/// The games of `filter`, newest first, at most `max_games`.
fn chosen_games(
    state: &tauri::State<'_, AppState>,
    filter: &GameFilter,
) -> Result<Vec<StoredGame>, Error> {
    let mut games = Vec::new();
    let mut seen = HashSet::new();
    for account in &filter.accounts {
        let pool = get_duckdb_pool(state, &account.file)?;
        let db = pool.get()?;
        for game in load_games(&db, &source_name(&account.file), &account.player)? {
            if filter.matches(&game.info) && seen.insert(game.info.key.clone()) {
                games.push(game);
            }
        }
    }
    // Several accounts: newest first over all of them (games without a date last).
    games.sort_by(|a, b| b.info.date.cmp(&a.info.date));
    if let Some(max) = filter.max_games {
        games.truncate(max as usize);
    }
    Ok(games)
}

/// How many games a filter chooses.
#[tauri::command]
#[specta::specta]
pub async fn count_tactic_games(
    filter: GameFilter,
    state: tauri::State<'_, AppState>,
) -> Result<u32, Error> {
    Ok(chosen_games(&state, &filter)?.len() as u32)
}

/// A tactic found in a game, and whether the player played it.
pub struct GameTactic {
    pub tactic: StoredTactic,
    pub played: bool,
}

/// The tactics of the player of `info` in one game (`moves` from `start`).
/// Returns them and the number of positions looked at.
#[allow(clippy::too_many_arguments)]
pub async fn tactics_in_game(
    analyzer: &mut Analyzer,
    prober: &mut Prober,
    cache: Option<&EvalCache>,
    model: &RatingModel,
    criteria: &Criteria,
    depth: u32,
    kind: TacticKind,
    info: &GameInfo,
    start: &Chess,
    moves: &[Move],
    cancel: &AtomicBool,
) -> Result<(Vec<GameTactic>, u32), Error> {
    let color = info.color();
    let mut positions = Vec::with_capacity(moves.len() + 1);
    positions.push(start.clone());
    for m in moves {
        let mut next = positions.last().expect("start is there").clone();
        next.play_unchecked(*m);
        positions.push(next);
    }

    let mut covered: HashSet<PosKey> = HashSet::new();
    let mut found = Vec::new();
    let mut looked_at = 0;
    for i in 1..moves.len() {
        if cancel.load(Ordering::SeqCst) {
            return Err(Error::AnalysisCancelled);
        }
        let pos = &positions[i];
        if pos.turn() != color || covered.contains(&position_key(pos)) {
            continue;
        }
        looked_at += 1;
        // Cheap look first: one line, mostly from the position store.
        let quick = analyzer.analyze(cache, pos, depth, 1).await?;
        let Some(best) = quick.first() else {
            continue;
        };
        if !criteria.is_winning(best) {
            continue;
        }
        let played = best.first_move(pos) == Some(moves[i]);
        let wanted = match kind {
            TacticKind::Both => true,
            TacticKind::Played => played,
            TacticKind::Missed => !played,
        };
        if !wanted {
            continue;
        }
        let Some(hit) = examine(
            analyzer,
            cache,
            criteria,
            depth,
            &positions[i - 1],
            &moves[i - 1],
            pos,
        )
        .await?
        else {
            continue;
        };
        let played = hit.solution.first() == Some(&moves[i]);
        if (kind == TacticKind::Played && !played) || (kind == TacticKind::Missed && played) {
            continue;
        }
        covered.extend(hit.covered.iter().copied());
        let line = format!(
            "{} – {}{}, {}",
            info.white,
            info.black,
            if info.date.is_empty() {
                String::new()
            } else {
                format!(" ({})", info.date)
            },
            if pos.turn() == Color::White {
                format!("{}.", pos.fullmoves())
            } else {
                format!("{}...", pos.fullmoves())
            }
        );
        let tactic = finish(
            hit,
            prober.get().await?,
            model,
            &positions[i - 1],
            &moves[i - 1],
            pos,
            &line,
        )
        .await?;
        found.push(GameTactic { tactic, played });
    }
    Ok((found, looked_at))
}

#[derive(Deserialize, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct GameTacticOptions {
    pub engine: String,
    pub uci_options: Vec<EngineOption>,
    pub depth: u32,
    pub filter: GameFilter,
    #[serde(default)]
    pub kind: TacticKind,
    #[serde(default)]
    pub strictness: Strictness,
    #[serde(default)]
    pub min_solver_moves: Option<u32>,
    #[serde(default)]
    pub max_engines: Option<u32>,
    /// The puzzle database to write to.
    pub dest: PathBuf,
}

#[derive(Serialize, Debug, Type, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GameTacticResult {
    /// Games searched.
    pub games: u32,
    /// Positions of the player looked at.
    pub positions: u32,
    /// Positions the engines had to calculate (the rest came from the position store).
    pub calculated: u32,
    /// Tactics found, and of those the player played or missed.
    pub found: u32,
    pub played: u32,
    pub missed: u32,
    /// Newly in the database.
    pub added: u32,
    /// Found, but already in the database (from Insight or another search).
    pub duplicates: u32,
    /// Found, but deleted in an earlier review of reported puzzles.
    pub rejected: u32,
    /// Puzzles in the database after the search.
    pub total: u32,
}

/// Name the puzzles of a game are filed under. Insight files the missed
/// tactics it finds under the game's key; this search has its own name, so
/// the two do not replace each other's puzzles.
fn source_of(info: &GameInfo) -> String {
    format!("{}#taktiksuche", info.key)
}

/// Searches the chosen own games for tactics and writes them to a puzzle
/// database, game by game, so a stopped search keeps what it found.
/// Progress goes to the progress bar `id`; `cancel_analysis(id)` stops it.
#[tauri::command]
#[specta::specta]
pub async fn find_tactics_in_games(
    id: String,
    options: GameTacticOptions,
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<GameTacticResult, Error> {
    let cancel = Arc::new(AtomicBool::new(false));
    state
        .analysis_cancel_flags
        .insert(id.clone(), cancel.clone());

    let result = async {
        let games = chosen_games(&state, &options.filter)?;
        if games.is_empty() {
            return Ok(GameTacticResult::default());
        }
        let path = PathBuf::from(&options.engine);
        let analyzers = start_engines(
            &path,
            &options.uci_options,
            games.len(),
            options.max_engines,
        )
        .await?;
        let criteria = Criteria::new(options.strictness, options.min_solver_moves.unwrap_or(1));
        let model = state.rating.model();
        let report = progress_reporter(&state, &app, &id);
        let run = Mutex::new(GameTacticResult::default());
        let done = AtomicUsize::new(0);
        let total = games.len() as f32;
        let (games_ref, run_ref, done_ref, report, model, criteria, options, state_ref) = (
            &games, &run, &done, &report, &model, &criteria, &options, &state,
        );
        let cancel_ref = &*cancel;

        let searched = run_parallel(
            analyzers,
            &path,
            games.len(),
            cancel_ref,
            move |mut worker: Worker, n| async move {
                let result = async {
                    let Worker { analyzer, prober } = &mut worker;
                    let game = &games_ref[n];
                    let decoded = decode_mainline(&game.movedata, game.fen.as_deref());
                    if let Ok((start, moves)) = decoded.as_ref() {
                        if moves.len() >= MIN_PLIES {
                            analyzer.clear_memo();
                            let (found, looked_at) = tactics_in_game(
                                analyzer,
                                prober,
                                Some(&state_ref.eval_cache),
                                model,
                                criteria,
                                options.depth,
                                options.kind,
                                &game.info,
                                start,
                                moves,
                                cancel_ref,
                            )
                            .await?;
                            let tactics: Vec<StoredTactic> =
                                found.iter().map(|f| f.tactic.clone()).collect();
                            let stored = if !tactics.is_empty() || options.dest.exists() {
                                let stored = store::replace_source(
                                    &options.dest,
                                    &source_of(&game.info),
                                    &tactics,
                                )?;
                                crate::puzzle::forget_cached_puzzles(&options.dest);
                                Some(stored)
                            } else {
                                None
                            };
                            let mut run = lock(run_ref);
                            run.games += 1;
                            run.positions += looked_at;
                            run.found += found.len() as u32;
                            run.played += found.iter().filter(|f| f.played).count() as u32;
                            run.missed += found.iter().filter(|f| !f.played).count() as u32;
                            if let Some(stored) = stored {
                                run.added += stored.added;
                                run.duplicates += stored.duplicates;
                                run.rejected += stored.rejected;
                                run.total = stored.total;
                            }
                        }
                    }
                    let finished = done_ref.fetch_add(1, Ordering::SeqCst) + 1;
                    report(finished as f32 / total);
                    Ok(())
                }
                .await;
                (worker, result)
            },
        )
        .await;
        let mut run = lock(&run).clone();
        match searched {
            Ok(searches) => {
                run.calculated = searches;
                Ok(run)
            }
            // Stopping is not a failure: what is done is saved.
            Err(Error::AnalysisCancelled) => Ok(run),
            Err(error) => Err(error),
        }
    }
    .await;

    state.analysis_cancel_flags.remove(&id);
    match &result {
        Ok(_) => update_progress(&state.progress_state, &app, id, 100.0, true)?,
        Err(_) => {
            state.progress_state.remove(&id);
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn info(white_side: bool, result: &str, date: &str, tc: &str) -> GameInfo {
        GameInfo {
            key: "k".into(),
            source: "s".into(),
            player: "me".into(),
            white_side,
            white: if white_side { "me" } else { "other" }.into(),
            black: if white_side { "other" } else { "me" }.into(),
            result: result.into(),
            date: date.into(),
            time_control: tc.into(),
            player_rating: None,
            opponent_rating: None,
        }
    }

    #[test]
    fn filter_by_colour_period_speed_and_result() {
        let game = info(true, "1-0", "2026-03-14", "300+3");
        assert!(GameFilter::default().matches(&game));
        let only = |f: GameFilter| f.matches(&game);
        assert!(only(GameFilter {
            color: Some("white".into()),
            ..Default::default()
        }));
        assert!(!only(GameFilter {
            color: Some("black".into()),
            ..Default::default()
        }));
        assert!(only(GameFilter {
            since: Some("2026-03-01".into()),
            until: Some("2026-03-14".into()),
            ..Default::default()
        }));
        assert!(!only(GameFilter {
            since: Some("2026-03-15".into()),
            ..Default::default()
        }));
        assert!(only(GameFilter {
            speeds: vec!["blitz".into()],
            ..Default::default()
        }));
        assert!(!only(GameFilter {
            speeds: vec!["rapid".into(), "classical".into()],
            ..Default::default()
        }));
        assert!(only(GameFilter {
            results: vec!["win".into()],
            ..Default::default()
        }));
        assert!(!only(GameFilter {
            results: vec!["loss".into(), "draw".into()],
            ..Default::default()
        }));
        // Without a date, a game only counts when no period is asked for.
        let undated = info(false, "0-1", "", "600");
        assert!(GameFilter::default().matches(&undated));
        assert!(!GameFilter {
            until: Some("2030-01-01".into()),
            ..Default::default()
        }
        .matches(&undated));
    }

    /// Needs an engine: `JBLBASE_TEST_ENGINE=/path/to/stockfish cargo test -- --ignored games`
    #[tokio::test]
    #[ignore]
    async fn finds_played_and_missed_tactics_in_games() {
        let engine = PathBuf::from(std::env::var("JBLBASE_TEST_ENGINE").unwrap());
        let cache = EvalCache::open_in_memory();
        let cancel = AtomicBool::new(false);
        let mut analyzer = Analyzer::new(engine.clone(), &[]).await.unwrap();
        let mut prober = Prober::new(engine);
        let criteria = Criteria::default();
        let play = |line: &str| {
            let mut pos = Chess::default();
            line.split_whitespace()
                .map(|u| {
                    let m = u
                        .parse::<shakmaty::uci::UciMove>()
                        .unwrap()
                        .to_move(&pos)
                        .unwrap();
                    pos.play_unchecked(m);
                    m
                })
                .collect::<Vec<_>>()
        };

        // Legal's mate, played by White: 5...Bxd1?? 6.Bxf7+ Ke7 7.Nd5#
        let played = play("e2e4 e7e5 g1f3 d7d6 f1c4 c8g4 b1c3 g7g6 f3e5 g4d1 c4f7 e8e7 c3d5");
        let white = info(true, "1-0", "2026-01-01", "300");
        let (found, looked_at) = tactics_in_game(
            &mut analyzer,
            &mut prober,
            Some(&cache),
            &RatingModel::default(),
            &criteria,
            14,
            TacticKind::Both,
            &white,
            &Chess::default(),
            &played,
            &cancel,
        )
        .await
        .unwrap();
        assert!(looked_at >= 5);
        let mate = found
            .iter()
            .find(|f| f.tactic.moves[0] == "g4d1")
            .expect("mate after 5...Bxd1");
        assert!(mate.played);

        // The same game, but White takes the queen instead: missed.
        let missed = play("e2e4 e7e5 g1f3 d7d6 f1c4 c8g4 b1c3 g7g6 f3e5 g4d1 c3d1 d6e5");
        let (found, _) = tactics_in_game(
            &mut analyzer,
            &mut prober,
            Some(&cache),
            &RatingModel::default(),
            &criteria,
            14,
            TacticKind::Missed,
            &white,
            &Chess::default(),
            &missed,
            &cancel,
        )
        .await
        .unwrap();
        let mate = found
            .iter()
            .find(|f| f.tactic.moves[0] == "g4d1")
            .expect("missed mate after 5...Bxd1");
        assert!(!mate.played);
        // Only played ones asked for: the missed mate is not there.
        let (found, _) = tactics_in_game(
            &mut analyzer,
            &mut prober,
            Some(&cache),
            &RatingModel::default(),
            &criteria,
            14,
            TacticKind::Played,
            &white,
            &Chess::default(),
            &missed,
            &cancel,
        )
        .await
        .unwrap();
        assert!(found.iter().all(|f| f.tactic.moves[0] != "g4d1"));
        analyzer.quit().await;
        prober.quit().await;
    }
}
