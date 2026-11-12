//! Reported puzzles: a puzzle that looks wrong in the trainer can be reported.
//! Reports are kept apart from the puzzle databases until a deep engine check
//! has looked at them, and a decision then confirms, corrects or deletes the
//! puzzle in its database.

use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};

use log::{info, warn};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use shakmaty::{CastlingMode, Move, Position};
use specta::Type;

use crate::{
    engine::EngineOption, error::Error, eval_cache::EvalCache, progress::update_progress, AppState,
};

use super::{
    build_solution,
    calibration::parse_puzzle,
    engine::Analyzer,
    features_of, is_only_move, is_winning, motifs,
    rating::RatingModel,
    store::{apply_verdict, Verdict},
};

pub const REPORTS_FILE_NAME: &str = "puzzle_reports.sqlite3";

#[derive(Default)]
pub struct ReportStore {
    inner: Mutex<Option<Connection>>,
}

/// A puzzle someone reported, and what came out of it.
#[derive(Serialize, Debug, Clone, PartialEq, Type)]
#[serde(rename_all = "camelCase")]
pub struct PuzzleReport {
    pub id: i64,
    /// The puzzle database the puzzle is in.
    pub db: String,
    pub fen: String,
    pub moves: String,
    pub rating: i32,
    /// "wrongSolution", "otherSolution", "rating" or "other".
    pub reason: String,
    pub note: String,
    /// Seconds since 1970.
    pub created_at: i64,
    /// "open", "checked" or "resolved".
    pub status: String,
    /// What the engine check suggests: "confirmed", "corrected" or "deleted".
    pub suggestion: Option<String>,
    /// Why: "ok", "longer", "otherMove", "otherLine", "shorter" or "noUniqueWin".
    pub check_reason: Option<String>,
    /// The solution the engine found, opponent's move first.
    pub new_moves: Option<String>,
    pub new_rating: Option<i32>,
    pub check_depth: Option<u32>,
    /// Evaluation of the engine's best move, centipawns for the solver.
    pub check_eval: Option<i32>,
    /// What was decided in the end.
    pub resolution: Option<String>,
}

#[derive(Deserialize, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct NewPuzzleReport {
    pub db: String,
    pub fen: String,
    pub moves: String,
    pub rating: i32,
    pub reason: String,
    pub note: String,
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn open_connection(path: &Path) -> Result<Connection, rusqlite::Error> {
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         CREATE TABLE IF NOT EXISTS reports (
             id INTEGER PRIMARY KEY AUTOINCREMENT,
             db TEXT NOT NULL,
             fen TEXT NOT NULL,
             moves TEXT NOT NULL,
             rating INTEGER NOT NULL,
             reason TEXT NOT NULL,
             note TEXT NOT NULL,
             created_at INTEGER NOT NULL,
             status TEXT NOT NULL,
             suggestion TEXT,
             check_reason TEXT,
             new_moves TEXT,
             new_rating INTEGER,
             check_depth INTEGER,
             check_eval INTEGER,
             resolution TEXT
         );",
    )?;
    Ok(conn)
}

const COLUMNS: &str = "id, db, fen, moves, rating, reason, note, created_at, status, suggestion,
     check_reason, new_moves, new_rating, check_depth, check_eval, resolution";

fn read_report(row: &rusqlite::Row<'_>) -> Result<PuzzleReport, rusqlite::Error> {
    Ok(PuzzleReport {
        id: row.get(0)?,
        db: row.get(1)?,
        fen: row.get(2)?,
        moves: row.get(3)?,
        rating: row.get(4)?,
        reason: row.get(5)?,
        note: row.get(6)?,
        created_at: row.get(7)?,
        status: row.get(8)?,
        suggestion: row.get(9)?,
        check_reason: row.get(10)?,
        new_moves: row.get(11)?,
        new_rating: row.get(12)?,
        check_depth: row.get(13)?,
        check_eval: row.get(14)?,
        resolution: row.get(15)?,
    })
}

impl ReportStore {
    /// Opens (or creates) the store. Failures are logged; reporting is then
    /// unavailable and the rest of the app is not affected.
    pub fn open(&self, path: PathBuf) {
        match open_connection(&path) {
            Ok(conn) => {
                info!("Puzzle reports opened at {}", path.display());
                *self.inner.lock().unwrap() = Some(conn);
            }
            Err(e) => warn!("Could not open puzzle reports {}: {e}", path.display()),
        }
    }

    #[cfg(test)]
    pub fn open_in_memory() -> Self {
        let store = Self::default();
        *store.inner.lock().unwrap() = Some(open_connection(Path::new(":memory:")).unwrap());
        store
    }

    fn with_conn<T>(
        &self,
        f: impl FnOnce(&mut Connection) -> Result<T, rusqlite::Error>,
    ) -> Result<T, Error> {
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| std::io::Error::other("puzzle reports lock poisoned"))?;
        let conn = guard
            .as_mut()
            .ok_or_else(|| std::io::Error::other("The puzzle reports could not be opened."))?;
        Ok(f(conn)?)
    }

    /// Files a report. A puzzle that is already reported and not yet decided
    /// is not filed twice; its report gets the newer reason instead.
    pub fn add(&self, report: &NewPuzzleReport) -> Result<i64, Error> {
        self.with_conn(|conn| {
            let open: Option<i64> = conn
                .query_row(
                    "SELECT id FROM reports WHERE db = ?1 AND fen = ?2 AND moves = ?3
                     AND status != 'resolved'",
                    params![report.db, report.fen, report.moves],
                    |r| r.get(0),
                )
                .optional()?;
            if let Some(id) = open {
                conn.execute(
                    "UPDATE reports SET reason = ?2, note = ?3 WHERE id = ?1",
                    params![id, report.reason, report.note],
                )?;
                return Ok(id);
            }
            conn.execute(
                "INSERT INTO reports (db, fen, moves, rating, reason, note, created_at, status)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'open')",
                params![
                    report.db,
                    report.fen,
                    report.moves,
                    report.rating,
                    report.reason,
                    report.note,
                    now()
                ],
            )?;
            Ok(conn.last_insert_rowid())
        })
    }

    /// Every report, the undecided ones first, newest first.
    pub fn list(&self, include_resolved: bool) -> Result<Vec<PuzzleReport>, Error> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(&format!(
                "SELECT {COLUMNS} FROM reports {}
                 ORDER BY status = 'resolved', created_at DESC, id DESC",
                if include_resolved {
                    ""
                } else {
                    "WHERE status != 'resolved'"
                }
            ))?;
            let rows = stmt.query_map([], read_report)?;
            rows.collect()
        })
    }

    pub fn get(&self, id: i64) -> Result<Option<PuzzleReport>, Error> {
        self.with_conn(|conn| {
            conn.query_row(
                &format!("SELECT {COLUMNS} FROM reports WHERE id = ?1"),
                params![id],
                read_report,
            )
            .optional()
        })
    }

    fn save_check(&self, id: i64, check: &Check, depth: u32) -> Result<(), Error> {
        self.with_conn(|conn| {
            conn.execute(
                "UPDATE reports SET status = 'checked', suggestion = ?2, check_reason = ?3,
                 new_moves = ?4, new_rating = ?5, check_depth = ?6, check_eval = ?7
                 WHERE id = ?1",
                params![
                    id,
                    check.verdict.as_str(),
                    check.reason,
                    check.moves,
                    check.rating,
                    depth,
                    check.eval
                ],
            )?;
            Ok(())
        })
    }

    fn resolve(&self, id: i64, verdict: Verdict) -> Result<(), Error> {
        self.with_conn(|conn| {
            conn.execute(
                "UPDATE reports SET status = 'resolved', resolution = ?2 WHERE id = ?1",
                params![id, verdict.as_str()],
            )?;
            Ok(())
        })
    }

    pub fn remove(&self, id: i64) -> Result<(), Error> {
        self.with_conn(|conn| {
            conn.execute("DELETE FROM reports WHERE id = ?1", params![id])?;
            Ok(())
        })
    }
}

/// What a deep engine check found out about a puzzle.
#[derive(Debug, Clone, PartialEq)]
pub struct Check {
    pub verdict: Verdict,
    /// See [`PuzzleReport::check_reason`].
    pub reason: &'static str,
    /// The engine's solution, opponent's move first, when it is a puzzle.
    pub moves: Option<String>,
    pub rating: Option<i32>,
    pub eval: Option<i32>,
}

/// Compares the stored solution with the one the deep check found (both
/// without the opponent's first move): is the puzzle right, does it need
/// correcting, and why.
pub fn compare_solutions(stored: &[Move], checked: &[Move]) -> (Verdict, &'static str) {
    if stored.first() != checked.first() {
        return (Verdict::Corrected, "otherMove");
    }
    let common = stored
        .iter()
        .zip(checked)
        .take_while(|(a, b)| a == b)
        .count();
    if common == stored.len() && common == checked.len() {
        (Verdict::Confirmed, "ok")
    } else if common == stored.len() {
        // The deeper look goes on where the puzzle stops: the puzzle is not
        // wrong, it only ends a little early.
        (Verdict::Confirmed, "longer")
    } else if common == checked.len() {
        // The puzzle asks for moves that are not the single winning move.
        (Verdict::Corrected, "shorter")
    } else {
        (Verdict::Corrected, "otherLine")
    }
}

/// Checks a puzzle (`fen` before the opponent's move, `moves` starting with
/// it) with `analyzer` at `depth`: is there exactly one winning move, and is
/// the stored solution the line the engine finds?
pub async fn check_puzzle(
    analyzer: &mut Analyzer,
    prober: &mut Analyzer,
    cache: Option<&EvalCache>,
    model: &RatingModel,
    depth: u32,
    fen: &str,
    moves: &str,
) -> Result<Check, Error> {
    let lead = moves.split_whitespace().next().unwrap_or("").to_string();
    let (start, stored) = parse_puzzle(fen, moves).ok_or_else(|| {
        std::io::Error::other(format!("The puzzle cannot be read: {fen} {moves}"))
    })?;
    let first = analyzer.analyze(cache, &start, depth, 2).await?;
    let eval = first.first().map(super::eval_cp);
    let rejected = Check {
        verdict: Verdict::Deleted,
        reason: "noUniqueWin",
        moves: None,
        rating: None,
        eval,
    };
    let legal = start.legal_moves().len();
    match first.first() {
        Some(best) if is_winning(best) && is_only_move(&first, legal) => {}
        _ => return Ok(rejected),
    }
    let Some((solution, _)) = build_solution(analyzer, cache, depth, &start, &first).await? else {
        return Ok(rejected);
    };
    let (verdict, reason) = compare_solutions(&stored, &solution);
    if verdict == Verdict::Confirmed {
        return Ok(Check {
            verdict,
            reason,
            moves: None,
            rating: None,
            eval,
        });
    }
    let themes = motifs::detect(&start, &solution);
    let features = features_of(prober, &start, &solution, &themes).await?;
    let mut new_moves = vec![lead];
    new_moves.extend(
        solution
            .iter()
            .map(|m| m.to_uci(CastlingMode::Standard).to_string()),
    );
    Ok(Check {
        verdict,
        reason,
        moves: Some(new_moves.join(" ")),
        rating: Some(model.estimate(&features)),
        eval,
    })
}

/// Reports a puzzle from the trainer. Returns the report's id.
#[tauri::command]
#[specta::specta]
pub async fn report_puzzle(
    report: NewPuzzleReport,
    state: tauri::State<'_, AppState>,
) -> Result<i64, Error> {
    state.reports.add(&report)
}

#[tauri::command]
#[specta::specta]
pub async fn list_puzzle_reports(
    include_resolved: bool,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<PuzzleReport>, Error> {
    state.reports.list(include_resolved)
}

#[derive(Deserialize, Debug, Type)]
#[serde(rename_all = "camelCase")]
pub struct ReportCheckOptions {
    pub engine: String,
    pub uci_options: Vec<EngineOption>,
    pub depth: u32,
    /// The reports to check; every report not decided yet when empty.
    pub ids: Vec<i64>,
}

/// Checks reported puzzles with the engine and saves what it suggests.
/// Progress goes to the progress bar `id`; `cancel_analysis(id)` stops after
/// the current puzzle, and the puzzles checked so far keep their result.
/// Returns the number of puzzles checked.
#[tauri::command]
#[specta::specta]
pub async fn check_puzzle_reports(
    id: String,
    options: ReportCheckOptions,
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<u32, Error> {
    let cancel = Arc::new(AtomicBool::new(false));
    state
        .analysis_cancel_flags
        .insert(id.clone(), cancel.clone());

    let result = async {
        let todo: Vec<PuzzleReport> = state
            .reports
            .list(false)?
            .into_iter()
            .filter(|r| options.ids.is_empty() || options.ids.contains(&r.id))
            .collect();
        if todo.is_empty() {
            return Ok(0);
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
        let model = state.rating.model();
        let mut checked = 0;
        let mut outcome = Ok(());
        for (n, report) in todo.iter().enumerate() {
            if cancel.load(Ordering::SeqCst) {
                break;
            }
            let _ = update_progress(
                &state.progress_state,
                &app,
                id.clone(),
                (n as f32 / todo.len() as f32 * 100.0).min(99.9),
                false,
            );
            analyzer.clear_memo();
            match check_puzzle(
                &mut analyzer,
                &mut prober,
                Some(&state.eval_cache),
                &model,
                options.depth,
                &report.fen,
                &report.moves,
            )
            .await
            {
                Ok(check) => {
                    state.reports.save_check(report.id, &check, options.depth)?;
                    checked += 1;
                }
                Err(error) => {
                    outcome = Err(error);
                    break;
                }
            }
        }
        analyzer.quit().await;
        prober.quit().await;
        outcome.map(|_| checked)
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

/// Decides a report: "confirmed" keeps the puzzle, "corrected" puts in the
/// solution the check found, "deleted" removes the puzzle from its database.
/// The decision is remembered there, so later searches respect it.
#[tauri::command]
#[specta::specta]
pub async fn resolve_puzzle_report(
    report_id: i64,
    verdict: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), Error> {
    let verdict = Verdict::parse(&verdict)
        .ok_or_else(|| std::io::Error::other(format!("Unknown decision {verdict}")))?;
    let report = state
        .reports
        .get(report_id)?
        .ok_or_else(|| std::io::Error::other("This report does not exist any more."))?;
    let corrected = match verdict {
        Verdict::Corrected => Some((
            report.new_moves.as_deref().ok_or_else(|| {
                std::io::Error::other("Check the puzzle first: there is no correction yet.")
            })?,
            report.new_rating.unwrap_or(report.rating),
        )),
        _ => None,
    };
    let db = PathBuf::from(&report.db);
    if db.exists() {
        apply_verdict(&db, &report.fen, &report.moves, verdict, corrected)?;
        crate::puzzle::forget_cached_puzzles(&db);
    }
    state.reports.resolve(report_id, verdict)
}

#[tauri::command]
#[specta::specta]
pub async fn delete_puzzle_report(
    report_id: i64,
    state: tauri::State<'_, AppState>,
) -> Result<(), Error> {
    state.reports.remove(report_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use shakmaty::{fen::Fen, uci::UciMove, Chess};

    fn report(fen: &str, moves: &str) -> NewPuzzleReport {
        NewPuzzleReport {
            db: "/tmp/x.duckdb".into(),
            fen: fen.into(),
            moves: moves.into(),
            rating: 1500,
            reason: "wrongSolution".into(),
            note: String::new(),
        }
    }

    #[test]
    fn a_puzzle_is_reported_once_until_decided() {
        let store = ReportStore::open_in_memory();
        let a = store.add(&report("f", "e2e4 e7e5")).unwrap();
        let mut again = report("f", "e2e4 e7e5");
        again.reason = "rating".into();
        assert_eq!(store.add(&again).unwrap(), a);
        let list = store.list(false).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].reason, "rating");
        assert_eq!(list[0].status, "open");

        store
            .save_check(
                a,
                &Check {
                    verdict: Verdict::Corrected,
                    reason: "otherMove",
                    moves: Some("e2e4 d7d5".into()),
                    rating: Some(1300),
                    eval: Some(250),
                },
                30,
            )
            .unwrap();
        let checked = store.get(a).unwrap().unwrap();
        assert_eq!(checked.status, "checked");
        assert_eq!(checked.suggestion.as_deref(), Some("corrected"));
        assert_eq!(checked.new_moves.as_deref(), Some("e2e4 d7d5"));
        assert_eq!(checked.check_depth, Some(30));

        store.resolve(a, Verdict::Corrected).unwrap();
        assert!(store.list(false).unwrap().is_empty());
        assert_eq!(store.list(true).unwrap().len(), 1);
        // Once decided, the puzzle can be reported anew.
        assert_ne!(store.add(&report("f", "e2e4 e7e5")).unwrap(), a);
    }

    fn line(fen: &str, moves: &[&str]) -> Vec<Move> {
        let mut pos: Chess = fen
            .parse::<Fen>()
            .unwrap()
            .into_position(CastlingMode::Standard)
            .unwrap();
        moves
            .iter()
            .map(|uci| {
                let m = uci.parse::<UciMove>().unwrap().to_move(&pos).unwrap();
                pos.play_unchecked(m);
                m
            })
            .collect()
    }

    #[test]
    fn solutions_are_compared_move_by_move() {
        let start = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
        let a = line(start, &["e2e4", "e7e5", "g1f3"]);
        let short = line(start, &["e2e4", "e7e5"]);
        let other_move = line(start, &["d2d4", "d7d5"]);
        let other_line = line(start, &["e2e4", "c7c5", "g1f3"]);
        assert_eq!(compare_solutions(&a, &a), (Verdict::Confirmed, "ok"));
        assert_eq!(
            compare_solutions(&short, &a),
            (Verdict::Confirmed, "longer")
        );
        assert_eq!(
            compare_solutions(&a, &short),
            (Verdict::Corrected, "shorter")
        );
        assert_eq!(
            compare_solutions(&a, &other_move),
            (Verdict::Corrected, "otherMove")
        );
        assert_eq!(
            compare_solutions(&a, &other_line),
            (Verdict::Corrected, "otherLine")
        );
    }

    /// Needs a UCI engine: `JBLBASE_TEST_ENGINE=/path/to/stockfish cargo test -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn the_deep_check_confirms_corrects_and_deletes() {
        let engine = PathBuf::from(std::env::var("JBLBASE_TEST_ENGINE").expect("engine path"));
        let mut analyzer = Analyzer::new(engine.clone(), &[]).await.unwrap();
        let mut prober = Analyzer::new(engine, &[]).await.unwrap();
        let model = RatingModel::default();
        // The Englund trap: 1.d4 e5 2.dxe5 Nc6 3.Nf3 Qe7 4.Bf4 Qb4+ 5.Bd2 Qxb2,
        // and after 6.Bc3?? Black wins the queen with 6...Bb4!
        let mut pos = Chess::default();
        for uci in [
            "d2d4", "e7e5", "d4e5", "b8c6", "g1f3", "d8e7", "c1f4", "e7b4", "f4d2", "b4b2",
        ] {
            let m = uci.parse::<UciMove>().unwrap().to_move(&pos).unwrap();
            pos.play_unchecked(m);
        }
        let fen = super::super::engine::fen_of(&pos);
        let right = check_puzzle(
            &mut analyzer,
            &mut prober,
            None,
            &model,
            18,
            &fen,
            "d2c3 f8b4",
        )
        .await
        .unwrap();
        assert_eq!(right.verdict, Verdict::Confirmed, "{right:?}");

        let wrong = check_puzzle(
            &mut analyzer,
            &mut prober,
            None,
            &model,
            18,
            &fen,
            "d2c3 b2a1",
        )
        .await
        .unwrap();
        assert_eq!(wrong.verdict, Verdict::Corrected, "{wrong:?}");
        assert_eq!(wrong.reason, "otherMove");
        assert!(wrong.moves.as_deref().unwrap().starts_with("d2c3 f8b4"));
        assert!(wrong.rating.is_some());

        // A quiet position: nothing wins, the puzzle has to go.
        let start = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
        let none = check_puzzle(
            &mut analyzer,
            &mut prober,
            None,
            &model,
            14,
            start,
            "e2e4 e7e5",
        )
        .await
        .unwrap();
        assert_eq!(none.verdict, Verdict::Deleted);
        assert_eq!(none.reason, "noUniqueWin");
        analyzer.quit().await;
        prober.quit().await;
    }
}
