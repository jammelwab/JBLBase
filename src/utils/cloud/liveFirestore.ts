// The Firestore side of the live sync (see liveSync.ts). Takes the Firestore
// module and database as a parameter, so the same code runs in the app
// (firebase/firestore) and against the emulator in the tests
// (firebase/tests/sync.test.mjs).

import type * as Firestore from "firebase/firestore";
import type { SyncCursor } from "./cursor";
import type { LiveBackend } from "./liveSync";

export type LiveFirestore = { db: Firestore.Firestore; firestore: typeof Firestore };

/** Listens for documents of users/{uid}/{name} written after `after`. */
export function listenAfter({ db, firestore: fs }: LiveFirestore): LiveBackend["listen"] {
    return (uid, name, after: SyncCursor | null, onNew, onError) => {
        const col = fs.collection(db, "users", uid, name);
        const constraints: Firestore.QueryConstraint[] = [];
        // Strictly later than the position: everything up to it, including
        // documents with the same time, has been read by the last run.
        if (after) {
            constraints.push(
                fs.where("syncedAt", ">", new fs.Timestamp(after.seconds, after.nanos)),
            );
        }
        constraints.push(fs.orderBy("syncedAt"), fs.limit(1));
        return fs.onSnapshot(
            fs.query(col, ...constraints),
            (snap) => {
                if (!snap.empty) onNew();
            },
            onError,
        );
    };
}
