import { describe, expect, it } from "vitest";
import { allowlistSize, quotaPercent, summarizeUsage } from "../cloud/adminOverview";
import { DEFAULT_LIMITS } from "../cloud/usage";

const ts = { seconds: 1, nanoseconds: 0 };

describe("summarizeUsage", () => {
    it("sums accounts and devices per day, newest first", () => {
        const s = summarizeUsage(
            [
                {
                    uid: "a",
                    day: "2026-11-19",
                    devices: { d1: { meta: { reads: 5, writes: 1 } }, updatedAt: ts },
                },
                {
                    uid: "a",
                    day: "2026-11-20",
                    devices: {
                        d1: { evals: { reads: 10, writes: 2 } },
                        d2: { repertoires: { reads: 3, writes: 0 } },
                        updatedAt: ts,
                    },
                },
                {
                    uid: "b",
                    day: "2026-11-20",
                    devices: { d1: { training: { reads: 1, writes: 1 } }, updatedAt: ts },
                },
            ],
            DEFAULT_LIMITS,
            "2026-11-20",
        );
        expect(s.days.map((d) => d.day)).toEqual(["2026-11-20", "2026-11-19"]);
        expect(s.days[0]).toMatchObject({ reads: 14, writes: 3, accounts: 2, devices: 3 });
        expect(s.today).toEqual({ reads: 14, writes: 3 });
        expect(s.activeAccounts).toBe(2);
        expect(s.activeDevices).toBe(3);
        expect(s.evalsPausedToday).toBe(0);
        expect(s.syncPausedToday).toBe(0);
    });

    it("skips empty documents and counts accounts at a limit today only", () => {
        const s = summarizeUsage(
            [
                { uid: "x", day: "2026-11-20", devices: { updatedAt: ts } },
                {
                    uid: "a",
                    day: "2026-11-20",
                    devices: { d1: { evals: { reads: DEFAULT_LIMITS.evalReads, writes: 0 } } },
                },
                {
                    uid: "b",
                    day: "2026-11-20",
                    devices: { d1: { meta: { reads: DEFAULT_LIMITS.totalReads, writes: 0 } } },
                },
                {
                    uid: "c",
                    day: "2026-11-19",
                    devices: { d1: { meta: { reads: DEFAULT_LIMITS.totalReads, writes: 0 } } },
                },
            ],
            DEFAULT_LIMITS,
            "2026-11-20",
        );
        expect(s.activeAccounts).toBe(3);
        expect(s.evalsPausedToday).toBe(1);
        expect(s.syncPausedToday).toBe(1);
    });

    it("has nothing for no documents", () => {
        const s = summarizeUsage([], DEFAULT_LIMITS, "2026-11-20");
        expect(s.days).toEqual([]);
        expect(s.today).toEqual({ reads: 0, writes: 0 });
    });
});

describe("quotaPercent", () => {
    it("rounds and handles a zero quota", () => {
        expect(quotaPercent(25_000, 50_000)).toBe(50);
        expect(quotaPercent(1, 3)).toBe(33);
        expect(quotaPercent(60_000, 50_000)).toBe(120);
        expect(quotaPercent(5, 0)).toBe(0);
    });
});

describe("allowlistSize", () => {
    it("counts string entries", () => {
        expect(allowlistSize({ emails: ["a", "b", 3], lichess: ["x"] })).toEqual({
            emails: 2,
            lichess: 1,
        });
        expect(allowlistSize({})).toEqual({ emails: 0, lichess: 0 });
        expect(allowlistSize(null)).toBeNull();
    });
});
