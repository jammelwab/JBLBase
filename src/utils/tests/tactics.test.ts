import { INITIAL_FEN, makeFen } from "chessops/fen";
import { parseSan } from "chessops/san";
import { expect, test } from "vitest";
import { positionFromFen } from "../chessops";
import { linesOfTree } from "../tactics";
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
