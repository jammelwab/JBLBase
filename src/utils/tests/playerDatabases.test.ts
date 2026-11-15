import { expect, test } from "vitest";
import {
    addLink,
    allPlayerNames,
    databaseName,
    linkOf,
    linksOfPlayer,
    removePlayerLinks,
    renameLinks,
} from "../playerDatabases";

const account = (username: string, player?: string) => ({
    chessCom: { username, stats: {} },
    player,
    updatedAt: 0,
});

test("players with only a database show up after the account players", () => {
    const links = [{ player: "Jannick Schwab", file: "/db/otb.duckdb", name: "Schwab, Jannick" }];
    expect(allPlayerNames([account("konto", "Aaron")], links)).toEqual(["Aaron", "Jannick Schwab"]);
    expect(allPlayerNames([account("konto", "jannick schwab")], links)).toEqual(["jannick schwab"]);
});

test("a database player belongs to one player, names join case-insensitively", () => {
    let links = addLink([], {
        player: "Jannick Schwab",
        file: "/db/otb.duckdb",
        name: "Schwab, J",
    });
    links = addLink(links, { player: "jannick schwab", file: "/db/club.duckdb", name: "Schwab" }, [
        "Jannick Schwab",
    ]);
    expect(linksOfPlayer(links, "JANNICK SCHWAB")).toHaveLength(2);
    expect(links.every((l) => l.player === "Jannick Schwab")).toBe(true);

    // Moving "Schwab, J" to Aaron replaces the old link
    links = addLink(links, { player: "Aaron", file: "/DB/otb.duckdb", name: "schwab, j" });
    expect(linksOfPlayer(links, "Jannick Schwab")).toHaveLength(1);
    expect(linkOf(links, "/db/otb.duckdb", "Schwab, J")?.player).toBe("Aaron");
});

test("renaming and removing a player takes their databases along", () => {
    const links = [
        { player: "Ich", file: "/db/a.duckdb", name: "A" },
        { player: "Aaron", file: "/db/b.duckdb", name: "B" },
    ];
    expect(renameLinks(links, "ich", "Jannick")[0].player).toBe("Jannick");
    expect(renameLinks(links, "Ich", " ")).toEqual(links);
    expect(removePlayerLinks(links, "aaron")).toEqual([links[0]]);
});

test("database names drop the folder and the extension", () => {
    expect(databaseName("C:\\Users\\x\\db\\Turniere 2025.duckdb")).toBe("Turniere 2025");
});
