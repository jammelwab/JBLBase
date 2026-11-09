import { resolve } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import { mutate } from "swr";
import { commands } from "@/bindings";
import { lichessOptionsAtom, mainOwnerAtom, sessionsAtom } from "@/state/atoms";
import { type Session, sessionPlayerName } from "@/utils/session";
import { findAccountDatabase, sameName } from "./accountDatabase";
import { getDatabases, searchPosition } from "./db";
import { getDatabasesDir } from "./directories";
import { getLichessGames } from "./lichess/api";
import { getMainOwner } from "./mainOwner";
import type { MoveStat } from "./gamesTree";
import type { MoveCount } from "./repertoireTree";
import type { RepertoireColor } from "./repertoires";

// Move counts for the repertoire tree: the Lichess database and the user's own games (the
// Chess.com/Lichess accounts downloaded under "User"). Results are cached per session.

const lichessCache = new Map<string, Promise<MoveCount[]>>();
const ownCache = new Map<string, Promise<MoveStat[]>>();

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
    const store = getDefaultStore();
    const token = store.get(sessionsAtom).find((s) => s.lichess?.accessToken)?.lichess?.accessToken;
    const options = { ...store.get(lichessOptionsAtom), player: undefined };
    // Changing the Lichess filters (speeds, ratings) must not show the old numbers
    const key = `${JSON.stringify(options)} ${fen}`;
    const cached = lichessCache.get(key);
    if (cached) return cached;
    const promise = enqueue(async () => {
        const data = await getLichessGames(fen, options, token);
        return data.moves.map((m) => ({ san: m.san, games: m.white + m.draws + m.black }));
    });
    // A failed request may succeed later (rate limit, network), so it is not kept
    promise.catch(() => lichessCache.delete(key));
    lichessCache.set(key, promise);
    return promise;
}

type OwnAccount = { path: string; player: string };

// Accounts per repertoire owner, so each player's repertoire is compared with their own games.
const accountsCache = new Map<string, Promise<OwnAccount[]>>();

/**
 * The accounts whose games belong to a repertoire owner: those of the player with the same
 * name (as on the player cards). The main user without a matching player keeps all accounts,
 * as before players were matched.
 */
export function sessionsOfOwner(sessions: Session[], owner: string, mainOwner: string): Session[] {
    const matched = sessions.filter((s) => sameName(sessionPlayerName(s), owner));
    if (matched.length > 0 || !sameName(owner, mainOwner)) return matched;
    return sessions;
}

function accountsOf(owner: string): Promise<OwnAccount[]> {
    const key = owner.toLowerCase();
    let promise = accountsCache.get(key);
    if (!promise) {
        promise = findOwnAccounts(owner);
        promise.catch(() => accountsCache.delete(key));
        accountsCache.set(key, promise);
    }
    return promise;
}

// The account name as the games spell it: "beispielkonto" can be "BeispielKonto" there.
async function playerName(path: string, username: string): Promise<string> {
    const res = await commands.getPlayers(path, {
        options: { skipCount: true, pageSize: 50, sort: "name", direction: "asc" },
        name: username,
    });
    if (res.status !== "ok") return username;
    return res.data.data.find((p) => sameName(p.name, username))?.name ?? username;
}

async function findOwnAccounts(owner: string): Promise<OwnAccount[]> {
    const sessions = sessionsOfOwner(getDefaultStore().get(sessionsAtom), owner, getMainOwner());
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

export async function hasOwnGames(owner: string = getMainOwner()): Promise<boolean> {
    return (await accountsOf(owner)).length > 0;
}

// SWR key for hasOwnGames, refreshed together when accounts change.
export function ownGamesKey(owner: string) {
    return ["own-games-available", owner.toLowerCase()] as const;
}

// Moves played from `fen` in the owner's own games where they had `color`, with results.
export function ownMoveCounts(
    fen: string,
    color: RepertoireColor,
    owner: string = getMainOwner(),
): Promise<MoveStat[]> {
    const key = `${owner.toLowerCase()} ${color} ${fen}`;
    const cached = ownCache.get(key);
    if (cached) return cached;
    const promise = (async () => {
        const totals = new Map<string, MoveStat>();
        for (const account of await accountsOf(owner)) {
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
                const t = totals.get(op.move) ?? {
                    san: op.move,
                    games: 0,
                    white: 0,
                    draw: 0,
                    black: 0,
                };
                t.games += op.total;
                t.white += op.white;
                t.draw += op.draw;
                t.black += op.black;
                totals.set(op.move, t);
            }
        }
        return [...totals.values()];
    })();
    // A failed lookup is tried again next time instead of staying empty
    promise.catch(() => {
        ownCache.delete(key);
        accountsCache.delete(owner.toLowerCase());
    });
    ownCache.set(key, promise);
    return promise;
}

export function clearExplorerCache() {
    lichessCache.clear();
    ownCache.clear();
    accountsCache.clear();
}

// Your own games change when games are downloaded or an account is added, removed or
// renamed. Without this, the repertoire pages kept showing the games (or "no games yet")
// from the first time they were opened until the app was restarted.
export function refreshOwnGames() {
    ownCache.clear();
    accountsCache.clear();
    void mutate((key) => Array.isArray(key) && key[0] === "own-games-available");
}

getDefaultStore().sub(sessionsAtom, refreshOwnGames);
getDefaultStore().sub(mainOwnerAtom, refreshOwnGames);
