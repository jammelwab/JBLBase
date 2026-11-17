import { describe, expect, test } from "vitest";
import {
    DEFAULT_LIMITS,
    UsageMeter,
    addCounts,
    decide,
    emptyCounts,
    parseCounts,
    parseLimits,
    totalOf,
    usageDay,
} from "./usage";

describe("parseCounts", () => {
    test("broken input counts as nothing", () => {
        expect(parseCounts(null)).toEqual(emptyCounts());
        expect(parseCounts("x")).toEqual(emptyCounts());
        expect(
            parseCounts({
                evals: { reads: -5, writes: "7" },
                live: { reads: 2.9, writes: Infinity },
            }),
        ).toEqual({
            ...emptyCounts(),
            evals: { reads: 0, writes: 0 },
            live: { reads: 2, writes: 0 },
        });
    });

    test("unknown areas are ignored", () => {
        expect(parseCounts({ other: { reads: 9, writes: 9 } })).toEqual(emptyCounts());
    });
});

test("addCounts and totalOf", () => {
    const a = emptyCounts();
    a.repertoires = { reads: 2, writes: 1 };
    const b = emptyCounts();
    b.repertoires = { reads: 3, writes: 0 };
    b.evals = { reads: 10, writes: 4 };
    const sum = addCounts(a, b);
    expect(sum.repertoires).toEqual({ reads: 5, writes: 1 });
    expect(totalOf(sum)).toEqual({ reads: 15, writes: 5 });
});

test("parseLimits keeps the defaults for missing or wrong values", () => {
    expect(parseLimits(null)).toEqual(DEFAULT_LIMITS);
    expect(parseLimits({ evalReads: 10, evalWrites: -1, totalReads: "x" })).toEqual({
        ...DEFAULT_LIMITS,
        evalReads: 10,
    });
});

describe("decide", () => {
    const limits = { evalReads: 100, evalWrites: 50, totalReads: 1000, totalWrites: 500 };

    test("normal use syncs everything", () => {
        const c = emptyCounts();
        c.repertoires = { reads: 50, writes: 10 };
        c.evals = { reads: 99, writes: 49 };
        expect(decide(c, limits, false)).toEqual({ evals: true, sync: true });
    });

    test("first only the position store pauses", () => {
        const c = emptyCounts();
        c.evals = { reads: 100, writes: 0 };
        expect(decide(c, limits, false)).toEqual({ evals: false, sync: true });
    });

    test("far above, the whole sync pauses", () => {
        const c = emptyCounts();
        c.training = { reads: 0, writes: 500 };
        expect(decide(c, limits, false)).toEqual({ evals: false, sync: false });
    });

    test("admins have no limits", () => {
        const c = emptyCounts();
        c.training = { reads: 1e9, writes: 1e9 };
        expect(decide(c, limits, true)).toEqual({ evals: true, sync: true });
    });
});

test("usageDay is the local date", () => {
    expect(usageDay(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
});

describe("UsageMeter", () => {
    test("a query costs at least one read", () => {
        const m = new UsageMeter("2026-11-17");
        m.read("repertoires", 0);
        m.read("repertoires", 5);
        m.write("training", 3);
        expect(m.counts.repertoires).toEqual({ reads: 6, writes: 0 });
        expect(m.counts.training).toEqual({ reads: 0, writes: 3 });
    });

    test("a new day starts from zero", () => {
        const m = new UsageMeter("2026-11-17");
        m.read("evals", 10);
        m.roll("2026-11-17");
        expect(m.counts.evals.reads).toBe(10);
        m.roll("2026-11-18");
        expect(m.counts).toEqual(emptyCounts());
    });

    test("stored counts are added once and kept with this start's counts", () => {
        const m = new UsageMeter("2026-11-17");
        m.read("live", 1);
        const stored = emptyCounts();
        stored.live = { reads: 4, writes: 0 };
        expect(m.needsLoad("alice", "2026-11-17")).toBe(true);
        m.load("alice", "2026-11-17", stored);
        m.load("alice", "2026-11-17", stored);
        expect(m.counts.live.reads).toBe(5);
        expect(m.needsLoad("alice", "2026-11-17")).toBe(false);
    });

    test("another account starts from zero", () => {
        const m = new UsageMeter("2026-11-17");
        m.load("alice", "2026-11-17", emptyCounts());
        m.read("evals", 7);
        m.load("bob", "2026-11-17", emptyCounts());
        expect(m.counts.evals.reads).toBe(0);
    });
});
