// Runs the cloud sync while someone is signed in: at start, after sign-in,
// every few minutes, shortly after local changes, and on demand.

import { dirname, join } from "@tauri-apps/api/path";
import { exists, mkdir, readDir, readTextFile, rename, writeTextFile } from "@tauri-apps/plugin-fs";
import type * as Firestore from "firebase/firestore/lite";
import { atom, getDefaultStore } from "jotai";
import { commands, type SyncCard, type SyncReview } from "@/bindings";
import {
    type Directory,
    type FileMetadata,
    processEntriesRecursively,
} from "@/components/files/file";
import { evalCloudSyncAtom, reloadTrainingDecks } from "@/state/atoms";
import { getDocumentDir } from "@/utils/directories";
import { bumpRepertoires } from "@/utils/repertoires";
import { type CloudAccount, cloudFirestore, cloudFirestoreLive, watchCloudAccount } from "./auth";
import {
    EVAL_PAGE,
    type EvalSource,
    type EvalSyncBackend,
    type EvalSyncResult,
    evalDocId,
    evalDocument,
    formatEvalCursor,
    parseEvalCursor,
    parseRemoteEval,
    syncEvals,
} from "./evalSync";
import { cloudRepertoires, fetchAfter } from "./firestoreDocs";
import { type LiveFirestore, listenAfter } from "./liveFirestore";
import { LiveSync } from "./liveSync";
import { setLocalChangeListener } from "./syncSignal";
import {
    type LocalRepertoire,
    type RepertoireSyncBackend,
    type RepertoireSyncResult,
    relativePath,
    syncRepertoires,
} from "./repertoireSync";
import {
    cardDocId,
    parseRemoteCard,
    parseRemoteReview,
    syncTraining,
    type TrainingSyncBackend,
} from "./trainingSync";

export const SYNC_INTERVAL_MS = 5 * 60 * 1000;
/** While the live listeners run, the periodic sync only runs this often. */
export const LIVE_SYNC_INTERVAL_MS = 30 * 60 * 1000;
const CHANGE_DELAY_MS = 15 * 1000;

export type CloudSyncStatus = {
    state: "off" | "idle" | "syncing" | "error";
    lastSync?: number;
    error?: string;
    repertoires?: RepertoireSyncResult;
    trainingUploaded?: number;
    trainingDownloaded?: number;
    /** Position store; absent when its sync is switched off. */
    evals?: EvalSyncResult;
    /** The cloud refused access: account not on the allowlist (or e-mail unconfirmed). */
    notAllowed?: boolean;
    /** Changes from other devices arrive live (see liveSync.ts). */
    live?: boolean;
};

export const cloudSyncStatusAtom = atom<CloudSyncStatus>({ state: "off" });

function unwrapResult<T>(res: { status: "ok"; data: T } | { status: "error"; error: unknown }): T {
    if (res.status === "error") throw new Error(String(res.error));
    return res.data;
}

const meta = {
    metaGet: async (key: string) => unwrapResult(await commands.syncMetaGet(key)),
    metaSet: async (key: string, value: string | null) => {
        unwrapResult(await commands.syncMetaSet(key, value));
    },
};

function trainingBackend(uid: string): TrainingSyncBackend {
    return {
        ...meta,
        pending: async (limit) => unwrapResult(await commands.trainingPending(limit)),
        markSynced: async (cards, reviews) => {
            unwrapResult(await commands.trainingMarkSynced(cards, reviews));
        },
        applyRemote: async (cards, reviews) =>
            unwrapResult(await commands.trainingApplyRemote(cards, reviews)),
        async push(cards: SyncCard[], reviews: SyncReview[]) {
            const { db, firestore: fs } = await cloudFirestore();
            const batch = fs.writeBatch(db);
            const syncedAt = fs.serverTimestamp();
            for (const c of cards) {
                batch.set(fs.doc(db, "users", uid, "cards", cardDocId(c.deck, c.position)), {
                    ...c,
                    syncedAt,
                });
            }
            for (const { uid: id, ...r } of reviews) {
                batch.set(fs.doc(db, "users", uid, "reviews", id), { ...r, syncedAt });
            }
            await batch.commit();
        },
        async fetchCards(after) {
            const { docs, cursor } = await fetchAfter(await cloudFirestore(), uid, "cards", after);
            return {
                items: docs.map((d) => parseRemoteCard(d.data)).filter((c) => c !== null),
                cursor,
            };
        },
        async fetchReviews(after) {
            const { docs, cursor } = await fetchAfter(
                await cloudFirestore(),
                uid,
                "reviews",
                after,
            );
            return {
                items: docs.map((d) => parseRemoteReview(d.id, d.data)).filter((r) => r !== null),
                cursor,
            };
        },
    };
}

/** Normal accounts store (and upload) up to this depth; see eval_cache.rs. */
const USER_MAX_EVAL_DEPTH = 28;

function evalBackend(uid: string): EvalSyncBackend {
    const collection = async (source: EvalSource) => {
        const { db, firestore: fs } = await cloudFirestore();
        return source === "own"
            ? fs.collection(db, "users", uid, "evals")
            : fs.collection(db, "evals");
    };
    return {
        ...meta,
        supported: async () => unwrapResult(await commands.evalSyncSupported()),
        pending: async (limit, minDepth, maxDepth) =>
            unwrapResult(await commands.evalSyncPending(limit, minDepth, maxDepth)),
        markSynced: async (keys) => {
            unwrapResult(await commands.evalSyncMarkSynced(keys));
        },
        applyRemote: async (evals) => unwrapResult(await commands.evalSyncApplyRemote(evals)),
        async push(target, evals) {
            const { db, firestore: fs } = await cloudFirestore();
            const col = await collection(target);
            const batch = fs.writeBatch(db);
            const updatedAt = fs.serverTimestamp();
            for (const e of evals) {
                batch.set(fs.doc(col, evalDocId(e)), { ...evalDocument(e), updatedAt });
            }
            await batch.commit();
        },
        async fetchPage(source, after) {
            const { firestore: fs } = await cloudFirestore();
            const constraints: Firestore.QueryConstraint[] = [
                fs.orderBy("updatedAt"),
                fs.orderBy(fs.documentId()),
            ];
            const start = parseEvalCursor(after);
            if (start) {
                constraints.push(
                    fs.startAfter(new fs.Timestamp(start.seconds, start.nanos), start.id),
                );
            }
            constraints.push(fs.limit(EVAL_PAGE));
            const snap = await fs.getDocs(fs.query(await collection(source), ...constraints));
            const items = [];
            let cursor: string | null = null;
            for (const d of snap.docs) {
                const data = d.data();
                const e = parseRemoteEval(data);
                if (e) items.push(e);
                const at = data.updatedAt;
                if (at instanceof fs.Timestamp) {
                    cursor = formatEvalCursor(at.seconds, at.nanoseconds, d.id);
                }
            }
            return { items, cursor, more: snap.docs.length === EVAL_PAGE };
        },
    };
}

/** Local date as YYYY-MM-DD. */
function today(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function flatten(entries: (FileMetadata | Directory)[]): FileMetadata[] {
    return entries.flatMap((e) => (e.type === "directory" ? flatten(e.children) : [e]));
}

const infoFile = (pgnFile: string) => pgnFile.replace(/\.pgn$/i, ".info");

async function repertoireBackend(uid: string): Promise<RepertoireSyncBackend> {
    const dir = await getDocumentDir();
    const absolute = async (path: string) => `${await join(dir, ...path.split("/"))}.pgn`;
    const ensureParent = async (file: string) => {
        const parent = await dirname(file);
        if (!(await exists(parent))) await mkdir(parent, { recursive: true });
    };
    return {
        ...meta,
        dir,
        async listLocal() {
            const files = flatten(await processEntriesRecursively(dir, await readDir(dir))).filter(
                (f) => f.metadata.type === "repertoire",
            );
            const result: LocalRepertoire[] = [];
            for (const f of files) {
                const path = relativePath(dir, f.path);
                if (!path) continue;
                let info: Record<string, unknown>;
                try {
                    info = JSON.parse(await readTextFile(infoFile(f.path)));
                } catch {
                    info = { ...f.metadata };
                }
                result.push({
                    file: f.path,
                    path,
                    info,
                    pgn: await readTextFile(f.path),
                    modifiedAt: f.lastModified * 1000,
                });
            }
            return result;
        },
        async writeLocal(path, info, pgn) {
            const file = await absolute(path);
            await ensureParent(file);
            await writeTextFile(file, pgn);
            await writeTextFile(infoFile(file), JSON.stringify(info));
            return file;
        },
        async moveLocal(file, path) {
            const target = await absolute(path);
            await ensureParent(target);
            await rename(file, target);
            if (await exists(infoFile(file))) await rename(infoFile(file), infoFile(target));
            return target;
        },
        async trashLocal(file) {
            const suffix = `.deleted-${Date.now()}`;
            await rename(file, file + suffix);
            if (await exists(infoFile(file))) await rename(infoFile(file), infoFile(file) + suffix);
        },
        async setLocalInfo(file, info) {
            await writeTextFile(infoFile(file), JSON.stringify(info));
        },
        async renameDecks(from, to) {
            unwrapResult(await commands.trainingRenameRepertoire(from, to));
        },
        newId: () => crypto.randomUUID(),
        now: () => Date.now(),
        ...cloudRepertoires(await cloudFirestore(), uid),
    };
}

let currentUid: string | null = null;
/**
 * Held until the signed-in account has agreed to the current terms (see
 * ConsentGate), and while the account is being deleted.
 */
let held = true;
let running: Promise<void> | null = null;
let again = false;
let timer: ReturnType<typeof setTimeout> | null = null;

let liveFirestore: Promise<LiveFirestore> | null = null;
let liveFs: LiveFirestore | null = null;
const live = new LiveSync(
    {
        ...meta,
        listen: (uid, name, after, onNew, onError) => {
            if (!liveFs) throw new Error("Firestore not loaded");
            return listenAfter(liveFs)(uid, name, after, onNew, onError);
        },
    },
    () => void syncNow(),
    (on) => getDefaultStore().set(cloudSyncStatusAtom, (s) => ({ ...s, live: on })),
);

/** Starts or moves the live listeners, unless the sync is held or the window hidden. */
async function refreshLive(uid: string) {
    if (held || uid !== currentUid || document.hidden) return;
    try {
        liveFirestore ??= cloudFirestoreLive();
        liveFs = await liveFirestore;
        if (held || uid !== currentUid || document.hidden) return;
        await live.refresh(uid);
    } catch (e) {
        liveFirestore = null;
        console.warn("Live sync unavailable", e);
    }
}

async function runSync(uid: string) {
    const store = getDefaultStore();
    store.set(cloudSyncStatusAtom, (s) => ({ ...s, state: "syncing" }));
    try {
        // Repertoires first: they give local files the ids the training uses.
        const repertoires = await syncRepertoires(await repertoireBackend(uid), uid);
        if (repertoires.downloaded > 0 || repertoires.conflicts > 0) bumpRepertoires();
        const training = await syncTraining(trainingBackend(uid), uid);
        if (training.changedDecks.length > 0) await reloadTrainingDecks(training.changedDecks);
        // Position store last: its first upload can take several runs.
        const evalSettings = store.get(evalCloudSyncAtom);
        const admin = store.get(cloudAccountAtom)?.role === "admin";
        const evals = evalSettings.enabled
            ? await syncEvals(evalBackend(uid), uid, {
                  minDepth: evalSettings.minDepth,
                  maxDepth: admin ? null : USER_MAX_EVAL_DEPTH,
                  target: admin ? "shared" : "own",
                  pullShared: evalSettings.shared,
                  today: today(),
              })
            : undefined;
        store.set(cloudSyncStatusAtom, (s) => ({
            live: s.live,
            state: "idle",
            lastSync: Date.now(),
            repertoires,
            trainingUploaded: training.uploaded,
            trainingDownloaded: training.downloaded,
            evals,
        }));
    } catch (e) {
        console.error("Cloud sync failed", e);
        store.set(cloudSyncStatusAtom, (s) => ({
            ...s,
            state: "error",
            error: e instanceof Error ? e.message : String(e),
            notAllowed:
                !!e && typeof e === "object" && "code" in e && e.code === "permission-denied",
        }));
    }
}

/** Syncs now (or right after a sync that is already running). */
export function syncNow(): Promise<void> {
    if (!currentUid || held) return Promise.resolve();
    if (running) {
        again = true;
        return running;
    }
    const uid = currentUid;
    running = runSync(uid).finally(() => {
        running = null;
        void refreshLive(uid);
        if (again && currentUid) {
            again = false;
            void syncNow();
        }
    });
    return running;
}

/** A local change: sync a little later, so several changes go up together. */
export function requestSync() {
    if (!currentUid || held) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
        timer = null;
        void syncNow();
    }, CHANGE_DELAY_MS);
}

setLocalChangeListener(requestSync);

/** Sets who is signed in; starts or stops syncing. */
export function setSyncAccount(uid: string | null) {
    if (uid === currentUid) return;
    currentUid = uid;
    live.stop();
    // A new account waits for ConsentGate.
    held = true;
    if (timer) clearTimeout(timer);
    timer = null;
    getDefaultStore().set(cloudSyncStatusAtom, { state: uid ? "idle" : "off" });
}

/** Resolves when no sync is running. */
export async function syncIdle(): Promise<void> {
    while (running) await running.catch(() => {});
}

/** Holds or releases the sync of the signed-in account. */
export function holdSync(hold: boolean) {
    if (held === hold) return;
    held = hold;
    if (hold) {
        if (timer) clearTimeout(timer);
        timer = null;
        live.stop();
    } else {
        void syncNow();
    }
}

const SIGNED_IN_KEY = "cloud-signed-in";

/** Someone signed in on this device before (Firebase then loads at start). */
export function signedInBefore(): boolean {
    try {
        return localStorage.getItem(SIGNED_IN_KEY) === "1";
    } catch {
        return false;
    }
}

/**
 * The signed-in account: `undefined` while Firebase is still loading it,
 * `null` when nobody is signed in.
 */
export const cloudAccountAtom = atom<CloudAccount | null | undefined>(
    signedInBefore() ? undefined : null,
);

/**
 * Starts the sync for the signed-in account. Firebase is only loaded when
 * someone signed in on this device before, so the app starts as fast as
 * ever without an account.
 */
let active: (() => void) | null = null;

export function startCloudSync(force = false): () => void {
    if (active) return () => {};
    if (!signedInBefore() && !force) return () => {};

    let stopped = false;
    let unwatch: (() => void) | null = null;
    watchCloudAccount((account) => {
        try {
            if (account) localStorage.setItem(SIGNED_IN_KEY, "1");
            else localStorage.removeItem(SIGNED_IN_KEY);
        } catch {}
        const before = getDefaultStore().get(cloudAccountAtom);
        getDefaultStore().set(cloudAccountAtom, account);
        setSyncAccount(account?.uid ?? null);
        // A confirmed e-mail address may open the cloud (allowlist): sync again.
        if (
            account?.emailVerified &&
            before &&
            before.uid === account.uid &&
            !before.emailVerified
        ) {
            void syncNow();
        }
        // Normal users store analyses up to depth 28 only; deeper results
        // stay in memory for the session. Admins have no limit.
        void commands.setEvalCacheUserLimit(account?.role === "user").catch(() => {});
    })
        .then((stop) => {
            if (stopped) stop();
            else unwatch = stop;
        })
        .catch((e) => {
            console.error("Cloud account unavailable", e);
            getDefaultStore().set(cloudAccountAtom, null);
        });

    // While the window is hidden or minimised, skip the periodic sync: nothing
    // changes locally then, and focusing the window syncs right away.
    // With live listeners running, only a rare run as a safety net.
    const interval = setInterval(() => {
        if (document.hidden) return;
        const { lastSync } = getDefaultStore().get(cloudSyncStatusAtom);
        if (live.live && lastSync && Date.now() - lastSync < LIVE_SYNC_INTERVAL_MS) return;
        void syncNow();
    }, SYNC_INTERVAL_MS);
    const onFocus = () => requestSync();
    window.addEventListener("focus", onFocus);
    // Hidden: no listeners (nothing to show). Visible again: sync, which
    // starts them at the new positions.
    const onVisibility = () => {
        if (document.hidden) live.stop();
        else void syncNow();
    };
    document.addEventListener("visibilitychange", onVisibility);
    const stop = () => {
        active = null;
        stopped = true;
        unwatch?.();
        clearInterval(interval);
        window.removeEventListener("focus", onFocus);
        document.removeEventListener("visibilitychange", onVisibility);
        live.stop();
    };
    active = stop;
    return stop;
}
