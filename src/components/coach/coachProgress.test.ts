import { describe, expect, it } from "vitest";
import de from "@/translation/de-DE.json";
import en from "@/translation/en-US.json";
import {
    computeReceipt,
    currentStreak,
    isoWeek,
    clampLock,
    lockAfter,
    streakBonusPercent,
    touchStreak,
} from "./coachProgress";

const base = {
    strength: "fairlyEasy" as const,
    brilliants: 0,
    goods: 0,
    blunders: 0,
    takebacks: 0,
    streakDays: 0,
    gameOfDay: 1,
};

describe("Serie", () => {
    it("zählt Tage in Folge und überbrückt einen Tag pro Woche", () => {
        let s = touchStreak({ last: "", days: 0, bridgedWeek: null }, "2026-11-16");
        s = touchStreak(s, "2026-11-17");
        expect(s.days).toBe(2);
        s = touchStreak(s, "2026-11-17");
        expect(s.days).toBe(2);
        // 18. ausgelassen, Montag-Woche 47: überbrückt
        s = touchStreak(s, "2026-11-19");
        expect(s.days).toBe(3);
        expect(s.bridgedWeek).toBe(isoWeek("2026-11-19"));
        // noch ein Loch in derselben Woche: Serie reißt
        s = touchStreak(s, "2026-11-21");
        expect(s.days).toBe(1);
    });

    it("gilt als gerissen, wenn zu lange nichts kam", () => {
        const s = { last: "2026-11-10", days: 9, bridgedWeek: null };
        expect(currentStreak(s, "2026-11-11")).toBe(9);
        expect(currentStreak(s, "2026-11-12")).toBe(9);
        expect(currentStreak(s, "2026-11-13")).toBe(0);
    });

    it("gibt 1 % pro Tag, höchstens 365 %", () => {
        expect(streakBonusPercent(42)).toBe(42);
        expect(streakBonusPercent(800)).toBe(365);
    });
});

describe("Kassenzettel", () => {
    it("rechnet Basis, dann Prozent-Boni auf die Basis, dann Geburtstag", () => {
        const { lines, total } = computeReceipt({
            ...base,
            result: "win",
            brilliants: 1,
            goods: 2,
            streakDays: 10,
            birthday: true,
        });
        // 20 + 50 + 30 + 20 = 120; sauber +24, Serie +12 = 156; Geburtstag x2
        expect(lines.find((l) => l.key === "clean")?.xp).toBe(24);
        expect(lines.find((l) => l.key === "streak")?.xp).toBe(12);
        expect(total).toBe(312);
    });

    it("gibt keinen Sauber-Bonus nach Rücknahme oder ??", () => {
        expect(
            computeReceipt({ ...base, result: "loss", takebacks: 1 }).lines.some(
                (l) => l.key === "clean",
            ),
        ).toBe(false);
        expect(
            computeReceipt({ ...base, result: "loss", blunders: 1 }).lines.some(
                (l) => l.key === "clean",
            ),
        ).toBe(false);
    });

    it("halbiert die Basis ab der 4. Partie am Tag", () => {
        const { total } = computeReceipt({ ...base, result: "loss", takebacks: 1, gameOfDay: 4 });
        expect(total).toBe(10);
    });

    it("sperrt nach Niederlage 3, nach Remis 1 Aufgabe", () => {
        expect(lockAfter("loss")).toBe(1);
        expect(lockAfter("draw")).toBe(0);
        expect(lockAfter("win")).toBe(0);
        expect(clampLock(3, false)).toBe(1);
        expect(clampLock(5, true)).toBe(5);
        expect(clampLock(0, false)).toBe(0);
    });

    it("hat Texte für jede Zeile", () => {
        const keys = [
            "played",
            "win",
            "draw",
            "brilliant",
            "good",
            "tired",
            "clean",
            "lambrusco",
            "streak",
            "birthday",
            "total",
        ];
        for (const t of [de.translation, en.translation] as Record<string, string>[]) {
            for (const k of keys) expect(t[`Coach.Receipt.${k}`]).toBeTruthy();
        }
    });
});
