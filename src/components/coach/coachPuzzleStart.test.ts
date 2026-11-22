import { describe, expect, it } from "vitest";
import { coachPuzzleElo, puzzleSpans } from "./coachPuzzleStart";

describe("coachPuzzleElo", () => {
    it("falls back to the best estimate, then the strength", () => {
        expect(coachPuzzleElo([], 1430, "medium")).toBe(1450);
        expect(coachPuzzleElo([], 0, "medium")).toBeGreaterThanOrEqual(500);
    });
    it("uses the performance from the games when there are enough", () => {
        const results = Array.from({ length: 6 }, () => ({ elo: 1200, score: 0.5 }));
        expect(coachPuzzleElo(results, 2000, "medium")).toBe(1200);
    });
    it("widens the rating window step by step", () => {
        expect(puzzleSpans(1200)[0]).toEqual([1100, 1300]);
        expect(puzzleSpans(300)[3]).toEqual([0, 1300]);
    });
});
