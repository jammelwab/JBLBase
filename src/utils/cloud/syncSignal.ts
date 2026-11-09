// Local changes that the cloud sync should pick up. Kept apart from
// ./sync, so state modules can signal without importing the sync itself.

let listener: (() => void) | null = null;

export function setLocalChangeListener(fn: (() => void) | null) {
    listener = fn;
}

/** Something that is synced changed on this device. */
export function notifyLocalChange() {
    listener?.();
}
