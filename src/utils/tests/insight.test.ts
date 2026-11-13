import { expect, test } from "vitest";
import type { DatabaseInfo } from "@/bindings";
import {
    accountKey,
    accountLabel,
    insightAccounts,
    mergeAccounts,
    monthLabel,
    moveNumber,
} from "../insight";
import type { Session } from "../session";

function database(filename: string) {
    return { filename, file: `/dbs/${filename}` } as DatabaseInfo & { file: string };
}

test("insightAccounts pairs each account with its downloaded games", () => {
    const sessions = [
        { lichess: { username: "Ich" }, updatedAt: 0 },
        { chessCom: { username: "ich_cc" }, updatedAt: 0 },
        { chessCom: { username: "ohnePartien" }, updatedAt: 0 },
    ] as unknown as Session[];
    const databases = [database("ich_lichess.duckdb"), database("ich_cc_chesscom.duckdb")];
    expect(insightAccounts(sessions, databases)).toEqual([
        { file: "/dbs/ich_lichess.duckdb", player: "Ich" },
        { file: "/dbs/ich_cc_chesscom.duckdb", player: "ich_cc" },
    ]);
});

test("labels", () => {
    expect(monthLabel("2026-03")).toBe("03/2026");
    expect(moveNumber(10)).toBe("6.");
    expect(moveNumber(11)).toBe("6...");
});

test("mergeAccounts keeps each player of a database once", () => {
    const a = { file: "/dbs/lichess_Ich.duckdb", player: "Ich" };
    const merged = mergeAccounts(
        [a],
        [
            { ...a, player: "ich" },
            { file: a.file, player: "Du" },
        ],
    );
    expect(merged.map((m) => m.player)).toEqual(["Ich", "Du"]);
    expect(accountKey(a)).toBe(accountKey({ ...a, player: "ICH" }));
    expect(accountLabel(a)).toBe("Ich (lichess_Ich.duckdb)");
    expect(accountLabel({ file: "C:\\dbs\\x.duckdb", player: "X" })).toBe("X (x.duckdb)");
});
