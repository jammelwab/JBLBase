import { getDefaultStore } from "jotai";
import { beforeEach, expect, test, vi } from "vitest";
import { myPlayerAtom, playerDatabasesAtom, sessionsAtom } from "@/state/atoms";
import {
    hasOwnGames,
    hasPlayerGames,
    playerForOwner,
    sessionsOfOwner,
} from "../repertoireExplorer";

// vi.mock calls are hoisted above these imports

const databases: { filename: string; file: string }[] = [];

vi.mock("@tauri-apps/api/path", () => ({ resolve: async (...p: string[]) => p.join("/") }));
vi.mock("@/bindings", () => ({
    commands: { getPlayers: async () => ({ status: "error" }) },
}));
vi.mock("../db", () => ({
    getDatabases: async () => databases,
    searchPosition: async () => [[]],
}));
vi.mock("../directories", () => ({ getDatabasesDir: async () => "/db" }));
vi.mock("../lichess/api", () => ({ getLichessGames: async () => ({ moves: [] }) }));

beforeEach(() => {
    databases.length = 0;
});

test("own games show up once an account is added, without restarting the app", async () => {
    const store = getDefaultStore();
    store.set(sessionsAtom, []);
    expect(await hasOwnGames()).toBe(false);

    databases.push({ filename: "Beispielkonto_chesscom.duckdb", file: "/db/x.duckdb" });
    store.set(sessionsAtom, [{ chessCom: { username: "beispielkonto", stats: {} }, updatedAt: 0 }]);
    expect(await hasOwnGames()).toBe(true);
});

const chessCom = (username: string, player?: string) => ({
    chessCom: { username, stats: {} },
    player,
    updatedAt: 0,
});

test("each repertoire owner is compared with the games of the player with that name", async () => {
    const store = getDefaultStore();
    databases.push(
        { filename: "Konto1_chesscom.duckdb", file: "/db/1.duckdb" },
        { filename: "Konto2_chesscom.duckdb", file: "/db/2.duckdb" },
    );
    store.set(sessionsAtom, [chessCom("konto1", "Spieler"), chessCom("konto2", "Freund")]);
    expect(await hasOwnGames("freund")).toBe(true);
    expect(await hasOwnGames("Spieler")).toBe(true);
    expect(await hasOwnGames("Jemand")).toBe(false);
});

test("sessionsOfOwner picks the matching player, the main user falls back to all accounts", () => {
    const sessions = [chessCom("konto1", "Spieler"), chessCom("konto2", "Freund")];
    expect(sessionsOfOwner(sessions, "freund", "Ich")).toEqual([sessions[1]]);
    expect(sessionsOfOwner(sessions, "Spieler", "Spieler")).toEqual([sessions[0]]);
    expect(sessionsOfOwner(sessions, "Ich", "Ich")).toEqual(sessions);
    expect(sessionsOfOwner(sessions, "Jemand", "Ich")).toEqual([]);
});

test("the player marked as me is used for your own repertoires", () => {
    const players = ["Jannick Schwab", "Aaron"];
    expect(playerForOwner("Ich", players, "Ich", "Jannick Schwab")).toBe("Jannick Schwab");
    expect(playerForOwner("aaron", players, "Ich", "Jannick Schwab")).toBe("Aaron");
    // Nobody marked: the main user keeps all accounts
    expect(playerForOwner("Ich", players, "Ich", "")).toBeNull();
    expect(playerForOwner("Jemand", players, "Ich", "")).toBe("Jemand");
});

test("databases added to a player count with their accounts", async () => {
    const store = getDefaultStore();
    databases.push(
        { filename: "Konto1_chesscom.duckdb", file: "/db/Konto1_chesscom.duckdb" },
        { filename: "Turniere.duckdb", file: "/db/Turniere.duckdb" },
    );
    store.set(sessionsAtom, [chessCom("konto1", "Aaron")]);
    store.set(playerDatabasesAtom, [
        { player: "Jannick Schwab", file: "/db/Turniere.duckdb", name: "Schwab, Jannick" },
        { player: "Jannick Schwab", file: "/db/Geloescht.duckdb", name: "Schwab" },
    ]);
    store.set(myPlayerAtom, "Jannick Schwab");
    expect(await hasPlayerGames("Jannick Schwab")).toBe(true);
    expect(await hasOwnGames("Ich")).toBe(true);
    expect(await hasPlayerGames("Niemand")).toBe(false);

    // A removed database does not count
    store.set(playerDatabasesAtom, [
        { player: "Jannick Schwab", file: "/db/Geloescht.duckdb", name: "Schwab" },
    ]);
    expect(await hasPlayerGames("Jannick Schwab")).toBe(false);
    store.set(playerDatabasesAtom, []);
    store.set(myPlayerAtom, "");
});
