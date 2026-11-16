import { describe, expect, it } from "vitest";
import type { SyncCard, SyncCardKey, SyncReview } from "@/bindings";
import {
    cardDocId,
    parseRemoteCard,
    parseRemoteReview,
    syncTraining,
    type TrainingSyncBackend,
} from "./trainingSync";

const card = (n: number): SyncCard => ({
    deck: "rep",
    position: `p${n}`,
    fen: `p${n} w - -`,
    answer: "e4",
    card: "{}",
    ord: n,
    updatedAt: 1000 + n,
    deleted: false,
});

describe("training sync helpers", () => {
    it("builds stable, path-safe document ids", () => {
        const id = cardDocId("rep#2", "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -");
        expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(cardDocId("rep#2", "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -")).toBe(
            id,
        );
        expect(
            cardDocId("rep#3", "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -"),
        ).not.toBe(id);
    });

    it("checks remote documents", () => {
        const { deck, position, fen, answer, card: c, updatedAt } = card(1);
        expect(
            parseRemoteCard({ deck, position, fen, answer, card: c, updatedAt, ord: 1 }),
        ).toEqual(card(1));
        expect(parseRemoteCard({ deck, position })).toBeNull();
        const review = { deck: "rep", fen: "x", log: "{}", reviewedAt: 5 };
        expect(parseRemoteReview("a".repeat(32), review)?.uid).toBe("a".repeat(32));
        expect(parseRemoteReview("bad", review)).toBeNull();
    });
});

describe("syncTraining", () => {
    it("uploads in batches, then applies remote changes after the cursor", async () => {
        let dirty = Array.from({ length: 450 }, (_, i) => card(i));
        const pushed: number[] = [];
        const meta = new Map<string, string>([["trainingCursor:u", "500000"]]);
        const after: (string | null)[] = [];
        const remote: SyncCard = { ...card(9), answer: "d4", updatedAt: 99999 };
        const b: TrainingSyncBackend = {
            async pending(limit) {
                return { cards: dirty.slice(0, limit), reviews: [] };
            },
            async markSynced(cards: SyncCardKey[]) {
                const done = new Set(cards.map((c) => c.position));
                dirty = dirty.filter((c) => !done.has(c.position));
            },
            async applyRemote(cards: SyncCard[], reviews: SyncReview[]) {
                return cards.length + reviews.length > 0 ? ["rep"] : [];
            },
            async push(cards) {
                pushed.push(cards.length);
            },
            async fetchCards(a) {
                after.push(a);
                return { items: [remote], cursor: "600.000000000|c" };
            },
            async fetchReviews(a) {
                after.push(a);
                return { items: [], cursor: a };
            },
            async metaGet(k) {
                return meta.get(k) ?? null;
            },
            async metaSet(k, v) {
                if (v === null) meta.delete(k);
                else meta.set(k, v);
            },
        };
        const result = await syncTraining(b, "u");
        expect(pushed).toEqual([200, 200, 50]);
        expect(result).toEqual({ uploaded: 450, downloaded: 1, changedDecks: ["rep"] });
        // The position of 1.0.28 is used once for both, then each keeps its own.
        expect(after).toEqual(["500000", "500000"]);
        expect(meta.get("trainingCursor:cards:u")).toBe("600.000000000|c");
        expect(meta.get("trainingCursor:reviews:u")).toBe("500000");
        expect(meta.has("trainingCursor:u")).toBe(false);
    });
});
