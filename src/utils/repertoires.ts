import { exists, readDir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { INITIAL_FEN } from "chessops/fen";
import { atom, getDefaultStore, useAtomValue } from "jotai";
import useSWR from "swr";
import { commands } from "@/bindings";
import {
    type Directory,
    type FileMetadata,
    processEntriesRecursively,
} from "@/components/files/file";
import { updatePersistedState } from "@/state/store/debouncedStorage";
import { mainOwnerAtom, tabsAtom } from "@/state/atoms";
import { getPGN, headersToPGN, parsePGN } from "./chess";
import { getDocumentDir } from "./directories";
import { createFile } from "./files";
import {
    type ConflictChoice,
    type CourseChapter,
    type CourseMergeResult,
    indexRepertoire,
    mergeCourse,
    mergeLine,
    type MergeResult,
    mergeTree,
    repertoireStats,
    splitPgnGames,
} from "./repertoireTree";
import type { GameHeaders, TreeNode, TreeState } from "./treeReducer";
import { DEFAULT_MAIN_OWNER, getMainOwner, mainOwnerName } from "./mainOwner";
import {
    addStoredFolder,
    combineTrees,
    findMainRepertoire,
    inFolder,
    isSameGroup,
    normalizeFolder,
    parseStoredFolders,
    planFolderImport,
    removeStoredFolder,
    renamedFolder,
    renameStoredFolders,
    type StoredFolder,
    uniqueName,
} from "./repertoireFolders";
import {
    type ImportEntry,
    readHistory,
    recordImport,
    undoPlan,
    writeHistory,
} from "./repertoireHistory";
import { notifyLocalChange } from "./cloud/syncSignal";
import { unwrap } from "./unwrap";

export type RepertoireColor = "white" | "black";

export type Repertoire = {
    file: FileMetadata;
    name: string;
    color: RepertoireColor;
    owner: string;
    // Folder path like "1.d4/London System", "" for the top level
    folder: string;
    root: TreeNode;
    headers: GameHeaders;
    index: Map<string, string[]>;
    stats: ReturnType<typeof repertoireStats>;
    // The main repertoire of its player and color ("Ich Weiß"), which gets every line of the
    // others too (see syncMainRepertoire)
    main?: boolean;
    // Set when this is several repertoires (a folder) looked at together; it has no file of
    // its own then, `file` is the first part's
    parts?: Repertoire[];
};

// Who a repertoire belongs to: the main user (see ./mainOwner) or anyone else by name.
export { DEFAULT_MAIN_OWNER, getMainOwner, mainOwnerName };

export function useMainOwner(): string {
    return mainOwnerName(useAtomValue(mainOwnerAtom));
}

// The repertoires offered with one click: White and Black for the user themself.
export function defaultRepertoires(mainOwner: string): { owner: string; color: RepertoireColor }[] {
    return [
        { owner: mainOwner, color: "white" },
        { owner: mainOwner, color: "black" },
    ];
}

// The configured name in any spelling, and "Ich" from before a name was set, are still the
// main user, otherwise their repertoires would lose the comparison with their own games.
export function repertoireOwner(owner: unknown, mainOwner: string = getMainOwner()): string {
    const name = typeof owner === "string" ? owner.trim() : "";
    const lower = name.toLowerCase();
    if (!name || lower === mainOwner.toLowerCase() || lower === DEFAULT_MAIN_OWNER.toLowerCase()) {
        return mainOwner;
    }
    return name;
}

// Bumped after every change, so lists and lookups reload.
export const repertoireVersionAtom = atom(0);

// Which view the repertoire page shows. `color` without `path` picks your own repertoire
// for that color (used by "Compare with my repertoire" on the player card).
export type RepertoireView = {
    mode: "tree" | "compare";
    path?: string;
    color?: RepertoireColor;
    // Whose repertoire `color` picks (a player card passes its player); the main user if unset
    owner?: string;
    // With `color`: only the repertoires in this folder (and its subfolders)
    folder?: string;
};
export const repertoireViewAtom = atom<RepertoireView | null>(null);

function flatten(entries: (FileMetadata | Directory)[]): FileMetadata[] {
    return entries.flatMap((e) => (e.type === "directory" ? flatten(e.children) : [e]));
}

async function readInfo(file: FileMetadata): Promise<Record<string, unknown>> {
    try {
        return JSON.parse(await readTextFile(file.path.replace(/\.pgn$/, ".info")));
    } catch {
        return { ...file.metadata };
    }
}

async function loadRepertoire(
    file: FileMetadata,
    mainOwner: string = getMainOwner(),
): Promise<Repertoire> {
    const [pgn] = unwrap(await commands.readGames(file.path, 0, 0));
    const tree = await parsePGN(pgn ?? "");
    const info = await readInfo(file);
    const color: RepertoireColor =
        info.color === "white" || info.color === "black"
            ? info.color
            : tree.headers.orientation === "black"
              ? "black"
              : "white";
    const owner = repertoireOwner(info.owner, mainOwner);
    return {
        file,
        name: file.name,
        color,
        owner,
        folder: normalizeFolder(info.folder),
        main: info.main === true,
        root: tree.root,
        headers: tree.headers,
        index: indexRepertoire(tree.root),
        stats: repertoireStats(tree.root),
    };
}

export async function listRepertoires(
    documentDir: string,
    mainOwner: string = getMainOwner(),
): Promise<Repertoire[]> {
    const entries = await processEntriesRecursively(documentDir, await readDir(documentDir));
    const files = flatten(entries).filter((f) => f.metadata.type === "repertoire");
    const repertoires = await Promise.all(
        files.map((file) => loadRepertoire(file, mainOwner).catch(() => null)),
    );
    return repertoires
        .filter((r): r is Repertoire => r !== null)
        .sort(
            (a, b) =>
                Number(b.owner === mainOwner) - Number(a.owner === mainOwner) ||
                a.owner.localeCompare(b.owner) ||
                Number(a.color === "black") - Number(b.color === "black") ||
                a.name.localeCompare(b.name),
        );
}

export function useRepertoires(documentDir: string) {
    const version = useAtomValue(repertoireVersionAtom);
    const mainOwner = useMainOwner();
    return useSWR(
        ["repertoires", documentDir, version, mainOwner],
        () => listRepertoires(documentDir, mainOwner),
        { revalidateOnFocus: false },
    );
}

export function bumpRepertoires() {
    const store = getDefaultStore();
    store.set(repertoireVersionAtom, (v) => v + 1);
    notifyLocalChange();
}

export async function createRepertoire({
    name,
    color,
    owner,
    dir,
    folder = "",
    main = false,
}: {
    name: string;
    color: RepertoireColor;
    owner: string;
    dir: string;
    folder?: string;
    main?: boolean;
}) {
    const pgn = headersToPGN({
        id: 0,
        fen: INITIAL_FEN,
        black: "",
        white: "",
        result: "*",
        event: name,
        site: "",
        orientation: color,
    });
    const result = await createFile({ filename: name, filetype: "repertoire", pgn, dir });
    if (result.isOk) {
        const metadata = {
            ...result.value.metadata,
            color,
            owner,
            folder: normalizeFolder(folder),
            ...(main ? { main: true } : {}),
        };
        await writeTextFile(result.value.path.replace(/\.pgn$/, ".info"), JSON.stringify(metadata));
        bumpRepertoires();
    }
    return result;
}

// Moves a repertoire into another folder ("" for the top level).
export async function setRepertoireFolder(file: FileMetadata, folder: string) {
    const info = await readInfo(file);
    await writeTextFile(
        file.path.replace(/\.pgn$/, ".info"),
        JSON.stringify({ ...info, folder: normalizeFolder(folder) }),
    );
    bumpRepertoires();
}

// Several repertoires of one player and color as one, e.g. a whole folder.
export function combineRepertoires(parts: Repertoire[], name: string): Repertoire | null {
    if (parts.length === 0) return null;
    if (parts.length === 1) return parts[0];
    const root = combineTrees(parts.map((p) => p.root))!;
    return {
        ...parts[0],
        name,
        root,
        index: indexRepertoire(root),
        stats: repertoireStats(root),
        parts,
    };
}

function serialize(root: TreeNode, headers: GameHeaders) {
    return `${getPGN(root, {
        headers,
        comments: true,
        extraMarkups: true,
        glyphs: true,
        variations: true,
    })}\n\n`;
}

// The repertoire file as it is on disk, for the import history
async function readRaw(file: FileMetadata): Promise<string> {
    const [pgn] = unwrap(await commands.readGames(file.path, 0, 0));
    return pgn ?? "";
}

// Adds a line (optionally with its side variations) to a repertoire file. The file is read
// fresh from disk, and a tab that has the repertoire open in the background gets the same
// moves, so neither overwrites the other later. `label` names the import in the history.
export async function addLineToRepertoire(
    file: FileMetadata,
    source: TreeNode,
    path: number[],
    options: { withVariations: boolean; label?: string; syncMain?: boolean },
): Promise<MergeResult> {
    const before = await readRaw(file);
    const repertoire = await loadRepertoire(file);
    const result = mergeLine(repertoire.root, source, path, options);
    if (!result.ok) return result;

    if (result.added > 0) {
        await recordImport(file.path, {
            kind: "line",
            source: options.label ?? "",
            added: result.added,
            before,
        });
        unwrap(
            await commands.writeGame(file.path, 0, serialize(repertoire.root, repertoire.headers)),
        );
    }

    const store = getDefaultStore();
    for (const tab of store.get(tabsAtom)) {
        const origin = tab.gameOrigin;
        if (
            (origin.kind === "file" || origin.kind === "temp_file") &&
            origin.file.path === file.path
        ) {
            updatePersistedState<TreeState>(tab.value, (state) => {
                mergeLine(state.root, source, path, options);
                return state;
            });
        }
    }

    if (result.added > 0 && options.syncMain !== false && !repertoire.main) {
        await syncAfterImport(repertoire, options.label ?? "");
    }
    bumpRepertoires();
    return result;
}

// A course is a PGN file (or pasted text); every game in it is a chapter.
export type Course = { name: string; chapters: CourseChapter[] };

function chapterName(headers: GameHeaders, number: number): string {
    const known = (v: string | undefined) => (v && v !== "?" ? v.trim() : "");
    // Course PGNs often keep the chapter title in the "White" tag and the course in "Event"
    const parts = [known(headers.white), known(headers.black)].filter(Boolean);
    const players = parts.length === 2 ? `${parts[0]} – ${parts[1]}` : parts.join("");
    return players || known(headers.event) || `#${number}`;
}

async function parseChapters(games: string[]): Promise<CourseChapter[]> {
    const chapters: CourseChapter[] = [];
    for (const [i, pgn] of games.entries()) {
        const tree = await parsePGN(pgn);
        if (tree.root.children.length === 0) continue;
        chapters.push({ name: chapterName(tree.headers, i + 1), root: tree.root });
    }
    return chapters;
}

export async function loadCourseFile(path: string): Promise<Course> {
    const count = unwrap(await commands.countPgnGames(path));
    const games = count > 0 ? unwrap(await commands.readGames(path, 0, count - 1)) : [];
    const base = path.split(/[\\/]/).pop() ?? path;
    return { name: base.replace(/\.pgn$/i, ""), chapters: await parseChapters(games) };
}

export async function parseCourseText(text: string, name: string): Promise<Course> {
    return { name, chapters: await parseChapters(splitPgnGames(text)) };
}

// Merges course chapters into a repertoire file, like addLineToRepertoire: read fresh from
// disk, written back, and applied to an open tab of the repertoire too.
export async function importCourseIntoRepertoire(
    file: FileMetadata,
    chapters: CourseChapter[],
    choices: Map<string, ConflictChoice>,
    note: string,
    label = "",
    syncMain = true,
): Promise<CourseMergeResult> {
    const before = await readRaw(file);
    const repertoire = await loadRepertoire(file);
    const result = mergeCourse(repertoire.root, chapters, repertoire.color, choices, note);
    if (result.added > 0) {
        await recordImport(file.path, {
            kind: "course",
            source: label,
            added: result.added,
            before,
        });
        unwrap(
            await commands.writeGame(file.path, 0, serialize(repertoire.root, repertoire.headers)),
        );
    }

    const store = getDefaultStore();
    for (const tab of store.get(tabsAtom)) {
        const origin = tab.gameOrigin;
        if (
            (origin.kind === "file" || origin.kind === "temp_file") &&
            origin.file.path === file.path
        ) {
            updatePersistedState<TreeState>(tab.value, (state) => {
                mergeCourse(state.root, chapters, repertoire.color, choices, note);
                return state;
            });
        }
    }

    if (result.added > 0 && syncMain && !repertoire.main) {
        await syncAfterImport(repertoire, label);
    }
    bumpRepertoires();
    return result;
}

// The main repertoire of a player and color ("Ich Weiß") holds every line of their other
// repertoires of that color as well, so training it or comparing it covers everything.
// Merges all of them into it; moves it already has are kept as they are. Recorded in the
// main repertoire's import history, so it can be undone there. Null if there is no main
// repertoire for that player and color.
export async function syncMainRepertoire(
    documentDir: string,
    owner: string,
    color: RepertoireColor,
    label: string,
): Promise<{ main: Repertoire; added: number } | null> {
    const mainOwner = getMainOwner();
    const all = await listRepertoires(documentDir, mainOwner);
    const aliases = owner.toLowerCase() === mainOwner.toLowerCase() ? [DEFAULT_MAIN_OWNER] : [];
    const main = findMainRepertoire(all, owner, color, aliases);
    if (!main) return null;
    const parts = all.filter((r) => r !== main && isSameGroup(r, owner, color));

    const before = await readRaw(main.file);
    let added = 0;
    for (const part of parts) added += mergeTree(main.root, part.root) ?? 0;
    if (added > 0) {
        await recordImport(main.file.path, { kind: "course", source: label, added, before });
        unwrap(await commands.writeGame(main.file.path, 0, serialize(main.root, main.headers)));
        const store = getDefaultStore();
        for (const tab of store.get(tabsAtom)) {
            const origin = tab.gameOrigin;
            if (
                (origin.kind === "file" || origin.kind === "temp_file") &&
                origin.file.path === main.file.path
            ) {
                updatePersistedState<TreeState>(tab.value, (state) => {
                    for (const part of parts) mergeTree(state.root, part.root);
                    return state;
                });
            }
        }
    }
    // Found by its name: mark it, so it stays the main repertoire when renamed or moved
    if (!main.main) {
        const info = await readInfo(main.file);
        await writeTextFile(
            main.file.path.replace(/\.pgn$/, ".info"),
            JSON.stringify({ ...info, main: true }),
        );
    }
    bumpRepertoires();
    return { main, added };
}

// After an import into a repertoire that isn't the main one. A failure here must not look
// like the import failed, the button on the main repertoire can repeat it.
async function syncAfterImport(repertoire: Repertoire, label: string) {
    try {
        await syncMainRepertoire(
            await getDocumentDir(),
            repertoire.owner,
            repertoire.color,
            label || repertoire.name,
        );
    } catch (e) {
        console.error("Could not update the main repertoire", e);
    }
}

export type { ImportEntry };

export function getImportHistory(file: FileMetadata): Promise<ImportEntry[]> {
    return readHistory(file.path);
}

// Puts the repertoire back to how it was before the import `id` (and every later import).
// A tab that has the repertoire open gets the old moves too.
export async function undoImport(file: FileMetadata, id: string): Promise<ImportEntry[] | null> {
    const plan = undoPlan(await readHistory(file.path), id);
    if (!plan) return null;
    unwrap(await commands.writeGame(file.path, 0, plan.restore));
    await writeHistory(file.path, plan.remaining);

    const tree = await parsePGN(plan.restore);
    const store = getDefaultStore();
    for (const tab of store.get(tabsAtom)) {
        const origin = tab.gameOrigin;
        if (
            (origin.kind === "file" || origin.kind === "temp_file") &&
            origin.file.path === file.path
        ) {
            updatePersistedState<TreeState>(tab.value, (state) => ({
                ...state,
                root: structuredClone(tree.root),
                position: [],
            }));
        }
    }

    bumpRepertoires();
    return plan.undone;
}

// Folders made in the app (also empty ones), next to the repertoires in the documents folder
function storedFoldersPath(documentDir: string) {
    return `${documentDir.replace(/[\\/]+$/, "")}/repertoire-folders.json`;
}

export async function readStoredFolders(documentDir: string): Promise<StoredFolder[]> {
    const path = storedFoldersPath(documentDir);
    if (!(await exists(path).catch(() => false))) return [];
    return parseStoredFolders(await readTextFile(path));
}

async function writeStoredFolders(documentDir: string, list: StoredFolder[]) {
    await writeTextFile(storedFoldersPath(documentDir), JSON.stringify(list, null, 1));
}

export function useStoredFolders(documentDir: string) {
    const version = useAtomValue(repertoireVersionAtom);
    return useSWR(["repertoire-folders", documentDir, version], () =>
        readStoredFolders(documentDir),
    );
}

export async function createFolder(documentDir: string, folder: StoredFolder) {
    await writeStoredFolders(
        documentDir,
        addStoredFolder(await readStoredFolders(documentDir), folder),
    );
    bumpRepertoires();
}

// Only for folders without repertoires; the page offers it only then
export async function deleteFolder(
    documentDir: string,
    owner: string,
    color: RepertoireColor,
    path: string,
) {
    await writeStoredFolders(
        documentDir,
        removeStoredFolder(await readStoredFolders(documentDir), owner, color, path),
    );
    bumpRepertoires();
}

// Renames (or moves) a folder with everything in it. The repertoires keep their .info,
// including the id their training progress hangs on; only the folder changes.
export async function renameFolder(
    documentDir: string,
    repertoires: Repertoire[],
    owner: string,
    color: RepertoireColor,
    from: string,
    to: string,
) {
    for (const r of repertoires) {
        if (r.parts || r.owner.toLowerCase() !== owner.toLowerCase() || r.color !== color) {
            continue;
        }
        if (!inFolder(r.folder, from)) continue;
        const info = await readInfo(r.file);
        await writeTextFile(
            r.file.path.replace(/\.pgn$/, ".info"),
            JSON.stringify({ ...info, folder: renamedFolder(r.folder, from, to) }),
        );
    }
    const stored = await readStoredFolders(documentDir);
    await writeStoredFolders(
        documentDir,
        addStoredFolder(renameStoredFolders(stored, owner, color, from, to), {
            owner,
            color,
            path: to,
        }),
    );
    bumpRepertoires();
}

// The PGN files in a folder on disk and its subfolders, with paths relative to it
export async function scanPgnFolder(
    dir: string,
): Promise<{ files: { path: string; relative: string }[]; dirs: string[] }> {
    const files: { path: string; relative: string }[] = [];
    const dirs: string[] = [];
    const walk = async (path: string, relative: string, depth: number) => {
        if (depth > 12) return;
        const entries = await readDir(path);
        for (const entry of entries) {
            if (entry.name.startsWith(".")) continue;
            const childPath = `${path.replace(/[\\/]+$/, "")}/${entry.name}`;
            const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
            if (entry.isDirectory) {
                dirs.push(childRelative);
                await walk(childPath, childRelative, depth + 1);
            } else if (/\.pgn$/i.test(entry.name)) {
                files.push({ path: childPath, relative: childRelative });
            }
        }
    };
    await walk(dir, "", 0);
    return { files, dirs };
}

export type FolderImportProgress = { done: number; total: number; current: string };

// Every PGN of a folder on disk becomes a repertoire (named after the file, its games as
// chapters), in folders that follow the folder's structure. Each import is in the
// repertoire's import history.
export async function importPgnFolder({
    documentDir,
    dir,
    owner,
    color,
    target,
    keepRootName,
    onProgress,
}: {
    documentDir: string;
    dir: string;
    owner: string;
    color: RepertoireColor;
    target: string;
    keepRootName: boolean;
    onProgress?: (p: FolderImportProgress) => void;
}): Promise<{
    created: number;
    moves: number;
    failed: { name: string; error: string }[];
    // New moves in the main repertoire of that player and color
    mainAdded: number;
}> {
    const scan = await scanPgnFolder(dir);
    const rootName = keepRootName ? (dir.split(/[\\/]/).filter(Boolean).pop() ?? null) : null;
    const plan = planFolderImport(scan.files, scan.dirs, target, rootName);

    let stored = await readStoredFolders(documentDir);
    for (const path of plan.folders) stored = addStoredFolder(stored, { owner, color, path });
    await writeStoredFolders(documentDir, stored);

    const taken = new Set(
        (await listRepertoires(documentDir)).map((r) => r.file.name.toLowerCase()),
    );
    let created = 0;
    let moves = 0;
    const failed: { name: string; error: string }[] = [];
    for (const [i, item] of plan.items.entries()) {
        onProgress?.({ done: i, total: plan.items.length, current: item.name });
        try {
            let name = uniqueName(item.name, taken);
            let result = await createRepertoire({
                name,
                color,
                owner,
                dir: documentDir,
                folder: item.folder,
            });
            // A file of that name that is no repertoire (e.g. a game file) also takes the name
            while (
                result.isErr &&
                (await exists(`${documentDir}/${name}.pgn`).catch(() => false))
            ) {
                name = uniqueName(item.name, taken);
                result = await createRepertoire({
                    name,
                    color,
                    owner,
                    dir: documentDir,
                    folder: item.folder,
                });
            }
            if (result.isErr) throw result.error;
            created++;
            const course = await loadCourseFile(item.source);
            const label = [item.folder, item.name].filter(Boolean).join(" › ");
            const merged = await importCourseIntoRepertoire(
                result.value,
                course.chapters,
                new Map(),
                "",
                label,
                false,
            );
            moves += merged.added;
        } catch (e) {
            failed.push({ name: item.name, error: e instanceof Error ? e.message : String(e) });
        }
    }
    onProgress?.({ done: plan.items.length, total: plan.items.length, current: "" });
    let mainAdded = 0;
    if (moves > 0) {
        try {
            const label = rootName ?? dir.split(/[\\/]/).filter(Boolean).pop() ?? dir;
            const sync = await syncMainRepertoire(documentDir, owner, color, label);
            mainAdded = sync?.added ?? 0;
        } catch (e) {
            console.error("Could not update the main repertoire", e);
        }
    }
    bumpRepertoires();
    return { created, moves, failed, mainAdded };
}
