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

// Die kleine Puzzle-Auswahl (1.2.31): rund 32 000 beliebte Lichess-Puzzles
// über alle Stufen, 1,3 MB zum Herunterladen statt der ganzen Lichess-Datenbank.
// Sie ersetzt die selbst gebauten JBL-Starter-Puzzles.
export const PUZZLE_SELECTION_FILE = "Puzzle-Auswahl.duckdb";
export const PUZZLE_SELECTION_PROGRESS = "puzzle_db_selection";
// Die alten Starter-Puzzles (1.2.14 bis 1.2.26), werden gelöscht
const OLD_STARTER_PUZZLE_FILE = "JBL Starter-Puzzles.duckdb";

export async function puzzleSelectionPath(): Promise<string> {
    return resolve(await getPuzzlesDir(), PUZZLE_SELECTION_FILE);
}

// Lädt die Puzzle-Auswahl herunter (neu). Fortschritt unter PUZZLE_SELECTION_PROGRESS.
export async function importPuzzleSelection() {
    const result = await commands.importPuzzleSelection(
        PUZZLE_SELECTION_PROGRESS,
        await puzzleSelectionPath(),
    );
    if (result.status === "error") await commands.clearProgress(PUZZLE_SELECTION_PROGRESS);
    return result;
}

// Eigene Taktik-Dateien zählen nicht als Puzzle-Datenbank
function isTrainingDb(db: PuzzleDatabaseInfo): boolean {
    return (
        db.puzzleCount > 0 && db.title !== REPERTOIRE_TACTICS_FILE && db.title !== GAME_TACTICS_FILE
    );
}

let selectionStarted: Promise<PuzzleDatabaseInfo[]> | null = null;

// Räumt die alten Starter-Puzzles weg und lädt die Puzzle-Auswahl, wenn noch
// keine Puzzle-Datenbank da ist. Gibt die Liste der Datenbanken danach zurück.
export async function ensurePuzzleDatabase(
    dbs: PuzzleDatabaseInfo[],
): Promise<PuzzleDatabaseInfo[]> {
    const old = dbs.find((db) => db.title === OLD_STARTER_PUZZLE_FILE);
    if (old) {
        await commands.deletePuzzleDatabase(old.path);
        dbs = dbs.filter((db) => db !== old);
    }
    if (dbs.some(isTrainingDb)) return dbs;
    selectionStarted ??= importPuzzleSelection()
        .then(() => getPuzzleDatabases())
        .finally(() => {
            selectionStarted = null;
        });
    return selectionStarted;
}

// Welche Datenbank ist ausgewählt? Die Lichess-Puzzles, sobald sie da sind,
// sonst die bisherige, sonst die Puzzle-Auswahl, sonst die erste zum Trainieren.
export function preferredPuzzleDb(
    dbs: PuzzleDatabaseInfo[],
    current: string | null,
): string | null {
    const lichess = dbs.find((db) => db.title === LICHESS_PUZZLE_FILE);
    const selection = dbs.find((db) => db.title === PUZZLE_SELECTION_FILE);
    if (lichess && (current === null || current === selection?.path)) return lichess.path;
    if (current && dbs.some((db) => db.path === current)) return current;
    return (lichess ?? selection ?? dbs.find(isTrainingDb) ?? null)?.path ?? null;
}

let selectionOnce = false;

// Bei der ersten Einführung: die kleine Puzzle-Auswahl im Hintergrund laden.
// Danach wählt die Puzzle-Seite sie von selbst aus. Die ganze Lichess-Datenbank
// gibt es weiter unter „Puzzle-Datenbank hinzufügen“.
export async function downloadPuzzlesOnce(onDone?: (path: string) => void) {
    if (selectionOnce) return;
    selectionOnce = true;
    try {
        const dbs = await getPuzzleDatabases();
        if (dbs.some(isTrainingDb)) return;
        const after = await ensurePuzzleDatabase(dbs);
        const selection = after.find((db) => db.title === PUZZLE_SELECTION_FILE);
        if (selection) onDone?.(selection.path);
    } catch (e) {
        console.error("Puzzle download failed", e);
    }
}
