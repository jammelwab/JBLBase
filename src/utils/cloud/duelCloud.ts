// Duell-Partien zwischen zwei Rivalen (1.2.7): duels/{id}. Jeder Zug wird
// in das gemeinsame Dokument geschrieben; der andere sieht ihn sofort über
// den Live-Listener. Nur die beiden Spieler lesen und schreiben.

import type * as Firestore from "firebase/firestore";
import {
    type Duel,
    type DuelReason,
    type DuelResult,
    parseDuel,
} from "@/components/coach/coachDuel";

export type DuelFirestore = { db: Firestore.Firestore; firestore: typeof Firestore };

// Höchstens so viele Duelle hört die App mit
const DUEL_LIMIT = 50;

export function listenDuels(
    { db, firestore: fs }: DuelFirestore,
    uid: string,
    onChange: (duels: Duel[]) => void,
    onError: (e: unknown) => void,
): () => void {
    const q = fs.query(
        fs.collection(db, "duels"),
        fs.where("players", "array-contains", uid),
        fs.limit(DUEL_LIMIT),
    );
    return fs.onSnapshot(
        q,
        (snap) => {
            const duels = snap.docs
                .map((d) => parseDuel(d.id, d.data()))
                .filter((d): d is Duel => d !== null)
                .sort((a, b) => b.updatedAt - a.updatedAt);
            onChange(duels);
        },
        onError,
    );
}

export async function createDuel(
    { db, firestore: fs }: DuelFirestore,
    me: { uid: string; name: string },
    rival: { uid: string; name: string },
    meWhite: boolean,
): Promise<string> {
    const ref = fs.doc(fs.collection(db, "duels"));
    await fs.setDoc(ref, {
        players: [me.uid, rival.uid],
        white: meWhite ? me.uid : rival.uid,
        black: meWhite ? rival.uid : me.uid,
        names: { [me.uid]: me.name, [rival.uid]: rival.name },
        moves: [],
        result: "*",
        reason: null,
        createdAt: fs.serverTimestamp(),
        updatedAt: fs.serverTimestamp(),
    });
    return ref.id;
}

export async function updateDuel(
    { db, firestore: fs }: DuelFirestore,
    id: string,
    moves: string[],
    result: DuelResult,
    reason: DuelReason | null,
) {
    await fs.updateDoc(fs.doc(db, "duels", id), {
        moves,
        result,
        reason,
        updatedAt: fs.serverTimestamp(),
    });
}
