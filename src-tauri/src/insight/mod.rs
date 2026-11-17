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
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
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
        engine::{
            fen_of, split_power, start_analyzers, with_threads_and_hash, Analyzer, Line, Prober,
            MAX_WORKERS,
        },
        is_winning, motifs,
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
pub(crate) const MIN_PLIES: usize = 8;
/// "!!": the move gives up at least this much material (an exchange) ...
const BRILLIANT_SACRIFICE: i32 = 200;
/// ... is the engine's best move or at most this many centipawns worse ...
const BRILLIANT_MARGIN: i32 = 10;
/// ... leaves the player at least this well off ...
const BRILLIANT_FLOOR: i32 = -80;
/// ... and the player was not already winning by more than this before.
const BRILLIANT_CEILING: i32 = 400;
/// `MoveError::class` of a brilliant move.
pub const BRILLIANT: u8 = 4;
/// Version of the analysis. Games analysed by an older version count as not
/// analysed, so the next run adds what is new (brilliant moves, the opening
/// the player chose).
pub const ANALYSIS_VERSION: u32 = 2;

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

    pub(crate) fn color(&self) -> Color {
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
    /// 1 inaccuracy, 2 mistake, 3 blunder, 4 brilliant (`BRILLIANT`).
    pub class: u8,
    pub phase: &'static str,
}

/// The analysis of one game from the player's side.
#[derive(Debug, Clone, Default)]
pub struct GameReport {
    pub plies: u32,
    pub opening: String,
    /// The opening as far as the player's own moves named it: the deepest
    /// known position reached by one of their moves.
    pub own_opening: String,
    pub accuracy: f64,
    pub opponent_accuracy: f64,
    pub acpl: f64,
    pub inaccuracies: u32,
    pub mistakes: u32,
    pub blunders: u32,
    pub brilliants: u32,
    pub phases: BTreeMap<&'static str, PhaseStats>,
    /// Errors and brilliant moves (class `BRILLIANT`) of the player.
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
    prober: &mut Prober,
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
    let opening_of =
        |p: &Chess| get_opening_from_setup(p.clone().to_setup(shakmaty::EnPassantMode::Legal)).ok();
    let opening = positions
        .iter()
        .take(40)
        .rev()
        .find_map(opening_of)
        .unwrap_or_default();
    // The same, counting only positions the player's own moves led to.
    let own_opening = positions
        .iter()
        .enumerate()
        .take(40)
        .skip(1)
        .rev()
        .filter(|(i, _)| positions[i - 1].turn() == color)
        .find_map(|(_, p)| opening_of(p))
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
            // One line is enough for the accuracy of a move. The second line
            // (is the best move the only one?) is only needed where the
            // player missed a winning move, and fetched there.
            evals.push(Some(analyzer.analyze(cache, p, depth, 1).await?));
        }
    }

    let mut report = GameReport {
        plies: moves.len() as u32,
        opening,
        own_opening,
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
        } else if is_brilliant(
            &positions[i],
            &moves[i],
            best_move == Some(moves[i]) || capped_cp(best) - after_cp <= BRILLIANT_MARGIN,
            // How the player stood before the opponent's last move: a
            // sacrifice that wins only because the opponent blundered still
            // counts, one in a position won long ago does not.
            match i
                .checked_sub(1)
                .and_then(|k| evals[k].as_ref())
                .and_then(|l| l.first())
            {
                Some(line) => -capped_cp(line),
                None => capped_cp(best),
            },
            after_cp,
        ) {
            report.brilliants += 1;
            report.errors.push(MoveError {
                ply: i as u32,
                fen: fen_of(&positions[i]),
                played: sans[i].clone(),
                best: sans[i].clone(),
                loss: 0.0,
                class: BRILLIANT,
                phase,
            });
        }

        // A tactic that was there and not played becomes a puzzle.
        if i == 0
            || best_move == Some(moves[i])
            || !is_winning(best)
            || covered.contains(&position_key(&positions[i]))
        {
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
        let prober = prober.get().await?;
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

/// Whether the engine's best move, played, deserves "!!": it gives up at
/// least an exchange, the player is still fine afterwards, and they were not
/// already winning before the opponent's last move. `before_cp` (that
/// position) and `after_cp` (after the move) are from the player's side.
pub(crate) fn is_brilliant(
    pos: &Chess,
    played: &Move,
    is_best: bool,
    before_cp: i32,
    after_cp: i32,
) -> bool {
    is_best
        && after_cp >= BRILLIANT_FLOOR
        && before_cp <= BRILLIANT_CEILING
        && pos.legal_moves().len() >= 2
        && crate::brilliance::sacrifice_value(pos, played) >= BRILLIANT_SACRIFICE
}

/// A game as read from an account's database.
pub(crate) struct StoredGame {
    pub info: GameInfo,
    pub fen: Option<String>,
    pub movedata: Vec<u8>,
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
pub(crate) fn load_games(
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

pub(crate) fn source_name(file: &std::path::Path) -> String {
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

#[derive(Serialize, Debug, Type, Default, Clone)]
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
        let run = InsightRunResult {
            remaining: waiting,
            ..Default::default()
        };
        if todo.is_empty() {
            return Ok(run);
        }

        // Several engines side by side, each on its own game (see `split_power`).
        let path = PathBuf::from(&options.engine);
        let (workers, threads, hash) = split_power(&options.uci_options, todo.len(), MAX_WORKERS);
        let worker_options = with_threads_and_hash(&options.uci_options, threads, hash);
        let analyzers = start_analyzers(&path, &worker_options, workers).await?;
        let engine_name = analyzers[0].name().to_string();
        let model = state.rating.model();
        let total = todo.len() as f32;

        let next = AtomicUsize::new(0);
        // Share done of every game, and the progress last reported.
        let progress = Mutex::new((vec![0.0f32; todo.len()], -1.0f32));
        let run = Mutex::new(run);
        let report_progress = |n: usize, share: f32| {
            let mut guard = progress.lock().unwrap_or_else(|e| e.into_inner());
            let (shares, last) = &mut *guard;
            shares[n] = share;
            let done = (shares.iter().sum::<f32>() / total * 100.0).min(99.9);
            if done - *last >= 0.1 {
                *last = done;
                let _ = update_progress(&state.progress_state, &app, id.clone(), done, false);
            }
        };

        let (todo, next, run, cancel, model, path) = (&todo, &next, &run, &*cancel, &model, &path);
        let (report_progress, engine_name, options) = (&report_progress, &engine_name, &options);
        let state = &state;
        let results =
            futures_util::future::join_all(analyzers.into_iter().map(|mut analyzer| async move {
                let mut prober = Prober::new(path.clone());
                let outcome: Result<(), Error> = async {
                    loop {
                        if cancel.load(Ordering::SeqCst) {
                            return Err(Error::AnalysisCancelled);
                        }
                        let n = next.fetch_add(1, Ordering::SeqCst);
                        let Some(game) = todo.get(n) else {
                            return Ok(());
                        };
                        let decoded = decode_mainline(&game.movedata, game.fen.as_deref());
                        let (start, moves) = match decoded {
                            Ok((start, moves)) if moves.len() >= MIN_PLIES => (start, moves),
                            _ => {
                                let mut run = run.lock().unwrap_or_else(|e| e.into_inner());
                                run.failed += 1;
                                run.remaining = run.remaining.saturating_sub(1);
                                drop(run);
                                report_progress(n, 1.0);
                                continue;
                            }
                        };
                        analyzer.clear_memo();
                        let report = analyse_game(
                            &mut analyzer,
                            &mut prober,
                            Some(&state.eval_cache),
                            model,
                            options.depth,
                            &game.info,
                            &start,
                            &moves,
                            cancel,
                            |share| report_progress(n, share),
                        )
                        .await?;
                        state
                            .insight
                            .save(&game.info, &report, options.depth, engine_name)?;
                        if !report.tactics.is_empty() || options.tactics_dest.exists() {
                            tactic_store::replace_source(
                                &options.tactics_dest,
                                &game.info.key,
                                &report.tactics,
                            )?;
                            crate::puzzle::forget_cached_puzzles(&options.tactics_dest);
                        }
                        let mut run = run.lock().unwrap_or_else(|e| e.into_inner());
                        run.analysed += 1;
                        run.remaining = run.remaining.saturating_sub(1);
                        run.missed_tactics += report.tactics.len() as u32;
                    }
                }
                .await;
                // A real error stops the other engines too.
                if outcome.is_err() {
                    cancel.store(true, Ordering::SeqCst);
                }
                let searches = analyzer.searches;
                analyzer.quit().await;
                prober.quit().await;
                (outcome, searches)
            }))
            .await;

        let mut run = run.lock().unwrap_or_else(|e| e.into_inner()).clone();
        run.calculated = results.iter().map(|(_, searches)| searches).sum();
        // Stopping is not a failure: what is done is saved.
        match results.into_iter().find_map(|(outcome, _)| {
            outcome
                .err()
                .filter(|e| !matches!(e, Error::AnalysisCancelled))
        }) {
            None => Ok(run),
            Some(error) => Err(error),
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

/// An analysed game, ready to open on a board.
#[derive(Serialize, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct InsightGame {
    /// The moves in PGN, with Insight's marks ("??", "!!" ...), the better
    /// move as a variation after each error, and the evaluations it used.
    pub pgn: String,
    /// Start position when the game did not start from the usual one.
    pub fen: Option<String>,
    pub white: String,
    pub black: String,
    pub date: String,
    pub result: String,
    pub site: String,
    pub time_control: String,
    pub white_elo: Option<i32>,
    pub black_elo: Option<i32>,
    /// Whether the player had White (the board is turned to their side).
    pub white_side: bool,
}

/// Engine evaluation of `pos` from the position store, preferring the engine
/// Insight used. Lines are scored from White's point of view.
fn stored_eval(
    cache: &EvalCache,
    pos: &Chess,
    engine: &str,
) -> Option<crate::eval_cache::CachedEval> {
    let mut found = cache.lookup_all(&position_key(pos));
    found.sort_by_key(|e| (!e.engine.starts_with(engine), std::cmp::Reverse(e.depth)));
    found.into_iter().find(|e| !e.lines.is_empty())
}

/// "[%eval 0.35,18]" or "[%eval #-3,24]".
fn eval_comment(eval: &crate::eval_cache::CachedEval) -> Option<String> {
    let line = eval.lines.iter().min_by_key(|l| l.multipv)?;
    let value = match (line.mate, line.cp) {
        (Some(m), _) => format!("#{m}"),
        (None, Some(cp)) => format!("{:.2}", cp as f64 / 100.0),
        (None, None) => return None,
    };
    Some(format!("[%eval {value},{}]", eval.depth))
}

fn move_prefix(pos: &Chess, force: bool) -> String {
    if pos.turn() == Color::White {
        format!("{}. ", pos.fullmoves())
    } else if force {
        format!("{}... ", pos.fullmoves())
    } else {
        String::new()
    }
}

/// Up to `max` plies of a stored line in SAN, starting at `pos`.
fn line_san(pos: &Chess, uci: &[String], max: usize) -> Vec<String> {
    let mut pos = pos.clone();
    let mut out = Vec::new();
    for u in uci.iter().take(max) {
        let Some(m) = u
            .parse::<shakmaty::uci::UciMove>()
            .ok()
            .and_then(|u| u.to_move(&pos).ok())
        else {
            break;
        };
        out.push(SanPlus::from_move_and_play_unchecked(&mut pos, m).to_string());
    }
    out
}

/// Writes the moves of a game as PGN with Insight's marks and evaluations.
pub(crate) fn annotated_pgn(
    start: &Chess,
    moves: &[Move],
    marks: &[store::MarkedMove],
    cache: Option<&EvalCache>,
    engine: &str,
) -> String {
    let mut out = String::new();
    let mut pos = start.clone();
    let mut after_comment = true;
    for (ply, m) in moves.iter().enumerate() {
        let before = pos.clone();
        let san = SanPlus::from_move_and_play_unchecked(&mut pos, *m).to_string();
        out.push_str(&move_prefix(&before, after_comment));
        out.push_str(&san);
        after_comment = false;
        let mark = marks.iter().find(|mk| mk.ply == ply as u32);
        if let Some(mark) = mark {
            out.push_str(match mark.class {
                1 => " $6",
                2 => " $2",
                3 => " $4",
                BRILLIANT => " $3",
                _ => "",
            });
        }
        if let Some(comment) = cache
            .filter(|_| !pos.is_game_over())
            .and_then(|c| stored_eval(c, &pos, engine))
            .and_then(|e| eval_comment(&e))
        {
            out.push_str(&format!(" {{ {comment} }}"));
            after_comment = true;
        }
        // After an error, what was better.
        if let Some(mark) = mark.filter(|mk| mk.class != BRILLIANT) {
            let from_cache = cache
                .and_then(|c| stored_eval(c, &before, engine))
                .and_then(|e| e.lines.into_iter().min_by_key(|l| l.multipv))
                .map(|l| line_san(&before, &l.uci, 8))
                .filter(|line| line.first() == Some(&mark.best));
            let line = from_cache.unwrap_or_else(|| vec![mark.best.clone()]);
            if !mark.best.is_empty() {
                let mut variation = before.clone();
                let mut text = String::new();
                for (k, san) in line.iter().enumerate() {
                    text.push_str(&move_prefix(&variation, k == 0));
                    text.push_str(san);
                    text.push(' ');
                    let Some(next) = san
                        .parse::<SanPlus>()
                        .ok()
                        .and_then(|s| s.san.to_move(&variation).ok())
                    else {
                        break;
                    };
                    variation.play_unchecked(next);
                }
                out.push_str(&format!(" ({})", text.trim_end()));
                after_comment = true;
            }
        }
        out.push(' ');
    }
    out.trim_end().to_string()
}

/// One analysed game with Insight's marks, to open on a board. `accounts`
/// are the databases the games may come from.
#[tauri::command]
#[specta::specta]
pub async fn insight_game(
    key: String,
    accounts: Vec<InsightAccount>,
    state: tauri::State<'_, AppState>,
) -> Result<InsightGame, Error> {
    let not_found = || Error::from(std::io::Error::other("Die Partie ist nicht mehr da."));
    let analysed = state.insight.game(&key)?.ok_or_else(not_found)?;
    let account = accounts
        .iter()
        .find(|a| {
            source_name(&a.file) == analysed.source
                && a.player.to_lowercase() == analysed.player.to_lowercase()
        })
        .or_else(|| {
            accounts
                .iter()
                .find(|a| source_name(&a.file) == analysed.source)
        })
        .ok_or_else(not_found)?;
    let pool = get_duckdb_pool(&state, &account.file)?;
    let game = {
        let db = pool.get()?;
        load_games(&db, &analysed.source, &analysed.player)?
            .into_iter()
            .find(|g| g.info.key == key)
            .ok_or_else(not_found)?
    };
    let (start, moves) =
        decode_mainline(&game.movedata, game.fen.as_deref()).map_err(std::io::Error::other)?;
    let pgn = annotated_pgn(
        &start,
        &moves,
        &analysed.moves,
        Some(&state.eval_cache),
        &analysed.engine,
    );
    let info = game.info;
    let (white_elo, black_elo) = if info.white_side {
        (info.player_rating, info.opponent_rating)
    } else {
        (info.opponent_rating, info.player_rating)
    };
    Ok(InsightGame {
        pgn,
        fen: game.fen,
        site: if key.contains("://") {
            key.clone()
        } else {
            String::new()
        },
        white: info.white,
        black: info.black,
        date: info.date.replace('-', "."),
        result: info.result,
        time_control: info.time_control,
        white_elo,
        black_elo,
        white_side: info.white_side,
    })
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
            own_opening: "Sicilian Defense: Open".into(),
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
        report.errors.push(MoveError {
            ply: 41,
            fen: "fen".into(),
            played: "Rxh7+".into(),
            best: "Rxh7+".into(),
            loss: 0.0,
            class: BRILLIANT,
            phase: "endgame",
        });
        report.brilliants = 1;
        store
            .save(&info(true, "1-0"), &report, 18, "Stockfish")
            .unwrap();
        report.accuracy = 70.0;
        report.opening = "Sicilian Defense".into();
        report.own_opening = "French Defense".into();
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
        // Only the openings named by the player's own moves, per color.
        assert_eq!(summary.by_opening_white.len(), 1);
        assert_eq!(summary.by_opening_white[0].key, "Sicilian Defense");
        assert_eq!(summary.by_opening_white[0].score, 100.0);
        assert_eq!(summary.by_opening_black.len(), 1);
        assert_eq!(summary.by_opening_black[0].key, "French Defense");
        assert_eq!(summary.by_opening_black[0].score, 0.0);
        assert_eq!(summary.brilliants, 2);
        assert_eq!(summary.brilliant.len(), 2);
        assert_eq!(summary.brilliant[0].class, BRILLIANT);
        assert_eq!(summary.outdated, 0);
        assert_eq!(summary.by_speed[0].key, "blitz");
        assert_eq!(summary.by_month[0].key, "2026-03");
        assert_eq!(summary.phases[0].accuracy, 90.0);
        assert_eq!(summary.phases[0].blunders, 2);
        assert_eq!(summary.worst.len(), 2);
        assert_eq!(summary.worst[0].best, "Nxe5");
        assert!(summary.worst.iter().all(|e| e.class == 3));
        assert_eq!(summary.players, vec!["ich"]);

        let game = store.game(&info(true, "1-0").key).unwrap().unwrap();
        assert_eq!(game.source, "ich_lichess.duckdb");
        assert!(game.white_side);
        assert_eq!(game.engine, "Stockfish");
        assert_eq!(
            game.moves
                .iter()
                .map(|m| (m.ply, m.class))
                .collect::<Vec<_>>(),
            vec![(31, 3), (41, BRILLIANT)]
        );
        assert_eq!(store.game("gibt es nicht").unwrap(), None);

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

    /// Games analysed before brilliant moves and the own opening existed
    /// count as not analysed, so the next run updates them.
    #[test]
    fn older_analyses_are_done_again() {
        let store = InsightStore::open_in_memory();
        let game = info(true, "1-0");
        store
            .save(&game, &GameReport::default(), 18, "Stockfish")
            .unwrap();
        assert_eq!(store.analysed_depth(&game.key).unwrap(), Some(18));
        store.set_version_for_test(&game.key, 1);
        assert_eq!(store.analysed_depth(&game.key).unwrap(), None);
        assert_eq!(
            store
                .count_analysed("ich_lichess.duckdb", "ich", 18)
                .unwrap(),
            0
        );
        assert_eq!(store.summary(None).unwrap().outdated, 1);
    }

    #[test]
    fn brilliant_means_a_sound_sacrifice() {
        // 1.e4 e5 2.Nf3 Nc6 3.Bc4 Nf6: 4.Bxf7+ gives up a bishop for a pawn.
        let (_, moves) = play("e2e4 e7e5 g1f3 b8c6 f1c4 g8f6");
        let mut pos = Chess::default();
        for m in &moves {
            pos.play_unchecked(*m);
        }
        let mv = |u: &str| u.parse::<UciMove>().unwrap().to_move(&pos).unwrap();
        // 4.Bxf7+ Kxf7: a bishop for a pawn.
        let sac = mv("c4f7");
        assert!(is_brilliant(&pos, &sac, true, 30, 25));
        // Not when it loses, not when it is not the best move, and not when
        // the player was winning anyway.
        assert!(!is_brilliant(&pos, &sac, true, 30, -150));
        assert!(!is_brilliant(&pos, &sac, false, 30, 0));
        assert!(!is_brilliant(&pos, &sac, true, 600, 600));
        // A quiet move is no sacrifice.
        assert!(!is_brilliant(&pos, &mv("d2d3"), true, 30, 30));
    }

    #[test]
    fn annotated_game_has_marks_and_better_moves() {
        let (start, moves) = play("e2e4 e7e5 g1f3 b8c6 f1c4 d7d6 f3g5 c8g4");
        let marks = vec![
            store::MarkedMove {
                ply: 5,
                class: 1,
                best: "Nf6".into(),
                loss: 12.0,
            },
            store::MarkedMove {
                ply: 7,
                class: 3,
                best: "Nh6".into(),
                loss: 40.0,
            },
            store::MarkedMove {
                ply: 4,
                class: BRILLIANT,
                best: "Bc4".into(),
                loss: 0.0,
            },
        ];
        let pgn = annotated_pgn(&start, &moves, &marks, None, "Stockfish");
        assert_eq!(
            pgn,
            "1. e4 e5 2. Nf3 Nc6 3. Bc4 $3 d6 $6 (3... Nf6) 4. Ng5 Bg4 $4 (4... Nh6)"
        );
    }

    /// Needs an engine: `JBLBASE_TEST_ENGINE=/path/to/stockfish cargo test -- --ignored insight`
    #[tokio::test]
    #[ignore]
    async fn analyses_a_game_and_finds_the_missed_tactic() {
        let engine = PathBuf::from(std::env::var("JBLBASE_TEST_ENGINE").unwrap());
        let cache = EvalCache::open_in_memory();
        let mut analyzer = Analyzer::new(engine.clone(), &[]).await.unwrap();
        let mut prober = Prober::new(engine);
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
        // Black's own moves led to the Englund Gambit.
        assert!(
            report.own_opening.contains("Englund"),
            "{}",
            report.own_opening
        );
        let error = report.errors.iter().find(|e| e.ply == 11).unwrap();
        assert_eq!(error.played, "Nf6");
        assert_eq!(error.best, "Bb4");
    }

    /// Needs an engine, see above.
    #[tokio::test]
    #[ignore]
    async fn finds_a_brilliant_sacrifice() {
        let engine = PathBuf::from(std::env::var("JBLBASE_TEST_ENGINE").unwrap());
        let cache = EvalCache::open_in_memory();
        let mut analyzer = Analyzer::new(engine.clone(), &[]).await.unwrap();
        let mut prober = Prober::new(engine);
        let cancel = AtomicBool::new(false);
        // French Defense, 7...O-O? 8.Bxh7+! Kxh7 9.Ng5+: the Greek gift.
        let (start, moves) = play(
            "e2e4 e7e6 d2d4 d7d5 b1c3 g8f6 e4e5 f6d7 g1f3 c7c5 d4c5 f8c5 f1d3 e8g8 d3h7 g8h7 f3g5 h7g8",
        );
        let report = analyse_game(
            &mut analyzer,
            &mut prober,
            Some(&cache),
            &RatingModel::default(),
            16,
            &info(true, "1-0"),
            &start,
            &moves,
            &cancel,
            |_| {},
        )
        .await
        .unwrap();
        println!("{:#?}", report.errors);
        assert!(
            report.own_opening.contains("French"),
            "{}",
            report.own_opening
        );
        let brilliant = report.errors.iter().find(|e| e.class == BRILLIANT);
        assert_eq!(brilliant.map(|e| e.played.as_str()), Some("Bxh7+"));
    }
}
