import { resolve } from "@tauri-apps/api/path";
import type { DatabaseInfo, InsightAccount } from "@/bindings";
import { findAccountDatabase } from "./accountDatabase";
import { getPuzzlesDir } from "./directories";
import { type Session, sessionUsername } from "./session";

// The puzzle database Insight writes the missed tactics of the own games to. It sits next to
// the Lichess puzzles, so the puzzle trainer lists it by itself.
export const GAME_TACTICS_FILE = "Partien-Taktiken.duckdb";

export const INSIGHT_DEPTHS = [18, 24] as const;
export const DEFAULT_INSIGHT_DEPTH = 18;

export async function gameTacticsPath(): Promise<string> {
    return resolve(await getPuzzlesDir(), GAME_TACTICS_FILE);
}

// The accounts whose games are downloaded, each with the database that holds them.
export function insightAccounts(
    sessions: Session[],
    databases: (DatabaseInfo & { file?: string })[],
): InsightAccount[] {
    const accounts: InsightAccount[] = [];
    for (const session of sessions) {
        const player = sessionUsername(session);
        if (!player) continue;
        const database = findAccountDatabase(
            databases,
            player,
            session.lichess ? "lichess" : "chesscom",
        ) as (DatabaseInfo & { file?: string }) | null;
        if (!database?.file) continue;
        if (accounts.some((a) => a.file === database.file)) continue;
        accounts.push({ file: database.file, player });
    }
    return accounts;
}

// "2026-03" -> "03/2026"
export function monthLabel(month: string): string {
    const [year, m] = month.split("-");
    return m && year ? `${m}/${year}` : month;
}

// Ply 0 is White's first move: ply 11 is "6..." and ply 10 "6."
export function moveNumber(ply: number): string {
    return `${Math.floor(ply / 2) + 1}${ply % 2 === 0 ? "." : "..."}`;
}

// Identifies an account in a select box.
export function accountKey(account: InsightAccount): string {
    return `${account.file}\n${account.player.toLowerCase()}`;
}

// "Magnus (lichess_Magnus.duckdb)"
export function accountLabel(account: InsightAccount): string {
    const file = account.file.split(/[\\/]/).pop() ?? account.file;
    return `${account.player} (${file})`;
}

// Both lists of accounts, each account once.
export function mergeAccounts(a: InsightAccount[], b: InsightAccount[]): InsightAccount[] {
    const seen = new Set<string>();
    return [...a, ...b].filter((account) => {
        const key = accountKey(account);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}
