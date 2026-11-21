import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { isBirthdayAtom } from "./coachBirthday";
import {
    advanceQuest,
    awardTrophyAtom,
    BONUS_TRACK_CHANCE,
    type CoachItemId,
    type CoachTrophyId,
    coachBestEstimateAtom,
    coachBonusTrackAtom,
    coachQuestAtom,
    coachResultsAtom,
    currentQuest,
    DAILY_QUEST_XP,
    type DailyQuestId,
    estimateStrength,
    itemsUnlockedBetween,
    strengthElo,
    trophiesForGame,
} from "./coachRewards";
import {
    type CoachStrengthId,
    coachDayAtom,
    coachXpAtom,
    levelProgress,
    today,
} from "./coachState";

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
// Die Aufgaben der Sperre sind Matt-in-1-Puzzles (Easter Egg für Aaron)
export const coachMateDrillAtom = atomWithStorage<boolean>("jbl-coach-mate-drill", false);

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
    // Bonus-Track: doppelte XP für diese Partie
    bonusTrack?: boolean;
    // XP für eine Tagesaufgabe, die diese Partie erfüllt hat
    questXp?: number;
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
    if (input.questXp) {
        lines.push({ key: "quest", xp: input.questXp, kind: "bonus" });
        total += input.questXp;
    }
    if (input.bonusTrack) {
        lines.push({ key: "bonusTrack", xp: total, kind: "bonus" });
        total *= 2;
    }
    if (input.birthday) {
        lines.push({ key: "birthday", xp: total, kind: "bonus" });
        total *= 2;
    }
    lines.push({ key: "total", xp: total, kind: "total" });
    return { lines, total };
}

// ---------- Schlimmster eigener Fehler ----------

// Nach Niederlage oder Remis ist die erste Aufgabe der schlimmste eigene Zug
// aus der Partie: „Finde den besseren Zug“.
export type CoachMistake = {
    fen: string;
    played: string;
    // Züge, die als richtig zählen (bester Zug und gleich gute)
    solutions: string[];
};

export const coachMistakeAtom = atomWithStorage<CoachMistake | null>("jbl-coach-mistake", null);

// ---------- Ereignisse ----------

// Eine Coach-Aktion an diesem Tag: hält die Serie am Leben.
export const touchStreakAtom = atom(null, (get, set) => {
    set(coachStreakAtom, touchStreak(get(coachStreakAtom), today()));
});

// Fortschritt für die Tagesaufgabe; gibt die XP zurück, wenn sie fertig wurde.
export const questEventAtom = atom(
    null,
    (get, set, event: DailyQuestId, amount?: number): number => {
        const { quest, completed } = advanceQuest(
            currentQuest(get(coachQuestAtom), today()),
            event,
            amount ?? 1,
        );
        set(coachQuestAtom, quest);
        return completed ? DAILY_QUEST_XP : 0;
    },
);

// Eine Aufgabe der Sperre ist erledigt (Puzzle oder eigener Fehler).
const finishLockTaskAtom = atom(null, (get, set, correct: boolean) => {
    const lock = get(coachLockAtom);
    if (lock > 0) set(coachLockAtom, lock - 1);
    if (lock <= 1 && get(coachMateDrillAtom)) set(coachMateDrillAtom, false);
    let xp = correct ? XP.puzzle : 0;
    if (correct) xp += set(questEventAtom, "puzzles");
    if (xp) set(coachXpAtom, get(coachXpAtom) + xp);
    set(touchStreakAtom);
    const day = get(coachDayAtom);
    const fresh = day.day === today() ? day : { day: today(), played: false, puzzles: false };
    set(coachDayAtom, { ...fresh, puzzles: true });
});

// Ein Puzzle ist fertig: zählt für die Sperre, gibt XP, wenn richtig.
export const coachPuzzleDoneAtom = atom(null, (_get, set, correct: boolean) => {
    set(finishLockTaskAtom, correct);
});

// Der eigene Fehler ist gelöst oder aufgegeben.
export const coachMistakeDoneAtom = atom(null, (_get, set, correct: boolean) => {
    set(coachMistakeAtom, null);
    set(finishLockTaskAtom, correct);
});

// Ein richtiger Zug im Repertoire-Training: 2 XP.
export const REPERTOIRE_XP = 2;
export const coachRepertoireMoveAtom = atom(null, (get, set) => {
    const xp = REPERTOIRE_XP + set(questEventAtom, "repertoire");
    set(coachXpAtom, get(coachXpAtom) + xp);
    set(touchStreakAtom);
});

export type CoachGameInput = Omit<
    ReceiptInput,
    "streakDays" | "gameOfDay" | "birthday" | "bonusTrack" | "questXp"
> & {
    mistake?: CoachMistake | null;
};

export type CoachGameSummary = {
    lines: ReceiptLine[];
    total: number;
    levelBefore: number;
    levelAfter: number;
    newItems: CoachItemId[];
    trophies: CoachTrophyId[];
    questDone: boolean;
    // Bonus-Track für die nächste Partie ausgelost
    bonusNext: boolean;
    estimate: number | null;
    newBest: boolean;
    lock: number;
};

// Eine Partie gegen JBL ist zu Ende: XP gutschreiben, Serie, Tageszähler,
// Sperre, Tagesaufgabe, Trophäen und Stärke-Schätzung.
export const finishCoachGameAtom = atom(
    null,
    (get, set, game: CoachGameInput, random: () => number = Math.random): CoachGameSummary => {
        const day = today();
        set(touchStreakAtom);
        const streakDays = currentStreak(get(coachStreakAtom), day);
        const prevDay = get(coachDayAtom);
        const fresh = prevDay.day === day ? prevDay : { day, played: false, puzzles: false };
        const gameOfDay = (fresh.games ?? 0) + 1;
        set(coachDayAtom, { ...fresh, played: true, games: gameOfDay });

        // Tagesaufgabe
        const events: DailyQuestId[] = [];
        if (game.goods > 0 || game.brilliants > 0) events.push("findGood");
        if (game.result === "win") events.push("win");
        if (game.blunders === 0 && game.takebacks === 0) events.push("clean");
        let questXp = 0;
        for (const e of events) questXp += set(questEventAtom, e);

        const bonusTrack = get(coachBonusTrackAtom);
        const birthday = get(isBirthdayAtom);
        const receipt = computeReceipt({
            ...game,
            streakDays,
            gameOfDay,
            bonusTrack,
            questXp,
            birthday,
        });
        const xpBefore = get(coachXpAtom);
        const xpAfter = xpBefore + receipt.total;
        set(coachXpAtom, xpAfter);
        // Am Geburtstag gibt es keine Pflichtaufgaben
        set(coachLockAtom, birthday ? 0 : lockAfter(game.result));
        set(
            coachMistakeAtom,
            !birthday && game.result !== "win" && game.mistake ? game.mistake : null,
        );

        const bonusNext = random() < BONUS_TRACK_CHANCE;
        set(coachBonusTrackAtom, bonusNext);

        const levelBefore = levelProgress(xpBefore).level;
        const levelAfter = levelProgress(xpAfter).level;

        const trophies = trophiesForGame({ ...game, streakDays, level: levelAfter }).filter((id) =>
            set(awardTrophyAtom, id),
        );

        const results = [
            ...get(coachResultsAtom),
            {
                elo: strengthElo(game.strength),
                score: game.result === "win" ? 1 : game.result === "draw" ? 0.5 : 0,
            },
        ].slice(-30);
        set(coachResultsAtom, results);
        const estimate = estimateStrength(results);
        const best = get(coachBestEstimateAtom);
        const newBest = estimate !== null && estimate > best;
        if (newBest) set(coachBestEstimateAtom, estimate);

        return {
            ...receipt,
            levelBefore,
            levelAfter,
            newItems: itemsUnlockedBetween(levelBefore, levelAfter),
            trophies,
            questDone: questXp > 0,
            bonusNext,
            estimate,
            newBest: newBest && best > 0,
            lock: get(coachLockAtom),
        };
    },
);
