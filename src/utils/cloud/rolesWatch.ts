// Rollen und Rechte live (1.2.31): Setzt ein Admin einem Konto neue Rechte,
// schreibt die Function adminSetPermissions roles/{uid}. Die App des Kontos
// hört auf dieses Dokument und erneuert ihr Token, sobald es neuer ist als
// das Token. So gelten neue Rechte sofort, ohne Ab- und Anmelden.
// Ein Listener kostet einen Lesezugriff beim Start und einen je Änderung.

import { cloudFirestoreLive, refreshTokenIfRolesChanged } from "./auth";

let current: { uid: string; stop: () => void } | null = null;

/** Hört auf roles/{uid} des angemeldeten Kontos; null hört auf. */
export function watchRoles(uid: string | null) {
    if (current?.uid === uid) return;
    current?.stop();
    current = null;
    if (!uid) return;
    let stopped = false;
    let unsubscribe: (() => void) | null = null;
    current = {
        uid,
        stop: () => {
            stopped = true;
            unsubscribe?.();
        },
    };
    void cloudFirestoreLive()
        .then(({ db, firestore }) => {
            if (stopped) return;
            unsubscribe = firestore.onSnapshot(
                firestore.doc(db, "roles", uid),
                (snap) => {
                    const at = snap.exists() ? snap.get("updatedAt") : null;
                    const millis =
                        at && typeof at.toMillis === "function" ? (at.toMillis() as number) : null;
                    void refreshTokenIfRolesChanged(uid, millis).catch(() => {});
                },
                // Regeln noch nicht deployt oder offline: Rechte gelten dann ab der nächsten Anmeldung
                () => {},
            );
        })
        .catch(() => {});
}
