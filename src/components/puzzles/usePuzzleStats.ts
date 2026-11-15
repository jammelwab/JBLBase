import { BaseDirectory, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { warn } from "@tauri-apps/plugin-log";
import { atom, getDefaultStore, useAtomValue } from "jotai";
import { useEffect } from "react";
import {
    type Attempt,
    defaultPuzzleStats,
    type PuzzleStats,
    parsePuzzleStats,
    recordAttempt,
} from "@/utils/puzzleStats";

/** The statistics live in the app data folder, next to the position store. */
export const PUZZLE_STATS_FILE = "puzzle_stats.json";
const options = { baseDir: BaseDirectory.AppData };

const statsAtom = atom<PuzzleStats>(defaultPuzzleStats());
const store = getDefaultStore();
let loading: Promise<void> | null = null;

function load(): Promise<void> {
    loading ??= readTextFile(PUZZLE_STATS_FILE, options)
        .then((text) => {
            if (text.trim() !== "") store.set(statsAtom, parsePuzzleStats(JSON.parse(text)));
        })
        // No file yet (first puzzle ever) or an unreadable one: start fresh
        .catch(() => {});
    return loading;
}

function save(stats: PuzzleStats) {
    store.set(statsAtom, stats);
    writeTextFile(PUZZLE_STATS_FILE, JSON.stringify(stats, null, 2), options).catch((e) =>
        warn(`Could not save ${PUZZLE_STATS_FILE}: ${e}`),
    );
}

/** The current statistics, also right after `recordPuzzleAttempt` and before the next render. */
export function getPuzzleStats(): PuzzleStats {
    return store.get(statsAtom);
}

export async function recordPuzzleAttempt(attempt: Omit<Attempt, "date">): Promise<PuzzleStats> {
    await load();
    const stats = recordAttempt(getPuzzleStats(), { ...attempt, date: new Date().toISOString() });
    save(stats);
    return stats;
}

export async function resetPuzzleStats() {
    await load();
    save(defaultPuzzleStats());
}

export function usePuzzleStats(): PuzzleStats {
    useEffect(() => {
        load();
    }, []);
    return useAtomValue(statsAtom, { store });
}
