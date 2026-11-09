import { readDir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
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
import { createFile } from "./files";
import {
    type ConflictChoice,
    type CourseChapter,
    type CourseMergeResult,
    indexRepertoire,
    mergeCourse,
    mergeLine,
    type MergeResult,
    repertoireStats,
    splitPgnGames,
} from "./repertoireTree";
import type { GameHeaders, TreeNode, TreeState } from "./treeReducer";
import { DEFAULT_MAIN_OWNER, getMainOwner, mainOwnerName } from "./mainOwner";
import { combineTrees, normalizeFolder } from "./repertoireFolders";
import {
    type ImportEntry,
    readHistory,
    recordImport,
    undoPlan,
    writeHistory,
} from "./repertoireHistory";
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
}

export async function createRepertoire({
    name,
    color,
    owner,
    dir,
    folder = "",
}: {
    name: string;
    color: RepertoireColor;
    owner: string;
    dir: string;
    folder?: string;
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
    options: { withVariations: boolean; label?: string },
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

    bumpRepertoires();
    return result;
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
