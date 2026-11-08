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

export type MoveCount = { san: string; games: number };

export type MoveShares = {
    total: number;
    // Share (0..1) of each repertoire move, in the order given
    shares: Map<string, number>;
    // Share of the moves that are not in the repertoire
    other: number;
    // The most played move, when the repertoire does not have it
    topMissing: { san: string; share: number } | null;
};

// How the games from a position split over the repertoire's moves. The repertoire moves and
// `other` add up to 100 %.
export function moveShares(counts: MoveCount[], repertoireMoves: string[]): MoveShares {
    const total = counts.reduce((acc, c) => acc + c.games, 0);
    const shares = new Map<string, number>();
    let covered = 0;
    for (const san of repertoireMoves) {
        const games = counts.find((c) => c.san === san)?.games ?? 0;
        shares.set(san, total > 0 ? games / total : 0);
        covered += games;
    }
    const top = counts.reduce<MoveCount | null>(
        (best, c) => (best === null || c.games > best.games ? c : best),
        null,
    );
    const topMissing =
        top && total > 0 && top.games > 0 && !repertoireMoves.includes(top.san)
            ? { san: top.san, share: top.games / total }
            : null;
    return { total, shares, other: total > 0 ? (total - covered) / total : 0, topMissing };
}

// ---------------------------------------------------------------------------
// Importing a course (one or more PGN chapters) into a repertoire

export type CourseChapter = {
    name: string;
    root: TreeNode;
    // Written in front of the comment of the first new move of every new branch
    note?: string;
};

// A position where the repertoire already plays a move for its own side and the course
// recommends a different one there.
export type CourseConflict = {
    // positionKey + "|" + course move; stable between the preview and the actual import
    key: string;
    fen: string;
    chapter: string;
    // The course moves that lead to the position
    line: string[];
    halfMoves: number;
    courseMove: string;
    repertoireMoves: string[];
};

// skip: keep the repertoire as it is and leave out the course line from here
// alternative: add the course move next to the repertoire's move
// main: add the course move and make it the first choice
export type ConflictChoice = "skip" | "alternative" | "main";

function conflictKey(fen: string, san: string) {
    return `${positionKey(fen)}|${san}`;
}

function sideToMove(fen: string): "white" | "black" {
    return fen.trim().split(/\s+/)[1] === "b" ? "black" : "white";
}

// Splits text with one or more PGN games into games. A game starts with a header line
// ("[Tag ...]") at the start of the text or after an empty line.
export function splitPgnGames(text: string): string[] {
    const normalized = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
    return normalized
        .split(/\n[ \t]*\n(?=[ \t]*\[)/)
        .map((game) => game.trim())
        .filter((game) => game.length > 0);
}

// Where a chapter can be attached in the repertoire: the shallowest node with the chapter's
// start position. Chapters from the normal start always fit a repertoire from the normal
// start; chapters from a later position fit once the repertoire reaches that position.
export function findAnchor(repertoireRoot: TreeNode, fen: string): TreeNode | null {
    const key = positionKey(fen);
    const queue = [repertoireRoot];
    for (let i = 0; i < queue.length; i++) {
        const node = queue[i];
        if (positionKey(node.fen) === key) return node;
        queue.push(...node.children);
    }
    return null;
}

// Conflicts between a course and the repertoire, in course order. Lines the user chose to
// skip are not followed, so conflicts behind them don't show up.
export function findCourseConflicts(
    repertoireRoot: TreeNode,
    chapters: CourseChapter[],
    color: "white" | "black",
    choices: Map<string, ConflictChoice> = new Map(),
): CourseConflict[] {
    const index = indexRepertoire(repertoireRoot);
    const found = new Map<string, CourseConflict>();
    for (const chapter of chapters) {
        if (!findAnchor(repertoireRoot, chapter.root.fen)) continue;
        const walk = (node: TreeNode, line: string[]) => {
            const ownMove = sideToMove(node.fen) === color;
            const repertoireMoves = index.get(positionKey(node.fen)) ?? [];
            for (const child of node.children) {
                if (!child.san) continue;
                if (ownMove && repertoireMoves.length > 0 && !repertoireMoves.includes(child.san)) {
                    const key = conflictKey(node.fen, child.san);
                    if (!found.has(key)) {
                        found.set(key, {
                            key,
                            fen: node.fen,
                            chapter: chapter.name,
                            line,
                            halfMoves: node.halfMoves,
                            courseMove: child.san,
                            repertoireMoves,
                        });
                    }
                    if ((choices.get(key) ?? "skip") === "skip") continue;
                }
                walk(child, [...line, child.san]);
            }
        };
        walk(chapter.root, []);
    }
    return [...found.values()];
}

export type CourseMergeResult = {
    added: number;
    // Chapters whose start position the repertoire doesn't reach
    unplaced: string[];
};

// Merges the chapters into the repertoire tree. Moves already there are reused, conflicts are
// resolved with `choices` (default: skip), and the first new move of every new branch gets the
// chapter's note (or `note`) in front of its comment, so you can see later where a line came
// from. Mutates
// `repertoireRoot`.
export function mergeCourse(
    repertoireRoot: TreeNode,
    chapters: CourseChapter[],
    color: "white" | "black",
    choices: Map<string, ConflictChoice>,
    note = "",
): CourseMergeResult {
    // Conflicts are judged against the repertoire before the import, so a chapter can't turn
    // the next chapter's moves into conflicts.
    const index = indexRepertoire(repertoireRoot);
    let added = 0;
    const unplaced: string[] = [];

    const merge = (target: TreeNode, source: TreeNode, insideNew: boolean, note: string) => {
        const ownMove = sideToMove(source.fen) === color;
        const repertoireMoves = index.get(positionKey(source.fen)) ?? [];
        for (const sourceChild of source.children) {
            if (!sourceChild.move || !sourceChild.san) continue;
            const isConflict =
                ownMove && repertoireMoves.length > 0 && !repertoireMoves.includes(sourceChild.san);
            const choice = isConflict
                ? (choices.get(conflictKey(source.fen, sourceChild.san)) ?? "skip")
                : null;
            if (choice === "skip") continue;
            const { child, added: isNew } = addChild(target, sourceChild);
            if (isNew) {
                added++;
                if (!insideNew && note) {
                    child.comment = child.comment ? `${note}\n${child.comment}` : note;
                }
            }
            if (choice === "main") {
                target.children.splice(target.children.indexOf(child), 1);
                target.children.unshift(child);
            }
            merge(child, sourceChild, insideNew || isNew, note);
        }
    };

    for (const chapter of chapters) {
        const anchor = findAnchor(repertoireRoot, chapter.root.fen);
        if (!anchor) {
            unplaced.push(chapter.name);
            continue;
        }
        merge(anchor, chapter.root, false, chapter.note ?? note);
    }
    return { added, unplaced };
}
