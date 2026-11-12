//! Tactic search: finds positions in a set of lines (a repertoire, later the
//! own games) where one side has a single clearly winning move, turns them
//! into puzzles with motifs and an estimated rating, and stores them where
//! the puzzle trainer finds them.

pub mod engine;
pub mod motifs;
pub mod rating;
pub mod store;

use std::{
    collections::HashSet,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

use serde::{Deserialize, Serialize};
use shakmaty::{fen::Fen, san::SanPlus, uci::UciMove, CastlingMode, Chess, Color, Move, Position};
use specta::Type;

use crate::{
    engine::EngineOption,
    error::Error,
    eval_cache::{position_key, EvalCache},
    progress::update_progress,
    AppState,
};

use engine::{fen_of, Analyzer, Line};
use rating::{Features, RatingModel};
use store::StoredTactic;

/// The best move has to beat the second best by this much (winning chances
/// from -1 to 1) to count as the only solution. Lichess asks for 0.7 in its
/// own puzzles; for training traps of a repertoire a bit less is enough, as
/// long as the second best move does not keep an advantage either.
const SINGLE_SOLUTION: f64 = 0.5;
/// The second best move may be worth at most this many centipawns.
const MAX_SECOND_BEST_CP: i32 = 100;
/// The solver has to be at least this much better after the first move.
const MIN_ADVANTAGE_CP: i32 = 200;
/// The opponent's last move has to have cost at least this much (winning
/// chances), so that a forced recapture in a won position is not a puzzle.
const MIN_GAIN: f64 = 0.3;
/// A solution never gets longer than this many solver moves.
const MAX_SOLVER_MOVES: usize = 8;
/// How deep the rating probe looks for the solution.
const PROBE_DEPTH: u32 = 14;

fn is_winning(line: &Line) -> bool {
    match (line.mate, line.cp) {
        (Some(m), _) => m > 0,
        (None, Some(cp)) => cp >= MIN_ADVANTAGE_CP,
        (None, None) => false,
    }
}

/// Is the first line the only good move? `legal` is the number of legal moves.
fn is_only_move(lines: &[Line], legal: usize) -> bool {
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
    best.win_chances() - second.win_chances() >= SINGLE_SOLUTION
        && second.mate.is_none_or(|m| m < 0)
        && second.cp.is_none_or(|cp| cp <= MAX_SECOND_BEST_CP)
}

fn eval_cp(line: &Line) -> i32 {
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
    let mut seen: HashSet<String> = HashSet::new();
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
async fn build_solution(
    analyzer: &mut Analyzer,
    cache: Option<&EvalCache>,
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
        let replies = analyzer.analyze(cache, &pos, depth, 2).await?;
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
        if !is_winning(line) || !is_only_move(&lines, legal) {
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

/// Is there a tactic for the side to move in `start`, which came about by
/// `lead` played in `parent`? If so, returns it as a finished puzzle together
/// with the positions its solution covers.
///
/// A tactic is a single clearly winning move after a real mistake of the
/// opponent. `line` is the text shown as the way to the position.
#[allow(clippy::too_many_arguments)]
pub async fn tactic_at(
    analyzer: &mut Analyzer,
    prober: &mut Analyzer,
    cache: Option<&EvalCache>,
    depth: u32,
    parent: &Chess,
    lead: &Move,
    start: &Chess,
    line: &str,
) -> Result<Option<(StoredTactic, Vec<String>)>, Error> {
    let first = analyzer.analyze(cache, start, depth, 2).await?;
    let legal = start.legal_moves().len();
    let Some(best) = first.first() else {
        return Ok(None);
    };
    if !is_winning(best) || !is_only_move(&first, legal) {
        return Ok(None);
    }
    // What the opponent could have had instead of the move played.
    let before = analyzer.analyze(cache, parent, depth, 2).await?;
    let Some(opponent_best) = before.first() else {
        return Ok(None);
    };
    if best.win_chances() + opponent_best.win_chances() < MIN_GAIN {
        return Ok(None);
    }

    let Some((solution, last)) = build_solution(analyzer, cache, depth, start, &first).await?
    else {
        return Ok(None);
    };

    // Rate it: how deep does a single-threaded search have to look?
    let mut covered = Vec::new();
    let mut pos = start.clone();
    let mut first_depth = 0;
    let mut max_depth = 0;
    for (n, m) in solution.iter().enumerate() {
        if n % 2 == 0 {
            covered.push(position_key(&pos));
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
    let mut themes = motifs::detect(start, &solution);
    themes.push(motifs::phase(start));
    if !themes.contains(&"mate") {
        themes.push(if eval_cp(&last) >= 600 {
            "crushing"
        } else {
            "advantage"
        });
    }
    let mut after_first = start.clone();
    after_first.play_unchecked(solution[0]);
    let features = Features {
        solver_moves: solution.len().div_ceil(2) as u32,
        first_depth,
        max_depth,
        sacrifice: themes.contains(&"sacrifice"),
        first_capture: solution[0].is_capture(),
        first_check: after_first.is_check(),
    };

    let mut moves = vec![lead.to_uci(CastlingMode::Standard).to_string()];
    moves.extend(
        solution
            .iter()
            .map(|m| m.to_uci(CastlingMode::Standard).to_string()),
    );
    Ok(Some((
        StoredTactic {
            fen: fen_of(parent),
            moves,
            rating: RatingModel::default().estimate(&features),
            themes: themes.iter().map(|t| t.to_string()).collect(),
            line: line.to_string(),
            eval_cp: eval_cp(&last),
        },
        covered,
    )))
}

/// Searches `lines` for tactics of `solver`. `on_progress` gets the share of
/// positions done; the search stops with an error once `cancel` is set.
#[allow(clippy::too_many_arguments)]
pub async fn find_tactics(
    analyzer: &mut Analyzer,
    prober: &mut Analyzer,
    cache: Option<&EvalCache>,
    depth: u32,
    root: &Chess,
    lines: &[Vec<String>],
    solver: Color,
    cancel: &AtomicBool,
    mut on_progress: impl FnMut(f32),
) -> Result<(usize, Vec<StoredTactic>), Error> {
    let candidates = collect_candidates(root, lines, solver)?;
    let mut found = Vec::new();
    // Positions that already are part of a found solution are not offered
    // again as a puzzle of their own.
    let mut covered: HashSet<String> = HashSet::new();

    for (i, candidate) in candidates.iter().enumerate() {
        if cancel.load(Ordering::SeqCst) {
            return Err(Error::AnalysisCancelled);
        }
        on_progress(i as f32 / candidates.len() as f32);
        if covered.contains(&position_key(&candidate.start)) {
            continue;
        }
        if let Some((tactic, positions)) = tactic_at(
            analyzer,
            prober,
            cache,
            depth,
            &candidate.parent,
            &candidate.lead,
            &candidate.start,
            &candidate.line,
        )
        .await?
        {
            covered.extend(positions);
            found.push(tactic);
        }
    }
    on_progress(1.0);
    Ok((candidates.len(), found))
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
    /// Puzzles in the database after the search.
    pub total: u32,
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
        let mut analyzer = Analyzer::new(path.clone(), &options.uci_options).await?;
        // The probe runs on one thread so that its depths mean the same every time.
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

        let mut last = -1.0f32;
        let searched = find_tactics(
            &mut analyzer,
            &mut prober,
            Some(&state.eval_cache),
            options.depth,
            &root,
            &options.lines,
            solver,
            &cancel,
            |share| {
                let progress = (share * 100.0).min(99.9);
                if progress - last >= 0.1 {
                    last = progress;
                    let _ =
                        update_progress(&state.progress_state, &app, id.clone(), progress, false);
                }
            },
        )
        .await;
        let calculated = analyzer.searches;
        analyzer.quit().await;
        prober.quit().await;
        let (positions, tactics) = searched?;

        let total = store::replace_source(&options.dest, &options.source, &tactics)?;
        crate::puzzle::forget_cached_puzzles(&options.dest);
        Ok(TacticSearchResult {
            positions: positions as u32,
            calculated,
            found: tactics.len() as u32,
            total,
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
        }
    }

    fn mate(m: i32) -> Line {
        Line {
            cp: None,
            mate: Some(m),
            depth: 18,
            pv: vec!["e2e4".into()],
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

    /// Needs an engine: `JBLBASE_TEST_ENGINE=/path/to/stockfish cargo test -- --ignored tactics`
    #[tokio::test]
    #[ignore]
    async fn finds_the_englund_trap_and_legals_mate() {
        let engine = PathBuf::from(std::env::var("JBLBASE_TEST_ENGINE").unwrap());
        let cache = EvalCache::open_in_memory();
        let mut analyzer = Analyzer::new(engine.clone(), &[]).await.unwrap();
        let mut prober = Analyzer::new(engine, &[]).await.unwrap();
        let cancel = AtomicBool::new(false);
        let root = Chess::default();
        let split = |s: &str| s.split_whitespace().map(String::from).collect::<Vec<_>>();

        // 1.d4 e5 2.dxe5 Nc6 3.Nf3 Qe7 4.Bf4 Qb4+ 5.Bd2 Qxb2 6.Bc3 (Bb4! wins)
        let englund = vec![split(
            "d2d4 e7e5 d4e5 b8c6 g1f3 d8e7 c1f4 e7b4 f4d2 b4b2 d2c3",
        )];
        let (positions, found) = find_tactics(
            &mut analyzer,
            &mut prober,
            Some(&cache),
            14,
            &root,
            &englund,
            Color::Black,
            &cancel,
            |_| {},
        )
        .await
        .unwrap();
        assert_eq!(positions, 6);
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
        let (_, found) = find_tactics(
            &mut analyzer,
            &mut prober,
            Some(&cache),
            14,
            &root,
            &legal,
            Color::White,
            &cancel,
            |_| {},
        )
        .await
        .unwrap();
        println!("Legal: {found:#?}");
        let mate = found
            .iter()
            .find(|t| t.moves[0] == "g4d1")
            .expect("mate after 5...Bxd1");
        assert_eq!(mate.moves, ["g4d1", "c4f7", "e8e7", "c3d5"]);
        assert!(mate.themes.iter().any(|t| t == "mateIn2"));
        assert!(mate.rating > trap.rating - 400);

        // A second run takes everything from the position store.
        let before = analyzer.searches;
        let mut again = Analyzer::new(
            PathBuf::from(std::env::var("JBLBASE_TEST_ENGINE").unwrap()),
            &[],
        )
        .await
        .unwrap();
        find_tactics(
            &mut again,
            &mut prober,
            Some(&cache),
            14,
            &root,
            &legal,
            Color::White,
            &cancel,
            |_| {},
        )
        .await
        .unwrap();
        assert!(before > 0);
        assert_eq!(again.searches, 0);
    }
}
