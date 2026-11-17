import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { parseSan } from "chessops/san";
import { expect, test } from "vitest";
import { getVariationWithSidelinesPGN } from "../chess";
import { createNode, defaultTree, type TreeNode } from "../treeReducer";

// Appends a line of SAN moves below `node` and returns the last node.
function line(node: TreeNode, sans: string[]): TreeNode {
    let current = node;
    for (const san of sans) {
        const pos = Chess.fromSetup(parseFen(current.fen).unwrap()).unwrap();
        const move = parseSan(pos, san)!;
        pos.play(move);
        const child = createNode({
            fen: makeFen(pos.toSetup()),
            move,
            san,
            halfMoves: current.halfMoves + 1,
        });
        current.children.push(child);
        current = child;
    }
    return current;
}

// 1. e4 {Königsbauer} e5 (1... c5 2. Nf3) 2. Nf3 $1 Nc6 (2... d6 3. d4 (3. Bc4) exd4) 3. Bb5 a6
function sampleTree(): TreeNode {
    const root = defaultTree().root;
    line(root, ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6"]);
    const e4 = root.children[0];
    e4.comment = "Königsbauer";
    line(e4, ["c5", "Nf3"]);
    const nf3 = e4.children[0].children[0];
    nf3.annotations = ["!"];
    const d4 = line(nf3, ["d6", "d4"]);
    line(d4, ["exd4"]);
    line(nf3.children[1], ["Bc4"]);
    return root;
}

test("copies the line to the move and everything after it with side lines", () => {
    // 1. e4 e5 2. Nf3
    const pgn = getVariationWithSidelinesPGN(sampleTree(), [0, 0, 0]);
    expect(pgn).toBe(
        "1. e4 {Königsbauer} e5 2. Nf3 $1 Nc6 (2... d6 3. d4 (3. Bc4) exd4) 3. Bb5 a6",
    );
});

test("copies a side line with its own sub-variations", () => {
    // 1. e4 e5 2. Nf3 d6
    const pgn = getVariationWithSidelinesPGN(sampleTree(), [0, 0, 0, 1]);
    expect(pgn).toBe("1. e4 {Königsbauer} e5 2. Nf3 $1 d6 3. d4 (3. Bc4) exd4");
});

test("keeps the start position of a game from a FEN", () => {
    const fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
    const root = defaultTree(fen).root;
    line(root, ["e5", "Nf3"]);
    line(root, ["c5"]);
    const pgn = getVariationWithSidelinesPGN(root, [0]);
    expect(pgn).toContain(`[FEN "${fen}"]`);
    expect(pgn).toContain("1... e5 2. Nf3");
    expect(pgn).not.toContain("c5");
});

test("empty or invalid paths give an empty string", () => {
    const root = sampleTree();
    expect(getVariationWithSidelinesPGN(root, [])).toBe("");
    expect(getVariationWithSidelinesPGN(root, [5])).toBe("");
});
