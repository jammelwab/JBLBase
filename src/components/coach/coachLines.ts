import { atom } from "jotai";
import { Chess } from "chessops/chess";
import { INITIAL_FEN, makeFen, parseFen } from "chessops/fen";
import { parseSan } from "chessops/san";
import type { TreeNode } from "@/utils/treeReducer";
import { createNode, defaultTree } from "@/utils/treeReducer";
import type { DiaryGame } from "./coachDiary";

// Neue Linie mit JBL (1.2.17): ein Assistent statt der offenen Repertoire-Datei.
// Gewählt wird das Repertoire, JBL schlägt eine Stelle vor, auf dem Brett wird
// nur ausprobiert, und erst nach der Bestätigung kommt die Linie ins Repertoire.

// In welchem Tab der Assistent offen ist (null = zu)
export const coachLineWizardAtom = atom<string | null>(null);

export type LineColor = "white" | "black";

export type LineSuggestion =
    // JBL hat in deinen Partien hier etwas gespielt, worauf dein Repertoire keine Antwort hat
    | { kind: "gap"; moves: string[]; move: string; count: number }
    // Ein häufiger Zug des Gegners ohne Antwort im Repertoire
    | { kind: "common"; moves: string[]; move: string }
    // Eine Linie, die früh aufhört
    | { kind: "short"; moves: string[] }
    // Leeres Repertoire: der erste eigene Zug bzw. die erste Antwort
    | { kind: "start"; moves: string[] };

// Häufige Züge an den ersten Abzweigungen, nach dem Zugweg (SAN mit Leerzeichen).
// Nur die gängigsten Antworten, keine Theorie dahinter.
export const COMMON_MOVES: Record<string, string[]> = {
    "": ["e4", "d4", "c4", "Nf3"],
    e4: ["c5", "e5", "e6", "c6", "d5", "Nf6", "d6", "g6"],
    d4: ["Nf6", "d5", "e6", "f5", "g6", "c5"],
    c4: ["e5", "Nf6", "c5", "e6", "c6", "g6"],
    Nf3: ["d5", "Nf6", "c5", "g6"],
    "e4 e5": ["Nf3", "Bc4", "Nc3", "f4", "d4"],
    "e4 c5": ["Nf3", "Nc3", "c3", "d4", "f4"],
    "e4 e6": ["d4", "d3", "Nf3", "Nc3"],
    "e4 c6": ["d4", "Nc3", "d3", "Nf3"],
    "e4 d5": ["exd5", "e5", "Nc3"],
    "e4 Nf6": ["e5", "Nc3", "d3"],
    "d4 Nf6": ["c4", "Nf3", "Bg5", "Bf4"],
    "d4 d5": ["c4", "Nf3", "Bf4", "e3", "Bg5"],
    "c4 e5": ["Nc3", "g3", "Nf3"],
    "Nf3 d5": ["d4", "g3", "c4"],
    "e4 e5 Nf3": ["Nc6", "Nf6", "d6"],
    "e4 c5 Nf3": ["d6", "Nc6", "e6"],
    "d4 Nf6 c4": ["e6", "g6", "c5", "e5"],
    "d4 d5 c4": ["e6", "c6", "dxc4", "Nc6"],
};

// Wer zieht nach diesen Zügen?
export function moverAfter(moves: string[]): LineColor {
    return moves.length % 2 === 0 ? "white" : "black";
}

// Spielt die Züge von der Grundstellung; null, wenn einer nicht geht.
export function playLine(moves: string[]): { fen: string; fens: string[] } | null {
    const setup = parseFen(INITIAL_FEN);
    if (setup.isErr) return null;
    const start = Chess.fromSetup(setup.value);
    if (start.isErr) return null;
    const pos = start.value;
    const fens: string[] = [];
    for (const san of moves) {
        const move = parseSan(pos, san);
        if (!move) return null;
        pos.play(move);
        fens.push(makeFen(pos.toSetup()));
    }
    return { fen: makeFen(pos.toSetup()), fens };
}

// Der Knoten des Repertoires nach diesen Zügen (nur über die Züge, ohne Zugumstellung)
export function nodeAfter(root: TreeNode, moves: string[]): TreeNode | null {
    let node = root;
    for (const san of moves) {
        const next = node.children.find((c) => c.san === san);
        if (!next) return null;
        node = next;
    }
    return node;
}

// Wie viele Züge der Linie schon im Repertoire stehen (von vorne)
export function knownPrefix(root: TreeNode, moves: string[]): number {
    let node = root;
    let n = 0;
    for (const san of moves) {
        const next = node.children.find((c) => c.san === san);
        if (!next) break;
        node = next;
        n++;
    }
    return n;
}

// Die Linie als eigener kleiner Baum, für addLineToRepertoire
export function lineTree(moves: string[]): { root: TreeNode; path: number[] } | null {
    const played = playLine(moves);
    if (!played) return null;
    const root = defaultTree().root;
    const setup = parseFen(INITIAL_FEN);
    if (setup.isErr) return null;
    const start = Chess.fromSetup(setup.value);
    if (start.isErr) return null;
    const pos = start.value;
    let node = root;
    moves.forEach((san, i) => {
        const move = parseSan(pos, san)!;
        pos.play(move);
        const child = createNode({ fen: played.fens[i], move, san, halfMoves: i + 1 });
        node.children.push(child);
        node = child;
    });
    return { root, path: moves.map(() => 0) };
}

// Wo JBL in deinen Partien das Repertoire verlassen hat und du keine Antwort hattest
function diaryGaps(root: TreeNode, color: LineColor, diary: DiaryGame[]): LineSuggestion[] {
    const gaps = new Map<string, { moves: string[]; move: string; count: number }>();
    for (const game of diary) {
        if (game.color !== color) continue;
        let node = root;
        const moves: string[] = [];
        for (const m of game.moves) {
            const next = node.children.find((c) => c.san === m.s);
            const opponentToMove = moverAfter(moves) !== color;
            if (!next) {
                // Nur eine echte Lücke: der Gegner zieht, das Repertoire kennt die Stelle
                if (opponentToMove && node.children.length > 0) {
                    const key = [...moves, m.s].join(" ");
                    const gap = gaps.get(key) ?? { moves: [...moves], move: m.s, count: 0 };
                    gap.count++;
                    gaps.set(key, gap);
                }
                break;
            }
            moves.push(m.s);
            node = next;
        }
    }
    return [...gaps.values()].sort((a, b) => b.count - a.count).map((g) => ({ kind: "gap", ...g }));
}

// Häufige Gegnerzüge an den ersten Abzweigungen ohne Antwort
function commonGaps(root: TreeNode, color: LineColor): LineSuggestion[] {
    const out: LineSuggestion[] = [];
    for (const [key, replies] of Object.entries(COMMON_MOVES)) {
        const moves = key === "" ? [] : key.split(" ");
        if (moverAfter(moves) === color) continue;
        // Die Stelle muss im Repertoire vorkommen
        const node = nodeAfter(root, moves);
        if (!node) continue;
        for (const reply of replies) {
            if (node.children.some((c) => c.san === reply)) continue;
            if (!playLine([...moves, reply])) continue;
            out.push({ kind: "common", moves, move: reply });
            break;
        }
    }
    // Früher im Spiel zuerst
    return out.sort((a, b) => a.moves.length - b.moves.length);
}

// Linien, die schon nach wenigen Zügen aufhören
function shortLines(root: TreeNode, maxPly = 8): LineSuggestion[] {
    const out: { moves: string[] }[] = [];
    const walk = (node: TreeNode, moves: string[]) => {
        if (node.children.length === 0) {
            if (moves.length > 0 && moves.length < maxPly) out.push({ moves });
            return;
        }
        for (const child of node.children) if (child.san) walk(child, [...moves, child.san]);
    };
    walk(root, []);
    return out
        .sort((a, b) => a.moves.length - b.moves.length)
        .map((l) => ({ kind: "short", ...l }));
}

// JBLs Vorschläge für die nächste Linie, die besten zuerst
export function lineSuggestions(
    root: TreeNode,
    color: LineColor,
    diary: DiaryGame[],
    max = 4,
): LineSuggestion[] {
    if (root.children.length === 0) {
        // Leeres Repertoire: mit Weiß der erste Zug, mit Schwarz die Antwort auf 1.e4 und 1.d4
        return color === "white"
            ? [{ kind: "start", moves: [] }]
            : [
                  { kind: "start", moves: ["e4"] },
                  { kind: "start", moves: ["d4"] },
              ];
    }
    const seen = new Set<string>();
    const out: LineSuggestion[] = [];
    for (const s of [
        ...diaryGaps(root, color, diary),
        ...commonGaps(root, color),
        ...shortLines(root),
    ]) {
        const key = [...s.moves, "move" in s ? s.move : ""].join(" ");
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(s);
        if (out.length >= max) break;
    }
    return out;
}

// Die Züge, mit denen das Brett im Assistenten startet
export function suggestionStart(s: LineSuggestion): string[] {
    return "move" in s ? [...s.moves, s.move] : s.moves;
}

// Zugnummern für die Anzeige: „1. e4 c5 2. Nf3“
export function lineText(moves: string[], from = 0): string {
    return moves
        .map((san, i) => {
            const ply = from + i;
            if (ply % 2 === 0) return `${ply / 2 + 1}. ${san}`;
            return i === 0 ? `${Math.floor(ply / 2) + 1}... ${san}` : san;
        })
        .join(" ");
}
