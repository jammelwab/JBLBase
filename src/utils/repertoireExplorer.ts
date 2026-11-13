import { resolve } from "@tauri-apps/api/path";
import { getDefaultStore } from "jotai";
import { mutate } from "swr";
import { commands } from "@/bindings";
import {
    lichessOptionsAtom,
    mainOwnerAtom,
    masterOptionsAtom,
    myPlayerAtom,
    playerDatabasesAtom,
    sessionsAtom,
} from "@/state/atoms";
import { type Session, sessionPlayerName } from "@/utils/session";
import { findAccountDatabase, sameName } from "./accountDatabase";
import { getDatabases, searchPosition } from "./db";
import { getDatabasesDir } from "./directories";
import { getLichessGames, getMasterGames } from "./lichess/api";
import { getMainOwner } from "./mainOwner";
import { allPlayerNames, linksOfPlayer } from "./playerDatabases";
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

const masterCache = new Map<string, Promise<MoveCount[]>>();

// The same for the Lichess masters database
export function masterMoveCounts(fen: string): Promise<MoveCount[]> {
    const store = getDefaultStore();
    const token = store.get(sessionsAtom).find((s) => s.lichess?.accessToken)?.lichess?.accessToken;
    const options = store.get(masterOptionsAtom);
    const key = `${JSON.stringify(options)} ${fen}`;
    const cached = masterCache.get(key);
    if (cached) return cached;
    const promise = enqueue(async () => {
        const data = await getMasterGames(fen, options, token);
        return data.moves.map((m) => ({ san: m.san, games: m.white + m.draws + m.black }));
    });
    promise.catch(() => masterCache.delete(key));
    masterCache.set(key, promise);
    return promise;
}

type OwnAccount = { path: string; player: string };

// Accounts per player, so each player's repertoire is compared with their own games.
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

/**
 * The player whose games a repertoire owner is compared with. Your own repertoires use the
 * player marked "This is me", others the player with the owner's name. `null` stands for all
 * accounts: the main user before a player was marked or named like them.
 */
export function playerForOwner(
    owner: string,
    players: string[],
    mainOwner: string,
    myPlayer: string,
): string | null {
    const main = sameName(owner, mainOwner);
    const me = players.find((p) => sameName(p, myPlayer));
    if (main && me) return me;
    const named = players.find((p) => sameName(p, owner));
    if (named) return named;
    return main ? null : owner;
}

function currentPlayers(): string[] {
    const store = getDefaultStore();
    return allPlayerNames(store.get(sessionsAtom), store.get(playerDatabasesAtom));
}

/** The player for a repertoire owner with the current accounts and settings. */
export function currentPlayerForOwner(owner: string): string | null {
    return playerForOwner(
        owner,
        currentPlayers(),
        getMainOwner(),
        getDefaultStore().get(myPlayerAtom),
    );
}

function playerKey(player: string | null) {
    return player === null ? "*" : `p:${player.toLowerCase()}`;
}

function accountsOf(player: string | null): Promise<OwnAccount[]> {
    const key = playerKey(player);
    let promise = accountsCache.get(key);
    if (!promise) {
        promise = findOwnAccounts(player);
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

async function findOwnAccounts(player: string | null): Promise<OwnAccount[]> {
    const store = getDefaultStore();
    const allSessions = store.get(sessionsAtom);
    const allLinks = store.get(playerDatabasesAtom);
    const sessions =
        player === null
            ? allSessions
            : allSessions.filter((s) => sameName(sessionPlayerName(s), player));
    const links = player === null ? allLinks : linksOfPlayer(allLinks, player);
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
    // Databases added to the player by hand, as long as they still exist
    const files = new Set(
        databases.map((db) => (db as { file?: string }).file?.replace(/\\/g, "/").toLowerCase()),
    );
    for (const link of links) {
        if (!files.has(link.file.replace(/\\/g, "/").toLowerCase())) continue;
        if (accounts.some((a) => a.path === link.file && sameName(a.player, link.name))) continue;
        accounts.push({ path: link.file, player: link.name });
    }
    return accounts;
}

/** Whether the repertoire owner has games to compare with. */
export async function hasOwnGames(owner: string = getMainOwner()): Promise<boolean> {
    return hasPlayerGames(currentPlayerForOwner(owner));
}

export async function hasPlayerGames(player: string | null): Promise<boolean> {
    return (await accountsOf(player)).length > 0;
}

// SWR key for hasOwnGames, refreshed together when accounts change.
export function ownGamesKey(owner: string) {
    return ["own-games-available", owner.toLowerCase()] as const;
}

// SWR key for hasPlayerGames
export function playerGamesKey(player: string | null) {
    return ["own-games-available", "player", playerKey(player)] as const;
}

// Moves played from `fen` in the owner's own games where they had `color`, with results.
export function ownMoveCounts(
    fen: string,
    color: RepertoireColor,
    owner: string = getMainOwner(),
): Promise<MoveStat[]> {
    return playerMoveCounts(fen, color, currentPlayerForOwner(owner));
}

// The same for a player; `null` for all accounts.
export function playerMoveCounts(
    fen: string,
    color: RepertoireColor,
    player: string | null,
): Promise<MoveStat[]> {
    const key = `${playerKey(player)} ${color} ${fen}`;
    const cached = ownCache.get(key);
    if (cached) return cached;
    const promise = (async () => {
        const totals = new Map<string, MoveStat>();
        for (const account of await accountsOf(player)) {
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
        accountsCache.delete(playerKey(player));
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
getDefaultStore().sub(playerDatabasesAtom, refreshOwnGames);
getDefaultStore().sub(myPlayerAtom, refreshOwnGames);
