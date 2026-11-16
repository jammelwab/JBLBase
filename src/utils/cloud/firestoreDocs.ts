// Reading and writing the synced collections in Firestore. Takes the
// Firestore module and database as a parameter, so the same code runs in the
// app (firebase/firestore/lite) and against the emulator in the tests
// (firebase/tests/sync.test.mjs).

import type * as Firestore from "firebase/firestore/lite";
import { formatSyncCursor, parseSyncCursor } from "./cursor";
import {
    type PackedPgn,
    parseRemoteRepertoire,
    type RemoteRepertoire,
    type RemoteState,
} from "./repertoireSync";

export type CloudFirestore = { db: Firestore.Firestore; firestore: typeof Firestore };

/** Documents per query page. */
export const PAGE = 300;

/**
 * All documents of a collection written after the download position
 * `after` (see cursor.ts), page by page, and the position after the last one
 * (unchanged when there is nothing new).
 */
export async function fetchAfter(
    { db, firestore: fs }: CloudFirestore,
    uid: string,
    name: string,
    after: string | null,
    page = PAGE,
) {
    const col = fs.collection(db, "users", uid, name);
    const docs: { id: string; data: Record<string, unknown> }[] = [];
    let start = parseSyncCursor(after);
    let cursor = start ? formatSyncCursor(start.seconds, start.nanos, start.id) : null;
    for (;;) {
        const constraints: Firestore.QueryConstraint[] = [];
        if (start && start.id === "") {
            // A time only (a position from 1.0.28 or older).
            constraints.push(
                fs.where("syncedAt", ">", new fs.Timestamp(start.seconds, start.nanos)),
            );
        }
        constraints.push(fs.orderBy("syncedAt"), fs.orderBy(fs.documentId()));
        if (start && start.id !== "") {
            constraints.push(fs.startAfter(new fs.Timestamp(start.seconds, start.nanos), start.id));
        }
        constraints.push(fs.limit(page));
        const snap = await fs.getDocs(fs.query(col, ...constraints));
        const before = cursor;
        for (const d of snap.docs) {
            const data = d.data();
            docs.push({ id: d.id, data });
            const at = data.syncedAt;
            if (at instanceof fs.Timestamp) {
                cursor = formatSyncCursor(at.seconds, at.nanoseconds, d.id);
                start = { seconds: at.seconds, nanos: at.nanoseconds, id: d.id };
            }
        }
        if (snap.docs.length < page || cursor === before) break;
    }
    return { docs, cursor };
}

/** A document with its compressed content (Firestore bytes) as Uint8Array. */
function withBytes(
    { firestore: fs }: CloudFirestore,
    d: Record<string, unknown>,
): Record<string, unknown> {
    const { pgnGz, ...rest } = d;
    return pgnGz instanceof fs.Bytes ? { ...rest, pgnGz: pgnGz.toUint8Array() } : rest;
}

/** The cloud side of the repertoire sync (see RepertoireSyncBackend). */
export function cloudRepertoires(cf: CloudFirestore, uid: string) {
    const { db, firestore: fs } = cf;
    return {
        async fetchChanged(after: string | null) {
            const { docs, cursor } = await fetchAfter(cf, uid, "repertoires", after);
            const items: RemoteRepertoire[] = [];
            for (const d of docs) {
                const r = await parseRemoteRepertoire(d.id, withBytes(cf, d.data));
                if (r) items.push(r);
            }
            return { items, cursor };
        },
        async fetchOne(id: string) {
            const snap = await fs.getDoc(fs.doc(db, "users", uid, "repertoires", id));
            return snap.exists() ? parseRemoteRepertoire(id, withBytes(cf, snap.data())) : null;
        },
        async put(id: string, state: RemoteState & PackedPgn) {
            const content =
                "pgnGz" in state
                    ? { ...state, pgnGz: fs.Bytes.fromUint8Array(state.pgnGz) }
                    : state;
            await fs.setDoc(fs.doc(db, "users", uid, "repertoires", id), {
                ...content,
                syncedAt: fs.serverTimestamp(),
            });
        },
    };
}
