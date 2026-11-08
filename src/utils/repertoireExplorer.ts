import { resolve } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import { commands } from "@/bindings";
import { lichessOptionsAtom, sessionsAtom } from "@/state/atoms";
import { findAccountDatabase, sameName } from "./accountDatabase";
import { getDatabases, searchPosition } from "./db";
import { getDatabasesDir } from "./directories";
import { getLichessGames } from "./lichess/api";
import type { MoveCount } from "./repertoireTree";
import type { RepertoireColor } from "./repertoires";

// Move counts for the repertoire tree: the Lichess database and the user's own games (the
// Chess.com/Lichess accounts downloaded under "User"). Results are cached per session.

const lichessCache = new Map<string, Promise<MoveCount[]>>();
const ownCache = new Map<string, Promise<MoveCount[]>>();

// The Lichess explorer allows only a few requests at a time, so they queue up.
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
}

export function hasLichessToken(): boolean {
    const sessions = getDefaultStore().get(sessionsAtom);
    return sessions.some((s) => s.lichess?.accessToken);
}

export function lichessMoveCounts(fen: string): Promise<MoveCount[]> {
    const cached = lichessCache.get(fen);
    if (cached) return cached;
    const store = getDefaultStore();
    const token = store.get(sessionsAtom).find((s) => s.lichess?.accessToken)?.lichess?.accessToken;
    const options = { ...store.get(lichessOptionsAtom), player: undefined };
    const promise = enqueue(async () => {
        const data = await getLichessGames(fen, options, token);
        return data.moves.map((m) => ({ san: m.san, games: m.white + m.draws + m.black }));
    });
    // A failed request may succeed later (rate limit, network), so it is not kept
    promise.catch(() => lichessCache.delete(fen));
    lichessCache.set(fen, promise);
    return promise;
}

type OwnAccount = { path: string; player: string };

let accountsPromise: Promise<OwnAccount[]> | null = null;

// The account name as the games spell it: "ragingforlife" can be "RagingForLife" there.
async function playerName(path: string, username: string): Promise<string> {
    const res = await commands.getPlayers(path, {
        options: { skipCount: true, pageSize: 50, sort: "name", direction: "asc" },
        name: username,
    });
    if (res.status !== "ok") return username;
    return res.data.data.find((p) => sameName(p.name, username))?.name ?? username;
}

async function findOwnAccounts(): Promise<OwnAccount[]> {
    const sessions = getDefaultStore().get(sessionsAtom);
    const databases = await getDatabases();
    const dir = await getDatabasesDir();
    const accounts: OwnAccount[] = [];
    for (const session of sessions) {
        const candidates = [
            session.lichess && {
                type: "lichess" as const,
                username: session.lichess.account.username,
            },
            session.chessCom && { type: "chesscom" as const, username: session.chessCom.username },
        ];
        for (const c of candidates) {
            if (!c) continue;
            const db = findAccountDatabase(databases, c.username, c.type);
            if (!db) continue;
            const path = await resolve(dir, db.filename);
            accounts.push({ path, player: await playerName(path, c.username) });
        }
    }
    return accounts;
}

export async function hasOwnGames(): Promise<boolean> {
    accountsPromise ??= findOwnAccounts();
    return (await accountsPromise).length > 0;
}

// Moves played from `fen` in the user's own games where they had `color`.
export function ownMoveCounts(fen: string, color: RepertoireColor): Promise<MoveCount[]> {
    const key = `${color} ${fen}`;
    const cached = ownCache.get(key);
    if (cached) return cached;
    const promise = (async () => {
        accountsPromise ??= findOwnAccounts();
        const totals = new Map<string, number>();
        for (const account of await accountsPromise) {
            const [openings] = await searchPosition(
                {
                    path: account.path,
                    player1: account.player,
                    sides: color === "white" ? "WhiteBlack" : "BlackWhite",
                    position: { fen, type_: "exact" },
                },
                "repertoire-tree",
            ).catch(() => [[]]);
            for (const op of openings) {
                if (op.move === "*") continue;
                totals.set(op.move, (totals.get(op.move) ?? 0) + op.total);
            }
        }
        return [...totals.entries()].map(([san, games]) => ({ san, games }));
    })();
    ownCache.set(key, promise);
    return promise;
}

export function clearExplorerCache() {
    lichessCache.clear();
    ownCache.clear();
    accountsPromise = null;
}
