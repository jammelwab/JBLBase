import { mergeSubtree } from "./repertoireTree";
import type { TreeNode } from "./treeReducer";

// Repertoires can sit in folders (e.g. "1.d4/London System"). The folder is a path with "/"
// between the levels and lives in the repertoire's .info file. Folders made in the app before
// anything is in them are kept in repertoire-folders.json (see StoredFolder).

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
    emptyFolders: string[] = [],
): FolderNode<T> {
    const root: FolderNode<T> = { name: "", path: "", items: [], children: [] };
    const nodeFor = (folder: string) => {
        let node = root;
        for (const part of normalizeFolder(folder).split("/").filter(Boolean)) {
            const path = node.path ? `${node.path}/${part}` : part;
            let child = node.children.find((c) => c.name.toLowerCase() === part.toLowerCase());
            if (!child) {
                child = { name: part, path, items: [], children: [] };
                node.children.push(child);
            }
            node = child;
        }
        return node;
    };
    for (const item of items) nodeFor(item.folder).items.push(item);
    for (const folder of emptyFolders) nodeFor(folder);
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

// A folder made in the app, kept even while it is empty. Folders belong to a player and a
// color like the repertoires in them.
export type StoredFolder = { owner: string; color: "white" | "black"; path: string };

export function parseStoredFolders(text: string): StoredFolder[] {
    try {
        const data = JSON.parse(text);
        if (!Array.isArray(data)) return [];
        return data
            .filter(
                (f) =>
                    f &&
                    typeof f.owner === "string" &&
                    (f.color === "white" || f.color === "black") &&
                    normalizeFolder(f.path),
            )
            .map((f) => ({ owner: f.owner, color: f.color, path: normalizeFolder(f.path) }));
    } catch {
        return [];
    }
}

const sameFolder = (a: string, b: string) =>
    normalizeFolder(a).toLowerCase() === normalizeFolder(b).toLowerCase();
const sameGroup = (a: StoredFolder, owner: string, color: string) =>
    a.owner.toLowerCase() === owner.toLowerCase() && a.color === color;

export function joinFolder(parent: string, name: string): string {
    return normalizeFolder(`${parent}/${name}`);
}

export function addStoredFolder(list: StoredFolder[], folder: StoredFolder): StoredFolder[] {
    const path = normalizeFolder(folder.path);
    if (!path) return list;
    if (list.some((f) => sameGroup(f, folder.owner, folder.color) && sameFolder(f.path, path))) {
        return list;
    }
    return [...list, { ...folder, path }];
}

// Removes a folder and the folders inside it
export function removeStoredFolder(
    list: StoredFolder[],
    owner: string,
    color: string,
    path: string,
): StoredFolder[] {
    return list.filter((f) => !(sameGroup(f, owner, color) && inFolder(f.path, path) && path));
}

// The new path of `folder` when the folder `from` is renamed or moved to `to`; folders
// outside `from` stay as they are.
export function renamedFolder(folder: string, from: string, to: string): string {
    const f = normalizeFolder(folder);
    const a = normalizeFolder(from);
    if (!a || !inFolder(f, a)) return f;
    return normalizeFolder(`${to}/${f.slice(a.length)}`);
}

export function renameStoredFolders(
    list: StoredFolder[],
    owner: string,
    color: string,
    from: string,
    to: string,
): StoredFolder[] {
    let out: StoredFolder[] = [];
    for (const f of list) {
        const path = sameGroup(f, owner, color) ? renamedFolder(f.path, from, to) : f.path;
        out = addStoredFolder(out, { ...f, path });
    }
    return out;
}

// A name that is not taken yet (case-insensitive): "Name", "Name (2)", "Name (3)" ...
export function uniqueName(name: string, taken: Set<string>): string {
    let candidate = name;
    for (let i = 2; taken.has(candidate.toLowerCase()); i++) candidate = `${name} (${i})`;
    taken.add(candidate.toLowerCase());
    return candidate;
}

// What a folder of PGN files on disk becomes: one repertoire per file, named after it, in a
// folder made of `target`, the folder's own name (when kept) and its subfolders.
export type FolderImportItem = { source: string; name: string; folder: string };

export function planFolderImport(
    files: { path: string; relative: string }[],
    dirs: string[],
    target: string,
    rootName: string | null,
): { items: FolderImportItem[]; folders: string[] } {
    const base = normalizeFolder(rootName ? `${target}/${rootName}` : target);
    const split = (relative: string) => relative.split(/[\\/]/).filter(Boolean);
    const items = files
        .filter((f) => /\.pgn$/i.test(f.relative))
        .map((f) => {
            const parts = split(f.relative);
            const file = parts.pop()!;
            return {
                source: f.path,
                name: file.replace(/\.pgn$/i, "").trim() || file,
                folder: normalizeFolder(`${base}/${parts.join("/")}`),
            };
        })
        .sort(
            (a, b) =>
                a.folder.localeCompare(b.folder, undefined, { numeric: true }) ||
                a.name.localeCompare(b.name, undefined, { numeric: true }),
        );
    const folders = [base, ...dirs.map((d) => normalizeFolder(`${base}/${split(d).join("/")}`))]
        .filter(Boolean)
        .filter((f, i, all) => all.findIndex((g) => sameFolder(f, g)) === i);
    return { items, folders };
}

// The main repertoire of a player and color ("Ich Weiß"): the one marked as main, otherwise
// the one at the top level named after the player and the color, as the page creates it.
// `aliases` are other names of the player (the main user was "Ich" before a name was set).
const COLOR_WORDS = {
    white: ["weiß", "weiss", "white"],
    black: ["schwarz", "black"],
} as const;

export type MainCandidate = {
    name: string;
    owner: string;
    color: "white" | "black";
    folder: string;
    main?: boolean;
};

export function isSameGroup(r: MainCandidate, owner: string, color: "white" | "black") {
    return r.owner.toLowerCase() === owner.toLowerCase() && r.color === color;
}

export function findMainRepertoire<T extends MainCandidate>(
    items: T[],
    owner: string,
    color: "white" | "black",
    aliases: string[] = [],
): T | undefined {
    const group = items.filter((r) => isSameGroup(r, owner, color));
    const names = [owner, ...aliases].map((n) => n.trim().toLowerCase());
    const named = (r: T) => {
        const name = r.name.trim().toLowerCase();
        return names.some((o) => COLOR_WORDS[color].some((c) => name === `${o} ${c}`));
    };
    return group.find((r) => r.main) ?? group.find((r) => !normalizeFolder(r.folder) && named(r));
}
