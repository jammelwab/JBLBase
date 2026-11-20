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

// Gesamt-XP. In Etappe 1 nur Anzeige, gesammelt wird ab Etappe 3.
export const coachXpAtom = atomWithStorage<number>("jbl-coach-xp", 0);

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
