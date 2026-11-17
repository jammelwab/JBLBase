import { describe, expect, test } from "vitest";
import {
    freeTarget,
    listTrash,
    parseTrashedName,
    purgeFromTrash,
    purgeOldTrash,
    restoreFromTrash,
    type TrashFs,
} from "./trash";

/** A folder tree in memory: path → content ("/" separators). */
function memoryFs(files: Record<string, string>) {
    const data = new Map(Object.entries(files));
    const fs: TrashFs = {
        async readDir(dir) {
            const prefix = `${dir}/`;
            const names = new Map<string, boolean>();
            for (const path of data.keys()) {
                if (!path.startsWith(prefix)) continue;
                const [first, ...rest] = path.slice(prefix.length).split("/");
                names.set(first, rest.length > 0 || names.get(first) === true);
            }
            if (names.size === 0) throw new Error(`no such folder ${dir}`);
            return [...names].map(([name, isDirectory]) => ({
                name,
                isDirectory,
                isFile: !isDirectory,
            }));
        },
        exists: async (path) => data.has(path),
        readTextFile: async (path) => {
            const text = data.get(path);
            if (text === undefined) throw new Error(`missing ${path}`);
            return text;
        },
        async rename(from, to) {
            const text = data.get(from);
            if (text === undefined) throw new Error(`missing ${from}`);
            data.delete(from);
            data.set(to, text);
        },
        remove: async (path) => {
            data.delete(path);
        },
        join: async (...parts) => parts.join("/"),
    };
    return { fs, data };
}

const DAY = 24 * 60 * 60 * 1000;

describe("trash", () => {
    test("recognises deleted repertoire files only", () => {
        expect(parseTrashedName("Ich Weiß.pgn.deleted-1700000000000")).toEqual({
            name: "Ich Weiß",
            deletedAt: 1700000000000,
        });
        expect(parseTrashedName("Ich Weiß.info.deleted-1700000000000")).toBeNull();
        expect(parseTrashedName("Ich Weiß.pgn")).toBeNull();
    });

    test("lists deleted repertoires in all folders, newest first, with their .info", async () => {
        const { fs } = memoryFs({
            "/docs/Weiß/Italienisch.pgn.deleted-100": "1. e4",
            "/docs/Weiß/Italienisch.info.deleted-100": '{"type":"repertoire","id":"r1"}',
            "/docs/Sizilianisch.pgn.deleted-200": "1. e4 c5",
            "/docs/Aktiv.pgn": "1. d4",
            "/docs/Aktiv.info": "{}",
        });
        const entries = await listTrash("/docs", fs);
        expect(entries.map((e) => e.name)).toEqual(["Sizilianisch", "Italienisch"]);
        expect(entries[1]).toMatchObject({
            original: "/docs/Weiß/Italienisch.pgn",
            suffix: ".deleted-100",
            info: { id: "r1" },
        });
        expect(entries[0].info).toBeNull();
    });

    test("restores .pgn, .info and history to their place", async () => {
        const { fs, data } = memoryFs({
            "/docs/A.pgn.deleted-5": "pgn",
            "/docs/A.info.deleted-5": '{"id":"r1"}',
            "/docs/A.history.json.deleted-5": "[]",
        });
        const [entry] = await listTrash("/docs", fs);
        expect(await restoreFromTrash(entry, fs)).toBe("/docs/A.pgn");
        expect([...data.keys()].sort()).toEqual([
            "/docs/A.history.json",
            "/docs/A.info",
            "/docs/A.pgn",
        ]);
        // The id stays, so training and cloud sync find it again.
        expect(data.get("/docs/A.info")).toBe('{"id":"r1"}');
    });

    test("restores under a new name when the old one is taken again", async () => {
        const { fs, data } = memoryFs({
            "/docs/A.pgn": "new",
            "/docs/A (2).pgn": "other",
            "/docs/A.pgn.deleted-5": "old",
            "/docs/A.info.deleted-5": "{}",
        });
        expect(await freeTarget("/docs/A.pgn", fs)).toBe("/docs/A (3).pgn");
        const [entry] = await listTrash("/docs", fs);
        await restoreFromTrash(entry, fs);
        expect(data.get("/docs/A (3).pgn")).toBe("old");
        expect(data.get("/docs/A (3).info")).toBe("{}");
        expect(data.get("/docs/A.pgn")).toBe("new");
    });

    test("removes one entry for good, with its companions", async () => {
        const { fs, data } = memoryFs({
            "/docs/A.pgn.deleted-5": "pgn",
            "/docs/A.info.deleted-5": "{}",
            "/docs/B.pgn": "keep",
        });
        const [entry] = await listTrash("/docs", fs);
        await purgeFromTrash(entry, fs);
        expect([...data.keys()]).toEqual(["/docs/B.pgn"]);
    });

    test("old entries are removed after the retention time, never with 0", async () => {
        const now = 100 * DAY;
        const files = {
            [`/docs/Alt.pgn.deleted-${now - 31 * DAY}`]: "x",
            [`/docs/Neu.pgn.deleted-${now - 2 * DAY}`]: "y",
        };
        const keep = memoryFs(files);
        expect(await purgeOldTrash("/docs", 0, now, keep.fs)).toBe(0);
        expect(keep.data.size).toBe(2);

        const { fs, data } = memoryFs(files);
        expect(await purgeOldTrash("/docs", 30, now, fs)).toBe(1);
        expect([...data.keys()]).toEqual([`/docs/Neu.pgn.deleted-${now - 2 * DAY}`]);
    });
});
