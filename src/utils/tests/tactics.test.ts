import { INITIAL_FEN, makeFen } from "chessops/fen";
import { parseSan } from "chessops/san";
import { expect, test } from "vitest";
import { positionFromFen } from "../chessops";
import { countSolverPositions, linesOfTree } from "../tactics";
import { createNode, defaultTree, type TreeNode } from "../treeReducer";

// Builds a tree from lines of SAN moves; the first line is the main line.
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

test("linesOfTree lists every line once, main line first", () => {
    const root = tree(["e4", "e5", "Nf3", "Nc6"], ["e4", "c5", "Nf3"], ["e4", "c5", "c3"]);
    expect(linesOfTree(root)).toEqual([
        ["e2e4", "e7e5", "g1f3", "b8c6"],
        ["e2e4", "c7c5", "g1f3"],
        ["e2e4", "c7c5", "c2c3"],
    ]);
});

test("linesOfTree of an empty tree is empty", () => {
    expect(linesOfTree(defaultTree().root)).toEqual([]);
});

test("countSolverPositions counts each position of the solver once", () => {
    // 1.e4 e5 2.Nf3 Nc6 and 1.Nf3 e5 2.e4 Nc6 meet in the same position.
    const root = tree(["e4", "e5", "Nf3", "Nc6"], ["Nf3", "e5", "e4", "Nc6"], ["d4"]);
    // White to move after: 1.e4 e5, 1.e4 e5 2.Nf3 Nc6 (= the transposition), 1.Nf3 e5.
    expect(countSolverPositions(root, "white")).toBe(3);
    // Black to move after: 1.e4, 1.e4 e5 2.Nf3 (= 1.Nf3 e5 2.e4), 1.Nf3, 1.d4.
    expect(countSolverPositions(root, "black")).toBe(4);
});
