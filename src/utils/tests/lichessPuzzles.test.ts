import { expect, test, vi } from "vitest";
import type { PuzzleDatabaseInfo } from "@/bindings";

vi.mock("@tauri-apps/api/path", () => ({ resolve: async (...p: string[]) => p.join("/") }));
vi.mock("@tauri-apps/plugin-fs", () => ({ readDir: async () => [] }));

import { pickReferenceDatabase } from "../lichessPuzzles";

function db(title: string, puzzleCount: number): PuzzleDatabaseInfo {
    return { title, description: "", puzzleCount, storageSize: BigInt(0), path: `/p/${title}` };
}

test("the imported Lichess puzzles are the reference", () => {
    const dbs = [db("puzzles.duckdb", 4_000_000), db("Lichess Puzzles.duckdb", 5_000_000)];
    expect(pickReferenceDatabase(dbs)?.title).toBe("Lichess Puzzles.duckdb");
});

test("without them, the biggest other puzzle database, never our own tactics", () => {
    const dbs = [
        db("Repertoire-Taktiken.duckdb", 900_000),
        db("small.duckdb", 5_000),
        db("puzzles.duckdb", 3_000_000),
    ];
    expect(pickReferenceDatabase(dbs)?.title).toBe("puzzles.duckdb");
    expect(pickReferenceDatabase([db("small.duckdb", 5_000)])).toBeNull();
});
