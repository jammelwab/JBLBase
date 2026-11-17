// Keeps shared repertoires (#120) up to date during the cloud sync:
// - as owner: every share whose repertoire changed gets the new version,
// - as recipient: every accepted share has a local file with its newest
//   version; a share that was withdrawn keeps its file, marked as ended.
// Shared files are not synced into the recipient's own repertoires.

import { type Share, type ShareContent, type ShareWithPgn, shareHash } from "./shares";

/** What a local file of a received share remembers (in its .info as "shared"). */
export type SharedInfo = {
    id: string;
    from: string;
    hash: string;
    ended?: boolean;
};

export type LocalSharedFile = { file: string; shared: SharedInfo };

export type OwnRepertoire = { id: string; name: string; color: "white" | "black"; pgn: string };

export interface ShareSyncBackend {
    uid: string;
    ownerName: string;
    listOwn(): Promise<Share[]>;
    listIncoming(): Promise<ShareWithPgn[]>;
    update(id: string, content: ShareContent): Promise<void>;
    /** The account's own repertoires with their cloud id */
    ownRepertoires(): Promise<OwnRepertoire[]>;
    /** Local files of received shares */
    sharedFiles(): Promise<LocalSharedFile[]>;
    writeShared(share: ShareWithPgn, existing: LocalSharedFile | undefined): Promise<void>;
    markEnded(file: LocalSharedFile): Promise<void>;
}

export type ShareSyncResult = { sent: number; received: number; ended: number };

export function parseSharedInfo(value: unknown): SharedInfo | null {
    if (!value || typeof value !== "object") return null;
    const v = value as Record<string, unknown>;
    if (typeof v.id !== "string" || !v.id) return null;
    return {
        id: v.id,
        from: typeof v.from === "string" ? v.from : "?",
        hash: typeof v.hash === "string" ? v.hash : "",
        ended: v.ended === true ? true : undefined,
    };
}

export async function syncShares(b: ShareSyncBackend): Promise<ShareSyncResult> {
    const result: ShareSyncResult = { sent: 0, received: 0, ended: 0 };

    const own = await b.listOwn();
    if (own.length > 0) {
        const repertoires = await b.ownRepertoires();
        for (const share of own) {
            const r = repertoires.find((x) => x.id === share.sourceId);
            if (!r) continue;
            const hash = await shareHash(r.name, r.color, r.pgn);
            if (hash === share.hash) continue;
            await b.update(share.id, {
                ownerName: b.ownerName,
                name: r.name,
                color: r.color,
                pgn: r.pgn,
            });
            result.sent++;
        }
    }

    const accepted = (await b.listIncoming()).filter(
        (s) => s.status === "accepted" && s.recipientUid === b.uid,
    );
    const files = await b.sharedFiles();
    for (const share of accepted) {
        const existing = files.find((f) => f.shared.id === share.id);
        if (existing && existing.shared.hash === share.hash && !existing.shared.ended) continue;
        await b.writeShared(share, existing);
        result.received++;
    }
    for (const f of files) {
        if (f.shared.ended || accepted.some((s) => s.id === f.shared.id)) continue;
        await b.markEnded(f);
        result.ended++;
    }
    return result;
}

/** A file name without characters Windows or macOS refuse. */
export function safeFileName(name: string): string {
    const cleaned = name
        .replace(/[<>:"/\\|?*]/g, "_")
        .replace(/[. ]+$/, "")
        .trim();
    return cleaned.slice(0, 80) || "Repertoire";
}
