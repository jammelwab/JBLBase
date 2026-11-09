import { describe, expect, test } from "vitest";
import type { TrainingCard, TrainingDeck, TrainingReview } from "@/bindings";
import {
    type DeckData,
    deckId,
    legacyBackupKey,
    legacyDeckKey,
    loadDeck,
    positionKey,
    repertoireId,
    saveDeck,
    type TrainingBackend,
} from "./training";

const FILE = "/rep/Weiß.pgn";
const FEN = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";

function fakeBackend(info: Record<string, unknown> | null = { type: "repertoire", tags: [] }) {
    const infos = new Map<string, Record<string, unknown>>();
    if (info) infos.set(FILE, info);
    const decks = new Map<string, { cards: TrainingCard[]; reviews: TrainingReview[] }>();
    const store = new Map<string, string>();
    let next = 0;
    const backend: TrainingBackend = {
        readInfo: async (file) => infos.get(file) ?? null,
        writeInfo: async (file, i) => {
            infos.set(file, i);
        },
        load: async (deck): Promise<TrainingDeck | null> => decks.get(deck) ?? null,
        saveCards: async (deck, cards) => {
            const d = decks.get(deck) ?? { cards: [], reviews: [] };
            decks.set(deck, { ...d, cards });
        },
        appendReviews: async (deck, reviews) => {
            const d = decks.get(deck) ?? { cards: [], reviews: [] };
            decks.set(deck, { ...d, reviews: [...d.reviews, ...reviews] });
        },
        storage: {
            getItem: (k) => store.get(k) ?? null,
            setItem: (k, v) => void store.set(k, v),
            removeItem: (k) => void store.delete(k),
        },
        newId: () => `id-${++next}`,
    };
    return { backend, infos, decks, store };
}

const card = (reps: number) => ({ reps, due: "2026-11-09T00:00:00.000Z" }) as never;

const sample: DeckData = {
    positions: [{ fen: FEN, answer: "e5", card: card(2) }],
    logs: [{ fen: FEN, rating: 3 } as never],
};

describe("positionKey", () => {
    test("drops move counters", () => {
        expect(positionKey(FEN)).toBe("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -");
        expect(positionKey(FEN.replace("0 1", "3 7"))).toBe(positionKey(FEN));
    });
});

describe("deckId", () => {
    test("adds the game number for later games only", () => {
        expect(deckId("abc", 0)).toBe("abc");
        expect(deckId("abc", 2)).toBe("abc#2");
    });
});

describe("repertoireId", () => {
    test("is created once and kept in the .info", async () => {
        const { backend, infos } = fakeBackend();
        expect(await repertoireId(backend, FILE, false)).toBeNull();
        expect(await repertoireId(backend, FILE, true)).toBe("id-1");
        expect(await repertoireId(backend, FILE, true)).toBe("id-1");
        expect(infos.get(FILE)).toEqual({ type: "repertoire", tags: [], id: "id-1" });
    });

    test("writes default metadata when the .info is missing", async () => {
        const { backend, infos } = fakeBackend(null);
        await repertoireId(backend, FILE, true);
        expect(infos.get(FILE)).toEqual({ type: "other", tags: [], id: "id-1" });
    });
});

describe("loadDeck", () => {
    test("nothing saved anywhere", async () => {
        const { backend, infos } = fakeBackend();
        expect(await loadDeck(backend, FILE, 0)).toBeNull();
        expect(infos.get(FILE)?.id).toBeUndefined();
    });

    test("moves a localStorage deck into the store and keeps a backup", async () => {
        const { backend, decks, store } = fakeBackend();
        const raw = JSON.stringify(sample);
        store.set(legacyDeckKey(FILE, 0), raw);

        expect(await loadDeck(backend, FILE, 0)).toEqual(sample);
        expect(store.has(legacyDeckKey(FILE, 0))).toBe(false);
        expect(store.get(legacyBackupKey(FILE, 0))).toBe(raw);
        const saved = decks.get("id-1");
        expect(saved?.cards).toHaveLength(1);
        expect(saved?.reviews).toHaveLength(1);

        // Second start: comes from the store, not migrated again.
        expect(await loadDeck(backend, FILE, 0)).toEqual(sample);
        expect(decks.get("id-1")?.reviews).toHaveLength(1);
    });

    test("survives a rename because the id moves with the .info", async () => {
        const { backend, infos } = fakeBackend();
        await saveDeck(backend, FILE, 0, { positions: [], logs: [] }, sample, 0);
        const renamed = "/rep/Neu.pgn";
        infos.set(renamed, infos.get(FILE)!);
        expect(await loadDeck(backend, renamed, 0)).toEqual(sample);
    });
});

describe("saveDeck", () => {
    test("appends only new reviews", async () => {
        const { backend, decks } = fakeBackend();
        let persisted = await saveDeck(backend, FILE, 0, { positions: [], logs: [] }, sample, 0);
        expect(persisted).toBe(1);
        const next: DeckData = {
            positions: [{ ...sample.positions[0], card: card(3) }],
            logs: [...sample.logs, { fen: FEN, rating: 4 } as never],
        };
        persisted = await saveDeck(backend, FILE, 0, sample, next, persisted);
        expect(persisted).toBe(2);
        expect(decks.get("id-1")?.reviews).toHaveLength(2);
        expect(JSON.parse(decks.get("id-1")!.cards[0].card).reps).toBe(3);
    });

    test("no file, nothing saved", async () => {
        const { backend, decks } = fakeBackend();
        expect(await saveDeck(backend, "", 0, { positions: [], logs: [] }, sample, 0)).toBe(0);
        expect(decks.size).toBe(0);
    });
});

describe("repertoireId concurrency", () => {
    test("two decks of one file get the same id", async () => {
        const { backend } = fakeBackend();
        const [a, b] = await Promise.all([
            repertoireId(backend, FILE, true),
            repertoireId(backend, FILE, true),
        ]);
        expect(a).toBe("id-1");
        expect(b).toBe("id-1");
    });
});
