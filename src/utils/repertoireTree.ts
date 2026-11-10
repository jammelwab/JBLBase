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
    // Counted from the repertoire, not from the source: a course chapter that starts from a
    // FEN often says "move 1" for a position the repertoire reaches at move 8
    child.halfMoves = parent.halfMoves + 1;
    parent.children.push(child);
    return { child, added: true };
}

export function mergeSubtree(target: TreeNode, source: TreeNode): number {
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
    const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
    // A new game starts with headers after an empty line, or (chapters pasted without
    // headers) with move 1 on a new line right after the result of the previous game.
    const gameStart = /\n[ \t]*\n(?=[ \t]*\[)|(?<=(?:\*|1-0|0-1|1\/2-1\/2))[ \t]*\n\s*(?=1\.)/;
    return normalized
        .split(gameStart)
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

// How much repertoire is behind every move: the lines (leaves) and moves below it, the move
// itself included. Keyed by the tree node.
export type RepertoireSize = { lines: number; moves: number };

export function repertoireSizes(root: TreeNode): Map<TreeNode, RepertoireSize> {
    const sizes = new Map<TreeNode, RepertoireSize>();
    const visit = (node: TreeNode): RepertoireSize => {
        let lines = 0;
        let moves = 0;
        for (const child of node.children) {
            const s = visit(child);
            lines += s.lines;
            moves += s.moves;
        }
        const size = { lines: Math.max(lines, 1), moves: moves + (node.san ? 1 : 0) };
        sizes.set(node, size);
        return size;
    };
    visit(root);
    return sizes;
}

// Position key -> lines behind each repertoire move from there, added up over all move
// orders that reach the position. Used to pick the main move of a position.
export function repertoireWeights(root: TreeNode): Map<string, Map<string, number>> {
    const sizes = repertoireSizes(root);
    const weights = new Map<string, Map<string, number>>();
    const stack = [root];
    while (stack.length > 0) {
        const node = stack.pop()!;
        if (node.children.length === 0) continue;
        const key = positionKey(node.fen);
        const moves = weights.get(key) ?? new Map<string, number>();
        for (const child of node.children) {
            if (child.san) {
                moves.set(child.san, (moves.get(child.san) ?? 0) + sizes.get(child)!.lines);
            }
            stack.push(child);
        }
        weights.set(key, moves);
    }
    return weights;
}

// The order the children of a node are shown in (indices into `children`): most first by
// `score`, ties keep the order of the file.
export function orderBy<T>(items: T[], score: (item: T) => number[]): number[] {
    const scores = items.map(score);
    return items
        .map((_, i) => i)
        .sort((a, b) => {
            for (let k = 0; k < scores[a].length; k++) {
                const d = (scores[b][k] ?? 0) - (scores[a][k] ?? 0);
                if (d !== 0) return d;
            }
            return a - b;
        });
}

// How far `line` (SAN moves from the root) follows the repertoire: the path of the moves
// that are in it, stopping at the first one that is not.
export function pathForLine(root: TreeNode, line: string[]): number[] {
    const path: number[] = [];
    let cur = root;
    for (const san of line) {
        const index = cur.children.findIndex((c) => c.san === san);
        if (index < 0) break;
        path.push(index);
        cur = cur.children[index];
    }
    return path;
}

// The shortest path to a position in the tree, reached by any move order, or null.
export function findPosition(root: TreeNode, fen: string): number[] | null {
    const key = positionKey(fen);
    const queue: { node: TreeNode; path: number[] }[] = [{ node: root, path: [] }];
    while (queue.length > 0) {
        const { node, path } = queue.shift()!;
        if (positionKey(node.fen) === key) return path;
        node.children.forEach((child, i) => queue.push({ node: child, path: [...path, i] }));
    }
    return null;
}

// The moves several repertoires have in one position, for a database-like table: per move
// the lines behind it (added up) and which repertoires have it. Most lines first.
export type RepertoireMoveRow = {
    move: string;
    lines: number;
    repertoires: { name: string; color: "white" | "black" }[];
};

export function repertoireMovesAt(
    sources: {
        name: string;
        color: "white" | "black";
        weights: Map<string, Map<string, number>>;
    }[],
    fen: string,
): RepertoireMoveRow[] {
    const key = positionKey(fen);
    const rows = new Map<string, RepertoireMoveRow>();
    for (const source of sources) {
        for (const [move, lines] of source.weights.get(key) ?? []) {
            const row = rows.get(move) ?? { move, lines: 0, repertoires: [] };
            row.lines += lines;
            row.repertoires.push({ name: source.name, color: source.color });
            rows.set(move, row);
        }
    }
    return [...rows.values()].sort((a, b) => b.lines - a.lines || a.move.localeCompare(b.move));
}

// How many moves of `source` the repertoire `target` doesn't have yet, counted from the
// position where `source` starts (0 if `target` never reaches it). Doesn't change anything.
export function missingMoves(target: TreeNode, source: TreeNode): number {
    const anchor = findAnchor(target, source.fen);
    if (!anchor) return 0;
    const count = (have: TreeNode | undefined, from: TreeNode): number => {
        let missing = 0;
        for (const child of from.children) {
            if (!child.san) continue;
            const match = have?.children.find((c) => c.san === child.san);
            if (!match) missing++;
            missing += count(match, child);
        }
        return missing;
    };
    return count(anchor, source);
}

// Adds every move of `source` to `target`, from the position where `source` starts.
// Returns the number of new moves, or null if `target` never reaches that position.
// Mutates `target`.
export function mergeTree(target: TreeNode, source: TreeNode): number | null {
    const anchor = findAnchor(target, source.fen);
    if (!anchor) return null;
    return mergeSubtree(anchor, source);
}

// The most played move of an explorer (Lichess, masters), if it has games
export function topMove(counts: MoveCount[] | undefined): string | undefined {
    let best: MoveCount | undefined;
    for (const c of counts ?? []) if (c.games > 0 && (!best || c.games > best.games)) best = c;
    return best?.san;
}

// Which moves of the repertoire table get a dot: the explorers' most played moves, but only
// where they differ from the repertoire move with the most lines (`moves[0]`). Explorer moves
// the repertoire doesn't have at all come back in `missing`, to be listed after the others.
export function explorerHints(
    moves: string[],
    tops: { lichess?: string; master?: string },
): { lichess?: string; master?: string; missing: string[] } {
    const differs = (move?: string) => (move && move !== moves[0] ? move : undefined);
    const lichess = differs(tops.lichess);
    const master = differs(tops.master);
    const missing = [...new Set([lichess, master].filter((m): m is string => !!m))].filter(
        (m) => !moves.includes(m),
    );
    return { lichess, master, missing };
}
