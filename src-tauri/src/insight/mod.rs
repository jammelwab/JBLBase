//! Insight: analyses every game of an account and keeps statistics about the
//! player's play: accuracy, errors per game phase, opening and time control,
//! and the tactics they missed (which become puzzles).
//!
//! Every evaluation goes through the evaluation cache, so a position is only
//! ever calculated once, and an interrupted run continues where it stopped.

pub mod store;

use std::{
    collections::{BTreeMap, HashSet},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

use aix_chess_compression::{Decoder, EncodedGame, GameEvent};
use serde::{Deserialize, Serialize};
use shakmaty::{san::SanPlus, Chess, Color, Move, Position};
use specta::Type;

use crate::{
    db::get_duckdb_pool,
    engine::EngineOption,
    error::Error,
    eval_cache::{position_key, EvalCache, PosKey},
    opening::get_opening_from_setup,
    progress::update_progress,
    tactics::{
        engine::{fen_of, Analyzer, Line},
        motifs,
        rating::RatingModel,
        store as tactic_store,
        store::StoredTactic,
        tactic_at,
    },
    AppState,
};

pub use store::{InsightStore, InsightSummary};

/// Winning chances (from -1 to 1) a move has to give away to count as an
/// inaccuracy, a mistake or a blunder. The limits Lichess uses.
const INACCURACY: f64 = 0.1;
const MISTAKE: f64 = 0.2;
const BLUNDER: f64 = 0.3;
/// Games shorter than this many plies were aborted and say nothing.
const MIN_PLIES: usize = 8;

/// What we know about a game apart from its moves.
#[derive(Debug, Clone)]
pub struct GameInfo {
    /// Identifies the game across imports: its link, or a made-up key.
    pub key: String,
    /// File name of the database it comes from.
    pub source: String,
    /// The player the analysis is for, and whether they had White.
    pub player: String,
    pub white_side: bool,
    pub white: String,
    pub black: String,
    /// PGN result: "1-0", "0-1", "1/2-1/2" or anything else for unknown.
    pub result: String,
    /// "2026-03-14", or empty.
    pub date: String,
    pub time_control: String,
    pub player_rating: Option<i32>,
    pub opponent_rating: Option<i32>,
}

impl GameInfo {
    /// "win", "draw" or "loss" for the player, empty when unknown.
    pub fn outcome(&self) -> &'static str {
        match (self.result.as_str(), self.white_side) {
            ("1-0", true) | ("0-1", false) => "win",
            ("1-0", false) | ("0-1", true) => "loss",
            ("1/2-1/2", _) => "draw",
            _ => "",
        }
    }

    fn color(&self) -> Color {
        if self.white_side {
            Color::White
        } else {
            Color::Black
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct PhaseStats {
    pub moves: u32,
    pub accuracy_sum: f64,
    pub inaccuracies: u32,
    pub mistakes: u32,
    pub blunders: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct MoveError {
    pub ply: u32,
    pub fen: String,
    pub played: String,
    pub best: String,
    /// Winning chances given away, in percent points (0 to 100).
    pub loss: f64,
    /// 1 inaccuracy, 2 mistake, 3 blunder.
    pub class: u8,
    pub phase: &'static str,
}

/// The analysis of one game from the player's side.
#[derive(Debug, Clone, Default)]
pub struct GameReport {
    pub plies: u32,
    pub opening: String,
    pub accuracy: f64,
    pub opponent_accuracy: f64,
    pub acpl: f64,
    pub inaccuracies: u32,
    pub mistakes: u32,
    pub blunders: u32,
    pub phases: BTreeMap<&'static str, PhaseStats>,
    pub errors: Vec<MoveError>,
    /// Tactics the player had and did not play, as puzzles.
    pub tactics: Vec<StoredTactic>,
}

/// Accuracy of a move from the winning chances it gave away (the Lichess
/// formula, which works on win percent from 0 to 100).
pub fn move_accuracy(loss: f64) -> f64 {
    let win_percent_lost = loss.max(0.0) * 50.0;
    (103.1668 * (-0.04354 * win_percent_lost).exp() - 3.1669).clamp(0.0, 100.0)
}

fn capped_cp(line: &Line) -> i32 {
    match (line.mate, line.cp) {
        (Some(m), _) => {
            if m > 0 {
                1000
            } else {
                -1000
            }
        }
        (None, Some(cp)) => cp.clamp(-1000, 1000),
        (None, None) => 0,
    }
}

/// "bullet", "blitz", "rapid", "classical" or "daily" from a PGN time
/// control such as "300+3"; empty when it cannot be read.
pub fn speed(time_control: &str) -> &'static str {
    let tc = time_control.trim();
    if tc.contains('/') {
        return "daily";
    }
    let mut parts = tc.split('+');
    let Some(base) = parts.next().and_then(|b| b.parse::<f64>().ok()) else {
        return "";
    };
    let increment = parts
        .next()
        .and_then(|i| i.parse::<f64>().ok())
        .unwrap_or(0.0);
    // The estimate Lichess uses: a game lasts about 40 moves.
    let estimate = base + 40.0 * increment;
    if estimate < 180.0 {
        "bullet"
    } else if estimate < 480.0 {
        "blitz"
    } else if estimate < 1500.0 {
        "rapid"
    } else {
        "classical"
    }
}

/// "Sicilian Defense: Najdorf Variation" -> "Sicilian Defense".
pub fn opening_family(opening: &str) -> &str {
    opening.split(':').next().unwrap_or(opening).trim()
}

/// The main line of a stored game.
pub fn decode_mainline(bytes: &[u8], fen: Option<&str>) -> Result<(Chess, Vec<Move>), String> {
    let game = EncodedGame::from_bytes(bytes).map_err(|e| e.to_string())?;
    let Decoder::Naive(mut decoder) =
        Decoder::new_with_initial_fen(&game, fen).map_err(|e| e.to_string())?
    else {
        return Err("Database move trees require LOW compression".into());
    };
    let start = match fen {
        Some(fen) => crate::db::chess_from_fen(fen)?,
        None => Chess::new(),
    };
    let mut position = start.clone();
    let mut previous: Option<Chess> = None;
    let mut stack = Vec::new();
    let mut moves = Vec::new();
    while let Some(event) = decoder.next_event() {
        match event.map_err(|e| e.to_string())? {
            GameEvent::Move(m) => {
                if stack.is_empty() {
                    moves.push(m);
                }
                previous = Some(position.clone());
                position.play_unchecked(m);
            }
            GameEvent::StartVariation => {
                let branch = previous.clone().ok_or("Variation before any move")?;
                stack.push((position.clone(), previous.clone()));
                position = branch;
                decoder.set_position(position.clone());
            }
            GameEvent::EndVariation => {
                (position, previous) = stack.pop().ok_or("Unmatched variation end")?;
                decoder.set_position(position.clone());
            }
        }
    }
    Ok((start, moves))
}

/// Analyses one game for its player. Stops with an error once `cancel` is
/// set; `on_progress` gets the share of the game's positions done.
#[allow(clippy::too_many_arguments)]
pub async fn analyse_game(
    analyzer: &mut Analyzer,
    prober: &mut Analyzer,
    cache: Option<&EvalCache>,
    model: &RatingModel,
    depth: u32,
    info: &GameInfo,
    start: &Chess,
    moves: &[Move],
    cancel: &AtomicBool,
    mut on_progress: impl FnMut(f32),
) -> Result<GameReport, Error> {
    let color = info.color();
    let mut positions = Vec::with_capacity(moves.len() + 1);
    let mut sans = Vec::with_capacity(moves.len());
    let mut pos = start.clone();
    positions.push(pos.clone());
    for m in moves {
        sans.push(SanPlus::from_move_and_play_unchecked(&mut pos, *m).to_string());
        positions.push(pos.clone());
    }

    // The deepest known opening position names the opening.
    let opening = positions
        .iter()
        .take(40)
        .rev()
        .find_map(|p| {
            get_opening_from_setup(p.clone().to_setup(shakmaty::EnPassantMode::Legal)).ok()
        })
        .unwrap_or_default();

    let mut evals: Vec<Option<Vec<Line>>> = Vec::with_capacity(positions.len());
    for (i, p) in positions.iter().enumerate() {
        if cancel.load(Ordering::SeqCst) {
            return Err(Error::AnalysisCancelled);
        }
        on_progress(i as f32 / positions.len() as f32);
        if p.is_game_over() {
            evals.push(None);
        } else {
            evals.push(Some(analyzer.analyze(cache, p, depth, 2).await?));
        }
    }

    let mut report = GameReport {
        plies: moves.len() as u32,
        opening,
        ..Default::default()
    };
    let (mut own_sum, mut own_moves) = (0.0, 0u32);
    let (mut other_sum, mut other_moves) = (0.0, 0u32);
    let mut cp_lost = 0i64;
    let mut covered: HashSet<PosKey> = HashSet::new();

    for i in 0..moves.len() {
        let Some(best) = evals[i].as_ref().and_then(|l| l.first()) else {
            continue;
        };
        let (after, after_cp) = match evals[i + 1].as_ref().and_then(|l| l.first()) {
            Some(next) => (-next.win_chances(), -capped_cp(next)),
            None if positions[i + 1].is_checkmate() => (1.0, 1000),
            None => (0.0, 0),
        };
        let loss = (best.win_chances() - after).max(0.0);
        let accuracy = move_accuracy(loss);
        if positions[i].turn() != color {
            other_sum += accuracy;
            other_moves += 1;
            continue;
        }
        own_sum += accuracy;
        own_moves += 1;
        cp_lost += (capped_cp(best) - after_cp).max(0) as i64;

        let phase = motifs::phase(&positions[i]);
        let stats = report.phases.entry(phase).or_default();
        stats.moves += 1;
        stats.accuracy_sum += accuracy;
        let class = if loss >= BLUNDER {
            stats.blunders += 1;
            report.blunders += 1;
            3
        } else if loss >= MISTAKE {
            stats.mistakes += 1;
            report.mistakes += 1;
            2
        } else if loss >= INACCURACY {
            stats.inaccuracies += 1;
            report.inaccuracies += 1;
            1
        } else {
            0
        };
        let best_move = best.first_move(&positions[i]);
        if class > 0 {
            report.errors.push(MoveError {
                ply: i as u32,
                fen: fen_of(&positions[i]),
                played: sans[i].clone(),
                best: best_move
                    .map(|m| SanPlus::from_move(positions[i].clone(), m).to_string())
                    .unwrap_or_default(),
                loss: loss * 50.0,
                class,
                phase,
            });
        }

        // A tactic that was there and not played becomes a puzzle.
        if i == 0 || best_move == Some(moves[i]) || covered.contains(&position_key(&positions[i])) {
            continue;
        }
        let line = format!(
            "{} – {}{}, {}",
            info.white,
            info.black,
            if info.date.is_empty() {
                String::new()
            } else {
                format!(" ({})", info.date)
            },
            if positions[i].turn() == Color::White {
                format!("{}.", positions[i].fullmoves())
            } else {
                format!("{}...", positions[i].fullmoves())
            }
        );
        if let Some((tactic, solved)) = tactic_at(
            analyzer,
            prober,
            cache,
            model,
            depth,
            &positions[i - 1],
            &moves[i - 1],
            &positions[i],
            &line,
        )
        .await?
        {
            covered.extend(solved);
            report.tactics.push(tactic);
        }
    }

    report.accuracy = if own_moves > 0 {
        own_sum / own_moves as f64
    } else {
        0.0
    };
    report.opponent_accuracy = if other_moves > 0 {
        other_sum / other_moves as f64
    } else {
        0.0
    };
    report.acpl = if own_moves > 0 {
        cp_lost as f64 / own_moves as f64
    } else {
        0.0
    };
    on_progress(1.0);
    Ok(report)
}

/// A game as read from an account's database.
struct StoredGame {
    info: GameInfo,
    fen: Option<String>,
    movedata: Vec<u8>,
}

fn game_key(
    source: &str,
    site: &str,
    white: &str,
    black: &str,
    date: &str,
    movedata: &[u8],
) -> String {
    if site.contains("://") {
        return site.to_string();
    }
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    movedata.hash(&mut hasher);
    format!("{source}|{white}|{black}|{date}|{:016x}", hasher.finish())
}

/// The games `player` played in the database behind `db`, newest first.
fn load_games(
    db: &duckdb::Connection,
    source: &str,
    player: &str,
) -> Result<Vec<StoredGame>, Error> {
    let mut stmt = db.prepare(
        "SELECT site, white, black, white_rating, black_rating, result, time_control,
                strftime(utc_timestamp, '%Y-%m-%d'), fen, movedata
         FROM games
         WHERE lower(white) = lower(?) OR lower(black) = lower(?)
         ORDER BY utc_timestamp DESC NULLS LAST, id DESC",
    )?;
    let rows = stmt.query_map(duckdb::params![player, player], |row| {
        let site: String = row.get::<_, Option<String>>(0)?.unwrap_or_default();
        let white: String = row.get::<_, Option<String>>(1)?.unwrap_or_default();
        let black: String = row.get::<_, Option<String>>(2)?.unwrap_or_default();
        let white_rating: Option<i32> = row.get(3)?;
        let black_rating: Option<i32> = row.get(4)?;
        let date: String = row.get::<_, Option<String>>(7)?.unwrap_or_default();
        let movedata: Vec<u8> = row.get::<_, Option<Vec<u8>>>(9)?.unwrap_or_default();
        let white_side = white.to_lowercase() == player.to_lowercase();
        Ok(StoredGame {
            info: GameInfo {
                key: game_key(source, &site, &white, &black, &date, &movedata),
                source: source.to_string(),
                player: player.to_string(),
                white_side,
                white,
                black,
                result: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
                date,
                time_control: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
                player_rating: if white_side {
                    white_rating
                } else {
                    black_rating
                },
                opponent_rating: if white_side {
                    black_rating
                } else {
                    white_rating
                },
            },
            fen: row.get(8)?,
            movedata,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

fn source_name(file: &std::path::Path) -> String {
    file.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| file.display().to_string())
}

#[derive(Deserialize, Debug, Clone, Type)]
#[serde(rename_all = "camelCase")]
pub struct InsightAccount {
    /// The database with the account's games.
    pub file: PathBuf,
    /// The account's name as it stands in the games.
    pub player: String,
}

#[derive(Deserialize, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct InsightOptions {
    pub engine: String,
    pub uci_options: Vec<EngineOption>,
    pub depth: u32,
    pub accounts: Vec<InsightAccount>,
    /// Analyse at most this many games in this run (newest first).
    pub max_games: Option<u32>,
    /// The puzzle database missed tactics are written to.
    pub tactics_dest: PathBuf,
}

#[derive(Serialize, Debug, Type, Default)]
#[serde(rename_all = "camelCase")]
pub struct InsightRunResult {
    /// Games analysed in this run.
    pub analysed: u32,
    /// Games still waiting.
    pub remaining: u32,
    /// Games that could not be read.
    pub failed: u32,
    /// Missed tactics found in this run.
    pub missed_tactics: u32,
    /// Positions the engine had to calculate.
    pub calculated: u32,
}

#[derive(Serialize, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct InsightAccountStatus {
    pub file: String,
    pub player: String,
    /// Games of the player in the database.
    pub total: u32,
    /// Of those, analysed to at least the asked depth.
    pub analysed: u32,
}

/// How far the analysis of each account is.
#[tauri::command]
#[specta::specta]
pub async fn insight_status(
    accounts: Vec<InsightAccount>,
    depth: u32,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<InsightAccountStatus>, Error> {
    let mut out = Vec::new();
    for account in accounts {
        let pool = get_duckdb_pool(&state, &account.file)?;
        let db = pool.get()?;
        let total: u32 = db.query_row(
            "SELECT COUNT(*) FROM games WHERE lower(white) = lower(?) OR lower(black) = lower(?)",
            duckdb::params![account.player, account.player],
            |row| row.get(0),
        )?;
        let analysed =
            state
                .insight
                .count_analysed(&source_name(&account.file), &account.player, depth)?;
        out.push(InsightAccountStatus {
            file: account.file.to_string_lossy().into_owned(),
            player: account.player,
            total,
            analysed: analysed.min(total),
        });
    }
    Ok(out)
}

/// Analyses the games of the given accounts that are not analysed yet,
/// newest first. Progress goes to the progress bar `id`;
/// `cancel_analysis(id)` stops after the current position, and everything
/// done so far is kept.
#[tauri::command]
#[specta::specta]
pub async fn insight_analyze(
    id: String,
    options: InsightOptions,
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<InsightRunResult, Error> {
    let cancel = Arc::new(AtomicBool::new(false));
    state
        .analysis_cancel_flags
        .insert(id.clone(), cancel.clone());

    let result = async {
        // What is there to do?
        let mut todo = Vec::new();
        for account in &options.accounts {
            let pool = get_duckdb_pool(&state, &account.file)?;
            let db = pool.get()?;
            for game in load_games(&db, &source_name(&account.file), &account.player)? {
                let done = state
                    .insight
                    .analysed_depth(&game.info.key)?
                    .is_some_and(|d| d >= options.depth);
                if !done {
                    todo.push(game);
                }
            }
        }
        let waiting = todo.len() as u32;
        if let Some(max) = options.max_games {
            todo.truncate(max as usize);
        }
        let mut run = InsightRunResult {
            remaining: waiting,
            ..Default::default()
        };
        if todo.is_empty() {
            return Ok(run);
        }

        let path = PathBuf::from(&options.engine);
        let mut analyzer = Analyzer::new(path.clone(), &options.uci_options).await?;
        let probe_options = [
            EngineOption {
                name: "Threads".into(),
                value: "1".into(),
            },
            EngineOption {
                name: "Hash".into(),
                value: "16".into(),
            },
        ];
        let mut prober = Analyzer::new(path, &probe_options).await?;
        let engine_name = analyzer.name().to_string();
        let model = state.rating.model();
        let total = todo.len() as f32;

        let mut outcome: Result<(), Error> = Ok(());
        for (n, game) in todo.iter().enumerate() {
            let decoded = decode_mainline(&game.movedata, game.fen.as_deref());
            let (start, moves) = match decoded {
                Ok((start, moves)) if moves.len() >= MIN_PLIES => (start, moves),
                _ => {
                    run.failed += 1;
                    run.remaining = run.remaining.saturating_sub(1);
                    continue;
                }
            };
            analyzer.clear_memo();
            let mut last = -1.0f32;
            let report = analyse_game(
                &mut analyzer,
                &mut prober,
                Some(&state.eval_cache),
                &model,
                options.depth,
                &game.info,
                &start,
                &moves,
                &cancel,
                |share| {
                    let progress = ((n as f32 + share) / total * 100.0).min(99.9);
                    if progress - last >= 0.1 {
                        last = progress;
                        let _ = update_progress(
                            &state.progress_state,
                            &app,
                            id.clone(),
                            progress,
                            false,
                        );
                    }
                },
            )
            .await;
            let report = match report {
                Ok(report) => report,
                Err(error) => {
                    outcome = Err(error);
                    break;
                }
            };
            state
                .insight
                .save(&game.info, &report, options.depth, &engine_name)?;
            if !report.tactics.is_empty() || options.tactics_dest.exists() {
                tactic_store::replace_source(
                    &options.tactics_dest,
                    &game.info.key,
                    &report.tactics,
                )?;
                crate::puzzle::forget_cached_puzzles(&options.tactics_dest);
            }
            run.analysed += 1;
            run.remaining = run.remaining.saturating_sub(1);
            run.missed_tactics += report.tactics.len() as u32;
        }
        run.calculated = analyzer.searches;
        analyzer.quit().await;
        prober.quit().await;
        match outcome {
            // Stopping is not a failure: what is done is saved.
            Ok(()) | Err(Error::AnalysisCancelled) => Ok(run),
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

/// The statistics over every analysed game, or only those of `player`.
#[tauri::command]
#[specta::specta]
pub async fn insight_summary(
    player: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<InsightSummary, Error> {
    state.insight.summary(player.as_deref())
}

/// Forgets every game analysis (the position store keeps its evaluations).
#[tauri::command]
#[specta::specta]
pub async fn insight_clear(state: tauri::State<'_, AppState>) -> Result<(), Error> {
    state.insight.clear()
}

#[cfg(test)]
mod tests {
    use super::*;
    use shakmaty::uci::UciMove;

    fn info(white_side: bool, result: &str) -> GameInfo {
        GameInfo {
            key: format!("https://lichess.org/test{white_side}{result}"),
            source: "ich_lichess.duckdb".into(),
            player: "ich".into(),
            white_side,
            white: if white_side { "ich" } else { "gegner" }.into(),
            black: if white_side { "gegner" } else { "ich" }.into(),
            result: result.into(),
            date: "2026-03-14".into(),
            time_control: "300+3".into(),
            player_rating: Some(1500),
            opponent_rating: Some(1550),
        }
    }

    fn play(line: &str) -> (Chess, Vec<Move>) {
        let start = Chess::default();
        let mut pos = start.clone();
        let moves = line
            .split_whitespace()
            .map(|u| {
                let m = u.parse::<UciMove>().unwrap().to_move(&pos).unwrap();
                pos.play_unchecked(m);
                m
            })
            .collect();
        (start, moves)
    }

    /// A game goes into a database and comes back out the way Insight reads it.
    #[test]
    fn reads_the_players_games_from_a_database() {
        use aix_chess_compression::{CompressionLevel, Encode, Encoder};

        // 1.e4 e5 (1...c5 2.Nf3) 2.Nf3: the variation must not end up in the main line.
        let mut encoder = Encoder::new_with_initial_fen(CompressionLevel::Low, None).unwrap();
        let (_, main) = play("e2e4 e7e5 g1f3");
        let (_, side) = play("e2e4 c7c5 g1f3");
        encoder.encode_move(main[0]).unwrap();
        encoder.encode_move(main[1]).unwrap();
        encoder.encode_start_variation();
        encoder.encode_move(side[1]).unwrap();
        encoder.encode_move(side[2]).unwrap();
        encoder.encode_end_variation();
        encoder.encode_move(main[2]).unwrap();
        let movedata = encoder.finish().into_bytes();

        let (start, moves) = decode_mainline(&movedata, None).unwrap();
        assert_eq!(start, Chess::default());
        assert_eq!(moves, main);

        let db = duckdb::Connection::open_in_memory().unwrap();
        db.execute_batch(include_str!("../db/init-database.sql"))
            .unwrap();
        let mut insert = db
            .prepare(
                "INSERT INTO games (site, white, black, white_rating, black_rating, result,
                                    time_control, utc_timestamp, movedata)
                 VALUES (?, ?, ?, ?, ?, ?, '300+3', CAST(? AS TIMESTAMP), ?)",
            )
            .unwrap();
        for (site, white, black, date) in [
            (
                "https://lichess.org/aaa",
                "Ich",
                "gegner",
                "2026-01-05 10:00:00",
            ),
            (
                "https://lichess.org/bbb",
                "gegner",
                "ich",
                "2026-03-14 10:00:00",
            ),
            ("https://lichess.org/ccc", "x", "y", "2026-03-15 10:00:00"),
        ] {
            insert
                .execute(duckdb::params![
                    site, white, black, 1500, 1600, "1-0", date, movedata
                ])
                .unwrap();
        }
        let games = load_games(&db, "ich_lichess.duckdb", "ich").unwrap();
        assert_eq!(games.len(), 2);
        // Newest first, and seen from the player.
        assert_eq!(games[0].info.key, "https://lichess.org/bbb");
        assert!(!games[0].info.white_side);
        assert_eq!(games[0].info.outcome(), "loss");
        assert_eq!(games[0].info.player_rating, Some(1600));
        assert_eq!(games[0].info.date, "2026-03-14");
        assert!(games[1].info.white_side);
        assert_eq!(games[1].movedata, movedata);
    }

    #[test]
    fn speed_classes() {
        assert_eq!(speed("60"), "bullet");
        assert_eq!(speed("120+1"), "bullet");
        assert_eq!(speed("180"), "blitz");
        assert_eq!(speed("300+3"), "blitz");
        assert_eq!(speed("600"), "rapid");
        assert_eq!(speed("900+10"), "rapid");
        assert_eq!(speed("1800"), "classical");
        assert_eq!(speed("1/86400"), "daily");
        assert_eq!(speed("-"), "");
    }

    #[test]
    fn accuracy_falls_with_the_loss() {
        assert!(move_accuracy(0.0) > 99.9);
        assert!(move_accuracy(0.1) > move_accuracy(0.3));
        assert!(move_accuracy(0.3) < 55.0);
        assert_eq!(move_accuracy(2.0), 0.0);
    }

    #[test]
    fn outcome_is_seen_from_the_player() {
        assert_eq!(info(true, "1-0").outcome(), "win");
        assert_eq!(info(false, "1-0").outcome(), "loss");
        assert_eq!(info(false, "1/2-1/2").outcome(), "draw");
        assert_eq!(info(true, "*").outcome(), "");
    }

    #[test]
    fn opening_families() {
        assert_eq!(
            opening_family("Sicilian Defense: Najdorf Variation"),
            "Sicilian Defense"
        );
        assert_eq!(opening_family("Englund Gambit"), "Englund Gambit");
    }

    #[test]
    fn summary_groups_the_saved_games() {
        let store = InsightStore::open_in_memory();
        let mut report = GameReport {
            plies: 40,
            opening: "Sicilian Defense: Najdorf Variation".into(),
            accuracy: 90.0,
            opponent_accuracy: 80.0,
            acpl: 20.0,
            blunders: 1,
            ..Default::default()
        };
        report.phases.insert(
            "middlegame",
            PhaseStats {
                moves: 20,
                accuracy_sum: 1800.0,
                blunders: 1,
                ..Default::default()
            },
        );
        report.errors.push(MoveError {
            ply: 31,
            fen: "fen".into(),
            played: "Qd2".into(),
            best: "Nxe5".into(),
            loss: 40.0,
            class: 3,
            phase: "middlegame",
        });
        store
            .save(&info(true, "1-0"), &report, 18, "Stockfish")
            .unwrap();
        report.accuracy = 70.0;
        report.opening = "Sicilian Defense".into();
        store
            .save(&info(false, "1-0"), &report, 18, "Stockfish")
            .unwrap();
        // Saving a game again replaces it.
        store
            .save(&info(false, "1-0"), &report, 24, "Stockfish")
            .unwrap();

        let summary = store.summary(None).unwrap();
        assert_eq!(summary.games, 2);
        assert_eq!(summary.accuracy, 80.0);
        assert_eq!(summary.by_color.len(), 2);
        assert_eq!(summary.by_opening.len(), 1);
        assert_eq!(summary.by_opening[0].key, "Sicilian Defense");
        assert_eq!(summary.by_opening[0].score, 50.0);
        assert_eq!(summary.by_speed[0].key, "blitz");
        assert_eq!(summary.by_month[0].key, "2026-03");
        assert_eq!(summary.phases[0].accuracy, 90.0);
        assert_eq!(summary.phases[0].blunders, 2);
        assert_eq!(summary.worst.len(), 2);
        assert_eq!(summary.worst[0].best, "Nxe5");
        assert_eq!(summary.players, vec!["ich"]);

        assert_eq!(store.summary(Some("jemand")).unwrap().games, 0);
        assert_eq!(
            store.analysed_depth(&info(false, "1-0").key).unwrap(),
            Some(24)
        );
        assert_eq!(
            store
                .count_analysed("ich_lichess.duckdb", "ICH", 24)
                .unwrap(),
            1
        );
        assert_eq!(
            store
                .count_analysed("ich_lichess.duckdb", "ICH", 18)
                .unwrap(),
            2
        );
        store.clear().unwrap();
        assert_eq!(store.summary(None).unwrap().games, 0);
    }

    /// Needs an engine: `JBLBASE_TEST_ENGINE=/path/to/stockfish cargo test -- --ignored insight`
    #[tokio::test]
    #[ignore]
    async fn analyses_a_game_and_finds_the_missed_tactic() {
        let engine = PathBuf::from(std::env::var("JBLBASE_TEST_ENGINE").unwrap());
        let cache = EvalCache::open_in_memory();
        let mut analyzer = Analyzer::new(engine.clone(), &[]).await.unwrap();
        let mut prober = Analyzer::new(engine, &[]).await.unwrap();
        let cancel = AtomicBool::new(false);

        // Black has 6...Bb4 winning after 6.Bc3, plays 6...Nf6 instead, and
        // White gives the queen back to mate: 7.Bxb2 is not played either.
        let (start, moves) =
            play("d2d4 e7e5 d4e5 b8c6 g1f3 d8e7 c1f4 e7b4 f4d2 b4b2 d2c3 g8f6 c3b2 f6g4");
        let report = analyse_game(
            &mut analyzer,
            &mut prober,
            Some(&cache),
            &RatingModel::default(),
            12,
            &info(false, "0-1"),
            &start,
            &moves,
            &cancel,
            |_| {},
        )
        .await
        .unwrap();
        println!("{report:#?}");
        assert_eq!(report.plies, 14);
        assert!(report.opening.contains("Englund"), "{}", report.opening);
        assert!(report.blunders >= 1);
        assert!(report.accuracy < 95.0 && report.accuracy > 20.0);
        let missed = report
            .tactics
            .iter()
            .find(|t| t.moves[0] == "d2c3")
            .expect("6...Bb4 was missed");
        assert_eq!(missed.moves[1], "f8b4");
        assert_eq!(missed.line, "gegner – ich (2026-03-14), 6...");
        let error = report.errors.iter().find(|e| e.ply == 11).unwrap();
        assert_eq!(error.played, "Nf6");
        assert_eq!(error.best, "Bb4");
    }
}
