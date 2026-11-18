export type PracticeAutoDifficulty = "time" | "none" | "1" | "2" | "3" | "4";

/** A correct move faster than this counts as "Easy", otherwise "Good". */
export const EASY_TIME_LIMIT_MS = 30_000;

/**
 * Grade for a correctly played move when the grade is chosen automatically,
 * or null when the user picks it by hand. Correct only on the second try
 * counts as "Hard"; two wrong tries are graded "Again" on the board.
 */
export function autoGrade(
    setting: PracticeAutoDifficulty,
    timeTaken: number | undefined,
    wrongTries = 0,
): 1 | 2 | 3 | 4 | null {
    if (setting === "none") return null;
    if (setting === "time") {
        if (wrongTries > 0) return 2;
        return timeTaken !== undefined && timeTaken < EASY_TIME_LIMIT_MS ? 4 : 3;
    }
    return Number(setting) as 1 | 2 | 3 | 4;
}
