//! A small engine driver for batch work (tactic search, later Insight):
//! one position in, the final lines out, with the evaluation cache in between.

use std::{collections::HashMap, path::PathBuf};

use shakmaty::{fen::Fen, uci::UciMove, Chess, Color, EnPassantMode, Move, Position};
use vampirc_uci::{parse_one, uci::ScoreValue, UciInfoAttribute, UciMessage};

use crate::{
    engine::{BaseEngine, EngineLog, EngineOption, GoMode},
    error::Error,
    eval_cache::{position_key, EvalCache, StoredLine},
};

/// One line of an evaluation, from the point of view of the side to move.
#[derive(Debug, Clone, PartialEq)]
pub struct Line {
    pub cp: Option<i32>,
    /// Mate in this many moves; negative when the side to move gets mated.
    pub mate: Option<i32>,
    pub depth: u32,
    pub pv: Vec<String>,
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
    multipv: u16,
    /// Results of this run, so a position reached twice is only looked up once.
    memo: HashMap<String, Vec<Line>>,
    /// Number of searches the engine really ran (the rest came from the cache).
    pub searches: u32,
}

impl Analyzer {
    pub async fn new(path: PathBuf, options: &[EngineOption]) -> Result<Self, Error> {
        let mut engine = BaseEngine::spawn(path.clone()).await?;
        engine.init_uci().await?;
        let name = engine
            .get_logs()
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
        Ok(Self {
            engine,
            name,
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
                    let mut out = Line {
                        cp: None,
                        mate: None,
                        depth: 0,
                        pv: Vec::new(),
                    };
                    let mut index = 1u16;
                    let mut bound = false;
                    for attr in attrs {
                        match attr {
                            UciInfoAttribute::Depth(d) => out.depth = d,
                            UciInfoAttribute::MultiPv(m) => index = m,
                            UciInfoAttribute::Score(score) => {
                                bound = score.lower_bound == Some(true)
                                    || score.upper_bound == Some(true);
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

        if let Some(cached) = cache.and_then(|c| c.lookup(&key, &self.name, wanted)) {
            if cached.depth >= depth && !cached.lines.is_empty() {
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
                        nodes: 0,
                        nps: 0,
                        cp: l.cp.map(flip),
                        mate: l.mate.map(flip),
                        wdl: None,
                        uci: l.pv.clone(),
                    })
                    .collect();
                cache.store(&key, &self.name, &stored);
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

    pub async fn quit(&mut self) {
        let _ = self.engine.quit().await;
    }
}
