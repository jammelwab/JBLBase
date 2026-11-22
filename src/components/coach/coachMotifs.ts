import {
    attacks,
    between,
    type Color,
    makeSquare,
    opposite,
    type Role,
    type Square,
} from "chessops";
import { Chess } from "chessops/chess";
import { parseFen } from "chessops/fen";
import { parseSan } from "chessops/san";

// Erklärfenster nach einem Fehler (1.2.12): Welches Taktikmotiv steckt in der
// Antwort des Gegners? Die App erkennt es selbst, Claude erklärt es nur.

export type MotifId = "mate" | "fork" | "pin" | "skewer" | "hanging";

export type Motif = {
    id: MotifId;
    // Kurze Beschreibung für Claude (Englisch, passt zur Prüfung der Function)
    text: string;
    // Felder für Pfeile am Brett: Angreifer und Ziele
    from?: string;
    targets: string[];
};

const VALUE: Record<Role, number> = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 100 };
const NAME: Record<Role, string> = {
    pawn: "pawn",
    knight: "knight",
    bishop: "bishop",
    rook: "rook",
    queen: "queen",
    king: "king",
};

function attackersOf(pos: Chess, square: Square, by: Color): number {
    return pos.kingAttackers(square, by, pos.board.occupied).size();
}

// Motive in der Antwort des Gegners. fen: Stellung nach deinem Zug,
// line: die Engine-Linie ab dort (der Gegner zieht zuerst), mateIn: falls der
// Gegner nach deinem Zug Matt setzen kann (Züge bis Matt).
export function detectMotifs(fen: string, line: string[], mateIn: number | null): Motif[] {
    const setup = parseFen(fen);
    if (setup.isErr) return [];
    const pos = Chess.fromSetup(setup.value);
    if (pos.isErr) return [];
    const before = pos.value;
    const out: Motif[] = [];
    if (mateIn !== null && mateIn > 0) {
        out.push({ id: "mate", text: `opponent mates in ${mateIn}`, targets: [] });
    }
    const first = line[0];
    if (!first) return out;
    const move = parseSan(before, first);
    if (!move || !("from" in move)) return out;
    const them = before.turn;
    const you = opposite(them);

    // Hängende Figur: der Gegner schlägt etwas, das du nicht gedeckt hattest
    const victim = before.board.get(move.to);
    if (victim && victim.color === you && victim.role !== "pawn") {
        const defended = attackersOf(before, move.to, you) > 0;
        if (!defended) {
            out.push({
                id: "hanging",
                text: `undefended ${NAME[victim.role]} on ${makeSquare(move.to)} is lost`,
                from: makeSquare(move.from),
                targets: [makeSquare(move.to)],
            });
        }
    }

    const after = before.clone();
    after.play(move);
    const piece = after.board.get(move.to);
    if (!piece) return out;
    const occ = after.board.occupied;

    // Gabel: die gezogene Figur greift zwei wertvolle Figuren auf einmal an
    const hits: Square[] = [];
    for (const sq of attacks(piece, move.to, occ)) {
        const target = after.board.get(sq);
        if (!target || target.color !== you || target.role === "pawn") continue;
        const worthIt =
            target.role === "king" ||
            VALUE[target.role] > VALUE[piece.role] ||
            attackersOf(after, sq, you) === 0;
        if (worthIt) hits.push(sq);
    }
    if (hits.length >= 2) {
        const names = hits.map((sq) => NAME[after.board.get(sq)!.role]).join(" and ");
        out.push({
            id: "fork",
            text: `fork by ${NAME[piece.role]} on ${makeSquare(move.to)} hits ${names}`.slice(
                0,
                40,
            ),
            from: makeSquare(move.to),
            targets: hits.map((sq) => makeSquare(sq)),
        });
    }

    // Fesselung und Spieß: eine Langschrittler-Linie durch zwei deiner Figuren
    if (piece.role === "bishop" || piece.role === "rook" || piece.role === "queen") {
        for (const front of attacks(piece, move.to, occ)) {
            const a = after.board.get(front);
            if (!a || a.color !== you) continue;
            // Was steht hinter der ersten Figur auf derselben Linie?
            const behind = attacks(piece, move.to, occ.without(front)).diff(
                attacks(piece, move.to, occ),
            );
            for (const back of behind) {
                const b = after.board.get(back);
                if (!b || b.color !== you) continue;
                if (!between(move.to, back).has(front)) continue;
                if (VALUE[b.role] > VALUE[a.role] && b.role !== "pawn") {
                    out.push({
                        id: "pin",
                        text: `pin ${NAME[a.role]} ${makeSquare(front)} to ${NAME[b.role]}`,
                        from: makeSquare(move.to),
                        targets: [makeSquare(front), makeSquare(back)],
                    });
                } else if (VALUE[a.role] > VALUE[b.role] && a.role !== "pawn") {
                    out.push({
                        id: "skewer",
                        text: `skewer ${NAME[a.role]} ${makeSquare(front)} and ${NAME[b.role]}`,
                        from: makeSquare(move.to),
                        targets: [makeSquare(front), makeSquare(back)],
                    });
                }
            }
        }
    }
    // Höchstens vier Stichworte, wichtigste zuerst
    const order: MotifId[] = ["mate", "fork", "skewer", "pin", "hanging"];
    return out.sort((x, y) => order.indexOf(x.id) - order.indexOf(y.id)).slice(0, 4);
}
