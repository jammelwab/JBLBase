import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { type CoachStrengthId, coachDayAtom, coachXpAtom, today } from "./coachState";

// ---------- Serie ----------

// Tage in Folge mit mindestens einer Coach-Aktion. Ein verpasster Tag pro
// Woche wird überbrückt.
export type CoachStreak = { last: string; days: number; bridgedWeek: string | null };

export const coachStreakAtom = atomWithStorage<CoachStreak>("jbl-coach-streak", {
    last: "",
    days: 0,
    bridgedWeek: null,
});

const MAX_STREAK_BONUS = 365;

function parseDay(day: string): Date {
    const [y, m, d] = day.split("-").map(Number);
    return new Date(y, m - 1, d);
}

export function daysBetween(from: string, to: string): number {
    return Math.round((parseDay(to).getTime() - parseDay(from).getTime()) / 86_400_000);
}

// ISO-Woche, z. B. "2026-W47"
export function isoWeek(day: string): string {
    const d = parseDay(day);
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dow = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - dow);
    const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
    return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function touchStreak(s: CoachStreak, day: string): CoachStreak {
    if (!s.last || s.days === 0) return { last: day, days: 1, bridgedWeek: null };
    const gap = daysBetween(s.last, day);
    if (gap <= 0) return s;
    if (gap === 1) return { ...s, last: day, days: s.days + 1 };
    const week = isoWeek(day);
    if (gap === 2 && s.bridgedWeek !== week)
        return { last: day, days: s.days + 1, bridgedWeek: week };
    return { last: day, days: 1, bridgedWeek: null };
}

// Die Serie, wie sie heute gilt: gerissen, wenn zu lange nichts kam.
export function currentStreak(s: CoachStreak, day: string): number {
    if (!s.last) return 0;
    const gap = daysBetween(s.last, day);
    if (gap <= 1) return s.days;
    if (gap === 2 && s.bridgedWeek !== isoWeek(day)) return s.days;
    return 0;
}

export function streakBonusPercent(days: number): number {
    return Math.max(0, Math.min(MAX_STREAK_BONUS, days));
}

// ---------- Sperre ----------

// Aufgaben, die nach einer Niederlage (3) oder einem Remis (1) noch fehlen,
// bevor man wieder gegen JBL spielen darf.
export const coachLockAtom = atomWithStorage<number>("jbl-coach-lock", 0);

export function lockAfter(result: "win" | "draw" | "loss"): number {
    return result === "loss" ? 3 : result === "draw" ? 1 : 0;
}

// ---------- Kassenzettel ----------

export const STRENGTH_FACTOR: Record<CoachStrengthId, number> = {
    veryEasy: 0.5,
    easy: 0.75,
    fairlyEasy: 1,
    medium: 1.5,
    fairlyHard: 2,
    hard: 2.5,
    veryHard: 3,
};

export const XP = {
    played: 20,
    win: 50,
    draw: 25,
    brilliant: 30,
    good: 10,
    puzzle: 10,
    cleanPercent: 20,
    lambruscoPercent: 10,
    // ab der 4. Partie am Tag halbe Basis-XP
    tiredFromGame: 4,
} as const;

export type ReceiptInput = {
    result: "win" | "draw" | "loss";
    strength: CoachStrengthId;
    brilliants: number;
    goods: number;
    blunders: number;
    takebacks: number;
    streakDays: number;
    // wievielte Partie gegen JBL heute (1 = erste)
    gameOfDay: number;
    lambrusco?: boolean;
    birthday?: boolean;
};

export type ReceiptLine = {
    key: string;
    xp: number;
    count?: number;
    percent?: number;
    kind: "base" | "bonus" | "total";
};

export function computeReceipt(input: ReceiptInput): { lines: ReceiptLine[]; total: number } {
    const factor = STRENGTH_FACTOR[input.strength] ?? 1;
    const lines: ReceiptLine[] = [{ key: "played", xp: XP.played, kind: "base" }];
    if (input.result === "win")
        lines.push({ key: "win", xp: Math.round(XP.win * factor), kind: "base" });
    if (input.result === "draw")
        lines.push({ key: "draw", xp: Math.round(XP.draw * factor), kind: "base" });
    if (input.brilliants > 0)
        lines.push({
            key: "brilliant",
            xp: input.brilliants * XP.brilliant,
            count: input.brilliants,
            kind: "base",
        });
    if (input.goods > 0)
        lines.push({ key: "good", xp: input.goods * XP.good, count: input.goods, kind: "base" });

    let base = lines.reduce((sum, l) => sum + l.xp, 0);
    if (input.gameOfDay >= XP.tiredFromGame) {
        const cut = -Math.floor(base / 2);
        lines.push({ key: "tired", xp: cut, kind: "base" });
        base += cut;
    }

    const percents: [string, number][] = [];
    if (input.blunders === 0 && input.takebacks === 0) percents.push(["clean", XP.cleanPercent]);
    if (input.lambrusco) percents.push(["lambrusco", XP.lambruscoPercent]);
    const streak = streakBonusPercent(input.streakDays);
    if (streak > 0) percents.push(["streak", streak]);
    let total = base;
    for (const [key, percent] of percents) {
        const xp = Math.round((base * percent) / 100);
        lines.push({ key, xp, percent, kind: "bonus" });
        total += xp;
    }
    if (input.birthday) {
        lines.push({ key: "birthday", xp: total, kind: "bonus" });
        total *= 2;
    }
    lines.push({ key: "total", xp: total, kind: "total" });
    return { lines, total };
}

// ---------- Ereignisse ----------

// Eine Coach-Aktion an diesem Tag: hält die Serie am Leben.
export const touchStreakAtom = atom(null, (get, set) => {
    set(coachStreakAtom, touchStreak(get(coachStreakAtom), today()));
});

// Ein Puzzle ist fertig: zählt für die Sperre, gibt XP, wenn richtig.
export const coachPuzzleDoneAtom = atom(null, (get, set, correct: boolean) => {
    const lock = get(coachLockAtom);
    if (lock > 0) set(coachLockAtom, lock - 1);
    if (correct) set(coachXpAtom, get(coachXpAtom) + XP.puzzle);
    set(touchStreakAtom);
    const day = get(coachDayAtom);
    const fresh = day.day === today() ? day : { day: today(), played: false, puzzles: false };
    set(coachDayAtom, { ...fresh, puzzles: true });
});
