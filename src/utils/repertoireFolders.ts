import { mergeSubtree } from "./repertoireTree";
import type { TreeNode } from "./treeReducer";

// Repertoires can sit in folders (e.g. "1.d4/London System"). The folder is a path with "/"
// between the levels and lives in the repertoire's .info file; a folder exists as long as a
// repertoire is in it.

export function normalizeFolder(folder: unknown): string {
    if (typeof folder !== "string") return "";
    return folder
        .split("/")
        .map((part) => part.trim())
        .filter(Boolean)
        .join("/");
}

export type FolderNode<T> = {
    name: string;
    path: string;
    items: T[];
    children: FolderNode<T>[];
};

export function buildFolderTree<T extends { folder: string; name: string }>(
    items: T[],
): FolderNode<T> {
    const root: FolderNode<T> = { name: "", path: "", items: [], children: [] };
    for (const item of items) {
        let node = root;
        for (const part of normalizeFolder(item.folder).split("/").filter(Boolean)) {
            const path = node.path ? `${node.path}/${part}` : part;
            let child = node.children.find((c) => c.name.toLowerCase() === part.toLowerCase());
            if (!child) {
                child = { name: part, path, items: [], children: [] };
                node.children.push(child);
            }
            node = child;
        }
        node.items.push(item);
    }
    const sort = (node: FolderNode<T>) => {
        node.children.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        node.items.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        node.children.forEach(sort);
    };
    sort(root);
    return root;
}

// Everything in a folder, including its subfolders
export function folderItems<T>(node: FolderNode<T>): T[] {
    return [...node.items, ...node.children.flatMap(folderItems)];
}

export function inFolder(itemFolder: string, folder: string): boolean {
    const a = normalizeFolder(itemFolder).toLowerCase();
    const b = normalizeFolder(folder).toLowerCase();
    return b === "" || a === b || a.startsWith(`${b}/`);
}

export function allFolders(items: { folder: string }[]): string[] {
    // Same folder in another spelling counts once, under the first spelling found
    const paths = new Map<string, string>();
    for (const item of items) {
        const parts = normalizeFolder(item.folder).split("/").filter(Boolean);
        for (let i = 1; i <= parts.length; i++) {
            const path = parts.slice(0, i).join("/");
            if (!paths.has(path.toLowerCase())) paths.set(path.toLowerCase(), path);
        }
    }
    return [...paths.values()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

// One tree with the moves of several repertoires, for looking at a whole folder at once.
// Repertoires that start from another position than the first are left out.
export function combineTrees(roots: TreeNode[]): TreeNode | null {
    if (roots.length === 0) return null;
    const start = roots[0];
    const combined: TreeNode = { ...start, children: [], shapes: [], annotations: [], comment: "" };
    for (const root of roots) {
        if (
            root.fen.split(" ").slice(0, 4).join(" ") !== start.fen.split(" ").slice(0, 4).join(" ")
        )
            continue;
        mergeSubtree(combined, root);
    }
    return combined;
}
