import { expect, test } from "vitest";
import {
    defaultPuzzleStats,
    expectedScore,
    nextElo,
    parsePuzzleStats,
    recordAttempt,
    START_ELO,
    STREAK_STEP,
    streakRatingSpans,
    streakStartRating,
    streakTargetRating,
} from "@/utils/puzzleStats";

const DATE = "2026-11-12T12:00:00.000Z";

function attempt(rating: number, correct: boolean, streak = true) {
    return { rating, correct, streak, timeMs: 5000, date: DATE };
}

test("an equally rated puzzle is a coin flip", () => {
    expect(expectedScore(1500, 1500)).toBeCloseTo(0.5);
    expect(expectedScore(1500, 1900)).toBeLessThan(0.1);
});

test("the rating rises when solving and falls when failing", () => {
    expect(nextElo(1500, 1500, true, 0)).toBe(1520);
    expect(nextElo(1500, 1500, false, 0)).toBe(1480);
    // After the first puzzles the rating moves in smaller steps
    expect(nextElo(1500, 1500, true, 50)).toBe(1510);
    // Solving a far too easy puzzle is worth almost nothing
    expect(nextElo(1500, 700, true, 50)).toBe(1500);
});

test("each solved puzzle makes the next one harder", () => {
    let stats = defaultPuzzleStats();
    const start = streakStartRating(START_ELO);
    expect(start).toBe(1100);
    expect(streakTargetRating(stats)).toBe(start);

    const targets: number[] = [];
    for (let i = 0; i < 5; i++) {
        const target = streakTargetRating(stats);
        targets.push(target);
        stats = recordAttempt(stats, attempt(target, true));
    }
    for (let i = 1; i < targets.length; i++) {
        expect(targets[i]).toBeGreaterThan(targets[i - 1]);
    }
    expect(stats.run.length).toBe(5);
    expect(stats.bestStreak).toBe(5);
    expect(stats.solved).toBe(5);
});

test("a wrong answer ends the streak and resets the difficulty", () => {
    let stats = defaultPuzzleStats();
    for (let i = 0; i < 6; i++) {
        stats = recordAttempt(stats, attempt(streakTargetRating(stats), true));
    }
    const hard = streakTargetRating(stats);
    stats = recordAttempt(stats, attempt(hard, false));

    expect(stats.run).toEqual({ length: 0, topRating: 0 });
    expect(stats.bestStreak).toBe(6);
    expect(stats.streaks).toHaveLength(1);
    expect(stats.streaks[0].length).toBe(6);
    expect(stats.streaks[0].topRating).toBe(hard - STREAK_STEP);
    expect(streakTargetRating(stats)).toBe(streakStartRating(stats.elo));
    expect(streakTargetRating(stats)).toBeLessThan(hard);
    expect(stats.failed).toBe(1);
});

test("puzzles outside a streak change the rating but not the streak", () => {
    let stats = recordAttempt(defaultPuzzleStats(), attempt(1100, true));
    stats = recordAttempt(stats, attempt(1500, false, false));
    expect(stats.run.length).toBe(1);
    expect(stats.streaks).toHaveLength(0);
    expect(stats.attempts).toBe(2);
    expect(stats.history).toHaveLength(2);
});

test("the difficulty stays inside the ratings a database has", () => {
    expect(streakStartRating(300)).toBe(600);
    const stats = { ...defaultPuzzleStats(), run: { length: 500, topRating: 0 } };
    expect(streakTargetRating(stats)).toBe(3000);
});

test("the rating span widens until it covers everything", () => {
    const spans = streakRatingSpans(1100);
    expect(spans[0]).toEqual([1075, 1125]);
    expect(spans.at(-1)).toEqual([0, 4000]);
});

test("broken or missing stored statistics fall back to defaults", () => {
    expect(parsePuzzleStats(null)).toEqual(defaultPuzzleStats());
    expect(parsePuzzleStats("x")).toEqual(defaultPuzzleStats());
    const parsed = parsePuzzleStats({ elo: 1700, run: { length: 3 }, streaks: "no" });
    expect(parsed.elo).toBe(1700);
    expect(parsed.peakElo).toBe(1700);
    expect(parsed.run).toEqual({ length: 3, topRating: 0 });
    expect(parsed.streaks).toEqual([]);

    const stats = recordAttempt(defaultPuzzleStats(), attempt(1100, true));
    expect(parsePuzzleStats(JSON.parse(JSON.stringify(stats)))).toEqual(stats);
});
