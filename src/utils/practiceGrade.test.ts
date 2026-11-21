import { describe, expect, it } from "vitest";
import { knownOnFirstTry } from "./practiceGrade";

describe("knownOnFirstTry", () => {
    it("counts a correct move with no wrong tries", () => {
        expect(knownOnFirstTry("correct", undefined)).toBe(true);
        expect(knownOnFirstTry("correct", 0)).toBe(true);
    });
    it("skips a second-try answer and other phases", () => {
        expect(knownOnFirstTry("correct", 1)).toBe(false);
        expect(knownOnFirstTry("waiting", undefined)).toBe(false);
        expect(knownOnFirstTry("incorrect", undefined)).toBe(false);
    });
});
