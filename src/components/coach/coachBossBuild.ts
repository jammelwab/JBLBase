import { getDefaultStore } from "jotai";
import { sessionsAtom } from "@/state/atoms";
import { findAccountDatabase, sameName } from "@/utils/accountDatabase";
import { getDatabases, query_games } from "@/utils/db";
import { getMainOwner } from "@/utils/repertoires";
import type { BookMove } from "@/bindings";
import { type BossGame, buildBossBook } from "./coachBoss";
import { loadOwnRepertoires } from "./coachPlan";

// So viele eigene Chess.com-Partien fließen höchstens ein (die neuesten)
const BOSS_GAMES = 1000;

// Baut das Boss-Buch aus den eigenen Repertoires und den geladenen
// Chess.com-Partien dieses Rechners (für die Admin-Übersicht).
export async function buildMyBossBook(): Promise<{
    book: BookMove[];
    repertoires: number;
    games: number;
}> {
    const owner = getMainOwner();
    const repertoires = (await loadOwnRepertoires())
        .filter((r) => r.owner === owner && !r.parts)
        .map((r) => ({ root: r.root, color: r.color }));
    const games: BossGame[] = [];
    const sessions = getDefaultStore().get(sessionsAtom);
    const databases = await getDatabases().catch(() => []);
    for (const session of sessions) {
        const name = session.chessCom?.username;
        if (!name) continue;
        const database = findAccountDatabase(databases, name, "chesscom") as
            | ((typeof databases)[number] & { file?: string })
            | null;
        if (!database?.file) continue;
        const res = await query_games(database.file, {
            player1: name,
            options: {
                skipCount: true,
                page: 1,
                pageSize: BOSS_GAMES,
                sort: "date",
                direction: "desc",
            },
        }).catch(() => null);
        for (const g of res?.data ?? []) {
            const color = sameName(g.white, name)
                ? "white"
                : sameName(g.black, name)
                  ? "black"
                  : null;
            if (color) games.push({ movetext: g.moves, color, fen: g.fen });
        }
    }
    return {
        book: buildBossBook(repertoires, games),
        repertoires: repertoires.length,
        games: games.length,
    };
}
