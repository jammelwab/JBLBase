import { INITIAL_FEN } from "chessops/fen";
import { expect, test } from "vitest";
import { DEFAULT_MIN_SHARE, frequentMoves } from "../databaseTree";

const root = { fen: INITIAL_FEN, halfMoves: 0, line: [] as string[] };
const stat = (san: string, games: number) => ({ san, games, white: games, draw: 0, black: 0 });

test("keeps only moves with at least 15 % of the games", () => {
    const moves = frequentMoves(
        root,
        [stat("e4", 500), stat("d4", 300), stat("c4", 150), stat("Nf3", 45), stat("a3", 5)],
        DEFAULT_MIN_SHARE,
    );
    expect(moves.map((m) => m.san)).toEqual(["e4", "d4", "c4"]);
    expect(moves[2].share).toBeCloseTo(0.15);
    expect(moves[0].line).toEqual(["e4"]);
    expect(moves[0].halfMoves).toBe(1);
});

test("the share counts the rare moves too, and games that end here do not count", () => {
    const moves = frequentMoves(
        root,
        [stat("*", 1000), stat("e4", 86), stat("d4", 14)],
        DEFAULT_MIN_SHARE,
    );
    expect(moves.map((m) => m.san)).toEqual(["e4"]);
    expect(moves[0].share).toBeCloseTo(0.86);
});

test("a share of 0 shows every move, sorted by games", () => {
    const moves = frequentMoves(root, [stat("a3", 1), stat("e4", 9)], 0);
    expect(moves.map((m) => m.san)).toEqual(["e4", "a3"]);
});
