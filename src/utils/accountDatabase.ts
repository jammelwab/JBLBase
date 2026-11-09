import type { DatabaseInfo } from "@/bindings";

/**
 * File name of the database that holds an account's downloaded games.
 * Usernames are compared case-insensitively: Chess.com and Lichess treat
 * "Beispielkonto" and "beispielkonto" as the same account.
 */
export function accountDatabaseFilename(username: string, type: "lichess" | "chesscom") {
    return `${username}_${type}.duckdb`;
}

export function sameName(a: string | null | undefined, b: string | null | undefined) {
    return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

export function findAccountDatabase(
    databases: DatabaseInfo[],
    username: string,
    type: "lichess" | "chesscom",
): DatabaseInfo | null {
    const filename = accountDatabaseFilename(username, type);
    return databases.find((db) => sameName(db.filename, filename)) ?? null;
}
