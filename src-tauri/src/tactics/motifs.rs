//! Names the tactical motifs of a solution, with the theme keys Lichess uses
//! (`fork`, `pin`, `mateIn2` ...), so the puzzle trainer's filter and labels
//! work for our own puzzles too.

use shakmaty::{attacks, Bitboard, Board, Chess, Color, Move, Position, Role, Square};

fn value(role: Role) -> i32 {
    match role {
        Role::Pawn => 1,
        Role::Knight | Role::Bishop => 3,
        Role::Rook => 5,
        Role::Queen => 9,
        Role::King => 99,
    }
}

/// Material of `color` minus material of the other side.
pub fn material_diff(board: &Board, color: Color) -> i32 {
    let count = |c: Color| -> i32 {
        [
            Role::Pawn,
            Role::Knight,
            Role::Bishop,
            Role::Rook,
            Role::Queen,
        ]
        .iter()
        .map(|r| (board.by_piece(r.of(c)).count() as i32) * value(*r))
        .sum()
    };
    count(color) - count(!color)
}

fn attackers(board: &Board, sq: Square, by: Color) -> Bitboard {
    board.attacks_to(sq, by, board.occupied())
}

/// No piece of its own side protects the piece on `sq`.
fn is_undefended(board: &Board, sq: Square, owner: Color) -> bool {
    attackers(board, sq, owner).is_empty()
}

/// The piece on `sq` attacks two or more targets worth taking: a king, a
/// piece worth more than itself, or a piece nobody defends.
fn is_fork(board: &Board, sq: Square, solver: Color) -> bool {
    let Some(piece) = board.piece_at(sq) else {
        return false;
    };
    if piece.role == Role::King {
        return false;
    }
    // A forking piece that is simply taken by something cheaper forks nothing.
    let cheaper_attacker = attackers(board, sq, !solver).into_iter().any(|a| {
        board
            .role_at(a)
            .is_some_and(|r| value(r) < value(piece.role))
    });
    if cheaper_attacker {
        return false;
    }
    let targets = board.attacks_from(sq) & board.by_color(!solver);
    let count = targets
        .into_iter()
        .filter(|t| {
            let Some(role) = board.role_at(*t) else {
                return false;
            };
            if role == Role::Pawn {
                return false;
            }
            role == Role::King
                || value(role) > value(piece.role)
                || is_undefended(board, *t, !solver)
        })
        .count();
    count >= 2
}

/// For a bishop, rook or queen on `sq`: the first two enemy pieces on each of
/// its rays, front piece first.
fn pieces_in_line(board: &Board, sq: Square, solver: Color) -> Vec<(Square, Square)> {
    let Some(piece) = board.piece_at(sq) else {
        return Vec::new();
    };
    let diagonal = matches!(piece.role, Role::Bishop | Role::Queen);
    let straight = matches!(piece.role, Role::Rook | Role::Queen);
    let mut found = Vec::new();
    let enemies = board.by_color(!solver);
    for front in board.attacks_from(sq) & enemies {
        let same_line = (diagonal && attacks::bishop_attacks(sq, Bitboard::EMPTY).contains(front))
            || (straight && attacks::rook_attacks(sq, Bitboard::EMPTY).contains(front));
        if !same_line {
            continue;
        }
        // Look through the front piece along the same ray.
        let without_front = board.occupied() ^ Bitboard::from_square(front);
        let through = if attacks::bishop_attacks(sq, Bitboard::EMPTY).contains(front) {
            attacks::bishop_attacks(sq, without_front)
        } else {
            attacks::rook_attacks(sq, without_front)
        };
        for back in through & attacks::ray(sq, front) & enemies {
            if back != front && attacks::between(sq, back).contains(front) {
                found.push((front, back));
            }
        }
    }
    found
}

fn is_pin(board: &Board, sq: Square, solver: Color) -> bool {
    pieces_in_line(board, sq, solver)
        .iter()
        .any(|(front, back)| {
            let (Some(f), Some(b)) = (board.role_at(*front), board.role_at(*back)) else {
                return false;
            };
            f != Role::Pawn && f != Role::King && (b == Role::King || value(b) > value(f))
        })
}

fn is_skewer(board: &Board, sq: Square, solver: Color) -> bool {
    let Some(mover) = board.role_at(sq) else {
        return false;
    };
    pieces_in_line(board, sq, solver)
        .iter()
        .any(|(front, back)| {
            let (Some(f), Some(b)) = (board.role_at(*front), board.role_at(*back)) else {
                return false;
            };
            b != Role::Pawn
                && b != Role::King
                && value(f) > value(b)
                && (f == Role::King || value(f) > value(mover))
                && (is_undefended(board, *back, !solver) || value(b) > value(mover))
        })
}

/// A piece other than the one that moved now attacks something it could not
/// attack before, because the move opened its line.
fn is_discovered_attack(before: &Board, after: &Board, m: &Move, solver: Color) -> bool {
    let Some(from) = m.from() else {
        return false;
    };
    let sliders = after.by_color(solver) & (after.bishops() | after.rooks() | after.queens());
    for slider in sliders {
        if slider == m.to() {
            continue;
        }
        let Some(slider_role) = after.role_at(slider) else {
            continue;
        };
        let now = after.attacks_from(slider) & after.by_color(!solver);
        let earlier = before.attacks_from(slider);
        for target in now {
            if earlier.contains(target) || !attacks::between(slider, target).contains(from) {
                continue;
            }
            let Some(role) = after.role_at(target) else {
                continue;
            };
            if role == Role::King
                || value(role) > value(slider_role)
                || (role != Role::Pawn && is_undefended(after, target, !solver))
            {
                return true;
            }
        }
    }
    false
}

fn is_back_rank_mate(pos: &Chess) -> bool {
    let loser = pos.turn();
    let board = pos.board();
    let Some(king) = board.king_of(loser) else {
        return false;
    };
    let back_rank = if loser == Color::White {
        shakmaty::Rank::First
    } else {
        shakmaty::Rank::Eighth
    };
    if king.rank() != back_rank {
        return false;
    }
    // The checking piece sits on the back rank and the king's own pieces
    // block every square in front of it.
    let checker_on_rank = pos.checkers().into_iter().any(|c| {
        c.rank() == back_rank && matches!(board.role_at(c), Some(Role::Rook) | Some(Role::Queen))
    });
    let in_front = attacks::king_attacks(king)
        .into_iter()
        .filter(|s| s.rank() != back_rank);
    let mut any = false;
    for sq in in_front {
        any = true;
        if !board.by_color(loser).contains(sq) {
            return false;
        }
    }
    checker_on_rank && any
}

fn is_smothered_mate(pos: &Chess) -> bool {
    let loser = pos.turn();
    let board = pos.board();
    let Some(king) = board.king_of(loser) else {
        return false;
    };
    let by_knight = pos
        .checkers()
        .into_iter()
        .all(|c| board.role_at(c) == Some(Role::Knight));
    by_knight
        && !pos.checkers().is_empty()
        && attacks::king_attacks(king)
            .into_iter()
            .all(|s| board.by_color(loser).contains(s))
}

/// Game phase of a position, the way Lichess tags its puzzles.
pub fn phase(pos: &Chess) -> &'static str {
    let board = pos.board();
    let pieces = (board.knights() | board.bishops() | board.rooks() | board.queens()).count();
    if pieces <= 6 {
        "endgame"
    } else if pos.fullmoves().get() <= 12 && pieces >= 12 {
        "opening"
    } else {
        "middlegame"
    }
}

/// Motifs of a solution. `start` is the position the solver sees and `moves`
/// the solution from there: solver, opponent, solver, ...
pub fn detect(start: &Chess, moves: &[Move]) -> Vec<&'static str> {
    let solver = start.turn();
    let mut themes: Vec<&'static str> = Vec::new();
    let mut add = |t: &'static str| {
        if !themes.contains(&t) {
            themes.push(t);
        }
    };

    let solver_moves = moves.len().div_ceil(2);
    add(match solver_moves {
        0 | 1 => "oneMove",
        2 => "short",
        3 => "long",
        _ => "veryLong",
    });

    let start_diff = material_diff(start.board(), solver);
    let mut pos = start.clone();
    for (i, m) in moves.iter().enumerate() {
        let before = pos.clone();
        pos.play_unchecked(*m);
        let board = pos.board();
        if i % 2 == 1 {
            // After the opponent's reply: is the solver down material for now?
            if i + 1 < moves.len() && material_diff(board, solver) <= start_diff - 2 {
                add("sacrifice");
            }
            continue;
        }
        if m.is_promotion() {
            add("promotion");
            if m.promotion() != Some(Role::Queen) {
                add("underPromotion");
            }
        }
        if m.is_en_passant() {
            add("enPassant");
        }
        if m.is_castle() {
            add("castling");
        }
        let checkers = pos.checkers();
        if checkers.count() >= 2 {
            add("doubleCheck");
        }
        if checkers.into_iter().any(|c| c != m.to()) && !m.is_castle() {
            add("discoveredCheck");
            add("discoveredAttack");
        } else if is_discovered_attack(before.board(), board, m, solver) {
            add("discoveredAttack");
        }
        if is_fork(board, m.to(), solver) {
            add("fork");
        }
        if is_pin(board, m.to(), solver) {
            add("pin");
        }
        if is_skewer(board, m.to(), solver) {
            add("skewer");
        }
        if i == 0 {
            if let Some(captured) = m.capture() {
                if !m.is_en_passant()
                    && value(captured) >= 3
                    && is_undefended(before.board(), m.to(), !solver)
                {
                    add("hangingPiece");
                }
            }
        }
    }

    if pos.is_checkmate() {
        add("mate");
        add(match solver_moves {
            1 => "mateIn1",
            2 => "mateIn2",
            3 => "mateIn3",
            4 => "mateIn4",
            _ => "mateIn5",
        });
        if is_back_rank_mate(&pos) {
            add("backRankMate");
        }
        if is_smothered_mate(&pos) {
            add("smotheredMate");
        }
    }
    themes
}

#[cfg(test)]
mod tests {
    use super::*;
    use shakmaty::{fen::Fen, uci::UciMove, CastlingMode};

    fn themes(fen: &str, line: &str) -> Vec<&'static str> {
        let start: Chess = fen
            .parse::<Fen>()
            .unwrap()
            .into_position(CastlingMode::Standard)
            .unwrap();
        let mut pos = start.clone();
        let moves: Vec<Move> = line
            .split_whitespace()
            .map(|u| {
                let m = u.parse::<UciMove>().unwrap().to_move(&pos).unwrap();
                pos.play_unchecked(m);
                m
            })
            .collect();
        detect(&start, &moves)
    }

    #[test]
    fn knight_fork() {
        // Nc7+ forks king and rook.
        let t = themes("r3k3/8/8/3N4/8/8/8/4K3 w - - 0 1", "d5c7 e8d7 c7a8");
        assert!(t.contains(&"fork"), "{t:?}");
        assert!(t.contains(&"short"));
    }

    #[test]
    fn back_rank_mate() {
        let t = themes("6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1", "a1a8");
        assert!(t.contains(&"mateIn1"), "{t:?}");
        assert!(t.contains(&"backRankMate"), "{t:?}");
        assert!(t.contains(&"oneMove"));
    }

    #[test]
    fn smothered_mate() {
        let t = themes("6rk/6pp/8/6N1/8/8/8/4K3 w - - 0 1", "g5f7");
        assert!(t.contains(&"smotheredMate"), "{t:?}");
    }

    #[test]
    fn pin_to_the_king() {
        // Bb5 pins the knight on c6 to the king on e8.
        let t = themes("4k3/8/2n5/8/8/8/4B3/4K3 w - - 0 1", "e2b5");
        assert!(t.contains(&"pin"), "{t:?}");
        assert!(!t.contains(&"skewer"), "{t:?}");
    }

    #[test]
    fn skewer_through_the_king() {
        // Ra8+ skewers the king on e8 and wins the rook on h8.
        let t = themes("4k2r/8/8/8/8/8/8/R3K3 w - - 0 1", "a1a8 e8e7 a8h8");
        assert!(t.contains(&"skewer"), "{t:?}");
    }

    #[test]
    fn discovered_check() {
        // The bishop leaves the e-file and the rook gives check.
        let t = themes("4k3/8/8/1q6/8/8/4B3/4RK2 w - - 0 1", "e2b5");
        assert!(t.contains(&"discoveredCheck"), "{t:?}");
    }

    #[test]
    fn hanging_piece() {
        let t = themes("4k3/8/8/3n4/8/8/8/3RK3 w - - 0 1", "d1d5");
        assert!(t.contains(&"hangingPiece"), "{t:?}");
    }

    #[test]
    fn queen_sacrifice_for_mate() {
        // Legal's mate pattern is too long for a unit test, a simple one:
        // Qxh7+ Kxh7, Rh3#.
        let t = themes("5rk1/5ppp/8/8/8/2B3R1/7Q/6K1 w - - 0 1", "h2h7 g8h7 g3h3");
        assert!(t.contains(&"sacrifice"), "{t:?}");
    }
}
