import { describe, expect, test } from "vitest";
import {
    detachSession,
    moveSessionToPlayer,
    playerNames,
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
