import { describe, expect, it } from "vitest";
import type { SyncEval, SyncEvalKey } from "@/bindings";
import {
    DAILY_UPLOADS,
    EVAL_BATCH,
    type EvalPage,
    type EvalSource,
    type EvalSyncBackend,
    type EvalSyncOptions,
    evalDocId,
    evalDocument,
    parseRemoteEval,
    RUN_UPLOADS,
    syncEvals,
} from "./evalSync";

const hex = (n: number) => n.toString(16).padStart(32, "0");

const ev = (n: number, depth = 22, engine = "Stockfish 19"): SyncEval => ({
    position: hex(n),
    engine,
    multipv: 1,
    depth,
    lines: [{ multipv: 1, depth, nodes: 1000, nps: 10, cp: 25, uci: ["e2e4", "e7e5"] }],
});

const key = (e: SyncEval) => `${e.engine}|${e.multipv}|${e.position}`;

/** A device's local store and the cloud, kept in memory. */
function setup(local: SyncEval[], cloud: Partial<Record<EvalSource, SyncEval[]>> = {}) {
    const store = new Map(local.map((e) => [key(e), { e, dirty: true }]));
    type Doc = { e: SyncEval; at: number };
    const toMap = (list: SyncEval[] = []) =>
        new Map<string, Doc>(list.map((e, i) => [key(e), { e, at: 1000 + i }]));
    const remote: Record<EvalSource, Map<string, Doc>> = {
        own: toMap(cloud.own),
        shared: toMap(cloud.shared),
    };
    const meta = new Map<string, string>();
    const pushed: Record<EvalSource, SyncEval[]> = { own: [], shared: [] };
    let clock = 5000;
    const pageSize = 2;
    const b: EvalSyncBackend = {
        supported: async () => true,
        async pending(limit, minDepth, maxDepth) {
            const all = [...store.values()]
                .filter(({ e, dirty }) => dirty && e.depth >= minDepth)
                .filter(({ e }) => maxDepth === null || e.depth <= maxDepth)
                .map(({ e }) => e);
            return { evals: all.slice(0, limit), total: all.length };
        },
        async markSynced(keys: SyncEvalKey[]) {
            for (const k of keys) {
                const s = store.get(`${k.engine}|${k.multipv}|${k.position}`);
                if (s && s.e.depth === k.depth) s.dirty = false;
            }
        },
        async applyRemote(evals) {
            let n = 0;
            for (const e of evals) {
                const s = store.get(key(e));
                if (!s || e.depth > s.e.depth) {
                    store.set(key(e), { e, dirty: false });
                    n++;
                }
            }
            return n;
        },
        async push(target, evals) {
            pushed[target].push(...evals);
            clock += 1;
            for (const e of evals) remote[target].set(key(e), { e, at: clock });
        },
        async fetchPage(source, since, after): Promise<EvalPage> {
            const list = [...remote[source].values()]
                .filter((r) => r.at > since)
                .sort((a, b2) => a.at - b2.at || key(a.e).localeCompare(key(b2.e)));
            const start = after === null ? 0 : (after as number);
            const page = list.slice(start, start + pageSize);
            return {
                items: page.map((r) => r.e),
                maxUpdatedAt: Math.max(0, ...page.map((r) => r.at)),
                next: page.length < pageSize ? null : start + pageSize,
            };
        },
        metaGet: async (k) => meta.get(k) ?? null,
        metaSet: async (k, v) => {
            if (v === null) meta.delete(k);
            else meta.set(k, v);
        },
    };
    return { b, store, remote, pushed, meta };
}

const opts = (o: Partial<EvalSyncOptions> = {}): EvalSyncOptions => ({
    minDepth: 20,
    maxDepth: 28,
    target: "own",
    pullShared: true,
    today: "2026-11-15",
    ...o,
});

describe("evaluation documents", () => {
    it("builds path-safe ids", () => {
        const id = evalDocId({
            engine: "Stockfish 19 [Skill Level=5]",
            multipv: 2,
            position: hex(1),
        });
        expect(id).not.toContain("/");
        expect(decodeURIComponent(id)).toBe(`Stockfish 19 [Skill Level=5]|2|${hex(1)}`);
    });

    it("writes no undefined fields and reads its own documents back", () => {
        const e = ev(1);
        e.lines[0].wdl = [500, 400, 100];
        const doc = evalDocument(e);
        expect(JSON.stringify(doc)).not.toContain("undefined");
        expect(doc.lines[0]).not.toHaveProperty("mate");
        expect(parseRemoteEval({ ...doc, updatedAt: {} })).toEqual(e);
    });

    it("rejects malformed documents", () => {
        const doc = evalDocument(ev(1));
        expect(
            parseRemoteEval({
                ...doc,
                position: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -",
            }),
        ).toBeNull();
        expect(parseRemoteEval({ ...doc, engine: "" })).toBeNull();
        expect(parseRemoteEval({ ...doc, lines: [] })).toBeNull();
        expect(parseRemoteEval({ ...doc, lines: [{ multipv: 1, depth: 3, uci: [] }] })).toBeNull();
    });
});

describe("evaluation sync", () => {
    it("downloads own and shared results, then uploads only what the cloud lacks", async () => {
        const { b, store, pushed } = setup([ev(1, 22), ev(2, 24), ev(3, 12)], {
            own: [ev(1, 26)],
            shared: [ev(2, 20), ev(4, 30), ev(5, 31), ev(6, 32)],
        });
        const r = await syncEvals(b, "u1", opts());
        expect(r.downloaded).toBe(5);
        expect(r.applied).toBe(4); // 1 (deeper), 4, 5, 6
        expect(store.get(key(ev(1)))?.e.depth).toBe(26);
        // Position 2 is deeper locally, position 3 too shallow to upload.
        expect(pushed.own.map((e) => e.position)).toEqual([hex(2)]);
        expect(pushed.shared).toEqual([]);
        expect(r.uploaded).toBe(1);
        expect(r.pending).toBe(0);
    });

    it("admins upload to the shared store without a depth limit", async () => {
        const { b, pushed } = setup([ev(1, 40)]);
        await syncEvals(b, "admin", opts({ maxDepth: null, target: "shared" }));
        expect(pushed.shared.map((e) => e.depth)).toEqual([40]);
        expect(pushed.own).toEqual([]);
    });

    it("normal accounts keep results above the limit at home", async () => {
        const { b, pushed } = setup([ev(1, 40), ev(2, 28)]);
        await syncEvals(b, "u1", opts());
        expect(pushed.own.map((e) => e.depth)).toEqual([28]);
    });

    it("skips the shared store when switched off", async () => {
        const { b, store } = setup([], { shared: [ev(4, 30)] });
        const r = await syncEvals(b, "u1", opts({ pullShared: false }));
        expect(r.downloaded).toBe(0);
        expect(store.size).toBe(0);
    });

    it("continues where it stopped and does not download the same pages twice", async () => {
        const { b, meta } = setup([], { shared: [ev(4), ev(5), ev(6)] });
        await syncEvals(b, "u1", opts());
        expect(Number(meta.get("evalCursor:shared"))).toBe(1002);
        // Within the overlap the last documents are read again, nothing new is taken over.
        const again = await syncEvals(b, "u1", opts());
        expect(again.applied).toBe(0);
    });

    it("uploads a large store over several runs and respects the daily cap", async () => {
        const many = Array.from({ length: RUN_UPLOADS + 10 }, (_, i) => ev(i + 1));
        const { b, meta } = setup(many);
        const first = await syncEvals(b, "u1", opts());
        expect(first.uploaded).toBe(RUN_UPLOADS);
        expect(first.pending).toBe(10);
        const second = await syncEvals(b, "u1", opts());
        expect(second.uploaded).toBe(10);
        expect(second.pending).toBe(0);

        meta.set("evalUploads", `2026-11-15 ${DAILY_UPLOADS - 5}`);
        const { b: b2, meta: m2 } = setup(many.slice(0, EVAL_BATCH));
        m2.set("evalUploads", `2026-11-15 ${DAILY_UPLOADS - 5}`);
        const capped = await syncEvals(b2, "u1", opts());
        expect(capped.uploaded).toBe(5);
        expect(capped.capped).toBe(true);
        // A new day starts a new count.
        const nextDay = await syncEvals(b2, "u1", opts({ today: "2026-11-16" }));
        expect(nextDay.uploaded).toBe(EVAL_BATCH - 5);
    });

    it("does nothing when this build names positions differently", async () => {
        const { b, pushed } = setup([ev(1)], { shared: [ev(4)] });
        b.supported = async () => false;
        const r = await syncEvals(b, "u1", opts());
        expect(r).toMatchObject({ uploaded: 0, downloaded: 0 });
        expect(pushed.own).toEqual([]);
    });
});
