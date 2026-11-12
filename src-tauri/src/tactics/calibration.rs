//! Fits the rating estimate to real puzzles: a sample of Lichess puzzles is
//! measured the same way as our own, and the weights are chosen so that the
//! estimate comes as close to their Lichess ratings as it can.

use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};

use log::warn;
use serde::{Deserialize, Serialize};
use shakmaty::{fen::Fen, uci::UciMove, CastlingMode, Chess, Move, Position};
use specta::Type;

use crate::{engine::EngineOption, error::Error, progress::update_progress, AppState};

use super::{
    engine::Analyzer,
    features_of, motifs,
    rating::{Features, RatingModel},
};

pub const RATING_FILE_NAME: &str = "rating_model.json";

/// Puzzles per 200 rating points are drawn evenly, so that the rare very
/// easy and very hard ones count as much as the many around 1500.
const BUCKET: i32 = 200;
const BUCKETS: u32 = 13;

/// The result of a calibration, as it is saved and shown.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Calibration {
    pub model: RatingModel,
    /// Puzzles the weights were fitted on.
    pub samples: u32,
    /// Average distance to the Lichess rating with the fitted weights ...
    pub mean_error: f64,
    /// ... and with the built-in ones, for comparison.
    pub default_error: f64,
    /// Seconds since 1970.
    pub calibrated_at: f64,
}

#[derive(Default)]
pub struct RatingStore {
    calibration: Mutex<Option<Calibration>>,
    path: Mutex<Option<PathBuf>>,
}

impl RatingStore {
    /// Remembers where the calibration is kept and loads it when it is there.
    pub fn open(&self, path: PathBuf) {
        if let Ok(text) = std::fs::read_to_string(&path) {
            match serde_json::from_str::<Calibration>(&text) {
                Ok(calibration) => *self.calibration.lock().unwrap() = Some(calibration),
                Err(e) => warn!("Could not read {}: {e}", path.display()),
            }
        }
        *self.path.lock().unwrap() = Some(path);
    }

    /// The weights to estimate with: the fitted ones, else the built-in ones.
    pub fn model(&self) -> RatingModel {
        self.calibration
            .lock()
            .ok()
            .and_then(|c| c.as_ref().map(|c| c.model.clone()))
            .unwrap_or_default()
    }

    pub fn get(&self) -> Option<Calibration> {
        self.calibration.lock().ok().and_then(|c| c.clone())
    }

    pub fn set(&self, calibration: Option<Calibration>) -> Result<(), Error> {
        if let Some(path) = self.path.lock().unwrap().clone() {
            match &calibration {
                Some(c) => std::fs::write(&path, serde_json::to_string_pretty(c).unwrap())?,
                None => match std::fs::remove_file(&path) {
                    Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e.into()),
                    _ => {}
                },
            }
        }
        *self.calibration.lock().unwrap() = calibration;
        Ok(())
    }
}

/// A puzzle of the sample: position before the opponent's move, the moves
/// and its Lichess rating.
struct Sample {
    fen: String,
    moves: String,
    rating: i32,
}

/// Draws up to `count` well-established puzzles, spread evenly over the
/// rating range.
fn draw_samples(file: &Path, count: u32) -> Result<Vec<Sample>, Error> {
    let db = crate::puzzle::open_database(file)?;
    let per_bucket = count.div_ceil(BUCKETS).max(1);
    let mut stmt = db.prepare(&format!(
        "SELECT fen, moves, rating FROM (
            SELECT fen, moves, rating,
                   row_number() OVER (PARTITION BY rating // {BUCKET} ORDER BY r) AS n
            FROM (
                SELECT fen, moves, rating, random() AS r FROM puzzles
                WHERE rating_deviation <= 100 AND nb_plays >= 50
            )
         ) WHERE n <= ? ORDER BY random() LIMIT ?"
    ))?;
    let rows = stmt.query_map(duckdb::params![per_bucket, count], |row| {
        Ok(Sample {
            fen: row.get(0)?,
            moves: row.get(1)?,
            rating: row.get(2)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// The position the solver sees and the solution, from a puzzle in the
/// trainer's format. `None` when the puzzle cannot be read.
fn parse_puzzle(fen: &str, moves: &str) -> Option<(Chess, Vec<Move>)> {
    let mut pos: Chess = fen
        .parse::<Fen>()
        .ok()?
        .into_position(CastlingMode::Standard)
        .ok()?;
    let mut start = None;
    let mut solution = Vec::new();
    for (i, uci) in moves.split_whitespace().enumerate() {
        let m = uci.parse::<UciMove>().ok()?.to_move(&pos).ok()?;
        pos.play_unchecked(m);
        if i == 0 {
            start = Some(pos.clone());
        } else {
            solution.push(m);
        }
    }
    if solution.is_empty() {
        return None;
    }
    Some((start?, solution))
}

/// Measures the sample puzzles. Stops with an error once `cancel` is set.
async fn measure(
    prober: &mut Analyzer,
    samples: &[Sample],
    cancel: &AtomicBool,
    mut on_progress: impl FnMut(f32),
) -> Result<Vec<(Features, f64)>, Error> {
    let mut measured = Vec::with_capacity(samples.len());
    for (i, sample) in samples.iter().enumerate() {
        if cancel.load(Ordering::SeqCst) {
            return Err(Error::AnalysisCancelled);
        }
        on_progress(i as f32 / samples.len() as f32);
        let Some((start, solution)) = parse_puzzle(&sample.fen, &sample.moves) else {
            continue;
        };
        let themes = motifs::detect(&start, &solution);
        let features = features_of(prober, &start, &solution, &themes).await?;
        measured.push((features, sample.rating as f64));
    }
    Ok(measured)
}

/// Fits the rating estimate to `samples` puzzles drawn from the Lichess
/// puzzle database `file`, measured with `engine`, and saves the result.
/// Progress goes to the progress bar `id`; `cancel_analysis(id)` stops it.
#[tauri::command]
#[specta::specta]
pub async fn calibrate_rating(
    id: String,
    engine: String,
    file: PathBuf,
    samples: u32,
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<Calibration, Error> {
    let cancel = Arc::new(AtomicBool::new(false));
    state
        .analysis_cancel_flags
        .insert(id.clone(), cancel.clone());

    let result = async {
        let drawn = draw_samples(&file, samples)?;
        // The same probe as in the tactic search: one thread, small hash.
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
        let mut prober = Analyzer::new(PathBuf::from(&engine), &probe_options).await?;
        let mut last = -1.0f32;
        let measured = measure(&mut prober, &drawn, &cancel, |share| {
            let progress = (share * 100.0).min(99.9);
            if progress - last >= 0.2 {
                last = progress;
                let _ = update_progress(&state.progress_state, &app, id.clone(), progress, false);
            }
        })
        .await;
        prober.quit().await;
        let measured = measured?;

        let model = RatingModel::fit(&measured).ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "Not enough puzzles to calibrate with. Import the Lichess puzzle database first.",
            )
        })?;
        let calibration = Calibration {
            mean_error: model.mean_error(&measured),
            default_error: RatingModel::default().mean_error(&measured),
            model,
            samples: measured.len() as u32,
            calibrated_at: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs() as f64)
                .unwrap_or(0.0),
        };
        state.rating.set(Some(calibration.clone()))?;
        Ok(calibration)
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

/// The calibration in use, `None` while the built-in weights apply.
#[tauri::command]
#[specta::specta]
pub async fn get_rating_calibration(
    state: tauri::State<'_, AppState>,
) -> Result<Option<Calibration>, Error> {
    Ok(state.rating.get())
}

/// Goes back to the built-in weights.
#[tauri::command]
#[specta::specta]
pub async fn reset_rating_calibration(state: tauri::State<'_, AppState>) -> Result<(), Error> {
    state.rating.set(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_lichess_puzzle() {
        // Lichess 00008: the opponent plays ...Bxg3 first, then White solves.
        let (start, solution) = parse_puzzle(
            "r6k/pp2r2p/4Rp1Q/3p4/8/1N1P2R1/PqP2bPP/7K b - - 0 24",
            "f2g3 e6e7 b2b1 b3c1 b1c1 h6c1",
        )
        .unwrap();
        assert_eq!(start.turn(), shakmaty::Color::White);
        assert_eq!(solution.len(), 5);
        assert!(parse_puzzle("not a fen", "e2e4 e7e5").is_none());
        assert!(parse_puzzle(&Fen::default().to_string(), "e2e4").is_none());
        assert!(parse_puzzle(&Fen::default().to_string(), "e2e4 e2e4").is_none());
    }

    #[test]
    fn the_store_keeps_the_calibration_on_disk() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(RATING_FILE_NAME);
        let store = RatingStore::default();
        store.open(path.clone());
        assert_eq!(store.model(), RatingModel::default());

        let calibration = Calibration {
            model: RatingModel {
                base: 800.0,
                ..Default::default()
            },
            samples: 2000,
            mean_error: 280.0,
            default_error: 400.0,
            calibrated_at: 1.0,
        };
        store.set(Some(calibration.clone())).unwrap();
        assert_eq!(store.model().base, 800.0);

        let again = RatingStore::default();
        again.open(path.clone());
        assert_eq!(again.get(), Some(calibration));

        again.set(None).unwrap();
        assert!(!path.exists());
        assert_eq!(again.model(), RatingModel::default());
    }

    #[test]
    fn samples_are_spread_over_the_ratings() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("puzzles.duckdb");
        {
            let db = duckdb::Connection::open(&path).unwrap();
            db.execute_batch(
                "CREATE TABLE puzzles AS
                 SELECT i AS id, 'fen' AS fen, 'e2e4 e7e5' AS moves,
                        -- 9 of 10 puzzles sit around 1500
                        CASE WHEN i % 10 = 0 THEN 600 + (i % 2400) ELSE 1450 + (i % 100) END AS rating,
                        80 AS rating_deviation, 0 AS popularity,
                        CASE WHEN i % 50 = 1 THEN 3 ELSE 500 END AS nb_plays
                 FROM range(20000) t(i);",
            )
            .unwrap();
        }
        let samples = draw_samples(&path, 260).unwrap();
        assert!(
            samples.len() <= 260 && samples.len() > 200,
            "{}",
            samples.len()
        );
        let around_1500 = samples
            .iter()
            .filter(|s| (1400..1600).contains(&s.rating))
            .count();
        // Without spreading it would be about nine in ten.
        assert!(around_1500 < samples.len() / 4, "{around_1500}");
        assert!(samples.iter().any(|s| s.rating < 1000));
        assert!(samples.iter().any(|s| s.rating > 2400));
    }

    /// Needs an engine: `JBLBASE_TEST_ENGINE=/path/to/stockfish cargo test -- --ignored calibration`
    #[tokio::test]
    #[ignore]
    async fn measures_puzzles_with_an_engine() {
        let engine = PathBuf::from(std::env::var("JBLBASE_TEST_ENGINE").unwrap());
        let mut prober = Analyzer::new(engine, &[]).await.unwrap();
        let samples = vec![
            Sample {
                fen: "r6k/pp2r2p/4Rp1Q/3p4/8/1N1P2R1/PqP2bPP/7K b - - 0 24".into(),
                moves: "f2g3 e6e7 b2b1 b3c1 b1c1 h6c1".into(),
                rating: 1877,
            },
            Sample {
                fen: "5rk1/1p3ppp/pq3b2/8/8/1P1Q1N2/P4PPP/3R2K1 w - - 2 27".into(),
                moves: "d3d6 f8d8 d6d8 f6d8".into(),
                rating: 1500,
            },
            Sample {
                fen: "broken".into(),
                moves: "".into(),
                rating: 1000,
            },
        ];
        let cancel = AtomicBool::new(false);
        let measured = measure(&mut prober, &samples, &cancel, |_| {})
            .await
            .unwrap();
        println!("{measured:#?}");
        assert_eq!(measured.len(), 2);
        assert_eq!(measured[0].0.solver_moves, 3);
        assert_eq!(measured[1].0.solver_moves, 2);
        assert!(!measured[1].0.first_capture);
        assert!(measured.iter().all(|(f, _)| f.first_depth >= 1));
    }
}
