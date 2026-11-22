import { describe, expect, it } from "vitest";
import de from "@/translation/de-DE.json";
import en from "@/translation/en-US.json";
import {
    COACH_STRENGTHS,
    coachTitleKey,
    levelProgress,
    nextCoachStep,
    nextCoachTask,
    REPS_PER_DAY,
    today,
    xpForLevel,
} from "./coachState";

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

describe("nächste Coach-Aufgabe", () => {
    const now = new Date(2026, 10, 20, 12);
    const day = (played: boolean, puzzles: boolean, d = "2026-11-20") => ({
        day: d,
        played,
        puzzles,
    });

    it("nimmt erst das Repertoire, dann die Partie, dann Puzzles", () => {
        expect(nextCoachTask(4, day(false, false), now)).toBe("repertoire");
        expect(nextCoachTask(0, day(false, false), now)).toBe("play");
        expect(nextCoachTask(0, day(true, false), now)).toBe("puzzles");
        expect(nextCoachTask(0, day(true, true), now)).toBe("done");
    });

    it("fängt an einem neuen Tag wieder von vorn an", () => {
        expect(nextCoachTask(0, day(true, true, "2026-11-19"), now)).toBe("play");
        expect(today(now)).toBe("2026-11-20");
    });

    it("schickt nach einer Niederlage erst zu den Puzzles", () => {
        expect(nextCoachTask(5, day(false, false), now, 3)).toBe("puzzles");
        expect(nextCoachTask(5, day(false, false), now, 0)).toBe("repertoire");
    });
});

describe("nächster Schritt auf der Coach-Seite", () => {
    const now = new Date(2026, 10, 20, 12);
    const base = {
        next: "play" as const,
        lock: 0,
        hasMistake: false,
        hasLesson: false,
        boss: false,
        questDone: false,
    };

    it("hakt das Repertoire nach 10 Zügen am Tag ab, auch wenn noch mehr fällig ist", () => {
        const day = { day: "2026-11-20", played: false, puzzles: false };
        expect(nextCoachTask(300, { ...day, reps: REPS_PER_DAY - 1 }, now)).toBe("repertoire");
        expect(nextCoachTask(300, { ...day, reps: REPS_PER_DAY }, now)).toBe("play");
        // Züge von gestern zählen nicht
        expect(nextCoachTask(300, { ...day, day: "2026-11-19", reps: 50 }, now)).toBe("repertoire");
    });

    it("zeigt genau einen Schritt in fester Reihenfolge", () => {
        expect(nextCoachStep({ ...base, lock: 2, hasMistake: true, hasLesson: true })).toBe(
            "mistake",
        );
        expect(nextCoachStep({ ...base, lock: 2, boss: true })).toBe("locked");
        expect(nextCoachStep({ ...base, hasLesson: true, boss: true })).toBe("lesson");
        expect(nextCoachStep({ ...base, boss: true })).toBe("boss");
        expect(nextCoachStep(base)).toBe("play");
        expect(nextCoachStep({ ...base, next: "done" })).toBe("quest");
        expect(nextCoachStep({ ...base, next: "done", questDone: true })).toBe("done");
    });
});
