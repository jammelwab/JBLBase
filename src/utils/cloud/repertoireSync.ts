// Repertoire sync: every repertoire file is synced as a whole.
//
// Firestore: users/{uid}/repertoires/{id} with
//   path      file path below the files folder, "/"-separated, without ".pgn"
//   info      the .info metadata as JSON (without the id)
//   pgn       the file content, or instead
//   pgnGz     the file content gzip-compressed, for files too big as text (#100)
//   hash      SHA-256 of path, info and pgn
//   updatedAt client time of the change (ms)
//   deleted   deletion mark, so an offline device does not bring it back
//   syncedAt  server time of the upload (for "what changed since", see cursor.ts)
//
// Each device remembers per repertoire the hash both sides had after the
// last sync (the base). With it, a change is recognised on either side:
// only local changed → upload, only remote changed → download, both → the
// newer one wins and the other version is kept as a copy marked
// "Konflikt", so nothing is lost.

/** Longest file sent as plain text; larger ones go compressed. */
export const MAX_PGN_LENGTH = 900_000;
/** Largest compressed file (a Firestore document holds at most 1 MiB). */
export const MAX_PGN_GZ_BYTES = 900_000;

/**
 * The file content as stored in the cloud. Up to MAX_PGN_LENGTH it stays
 * plain text, which 1.0.28 can read as well; a larger file is compressed
 * (PGN shrinks to about a fifth). 1.0.28 ignores such a document.
 */
export type PackedPgn = { pgn: string } | { pgnGz: Uint8Array };

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream) {
    const writer = stream.writable.getWriter();
    const written = writer.write(data as Uint8Array<ArrayBuffer>).then(() => writer.close());
    // Damaged input fails the reading side as well; the error is thrown there.
    written.catch(() => {});
    const chunks: Uint8Array[] = [];
    const reader = stream.readable.getReader();
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
    }
    await written;
    const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let at = 0;
    for (const c of chunks) {
        out.set(c, at);
        at += c.length;
    }
    return out;
}

/** The content to upload; null when it is too big even compressed. */
export async function packPgn(pgn: string): Promise<PackedPgn | null> {
    if (pgn.length <= MAX_PGN_LENGTH) return { pgn };
    const pgnGz = await pipe(new TextEncoder().encode(pgn), new CompressionStream("gzip"));
    return pgnGz.length <= MAX_PGN_GZ_BYTES ? { pgnGz } : null;
}

/** The file content of a document; null when it has none or it is damaged. */
export async function unpackPgn(d: { pgn?: unknown; pgnGz?: Uint8Array }): Promise<string | null> {
    if (typeof d.pgn === "string") return d.pgn;
    if (!d.pgnGz) return null;
    try {
        const text = await pipe(d.pgnGz, new DecompressionStream("gzip"));
        return new TextDecoder("utf-8", { fatal: true }).decode(text);
    } catch {
        return null;
    }
}

export type RemoteState = {
    path: string;
    info: string;
    hash: string;
    updatedAt: number;
    deleted: boolean;
};

export type RemoteRepertoire = RemoteState & { id: string; pgn: string };

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

/**
 * A repertoire document from the cloud (compressed content as Uint8Array);
 * null when it is malformed.
 */
export async function parseRemoteRepertoire(
    id: string,
    d: Record<string, unknown>,
): Promise<RemoteRepertoire | null> {
    const { path, info, hash, updatedAt, deleted, pgnGz } = d;
    if (
        typeof path !== "string" ||
        typeof info !== "string" ||
        typeof hash !== "string" ||
        typeof updatedAt !== "number" ||
        path.split("/").some((part) => part === "" || part === "." || part === "..")
    ) {
        return null;
    }
    const pgn = await unpackPgn({
        pgn: d.pgn,
        pgnGz: pgnGz instanceof Uint8Array ? pgnGz : undefined,
    });
    if (pgn === null) return null;
    return { id, path, info, pgn, hash, updatedAt, deleted: deleted === true };
}

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
    /**
     * Repertoires written after the download position `after` (null: all) and
     * the position after them (see cursor.ts); unchanged when nothing is new.
     */
    fetchChanged(
        after: string | null,
    ): Promise<{ items: RemoteRepertoire[]; cursor: string | null }>;
    fetchOne(id: string): Promise<RemoteRepertoire | null>;
    put(id: string, state: RemoteState & PackedPgn): Promise<void>;
    metaGet(key: string): Promise<string | null>;
    metaSet(key: string, value: string | null): Promise<void>;
}

export type RepertoireSyncResult = {
    uploaded: number;
    downloaded: number;
    conflicts: number;
    /** The copies that keep the losing side of a conflict (path below the files folder, file). */
    conflictCopies: { path: string; file: string }[];
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
        conflictCopies: [],
        tooBig: [],
        deletionsHeld: false,
    };
    const key = (name: string) => `${name}:${uid}`;
    const index = parseJson<Record<string, RemoteState>>(await b.metaGet(key("repIndex")), {});
    let bases = parseJson<Record<string, string>>(await b.metaGet(key("repBase")), {});
    const cursor = await b.metaGet(key("repCursor"));
    // Another files folder: link everything again by path, delete nothing.
    if ((await b.metaGet(key("repDir"))) !== b.dir) bases = {};

    const remotePgn = new Map<string, string>();
    const changed = await b.fetchChanged(cursor);
    for (const r of changed.items) {
        const { id, pgn, ...state } = r;
        index[id] = state;
        remotePgn.set(id, pgn);
    }

    let locals: Local[] = [];
    for (const l of await b.listLocal()) {
        const infoJson = infoText(l.info);
        locals.push({
            ...l,
            id: typeof l.info.id === "string" ? l.info.id : "",
            infoJson,
            hash: await repertoireHash(l.path, infoJson, l.pgn),
        });
    }

    // Two files with one id (a file copied in the file manager, or a conflict copy of a
    // cloud drive like iCloud or OneDrive): the file at the path the cloud knows keeps the
    // id, the others become repertoires of their own. Otherwise only one of them would be
    // synced, and its path would win by chance.
    const sameId = new Map<string, Local[]>();
    for (const l of locals) {
        if (l.id) sameId.set(l.id, [...(sameId.get(l.id) ?? []), l]);
    }
    for (const [id, group] of sameId) {
        if (group.length < 2) continue;
        const known = index[id]?.path.toLowerCase();
        const sorted = [...group].sort((a, b) => a.path.localeCompare(b.path));
        const keeper = sorted.find((l) => l.path.toLowerCase() === known) ?? sorted[0];
        for (const l of group) {
            if (l === keeper) continue;
            l.id = "";
            const { id: _id, ...rest } = l.info;
            l.info = rest;
        }
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
        const packed = await packPgn(l.pgn);
        if (!packed) {
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
        await b.put(id, { ...state, ...packed });
        index[id] = state;
        bases[id] = l.hash;
        result.uploaded++;
    };

    const pushDelete = async (id: string) => {
        const r = index[id];
        const state: RemoteState = {
            ...r,
            hash: "",
            updatedAt: Math.max(b.now(), r.updatedAt + 1),
            deleted: true,
        };
        await b.put(id, { ...state, pgn: "" });
        index[id] = state;
        delete bases[id];
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
        const copy = conflictPath(path, new Date(b.now()));
        const file = await b.writeLocal(
            copy,
            { ...rest, type: "other", tags: [...tags, "Konflikt"] },
            pgn,
        );
        result.conflictCopies.push({ path: copy, file });
    };

    // Two repertoires in the cloud at the same path: created on two devices (e.g. "Ich Weiß"
    // with "Standard-Repertoires anlegen") before either had synced. One file can hold only
    // one of them; without this, each device overwrote its file with the other one's and
    // then deleted both. The smaller id wins on every device alike, the other one is kept
    // here as a conflict copy and deleted in the cloud.
    const live = (id: string) => (index[id] && !index[id].deleted ? index[id] : undefined);
    const localById = new Set(locals.map((l) => l.id));
    for (const l of [...locals]) {
        const own = live(l.id);
        if (!own || own.path.toLowerCase() !== l.path.toLowerCase()) continue;
        const other = Object.keys(index).find(
            (id) =>
                id !== l.id &&
                !localById.has(id) &&
                live(id)?.path.toLowerCase() === l.path.toLowerCase(),
        );
        if (!other) continue;
        result.conflicts++;
        if (other < l.id) {
            // The other one wins: keep this file as a copy, it is downloaded below.
            await keepCopy(l.path, l.info, l.pgn);
            await pushDelete(l.id);
            locals = locals.filter((x) => x !== l);
            localById.delete(l.id);
        } else {
            const pgn = await remoteContent(other);
            if (pgn !== null)
                await keepCopy(index[other].path, parseJson(index[other].info, {}), pgn);
            await pushDelete(other);
        }
    }

    const byId = new Map(locals.map((l) => [l.id, l]));
    const missing = Object.keys(bases).filter((id) => !byId.has(id) && !index[id]?.deleted);
    const holdDeletions = missing.length > 2 && missing.length * 2 > Object.keys(bases).length;
    result.deletionsHeld = holdDeletions;

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
            case "pushDelete":
                if (holdDeletions) break;
                await pushDelete(id);
                break;
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
    await b.metaSet(key("repCursor"), changed.cursor);
    await b.metaSet(key("repDir"), b.dir);
    return result;
}
