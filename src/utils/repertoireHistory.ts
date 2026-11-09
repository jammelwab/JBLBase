import { exists, readTextFile, remove, rename, writeTextFile } from "@tauri-apps/plugin-fs";

// Every import into a repertoire (a course or a line from a game) keeps the repertoire as it
// was before, so a wrong import can be undone. The history sits next to the file:
// "Name.pgn" -> "Name.history.json", newest import first.

export type ImportKind = "course" | "line";

export type ImportEntry = {
    id: string;
    // Milliseconds since 1970
    date: number;
    kind: ImportKind;
    // What was imported: the course names or the line
    source: string;
    added: number;
    // The whole repertoire file before the import
    before: string;
};

// Old snapshots are dropped after this many imports
export const MAX_HISTORY = 30;

export function historyPath(pgnPath: string): string {
    return pgnPath.replace(/\.pgn$/i, ".history.json");
}

function isEntry(e: unknown): e is ImportEntry {
    const v = e as ImportEntry;
    return (
        !!v &&
        typeof v.id === "string" &&
        typeof v.date === "number" &&
        typeof v.before === "string" &&
        (v.kind === "course" || v.kind === "line")
    );
}

export function parseHistory(text: string): ImportEntry[] {
    try {
        const data = JSON.parse(text);
        return Array.isArray(data) ? data.filter(isEntry) : [];
    } catch {
        return [];
    }
}

// A new entry in front, the oldest ones dropped
export function addEntry(entries: ImportEntry[], entry: ImportEntry): ImportEntry[] {
    return [entry, ...entries].slice(0, MAX_HISTORY);
}

// Undoing an import also undoes every import made after it, since those were made on top of
// it. Returns the file content to restore and the history that is left.
export function undoPlan(
    entries: ImportEntry[],
    id: string,
): { restore: string; undone: ImportEntry[]; remaining: ImportEntry[] } | null {
    const index = entries.findIndex((e) => e.id === id);
    if (index < 0) return null;
    return {
        restore: entries[index].before,
        undone: entries.slice(0, index + 1),
        remaining: entries.slice(index + 1),
    };
}

export async function readHistory(pgnPath: string): Promise<ImportEntry[]> {
    const path = historyPath(pgnPath);
    if (!(await exists(path).catch(() => false))) return [];
    return parseHistory(await readTextFile(path));
}

export async function writeHistory(pgnPath: string, entries: ImportEntry[]) {
    const path = historyPath(pgnPath);
    if (entries.length === 0) {
        await remove(path).catch(() => {});
        return;
    }
    await writeTextFile(path, JSON.stringify(entries));
}

export async function recordImport(
    pgnPath: string,
    entry: Omit<ImportEntry, "id" | "date">,
): Promise<void> {
    const entries = await readHistory(pgnPath);
    const date = Date.now();
    const id = `${date}-${Math.random().toString(36).slice(2, 8)}`;
    await writeHistory(pgnPath, addEntry(entries, { ...entry, id, date }));
}

// Keeps the history with its file when the file is renamed, moved or deleted
export async function moveHistory(fromPgn: string, toPgn: string) {
    await rename(historyPath(fromPgn), historyPath(toPgn)).catch(() => {});
}

export async function removeHistory(pgnPath: string) {
    await remove(historyPath(pgnPath)).catch(() => {});
}
