//! Writes found tactics into a puzzle database the trainer can open: the same
//! tables as an imported Lichess database, plus where each puzzle comes from.

use std::path::Path;

use duckdb::{params, Connection};

use crate::error::Error;

/// A finished puzzle, in the trainer's format: `fen` is the position before
/// the opponent's move and `moves` starts with that move.
#[derive(Debug, Clone, PartialEq)]
pub struct StoredTactic {
    pub fen: String,
    pub moves: Vec<String>,
    pub rating: i32,
    pub themes: Vec<String>,
    /// The moves that lead to the puzzle, as text ("1. e4 e5 2. Nf3 ...").
    pub line: String,
    /// Evaluation after the solution in centipawns for the solver, mate as ±10000.
    pub eval_cp: i32,
}

/// How sure the estimated rating is, shown where Lichess has its deviation.
const RATING_DEVIATION: i32 = 150;

fn create_tables(db: &Connection) -> Result<(), Error> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS puzzles (
            id INTEGER PRIMARY KEY,
            fen VARCHAR NOT NULL,
            moves VARCHAR NOT NULL,
            rating INTEGER NOT NULL,
            rating_deviation INTEGER NOT NULL,
            popularity INTEGER NOT NULL,
            nb_plays INTEGER NOT NULL,
            source VARCHAR NOT NULL,
            line VARCHAR,
            eval_cp INTEGER
        );
        CREATE TABLE IF NOT EXISTS themes (id INTEGER PRIMARY KEY, name VARCHAR NOT NULL);
        CREATE TABLE IF NOT EXISTS puzzle_themes (puzzle_id INTEGER NOT NULL, theme_id INTEGER NOT NULL);",
    )?;
    Ok(())
}

/// Replaces the puzzles of `source` (one repertoire, or the own games) in the
/// database at `path` with `tactics`. Puzzles of other sources stay.
/// Returns the number of puzzles in the database afterwards.
pub fn replace_source(path: &Path, source: &str, tactics: &[StoredTactic]) -> Result<u32, Error> {
    let mut db = Connection::open(path)?;
    create_tables(&db)?;
    let tx = db.transaction()?;
    tx.execute(
        "DELETE FROM puzzle_themes WHERE puzzle_id IN (SELECT id FROM puzzles WHERE source = ?)",
        params![source],
    )?;
    tx.execute("DELETE FROM puzzles WHERE source = ?", params![source])?;

    let mut next_id: i32 =
        tx.query_row("SELECT COALESCE(MAX(id), 0) + 1 FROM puzzles", [], |r| {
            r.get(0)
        })?;
    let mut next_theme: i32 =
        tx.query_row("SELECT COALESCE(MAX(id), 0) + 1 FROM themes", [], |r| {
            r.get(0)
        })?;

    for tactic in tactics {
        tx.execute(
            "INSERT INTO puzzles (id, fen, moves, rating, rating_deviation, popularity, nb_plays, source, line, eval_cp)
             VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?)",
            params![
                next_id,
                tactic.fen,
                tactic.moves.join(" "),
                tactic.rating,
                RATING_DEVIATION,
                source,
                tactic.line,
                tactic.eval_cp
            ],
        )?;
        for theme in &tactic.themes {
            let existing: Option<i32> = tx
                .query_row(
                    "SELECT id FROM themes WHERE name = ?",
                    params![theme],
                    |r| r.get(0),
                )
                .ok();
            let theme_id = match existing {
                Some(id) => id,
                None => {
                    tx.execute(
                        "INSERT INTO themes (id, name) VALUES (?, ?)",
                        params![next_theme, theme],
                    )?;
                    next_theme += 1;
                    next_theme - 1
                }
            };
            tx.execute(
                "INSERT INTO puzzle_themes (puzzle_id, theme_id) VALUES (?, ?)",
                params![next_id, theme_id],
            )?;
        }
        next_id += 1;
    }
    // Themes nobody uses any more would only clutter the trainer's filter.
    tx.execute(
        "DELETE FROM themes WHERE id NOT IN (SELECT theme_id FROM puzzle_themes)",
        [],
    )?;
    tx.commit()?;
    let total: u32 = db.query_row("SELECT COUNT(*) FROM puzzles", [], |r| r.get(0))?;
    db.execute_batch("CHECKPOINT;")?;
    Ok(total)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tactic(fen: &str, themes: &[&str]) -> StoredTactic {
        StoredTactic {
            fen: fen.to_string(),
            moves: vec!["e7e5".into(), "d1h5".into()],
            rating: 1200,
            themes: themes.iter().map(|t| t.to_string()).collect(),
            line: "1. e4".into(),
            eval_cp: 300,
        }
    }

    #[test]
    fn a_new_scan_replaces_only_its_own_source() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("tactics.duckdb");
        assert_eq!(
            replace_source(
                &path,
                "Ich Weiß",
                &[tactic("a", &["fork"]), tactic("b", &["pin"])]
            )
            .unwrap(),
            2
        );
        assert_eq!(
            replace_source(&path, "Aaron", &[tactic("c", &["fork", "mate"])]).unwrap(),
            3
        );
        // Scanning the first repertoire again: its two puzzles go, one comes.
        assert_eq!(
            replace_source(&path, "Ich Weiß", &[tactic("d", &["skewer"])]).unwrap(),
            2
        );

        let file = path.to_string_lossy().into_owned();
        let themes = crate::puzzle::get_puzzle_themes(file.clone()).unwrap();
        assert_eq!(themes, vec!["fork", "mate", "skewer"]);
        // The trainer finds them like Lichess puzzles.
        let puzzle = crate::puzzle::get_puzzle(file, 1000, 1400, Some("skewer".into())).unwrap();
        assert_eq!(puzzle.fen, "d");
        assert_eq!(puzzle.moves, "e7e5 d1h5");
    }
}
