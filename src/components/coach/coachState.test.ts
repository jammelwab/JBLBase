import { describe, expect, it } from "vitest";
import de from "@/translation/de-DE.json";
import en from "@/translation/en-US.json";
import { COACH_STRENGTHS, coachTitleKey, levelProgress, xpForLevel } from "./coachState";

describe("JBL Coach", () => {
    it("braucht für höhere Level immer mehr XP", () => {
        expect(xpForLevel(1)).toBe(0);
        expect(xpForLevel(2)).toBe(100);
        let step = 0;
        for (let l = 2; l < 60; l++) {
            const next = xpForLevel(l + 1) - xpForLevel(l);
            expect(next).toBeGreaterThan(step);
            step = next;
        }
    });

    it("rechnet XP in Level und Fortschritt um", () => {
        expect(levelProgress(0)).toEqual({ level: 1, intoLevel: 0, needed: 100 });
        expect(levelProgress(99).level).toBe(1);
        expect(levelProgress(100)).toEqual({ level: 2, intoLevel: 0, needed: xpForLevel(3) - 100 });
        expect(levelProgress(-5).level).toBe(1);
    });

    it("hat sieben Stärkestufen mit steigender Elo", () => {
        expect(COACH_STRENGTHS).toHaveLength(7);
        const elos = COACH_STRENGTHS.map((s) => s.elo);
        expect([...elos].sort((a, b) => a - b)).toEqual(elos);
    });

    it("hat Texte für alle Stufen und Titel auf Deutsch und Englisch", () => {
        const titles = new Set([1, 4, 6, 8, 12, 20, 50].map(coachTitleKey));
        for (const t of [de.translation, en.translation] as Record<string, string>[]) {
            for (const s of COACH_STRENGTHS) expect(t[`Coach.Strength.${s.id}`]).toBeTruthy();
            for (const k of titles) expect(t[`Coach.Title.${k}`]).toBeTruthy();
        }
    });
});
