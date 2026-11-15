import { expect, test } from "vitest";
import { fillMissingMonths } from "@/utils/activity";

const month = (name: string, count = 1) => ({ name, count, won: count, draw: 0, lost: 0 });

test("keeps the newest month when play started in summer and ends in winter", () => {
    const filled = fillMissingMonths([month("2025-07"), month("2026-11", 3)]);
    expect(filled[0].name).toBe("2025-07");
    expect(filled.at(-1)).toEqual(month("2026-11", 3));
    expect(filled).toHaveLength(17);
});

test("fills gaps with empty months across a year change", () => {
    const filled = fillMissingMonths([month("2026-02"), month("2025-11")]);
    expect(filled.map((m) => m.name)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(filled[1].count).toBe(0);
});

test("handles no games and a single month", () => {
    expect(fillMissingMonths([])).toEqual([]);
    expect(fillMissingMonths([month("2026-01")])).toEqual([month("2026-01")]);
});
