import { describe, expect, test } from "vitest";
import {
    addSession,
    detachSession,
    moveSessionToPlayer,
    playerNames,
    renamePlayer,
    type Session,
    sessionKey,
    sessionsOfPlayer,
} from "../session";

const chessCom = (username: string, player?: string): Session =>
    ({ chessCom: { username, stats: {} }, player, updatedAt: 0 }) as Session;
const lichess = (username: string, player?: string): Session =>
    ({
        lichess: { username, account: { id: username.toLowerCase(), username } },
        player,
        updatedAt: 0,
    }) as unknown as Session;

describe("merging accounts", () => {
    const sessions = [lichess("LichessKonto"), chessCom("beispielkonto")];

    test("every account starts as its own player", () => {
        expect(playerNames(sessions)).toEqual(["LichessKonto", "beispielkonto"]);
    });

    test("dropping an account on a player merges them", () => {
        const merged = moveSessionToPlayer(sessions, sessionKey(sessions[1]), "LichessKonto");
        expect(playerNames(merged)).toEqual(["LichessKonto"]);
        expect(sessionsOfPlayer(merged, "LichessKonto")).toHaveLength(2);
        // The target keeps its name even without its original account.
        const rest = merged.filter((s) => s.lichess === undefined);
        expect(playerNames(rest)).toEqual(["LichessKonto"]);
    });

    test("detaching gives the account its own player again", () => {
        const merged = moveSessionToPlayer(sessions, sessionKey(sessions[1]), "LichessKonto");
        const split = detachSession(merged, sessionKey(sessions[1]));
        expect(playerNames(split)).toEqual(["LichessKonto", "beispielkonto"]);
    });

    test("a player with an explicit name is not confused with an account name", () => {
        const named = [lichess("LichessKonto", "Spieler"), chessCom("LichessKonto")];
        expect(sessionsOfPlayer(named, "Spieler")).toHaveLength(1);
        expect(sessionsOfPlayer(named, "LichessKonto")).toHaveLength(1);
    });
});

describe("adding accounts", () => {
    test("the same Chess.com account in other letter case replaces the old one", () => {
        const sessions = [chessCom("beispielkonto", "Spieler")];
        const added = addSession(sessions, chessCom("BeispielKonto", "Spieler"));
        expect(added).toHaveLength(1);
        expect(added[0].chessCom?.username).toBe("BeispielKonto");
    });

    test("the same Lichess account is recognised by its id", () => {
        const added = addSession([lichess("LichessKonto")], lichess("lichesskonto"));
        expect(added).toHaveLength(1);
    });

    test("a Chess.com and a Lichess account with the same name stay apart", () => {
        const added = addSession([lichess("beispielkonto")], chessCom("beispielkonto"));
        expect(added).toHaveLength(2);
    });

    test("a player name in other letter case joins the existing player", () => {
        const sessions = [lichess("LichessKonto", "Spieler")];
        const added = addSession(sessions, chessCom("beispielkonto", " spieler "));
        expect(playerNames(added)).toEqual(["Spieler"]);
    });
});

describe("renaming players", () => {
    const sessions = [lichess("LichessKonto", "Spieler"), chessCom("beispielkonto", "Spieler")];

    test("all accounts of the player get the new name, without spaces around it", () => {
        expect(playerNames(renamePlayer(sessions, "Spieler", "  Spieler S. "))).toEqual([
            "Spieler S.",
        ]);
    });

    test("an empty name gives each account its own player again", () => {
        expect(playerNames(renamePlayer(sessions, "Spieler", "  "))).toEqual([
            "LichessKonto",
            "beispielkonto",
        ]);
    });
});
