import { resolve } from "@tauri-apps/api/path";
import { makeUci } from "chessops";
import { getPuzzlesDir } from "./directories";
import type { TreeNode } from "./treeReducer";

// The puzzle database the tactic search writes to. It sits next to the Lichess puzzles, so
// the puzzle trainer lists it by itself.
export const REPERTOIRE_TACTICS_FILE = "Repertoire-Taktiken.duckdb";

export const DEFAULT_TACTIC_DEPTH = 18;

export async function repertoireTacticsPath(): Promise<string> {
    return resolve(await getPuzzlesDir(), REPERTOIRE_TACTICS_FILE);
}

// Every line of a tree from the root to a leaf, as UCI moves.
export function linesOfTree(root: TreeNode): string[][] {
    const lines: string[][] = [];
    const stack: { node: TreeNode; line: string[] }[] = [{ node: root, line: [] }];
    while (stack.length > 0) {
        const { node, line } = stack.pop()!;
        const children = node.children.filter((child) => child.move);
        if (children.length === 0) {
            if (line.length > 0) lines.push(line);
            continue;
        }
        // Reversed, so that the main line comes off the stack first.
        for (let i = children.length - 1; i >= 0; i--) {
            stack.push({ node: children[i], line: [...line, makeUci(children[i].move!)] });
        }
    }
    return lines;
}
