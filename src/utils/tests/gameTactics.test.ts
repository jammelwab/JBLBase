import { describe, expect, it } from "vitest";
import { periodRange } from "../gameTactics";

describe("periodRange", () => {
    const today = new Date(2026, 10, 15);
    it("leaves everything open for all games", () => {
        expect(periodRange("all", { since: "", until: "" }, today)).toEqual({
            since: null,
            until: null,
        });
    });
    it("counts back from today", () => {
        expect(periodRange("month", { since: "", until: "" }, today).since).toBe("2026-10-16");
        expect(periodRange("year", { since: "", until: "" }, today).since).toBe("2025-11-15");
    });
    it("takes a custom range as given", () => {
        expect(periodRange("custom", { since: "2026-01-01", until: "" }, today)).toEqual({
            since: "2026-01-01",
            until: null,
        });
    });
});
