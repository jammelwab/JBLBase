import { type Move, parseUci } from "chessops";
import type { Chess } from "chessops/chess";
import { makeSan, parseSan } from "chessops/san";

// German piece letters: König, Dame, Turm, Läufer, Springer (Bauer has none)
const GERMAN_TO_ENGLISH: Record<string, string> = { K: "K", D: "Q", T: "R", L: "B", S: "N" };
const ENGLISH_TO_GERMAN: Record<string, string> = { K: "K", Q: "D", R: "T", B: "L", N: "S" };

function clean(input: string): string {
    return (
        input
            .trim()
            // Move number in front, as in "23. Sxd4" or "23... Nxd4"
            .replace(/^\d+\s*\.+\s*/, "")
            .replace(/\s+/g, "")
            // Annotations and check marks never change the move
            .replace(/[+#†‡!?]+$/, "")
            .replace(/e\.?p\.?$/i, "")
            // Castling written with zeros, dashes of any kind
            .replace(/[–—]/g, "-")
            .replace(/^0-0-0$/, "O-O-O")
            .replace(/^0-0$/, "O-O")
            .replace(/^o-o-o$/i, "O-O-O")
            .replace(/^o-o$/i, "O-O")
            // German capture sign
            .replace(/:/g, "x")
    );
}

function isLegal(pos: Chess, move: Move | undefined): move is Move {
    return move !== undefined && pos.isLegal(move);
}

/**
 * Reads a move the user typed: English SAN ("Nxd4"), German SAN ("Sxd4",
 * "Dh5", "e8D"), with or without capture sign, check marks or move number,
 * or UCI ("g1f3"). Returns the legal move, or undefined if the text is not a
 * legal move in this position.
 */
export function parseMoveInput(pos: Chess, input: string): Move | undefined {
    const text = clean(input);
    if (!text) return;

    if (text === "O-O" || text === "O-O-O") {
        const move = parseSan(pos, text);
        return isLegal(pos, move) ? move : undefined;
    }

    // Piece letters typed in lower case ("nf3", "sxd4"). b to h are files, so only these.
    const upper = text.replace(/^[kqrntls]/, (c) => c.toUpperCase());

    const candidates: string[] = [upper];
    // German letters, also for the promotion piece ("e8D", "e8=D")
    const german = upper
        .replace(/^[DTLS]/, (c) => GERMAN_TO_ENGLISH[c])
        .replace(
            /(=?)([DTLSdtls])$/,
            (_m, eq: string, c: string) => eq + GERMAN_TO_ENGLISH[c.toUpperCase()],
        );
    if (german !== upper) candidates.push(german);
    // "B" is the English bishop, but a German player may mean the pawn (Bauer)
    if (/^B[a-h]/.test(upper)) candidates.push(upper.slice(1));

    for (const san of candidates) {
        const move = parseSan(pos, san);
        if (isLegal(pos, move)) return move;
    }

    if (/^[a-h][1-8][a-h][1-8][qrbnQRBNdtlsDTLS]?$/.test(text)) {
        const promo = text[4];
        const uci =
            text.slice(0, 4) +
            (promo ? (GERMAN_TO_ENGLISH[promo.toUpperCase()] ?? promo).toLowerCase() : "");
        const move = parseUci(uci);
        if (isLegal(pos, move)) return move;
    }
    return undefined;
}

/** English SAN with German piece letters ("Nxd4" becomes "Sxd4"). */
export function germanSan(san: string): string {
    return san
        .replace(/^[KQRBN]/, (c) => ENGLISH_TO_GERMAN[c])
        .replace(/=([QRBN])/, (_m, c: string) => `=${ENGLISH_TO_GERMAN[c]}`);
}

/** The move in SAN, with German piece letters when the app is in German. */
export function localSan(pos: Chess, move: Move, language: string): string {
    const san = makeSan(pos, move);
    return language.startsWith("de") ? germanSan(san) : san;
}
