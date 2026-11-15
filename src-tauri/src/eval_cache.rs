//! Persistent evaluation cache ("Positionsspeicher").
//!
//! Every position an engine evaluates is stored in a local SQLite database
//! together with the engine, the search depth and the principal variations.
//! When the same position is analysed again (live analysis, game report,
//! tactic search, Insight) the stored result is used right away and, if it is
//! deep enough, the engine does not need to search at all.
//!
//! How results are filed:
//!
//! - **Position:** a 128-bit Zobrist hash of piece placement, side to move,
//!   castling rights and (only when a capture is possible) the en passant
//!   square. Move counters are left out, so transpositions share one entry.
//! - **Engine:** the name the engine reports (`id name`), plus every option
//!   that changes its play (for example a reduced `Skill Level`). Threads,
//!   Hash, MultiPV and similar options do not count.
//! - **Number of lines (MultiPV):** a 3-line result can serve a request for
//!   1, 2 or 3 lines, not one for 5. A result that is beaten by another one
//!   with more lines and at least the same depth is deleted.
//!
//! Only deeper results replace stored ones, very shallow results are not
//! stored, and positions whose evaluation depends on the move history
//! (repetitions, a high 50-move counter) are neither read nor stored.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU32, Ordering},
        Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};

use log::{info, warn};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use shakmaty::{
    fen::Fen, uci::UciMove, zobrist::Zobrist128, CastlingMode, Chess, EnPassantMode, Position,
    Role, Square,
};
use specta::Type;
use vampirc_uci::{
    parse_one,
    uci::{Score, ScoreValue},
    UciMessage, UciOptionConfig,
};

use crate::{
    engine::{EngineLog, EngineOption},
    error::Error,
    AppState,
};

pub const CACHE_FILE_NAME: &str = "eval_cache.sqlite3";

/// Results shallower than this are not stored (mates always are). They come
/// from clicking through positions and cost the engine a fraction of a second.
pub const MIN_STORE_DEPTH: u32 = 10;

/// Above this 50-move counter engines start to pull evaluations towards a
/// draw, so the result no longer belongs to the position alone.
pub const MAX_CLEAN_HALFMOVES: u32 = 30;

/// Normalised key of a position: a 128-bit Zobrist hash of piece placement,
/// side to move, castling rights and (only when a capture is actually
/// possible) the en passant square. Move counters are left out on purpose.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default)]
pub struct PosKey(pub [u8; 16]);

impl std::fmt::Display for PosKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        for b in self.0 {
            write!(f, "{b:02x}")?;
        }
        Ok(())
    }
}

pub fn position_key(pos: &Chess) -> PosKey {
    let Zobrist128(hash) = pos.zobrist_hash::<Zobrist128>(EnPassantMode::Legal);
    PosKey(hash.to_be_bytes())
}

/// True when a stored result for the last position of `history` would mean
/// the same as for any other way to reach it. `history` holds the positions
/// since the last capture or pawn move (or since the start of the known
/// moves), the analysed position last. A position that already occurred
/// twice lets the engine see a draw by repetition that is not there on
/// other move orders.
pub fn is_clean_history(history: &[PosKey], halfmoves: u32) -> bool {
    if halfmoves > MAX_CLEAN_HALFMOVES {
        return false;
    }
    let mut sorted = history.to_vec();
    sorted.sort_unstable();
    sorted.windows(2).all(|w| w[0] != w[1])
}

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
    /// Nodes the engine searched for this result.
    pub nodes: u32,
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
    /// Since the app started: positions looked up.
    pub session_lookups: u32,
    /// Since the app started: lookups that found a stored result.
    pub session_hits: u32,
    /// Since the app started: engine searches the stored results made unnecessary.
    pub session_saved: u32,
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

/// How deep results may be stored. Admins store without limit; normal users
/// store up to a fixed depth. Proven mates are always stored as they are,
/// because engines report them with an artificial depth (Stockfish uses its
/// maximum of 245) and they are the most certain results.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum StoreLimit {
    #[default]
    Unlimited,
    MaxDepth(u32),
}

/// Depth limit for normal user accounts.
pub const USER_MAX_STORE_DEPTH: u32 = 28;

/// Upper bound for the write-ahead log after a checkpoint. Without it the
/// `-wal` file keeps its largest size (about 4 MB) forever.
const WAL_SIZE_LIMIT_BYTES: i64 = 1024 * 1024;

const SCHEMA_VERSION: &str = "2";

#[derive(Default)]
pub struct EvalCache {
    inner: Mutex<Option<CacheInner>>,
    limit: Mutex<StoreLimit>,
    /// Results deeper than the store limit, kept only while the app runs.
    temp: Mutex<HashMap<TempKey, CachedEval>>,
    lookups: AtomicU32,
    hits: AtomicU32,
    saved: AtomicU32,
}

/// (position, engine, multipv)
type TempKey = (PosKey, String, u16);

/// Upper bound for the in-memory results; the map is emptied when reached.
const TEMP_MAX_ENTRIES: usize = 20_000;

struct CacheInner {
    conn: Connection,
    path: PathBuf,
    /// Engine name -> id in the `engines` table.
    engines: HashMap<String, i64>,
}

impl CacheInner {
    fn engine_id(&mut self, name: &str, create: bool) -> Option<i64> {
        if let Some(id) = self.engines.get(name) {
            return Some(*id);
        }
        let found: Option<i64> = self
            .conn
            .query_row(
                "SELECT id FROM engines WHERE name = ?1",
                params![name],
                |r| r.get(0),
            )
            .optional()
            .ok()?;
        let id = match found {
            Some(id) => id,
            None if create => {
                self.conn
                    .execute("INSERT INTO engines (name) VALUES (?1)", params![name])
                    .ok()?;
                self.conn.last_insert_rowid()
            }
            None => return None,
        };
        self.engines.insert(name.to_string(), id);
        Some(id)
    }
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
         CREATE TABLE IF NOT EXISTS engines (
             id   INTEGER PRIMARY KEY,
             name TEXT    NOT NULL UNIQUE
         );
         CREATE TABLE IF NOT EXISTS evals_v2 (
             pos        BLOB    NOT NULL,
             engine     INTEGER NOT NULL,
             multipv    INTEGER NOT NULL,
             depth      INTEGER NOT NULL,
             nodes      INTEGER NOT NULL,
             mate       INTEGER NOT NULL,
             lines      BLOB    NOT NULL,
             updated_at INTEGER NOT NULL,
             PRIMARY KEY (pos, engine, multipv)
         ) WITHOUT ROWID;
         CREATE TABLE IF NOT EXISTS meta (
             key   TEXT PRIMARY KEY,
             value TEXT NOT NULL
         );",
    )?;
    conn.pragma_update(None, "journal_size_limit", WAL_SIZE_LIMIT_BYTES)?;
    check_hash_function(&conn)?;
    let has_v1: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'evals')",
        [],
        |r| r.get(0),
    )?;
    if has_v1 {
        migrate_v1(&conn)?;
    }
    conn.execute(
        "INSERT INTO meta (key, value) VALUES ('schema_version', ?1)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        params![SCHEMA_VERSION],
    )?;
    // Fold what an earlier session left in the log back into the main file.
    if let Err(e) = conn.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(())) {
        warn!("Evaluation cache checkpoint failed: {e}");
    }
    Ok(conn)
}

/// Positions are filed by a hash. Should a library update ever change the
/// hash function, every stored key would point to the wrong position, so the
/// hash of the start position is remembered and checked.
fn check_hash_function(conn: &Connection) -> Result<(), rusqlite::Error> {
    let probe = position_key(&Chess::default()).to_string();
    let stored: Option<String> = conn
        .query_row("SELECT value FROM meta WHERE key = 'hash_probe'", [], |r| {
            r.get(0)
        })
        .optional()?;
    if stored.as_deref() != Some(probe.as_str()) {
        if stored.is_some() {
            warn!("Evaluation cache: position hash changed, stored results are dropped");
            conn.execute("DELETE FROM evals_v2", [])?;
        }
        conn.execute(
            "INSERT INTO meta (key, value) VALUES ('hash_probe', ?1)
             ON CONFLICT (key) DO UPDATE SET value = excluded.value",
            params![probe],
        )?;
    }
    Ok(())
}

/// Moves the results of the first version (FEN text and JSON lines) into the
/// compact table, drops what is now obsolete and shrinks the file.
fn migrate_v1(conn: &Connection) -> Result<(), rusqlite::Error> {
    info!("Evaluation cache: converting to the compact format");
    let tx = conn.unchecked_transaction()?;
    let mut moved = 0u32;
    {
        let mut engines: HashMap<String, i64> = HashMap::new();
        let mut select = tx.prepare("SELECT position, engine, lines, updated_at FROM evals")?;
        let mut insert = tx.prepare(
            "INSERT INTO evals_v2 (pos, engine, multipv, depth, nodes, mate, lines, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT (pos, engine, multipv) DO UPDATE SET
                 depth = excluded.depth, nodes = excluded.nodes, mate = excluded.mate,
                 lines = excluded.lines, updated_at = excluded.updated_at
             WHERE excluded.depth > evals_v2.depth",
        )?;
        let rows = select.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, i64>(3)?,
            ))
        })?;
        for (position, engine, lines, updated_at) in rows.flatten() {
            let Some(pos) = parse_epd(&position) else {
                continue;
            };
            let Ok(mut lines) = serde_json::from_str::<Vec<StoredLine>>(&lines) else {
                continue;
            };
            lines.sort_by_key(|l| l.multipv);
            let depth = lines.iter().map(|l| l.depth).min().unwrap_or(0);
            let mate = is_mate(&lines);
            if depth == 0 || (depth < MIN_STORE_DEPTH && !mate) {
                continue;
            }
            let Some(blob) = encode_lines(&lines) else {
                continue;
            };
            let engine_id = match engines.get(&engine) {
                Some(id) => *id,
                None => {
                    tx.execute(
                        "INSERT OR IGNORE INTO engines (name) VALUES (?1)",
                        params![engine],
                    )?;
                    let id: i64 = tx.query_row(
                        "SELECT id FROM engines WHERE name = ?1",
                        params![engine],
                        |r| r.get(0),
                    )?;
                    engines.insert(engine.clone(), id);
                    id
                }
            };
            let nodes = lines.iter().map(|l| l.nodes).max().unwrap_or(0);
            insert.execute(params![
                &position_key(&pos).0[..],
                engine_id,
                lines.len() as u16,
                depth,
                nodes,
                mate,
                blob,
                updated_at
            ])?;
            moved += 1;
        }
    }
    let pruned = prune_dominated(&tx)?;
    tx.execute("DROP TABLE evals", [])?;
    tx.commit()?;
    info!("Evaluation cache: converted {moved} results, {pruned} obsolete ones dropped");
    if let Err(e) = conn.execute_batch("VACUUM") {
        warn!("Evaluation cache: shrinking the file failed: {e}");
    }
    Ok(())
}

/// Deletes results beaten by another result of the same engine with more
/// lines and at least the same depth.
fn prune_dominated(conn: &Connection) -> Result<usize, rusqlite::Error> {
    conn.execute(
        "DELETE FROM evals_v2 WHERE EXISTS (
             SELECT 1 FROM evals_v2 AS o
             WHERE o.pos = evals_v2.pos AND o.engine = evals_v2.engine
               AND o.multipv > evals_v2.multipv AND o.depth >= evals_v2.depth)",
        [],
    )
}

/// Position from the 4-field key of the first cache version.
fn parse_epd(epd: &str) -> Option<Chess> {
    let fen: Fen = format!("{epd} 0 1").parse().ok()?;
    let setup = fen.into_setup();
    let mode = CastlingMode::detect(&setup);
    setup.position(mode).ok()
}

// --- Compact encoding of the lines -------------------------------------
//
// Per line: depth, flags (mate / cp / wdl), score, nodes, nps, wdl, then the
// moves with two bytes each (from, to, promotion). Numbers are varints.
// The line number (MultiPV) is the position in the list.

const LINES_FORMAT: u8 = 1;
const FLAG_MATE: u8 = 1;
const FLAG_CP: u8 = 2;
const FLAG_WDL: u8 = 4;

fn put_var(out: &mut Vec<u8>, mut v: u64) {
    loop {
        let b = (v & 0x7f) as u8;
        v >>= 7;
        if v == 0 {
            out.push(b);
            return;
        }
        out.push(b | 0x80);
    }
}

fn get_var(buf: &mut &[u8]) -> Option<u64> {
    let mut v = 0u64;
    let mut shift = 0;
    loop {
        let (&b, rest) = buf.split_first()?;
        *buf = rest;
        v |= ((b & 0x7f) as u64) << shift;
        if b & 0x80 == 0 {
            return Some(v);
        }
        shift += 7;
        if shift > 63 {
            return None;
        }
    }
}

fn put_signed(out: &mut Vec<u8>, v: i32) {
    let v = v as i64;
    put_var(out, ((v << 1) ^ (v >> 63)) as u64);
}

fn get_signed(buf: &mut &[u8]) -> Option<i32> {
    let v = get_var(buf)?;
    i32::try_from(((v >> 1) as i64) ^ -((v & 1) as i64)).ok()
}

fn encode_move(uci: &str) -> Option<u16> {
    match uci.parse::<UciMove>().ok()? {
        UciMove::Normal {
            from,
            to,
            promotion,
        } => {
            let promo = match promotion {
                None => 0,
                Some(Role::Knight) => 1,
                Some(Role::Bishop) => 2,
                Some(Role::Rook) => 3,
                Some(Role::Queen) => 4,
                Some(Role::King) => 5,
                Some(Role::Pawn) => return None,
            };
            Some(u32::from(from) as u16 | (u32::from(to) as u16) << 6 | promo << 12)
        }
        _ => None,
    }
}

fn decode_move(code: u16) -> Option<String> {
    let promotion = match code >> 12 {
        0 => None,
        1 => Some(Role::Knight),
        2 => Some(Role::Bishop),
        3 => Some(Role::Rook),
        4 => Some(Role::Queen),
        5 => Some(Role::King),
        _ => return None,
    };
    Some(
        UciMove::Normal {
            from: Square::new((code & 63) as u32),
            to: Square::new(((code >> 6) & 63) as u32),
            promotion,
        }
        .to_string(),
    )
}

/// Lines in MultiPV order. `None` when a line has no move that can be stored.
fn encode_lines(lines: &[StoredLine]) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(16 + lines.len() * 48);
    out.push(LINES_FORMAT);
    put_var(&mut out, lines.len() as u64);
    for l in lines {
        let moves: Vec<u16> = l.uci.iter().map_while(|m| encode_move(m)).collect();
        if moves.is_empty() {
            return None;
        }
        let mut flags = 0;
        if l.mate.is_some() {
            flags |= FLAG_MATE;
        } else if l.cp.is_some() {
            flags |= FLAG_CP;
        }
        if l.wdl.is_some() {
            flags |= FLAG_WDL;
        }
        put_var(&mut out, l.depth as u64);
        out.push(flags);
        if let Some(m) = l.mate {
            put_signed(&mut out, m);
        } else if let Some(cp) = l.cp {
            put_signed(&mut out, cp);
        }
        put_var(&mut out, l.nodes as u64);
        put_var(&mut out, l.nps as u64);
        if let Some((w, d, lo)) = l.wdl {
            put_signed(&mut out, w);
            put_signed(&mut out, d);
            put_signed(&mut out, lo);
        }
        put_var(&mut out, moves.len() as u64);
        for m in moves {
            out.extend_from_slice(&m.to_le_bytes());
        }
    }
    Some(out)
}

fn decode_lines(mut buf: &[u8]) -> Option<Vec<StoredLine>> {
    let (&format, rest) = buf.split_first()?;
    if format != LINES_FORMAT {
        return None;
    }
    buf = rest;
    let count = get_var(&mut buf)? as usize;
    let mut lines = Vec::with_capacity(count.min(64));
    for i in 0..count {
        let depth = get_var(&mut buf)? as u32;
        let (&flags, rest) = buf.split_first()?;
        buf = rest;
        let (mut cp, mut mate) = (None, None);
        if flags & FLAG_MATE != 0 {
            mate = Some(get_signed(&mut buf)?);
        } else if flags & FLAG_CP != 0 {
            cp = Some(get_signed(&mut buf)?);
        }
        let nodes = get_var(&mut buf)? as u32;
        let nps = get_var(&mut buf)? as u32;
        let wdl = if flags & FLAG_WDL != 0 {
            Some((
                get_signed(&mut buf)?,
                get_signed(&mut buf)?,
                get_signed(&mut buf)?,
            ))
        } else {
            None
        };
        let n = get_var(&mut buf)? as usize;
        let mut uci = Vec::with_capacity(n.min(256));
        for _ in 0..n {
            let (bytes, rest) = buf.split_at_checked(2)?;
            buf = rest;
            uci.push(decode_move(u16::from_le_bytes([bytes[0], bytes[1]]))?);
        }
        lines.push(StoredLine {
            multipv: i as u16 + 1,
            depth,
            nodes,
            nps,
            cp,
            mate,
            wdl,
            uci,
        });
    }
    Some(lines)
}

// --- Engine identity ------------------------------------------------------

/// Options that change how fast or how an engine reports, not what it thinks.
const NEUTRAL_OPTIONS: &[&str] = &[
    "threads",
    "hash",
    "multipv",
    "ponder",
    "uci_chess960",
    "uci_showwdl",
    "uci_analysemode",
    "move overhead",
    "minimum thinking time",
    "slow mover",
    "nodestime",
    "clear hash",
    "debug log file",
    "numapolicy",
    "syzygypath",
    "syzygyprobedepth",
    "syzygyprobelimit",
    "uci_opponent",
    "uci_ratingadv",
];

/// The option defaults an engine announced during `uci`.
pub fn option_defaults(logs: &[EngineLog]) -> Vec<UciOptionConfig> {
    logs.iter()
        .filter_map(|l| match l {
            EngineLog::Engine(line) if line.starts_with("option ") => match parse_one(line) {
                UciMessage::Option(opt) => Some(opt),
                _ => None,
            },
            _ => None,
        })
        .collect()
}

fn same_value(default: &UciOptionConfig, value: &str) -> bool {
    let value = value.trim();
    match default {
        UciOptionConfig::Check { default, .. } => {
            value.parse::<bool>().ok() == Some(default.unwrap_or(false))
        }
        UciOptionConfig::Spin { default, .. } => {
            value.parse::<i64>().ok() == Some(default.unwrap_or(0))
        }
        UciOptionConfig::Combo { default, .. } | UciOptionConfig::String { default, .. } => default
            .as_deref()
            .unwrap_or("")
            .trim()
            .eq_ignore_ascii_case(value),
        UciOptionConfig::Button { .. } => true,
    }
}

/// The name results are filed under: the engine's own name, followed by
/// every option that differs from its default and can change the engine's
/// moves or evaluations, e.g. `Stockfish 17.1 [Skill Level=5]`.
pub fn cache_engine_name(
    name: &str,
    defaults: &[UciOptionConfig],
    options: &[EngineOption],
) -> String {
    let limited = options.iter().any(|o| {
        o.name.eq_ignore_ascii_case("UCI_LimitStrength")
            && o.value.trim().eq_ignore_ascii_case("true")
    });
    let mut changed: Vec<String> = options
        .iter()
        .filter(|o| !NEUTRAL_OPTIONS.contains(&o.name.to_ascii_lowercase().as_str()))
        // The Elo setting only matters while the strength is limited.
        .filter(|o| limited || !o.name.eq_ignore_ascii_case("UCI_Elo"))
        .filter(|o| {
            defaults
                .iter()
                .find(|d| d.get_name().eq_ignore_ascii_case(&o.name))
                .is_some_and(|d| !same_value(d, &o.value))
        })
        .map(|o| format!("{}={}", o.name, o.value.trim()))
        .collect();
    if changed.is_empty() {
        return name.to_string();
    }
    changed.sort();
    changed.dedup();
    format!("{name} [{}]", changed.join(", "))
}

// --- The cache --------------------------------------------------------------

impl EvalCache {
    /// Opens (or creates) the cache file, converting an older format. Failures
    /// are logged and leave the cache disabled; analysis keeps working.
    pub fn open(&self, path: PathBuf) {
        match open_connection(&path) {
            Ok(conn) => {
                info!("Evaluation cache opened at {}", path.display());
                *self.inner.lock().unwrap() = Some(CacheInner {
                    conn,
                    path,
                    engines: HashMap::new(),
                });
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
            engines: HashMap::new(),
        });
        cache
    }

    /// Sets the store limit. Lifting it (admin) writes the results that
    /// were only held in memory to the file.
    pub fn set_limit(&self, limit: StoreLimit) {
        if let Ok(mut l) = self.limit.lock() {
            *l = limit;
        }
        if limit == StoreLimit::Unlimited {
            let held: Vec<(TempKey, CachedEval)> = self
                .temp
                .lock()
                .map(|mut t| t.drain().collect())
                .unwrap_or_default();
            for ((position, engine, _), eval) in held {
                self.store(&position, &engine, &eval.lines);
            }
        }
    }

    pub fn limit(&self) -> StoreLimit {
        self.limit.lock().map(|l| *l).unwrap_or_default()
    }

    /// Counts an engine search that a stored result made unnecessary.
    pub fn note_saved_search(&self) {
        self.saved.fetch_add(1, Ordering::Relaxed);
    }

    /// Deepest in-memory result for `engine` with at least `min_multipv` lines.
    fn lookup_temp(&self, position: &PosKey, engine: &str, min_multipv: u16) -> Option<CachedEval> {
        let temp = self.temp.lock().ok()?;
        if temp.is_empty() {
            return None;
        }
        temp.iter()
            .filter(|((p, e, m), _)| p == position && e == engine && *m >= min_multipv)
            .map(|(_, v)| v)
            .max_by_key(|v| (v.depth, std::cmp::Reverse(v.multipv)))
            .map(|v| {
                let mut v = v.clone();
                v.lines.truncate(min_multipv as usize);
                v
            })
    }

    fn hold_in_memory(&self, position: &PosKey, engine: &str, lines: &[StoredLine], depth: u32) {
        let Ok(mut temp) = self.temp.lock() else {
            return;
        };
        let multipv = lines.len() as u16;
        let key = (*position, engine.to_string(), multipv);
        if temp.get(&key).is_some_and(|old| old.depth >= depth) {
            return;
        }
        if temp.len() >= TEMP_MAX_ENTRIES {
            temp.clear();
        }
        let mut lines = lines.to_vec();
        lines.sort_by_key(|l| l.multipv);
        temp.insert(
            key,
            CachedEval {
                engine: engine.to_string(),
                depth,
                multipv,
                nodes: lines.iter().map(|l| l.nodes).max().unwrap_or(0),
                lines,
            },
        );
    }

    /// Best stored result for `engine` with at least `min_multipv` lines.
    /// The returned lines are trimmed to `min_multipv`.
    pub fn lookup(&self, position: &PosKey, engine: &str, min_multipv: u16) -> Option<CachedEval> {
        self.lookups.fetch_add(1, Ordering::Relaxed);
        let stored = self.lookup_stored(position, engine, min_multipv);
        let held = self.lookup_temp(position, engine, min_multipv);
        let found = match (stored, held) {
            (Some(s), Some(h)) => Some(if h.depth > s.depth { h } else { s }),
            (s, h) => s.or(h),
        };
        if found.is_some() {
            self.hits.fetch_add(1, Ordering::Relaxed);
        }
        found
    }

    fn lookup_stored(
        &self,
        position: &PosKey,
        engine: &str,
        min_multipv: u16,
    ) -> Option<CachedEval> {
        let mut guard = self.inner.lock().ok()?;
        let inner = guard.as_mut()?;
        let engine_id = inner.engine_id(engine, false)?;
        let row: Option<(u32, u16, u32, Vec<u8>)> = inner
            .conn
            .prepare_cached(
                "SELECT depth, multipv, nodes, lines FROM evals_v2
                 WHERE pos = ?1 AND engine = ?2 AND multipv >= ?3
                 ORDER BY depth DESC, multipv ASC LIMIT 1",
            )
            .and_then(|mut stmt| {
                stmt.query_row(params![&position.0[..], engine_id, min_multipv], |r| {
                    Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
                })
                .optional()
            })
            .unwrap_or_else(|e| {
                warn!("Evaluation cache lookup failed: {e}");
                None
            });
        let (depth, multipv, nodes, blob) = row?;
        let mut lines = decode_lines(&blob)?;
        lines.truncate(min_multipv as usize);
        if lines.is_empty() {
            return None;
        }
        Some(CachedEval {
            engine: engine.to_string(),
            depth,
            multipv,
            nodes,
            lines,
        })
    }

    /// Stores a result unless an equally deep or deeper one already exists
    /// for the same engine with as many or more lines. Results it beats
    /// (fewer lines, not deeper) are deleted.
    pub fn store(&self, position: &PosKey, engine: &str, lines: &[StoredLine]) {
        if lines.is_empty() {
            return;
        }
        let depth = lines.iter().map(|l| l.depth).min().unwrap_or(0);
        let mate = is_mate(lines);
        if depth == 0 || (depth < MIN_STORE_DEPTH && !mate) {
            return;
        }
        let mut lines = lines.to_vec();
        lines.sort_by_key(|l| l.multipv);
        let depth = match self.limit() {
            StoreLimit::MaxDepth(max) if depth > max && !mate => {
                // The full result is used for the rest of this session; the
                // file only gets it as a depth-`max` result.
                self.hold_in_memory(position, engine, &lines, depth);
                for l in &mut lines {
                    l.depth = l.depth.min(max);
                }
                max
            }
            _ => depth,
        };
        let Some(blob) = encode_lines(&lines) else {
            return;
        };
        let multipv = lines.len() as u16;
        let nodes = lines.iter().map(|l| l.nodes).max().unwrap_or(0);

        let Ok(mut guard) = self.inner.lock() else {
            return;
        };
        let Some(inner) = guard.as_mut() else {
            return;
        };
        let Some(engine_id) = inner.engine_id(engine, true) else {
            return;
        };
        let res = (|| -> Result<(), rusqlite::Error> {
            let tx = inner.conn.unchecked_transaction()?;
            let pos = &position.0[..];
            let beaten: bool = tx
                .prepare_cached(
                    "SELECT EXISTS(SELECT 1 FROM evals_v2
                 WHERE pos = ?1 AND engine = ?2 AND multipv > ?3 AND depth >= ?4)",
                )?
                .query_row(params![pos, engine_id, multipv, depth], |r| r.get(0))?;
            if beaten {
                return Ok(());
            }
            let changed = tx
                .prepare_cached(
                    "INSERT INTO evals_v2
                         (pos, engine, multipv, depth, nodes, mate, lines, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                     ON CONFLICT (pos, engine, multipv) DO UPDATE SET
                         depth = excluded.depth,
                         nodes = excluded.nodes,
                         mate = excluded.mate,
                         lines = excluded.lines,
                         updated_at = excluded.updated_at
                     WHERE excluded.depth > evals_v2.depth
                        OR (excluded.depth = evals_v2.depth AND excluded.nodes > evals_v2.nodes)",
                )?
                .execute(params![
                    pos,
                    engine_id,
                    multipv,
                    depth,
                    nodes,
                    mate,
                    blob,
                    now_secs()
                ])?;
            if changed > 0 {
                tx.prepare_cached(
                    "DELETE FROM evals_v2
                     WHERE pos = ?1 AND engine = ?2 AND multipv < ?3 AND depth <= ?4",
                )?
                .execute(params![pos, engine_id, multipv, depth])?;
            }
            tx.commit()
        })();
        if let Err(e) = res {
            warn!("Evaluation cache write failed: {e}");
        }
    }

    /// All stored results for a position (every engine, deepest per engine).
    pub fn lookup_all(&self, position: &PosKey) -> Vec<CachedEval> {
        let mut out: Vec<CachedEval> = Vec::new();
        if let Ok(temp) = self.temp.lock() {
            let mut held: Vec<&CachedEval> = temp
                .iter()
                .filter(|((p, _, _), _)| p == position)
                .map(|(_, v)| v)
                .collect();
            held.sort_by(|a, b| b.depth.cmp(&a.depth).then(b.multipv.cmp(&a.multipv)));
            for v in held {
                if !out.iter().any(|e| e.engine == v.engine) {
                    out.push(v.clone());
                }
            }
        }
        let Ok(guard) = self.inner.lock() else {
            return out;
        };
        let Some(inner) = guard.as_ref() else {
            return out;
        };
        let Ok(mut stmt) = inner.conn.prepare(
            "SELECT e.name, v.depth, v.multipv, v.nodes, v.lines
             FROM evals_v2 v JOIN engines e ON e.id = v.engine
             WHERE v.pos = ?1 ORDER BY e.name, v.depth DESC, v.multipv DESC",
        ) else {
            return out;
        };
        let rows = stmt.query_map(params![&position.0[..]], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, u32>(1)?,
                r.get::<_, u16>(2)?,
                r.get::<_, u32>(3)?,
                r.get::<_, Vec<u8>>(4)?,
            ))
        });
        let Ok(rows) = rows else {
            return out;
        };
        for (engine, depth, multipv, nodes, blob) in rows.flatten() {
            if out.iter().any(|e| e.engine == engine) {
                continue;
            }
            if let Some(lines) = decode_lines(&blob) {
                out.push(CachedEval {
                    engine,
                    depth,
                    multipv,
                    nodes,
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
            conn.query_row("SELECT COUNT(DISTINCT pos) FROM evals_v2", [], |r| r.get(0))?;
        let entries: u32 = conn.query_row("SELECT COUNT(*) FROM evals_v2", [], |r| r.get(0))?;
        let mut stmt = conn.prepare(
            // Mates carry an artificial depth (245 for Stockfish), so the
            // deepest real search is taken from the other entries.
            "SELECT e.name, COUNT(*), COALESCE(MAX(CASE WHEN v.mate = 0 THEN v.depth END), 0)
             FROM evals_v2 v JOIN engines e ON e.id = v.engine
             GROUP BY v.engine ORDER BY COUNT(*) DESC",
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
            session_lookups: self.lookups.load(Ordering::Relaxed),
            session_hits: self.hits.load(Ordering::Relaxed),
            session_saved: self.saved.load(Ordering::Relaxed),
        })
    }

    pub fn clear(&self) -> Result<(), Error> {
        let mut guard = self.inner.lock().map_err(|_| Error::EvalCacheUnavailable)?;
        let inner = guard.as_mut().ok_or(Error::EvalCacheUnavailable)?;
        inner
            .conn
            .execute_batch("DELETE FROM evals_v2; DELETE FROM engines; VACUUM;")?;
        inner.engines.clear();
        if let Ok(mut temp) = self.temp.lock() {
            temp.clear();
        }
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

/// Normal user accounts keep results deeper than [`USER_MAX_STORE_DEPTH`]
/// only in memory; admins and the app without an account store everything.
#[tauri::command]
#[specta::specta]
pub async fn set_eval_cache_user_limit(
    limited: bool,
    state: tauri::State<'_, AppState>,
) -> Result<(), Error> {
    state.eval_cache.set_limit(if limited {
        StoreLimit::MaxDepth(USER_MAX_STORE_DEPTH)
    } else {
        StoreLimit::Unlimited
    });
    Ok(())
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
    use shakmaty::uci::UciMove;

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

    fn key(n: u8) -> PosKey {
        PosKey([n; 16])
    }

    fn play(moves: &[&str]) -> Chess {
        let mut pos = Chess::default();
        for m in moves {
            let mv = UciMove::from_ascii(m.as_bytes())
                .unwrap()
                .to_move(&pos)
                .unwrap();
            pos.play_unchecked(mv);
        }
        pos
    }

    #[test]
    fn key_ignores_move_counters_and_unusable_en_passant() {
        let pos = play(&["e2e4"]);
        // No black pawn can capture on e3, so the ep square does not count.
        let same = parse_epd("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -").unwrap();
        assert_eq!(position_key(&pos), position_key(&same));
        let later: Chess =
            Fen::from_ascii(b"rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 7 40")
                .unwrap()
                .into_position(CastlingMode::Standard)
                .unwrap();
        assert_eq!(position_key(&pos), position_key(&later));
    }

    #[test]
    fn castling_rights_and_side_to_move_count() {
        let a = parse_epd("r3k2r/8/8/8/8/8/8/R3K2R w KQkq -").unwrap();
        let b = parse_epd("r3k2r/8/8/8/8/8/8/R3K2R w Kkq -").unwrap();
        let c = parse_epd("r3k2r/8/8/8/8/8/8/R3K2R b KQkq -").unwrap();
        assert_ne!(position_key(&a), position_key(&b));
        assert_ne!(position_key(&a), position_key(&c));
    }

    #[test]
    fn transpositions_share_a_key() {
        assert_eq!(
            position_key(&play(&["g1f3", "d7d5", "d2d4"])),
            position_key(&play(&["d2d4", "d7d5", "g1f3"]))
        );
    }

    #[test]
    fn lines_roundtrip_compactly() {
        let lines = vec![
            StoredLine {
                multipv: 1,
                depth: 31,
                nodes: 123_456_789,
                nps: 9_000_000,
                cp: Some(-35),
                mate: None,
                wdl: Some((120, 700, 180)),
                uci: ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5"]
                    .map(String::from)
                    .to_vec(),
            },
            StoredLine {
                multipv: 2,
                depth: 31,
                nodes: 123_456_789,
                nps: 9_000_000,
                cp: None,
                mate: Some(-4),
                wdl: None,
                uci: ["a7a8q", "e1g1", "h2h1n"].map(String::from).to_vec(),
            },
        ];
        let blob = encode_lines(&lines).unwrap();
        assert_eq!(decode_lines(&blob).unwrap(), lines);
        let json = serde_json::to_string(&lines).unwrap();
        assert!(
            blob.len() * 3 < json.len(),
            "{} vs {}",
            blob.len(),
            json.len()
        );
    }

    #[test]
    fn keeps_deepest_result() {
        let cache = EvalCache::open_in_memory();
        let k = key(1);
        cache.store(&k, "SF", &[line(1, 20, 30, "e2e4")]);
        cache.store(&k, "SF", &[line(1, 15, 99, "d2d4")]);
        let got = cache.lookup(&k, "SF", 1).unwrap();
        assert_eq!(got.depth, 20);
        assert_eq!(got.lines[0].cp, Some(30));
        assert_eq!(got.nodes, 20_000);

        cache.store(&k, "SF", &[line(1, 25, 40, "c2c4")]);
        assert_eq!(cache.lookup(&k, "SF", 1).unwrap().depth, 25);
    }

    #[test]
    fn shallow_results_are_not_stored_but_mates_are() {
        let cache = EvalCache::open_in_memory();
        cache.store(&key(1), "SF", &[line(1, MIN_STORE_DEPTH - 1, 30, "e2e4")]);
        assert!(cache.lookup(&key(1), "SF", 1).is_none());
        cache.store(&key(2), "SF", &[mate_line(3, 1)]);
        assert!(cache.lookup(&key(2), "SF", 1).is_some());
    }

    #[test]
    fn multipv_and_engines_are_separate() {
        let cache = EvalCache::open_in_memory();
        let k = key(1);
        cache.store(&k, "SF", &[line(1, 30, 30, "e2e4")]);
        cache.store(
            &k,
            "SF",
            &[line(1, 18, 30, "e2e4"), line(2, 18, 10, "d2d4")],
        );
        cache.store(&k, "Patricia", &[line(1, 12, 80, "f2f4")]);

        // Single line request: deepest single or multi line result.
        assert_eq!(cache.lookup(&k, "SF", 1).unwrap().depth, 30);
        // Two lines requested: only the MultiPV 2 entry qualifies.
        let two = cache.lookup(&k, "SF", 2).unwrap();
        assert_eq!(two.depth, 18);
        assert_eq!(two.lines.len(), 2);
        assert!(cache.lookup(&k, "SF", 3).is_none());

        assert_eq!(
            cache.lookup(&k, "Patricia", 1).unwrap().lines[0].cp,
            Some(80)
        );
        assert_eq!(cache.lookup_all(&k).len(), 2);
        let stats = cache.stats().unwrap();
        assert_eq!(stats.positions, 1);
        assert_eq!(stats.entries, 3);
        cache.clear().unwrap();
        assert!(cache.lookup(&k, "SF", 1).is_none());
        // Engines can be filed again after clearing.
        cache.store(&k, "SF", &[line(1, 30, 30, "e2e4")]);
        assert!(cache.lookup(&k, "SF", 1).is_some());
    }

    #[test]
    fn beaten_results_are_dropped() {
        let cache = EvalCache::open_in_memory();
        let k = key(1);
        cache.store(&k, "SF", &[line(1, 20, 30, "e2e4")]);
        // Two lines at the same depth make the single line obsolete.
        cache.store(
            &k,
            "SF",
            &[line(1, 22, 30, "e2e4"), line(2, 22, 10, "d2d4")],
        );
        assert_eq!(cache.stats().unwrap().entries, 1);
        // A shallower single line next to a deeper two-line result is not kept.
        cache.store(&k, "SF", &[line(1, 21, 30, "e2e4")]);
        assert_eq!(cache.stats().unwrap().entries, 1);
        // A deeper single line is.
        cache.store(&k, "SF", &[line(1, 35, 30, "e2e4")]);
        assert_eq!(cache.stats().unwrap().entries, 2);
        assert_eq!(cache.lookup(&k, "SF", 1).unwrap().depth, 35);
        assert_eq!(cache.lookup(&k, "SF", 2).unwrap().depth, 22);
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
        cache.store(&key(1), "SF", &[line(1, 40, 25, "e2e4")]);
        let got = cache.lookup_stored(&key(1), "SF", 1).unwrap();
        assert_eq!(got.depth, 28);
        assert_eq!(got.lines[0].depth, 28);
        assert_eq!(got.lines[0].cp, Some(25));

        // Shallower than the limit: stored unchanged.
        cache.store(&key(2), "SF", &[line(1, 20, 5, "d2d4")]);
        assert_eq!(cache.lookup(&key(2), "SF", 1).unwrap().depth, 20);
    }

    #[test]
    fn deeper_result_stays_in_memory_for_the_session() {
        let cache = EvalCache::open_in_memory();
        cache.set_limit(StoreLimit::MaxDepth(USER_MAX_STORE_DEPTH));
        cache.store(&key(1), "SF", &[line(1, 40, 25, "e2e4")]);
        // This session sees the full depth, the file only 28.
        assert_eq!(cache.lookup(&key(1), "SF", 1).unwrap().depth, 40);
        assert_eq!(cache.lookup_stored(&key(1), "SF", 1).unwrap().depth, 28);
        assert_eq!(cache.lookup_all(&key(1))[0].depth, 40);

        // Admin signs in: the held result is written in full.
        cache.set_limit(StoreLimit::Unlimited);
        assert_eq!(cache.lookup_stored(&key(1), "SF", 1).unwrap().depth, 40);
        assert!(cache.temp.lock().unwrap().is_empty());
    }

    #[test]
    fn mates_are_never_capped() {
        let cache = EvalCache::open_in_memory();
        cache.set_limit(StoreLimit::MaxDepth(USER_MAX_STORE_DEPTH));
        cache.store(&key(1), "SF", &[mate_line(245, 2)]);
        assert_eq!(cache.lookup(&key(1), "SF", 1).unwrap().depth, 245);
    }

    #[test]
    fn unlimited_by_default() {
        let cache = EvalCache::open_in_memory();
        assert_eq!(cache.limit(), StoreLimit::Unlimited);
        cache.store(&key(1), "SF", &[line(1, 47, 25, "e2e4")]);
        assert_eq!(cache.lookup(&key(1), "SF", 1).unwrap().depth, 47);
    }

    #[test]
    fn stats_ignore_mate_depth_and_count_the_session() {
        let cache = EvalCache::open_in_memory();
        cache.store(&key(1), "SF", &[line(1, 42, 25, "e2e4")]);
        cache.store(&key(2), "SF", &[mate_line(245, 3)]);
        cache.store(&key(3), "Patricia", &[mate_line(127, 1)]);
        cache.lookup(&key(1), "SF", 1);
        cache.lookup(&key(9), "SF", 1);
        cache.note_saved_search();
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
        assert_eq!(
            (
                stats.session_lookups,
                stats.session_hits,
                stats.session_saved
            ),
            (2, 1, 1)
        );
    }

    #[test]
    fn wal_is_truncated_on_open() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(CACHE_FILE_NAME);
        {
            let cache = EvalCache::default();
            cache.open(path.clone());
            for i in 0..2000u32 {
                let mut k = [0u8; 16];
                k[..4].copy_from_slice(&i.to_be_bytes());
                cache.store(&PosKey(k), "SF", &[line(1, 20, i as i32, "e2e4")]);
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
    fn first_version_is_converted() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(CACHE_FILE_NAME);
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(
                "CREATE TABLE evals (
                     position TEXT NOT NULL, engine TEXT NOT NULL, multipv INTEGER NOT NULL,
                     depth INTEGER NOT NULL, nodes INTEGER NOT NULL, lines TEXT NOT NULL,
                     updated_at INTEGER NOT NULL, PRIMARY KEY (position, engine, multipv)
                 ) WITHOUT ROWID;
                 CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                 INSERT INTO meta VALUES ('schema_version', '1');",
            )
            .unwrap();
            let start = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -";
            let rows = [
                (start, "SF", vec![line(1, 30, 20, "e2e4")]),
                (
                    start,
                    "SF",
                    vec![line(1, 24, 20, "e2e4"), line(2, 24, 15, "d2d4")],
                ),
                // Beaten by the two-line result of the same engine.
                (start, "Other", vec![line(1, 20, 20, "e2e4")]),
                (
                    start,
                    "Other",
                    vec![line(1, 22, 20, "e2e4"), line(2, 22, 15, "d2d4")],
                ),
                // Too shallow to keep.
                (start, "Patricia", vec![line(1, 8, 50, "f2f4")]),
                ("not a position", "SF", vec![line(1, 30, 0, "e2e4")]),
            ];
            for (pos, engine, lines) in rows {
                conn.execute(
                    "INSERT INTO evals VALUES (?1, ?2, ?3, ?4, 0, ?5, 0)",
                    params![
                        pos,
                        engine,
                        lines.len() as u16,
                        lines[0].depth,
                        serde_json::to_string(&lines).unwrap()
                    ],
                )
                .unwrap();
            }
        }
        let cache = EvalCache::default();
        cache.open(path);
        let k = position_key(&Chess::default());
        assert_eq!(cache.lookup(&k, "SF", 1).unwrap().depth, 30);
        let two = cache.lookup(&k, "SF", 2).unwrap();
        assert_eq!(two.depth, 24);
        assert_eq!(two.lines[1].uci, vec!["d2d4".to_string()]);
        assert!(cache.lookup(&k, "Patricia", 1).is_none());
        assert_eq!(cache.lookup(&k, "Other", 1).unwrap().depth, 22);
        assert_eq!(cache.stats().unwrap().entries, 3);
        let guard = cache.inner.lock().unwrap();
        let conn = &guard.as_ref().unwrap().conn;
        let v1_left: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name = 'evals')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(!v1_left);
    }

    #[test]
    fn engine_name_includes_options_that_change_play() {
        let defaults = option_defaults(&[
            EngineLog::Engine("option name Threads type spin default 1 min 1 max 1024".into()),
            EngineLog::Engine("option name Skill Level type spin default 20 min 0 max 20".into()),
            EngineLog::Engine("option name UCI_LimitStrength type check default false".into()),
            EngineLog::Engine(
                "option name UCI_Elo type spin default 1320 min 1320 max 3190".into(),
            ),
            EngineLog::Engine("option name MultiPV type spin default 1 min 1 max 256".into()),
        ]);
        assert_eq!(defaults.len(), 5);
        let opt = |n: &str, v: &str| EngineOption {
            name: n.into(),
            value: v.into(),
        };
        // Defaults, neutral options and an Elo that is not in use: plain name.
        let plain = [
            opt("Threads", "10"),
            opt("MultiPV", "3"),
            opt("Skill Level", "20"),
            opt("UCI_LimitStrength", "false"),
            opt("UCI_Elo", "2000"),
            opt("Unknown", "1"),
        ];
        assert_eq!(cache_engine_name("SF 17", &defaults, &plain), "SF 17");
        let weak = [
            opt("Skill Level", "5"),
            opt("UCI_LimitStrength", "true"),
            opt("UCI_Elo", "2000"),
        ];
        assert_eq!(
            cache_engine_name("SF 17", &defaults, &weak),
            "SF 17 [Skill Level=5, UCI_Elo=2000, UCI_LimitStrength=true]"
        );
    }

    #[test]
    fn history_with_repetitions_is_not_clean() {
        let (a, b) = (key(1), key(2));
        assert!(is_clean_history(&[a, b], 4));
        assert!(!is_clean_history(&[a, b, a], 4));
        assert!(!is_clean_history(&[a], MAX_CLEAN_HALFMOVES + 1));
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
