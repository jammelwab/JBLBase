import { describe, expect, it } from "vitest";
import {
    chapterNameFromFile,
    cleanComment,
    fenAfter,
    judgeMotifMove,
    levelFromTitle,
    parseExampleTitle,
    parseMotifCollection,
} from "./motifImport";
import { buildSession, countLines } from "./motifSession";

// Eigene kleine Leiter-Matt-Aufgabe im Format eines Kurs-Exports
const PGN = `[Event "1. Treppenmatt"]
[Site "?"]

{ Zwei Türme schieben den König an den Rand. } *

[Event "2. Example 1 - Variation A"]
[SetUp "1"]
[FEN "6k1/1R6/R7/8/8/8/8/2K5 w - - 0 1"]

{ Der König steht am Rand. } 1. Ra8# { Matt. } *

[Event "3. Ejemplo 1 - Variante B"]
[SetUp "1"]
[FEN "8/6k1/R7/8/8/8/8/1RK5 w - - 0 1"]

{ Zwei Züge vorher. [%cal Gb1b7] } 1. Rb7+ Kg8 (1... Kf8 2. Ra8#) (1... Kh8 { auch } 2. Ra8#) 2. Ra8# *

[Event "4. Freie Aufgabe"]
[SetUp "1"]
[FEN "6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1"]

1. Re8# *

[Event "5. Example 2 - Variation A"]
[SetUp "1"]
[FEN "6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1"]

1. Qh5 *
`;

describe("motif import", () => {
    it("reads titles", () => {
        expect(parseExampleTitle("4. Example 1 - Variation A")).toEqual({ key: "1", step: "A" });
        expect(parseExampleTitle("5. Ejemplo 12 - Variante B")).toEqual({ key: "12", step: "B" });
        expect(parseExampleTitle("1. Introduction")).toBeNull();
        expect(chapterNameFromFile("C:\\x\\01_1._Introduction.pgn")).toBe("Introduction");
        expect(levelFromTitle("3. Intermediate Mates")).toBe("intermediate");
        expect(levelFromTitle("Leichte Matts")).toBe("easy");
        expect(cleanComment(["a  [%csl Ge4] b", "c"])).toBe("a b\n\nc");
    });

    it("pairs A and B, keeps comments, builds forwarding lines", () => {
        const { collection, skipped } = parseMotifCollection("Test", [
            { name: "01_Treppe.pgn", text: PGN },
        ]);
        expect(skipped).toEqual(["Example 2 - Variation A"]);
        const [chapter] = collection.chapters;
        expect(chapter.title).toBe("Treppenmatt");
        expect(chapter.intro).toBe("Zwei Türme schieben den König an den Rand.");
        expect(chapter.patterns).toHaveLength(2);
        const [p1, solo] = chapter.patterns;
        expect(p1.title).toBe("Example 1");
        expect(p1.steps.map((s) => [s.step, s.mateIn])).toEqual([
            ["A", 1],
            ["B", 2],
        ]);
        expect(p1.steps[0].moves[0]).toEqual({ san: "Ra8#", comment: "Matt." });
        expect(p1.steps[1].intro).toBe("Zwei Züge vorher.");
        expect(p1.forwarding.map((f) => f.moves.map((m) => m.san))).toEqual([
            ["Rb7+", "Kf8", "Ra8#"],
            ["Rb7+", "Kh8", "Ra8#"],
        ]);
        expect(p1.forwarding[1].moves[1].comment).toBe("auch");
        expect(p1.forwarding[0].forwardFrom).toBe(1);
        expect(solo.title).toBe("Freie Aufgabe");
        expect(countLines(collection)).toEqual({ patterns: 2, mate1: 2, longer: 1, forwarding: 2 });
    });

    it("judges moves; any mate counts on the last move", () => {
        const { collection } = parseMotifCollection("T", [{ name: "x.pgn", text: PGN }]);
        const b = collection.chapters[0].patterns[0].steps[1];
        expect(judgeMotifMove(b, 0, b.fen, "Rb7+")).toBe("right");
        expect(judgeMotifMove(b, 0, b.fen, "Ra7+")).toBe("wrong");
        const before = fenAfter(b, 2);
        expect(judgeMotifMove(b, 2, before, "Ra8#")).toBe("right");
        expect(judgeMotifMove(b, 2, before, "Ra8")).toBe("right");
        expect(judgeMotifMove(b, 2, before, "Rb8+")).toBe("wrong");
        // Beim letzten Zug zählt jedes Matt: hier sind Re8# und (mit Turm auf d1) Rd8# möglich
        const two = {
            ...b,
            fen: "6k1/5ppp/8/8/8/8/5PPP/3RR1K1 w - - 0 1",
            moves: [{ san: "Re8#" }],
        };
        expect(judgeMotifMove(two, 0, two.fen, "Rd8#")).toBe("right");
    });

    it("builds sessions per mode", () => {
        const { collection } = parseMotifCollection("T", [{ name: "x.pgn", text: PGN }]);
        const level = collection.chapters[0].level;
        const base = { levels: [level], chapterIds: [], onlyMistakes: false, withForwarding: true };
        const rev = buildSession(collection, { ...base, mode: "reversing" });
        expect(rev.map((t) => t.line.step)).toEqual(["A", "B", "B1", "B2", "A"]);
        expect(rev[1].template?.step).toBe("A");
        expect(rev[0].template).toBeUndefined();
        const t1 = buildSession(collection, { ...base, mode: "test1" });
        expect(t1).toHaveLength(2);
        expect(t1.every((t) => !t.template)).toBe(true);
        const t2 = buildSession(collection, { ...base, mode: "test2", withForwarding: false });
        expect(t2.map((t) => t.line.step)).toEqual(["B"]);
        const bId = rev[1].line.id;
        const mistakes = buildSession(
            collection,
            { ...base, mode: "reversing", onlyMistakes: true },
            { [bId]: { ok: 0, bad: 1, last: "bad", at: "" } },
        );
        expect(mistakes.map((t) => t.line.id)).toEqual([bId]);
    });
});
