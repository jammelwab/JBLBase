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
    it("asks for a first move in an empty white repertoire", () => {
        const scan = findGaps(tree(), new Map(), { color: "white", minShare: 0.05, maxDepth: 20 });
        expect(scan.gaps).toHaveLength(1);
        expect(scan.gaps[0]).toMatchObject({ kind: "answer", line: [], reach: 1 });
        expect(scan.leaking).toBe(1);
    });

    it("finds often played opponent moves without a line", () => {
        const root = tree(["e4", "e5", "Nf3"], ["e4", "c5", "Nf3"]);
        const counts = new Map([
            [
                fenAfter(root, ["e4"]),
                [
                    { san: "c5", games: 50 },
                    { san: "e5", games: 30 },
                    { san: "e6", games: 15 },
                    { san: "a6", games: 5 },
                ],
            ],
        ]);
        const scan = findGaps(root, counts, { color: "white", minShare: 0.1, maxDepth: 20 });
        const replies = scan.gaps.filter((g) => g.kind === "reply");
        expect(replies).toHaveLength(1);
        expect(replies[0]).toMatchObject({ move: "e6", line: ["e4"], share: 0.15 });
        expect(replies[0].reach).toBeCloseTo(0.15);
        expect(scan.leaking).toBeCloseTo(0.15);
    });

    it("finds lines that end after an opponent move", () => {
        const root = tree(["e4", "e5", "Nf3", "Nc6"], ["e4", "c5", "Nf3"]);
        const scan = findGaps(root, new Map(), { color: "white", minShare: 0.05, maxDepth: 20 });
        expect(scan.gaps.map((g) => g.line.join(" "))).toEqual(["e4 e5 Nf3 Nc6"]);
        // Without numbers it can't say how many games leave there
        expect(scan.gaps[0].exact).toBe(false);
        expect(scan.leaking).toBe(0);
        expect(scan.wanted.map((w) => w.fen)).toContain(fenAfter(root, ["e4"]));
    });

    it("suggests how a line ending after the user's move goes on, after the holes", () => {
        const root = tree(["e4", "e5", "Nf3"], ["d4"]);
        const counts = new Map([
            [
                fenAfter(root, ["e4", "e5", "Nf3"]),
                [
                    { san: "Nc6", games: 80 },
                    { san: "Nf6", games: 20 },
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
            "reply c5",
            "extend Nc6",
            "extend Nf6",
        ]);
        expect(scan.leaking).toBeCloseTo(0.5);
    });

    it("weights a black repertoire by the opponent's first moves", () => {
        const root = tree(["e4", "c5"]);
        const counts = new Map([
            [
                START,
                [
                    { san: "e4", games: 60 },
                    { san: "d4", games: 40 },
                ],
            ],
        ]);
        const scan = findGaps(root, counts, { color: "black", minShare: 0.05, maxDepth: 20 });
        expect(scan.gaps[0]).toMatchObject({ kind: "reply", move: "d4", line: [] });
        expect(scan.gaps[0].reach).toBeCloseTo(0.4);
    });

    it("stops at the depth limit", () => {
        const root = tree(["e4", "e5", "Nf3", "Nc6"]);
        const scan = findGaps(root, new Map(), { color: "white", minShare: 0.05, maxDepth: 2 });
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
