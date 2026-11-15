//! Writes found tactics into a puzzle database the trainer can open: the same
//! tables as an imported Lichess database, plus where each puzzle comes from.
//!
//! Each puzzle is in a database only once, however many repertoires or games
//! lead to it, and what a review decided about a puzzle (wrong, corrected,
//! right after all) is kept in the database, so a new search does not bring a
//! deleted puzzle back or undo a correction.

use std::{
    collections::{HashMap, HashSet},
    path::Path,
};

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
    create_review_table(db)
}

fn create_review_table(db: &Connection) -> Result<(), Error> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS reviews (
            position VARCHAR NOT NULL,
            lead VARCHAR NOT NULL,
            verdict VARCHAR NOT NULL,
            moves VARCHAR,
            rating INTEGER,
            PRIMARY KEY (position, lead)
        );",
    )?;
    Ok(())
}

/// The position of a FEN without the move counters, so that the same position
/// reached by another move order is recognised.
pub fn position_part(fen: &str) -> String {
    fen.split_whitespace().take(4).collect::<Vec<_>>().join(" ")
}

/// What identifies a puzzle: its position and the opponent's move into it.
fn puzzle_key(fen: &str, moves: &str) -> (String, String) {
    (
        position_part(fen),
        moves.split_whitespace().next().unwrap_or("").to_string(),
    )
}

/// What a review decided about a puzzle.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    /// The puzzle is right as it is.
    Confirmed,
    /// The solution was replaced by a better one.
    Corrected,
    /// The puzzle is wrong and gone.
    Deleted,
}

impl Verdict {
    pub fn as_str(self) -> &'static str {
        match self {
            Verdict::Confirmed => "confirmed",
            Verdict::Corrected => "corrected",
            Verdict::Deleted => "deleted",
        }
    }

    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "confirmed" => Some(Verdict::Confirmed),
            "corrected" => Some(Verdict::Corrected),
            "deleted" => Some(Verdict::Deleted),
            _ => None,
        }
    }
}

struct Review {
    verdict: String,
    moves: Option<String>,
    rating: Option<i32>,
}

/// How a new search was stored.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Stored {
    /// Puzzles of this source now in the database.
    pub added: u32,
    /// Found again, but already there from another source or twice in this one.
    pub duplicates: u32,
    /// Found again, but deleted in an earlier review.
    pub rejected: u32,
    /// Puzzles in the database altogether.
    pub total: u32,
}

/// Replaces the puzzles of `source` (one repertoire, or the own games) in the
/// database at `path` with `tactics`. Puzzles of other sources stay; a puzzle
/// that another source already has is not added a second time, one deleted
/// in a review not again, and a corrected one gets its corrected solution.
pub fn replace_source(
    path: &Path,
    source: &str,
    tactics: &[StoredTactic],
) -> Result<Stored, Error> {
    let mut db = Connection::open(path)?;
    create_tables(&db)?;
    let tx = db.transaction()?;
    tx.execute(
        "DELETE FROM puzzle_themes WHERE puzzle_id IN (SELECT id FROM puzzles WHERE source = ?)",
        params![source],
    )?;
    tx.execute("DELETE FROM puzzles WHERE source = ?", params![source])?;

    let mut present: HashSet<(String, String)> = HashSet::new();
    {
        let mut stmt = tx.prepare("SELECT fen, moves FROM puzzles")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
        for row in rows {
            let (fen, moves) = row?;
            present.insert(puzzle_key(&fen, &moves));
        }
    }
    let mut reviews: HashMap<(String, String), Review> = HashMap::new();
    {
        let mut stmt = tx.prepare("SELECT position, lead, verdict, moves, rating FROM reviews")?;
        let rows = stmt.query_map([], |r| {
            Ok((
                (r.get::<_, String>(0)?, r.get::<_, String>(1)?),
                Review {
                    verdict: r.get(2)?,
                    moves: r.get(3)?,
                    rating: r.get(4)?,
                },
            ))
        })?;
        for row in rows {
            let (key, review) = row?;
            reviews.insert(key, review);
        }
    }
    let mut stored = Stored::default();

    let mut next_id: i32 =
        tx.query_row("SELECT COALESCE(MAX(id), 0) + 1 FROM puzzles", [], |r| {
            r.get(0)
        })?;
    let mut next_theme: i32 =
        tx.query_row("SELECT COALESCE(MAX(id), 0) + 1 FROM themes", [], |r| {
            r.get(0)
        })?;

    for tactic in tactics {
        let mut moves = tactic.moves.join(" ");
        let mut rating = tactic.rating;
        let key = puzzle_key(&tactic.fen, &moves);
        if present.contains(&key) {
            stored.duplicates += 1;
            continue;
        }
        match reviews.get(&key) {
            Some(review) if review.verdict == Verdict::Deleted.as_str() => {
                stored.rejected += 1;
                continue;
            }
            Some(review) if review.verdict == Verdict::Corrected.as_str() => {
                if let Some(corrected) = &review.moves {
                    moves = corrected.clone();
                }
                rating = review.rating.unwrap_or(rating);
            }
            _ => {}
        }
        present.insert(key);
        stored.added += 1;
        tx.execute(
            "INSERT INTO puzzles (id, fen, moves, rating, rating_deviation, popularity, nb_plays, source, line, eval_cp)
             VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?)",
            params![
                next_id,
                tactic.fen,
                moves,
                rating,
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
    stored.total = db.query_row("SELECT COUNT(*) FROM puzzles", [], |r| r.get(0))?;
    db.execute_batch("CHECKPOINT;")?;
    Ok(stored)
}

/// Carries out a review decision on the puzzle `fen`/`moves` of the database
/// at `path` and remembers it for later searches. `corrected` holds the new
/// moves (starting with the opponent's move, as always) and rating.
/// Returns whether the puzzle was found in the database.
pub fn apply_verdict(
    path: &Path,
    fen: &str,
    moves: &str,
    verdict: Verdict,
    corrected: Option<(&str, i32)>,
) -> Result<bool, Error> {
    let mut db = Connection::open(path)?;
    create_review_table(&db)?;
    let tx = db.transaction()?;
    let ids: Vec<i64> = {
        let mut stmt = tx.prepare("SELECT id FROM puzzles WHERE fen = ? AND moves = ?")?;
        let rows = stmt.query_map(params![fen, moves], |r| r.get(0))?;
        rows.collect::<Result<_, _>>()?
    };
    match verdict {
        Verdict::Confirmed => {}
        Verdict::Corrected => {
            let (new_moves, new_rating) = corrected.ok_or_else(|| {
                std::io::Error::other("A correction needs the corrected solution.")
            })?;
            for id in &ids {
                tx.execute(
                    "UPDATE puzzles SET moves = ?, rating = ? WHERE id = ?",
                    params![new_moves, new_rating, id],
                )?;
            }
        }
        Verdict::Deleted => {
            for id in &ids {
                tx.execute("DELETE FROM puzzle_themes WHERE puzzle_id = ?", params![id])?;
                tx.execute("DELETE FROM puzzles WHERE id = ?", params![id])?;
            }
            tx.execute(
                "DELETE FROM themes WHERE id NOT IN (SELECT theme_id FROM puzzle_themes)",
                [],
            )?;
        }
    }
    let (position, lead) = puzzle_key(fen, moves);
    tx.execute(
        "INSERT OR REPLACE INTO reviews (position, lead, verdict, moves, rating) VALUES (?, ?, ?, ?, ?)",
        params![
            position,
            lead,
            verdict.as_str(),
            corrected.map(|c| c.0.to_string()),
            corrected.map(|c| c.1)
        ],
    )?;
    tx.commit()?;
    db.execute_batch("CHECKPOINT;")?;
    Ok(!ids.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tactic(fen: &str, themes: &[&str]) -> StoredTactic {
        StoredTactic {
            // A distinct position per name, with the move counters of a real FEN.
            fen: format!("{fen} w - - 0 1"),
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
            .unwrap()
            .total,
            2
        );
        assert_eq!(
            replace_source(&path, "Aaron", &[tactic("c", &["fork", "mate"])])
                .unwrap()
                .total,
            3
        );
        // Scanning the first repertoire again: its two puzzles go, one comes.
        assert_eq!(
            replace_source(&path, "Ich Weiß", &[tactic("d", &["skewer"])])
                .unwrap()
                .total,
            2
        );

        let file = path.to_string_lossy().into_owned();
        let themes = crate::puzzle::get_puzzle_themes(file.clone()).unwrap();
        assert_eq!(themes, vec!["fork", "mate", "skewer"]);
        // The trainer finds them like Lichess puzzles.
        let puzzle = crate::puzzle::get_puzzle(file, 1000, 1400, Some("skewer".into())).unwrap();
        assert_eq!(puzzle.fen, "d w - - 0 1");
        assert_eq!(puzzle.moves, "e7e5 d1h5");
    }

    #[test]
    fn a_puzzle_is_stored_only_once() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("tactics.duckdb");
        replace_source(&path, "A", &[tactic("a", &["fork"])]).unwrap();
        // The same position, reached with other move counters, from another source.
        let mut again = tactic("a", &["fork"]);
        again.fen = "a w - - 4 9".into();
        let stored = replace_source(&path, "B", &[again.clone(), tactic("b", &["pin"])]).unwrap();
        assert_eq!(
            stored,
            Stored {
                added: 1,
                duplicates: 1,
                rejected: 0,
                total: 2
            }
        );
        // Twice in one search counts once as well.
        let stored = replace_source(&path, "C", &[tactic("c", &[]), tactic("c", &[])]).unwrap();
        assert_eq!((stored.added, stored.duplicates), (1, 1));
        // Running a source again is no duplicate of itself.
        let stored = replace_source(&path, "B", &[again, tactic("b", &["pin"])]).unwrap();
        assert_eq!((stored.added, stored.duplicates, stored.total), (1, 1, 3));
    }

    #[test]
    fn review_decisions_last_through_new_searches() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("tactics.duckdb");
        let a = tactic("a", &["fork"]);
        let b = tactic("b", &["pin"]);
        replace_source(&path, "A", &[a.clone(), b.clone()]).unwrap();

        assert!(apply_verdict(&path, &a.fen, "e7e5 d1h5", Verdict::Deleted, None).unwrap());
        assert!(apply_verdict(
            &path,
            &b.fen,
            "e7e5 d1h5",
            Verdict::Corrected,
            Some(("e7e5 f1c4", 1700))
        )
        .unwrap());
        let file = path.to_string_lossy().into_owned();
        assert_eq!(
            crate::puzzle::get_puzzle_themes(file.clone()).unwrap(),
            vec!["pin"]
        );

        // The search finds both again: the deleted one stays away, the
        // corrected one keeps its correction.
        let stored = replace_source(&path, "A", &[a, b]).unwrap();
        assert_eq!((stored.added, stored.rejected, stored.total), (1, 1, 1));
        crate::puzzle::forget_cached_puzzles(&path);
        let puzzle = crate::puzzle::get_puzzle(file, 1000, 2000, None).unwrap();
        assert_eq!(puzzle.moves, "e7e5 f1c4");
        assert_eq!(puzzle.rating, 1700);
    }
}
