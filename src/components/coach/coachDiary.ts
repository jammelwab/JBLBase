import { makeUci, parseUci } from "chessops";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { atomWithStorage } from "jotai/utils";
import type { BookMove } from "@/bindings";
import type { TreeNode } from "@/utils/treeReducer";

// JBLs verborgenes Tagebuch über die Partien gegen ihn: die ersten Züge jeder
// Partie, wer sie gespielt hat, und welche eigenen Züge schlecht waren.
// Schlüssel ist die Stellung (EPD), nicht der Zugweg.

// So viele Halbzüge pro Partie merkt sich JBL
export const DIARY_PLIES = 30;
// So viele Partien
export const DIARY_GAMES = 200;

export type DiaryMove = {
    // Stellung vor dem Zug (die ersten vier FEN-Felder)
    e: string;
    // Zug als UCI und SAN
    u: string;
    s: string;
    // 1 = eigener Zug des Spielers
    h?: 1;
    // Bewertung des eigenen Zugs, falls auffällig ("?!", "?", "??")
    x?: string;
};

export type DiaryGame = {
    day: string;
    color: "white" | "black";
    result: "win" | "draw" | "loss";
    moves: DiaryMove[];
};

export const coachDiaryAtom = atomWithStorage<DiaryGame[]>("jbl-coach-diary", []);

// Die ersten vier FEN-Felder; en passant nur, wenn es wirklich geht (wie in
// der Partie-Engine), damit dieselbe Stellung denselben Schlüssel hat.
export function epdOf(fen: string): string {
    const setup = parseFen(fen);
    if (setup.isOk) {
        const pos = Chess.fromSetup(setup.value);
        if (pos.isOk) {
            const p = pos.value;
            const ep = p.epSquare !== undefined && hasLegalEp(p) ? p.epSquare : undefined;
            return makeFen({ ...p.toSetup(), epSquare: ep })
                .split(" ")
                .slice(0, 4)
                .join(" ");
        }
    }
    return fen.trim().split(/\s+/).slice(0, 4).join(" ");
}

function hasLegalEp(pos: Chess): boolean {
    if (pos.epSquare === undefined) return false;
    for (const [, dests] of pos.allDests()) if (dests.has(pos.epSquare)) return true;
    return false;
}

// Hauptlinie einer Partie als Tagebuch-Eintrag
export function diaryGame(
    root: TreeNode,
    color: "white" | "black",
    result: DiaryGame["result"],
    marks: Record<number, string>,
    day: string,
): DiaryGame {
    const moves: DiaryMove[] = [];
    let node = root;
    while (node.children.length > 0 && moves.length < DIARY_PLIES) {
        const child = node.children[0];
        if (!child.move) break;
        const mover = child.halfMoves % 2 === 1 ? "white" : "black";
        const m: DiaryMove = { e: epdOf(node.fen), u: makeUci(child.move), s: child.san ?? "" };
        if (mover === color) {
            m.h = 1;
            if (marks[child.halfMoves]) m.x = marks[child.halfMoves];
        }
        moves.push(m);
        node = child;
    }
    return { day, color, result, moves };
}

export function addToDiary(diary: readonly DiaryGame[], game: DiaryGame): DiaryGame[] {
    return [...diary, game].slice(-DIARY_GAMES);
}

const BAD = new Set(["?", "??"]);

// Zugbuch für die nächste Partie: JBL steuert in Linien, in denen der
// Spieler früher danebengegriffen hat. Nur JBLs eigene Züge auf dem Weg
// dorthin kommen ins Buch; weicht der Spieler ab, rechnet wieder Stockfish.
export function steeringBook(diary: readonly DiaryGame[], color: "white" | "black"): BookMove[] {
    const weights = new Map<string, number>();
    for (const g of diary) {
        if (g.color !== color) continue;
        const bad = g.moves.findIndex((m) => m.h && m.x && BAD.has(m.x));
        if (bad < 0) continue;
        for (const m of g.moves.slice(0, bad)) {
            if (m.h) continue;
            const key = `${m.e}|${m.u}`;
            weights.set(key, (weights.get(key) ?? 0) + 1);
        }
    }
    return [...weights].map(([key, w]) => {
        const [epd, uci] = key.split("|");
        return { epd, uci, weight: Math.min(50, w * 3) };
    });
}

// Wie oft der Spieler in den letzten Partien mit dieser Farbe denselben
// ersten Zug gespielt hat (nur Weiß), und JBLs übliche erste Antwort.
const FIRST_REPLIES: Record<string, string[]> = {
    e2e4: ["c7c5", "e7e5", "e7e6", "c7c6"],
    d2d4: ["d7d5", "g8f6", "e7e6"],
    c2c4: ["e7e5", "g8f6", "c7c5"],
    g1f3: ["d7d5", "g8f6", "c7c5"],
};
const FIRST_MOVES = ["e2e4", "d2d4", "c2c4", "g1f3"];
const START_EPD = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -";

export type VarietyPlan = { book: BookMove[]; announce: boolean };

// „Du spielst jedes Mal 1.e4. Heute probier ich mal was anderes.“
export function varietyBook(
    diary: readonly DiaryGame[],
    color: "white" | "black",
    rand: () => number = Math.random,
): VarietyPlan {
    const recent = diary.filter((g) => g.color === color && g.moves.length >= 2).slice(-3);
    if (recent.length < 3) return { book: [], announce: false };
    if (color === "white") {
        const first = recent[0].moves[0].u;
        const reply = recent[0].moves[1].u;
        const same = recent.every((g) => g.moves[0].u === first && g.moves[1].u === reply);
        const options = (FIRST_REPLIES[first] ?? []).filter((u) => u !== reply);
        if (!same || options.length === 0) return { book: [], announce: false };
        const pick = options[Math.floor(rand() * options.length)];
        return {
            book: [{ epd: afterMove(START_EPD, first), uci: pick, weight: 1 }],
            announce: true,
        };
    }
    const first = recent[0].moves[0].u;
    const same = recent.every((g) => g.moves[0].u === first);
    const options = FIRST_MOVES.filter((u) => u !== first);
    if (!same) return { book: [], announce: false };
    const pick = options[Math.floor(rand() * options.length)];
    return { book: [{ epd: START_EPD, uci: pick, weight: 1 }], announce: true };
}

function afterMove(epd: string, uci: string): string {
    const setup = parseFen(`${epd} 0 1`);
    if (!setup.isOk) return epd;
    const pos = Chess.fromSetup(setup.value);
    const move = parseUci(uci);
    if (!pos.isOk || !move) return epd;
    const p = pos.value;
    p.play(move);
    return epdOf(makeFen(p.toSetup()));
}

// Eröffnungs-Sparring: JBL spielt die Gegnerzüge aus dem Repertoire, gewichtet
// nach der Zahl der Linien dahinter.
export function repertoireBook(root: TreeNode, userColor: "white" | "black"): BookMove[] {
    const out: BookMove[] = [];
    const lines = (n: TreeNode): number =>
        n.children.length === 0 ? 1 : n.children.reduce((s, c) => s + lines(c), 0);
    const stack = [root];
    const seen = new Set<string>();
    while (stack.length > 0) {
        const node = stack.pop()!;
        const turn = node.halfMoves % 2 === 0 ? "white" : "black";
        const epd = epdOf(node.fen);
        for (const child of node.children) {
            stack.push(child);
            if (turn === userColor || !child.move) continue;
            const key = `${epd}|${makeUci(child.move)}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({ epd, uci: makeUci(child.move), weight: Math.min(1000, lines(child)) });
        }
    }
    return out;
}

// Stellungen aus dem Tagebuch, in denen der Spieler am Zug war und sein
// Repertoire nichts hat, mit der Zahl der Partien. Die häufigste zuerst.
export function diaryGaps(
    diary: readonly DiaryGame[],
    color: "white" | "black",
    repertoireIndex: Map<string, string[]> | null,
): { epd: string; count: number; line: string[] }[] {
    const counts = new Map<string, { count: number; line: string[] }>();
    for (const g of diary) {
        if (g.color !== color) continue;
        const line: string[] = [];
        for (const m of g.moves) {
            if (m.h) {
                const known = repertoireIndex?.get(m.e);
                if (!known || known.length === 0) {
                    const c = counts.get(m.e) ?? { count: 0, line: [...line] };
                    c.count++;
                    counts.set(m.e, c);
                    break;
                }
                if (!known.includes(m.s)) break;
            }
            line.push(m.s);
        }
    }
    return [...counts]
        .map(([epd, c]) => ({ epd, ...c }))
        .sort((a, b) => b.count - a.count || a.line.length - b.line.length);
}

// Stellung (EPD) -> Züge im Repertoire (SAN), mit denselben Schlüsseln wie das Tagebuch
export function epdIndex(root: TreeNode): Map<string, string[]> {
    const index = new Map<string, string[]>();
    const stack = [root];
    while (stack.length > 0) {
        const node = stack.pop()!;
        const key = epdOf(node.fen);
        const moves = index.get(key) ?? [];
        for (const child of node.children) {
            if (child.san && !moves.includes(child.san)) moves.push(child.san);
            stack.push(child);
        }
        index.set(key, moves);
    }
    return index;
}

export type RepertoireDeparture =
    // Der Spieler hat einen Zug gespielt, der nicht in seinem Repertoire steht
    | { kind: "own"; ply: number; played: string; expected: string[]; path: number[] }
    // JBL hat einen Zug gespielt, auf den das Repertoire keine Antwort hat;
    // `played` ist die Antwort des Spielers (falls es eine gab)
    | { kind: "gap"; ply: number; jbl: string; played: string | null; path: number[] };

// Wo die Partie das Repertoire verlassen hat (Hauptlinie ab `root`).
export function repertoireDeparture(
    root: TreeNode,
    humanColor: "white" | "black",
    index: Map<string, string[]>,
): RepertoireDeparture | null {
    let node = root;
    const path: number[] = [];
    if (!index.has(epdOf(root.fen))) return null;
    while (node.children.length > 0) {
        const child = node.children[0];
        const mover = child.halfMoves % 2 === 1 ? "white" : "black";
        const known = index.get(epdOf(node.fen));
        path.push(0);
        if (!known || known.length === 0) return null;
        if (!known.includes(child.san ?? "")) {
            if (mover === humanColor)
                return {
                    kind: "own",
                    ply: child.halfMoves,
                    played: child.san ?? "",
                    expected: known,
                    path: [...path],
                };
            const reply = child.children[0];
            return {
                kind: "gap",
                ply: child.halfMoves,
                jbl: child.san ?? "",
                played: reply?.san ?? null,
                path: reply ? [...path, 0] : [...path],
            };
        }
        node = child;
    }
    return null;
}
