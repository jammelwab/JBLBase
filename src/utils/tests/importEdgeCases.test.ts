import { INITIAL_FEN } from "chessops/fen";
import { makeUci } from "chessops";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Randfälle beim Import: Partie-Links, Chess.com-Zugcodes (TCN), eingefügte
// Kurs-PGNs und PGNs mit Fehlern. Ergänzt im automatischen Testlauf vor 1.1.

const chesscom = vi.hoisted(() => ({ getChesscomGame: vi.fn() }));
const lichess = vi.hoisted(() => ({ getLichessGame: vi.fn() }));
vi.mock("../chess.com/api", () => chesscom);
vi.mock("../lichess/api", () => lichess);

import { getMainLine, innerParsePGN } from "../chess";
import { decodeTCN } from "../chess.com/tcn";
import { getGameFromUrl } from "../import";
import { splitPgnGames } from "../repertoireTree";

const pieceEncoding =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!?{~}(^)[_]@#$,./&-*++=";
const sq = (name: string) => pieceEncoding[name.charCodeAt(0) - 97 + (Number(name[1]) - 1) * 8];

describe("getGameFromUrl", () => {
    beforeEach(() => {
        chesscom.getChesscomGame.mockReset();
        lichess.getLichessGame.mockReset();
        lichess.getLichessGame.mockResolvedValue("PGN");
    });

    test.each([
        ["https://lichess.org/AbCdEfGh", "AbCdEfGh"],
        ["https://lichess.org/AbCdEfGh/black", "AbCdEfGh"],
        ["https://lichess.org/AbCdEfGhIjKl", "AbCdEfGhIjKl"],
        ["https://lichess.org/game/export/AbCdEfGh", "AbCdEfGh"],
        ["https://lichess.org/AbCdEfGh#32", "AbCdEfGh"],
    ])("Lichess-Link %s lädt Partie %s", async (url, id) => {
        await expect(getGameFromUrl(url)).resolves.toBe("PGN");
        expect(lichess.getLichessGame).toHaveBeenCalledWith(id);
    });

    test("Lichess-Startseite ohne Partie-ID gibt einen Fehler", async () => {
        await expect(getGameFromUrl("https://lichess.org/")).rejects.toThrow(/invalid URL/);
    });

    test("Chess.com-Link ohne Treffer gibt einen Fehler statt leerer Partie", async () => {
        chesscom.getChesscomGame.mockResolvedValue(null);
        await expect(getGameFromUrl("https://www.chess.com/game/live/1")).rejects.toThrow(
            /Chess.com/,
        );
    });

    test("Andere Seiten werden abgelehnt", async () => {
        await expect(getGameFromUrl("https://example.com/game/1")).rejects.toThrow(/unsupported/);
    });
});

describe("decodeTCN (Chess.com-Zugcodes)", () => {
    test("normaler Zug", () => {
        expect(makeUci(decodeTCN(sq("e2") + sq("e4")))).toBe("e2e4");
        expect(makeUci(decodeTCN(sq("g8") + sq("f6")))).toBe("g8f6");
    });

    test("Umwandlung geradeaus und mit Schlag, Weiß und Schwarz", () => {
        // 64 + 3 * Figur + Richtung (0 = nach links schlagen, 1 = gerade, 2 = nach rechts)
        expect(makeUci(decodeTCN(sq("a7") + pieceEncoding[64 + 1]))).toBe("a7a8q");
        expect(makeUci(decodeTCN(sq("b7") + pieceEncoding[64 + 3 + 0]))).toBe("b7a8n");
        expect(makeUci(decodeTCN(sq("g2") + pieceEncoding[64 + 2]))).toBe("g2h1q");
    });
});

const san = (value: string) => ({ type: "San", value }) as const;

describe("innerParsePGN mit fehlerhaften Zügen", () => {
    test("ein unmöglicher Zug wird übersprungen, der Rest der Partie bleibt", () => {
        const tree = innerParsePGN(["e4", "e5", "Nf3", "Qh8", "Nc6"].map(san), INITIAL_FEN);
        expect(getMainLine(tree.root)).toEqual(["e2e4", "e7e5", "g1f3", "b8c6"]);
    });

    test("kaputte FEN wirft einen Fehler (wird vom Aufrufer gemeldet)", () => {
        expect(() => innerParsePGN([san("e4")], "keine fen")).toThrow();
    });
});

describe("splitPgnGames", () => {
    test("trennt Kapitel mit und ohne Kopfzeilen", () => {
        const text = '[Event "A"]\n\n1. e4 e5 *\n\n[Event "B"]\n\n1. d4 d5 *\n1. c4 *';
        expect(splitPgnGames(text)).toEqual([
            '[Event "A"]\n\n1. e4 e5 *',
            '[Event "B"]\n\n1. d4 d5 *',
            "1. c4 *",
        ]);
    });

    test("Windows-Zeilenenden und BOM", () => {
        expect(
            splitPgnGames('﻿[Event "A"]\r\n\r\n1. e4 *\r\n\r\n[Event "B"]\r\n\r\n1. d4 *'),
        ).toHaveLength(2);
    });

    // Bekannter Fehler #90: eine Leerzeile vor "[%cal ...]" in einem Kommentar
    // trennt das Kapitel mitten im Kommentar.
    test.fails("Leerzeile vor [%cal] in einem Kommentar trennt kein Kapitel", () => {
        const text =
            '[Event "A"]\n\n1. e4 { Idee:\n\n[%cal Ge2e4] } e5 *\n\n[Event "B"]\n\n1. d4 *';
        expect(splitPgnGames(text)).toHaveLength(2);
    });

    // Bekannter Fehler #90: "1-0" am Zeilenende eines Kommentars mit "1." in der
    // nächsten Zeile gilt als Partieende.
    test.fails("Ergebnis im Kommentar trennt kein Kapitel", () => {
        const text = '[Event "A"]\n\n1. e4 { Weiß gewinnt 1-0\n1. e4 ist gut } e5 *';
        expect(splitPgnGames(text)).toHaveLength(1);
    });
});
