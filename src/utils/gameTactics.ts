// Helpers for the tactic search in the own games.

export type Period = "all" | "month" | "quarter" | "year" | "custom";

export const PERIODS: Period[] = ["all", "month", "quarter", "year", "custom"];

export const SPEEDS = ["bullet", "blitz", "rapid", "classical", "daily"] as const;
export const RESULTS = ["win", "draw", "loss"] as const;

function day(date: Date): string {
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// The first and last day of a period, as "2026-03-14", or null where it is open.
export function periodRange(
    period: Period,
    custom: { since: string; until: string },
    today: Date = new Date(),
): { since: string | null; until: string | null } {
    const back = (days: number) => {
        const d = new Date(today);
        d.setDate(d.getDate() - days);
        return day(d);
    };
    switch (period) {
        case "month":
            return { since: back(30), until: null };
        case "quarter":
            return { since: back(91), until: null };
        case "year":
            return { since: back(365), until: null };
        case "custom":
            return { since: custom.since || null, until: custom.until || null };
        default:
            return { since: null, until: null };
    }
}
