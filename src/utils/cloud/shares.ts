// Sharing a repertoire with another account (#120). A share is a copy of one
// repertoire in shares/{id}, meant for one recipient: an e-mail address or a
// Lichess name. Only the owner and that recipient can read it (see
// firebase/firestore.rules). The owner's app sends a new version whenever the
// repertoire changes; the recipient's app keeps a local file of it up to date
// once the share is accepted. Withdrawing deletes the share; the recipient
// keeps the version received last, without further updates.
//
// The Firestore module is a parameter (as in firestoreDocs.ts), so the same
// code runs in the app and against the emulator.

import type { CloudFirestore } from "./firestoreDocs";
import { type PackedPgn, packPgn, unpackPgn } from "./repertoireSync";

export type ShareStatus = "pending" | "accepted";

export type Share = {
    id: string;
    ownerUid: string;
    ownerName: string;
    recipientKey: string;
    // The repertoire's cloud id (its .info "id")
    sourceId: string;
    name: string;
    color: "white" | "black";
    hash: string;
    status: ShareStatus;
    recipientUid?: string;
    updatedAt?: number;
};

export type ShareWithPgn = Share & { pgn: string };

/** Who a share is for, from what the owner typed: an e-mail address or a Lichess name. */
export function parseRecipient(input: string): string | null {
    const value = input.trim().toLowerCase();
    if (!value || value.length > 200 || /\s/.test(value)) return null;
    if (value.includes("@")) {
        return /^[^@]+@[^@]+\.[^@]+$/.test(value) ? `email:${value}` : null;
    }
    // Lichess names: 2 to 30 letters, digits, "_" and "-"
    const name = value.replace(/^lichess:/, "");
    return /^[a-z0-9][a-z0-9_-]{1,29}$/.test(name) ? `lichess:${name}` : null;
}

/** The recipient as shown in the app ("aaron@example.org", "Lichess: aaron"). */
export function recipientLabel(key: string): string {
    if (key.startsWith("email:")) return key.slice("email:".length);
    if (key.startsWith("lichess:")) return `Lichess: ${key.slice("lichess:".length)}`;
    return key;
}

/** The keys shares for this account are filed under (see isShareRecipient in the rules). */
export function ownRecipientKeys(account: {
    email: string | null;
    emailVerified: boolean;
    method: "email" | "lichess";
    displayName: string | null;
}): string[] {
    const keys: string[] = [];
    if (account.email && account.emailVerified) keys.push(`email:${account.email.toLowerCase()}`);
    if (account.method === "lichess" && account.displayName) {
        keys.push(`lichess:${account.displayName.toLowerCase()}`);
    }
    return keys;
}

/** Fingerprint of what the recipient gets, to send only real changes. */
export async function shareHash(name: string, color: string, pgn: string): Promise<string> {
    const data = new TextEncoder().encode(`${name}\n${color}\n${pgn}`);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function parseShare(id: string, d: Record<string, unknown>): Share | null {
    if (
        typeof d.ownerUid !== "string" ||
        typeof d.recipientKey !== "string" ||
        typeof d.sourceId !== "string" ||
        typeof d.name !== "string" ||
        (d.color !== "white" && d.color !== "black") ||
        (d.status !== "pending" && d.status !== "accepted")
    ) {
        return null;
    }
    const at = d.updatedAt as { toMillis?: () => number } | undefined;
    return {
        id,
        ownerUid: d.ownerUid,
        ownerName: typeof d.ownerName === "string" ? d.ownerName : "?",
        recipientKey: d.recipientKey,
        sourceId: d.sourceId,
        name: d.name,
        color: d.color,
        hash: typeof d.hash === "string" ? d.hash : "",
        status: d.status,
        recipientUid: typeof d.recipientUid === "string" ? d.recipientUid : undefined,
        updatedAt: typeof at?.toMillis === "function" ? at.toMillis() : undefined,
    };
}

export type ShareContent = {
    ownerName: string;
    name: string;
    color: "white" | "black";
    pgn: string;
};

export function cloudShares({ db, firestore: fs }: CloudFirestore) {
    const col = () => fs.collection(db, "shares");
    const content = async (c: ShareContent) => {
        const packed: PackedPgn | null = await packPgn(c.pgn);
        if (!packed) throw new Error("too-big");
        const body = "pgnGz" in packed ? { pgnGz: fs.Bytes.fromUint8Array(packed.pgnGz) } : packed;
        return {
            ownerName: c.ownerName.slice(0, 80) || "?",
            name: c.name.slice(0, 200),
            color: c.color,
            hash: await shareHash(c.name, c.color, c.pgn),
            ...body,
            updatedAt: fs.serverTimestamp(),
        };
    };
    const withPgn = async (id: string, d: Record<string, unknown>) => {
        const share = parseShare(id, d);
        if (!share) return null;
        const gz = d.pgnGz instanceof fs.Bytes ? d.pgnGz.toUint8Array() : undefined;
        const pgn = await unpackPgn({ pgn: d.pgn, pgnGz: gz });
        return pgn === null ? null : { ...share, pgn };
    };
    return {
        /** Shares this account made, with or without content. */
        async listOwn(uid: string): Promise<Share[]> {
            const snap = await fs.getDocs(fs.query(col(), fs.where("ownerUid", "==", uid)));
            return snap.docs.map((d) => parseShare(d.id, d.data())).filter((s): s is Share => !!s);
        },
        /** Shares for this account (all of its addresses), with content. */
        async listIncoming(keys: string[]): Promise<ShareWithPgn[]> {
            const out: ShareWithPgn[] = [];
            for (const key of keys) {
                const snap = await fs.getDocs(fs.query(col(), fs.where("recipientKey", "==", key)));
                for (const d of snap.docs) {
                    const share = await withPgn(d.id, d.data());
                    if (share && !out.some((s) => s.id === share.id)) out.push(share);
                }
            }
            return out;
        },
        async create(uid: string, recipientKey: string, sourceId: string, c: ShareContent) {
            const ref = fs.doc(col());
            await fs.setDoc(ref, {
                ownerUid: uid,
                recipientKey,
                sourceId,
                status: "pending",
                createdAt: fs.serverTimestamp(),
                ...(await content(c)),
            });
            return ref.id;
        },
        /** A new version of the repertoire; the field not used any more goes. */
        async update(id: string, c: ShareContent) {
            const body = await content(c);
            await fs.updateDoc(fs.doc(db, "shares", id), {
                ...body,
                ...("pgnGz" in body ? { pgn: fs.deleteField() } : { pgnGz: fs.deleteField() }),
            });
        },
        async accept(id: string, uid: string) {
            await fs.updateDoc(fs.doc(db, "shares", id), { status: "accepted", recipientUid: uid });
        },
        /** Withdraw (owner) or decline (recipient). */
        async remove(id: string) {
            await fs.deleteDoc(fs.doc(db, "shares", id));
        },
    };
}

export type CloudShares = ReturnType<typeof cloudShares>;
