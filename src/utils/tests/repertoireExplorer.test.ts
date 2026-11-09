import { getDefaultStore } from "jotai";
import { beforeEach, expect, test, vi } from "vitest";
import { sessionsAtom } from "@/state/atoms";
import { hasOwnGames } from "../repertoireExplorer";

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
