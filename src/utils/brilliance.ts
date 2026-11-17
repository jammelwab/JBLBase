import { makeUci } from "chessops";
import type { BrillianceFind } from "@/bindings";
import type { LocalEngine } from "@/utils/engines";
import type { TreeNode } from "@/utils/treeReducer";

/** Prefers Patricia, the engine that likes to attack. */
export function pickBrillianceEngine(engines: LocalEngine[], saved: string): string {
    if (saved && engines.some((e) => e.id === saved)) return saved;
    const patricia = engines.find((e) => /patricia/i.test(e.name) || /patricia/i.test(e.path));
    return (patricia ?? engines[0])?.id ?? "";
}

/** "14...Nxf2" from the position before the move. */
export function numberedMove(fen: string, san: string): string {
    const parts = fen.split(" ");
    const turn = parts[1] ?? "w";
    const fullmove = Number.parseInt(parts[5] ?? "1", 10) || 1;
    return turn === "w" ? `${fullmove}.${san}` : `${fullmove}...${san}`;
}

/** Path from the start position in short notation: "1.e4 e5 2.Nf3". */
export function numberedLine(startFen: string, sans: string[]): string {
    const parts = startFen.split(" ");
    let white = (parts[1] ?? "w") === "w";
    let fullmove = Number.parseInt(parts[5] ?? "1", 10) || 1;
    const out: string[] = [];
    sans.forEach((san, i) => {
        if (white) out.push(`${fullmove}.${san}`);
        else out.push(i === 0 ? `${fullmove}...${san}` : san);
        if (!white) fullmove++;
        white = !white;
    });
    return out.join(" ");
}

// The variations below a node as UCI moves, at most `limit` of them
export function linesBelow(node: TreeNode, limit = 2000): string[][] {
    const lines: string[][] = [];
    const walk = (n: TreeNode, path: string[]) => {
        if (lines.length >= limit) return;
        if (n.children.length === 0) {
            if (path.length > 0) lines.push(path);
            return;
        }
        for (const child of n.children) {
            if (!child.move) continue;
            walk(child, [...path, makeUci(child.move)]);
        }
    };
    walk(node, []);
    return lines;
}

// The node a find's move would be, if the variation already has that move
export function existingMove(
    start: TreeNode,
    find: Pick<BrillianceFind, "pathUci" | "moveUci">,
): TreeNode | null {
    let node: TreeNode | undefined = start;
    for (const uci of [...find.pathUci, find.moveUci]) {
        node = node.children.find((c) => c.move && makeUci(c.move) === uci);
        if (!node) return null;
    }
    return node;
}
