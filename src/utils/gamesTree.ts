import { makeFen } from "chessops/fen";
import { makeSquare, parseSquare } from "chessops";
import { normalizeMove } from "chessops/chess";
import { chessgroundDests } from "chessops/compat";
import { makeSan, parseSan } from "chessops/san";
import { positionFromFen } from "./chessops";
import { positionKey } from "./repertoireTree";
import { createNode, defaultTree, type TreeNode } from "./treeReducer";

// Your own games as an opening tree, compared with a repertoire. Only moves played at least
// `minGames` times count, so one-off games don't clutter the tree.

export type MoveStat = { san: string; games: number; white: number; draw: number; black: number };

// How a move from your games relates to the repertoire:
// book: the repertoire has it; deviation: you played something else than prepared;
// surprise: the opponent played something you are not prepared for; end: the repertoire
// stops before this move; outside: the game already left the repertoire earlier.
export type GameMoveStatus = "book" | "deviation" | "surprise" | "end" | "outside";

export function moveStatus(
    repertoireMoves: string[] | undefined,
    san: string,
    mine: boolean,
): GameMoveStatus {
    if (repertoireMoves === undefined) return "outside";
    if (repertoireMoves.length === 0) return "end";
    if (repertoireMoves.includes(san)) return "book";
    return mine ? "deviation" : "surprise";
}

export type GameNode = {
    fen: string;
    san: string;
    halfMoves: number;
    // Moves from the start, in SAN
    line: string[];
    games: number;
    // Your score in these games, 0..1
    score: number;
    status: GameMoveStatus;
};

export function scoreFor(stat: MoveStat, color: "white" | "black") {
    const won = color === "white" ? stat.white : stat.black;
    return stat.games > 0 ? (won + stat.draw / 2) / stat.games : 0;
}

export function childNodes(
    parent: { fen: string; halfMoves: number; line: string[] },
    stats: MoveStat[],
    color: "white" | "black",
    index: Map<string, string[]>,
    minGames: number,
): GameNode[] {
    const [pos] = positionFromFen(parent.fen);
    if (!pos) return [];
    const mine = (parent.halfMoves % 2 === 0) === (color === "white");
    const repertoireMoves = index.get(positionKey(parent.fen));
    return stats
        .filter((s) => s.games >= minGames)
        .sort((a, b) => b.games - a.games)
        .flatMap((s) => {
            const child = pos.clone();
            const move = parseSan(child, s.san);
            if (!move) return [];
            child.play(move);
            return [
                {
                    fen: makeFen(child.toSetup()),
                    san: s.san,
                    halfMoves: parent.halfMoves + 1,
                    line: [...parent.line, s.san],
                    games: s.games,
                    score: scoreFor(s, color),
                    status: moveStatus(repertoireMoves, s.san, mine),
                },
            ];
        });
}

export type Issue = GameNode & { kind: "deviation" | "surprise" | "end" };

// Walks the part of your games that is still inside the repertoire and collects every
// place where a game left it.
export async function collectIssues(
    rootFen: string,
    rootHalfMoves: number,
    color: "white" | "black",
    index: Map<string, string[]>,
    stats: (fen: string) => Promise<MoveStat[]>,
    { minGames = 2, maxPositions = 400 } = {},
): Promise<Issue[]> {
    const issues: Issue[] = [];
    const queue = [{ fen: rootFen, halfMoves: rootHalfMoves, line: [] as string[] }];
    // A position reached by two move orders has the same games behind it, so it is walked
    // (and its issues are listed) only once, under the first move order found.
    const seen = new Set([positionKey(rootFen)]);
    const reported = new Set<string>();
    let visited = 0;
    while (queue.length > 0 && visited < maxPositions) {
        const parent = queue.shift()!;
        visited++;
        for (const node of childNodes(parent, await stats(parent.fen), color, index, minGames)) {
            const key = positionKey(node.fen);
            if (node.status === "book") {
                if (!seen.has(key)) {
                    seen.add(key);
                    queue.push(node);
                }
            } else if (node.status !== "outside") {
                const issueKey = `${positionKey(parent.fen)} ${node.san}`;
                if (reported.has(issueKey)) continue;
                reported.add(issueKey);
                issues.push({ ...node, kind: node.status });
            }
        }
    }
    return issues.sort((a, b) => b.games - a.games);
}

export function lineText(line: string[], startHalfMoves = 0, ellipsis = "…"): string {
    return line
        .map((san, i) => {
            const half = startHalfMoves + i + 1;
            const number = Math.ceil(half / 2);
            if (half % 2 === 1) return `${number}. ${san}`;
            return i === 0 ? `${number}${ellipsis} ${san}` : san;
        })
        .join(" ");
}

// The position after playing `line` from `rootFen`, with the last move for highlighting.
export function playLine(
    rootFen: string,
    line: string[],
): { fen: string; lastMove: [string, string] | null } {
    const [pos] = positionFromFen(rootFen);
    if (!pos) return { fen: rootFen, lastMove: null };
    let lastMove: [string, string] | null = null;
    for (const san of line) {
        const move = parseSan(pos, san);
        if (!move) break;
        if ("from" in move) lastMove = [makeSquare(move.from), makeSquare(move.to)];
        pos.play(move);
    }
    return { fen: makeFen(pos.toSetup()), lastMove };
}

// From- and to-square of a SAN move in a position, for drawing an arrow.
export function sanToSquares(fen: string, san: string): [string, string] | null {
    const [pos] = positionFromFen(fen);
    if (!pos) return null;
    const move = parseSan(pos, san);
    if (!move || !("from" in move)) return null;
    // chessops writes castling as king takes rook; the arrow should end on the king's square
    if (
        pos.board.get(move.from)?.role === "king" &&
        Math.abs(move.to - move.from) !== 1 &&
        pos.board.get(move.to)?.role === "rook" &&
        pos.board.get(move.to)?.color === pos.turn
    ) {
        const kingTo = move.to > move.from ? move.from + 2 : move.from - 2;
        return [makeSquare(move.from), makeSquare(kingTo)];
    }
    return [makeSquare(move.from), makeSquare(move.to)];
}

// For a playable board: whose turn it is and where every piece may go.
export function boardMoves(fen: string): {
    turn: "white" | "black";
    dests: Map<string, string[]>;
} {
    const [pos] = positionFromFen(fen);
    if (!pos) return { turn: "white", dests: new Map() };
    return { turn: pos.turn, dests: chessgroundDests(pos) as Map<string, string[]> };
}

// The SAN of a move dragged on the board (castling either way, promotion to a queen).
export function squaresToSan(fen: string, orig: string, dest: string): string | null {
    const [pos] = positionFromFen(fen);
    const from = parseSquare(orig);
    const to = parseSquare(dest);
    if (!pos || from === undefined || to === undefined) return null;
    const piece = pos.board.get(from);
    const promotes =
        piece?.role === "pawn" && (dest[1] === "8" || dest[1] === "1") ? "queen" : undefined;
    const move = normalizeMove(pos, { from, to, promotion: promotes });
    if (!pos.isLegal(move)) return null;
    return makeSan(pos, move);
}

// A tree that is only `line`, from `rootFen`, e.g. to add it to a repertoire.
export function lineTree(rootFen: string, rootHalfMoves: number, line: string[]): TreeNode {
    const root = defaultTree(rootFen).root;
    root.halfMoves = rootHalfMoves;
    const [pos] = positionFromFen(rootFen);
    if (!pos) return root;
    let cur = root;
    for (const san of line) {
        const move = parseSan(pos, san);
        if (!move) break;
        const sanText = makeSan(pos, move);
        pos.play(move);
        const child = createNode({
            fen: makeFen(pos.toSetup()),
            move,
            san: sanText,
            halfMoves: cur.halfMoves + 1,
        });
        cur.children.push(child);
        cur = child;
    }
    return root;
}
