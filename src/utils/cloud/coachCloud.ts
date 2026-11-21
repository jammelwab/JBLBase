// Der Coach-Stand in der Cloud: users/{uid}/coach/state, dazu das vom Admin
// gepflegte Coach-Profil coachProfiles/{uid} (Geburtstag, Easter Eggs).
// Takes the Firestore module and database as a parameter (see firestoreDocs.ts).

import type { createStore } from "jotai";
import { coachProfileAtom, parseCoachProfile } from "@/components/coach/coachProfile";
import {
    applyLocal,
    coachSyncMarkAtom,
    mergeCoach,
    parseCloudState,
    readLocal,
} from "@/components/coach/coachSync";
import type { CloudFirestore } from "./firestoreDocs";

export async function syncCoachState(
    { db, firestore: fs }: CloudFirestore,
    uid: string,
    device: string,
    store: ReturnType<typeof createStore>,
    now = Date.now(),
): Promise<{ reads: number; writes: number }> {
    const ref = fs.doc(db, "users", uid, "coach", "state");
    const snap = await fs.getDoc(ref);
    const remote = snap.exists() ? parseCloudState(snap.data()) : null;
    const result = mergeCoach(readLocal(store), remote, store.get(coachSyncMarkAtom), device, now);
    if (result.write) {
        // Firestore nimmt kein undefined an
        const clean = JSON.parse(JSON.stringify(result.cloud));
        await fs.setDoc(ref, { ...clean, updatedAt: fs.serverTimestamp() });
    }
    applyLocal(store, result);
    return { reads: 1, writes: result.write ? 1 : 0 };
}

export async function fetchCoachProfile(
    { db, firestore: fs }: CloudFirestore,
    uid: string,
    store: ReturnType<typeof createStore>,
) {
    const snap = await fs.getDoc(fs.doc(db, "coachProfiles", uid));
    store.set(coachProfileAtom, parseCoachProfile(snap.exists() ? snap.data() : null));
}
