export type ActivityData = {
    name: string;
    count: number;
    won: number;
    draw: number;
    lost: number;
};

/**
 * Fills the gaps between the first and the last month ("2026-03") with empty
 * months. Months are counted as plain numbers: going through local dates lost
 * the newest month whenever the first game was played in summer time and the
 * last one in winter time.
 */
export function fillMissingMonths(data: ActivityData[]): ActivityData[] {
    const byMonth = new Map<number, ActivityData>();
    for (const item of data) {
        const match = /^(\d{4})-(\d{2})$/.exec(item.name);
        if (!match) continue;
        byMonth.set(Number(match[1]) * 12 + Number(match[2]) - 1, item);
    }
    if (byMonth.size === 0) return [];

    const months = [...byMonth.keys()];
    const first = Math.min(...months);
    const last = Math.max(...months);
    const filled: ActivityData[] = [];
    for (let month = first; month <= last; month++) {
        const name = `${Math.floor(month / 12)}-${String((month % 12) + 1).padStart(2, "0")}`;
        filled.push(byMonth.get(month) ?? { name, count: 0, won: 0, draw: 0, lost: 0 });
    }
    return filled;
}
