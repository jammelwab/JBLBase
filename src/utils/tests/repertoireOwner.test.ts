import { expect, test } from "vitest";
import {
    DEFAULT_MAIN_OWNER,
    defaultRepertoires,
    mainOwnerName,
    repertoireOwner,
} from "../repertoires";

test("the main user is recognised in any letter case", () => {
    expect(repertoireOwner("spieler", "Spieler")).toBe("Spieler");
    expect(repertoireOwner(" Spieler ", "Spieler")).toBe("Spieler");
    expect(repertoireOwner(undefined, "Spieler")).toBe("Spieler");
    expect(repertoireOwner("", "Spieler")).toBe("Spieler");
    expect(repertoireOwner(" Freund ", "Spieler")).toBe("Freund");
});

test("repertoires made before a name was set still belong to the main user", () => {
    expect(repertoireOwner(DEFAULT_MAIN_OWNER, "Spieler")).toBe("Spieler");
    expect(repertoireOwner("ich", DEFAULT_MAIN_OWNER)).toBe(DEFAULT_MAIN_OWNER);
});

test("without a configured name the main user is called Ich", () => {
    expect(mainOwnerName("")).toBe(DEFAULT_MAIN_OWNER);
    expect(mainOwnerName("  ")).toBe(DEFAULT_MAIN_OWNER);
    expect(mainOwnerName(null)).toBe(DEFAULT_MAIN_OWNER);
    expect(mainOwnerName(" Spieler ")).toBe("Spieler");
});

test("the one-click repertoires name no one in the code", () => {
    expect(defaultRepertoires("Spieler")).toEqual([
        { owner: "Spieler", color: "white" },
        { owner: "Spieler", color: "black" },
    ]);
});
