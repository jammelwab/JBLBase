// Runs the cloud sync while someone is signed in: at start, after sign-in,
// every few minutes, shortly after local changes, and on demand.

import { dirname, join } from "@tauri-apps/api/path";
import { exists, mkdir, readDir, readTextFile, rename, writeTextFile } from "@tauri-apps/plugin-fs";
import type { QueryConstraint } from "firebase/firestore/lite";
import { atom, getDefaultStore } from "jotai";
import { commands, type SyncCard, type SyncReview } from "@/bindings";
import {
    type Directory,
    type FileMetadata,
    processEntriesRecursively,
} from "@/components/files/file";
import { reloadTrainingDecks } from "@/state/atoms";
import { getDocumentDir } from "@/utils/directories";
import { bumpRepertoires } from "@/utils/repertoires";
import { type CloudAccount, cloudFirestore, watchCloudAccount } from "./auth";
import { formatSyncCursor, parseSyncCursor } from "./cursor";
import { setLocalChangeListener } from "./syncSignal";
import {
    type LocalRepertoire,
    type RemoteRepertoire,
    type RepertoireSyncBackend,
    type RepertoireSyncResult,
    parseRemoteRepertoire,
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
const CHANGE_DELAY_MS = 15 * 1000;
const PAGE = 300;

export type CloudSyncStatus = {
    state: "off" | "idle" | "syncing" | "error";
    lastSync?: number;
    error?: string;
    repertoires?: RepertoireSyncResult;
    trainingUploaded?: number;
    trainingDownloaded?: number;
    /** The cloud refused access: account not on the allowlist (or e-mail unconfirmed). */
    notAllowed?: boolean;
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

/**
 * All documents of a collection written after the download position
 * `after` (see cursor.ts), page by page, and the position after the last one
 * (unchanged when there is nothing new).
 */
async function fetchAfter(uid: string, name: string, after: string | null) {
    const { db, firestore: fs } = await cloudFirestore();
    const col = fs.collection(db, "users", uid, name);
    const docs: { id: string; data: Record<string, unknown> }[] = [];
    let start = parseSyncCursor(after);
    let cursor = start ? formatSyncCursor(start.seconds, start.nanos, start.id) : null;
    for (;;) {
        const constraints: QueryConstraint[] = [];
        if (start && start.id === "") {
            // A time only (a position from 1.0.28 or older).
            constraints.push(
                fs.where("syncedAt", ">", new fs.Timestamp(start.seconds, start.nanos)),
            );
        }
        constraints.push(fs.orderBy("syncedAt"), fs.orderBy(fs.documentId()));
        if (start && start.id !== "") {
            constraints.push(fs.startAfter(new fs.Timestamp(start.seconds, start.nanos), start.id));
        }
        constraints.push(fs.limit(PAGE));
        const snap = await fs.getDocs(fs.query(col, ...constraints));
        const before = cursor;
        for (const d of snap.docs) {
            const data = d.data();
            docs.push({ id: d.id, data });
            const at = data.syncedAt;
            if (at instanceof fs.Timestamp) {
                cursor = formatSyncCursor(at.seconds, at.nanoseconds, d.id);
                start = { seconds: at.seconds, nanos: at.nanoseconds, id: d.id };
            }
        }
        if (snap.docs.length < PAGE || cursor === before) break;
    }
    return { docs, cursor };
}

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
            const { docs, cursor } = await fetchAfter(uid, "cards", after);
            return {
                items: docs.map((d) => parseRemoteCard(d.data)).filter((c) => c !== null),
                cursor,
            };
        },
        async fetchReviews(after) {
            const { docs, cursor } = await fetchAfter(uid, "reviews", after);
            return {
                items: docs.map((d) => parseRemoteReview(d.id, d.data)).filter((r) => r !== null),
                cursor,
            };
        },
    };
}

function flatten(entries: (FileMetadata | Directory)[]): FileMetadata[] {
    return entries.flatMap((e) => (e.type === "directory" ? flatten(e.children) : [e]));
}

const infoFile = (pgnFile: string) => pgnFile.replace(/\.pgn$/i, ".info");

/** A document with its compressed content (Firestore bytes) as Uint8Array. */
async function withBytes(d: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { firestore: fs } = await cloudFirestore();
    const { pgnGz, ...rest } = d;
    return pgnGz instanceof fs.Bytes ? { ...rest, pgnGz: pgnGz.toUint8Array() } : rest;
}

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
        async fetchChanged(after) {
            const { docs, cursor } = await fetchAfter(uid, "repertoires", after);
            const items: RemoteRepertoire[] = [];
            for (const d of docs) {
                const r = await parseRemoteRepertoire(d.id, await withBytes(d.data));
                if (r) items.push(r);
            }
            return { items, cursor };
        },
        async fetchOne(id) {
            const { db, firestore: fs } = await cloudFirestore();
            const snap = await fs.getDoc(fs.doc(db, "users", uid, "repertoires", id));
            return snap.exists() ? parseRemoteRepertoire(id, await withBytes(snap.data())) : null;
        },
        async put(id, state) {
            const { db, firestore: fs } = await cloudFirestore();
            const content =
                "pgnGz" in state
                    ? { ...state, pgnGz: fs.Bytes.fromUint8Array(state.pgnGz) }
                    : state;
            await fs.setDoc(fs.doc(db, "users", uid, "repertoires", id), {
                ...content,
                syncedAt: fs.serverTimestamp(),
            });
        },
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

async function runSync(uid: string) {
    const store = getDefaultStore();
    store.set(cloudSyncStatusAtom, (s) => ({ ...s, state: "syncing" }));
    try {
        // Repertoires first: they give local files the ids the training uses.
        const repertoires = await syncRepertoires(await repertoireBackend(uid), uid);
        if (repertoires.downloaded > 0 || repertoires.conflicts > 0) bumpRepertoires();
        const training = await syncTraining(trainingBackend(uid), uid);
        if (training.changedDecks.length > 0) await reloadTrainingDecks(training.changedDecks);
        store.set(cloudSyncStatusAtom, {
            state: "idle",
            lastSync: Date.now(),
            repertoires,
            trainingUploaded: training.uploaded,
            trainingDownloaded: training.downloaded,
        });
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
    const interval = setInterval(() => {
        if (!document.hidden) void syncNow();
    }, SYNC_INTERVAL_MS);
    const onFocus = () => requestSync();
    window.addEventListener("focus", onFocus);
    const stop = () => {
        active = null;
        stopped = true;
        unwatch?.();
        clearInterval(interval);
        window.removeEventListener("focus", onFocus);
    };
    active = stop;
    return stop;
}
