// Repertoire sync: every repertoire file is synced as a whole.
//
// Firestore: users/{uid}/repertoires/{id} with
//   path      file path below the files folder, "/"-separated, without ".pgn"
//   info      the .info metadata as JSON (without the id)
//   pgn       the file content
//   hash      SHA-256 of path, info and pgn
//   updatedAt client time of the change (ms)
//   deleted   deletion mark, so an offline device does not bring it back
//   syncedAt  server time of the upload (for "what changed since")
//
// Each device remembers per repertoire the hash both sides had after the
// last sync (the base). With it, a change is recognised on either side:
// only local changed → upload, only remote changed → download, both → the
// newer one wins and the other version is kept as a copy marked
// "Konflikt", so nothing is lost.

export const MAX_PGN_LENGTH = 900_000;
/** Pull a little before the cursor, in case of clock skew; applying twice does nothing. */
export const CURSOR_OVERLAP_MS = 2 * 60 * 1000;

export type RemoteState = {
    path: string;
    info: string;
    hash: string;
    updatedAt: number;
    deleted: boolean;
};

export type RemoteRepertoire = RemoteState & { id: string; pgn: string; syncedAt: number };

export type LocalRepertoire = {
    /** Absolute path of the .pgn file. */
    file: string;
    /** Relative path, see `relativePath`. */
    path: string;
    info: Record<string, unknown>;
    pgn: string;
    /** Last change of the file (ms). */
    modifiedAt: number;
};

export type Plan =
    | { kind: "none" }
    | { kind: "setBase" }
    | { kind: "push" }
    | { kind: "pull" }
    | { kind: "pushDelete" }
    | { kind: "deleteLocal" }
    | { kind: "conflict"; winner: "local" | "remote" };

/** What to do with one repertoire, from its local and remote state and the base hash. */
export function planRepertoire(
    local: { hash: string; modifiedAt: number } | undefined,
    remote: { hash: string; updatedAt: number; deleted: boolean } | undefined,
    base: string | undefined,
): Plan {
    if (!local && !remote) return { kind: "none" };
    if (local && !remote) return { kind: "push" };
    if (!local && remote) {
        if (remote.deleted) return { kind: "none" };
        if (base !== undefined && base === remote.hash) return { kind: "pushDelete" };
        return { kind: "pull" };
    }
    const l = local!;
    const r = remote!;
    if (r.deleted) {
        return base !== undefined && l.hash === base ? { kind: "deleteLocal" } : { kind: "push" };
    }
    if (l.hash === r.hash) return base === l.hash ? { kind: "none" } : { kind: "setBase" };
    const localChanged = base === undefined || l.hash !== base;
    const remoteChanged = base === undefined || r.hash !== base;
    if (localChanged && !remoteChanged) return { kind: "push" };
    if (!localChanged && remoteChanged) return { kind: "pull" };
    return { kind: "conflict", winner: l.modifiedAt > r.updatedAt ? "local" : "remote" };
}

/** Path below the files folder with "/" separators and without ".pgn". */
export function relativePath(dir: string, file: string): string | null {
    const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
    const d = norm(dir);
    const f = norm(file);
    if (!f.toLowerCase().startsWith(`${d.toLowerCase()}/`)) return null;
    return f.slice(d.length + 1).replace(/\.pgn$/i, "");
}

/** The .info metadata without the id, with sorted keys, so equal infos give equal text. */
export function infoText(info: Record<string, unknown>): string {
    const { id: _id, ...rest } = info;
    return JSON.stringify(rest, Object.keys(rest).sort());
}

export async function repertoireHash(path: string, info: string, pgn: string): Promise<string> {
    const data = new TextEncoder().encode(`${path}\n${info}\n${pgn}`);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Name of the copy that keeps the losing side of a conflict. */
export function conflictPath(path: string, date: Date): string {
    const stamp = date.toISOString().slice(0, 16).replace("T", " ").replace(":", "-");
    return `${path} (Konflikt ${stamp})`;
}

export interface RepertoireSyncBackend {
    /** Absolute path of the files folder. */
    dir: string;
    listLocal(): Promise<LocalRepertoire[]>;
    /** Writes .pgn and .info at `path`, creating folders; returns the absolute file. */
    writeLocal(path: string, info: Record<string, unknown>, pgn: string): Promise<string>;
    /** Moves .pgn and .info to `path`; returns the new absolute file. */
    moveLocal(file: string, path: string): Promise<string>;
    /** Moves .pgn and .info out of the file list (kept as *.deleted). */
    trashLocal(file: string): Promise<void>;
    setLocalInfo(file: string, info: Record<string, unknown>): Promise<void>;
    renameDecks(from: string, to: string): Promise<void>;
    newId(): string;
    now(): number;
    fetchChanged(since: number): Promise<RemoteRepertoire[]>;
    fetchOne(id: string): Promise<RemoteRepertoire | null>;
    put(id: string, state: RemoteState & { pgn: string }): Promise<void>;
    metaGet(key: string): Promise<string | null>;
    metaSet(key: string, value: string | null): Promise<void>;
}

export type RepertoireSyncResult = {
    uploaded: number;
    downloaded: number;
    conflicts: number;
    /** Repertoires that are too big for the cloud. */
    tooBig: string[];
    /** Local deletions were not uploaded because too many files were missing at once. */
    deletionsHeld: boolean;
};

type Local = LocalRepertoire & { id: string; infoJson: string; hash: string };

function parseJson<T>(text: string | null, fallback: T): T {
    if (!text) return fallback;
    try {
        return JSON.parse(text) as T;
    } catch {
        return fallback;
    }
}

export async function syncRepertoires(
    b: RepertoireSyncBackend,
    uid: string,
): Promise<RepertoireSyncResult> {
    const result: RepertoireSyncResult = {
        uploaded: 0,
        downloaded: 0,
        conflicts: 0,
        tooBig: [],
        deletionsHeld: false,
    };
    const key = (name: string) => `${name}:${uid}`;
    const index = parseJson<Record<string, RemoteState>>(await b.metaGet(key("repIndex")), {});
    let bases = parseJson<Record<string, string>>(await b.metaGet(key("repBase")), {});
    const cursor = Number((await b.metaGet(key("repCursor"))) ?? 0) || 0;
    // Another files folder: link everything again by path, delete nothing.
    if ((await b.metaGet(key("repDir"))) !== b.dir) bases = {};

    const remotePgn = new Map<string, string>();
    let newCursor = cursor;
    for (const r of await b.fetchChanged(Math.max(0, cursor - CURSOR_OVERLAP_MS))) {
        const { id, pgn, syncedAt, ...state } = r;
        index[id] = state;
        remotePgn.set(id, pgn);
        newCursor = Math.max(newCursor, syncedAt);
    }

    const locals: Local[] = [];
    for (const l of await b.listLocal()) {
        const infoJson = infoText(l.info);
        locals.push({
            ...l,
            id: typeof l.info.id === "string" ? l.info.id : "",
            infoJson,
            hash: await repertoireHash(l.path, infoJson, l.pgn),
        });
    }

    // Link local repertoires the cloud does not know by id to a remote one
    // with the same path (the same file on another device), or give them an id.
    const localIds = new Set(locals.map((l) => l.id).filter(Boolean));
    for (const l of locals) {
        if (l.id && (index[l.id] || bases[l.id] !== undefined)) continue;
        const match = Object.entries(index).find(
            ([id, r]) =>
                !r.deleted &&
                !localIds.has(id) &&
                bases[id] === undefined &&
                r.path.toLowerCase() === l.path.toLowerCase(),
        );
        const id = match ? match[0] : l.id || b.newId();
        if (id === l.id) continue;
        if (l.id) await b.renameDecks(l.id, id);
        l.info = { ...l.info, id };
        await b.setLocalInfo(l.file, l.info);
        localIds.delete(l.id);
        localIds.add(id);
        l.id = id;
    }

    const byId = new Map(locals.map((l) => [l.id, l]));
    const missing = Object.keys(bases).filter((id) => !byId.has(id) && !index[id]?.deleted);
    const holdDeletions = missing.length > 2 && missing.length * 2 > Object.keys(bases).length;
    result.deletionsHeld = holdDeletions;

    const remoteContent = async (id: string) => {
        const known = remotePgn.get(id);
        if (known !== undefined) return known;
        const r = await b.fetchOne(id);
        if (!r) return null;
        index[id] = {
            path: r.path,
            info: r.info,
            hash: r.hash,
            updatedAt: r.updatedAt,
            deleted: r.deleted,
        };
        remotePgn.set(id, r.pgn);
        return r.pgn;
    };

    const push = async (id: string, l: Local) => {
        if (l.pgn.length > MAX_PGN_LENGTH) {
            result.tooBig.push(l.path);
            return;
        }
        const state: RemoteState = {
            path: l.path,
            info: l.infoJson,
            hash: l.hash,
            // When the file was changed, so the newer edit wins a conflict.
            updatedAt: Math.max(l.modifiedAt, (index[id]?.updatedAt ?? 0) + 1),
            deleted: false,
        };
        await b.put(id, { ...state, pgn: l.pgn });
        index[id] = state;
        bases[id] = l.hash;
        result.uploaded++;
    };

    const pull = async (id: string, l: Local | undefined) => {
        const r = index[id];
        const pgn = await remoteContent(id);
        if (pgn === null) return;
        const info = { ...parseJson<Record<string, unknown>>(r.info, {}), id };
        let file = l?.file;
        if (file && l && l.path !== r.path) file = await b.moveLocal(file, r.path);
        await b.writeLocal(r.path, info, pgn);
        bases[id] = r.hash;
        result.downloaded++;
    };

    const keepCopy = async (path: string, info: Record<string, unknown>, pgn: string) => {
        const { id: _id, ...rest } = info;
        const tags = Array.isArray(rest.tags) ? rest.tags : [];
        await b.writeLocal(
            conflictPath(path, new Date(b.now())),
            { ...rest, type: "other", tags: [...tags, "Konflikt"] },
            pgn,
        );
    };

    const ids = new Set([...byId.keys(), ...Object.keys(index), ...Object.keys(bases)]);
    for (const id of ids) {
        const l = byId.get(id);
        const r = index[id];
        const plan = planRepertoire(l, r, bases[id]);
        switch (plan.kind) {
            case "none":
                if (!l && r?.deleted) delete bases[id];
                break;
            case "setBase":
                bases[id] = l!.hash;
                break;
            case "push":
                await push(id, l!);
                break;
            case "pull":
                await pull(id, l);
                break;
            case "pushDelete": {
                if (holdDeletions) break;
                const state: RemoteState = {
                    ...r!,
                    hash: "",
                    updatedAt: Math.max(b.now(), r!.updatedAt + 1),
                    deleted: true,
                };
                await b.put(id, { ...state, pgn: "" });
                index[id] = state;
                delete bases[id];
                result.uploaded++;
                break;
            }
            case "deleteLocal":
                await b.trashLocal(l!.file);
                delete bases[id];
                result.downloaded++;
                break;
            case "conflict": {
                result.conflicts++;
                if (plan.winner === "local") {
                    const pgn = await remoteContent(id);
                    if (pgn !== null) {
                        await keepCopy(r!.path, parseJson(r!.info, {}), pgn);
                    }
                    await push(id, l!);
                } else {
                    await keepCopy(l!.path, l!.info, l!.pgn);
                    await pull(id, l);
                }
                break;
            }
        }
    }

    await b.metaSet(key("repIndex"), JSON.stringify(index));
    await b.metaSet(key("repBase"), JSON.stringify(bases));
    await b.metaSet(key("repCursor"), String(newCursor));
    await b.metaSet(key("repDir"), b.dir);
    return result;
}
