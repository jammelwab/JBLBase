// Papierkorb für Repertoires (#113).
//
// Deleting a repertoire never removes its files: `deleteRepertoire` and the
// cloud sync rename them to "<name>.pgn.deleted-<ms>" (plus the .info and the
// import history with the same suffix). This module lists those files,
// restores them and removes them for good, e.g. after 30 days.
//
// A restored repertoire keeps its id: its training progress is there again
// at once, and the next cloud sync uploads it as new (the cloud only has a
// deletion mark), so it comes back on the other devices as well.

import { join } from "@tauri-apps/api/path";
import { exists, readDir, readTextFile, remove, rename } from "@tauri-apps/plugin-fs";
import { atomWithStorage } from "jotai/utils";

/** How many days deleted repertoires are kept; 0 = for ever. */
export const trashRetentionDaysAtom = atomWithStorage<number>("trash-retention-days", 30);
export const TRASH_RETENTION_CHOICES = [7, 30, 90, 0] as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const TRASHED = /^(.*)\.pgn\.deleted-(\d+)$/i;

/** The file system calls this module needs (the Tauri plugin in the app, a fake in tests). */
export type TrashFs = {
    readDir(dir: string): Promise<{ name: string; isFile: boolean; isDirectory: boolean }[]>;
    exists(path: string): Promise<boolean>;
    readTextFile(path: string): Promise<string>;
    rename(from: string, to: string): Promise<void>;
    remove(path: string): Promise<void>;
    join(...parts: string[]): Promise<string>;
};

const tauriFs: TrashFs = {
    readDir: (dir) => readDir(dir),
    exists: (path) => exists(path),
    readTextFile: (path) => readTextFile(path),
    rename: (from, to) => rename(from, to),
    remove: (path) => remove(path),
    join: (...parts) => join(...parts),
};

export type TrashEntry = {
    /** The deleted .pgn file ("….pgn.deleted-<ms>"). */
    file: string;
    /** Where the .pgn was before it was deleted. */
    original: string;
    /** Repertoire name (the file name). */
    name: string;
    /** Suffix shared by all files of this deletion (".deleted-<ms>"). */
    suffix: string;
    deletedAt: number;
    /** Contents of the deleted .info, when there is one. */
    info: Record<string, unknown> | null;
};

/** The parts of a deleted .pgn file name; null for any other file. */
export function parseTrashedName(fileName: string): { name: string; deletedAt: number } | null {
    const m = fileName.match(TRASHED);
    if (!m) return null;
    return { name: m[1], deletedAt: Number(m[2]) };
}

/** The other files of a repertoire next to its .pgn. */
function companions(pgn: string): string[] {
    const base = pgn.replace(/\.pgn$/i, "");
    return [`${base}.info`, `${base}.history.json`];
}

/** Deleted repertoires below `dir`, newest first. */
export async function listTrash(dir: string, fs: TrashFs = tauriFs): Promise<TrashEntry[]> {
    const entries: TrashEntry[] = [];
    const walk = async (folder: string) => {
        let items: Awaited<ReturnType<TrashFs["readDir"]>>;
        try {
            items = await fs.readDir(folder);
        } catch {
            return;
        }
        for (const item of items) {
            const path = await fs.join(folder, item.name);
            if (item.isDirectory) {
                await walk(path);
                continue;
            }
            const parsed = item.isFile ? parseTrashedName(item.name) : null;
            if (!parsed) continue;
            const suffix = `.deleted-${parsed.deletedAt}`;
            const original = path.slice(0, -suffix.length);
            let info: Record<string, unknown> | null = null;
            try {
                const infoFile = `${original.replace(/\.pgn$/i, ".info")}${suffix}`;
                if (await fs.exists(infoFile)) info = JSON.parse(await fs.readTextFile(infoFile));
            } catch {
                info = null;
            }
            entries.push({
                file: path,
                original,
                name: parsed.name,
                suffix,
                deletedAt: parsed.deletedAt,
                info,
            });
        }
    };
    await walk(dir);
    return entries.sort((a, b) => b.deletedAt - a.deletedAt);
}

/**
 * A free .pgn path for the restored file: the original one, or "Name (2)",
 * "Name (3)" … when a repertoire of that name exists again.
 */
export async function freeTarget(original: string, fs: TrashFs = tauriFs): Promise<string> {
    if (!(await fs.exists(original))) return original;
    const base = original.replace(/\.pgn$/i, "");
    for (let n = 2; ; n++) {
        const candidate = `${base} (${n}).pgn`;
        if (!(await fs.exists(candidate))) return candidate;
    }
}

/** Puts a deleted repertoire back; returns the path of the restored .pgn. */
export async function restoreFromTrash(
    entry: Pick<TrashEntry, "file" | "original" | "suffix">,
    fs: TrashFs = tauriFs,
): Promise<string> {
    const target = await freeTarget(entry.original, fs);
    const from = companions(entry.original);
    const to = companions(target);
    // Companions first: once the .pgn is back, the file list reads its .info
    // and would write a default one if it were still missing.
    for (let i = 0; i < from.length; i++) {
        const trashed = from[i] + entry.suffix;
        if (await fs.exists(trashed)) await fs.rename(trashed, to[i]);
    }
    await fs.rename(entry.file, target);
    return target;
}

/** Removes a deleted repertoire for good. */
export async function purgeFromTrash(
    entry: Pick<TrashEntry, "file" | "original" | "suffix">,
    fs: TrashFs = tauriFs,
): Promise<void> {
    for (const companion of companions(entry.original)) {
        const trashed = companion + entry.suffix;
        if (await fs.exists(trashed)) await fs.remove(trashed);
    }
    if (await fs.exists(entry.file)) await fs.remove(entry.file);
}

/** Removes everything deleted more than `days` days ago (0: nothing). Returns how many. */
export async function purgeOldTrash(
    dir: string,
    days: number,
    now = Date.now(),
    fs: TrashFs = tauriFs,
): Promise<number> {
    if (days <= 0) return 0;
    const old = (await listTrash(dir, fs)).filter((e) => now - e.deletedAt > days * DAY_MS);
    for (const e of old) await purgeFromTrash(e, fs);
    return old.length;
}
