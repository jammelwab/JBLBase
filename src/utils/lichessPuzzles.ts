import { resolve } from "@tauri-apps/api/path";
import { commands, type PuzzleDatabaseInfo } from "@/bindings";
import { getPuzzlesDir } from "./directories";
import { GAME_TACTICS_FILE } from "./insight";
import { getPuzzleDatabases } from "./puzzles";
import { REPERTOIRE_TACTICS_FILE } from "./tactics";

// The database the Lichess import writes.
export const LICHESS_PUZZLE_FILE = "Lichess Puzzles.duckdb";
export const LICHESS_PUZZLE_PROGRESS = "puzzle_db_lichess";

// Fewer puzzles than this is no Lichess puzzle database to measure against.
const MIN_REFERENCE_PUZZLES = 100_000;

export async function lichessPuzzlePath(): Promise<string> {
    return resolve(await getPuzzlesDir(), LICHESS_PUZZLE_FILE);
}

// Downloads and imports the Lichess puzzles, or imports them from `source` (a .csv or
// .csv.zst file). Progress goes to LICHESS_PUZZLE_PROGRESS.
export async function importLichessPuzzles(source: string | null) {
    const result = await commands.importLichessPuzzles(
        LICHESS_PUZZLE_PROGRESS,
        source,
        await lichessPuzzlePath(),
    );
    if (result.status === "error") await commands.clearProgress(LICHESS_PUZZLE_PROGRESS);
    return result;
}

// The puzzle database with real Lichess ratings to calibrate against: the imported Lichess
// puzzles, or else the biggest other database that is not one of our own tactic files.
export function pickReferenceDatabase(dbs: PuzzleDatabaseInfo[]): PuzzleDatabaseInfo | null {
    const lichess = dbs.find((db) => db.title === LICHESS_PUZZLE_FILE);
    if (lichess) return lichess;
    const others = dbs
        .filter(
            (db) =>
                db.title !== REPERTOIRE_TACTICS_FILE &&
                db.title !== GAME_TACTICS_FILE &&
                db.puzzleCount >= MIN_REFERENCE_PUZZLES,
        )
        .sort((a, b) => b.puzzleCount - a.puzzleCount);
    return others[0] ?? null;
}

export async function findReferenceDatabase(): Promise<PuzzleDatabaseInfo | null> {
    return pickReferenceDatabase(await getPuzzleDatabases());
}
