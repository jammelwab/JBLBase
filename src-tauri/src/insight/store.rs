//! Where Insight keeps what it found out about each analysed game: one row
//! per game, its numbers per game phase and the player's errors.

use std::{
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use log::{info, warn};
use rusqlite::{params, Connection};
use serde::Serialize;
use specta::Type;

use crate::error::Error;

use super::{GameInfo, GameReport, ANALYSIS_VERSION, BRILLIANT};

pub const INSIGHT_FILE_NAME: &str = "insight.sqlite3";

#[derive(Default)]
pub struct InsightStore {
    inner: Mutex<Option<Connection>>,
}

/// Numbers of one group of games (a color, a time control, an opening ...).
#[derive(Serialize, Debug, Clone, PartialEq, Type)]
#[serde(rename_all = "camelCase")]
pub struct InsightGroup {
    pub key: String,
    pub games: u32,
    /// Average accuracy of the player, 0 to 100.
    pub accuracy: f64,
    /// Points scored in percent (win 100, draw 50).
    pub score: f64,
    /// Errors per game.
    pub inaccuracies: f64,
    pub mistakes: f64,
    pub blunders: f64,
}

#[derive(Serialize, Debug, Clone, PartialEq, Type)]
#[serde(rename_all = "camelCase")]
pub struct InsightPhase {
    /// "opening", "middlegame" or "endgame".
    pub phase: String,
    pub moves: u32,
    pub accuracy: f64,
    pub inaccuracies: u32,
    pub mistakes: u32,
    pub blunders: u32,
}

#[derive(Serialize, Debug, Clone, PartialEq, Type)]
#[serde(rename_all = "camelCase")]
pub struct InsightError {
    pub game: String,
    pub white: String,
    pub black: String,
    pub date: String,
    pub ply: u32,
    /// Position before the error.
    pub fen: String,
    pub played: String,
    pub best: String,
    /// Winning chances given away, in percent points (0 to 100).
    pub loss: f64,
    pub phase: String,
    /// 1 inaccuracy, 2 mistake, 3 blunder, 4 brilliant.
    pub class: u8,
}

/// A move Insight marked in a game.
#[derive(Debug, Clone, PartialEq)]
pub struct MarkedMove {
    pub ply: u32,
    pub class: u8,
    pub best: String,
    pub loss: f64,
}

/// One analysed game as the store knows it.
#[derive(Debug, Clone, PartialEq)]
pub struct AnalysedGame {
    pub source: String,
    pub player: String,
    pub white_side: bool,
    pub engine: String,
    pub moves: Vec<MarkedMove>,
}

#[derive(Serialize, Debug, Clone, PartialEq, Type, Default)]
#[serde(rename_all = "camelCase")]
pub struct InsightSummary {
    pub games: u32,
    pub accuracy: f64,
    pub opponent_accuracy: f64,
    /// Average centipawn loss per move.
    pub acpl: f64,
    pub missed_tactics: u32,
    /// Brilliant moves ("!!") of the player.
    pub brilliants: u32,
    pub by_color: Vec<InsightGroup>,
    pub by_speed: Vec<InsightGroup>,
    pub by_result: Vec<InsightGroup>,
    /// The openings the player chose most with White and with Black, by
    /// family ("Sicilian Defense"). Only the player's own moves name it.
    pub by_opening_white: Vec<InsightGroup>,
    pub by_opening_black: Vec<InsightGroup>,
    /// By month ("2026-03"), oldest first.
    pub by_month: Vec<InsightGroup>,
    pub phases: Vec<InsightPhase>,
    /// The biggest errors, worst first.
    pub worst: Vec<InsightError>,
    /// The brilliant moves, newest first.
    pub brilliant: Vec<InsightError>,
    /// Games analysed by an older version of Insight; analysing again adds
    /// what is new.
    pub outdated: u32,
    /// Everyone games were analysed for.
    pub players: Vec<String>,
}

fn open_connection(path: &Path) -> Result<Connection, rusqlite::Error> {
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         CREATE TABLE IF NOT EXISTS games (
             key TEXT PRIMARY KEY,
             source TEXT NOT NULL,
             player TEXT NOT NULL,
             color TEXT NOT NULL,
             white TEXT NOT NULL,
             black TEXT NOT NULL,
             outcome TEXT NOT NULL,
             date TEXT NOT NULL,
             time_control TEXT NOT NULL,
             speed TEXT NOT NULL,
             player_rating INTEGER,
             opponent_rating INTEGER,
             opening TEXT NOT NULL,
             family TEXT NOT NULL,
             plies INTEGER NOT NULL,
             depth INTEGER NOT NULL,
             engine TEXT NOT NULL,
             accuracy REAL NOT NULL,
             opponent_accuracy REAL NOT NULL,
             acpl REAL NOT NULL,
             inaccuracies INTEGER NOT NULL,
             mistakes INTEGER NOT NULL,
             blunders INTEGER NOT NULL,
             missed_tactics INTEGER NOT NULL,
             analysed_at INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS games_source ON games (source, player);
         CREATE TABLE IF NOT EXISTS phases (
             game_key TEXT NOT NULL,
             phase TEXT NOT NULL,
             moves INTEGER NOT NULL,
             accuracy_sum REAL NOT NULL,
             inaccuracies INTEGER NOT NULL,
             mistakes INTEGER NOT NULL,
             blunders INTEGER NOT NULL,
             PRIMARY KEY (game_key, phase)
         );
         CREATE TABLE IF NOT EXISTS errors (
             game_key TEXT NOT NULL,
             ply INTEGER NOT NULL,
             fen TEXT NOT NULL,
             played TEXT NOT NULL,
             best TEXT NOT NULL,
             loss REAL NOT NULL,
             class INTEGER NOT NULL,
             phase TEXT NOT NULL,
             PRIMARY KEY (game_key, ply)
         );",
    )?;
    // Columns added later.
    let columns: Vec<String> = conn
        .prepare("SELECT name FROM pragma_table_info('games')")?
        .query_map([], |row| row.get(0))?
        .collect::<Result<_, _>>()?;
    for (column, definition) in [
        ("version", "INTEGER NOT NULL DEFAULT 1"),
        ("own_opening", "TEXT NOT NULL DEFAULT ''"),
        ("own_family", "TEXT NOT NULL DEFAULT ''"),
        ("brilliants", "INTEGER NOT NULL DEFAULT 0"),
    ] {
        if !columns.iter().any(|c| c == column) {
            conn.execute_batch(&format!(
                "ALTER TABLE games ADD COLUMN {column} {definition}"
            ))?;
        }
    }
    Ok(conn)
}

impl InsightStore {
    /// Opens (or creates) the store. Failures are logged and leave Insight
    /// unavailable; the rest of the app is not affected.
    pub fn open(&self, path: PathBuf) {
        match open_connection(&path) {
            Ok(conn) => {
                info!("Insight store opened at {}", path.display());
                *self.inner.lock().unwrap() = Some(conn);
            }
            Err(e) => warn!("Could not open insight store {}: {e}", path.display()),
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
            .map_err(|_| std::io::Error::other("insight store lock poisoned"))?;
        let conn = guard
            .as_mut()
            .ok_or_else(|| std::io::Error::other("The insight store could not be opened."))?;
        Ok(f(conn)?)
    }

    /// Depth a game was analysed to, `None` when it never was.
    pub fn analysed_depth(&self, key: &str) -> Result<Option<u32>, Error> {
        self.with_conn(|conn| {
            let mut stmt =
                conn.prepare_cached("SELECT depth FROM games WHERE key = ?1 AND version >= ?2")?;
            let mut rows = stmt.query(params![key, ANALYSIS_VERSION])?;
            match rows.next()? {
                Some(row) => Ok(Some(row.get(0)?)),
                None => Ok(None),
            }
        })
    }

    /// Games of `player` from `source` analysed to at least `depth`.
    pub fn count_analysed(&self, source: &str, player: &str, depth: u32) -> Result<u32, Error> {
        self.with_conn(|conn| {
            conn.query_row(
                "SELECT COUNT(*) FROM games
                 WHERE source = ?1 AND lower(player) = lower(?2) AND depth >= ?3
                   AND version >= ?4",
                params![source, player, depth, ANALYSIS_VERSION],
                |row| row.get(0),
            )
        })
    }

    /// Saves the analysis of one game, replacing an earlier one.
    pub fn save(
        &self,
        game: &GameInfo,
        report: &GameReport,
        depth: u32,
        engine: &str,
    ) -> Result<(), Error> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        self.with_conn(|conn| {
            let tx = conn.transaction()?;
            tx.execute("DELETE FROM phases WHERE game_key = ?1", params![game.key])?;
            tx.execute("DELETE FROM errors WHERE game_key = ?1", params![game.key])?;
            tx.execute(
                "INSERT OR REPLACE INTO games (
                    key, source, player, color, white, black, outcome, date, time_control,
                    speed, player_rating, opponent_rating, opening, family, plies, depth,
                    engine, accuracy, opponent_accuracy, acpl, inaccuracies, mistakes,
                    blunders, missed_tactics, analysed_at, version, own_opening, own_family,
                    brilliants
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15,
                           ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?29)",
                params![
                    game.key,
                    game.source,
                    game.player,
                    if game.white_side { "white" } else { "black" },
                    game.white,
                    game.black,
                    game.outcome(),
                    game.date,
                    game.time_control,
                    super::speed(&game.time_control),
                    game.player_rating,
                    game.opponent_rating,
                    report.opening,
                    super::opening_family(&report.opening),
                    report.plies,
                    depth,
                    engine,
                    report.accuracy,
                    report.opponent_accuracy,
                    report.acpl,
                    report.inaccuracies,
                    report.mistakes,
                    report.blunders,
                    report.tactics.len() as u32,
                    now,
                    ANALYSIS_VERSION,
                    report.own_opening,
                    super::opening_family(&report.own_opening),
                    report.brilliants
                ],
            )?;
            for (phase, stats) in &report.phases {
                tx.execute(
                    "INSERT INTO phases (game_key, phase, moves, accuracy_sum, inaccuracies, mistakes, blunders)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![
                        game.key,
                        phase,
                        stats.moves,
                        stats.accuracy_sum,
                        stats.inaccuracies,
                        stats.mistakes,
                        stats.blunders
                    ],
                )?;
            }
            for error in &report.errors {
                tx.execute(
                    "INSERT OR REPLACE INTO errors (game_key, ply, fen, played, best, loss, class, phase)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    params![
                        game.key,
                        error.ply,
                        error.fen,
                        error.played,
                        error.best,
                        error.loss,
                        error.class,
                        error.phase
                    ],
                )?;
            }
            tx.commit()
        })
    }

    /// The statistics over all analysed games, or only those of `player`.
    pub fn summary(&self, player: Option<&str>) -> Result<InsightSummary, Error> {
        self.with_conn(|conn| {
            const FILTER: &str = "(?1 IS NULL OR lower(player) = lower(?1))";
            let groups_where = |column: &str, filter: &str, order: &str, limit: u32| -> Result<Vec<InsightGroup>, rusqlite::Error> {
                let sql = format!(
                    "SELECT {column}, COUNT(*), AVG(accuracy),
                            AVG(CASE outcome WHEN 'win' THEN 100.0 WHEN 'draw' THEN 50.0 ELSE 0.0 END),
                            AVG(inaccuracies), AVG(mistakes), AVG(blunders)
                     FROM games WHERE {FILTER} AND {column} <> '' AND {filter}
                     GROUP BY {column} ORDER BY {order} LIMIT {limit}"
                );
                let mut stmt = conn.prepare(&sql)?;
                let rows = stmt.query_map(params![player], |row| {
                    Ok(InsightGroup {
                        key: row.get(0)?,
                        games: row.get(1)?,
                        accuracy: row.get(2)?,
                        score: row.get(3)?,
                        inaccuracies: row.get(4)?,
                        mistakes: row.get(5)?,
                        blunders: row.get(6)?,
                    })
                })?;
                rows.collect()
            };
            let groups = |column: &str, order: &str, limit: u32| groups_where(column, "1", order, limit);

            let (games, accuracy, opponent_accuracy, acpl, missed_tactics, brilliants, outdated) = conn.query_row(
                &format!(
                    "SELECT COUNT(*), COALESCE(AVG(accuracy), 0), COALESCE(AVG(opponent_accuracy), 0),
                            COALESCE(AVG(acpl), 0), COALESCE(SUM(missed_tactics), 0),
                            COALESCE(SUM(brilliants), 0),
                            COALESCE(SUM(CASE WHEN version < ?2 THEN 1 ELSE 0 END), 0)
                     FROM games WHERE {FILTER}"
                ),
                params![player, ANALYSIS_VERSION],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                    ))
                },
            )?;

            let phases = {
                let mut stmt = conn.prepare(&format!(
                    "SELECT p.phase, SUM(p.moves), SUM(p.accuracy_sum), SUM(p.inaccuracies),
                            SUM(p.mistakes), SUM(p.blunders)
                     FROM phases p JOIN games g ON g.key = p.game_key
                     WHERE {FILTER}
                     GROUP BY p.phase
                     ORDER BY CASE p.phase WHEN 'opening' THEN 0 WHEN 'middlegame' THEN 1 ELSE 2 END"
                ))?;
                let rows = stmt.query_map(params![player], |row| {
                    let moves: u32 = row.get(1)?;
                    let sum: f64 = row.get(2)?;
                    Ok(InsightPhase {
                        phase: row.get(0)?,
                        moves,
                        accuracy: if moves > 0 { sum / moves as f64 } else { 0.0 },
                        inaccuracies: row.get(3)?,
                        mistakes: row.get(4)?,
                        blunders: row.get(5)?,
                    })
                })?;
                rows.collect::<Result<Vec<_>, _>>()?
            };

            let moves = |filter: &str, order: &str| -> Result<Vec<InsightError>, rusqlite::Error> {
                let mut stmt = conn.prepare(&format!(
                    "SELECT e.game_key, g.white, g.black, g.date, e.ply, e.fen, e.played, e.best,
                            e.loss, e.phase, e.class
                     FROM errors e JOIN games g ON g.key = e.game_key
                     WHERE {FILTER} AND {filter}
                     ORDER BY {order} LIMIT 30"
                ))?;
                let rows = stmt.query_map(params![player, BRILLIANT], |row| {
                    Ok(InsightError {
                        game: row.get(0)?,
                        white: row.get(1)?,
                        black: row.get(2)?,
                        date: row.get(3)?,
                        ply: row.get(4)?,
                        fen: row.get(5)?,
                        played: row.get(6)?,
                        best: row.get(7)?,
                        loss: row.get(8)?,
                        phase: row.get(9)?,
                        class: row.get(10)?,
                    })
                })?;
                rows.collect()
            };
            let worst = moves("e.class < ?2", "e.loss DESC, g.date DESC")?;
            let brilliant = moves("e.class = ?2", "g.date DESC, e.ply")?;

            let players = {
                let mut stmt =
                    conn.prepare("SELECT DISTINCT player FROM games ORDER BY lower(player)")?;
                let rows = stmt.query_map([], |row| row.get(0))?;
                rows.collect::<Result<Vec<String>, _>>()?
            };

            let mut by_month = groups("substr(date, 1, 7)", "1 DESC", 36)?;
            by_month.reverse();

            Ok(InsightSummary {
                games,
                accuracy,
                opponent_accuracy,
                acpl,
                missed_tactics,
                brilliants,
                by_color: groups("color", "1 DESC", 2)?,
                by_speed: groups("speed", "2 DESC", 10)?,
                by_result: groups("outcome", "2 DESC", 3)?,
                by_opening_white: groups_where("own_family", "color = 'white'", "2 DESC", 15)?,
                by_opening_black: groups_where("own_family", "color = 'black'", "2 DESC", 15)?,
                by_month,
                phases,
                worst,
                brilliant,
                outdated,
                players,
            })
        })
    }

    /// What Insight found in one game: where it came from and the player's
    /// errors and brilliant moves. `None` when the game is not analysed.
    pub fn game(&self, key: &str) -> Result<Option<AnalysedGame>, Error> {
        self.with_conn(|conn| {
            let game = conn.query_row(
                "SELECT source, player, color, engine FROM games WHERE key = ?1",
                params![key],
                |row| {
                    Ok(AnalysedGame {
                        source: row.get(0)?,
                        player: row.get(1)?,
                        white_side: row.get::<_, String>(2)? == "white",
                        engine: row.get(3)?,
                        moves: Vec::new(),
                    })
                },
            );
            let mut game = match game {
                Ok(game) => game,
                Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(None),
                Err(e) => return Err(e),
            };
            let mut stmt = conn.prepare(
                "SELECT ply, class, best, loss FROM errors WHERE game_key = ?1 ORDER BY ply",
            )?;
            game.moves = stmt
                .query_map(params![key], |row| {
                    Ok(MarkedMove {
                        ply: row.get(0)?,
                        class: row.get(1)?,
                        best: row.get(2)?,
                        loss: row.get(3)?,
                    })
                })?
                .collect::<Result<_, _>>()?;
            Ok(Some(game))
        })
    }

    #[cfg(test)]
    pub fn set_version_for_test(&self, key: &str, version: u32) {
        self.with_conn(|conn| {
            conn.execute(
                "UPDATE games SET version = ?2 WHERE key = ?1",
                params![key, version],
            )
        })
        .unwrap();
    }

    /// Forgets every analysis. The evaluations stay in the position store,
    /// so analysing again is quick.
    pub fn clear(&self) -> Result<(), Error> {
        self.with_conn(|conn| {
            conn.execute_batch("DELETE FROM errors; DELETE FROM phases; DELETE FROM games;")
        })
    }
}
