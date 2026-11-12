import { expect, test, vi } from "vitest";
import {
    isDatabaseCacheKey,
    isRejectedToken,
    registerAccountSync,
    syncAccounts,
} from "@/utils/accountSync";

test("games, players and personal statistics are reloaded after a download", () => {
    expect(isDatabaseCacheKey("databases")).toBe(true);
    expect(isDatabaseCacheKey(["games", "a.duckdb", {}])).toBe(true);
    expect(isDatabaseCacheKey(["player-game-info", "a.duckdb", "Spieler"])).toBe(true);
    expect(isDatabaseCacheKey(["personalInfo", "Spieler", []])).toBe(true);
    expect(isDatabaseCacheKey(["tablebase", "fen"])).toBe(false);
    expect(isDatabaseCacheKey("memory")).toBe(false);
});

test("accounts of a player are updated one after the other", async () => {
    const order: string[] = [];
    const job = (name: string) => async () => {
        order.push(`${name} start`);
        await Promise.resolve();
        order.push(`${name} end`);
    };
    const offA = registerAccountSync("lichess:a", job("a"));
    const offB = registerAccountSync("chesscom:b", job("b"));
    await syncAccounts(["lichess:a", "chesscom:b", "lichess:unknown"]);
    expect(order).toEqual(["a start", "a end", "b start", "b end"]);
    offA();
    offB();
});

test("a failing account does not stop the others", async () => {
    const second = vi.fn(async () => {});
    const offA = registerAccountSync("lichess:a", async () => {
        throw new Error("offline");
    });
    const offB = registerAccountSync("chesscom:b", second);
    await syncAccounts(["lichess:a", "chesscom:b"]);
    expect(second).toHaveBeenCalledOnce();
    offA();
    offB();
});

test("an unregistered card is no longer updated", async () => {
    const job = vi.fn(async () => {});
    registerAccountSync("lichess:a", job)();
    await syncAccounts(["lichess:a"]);
    expect(job).not.toHaveBeenCalled();
});

test("recognises a rejected Lichess token", () => {
    expect(
        isRejectedToken(
            "HTTP status client error (401 Unauthorized) for url (https://lichess.org)",
        ),
    ).toBe(true);
    expect(isRejectedToken("HTTP status client error (429 Too Many Requests)")).toBe(false);
    expect(isRejectedToken("error sending request for url (…since=1740100000000)")).toBe(false);
});
