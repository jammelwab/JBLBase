import { describe, expect, it } from "vitest";
import { type LocalSharedFile, safeFileName, type ShareSyncBackend, syncShares } from "./shareSync";
import {
    ownRecipientKeys,
    parseRecipient,
    recipientLabel,
    type Share,
    type ShareWithPgn,
    shareHash,
} from "./shares";

function share(over: Partial<ShareWithPgn> = {}): ShareWithPgn {
    return {
        id: "s1",
        ownerUid: "jannick",
        ownerName: "Jannick",
        recipientKey: "lichess:aaron",
        sourceId: "rep1",
        name: "Aaron Weiß",
        color: "white",
        hash: "",
        status: "accepted",
        recipientUid: "aaron",
        pgn: "1. e4 *",
        ...over,
    };
}

function backend(over: Partial<ShareSyncBackend> = {}) {
    const calls: string[] = [];
    const b: ShareSyncBackend = {
        uid: "aaron",
        ownerName: "Jannick",
        listOwn: async () => [],
        listIncoming: async () => [],
        update: async (id) => void calls.push(`update ${id}`),
        ownRepertoires: async () => [],
        sharedFiles: async () => [],
        writeShared: async (s, f) => void calls.push(`write ${s.id} ${f ? "over" : "new"}`),
        markEnded: async (f) => void calls.push(`end ${f.shared.id}`),
        ...over,
    };
    return { b, calls };
}

describe("parseRecipient", () => {
    it("takes e-mail addresses and Lichess names", () => {
        expect(parseRecipient(" Aaron@Example.org ")).toBe("email:aaron@example.org");
        expect(parseRecipient("Aaron_2010")).toBe("lichess:aaron_2010");
        expect(parseRecipient("lichess:Aaron")).toBe("lichess:aaron");
        expect(parseRecipient("not an address")).toBeNull();
        expect(parseRecipient("a@b")).toBeNull();
        expect(parseRecipient("")).toBeNull();
    });

    it("shows them readably", () => {
        expect(recipientLabel("email:a@b.de")).toBe("a@b.de");
        expect(recipientLabel("lichess:aaron")).toBe("Lichess: aaron");
    });

    it("knows the keys of the signed-in account", () => {
        expect(
            ownRecipientKeys({
                email: "A@B.de",
                emailVerified: true,
                method: "email",
                displayName: null,
            }),
        ).toEqual(["email:a@b.de"]);
        expect(
            ownRecipientKeys({
                email: "A@B.de",
                emailVerified: false,
                method: "email",
                displayName: null,
            }),
        ).toEqual([]);
        expect(
            ownRecipientKeys({
                email: null,
                emailVerified: false,
                method: "lichess",
                displayName: "Aaron",
            }),
        ).toEqual(["lichess:aaron"]);
    });
});

describe("syncShares", () => {
    it("sends a new version only when the repertoire changed", async () => {
        const pgn = "1. e4 e5 *";
        const unchanged: Share = { ...share(), hash: await shareHash("Aaron Weiß", "white", pgn) };
        const changed: Share = { ...share({ id: "s2", sourceId: "rep2" }), hash: "old" };
        const gone: Share = { ...share({ id: "s3", sourceId: "rep3" }), hash: "old" };
        const { b, calls } = backend({
            listOwn: async () => [unchanged, changed, gone],
            ownRepertoires: async () => [
                { id: "rep1", name: "Aaron Weiß", color: "white", pgn },
                { id: "rep2", name: "Aaron Schwarz", color: "black", pgn },
            ],
        });
        const result = await syncShares(b);
        expect(calls).toEqual(["update s2"]);
        expect(result.sent).toBe(1);
    });

    it("keeps the files of accepted shares up to date", async () => {
        const files: LocalSharedFile[] = [
            { file: "a.pgn", shared: { id: "s1", from: "Jannick", hash: "h1" } },
            { file: "b.pgn", shared: { id: "s2", from: "Jannick", hash: "old" } },
        ];
        const { b, calls } = backend({
            listIncoming: async () => [
                share({ id: "s1", hash: "h1" }),
                share({ id: "s2", hash: "h2" }),
                share({ id: "s4", hash: "h4" }),
                // Not accepted yet, or accepted on another account: no file
                share({ id: "s5", status: "pending", recipientUid: undefined }),
                share({ id: "s6", recipientUid: "someone-else" }),
            ],
            sharedFiles: async () => files,
        });
        const result = await syncShares(b);
        expect(calls).toEqual(["write s2 over", "write s4 new"]);
        expect(result).toEqual({ sent: 0, received: 2, ended: 0 });
    });

    it("marks the file of a withdrawn share once", async () => {
        const { b, calls } = backend({
            sharedFiles: async () => [
                { file: "a.pgn", shared: { id: "s1", from: "Jannick", hash: "h1" } },
                { file: "b.pgn", shared: { id: "s2", from: "Jannick", hash: "h2", ended: true } },
            ],
        });
        expect((await syncShares(b)).ended).toBe(1);
        expect(calls).toEqual(["end s1"]);
    });
});

describe("safeFileName", () => {
    it("drops characters file systems refuse", () => {
        expect(safeFileName('Aaron: "Weiß"/1.e4?')).toBe("Aaron_ _Weiß__1.e4_");
        expect(safeFileName("...")).toBe("Repertoire");
    });
});
