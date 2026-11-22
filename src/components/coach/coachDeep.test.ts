import { describe, expect, it } from "vitest";
import { countReactions } from "./coachCloud";
import { lineSteps, mateInFromEval, moveNumber, type ReportMove, reportMoments } from "./coachDeep";

const move = (ply: number, reaction: ReportMove["reaction"], sign = ""): ReportMove => ({
    reaction,
    ply,
    san: "e4",
    best: null,
    sign,
    motif: null,
    motifText: null,
});

describe("coachDeep", () => {
    it("reads a mate for the opponent from the eval", () => {
        expect(mateInFromEval("-M3")).toBe(3);
        expect(mateInFromEval("+M2")).toBeNull();
        expect(mateInFromEval("-1.5")).toBeNull();
    });

    it("picks the three worst moments in game order", () => {
        const moves = [
            move(1, "book"),
            move(3, "dubious", "?!"),
            move(5, "blunder", "??"),
            move(7, "mistake", "?"),
            move(9, "dubious", "?!"),
            move(11, "missedMate", "??"),
        ];
        expect(reportMoments(moves).map((m) => m.ply)).toEqual([5, 7, 11]);
    });

    it("writes move numbers", () => {
        expect(moveNumber(1)).toBe("1.");
        expect(moveNumber(4)).toBe("2...");
    });

    it("counts reactions for the report", () => {
        expect(
            countReactions([
                "book",
                "solid",
                "brilliant",
                "good",
                "dubious",
                "missedMate",
                "blunder",
            ]),
        ).toEqual({ book: 1, solid: 1, good: 2, dubious: 1, mistake: 0, blunder: 2 });
    });
});

describe("lineSteps", () => {
    it("walks the engine line up to four half-moves", () => {
        const fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
        const steps = lineSteps(fen, ["e5", "Nf3", "Nc6", "Bb5", "a6"]);
        expect(steps.map((s) => s.san)).toEqual(["e5", "Nf3", "Nc6", "Bb5"]);
        expect(steps[1]).toMatchObject({ from: "g1", to: "f3" });
        expect(lineSteps(fen, ["e5", "Qxf7"])).toHaveLength(1);
    });
});
