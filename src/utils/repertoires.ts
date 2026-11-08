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
import { tabsAtom } from "@/state/atoms";
import { getPGN, headersToPGN, parsePGN } from "./chess";
import { createFile } from "./files";
import { indexRepertoire, mergeLine, type MergeResult, repertoireStats } from "./repertoireTree";
import type { GameHeaders, TreeNode, TreeState } from "./treeReducer";
import { unwrap } from "./unwrap";

export type RepertoireColor = "white" | "black";

export type Repertoire = {
    file: FileMetadata;
    name: string;
    color: RepertoireColor;
    owner: string;
    root: TreeNode;
    headers: GameHeaders;
    index: Map<string, string[]>;
    stats: ReturnType<typeof repertoireStats>;
};

// Who a repertoire belongs to. Older repertoires without an owner count as the main user's.
export const MAIN_OWNER = "Jannick";
export const DEFAULT_REPERTOIRES: { owner: string; color: RepertoireColor }[] = [
    { owner: "Jannick", color: "white" },
    { owner: "Jannick", color: "black" },
    { owner: "Aaron", color: "white" },
    { owner: "Aaron", color: "black" },
];

// Bumped after every change, so lists and lookups reload.
export const repertoireVersionAtom = atom(0);

// Which view the repertoire page shows. `color` without `path` picks your own repertoire
// for that color (used by "Compare with my repertoire" on the player card).
export type RepertoireView = {
    mode: "tree" | "compare";
    path?: string;
    color?: RepertoireColor;
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

async function loadRepertoire(file: FileMetadata): Promise<Repertoire> {
    const [pgn] = unwrap(await commands.readGames(file.path, 0, 0));
    const tree = await parsePGN(pgn ?? "");
    const info = await readInfo(file);
    const color: RepertoireColor =
        info.color === "white" || info.color === "black"
            ? info.color
            : tree.headers.orientation === "black"
              ? "black"
              : "white";
    const owner = typeof info.owner === "string" && info.owner ? info.owner : MAIN_OWNER;
    return {
        file,
        name: file.name,
        color,
        owner,
        root: tree.root,
        headers: tree.headers,
        index: indexRepertoire(tree.root),
        stats: repertoireStats(tree.root),
    };
}

export async function listRepertoires(documentDir: string): Promise<Repertoire[]> {
    const entries = await processEntriesRecursively(documentDir, await readDir(documentDir));
    const files = flatten(entries).filter((f) => f.metadata.type === "repertoire");
    const repertoires = await Promise.all(
        files.map((file) => loadRepertoire(file).catch(() => null)),
    );
    return repertoires
        .filter((r): r is Repertoire => r !== null)
        .sort(
            (a, b) =>
                Number(b.owner === MAIN_OWNER) - Number(a.owner === MAIN_OWNER) ||
                a.owner.localeCompare(b.owner) ||
                Number(a.color === "black") - Number(b.color === "black") ||
                a.name.localeCompare(b.name),
        );
}

export function useRepertoires(documentDir: string) {
    const version = useAtomValue(repertoireVersionAtom);
    return useSWR(["repertoires", documentDir, version], () => listRepertoires(documentDir), {
        revalidateOnFocus: false,
    });
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
}: {
    name: string;
    color: RepertoireColor;
    owner: string;
    dir: string;
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
        const metadata = { ...result.value.metadata, color, owner };
        await writeTextFile(result.value.path.replace(/\.pgn$/, ".info"), JSON.stringify(metadata));
        bumpRepertoires();
    }
    return result;
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

// Adds a line (optionally with its side variations) to a repertoire file. The file is read
// fresh from disk, and a tab that has the repertoire open in the background gets the same
// moves, so neither overwrites the other later.
export async function addLineToRepertoire(
    file: FileMetadata,
    source: TreeNode,
    path: number[],
    options: { withVariations: boolean },
): Promise<MergeResult> {
    const repertoire = await loadRepertoire(file);
    const result = mergeLine(repertoire.root, source, path, options);
    if (!result.ok) return result;

    if (result.added > 0) {
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
