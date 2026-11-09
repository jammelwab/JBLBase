import { describe, expect, test } from "vitest";
import type { DatabaseInfo } from "@/bindings";
import { findAccountDatabase } from "../accountDatabase";

const db = (filename: string) => ({ filename, file: `/db/${filename}` }) as unknown as DatabaseInfo;

describe("findAccountDatabase", () => {
    const databases = [db("Beispielkonto_chesscom.duckdb"), db("LichessKonto_lichess.duckdb")];

    test("ignores the capitalisation of the username", () => {
        expect(findAccountDatabase(databases, "beispielkonto", "chesscom")?.filename).toBe(
            "Beispielkonto_chesscom.duckdb",
        );
        expect(findAccountDatabase(databases, "lichesskonto", "lichess")?.filename).toBe(
            "LichessKonto_lichess.duckdb",
        );
    });

    test("keeps Lichess and Chess.com apart", () => {
        expect(findAccountDatabase(databases, "beispielkonto", "lichess")).toBeNull();
    });
});
