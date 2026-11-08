import { makeFen } from "chessops/fen";
import { parseSan } from "chessops/san";
import { positionFromFen } from "./chessops";
import { positionKey } from "./repertoireTree";

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
