//! Persistent evaluation cache ("Positionsspeicher").
//!
//! Every position an engine evaluates is stored in a local SQLite database
//! together with the engine name, the search depth and the principal
//! variations. When the same position is analysed again (live analysis or
//! full game analysis) the stored result is shown immediately and, if it is
//! deep enough, the engine does not need to search at all.
//!
//! Positions are keyed by their EPD (FEN without the move counters), so the
//! same position reached through different move orders shares one entry.
//! Results are stored per engine and per number of lines (MultiPV), because a
//! 1-line search and a 5-line search at the same depth are not interchangeable.

use std::{
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use log::{info, warn};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use shakmaty::{fen::Fen, EnPassantMode, Position};
use specta::Type;
use vampirc_uci::uci::{Score, ScoreValue};

use crate::{error::Error, AppState};

pub const CACHE_FILE_NAME: &str = "eval_cache.sqlite3";

/// One stored principal variation. Scores are from White's point of view,
/// exactly like the `BestMoves` sent to the frontend.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct StoredLine {
    pub multipv: u16,
    pub depth: u32,
    pub nodes: u32,
    pub nps: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cp: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mate: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wdl: Option<(i32, i32, i32)>,
    pub uci: Vec<String>,
}

impl StoredLine {
    pub fn score(&self) -> Score {
        let value = match (self.mate, self.cp) {
            (Some(m), _) => ScoreValue::Mate(m),
            (None, Some(cp)) => ScoreValue::Cp(cp),
            (None, None) => ScoreValue::Cp(0),
        };
        Score {
            value,
            wdl: self.wdl,
            lower_bound: None,
            upper_bound: None,
        }
    }

    pub fn from_score(
        multipv: u16,
        depth: u32,
        nodes: u32,
        nps: u32,
        score: &Score,
        uci: Vec<String>,
    ) -> Self {
        let (cp, mate) = match score.value {
            ScoreValue::Cp(cp) => (Some(cp), None),
            ScoreValue::Mate(m) => (None, Some(m)),
        };
        Self {
            multipv,
            depth,
            nodes,
            nps,
            cp,
            mate,
            wdl: score.wdl,
            uci,
        }
    }
}

/// A cached evaluation of one position by one engine.
#[derive(Debug, Clone, PartialEq)]
pub struct CachedEval {
    pub engine: String,
    pub depth: u32,
    pub multipv: u16,
    pub lines: Vec<StoredLine>,
}

#[derive(Serialize, Debug, Clone, Type)]
#[serde(rename_all = "camelCase")]
pub struct EvalCacheStats {
    pub path: String,
    pub positions: u32,
    pub entries: u32,
    pub size_bytes: f64,
    pub engines: Vec<EngineCacheStats>,
}

#[derive(Serialize, Debug, Clone, Type)]
#[serde(rename_all = "camelCase")]
pub struct EngineCacheStats {
    pub engine: String,
    pub entries: u32,
    pub max_depth: u32,
}

/// Cached evaluation as shown to the frontend (e.g. for repertoire tools).
#[derive(Serialize, Debug, Clone, Type)]
#[serde(rename_all = "camelCase")]
pub struct CachedEvalJs {
    pub engine: String,
    pub depth: u32,
    pub multipv: u16,
    pub score: Score,
    pub uci_moves: Vec<String>,
}

/// Normalised key of a position: piece placement, side to move, castling
/// rights and (only when a capture is actually possible) the en passant
/// square. Move counters are dropped on purpose.
pub fn position_key<P: Position>(pos: &P) -> String {
    let fen = Fen::from_position(pos, EnPassantMode::Legal).to_string();
    fen.split_whitespace().take(4).collect::<Vec<_>>().join(" ")
}

/// How deep results may be stored. Admins store without limit; normal users
/// (once accounts exist) store up to a fixed depth. Proven mates are always
/// stored as they are, because engines report them with an artificial depth
/// (Stockfish uses its maximum of 245) and they are the most certain results.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum StoreLimit {
    #[default]
    Unlimited,
    MaxDepth(u32),
}

/// Depth limit planned for normal user accounts.
pub const USER_MAX_STORE_DEPTH: u32 = 28;

/// Upper bound for the write-ahead log after a checkpoint. Without it the
/// `-wal` file keeps its largest size (about 4 MB) forever.
const WAL_SIZE_LIMIT_BYTES: i64 = 1024 * 1024;

#[derive(Default)]
pub struct EvalCache {
    inner: Mutex<Option<CacheInner>>,
    limit: Mutex<StoreLimit>,
}

struct CacheInner {
    conn: Connection,
    path: PathBuf,
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn open_connection(path: &Path) -> Result<Connection, rusqlite::Error> {
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA busy_timeout = 2000;
         CREATE TABLE IF NOT EXISTS evals (
             position   TEXT    NOT NULL,
             engine     TEXT    NOT NULL,
             multipv    INTEGER NOT NULL,
             depth      INTEGER NOT NULL,
             nodes      INTEGER NOT NULL,
             lines      TEXT    NOT NULL,
             updated_at INTEGER NOT NULL,
             PRIMARY KEY (position, engine, multipv)
         ) WITHOUT ROWID;
         CREATE TABLE IF NOT EXISTS meta (
             key   TEXT PRIMARY KEY,
             value TEXT NOT NULL
         );
         INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', '1');",
    )?;
    conn.pragma_update(None, "journal_size_limit", WAL_SIZE_LIMIT_BYTES)?;
    // Fold what an earlier session left in the log back into the main file.
    if let Err(e) = conn.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(())) {
        warn!("Evaluation cache checkpoint failed: {e}");
    }
    Ok(conn)
}

impl EvalCache {
    /// Opens (or creates) the cache file. Failures are logged and leave the
    /// cache disabled; analysis keeps working without it.
    pub fn open(&self, path: PathBuf) {
        match open_connection(&path) {
            Ok(conn) => {
                info!("Evaluation cache opened at {}", path.display());
                *self.inner.lock().unwrap() = Some(CacheInner { conn, path });
            }
            Err(e) => warn!("Could not open evaluation cache {}: {e}", path.display()),
        }
    }

    #[cfg(test)]
    pub fn open_in_memory() -> Self {
        let cache = Self::default();
        let conn = open_connection(Path::new(":memory:")).unwrap();
        *cache.inner.lock().unwrap() = Some(CacheInner {
            conn,
            path: PathBuf::from(":memory:"),
        });
        cache
    }

    pub fn set_limit(&self, limit: StoreLimit) {
        if let Ok(mut l) = self.limit.lock() {
            *l = limit;
        }
    }

    pub fn limit(&self) -> StoreLimit {
        self.limit.lock().map(|l| *l).unwrap_or_default()
    }

    /// Best stored result for `engine` with at least `min_multipv` lines.
    /// The returned lines are trimmed to `min_multipv`.
    pub fn lookup(&self, position: &str, engine: &str, min_multipv: u16) -> Option<CachedEval> {
        let guard = self.inner.lock().ok()?;
        let inner = guard.as_ref()?;
        let row: Option<(u32, u16, String)> = inner
            .conn
            .query_row(
                "SELECT depth, multipv, lines FROM evals
                 WHERE position = ?1 AND engine = ?2 AND multipv >= ?3
                 ORDER BY depth DESC, multipv ASC LIMIT 1",
                params![position, engine, min_multipv],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()
            .unwrap_or_else(|e| {
                warn!("Evaluation cache lookup failed: {e}");
                None
            });
        let (depth, multipv, lines) = row?;
        let mut lines: Vec<StoredLine> = serde_json::from_str(&lines).ok()?;
        lines.sort_by_key(|l| l.multipv);
        lines.truncate(min_multipv as usize);
        if lines.is_empty() {
            return None;
        }
        Some(CachedEval {
            engine: engine.to_string(),
            depth,
            multipv,
            lines,
        })
    }

    /// Stores a result unless an equally deep or deeper one already exists
    /// for the same engine and number of lines.
    pub fn store(&self, position: &str, engine: &str, lines: &[StoredLine]) {
        if lines.is_empty() {
            return;
        }
        let Ok(guard) = self.inner.lock() else {
            return;
        };
        let Some(inner) = guard.as_ref() else {
            return;
        };
        let depth = lines.iter().map(|l| l.depth).min().unwrap_or(0);
        if depth == 0 {
            return;
        }
        let capped;
        let (lines, depth) = match self.limit() {
            StoreLimit::MaxDepth(max) if depth > max && !is_mate(lines) => {
                capped = lines
                    .iter()
                    .map(|l| StoredLine {
                        depth: l.depth.min(max),
                        ..l.clone()
                    })
                    .collect::<Vec<_>>();
                (capped.as_slice(), max)
            }
            _ => (lines, depth),
        };
        let multipv = lines.len() as u16;
        let nodes = lines.iter().map(|l| l.nodes).max().unwrap_or(0);
        let Ok(json) = serde_json::to_string(lines) else {
            return;
        };
        let res = inner.conn.execute(
            "INSERT INTO evals (position, engine, multipv, depth, nodes, lines, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT (position, engine, multipv) DO UPDATE SET
                 depth = excluded.depth,
                 nodes = excluded.nodes,
                 lines = excluded.lines,
                 updated_at = excluded.updated_at
             WHERE excluded.depth > evals.depth
                OR (excluded.depth = evals.depth AND excluded.nodes > evals.nodes)",
            params![position, engine, multipv, depth, nodes, json, now_secs()],
        );
        if let Err(e) = res {
            warn!("Evaluation cache write failed: {e}");
        }
    }

    /// All stored results for a position (every engine, deepest per engine).
    pub fn lookup_all(&self, position: &str) -> Vec<CachedEval> {
        let Ok(guard) = self.inner.lock() else {
            return vec![];
        };
        let Some(inner) = guard.as_ref() else {
            return vec![];
        };
        let Ok(mut stmt) = inner.conn.prepare(
            "SELECT engine, depth, multipv, lines FROM evals
             WHERE position = ?1 ORDER BY engine, depth DESC, multipv DESC",
        ) else {
            return vec![];
        };
        let rows = stmt.query_map(params![position], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, u32>(1)?,
                r.get::<_, u16>(2)?,
                r.get::<_, String>(3)?,
            ))
        });
        let Ok(rows) = rows else {
            return vec![];
        };
        let mut out: Vec<CachedEval> = Vec::new();
        for (engine, depth, multipv, lines) in rows.flatten() {
            if out.iter().any(|e| e.engine == engine) {
                continue;
            }
            if let Ok(mut lines) = serde_json::from_str::<Vec<StoredLine>>(&lines) {
                lines.sort_by_key(|l| l.multipv);
                out.push(CachedEval {
                    engine,
                    depth,
                    multipv,
                    lines,
                });
            }
        }
        out
    }

    pub fn stats(&self) -> Result<EvalCacheStats, Error> {
        let guard = self.inner.lock().map_err(|_| Error::EvalCacheUnavailable)?;
        let inner = guard.as_ref().ok_or(Error::EvalCacheUnavailable)?;
        let conn = &inner.conn;
        let positions: u32 =
            conn.query_row("SELECT COUNT(DISTINCT position) FROM evals", [], |r| {
                r.get(0)
            })?;
        let entries: u32 = conn.query_row("SELECT COUNT(*) FROM evals", [], |r| r.get(0))?;
        let mut stmt = conn.prepare(
            // Mates carry an artificial depth (245 for Stockfish), so the
            // deepest real search is taken from the other entries.
            "SELECT engine, COUNT(*),
                    COALESCE(MAX(CASE WHEN lines NOT LIKE '%\"mate\":%' THEN depth END), 0)
             FROM evals GROUP BY engine ORDER BY COUNT(*) DESC",
        )?;
        let engines = stmt
            .query_map([], |r| {
                Ok(EngineCacheStats {
                    engine: r.get(0)?,
                    entries: r.get(1)?,
                    max_depth: r.get(2)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let size_bytes = [inner.path.clone(), inner.path.with_extension("sqlite3-wal")]
            .iter()
            .filter_map(|p| std::fs::metadata(p).ok())
            .map(|m| m.len() as f64)
            .sum();
        Ok(EvalCacheStats {
            path: inner.path.display().to_string(),
            positions,
            entries,
            size_bytes,
            engines,
        })
    }

    pub fn clear(&self) -> Result<(), Error> {
        let guard = self.inner.lock().map_err(|_| Error::EvalCacheUnavailable)?;
        let inner = guard.as_ref().ok_or(Error::EvalCacheUnavailable)?;
        inner.conn.execute_batch("DELETE FROM evals; VACUUM;")?;
        Ok(())
    }
}

/// True when any line is a proven mate.
fn is_mate(lines: &[StoredLine]) -> bool {
    lines.iter().any(|l| l.mate.is_some())
}

#[tauri::command]
#[specta::specta]
pub async fn get_eval_cache_stats(
    state: tauri::State<'_, AppState>,
) -> Result<EvalCacheStats, Error> {
    state.eval_cache.stats()
}

#[tauri::command]
#[specta::specta]
pub async fn clear_eval_cache(state: tauri::State<'_, AppState>) -> Result<(), Error> {
    state.eval_cache.clear()
}

/// Every stored evaluation of the position given by `fen`, one per engine.
#[tauri::command]
#[specta::specta]
pub async fn get_cached_evals(
    fen: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<CachedEvalJs>, Error> {
    let pos = crate::engine::parse_fen_to_position(&fen)?;
    let key = position_key(&pos);
    Ok(state
        .eval_cache
        .lookup_all(&key)
        .into_iter()
        .filter_map(|e| {
            let first = e.lines.first()?;
            Some(CachedEvalJs {
                engine: e.engine.clone(),
                depth: e.depth,
                multipv: e.multipv,
                score: first.score(),
                uci_moves: first.uci.clone(),
            })
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use shakmaty::{uci::UciMove, Chess};

    fn line(multipv: u16, depth: u32, cp: i32, mv: &str) -> StoredLine {
        StoredLine {
            multipv,
            depth,
            nodes: depth * 1000,
            nps: 1,
            cp: Some(cp),
            mate: None,
            wdl: None,
            uci: vec![mv.to_string()],
        }
    }

    #[test]
    fn key_ignores_move_counters_and_unusable_en_passant() {
        let mut pos = Chess::default();
        let mv = UciMove::from_ascii(b"e2e4").unwrap().to_move(&pos).unwrap();
        pos.play_unchecked(mv);
        // No black pawn can capture on e3, so the ep square is dropped.
        assert_eq!(
            position_key(&pos),
            "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -"
        );
    }

    #[test]
    fn transpositions_share_a_key() {
        let play = |moves: &[&str]| {
            let mut pos = Chess::default();
            for m in moves {
                let mv = UciMove::from_ascii(m.as_bytes())
                    .unwrap()
                    .to_move(&pos)
                    .unwrap();
                pos.play_unchecked(mv);
            }
            position_key(&pos)
        };
        assert_eq!(
            play(&["g1f3", "d7d5", "d2d4"]),
            play(&["d2d4", "d7d5", "g1f3"])
        );
    }

    #[test]
    fn keeps_deepest_result() {
        let cache = EvalCache::open_in_memory();
        let k = "pos";
        cache.store(k, "SF", &[line(1, 20, 30, "e2e4")]);
        cache.store(k, "SF", &[line(1, 15, 99, "d2d4")]);
        let got = cache.lookup(k, "SF", 1).unwrap();
        assert_eq!(got.depth, 20);
        assert_eq!(got.lines[0].cp, Some(30));

        cache.store(k, "SF", &[line(1, 25, 40, "c2c4")]);
        assert_eq!(cache.lookup(k, "SF", 1).unwrap().depth, 25);
    }

    #[test]
    fn multipv_and_engines_are_separate() {
        let cache = EvalCache::open_in_memory();
        let k = "pos";
        cache.store(k, "SF", &[line(1, 30, 30, "e2e4")]);
        cache.store(k, "SF", &[line(1, 18, 30, "e2e4"), line(2, 18, 10, "d2d4")]);
        cache.store(k, "Patricia", &[line(1, 12, 80, "f2f4")]);

        // Single line request: deepest single or multi line result.
        assert_eq!(cache.lookup(k, "SF", 1).unwrap().depth, 30);
        // Two lines requested: only the MultiPV 2 entry qualifies.
        let two = cache.lookup(k, "SF", 2).unwrap();
        assert_eq!(two.depth, 18);
        assert_eq!(two.lines.len(), 2);
        assert!(cache.lookup(k, "SF", 3).is_none());

        assert_eq!(
            cache.lookup(k, "Patricia", 1).unwrap().lines[0].cp,
            Some(80)
        );
        assert_eq!(cache.lookup_all(k).len(), 2);
        let stats = cache.stats().unwrap();
        assert_eq!(stats.positions, 1);
        assert_eq!(stats.entries, 3);
        cache.clear().unwrap();
        assert!(cache.lookup(k, "SF", 1).is_none());
    }

    fn mate_line(depth: u32, mate: i32) -> StoredLine {
        StoredLine {
            cp: None,
            mate: Some(mate),
            ..line(1, depth, 0, "d8f8")
        }
    }

    #[test]
    fn user_limit_caps_depth_but_keeps_result() {
        let cache = EvalCache::open_in_memory();
        cache.set_limit(StoreLimit::MaxDepth(USER_MAX_STORE_DEPTH));
        cache.store("pos", "SF", &[line(1, 40, 25, "e2e4")]);
        let got = cache.lookup("pos", "SF", 1).unwrap();
        assert_eq!(got.depth, 28);
        assert_eq!(got.lines[0].depth, 28);
        assert_eq!(got.lines[0].cp, Some(25));

        // Shallower than the limit: stored unchanged.
        cache.store("other", "SF", &[line(1, 20, 5, "d2d4")]);
        assert_eq!(cache.lookup("other", "SF", 1).unwrap().depth, 20);
    }

    #[test]
    fn mates_are_never_capped() {
        let cache = EvalCache::open_in_memory();
        cache.set_limit(StoreLimit::MaxDepth(USER_MAX_STORE_DEPTH));
        cache.store("pos", "SF", &[mate_line(245, 2)]);
        assert_eq!(cache.lookup("pos", "SF", 1).unwrap().depth, 245);
    }

    #[test]
    fn unlimited_by_default() {
        let cache = EvalCache::open_in_memory();
        assert_eq!(cache.limit(), StoreLimit::Unlimited);
        cache.store("pos", "SF", &[line(1, 47, 25, "e2e4")]);
        assert_eq!(cache.lookup("pos", "SF", 1).unwrap().depth, 47);
    }

    #[test]
    fn stats_ignore_mate_depth() {
        let cache = EvalCache::open_in_memory();
        cache.store("a", "SF", &[line(1, 42, 25, "e2e4")]);
        cache.store("b", "SF", &[mate_line(245, 3)]);
        cache.store("c", "Patricia", &[mate_line(127, 1)]);
        let stats = cache.stats().unwrap();
        let sf = stats.engines.iter().find(|e| e.engine == "SF").unwrap();
        assert_eq!(sf.max_depth, 42);
        assert_eq!(sf.entries, 2);
        let pat = stats
            .engines
            .iter()
            .find(|e| e.engine == "Patricia")
            .unwrap();
        assert_eq!(pat.max_depth, 0);
    }

    #[test]
    fn wal_is_truncated_on_open() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(CACHE_FILE_NAME);
        {
            let cache = EvalCache::default();
            cache.open(path.clone());
            for i in 0..2000 {
                cache.store(&format!("pos{i}"), "SF", &[line(1, 20, i, "e2e4")]);
            }
        }
        let cache = EvalCache::default();
        cache.open(path.clone());
        let wal = std::fs::metadata(path.with_extension("sqlite3-wal"))
            .map(|m| m.len())
            .unwrap_or(0);
        assert!(wal <= WAL_SIZE_LIMIT_BYTES as u64, "wal is {wal} bytes");
        assert_eq!(cache.stats().unwrap().entries, 2000);
    }

    #[test]
    fn score_roundtrip() {
        let s = Score {
            value: ScoreValue::Mate(-3),
            wdl: Some((0, 10, 990)),
            lower_bound: None,
            upper_bound: None,
        };
        let l = StoredLine::from_score(1, 20, 5, 5, &s, vec![]);
        assert_eq!(l.score(), s);
    }
}
