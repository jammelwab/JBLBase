//! A small engine driver for batch work (tactic search, later Insight):
//! one position in, the final lines out, with the evaluation cache in between.

use std::{collections::HashMap, path::PathBuf};

use shakmaty::{fen::Fen, uci::UciMove, Chess, Color, EnPassantMode, Move, Position};
use vampirc_uci::{parse_one, uci::ScoreValue, UciInfoAttribute, UciMessage};

use crate::{
    engine::{BaseEngine, EngineLog, EngineOption, GoMode},
    error::Error,
    eval_cache::{
        cache_engine_name, option_defaults, position_key, EvalCache, PosKey, StoredLine,
        MAX_CLEAN_HALFMOVES,
    },
};

/// One line of an evaluation, from the point of view of the side to move.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Line {
    pub cp: Option<i32>,
    /// Mate in this many moves; negative when the side to move gets mated.
    pub mate: Option<i32>,
    pub depth: u32,
    pub pv: Vec<String>,
    pub nodes: u32,
    pub nps: u32,
    /// Win/draw/loss per mille for the side to move, when the engine sends it.
    pub wdl: Option<(i32, i32, i32)>,
}

impl Line {
    /// Winning chances between -1 and 1 (the Lichess formula).
    pub fn win_chances(&self) -> f64 {
        match (self.mate, self.cp) {
            (Some(m), _) => {
                if m > 0 {
                    1.0
                } else {
                    -1.0
                }
            }
            (None, Some(cp)) => win_chances(cp),
            (None, None) => 0.0,
        }
    }

    /// The first move of the line in `pos`.
    pub fn first_move(&self, pos: &Chess) -> Option<Move> {
        let uci: UciMove = self.pv.first()?.parse().ok()?;
        uci.to_move(pos).ok()
    }
}

pub fn win_chances(cp: i32) -> f64 {
    2.0 / (1.0 + (-0.00368208 * cp as f64).exp()) - 1.0
}

pub fn fen_of(pos: &Chess) -> String {
    Fen::from_position(pos, EnPassantMode::Legal).to_string()
}

/// What one search printed: the final lines and the best move at each depth.
struct SearchOutput {
    lines: Vec<Line>,
    /// (depth, first move of the main line), in the order the engine sent them.
    history: Vec<(u32, String)>,
}

pub struct Analyzer {
    engine: BaseEngine,
    name: String,
    /// Name results are filed under in the evaluation cache (engine name plus
    /// options that change its play).
    cache_name: String,
    multipv: u16,
    /// Results of this run, so a position reached twice is only looked up once.
    memo: HashMap<PosKey, Vec<Line>>,
    /// Number of searches the engine really ran (the rest came from the cache).
    pub searches: u32,
}

impl Analyzer {
    pub async fn new(path: PathBuf, options: &[EngineOption]) -> Result<Self, Error> {
        let mut engine = BaseEngine::spawn(path.clone()).await?;
        engine.init_uci().await?;
        let logs = engine.get_logs();
        let name = logs
            .iter()
            .find_map(|l| match l {
                EngineLog::Engine(line) => line
                    .strip_prefix("id name ")
                    .map(|n| n.trim().to_string())
                    .filter(|n| !n.is_empty()),
                EngineLog::Gui(_) => None,
            })
            .unwrap_or_else(|| {
                path.file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_else(|| path.display().to_string())
            });
        for option in options {
            if option.name != "MultiPV" && option.name != "UCI_Chess960" {
                engine.set_option(&option.name, &option.value).await?;
            }
        }
        let cache_name = cache_engine_name(&name, &option_defaults(&logs), options);
        Ok(Self {
            engine,
            name,
            cache_name,
            multipv: 0,
            memo: HashMap::new(),
            searches: 0,
        })
    }

    async fn search(
        &mut self,
        pos: &Chess,
        depth: u32,
        multipv: u16,
    ) -> Result<SearchOutput, Error> {
        if self.multipv != multipv {
            self.engine.set_option("MultiPV", multipv).await?;
            self.multipv = multipv;
        }
        self.engine.set_position(&fen_of(pos), &[]).await?;
        self.engine.go(&GoMode::Depth(depth)).await?;
        self.searches += 1;

        let mut latest: HashMap<u16, Line> = HashMap::new();
        let mut history = Vec::new();
        loop {
            let line = {
                let reader = self.engine.reader_mut().ok_or(Error::EngineDisconnected)?;
                reader.next_line().await?
            };
            let Some(line) = line else {
                return Err(Error::EngineDisconnected);
            };
            match parse_one(&line) {
                UciMessage::Info(attrs) => {
                    let mut out = Line::default();
                    let mut index = 1u16;
                    let mut bound = false;
                    for attr in attrs {
                        match attr {
                            UciInfoAttribute::Depth(d) => out.depth = d,
                            UciInfoAttribute::Nodes(n) => out.nodes = n as u32,
                            UciInfoAttribute::Nps(n) => out.nps = n as u32,
                            UciInfoAttribute::MultiPv(m) => index = m,
                            UciInfoAttribute::Score(score) => {
                                bound = score.lower_bound == Some(true)
                                    || score.upper_bound == Some(true);
                                out.wdl = score.wdl;
                                match score.value {
                                    ScoreValue::Cp(cp) => out.cp = Some(cp),
                                    ScoreValue::Mate(m) => out.mate = Some(m),
                                }
                            }
                            UciInfoAttribute::Pv(moves) => {
                                out.pv = moves.iter().map(|m| m.to_string()).collect();
                            }
                            _ => {}
                        }
                    }
                    if bound || out.pv.is_empty() || (out.cp.is_none() && out.mate.is_none()) {
                        continue;
                    }
                    if index == 1 {
                        history.push((out.depth, out.pv[0].clone()));
                    }
                    latest.insert(index, out);
                }
                UciMessage::BestMove { .. } => break,
                _ => {}
            }
        }

        let mut lines: Vec<(u16, Line)> = latest.into_iter().collect();
        lines.sort_by_key(|(i, _)| *i);
        // Only lines of the last finished depth belong together.
        let depth = lines.first().map(|(_, l)| l.depth).unwrap_or(0);
        let lines = lines
            .into_iter()
            .enumerate()
            .take_while(|(n, (i, l))| *i as usize == n + 1 && l.depth == depth)
            .map(|(_, (_, l))| l)
            .collect();
        Ok(SearchOutput { lines, history })
    }

    /// Evaluates `pos` to `depth` with up to `multipv` lines. A result that is
    /// already deep enough in the evaluation cache is taken from there, and
    /// every new result is stored in it.
    pub async fn analyze(
        &mut self,
        cache: Option<&EvalCache>,
        pos: &Chess,
        depth: u32,
        multipv: u16,
    ) -> Result<Vec<Line>, Error> {
        let legal = pos.legal_moves().len();
        if legal == 0 {
            return Ok(Vec::new());
        }
        let wanted = multipv.min(legal as u16);
        let key = position_key(pos);
        if let Some(lines) = self.memo.get(&key) {
            if lines.len() >= wanted as usize {
                return Ok(lines.clone());
            }
        }
        let white = pos.turn() == Color::White;
        let flip = |v: i32| if white { v } else { -v };
        let flip_wdl = |w: (i32, i32, i32)| if white { w } else { (w.2, w.1, w.0) };
        // A high 50-move counter pulls evaluations towards a draw; such a
        // result belongs to this game only.
        let cache = cache.filter(|_| pos.halfmoves() <= MAX_CLEAN_HALFMOVES);

        if let Some(cached) = cache.and_then(|c| c.lookup(&key, &self.cache_name, wanted)) {
            if cached.depth >= depth && !cached.lines.is_empty() {
                if let Some(c) = cache {
                    c.note_saved_search();
                }
                let lines: Vec<Line> = cached
                    .lines
                    .iter()
                    .map(|l| Line {
                        cp: if l.mate.is_some() {
                            None
                        } else {
                            Some(flip(l.cp.unwrap_or(0)))
                        },
                        mate: l.mate.map(flip),
                        depth: l.depth,
                        pv: l.uci.clone(),
                        nodes: l.nodes,
                        nps: l.nps,
                        wdl: l.wdl.map(flip_wdl),
                    })
                    .collect();
                self.memo.insert(key, lines.clone());
                return Ok(lines);
            }
        }

        let lines = self.search(pos, depth, wanted).await?.lines;
        if lines.is_empty() {
            return Err(Error::NoMovesFound);
        }
        if let Some(cache) = cache {
            if lines.len() == wanted as usize {
                let stored: Vec<StoredLine> = lines
                    .iter()
                    .enumerate()
                    .map(|(i, l)| StoredLine {
                        multipv: i as u16 + 1,
                        depth: l.depth,
                        nodes: l.nodes,
                        nps: l.nps,
                        cp: l.cp.map(flip),
                        mate: l.mate.map(flip),
                        wdl: l.wdl.map(flip_wdl),
                        uci: l.pv.clone(),
                    })
                    .collect();
                cache.store(&key, &self.cache_name, &stored);
            }
        }
        self.memo.insert(key, lines.clone());
        Ok(lines)
    }

    /// The search depth from which the engine plays `solution` and stays with
    /// it, looking up to `max_depth`. `max_depth + 1` when it never settles on
    /// it. A measure of how deep one has to see to find the move.
    pub async fn solve_depth(
        &mut self,
        pos: &Chess,
        solution: &Move,
        max_depth: u32,
    ) -> Result<u32, Error> {
        let output = self.search(pos, max_depth, 1).await?;
        let mut found = max_depth + 1;
        for (depth, first) in &output.history {
            let is_solution = first
                .parse::<UciMove>()
                .ok()
                .and_then(|u| u.to_move(pos).ok())
                .is_some_and(|m| &m == solution);
            if is_solution {
                found = found.min(*depth);
            } else {
                found = max_depth + 1;
            }
        }
        Ok(found)
    }

    /// Forgets the results of this run (the evaluation cache keeps them).
    pub fn clear_memo(&mut self) {
        self.memo.clear();
    }

    /// The engine's name, as it is filed in the evaluation cache.
    pub fn name(&self) -> &str {
        &self.name
    }

    pub async fn quit(&mut self) {
        let _ = self.engine.quit().await;
    }
}

/// The engine that measures how hard a found tactic is. It runs on one
/// thread, so that its depths mean the same every time, and is only started
/// once a tactic is really found, so most runs never need the extra process.
pub struct Prober {
    path: PathBuf,
    engine: Option<Analyzer>,
}

impl Prober {
    pub fn new(path: PathBuf) -> Self {
        Self { path, engine: None }
    }

    pub async fn get(&mut self) -> Result<&mut Analyzer, Error> {
        if self.engine.is_none() {
            let options = [
                EngineOption {
                    name: "Threads".into(),
                    value: "1".into(),
                },
                EngineOption {
                    name: "Hash".into(),
                    value: "16".into(),
                },
            ];
            self.engine = Some(Analyzer::new(self.path.clone(), &options).await?);
        }
        Ok(self.engine.as_mut().expect("just started"))
    }

    pub async fn quit(&mut self) {
        if let Some(engine) = self.engine.as_mut() {
            engine.quit().await;
        }
    }
}

/// At most this many engines search side by side.
pub const MAX_WORKERS: u32 = 8;

/// How the power the user chose (the `Threads` and `Hash` of `options`) is
/// split between engines running side by side: (engines, threads each, hash
/// each in MB). `jobs` is how much work there is to share.
///
/// A search to a fixed depth of around 18 takes well under a second, and for
/// such short searches the threads of one engine get in each other's way.
/// Several engines with one thread each, every one on its own position or
/// game, get through far more in the same time, and every position is still
/// searched to the full depth.
pub fn split_power(options: &[EngineOption], jobs: usize, max_workers: u32) -> (u32, u32, u32) {
    let value = |name: &str| {
        options
            .iter()
            .find(|o| o.name.eq_ignore_ascii_case(name))
            .and_then(|o| o.value.trim().parse::<u32>().ok())
    };
    let threads = value("Threads").unwrap_or(1).max(1);
    let hash = value("Hash").unwrap_or(16).max(1);
    let workers = threads
        .clamp(1, max_workers.clamp(1, MAX_WORKERS))
        .min(jobs.max(1) as u32);
    (
        workers,
        (threads / workers).max(1),
        (hash / workers).max(16),
    )
}

/// The engine options with threads and hash replaced.
pub fn with_threads_and_hash(
    options: &[EngineOption],
    threads: u32,
    hash: u32,
) -> Vec<EngineOption> {
    let mut out: Vec<EngineOption> = options
        .iter()
        .filter(|o| !o.name.eq_ignore_ascii_case("Threads") && !o.name.eq_ignore_ascii_case("Hash"))
        .cloned()
        .collect();
    out.push(EngineOption {
        name: "Threads".into(),
        value: threads.to_string(),
    });
    out.push(EngineOption {
        name: "Hash".into(),
        value: hash.to_string(),
    });
    out
}

/// Starts `count` engines at `path` with `options`. Should one fail to
/// start, the others are dropped, and dropping an engine ends its process.
pub async fn start_analyzers(
    path: &std::path::Path,
    options: &[EngineOption],
    count: u32,
) -> Result<Vec<Analyzer>, Error> {
    let started = futures_util::future::join_all(
        (0..count.max(1)).map(|_| Analyzer::new(path.to_path_buf(), options)),
    )
    .await;
    started.into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opt(name: &str, value: &str) -> EngineOption {
        EngineOption {
            name: name.into(),
            value: value.into(),
        }
    }

    #[test]
    fn power_is_split_between_engines() {
        let options = [opt("Threads", "11"), opt("Hash", "512")];
        assert_eq!(split_power(&options, 100, 8), (8, 1, 64));
        // Never more engines than there is work.
        assert_eq!(split_power(&options, 3, 8), (3, 3, 170));
        // One engine asked for: all threads in it.
        assert_eq!(split_power(&options, 100, 1), (1, 11, 512));
        assert_eq!(split_power(&[], 100, 8), (1, 1, 16));
    }
}
