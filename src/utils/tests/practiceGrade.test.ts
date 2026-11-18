import { describe, expect, it } from "vitest";
import { autoGrade } from "../practiceGrade";

describe("autoGrade", () => {
    it("gives Easy for a correct move under 30 seconds", () => {
        expect(autoGrade("time", 0)).toBe(4);
        expect(autoGrade("time", 29_999)).toBe(4);
    });

    it("gives Good for a correct move of 30 seconds or more", () => {
        expect(autoGrade("time", 30_000)).toBe(3);
        expect(autoGrade("time", 120_000)).toBe(3);
    });

    it("falls back to Good when the time is unknown", () => {
        expect(autoGrade("time", undefined)).toBe(3);
    });

    it("gives Hard when the move was only right on the second try", () => {
        expect(autoGrade("time", 5_000, 1)).toBe(2);
        expect(autoGrade("time", 50_000, 1)).toBe(2);
    });

    it("keeps the fixed grades and manual mode", () => {
        expect(autoGrade("none", 1000)).toBeNull();
        expect(autoGrade("2", 1000)).toBe(2);
        expect(autoGrade("4", 60_000)).toBe(4);
    });
});
