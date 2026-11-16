// Training sync: cards (last change wins) and the append-only review log.
//
// Firestore:
//   users/{uid}/cards/{cardDocId(deck, position)}
//       deck, position, fen, answer, card (FSRS JSON), ord, updatedAt, deleted, syncedAt
//   users/{uid}/reviews/{uid of the review}
//       deck, fen, log (FSRS JSON), reviewedAt, syncedAt
//
// The local store (src-tauri/src/training.rs) marks changed cards and new
// reviews as dirty; they are uploaded in batches and then marked synced.
// Changes from other devices are fetched by `syncedAt` after the last
// document read, one download position per collection (see cursor.ts).

import type { SyncCard, SyncCardKey, SyncReview, TrainingPending } from "@/bindings";

/** Cards and reviews per upload batch; Firestore allows 500 writes per batch. */
export const BATCH = 200;
const MAX_ROUNDS = 100;

export interface TrainingSyncBackend {
    pending(limit: number): Promise<TrainingPending>;
    markSynced(cards: SyncCardKey[], reviews: string[]): Promise<void>;
    applyRemote(cards: SyncCard[], reviews: SyncReview[]): Promise<string[]>;
    /** Uploads cards and reviews in one atomic batch. */
    push(cards: SyncCard[], reviews: SyncReview[]): Promise<void>;
    /** Documents after the download position `after`, and the position after them. */
    fetchCards(after: string | null): Promise<{ items: SyncCard[]; cursor: string | null }>;
    fetchReviews(after: string | null): Promise<{ items: SyncReview[]; cursor: string | null }>;
    metaGet(key: string): Promise<string | null>;
    metaSet(key: string, value: string | null): Promise<void>;
}

/** Firestore document id of a card: deck and position, base64url-encoded. */
export function cardDocId(deck: string, position: string): string {
    const bytes = new TextEncoder().encode(`${deck}\n${position}`);
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A card document from the cloud; null when it is malformed. */
export function parseRemoteCard(d: Record<string, unknown>): SyncCard | null {
    const { deck, position, fen, answer, card, ord, updatedAt, deleted } = d;
    if (
        typeof deck !== "string" ||
        typeof position !== "string" ||
        typeof fen !== "string" ||
        typeof answer !== "string" ||
        typeof card !== "string" ||
        typeof updatedAt !== "number"
    ) {
        return null;
    }
    return {
        deck,
        position,
        fen,
        answer,
        card,
        ord: typeof ord === "number" && ord >= 0 ? Math.floor(ord) : 0,
        updatedAt,
        deleted: deleted === true,
    };
}

export function parseRemoteReview(id: string, d: Record<string, unknown>): SyncReview | null {
    const { deck, fen, log, reviewedAt } = d;
    if (
        !/^[0-9a-f]{32}$/.test(id) ||
        typeof deck !== "string" ||
        typeof fen !== "string" ||
        typeof log !== "string" ||
        typeof reviewedAt !== "number"
    ) {
        return null;
    }
    return { uid: id, deck, fen, log, reviewedAt };
}

export type TrainingSyncResult = { uploaded: number; downloaded: number; changedDecks: string[] };

export async function syncTraining(
    b: TrainingSyncBackend,
    uid: string,
): Promise<TrainingSyncResult> {
    let uploaded = 0;
    for (let round = 0; round < MAX_ROUNDS; round++) {
        const { cards, reviews } = await b.pending(BATCH);
        if (cards.length === 0 && reviews.length === 0) break;
        await b.push(cards, reviews);
        await b.markSynced(
            cards.map(({ deck, position, updatedAt }) => ({ deck, position, updatedAt })),
            reviews.map((r) => r.uid),
        );
        uploaded += cards.length + reviews.length;
    }

    // Up to 1.0.28 one millisecond time for both collections.
    const legacyKey = `trainingCursor:${uid}`;
    const legacy = await b.metaGet(legacyKey);
    const cardsKey = `trainingCursor:cards:${uid}`;
    const reviewsKey = `trainingCursor:reviews:${uid}`;
    const [cards, reviews] = await Promise.all([
        b.fetchCards((await b.metaGet(cardsKey)) ?? legacy),
        b.fetchReviews((await b.metaGet(reviewsKey)) ?? legacy),
    ]);
    const changedDecks =
        cards.items.length > 0 || reviews.items.length > 0
            ? await b.applyRemote(cards.items, reviews.items)
            : [];
    await b.metaSet(cardsKey, cards.cursor);
    await b.metaSet(reviewsKey, reviews.cursor);
    if (legacy !== null) await b.metaSet(legacyKey, null);
    return { uploaded, downloaded: changedDecks.length, changedDecks };
}
