import { askCoachExplain } from "@/utils/cloud/auth";

// Fragt Claude über die Cloud-Funktion; null bei Fehler oder Zeitüberschreitung,
// dann gilt der feste Text der App.
export async function askCoach(
    facts: Record<string, unknown>,
    timeoutMs: number,
): Promise<string | null> {
    const answer = askCoachExplain(facts).catch(() => null);
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
    return Promise.race([answer, timeout]);
}

export type CoachReportCounts = Record<
    "book" | "solid" | "good" | "dubious" | "mistake" | "blunder",
    number
>;

// Zählt die Einordnungen der eigenen Züge für den Partiebericht
export function countReactions(reactions: string[]): CoachReportCounts {
    const c: CoachReportCounts = { book: 0, solid: 0, good: 0, dubious: 0, mistake: 0, blunder: 0 };
    for (const r of reactions) {
        if (r === "book") c.book++;
        else if (r === "solid") c.solid++;
        else if (r === "good" || r === "brilliant" || r === "interesting") c.good++;
        else if (r === "dubious") c.dubious++;
        else if (r === "mistake") c.mistake++;
        else if (r === "blunder" || r === "missedMate") c.blunder++;
    }
    return c;
}
