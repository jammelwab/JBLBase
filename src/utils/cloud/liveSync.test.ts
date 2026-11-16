import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { SyncCursor } from "./cursor";
import { LIVE_COLLECTIONS, type LiveBackend, type LiveCollection, LiveSync } from "./liveSync";

type Listener = {
    uid: string;
    name: LiveCollection;
    after: SyncCursor | null;
    onNew: () => void;
    onError: (e: unknown) => void;
    stopped: boolean;
};

function fakeBackend(meta: Record<string, string | null> = {}) {
    const listeners: Listener[] = [];
    const backend: LiveBackend = {
        listen(uid, name, after, onNew, onError) {
            const l: Listener = { uid, name, after, onNew, onError, stopped: false };
            listeners.push(l);
            return () => {
                l.stopped = true;
            };
        },
        metaGet: async (key) => meta[key] ?? null,
    };
    const active = () => listeners.filter((l) => !l.stopped);
    const of = (name: LiveCollection) => active().find((l) => l.name === name)!;
    return { backend, meta, listeners, active, of };
}

describe("LiveSync", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    test("listens to all three collections after their download positions", async () => {
        const f = fakeBackend({
            "repCursor:u1": "100.000000000|rep-a",
            "trainingCursor:cards:u1": null,
        });
        const states: boolean[] = [];
        const live = new LiveSync(
            f.backend,
            () => {},
            (s) => states.push(s),
        );
        await live.refresh("u1");
        expect(f.active().map((l) => l.name)).toEqual([...LIVE_COLLECTIONS]);
        expect(f.of("repertoires").after).toEqual({ seconds: 100, nanos: 0, id: "rep-a" });
        expect(f.of("cards").after).toBeNull();
        expect(f.active().every((l) => l.uid === "u1")).toBe(true);
        expect(live.live).toBe(true);
        expect(states.at(-1)).toBe(true);
    });

    test("a new document starts one sync for changes that arrive together", async () => {
        const f = fakeBackend();
        const sync = vi.fn<() => void>();
        const live = new LiveSync(f.backend, sync, () => {}, 1000);
        await live.refresh("u1");
        f.of("repertoires").onNew();
        f.of("cards").onNew();
        f.of("reviews").onNew();
        expect(sync).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1000);
        expect(sync).toHaveBeenCalledTimes(1);
    });

    test("only listeners whose position moved are replaced", async () => {
        const f = fakeBackend({ "repCursor:u1": "1.000000000|a" });
        const live = new LiveSync(f.backend, () => {});
        await live.refresh("u1");
        const cards = f.of("cards");
        f.meta["repCursor:u1"] = "2.000000000|b";
        await live.refresh("u1");
        expect(f.listeners).toHaveLength(4);
        expect(f.of("repertoires").after?.seconds).toBe(2);
        expect(f.of("cards")).toBe(cards);
    });

    test("a sync that does not move the position does not restart the listener", async () => {
        // A listener only fires again for a changed document, so a failing
        // sync cannot keep starting itself.
        const f = fakeBackend({ "repCursor:u1": "1.000000000|a" });
        const live = new LiveSync(f.backend, () => {});
        await live.refresh("u1");
        await live.refresh("u1");
        await live.refresh("u1");
        expect(f.listeners).toHaveLength(3);
    });

    test("stop ends all listeners and a pending sync", async () => {
        const f = fakeBackend();
        const sync = vi.fn<() => void>();
        const states: boolean[] = [];
        const live = new LiveSync(f.backend, sync, (s) => states.push(s));
        await live.refresh("u1");
        f.of("cards").onNew();
        live.stop();
        vi.advanceTimersByTime(10_000);
        expect(sync).not.toHaveBeenCalled();
        expect(f.active()).toHaveLength(0);
        expect(live.live).toBe(false);
        expect(states.at(-1)).toBe(false);
    });

    test("a stopped listener no longer starts a sync", async () => {
        const f = fakeBackend({ "repCursor:u1": "1.000000000|a" });
        const sync = vi.fn<() => void>();
        const live = new LiveSync(f.backend, sync, () => {}, 0);
        await live.refresh("u1");
        const old = f.of("repertoires");
        f.meta["repCursor:u1"] = "2.000000000|b";
        await live.refresh("u1");
        old.onNew();
        vi.runAllTimers();
        expect(sync).not.toHaveBeenCalled();
    });

    test("an error drops the listener and reports that live sync is off", async () => {
        const f = fakeBackend();
        const states: boolean[] = [];
        const live = new LiveSync(
            f.backend,
            () => {},
            (s) => states.push(s),
        );
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        await live.refresh("u1");
        f.of("reviews").onError(new Error("permission-denied"));
        expect(live.live).toBe(false);
        expect(states.at(-1)).toBe(false);
        // The next sync starts it again.
        await live.refresh("u1");
        expect(live.live).toBe(true);
        warn.mockRestore();
    });

    test("switching accounts replaces every listener", async () => {
        const f = fakeBackend();
        const live = new LiveSync(f.backend, () => {});
        await live.refresh("u1");
        await live.refresh("u2");
        expect(f.active().map((l) => l.uid)).toEqual(["u2", "u2", "u2"]);
    });

    test("a refresh that finishes after stop starts nothing", async () => {
        const f = fakeBackend();
        const live = new LiveSync(f.backend, () => {});
        const pending = live.refresh("u1");
        live.stop();
        await pending;
        expect(f.listeners).toHaveLength(0);
    });
});
