import { makeFen } from "chessops/fen";
import { parseSan } from "chessops/san";
import { positionFromFen } from "./chessops";
import type { MoveStat } from "./gamesTree";

// A database as an opening tree. A big database has every odd move somewhere, so only moves
// with a real share of the games from their position are shown.

export const DEFAULT_MIN_SHARE = 0.15;

export type DatabaseMove = MoveStat & {
    // Share of the games from the parent position that continued with this move, 0..1
    share: number;
    fen: string;
    halfMoves: number;
    // Moves from the start, in SAN
    line: string[];
};

// The moves from `parent` that were played in at least `minShare` of its games, most played
// first. The share is counted over all moves, also the ones that are left out.
export function frequentMoves(
    parent: { fen: string; halfMoves: number; line: string[] },
    stats: MoveStat[],
    minShare: number,
): DatabaseMove[] {
    const [pos] = positionFromFen(parent.fen);
    if (!pos) return [];
    const played = stats.filter((s) => s.san !== "*" && s.games > 0);
    const total = played.reduce((sum, s) => sum + s.games, 0);
    if (total === 0) return [];
    return played
        .filter((s) => s.games / total >= minShare)
        .sort((a, b) => b.games - a.games)
        .flatMap((s) => {
            const child = pos.clone();
            const move = parseSan(child, s.san);
            if (!move) return [];
            child.play(move);
            return [
                {
                    ...s,
                    share: s.games / total,
                    fen: makeFen(child.toSetup()),
                    halfMoves: parent.halfMoves + 1,
                    line: [...parent.line, s.san],
                },
            ];
        });
}
