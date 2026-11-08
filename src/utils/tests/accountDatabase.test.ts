import { describe, expect, test } from "vitest";
import type { DatabaseInfo } from "@/bindings";
import { findAccountDatabase } from "../accountDatabase";

const db = (filename: string) => ({ filename, file: `/db/${filename}` }) as unknown as DatabaseInfo;

describe("findAccountDatabase", () => {
    const databases = [db("Ragingforlife_chesscom.duckdb"), db("JBLBASE_lichess.duckdb")];

    test("ignores the capitalisation of the username", () => {
        expect(findAccountDatabase(databases, "ragingforlife", "chesscom")?.filename).toBe(
            "Ragingforlife_chesscom.duckdb",
        );
        expect(findAccountDatabase(databases, "jblbase", "lichess")?.filename).toBe(
            "JBLBASE_lichess.duckdb",
        );
    });

    test("keeps Lichess and Chess.com apart", () => {
        expect(findAccountDatabase(databases, "ragingforlife", "lichess")).toBeNull();
    });
});
