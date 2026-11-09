import { describe, expect, it } from "vitest";
import { cloudErrorKey, isLichessUid, normalizeChessComUsername, parseProfile } from "./auth";

describe("cloud account helpers", () => {
    it("recognises Lichess accounts by uid", () => {
        expect(isLichessUid("lichess:someone")).toBe(true);
        expect(isLichessUid("Xy12abc")).toBe(false);
    });

    it("checks Chess.com usernames", () => {
        expect(normalizeChessComUsername("  Hikaru ")).toBe("Hikaru");
        expect(normalizeChessComUsername("a_b-c1")).toBe("a_b-c1");
        expect(normalizeChessComUsername("ab")).toBeNull();
        expect(normalizeChessComUsername("with space")).toBeNull();
        expect(normalizeChessComUsername("x".repeat(26))).toBeNull();
    });

    it("reads only known profile fields", () => {
        expect(parseProfile(undefined)).toEqual({});
        expect(parseProfile({ lichess: "a", chesscom: "", settings: {} })).toEqual({
            lichess: "a",
        });
        expect(parseProfile({ lichess: 3, chesscom: "b" })).toEqual({ chesscom: "b" });
    });

    it("maps Firebase errors to messages", () => {
        expect(cloudErrorKey({ code: "auth/invalid-credential" })).toBe(
            "Settings.Cloud.Error.WrongCredentials",
        );
        expect(cloudErrorKey({ code: "auth/email-already-in-use" })).toBe(
            "Settings.Cloud.Error.EmailInUse",
        );
        expect(cloudErrorKey({ code: "functions/unauthenticated" })).toBe(
            "Settings.Cloud.Error.LichessRejected",
        );
        expect(cloudErrorKey(new Error("x"))).toBe("Settings.Cloud.Error.Unknown");
        expect(cloudErrorKey(null)).toBe("Settings.Cloud.Error.Unknown");
    });
});
