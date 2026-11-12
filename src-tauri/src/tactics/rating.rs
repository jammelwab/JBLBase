//! Estimates how hard a puzzle is, as an Elo number on the Lichess puzzle
//! scale, from what the engine needed to solve it.

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

/// Weights of the estimate. These defaults are set by hand; they are meant to
/// be replaced by a fit against the Lichess ratings (see the roadmap).
#[derive(Debug, Clone, PartialEq)]
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

impl RatingModel {
    pub fn estimate(&self, f: &Features) -> i32 {
        let first = f.first_depth.max(1) as f64;
        let extra_depth = f.max_depth.saturating_sub(f.first_depth) as f64;
        let extra_moves = f.solver_moves.saturating_sub(1).min(5) as f64;
        let mut rating = self.base
            + self.per_first_depth * first
            + self.per_extra_depth * extra_depth
            + self.per_extra_move * extra_moves;
        if f.sacrifice {
            rating += self.sacrifice;
        }
        if !f.first_capture && !f.first_check {
            rating += self.quiet_first_move;
        }
        if f.first_capture && !f.sacrifice {
            rating += self.plain_capture;
        }
        // Round to 5 so the number does not look more exact than it is.
        ((rating / 5.0).round() as i32 * 5).clamp(400, 3000)
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
