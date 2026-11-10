import { INITIAL_FEN, makeFen } from "chessops/fen";
import { parseSan } from "chessops/san";
import { expect, test } from "vitest";
import { positionFromFen } from "../chessops";
import { classifyMove, countClassifications } from "../moveClassification";
import {
    findCourseConflicts,
    findPosition,
    pathForLine,
    indexRepertoire,
    mergeCourse,
    mergeLine,
    mergeTree,
    missingMoves,
    moveShares,
    orderBy,
    positionKey,
    repertoireSizes,
    repertoireStats,
    repertoireMovesAt,
    repertoireWeights,
    splitPgnGames,
} from "../repertoireTree";
import {
    childNodes,
    collectIssues,
    lineText,
    lineTree,
    playLine,
    squaresToSan,
} from "../gamesTree";
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

test("the tree diagram puts every line on its own row", async () => {
    const { layoutTree } = await import("../treeLayout");
    const n = (id: string, ...children: { id: string; children: unknown[] }[]) =>
        ({ id, children }) as never;
    const { nodes, width, height } = layoutTree(n("root", n("e4", n("e5"), n("c5")), n("d4")), {
        colWidth: 100,
        rowHeight: 10,
    });
    expect(nodes.get("e5")).toMatchObject({ x: 200, y: 0, parent: "e4" });
    expect(nodes.get("c5")).toMatchObject({ x: 200, y: 10 });
    expect(nodes.get("e4")).toMatchObject({ x: 100, y: 5 });
    expect(nodes.get("d4")).toMatchObject({ x: 100, y: 20 });
    expect(nodes.get("root")).toMatchObject({ x: 0, y: 12.5 });
    expect([width, height]).toEqual([300, 30]);
});

// --- Course import

test("a PGN with several chapters is split into games", () => {
    const text =
        '\uFEFF[Event "Kurs"]\r\n[White "Kapitel 1"]\r\n\r\n1. e4 e5 *\r\n\r\n[Event "Kurs"]\n[White "Kapitel 2"]\n\n1. d4 d5 *\n';
    const games = splitPgnGames(text);
    expect(games).toHaveLength(2);
    expect(games[0]).toContain("Kapitel 1");
    expect(games[1]).toContain("1. d4 d5");
    expect(splitPgnGames("1. e4 e5 2. Nf3 *")).toEqual(["1. e4 e5 2. Nf3 *"]);
});

test("a course move against my own move is a conflict, the opponent's moves are not", () => {
    // White repertoire: 1.e4 e5 2.Nf3
    const rep = tree(["e4", "e5", "Nf3"]);
    // The course plays 2.Bc4 (own move, conflict) and also covers 1...c5 (opponent, fine)
    const course = tree(["e4", "e5", "Bc4", "Nf6"], ["e4", "c5", "Nf3"]);
    const conflicts = findCourseConflicts(rep, [{ name: "K1", root: course }], "white");
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
        courseMove: "Bc4",
        repertoireMoves: ["Nf3"],
        line: ["e4", "e5"],
        chapter: "K1",
    });
});

test("skipped conflicts keep my repertoire, everything else is added", () => {
    const rep = tree(["e4", "e5", "Nf3"]);
    const course = tree(["e4", "e5", "Bc4", "Nf6"], ["e4", "c5", "Nf3"]);
    const result = mergeCourse(rep, [{ name: "K1", root: course }], "white", new Map());
    expect(result).toEqual({ added: 2, unplaced: [] });
    expect(lines(rep)).toEqual(["e4 e5 Nf3", "e4 c5 Nf3"]);
});

test("a conflict can be added as alternative or as the new main move", () => {
    const course = tree(["e4", "e5", "Bc4", "Nf6"]);
    const [conflict] = findCourseConflicts(
        tree(["e4", "e5", "Nf3"]),
        [{ name: "K1", root: course }],
        "white",
    );

    const alt = tree(["e4", "e5", "Nf3"]);
    mergeCourse(
        alt,
        [{ name: "K1", root: course }],
        "white",
        new Map([[conflict.key, "alternative"]]),
    );
    expect(lines(alt)).toEqual(["e4 e5 Nf3", "e4 e5 Bc4 Nf6"]);

    const main = tree(["e4", "e5", "Nf3"]);
    mergeCourse(main, [{ name: "K1", root: course }], "white", new Map([[conflict.key, "main"]]));
    expect(lines(main)).toEqual(["e4 e5 Bc4 Nf6", "e4 e5 Nf3"]);
});

test("conflicts behind a skipped line are not shown", () => {
    const rep = tree(["e4", "e5", "Nf3", "Nc6", "Bb5"]);
    // 1.Nf3 Nc6 2.e4 e5 transposes to the repertoire position after 2...Nc6, where the
    // repertoire plays 3.Bb5 and the course 3.Bc4
    const course = tree(["Nf3", "Nc6", "e4", "e5", "Bc4"]);
    const chapters = [{ name: "K", root: course }];
    const conflicts = findCourseConflicts(rep, chapters, "white");
    expect(conflicts.map((c) => c.courseMove)).toEqual(["Nf3"]);

    const opened = findCourseConflicts(
        rep,
        chapters,
        "white",
        new Map([[conflicts[0].key, "alternative"]]),
    );
    expect(opened.map((c) => c.courseMove)).toEqual(["Nf3", "Bc4"]);
    expect(opened[1].repertoireMoves).toEqual(["Bb5"]);
});

test("the first new move of each new branch gets the source note", () => {
    const rep = tree(["e4", "e5"]);
    const course = tree(["e4", "e5", "Nf3", "Nc6"], ["e4", "c5", "Nf3"]);
    mergeCourse(rep, [{ name: "K", root: course }], "white", new Map(), "Quelle: Kurs");
    const e4 = rep.children[0];
    const nf3 = e4.children[0].children[0];
    expect(nf3.comment).toBe("Quelle: Kurs");
    expect(nf3.children[0].comment).toBe("");
    expect(e4.children[1].comment).toBe("Quelle: Kurs");
});

test("a chapter from a later position is attached where the repertoire reaches it", () => {
    const rep = tree(["d4", "d5", "c4"]);
    // Chapter starting after 1.d4 d5 (as with a FEN header)
    const chapterRoot = tree(["d4", "d5", "c4", "e6", "Nc3"]).children[0].children[0];
    const result = mergeCourse(rep, [{ name: "QGD", root: chapterRoot }], "white", new Map());
    expect(result.added).toBe(2);
    expect(lines(rep)).toEqual(["d4 d5 c4 e6 Nc3"]);

    const unreachable = tree(["e4", "c5", "Nf3"]).children[0];
    const missing = mergeCourse(
        rep,
        [{ name: "Sizilianisch", root: unreachable }],
        "white",
        new Map(),
    );
    expect(missing).toEqual({ added: 0, unplaced: ["Sizilianisch"] });
});

test("chapters pasted without headers are still split at their result", () => {
    expect(splitPgnGames("1. e4 e5 2. Nf3 *\n\n1. d4 d5 1-0\n1. c4 e5 1/2-1/2")).toEqual([
        "1. e4 e5 2. Nf3 *",
        "1. d4 d5 1-0",
        "1. c4 e5 1/2-1/2",
    ]);
    // A result inside a comment in the middle of a line does not split
    expect(splitPgnGames("1. e4 { like 1-0 } e5 *")).toEqual(["1. e4 { like 1-0 } e5 *"]);
});

test("moves from a chapter with its own move numbers are numbered like the repertoire", () => {
    const rep = tree(["d4", "d5", "c4"]);
    // A FEN chapter after 1.d4 d5 that starts counting at move 1 again
    const chapterRoot = tree(["d4", "d5", "c4", "e6", "Nc3"]).children[0].children[0];
    const renumber = (node: TreeNode) => {
        node.halfMoves -= 2;
        node.children.forEach(renumber);
    };
    renumber(chapterRoot);
    mergeCourse(rep, [{ name: "QGD", root: chapterRoot }], "white", new Map());
    const c4 = rep.children[0].children[0].children[0];
    expect(c4.halfMoves).toBe(3);
    expect(c4.children[0].halfMoves).toBe(4);
    expect(c4.children[0].children[0].halfMoves).toBe(5);
});

test("a line is played out for the board preview", async () => {
    const { playLine } = await import("../gamesTree");
    const result = playLine(INITIAL_FEN, ["e4", "e5", "Nf3"]);
    expect(result.fen).toBe("rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2");
    expect(result.lastMove).toEqual(["g1", "f3"]);
});

test("arrows for the board preview go from square to square", async () => {
    const { sanToSquares } = await import("../gamesTree");
    expect(sanToSquares(INITIAL_FEN, "Nf3")).toEqual(["g1", "f3"]);
    const castle = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
    expect(sanToSquares(castle, "O-O")).toEqual(["e1", "g1"]);
    expect(sanToSquares(castle, "O-O-O")).toEqual(["e1", "c1"]);
    expect(sanToSquares(INITIAL_FEN, "Nf6")).toBeNull();
});

test("repertoires are sorted into folders and can be looked at together", async () => {
    const { allFolders, buildFolderTree, combineTrees, folderItems, inFolder, normalizeFolder } =
        await import("../repertoireFolders");
    expect(normalizeFolder(" 1.d4 / Londoner System/ ")).toBe("1.d4/Londoner System");
    expect(normalizeFolder(undefined)).toBe("");

    const items = [
        { name: "Londoner", folder: "1.d4/Systeme" },
        { name: "Damengambit", folder: "1.d4" },
        { name: "Allgemein", folder: "" },
        { name: "Colle", folder: "1.D4/systeme" },
    ];
    const folders = buildFolderTree(items);
    expect(folders.items.map((i) => i.name)).toEqual(["Allgemein"]);
    expect(folders.children.map((c) => c.path)).toEqual(["1.d4"]);
    expect(folders.children[0].children[0].items.map((i) => i.name)).toEqual(["Colle", "Londoner"]);
    expect(folderItems(folders.children[0]).map((i) => i.name)).toEqual([
        "Damengambit",
        "Colle",
        "Londoner",
    ]);
    expect(allFolders(items)).toEqual(["1.d4", "1.d4/Systeme"]);
    expect(inFolder("1.d4/Systeme", "1.d4")).toBe(true);
    expect(inFolder("1.d4x", "1.d4")).toBe(false);
    expect(inFolder("anything", "")).toBe(true);

    const a = tree(["d4", "d5", "Bf4"]);
    const b = tree(["d4", "Nf6", "c4"], ["e4", "e5"]);
    const combined = combineTrees([a, b])!;
    expect(combined.children.map((c) => c.san)).toEqual(["d4", "e4"]);
    expect(combined.children[0].children.map((c) => c.san)).toEqual(["d5", "Nf6"]);
    // the originals stay as they were
    expect(a.children[0].children.map((c) => c.san)).toEqual(["d5"]);
});

test("repertoire sizes count the lines and moves behind every move", () => {
    const rep = tree(
        ["d4", "Nf6", "c4", "e6"],
        ["d4", "Nf6", "Bf4", "c5"],
        ["d4", "Nf6", "Nf3", "d5"],
        ["d4", "c5", "d5"],
    );
    const sizes = repertoireSizes(rep);
    const d4 = rep.children[0];
    expect(sizes.get(rep)).toEqual({ lines: 4, moves: 10 });
    expect(sizes.get(d4)).toEqual({ lines: 4, moves: 10 });
    expect(sizes.get(d4.children[0])).toEqual({ lines: 3, moves: 7 });
    expect(sizes.get(d4.children[1])).toEqual({ lines: 1, moves: 2 });
});

test("repertoire weights add up over transpositions", () => {
    const rep = tree(
        ["d4", "Nf6", "c4", "e6"],
        ["d4", "Nf6", "c4", "g6"],
        ["c4", "Nf6", "d4", "e6"],
        ["d4", "c5"],
    );
    const afterD4 = rep.children[0].fen;
    expect(repertoireWeights(rep).get(positionKey(afterD4))).toEqual(
        new Map([
            ["Nf6", 2],
            ["c5", 1],
        ]),
    );
    // 1.d4 Nf6 2.c4 and 1.c4 Nf6 2.d4 are the same position: e6 twice, g6 once
    const both = rep.children[0].children[0].children[0].fen;
    expect(repertoireWeights(rep).get(positionKey(both))).toEqual(
        new Map([
            ["e6", 2],
            ["g6", 1],
        ]),
    );
});

test("orderBy sorts by the scores, most first, and keeps ties in file order", () => {
    const items = ["a", "b", "c", "d"];
    const score: Record<string, number[]> = { a: [1, 5], b: [3, 0], c: [1, 9], d: [3, 0] };
    expect(orderBy(items, (i) => score[i])).toEqual([1, 3, 2, 0]);
});

test("pathForLine follows the repertoire as far as the line goes", () => {
    const rep = tree(["d4", "Nf6", "c4", "g6"], ["d4", "Nf6", "Nf3", "d5"]);
    expect(pathForLine(rep, ["d4", "Nf6", "Nf3", "d5"])).toEqual([0, 0, 1, 0]);
    expect(pathForLine(rep, ["d4", "Nf6", "Bg5"])).toEqual([0, 0]);
    expect(pathForLine(rep, ["e4"])).toEqual([]);
});

test("findPosition finds a position reached by another move order", () => {
    const rep = tree(["d4", "Nf6", "c4", "e6"], ["c4", "e5"]);
    const fen = playLine(INITIAL_FEN, ["c4", "Nf6", "d4", "e6"]).fen;
    expect(findPosition(rep, fen)).toEqual([0, 0, 0, 0]);
    expect(findPosition(rep, playLine(INITIAL_FEN, ["e4"]).fen)).toBeNull();
});

test("squaresToSan turns a dragged move into SAN", () => {
    expect(squaresToSan(INITIAL_FEN, "g1", "f3")).toBe("Nf3");
    expect(squaresToSan(INITIAL_FEN, "e2", "e5")).toBeNull();
    const castle = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
    // chessground offers both the king's square and the rook's square for castling
    expect(squaresToSan(castle, "e1", "g1")).toBe("O-O");
    expect(squaresToSan(castle, "e1", "h1")).toBe("O-O");
    expect(squaresToSan(castle, "e1", "c1")).toBe("O-O-O");
    expect(squaresToSan("7k/P7/8/8/8/8/8/K7 w - - 0 1", "a7", "a8")).toBe("a8=Q+");
});

test("lineTree builds a single line to add to a repertoire", () => {
    const line = lineTree(INITIAL_FEN, 0, ["e4", "c5", "Nf3"]);
    expect(lines(line)).toEqual(["e4 c5 Nf3"]);
    expect(line.children[0].children[0].halfMoves).toBe(2);
    const rep = tree(["e4", "e5"]);
    const result = mergeLine(rep, line, [0, 0, 0]);
    expect(result).toMatchObject({ ok: true, added: 2 });
    expect(lines(rep)).toEqual(["e4 e5", "e4 c5 Nf3"]);
});

test("repertoireMovesAt adds up the moves of several repertoires in one position", () => {
    const a = tree(["d4", "Nf6", "c4", "g6"], ["d4", "Nf6", "Nf3", "g6"], ["d4", "d5"]);
    const b = tree(["d4", "Nf6", "c4", "e6"], ["e4", "c5"]);
    const sources = [
        { name: "A", color: "black" as const, weights: repertoireWeights(a) },
        { name: "B", color: "black" as const, weights: repertoireWeights(b) },
    ];
    const afterD4 = playLine(INITIAL_FEN, ["d4"]).fen;
    expect(repertoireMovesAt(sources, afterD4)).toEqual([
        {
            move: "Nf6",
            lines: 3,
            repertoires: [
                { name: "A", color: "black" },
                { name: "B", color: "black" },
            ],
        },
        { move: "d5", lines: 1, repertoires: [{ name: "A", color: "black" }] },
    ]);
    expect(repertoireMovesAt(sources, playLine(INITIAL_FEN, ["a3"]).fen)).toEqual([]);
});

test("the main repertoire gets every move of the others, once", () => {
    const main = tree(["e4", "e5", "Nf3"]);
    const englund = tree(["d4", "e5", "dxe5", "Nc6"], ["d4", "e5", "dxe5", "d6"]);
    expect(missingMoves(main, englund)).toBe(5);
    expect(missingMoves(main, tree(["e4", "e5"]))).toBe(0);
    expect(mergeTree(main, englund)).toBe(5);
    expect(lines(main)).toEqual(["e4 e5 Nf3", "d4 e5 dxe5 Nc6", "d4 e5 dxe5 d6"]);
    // nothing left to add, and merging again changes nothing
    expect(missingMoves(main, englund)).toBe(0);
    expect(mergeTree(main, englund)).toBe(0);
    // the source is left as it was
    expect(lines(englund)).toEqual(["d4 e5 dxe5 Nc6", "d4 e5 dxe5 d6"]);
});

test("the main repertoire is found by its mark or by its name", async () => {
    const { findMainRepertoire } = await import("../repertoireFolders");
    const rep = (name: string, folder = "", extra = {}) => ({
        name,
        owner: "Spieler",
        color: "white" as const,
        folder,
        ...extra,
    });
    const items = [rep("Englund"), rep("Ich Weiß"), rep("Spieler Weiß", "Kurse")];
    // a repertoire in a folder is not the main one, even with the right name
    expect(findMainRepertoire(items, "Spieler", "white")).toBeUndefined();
    // the main user was called "Ich" before a name was set
    expect(findMainRepertoire(items, "spieler", "white", ["Ich"])?.name).toBe("Ich Weiß");
    expect(findMainRepertoire(items, "Spieler", "black", ["Ich"])).toBeUndefined();
    // a marked repertoire wins, whatever it is called
    const marked = [...items, rep("Alles", "Kurse", { main: true })];
    expect(findMainRepertoire(marked, "Spieler", "white", ["Ich"])?.name).toBe("Alles");
    expect(findMainRepertoire([rep("Spieler White")], "Spieler", "white")?.name).toBe(
        "Spieler White",
    );
});

test("explorer dots mark the most played moves where they differ from the repertoire", async () => {
    const { explorerHints, topMove } = await import("../repertoireTree");
    expect(
        topMove([
            { san: "Bf4", games: 10 },
            { san: "Nf3", games: 30 },
        ]),
    ).toBe("Nf3");
    expect(topMove([{ san: "Nf3", games: 0 }])).toBeUndefined();
    expect(topMove(undefined)).toBeUndefined();

    const moves = ["Bf4", "Nf3", "e3"];
    // the same move as the repertoire's main move gets no dot
    expect(explorerHints(moves, { lichess: "Bf4", master: "Bf4" })).toEqual({ missing: [] });
    expect(explorerHints(moves, { lichess: "Nf3", master: "e3" })).toEqual({
        lichess: "Nf3",
        master: "e3",
        missing: [],
    });
    // moves the repertoire doesn't have are listed once
    expect(explorerHints(moves, { lichess: "Nc3", master: "Nc3" })).toEqual({
        lichess: "Nc3",
        master: "Nc3",
        missing: ["Nc3"],
    });
    expect(explorerHints([], { lichess: "e4" })).toEqual({ lichess: "e4", missing: ["e4"] });
});
