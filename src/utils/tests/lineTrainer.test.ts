import { INITIAL_FEN, makeFen } from "chessops/fen";
import { parseSan } from "chessops/san";
import { expect, test } from "vitest";
import { positionFromFen } from "../chessops";
import {
    alternatives,
    buildLines,
    isUserTurn,
    nodesOfLine,
    planSession,
    repeatItem,
    startPlyAfter,
} from "../lineTrainer";
import { createNode, defaultTree, type TreeNode } from "../treeReducer";

function tree(...lines: string[][]): TreeNode {
    const root = defaultTree().root;
    for (const line of lines) {
        let cur = root;
        const [pos] = positionFromFen(INITIAL_FEN);
        for (const san of line) {
            const move = parseSan(pos!, san)!;
            pos!.play(move);
            let child = cur.children.find((c) => c.san === san);
            if (!child) {
                child = createNode({
                    fen: makeFen(pos!.toSetup()),
                    move,
                    san,
                    halfMoves: cur.halfMoves + 1,
                });
                cur.children.push(child);
            }
            cur = child;
        }
    }
    return root;
}

// 1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 4.Ba4 Nf6 5.O-O Be7 / ... 5.O-O b5 (differs at move 10)
const ruyLopez = tree(
    ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6", "O-O", "Be7"],
    ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6", "O-O", "b5"],
    ["e4", "c5", "Nf3"],
);

test("lines are the paths to every leaf, main line first", () => {
    expect(buildLines(ruyLopez)).toEqual([
        [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
        [0, 1, 0],
    ]);
});

test("the next line starts one move before it changes", () => {
    const [main, b5, sicilian] = buildLines(ruyLopez);
    // shared 9 plies, so the board starts after 8 plies: 5.O-O is played again, then ...b5
    expect(startPlyAfter(main, b5)).toBe(8);
    expect(startPlyAfter(b5, sicilian)).toBe(0);
    expect(startPlyAfter(null, main)).toBe(0);
});

test("a session takes the lines asked for and repeats misses near the miss", () => {
    const lines = buildLines(ruyLopez);
    expect(planSession(lines, () => true)).toEqual([
        { line: 0, startPly: 0 },
        { line: 1, startPly: 8 },
        { line: 2, startPly: 0 },
    ]);
    expect(planSession(lines, (l) => l[1] === 1)).toEqual([{ line: 2, startPly: 0 }]);
    expect(repeatItem(0, 6)).toEqual({ line: 0, startPly: 5 });
});

test("other opponent moves in the repertoire are found", () => {
    const [main] = buildLines(ruyLopez);
    expect(alternatives(ruyLopez, main, 1).map((n) => n.san)).toEqual(["c5"]);
    expect(alternatives(ruyLopez, main, 9).map((n) => n.san)).toEqual(["b5"]);
    expect(alternatives(ruyLopez, main, 2)).toEqual([]);
    const nodes = nodesOfLine(ruyLopez, main);
    expect(isUserTurn(nodes[0], "white")).toBe(true);
    expect(isUserTurn(nodes[1], "white")).toBe(false);
});
