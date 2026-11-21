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
import type { BookMove } from "@/bindings";
import { coachBossBookAtom, packBossBook, unpackBossBook } from "@/components/coach/coachBoss";
import { coachRivalAtom, coachRivalMarkAtom, parseRival } from "@/components/coach/coachDuel";
import { coachXpAtom, levelProgress } from "@/components/coach/coachState";
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

// Boss-Buch (1.2.7): bossBook/main, alle Mitglieder lesen, nur Admins schreiben.
export async function fetchBossBook(
    { db, firestore: fs }: CloudFirestore,
    store: ReturnType<typeof createStore>,
) {
    const snap = await fs.getDoc(fs.doc(db, "bossBook", "main"));
    store.set(coachBossBookAtom, snap.exists() ? unpackBossBook(snap.data()) : []);
}

export async function uploadBossBook({ db, firestore: fs }: CloudFirestore, book: BookMove[]) {
    await fs.setDoc(fs.doc(db, "bossBook", "main"), {
        moves: packBossBook(book),
        count: book.length,
        updatedAt: fs.serverTimestamp(),
    });
}

// Duell (1.2.7): das eigene Level für den Rivalen veröffentlichen
// (coachRivals/{uid}) und das Level des Rivalen lesen. Nur mit Rivale im
// Coach-Profil.
export async function syncRival(
    { db, firestore: fs }: CloudFirestore,
    uid: string,
    store: ReturnType<typeof createStore>,
): Promise<{ reads: number; writes: number }> {
    const profile = store.get(coachProfileAtom);
    if (!profile.rival) {
        if (store.get(coachRivalAtom)) store.set(coachRivalAtom, null);
        return { reads: 0, writes: 0 };
    }
    const xp = store.get(coachXpAtom);
    const level = levelProgress(xp).level;
    const name = profile.name ?? "";
    const mark = `${level}|${xp}|${name}`;
    let writes = 0;
    if (store.get(coachRivalMarkAtom) !== mark) {
        await fs.setDoc(fs.doc(db, "coachRivals", uid), {
            level,
            xp,
            name,
            updatedAt: fs.serverTimestamp(),
        });
        store.set(coachRivalMarkAtom, mark);
        writes = 1;
    }
    const snap = await fs.getDoc(fs.doc(db, "coachRivals", profile.rival));
    store.set(coachRivalAtom, snap.exists() ? parseRival(profile.rival, snap.data()) : null);
    return { reads: 1, writes };
}
