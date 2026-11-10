// Agreement to the terms of use and the privacy policy.
//
// The agreement is given before the account exists (registration, first
// Lichess sign-in), so it is first kept on this device ("pending") and
// written to users/{uid}/consents/{terms}_{privacy} as soon as the account
// is signed in. Those documents can only be created, never changed, so each
// agreed version stays on record with its server time.

import { PRIVACY_VERSION, TERMS_VERSION } from "@/legal/legal";
import { cloudFirestore } from "./auth";

export type ConsentMethod = "register" | "lichess" | "update";

export type PendingConsent = {
    terms: string;
    privacy: string;
    method: ConsentMethod;
    ageConfirmed: true;
    /** When the box was ticked, ms. */
    at: number;
};

const PENDING_KEY = "cloud-consent-pending";
/** A pending agreement only counts for a sign-in shortly after it. */
export const PENDING_MAX_AGE_MS = 60 * 60 * 1000;

export function consentDocId(terms = TERMS_VERSION, privacy = PRIVACY_VERSION): string {
    return `${terms}_${privacy}`;
}

export function rememberConsent(method: ConsentMethod, now = Date.now()) {
    const pending: PendingConsent = {
        terms: TERMS_VERSION,
        privacy: PRIVACY_VERSION,
        method,
        ageConfirmed: true,
        at: now,
    };
    try {
        localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
    } catch {}
}

export function forgetPendingConsent() {
    try {
        localStorage.removeItem(PENDING_KEY);
    } catch {}
}

/** A pending agreement to the current versions, if it is recent enough. */
export function parsePendingConsent(raw: string | null, now = Date.now()): PendingConsent | null {
    if (!raw) return null;
    try {
        const p = JSON.parse(raw) as Partial<PendingConsent>;
        if (
            p.terms !== TERMS_VERSION ||
            p.privacy !== PRIVACY_VERSION ||
            p.ageConfirmed !== true ||
            typeof p.at !== "number" ||
            now - p.at > PENDING_MAX_AGE_MS ||
            now < p.at ||
            (p.method !== "register" && p.method !== "lichess" && p.method !== "update")
        ) {
            return null;
        }
        return p as PendingConsent;
    } catch {
        return null;
    }
}

export function pendingConsent(now = Date.now()): PendingConsent | null {
    try {
        return parsePendingConsent(localStorage.getItem(PENDING_KEY), now);
    } catch {
        return null;
    }
}

async function consentRef(uid: string) {
    const { db, firestore } = await cloudFirestore();
    return { ref: firestore.doc(db, "users", uid, "consents", consentDocId()), firestore };
}

/** The account agreed to the current versions. */
export async function hasCurrentConsent(uid: string): Promise<boolean> {
    const { ref, firestore } = await consentRef(uid);
    return (await firestore.getDoc(ref)).exists();
}

/** Stores the agreement to the current versions (once per version). */
export async function saveConsent(uid: string, method: ConsentMethod, appVersion: string) {
    const { ref, firestore } = await consentRef(uid);
    if ((await firestore.getDoc(ref)).exists()) return;
    await firestore.setDoc(ref, {
        terms: TERMS_VERSION,
        privacy: PRIVACY_VERSION,
        method,
        ageConfirmed: true,
        appVersion: appVersion.slice(0, 32),
        acceptedAt: firestore.serverTimestamp(),
    });
}
