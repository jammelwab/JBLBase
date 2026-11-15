// The user's own puzzle rating and statistics, and the rules of the streak mode.
// Everything here is pure, reading and writing the file lives in usePuzzleStats.

export type PuzzleMode = "normal" | "streak";

export interface StreakRecord {
    /** ISO date of the moment the streak ended. */
    date: string;
    length: number;
    /** Rating of the hardest puzzle solved in the streak, 0 if none was solved. */
    topRating: number;
}

export interface EloPoint {
    date: string;
    elo: number;
}

export interface PuzzleStats {
    version: 1;
    elo: number;
    peakElo: number;
    attempts: number;
    solved: number;
    failed: number;
    /** Time spent on all rated puzzles, in milliseconds. */
    timeMs: number;
    bestStreak: number;
    /** The streak that is running right now. */
    run: { length: number; topRating: number };
    /** Finished streaks, oldest first. */
    streaks: StreakRecord[];
    /** The rating after each puzzle, oldest first. */
    history: EloPoint[];
}

export const START_ELO = 1500;
export const MIN_PUZZLE_RATING = 600;
export const MAX_PUZZLE_RATING = 3000;
/** A streak starts this far below the user's rating. */
export const STREAK_HEAD_START = 400;
/** Each solved puzzle raises the next one by this much. */
export const STREAK_STEP = 50;

const MAX_STREAKS = 100;
const MAX_HISTORY = 500;
/** The rating moves fast for the first puzzles and settles afterwards. */
const PROVISIONAL_ATTEMPTS = 20;

export function defaultPuzzleStats(): PuzzleStats {
    return {
        version: 1,
        elo: START_ELO,
        peakElo: START_ELO,
        attempts: 0,
        solved: 0,
        failed: 0,
        timeMs: 0,
        bestStreak: 0,
        run: { length: 0, topRating: 0 },
        streaks: [],
        history: [],
    };
}

function num(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Reads stored statistics, falling back to defaults for anything missing or broken. */
export function parsePuzzleStats(raw: unknown): PuzzleStats {
    const base = defaultPuzzleStats();
    if (typeof raw !== "object" || raw === null) return base;
    const r = raw as Record<string, unknown>;
    const run = (typeof r.run === "object" && r.run !== null ? r.run : {}) as Record<
        string,
        unknown
    >;
    const elo = num(r.elo, base.elo);
    return {
        version: 1,
        elo,
        peakElo: Math.max(elo, num(r.peakElo, elo)),
        attempts: num(r.attempts, 0),
        solved: num(r.solved, 0),
        failed: num(r.failed, 0),
        timeMs: num(r.timeMs, 0),
        bestStreak: num(r.bestStreak, 0),
        run: { length: num(run.length, 0), topRating: num(run.topRating, 0) },
        streaks: Array.isArray(r.streaks)
            ? r.streaks
                  .filter((s) => typeof s === "object" && s !== null)
                  .map((s) => ({
                      date: String(s.date ?? ""),
                      length: num(s.length, 0),
                      topRating: num(s.topRating, 0),
                  }))
            : [],
        history: Array.isArray(r.history)
            ? r.history
                  .filter((p) => typeof p === "object" && p !== null)
                  .map((p) => ({ date: String(p.date ?? ""), elo: num(p.elo, START_ELO) }))
            : [],
    };
}

/** Chance that a player rated `elo` solves a puzzle rated `rating`. */
export function expectedScore(elo: number, rating: number): number {
    return 1 / (1 + 10 ** ((rating - elo) / 400));
}

export function kFactor(attempts: number): number {
    return attempts < PROVISIONAL_ATTEMPTS ? 40 : 20;
}

export function nextElo(elo: number, rating: number, correct: boolean, attempts: number): number {
    const change = kFactor(attempts) * ((correct ? 1 : 0) - expectedScore(elo, rating));
    return Math.max(100, Math.round(elo + change));
}

export interface Attempt {
    rating: number;
    correct: boolean;
    timeMs: number;
    /** Whether the puzzle was part of a streak. */
    streak: boolean;
    date: string;
}

/** The statistics after one more puzzle. A wrong answer in a streak ends it. */
export function recordAttempt(stats: PuzzleStats, attempt: Attempt): PuzzleStats {
    const elo = nextElo(stats.elo, attempt.rating, attempt.correct, stats.attempts);
    const next: PuzzleStats = {
        ...stats,
        elo,
        peakElo: Math.max(stats.peakElo, elo),
        attempts: stats.attempts + 1,
        solved: stats.solved + (attempt.correct ? 1 : 0),
        failed: stats.failed + (attempt.correct ? 0 : 1),
        timeMs: stats.timeMs + Math.max(0, attempt.timeMs),
        history: [...stats.history, { date: attempt.date, elo }].slice(-MAX_HISTORY),
    };
    if (!attempt.streak) return next;

    if (attempt.correct) {
        const length = stats.run.length + 1;
        next.run = { length, topRating: Math.max(stats.run.topRating, attempt.rating) };
        next.bestStreak = Math.max(stats.bestStreak, length);
    } else {
        next.streaks = [...stats.streaks, { date: attempt.date, ...stats.run }].slice(-MAX_STREAKS);
        next.run = { length: 0, topRating: 0 };
    }
    return next;
}

function clampRating(rating: number): number {
    return Math.min(MAX_PUZZLE_RATING, Math.max(MIN_PUZZLE_RATING, rating));
}

/** Where a new streak starts: well below the user's rating, so the first ones are easy. */
export function streakStartRating(elo: number): number {
    return clampRating(Math.round((elo - STREAK_HEAD_START) / 50) * 50);
}

/** The rating the next puzzle of the running streak should have. */
export function streakTargetRating(stats: PuzzleStats): number {
    return clampRating(streakStartRating(stats.elo) + stats.run.length * STREAK_STEP);
}

/**
 * Rating spans to ask the database for, the narrowest first. Small databases
 * (own tactics) rarely have a puzzle at the exact rating, so the span widens.
 */
export function streakRatingSpans(target: number): [number, number][] {
    const spans = [25, 75, 150, 300, 600].map((width): [number, number] => [
        Math.max(0, target - width),
        target + width,
    ]);
    spans.push([0, 4000]);
    return spans;
}

export function accuracyPercent(stats: PuzzleStats): number | null {
    return stats.attempts > 0 ? Math.round((stats.solved / stats.attempts) * 100) : null;
}
