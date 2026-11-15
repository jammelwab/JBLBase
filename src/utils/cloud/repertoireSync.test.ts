import { describe, expect, it } from "vitest";
import { formatSyncCursor, parseSyncCursor } from "./cursor";
import {
    conflictPath,
    infoText,
    type LocalRepertoire,
    MAX_PGN_LENGTH,
    type PackedPgn,
    packPgn,
    parseRemoteRepertoire,
    planRepertoire,
    relativePath,
    type RemoteRepertoire,
    type RemoteState,
    type RepertoireSyncBackend,
    repertoireHash,
    syncRepertoires,
    unpackPgn,
} from "./repertoireSync";

const l = (hash: string, modifiedAt = 0) => ({ hash, modifiedAt });
const r = (hash: string, updatedAt = 0, deleted = false) => ({ hash, updatedAt, deleted });

describe("planRepertoire", () => {
    it("uploads new and locally changed repertoires", () => {
        expect(planRepertoire(l("a"), undefined, undefined).kind).toBe("push");
        expect(planRepertoire(l("b"), r("a"), "a").kind).toBe("push");
    });

    it("downloads new and remotely changed repertoires", () => {
        expect(planRepertoire(undefined, r("a"), undefined).kind).toBe("pull");
        expect(planRepertoire(l("a"), r("b"), "a").kind).toBe("pull");
    });

    it("does nothing when both sides agree", () => {
        expect(planRepertoire(l("a"), r("a"), "a").kind).toBe("none");
        expect(planRepertoire(l("a"), r("a"), undefined).kind).toBe("setBase");
        expect(planRepertoire(undefined, r("", 0, true), undefined).kind).toBe("none");
    });

    it("handles deletions", () => {
        expect(planRepertoire(undefined, r("a"), "a").kind).toBe("pushDelete");
        expect(planRepertoire(l("a"), r("", 0, true), "a").kind).toBe("deleteLocal");
        // Changed here after it was deleted elsewhere: keep it.
        expect(planRepertoire(l("b"), r("", 0, true), "a").kind).toBe("push");
    });

    it("lets the newer side win a conflict", () => {
        expect(planRepertoire(l("b", 20), r("c", 10), "a")).toEqual({
            kind: "conflict",
            winner: "local",
        });
        expect(planRepertoire(l("b", 10), r("c", 20), "a")).toEqual({
            kind: "conflict",
            winner: "remote",
        });
        expect(planRepertoire(l("b", 10), r("c", 20), undefined).kind).toBe("conflict");
    });
});

describe("cloud content", () => {
    it("keeps small files as text, which 1.0.28 can read", async () => {
        expect(await packPgn("1. e4")).toEqual({ pgn: "1. e4" });
    });

    it("compresses big files and reads them back", async () => {
        const text = "1. e4 e5 2. Nf3 { Spanisch } Nc6 ".repeat(40_000);
        const packed = await packPgn(text);
        expect(packed && "pgnGz" in packed).toBe(true);
        const doc = { path: "a", info: "{}", hash: "h", updatedAt: 1, deleted: false, ...packed };
        expect((await parseRemoteRepertoire("id", doc))?.pgn).toBe(text);
    });

    it("skips documents without content or with damaged content", async () => {
        const doc = { path: "a", info: "{}", hash: "h", updatedAt: 1 };
        expect(await parseRemoteRepertoire("id", doc)).toBeNull();
        expect(
            await parseRemoteRepertoire("id", { ...doc, pgnGz: new Uint8Array([1, 2, 3]) }),
        ).toBeNull();
        expect((await parseRemoteRepertoire("id", { ...doc, pgn: "" }))?.pgn).toBe("");
    });
});

describe("paths and hashes", () => {
    it("builds relative paths on every platform", () => {
        expect(
            relativePath("/home/x/Documents/JBL", "/home/x/Documents/JBL/a/Sizilianisch.pgn"),
        ).toBe("a/Sizilianisch");
        expect(relativePath("C:\\Users\\x\\JBL\\", "C:\\Users\\x\\JBL\\e4.pgn")).toBe("e4");
        expect(relativePath("/a/b", "/a/bc/x.pgn")).toBeNull();
    });

    it("ignores the id and key order of the info", () => {
        expect(infoText({ type: "repertoire", id: "x", tags: [] })).toBe(
            infoText({ tags: [], type: "repertoire", id: "y" }),
        );
    });

    it("hashes path, info and content", async () => {
        const a = await repertoireHash("a", "{}", "1. e4");
        expect(a).toMatch(/^[0-9a-f]{64}$/);
        expect(await repertoireHash("b", "{}", "1. e4")).not.toBe(a);
        expect(await repertoireHash("a", "{}", "1. d4")).not.toBe(a);
    });

    it("names conflict copies with the date", () => {
        expect(conflictPath("a/Weiß", new Date("2026-11-09T21:05:00Z"))).toBe(
            "a/Weiß (Konflikt 2026-11-09 21-05)",
        );
    });
});

/** One device's files and the shared cloud. */
class FakeCloud {
    docs = new Map<string, RemoteRepertoire & { syncedAt: number }>();
    /** Ids of documents stored compressed. */
    packed = new Set<string>();
    /** Documents read by queries (what Firestore bills). */
    reads = 0;
    clock = 1000;
    tick() {
        return ++this.clock;
    }
}

function withoutSyncedAt(d: RemoteRepertoire & { syncedAt: number }): RemoteRepertoire {
    const { syncedAt: _syncedAt, ...r } = d;
    return r;
}

class FakeDevice implements RepertoireSyncBackend {
    dir = "/docs";
    files = new Map<string, { info: Record<string, unknown>; pgn: string; modifiedAt: number }>();
    trash: string[] = [];
    renamed: [string, string][] = [];
    meta = new Map<string, string>();
    ids = 0;
    constructor(
        public cloud: FakeCloud,
        public name: string,
    ) {}
    file(
        path: string,
        pgn: string,
        info: Record<string, unknown> = { type: "repertoire", tags: [] },
    ) {
        this.files.set(path, { info, pgn, modifiedAt: this.cloud.tick() });
    }
    async listLocal(): Promise<LocalRepertoire[]> {
        // Like the app: only repertoires, no conflict copies
        return [...this.files]
            .filter(([, f]) => f.info.type === "repertoire")
            .map(([path, f]) => ({
                file: `${this.dir}/${path}.pgn`,
                path,
                info: f.info,
                pgn: f.pgn,
                modifiedAt: f.modifiedAt,
            }));
    }
    private pathOf(file: string) {
        return relativePath(this.dir, file)!;
    }
    async writeLocal(path: string, info: Record<string, unknown>, pgn: string) {
        this.files.set(path, { info, pgn, modifiedAt: this.cloud.tick() });
        return `${this.dir}/${path}.pgn`;
    }
    async moveLocal(file: string, path: string) {
        const from = this.pathOf(file);
        const f = this.files.get(from)!;
        this.files.delete(from);
        this.files.set(path, f);
        return `${this.dir}/${path}.pgn`;
    }
    async trashLocal(file: string) {
        const path = this.pathOf(file);
        this.files.delete(path);
        this.trash.push(path);
    }
    async setLocalInfo(file: string, info: Record<string, unknown>) {
        this.files.get(this.pathOf(file))!.info = info;
    }
    async renameDecks(from: string, to: string) {
        this.renamed.push([from, to]);
    }
    newId() {
        return `${this.name}-${++this.ids}`;
    }
    now() {
        return this.cloud.tick();
    }
    async fetchChanged(after: string | null) {
        // Ordered by (syncedAt, id) like the app; the fake's server time is in seconds.
        const start = parseSyncCursor(after);
        const docs = [...this.cloud.docs.values()]
            .filter(
                (d) =>
                    !start ||
                    d.syncedAt > start.seconds ||
                    (d.syncedAt === start.seconds && start.id !== "" && d.id > start.id),
            )
            .sort((a, b) => a.syncedAt - b.syncedAt || a.id.localeCompare(b.id));
        this.cloud.reads += docs.length;
        const last = docs.at(-1);
        return {
            items: docs.map(withoutSyncedAt),
            cursor: last ? formatSyncCursor(last.syncedAt, 0, last.id) : after,
        };
    }
    async fetchOne(id: string) {
        const d = this.cloud.docs.get(id);
        return d ? withoutSyncedAt(d) : null;
    }
    async put(id: string, state: RemoteState & PackedPgn) {
        const {
            pgn: _pgn,
            pgnGz: _pgnGz,
            ...rest
        } = state as RemoteState & {
            pgn?: string;
            pgnGz?: Uint8Array;
        };
        const pgn = (await unpackPgn(state))!;
        if ("pgnGz" in state) this.cloud.packed.add(id);
        else this.cloud.packed.delete(id);
        this.cloud.docs.set(id, { ...rest, pgn, id, syncedAt: this.cloud.tick() });
    }
    async metaGet(key: string) {
        return this.meta.get(key) ?? null;
    }
    async metaSet(key: string, value: string | null) {
        if (value === null) this.meta.delete(key);
        else this.meta.set(key, value);
    }
    pgn(path: string) {
        return this.files.get(path)?.pgn;
    }
}

describe("syncRepertoires", () => {
    it("brings a repertoire to a second device and keeps both in step", async () => {
        const cloud = new FakeCloud();
        const mac = new FakeDevice(cloud, "mac");
        const win = new FakeDevice(cloud, "win");
        mac.file("Weiß/e4", "1. e4 e5");

        expect((await syncRepertoires(mac, "u")).uploaded).toBe(1);
        expect((await syncRepertoires(win, "u")).downloaded).toBe(1);
        expect(win.pgn("Weiß/e4")).toBe("1. e4 e5");
        const id = mac.files.get("Weiß/e4")!.info.id;
        expect(win.files.get("Weiß/e4")!.info.id).toBe(id);

        win.file("Weiß/e4", "1. e4 e5 2. Nf3", win.files.get("Weiß/e4")!.info);
        expect((await syncRepertoires(win, "u")).uploaded).toBe(1);
        expect((await syncRepertoires(mac, "u")).downloaded).toBe(1);
        expect(mac.pgn("Weiß/e4")).toBe("1. e4 e5 2. Nf3");

        // Nothing changed: nothing moves.
        expect(await syncRepertoires(mac, "u")).toMatchObject({ uploaded: 0, downloaded: 0 });
    });

    it("links the same file on both devices by path and moves its training", async () => {
        const cloud = new FakeCloud();
        const mac = new FakeDevice(cloud, "mac");
        const win = new FakeDevice(cloud, "win");
        mac.file("Schwarz", "1. e4 c5", { type: "repertoire", tags: [], id: "mac-old" });
        win.file("Schwarz", "1. e4 c5", { type: "repertoire", tags: [], id: "win-old" });

        await syncRepertoires(mac, "u");
        const result = await syncRepertoires(win, "u");
        expect(result).toMatchObject({ uploaded: 0, downloaded: 0, conflicts: 0 });
        expect(win.files.get("Schwarz")!.info.id).toBe("mac-old");
        expect(win.renamed).toEqual([["win-old", "mac-old"]]);
    });

    it("keeps the losing side of a conflict as a copy", async () => {
        const cloud = new FakeCloud();
        const mac = new FakeDevice(cloud, "mac");
        const win = new FakeDevice(cloud, "win");
        mac.file("e4", "1. e4");
        await syncRepertoires(mac, "u");
        await syncRepertoires(win, "u");

        mac.file("e4", "1. e4 e5", mac.files.get("e4")!.info);
        win.file("e4", "1. e4 c5", win.files.get("e4")!.info);
        await syncRepertoires(mac, "u");
        const result = await syncRepertoires(win, "u");
        expect(result.conflicts).toBe(1);
        // The Windows change is newer and wins; the Mac version stays as a copy.
        const copy = [...win.files.keys()].find((p) => p.includes("Konflikt"))!;
        expect(win.pgn(copy)).toBe("1. e4 e5");
        expect(win.files.get(copy)!.info.type).toBe("other");
        expect(win.pgn("e4")).toBe("1. e4 c5");
        await syncRepertoires(mac, "u");
        expect(mac.pgn("e4")).toBe("1. e4 c5");
    });

    it("passes deletions on and does not bring them back", async () => {
        const cloud = new FakeCloud();
        const mac = new FakeDevice(cloud, "mac");
        const win = new FakeDevice(cloud, "win");
        mac.file("a", "1. d4");
        await syncRepertoires(mac, "u");
        await syncRepertoires(win, "u");

        mac.files.delete("a");
        await syncRepertoires(mac, "u");
        expect([...cloud.docs.values()][0].deleted).toBe(true);
        await syncRepertoires(win, "u");
        expect(win.files.has("a")).toBe(false);
        expect(win.trash).toEqual(["a"]);
        await syncRepertoires(mac, "u");
        expect(mac.files.has("a")).toBe(false);
    });

    it("holds deletions when most files are suddenly missing", async () => {
        const cloud = new FakeCloud();
        const mac = new FakeDevice(cloud, "mac");
        for (const p of ["a", "b", "c", "d"]) mac.file(p, p);
        await syncRepertoires(mac, "u");
        mac.files.clear();
        const result = await syncRepertoires(mac, "u");
        expect(result.deletionsHeld).toBe(true);
        expect([...cloud.docs.values()].some((d) => d.deleted)).toBe(false);
    });

    it("renames a file on the other device", async () => {
        const cloud = new FakeCloud();
        const mac = new FakeDevice(cloud, "mac");
        const win = new FakeDevice(cloud, "win");
        mac.file("alt", "1. c4");
        await syncRepertoires(mac, "u");
        await syncRepertoires(win, "u");
        const f = mac.files.get("alt")!;
        mac.files.delete("alt");
        mac.files.set("neu", { ...f, modifiedAt: cloud.tick() });
        await syncRepertoires(mac, "u");
        await syncRepertoires(win, "u");
        expect([...win.files.keys()]).toEqual(["neu"]);
        expect(win.pgn("neu")).toBe("1. c4");
    });

    it("uploads big files compressed (#100)", async () => {
        const cloud = new FakeCloud();
        const mac = new FakeDevice(cloud, "mac");
        const win = new FakeDevice(cloud, "win");
        const big = "1. e4 { Ein langer Kommentar mit Umlauten: äöü } e5 ".repeat(30_000);
        expect(big.length).toBeGreaterThan(MAX_PGN_LENGTH);
        mac.file("big", big);
        mac.file("small", "1. d4");
        const result = await syncRepertoires(mac, "u");
        expect(result.tooBig).toEqual([]);
        expect(cloud.docs.size).toBe(2);
        expect(cloud.packed.size).toBe(1);
        await syncRepertoires(win, "u");
        expect(win.pgn("big")).toBe(big);
        expect(win.pgn("small")).toBe("1. d4");
    });

    it("does not upload files that are too big even compressed", async () => {
        const cloud = new FakeCloud();
        const mac = new FakeDevice(cloud, "mac");
        // Random text barely compresses.
        let seed = 1;
        const random = Array.from({ length: 2_000_000 }, () => {
            seed = (seed * 48271) % 2147483647;
            return String.fromCharCode(33 + (seed % 90));
        }).join("");
        mac.file("big", random);
        const result = await syncRepertoires(mac, "u");
        expect(result.tooBig).toEqual(["big"]);
        expect(cloud.docs.size).toBe(0);
    });

    it("keeps one repertoire when two devices created the same one before syncing", async () => {
        const cloud = new FakeCloud();
        const mac = new FakeDevice(cloud, "mac");
        const win = new FakeDevice(cloud, "win");
        mac.file("Ich White", "1. e4");
        win.file("Ich White", "1. d4");
        // Both sync at the same time, neither sees the other's upload yet.
        await Promise.all([syncRepertoires(mac, "u"), syncRepertoires(win, "u")]);
        for (let i = 0; i < 3; i++) {
            await syncRepertoires(mac, "u");
            await syncRepertoires(win, "u");
        }
        const repertoires = (d: FakeDevice) =>
            [...d.files].filter(([, f]) => f.info.type === "repertoire").map(([p]) => p);
        expect(repertoires(mac)).toEqual(["Ich White"]);
        expect(repertoires(win)).toEqual(["Ich White"]);
        expect(mac.pgn("Ich White")).toBe(win.pgn("Ich White"));
        expect(mac.files.get("Ich White")!.info.id).toBe(win.files.get("Ich White")!.info.id);
        expect([...cloud.docs.values()].filter((d) => !d.deleted)).toHaveLength(1);
        // The other version is not lost.
        const copies = [...mac.files, ...win.files].filter(([p]) => p.includes("Konflikt"));
        expect(copies.map(([, f]) => f.pgn)).toContain(
            mac.pgn("Ich White") === "1. e4" ? "1. d4" : "1. e4",
        );
    });

    it("gives a copied file its own id", async () => {
        const cloud = new FakeCloud();
        const mac = new FakeDevice(cloud, "mac");
        const win = new FakeDevice(cloud, "win");
        mac.file("Ich White", "1. e4");
        await syncRepertoires(mac, "u");
        await syncRepertoires(win, "u");
        // e.g. a conflict copy of iCloud Drive, with the same .info
        mac.file("Ich White 2", "1. e4 e5", { ...mac.files.get("Ich White")!.info });
        await syncRepertoires(mac, "u");
        await syncRepertoires(win, "u");
        const id = mac.files.get("Ich White")!.info.id;
        expect(mac.files.get("Ich White 2")!.info.id).not.toBe(id);
        expect(win.files.get("Ich White")!.info.id).toBe(id);
        expect(win.pgn("Ich White")).toBe("1. e4");
        expect(win.pgn("Ich White 2")).toBe("1. e4 e5");
    });

    it("reads nothing again when nothing changed in the cloud (#99)", async () => {
        const cloud = new FakeCloud();
        const a = new FakeDevice(cloud, "a");
        const b = new FakeDevice(cloud, "b");
        for (let i = 0; i < 20; i++) a.file(`r${i}`, `1. e4 ${i}`);
        await syncRepertoires(a, "u");
        await syncRepertoires(b, "u");
        expect(b.files.size).toBe(20);

        // Its own uploads come back once, then nothing.
        cloud.reads = 0;
        await syncRepertoires(a, "u");
        expect(cloud.reads).toBe(20);
        for (const d of [a, b, a, b]) {
            cloud.reads = 0;
            await syncRepertoires(d, "u");
            expect(cloud.reads).toBe(0);
        }

        // A change is read once by each device.
        a.files.get("r3")!.pgn = "1. d4";
        await syncRepertoires(a, "u");
        cloud.reads = 0;
        await syncRepertoires(b, "u");
        expect(cloud.reads).toBe(1);
        expect(b.pgn("r3")).toBe("1. d4");
        cloud.reads = 0;
        await syncRepertoires(b, "u");
        expect(cloud.reads).toBe(0);
    });

    it("continues from a position stored by 1.0.28", async () => {
        const cloud = new FakeCloud();
        const a = new FakeDevice(cloud, "a");
        a.file("w", "1. e4");
        await syncRepertoires(a, "u");
        // Old format: milliseconds; the fake's seconds count as ms here.
        a.meta.set("repCursor:u", "5000");
        cloud.reads = 0;
        await syncRepertoires(a, "u");
        expect(a.meta.get("repCursor:u")).toMatch(/^\d+\.\d{9}\|/);
        cloud.reads = 0;
        await syncRepertoires(a, "u");
        expect(cloud.reads).toBe(0);
    });
});
