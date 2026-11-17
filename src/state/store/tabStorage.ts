// The state of each board tab (its game tree) lives in sessionStorage under the tab's id.
// sessionStorage holds only about 5 MB (WebKit on macOS counts each character as up to two
// bytes). A large repertoire is several megabytes as JSON, so writing it there can throw a
// QuotaExceededError, and the tab never opened. A state that does not fit is kept in memory
// instead: it lives as long as the window, which is all a tab needs.

const memory = new Map<string, string>();

function isQuotaError(e: unknown): boolean {
    if (!(e instanceof DOMException)) {
        return false;
    }
    return (
        e.name === "QuotaExceededError" ||
        e.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
        e.code === 22 ||
        e.code === 1014
    );
}

export function readTabState(id: string): string | null {
    return memory.get(id) ?? sessionStorage.getItem(id);
}

export function writeTabState(id: string, value: string): void {
    try {
        sessionStorage.setItem(id, value);
        memory.delete(id);
    } catch (e) {
        if (!isQuotaError(e)) {
            throw e;
        }
        // An older, smaller copy must not be read back instead of this one.
        sessionStorage.removeItem(id);
        memory.set(id, value);
    }
}

export function removeTabState(id: string): void {
    memory.delete(id);
    sessionStorage.removeItem(id);
}
