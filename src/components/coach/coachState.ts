import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";

// Sieben Stärkestufen. Unter 1320 Elo kann Stockfish nicht begrenzen,
// dort wählt JBL später selbst aus mehreren Kandidatenzügen.
export const COACH_STRENGTHS = [
    { id: "veryEasy", elo: 600 },
    { id: "easy", elo: 900 },
    { id: "fairlyEasy", elo: 1200 },
    { id: "medium", elo: 1500 },
    { id: "fairlyHard", elo: 1900 },
    { id: "hard", elo: 2300 },
    { id: "veryHard", elo: 2800 },
] as const;

export type CoachStrengthId = (typeof COACH_STRENGTHS)[number]["id"];

export const coachStrengthAtom = atomWithStorage<CoachStrengthId>(
    "jbl-coach-strength",
    "fairlyEasy",
);

// XP, die auf diesem Rechner gesammelt wurden, und die der anderen Rechner
// desselben Kontos (aus dem Coach-Sync). Jeder Rechner schreibt nur seinen
// eigenen Anteil, so geht beim Abgleich nichts verloren.
export const coachXpOwnAtom = atomWithStorage<number>("jbl-coach-xp", 0);
export const coachXpOthersAtom = atomWithStorage<number>("jbl-coach-xp-others", 0);

// Gesamt-XP aus Partien gegen JBL, Puzzles und Training. Schreiben setzt die
// Summe; der Unterschied landet im eigenen Anteil.
export const coachXpAtom = atom(
    (get) => get(coachXpOwnAtom) + get(coachXpOthersAtom),
    (get, set, total: number) => {
        set(coachXpOwnAtom, get(coachXpOwnAtom) + (total - get(coachXpAtom)));
    },
);

// XP, die man insgesamt braucht, um Level n zu erreichen (Level 1 ab 0 XP).
export function xpForLevel(level: number): number {
    if (level <= 1) return 0;
    return Math.round(100 * (level - 1) ** 1.8);
}

export function levelProgress(totalXp: number): {
    level: number;
    intoLevel: number;
    needed: number;
} {
    const xp = Math.max(0, Math.floor(totalXp));
    let level = 1;
    while (xpForLevel(level + 1) <= xp) level++;
    const start = xpForLevel(level);
    return { level, intoLevel: xp - start, needed: xpForLevel(level + 1) - start };
}

// Titel je Level-Stufe, wie im Konzept.
const TITLES: [number, string][] = [
    [1, "PawnPusher"],
    [4, "KnightFan"],
    [6, "BishopLover"],
    [8, "RookTactician"],
    [12, "QueenStrategist"],
    [20, "KingMaker"],
];

export function coachTitleKey(level: number): string {
    let key = TITLES[0][1];
    for (const [from, k] of TITLES) if (level >= from) key = k;
    return key;
}

// Was heute schon erledigt ist: gezählt, wenn eine Partie oder ein Puzzle
// wirklich fertig ist.
// reps: heute auf Anhieb richtig gewusste Repertoire-Züge.
export type CoachDay = {
    day: string;
    played: boolean;
    puzzles: boolean;
    games?: number;
    reps?: number;
};

// So viele Repertoire-Züge am Tag reichen für die Aufgabe, auch wenn noch
// mehr Stellungen fällig sind (sonst wäre sie bei großen Repertoires nie fertig).
export const REPS_PER_DAY = 10;

export function repsToday(day: CoachDay, now = new Date()): number {
    return day.day === today(now) ? (day.reps ?? 0) : 0;
}

export const coachDayAtom = atomWithStorage<CoachDay>("jbl-coach-day", {
    day: "",
    played: false,
    puzzles: false,
});

export function today(now = new Date()): string {
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${now.getFullYear()}-${m}-${d}`;
}

export type CoachTaskId = "repertoire" | "play" | "puzzles" | "done";

// Reihenfolge: fällige Repertoire-Stellungen zuerst, dann eine Partie gegen
// JBL, dann Puzzles. Ein neuer Tag fängt wieder von vorn an.
// Nach einer Niederlage sind erst Aufgaben dran (lock > 0): dann sind Puzzles
// die nächste Aufgabe und „Gegen JBL spielen“ ist gesperrt.
export function coachTasks(
    dueCount: number,
    day: CoachDay,
    now = new Date(),
    lock = 0,
): { id: Exclude<CoachTaskId, "done">; done: boolean; locked?: boolean }[] {
    const fresh = day.day === today(now);
    return [
        { id: "repertoire", done: dueCount === 0 || repsToday(day, now) >= REPS_PER_DAY },
        { id: "play", done: fresh && day.played, locked: lock > 0 },
        { id: "puzzles", done: lock === 0 && fresh && day.puzzles },
    ];
}

export function nextCoachTask(
    dueCount: number,
    day: CoachDay,
    now = new Date(),
    lock = 0,
): CoachTaskId {
    if (lock > 0) return "puzzles";
    return coachTasks(dueCount, day, now, lock).find((t) => !t.done)?.id ?? "done";
}

// Der eine nächste Schritt, den Startkarte und Coach-Seite groß zeigen.
// Reihenfolge: Sperre (erst der eigene Fehler, dann Puzzles), neue Lektion,
// Boss-Challenge, die drei Tagesaufgaben, dann die Tagesaufgabe für XP.
export type CoachStepId =
    | "mistake"
    | "locked"
    | "lesson"
    | "boss"
    | "repertoire"
    | "play"
    | "puzzles"
    | "quest"
    // Tagesplan geschafft: der weitere Pfad (1.2.15)
    | "path"
    | "done";

export type CoachStepInput = {
    next: CoachTaskId;
    lock: number;
    hasMistake: boolean;
    hasLesson: boolean;
    boss: boolean;
    questDone: boolean;
};

export function nextCoachStep(i: CoachStepInput): CoachStepId {
    if (i.lock > 0) return i.hasMistake ? "mistake" : "locked";
    if (i.hasLesson) return "lesson";
    if (i.boss) return "boss";
    if (i.next !== "done") return i.next;
    return i.questDone ? "path" : "quest";
}
