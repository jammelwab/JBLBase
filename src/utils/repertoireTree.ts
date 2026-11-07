import { createNode, type TreeNode } from "./treeReducer";

// Pure helpers for repertoire trees. File access lives in repertoires.ts.

// A position without move counters, so transpositions share one key.
export function positionKey(fen: string): string {
    return fen.trim().split(/\s+/).slice(0, 4).join(" ");
}

// The nodes from the root (exclusive) down to `path`.
export function nodesOnPath(root: TreeNode, path: number[]): TreeNode[] {
    const nodes: TreeNode[] = [];
    let cur = root;
    for (const index of path) {
        const next = cur.children[index];
        if (!next) break;
        nodes.push(next);
        cur = next;
    }
    return nodes;
}

function copyMove(source: TreeNode): TreeNode {
    const node = createNode({
        fen: source.fen,
        move: source.move!,
        san: source.san!,
        halfMoves: source.halfMoves,
    });
    // Glyphs and comments are worth keeping in a repertoire, clocks and evals are not.
    node.annotations = [...source.annotations];
    node.comment = source.comment;
    return node;
}

function addChild(parent: TreeNode, source: TreeNode): { child: TreeNode; added: boolean } {
    const existing = parent.children.find((c) => c.san === source.san);
    if (existing) return { child: existing, added: false };
    const child = copyMove(source);
    parent.children.push(child);
    return { child, added: true };
}

function mergeSubtree(target: TreeNode, source: TreeNode): number {
    let added = 0;
    for (const sourceChild of source.children) {
        const { child, added: isNew } = addChild(target, sourceChild);
        if (isNew) added++;
        added += mergeSubtree(child, sourceChild);
    }
    return added;
}

export type MergeResult =
    | { ok: true; added: number; path: number[] }
    | { ok: false; reason: "different-start" };

// Adds the line from the start of `source` down to `path` to the repertoire tree, reusing
// moves that are already there. With `withVariations`, the side variations that branch off
// along the line and everything after its last move are merged too. Mutates
// `repertoireRoot`.
export function mergeLine(
    repertoireRoot: TreeNode,
    source: TreeNode,
    path: number[],
    { withVariations = false }: { withVariations?: boolean } = {},
): MergeResult {
    if (positionKey(repertoireRoot.fen) !== positionKey(source.fen)) {
        return { ok: false, reason: "different-start" };
    }
    let added = 0;
    const targetPath: number[] = [];
    let cur = repertoireRoot;
    let sourceCur = source;
    for (const index of path) {
        const next = sourceCur.children[index];
        if (!next?.move || !next.san) break;
        // The line itself first, so it stays ahead of its side variations
        const { child, added: isNew } = addChild(cur, next);
        if (isNew) added++;
        if (withVariations) {
            for (const sibling of sourceCur.children) {
                if (sibling === next) continue;
                const { child: side, added: sideIsNew } = addChild(cur, sibling);
                if (sideIsNew) added++;
                added += mergeSubtree(side, sibling);
            }
        }
        targetPath.push(cur.children.indexOf(child));
        cur = child;
        sourceCur = next;
    }
    if (withVariations) {
        added += mergeSubtree(cur, sourceCur);
    }
    return { ok: true, added, path: targetPath };
}

// Position key -> moves the repertoire plays (or expects) from there. Every position of the
// tree is a key, leaves map to an empty list.
export function indexRepertoire(root: TreeNode): Map<string, string[]> {
    const index = new Map<string, string[]>();
    const stack = [root];
    while (stack.length > 0) {
        const node = stack.pop()!;
        const key = positionKey(node.fen);
        const moves = index.get(key) ?? [];
        for (const child of node.children) {
            if (child.san && !moves.includes(child.san)) moves.push(child.san);
            stack.push(child);
        }
        index.set(key, moves);
    }
    return index;
}

export function repertoireStats(root: TreeNode) {
    let moves = 0;
    let leaves = 0;
    let depth = 0;
    const stack: { node: TreeNode; ply: number }[] = [{ node: root, ply: 0 }];
    while (stack.length > 0) {
        const { node, ply } = stack.pop()!;
        if (ply > depth) depth = ply;
        if (node.children.length === 0 && ply > 0) leaves++;
        for (const child of node.children) {
            moves++;
            stack.push({ node: child, ply: ply + 1 });
        }
    }
    return { moves, leaves, depth };
}
