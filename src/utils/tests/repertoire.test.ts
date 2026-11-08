import { INITIAL_FEN, makeFen } from "chessops/fen";
import { parseSan } from "chessops/san";
import { expect, test } from "vitest";
import { positionFromFen } from "../chessops";
import { classifyMove, countClassifications } from "../moveClassification";
import {
    indexRepertoire,
    mergeLine,
    moveShares,
    positionKey,
    repertoireStats,
} from "../repertoireTree";
import { childNodes, collectIssues, lineText } from "../gamesTree";
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
    const result = mergeLine(rep, game, [0, 0, 0, 0, 0, 0]);
    expect(result).toEqual({ ok: true, added: 3, path: [0, 0, 0, 1, 0, 0] });
    expect(lines(rep)).toEqual(["e4 e5 Nf3 Nc6 Bb5", "e4 e5 Nf3 Nf6 Nxe5 d6"]);
});

test("adding a line twice adds nothing", () => {
    const rep = tree(["d4", "d5", "c4"]);
    const result = mergeLine(rep, tree(["d4", "d5"]), [0, 0]);
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
    const result = mergeLine(rep, game, [0, 0, 0], { withVariations: true });
    expect(result).toMatchObject({ ok: true, added: 3 + 17 + 1 });
    expect(repertoireStats(rep)).toEqual({ moves: 21, leaves: 2, depth: 20 });
});

test("side variations along the line come along only when asked", () => {
    const game = tree(["e4", "e5", "Nf3", "Nc6"], ["e4", "c5", "Nf3"], ["d4", "d5"]);
    const plain = defaultTree().root;
    mergeLine(plain, game, [0, 0, 0]);
    expect(lines(plain)).toEqual(["e4 e5 Nf3"]);

    const full = defaultTree().root;
    const result = mergeLine(full, game, [0, 0, 0], { withVariations: true });
    expect(lines(full)).toEqual(["e4 e5 Nf3 Nc6", "e4 c5 Nf3", "d4 d5"]);
    expect(result).toMatchObject({ ok: true, path: [0, 0, 0] });
});

test("a line from another start position is refused", () => {
    const rep = tree(["e4"]);
    const other = defaultTree("rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1").root;
    expect(mergeLine(rep, other, [])).toEqual({ ok: false, reason: "different-start" });
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

test("move shares add up to 100 % and name the missing top move", () => {
    const counts = [
        { san: "e5", games: 50 },
        { san: "c5", games: 120 },
        { san: "e6", games: 30 },
    ];
    const result = moveShares(counts, ["e5", "e6"]);
    expect(result.total).toBe(200);
    expect(result.shares.get("e5")).toBe(0.25);
    expect(result.shares.get("e6")).toBe(0.15);
    expect(result.other).toBe(0.6);
    expect(result.topMissing).toEqual({ san: "c5", share: 0.6 });

    expect(moveShares(counts, ["c5"]).topMissing).toBeNull();
    expect(moveShares([], ["e5"])).toMatchObject({ total: 0, other: 0, topMissing: null });
});

test("games are compared with the repertoire move by move", async () => {
    const rep = tree(["e4", "e5", "Nf3", "Nc6", "Bb5"], ["e4", "c5", "Nf3"]);
    const index = indexRepertoire(rep);
    const stat = (san: string, games: number) => ({ san, games, white: games, draw: 0, black: 0 });
    const games: Record<string, ReturnType<typeof stat>[]> = {
        [rep.fen]: [stat("e4", 10), stat("d4", 1)],
        [getFenAfter(["e4"])]: [stat("e5", 5), stat("c5", 2), stat("e6", 3)],
        [getFenAfter(["e4", "e5"])]: [stat("Nf3", 3), stat("Bc4", 2)],
        [getFenAfter(["e4", "c5"])]: [stat("Nf3", 2)],
        [getFenAfter(["e4", "e5", "Nf3"])]: [stat("Nc6", 3)],
        [getFenAfter(["e4", "e5", "Nf3", "Nc6"])]: [stat("Bb5", 3)],
        [getFenAfter(["e4", "c5", "Nf3"])]: [stat("d6", 2)],
        [getFenAfter(["e4", "e5", "Nf3", "Nc6", "Bb5"])]: [stat("a6", 3)],
    };
    const issues = await collectIssues(rep.fen, 0, "white", index, async (fen) => games[fen] ?? []);
    expect(issues.map((i) => `${i.kind} ${lineText(i.line)}`)).toEqual([
        "surprise 1. e4 e6",
        "end 1. e4 e5 2. Nf3 Nc6 3. Bb5 a6",
        "deviation 1. e4 e5 2. Bc4",
        "end 1. e4 c5 2. Nf3 d6",
    ]);
    // d4 was played only once and does not count
    expect(
        childNodes({ fen: rep.fen, halfMoves: 0, line: [] }, games[rep.fen], "white", index, 2).map(
            (n) => n.san,
        ),
    ).toEqual(["e4"]);
});
