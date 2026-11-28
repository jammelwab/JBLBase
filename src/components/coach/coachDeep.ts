import { makeSquare } from "chessops";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { parseSan } from "chessops/san";
import { detectMotifs, type Motif } from "./coachMotifs";
import type { CoachReaction } from "./coachGame";

// Erklärfenster und Partiebericht (1.2.12): was aus den Kommentaren einer
// Partie für die Tiefenerklärung und den Bericht gebraucht wird.

// Reaktionen, bei denen JBL den Fehler in einem eigenen Fenster erklärt
export const DEEP_REACTIONS: readonly CoachReaction[] = ["blunder", "missedMate", "mistake"];

// Matt für den Gegner aus der Bewertung nach deinem Zug ("-M3" -> 3)
export function mateInFromEval(after: string): number | null {
    const m = /^-M(\d{1,2})$/.exec(after);
    return m ? Number(m[1]) : null;
}

export type DeepFacts = {
    fenAfter: string;
    line: string[];
    after: string;
    // Stellung vor deinem Zug und der Zug selbst, falls bekannt: schlägt dein
    // Zug etwas und wird zurückgeschlagen, ist das ein Abtausch (1.2.34)
    fen?: string;
    san?: string;
};

const ROLE_VALUE: Record<string, number> = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9 };

// Was dein Zug geschlagen hat: Zielfeld und Wert der geschlagenen Figur
export function capturedBy(fen: string, san: string): { square: string; value: number } | null {
    const setup = parseFen(fen);
    if (setup.isErr) return null;
    const pos = Chess.fromSetup(setup.value);
    if (pos.isErr) return null;
    const move = parseSan(pos.value, san);
    if (!move || !("from" in move)) return null;
    const victim = pos.value.board.get(move.to);
    if (!victim) return null;
    return { square: makeSquare(move.to), value: ROLE_VALUE[victim.role] ?? 0 };
}

export function motifsFor(c: DeepFacts): Motif[] {
    const trade = c.fen && c.san ? capturedBy(c.fen, c.san) : null;
    return detectMotifs(c.fenAfter, c.line, mateInFromEval(c.after), trade);
}

// Ein bewerteter eigener Zug, wie er für den Bericht gesammelt wird
export type ReportMove = {
    reaction: CoachReaction;
    ply: number;
    san: string;
    best: string | null;
    sign: string;
    motif: Motif["id"] | null;
    motifText: string | null;
};

const SEVERITY: Partial<Record<CoachReaction, number>> = {
    missedMate: 4,
    blunder: 3,
    mistake: 2,
    dubious: 1,
};

// Die bis zu drei schlimmsten Momente, in Partiereihenfolge
export function reportMoments(moves: ReportMove[], max = 3): ReportMove[] {
    return moves
        .filter((m) => (SEVERITY[m.reaction] ?? 0) > 0 && m.sign)
        .sort((a, b) => (SEVERITY[b.reaction] ?? 0) - (SEVERITY[a.reaction] ?? 0) || a.ply - b.ply)
        .slice(0, max)
        .sort((a, b) => a.ply - b.ply);
}

// Zugnummer in Notation: Ply 1 -> "1.", Ply 2 -> "1..."
export function moveNumber(ply: number): string {
    const n = Math.ceil(ply / 2);
    return ply % 2 === 1 ? `${n}.` : `${n}...`;
}

export type LineStep = { san: string; fen: string; from: string; to: string };

// Die Folgevariante Zug für Zug (höchstens max Halbzüge), für das Brett im
// Erklärfenster. Bricht beim ersten ungültigen Zug ab.
export function lineSteps(fenAfter: string, line: string[], max = 4): LineStep[] {
    const setup = parseFen(fenAfter);
    if (setup.isErr) return [];
    const start = Chess.fromSetup(setup.value);
    if (start.isErr) return [];
    const pos = start.value;
    const out: LineStep[] = [];
    for (const san of line.slice(0, max)) {
        const move = parseSan(pos, san);
        if (!move || !("from" in move)) break;
        pos.play(move);
        out.push({
            san,
            fen: makeFen(pos.toSetup()),
            from: makeSquare(move.from),
            to: makeSquare(move.to),
        });
    }
    return out;
}

// Taktikmotiv in der Lösung des eigenen Fehlers (1.2.14): was der richtige Zug
// selbst macht. fen: Stellung vor dem Zug, san: der gefundene Zug, before:
// Bewertung vorher aus Sicht des Spielers, best: der beste Zug der Engine.
export type SolutionMotif = { id: Motif["id"]; square: string | null; mateIn: number | null };

export function solutionMotif(
    fen: string,
    san: string,
    before: string | undefined,
    best: string | undefined,
): SolutionMotif | null {
    const mate = before ? /^\+M(\d{1,2})$/.exec(before) : null;
    if (mate && san === best) return { id: "mate", square: null, mateIn: Number(mate[1]) };
    // Die Erkennung sieht den Zug als Antwort des Gegners: hier ist der
    // Spieler am Zug, also gehören die Ziele dem Gegner.
    const m = detectMotifs(fen, [san], null)[0];
    if (!m) return null;
    const square = m.id === "fork" ? (m.from ?? null) : (m.targets[0] ?? null);
    return { id: m.id, square, mateIn: null };
}

const MATERIAL: Record<string, number> = {
    pawn: 1,
    knight: 3,
    bishop: 3,
    rook: 5,
    queen: 9,
    king: 0,
};

// Wie viele Halbzüge einer Engine-Linie man sehen muss, bis ihr Punkt klar ist
// (1.2.34). Stichproben mit Stockfish: Fester Ausschnitt von 4 Halbzügen
// endete oft mitten im Abtausch oder zeigte bei ruhigen Fehlern vier
// beliebige Züge. Die Linie beginnt mit der Seite am Zug in fen.
// - Matt in der Linie: bis zum Matt.
// - Materialgewinn für die Seite am Zug: bis der Gewinn steht, und zwar
//   nach der Antwort der anderen Seite (kein Ende mitten im Abtausch).
// - Sonst ruhig: nur die ersten 2 Halbzüge, die Bewertung erklärt den Rest.
export type LinePoint = { plies: number; kind: "mate" | "material" | "quiet"; gain: number };

export function linePoint(fen: string, line: string[], max = 8): LinePoint {
    const setup = parseFen(fen);
    if (setup.isErr) return { plies: 0, kind: "quiet", gain: 0 };
    const start = Chess.fromSetup(setup.value);
    if (start.isErr) return { plies: 0, kind: "quiet", gain: 0 };
    const pos = start.value;
    const side = pos.turn;
    const material = () => {
        let s = 0;
        for (const [, p] of pos.board) s += (p.color === side ? 1 : -1) * MATERIAL[p.role];
        return s;
    };
    const trail = [material()];
    for (const san of line.slice(0, max)) {
        const move = parseSan(pos, san);
        if (!move) break;
        pos.play(move);
        trail.push(material());
        if (pos.isCheckmate()) return { plies: trail.length - 1, kind: "mate", gain: 0 };
    }
    let end = trail.length - 1;
    if (end === 0) return { plies: 0, kind: "quiet", gain: 0 };
    // Geht die Linie über den Ausschnitt hinaus, kann ein Schlagzug am Ende
    // noch zurückgeschlagen werden: dann zählt der Stand davor
    if (line.length > end || end >= max)
        while (end > 2 && (end % 2 === 1 || line[end - 1].includes("x"))) end--;
    const gain = trail[end] - trail[0];
    if (gain >= 1) {
        // Ab wann bleibt der Stand so? (nach jeder Antwort der anderen Seite
        // gleich), damit das Brett am Ende genau den genannten Gewinn zeigt
        let k = end;
        for (let j = end % 2 === 0 ? end - 2 : end - 1; j >= 2; j -= 2) {
            if (trail[j] !== trail[end]) break;
            k = j;
        }
        return { plies: k, kind: "material", gain };
    }
    return { plies: Math.min(2, end), kind: "quiet", gain: 0 };
}

// Erklärfenster: answer zeigt, was der Gegner jetzt macht, better, was
// richtig gewesen wäre
export type DeepView = "answer" | "better";

// Welche Ansicht zuerst? Die, in der man etwas Konkretes sieht (1.2.34):
// Matt geht vor (erst das zugelassene, dann das verpasste), dann Material
// (erst der eigene Verlust, dann der verpasste Gewinn), sonst die Antwort.
export function firstView(answer: LinePoint, better: LinePoint): DeepView {
    if (answer.kind === "mate") return "answer";
    if (better.kind === "mate") return "better";
    if (answer.kind !== "quiet") return "answer";
    if (better.kind !== "quiet") return "better";
    return "answer";
}
