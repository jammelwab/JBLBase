// Runs the cloud sync while someone is signed in: at start, after sign-in,
// every few minutes, shortly after local changes, and on demand.

import { fetchBossBook, fetchCoachProfile, syncCoachState, syncRival } from "./coachCloud";
import { dirname, join } from "@tauri-apps/api/path";
import { exists, mkdir, readDir, readTextFile, rename, writeTextFile } from "@tauri-apps/plugin-fs";
import type * as Firestore from "firebase/firestore/lite";
import i18n from "i18next";
import { atom, getDefaultStore } from "jotai";
import { commands, type SyncCard, type SyncReview } from "@/bindings";
import {
    type Directory,
    type FileMetadata,
    processEntriesRecursively,
} from "@/components/files/file";
import { evalCloudSyncAtom, reloadTrainingDecks } from "@/state/atoms";
import { getDocumentDir } from "@/utils/directories";
import { DEFAULT_MAIN_OWNER, getMainOwner } from "@/utils/mainOwner";
import { bumpRepertoires } from "@/utils/repertoires";
import {
    bigBucket,
    bucket,
    DAY_MS,
    errorKind,
    HOUR_MS,
    trackUsageThrottled,
} from "@/utils/usageStats";
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
import {
    cloudRepertoires,
    fetchAccountUsage,
    fetchAfter,
    fetchLimits,
    putDeviceUsage,
} from "./firestoreDocs";
import { type LiveFirestore, listenAfter } from "./liveFirestore";
import { LiveSync } from "./liveSync";
import {
    type LocalSharedFile,
    type OwnRepertoire,
    parseSharedInfo,
    safeFileName,
    type ShareSyncBackend,
    type ShareSyncResult,
    syncShares,
} from "./shareSync";
import { cloudShares, ownRecipientKeys } from "./shares";
import { setLocalChangeListener } from "./syncSignal";
import {
    addCounts,
    decide,
    emptyCounts,
    parseCounts,
    parseLimits,
    totalOf,
    type UsageCount,
    type UsageCounts,
    type UsageLimits,
    usageDay,
    usageMeter,
} from "./usage";
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
    /** The device has no network connection. */
    offline?: boolean;
    /** Conflict copies made since they were last dismissed (#111). */
    conflictCopies?: { path: string; file: string }[];
    /** Today's cloud usage (#114). */
    usage?: { device: UsageCounts; account: UsageCount };
    /** Far above the daily limit (only a bug gets there): the sync pauses until tomorrow. */
    limited?: boolean;
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
            usageMeter.write("training", cards.length + reviews.length);
        },
        async fetchCards(after) {
            const { docs, cursor } = await fetchAfter(await cloudFirestore(), uid, "cards", after);
            usageMeter.read("training", docs.length);
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
            usageMeter.read("training", docs.length);
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
            usageMeter.write("evals", evals.length);
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
            usageMeter.read("evals", snap.docs.length);
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
                // A repertoire someone shared with this account stays out of its own
                // repertoires; it comes from the share (see shareSync.ts)
                if (parseSharedInfo(info.shared)) continue;
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
        ...countedRepertoires(cloudRepertoires(await cloudFirestore(), uid)),
    };
}

/** The name a share shows as its sender: the player name, else the account's name. */
export function shareOwnerName(account: CloudAccount | null | undefined): string {
    const main = getMainOwner();
    if (main && main !== DEFAULT_MAIN_OWNER) return main;
    return account?.displayName || account?.email?.split("@")[0] || main;
}

async function localRepertoireFiles(dir: string) {
    const files = flatten(await processEntriesRecursively(dir, await readDir(dir))).filter(
        (f) => f.metadata.type === "repertoire",
    );
    const out: { file: string; info: Record<string, unknown> }[] = [];
    for (const f of files) {
        try {
            out.push({ file: f.path, info: JSON.parse(await readTextFile(infoFile(f.path))) });
        } catch {
            // without .info it is neither shared nor synced
        }
    }
    return out;
}

/** Shared repertoires (#120), sent and received with the cloud sync. */
async function shareBackend(account: CloudAccount): Promise<ShareSyncBackend> {
    const dir = await getDocumentDir();
    const cloud = cloudShares(await cloudFirestore());
    const writeInfo = (file: string, info: Record<string, unknown>) =>
        writeTextFile(infoFile(file), JSON.stringify(info));
    return {
        uid: account.uid,
        ownerName: shareOwnerName(account),
        async listOwn() {
            const own = await cloud.listOwn(account.uid);
            usageMeter.read("repertoires", Math.max(1, own.length));
            return own;
        },
        async listIncoming() {
            const keys = ownRecipientKeys(account);
            if (keys.length === 0) return [];
            const incoming = await cloud.listIncoming(keys);
            usageMeter.read("repertoires", Math.max(keys.length, incoming.length));
            return incoming;
        },
        async update(id, content) {
            await cloud.update(id, content);
            usageMeter.write("repertoires", 1);
        },
        async ownRepertoires() {
            const out: OwnRepertoire[] = [];
            for (const { file, info } of await localRepertoireFiles(dir)) {
                if (typeof info.id !== "string" || parseSharedInfo(info.shared)) continue;
                const name = file
                    .split(/[\\/]/)
                    .pop()!
                    .replace(/\.pgn$/i, "");
                out.push({
                    id: info.id,
                    name,
                    color: info.color === "black" ? "black" : "white",
                    pgn: await readTextFile(file),
                });
            }
            return out;
        },
        async sharedFiles() {
            const out: LocalSharedFile[] = [];
            for (const { file, info } of await localRepertoireFiles(dir)) {
                const shared = parseSharedInfo(info.shared);
                if (shared) out.push({ file, shared });
            }
            return out;
        },
        async writeShared(share, existing) {
            const shared = { id: share.id, from: share.ownerName, hash: share.hash };
            if (existing) {
                const info = JSON.parse(await readTextFile(infoFile(existing.file)));
                await writeTextFile(existing.file, share.pgn);
                await writeInfo(existing.file, { ...info, color: share.color, shared });
                return;
            }
            const folder = await join(dir, "Geteilt", safeFileName(share.ownerName));
            if (!(await exists(folder))) await mkdir(folder, { recursive: true });
            let file = await join(folder, `${safeFileName(share.name)}.pgn`);
            for (let n = 2; await exists(file); n++) {
                file = await join(folder, `${safeFileName(share.name)} (${n}).pgn`);
            }
            await writeTextFile(file, share.pgn);
            await writeInfo(file, {
                type: "repertoire",
                tags: [],
                color: share.color,
                owner: getMainOwner(),
                folder: i18n.t("Repertoire.Share.Folder", { name: share.ownerName }),
                shared,
            });
        },
        async markEnded(f) {
            const info = JSON.parse(await readTextFile(infoFile(f.file)));
            await writeInfo(f.file, { ...info, shared: { ...f.shared, ended: true } });
        },
    };
}

/** The cloud side of the repertoire sync, counted (see usage.ts). */
function countedRepertoires(
    cloud: ReturnType<typeof cloudRepertoires>,
): ReturnType<typeof cloudRepertoires> {
    return {
        async fetchChanged(after) {
            const changed = await cloud.fetchChanged(after);
            usageMeter.read("repertoires", changed.items.length);
            return changed;
        },
        async fetchOne(id) {
            usageMeter.read("repertoires", 1);
            return cloud.fetchOne(id);
        },
        async put(id, state) {
            await cloud.put(id, state);
            usageMeter.write("repertoires", 1);
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

let liveFirestore: Promise<LiveFirestore> | null = null;
let liveFs: LiveFirestore | null = null;
const live = new LiveSync(
    {
        ...meta,
        listen: (uid, name, after, onNew, onError) => {
            if (!liveFs) throw new Error("Firestore not loaded");
            // Starting a listener costs one read, each change one more.
            usageMeter.read("live", 1);
            return listenAfter(liveFs)(
                uid,
                name,
                after,
                () => {
                    usageMeter.read("live", 1);
                    onNew();
                },
                onError,
            );
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

const DEVICE_KEY = "cloud-device-id";

/** Random id of this installation, a field name in the usage document. */
function deviceId(): string {
    try {
        let id = localStorage.getItem(DEVICE_KEY);
        if (!id) {
            id = `d${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
            localStorage.setItem(DEVICE_KEY, id);
        }
        return id;
    } catch {
        return "unknown";
    }
}

let limits: UsageLimits | null = null;
/** What this device last wrote to the usage document (to skip unchanged writes). */
let usageWritten = "";

/**
 * Today's usage of the account: the other devices from the usage document,
 * this one from the meter. Loads this device's earlier counts once.
 */
async function otherDevicesUsage(uid: string, day: string): Promise<UsageCounts> {
    const metaKey = `usage:${uid}:${day}`;
    if (usageMeter.needsLoad(uid, day)) {
        let stored = emptyCounts();
        try {
            stored = parseCounts(JSON.parse((await meta.metaGet(metaKey)) ?? "null"));
        } catch {}
        usageMeter.load(uid, day, stored);
    }
    const cf = await cloudFirestore();
    if (!limits) {
        limits = parseLimits(await fetchLimits(cf).catch(() => null));
        usageMeter.read("meta", 1);
    }
    let others = emptyCounts();
    // Without the usage document (e.g. rules not deployed yet) only this
    // device counts; the sync itself must not fail because of it.
    let devices: Record<string, unknown> = {};
    try {
        devices = await fetchAccountUsage(cf, uid, day);
    } catch (e) {
        console.warn("Account usage unavailable", e);
    }
    usageMeter.read("meta", 1);
    const me = deviceId();
    for (const [device, counts] of Object.entries(devices)) {
        if (device !== me) others = addCounts(others, parseCounts(counts));
    }
    return others;
}

/** The counts without the bookkeeping itself (which changes on every run). */
function syncedWork(counts: UsageCounts): string {
    const { meta: _meta, ...rest } = counts;
    return `${usageMeter.day} ${JSON.stringify(rest)}`;
}

/**
 * Stores this device's counts: locally always, in the cloud only when the
 * sync did real work since the last write, so a run without changes still
 * writes nothing (#99).
 */
async function saveUsage(uid: string, day: string) {
    await meta.metaSet(`usage:${uid}:${day}`, JSON.stringify(usageMeter.counts)).catch(() => {});
    const work = syncedWork(usageMeter.counts);
    if (work === usageWritten) return;
    try {
        usageMeter.write("meta", 1);
        await putDeviceUsage(await cloudFirestore(), uid, day, deviceId(), usageMeter.counts);
        usageWritten = work;
        await meta
            .metaSet(`usage:${uid}:${day}`, JSON.stringify(usageMeter.counts))
            .catch(() => {});
    } catch (e) {
        console.warn("Usage not stored", e);
    }
}

function usageNow(others: UsageCounts) {
    return {
        device: structuredClone(usageMeter.counts),
        account: totalOf(addCounts(others, usageMeter.counts)),
    };
}

/** One usage event per area and hour for a sync that worked (#115). */
function countSyncRun(area: string, changes: number) {
    trackUsageThrottled("sync_run", { area, changes: bucket(changes) }, area, HOUR_MS);
}

async function runSync(uid: string) {
    const store = getDefaultStore();
    store.set(cloudSyncStatusAtom, (s) => ({ ...s, state: "syncing" }));
    const day = usageDay();
    usageMeter.roll(day);
    const admin = store.get(cloudAccountAtom)?.role === "admin";
    let others = emptyCounts();
    // Which part of the sync was running when it failed (for the statistics)
    let area = "meta";
    try {
        others = await otherDevicesUsage(uid, day);
        const allowed = decide(addCounts(others, usageMeter.counts), limits!, admin);
        if (!allowed.sync) {
            trackUsageThrottled("sync_paused", { limit: "total" }, "total", DAY_MS);
            store.set(cloudSyncStatusAtom, (s) => ({
                ...s,
                state: "idle",
                limited: true,
                usage: usageNow(others),
            }));
            await saveUsage(uid, day);
            return;
        }
        // Repertoires first: they give local files the ids the training uses.
        area = "repertoires";
        const repertoires = await syncRepertoires(await repertoireBackend(uid), uid);
        if (repertoires.downloaded > 0 || repertoires.conflicts > 0) bumpRepertoires();
        // Shared repertoires: a failure here must not stop the rest of the sync
        const account = store.get(cloudAccountAtom);
        let shares: ShareSyncResult | undefined;
        if (account && account.uid === uid) {
            shares = await syncShares(await shareBackend(account)).catch((e) => {
                console.warn("Shared repertoires not synced", e);
                return undefined;
            });
            if (shares && shares.received + shares.ended > 0) bumpRepertoires();
        }
        countSyncRun("repertoires", repertoires.uploaded + repertoires.downloaded);
        area = "training";
        const training = await syncTraining(trainingBackend(uid), uid);
        if (training.changedDecks.length > 0) await reloadTrainingDecks(training.changedDecks);
        // Position store last: its first upload can take several runs.
        countSyncRun("training", training.uploaded + training.downloaded);
        // JBL Coach: XP, Trophäen, Serie und Einstellungen; ein Fehler hier
        // hält den Rest nicht auf.
        area = "coach";
        try {
            const cf = await cloudFirestore();
            const coach = await syncCoachState(cf, uid, deviceId(), store);
            usageMeter.read("training", coach.reads);
            if (coach.writes) usageMeter.write("training", coach.writes);
            await fetchCoachProfile(cf, uid, store).catch(() => {});
            await fetchBossBook(cf, store).catch(() => {});
            usageMeter.read("training", 2);
            const rival = await syncRival(cf, uid, store).catch(() => ({ reads: 0, writes: 0 }));
            if (rival.reads) usageMeter.read("training", rival.reads);
            if (rival.writes) usageMeter.write("training", rival.writes);
        } catch (e) {
            console.warn("Coach not synced", e);
        }
        area = "evals";
        const evalSettings = store.get(evalCloudSyncAtom);
        if (evalSettings.enabled && !allowed.evals) {
            trackUsageThrottled("sync_paused", { limit: "evals" }, "evals", DAY_MS);
        }
        // Over the position store's daily limit it pauses silently until tomorrow.
        const evals =
            evalSettings.enabled && allowed.evals
                ? await syncEvals(evalBackend(uid), uid, {
                      minDepth: evalSettings.minDepth,
                      maxDepth: admin ? null : USER_MAX_EVAL_DEPTH,
                      target: admin ? "shared" : "own",
                      pullShared: evalSettings.shared,
                      today: today(),
                  })
                : undefined;
        if (evals) {
            countSyncRun("evals", evals.uploaded + evals.downloaded);
            if (evals.uploaded + evals.downloaded > 0) {
                trackUsageThrottled(
                    "eval_cloud",
                    {
                        up: bigBucket(evals.uploaded),
                        down: bigBucket(evals.downloaded),
                        source: admin ? "shared" : "own",
                    },
                    "evals",
                    HOUR_MS,
                );
            }
        }
        store.set(cloudSyncStatusAtom, (s) => ({
            live: s.live,
            offline: s.offline,
            conflictCopies: [...(s.conflictCopies ?? []), ...repertoires.conflictCopies],
            state: "idle",
            lastSync: Date.now(),
            repertoires,
            trainingUploaded: training.uploaded,
            trainingDownloaded: training.downloaded,
            evals,
            limited: false,
            usage: usageNow(others),
        }));
        await saveUsage(uid, day);
    } catch (e) {
        void saveUsage(uid, day);
        console.error("Cloud sync failed", e);
        const kind = errorKind(e);
        trackUsageThrottled("sync_error", { area, kind }, `${area}:${kind}`, HOUR_MS);
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

/** The conflict copies were seen: stop pointing at them. */
export function dismissConflicts() {
    getDefaultStore().set(cloudSyncStatusAtom, (s) => ({ ...s, conflictCopies: [] }));
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
    getDefaultStore().set(cloudSyncStatusAtom, (s) => ({
        state: uid ? "idle" : "off",
        offline: s.offline,
    }));
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
    // Offline: say so; back online: sync right away.
    const onNetwork = () => {
        const offline = !navigator.onLine;
        getDefaultStore().set(cloudSyncStatusAtom, (s) => ({ ...s, offline }));
        if (!offline) void syncNow();
    };
    if (!navigator.onLine) onNetwork();
    window.addEventListener("online", onNetwork);
    window.addEventListener("offline", onNetwork);
    const stop = () => {
        active = null;
        stopped = true;
        unwatch?.();
        clearInterval(interval);
        window.removeEventListener("focus", onFocus);
        document.removeEventListener("visibilitychange", onVisibility);
        window.removeEventListener("online", onNetwork);
        window.removeEventListener("offline", onNetwork);
        live.stop();
    };
    active = stop;
    return stop;
}
