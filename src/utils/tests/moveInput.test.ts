import { makeUci } from "chessops";
import { expect, test } from "vitest";
import { positionFromFen } from "../chessops";
import { germanSan, localSan, parseMoveInput } from "../moveInput";

function uci(fen: string, input: string) {
    const [pos] = positionFromFen(fen);
    const move = parseMoveInput(pos!, input);
    return move ? makeUci(move) : undefined;
}

// White knight on f3 can take on d4
const KNIGHT = "r1bqkbnr/pppp1ppp/2n5/8/3pP3/5N2/PPP2PPP/RNBQKB1R w KQkq - 0 4";

test("English and German piece letters give the same move", () => {
    expect(uci(KNIGHT, "Nxd4")).toBe("f3d4");
    expect(uci(KNIGHT, "Sxd4")).toBe("f3d4");
    expect(uci(KNIGHT, "Sd4")).toBe("f3d4");
    expect(uci(KNIGHT, "S:d4")).toBe("f3d4");
    expect(uci(KNIGHT, "sxd4")).toBe("f3d4");
    expect(uci(KNIGHT, "nxd4+")).toBe("f3d4");
    expect(uci(KNIGHT, "4. Sxd4!")).toBe("f3d4");
    expect(uci(KNIGHT, "f3d4")).toBe("f3d4");
});

test("queen, rook and bishop in German", () => {
    const start = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";
    expect(uci(start, "Dh5")).toBe("d1h5");
    expect(uci(start, "Qh5")).toBe("d1h5");
    expect(uci(start, "Lc4")).toBe("f1c4");
    expect(uci(start, "Bc4")).toBe("f1c4");
    expect(uci(start, "Ke2")).toBe("e1e2");
});

test("pawn moves, also with the German Bauer letter", () => {
    const start = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    expect(uci(start, "e4")).toBe("e2e4");
    expect(uci(start, "Be4")).toBe("e2e4");
});

test("castling with zeros or letters", () => {
    const fen = "r3k2r/pppqbppp/2np1n2/4p3/4P3/2NP1N2/PPPQBPPP/R3K2R w KQkq - 0 1";
    expect(uci(fen, "0-0")).toBe("e1h1");
    expect(uci(fen, "O-O")).toBe("e1h1");
    expect(uci(fen, "o-o-o")).toBe("e1a1");
});

test("promotion with German or English piece", () => {
    const fen = "8/4P3/8/8/8/8/k7/7K w - - 0 1";
    expect(uci(fen, "e8D")).toBe("e7e8q");
    expect(uci(fen, "e8=Q")).toBe("e7e8q");
    expect(uci(fen, "e8=S")).toBe("e7e8n");
    expect(uci(fen, "e7e8d")).toBe("e7e8q");
});

test("illegal or unreadable input is no move", () => {
    expect(uci(KNIGHT, "Sxd5")).toBeUndefined();
    expect(uci(KNIGHT, "hallo")).toBeUndefined();
    expect(uci(KNIGHT, "")).toBeUndefined();
});

test("moves are shown with German letters in German", () => {
    expect(germanSan("Nxd4")).toBe("Sxd4");
    expect(germanSan("Qh5+")).toBe("Dh5+");
    expect(germanSan("e8=Q")).toBe("e8=D");
    expect(germanSan("O-O")).toBe("O-O");
    const [pos] = positionFromFen(KNIGHT);
    const move = parseMoveInput(pos!, "Nxd4")!;
    expect(localSan(pos!, move, "de-DE")).toBe("Sxd4");
    expect(localSan(pos!, move, "en-US")).toBe("Nxd4");
});
