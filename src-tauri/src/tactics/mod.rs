//! Tactic search: finds positions in a set of lines (a repertoire, later the
//! own games) where one side has a single clearly winning move, turns them
//! into puzzles with motifs and an estimated rating, and stores them where
//! the puzzle trainer finds them.

pub mod calibration;
pub mod engine;
pub mod games;
pub mod motifs;
pub mod rating;
pub mod review;
pub mod store;

use std::{
    collections::HashSet,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
    },
};

use serde::{Deserialize, Serialize};
use shakmaty::{fen::Fen, san::SanPlus, uci::UciMove, CastlingMode, Chess, Color, Move, Position};
use specta::Type;

use crate::{
    engine::EngineOption,
    error::Error,
    eval_cache::{position_key, EvalCache, PosKey},
    progress::update_progress,
    AppState,
};

use engine::{fen_of, Analyzer, Line};
use rating::{Features, RatingModel};
use store::StoredTactic;

/// How fussy the search is about what counts as a tactic.
#[derive(Deserialize, Serialize, Debug, Clone, Copy, PartialEq, Eq, Default, Type)]
#[serde(rename_all = "camelCase")]
pub enum Strictness {
    /// More puzzles, some of them easy or with a second decent move.
    Loose,
    /// One clearly best move after a real mistake, no simple recaptures.
    #[default]
    Normal,
    /// Close to what Lichess asks of its own puzzles, with a real motif and
    /// checked once more at a greater depth.
    Strict,
}

/// The limits a position has to meet to become a puzzle.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Criteria {
    /// The best move has to beat the second best by this much (winning
    /// chances from -1 to 1) to count as the only solution. Lichess asks for
    /// 0.7 in its own puzzles.
    pub single_solution: f64,
    /// The second best move may be worth at most this many centipawns.
    pub max_second_best_cp: i32,
    /// The solver has to be at least this much better after the first move.
    pub min_advantage_cp: i32,
    /// The opponent's last move has to have cost at least this much (winning
    /// chances), so that a forced recapture in a won position is no puzzle.
    pub min_gain: f64,
    /// Drop one-move recaptures and grabbing a hanging piece.
    pub skip_trivial: bool,
    /// A one-move solution needs a real motif (fork, pin, mate ...).
    pub need_motif: bool,
    /// The solution has at least this many solver moves.
    pub min_solver_moves: usize,
    /// A found tactic is checked once more this many plies deeper.
    pub verify_extra_depth: u32,
}

impl Criteria {
    pub fn new(strictness: Strictness, min_solver_moves: u32) -> Self {
        let base = match strictness {
            Strictness::Loose => Criteria {
                single_solution: 0.4,
                max_second_best_cp: 150,
                min_advantage_cp: 150,
                min_gain: 0.25,
                skip_trivial: false,
                need_motif: false,
                min_solver_moves: 1,
                verify_extra_depth: 0,
            },
            Strictness::Normal => Criteria {
                single_solution: 0.5,
                max_second_best_cp: 100,
                min_advantage_cp: 200,
                min_gain: 0.3,
                skip_trivial: true,
                need_motif: false,
                min_solver_moves: 1,
                verify_extra_depth: 4,
            },
            Strictness::Strict => Criteria {
                single_solution: 0.6,
                max_second_best_cp: 50,
                min_advantage_cp: 300,
                min_gain: 0.4,
                skip_trivial: true,
                need_motif: true,
                min_solver_moves: 1,
                verify_extra_depth: 6,
            },
        };
        Criteria {
            min_solver_moves: (min_solver_moves as usize).max(1),
            ..base
        }
    }

    pub fn is_winning(&self, line: &Line) -> bool {
        match (line.mate, line.cp) {
            (Some(m), _) => m > 0,
            (None, Some(cp)) => cp >= self.min_advantage_cp,
            (None, None) => false,
        }
    }

    /// Is the first line the only good move? `legal` is the number of legal moves.
    pub fn is_only_move(&self, lines: &[Line], legal: usize) -> bool {
        let Some(best) = lines.first() else {
            return false;
        };
        if legal == 1 {
            return true;
        }
        let Some(second) = lines.get(1) else {
            return false;
        };
        if best.mate.is_some_and(|m| m > 0) {
            // A mate is the solution as long as nothing else mates or wins big.
            return second.mate.is_none_or(|m| m < 0) && second.cp.is_none_or(|cp| cp < 400);
        }
        best.win_chances() - second.win_chances() >= self.single_solution
            && second.mate.is_none_or(|m| m < 0)
            && second.cp.is_none_or(|cp| cp <= self.max_second_best_cp)
    }

    /// Is a found solution worth a puzzle? `lead` is the opponent's move into
    /// the position.
    pub fn accepts(&self, lead: &Move, solution: &[Move], themes: &[&str]) -> bool {
        if solution.len().div_ceil(2) < self.min_solver_moves {
            return false;
        }
        if self.skip_trivial && motifs::is_trivial(lead, solution, themes) {
            return false;
        }
        if self.need_motif && solution.len() == 1 && !motifs::has_real_motif(themes) {
            return false;
        }
        true
    }
}

impl Default for Criteria {
    fn default() -> Self {
        Criteria::new(Strictness::Normal, 1)
    }
}

/// A solution never gets longer than this many solver moves.
const MAX_SOLVER_MOVES: usize = 8;
/// How deep the rating probe looks for the solution.
const PROBE_DEPTH: u32 = 14;
/// Deepest search the check of a found tactic goes to.
const MAX_VERIFY_DEPTH: u32 = 40;

pub(crate) fn is_winning(line: &Line) -> bool {
    Criteria::default().is_winning(line)
}

/// Is the first line the only good move? `legal` is the number of legal moves.
pub(crate) fn is_only_move(lines: &[Line], legal: usize) -> bool {
    Criteria::default().is_only_move(lines, legal)
}

pub(crate) fn eval_cp(line: &Line) -> i32 {
    match (line.mate, line.cp) {
        (Some(m), _) => {
            if m > 0 {
                10_000
            } else {
                -10_000
            }
        }
        (None, Some(cp)) => cp,
        (None, None) => 0,
    }
}

/// A position to check: the solver is to move in `start`, which came about by
/// `lead` played in `parent`.
struct Candidate {
    parent: Chess,
    lead: Move,
    start: Chess,
    /// The moves up to and including `lead`, as text.
    line: String,
}

/// Collects every position of `lines` (each a list of UCI moves from `root`)
/// in which `solver` is to move, each position once.
fn collect_candidates(
    root: &Chess,
    lines: &[Vec<String>],
    solver: Color,
) -> Result<Vec<Candidate>, Error> {
    let mut seen: HashSet<PosKey> = HashSet::new();
    let mut candidates = Vec::new();
    for line in lines {
        let mut pos = root.clone();
        let mut text = String::new();
        for (i, uci) in line.iter().enumerate() {
            let m = UciMove::from_ascii(uci.as_bytes())?.to_move(&pos)?;
            let parent = pos.clone();
            if pos.turn() == Color::White {
                if !text.is_empty() {
                    text.push(' ');
                }
                text.push_str(&format!("{}.", pos.fullmoves()));
            } else if i == 0 {
                text.push_str(&format!("{}...", pos.fullmoves()));
            }
            text.push(' ');
            text.push_str(&SanPlus::from_move_and_play_unchecked(&mut pos, m).to_string());
            if pos.turn() == solver && !pos.is_game_over() && seen.insert(position_key(&pos)) {
                candidates.push(Candidate {
                    parent,
                    lead: m,
                    start: pos.clone(),
                    line: text.clone(),
                });
            }
        }
    }
    Ok(candidates)
}

/// Follows the solution from `start` as long as the solver has a single
/// winning move. Returns the moves (solver, opponent, solver, ...) and the
/// evaluation at the solver's last move.
pub(crate) async fn build_solution(
    analyzer: &mut Analyzer,
    cache: Option<&EvalCache>,
    criteria: &Criteria,
    depth: u32,
    start: &Chess,
    first: &[Line],
) -> Result<Option<(Vec<Move>, Line)>, Error> {
    let Some(mut best) = first.first().cloned() else {
        return Ok(None);
    };
    let Some(mut next) = best.first_move(start) else {
        return Ok(None);
    };
    let mut pos = start.clone();
    let mut moves = Vec::new();
    loop {
        moves.push(next);
        pos.play_unchecked(next);
        if pos.is_game_over() || moves.len().div_ceil(2) >= MAX_SOLVER_MOVES {
            break;
        }
        // The opponent's best reply: one line is enough.
        let replies = analyzer.analyze(cache, &pos, depth, 1).await?;
        let Some(reply) = replies.first().and_then(|l| l.first_move(&pos)) else {
            break;
        };
        let mut after = pos.clone();
        after.play_unchecked(reply);
        if after.is_game_over() {
            break;
        }
        let lines = analyzer.analyze(cache, &after, depth, 2).await?;
        let legal = after.legal_moves().len();
        let Some(line) = lines.first() else {
            break;
        };
        if !criteria.is_winning(line) || !criteria.is_only_move(&lines, legal) {
            break;
        }
        let Some(m) = line.first_move(&after) else {
            break;
        };
        moves.push(reply);
        pos = after;
        best = line.clone();
        next = m;
    }
    Ok(Some((moves, best)))
}

/// Keys of the positions in which the solver is to move during `solution`.
fn solver_positions(start: &Chess, solution: &[Move]) -> Vec<PosKey> {
    let mut pos = start.clone();
    let mut keys = Vec::new();
    for (n, m) in solution.iter().enumerate() {
        if n % 2 == 0 {
            keys.push(position_key(&pos));
        }
        pos.play_unchecked(*m);
    }
    keys
}

/// Measures what the rating estimate needs about a puzzle: `start` is the
/// position the solver sees, `solution` the moves from there and `themes`
/// its motifs. The probe engine looks how deep it has to search for each of
/// the solver's moves.
pub async fn features_of(
    prober: &mut Analyzer,
    start: &Chess,
    solution: &[Move],
    themes: &[&'static str],
) -> Result<Features, Error> {
    let mut pos = start.clone();
    let mut first_depth = 0;
    let mut max_depth = 0;
    for (n, m) in solution.iter().enumerate() {
        if n % 2 == 0 {
            let d = if pos.legal_moves().len() == 1 {
                1
            } else {
                prober.solve_depth(&pos, m, PROBE_DEPTH).await?
            };
            if n == 0 {
                first_depth = d;
            }
            max_depth = max_depth.max(d);
        }
        pos.play_unchecked(*m);
    }
    let mut after_first = start.clone();
    let first = solution.first().ok_or(Error::NoMovesFound)?;
    after_first.play_unchecked(*first);
    Ok(Features {
        solver_moves: solution.len().div_ceil(2) as u32,
        first_depth,
        max_depth,
        sacrifice: themes.contains(&"sacrifice"),
        first_capture: first.is_capture(),
        first_check: after_first.is_check(),
    })
}

/// A tactic found in a position, before its rating is measured.
pub struct Found {
    /// The solution: solver, opponent, solver, ...
    pub solution: Vec<Move>,
    /// The evaluation at the solver's last move.
    pub last: Line,
    pub themes: Vec<&'static str>,
    /// Positions in which the solver is to move during the solution.
    pub covered: Vec<PosKey>,
}

/// Is there a tactic for the side to move in `start`, which came about by
/// `lead` played in `parent`?
///
/// A tactic is a single clearly winning move after a real mistake of the
/// opponent. The cheap checks come first: one line for `start` (is the
/// solver winning at all?) and one for `parent` (did the opponent's move
/// really cost something?). Only a position that passes both is searched
/// with two lines, which is what costs the time.
pub async fn examine(
    analyzer: &mut Analyzer,
    cache: Option<&EvalCache>,
    criteria: &Criteria,
    depth: u32,
    parent: &Chess,
    lead: &Move,
    start: &Chess,
) -> Result<Option<Found>, Error> {
    let quick = analyzer.analyze(cache, start, depth, 1).await?;
    let Some(best) = quick.first() else {
        return Ok(None);
    };
    if !criteria.is_winning(best) {
        return Ok(None);
    }
    // What the opponent could have had instead of the move played.
    let before = analyzer.analyze(cache, parent, depth, 1).await?;
    let Some(opponent_best) = before.first() else {
        return Ok(None);
    };
    if best.win_chances() + opponent_best.win_chances() < criteria.min_gain {
        return Ok(None);
    }

    let legal = start.legal_moves().len();
    let first = analyzer.analyze(cache, start, depth, 2).await?;
    match first.first() {
        Some(best) if criteria.is_winning(best) && criteria.is_only_move(&first, legal) => {}
        _ => return Ok(None),
    }
    let Some((solution, last)) =
        build_solution(analyzer, cache, criteria, depth, start, &first).await?
    else {
        return Ok(None);
    };
    let themes = motifs::detect(start, &solution);
    if !criteria.accepts(lead, &solution, &themes) {
        return Ok(None);
    }

    // A second look, deeper: does the move stay the only winning one?
    if criteria.verify_extra_depth > 0 && legal > 1 {
        let deeper = (depth + criteria.verify_extra_depth).min(MAX_VERIFY_DEPTH);
        let check = analyzer.analyze(cache, start, deeper, 2).await?;
        let same_move =
            check.first().and_then(|l| l.first_move(start)) == solution.first().copied();
        let holds = check
            .first()
            .is_some_and(|l| criteria.is_winning(l) && criteria.is_only_move(&check, legal));
        if !same_move || !holds {
            return Ok(None);
        }
    }

    Ok(Some(Found {
        covered: solver_positions(start, &solution),
        solution,
        last,
        themes,
    }))
}

/// Turns a found tactic into a finished puzzle: measures how hard it is and
/// names its phase. `line` is the text shown as the way to the position.
pub async fn finish(
    found: Found,
    prober: &mut Analyzer,
    model: &RatingModel,
    parent: &Chess,
    lead: &Move,
    start: &Chess,
    line: &str,
) -> Result<StoredTactic, Error> {
    let Found {
        solution,
        last,
        mut themes,
        ..
    } = found;
    let features = features_of(prober, start, &solution, &themes).await?;
    themes.push(motifs::phase(start));
    if !themes.contains(&"mate") {
        themes.push(if eval_cp(&last) >= 600 {
            "crushing"
        } else {
            "advantage"
        });
    }
    let mut moves = vec![lead.to_uci(CastlingMode::Standard).to_string()];
    moves.extend(
        solution
            .iter()
            .map(|m| m.to_uci(CastlingMode::Standard).to_string()),
    );
    Ok(StoredTactic {
        fen: fen_of(parent),
        moves,
        rating: model.estimate(&features),
        themes: themes.iter().map(|t| t.to_string()).collect(),
        line: line.to_string(),
        eval_cp: eval_cp(&last),
    })
}

/// Is there a tactic for the side to move in `start`, which came about by
/// `lead` played in `parent`? If so, returns it as a finished puzzle together
/// with the positions its solution covers. Uses the normal criteria.
#[allow(clippy::too_many_arguments)]
pub async fn tactic_at(
    analyzer: &mut Analyzer,
    prober: &mut Analyzer,
    cache: Option<&EvalCache>,
    model: &RatingModel,
    depth: u32,
    parent: &Chess,
    lead: &Move,
    start: &Chess,
    line: &str,
) -> Result<Option<(StoredTactic, Vec<PosKey>)>, Error> {
    let criteria = Criteria::default();
    let Some(found) = examine(analyzer, cache, &criteria, depth, parent, lead, start).await? else {
        return Ok(None);
    };
    let covered = found.covered.clone();
    let tactic = finish(found, prober, model, parent, lead, start, line).await?;
    Ok(Some((tactic, covered)))
}

/// What a search over many positions or games brought.
#[derive(Debug, Default)]
pub struct Outcome {
    /// Positions (or games) looked at.
    pub looked_at: usize,
    /// Searches the engines really ran (the rest came from the position store).
    pub searches: u32,
    pub tactics: Vec<StoredTactic>,
}

/// One engine of a parallel search, with its own prober for the rating.
pub(crate) struct Worker {
    pub analyzer: Analyzer,
    pub prober: engine::Prober,
}

/// Runs `job` for every index below `count` on `analyzers` side by side:
/// each engine takes the next index as soon as it is free. A job gets the
/// worker and the index and hands the worker back with its result. Every
/// engine is shut down at the end; an error stops the others too.
pub(crate) async fn run_parallel<J, F>(
    analyzers: Vec<Analyzer>,
    probe_path: &std::path::Path,
    count: usize,
    cancel: &AtomicBool,
    job: J,
) -> Result<u32, Error>
where
    J: Fn(Worker, usize) -> F,
    F: std::future::Future<Output = (Worker, Result<(), Error>)>,
{
    let next = AtomicUsize::new(0);
    let (next, job) = (&next, &job);
    let results =
        futures_util::future::join_all(analyzers.into_iter().map(|analyzer| async move {
            let mut worker = Worker {
                analyzer,
                prober: engine::Prober::new(probe_path.to_path_buf()),
            };
            let outcome = loop {
                if cancel.load(Ordering::SeqCst) {
                    break Err(Error::AnalysisCancelled);
                }
                let n = next.fetch_add(1, Ordering::SeqCst);
                if n >= count {
                    break Ok(());
                }
                let (back, result) = job(worker, n).await;
                worker = back;
                if let Err(error) = result {
                    break Err(error);
                }
            };
            if outcome.is_err() {
                cancel.store(true, Ordering::SeqCst);
            }
            let searches = worker.analyzer.searches;
            worker.analyzer.quit().await;
            worker.prober.quit().await;
            (outcome, searches)
        }))
        .await;
    let searches = results.iter().map(|(_, s)| s).sum();
    // The first real error wins over the cancellations it caused.
    let mut cancelled = false;
    for (outcome, _) in results {
        match outcome {
            Ok(()) => {}
            Err(Error::AnalysisCancelled) => cancelled = true,
            Err(error) => return Err(error),
        }
    }
    if cancelled {
        return Err(Error::AnalysisCancelled);
    }
    Ok(searches)
}

/// Searches `lines` for tactics of `solver`, with every engine of
/// `analyzers` side by side. `on_progress` gets the share of positions done;
/// the search stops with an error once `cancel` is set.
#[allow(clippy::too_many_arguments)]
pub async fn find_tactics(
    analyzers: Vec<Analyzer>,
    probe_path: &std::path::Path,
    cache: Option<&EvalCache>,
    model: &RatingModel,
    criteria: &Criteria,
    depth: u32,
    root: &Chess,
    lines: &[Vec<String>],
    solver: Color,
    cancel: &AtomicBool,
    on_progress: impl Fn(f32),
) -> Result<Outcome, Error> {
    let candidates = collect_candidates(root, lines, solver)?;
    // Positions that already are part of a found solution are not offered
    // again as a puzzle of their own.
    let covered: Mutex<HashSet<PosKey>> = Mutex::new(HashSet::new());
    let found: Mutex<Vec<(usize, StoredTactic, Vec<PosKey>)>> = Mutex::new(Vec::new());
    let done = AtomicUsize::new(0);
    let total = candidates.len().max(1) as f32;
    let (candidates_ref, covered_ref, found_ref, done_ref, on_progress) =
        (&candidates, &covered, &found, &done, &on_progress);

    let searches = run_parallel(
        analyzers,
        probe_path,
        candidates.len(),
        cancel,
        move |mut worker: Worker, n| async move {
            let result = async {
                let Worker { analyzer, prober } = &mut worker;
                let candidate = &candidates_ref[n];
                let key = position_key(&candidate.start);
                let skip = lock(covered_ref).contains(&key);
                if !skip {
                    if let Some(hit) = examine(
                        analyzer,
                        cache,
                        criteria,
                        depth,
                        &candidate.parent,
                        &candidate.lead,
                        &candidate.start,
                    )
                    .await?
                    {
                        let positions = hit.covered.clone();
                        lock(covered_ref).extend(positions.iter().skip(1).copied());
                        let tactic = finish(
                            hit,
                            prober.get().await?,
                            model,
                            &candidate.parent,
                            &candidate.lead,
                            &candidate.start,
                            &candidate.line,
                        )
                        .await?;
                        lock(found_ref).push((n, tactic, positions));
                    }
                }
                let finished = done_ref.fetch_add(1, Ordering::SeqCst) + 1;
                on_progress(finished as f32 / total);
                Ok(())
            }
            .await;
            (worker, result)
        },
    )
    .await?;

    // Engines side by side can find a puzzle that lies inside the solution
    // of another one; in line order, the first one stays.
    let mut found = found.into_inner().unwrap_or_else(|e| e.into_inner());
    found.sort_by_key(|(n, _, _)| *n);
    let mut inside: HashSet<PosKey> = HashSet::new();
    let mut tactics = Vec::new();
    for (n, tactic, positions) in found {
        if inside.contains(&position_key(&candidates[n].start)) {
            continue;
        }
        inside.extend(positions.into_iter().skip(1));
        tactics.push(tactic);
    }
    on_progress(1.0);
    Ok(Outcome {
        looked_at: candidates.len(),
        searches,
        tactics,
    })
}

pub(crate) fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

#[derive(Deserialize, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct TacticSearchOptions {
    /// Path of the engine to search with.
    pub engine: String,
    pub uci_options: Vec<EngineOption>,
    pub depth: u32,
    /// Start position of the lines.
    pub fen: String,
    /// Every line as UCI moves from `fen`.
    pub lines: Vec<Vec<String>>,
    /// Whose tactics to look for: "white" or "black".
    pub solver: String,
    /// Name the puzzles are filed under; a new search replaces the old ones.
    pub source: String,
    /// The puzzle database to write to.
    pub dest: PathBuf,
    /// How fussy the search is (normal when left out).
    #[serde(default)]
    pub strictness: Strictness,
    /// Only solutions with at least this many own moves.
    #[serde(default)]
    pub min_solver_moves: Option<u32>,
    /// Use at most this many engines side by side (as many as the chosen
    /// power allows when left out).
    #[serde(default)]
    pub max_engines: Option<u32>,
}

#[derive(Serialize, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct TacticSearchResult {
    /// Positions looked at.
    pub positions: u32,
    /// Positions the engine had to calculate (the rest came from the position store).
    pub calculated: u32,
    /// Tactics found for this source.
    pub found: u32,
    /// Of those, newly in the database.
    pub added: u32,
    /// Found, but already in the database from another repertoire or game.
    pub duplicates: u32,
    /// Found, but deleted in an earlier review of reported puzzles.
    pub rejected: u32,
    /// Puzzles in the database after the search.
    pub total: u32,
}

/// Starts the engines for a search: as many side by side as the power the
/// user chose allows (see `engine::split_power`), at most `max_engines`.
pub(crate) async fn start_engines(
    path: &std::path::Path,
    options: &[EngineOption],
    jobs: usize,
    max_engines: Option<u32>,
) -> Result<Vec<Analyzer>, Error> {
    let (count, threads, hash) =
        engine::split_power(options, jobs, max_engines.unwrap_or(engine::MAX_WORKERS));
    let options = engine::with_threads_and_hash(options, threads, hash);
    engine::start_analyzers(path, &options, count).await
}

/// Sends the share done (0 to 1) to the progress bar `id`, at most every
/// tenth of a percent.
pub(crate) fn progress_reporter<'a>(
    state: &'a tauri::State<'_, AppState>,
    app: &'a tauri::AppHandle,
    id: &'a str,
) -> impl Fn(f32) + 'a {
    let last = Mutex::new(-1.0f32);
    move |share: f32| {
        let progress = (share * 100.0).min(99.9);
        let mut last = lock(&last);
        if progress - *last >= 0.1 {
            *last = progress;
            let _ = update_progress(&state.progress_state, app, id.to_string(), progress, false);
        }
    }
}

/// Searches a set of lines for tactics and writes them to a puzzle database.
/// Progress goes to the progress bar `id`; `cancel_analysis(id)` stops it.
#[tauri::command]
#[specta::specta]
pub async fn find_tactics_in_lines(
    id: String,
    options: TacticSearchOptions,
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<TacticSearchResult, Error> {
    let cancel = Arc::new(AtomicBool::new(false));
    state
        .analysis_cancel_flags
        .insert(id.clone(), cancel.clone());

    let result = async {
        let root: Chess =
            Fen::from_ascii(options.fen.as_bytes())?.into_position(CastlingMode::Standard)?;
        let solver = if options.solver == "black" {
            Color::Black
        } else {
            Color::White
        };
        let path = PathBuf::from(&options.engine);
        let candidates = options.lines.iter().map(Vec::len).sum::<usize>() / 2;
        let analyzers =
            start_engines(&path, &options.uci_options, candidates, options.max_engines).await?;
        let criteria = Criteria::new(options.strictness, options.min_solver_moves.unwrap_or(1));
        let report = progress_reporter(&state, &app, &id);
        let Outcome {
            looked_at,
            searches,
            tactics,
        } = find_tactics(
            analyzers,
            &path,
            Some(&state.eval_cache),
            &state.rating.model(),
            &criteria,
            options.depth,
            &root,
            &options.lines,
            solver,
            &cancel,
            report,
        )
        .await?;
        let (positions, calculated) = (looked_at, searches);

        let stored = store::replace_source(&options.dest, &options.source, &tactics)?;
        crate::puzzle::forget_cached_puzzles(&options.dest);
        Ok(TacticSearchResult {
            positions: positions as u32,
            calculated,
            found: tactics.len() as u32,
            added: stored.added,
            duplicates: stored.duplicates,
            rejected: stored.rejected,
            total: stored.total,
        })
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

    fn line(cp: i32) -> Line {
        Line {
            cp: Some(cp),
            mate: None,
            depth: 18,
            pv: vec!["e2e4".into()],
            ..Default::default()
        }
    }

    fn mate(m: i32) -> Line {
        Line {
            cp: None,
            mate: Some(m),
            depth: 18,
            pv: vec!["e2e4".into()],
            ..Default::default()
        }
    }

    #[test]
    fn only_move_needs_a_clear_gap() {
        assert!(is_only_move(&[line(400), line(-50)], 30));
        assert!(!is_only_move(&[line(400), line(250)], 30));
        // Far ahead, but the second move still keeps an advantage.
        assert!(!is_only_move(&[line(900), line(150)], 30));
        // A forced move is always the only move.
        assert!(is_only_move(&[line(-300)], 1));
        // Mate against a merely good move is a solution, two mates are not.
        assert!(is_only_move(&[mate(2), line(150)], 30));
        assert!(!is_only_move(&[mate(2), mate(4)], 30));
        assert!(!is_only_move(&[mate(2), line(900)], 30));
    }

    #[test]
    fn candidates_are_unique_positions_of_the_solver() {
        let root = Chess::default();
        let lines = vec![
            vec!["g1f3".into(), "d7d5".into(), "d2d4".into()],
            vec!["d2d4".into(), "d7d5".into(), "g1f3".into(), "g8f6".into()],
        ];
        let white = collect_candidates(&root, &lines, Color::White).unwrap();
        // After 1...d5 in both lines (two different positions) and after 2...Nf6.
        assert_eq!(white.len(), 3);
        assert_eq!(white[0].line, "1. Nf3 d5");
        let black = collect_candidates(&root, &lines, Color::Black).unwrap();
        // 1.Nf3, 1.d4 and the position after 2.d4 / 2.Nf3, reached twice.
        assert_eq!(black.len(), 3);
        assert_eq!(black[1].line, "1. Nf3 d5 2. d4");
        assert_eq!(black[2].line, "1. d4");
    }

    #[test]
    fn strict_criteria_ask_more() {
        let loose = Criteria::new(Strictness::Loose, 1);
        let normal = Criteria::default();
        let strict = Criteria::new(Strictness::Strict, 1);
        // Clear enough for normal, not for strict.
        let lines = [line(500), line(60)];
        assert!(loose.is_only_move(&lines, 30));
        assert!(normal.is_only_move(&lines, 30));
        assert!(!strict.is_only_move(&lines, 30));
        assert!(normal.is_winning(&line(250)));
        assert!(!strict.is_winning(&line(250)));
        assert!(loose.is_winning(&line(160)));
        assert_eq!(Criteria::new(Strictness::Normal, 3).min_solver_moves, 3);
        assert_eq!(Criteria::new(Strictness::Normal, 0).min_solver_moves, 1);
    }

    fn moves_of(fen: &str, line: &str) -> (Chess, Vec<Move>) {
        let mut pos: Chess = Fen::from_ascii(fen.as_bytes())
            .unwrap()
            .into_position(CastlingMode::Standard)
            .unwrap();
        let start = pos.clone();
        let moves = line
            .split_whitespace()
            .map(|u| {
                let m = UciMove::from_ascii(u.as_bytes())
                    .unwrap()
                    .to_move(&pos)
                    .unwrap();
                pos.play_unchecked(m);
                m
            })
            .collect();
        (start, moves)
    }

    #[test]
    fn simple_recaptures_are_no_puzzles() {
        // 1...Nxe4?? 2.Nxe4: the knight on c3 just takes back.
        let (parent, moves) = moves_of(
            "rnbqkb1r/pppp1ppp/5n2/4p3/4P3/2N5/PPPP1PPP/R1BQKBNR b KQkq - 0 1",
            "f6e4 c3e4",
        );
        let mut start = parent.clone();
        start.play_unchecked(moves[0]);
        let solution = &moves[1..];
        let themes = motifs::detect(&start, solution);
        assert!(motifs::is_trivial(&moves[0], solution, &themes));
        assert!(!Criteria::default().accepts(&moves[0], solution, &themes));
        assert!(Criteria::new(Strictness::Loose, 1).accepts(&moves[0], solution, &themes));

        // A knight fork is a puzzle even as a single move.
        let (start, solution) = moves_of("r3k3/8/8/3N4/8/8/8/4K3 w - - 0 1", "d5c7");
        let (_, lead) = moves_of("r3k3/8/8/3N4/8/8/8/3K4 w - - 0 1", "d1e1");
        let themes = motifs::detect(&start, &solution);
        assert!(!motifs::is_trivial(&lead[0], &solution, &themes));
        assert!(Criteria::new(Strictness::Strict, 1).accepts(&lead[0], &solution, &themes));
        // ... but not when at least two own moves are asked for.
        assert!(!Criteria::new(Strictness::Normal, 2).accepts(&lead[0], &solution, &themes));
    }

    fn test_engine() -> PathBuf {
        PathBuf::from(std::env::var("JBLBASE_TEST_ENGINE").unwrap())
    }

    async fn engines(count: u32) -> Vec<Analyzer> {
        engine::start_analyzers(&test_engine(), &[], count)
            .await
            .unwrap()
    }

    /// Needs an engine: `JBLBASE_TEST_ENGINE=/path/to/stockfish cargo test -- --ignored tactics`
    #[tokio::test]
    #[ignore]
    async fn finds_the_englund_trap_and_legals_mate() {
        let cache = EvalCache::open_in_memory();
        let cancel = AtomicBool::new(false);
        let root = Chess::default();
        let split = |s: &str| s.split_whitespace().map(String::from).collect::<Vec<_>>();
        let criteria = Criteria::default();

        // 1.d4 e5 2.dxe5 Nc6 3.Nf3 Qe7 4.Bf4 Qb4+ 5.Bd2 Qxb2 6.Bc3 (Bb4! wins)
        let englund = vec![split(
            "d2d4 e7e5 d4e5 b8c6 g1f3 d8e7 c1f4 e7b4 f4d2 b4b2 d2c3",
        )];
        let outcome = find_tactics(
            engines(2).await,
            &test_engine(),
            Some(&cache),
            &RatingModel::default(),
            &criteria,
            14,
            &root,
            &englund,
            Color::Black,
            &cancel,
            |_| {},
        )
        .await
        .unwrap();
        assert_eq!(outcome.looked_at, 6);
        let found = outcome.tactics;
        let trap = found
            .iter()
            .find(|t| t.moves[0] == "d2c3")
            .expect("the trap after 6.Bc3");
        assert_eq!(trap.moves[1], "f8b4");
        assert_eq!(
            trap.line,
            "1. d4 e5 2. dxe5 Nc6 3. Nf3 Qe7 4. Bf4 Qb4+ 5. Bd2 Qxb2 6. Bc3"
        );
        assert!((400..=3000).contains(&trap.rating));
        println!("Englund: {found:#?}");

        // Legal's mate: 1.e4 e5 2.Nf3 d6 3.Bc4 Bg4 4.Nc3 g6 5.Nxe5 Bxd1 (Bxf7+ Ke7, Nd5#)
        let legal = vec![split("e2e4 e7e5 g1f3 d7d6 f1c4 c8g4 b1c3 g7g6 f3e5 g4d1")];
        let outcome = find_tactics(
            engines(3).await,
            &test_engine(),
            Some(&cache),
            &RatingModel::default(),
            &criteria,
            14,
            &root,
            &legal,
            Color::White,
            &cancel,
            |_| {},
        )
        .await
        .unwrap();
        let found = outcome.tactics;
        println!("Legal: {found:#?}");
        let mate = found
            .iter()
            .find(|t| t.moves[0] == "g4d1")
            .expect("mate after 5...Bxd1");
        assert_eq!(mate.moves, ["g4d1", "c4f7", "e8e7", "c3d5"]);
        assert!(mate.themes.iter().any(|t| t == "mateIn2"));
        assert!(mate.rating > trap.rating - 400);
        assert!(outcome.searches > 0);

        // A second run takes everything from the position store.
        let again = find_tactics(
            engines(1).await,
            &test_engine(),
            Some(&cache),
            &RatingModel::default(),
            &criteria,
            14,
            &root,
            &legal,
            Color::White,
            &cancel,
            |_| {},
        )
        .await
        .unwrap();
        assert_eq!(again.searches, 0);
        assert_eq!(again.tactics.len(), found.len());
    }
}
