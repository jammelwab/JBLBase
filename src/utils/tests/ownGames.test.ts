import { describe, expect, it } from "vitest";
import { ownGamesOptions } from "../ownGames";

const WHITE_TO_MOVE = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const BLACK_TO_MOVE = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
const base = { path: "me_lichess.duckdb", position: { fen: WHITE_TO_MOVE, type_: "exact" } };

describe("ownGamesOptions", () => {
    it("leaves the query alone without an account or with all games", () => {
        expect(ownGamesOptions(base, undefined, "mine", WHITE_TO_MOVE)).toBe(base);
        expect(ownGamesOptions(base, "Me", "all", WHITE_TO_MOVE)).toBe(base);
    });

    it("filters by the color you had", () => {
        expect(ownGamesOptions(base, "Me", "white", BLACK_TO_MOVE)).toMatchObject({
            player1: "Me",
            sides: "WhiteBlack",
        });
        expect(ownGamesOptions(base, "Me", "black", WHITE_TO_MOVE)).toMatchObject({
            player1: "Me",
            sides: "BlackWhite",
        });
    });

    it("takes the side to move for your own moves", () => {
        expect(ownGamesOptions(base, "Me", "mine", WHITE_TO_MOVE).sides).toBe("WhiteBlack");
        expect(ownGamesOptions(base, "Me", "mine", BLACK_TO_MOVE).sides).toBe("BlackWhite");
    });

    it("drops an opponent filter that would clash with yours", () => {
        const opened = { ...base, player2: "Me", sides: "WhiteBlack" as const };
        expect(ownGamesOptions(opened, "Me", "black", WHITE_TO_MOVE)).toMatchObject({
            player1: "Me",
            player2: undefined,
            sides: "BlackWhite",
        });
    });
});
