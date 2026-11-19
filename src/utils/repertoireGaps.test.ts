import { describe, expect, it } from "vitest";
import { findGaps, mostPlayed } from "./repertoireGaps";
import { lineTree } from "./gamesTree";
import { mergeTree } from "./repertoireTree";
import { defaultTree } from "./treeReducer";

const START = defaultTree().root.fen;

function tree(...lines: string[][]) {
    const root = defaultTree().root;
    for (const line of lines) mergeTree(root, lineTree(START, 0, line));
    return root;
}

function fenAfter(root: ReturnType<typeof tree>, line: string[]) {
    let node = root;
    for (const san of line) node = node.children.find((c) => c.san === san)!;
    return node.fen;
}

describe("findGaps", () => {
    it("finds nothing in an empty repertoire: the own first move is no gap", () => {
        const scan = findGaps(tree(), new Map(), { color: "white", minShare: 0.05, maxDepth: 20 });
        expect(scan.gaps).toHaveLength(0);
        expect(scan.leaking).toBe(0);
    });

    it("finds often played opponent moves without a line", () => {
        const root = tree(["e4", "e5", "Nf3", "Nc6", "Bb5"], ["e4", "e5", "Nf3", "d6", "d4"]);
        const counts = new Map([
            [
                fenAfter(root, ["e4"]),
                [
                    { san: "e5", games: 50 },
                    { san: "c5", games: 50 },
                ],
            ],
            [
                fenAfter(root, ["e4", "e5", "Nf3"]),
                [
                    { san: "Nc6", games: 70 },
                    { san: "d6", games: 10 },
                    { san: "Nf6", games: 15 },
                    { san: "a6", games: 5 },
                ],
            ],
        ]);
        const scan = findGaps(root, counts, { color: "white", minShare: 0.1, maxDepth: 20 });
        const replies = scan.gaps.filter((g) => g.kind === "reply");
        expect(replies).toHaveLength(1);
        expect(replies[0]).toMatchObject({ move: "Nf6", line: ["e4", "e5", "Nf3"], share: 0.15 });
        // 1...e5 is half of the games, Nf6 15 % of those
        expect(replies[0].reach).toBeCloseTo(0.075);
        expect(scan.leaking).toBeCloseTo(0.075);
    });

    it("ignores move 1: not covering 1...c5 in a white repertoire is no gap", () => {
        const root = tree(["e4", "e5", "Nf3"]);
        const counts = new Map([
            [
                fenAfter(root, ["e4"]),
                [
                    { san: "c5", games: 50 },
                    { san: "e5", games: 50 },
                ],
            ],
        ]);
        const scan = findGaps(root, counts, { color: "white", minShare: 0.05, maxDepth: 20 });
        expect(scan.gaps.filter((g) => g.move === "c5")).toHaveLength(0);
    });

    it("ignores the user's own moves: a line ending after an opponent move is no gap", () => {
        const root = tree(["e4", "e5", "Nf3", "Nc6"], ["d4", "d5", "c4"]);
        const scan = findGaps(root, new Map(), { color: "white", minShare: 0.05, maxDepth: 20 });
        expect(scan.gaps).toHaveLength(0);
        expect(scan.wanted.map((w) => w.fen)).toContain(fenAfter(root, ["e4", "e5", "Nf3"]));
        // The user's own positions need no numbers
        expect(scan.wanted.map((w) => w.fen)).not.toContain(
            fenAfter(root, ["e4", "e5", "Nf3", "Nc6"]),
        );
    });

    it("suggests how a line ending after the user's move goes on, after the holes", () => {
        const root = tree(["e4", "e5", "Nf3"], ["e4", "c5", "Nf3", "d6", "d4"]);
        const counts = new Map([
            [
                fenAfter(root, ["e4", "e5", "Nf3"]),
                [
                    { san: "Nc6", games: 80 },
                    { san: "Nf6", games: 20 },
                ],
            ],
            [
                fenAfter(root, ["e4", "c5", "Nf3"]),
                [
                    { san: "d6", games: 50 },
                    { san: "Nc6", games: 50 },
                ],
            ],
            [
                fenAfter(root, ["e4"]),
                [
                    { san: "e5", games: 50 },
                    { san: "c5", games: 50 },
                ],
            ],
        ]);
        const scan = findGaps(root, counts, { color: "white", minShare: 0.1, maxDepth: 20 });
        expect(scan.gaps.map((g) => `${g.kind} ${g.move ?? ""}`)).toEqual([
            "reply Nc6",
            "extend Nc6",
            "extend Nf6",
        ]);
        expect(scan.leaking).toBeCloseTo(0.25);
    });

    it("finds missing white moves in a black repertoire, from move 2 on", () => {
        const root = tree(["e4", "c5", "Nf3", "d6"]);
        const counts = new Map([
            [
                START,
                [
                    { san: "e4", games: 60 },
                    { san: "d4", games: 40 },
                ],
            ],
            [
                fenAfter(root, ["e4", "c5"]),
                [
                    { san: "Nf3", games: 70 },
                    { san: "Nc3", games: 30 },
                ],
            ],
        ]);
        const scan = findGaps(root, counts, { color: "black", minShare: 0.05, maxDepth: 20 });
        // 1.d4 is move 1 and left out; 2.Nc3 is a white move without an answer
        expect(scan.gaps.map((g) => g.move)).toEqual(["Nc3"]);
        expect(scan.gaps[0]).toMatchObject({ kind: "reply", line: ["e4", "c5"] });
        expect(scan.gaps[0].reach).toBeCloseTo(0.18);
        // Black moves are the user's own and never a gap
        expect(scan.gaps.every((g) => g.fen.split(" ")[1] === "w")).toBe(true);
    });

    it("stops at the depth limit", () => {
        const root = tree(["e4", "e5", "Nf3", "Nc6"]);
        const counts = new Map([
            [
                fenAfter(root, ["e4", "e5", "Nf3"]),
                [
                    { san: "Nc6", games: 50 },
                    { san: "Nf6", games: 50 },
                ],
            ],
        ]);
        const scan = findGaps(root, counts, { color: "white", minShare: 0.05, maxDepth: 2 });
        expect(scan.gaps).toHaveLength(0);
    });
});

describe("mostPlayed", () => {
    it("picks the move with the most games", () => {
        expect(
            mostPlayed([
                { san: "e4", games: 3 },
                { san: "d4", games: 1 },
            ]),
        ).toEqual({ san: "e4", share: 0.75 });
        expect(mostPlayed([])).toBeNull();
    });
});
