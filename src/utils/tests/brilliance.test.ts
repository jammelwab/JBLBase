import { describe, expect, it, test } from "vitest";
import {
    existingMove,
    linesBelow,
    numberedLine,
    numberedMove,
    pickBrillianceEngine,
} from "@/utils/brilliance";
import { INITIAL_FEN } from "chessops/fen";
import { lineTree } from "@/utils/gamesTree";
import { mergeTree } from "@/utils/repertoireTree";
import type { LocalEngine } from "@/utils/engines";

const engine = (id: string, name: string, path = `${id}.exe`) =>
    ({ type: "local", id, name, path }) as LocalEngine;

test("Patricia is the default engine for the brilliancy search", () => {
    const engines = [engine("sf", "Stockfish 17"), engine("pat", "Patricia")];
    expect(pickBrillianceEngine(engines, "")).toBe("pat");
    expect(pickBrillianceEngine(engines, "sf")).toBe("sf");
    expect(pickBrillianceEngine(engines, "gone")).toBe("pat");
    expect(pickBrillianceEngine([engine("sf", "Stockfish 17")], "")).toBe("sf");
    expect(pickBrillianceEngine([], "")).toBe("");
});

test("moves are numbered from the start position", () => {
    const white = "r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4";
    const black = "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 3 2";
    expect(numberedMove(white, "Bxf7+")).toBe("4.Bxf7+");
    expect(numberedMove(black, "Nf6")).toBe("2...Nf6");
    expect(numberedLine(white, ["c3", "Nf6", "d4"])).toBe("4.c3 Nf6 5.d4");
    expect(numberedLine(black, ["Nf6", "Ng5", "d5"])).toBe("2...Nf6 3.Ng5 d5");
    expect(numberedLine(white, [])).toBe("");
});

describe("linesBelow and existingMove", () => {
    const line = (...sans: string[]) => lineTree(INITIAL_FEN, 0, sans);
    const root = line("e4", "e5", "Nf3");
    mergeTree(root, line("e4", "c5"));

    it("lists every variation below a node in UCI", () => {
        expect(linesBelow(root)).toEqual([
            ["e2e4", "e7e5", "g1f3"],
            ["e2e4", "c7c5"],
        ]);
        expect(linesBelow(root.children[0].children[1])).toEqual([]);
    });

    it("finds a move that is already in the variation", () => {
        expect(existingMove(root, { pathUci: ["e2e4", "e7e5"], moveUci: "g1f3" })?.san).toBe("Nf3");
        expect(existingMove(root, { pathUci: ["e2e4", "e7e5"], moveUci: "f1c4" })).toBeNull();
    });
});
