import type { TreeNode } from "./treeReducer";

// Line-by-line repertoire training (in the spirit of Chessable): the opponent's moves are
// played for you, your moves have to be found. Pure helpers, the UI is LineTrainer.tsx.

export const MOVE_SECONDS = 30;

// A line is the path (child indices) from the root to a leaf.
export type Line = number[];

export function buildLines(root: TreeNode, start: number[] = []): Line[] {
    const lines: Line[] = [];
    const walk = (node: TreeNode, path: number[]) => {
        if (node.children.length === 0) {
            if (path.length > start.length) lines.push(path);
            return;
        }
        node.children.forEach((child, i) => walk(child, [...path, i]));
    };
    let node = root;
    for (const i of start) node = node.children[i] ?? node;
    walk(node, [...start]);
    return lines;
}

export function sharedPrefix(a: number[], b: number[]): number {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return i;
}

export type SessionItem = {
    line: number;
    // Number of moves already on the board when the line starts
    startPly: number;
};

// Where a line starts: one move before it leaves the previous line, so moves you just played
// are not repeated from move 1 but you still see what changes.
export function startPlyAfter(previous: Line | null, line: Line, minPly = 0): number {
    if (!previous) return minPly;
    return Math.max(minPly, sharedPrefix(previous, line) - 1);
}

export function planSession(lines: Line[], include: (line: Line) => boolean, minPly = 0) {
    const items: SessionItem[] = [];
    let previous: Line | null = null;
    lines.forEach((line, index) => {
        if (!include(line)) return;
        items.push({ line: index, startPly: startPlyAfter(previous, line, minPly) });
        previous = line;
    });
    return items;
}

// A missed position comes back at the end of the session, one move before it.
export function repeatItem(line: number, missedPly: number, minPly = 0): SessionItem {
    return { line, startPly: Math.max(minPly, missedPly - 1) };
}

export function nodesOfLine(root: TreeNode, line: Line): TreeNode[] {
    const nodes = [root];
    let node = root;
    for (const i of line) {
        node = node.children[i];
        nodes.push(node);
    }
    return nodes;
}

// The moves of the side to move at `ply` (0 = position before the first move) that the
// repertoire also has, besides the one the line continues with.
export function alternatives(root: TreeNode, line: Line, ply: number): TreeNode[] {
    const node = nodesOfLine(root, line)[ply];
    const next = line[ply];
    return node.children.filter((_, i) => i !== next);
}

export function isUserTurn(node: TreeNode, color: "white" | "black") {
    return (node.halfMoves % 2 === 0) === (color === "white");
}
