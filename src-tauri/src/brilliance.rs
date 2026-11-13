//! "Brillante Züge suchen": looks for moves that would deserve a "!!".
//!
//! Starting from a position, an engine (usually Patricia) explores a small
//! tree of plausible lines. On the hero's turn every engine line is checked
//! for a brilliancy:
//!
//! - **Opfer:** the move gives up material (by a capture-only search, at least
//!   `min_sacrifice` centipawns, an exchange or more by default), yet the
//!   engine says it is sound (within a small margin of the best move).
//! - **Versteckt:** a shallow "club level" search does not find the move,
//!   only the deep search does.
//! - **Einziger Zug:** every other move is clearly worse.
//!
//! On the opponent's turn the search follows not only the engine's best reply
//! but also replies a club player would realistically play: the best moves of
//! the shallow club search, moves within `club_tolerance` of the best one,
//! and accepting a sacrifice that was just offered.
//!
//! Deep results go through the position store (`eval_cache`), which applies
//! the depth limit for normal accounts on its own (at most depth 28 stored).

use std::{
    collections::{HashSet, VecDeque},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

use serde::{Deserialize, Serialize};
use shakmaty::{san::SanPlus, uci::UciMove, Chess, Color, Move, Position, Role};
use specta::Type;
use vampirc_uci::{
    parse_one,
    uci::{Score, ScoreValue},
    UciInfoAttribute, UciMessage,
};

use crate::{
    chess::{count_material, qsearch},
    engine::{parse_fen_and_apply_moves, BaseEngine, EngineLog, EngineOption, GoMode},
    error::Error,
    eval_cache::{cache_engine_name, option_defaults, position_key, EvalCache, PosKey, StoredLine},
    progress::update_progress,
    AppState,
};

/// Centipawn value used for a forced mate, minus the mate distance.
const MATE_CP: i32 = 100_000;
/// A sound move may be this much worse than the engine's best move.
const SOUND_MARGIN: i32 = 40;
/// The move must leave the hero at least this well off (side to move view).
const SOUND_FLOOR: i32 = -80;
/// "Einziger Zug": the second best move is at least this much worse.
const ONLY_MOVE_GAP: i32 = 150;
/// "Versteckt": the club search rates the move at least this much worse than
/// its own favourite (or does not list it at all).
const HIDDEN_GAP: i32 = 100;
/// Hero moves followed further per position (best move + brilliancies).
const MAX_HERO_CHILDREN: usize = 3;

#[derive(Deserialize, Debug, Clone, Type)]
#[serde(rename_all = "camelCase")]
pub struct BrillianceOptions {
    pub fen: String,
    pub moves: Vec<String>,
    /// "white", "black" or "both". Anything else means the side to move.
    pub hero: String,
    /// Search per position (deep search).
    pub go_mode: GoMode,
    /// Depth of the "club level" search. 0 turns it off.
    pub club_depth: u32,
    /// How many plies the tree goes from the start position.
    pub max_plies: u32,
    /// Engine lines checked per hero position.
    pub lines: u16,
    /// Opponent replies followed per position.
    pub club_replies: u16,
    /// Opponent replies within this many centipawns of the best are realistic.
    pub club_tolerance: i32,
    /// Smallest material sacrifice in centipawns (pawn 90, minor 300, rook 500).
    pub min_sacrifice: i32,
    /// Upper bound for the number of positions searched.
    pub max_positions: u32,
}

#[derive(Serialize, Debug, Clone, Type)]
#[serde(rename_all = "camelCase")]
pub struct BrillianceFind {
    /// Moves (UCI) from the start position up to the brilliant move.
    pub path_uci: Vec<String>,
    pub path_san: Vec<String>,
    pub move_uci: String,
    pub move_san: String,
    /// Engine continuation after the move (without the move itself).
    pub continuation_uci: Vec<String>,
    pub continuation_san: Vec<String>,
    /// "!!" or "!".
    pub annotation: String,
    /// "sacrifice", "hidden", "onlyMove", "mate".
    pub tags: Vec<String>,
    /// Material given up in centipawns (0 when it is not a sacrifice).
    pub sacrifice: i32,
    /// Engine score after the move, from White's point of view.
    pub score: Score,
    /// How much worse the second best move is (centipawns, side to move).
    pub gap: Option<i32>,
    /// Opponent moves on the path that are club replies, not the engine's best.
    pub club_moves: u32,
    pub depth: u32,
    /// Higher is more spectacular; the list is sorted by it.
    pub rating: i32,
    /// Position before the brilliant move.
    pub fen: String,
}

#[derive(Serialize, Debug, Clone, Type)]
#[serde(rename_all = "camelCase")]
pub struct BrillianceResult {
    pub finds: Vec<BrillianceFind>,
    pub positions: u32,
    pub engine_name: String,
}

/// One engine line, score from the side to move.
#[derive(Debug, Clone)]
struct Line {
    multipv: u16,
    depth: u32,
    nodes: u32,
    nps: u32,
    score: Score,
    uci: Vec<String>,
}

impl Line {
    fn cp(&self) -> i32 {
        score_cp(&self.score)
    }
}

fn score_cp(score: &Score) -> i32 {
    match score.value {
        ScoreValue::Cp(cp) => cp,
        ScoreValue::Mate(m) if m > 0 => MATE_CP - m * 100,
        ScoreValue::Mate(m) if m < 0 => -MATE_CP - m * 100,
        // "mate 0": the side to move is mated.
        ScoreValue::Mate(_) => -MATE_CP,
    }
}

fn invert_score(score: &Score) -> Score {
    let value = match score.value {
        ScoreValue::Cp(x) => ScoreValue::Cp(-x),
        ScoreValue::Mate(x) => ScoreValue::Mate(-x),
    };
    Score {
        value,
        wdl: score.wdl.map(|(w, d, l)| (l, d, w)),
        lower_bound: None,
        upper_bound: None,
    }
}

/// Score from the side to move to White's point of view.
fn white_view(score: &Score, turn: Color) -> Score {
    if turn == Color::White {
        Score {
            lower_bound: None,
            upper_bound: None,
            ..score.clone()
        }
    } else {
        invert_score(score)
    }
}

struct Searcher {
    base: BaseEngine,
    engine_name: String,
    /// Name results are filed under in the position store (engine name plus
    /// options that change its play).
    cache_name: String,
    multipv: u16,
}

impl Searcher {
    async fn new(path: PathBuf, options: Vec<EngineOption>) -> Result<Self, Error> {
        let mut base = BaseEngine::spawn(path.clone()).await?;
        base.init_uci().await?;
        let logs = base.get_logs();
        let engine_name = logs
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
                    .unwrap_or_default()
            });
        for o in &options {
            if o.name != "MultiPV" && o.name != "UCI_Chess960" {
                base.set_option(&o.name, &o.value).await?;
            }
        }
        let cache_name = cache_engine_name(&engine_name, &option_defaults(&logs), &options);
        Ok(Self {
            base,
            engine_name,
            cache_name,
            multipv: 0,
        })
    }

    /// Searches `fen` + `moves` with `multipv` lines. Deep searches use the
    /// position store; club searches always run so they stay shallow.
    async fn search(
        &mut self,
        fen: &str,
        moves: &[String],
        multipv: u16,
        go_mode: &GoMode,
        cache: Option<&EvalCache>,
    ) -> Result<Vec<Line>, Error> {
        let pos = parse_fen_and_apply_moves(fen, moves)?;
        let legal = pos.legal_moves().len() as u16;
        if legal == 0 {
            return Ok(vec![]);
        }
        let multipv = multipv.clamp(1, legal);
        let turn = pos.turn();
        // Positions whose evaluation depends on the move history (repetition,
        // high 50-move counter) are kept out of the store.
        let key = crate::chess::clean_position_key(fen, moves);
        let cache = cache.zip(key);

        if let Some((cache, key)) = cache {
            if let GoMode::Depth(d) = go_mode {
                if let Some(c) = cache.lookup(&key, &self.cache_name, multipv) {
                    if c.depth >= *d && c.lines.len() == multipv as usize {
                        let lines: Vec<Line> = c
                            .lines
                            .iter()
                            .map(|l| Line {
                                multipv: l.multipv,
                                depth: l.depth,
                                nodes: l.nodes,
                                nps: l.nps,
                                score: white_view(&l.score(), turn),
                                uci: l.uci.clone(),
                            })
                            .collect();
                        if lines.iter().all(|l| !l.uci.is_empty()) {
                            cache.note_saved_search();
                            return Ok(lines);
                        }
                    }
                }
            }
        }

        if self.multipv != multipv {
            self.base.set_option("MultiPV", multipv).await?;
            self.multipv = multipv;
        }
        self.base.set_position(fen, moves).await?;
        self.base.go(go_mode).await?;

        let mut lines: Vec<Option<Line>> = vec![None; multipv as usize];
        loop {
            let line = {
                let reader = self.base.reader_mut().ok_or(Error::EngineDisconnected)?;
                reader.next_line().await?
            };
            let Some(line) = line else {
                return Err(Error::EngineDisconnected);
            };
            self.base.log_engine(&line);
            match parse_one(&line) {
                UciMessage::Info(attrs) => {
                    if let Some(l) = parse_info(attrs) {
                        let i = l.multipv as usize;
                        if i >= 1 && i <= lines.len() {
                            lines[i - 1] = Some(l);
                        }
                    }
                }
                UciMessage::BestMove { .. } => break,
                _ => {}
            }
        }
        let lines: Vec<Line> = lines.into_iter().flatten().collect();

        if let Some((cache, key)) = cache {
            if lines.len() == multipv as usize && lines.iter().all(|l| l.depth > 0) {
                let stored: Vec<StoredLine> = lines
                    .iter()
                    .map(|l| {
                        StoredLine::from_score(
                            l.multipv,
                            l.depth,
                            l.nodes,
                            l.nps,
                            &white_view(&l.score, turn),
                            l.uci.clone(),
                        )
                    })
                    .collect();
                cache.store(&key, &self.cache_name, &stored);
            }
        }
        Ok(lines)
    }

    async fn quit(&mut self) {
        let _ = self.base.quit().await;
    }
}

fn parse_info(attrs: Vec<UciInfoAttribute>) -> Option<Line> {
    let mut line = Line {
        multipv: 1,
        depth: 0,
        nodes: 0,
        nps: 0,
        score: Score {
            value: ScoreValue::Cp(0),
            wdl: None,
            lower_bound: None,
            upper_bound: None,
        },
        uci: vec![],
    };
    let mut has_score = false;
    for a in attrs {
        match a {
            UciInfoAttribute::Pv(m) => line.uci = m.iter().map(|m| m.to_string()).collect(),
            UciInfoAttribute::Depth(d) => line.depth = d,
            UciInfoAttribute::Nodes(n) => line.nodes = n as u32,
            UciInfoAttribute::Nps(n) => line.nps = n as u32,
            UciInfoAttribute::MultiPv(m) => line.multipv = m,
            UciInfoAttribute::Score(s) => {
                if s.lower_bound == Some(true) || s.upper_bound == Some(true) {
                    return None;
                }
                line.score = s;
                has_score = true;
            }
            _ => {}
        }
    }
    (has_score && !line.uci.is_empty()).then_some(line)
}

fn parse_move(pos: &Chess, uci: &str) -> Option<Move> {
    let u: UciMove = uci.parse().ok()?;
    u.to_move(pos).ok()
}

/// Material the side to move gives up with `mv`, in centipawns.
///
/// The value after a move is the material balance once the opponent has made
/// its best captures (capture-only search). It is compared with what the
/// position could keep: the current material, or less if something is lost
/// whatever the hero plays. Not taking a hanging piece is no sacrifice.
pub fn sacrifice_value(pos: &Chess, mv: &Move) -> i32 {
    let after = |m: &Move| {
        let mut p = pos.clone();
        p.play_unchecked(*m);
        if p.is_checkmate() {
            return 1_000_000;
        }
        -qsearch(&p, -1_000_000, 1_000_000)
    };
    let now = count_material(pos);
    let keep = pos
        .legal_moves()
        .iter()
        .map(after)
        .max()
        .unwrap_or(now)
        .min(now);
    (keep - after(mv)).max(0)
}

/// Captures that take back the piece which just moved to `square` (accepting
/// the sacrifice), cheapest attacker first.
fn accept_captures(pos: &Chess, square: shakmaty::Square) -> Vec<Move> {
    let mut caps: Vec<Move> = pos
        .legal_moves()
        .into_iter()
        .filter(|m| m.is_capture() && m.to() == square)
        .collect();
    caps.sort_by_key(|m| role_value(m.role()));
    caps
}

fn role_value(role: Role) -> i32 {
    match role {
        Role::Pawn => 1,
        Role::Knight | Role::Bishop => 3,
        Role::Rook => 5,
        Role::Queen => 9,
        Role::King => 100,
    }
}

fn is_hero(hero: &str, root_turn: Color, turn: Color) -> bool {
    match hero {
        "white" => turn == Color::White,
        "black" => turn == Color::Black,
        "both" => true,
        _ => turn == root_turn,
    }
}

struct Candidate {
    annotation: &'static str,
    tags: Vec<String>,
    sacrifice: i32,
    gap: Option<i32>,
    rating: i32,
}

/// Decides whether the first move of `line` deserves "!!" or "!".
fn judge(
    pos: &Chess,
    line: &Line,
    deep: &[Line],
    club: &[Line],
    min_sacrifice: i32,
) -> Option<Candidate> {
    let best = deep.first()?;
    let mv_uci = line.uci.first()?;
    let mv = parse_move(pos, mv_uci)?;
    let cp = line.cp();
    if cp < best.cp() - SOUND_MARGIN || cp < SOUND_FLOOR {
        return None;
    }
    if pos.legal_moves().len() < 2 {
        return None;
    }
    let is_best = line.multipv == best.multipv;
    let mate = matches!(line.score.value, ScoreValue::Mate(m) if m > 0);

    let sacrifice = sacrifice_value(pos, &mv);

    let gap = if is_best {
        deep.get(1).map(|second| cp - second.cp())
    } else {
        None
    };
    let only_move = gap.is_some_and(|g| g >= ONLY_MOVE_GAP);

    let hidden = if club.is_empty() {
        false
    } else {
        let club_best = &club[0];
        match club.iter().find(|l| l.uci.first() == Some(mv_uci)) {
            None => true,
            Some(l) => l.multipv != club_best.multipv && club_best.cp() - l.cp() >= HIDDEN_GAP,
        }
    };

    let mut tags = Vec::new();
    if sacrifice >= 90 {
        tags.push("sacrifice".to_string());
    }
    if hidden {
        tags.push("hidden".to_string());
    }
    if only_move {
        tags.push("onlyMove".to_string());
    }
    if mate {
        tags.push("mate".to_string());
    }

    let big_sac = sacrifice >= min_sacrifice;
    let quiet = !mv.is_capture() && !mv.is_promotion();
    let annotation = if big_sac && (is_best || hidden || mate) {
        "!!"
    } else if only_move && hidden && quiet && gap.is_some_and(|g| g >= 2 * ONLY_MOVE_GAP) {
        "!!"
    } else if (sacrifice >= 90 && is_best) || (only_move && hidden) || (big_sac && !is_best) {
        "!"
    } else {
        return None;
    };

    let rating = sacrifice
        + if hidden { 300 } else { 0 }
        + if only_move { 150 } else { 0 }
        + if mate { 200 } else { 0 }
        + if annotation == "!!" { 1000 } else { 0 };

    Some(Candidate {
        annotation,
        tags,
        sacrifice,
        gap,
        rating,
    })
}

fn san_line(pos: &Chess, uci: &[String]) -> Option<Vec<String>> {
    let mut p = pos.clone();
    let mut out = Vec::with_capacity(uci.len());
    for m in uci {
        let mv = parse_move(&p, m)?;
        out.push(SanPlus::from_move_and_play_unchecked(&mut p, mv).to_string());
    }
    Some(out)
}

struct Node {
    path: Vec<String>,
    club_moves: u32,
    /// Square of the hero's last move if it was a sacrifice.
    sacrificed_on: Option<shakmaty::Square>,
}

#[tauri::command]
#[specta::specta]
pub async fn find_brilliancies(
    id: String,
    engine: String,
    options: BrillianceOptions,
    uci_options: Vec<EngineOption>,
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<BrillianceResult, Error> {
    let cancel = Arc::new(AtomicBool::new(false));
    state
        .analysis_cancel_flags
        .insert(id.clone(), cancel.clone());
    let progress_id = id.clone();
    let result = run(
        engine,
        &options,
        uci_options,
        &state.eval_cache,
        &cancel,
        |p| update_progress(&state.progress_state, &app, progress_id.clone(), p, false),
    )
    .await;
    state.analysis_cancel_flags.remove(&id);
    update_progress(&state.progress_state, &app, id.clone(), 100.0, true)?;
    result
}

async fn run(
    engine: String,
    o: &BrillianceOptions,
    uci_options: Vec<EngineOption>,
    cache: &EvalCache,
    cancel: &AtomicBool,
    mut progress: impl FnMut(f32) -> Result<(), Error>,
) -> Result<BrillianceResult, Error> {
    let root = parse_fen_and_apply_moves(&o.fen, &o.moves)?;
    let root_turn = root.turn();
    let mut searcher = Searcher::new(PathBuf::from(engine), uci_options).await?;
    let club_mode = GoMode::Depth(o.club_depth.max(1));
    let max_positions = o.max_positions.max(1);

    let mut queue: VecDeque<Node> = VecDeque::new();
    queue.push_back(Node {
        path: vec![],
        club_moves: 0,
        sacrificed_on: None,
    });
    let mut seen: HashSet<PosKey> = HashSet::new();
    let mut found: HashSet<(PosKey, String)> = HashSet::new();
    let mut finds: Vec<BrillianceFind> = Vec::new();
    let mut positions = 0u32;

    while let Some(node) = queue.pop_front() {
        if cancel.load(Ordering::SeqCst) {
            searcher.quit().await;
            return Err(Error::AnalysisCancelled);
        }
        if positions >= max_positions {
            break;
        }
        let mut all_moves = o.moves.clone();
        all_moves.extend(node.path.iter().cloned());
        let Ok(pos) = parse_fen_and_apply_moves(&o.fen, &all_moves) else {
            continue;
        };
        if pos.is_game_over() || !seen.insert(position_key(&pos)) {
            continue;
        }
        positions += 1;
        progress((positions as f32 / max_positions as f32 * 100.0).min(99.0))?;

        let ply = node.path.len() as u32;
        let hero = is_hero(&o.hero, root_turn, pos.turn());
        let lines = if hero {
            o.lines.max(2)
        } else {
            o.club_replies.max(1) + 1
        };
        let deep = searcher
            .search(&o.fen, &all_moves, lines, &o.go_mode, Some(cache))
            .await?;
        if deep.is_empty() {
            continue;
        }
        let club = if o.club_depth > 0 {
            searcher
                .search(&o.fen, &all_moves, lines, &club_mode, None)
                .await?
        } else {
            vec![]
        };

        let expand = ply + 1 < o.max_plies;
        if hero {
            let mut children: Vec<(String, Option<shakmaty::Square>)> = Vec::new();
            for line in &deep {
                let Some(c) = judge(&pos, line, &deep, &club, o.min_sacrifice) else {
                    continue;
                };
                let mv_uci = line.uci[0].clone();
                let key = (position_key(&pos), mv_uci.clone());
                if found.insert(key) {
                    let path_san = san_line(&root, &node.path).unwrap_or_default();
                    let full = san_line(&pos, &line.uci).unwrap_or_default();
                    finds.push(BrillianceFind {
                        path_uci: node.path.clone(),
                        path_san,
                        move_uci: mv_uci.clone(),
                        move_san: full.first().cloned().unwrap_or_else(|| mv_uci.clone()),
                        continuation_uci: line.uci.iter().skip(1).cloned().collect(),
                        continuation_san: full.iter().skip(1).cloned().collect(),
                        annotation: c.annotation.to_string(),
                        tags: c.tags,
                        sacrifice: c.sacrifice,
                        score: white_view(&line.score, pos.turn()),
                        gap: c.gap,
                        club_moves: node.club_moves,
                        depth: line.depth,
                        rating: c.rating - 50 * ply as i32,
                        fen: shakmaty::fen::Fen::from_position(
                            &pos,
                            shakmaty::EnPassantMode::Legal,
                        )
                        .to_string(),
                    });
                }
                let sq = (c.sacrifice >= 90)
                    .then(|| parse_move(&pos, &mv_uci).map(|m| m.to()))
                    .flatten();
                if !children.iter().any(|(m, _)| *m == mv_uci) {
                    children.push((mv_uci, sq));
                }
            }
            if expand {
                let best = deep[0].uci[0].clone();
                if !children.iter().any(|(m, _)| *m == best) {
                    children.insert(0, (best, None));
                }
                for (mv, sq) in children.into_iter().take(MAX_HERO_CHILDREN) {
                    let mut path = node.path.clone();
                    path.push(mv);
                    queue.push_back(Node {
                        path,
                        club_moves: node.club_moves,
                        sacrificed_on: sq,
                    });
                }
            }
        } else if expand {
            // Realistic replies: engine best, club favourites, near-best
            // moves and taking a sacrificed piece.
            let best = &deep[0];
            let mut replies: Vec<(String, bool)> = vec![(best.uci[0].clone(), false)];
            let push = |m: String, replies: &mut Vec<(String, bool)>| {
                if !replies.iter().any(|(r, _)| *r == m) {
                    replies.push((m, true));
                }
            };
            if let Some(sq) = node.sacrificed_on {
                if let Some(m) = accept_captures(&pos, sq).first() {
                    push(
                        UciMove::from_move(*m, shakmaty::CastlingMode::Standard).to_string(),
                        &mut replies,
                    );
                }
            }
            for l in club.iter().take(2) {
                push(l.uci[0].clone(), &mut replies);
            }
            for l in deep.iter().skip(1) {
                if best.cp() - l.cp() <= o.club_tolerance {
                    push(l.uci[0].clone(), &mut replies);
                }
            }
            for (mv, club_move) in replies.into_iter().take(o.club_replies.max(1) as usize) {
                let mut path = node.path.clone();
                path.push(mv);
                queue.push_back(Node {
                    path,
                    club_moves: node.club_moves + club_move as u32,
                    sacrificed_on: None,
                });
            }
        }
    }

    searcher.quit().await;
    finds.sort_by(|a, b| b.rating.cmp(&a.rating));
    Ok(BrillianceResult {
        finds,
        positions,
        engine_name: searcher.engine_name.clone(),
    })
}

#[cfg(test)]
mod tests {
    use shakmaty::{fen::Fen, CastlingMode, FromSetup};

    use super::*;

    fn pos(fen: &str) -> Chess {
        let fen: Fen = fen.parse().unwrap();
        Chess::from_setup(fen.into_setup(), CastlingMode::Standard).unwrap()
    }

    fn mv(p: &Chess, uci: &str) -> Move {
        parse_move(p, uci).unwrap()
    }

    fn line(multipv: u16, cp: i32, uci: &str) -> Line {
        Line {
            multipv,
            depth: 20,
            nodes: 0,
            nps: 0,
            score: Score {
                value: ScoreValue::Cp(cp),
                wdl: None,
                lower_bound: None,
                upper_bound: None,
            },
            uci: vec![uci.to_string()],
        }
    }

    #[test]
    fn quiet_developing_move_is_no_sacrifice() {
        let p = Chess::default();
        assert_eq!(sacrifice_value(&p, &mv(&p, "g1f3")), 0);
    }

    #[test]
    fn hanging_a_knight_is_a_sacrifice() {
        // 1.e4 e5: Ng1-g5?? walks into ...Qxg5.
        let p = pos("rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2");
        assert_eq!(sacrifice_value(&p, &mv(&p, "g1h3")), 0);
        let p = pos("rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 2");
        assert!(sacrifice_value(&p, &mv(&p, "f3g5")) >= 200);
    }

    #[test]
    fn legal_sacrifice_bxf7() {
        // Italian: Bxf7+ gives a bishop for a pawn.
        let p = pos("r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4");
        let s = sacrifice_value(&p, &mv(&p, "c4f7"));
        assert!(s >= 200, "{s}");
    }

    #[test]
    fn sound_hidden_sacrifice_gets_double_exclam() {
        let p = pos("rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 2");
        let deep = vec![line(1, 50, "f3g5"), line(2, 30, "b1c3")];
        let club = vec![line(1, 40, "b1c3"), line(2, 30, "f1c4")];
        let c = judge(&p, &deep[0], &deep, &club, 200).unwrap();
        assert_eq!(c.annotation, "!!");
        assert!(c.tags.contains(&"sacrifice".to_string()));
        assert!(c.tags.contains(&"hidden".to_string()));
    }

    #[test]
    fn unsound_sacrifice_is_ignored() {
        let p = pos("rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 2");
        let deep = vec![line(1, 50, "b1c3"), line(2, -250, "f3g5")];
        assert!(judge(&p, &deep[1], &deep, &[], 200).is_none());
    }

    #[test]
    fn normal_best_move_is_not_brilliant() {
        let p = Chess::default();
        let deep = vec![line(1, 30, "e2e4"), line(2, 25, "d2d4")];
        let club = vec![line(1, 30, "e2e4")];
        assert!(judge(&p, &deep[0], &deep, &club, 200).is_none());
    }

    #[test]
    fn mate_scores_order() {
        let m1 = Score {
            value: ScoreValue::Mate(1),
            wdl: None,
            lower_bound: None,
            upper_bound: None,
        };
        let m5 = Score {
            value: ScoreValue::Mate(5),
            ..m1.clone()
        };
        assert!(score_cp(&m1) > score_cp(&m5));
        assert!(score_cp(&m5) > 10_000);
        assert!(score_cp(&invert_score(&m5)) < -10_000);
    }

    /// Runs the whole search with a real engine.
    /// `JBLBASE_TEST_ENGINE=/path/to/engine cargo test -- --ignored brilliance_real_engine`
    #[tokio::test]
    #[ignore]
    async fn brilliance_real_engine() {
        let Ok(path) = std::env::var("JBLBASE_TEST_ENGINE") else {
            return;
        };
        let cache = EvalCache::open_in_memory();
        // Legal's mate: 1.e4 e5 2.Nf3 d6 3.Bc4 Bg4 4.Nc3 g6? 5.Nxe5!! Bxd1 6.Bxf7+ Ke7 7.Nd5#
        let options = BrillianceOptions {
            fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1".into(),
            moves: [
                "e2e4", "e7e5", "g1f3", "d7d6", "f1c4", "c8g4", "b1c3", "g7g6",
            ]
            .iter()
            .map(|m| m.to_string())
            .collect(),
            hero: "turn".into(),
            go_mode: GoMode::Depth(14),
            club_depth: 4,
            max_plies: 5,
            lines: 3,
            club_replies: 3,
            club_tolerance: 150,
            min_sacrifice: 200,
            max_positions: 12,
        };
        let custom = std::env::var("JBLBASE_TEST_FEN").ok();
        let options = match &custom {
            Some(fen) => BrillianceOptions {
                fen: fen.clone(),
                moves: vec![],
                max_plies: 8,
                max_positions: 40,
                ..options
            },
            None => options,
        };
        let cancel = AtomicBool::new(false);
        let mut steps = 0;
        let result = run(path, &options, vec![], &cache, &cancel, |_| {
            steps += 1;
            Ok(())
        })
        .await
        .unwrap();
        for f in &result.finds {
            println!(
                "{} {}{} {:?} sac {} after {:?} cont {:?}",
                f.rating,
                f.move_san,
                f.annotation,
                f.tags,
                f.sacrifice,
                f.path_san,
                f.continuation_san
            );
        }
        assert!(steps > 0);
        if custom.is_some() {
            return;
        }
        let first = &result.finds[0];
        assert_eq!(first.move_san, "Nxe5");
        assert_eq!(first.annotation, "!!");
        assert!(first.path_san.is_empty());
    }
}
