import { getDefaultStore } from "jotai";
import { beforeEach, expect, test, vi } from "vitest";
import { sessionsAtom } from "@/state/atoms";
import { hasOwnGames, sessionsOfOwner } from "../repertoireExplorer";

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
