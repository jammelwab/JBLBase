// Training progress storage.
//
// Decks (FSRS cards plus the review log) used to live in localStorage under
// `deck-<absolute path>-<game>`: bound to one device and lost on rename.
// They now live in the app's SQLite training store, keyed by a stable deck
// id: the repertoire id from the file's .info (created on first use) plus
// the game number for files with several games. Cards are keyed by the
// position without move counters.
//
// Existing localStorage decks are moved over the first time a deck is
// opened. The old entry is kept under `deck-backup-…` so nothing is lost.

import { exists, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { Card, ReviewLog } from "ts-fsrs";
import { commands, type TrainingCard, type TrainingDeck, type TrainingReview } from "@/bindings";

export type DeckPosition = { fen: string; answer: string; card: Card };
export type DeckLog = ReviewLog & { fen: string };
export type DeckData = { positions: DeckPosition[]; logs: DeckLog[] };

/** Placement, side to move, castling and en passant; no move counters. */
export function positionKey(fen: string): string {
    return fen.trim().split(/\s+/).slice(0, 4).join(" ");
}

export function samePosition(a: string, b: string): boolean {
    return positionKey(a) === positionKey(b);
}

export function deckId(repertoireId: string, game: number): string {
    return game === 0 ? repertoireId : `${repertoireId}#${game}`;
}

export function legacyDeckKey(file: string, game: number): string {
    return `deck-${file}-${game}`;
}

export function legacyBackupKey(file: string, game: number): string {
    return `deck-backup-${file}-${game}`;
}

export function toTrainingCards(positions: DeckPosition[]): TrainingCard[] {
    return positions.map((p) => ({ fen: p.fen, answer: p.answer, card: JSON.stringify(p.card) }));
}

export function toTrainingReviews(logs: DeckLog[]): TrainingReview[] {
    return logs.map(({ fen, ...log }) => ({ fen, log: JSON.stringify(log) }));
}

export function fromTrainingDeck(deck: TrainingDeck): DeckData {
    return {
        positions: deck.cards.map((c) => ({
            fen: c.fen,
            answer: c.answer,
            card: JSON.parse(c.card) as Card,
        })),
        logs: deck.reviews.map((r) => ({ ...(JSON.parse(r.log) as ReviewLog), fen: r.fen })),
    };
}

/** Parses a legacy localStorage deck; null when missing or malformed. */
export function parseLegacyDeck(raw: string | null): DeckData | null {
    if (!raw) return null;
    try {
        const data = JSON.parse(raw);
        if (!data || !Array.isArray(data.positions) || !Array.isArray(data.logs)) return null;
        const positions = data.positions.filter(
            (p: unknown): p is DeckPosition =>
                !!p &&
                typeof (p as DeckPosition).fen === "string" &&
                typeof (p as DeckPosition).answer === "string" &&
                typeof (p as DeckPosition).card === "object",
        );
        const logs = data.logs.filter(
            (l: unknown): l is DeckLog => !!l && typeof (l as DeckLog).fen === "string",
        );
        return { positions, logs };
    } catch {
        return null;
    }
}

export interface TrainingBackend {
    readInfo(file: string): Promise<Record<string, unknown> | null>;
    writeInfo(file: string, info: Record<string, unknown>): Promise<void>;
    load(deck: string): Promise<TrainingDeck | null>;
    saveCards(deck: string, cards: TrainingCard[]): Promise<void>;
    appendReviews(deck: string, reviews: TrainingReview[]): Promise<void>;
    storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
    newId(): string;
}

function infoPath(file: string) {
    return file.replace(/\.pgn$/, ".info");
}

export const tauriTrainingBackend: TrainingBackend = {
    async readInfo(file) {
        const path = infoPath(file);
        if (!(await exists(path))) return null;
        try {
            return JSON.parse(await readTextFile(path));
        } catch {
            return null;
        }
    },
    async writeInfo(file, info) {
        await writeTextFile(infoPath(file), JSON.stringify(info));
    },
    async load(deck) {
        const res = await commands.trainingLoadDeck(deck);
        if (res.status === "error") throw new Error(res.error);
        return res.data;
    },
    async saveCards(deck, cards) {
        const res = await commands.trainingSaveCards(deck, cards);
        if (res.status === "error") throw new Error(res.error);
    },
    async appendReviews(deck, reviews) {
        const res = await commands.trainingAppendReviews(deck, reviews);
        if (res.status === "error") throw new Error(res.error);
    },
    storage: globalThis.localStorage,
    newId: () => crypto.randomUUID(),
};

// Id creation per file runs once at a time, so two decks of one file
// (several games) never write two different ids.
const creatingIds = new Map<string, Promise<string | null>>();

/** The repertoire id stored in the file's .info; created when asked. */
export async function repertoireId(
    backend: TrainingBackend,
    file: string,
    create: boolean,
): Promise<string | null> {
    if (!file.endsWith(".pgn")) return null;
    const pending = creatingIds.get(file);
    if (pending) return pending;
    const info = await backend.readInfo(file);
    if (info && typeof info.id === "string" && info.id) return info.id;
    if (!create) return null;
    const again = creatingIds.get(file);
    if (again) return again;
    const creating = (async () => {
        const id = backend.newId();
        // Default metadata as for a file without .info (see readFileMetadata).
        await backend.writeInfo(file, { type: "other", tags: [], ...info, id });
        return id;
    })().finally(() => creatingIds.delete(file));
    creatingIds.set(file, creating);
    return creating;
}

/**
 * Loads a deck. Returns null when there is nothing saved yet. A deck still
 * in localStorage is moved into the training store on the way.
 */
export async function loadDeck(
    backend: TrainingBackend,
    file: string,
    game: number,
): Promise<DeckData | null> {
    if (!file) return null;
    const id = await repertoireId(backend, file, false);
    if (id) {
        const stored = await backend.load(deckId(id, game));
        if (stored) return fromTrainingDeck(stored);
    }

    const legacyKey = legacyDeckKey(file, game);
    const legacy = parseLegacyDeck(backend.storage.getItem(legacyKey));
    if (!legacy || (legacy.positions.length === 0 && legacy.logs.length === 0)) return null;

    const newId = id ?? (await repertoireId(backend, file, true));
    if (!newId) return legacy;
    const deck = deckId(newId, game);
    await backend.saveCards(deck, toTrainingCards(legacy.positions));
    if (legacy.logs.length > 0) await backend.appendReviews(deck, toTrainingReviews(legacy.logs));
    const raw = backend.storage.getItem(legacyKey);
    if (raw !== null) backend.storage.setItem(legacyBackupKey(file, game), raw);
    backend.storage.removeItem(legacyKey);
    return legacy;
}

/**
 * Saves the change from `prev` to `next`: all cards when they changed, and
 * the reviews appended since `persistedLogs`. Returns the new log count.
 */
export async function saveDeck(
    backend: TrainingBackend,
    file: string,
    game: number,
    prev: DeckData,
    next: DeckData,
    persistedLogs: number,
): Promise<number> {
    if (!file) return persistedLogs;
    const cardsChanged = prev.positions !== next.positions || cardsDiffer(prev, next);
    const newLogs = next.logs.length > persistedLogs ? next.logs.slice(persistedLogs) : [];
    if (!cardsChanged && newLogs.length === 0) return persistedLogs;
    const id = await repertoireId(backend, file, true);
    if (!id) return persistedLogs;
    const deck = deckId(id, game);
    if (cardsChanged) await backend.saveCards(deck, toTrainingCards(next.positions));
    if (newLogs.length > 0) await backend.appendReviews(deck, toTrainingReviews(newLogs));
    return Math.max(persistedLogs, next.logs.length);
}

function cardsDiffer(a: DeckData, b: DeckData) {
    if (a.positions.length !== b.positions.length) return true;
    return a.positions.some((p, i) => {
        const q = b.positions[i];
        return p.fen !== q.fen || p.answer !== q.answer || p.card !== q.card;
    });
}
