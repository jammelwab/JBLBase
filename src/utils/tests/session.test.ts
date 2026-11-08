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
    const sessions = [lichess("JBLBASE"), chessCom("ragingforlife")];

    test("every account starts as its own player", () => {
        expect(playerNames(sessions)).toEqual(["JBLBASE", "ragingforlife"]);
    });

    test("dropping an account on a player merges them", () => {
        const merged = moveSessionToPlayer(sessions, sessionKey(sessions[1]), "JBLBASE");
        expect(playerNames(merged)).toEqual(["JBLBASE"]);
        expect(sessionsOfPlayer(merged, "JBLBASE")).toHaveLength(2);
        // The target keeps its name even without its original account.
        const rest = merged.filter((s) => s.lichess === undefined);
        expect(playerNames(rest)).toEqual(["JBLBASE"]);
    });

    test("detaching gives the account its own player again", () => {
        const merged = moveSessionToPlayer(sessions, sessionKey(sessions[1]), "JBLBASE");
        const split = detachSession(merged, sessionKey(sessions[1]));
        expect(playerNames(split)).toEqual(["JBLBASE", "ragingforlife"]);
    });

    test("a player with an explicit name is not confused with an account name", () => {
        const named = [lichess("JBLBASE", "Jannick"), chessCom("JBLBASE")];
        expect(sessionsOfPlayer(named, "Jannick")).toHaveLength(1);
        expect(sessionsOfPlayer(named, "JBLBASE")).toHaveLength(1);
    });
});

describe("adding accounts", () => {
    test("the same Chess.com account in other letter case replaces the old one", () => {
        const sessions = [chessCom("ragingforlife", "Jannick")];
        const added = addSession(sessions, chessCom("RagingForLife", "Jannick"));
        expect(added).toHaveLength(1);
        expect(added[0].chessCom?.username).toBe("RagingForLife");
    });

    test("the same Lichess account is recognised by its id", () => {
        const added = addSession([lichess("JBLBASE")], lichess("jblbase"));
        expect(added).toHaveLength(1);
    });

    test("a Chess.com and a Lichess account with the same name stay apart", () => {
        const added = addSession([lichess("ragingforlife")], chessCom("ragingforlife"));
        expect(added).toHaveLength(2);
    });

    test("a player name in other letter case joins the existing player", () => {
        const sessions = [lichess("JBLBASE", "Jannick")];
        const added = addSession(sessions, chessCom("ragingforlife", " jannick "));
        expect(playerNames(added)).toEqual(["Jannick"]);
    });
});

describe("renaming players", () => {
    const sessions = [lichess("JBLBASE", "Jannick"), chessCom("ragingforlife", "Jannick")];

    test("all accounts of the player get the new name, without spaces around it", () => {
        expect(playerNames(renamePlayer(sessions, "Jannick", "  Jannick S. "))).toEqual([
            "Jannick S.",
        ]);
    });

    test("an empty name gives each account its own player again", () => {
        expect(playerNames(renamePlayer(sessions, "Jannick", "  "))).toEqual([
            "JBLBASE",
            "ragingforlife",
        ]);
    });
});
