// Live sync (#110): while the app is open and visible, it listens for
// documents that another device wrote to the synced collections, and runs the
// normal sync as soon as one arrives. Changes then show up within seconds
// instead of with the next periodic run.
//
// Each listener watches only documents written after the download position
// of its collection (see cursor.ts), limited to one document. A quiet
// listener reads nothing; a new document costs one read, and the sync it
// starts reads exactly what is new. After a sync the listeners move to the
// new positions; a listener whose position did not change is kept, so a
// failing sync cannot start itself again and again.
//
// What this device uploads itself is newer than its position, so it also
// fires once and the next run reads it back (as the periodic sync always
// did). The position store (evals) is not watched: it is large and not
// urgent, the periodic sync keeps handling it.

import { parseSyncCursor, type SyncCursor } from "./cursor";

export const LIVE_COLLECTIONS = ["repertoires", "cards", "reviews"] as const;
export type LiveCollection = (typeof LIVE_COLLECTIONS)[number];

/** Keys of the download positions in the sync metadata (see repertoireSync.ts, trainingSync.ts). */
export function liveCursorKey(name: LiveCollection, uid: string): string {
    switch (name) {
        case "repertoires":
            return `repCursor:${uid}`;
        case "cards":
            return `trainingCursor:cards:${uid}`;
        case "reviews":
            return `trainingCursor:reviews:${uid}`;
    }
}

export interface LiveBackend {
    /**
     * Watches users/{uid}/{name} for documents written after `after` (all
     * documents when null). Calls `onNew` whenever at least one exists,
     * `onError` when the listener stops. Returns the function that stops it.
     */
    listen(
        uid: string,
        name: LiveCollection,
        after: SyncCursor | null,
        onNew: () => void,
        onError: (error: unknown) => void,
    ): () => void;
    metaGet(key: string): Promise<string | null>;
}

type Watch = { cursor: string | null; stop: () => void };

/** Short wait after a change, so the three collections of one upload start one run. */
export const LIVE_DELAY_MS = 1500;

export class LiveSync {
    private watches = new Map<LiveCollection, Watch>();
    private uid: string | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private generation = 0;

    constructor(
        private backend: LiveBackend,
        /** Runs the sync. */
        private onRemoteChange: () => void,
        /** The live state changed (true: all listeners run). */
        private onState: (live: boolean) => void = () => {},
        private delayMs = LIVE_DELAY_MS,
    ) {}

    /** All listeners are running. */
    get live(): boolean {
        return this.uid !== null && this.watches.size === LIVE_COLLECTIONS.length;
    }

    /**
     * Starts (or moves) the listeners of `uid` to the current download
     * positions. Call after every sync run and when the window becomes visible.
     */
    async refresh(uid: string): Promise<void> {
        if (this.uid !== uid) this.stop();
        this.uid = uid;
        const generation = this.generation;
        const cursors = await Promise.all(
            LIVE_COLLECTIONS.map((name) => this.backend.metaGet(liveCursorKey(name, uid))),
        );
        // Stopped or switched account meanwhile.
        if (generation !== this.generation || this.uid !== uid) return;
        LIVE_COLLECTIONS.forEach((name, i) => {
            const cursor = cursors[i];
            const current = this.watches.get(name);
            if (current && current.cursor === cursor) return;
            current?.stop();
            this.watches.delete(name);
            const watch: Watch = { cursor, stop: () => {} };
            watch.stop = this.backend.listen(
                uid,
                name,
                parseSyncCursor(cursor),
                () => {
                    if (this.watches.get(name) === watch) this.changed();
                },
                (error) => {
                    if (this.watches.get(name) !== watch) return;
                    console.warn(`Live sync of ${name} stopped`, error);
                    this.watches.delete(name);
                    this.onState(this.live);
                },
            );
            this.watches.set(name, watch);
        });
        this.onState(this.live);
    }

    /** Stops all listeners (signed out, window hidden, sync held). */
    stop(): void {
        this.generation++;
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        const had = this.watches.size > 0;
        for (const w of this.watches.values()) w.stop();
        this.watches.clear();
        this.uid = null;
        if (had) this.onState(false);
    }

    private changed() {
        if (this.timer) return;
        this.timer = setTimeout(() => {
            this.timer = null;
            this.onRemoteChange();
        }, this.delayMs);
    }
}
