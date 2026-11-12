//! Estimates how hard a puzzle is, as an Elo number on the Lichess puzzle
//! scale, from what the engine needed to solve it.

use serde::{Deserialize, Serialize};
use specta::Type;

/// What we measure about one puzzle.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Features {
    /// Moves the solver has to find.
    pub solver_moves: u32,
    /// Search depth from which the engine plays the first move.
    pub first_depth: u32,
    /// Deepest such depth over all moves of the solution.
    pub max_depth: u32,
    /// The solver gives up material on the way.
    pub sacrifice: bool,
    /// The first move takes something.
    pub first_capture: bool,
    /// The first move gives check.
    pub first_check: bool,
}

/// Weights of the estimate. The defaults are set by hand; `fit` replaces
/// them with weights that match the ratings of real Lichess puzzles.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RatingModel {
    pub base: f64,
    pub per_first_depth: f64,
    pub per_extra_depth: f64,
    pub per_extra_move: f64,
    pub sacrifice: f64,
    pub quiet_first_move: f64,
    pub plain_capture: f64,
}

impl Default for RatingModel {
    fn default() -> Self {
        Self {
            base: 550.0,
            per_first_depth: 95.0,
            per_extra_depth: 45.0,
            per_extra_move: 130.0,
            sacrifice: 120.0,
            quiet_first_move: 120.0,
            plain_capture: -80.0,
        }
    }
}

/// The numbers the weights are multiplied with, in the order of the fields
/// of `RatingModel`.
fn terms(f: &Features) -> [f64; 7] {
    let flag = |b: bool| if b { 1.0 } else { 0.0 };
    [
        1.0,
        f.first_depth.max(1) as f64,
        f.max_depth.saturating_sub(f.first_depth) as f64,
        f.solver_moves.saturating_sub(1).min(5) as f64,
        flag(f.sacrifice),
        flag(!f.first_capture && !f.first_check),
        flag(f.first_capture && !f.sacrifice),
    ]
}

impl RatingModel {
    fn weights(&self) -> [f64; 7] {
        [
            self.base,
            self.per_first_depth,
            self.per_extra_depth,
            self.per_extra_move,
            self.sacrifice,
            self.quiet_first_move,
            self.plain_capture,
        ]
    }

    /// The estimate before rounding and limits.
    fn raw(&self, f: &Features) -> f64 {
        terms(f)
            .iter()
            .zip(self.weights())
            .map(|(t, w)| t * w)
            .sum()
    }

    pub fn estimate(&self, f: &Features) -> i32 {
        // Round to 5 so the number does not look more exact than it is.
        ((self.raw(f) / 5.0).round() as i32 * 5).clamp(400, 3000)
    }

    /// Average distance between estimate and real rating over `samples`.
    pub fn mean_error(&self, samples: &[(Features, f64)]) -> f64 {
        if samples.is_empty() {
            return 0.0;
        }
        samples
            .iter()
            .map(|(f, rating)| (self.estimate(f) as f64 - rating).abs())
            .sum::<f64>()
            / samples.len() as f64
    }

    /// The weights that fit `samples` (features with the real rating) best,
    /// by least squares. `None` when the samples do not determine them.
    pub fn fit(samples: &[(Features, f64)]) -> Option<RatingModel> {
        const N: usize = 7;
        if samples.len() < N * 5 {
            return None;
        }
        // Normal equations (XᵀX) w = Xᵀy, with a small ridge so that a term
        // that never occurs in the samples keeps a weight of zero.
        let mut a = [[0.0f64; N + 1]; N];
        for (features, rating) in samples {
            let x = terms(features);
            for i in 0..N {
                for j in 0..N {
                    a[i][j] += x[i] * x[j];
                }
                a[i][N] += x[i] * rating;
            }
        }
        for (i, row) in a.iter_mut().enumerate() {
            row[i] += 1e-6 * samples.len() as f64;
        }
        // Gaussian elimination with partial pivoting.
        for col in 0..N {
            let pivot = (col..N).max_by(|x, y| a[*x][col].abs().total_cmp(&a[*y][col].abs()))?;
            if a[pivot][col].abs() < 1e-12 {
                return None;
            }
            a.swap(col, pivot);
            for row in 0..N {
                if row != col {
                    let factor = a[row][col] / a[col][col];
                    for k in col..=N {
                        a[row][k] -= factor * a[col][k];
                    }
                }
            }
        }
        let w: Vec<f64> = (0..N).map(|i| a[i][N] / a[i][i]).collect();
        if w.iter().any(|v| !v.is_finite()) {
            return None;
        }
        Some(RatingModel {
            base: w[0],
            per_first_depth: w[1],
            per_extra_depth: w[2],
            per_extra_move: w[3],
            sacrifice: w[4],
            quiet_first_move: w[5],
            plain_capture: w[6],
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn harder_puzzles_rate_higher() {
        let model = RatingModel::default();
        let hanging_piece = Features {
            solver_moves: 1,
            first_depth: 1,
            max_depth: 1,
            first_capture: true,
            ..Default::default()
        };
        let combination = Features {
            solver_moves: 3,
            first_depth: 7,
            max_depth: 7,
            sacrifice: true,
            first_capture: true,
            ..Default::default()
        };
        let deep_quiet = Features {
            solver_moves: 4,
            first_depth: 13,
            max_depth: 13,
            ..Default::default()
        };
        let easy = model.estimate(&hanging_piece);
        let medium = model.estimate(&combination);
        let hard = model.estimate(&deep_quiet);
        assert!(easy < 800, "{easy}");
        assert!((1300..1900).contains(&medium), "{medium}");
        assert!(hard > 2000, "{hard}");
        assert!(easy < medium && medium < hard);
    }

    #[test]
    fn fit_recovers_the_weights_behind_the_samples() {
        let truth = RatingModel {
            base: 700.0,
            per_first_depth: 80.0,
            per_extra_depth: 30.0,
            per_extra_move: 150.0,
            sacrifice: 200.0,
            quiet_first_move: 90.0,
            plain_capture: -120.0,
        };
        let mut samples = Vec::new();
        for i in 0..400u32 {
            let first_depth = 1 + i % 9;
            let features = Features {
                solver_moves: 1 + i % 4,
                first_depth,
                max_depth: first_depth + (i / 3) % 5,
                sacrifice: i % 5 == 0,
                first_capture: i % 3 == 0,
                first_check: i % 7 == 0,
            };
            // A little noise that averages out.
            let noise = if i % 2 == 0 { 20.0 } else { -20.0 };
            samples.push((features.clone(), truth.raw(&features) + noise));
        }
        let fitted = RatingModel::fit(&samples).unwrap();
        for (got, want) in fitted.weights().iter().zip(truth.weights()) {
            assert!((got - want).abs() < 15.0, "{fitted:?}");
        }
        assert!(fitted.mean_error(&samples) < 25.0);
        assert!(fitted.mean_error(&samples) < RatingModel::default().mean_error(&samples));
        // Too few samples say nothing.
        assert!(RatingModel::fit(&samples[..10]).is_none());
    }

    #[test]
    fn stays_in_range() {
        let model = RatingModel::default();
        let extreme = Features {
            solver_moves: 9,
            first_depth: 40,
            max_depth: 40,
            sacrifice: true,
            ..Default::default()
        };
        assert_eq!(model.estimate(&extreme), 3000);
    }
}
