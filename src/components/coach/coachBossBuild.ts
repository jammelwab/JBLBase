import type { BookMove } from "@/bindings";
import { findAccountDatabase, sameName } from "@/utils/accountDatabase";
import { fetchRecentChessComPgns } from "@/utils/chess.com/api";
import { getDatabases, query_games } from "@/utils/db";
import { getMainOwner } from "@/utils/repertoires";
import {
    type BossBookSummary,
    type BossGame,
    bossBookSummary,
    bossGameFromPgn,
    buildBossBook,
} from "./coachBoss";
import { loadOwnRepertoires } from "./coachPlan";

// So viele eigene Chess.com-Partien fließen höchstens ein (die neuesten)
const BOSS_GAMES = 1000;
// Der Chess.com-Account des Bosses (1.2.19): seine Partien bauen das Buch,
// egal auf welchem Rechner es gebaut wird
export const BOSS_CHESSCOM = "jbl_Mix3r";

async function bossGames(): Promise<{ games: BossGame[]; source: "database" | "chesscom" }> {
    const databases = await getDatabases().catch(() => []);
    const database = findAccountDatabase(databases, BOSS_CHESSCOM, "chesscom") as
        | ((typeof databases)[number] & { file?: string })
        | null;
    if (database?.file) {
        const res = await query_games(database.file, {
            player1: BOSS_CHESSCOM,
            options: {
                skipCount: true,
                page: 1,
                pageSize: BOSS_GAMES,
                sort: "date",
                direction: "desc",
            },
        }).catch(() => null);
        const games: BossGame[] = [];
        for (const g of res?.data ?? []) {
            const color = sameName(g.white, BOSS_CHESSCOM)
                ? "white"
                : sameName(g.black, BOSS_CHESSCOM)
                  ? "black"
                  : null;
            if (color) games.push({ movetext: g.moves, color, fen: g.fen });
        }
        if (games.length > 0) return { games, source: "database" };
    }
    // Nicht auf diesem Rechner geladen: direkt von Chess.com
    const pgns = await fetchRecentChessComPgns(BOSS_CHESSCOM, BOSS_GAMES);
    return {
        games: pgns.flatMap((pgn) => bossGameFromPgn(pgn, BOSS_CHESSCOM) ?? []),
        source: "chesscom",
    };
}

export type BossBuild = {
    book: BookMove[];
    repertoires: { name: string; color: "white" | "black" }[];
    games: number;
    source: "database" | "chesscom";
    summary: BossBookSummary;
};

// Baut das Boss-Buch aus den eigenen Repertoires (nicht geteilte, aus der
// Cloud geladen) und den Chess.com-Partien von jbl_Mix3r. Hochgeladen wird
// nur das Buch, die Repertoires bleiben privat.
export async function buildMyBossBook(): Promise<BossBuild> {
    const owner = getMainOwner();
    const own = (await loadOwnRepertoires()).filter(
        (r) => r.owner === owner && !r.parts && !r.shared,
    );
    const { games, source } = await bossGames();
    const book = buildBossBook(
        own.map((r) => ({ root: r.root, color: r.color })),
        games,
    );
    return {
        book,
        repertoires: own.map((r) => ({ name: r.name, color: r.color })),
        games: games.length,
        source,
        summary: bossBookSummary(book),
    };
}
