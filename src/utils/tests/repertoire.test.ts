import { INITIAL_FEN, makeFen } from "chessops/fen";
import { parseSan } from "chessops/san";
import { expect, test } from "vitest";
import { positionFromFen } from "../chessops";
import { classifyMove, countClassifications } from "../moveClassification";
import {
    findCourseConflicts,
    indexRepertoire,
    mergeCourse,
    mergeLine,
    moveShares,
    positionKey,
    repertoireStats,
    splitPgnGames,
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
