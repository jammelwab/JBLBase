import { mutate } from "swr";

/** Lists and statistics that are read from a game database and cached. */
const DATABASE_CACHE_KEYS = [
    "games",
    "position-games",
    "tournament-games",
    "players",
    "tournaments",
    "player-game-info",
    "personalDatabases",
    "personalInfo",
];

export function isDatabaseCacheKey(key: unknown): boolean {
    return key === "databases" || (Array.isArray(key) && DATABASE_CACHE_KEYS.includes(key[0]));
}

/**
 * Reloads everything that shows games of a database. Without this, an open
 * database kept listing the games from before the download.
 */
export function refreshDatabaseCaches() {
    return mutate(isDatabaseCacheKey, undefined, { revalidate: true });
}

type SyncJob = () => Promise<void>;

const syncJobs = new Map<string, SyncJob>();

/** An account card offers its download here, so a player can update all accounts at once. */
export function registerAccountSync(key: string, job: SyncJob): () => void {
    syncJobs.set(key, job);
    return () => {
        if (syncJobs.get(key) === job) syncJobs.delete(key);
    };
}

/**
 * Downloads the games of several accounts, one after the other: Lichess only
 * allows one download at a time. A failing account does not stop the others.
 */
export async function syncAccounts(keys: string[]): Promise<void> {
    for (const key of keys) {
        try {
            await syncJobs.get(key)?.();
        } catch {
            // The account card reports its own errors.
        }
    }
}

/**
 * Lichess answers 401 for a token that expired or was revoked, even though the
 * games are public. The download is then repeated without the token.
 */
export function isRejectedToken(error: string): boolean {
    return error.includes("(401 ") || error.includes("401 Unauthorized");
}
