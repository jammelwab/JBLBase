import { Result } from "@badrap/result";
import { resolve } from "@tauri-apps/api/path";
import { exists, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { platform } from "@tauri-apps/plugin-os";
import { defaultGame, makePgn } from "chessops/pgn";
import { getDefaultStore } from "jotai";
import useSWR from "swr";
import { commands } from "@/bindings";
import type { FileInfoMetadata, FileMetadata } from "@/components/files/file";
import { addRecentFileAtom, tabFamily } from "@/state/atoms";
import { unwrap } from "@/utils/unwrap";
import { parsePGN } from "./chess";
import { createTab, isInTempDir, type Tab } from "./tabs";
import { getGameName } from "./treeReducer";

export function usePlatform() {
    const r = useSWR("os", async () => {
        return platform();
    });
    return { os: r.data, ...r };
}

/** The .info next to a PGN, or null when there is none (nothing is written). */
export async function readInfoFile(pgnPath: string): Promise<FileInfoMetadata | null> {
    if (!/\.pgn$/i.test(pgnPath)) return null;
    const infoPath = pgnPath.replace(/\.pgn$/i, ".info");
    try {
        if (!(await exists(infoPath))) return null;
        const info = JSON.parse(await readTextFile(infoPath)) as FileInfoMetadata;
        return { ...info, tags: info.tags ?? [] };
    } catch {
        return null;
    }
}

export async function openFile(
    file: string | FileMetadata,
    setTabs: React.Dispatch<React.SetStateAction<Tab[]>>,
    setActiveTab: React.Dispatch<React.SetStateAction<string | null>>,
    options?: {
        gameNumber?: number;
        pgn?: string;
    },
) {
    const store = getDefaultStore();
    const gameNumber = options?.gameNumber ?? 0;
    let fileInfo: FileMetadata;
    let isTempOrigin = false;
    let pgn = options?.pgn;
    let tabName = "Untitled";

    if (typeof file === "string") {
        isTempOrigin = await isInTempDir(file);
        // Read the file's .info so a repertoire opened by path is still a repertoire.
        const info = isTempOrigin ? null : await readInfoFile(file);
        const fileName = file.split(/[\\/]/).pop() ?? file;
        fileInfo = {
            type: "file" as const,
            metadata: info ?? {
                tags: [],
                type: "game" as const,
            },
            name: fileName.replace(/\.pgn$/i, ""),
            path: file,
            numGames: unwrap(await commands.countPgnGames(file)),
            lastModified: Date.now(),
        };
        if (pgn === undefined) {
            pgn = unwrap(await commands.readGames(file, gameNumber, gameNumber))[0];
        }

        if (fileInfo.metadata.type === "repertoire") {
            tabName = fileInfo.name;
        } else if (pgn) {
            const tree = await parsePGN(pgn);
            tabName = getGameName(tree.headers);
        } else {
            tabName = fileInfo.name;
        }
    } else {
        fileInfo = file;
        isTempOrigin = await isInTempDir(file.path);
        if (pgn === undefined) {
            pgn = unwrap(await commands.readGames(file.path, gameNumber, gameNumber))[0];
        }
        tabName = file.name || "Untitled";
    }

    const id = await createTab({
        tab: {
            name: tabName,
            type: "analysis",
        },
        setTabs,
        setActiveTab,
        pgn: pgn || "",
        gameOrigin: {
            kind: isTempOrigin ? "temp_file" : "file",
            file: fileInfo,
            gameNumber,
        },
    });

    if (fileInfo.metadata.type === "repertoire") {
        store.set(tabFamily(id), "practice");
    }

    // Imported games live in a temp file that is deleted later: not worth listing.
    if (!isTempOrigin) {
        store.set(addRecentFileAtom, {
            name: fileInfo.name.replace(/\.pgn$/i, ""),
            path: fileInfo.path,
            type: fileInfo.metadata.type,
        });
    }

    return id;
}

export async function createFile({
    filename,
    filetype,
    pgn,
    dir,
}: {
    filename: string;
    filetype: "game" | "repertoire" | "tournament" | "puzzle" | "other";
    pgn?: string;
    dir: string;
}): Promise<Result<FileMetadata>> {
    const file = await resolve(dir, `${filename}.pgn`);
    if (await exists(file)) {
        return Result.err(Error("File already exists"));
    }
    const metadata = {
        type: filetype,
        tags: [],
    };
    await writeTextFile(file, pgn || makePgn(defaultGame()));
    await writeTextFile(file.replace(".pgn", ".info"), JSON.stringify(metadata));
    const numGames = unwrap(await commands.countPgnGames(file));
    return Result.ok({
        type: "file",
        name: filename,
        path: file,
        numGames,
        metadata,
        lastModified: Date.now(),
    });
}
