import { describe, expect, it } from "vitest";
import { isOnlyMove, notationSign } from "./coachGame";

const base = {
    annotation: "",
    allowsMateInOne: false,
    inBook: false,
    prevInBook: false,
    onlyMove: false,
};

describe("notationSign", () => {
    it("leaves theory without sign unless it is a real mistake or brilliant", () => {
        expect(notationSign({ ...base, inBook: true, prevInBook: true })).toBe("");
        expect(notationSign({ ...base, inBook: true, annotation: "?!" })).toBe("");
        expect(notationSign({ ...base, inBook: true, annotation: "??" })).toBe("??");
    });

    it("marks the first move out of book as novelty", () => {
        expect(notationSign({ ...base, prevInBook: true })).toBe("N");
        expect(notationSign({ ...base, prevInBook: true, annotation: "?" })).toBe("?");
    });

    it("marks the only move and mate in one", () => {
        expect(notationSign({ ...base, onlyMove: true })).toBe("□");
        expect(notationSign({ ...base, onlyMove: true, annotation: "!" })).toBe("!");
        expect(notationSign({ ...base, allowsMateInOne: true })).toBe("??");
    });

    it("finds the only move", () => {
        expect(
            isOnlyMove("Qd2", [
                { san: "Qd2", score: 50 },
                { san: "Qe2", score: -200 },
            ]),
        ).toBe(true);
        expect(
            isOnlyMove("Qd2", [
                { san: "Qd2", score: 50 },
                { san: "Qe2", score: 0 },
            ]),
        ).toBe(false);
        expect(
            isOnlyMove("Qe2", [
                { san: "Qd2", score: 50 },
                { san: "Qe2", score: -200 },
            ]),
        ).toBe(false);
        expect(isOnlyMove("Qd2", [{ san: "Qd2", score: 50 }])).toBe(false);
    });
});
