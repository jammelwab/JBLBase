// One line about the cloud sync for the corner of the window and the
// settings (#111): is everything in the cloud, and since when.

import type { CloudSyncStatus } from "./sync";

export type SyncTone = "ok" | "busy" | "offline" | "error" | "warning" | "off";

export type SyncSummary = {
    tone: SyncTone;
    /** Translation key (Settings.Cloud.Sync.*). */
    key: string;
    /** Time of the last sync, for "{{ago}}". */
    lastSync?: number;
};

export function syncSummary(status: CloudSyncStatus): SyncSummary {
    const { lastSync } = status;
    if (status.state === "off") return { tone: "off", key: "Settings.Cloud.Sync.Off" };
    if (status.offline) return { tone: "offline", key: "Settings.Cloud.Sync.Offline", lastSync };
    if (status.state === "syncing") return { tone: "busy", key: "Settings.Cloud.Sync.Running" };
    if (status.state === "error") {
        return status.notAllowed
            ? { tone: "error", key: "Settings.Cloud.NotAllowed" }
            : { tone: "error", key: "Settings.Cloud.Sync.Failed", lastSync };
    }
    if (status.limited) {
        return { tone: "warning", key: "Settings.Cloud.Sync.Limited", lastSync };
    }
    if ((status.conflictCopies?.length ?? 0) > 0) {
        return { tone: "warning", key: "Settings.Cloud.Sync.ConflictShort", lastSync };
    }
    if (!lastSync) return { tone: "busy", key: "Settings.Cloud.Sync.Never" };
    return {
        tone: "ok",
        key: status.live ? "Settings.Cloud.Sync.AgoLive" : "Settings.Cloud.Sync.Ago",
        lastSync,
    };
}

/**
 * "vor 10 Sek.", "vor 3 Min." up to an hour, then the time of day
 * ("um 14:03" comes from the translation).
 */
export function formatAgo(
    time: number,
    language: string,
    now = Date.now(),
): { relative: string } | { time: string } {
    const seconds = Math.max(0, Math.round((now - time) / 1000));
    if (seconds < 3600) {
        const rtf = new Intl.RelativeTimeFormat(language, { numeric: "auto", style: "short" });
        // Steps of 10 seconds, so the text does not flicker every second.
        if (seconds < 60) return { relative: rtf.format(-Math.floor(seconds / 10) * 10, "second") };
        return { relative: rtf.format(-Math.floor(seconds / 60), "minute") };
    }
    return {
        time: new Date(time).toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit" }),
    };
}
