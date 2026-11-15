// Evaluation sync: the local position store (src-tauri/src/eval_cache.rs)
// shares its results through the cloud, so a position computed on one
// device is not computed again on another.
//
// Firestore:
//   users/{uid}/evals/{evalDocId}   own results (normal accounts, up to depth 28)
//   evals/{evalDocId}               shared store: everyone reads, admins write
//       position (hex key), engine, depth, multipv, lines, updatedAt (server time)
//
// Order of a run: fetch what is new in the cloud and merge it (the deeper
// result wins), then upload local results that are still marked.
//
// Downloads continue exactly after the last document read, ordered by
// (updatedAt, document id). A query reads a consistent snapshot, so a write
// it did not see commits later and gets a later updatedAt: nothing is
// missed, and a run without changes in the cloud reads nothing. (A time
// overlap would read the same documents again on every run.) What a device
// uploads itself comes back once with its next download. Uploads and
// downloads are capped per run and per day, so a large store goes up over
// several runs and stays within Firestore's free daily quota.

import type { EvalSyncPending, StoredLine, SyncEval, SyncEvalKey } from "@/bindings";

export type EvalSource = "own" | "shared";

export type EvalSyncOptions = {
    /** Upload results from this depth on (proven mates always). */
    minDepth: number;
    /** Normal accounts: upload results up to this depth only. */
    maxDepth: number | null;
    /** Admins upload to the shared store, everyone else to their own area. */
    target: EvalSource;
    /** Also download the shared store. */
    pullShared: boolean;
    /** Today, as YYYY-MM-DD (for the daily caps). */
    today: string;
};

export type EvalPage = {
    items: SyncEval[];
    /**
     * Position after the last document of the page (opaque, from the
     * backend); null when the page was empty.
     */
    cursor: string | null;
    /** A further page may follow. */
    more: boolean;
};

export interface EvalSyncBackend {
    supported(): Promise<boolean>;
    pending(limit: number, minDepth: number, maxDepth: number | null): Promise<EvalSyncPending>;
    markSynced(keys: SyncEvalKey[]): Promise<void>;
    applyRemote(evals: SyncEval[]): Promise<number>;
    push(target: EvalSource, evals: SyncEval[]): Promise<void>;
    /** Documents after `after` (null: from the start), oldest first. */
    fetchPage(source: EvalSource, after: string | null): Promise<EvalPage>;
    metaGet(key: string): Promise<string | null>;
    metaSet(key: string, value: string | null): Promise<void>;
}

/** Results per upload batch; Firestore allows 500 writes per batch. */
export const EVAL_BATCH = 400;
/** Documents per download page. */
export const EVAL_PAGE = 500;
/** Per run: at most this many uploads and downloads. */
export const RUN_UPLOADS = 4000;
export const RUN_DOWNLOADS = 15000;
/** Per day (Firestore's free quota is 20,000 writes and 50,000 reads). */
export const DAILY_UPLOADS = 15000;
export const DAILY_DOWNLOADS = 40000;

export type EvalSyncResult = {
    uploaded: number;
    downloaded: number;
    /** Results taken over because they were deeper. */
    applied: number;
    /** Results still waiting for upload. */
    pending: number;
    /** The daily cap stopped the run; the rest follows tomorrow. */
    capped: boolean;
};

/** Download position: server time of the last document read and its id. */
export function formatEvalCursor(seconds: number, nanos: number, id: string): string {
    return `${seconds}.${String(nanos).padStart(9, "0")}|${id}`;
}

export function parseEvalCursor(
    cursor: string | null,
): { seconds: number; nanos: number; id: string } | null {
    const m = cursor?.match(/^(\d+)\.(\d{9})\|(.+)$/);
    if (!m) return null;
    return { seconds: Number(m[1]), nanos: Number(m[2]), id: m[3] };
}

/** Firestore document id: engine, line count and position, path-safe. */
export function evalDocId(e: { engine: string; multipv: number; position: string }): string {
    return encodeURIComponent(`${e.engine}|${e.multipv}|${e.position}`);
}

function parseLine(l: unknown): StoredLine | null {
    if (!l || typeof l !== "object") return null;
    const { multipv, depth, nodes, nps, cp, mate, wdl, uci } = l as Record<string, unknown>;
    const int = (v: unknown) => typeof v === "number" && Number.isInteger(v);
    if (
        !int(multipv) ||
        !int(depth) ||
        !Array.isArray(uci) ||
        uci.length === 0 ||
        !uci.every((m) => typeof m === "string")
    ) {
        return null;
    }
    const line: StoredLine = {
        multipv: multipv as number,
        depth: depth as number,
        nodes: int(nodes) && (nodes as number) >= 0 ? (nodes as number) : 0,
        nps: int(nps) && (nps as number) >= 0 ? (nps as number) : 0,
        uci: uci as string[],
    };
    if (int(mate)) line.mate = mate as number;
    else if (int(cp)) line.cp = cp as number;
    if (Array.isArray(wdl) && wdl.length === 3 && wdl.every(int)) {
        line.wdl = wdl as [number, number, number];
    }
    return line;
}

/** An evaluation document from the cloud; null when it is malformed. */
export function parseRemoteEval(d: Record<string, unknown>): SyncEval | null {
    const { position, engine, depth, multipv, lines } = d;
    if (
        typeof position !== "string" ||
        !/^[0-9a-f]{32}$/.test(position) ||
        typeof engine !== "string" ||
        engine.length === 0 ||
        typeof depth !== "number" ||
        typeof multipv !== "number" ||
        !Array.isArray(lines)
    ) {
        return null;
    }
    const parsed = lines.map(parseLine);
    if (parsed.length === 0 || parsed.some((l) => l === null)) return null;
    return { position, engine, depth, multipv, lines: parsed as StoredLine[] };
}

/** The document as written to Firestore (without `updatedAt`). */
export function evalDocument(e: SyncEval) {
    return {
        position: e.position,
        engine: e.engine,
        depth: e.depth,
        multipv: e.multipv,
        // Firestore takes no undefined fields and no tuples.
        lines: e.lines.map((l) => {
            const out: Record<string, unknown> = {
                multipv: l.multipv,
                depth: l.depth,
                nodes: l.nodes,
                nps: l.nps,
                uci: l.uci,
            };
            if (l.mate != null) out.mate = l.mate;
            else if (l.cp != null) out.cp = l.cp;
            if (l.wdl) out.wdl = [...l.wdl];
            return out;
        }),
    };
}

async function counter(b: EvalSyncBackend, key: string, today: string): Promise<number> {
    const raw = await b.metaGet(key);
    if (!raw) return 0;
    const [day, n] = raw.split(" ");
    return day === today ? Number(n) || 0 : 0;
}

export async function syncEvals(
    b: EvalSyncBackend,
    uid: string,
    o: EvalSyncOptions,
): Promise<EvalSyncResult> {
    const result: EvalSyncResult = {
        uploaded: 0,
        downloaded: 0,
        applied: 0,
        pending: 0,
        capped: false,
    };
    if (!(await b.supported())) return result;

    // Download first, so nothing shallower than the cloud goes up.
    const downKey = "evalDownloads";
    let downToday = await counter(b, downKey, o.today);
    const sources: EvalSource[] = o.pullShared ? ["own", "shared"] : ["own"];
    for (const source of sources) {
        const cursorKey = source === "own" ? `evalCursor:own:${uid}` : "evalCursor:shared";
        let after = await b.metaGet(cursorKey);
        for (;;) {
            if (result.downloaded >= RUN_DOWNLOADS) break;
            if (downToday >= DAILY_DOWNLOADS) {
                result.capped = true;
                break;
            }
            const page = await b.fetchPage(source, after);
            if (page.items.length > 0) result.applied += await b.applyRemote(page.items);
            result.downloaded += page.items.length;
            downToday += page.items.length;
            if (page.cursor) {
                after = page.cursor;
                await b.metaSet(cursorKey, after);
            }
            if (!page.more || !page.cursor) break;
        }
    }
    await b.metaSet(downKey, `${o.today} ${downToday}`);

    const upKey = "evalUploads";
    let upToday = await counter(b, upKey, o.today);
    for (;;) {
        const room = Math.min(EVAL_BATCH, RUN_UPLOADS - result.uploaded, DAILY_UPLOADS - upToday);
        const { evals, total } = await b.pending(Math.max(room, 0), o.minDepth, o.maxDepth);
        result.pending = total;
        if (total === 0 || room <= 0) {
            if (total > 0 && upToday >= DAILY_UPLOADS) result.capped = true;
            break;
        }
        if (evals.length === 0) break;
        await b.push(o.target, evals);
        await b.markSynced(
            evals.map(({ position, engine, multipv, depth }) => ({
                position,
                engine,
                multipv,
                depth,
            })),
        );
        result.uploaded += evals.length;
        upToday += evals.length;
        result.pending = total - evals.length;
        await b.metaSet(upKey, `${o.today} ${upToday}`);
    }
    return result;
}
