use std::{
    fmt::Display,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

use derivative::Derivative;
use governor::{Quota, RateLimiter};
use log::{info, warn};
use nonzero_ext::*;
use serde::{Deserialize, Serialize};
use shakmaty::{
    fen::Fen, san::SanPlus, uci::UciMove, ByColor, CastlingMode, Chess, Color, EnPassantMode,
    Position, Role,
};
use specta::Type;
use tauri::Emitter;
use tauri_specta::Event;
use tokio::sync::Mutex;
use vampirc_uci::{
    parse_one,
    uci::{Score, ScoreValue},
    UciInfoAttribute, UciMessage, UciOptionConfig,
};

use crate::{
    db::{is_position_in_db, GameQuery, PositionQueryJs},
    engine::{
        parse_fen_and_apply_moves, BaseEngine, EngineLog, EngineOption, EngineReader, GoMode,
    },
    error::Error,
    eval_cache::{
        cache_engine_name, is_clean_history, option_defaults, position_key, CachedEval, EvalCache,
        PosKey, StoredLine,
    },
    progress::update_progress,
    AppState,
};

/// Longest an engine may take to answer `isready` or to end a stopped search
/// before it counts as hung and is restarted on the next request (#98).
const ENGINE_STALL: Duration = Duration::from_secs(3);
/// Patricia 5.1 loses a `stop` that it reads within about half a millisecond
/// of the `go` before it, and then hangs (#98).
const MIN_GO_TO_STOP: Duration = Duration::from_millis(5);

pub struct EngineProcess {
    base: BaseEngine,
    last_depth: u32,
    best_moves: Vec<BestMoves>,
    last_best_moves: Vec<BestMoves>,
    last_progress: f32,
    options: EngineOptions,
    go_mode: GoMode,
    running: bool,
    /// The engine has a search going whose `bestmove` has not been read yet.
    searching: bool,
    /// `bestmove`s still owed by searches that were stopped. Until they have
    /// arrived, the engine's output belongs to an old position and is ignored.
    stale_searches: u32,
    /// A search to start once the engine has answered every `isready` sent.
    /// The `go` is held back until the engine is idle: Patricia loses a `stop`
    /// that it reads together with a `go` it has not started yet (#98).
    pending_go: Option<GoMode>,
    /// `isready`s sent whose `readyok` has not been read yet.
    pending_ready: u32,
    /// Since when the engine owes a `readyok` or a `bestmove` (time of the
    /// last answer while it still owes one); `None` when it owes nothing.
    waiting_since: Option<Instant>,
    /// A result of the current search has been shown already.
    emitted_since_go: bool,
    /// The app ended the process (`kill`); otherwise it exited by itself.
    killed: bool,
    real_multipv: u16,
    start: Instant,
    /// Engine name as reported by `id name`.
    engine_name: String,
    /// Option defaults the engine announced, to tell which options are changed.
    option_defaults: Vec<UciOptionConfig>,
    /// Name results are filed under in the cache (engine name plus options
    /// that change its play).
    cache_engine: String,
    /// Cache key of the position being analysed; `None` when its evaluation
    /// depends on the move history and must not be shared.
    position_key: Option<PosKey>,
}

impl EngineProcess {
    async fn new(path: PathBuf) -> Result<(Self, EngineReader), Error> {
        let mut base = BaseEngine::spawn(path.clone()).await?;
        match tokio::time::timeout(UCI_HANDSHAKE_TIMEOUT, base.init_uci()).await {
            Ok(result) => result?,
            Err(_) => {
                base.kill_sync();
                return Err(Error::NotUciEngine);
            }
        }
        let reader = base.take_reader().ok_or(Error::EngineDisconnected)?;
        let logs = base.get_logs();
        let option_defaults = option_defaults(&logs);
        let engine_name = engine_name_from_logs(&logs).unwrap_or_else(|| {
            path.file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| path.display().to_string())
        });

        Ok((
            Self {
                base,
                last_depth: 0,
                best_moves: Vec::new(),
                last_best_moves: Vec::new(),
                last_progress: 0.0,
                options: EngineOptions::default(),
                real_multipv: 0,
                go_mode: GoMode::Infinite,
                running: false,
                searching: false,
                stale_searches: 0,
                pending_go: None,
                pending_ready: 0,
                waiting_since: None,
                emitted_since_go: false,
                killed: false,
                start: Instant::now(),
                cache_engine: engine_name.clone(),
                engine_name,
                option_defaults,
                position_key: None,
            },
            reader,
        ))
    }

    async fn set_option<T>(&mut self, name: &str, value: T) -> Result<(), Error>
    where
        T: Display,
    {
        self.base.set_option(name, value).await
    }

    async fn set_options(&mut self, options: EngineOptions) -> Result<(), Error> {
        let fen_changed = options.fen != self.options.fen;
        let fen: Fen = options.fen.parse()?;
        let setup = fen.as_setup();
        let castling_mode = CastlingMode::detect(setup);
        let pos = parse_fen_and_apply_moves(&options.fen, &options.moves)?;

        if fen_changed {
            if castling_mode.is_chess960() {
                self.set_option("UCI_Chess960", "true").await?;
            } else {
                self.set_option("UCI_Chess960", "false").await?;
            }
        }

        let multipv = options
            .extra_options
            .iter()
            .find(|x| x.name == "MultiPV")
            .map(|x| x.value.parse().unwrap_or(1))
            .unwrap_or(1);

        self.real_multipv = multipv.min(pos.legal_moves().len() as u16);
        self.position_key = clean_position_key(&options.fen, &options.moves);
        self.cache_engine = cache_engine_name(
            &self.engine_name,
            &self.option_defaults,
            &options.extra_options,
        );

        for option in &options.extra_options {
            if !self.options.extra_options.contains(option) && option.name != "UCI_Chess960" {
                self.set_option(&option.name, &option.value).await?;
            }
        }

        if fen_changed || options.moves != self.options.moves {
            self.set_position(&options.fen, &options.moves).await?;
        }
        self.last_depth = 0;
        self.options = options.clone();
        self.best_moves.clear();
        self.last_best_moves.clear();
        Ok(())
    }

    async fn set_position(&mut self, fen: &str, moves: &[String]) -> Result<(), Error> {
        self.base.set_position(fen, moves).await?;
        self.options.fen = fen.to_string();
        self.options.moves = moves.to_owned();
        Ok(())
    }

    async fn go(&mut self, mode: &GoMode) -> Result<(), Error> {
        self.go_mode = mode.clone();
        self.base.go(mode).await?;
        self.running = true;
        self.searching = true;
        self.emitted_since_go = false;
        self.start = Instant::now();
        Ok(())
    }

    /// Starts a search once the engine is idle: sends `isready` and sends the
    /// `go` when its `readyok` arrives (see `on_ready`). Until then the engine
    /// may still be busy with options (a large hash takes over a second) or
    /// with ending a stopped search.
    async fn request_go(&mut self, mode: &GoMode) -> Result<(), Error> {
        self.go_mode = mode.clone();
        self.pending_go = Some(mode.clone());
        self.running = true;
        self.emitted_since_go = false;
        self.start_waiting();
        self.pending_ready += 1;
        self.base.send("isready").await
    }

    /// The engine answered an `isready`; when it was the last one, the
    /// requested search starts.
    async fn on_ready(&mut self) -> Result<(), Error> {
        self.pending_ready = self.pending_ready.saturating_sub(1);
        self.answered();
        if self.pending_ready == 0 {
            if let Some(mode) = self.pending_go.take() {
                self.go(&mode).await?;
            }
        }
        Ok(())
    }

    fn owes_answer(&self) -> bool {
        self.pending_ready > 0 || self.stale_searches > 0
    }

    /// Call before the engine starts to owe a `readyok` or a `bestmove`.
    fn start_waiting(&mut self) {
        if !self.owes_answer() {
            self.waiting_since = Some(Instant::now());
        }
    }

    /// Call after the engine sent a `readyok` or a stale `bestmove`.
    fn answered(&mut self) {
        self.waiting_since = self.owes_answer().then(Instant::now);
    }

    /// The engine has owed an answer for too long: it no longer reacts to
    /// commands and has to be restarted.
    fn stalled(&self) -> bool {
        self.waiting_since
            .is_some_and(|since| since.elapsed() >= ENGINE_STALL)
    }

    /// Stops the current search. Its remaining output, up to and including
    /// its `bestmove`, is ignored, so it can never be shown for the next
    /// position. A search that was requested but not started yet is dropped.
    async fn stop(&mut self) -> Result<(), Error> {
        self.running = false;
        self.pending_go = None;
        if self.searching {
            let since_go = self.start.elapsed();
            if since_go < MIN_GO_TO_STOP {
                tokio::time::sleep(MIN_GO_TO_STOP - since_go).await;
            }
            self.searching = false;
            self.start_waiting();
            self.stale_searches += 1;
            self.base.stop().await?;
        }
        Ok(())
    }

    /// Ends the engine process for good: asks it to quit and then terminates
    /// it, so an engine that does not react to `quit` (Patricia waits for its
    /// search threads) cannot keep running in the background.
    async fn kill(&mut self) {
        let polite = async {
            let _ = self.base.stop().await;
            let _ = self.base.quit().await;
        };
        let _ = tokio::time::timeout(std::time::Duration::from_millis(200), polite).await;
        self.running = false;
        self.searching = false;
        self.pending_go = None;
        self.killed = true;
        self.base.kill_sync();
    }

    /// Why the engine exited by itself: its last `info string` (Stockfish:
    /// "CRITICAL ERROR: ... Unsupported position ..."), else its last line.
    fn exit_reason(&self) -> String {
        let lines: Vec<String> = self
            .base
            .get_logs()
            .into_iter()
            .filter_map(|l| match l {
                EngineLog::Engine(line) => Some(line),
                _ => None,
            })
            .collect();
        lines
            .iter()
            .rev()
            .find_map(|l| l.strip_prefix("info string ").map(str::to_string))
            .or_else(|| lines.last().cloned())
            .unwrap_or_default()
    }

    pub fn kill_sync(&mut self) {
        self.base.kill_sync();
    }

    fn cache_lookup(&self, cache: &EvalCache) -> Option<CachedEval> {
        let key = self.position_key.as_ref()?;
        if self.real_multipv == 0 {
            return None;
        }
        cache.lookup(key, &self.cache_engine, self.real_multipv)
    }

    fn cache_store(&self, cache: &EvalCache, lines: &[BestMoves]) {
        let Some(key) = self.position_key.as_ref() else {
            return;
        };
        if lines.len() != self.real_multipv as usize {
            return;
        }
        cache.store(key, &self.cache_engine, &to_stored(lines));
    }

    /// Shows a stored evaluation for the current position right away.
    ///
    /// Returns `true` when the stored result already satisfies the requested
    /// search (fixed depth reached), in which case the engine is not started.
    /// Otherwise the engine still runs, but its output is only shown once it
    /// is at least as deep as the stored result.
    fn serve_from_cache(
        &mut self,
        go_mode: &GoMode,
        cache: &EvalCache,
        app: &tauri::AppHandle,
        engine_id: &str,
        tab: &str,
    ) -> Result<bool, Error> {
        let Some(cached) = self.cache_lookup(cache) else {
            return Ok(false);
        };
        let Some(lines) = from_cached(&cached, &self.options.fen, &self.options.moves) else {
            return Ok(false);
        };
        let satisfied = matches!(go_mode, GoMode::Depth(d) if cached.depth >= *d);
        let progress = if satisfied {
            100.0
        } else {
            match go_mode {
                GoMode::Depth(d) => (cached.depth as f64 / *d as f64) * 100.0,
                GoMode::Infinite | GoMode::PlayersTime(_) => 99.99,
                GoMode::Time(_) | GoMode::Nodes(_) => 0.0,
            }
        };
        info!(
            "Evaluation cache hit: {} depth {}",
            self.cache_engine, cached.depth
        );
        BestMovesPayload {
            best_lines: lines.clone(),
            engine: engine_id.to_string(),
            tab: tab.to_string(),
            fen: self.options.fen.clone(),
            moves: self.options.moves.clone(),
            progress,
        }
        .emit(app)?;
        self.last_best_moves = lines;
        self.last_depth = cached.depth;
        self.last_progress = progress as f32;
        if satisfied {
            self.go_mode = go_mode.clone();
            self.running = false;
            cache.note_saved_search();
        }
        Ok(satisfied)
    }
}

/// Cache key of the position after `moves`, or `None` when the move history
/// changes its evaluation (a repeated position or a high 50-move counter).
pub(crate) fn clean_position_key(fen: &str, moves: &[String]) -> Option<PosKey> {
    let mut pos = parse_fen_and_apply_moves(fen, &[]).ok()?;
    let mut history = vec![position_key(&pos)];
    for m in moves {
        let mv = UciMove::from_ascii(m.as_bytes()).ok()?.to_move(&pos).ok()?;
        pos.play_unchecked(mv);
        if pos.halfmoves() == 0 {
            history.clear();
        }
        history.push(position_key(&pos));
    }
    is_clean_history(&history, pos.halfmoves()).then(|| *history.last().unwrap())
}

fn engine_name_from_logs(logs: &[EngineLog]) -> Option<String> {
    logs.iter().find_map(|l| match l {
        EngineLog::Engine(line) => line
            .strip_prefix("id name ")
            .map(|n| n.trim().to_string())
            .filter(|n| !n.is_empty()),
        EngineLog::Gui(_) => None,
    })
}

fn to_stored(lines: &[BestMoves]) -> Vec<StoredLine> {
    lines
        .iter()
        .map(|l| {
            StoredLine::from_score(
                l.multipv,
                l.depth,
                l.nodes,
                l.nps,
                &l.score,
                l.uci_moves.clone(),
            )
        })
        .collect()
}

/// Rebuilds `BestMoves` (including SAN) from a stored evaluation.
fn from_cached(cached: &CachedEval, fen: &str, moves: &[String]) -> Option<Vec<BestMoves>> {
    let root = parse_fen_and_apply_moves(fen, moves).ok()?;
    cached
        .lines
        .iter()
        .map(|l| {
            let mut pos = root.clone();
            let mut san_moves = Vec::with_capacity(l.uci.len());
            for m in &l.uci {
                let uci: UciMove = m.parse().ok()?;
                let mv = uci.to_move(&pos).ok()?;
                san_moves.push(SanPlus::from_move_and_play_unchecked(&mut pos, mv).to_string());
            }
            if san_moves.is_empty() {
                return None;
            }
            Some(BestMoves {
                nodes: l.nodes,
                depth: l.depth,
                score: l.score(),
                uci_moves: l.uci.clone(),
                san_moves,
                multipv: l.multipv,
                nps: l.nps,
            })
        })
        .collect()
}

#[derive(Clone, Serialize, Debug, Derivative, Type)]
#[derivative(Default)]
pub struct BestMoves {
    nodes: u32,
    depth: u32,
    score: Score,
    #[serde(rename = "uciMoves")]
    uci_moves: Vec<String>,
    #[serde(rename = "sanMoves")]
    san_moves: Vec<String>,
    #[derivative(Default(value = "1"))]
    multipv: u16,
    nps: u32,
}

#[derive(Serialize, Debug, Clone, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct BestMovesPayload {
    pub best_lines: Vec<BestMoves>,
    pub engine: String,
    pub tab: String,
    pub fen: String,
    pub moves: Vec<String>,
    pub progress: f64,
}

fn invert_score(score: Score) -> Score {
    let new_value = match score.value {
        ScoreValue::Cp(x) => ScoreValue::Cp(-x),
        ScoreValue::Mate(x) => ScoreValue::Mate(-x),
    };
    let new_wdl = score.wdl.map(|(w, d, l)| (l, d, w));
    Score {
        value: new_value,
        wdl: new_wdl,
        ..score
    }
}

fn parse_uci_attrs(
    attrs: Vec<UciInfoAttribute>,
    fen: &Fen,
    moves: &[String],
) -> Result<BestMoves, Error> {
    let mut best_moves = BestMoves::default();

    let mut pos = parse_fen_and_apply_moves(&fen.to_string(), moves)?;
    let turn = pos.turn();

    for a in attrs {
        match a {
            UciInfoAttribute::Pv(m) => {
                for mv in m {
                    let uci: UciMove = mv.to_string().parse()?;
                    let m = uci.to_move(&pos)?;
                    let san = SanPlus::from_move_and_play_unchecked(&mut pos, m);
                    best_moves.san_moves.push(san.to_string());
                    best_moves.uci_moves.push(uci.to_string());
                }
            }
            UciInfoAttribute::Nps(nps) => {
                best_moves.nps = nps as u32;
            }
            UciInfoAttribute::Nodes(nodes) => {
                best_moves.nodes = nodes as u32;
            }
            UciInfoAttribute::Depth(depth) => {
                best_moves.depth = depth;
            }
            UciInfoAttribute::MultiPv(multipv) => {
                best_moves.multipv = multipv;
            }
            UciInfoAttribute::Score(score) => {
                best_moves.score = score;
            }
            _ => (),
        }
    }

    if best_moves.san_moves.is_empty() {
        return Err(Error::NoMovesFound);
    }

    if turn == Color::Black {
        best_moves.score = invert_score(best_moves.score);
    }

    Ok(best_moves)
}

#[derive(Deserialize, Debug, Clone, Type, Derivative, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
#[derivative(Default)]
pub struct EngineOptions {
    pub fen: String,
    pub moves: Vec<String>,
    pub extra_options: Vec<EngineOption>,
}

type EngineKey = (String, String);
type SharedEngine = Arc<Mutex<EngineProcess>>;

/// The analysis engine registered for `key`. The map guard is released right
/// away, so it is never held across an `await`.
fn registered_engine(state: &AppState, key: &EngineKey) -> Option<SharedEngine> {
    state.engine_processes.get(key).map(|p| p.value().clone())
}

/// Forgets `process` if it is still the engine registered for `key` (a newer
/// one may have replaced it in the meantime).
fn unregister_engine(state: &AppState, key: &EngineKey, process: &SharedEngine) {
    state
        .engine_processes
        .remove_if(key, |_, registered| Arc::ptr_eq(registered, process));
}

async fn kill_registered(state: &AppState, key: &EngineKey) {
    if let Some(process) = registered_engine(state, key) {
        process.lock().await.kill().await;
        unregister_engine(state, key, &process);
    }
}

#[tauri::command]
#[specta::specta]
pub async fn kill_engines(tab: String, state: tauri::State<'_, AppState>) -> Result<(), Error> {
    let keys: Vec<_> = state
        .engine_processes
        .iter()
        .map(|x| x.key().clone())
        .filter(|key| key.0.starts_with(&tab))
        .collect();
    for key in keys {
        kill_registered(&state, &key).await;
    }
    state
        .engine_start_locks
        .retain(|key, _| !key.0.starts_with(&tab));
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn kill_engine(
    engine: String,
    tab: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), Error> {
    let key = (tab, engine);
    // Wait for a start that is under way, so it cannot outlive the kill.
    let start_lock = engine_start_lock(&state, &key);
    let _start = start_lock.lock().await;
    kill_registered(&state, &key).await;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn stop_engine(
    engine: String,
    tab: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), Error> {
    let key = (tab, engine);
    // Wait for a start that is under way, so the new engine is stopped too.
    let start_lock = engine_start_lock(&state, &key);
    let _start = start_lock.lock().await;
    if let Some(process) = registered_engine(&state, &key) {
        process.lock().await.stop().await?;
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn get_engine_logs(
    engine: String,
    tab: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<EngineLog>, Error> {
    let key = (tab, engine);
    if let Some(process) = registered_engine(&state, &key) {
        Ok(process.lock().await.base.get_logs())
    } else {
        Ok(Vec::new())
    }
}

fn engine_start_lock(state: &AppState, key: &EngineKey) -> Arc<Mutex<()>> {
    state
        .engine_start_locks
        .entry(key.clone())
        .or_default()
        .value()
        .clone()
}

/// A position an analysis engine exited on by itself (#103).
#[derive(Clone, Debug)]
pub struct EngineExit {
    fen: String,
    moves: Vec<String>,
    reason: String,
}

/// Sent when an analysis engine exited without the app ending it.
#[derive(Clone, Serialize)]
struct EngineExitedPayload {
    engine: String,
    tab: String,
    reason: String,
}

const ENGINE_EXITED_EVENT: &str = "engine_exited";

/// Moves a running engine to a new position. Returns the result to show right
/// away when the engine is already analysing exactly this.
async fn reuse_engine(
    process: &SharedEngine,
    id: &str,
    tab: &str,
    go_mode: &GoMode,
    options: &EngineOptions,
    app: &tauri::AppHandle,
    state: &AppState,
) -> Result<Option<(f32, Vec<BestMoves>)>, Error> {
    let mut process = process.lock().await;
    if process.stalled() {
        // E.g. Patricia after losing a `stop` (#98): it neither answers nor
        // stops, but keeps all its threads busy.
        return Err(Error::EngineNotResponding);
    }
    if *options == process.options && *go_mode == process.go_mode && process.running {
        return Ok(Some((
            process.last_progress,
            process.last_best_moves.clone(),
        )));
    }
    // UCI commands are handled in order: the engine finishes the old search
    // (whose output is now ignored) before it reads the new position.
    process.stop().await?;
    process.set_options(options.clone()).await?;
    if !process.serve_from_cache(go_mode, &state.eval_cache, app, id, tab)? {
        process.request_go(go_mode).await?;
    }
    Ok(None)
}

#[tauri::command]
#[specta::specta]
pub async fn get_best_moves(
    id: String,
    engine: String,
    tab: String,
    go_mode: GoMode,
    options: EngineOptions,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<Option<(f32, Vec<BestMoves>)>, Error> {
    let path = PathBuf::from(&engine);

    let key = (tab.clone(), id.clone());

    let setup_validation = parse_fen_and_apply_moves(&options.fen, &options.moves);
    if let Err(e) = setup_validation {
        warn!("Invalid position for engine: {:?}", e);
        if let Some(process) = registered_engine(&state, &key) {
            process.lock().await.stop().await?;
        }
        return Ok(None);
    }

    // Held until the engine is registered: a second request that arrives
    // while the engine is still starting waits here and then reuses it,
    // instead of starting another process that would keep running unseen.
    let start_lock = engine_start_lock(&state, &key);
    let start_guard = start_lock.lock().await;

    if let Some(process) = registered_engine(&state, &key) {
        match reuse_engine(&process, &id, &tab, &go_mode, &options, &app, &state).await {
            Ok(result) => return Ok(result),
            Err(e) => {
                // The engine no longer takes commands (crashed or exited):
                // end it and start a fresh one below.
                warn!("Engine {} stopped responding, restarting it: {:?}", id, e);
                process.lock().await.kill().await;
                unregister_engine(&state, &key, &process);
            }
        }
    }

    // The engine exited by itself on this very position before: starting it
    // again would only end the same way.
    if let Some(exit) = state.engine_exits.get(&key).map(|e| e.clone()) {
        if exit.fen == options.fen && exit.moves == options.moves {
            return Err(Error::EngineExited(exit.reason));
        }
        state.engine_exits.remove(&key);
    }

    let (mut process, mut reader) = EngineProcess::new(path).await?;
    process.set_options(options.clone()).await?;
    if !process.serve_from_cache(&go_mode, &state.eval_cache, &app, &id, &tab)? {
        process.request_go(&go_mode).await?;
    }

    let process = Arc::new(Mutex::new(process));
    if let Some(replaced) = state.engine_processes.insert(key.clone(), process.clone()) {
        replaced.lock().await.kill().await;
    }
    drop(start_guard);

    let lim = RateLimiter::direct(Quota::per_second(nonzero!(5u32)));

    loop {
        let line = match reader.next_line().await {
            Ok(Some(line)) => line,
            Ok(None) => break,
            Err(e) => {
                warn!("Failed to read engine output: {:?}", e);
                break;
            }
        };
        let mut proc = process.lock().await;
        proc.base.log_engine(&line);
        if line.trim() == "readyok" {
            if let Err(e) = proc.on_ready().await {
                warn!("Failed to start the engine search: {:?}", e);
            }
            continue;
        }
        let mut emit = |payload: BestMovesPayload| payload.emit(&app).map_err(Error::from);
        if let Err(e) = handle_engine_line(
            &mut proc,
            &line,
            &lim,
            &id,
            &tab,
            &state.eval_cache,
            &mut emit,
        ) {
            warn!("Failed to handle engine output: {}, error: {:?}", line, e);
        }
    }
    info!("Engine process finished: tab: {}, engine: {}", tab, engine);
    let mut proc = process.lock().await;
    let exited_by_itself = !proc.killed;
    let exit = EngineExit {
        fen: proc.options.fen.clone(),
        moves: proc.options.moves.clone(),
        reason: proc.exit_reason(),
    };
    proc.kill().await;
    drop(proc);
    unregister_engine(&state, &key, &process);
    if exited_by_itself {
        warn!("Engine {} exited by itself: {}", id, exit.reason);
        let _ = app.emit(
            ENGINE_EXITED_EVENT,
            EngineExitedPayload {
                engine: id.clone(),
                tab: tab.clone(),
                reason: exit.reason.clone(),
            },
        );
        state.engine_exits.insert(key, exit);
    }
    Ok(None)
}

fn handle_engine_line(
    proc: &mut EngineProcess,
    line: &str,
    lim: &governor::DefaultDirectRateLimiter,
    id: &str,
    tab: &str,
    cache: &EvalCache,
    emit: &mut dyn FnMut(BestMovesPayload) -> Result<(), Error>,
) -> Result<(), Error> {
    match parse_one(line) {
        UciMessage::BestMove { .. } if proc.stale_searches > 0 => {
            // The end of a stopped search; from here on the output is current.
            proc.stale_searches -= 1;
            proc.answered();
        }
        _ if proc.stale_searches > 0 => {}
        UciMessage::Info(attrs) => {
            let best_moves =
                match parse_uci_attrs(attrs, &proc.options.fen.parse()?, &proc.options.moves) {
                    Ok(best_moves) => best_moves,
                    Err(Error::NoMovesFound) => return Ok(()),
                    Err(e) => {
                        warn!("Failed to parse info line: {}, error: {:?}", line, e);
                        return Ok(());
                    }
                };
            if best_moves.score.lower_bound == Some(true)
                || best_moves.score.upper_bound == Some(true)
            {
                return Ok(());
            }
            let multipv = best_moves.multipv;
            let cur_depth = best_moves.depth;
            let cur_nodes = best_moves.nodes;
            if multipv as usize != proc.best_moves.len() + 1 {
                return Ok(());
            }
            proc.best_moves.push(best_moves);
            if multipv != proc.real_multipv {
                return Ok(());
            }
            let complete = proc.best_moves.iter().all(|x| x.depth == cur_depth)
                && cur_depth >= proc.last_depth;
            if complete {
                // Always persist and remember the deepest result, even when the
                // UI update below is rate limited.
                let lines = proc.best_moves.clone();
                proc.cache_store(cache, &lines);
                proc.last_depth = cur_depth;
                proc.last_best_moves = lines;
            }
            // The first result of a search is always shown; later ones are
            // rate limited.
            if complete && (!proc.emitted_since_go || lim.check().is_ok()) {
                let progress = match proc.go_mode {
                    GoMode::Depth(depth) => (cur_depth as f64 / depth as f64) * 100.0,
                    GoMode::Time(time) => {
                        (proc.start.elapsed().as_millis() as f64 / time as f64) * 100.0
                    }
                    GoMode::Nodes(nodes) => (cur_nodes as f64 / nodes as f64) * 100.0,
                    GoMode::PlayersTime(_) => 99.99,
                    GoMode::Infinite => 99.99,
                };
                proc.emitted_since_go = true;
                proc.last_progress = progress as f32;
                proc.best_moves.clear();
                emit(BestMovesPayload {
                    best_lines: proc.last_best_moves.clone(),
                    engine: id.to_string(),
                    tab: tab.to_string(),
                    fen: proc.options.fen.clone(),
                    moves: proc.options.moves.clone(),
                    progress,
                })?;
            } else {
                proc.best_moves.clear();
            }
        }
        UciMessage::BestMove { .. } => {
            proc.searching = false;
            proc.last_progress = 100.0;
            if !proc.last_best_moves.is_empty() {
                emit(BestMovesPayload {
                    best_lines: proc.last_best_moves.clone(),
                    engine: id.to_string(),
                    tab: tab.to_string(),
                    fen: proc.options.fen.clone(),
                    moves: proc.options.moves.clone(),
                    progress: 100.0,
                })?;
            }
        }
        _ => {}
    }
    Ok(())
}

#[derive(Serialize, Debug, Default, Type)]
pub struct MoveAnalysis {
    best: Vec<BestMoves>,
    novelty: bool,
    is_sacrifice: bool,
}

#[derive(Deserialize, Debug, Default, Type)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisOptions {
    pub fen: String,
    pub moves: Vec<String>,
    pub annotate_novelties: bool,
    pub reference_db: Option<PathBuf>,
    pub reversed: bool,
}

#[tauri::command]
#[specta::specta]
pub async fn cancel_analysis(id: String, state: tauri::State<'_, AppState>) -> Result<(), Error> {
    if let Some(flag) = state.analysis_cancel_flags.get(&id) {
        flag.store(true, Ordering::SeqCst);
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn analyze_game(
    id: String,
    engine: String,
    go_mode: GoMode,
    options: AnalysisOptions,
    uci_options: Vec<EngineOption>,
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<Vec<MoveAnalysis>, Error> {
    let cancel_flag = Arc::new(AtomicBool::new(false));
    state
        .analysis_cancel_flags
        .insert(id.clone(), cancel_flag.clone());

    let path = PathBuf::from(&engine);
    let mut analysis: Vec<MoveAnalysis> = Vec::new();

    let (mut proc, mut reader) = EngineProcess::new(path).await?;

    let fen = Fen::from_ascii(options.fen.as_bytes())?;
    let setup = fen.as_setup().clone();
    let castling_mode = CastlingMode::detect(&setup);

    let mut chess: Chess = setup.position(castling_mode)?;
    let mut fens: Vec<(Fen, Vec<String>, bool)> = vec![(fen, vec![], false)];

    options
        .moves
        .iter()
        .enumerate()
        .try_for_each(|(i, m)| -> Result<(), Error> {
            let uci = UciMove::from_ascii(m.as_bytes())?;
            let m = uci.to_move(&chess)?;
            let previous_pos = chess.clone();
            chess.play_unchecked(m);
            let current_pos = chess.clone();
            if !chess.is_game_over() {
                let prev_eval = naive_eval(&previous_pos);
                let cur_eval = -naive_eval(&current_pos);
                fens.push((
                    Fen::from_position(&current_pos, EnPassantMode::Legal),
                    options.moves.clone().into_iter().take(i + 1).collect(),
                    prev_eval > cur_eval + 100,
                ));
            }
            Ok(())
        })?;

    if options.reversed {
        fens.reverse();
    }

    let mut novelty_found = false;
    // Depths the fresh searches of this run reached: what the time or node
    // limit buys, so stored results at least that deep can stand in.
    let mut reached: Vec<u32> = Vec::new();

    for (i, (_, moves, _)) in fens.iter().enumerate() {
        if cancel_flag.load(Ordering::SeqCst) {
            proc.kill().await;
            state.analysis_cancel_flags.remove(&id);
            return Err(Error::AnalysisCancelled);
        }

        update_progress(
            &state.progress_state,
            &app,
            id.clone(),
            (i as f32 / fens.len() as f32) * 100.0,
            false,
        )?;

        let mut extra_options = uci_options.clone();
        if !extra_options.iter().any(|x| x.name == "MultiPV") {
            extra_options.push(EngineOption {
                name: "MultiPV".to_string(),
                value: "2".to_string(),
            });
        } else {
            extra_options.iter_mut().for_each(|x| {
                if x.name == "MultiPV" {
                    x.value = "2".to_string();
                }
            });
        }

        proc.set_options(EngineOptions {
            fen: options.fen.clone(),
            moves: moves.clone(),
            extra_options,
        })
        .await?;

        let mut current_analysis = MoveAnalysis::default();
        let cached = proc.cache_lookup(&state.eval_cache);
        let cached_lines = cached
            .as_ref()
            .and_then(|c| from_cached(c, &proc.options.fen, &proc.options.moves));
        if let (Some(c), Some(lines)) = (&cached, &cached_lines) {
            if cached_is_enough(&go_mode, c, &reached) {
                state.eval_cache.note_saved_search();
                current_analysis.best = lines.clone();
                analysis.push(current_analysis);
                continue;
            }
        }

        proc.go(&go_mode).await?;

        while let Ok(Some(line)) = reader.next_line().await {
            match parse_one(&line) {
                UciMessage::Info(attrs) => {
                    if let Ok(best_moves) =
                        parse_uci_attrs(attrs, &proc.options.fen.parse()?, moves)
                    {
                        let multipv = best_moves.multipv;
                        let cur_depth = best_moves.depth;
                        if multipv as usize == proc.best_moves.len() + 1 {
                            proc.best_moves.push(best_moves);
                            if multipv == proc.real_multipv {
                                if proc.best_moves.iter().all(|x| x.depth == cur_depth)
                                    && cur_depth >= proc.last_depth
                                {
                                    current_analysis.best = proc.best_moves.clone();
                                    proc.last_depth = cur_depth;
                                }
                                assert_eq!(proc.best_moves.len(), proc.real_multipv as usize);
                                proc.best_moves.clear();
                            }
                        }
                    }
                }
                UciMessage::BestMove { .. } => {
                    break;
                }
                _ => {}
            }
        }
        proc.cache_store(&state.eval_cache, &current_analysis.best);
        let engine_depth = current_analysis.best.first().map(|b| b.depth).unwrap_or(0);
        if engine_depth > 0 {
            reached.push(engine_depth);
        }
        if let (Some(c), Some(lines)) = (cached, cached_lines) {
            if c.depth > engine_depth {
                current_analysis.best = lines;
            }
        }
        analysis.push(current_analysis);
    }

    if options.reversed {
        analysis.reverse();
        fens.reverse();
    }

    for (i, analysis) in analysis.iter_mut().enumerate() {
        let fen = &fens[i].0;
        // let query = PositionQuery::exact_from_fen(&fen.to_string())?;
        let query = PositionQueryJs {
            fen: fen.to_string(),
            type_: "exact".to_string(),
        };

        analysis.is_sacrifice = fens[i].2;
        if options.annotate_novelties && !novelty_found {
            if let Some(reference) = options.reference_db.clone() {
                analysis.novelty = !is_position_in_db(
                    reference,
                    GameQuery::new().position(query.clone()).clone(),
                    state.clone(),
                )
                .await?;
                if analysis.novelty {
                    novelty_found = true;
                }
            } else {
                return Err(Error::MissingReferenceDatabase);
            }
        }
    }
    update_progress(&state.progress_state, &app, id.clone(), 100.0, true)?;
    state.analysis_cancel_flags.remove(&id);
    Ok(analysis)
}

/// Whether a stored result can stand in for a search with `go_mode`.
/// `reached` holds the depths the fresh searches of this run got to.
fn cached_is_enough(go_mode: &GoMode, cached: &CachedEval, reached: &[u32]) -> bool {
    let typical_depth =
        (!reached.is_empty()).then(|| reached.iter().sum::<u32>().div_ceil(reached.len() as u32));
    let deep_enough = typical_depth.is_some_and(|d| cached.depth >= d);
    match go_mode {
        GoMode::Depth(d) => cached.depth >= *d,
        GoMode::Nodes(n) => cached.nodes >= *n || deep_enough,
        GoMode::Time(_) => deep_enough,
        GoMode::PlayersTime(_) | GoMode::Infinite => false,
    }
}

pub(crate) fn count_material(position: &Chess) -> i32 {
    if position.is_checkmate() {
        return -10000;
    }
    let material: ByColor<i32> = position.board().material().map(|p| {
        p.pawn as i32 * piece_value(Role::Pawn)
            + p.knight as i32 * piece_value(Role::Knight)
            + p.bishop as i32 * piece_value(Role::Bishop)
            + p.rook as i32 * piece_value(Role::Rook)
            + p.queen as i32 * piece_value(Role::Queen)
    });
    if position.turn() == Color::White {
        material.white - material.black
    } else {
        material.black - material.white
    }
}

fn piece_value(role: Role) -> i32 {
    match role {
        Role::Pawn => 90,
        Role::Knight => 300,
        Role::Bishop => 300,
        Role::Rook => 500,
        Role::Queen => 1000,
        _ => 0,
    }
}

pub(crate) fn qsearch(position: &Chess, mut alpha: i32, beta: i32) -> i32 {
    let stand_pat = count_material(position);

    if stand_pat >= beta {
        return beta;
    }
    if alpha < stand_pat {
        alpha = stand_pat;
    }
    let legal_moves = position.legal_moves();
    let mut captures: Vec<_> = legal_moves.iter().filter(|m| m.is_capture()).collect();

    captures.sort_by(|a, b| {
        let a_value = piece_value(a.capture().unwrap());
        let b_value = piece_value(b.capture().unwrap());
        b_value.cmp(&a_value)
    });

    for capture in captures {
        let mut new_position = position.clone();
        new_position.play_unchecked(*capture);
        let score = -qsearch(&new_position, -beta, -alpha);
        if score >= beta {
            return beta;
        }
        if score > alpha {
            alpha = score;
        }
    }

    alpha
}

fn naive_eval(pos: &Chess) -> i32 {
    pos.legal_moves()
        .iter()
        .map(|mv| {
            let mut new_position = pos.clone();
            new_position.play_unchecked(*mv);
            -qsearch(&new_position, i32::MIN, i32::MAX)
        })
        .max()
        .unwrap_or(i32::MIN)
}

#[cfg(test)]
mod tests {
    use shakmaty::FromSetup;

    use super::*;

    fn pos(fen: &str) -> Chess {
        let fen: Fen = fen.parse().unwrap();
        Chess::from_setup(fen.into_setup(), CastlingMode::Chess960).unwrap()
    }

    fn cached(depth: u32, nodes: u32) -> CachedEval {
        CachedEval {
            engine: "SF".into(),
            depth,
            multipv: 2,
            nodes,
            lines: vec![],
        }
    }

    #[test]
    fn stored_results_stand_in_for_limited_searches() {
        let c = cached(22, 5_000_000);
        assert!(cached_is_enough(&GoMode::Depth(22), &c, &[]));
        assert!(!cached_is_enough(&GoMode::Depth(23), &c, &[]));
        assert!(cached_is_enough(&GoMode::Nodes(5_000_000), &c, &[]));
        assert!(!cached_is_enough(&GoMode::Nodes(6_000_000), &c, &[]));
        // A time limit needs a reference from this run first.
        assert!(!cached_is_enough(&GoMode::Time(500), &c, &[]));
        assert!(cached_is_enough(&GoMode::Time(500), &c, &[20, 23]));
        assert!(!cached_is_enough(&GoMode::Time(500), &c, &[22, 23]));
        assert!(cached_is_enough(&GoMode::Nodes(9_000_000), &c, &[21]));
        assert!(!cached_is_enough(&GoMode::Infinite, &c, &[10]));
    }

    #[test]
    fn repeated_positions_are_not_shared() {
        let start = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
        let moves = |m: &[&str]| m.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let shuffle = ["g1f3", "g8f6", "f3g1", "f6g8"];
        assert!(clean_position_key(start, &moves(&shuffle[..2])).is_some());
        // The start position for the second time: one more repetition draws.
        assert_eq!(clean_position_key(start, &moves(&shuffle)), None);
        // A pawn move resets the history.
        let reset = clean_position_key(
            start,
            &moves(&[&shuffle[..], &["e2e4", "e7e5"], &shuffle[..2]].concat()),
        );
        assert!(reset.is_some());
        let late = "8/8/4k3/8/8/4K3/4P3/8 w - - 31 80";
        assert_eq!(clean_position_key(late, &[]), None);
    }

    #[test]
    fn eval_start_pos() {
        assert_eq!(naive_eval(&Chess::default()), 0);
    }

    #[test]
    fn eval_scandi() {
        let position = pos("rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2");
        assert_eq!(naive_eval(&position), 0);
    }

    #[test]
    fn eval_hanging_pawn() {
        let position = pos("r1bqkbnr/ppp1pppp/2n5/1B1p4/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3");
        assert_eq!(naive_eval(&position), 90);
    }

    #[test]
    fn eval_complex_center() {
        let position = pos("r1bqkbnr/ppp2ppp/2n5/1B1pp3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 4");
        assert_eq!(naive_eval(&position), 90);
    }

    #[test]
    fn eval_in_check() {
        let position = pos("r1bqkbnr/ppp2ppp/2B5/3pp3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 0 4");
        assert_eq!(naive_eval(&position), -90);
    }

    #[test]
    fn eval_rook_stack() {
        let position = pos("rnrq4/8/8/1R6/1R6/1R5K/1Q6/7k w - - 0 1");
        assert_eq!(naive_eval(&position), 10000);
    }

    #[test]
    fn eval_rook_stack2() {
        let position = pos("rnrq4/8/8/1R6/1Q6/1R5K/1R6/7k w - - 0 1");
        assert_eq!(naive_eval(&position), 10000);
    }

    #[test]
    fn eval_opera_game1() {
        let position = pos("4kb1r/p2rqppp/5n2/1B2p1B1/4P3/1Q6/PPP2PPP/2K4R w k - 0 14");
        assert_eq!(naive_eval(&position), -120);
    }

    #[test]
    fn eval_opera_game2() {
        let position = pos("4kb1r/p2rqppp/5n2/1B2p1B1/4P3/1Q6/PPP2PPP/2KR4 b k - 1 14");
        assert_eq!(naive_eval(&position), 20);
    }
}

#[derive(Type, Default, Serialize, Debug)]
pub struct EngineConfig {
    pub name: String,
    pub options: Vec<UciOptionConfig>,
}

#[tauri::command]
#[specta::specta]
pub async fn get_engine_config(path: PathBuf) -> Result<EngineConfig, Error> {
    let mut base = BaseEngine::spawn(path.clone()).await?;

    // A program that already exited cannot take the command.
    if base.send("uci").await.is_err() {
        base.kill_sync();
        return Err(Error::NotUciEngine);
    }

    let mut config = EngineConfig::default();

    // A program that is not a UCI engine may never answer (#95).
    let handshake = async {
        let reader = base.reader_mut().ok_or(Error::EngineDisconnected)?;
        while let Some(line) = reader.next_line().await? {
            match parse_one(&line) {
                UciMessage::Id {
                    name: Some(name), ..
                } => config.name = name,
                UciMessage::Option(opt) => config.options.push(opt),
                UciMessage::UciOk => return Ok(true),
                _ => {}
            }
        }
        Ok::<_, Error>(false)
    };
    let answered = matches!(
        tokio::time::timeout(UCI_HANDSHAKE_TIMEOUT, handshake).await,
        Ok(Ok(true))
    );
    if !answered {
        base.kill_sync();
        return Err(Error::NotUciEngine);
    }
    let _ = base.quit().await;
    Ok(config)
}

/// How long a program may take to answer `uci` with `uciok`.
const UCI_HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);

/// End-to-end check of the evaluation cache with a real UCI engine.
/// Run with: `JBLBASE_TEST_ENGINE=/path/to/stockfish cargo test -- --ignored engine_cache`
#[cfg(test)]
mod engine_cache_tests {
    use super::*;

    async fn search(
        proc: &mut EngineProcess,
        reader: &mut EngineReader,
        fen: &str,
        moves: &[&str],
        depth: u32,
    ) -> Vec<BestMoves> {
        proc.set_options(EngineOptions {
            fen: fen.to_string(),
            moves: moves.iter().map(|m| m.to_string()).collect(),
            extra_options: vec![EngineOption {
                name: "MultiPV".into(),
                value: "2".into(),
            }],
        })
        .await
        .unwrap();
        proc.go(&GoMode::Depth(depth)).await.unwrap();
        let mut best = Vec::new();
        while let Ok(Some(line)) = reader.next_line().await {
            match parse_one(&line) {
                UciMessage::Info(attrs) => {
                    let opts = proc.options.clone();
                    if let Ok(bm) = parse_uci_attrs(attrs, &opts.fen.parse().unwrap(), &opts.moves)
                    {
                        if bm.multipv as usize == proc.best_moves.len() + 1 {
                            proc.best_moves.push(bm);
                            if proc.best_moves.len() == proc.real_multipv as usize {
                                best = std::mem::take(&mut proc.best_moves);
                            }
                        }
                    }
                }
                UciMessage::BestMove { .. } => break,
                _ => {}
            }
        }
        best
    }

    #[tokio::test]
    #[ignore]
    async fn engine_cache_roundtrip_with_real_engine() {
        let Ok(path) = std::env::var("JBLBASE_TEST_ENGINE") else {
            return;
        };
        let cache = EvalCache::open_in_memory();
        let (mut proc, mut reader) = EngineProcess::new(PathBuf::from(path)).await.unwrap();
        assert!(
            proc.engine_name.starts_with("Stockfish"),
            "{}",
            proc.engine_name
        );

        let start = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
        let best = search(&mut proc, &mut reader, start, &["g1f3", "d7d5", "d2d4"], 12).await;
        assert_eq!(best.len(), 2);
        proc.cache_store(&cache, &best);

        // Same position reached by a different move order -> cache hit.
        proc.set_options(EngineOptions {
            fen: start.to_string(),
            moves: vec!["d2d4".into(), "d7d5".into(), "g1f3".into()],
            extra_options: vec![EngineOption {
                name: "MultiPV".into(),
                value: "2".into(),
            }],
        })
        .await
        .unwrap();
        let cached = proc.cache_lookup(&cache).expect("cache hit");
        assert_eq!(cached.depth, 12);
        let restored = from_cached(&cached, start, &proc.options.moves).unwrap();
        assert_eq!(restored.len(), 2);
        assert_eq!(restored[0].san_moves, best[0].san_moves);
        assert_eq!(restored[0].score, best[0].score);

        // A request for more lines than stored is a miss.
        proc.real_multipv = 3;
        assert!(proc.cache_lookup(&cache).is_none());

        // A shallower search does not overwrite the deeper one.
        let shallow = search(&mut proc, &mut reader, start, &["g1f3", "d7d5", "d2d4"], 6).await;
        proc.cache_store(&cache, &shallow);
        assert_eq!(proc.cache_lookup(&cache).unwrap().depth, 12);
        proc.kill().await;
    }
}

#[cfg(all(test, unix))]
mod engine_switch_tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    /// A UCI engine that always "finds" Nf3. On `stop` it still reports a
    /// deeper line before its `bestmove`, like real engines do.
    const FAKE_ENGINE: &str = r#"#!/bin/sh
while read -r cmd rest; do
  case "$cmd" in
    uci) echo "id name FakeEngine"; echo "uciok" ;;
    isready) echo "readyok" ;;
    go) searching=1; echo "info depth 3 multipv 1 score cp 10 nodes 100 nps 100 pv g1f3" ;;
    stop)
      # Like a real engine: only a running search answers with bestmove.
      if [ "$searching" = 1 ]; then
        searching=0
        echo "info depth 21 multipv 1 score cp 99 nodes 100 nps 100 pv g1f3"; echo "bestmove g1f3"
      fi ;;
    quit) exit 0 ;;
  esac
done
"#;

    const START: &str = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

    fn options(moves: &[&str]) -> EngineOptions {
        EngineOptions {
            fen: START.to_string(),
            moves: moves.iter().map(|m| m.to_string()).collect(),
            extra_options: vec![],
        }
    }

    async fn feed(
        proc: &mut EngineProcess,
        reader: &mut EngineReader,
        lines: usize,
        cache: &EvalCache,
        out: &mut Vec<BestMovesPayload>,
    ) {
        let lim = RateLimiter::direct(Quota::per_second(nonzero!(5u32)));
        for _ in 0..lines {
            let line = reader.next_line().await.unwrap().unwrap();
            let mut emit = |p: BestMovesPayload| {
                out.push(p);
                Ok(())
            };
            handle_engine_line(proc, &line, &lim, "fake", "tab", cache, &mut emit).unwrap();
        }
    }

    #[tokio::test]
    async fn output_of_a_stopped_search_is_not_shown_for_the_next_position() {
        let path = std::env::temp_dir().join(format!("jbl-fake-engine-{}", std::process::id()));
        std::fs::write(&path, FAKE_ENGINE).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        let cache = EvalCache::open_in_memory();
        let mut out = Vec::new();

        let (mut proc, mut reader) = EngineProcess::new(path.clone()).await.unwrap();
        proc.set_options(options(&[])).await.unwrap();
        proc.go(&GoMode::Infinite).await.unwrap();
        feed(&mut proc, &mut reader, 1, &cache, &mut out).await;
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].best_lines[0].depth, 3);
        assert!(out[0].moves.is_empty());

        // New position: the old search's late depth-21 line and bestmove
        // (Nf3 is legal in the new position too) must be ignored.
        proc.stop().await.unwrap();
        proc.stop().await.unwrap(); // a second stop owes no bestmove
        assert_eq!(proc.stale_searches, 1);
        proc.set_options(options(&["e2e4", "e7e5"])).await.unwrap();
        proc.go(&GoMode::Infinite).await.unwrap();
        feed(&mut proc, &mut reader, 3, &cache, &mut out).await;
        assert_eq!(proc.stale_searches, 0);
        assert_eq!(out.len(), 2, "only the new search's line is shown");
        assert_eq!(out[1].moves, vec!["e2e4", "e7e5"]);
        assert_eq!(out[1].best_lines[0].depth, 3);
        assert_eq!(out[1].best_lines[0].san_moves, vec!["Nf3"]);

        // Killing ends the process even without waiting for it.
        // `kill` sends "stop" first, so the engine may still answer with its
        // bestmove; after that the output must end.
        proc.kill().await;
        let drained = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            while let Ok(Some(_)) = reader.next_line().await {}
        })
        .await;
        assert!(drained.is_ok(), "engine output did not end after kill");
        let _ = std::fs::remove_file(path);
    }
}

#[cfg(all(test, unix))]
mod engine_stop_tests {
    //! A `stop` must never reach the engine together with a `go` it has not
    //! started yet, and a hung engine must be noticed (#98).
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    const ENGINE: &str = r#"#!/bin/sh
while read -r cmd rest; do
  case "$cmd" in
    uci) echo "id name FakeEngine"; echo "uciok" ;;
    isready) echo "readyok" ;;
    go) echo "info depth 3 multipv 1 score cp 10 nodes 100 nps 100 pv g1f3" ;;
    stop) echo "bestmove g1f3" ;;
    quit) exit 0 ;;
  esac
done
"#;

    const START: &str = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

    async fn engine(name: &str) -> (EngineProcess, EngineReader, PathBuf) {
        let path =
            std::env::temp_dir().join(format!("jbl-stop-engine-{}-{}", name, std::process::id()));
        std::fs::write(&path, ENGINE).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        // Another test may fork while this file is still open for writing,
        // which makes starting it fail with "Text file busy" for a moment.
        let mut attempt = 0;
        let (mut proc, reader) = loop {
            match EngineProcess::new(path.clone()).await {
                Ok(started) => break started,
                Err(Error::Io(e))
                    if e.kind() == std::io::ErrorKind::ExecutableFileBusy && attempt < 50 =>
                {
                    attempt += 1;
                    tokio::time::sleep(Duration::from_millis(20)).await;
                }
                Err(e) => panic!("engine did not start: {e:?}"),
            }
        };
        proc.set_options(EngineOptions {
            fen: START.to_string(),
            moves: vec![],
            extra_options: vec![],
        })
        .await
        .unwrap();
        (proc, reader, path)
    }

    fn sent(proc: &EngineProcess) -> Vec<String> {
        proc.base
            .get_logs()
            .into_iter()
            .filter_map(|l| match l {
                EngineLog::Gui(cmd) => Some(cmd.trim_end().to_string()),
                _ => None,
            })
            .collect()
    }

    async fn next(reader: &mut EngineReader) -> String {
        tokio::time::timeout(Duration::from_secs(5), reader.next_line())
            .await
            .expect("engine answers")
            .unwrap()
            .unwrap()
    }

    #[tokio::test]
    async fn go_waits_for_readyok() {
        let (mut proc, mut reader, path) = engine("ready").await;
        proc.request_go(&GoMode::Infinite).await.unwrap();
        assert!(proc.running);
        assert!(!proc.searching);
        assert_eq!(sent(&proc).last().unwrap(), "isready");

        assert_eq!(next(&mut reader).await, "readyok");
        proc.on_ready().await.unwrap();
        assert!(proc.searching);
        assert!(sent(&proc).last().unwrap().starts_with("go"));
        assert!(!proc.stalled());
        proc.kill().await;
        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn a_move_before_the_engine_is_ready_sends_no_stop() {
        let (mut proc, mut reader, path) = engine("early").await;
        proc.request_go(&GoMode::Infinite).await.unwrap();
        // The next position arrives before the engine answered.
        proc.stop().await.unwrap();
        proc.request_go(&GoMode::Infinite).await.unwrap();
        assert_eq!(proc.stale_searches, 0);
        assert!(!sent(&proc).iter().any(|c| c == "stop"));

        assert_eq!(next(&mut reader).await, "readyok");
        proc.on_ready().await.unwrap();
        assert!(!proc.searching, "waits for the second readyok");
        assert_eq!(next(&mut reader).await, "readyok");
        proc.on_ready().await.unwrap();
        assert!(proc.searching);
        assert_eq!(
            sent(&proc).iter().filter(|c| c.starts_with("go")).count(),
            1
        );
        proc.kill().await;
        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn stop_right_after_go_is_delayed() {
        let (mut proc, _reader, path) = engine("delay").await;
        proc.go(&GoMode::Infinite).await.unwrap();
        proc.stop().await.unwrap();
        assert!(proc.start.elapsed() >= MIN_GO_TO_STOP);
        assert_eq!(proc.stale_searches, 1);
        proc.kill().await;
        let _ = std::fs::remove_file(path);
    }

    #[tokio::test]
    async fn an_engine_that_owes_an_answer_too_long_is_stalled() {
        let (mut proc, _reader, path) = engine("stall").await;
        proc.go(&GoMode::Infinite).await.unwrap();
        proc.stop().await.unwrap();
        assert!(!proc.stalled());
        // Patricia after a lost stop: the bestmove never comes.
        proc.waiting_since = Some(Instant::now() - ENGINE_STALL);
        assert!(proc.stalled());
        // Once it answers, it is fine again.
        proc.stale_searches = 0;
        proc.answered();
        assert!(!proc.stalled());
        proc.kill().await;
        let _ = std::fs::remove_file(path);
    }
}

#[cfg(all(test, unix))]
mod engine_handshake_tests {
    //! A program that is not a UCI engine is rejected instead of hanging (#95).
    use super::*;

    #[tokio::test]
    async fn a_program_that_never_answers_uci_is_rejected() {
        // `cat` echoes "uci" back but never sends "uciok".
        let res = tokio::time::timeout(
            UCI_HANDSHAKE_TIMEOUT + Duration::from_secs(5),
            get_engine_config(PathBuf::from("/bin/cat")),
        )
        .await
        .expect("must not hang");
        assert!(matches!(res, Err(Error::NotUciEngine)));
    }

    #[tokio::test]
    async fn a_program_that_exits_is_rejected() {
        let res = get_engine_config(PathBuf::from("/bin/true")).await;
        assert!(matches!(res, Err(Error::NotUciEngine)));
    }
}

#[cfg(all(test, unix))]
mod engine_exit_tests {
    //! An engine that exits by itself on a position says why (#103).
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    /// Like Stockfish 19 with too many pieces: complains and exits.
    const ENGINE: &str = r#"#!/bin/sh
while read -r cmd rest; do
  case "$cmd" in
    uci) echo "id name FakeEngine"; echo "uciok" ;;
    isready) echo "readyok" ;;
    position)
      echo "info string CRITICAL ERROR: Command \`position $rest\` failed. Reason: Unsupported position. Too many pieces for WHITE."
      exit 1 ;;
  esac
done
"#;

    #[tokio::test]
    async fn the_reason_is_the_last_info_string() {
        let path = std::env::temp_dir().join(format!("jbl-exit-engine-{}", std::process::id()));
        std::fs::write(&path, ENGINE).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        let mut attempt = 0;
        let (mut proc, mut reader) = loop {
            match EngineProcess::new(path.clone()).await {
                Ok(started) => break started,
                Err(Error::Io(e))
                    if e.kind() == std::io::ErrorKind::ExecutableFileBusy && attempt < 50 =>
                {
                    attempt += 1;
                    tokio::time::sleep(Duration::from_millis(20)).await;
                }
                Err(e) => panic!("engine did not start: {e:?}"),
            }
        };
        proc.set_options(EngineOptions {
            fen: "NNNNNNNN/NNNNNNNN/N7/8/8/8/8/K6k w - - 0 1".into(),
            moves: vec![],
            extra_options: vec![],
        })
        .await
        .expect("the app accepts the position");
        while let Ok(Some(line)) = reader.next_line().await {
            proc.base.log_engine(&line);
        }
        assert!(!proc.killed, "it exited by itself");
        assert!(proc
            .exit_reason()
            .starts_with("CRITICAL ERROR: Command `position fen NNNNNNNN"));
        assert!(proc.exit_reason().ends_with("Too many pieces for WHITE."));
        let _ = std::fs::remove_file(path);
    }
}

/// The analysis with a real engine, driven like `get_best_moves` does it:
/// one task reads the engine output, the test changes positions quickly.
/// Run with:
/// `JBLBASE_TEST_ENGINE=/path/to/patricia cargo test -- --ignored real_engine_moves`
/// (`JBLBASE_TEST_HASH` sets the hash in MB, default 1024).
#[cfg(test)]
mod real_engine_moves_tests {
    use super::*;

    const START: &str = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    const LINE: [&str; 8] = [
        "e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "a7a6", "b5a4", "g8f6",
    ];

    struct Harness {
        proc: Arc<Mutex<EngineProcess>>,
        shown: Arc<std::sync::Mutex<Vec<BestMovesPayload>>>,
        hash: String,
    }

    impl Harness {
        async fn start() -> Option<Harness> {
            let path = std::env::var("JBLBASE_TEST_ENGINE").ok()?;
            let hash = std::env::var("JBLBASE_TEST_HASH").unwrap_or_else(|_| "1024".into());
            let (proc, mut reader) = EngineProcess::new(PathBuf::from(path)).await.unwrap();
            let proc = Arc::new(Mutex::new(proc));
            let shown = Arc::new(std::sync::Mutex::new(Vec::new()));
            let (p, s) = (proc.clone(), shown.clone());
            tokio::spawn(async move {
                let lim = RateLimiter::direct(Quota::per_second(nonzero!(5u32)));
                let cache = EvalCache::open_in_memory();
                while let Ok(Some(line)) = reader.next_line().await {
                    let mut proc = p.lock().await;
                    proc.base.log_engine(&line);
                    if line.trim() == "readyok" {
                        proc.on_ready().await.unwrap();
                        continue;
                    }
                    let mut emit = |payload: BestMovesPayload| {
                        s.lock().unwrap().push(payload);
                        Ok(())
                    };
                    let _ = handle_engine_line(&mut proc, &line, &lim, "e", "t", &cache, &mut emit);
                }
            });
            Some(Harness { proc, shown, hash })
        }

        fn options(&self, plies: usize) -> EngineOptions {
            EngineOptions {
                fen: START.into(),
                moves: LINE[..plies].iter().map(|m| m.to_string()).collect(),
                extra_options: vec![
                    EngineOption {
                        name: "Hash".into(),
                        value: self.hash.clone(),
                    },
                    EngineOption {
                        name: "Threads".into(),
                        value: "4".into(),
                    },
                ],
            }
        }

        /// What `reuse_engine` does for a new position (without the cache).
        async fn show(&self, plies: usize) {
            let mut proc = self.proc.lock().await;
            assert!(!proc.stalled(), "engine stalled before ply {plies}");
            proc.stop().await.unwrap();
            proc.set_options(self.options(plies)).await.unwrap();
            if std::env::var("JBLBASE_TEST_OLD_PROTOCOL").is_ok() {
                // 1.0.28: go right away (to compare).
                proc.go(&GoMode::Infinite).await.unwrap();
            } else {
                proc.request_go(&GoMode::Infinite).await.unwrap();
            }
        }

        /// The engine shows lines for `plies` within `secs`, and answers.
        async fn expect_lines_for(&self, plies: usize, secs: u64) {
            let want: Vec<String> = LINE[..plies].iter().map(|m| m.to_string()).collect();
            let deadline = Instant::now() + Duration::from_secs(secs);
            loop {
                if self.shown.lock().unwrap().iter().any(|p| p.moves == want) {
                    break;
                }
                assert!(
                    Instant::now() < deadline,
                    "no lines for ply {plies} after {secs} s (engine hangs?)"
                );
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
            let proc = self.proc.lock().await;
            assert!(!proc.stalled());
        }

        async fn end(self) {
            self.proc.lock().await.kill().await;
        }
    }

    /// #103: Stockfish 19 exits on a position with too many pieces; the
    /// reason the app shows is its last `info string`.
    #[tokio::test(flavor = "multi_thread")]
    #[ignore]
    async fn real_engine_too_many_pieces() {
        let Ok(path) = std::env::var("JBLBASE_TEST_ENGINE") else {
            return;
        };
        let (mut proc, mut reader) = EngineProcess::new(PathBuf::from(path)).await.unwrap();
        proc.set_options(EngineOptions {
            fen: "NNNNNNNN/NNNNNNNN/N7/8/8/8/8/K6k w - - 0 1".into(),
            moves: vec![],
            extra_options: vec![],
        })
        .await
        .unwrap();
        let _ = proc.go(&GoMode::Depth(8)).await;
        let read = tokio::time::timeout(Duration::from_secs(20), async {
            while let Ok(Some(line)) = reader.next_line().await {
                proc.base.log_engine(&line);
                if line.starts_with("bestmove") {
                    return false;
                }
            }
            true
        })
        .await;
        match read {
            Ok(true) => {
                let reason = proc.exit_reason();
                eprintln!("engine exited: {reason}");
                assert!(reason.contains("Too many pieces"), "{reason}");
            }
            Ok(false) => eprintln!("engine analysed the position (no exit)"),
            Err(_) => panic!("engine neither answered nor exited"),
        }
        proc.kill().await;
    }

    #[tokio::test(flavor = "multi_thread")]
    #[ignore]
    async fn real_engine_moves_right_after_start_with_a_big_hash() {
        let Some(h) = Harness::start().await else {
            return;
        };
        // Like the app: options and position, go; then a move 0.2 s later.
        h.show(0).await;
        tokio::time::sleep(Duration::from_millis(200)).await;
        h.show(1).await;
        h.expect_lines_for(1, 15).await;
        h.end().await;
    }

    #[tokio::test(flavor = "multi_thread")]
    #[ignore]
    async fn real_engine_moves_through_a_line_quickly() {
        let Some(h) = Harness::start().await else {
            return;
        };
        h.show(0).await;
        h.expect_lines_for(0, 15).await;
        // Clicking through: stop, position, go back to back, and with gaps
        // of 0 to 3 ms.
        for round in 0..5 {
            for plies in 1..=LINE.len() {
                h.show(plies).await;
                if (plies + round) % 3 != 0 {
                    tokio::time::sleep(Duration::from_micros(((plies * 700) % 3000) as u64)).await;
                }
            }
            h.expect_lines_for(LINE.len(), 15).await;
            h.shown.lock().unwrap().clear();
            h.show(0).await;
            h.expect_lines_for(0, 15).await;
        }
        h.end().await;
    }
}

#[cfg(test)]
mod engine_config_edge_case_tests {
    //! Falsche Datei als Engine (automatischer Testlauf vor 1.1).
    use super::*;
    use std::time::Duration;

    #[tokio::test]
    async fn program_that_exits_is_rejected() {
        let res = tokio::time::timeout(
            Duration::from_secs(5),
            get_engine_config(PathBuf::from("/bin/true")),
        )
        .await
        .expect("must not hang");
        match res {
            Ok(config) => panic!("accepted a non-engine: name={:?}", config.name),
            Err(_) => {}
        }
    }

    #[tokio::test]
    async fn program_that_never_answers_uci_does_not_hang() {
        // #95: `cat` echoes "uci" back but never sends "uciok". The app gives
        // up after UCI_HANDSHAKE_TIMEOUT and reports an error.
        let res = tokio::time::timeout(
            UCI_HANDSHAKE_TIMEOUT + Duration::from_secs(5),
            get_engine_config(PathBuf::from("/bin/cat")),
        )
        .await
        .expect("get_engine_config hangs on a program that is not a UCI engine");
        assert!(res.is_err(), "accepted a program that never answers uci");
    }
}
