import { INITIAL_FEN, makeFen } from "chessops/fen";
import { parseSan } from "chessops/san";
import { expect, test } from "vitest";
import { positionFromFen } from "../chessops";
import { classifyMove, countClassifications } from "../moveClassification";
import {
    indexRepertoire,
    mergeLine,
    nodesOnPath,
    positionKey,
    repertoireStats,
} from "../repertoireTree";
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

function lines(root: TreeNode): string[] {
    const out: string[] = [];
    const walk = (node: TreeNode, prefix: string[]) => {
        if (node.children.length === 0) out.push(prefix.join(" "));
        for (const c of node.children) walk(c, [...prefix, c.san!]);
    };
    walk(root, []);
    return out;
}

test("a new line branches off where it leaves the repertoire", () => {
    const rep = tree(["e4", "e5", "Nf3", "Nc6", "Bb5"]);
    const game = tree(["e4", "e5", "Nf3", "Nf6", "Nxe5", "d6"]);
    const result = mergeLine(rep, game.fen, nodesOnPath(game, [0, 0, 0, 0, 0, 0]));
    expect(result).toEqual({ ok: true, added: 3, path: [0, 0, 0, 1, 0, 0] });
    expect(lines(rep)).toEqual(["e4 e5 Nf3 Nc6 Bb5", "e4 e5 Nf3 Nf6 Nxe5 d6"]);
});

test("adding a line twice adds nothing", () => {
    const rep = tree(["d4", "d5", "c4"]);
    const result = mergeLine(rep, rep.fen, nodesOnPath(tree(["d4", "d5"]), [0, 0]));
    expect(result).toMatchObject({ ok: true, added: 0 });
});

test("the continuation brings all variations along, without depth limit", () => {
    const deep = [
        "e4",
        "c5",
        "Nf3",
        "d6",
        "d4",
        "cxd4",
        "Nxd4",
        "Nf6",
        "Nc3",
        "a6",
        "Be3",
        "e5",
        "Nb3",
        "Be6",
        "f3",
        "Be7",
        "Qd2",
        "O-O",
        "O-O-O",
        "Nbd7",
    ];
    const game = tree(deep, ["e4", "c5", "Nf3", "Nc6"]);
    const rep = defaultTree().root;
    const nf3 = nodesOnPath(game, [0, 0, 0]);
    const result = mergeLine(rep, game.fen, nf3, nf3[nf3.length - 1]);
    expect(result).toMatchObject({ ok: true, added: 3 + 17 + 1 });
    expect(repertoireStats(rep)).toEqual({ moves: 21, leaves: 2, depth: 20 });
});

test("a line from another start position is refused", () => {
    const rep = tree(["e4"]);
    const other = defaultTree("rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1").root;
    expect(mergeLine(rep, other.fen, [])).toEqual({ ok: false, reason: "different-start" });
});

test("transpositions share one entry in the index", () => {
    const rep = tree(["Nf3", "d5", "d4", "Nf6"], ["d4", "d5", "Nf3", "c6"]);
    const index = indexRepertoire(rep);
    const after = getFenAfter(["d4", "d5", "Nf3"]);
    expect(index.get(positionKey(after))?.sort()).toEqual(["Nf6", "c6"]);
});

function getFenAfter(moves: string[]) {
    const [pos] = positionFromFen(INITIAL_FEN);
    for (const san of moves) pos!.play(parseSan(pos!, san)!);
    return makeFen(pos!.toSetup());
}

test("move ratings follow the expected-score loss", () => {
    expect(classifyMove({ winChanceLoss: 0, isBest: true })).toBe("best");
    expect(classifyMove({ winChanceLoss: 1 })).toBe("excellent");
    expect(classifyMove({ winChanceLoss: 4 })).toBe("good");
    expect(classifyMove({ winChanceLoss: 7 })).toBe("inaccuracy");
    expect(classifyMove({ winChanceLoss: 15 })).toBe("mistake");
    expect(classifyMove({ winChanceLoss: 30 })).toBe("blunder");
    expect(classifyMove({ winChanceLoss: 0, annotation: "!!", isBest: true })).toBe("brilliant");
    expect(classifyMove({ winChanceLoss: 3, isBook: true })).toBe("book");
    expect(classifyMove({ winChanceLoss: 25, isBook: true })).toBe("blunder");

    const counts = countClassifications([
        { halfMoves: 1, classification: "best" },
        { halfMoves: 2, classification: "blunder" },
        { halfMoves: 3, classification: "best" },
    ]);
    expect(counts.white.best).toBe(2);
    expect(counts.black.blunder).toBe(1);
});
