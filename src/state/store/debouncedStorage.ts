import { type PersistStorage, type StorageValue } from "zustand/middleware";

const DEBOUNCE_MS = 300;
const pendingWrites = new Map<string, StorageValue<unknown>>();

let flushTimeout: ReturnType<typeof setTimeout> | null = null;
let flushHandlersBound = false;

function flush() {
    if (pendingWrites.size === 0) {
        return;
    }

    for (const [name, value] of pendingWrites) {
        sessionStorage.setItem(name, JSON.stringify(value));
    }

    pendingWrites.clear();
}

function scheduleFlush(delay: number) {
    if (flushTimeout) {
        clearTimeout(flushTimeout);
    }

    flushTimeout = setTimeout(() => {
        flushTimeout = null;
        flush();
    }, delay);
}

function bindFlushHandlers() {
    if (flushHandlersBound || typeof window === "undefined") {
        return;
    }

    const flushAndClearTimeout = () => {
        if (flushTimeout) {
            clearTimeout(flushTimeout);
            flushTimeout = null;
        }

        flush();
    };

    window.addEventListener("beforeunload", flushAndClearTimeout);
    window.addEventListener("pagehide", flushAndClearTimeout);

    flushHandlersBound = true;
}

export function createDebouncedSessionStorage<S>(delay = DEBOUNCE_MS): PersistStorage<S> {
    bindFlushHandlers();

    return {
        getItem: (name) => {
            const pending = pendingWrites.get(name);
            if (pending) {
                return pending as StorageValue<S>;
            }

            const stored = sessionStorage.getItem(name);
            return stored ? (JSON.parse(stored) as StorageValue<S>) : null;
        },
        setItem: (name, value) => {
            pendingWrites.set(name, value as StorageValue<unknown>);
            scheduleFlush(delay);
        },
        removeItem: (name) => {
            pendingWrites.delete(name);
            sessionStorage.removeItem(name);
        },
    };
}

// Changes the persisted state of a store that is not mounted right now (e.g. a tab in the
// background). Pending debounced writes are taken into account.
export function updatePersistedState<S>(name: string, update: (state: S) => S): boolean {
    const pending = pendingWrites.get(name);
    const stored = pending ?? JSON.parse(sessionStorage.getItem(name) ?? "null");
    if (!stored || typeof stored !== "object" || !("state" in stored)) {
        return false;
    }
    const next = { ...stored, state: update(stored.state as S) };
    if (pending) {
        pendingWrites.set(name, next);
    } else {
        sessionStorage.setItem(name, JSON.stringify(next));
    }
    return true;
}
