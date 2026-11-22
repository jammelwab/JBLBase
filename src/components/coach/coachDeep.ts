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
};

export function motifsFor(c: DeepFacts): Motif[] {
    return detectMotifs(c.fenAfter, c.line, mateInFromEval(c.after));
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
