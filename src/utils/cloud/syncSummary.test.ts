import { describe, expect, test } from "vitest";
import { formatAgo, syncSummary } from "./syncSummary";

describe("syncSummary", () => {
    test("signed out", () => {
        expect(syncSummary({ state: "off" }).tone).toBe("off");
    });

    test("synced, live or not", () => {
        expect(syncSummary({ state: "idle", lastSync: 5, live: true })).toEqual({
            tone: "ok",
            key: "Settings.Cloud.Sync.AgoLive",
            lastSync: 5,
        });
        expect(syncSummary({ state: "idle", lastSync: 5 }).key).toBe("Settings.Cloud.Sync.Ago");
    });

    test("offline wins over everything but signed out", () => {
        expect(syncSummary({ state: "error", offline: true, lastSync: 5 })).toEqual({
            tone: "offline",
            key: "Settings.Cloud.Sync.Offline",
            lastSync: 5,
        });
    });

    test("running, never synced, errors", () => {
        expect(syncSummary({ state: "syncing" }).tone).toBe("busy");
        expect(syncSummary({ state: "idle" }).key).toBe("Settings.Cloud.Sync.Never");
        expect(syncSummary({ state: "error", error: "x" }).key).toBe("Settings.Cloud.Sync.Failed");
        expect(syncSummary({ state: "error", notAllowed: true }).key).toBe(
            "Settings.Cloud.NotAllowed",
        );
    });

    test("a conflict copy stays visible until dismissed", () => {
        const s = syncSummary({
            state: "idle",
            lastSync: 5,
            conflictCopies: [{ path: "e4 (Konflikt)", file: "/x/e4 (Konflikt).pgn" }],
        });
        expect(s.tone).toBe("warning");
    });
});

describe("formatAgo", () => {
    const now = 1_700_000_000_000;
    test("seconds in steps of ten, then minutes, then the time of day", () => {
        expect(formatAgo(now - 4_000, "en-US", now)).toEqual({ relative: "now" });
        expect(formatAgo(now - 25_000, "en-US", now)).toEqual({ relative: "20 sec. ago" });
        expect(formatAgo(now - 3 * 60_000, "de-DE", now)).toEqual({ relative: "vor 3 Min." });
        expect("time" in formatAgo(now - 2 * 3600_000, "de-DE", now)).toBe(true);
    });

    test("a time slightly in the future (clock skew) counts as now", () => {
        expect(formatAgo(now + 5_000, "en-US", now)).toEqual({ relative: "now" });
    });
});
