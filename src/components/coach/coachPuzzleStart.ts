import { atom } from "jotai";
import { type CoachResult, estimateStrength, strengthElo } from "./coachRewards";
import type { CoachStrengthId } from "./coachState";

// Puzzles aus dem Coach heraus (1.2.14): die Puzzle-Seite startet sofort ein
// Puzzle in der Stärke, auf die JBL dich (heimlich) schätzt.
export const coachPuzzleStartAtom = atom<number | null>(null);

// Die geschätzte Elo: Leistungszahl aus den Partien gegen JBL, sonst die
// beste bisherige Schätzung, sonst die Stufe, gegen die du spielst.
export function coachPuzzleElo(
    results: readonly CoachResult[],
    bestEstimate: number,
    strength: CoachStrengthId,
): number {
    const elo = estimateStrength(results) ?? (bestEstimate || strengthElo(strength));
    return Math.max(500, Math.min(2800, Math.round(elo / 50) * 50));
}

// Wertungsfenster um die Ziel-Elo, vom engsten zum weitesten
export function puzzleSpans(elo: number): [number, number][] {
    return [100, 250, 500, 1000].map((d) => [Math.max(0, elo - d), elo + d]);
}
