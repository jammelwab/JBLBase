import type { MoveCount } from "./repertoireTree";
import type { TreeNode } from "./treeReducer";

// Finds the gaps of a repertoire while it is being built. A gap is always an opponent move
// the repertoire has no answer for: in a white repertoire black moves, in a black one white
// moves. The user's own moves are their choice and never a gap.
// - "reply": a move the opponent often plays (by the Lichess database) that the repertoire
//   has no line for,
// - "extend": a line that ends after the user's move; the opponent's common answers there
//   show how it could go on. Lines have to end somewhere, so this is no hole, only a hint.
// Move 1 is left out: which first moves a repertoire covers (1.e4 only, or only 1...e5) is
// the user's choice, not something overlooked.
// Each gap gets an estimate how often a game gets there (`reach`): the share of the
// opponent's moves on the way, by Lichess; the user's own moves count fully.

export type RepertoireGap = {
    kind: "reply" | "extend";
    // Moves from the repertoire's start to the position of the gap
    line: string[];
    // Path of that position in the repertoire tree
    path: number[];
    fen: string;
    halfMoves: number;
    // "reply": the opponent move without a line and its Lichess share there
    move?: string;
    share?: number;
    // Estimated share of games that reach the gap (0..1); unknown shares count as 1
    reach: number;
    // Every opponent share on the way was known
    exact: boolean;
};

export type GapOptions = {
    color: "white" | "black";
    // Opponent moves played less often than this (0..1) are not a gap
    minShare: number;
    // Positions deeper than this many half-moves from the start are not looked at
    maxDepth: number;
};

export type GapScan = {
    gaps: RepertoireGap[];
    // Positions whose Lichess numbers would make the result more exact, most reached first
    wanted: { fen: string; reach: number }[];
    // Share of games (by the known numbers) that leave the repertoire at one of the gaps
    leaking: number;
};

function sideToMove(fen: string): "white" | "black" {
    return fen.split(" ")[1] === "b" ? "black" : "white";
}

// The move number of the FEN ("1" before 1.e4 and before 1...e5)
function moveNumber(fen: string): number {
    return Number(fen.split(" ")[5]) || 1;
}

export function findGaps(
    root: TreeNode,
    counts: Map<string, MoveCount[]>,
    options: GapOptions,
): GapScan {
    const gaps: RepertoireGap[] = [];
    const wanted: { fen: string; reach: number }[] = [];
    const walk = (
        node: TreeNode,
        line: string[],
        path: number[],
        reach: number,
        exact: boolean,
    ) => {
        if (line.length > options.maxDepth) return;
        const mine = sideToMove(node.fen) === options.color;
        const known = counts.get(node.fen);
        // The opponent's numbers are needed for the gaps and for how often a line is reached
        if (!known && !mine) wanted.push({ fen: node.fen, reach });

        if (mine) {
            node.children.forEach((child, i) =>
                walk(child, [...line, child.san ?? ""], [...path, i], reach, exact),
            );
            return;
        }

        // The opponent's turn
        const total = (known ?? []).reduce((sum, c) => sum + c.games, 0);
        const shareOf = (san: string) => {
            if (!known || total === 0) return undefined;
            return (known.find((c) => c.san === san)?.games ?? 0) / total;
        };
        if (known && total > 0 && moveNumber(node.fen) > 1) {
            for (const c of known) {
                const share = c.games / total;
                if (share < options.minShare) continue;
                if (node.children.some((child) => child.san === c.san)) continue;
                gaps.push({
                    kind: node.children.length === 0 && line.length > 0 ? "extend" : "reply",
                    line,
                    path,
                    fen: node.fen,
                    halfMoves: node.halfMoves,
                    move: c.san,
                    share,
                    reach: reach * share,
                    exact,
                });
            }
        }
        node.children.forEach((child, i) => {
            const share = shareOf(child.san ?? "");
            walk(
                child,
                [...line, child.san ?? ""],
                [...path, i],
                reach * (share ?? 1),
                exact && share !== undefined,
            );
        });
    };
    walk(root, [], [], 1, true);

    // Holes first; a line to extend counts half as much as a hole as often reached
    const weight = (g: RepertoireGap) => (g.kind === "extend" ? g.reach / 2 : g.reach);
    gaps.sort((a, b) => weight(b) - weight(a) || a.line.length - b.line.length);
    wanted.sort((a, b) => b.reach - a.reach);
    // The holes with known numbers all the way add up; where a line ends after the user's
    // move, the repertoire has done its job
    const leaking = Math.min(
        1,
        gaps.filter((g) => g.exact && g.kind !== "extend").reduce((sum, g) => sum + g.reach, 0),
    );
    return { gaps, wanted, leaking };
}

// The move most often played in a position, with its share, if there are games
export function mostPlayed(counts: MoveCount[] | undefined): { san: string; share: number } | null {
    const total = (counts ?? []).reduce((sum, c) => sum + c.games, 0);
    if (!counts || total === 0) return null;
    const best = counts.reduce((a, b) => (b.games > a.games ? b : a));
    return { san: best.san, share: best.games / total };
}
