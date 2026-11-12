import { atomWithStorage } from "jotai/utils";
import type { PowerLevel } from "./enginePower";
import { powerSettings } from "./enginePower";

// What a long analysis is counted in: positions of a repertoire, games, reported puzzles.
export type AnalysisKind = "tactics" | "insight" | "review";

// Measured seconds per unit, by kind, depth and power level.
export type AnalysisSpeeds = Record<string, number>;

export const analysisSpeedsAtom = atomWithStorage<AnalysisSpeeds>("analysis-speeds", {});

// Rough seconds per unit at depth 18 on four threads, until a run has been measured.
const DEFAULT_SECONDS: Record<AnalysisKind, number> = {
    tactics: 1.2,
    insight: 45,
    review: 6,
};

export function speedKey(kind: AnalysisKind, depth: number, power: PowerLevel): string {
    return `${kind}:${depth}:${power}`;
}

// Seconds the analysis of `units` will take, and whether that is measured or a guess.
export function estimateSeconds(
    speeds: AnalysisSpeeds,
    kind: AnalysisKind,
    depth: number,
    power: PowerLevel,
    units: number,
    cores?: number,
): { seconds: number; measured: boolean } {
    const measured = speeds[speedKey(kind, depth, power)];
    if (measured !== undefined) return { seconds: measured * units, measured: true };
    // Every two plies of depth cost about half again as much; more threads help, though
    // not in full proportion.
    const depthFactor = 1.5 ** ((depth - 18) / 2);
    const { threads } = powerSettings(power, cores);
    const threadFactor = (4 / threads) ** 0.8;
    return { seconds: DEFAULT_SECONDS[kind] * units * depthFactor * threadFactor, measured: false };
}

// Folds a finished run into the measured speed (a later run counts more than an old one).
export function recordSpeed(
    speeds: AnalysisSpeeds,
    kind: AnalysisKind,
    depth: number,
    power: PowerLevel,
    seconds: number,
    units: number,
): AnalysisSpeeds {
    if (units <= 0 || seconds <= 0) return speeds;
    const key = speedKey(kind, depth, power);
    const perUnit = seconds / units;
    const old = speeds[key];
    return { ...speeds, [key]: old === undefined ? perUnit : old * 0.4 + perUnit * 0.6 };
}

// Time still needed, from the time so far and the share done (0 to 100). `null` while
// there is too little to go on.
export function remainingSeconds(elapsed: number, progress: number): number | null {
    if (progress < 1 || elapsed < 5) return null;
    return (elapsed * (100 - progress)) / progress;
}

// "unter 1 Min.", "12 Min.", "3 Std. 5 Min."; the words come from `t`.
export function formatDuration(
    seconds: number,
    t: (key: string, options?: Record<string, unknown>) => string,
): string {
    if (seconds < 60) return t("Eta.UnderMinute");
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return t("Eta.Minutes", { count: minutes });
    const hours = Math.floor(minutes / 60);
    return t("Eta.HoursMinutes", { hours, minutes: minutes % 60 });
}
