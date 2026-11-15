// Download position of a synced collection: the server time (`syncedAt`) of
// the last document read and its id. The next run continues right after it,
// ordered by (syncedAt, document id). A query reads a consistent snapshot, so
// a write it did not see commits later and gets a later syncedAt: nothing is
// missed, and a run without changes in the cloud reads nothing.
//
// Up to 1.0.28 the position was a plain millisecond time, and each run read
// everything from two minutes before it again (#99). Such a value is still
// understood, once, with that overlap.

/** `id` is empty for a time-only position: continue with documents after that time. */
export type SyncCursor = { seconds: number; nanos: number; id: string };

/** Overlap for a position stored by 1.0.28 or older (milliseconds only). */
export const LEGACY_OVERLAP_MS = 2 * 60 * 1000;

export function formatSyncCursor(seconds: number, nanos: number, id: string): string {
    return `${seconds}.${String(nanos).padStart(9, "0")}|${id}`;
}

/**
 * The position to continue after; null to read from the start. An old
 * millisecond value becomes a time-only position two minutes before it, so
 * every document from that time on is read once more.
 */
export function parseSyncCursor(text: string | null): SyncCursor | null {
    if (!text) return null;
    const m = text.match(/^(\d+)\.(\d{9})\|(.*)$/);
    if (m) return { seconds: Number(m[1]), nanos: Number(m[2]), id: m[3] };
    if (/^\d+$/.test(text)) {
        const ms = Math.max(0, Number(text) - LEGACY_OVERLAP_MS);
        if (ms === 0) return null;
        return { seconds: Math.floor(ms / 1000), nanos: (ms % 1000) * 1_000_000, id: "" };
    }
    return null;
}
