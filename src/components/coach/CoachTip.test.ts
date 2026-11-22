import { describe, expect, it } from "vitest";
import de from "@/translation/de-DE.json";
import en from "@/translation/en-US.json";
import { COACH_TIP_PLACES, type CoachTipPlace, tipHidden, tipIndex } from "./CoachTip";

describe("Coach-Tipps (1.2.24)", () => {
    it("jede Seite hat ihre Tipps auf Deutsch und Englisch, kurz", () => {
        const tr = [de.translation, en.translation] as Record<string, string>[];
        for (const [place, n] of Object.entries(COACH_TIP_PLACES))
            for (let i = 1; i <= n; i++)
                for (const t of tr) {
                    const text = t[`Coach.Tip.${place}.${i}`];
                    expect(text, `${place}.${i}`).toBeTruthy();
                    expect(text.length).toBeLessThanOrEqual(80);
                }
    });
    it("am selben Tag derselbe Tipp, immer im gültigen Bereich", () => {
        for (const place of Object.keys(COACH_TIP_PLACES) as CoachTipPlace[]) {
            expect(tipIndex(place, "2026-11-22")).toBe(tipIndex(place, "2026-11-22"));
            for (const day of ["2026-11-20", "2026-11-21", "2026-12-01"]) {
                const i = tipIndex(place, day);
                expect(i).toBeGreaterThanOrEqual(1);
                expect(i).toBeLessThanOrEqual(COACH_TIP_PLACES[place]);
            }
        }
    });
    it("weggeklickt bleibt eine Woche weg", () => {
        expect(tipHidden(undefined, "2026-11-22")).toBe(false);
        expect(tipHidden("2026-11-22", "2026-11-22")).toBe(true);
        expect(tipHidden("2026-11-16", "2026-11-22")).toBe(true);
        expect(tipHidden("2026-11-15", "2026-11-22")).toBe(false);
    });
});
