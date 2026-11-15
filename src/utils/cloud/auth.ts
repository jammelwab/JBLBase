// JBLBase account (Firebase Auth).
//
// Sign-in methods:
// - E-mail and password.
// - Lichess: the app runs the normal Lichess OAuth login, sends the token to
//   the Cloud Function `lichessLogin` and signs in with the custom token it
//   returns (uid "lichess:<id>").
// Chess.com has no login for other apps; it is linked by username only and
// stored in the profile document users/{uid}.
//
// Firebase is loaded lazily, so the app starts as before for everyone who
// never opens the account settings.

import type { FirebaseApp } from "firebase/app";
import type { Auth, User } from "firebase/auth";
import i18n from "i18next";
import { trackUsage } from "../usageStats";
import { FIREBASE_REGION, firebaseConfig } from "./firebaseConfig";

export type CloudRole = "admin" | "user";

export type CloudProfile = {
    lichess?: string;
    chesscom?: string;
};

export type CloudAccount = {
    uid: string;
    email: string | null;
    emailVerified: boolean;
    /** "email" or "lichess", by how the account signs in. */
    method: "email" | "lichess";
    displayName: string | null;
    role: CloudRole;
};

let appPromise: Promise<FirebaseApp> | null = null;
let authPromise: Promise<Auth> | null = null;

function firebaseApp(): Promise<FirebaseApp> {
    appPromise ??= import("firebase/app").then(
        ({ getApps, initializeApp }) => getApps()[0] ?? initializeApp(firebaseConfig),
    );
    return appPromise;
}

/**
 * Auth without the popup/redirect helper: that one loads an iframe from the
 * auth domain, which the desktop app does not need.
 */
export function cloudAuth(): Promise<Auth> {
    authPromise ??= Promise.all([firebaseApp(), import("firebase/auth")]).then(
        ([app, { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence }]) =>
            initializeAuth(app, {
                persistence: [indexedDBLocalPersistence, browserLocalPersistence],
            }),
    );
    return authPromise;
}

/**
 * Firebase picks the e-mail template (verification, password reset) by this
 * language, so the mails come in the language the app is set to.
 */
function setMailLanguage(auth: Auth) {
    auth.languageCode = (i18n.language || "de").slice(0, 2);
}

export function isLichessUid(uid: string): boolean {
    return uid.startsWith("lichess:");
}

export async function toCloudAccount(user: User): Promise<CloudAccount> {
    const token = await user.getIdTokenResult();
    return {
        uid: user.uid,
        email: user.email,
        emailVerified: user.emailVerified,
        method: isLichessUid(user.uid) ? "lichess" : "email",
        displayName: user.displayName,
        role: token.claims.admin === true ? "admin" : "user",
    };
}

/** Calls `listener` with the signed-in account (or null) on every change. */
export async function watchCloudAccount(
    listener: (account: CloudAccount | null) => void,
): Promise<() => void> {
    const auth = await cloudAuth();
    const { onIdTokenChanged } = await import("firebase/auth");

    // The confirmation link is opened in the browser, so the app never hears
    // about it. While the address is unconfirmed, ask Firebase again when the
    // window gets focus and every few seconds; a fresh token then reports the
    // new state through onIdTokenChanged.
    let timer: ReturnType<typeof setInterval> | null = null;
    const checkVerified = async () => {
        const user = auth.currentUser;
        if (!user || user.emailVerified || !user.email) return;
        try {
            await user.reload();
            if (user.emailVerified) await user.getIdToken(true);
        } catch {}
    };
    const watchVerification = (pending: boolean) => {
        if (pending && !timer) {
            timer = setInterval(() => void checkVerified(), VERIFY_POLL_MS);
            window.addEventListener("focus", checkVerified);
        } else if (!pending && timer) {
            clearInterval(timer);
            timer = null;
            window.removeEventListener("focus", checkVerified);
        }
    };

    const unsubscribe = onIdTokenChanged(auth, async (user) => {
        watchVerification(!!user && !!user.email && !user.emailVerified);
        listener(user ? await toCloudAccount(user) : null);
    });
    return () => {
        watchVerification(false);
        unsubscribe();
    };
}

/** How often an unconfirmed e-mail address is checked again. */
const VERIFY_POLL_MS = 10_000;

export async function signInWithEmail(email: string, password: string) {
    const auth = await cloudAuth();
    const { signInWithEmailAndPassword } = await import("firebase/auth");
    await signInWithEmailAndPassword(auth, email.trim(), password);
    trackUsage("login", { method: "email" });
}

export async function registerWithEmail(email: string, password: string) {
    const auth = await cloudAuth();
    const { createUserWithEmailAndPassword } = await import("firebase/auth");
    await createUserWithEmailAndPassword(auth, email.trim(), password);
    await sendVerification().catch(() => {});
    trackUsage("sign_up", { method: "email" });
}

export async function resetPassword(email: string) {
    try {
        await callMailFunction("sendPasswordResetMail", { email: email.trim() });
    } catch (e) {
        if (!useStandardMail(e)) throw e;
        const auth = await cloudAuth();
        const { sendPasswordResetEmail } = await import("firebase/auth");
        setMailLanguage(auth);
        await sendPasswordResetEmail(auth, email.trim());
    }
}

export async function resendVerification() {
    await sendVerification();
}

/**
 * The confirmation mail in the JBLBase design (Cloud Function
 * `sendVerificationMail`), or Firebase's standard mail while the function
 * is not deployed or not set up.
 */
async function sendVerification() {
    const auth = await cloudAuth();
    if (!auth.currentUser) return;
    try {
        await callMailFunction("sendVerificationMail", {});
    } catch (e) {
        if (!useStandardMail(e)) throw e;
        const { sendEmailVerification } = await import("firebase/auth");
        setMailLanguage(auth);
        await sendEmailVerification(auth.currentUser);
    }
}

async function callMailFunction(name: string, data: Record<string, string>) {
    const app = await firebaseApp();
    const { getFunctions, httpsCallable } = await import("firebase/functions");
    const lang = (i18n.language || "de").slice(0, 2);
    await httpsCallable(getFunctions(app, FIREBASE_REGION), name, { timeout: 20_000 })({
        ...data,
        lang,
    });
}

/**
 * Own mail not available (function missing, mail service not set up or
 * failing): send Firebase's standard mail instead. Rate limits and invalid
 * input are passed on.
 */
function useStandardMail(error: unknown): boolean {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    return !["functions/resource-exhausted", "functions/invalid-argument"].includes(code);
}

/** Signs in with a Lichess OAuth access token (see `lichessLogin`). */
export async function signInWithLichessToken(
    lichessToken: string,
): Promise<{ uid: string; username: string }> {
    const [app, auth] = await Promise.all([firebaseApp(), cloudAuth()]);
    const [{ getFunctions, httpsCallable }, { signInWithCustomToken }] = await Promise.all([
        import("firebase/functions"),
        import("firebase/auth"),
    ]);
    const login = httpsCallable<{ token: string }, { token: string; username: string }>(
        getFunctions(app, FIREBASE_REGION),
        "lichessLogin",
    );
    const { data } = await login({ token: lichessToken });
    const { user } = await signInWithCustomToken(auth, data.token);
    trackUsage("login", { method: "lichess" });
    return { uid: user.uid, username: data.username };
}

/**
 * Deletes the signed-in account and all its cloud data (Cloud Function
 * `deleteAccount`), then signs out. Files on this device stay.
 */
export async function deleteCloudAccount() {
    const [app, auth] = await Promise.all([firebaseApp(), cloudAuth()]);
    const [{ getFunctions, httpsCallable }, { signOut }] = await Promise.all([
        import("firebase/functions"),
        import("firebase/auth"),
    ]);
    await httpsCallable(getFunctions(app, FIREBASE_REGION), "deleteAccount", {
        timeout: 120_000,
    })();
    await signOut(auth);
}

export async function signOutCloud() {
    const auth = await cloudAuth();
    const { signOut } = await import("firebase/auth");
    await signOut(auth);
}

/** Firestore (lite: no live updates, smaller) and its functions. */
export async function cloudFirestore() {
    const [app, firestore] = await Promise.all([firebaseApp(), import("firebase/firestore/lite")]);
    return { db: firestore.getFirestore(app), firestore };
}

async function profileRef(uid: string) {
    const [app, { doc, getFirestore }] = await Promise.all([
        firebaseApp(),
        import("firebase/firestore/lite"),
    ]);
    return doc(getFirestore(app), "users", uid);
}

export function parseProfile(data: unknown): CloudProfile {
    const profile: CloudProfile = {};
    if (!data || typeof data !== "object") return profile;
    const { lichess, chesscom } = data as Record<string, unknown>;
    if (typeof lichess === "string" && lichess) profile.lichess = lichess;
    if (typeof chesscom === "string" && chesscom) profile.chesscom = chesscom;
    return profile;
}

export async function loadProfile(uid: string): Promise<CloudProfile> {
    const ref = await profileRef(uid);
    const { getDoc } = await import("firebase/firestore/lite");
    const snap = await getDoc(ref);
    return parseProfile(snap.data());
}

/** Saves linked usernames. An empty string removes the link. */
export async function saveProfile(uid: string, changes: CloudProfile) {
    const ref = await profileRef(uid);
    const { deleteField, serverTimestamp, setDoc } = await import("firebase/firestore/lite");
    const data: Record<string, unknown> = { updatedAt: serverTimestamp() };
    for (const key of ["lichess", "chesscom"] as const) {
        if (!(key in changes)) continue;
        const value = changes[key]?.trim();
        data[key] = value ? value : deleteField();
    }
    await setDoc(ref, data, { merge: true });
}

/** Chess.com usernames: letters, digits, "_" and "-", 3 to 25 characters. */
export function normalizeChessComUsername(input: string): string | null {
    const name = input.trim();
    return /^[A-Za-z0-9_-]{3,25}$/.test(name) ? name : null;
}

/** Translation key for a Firebase error, so users see a clear message. */
export function cloudErrorKey(error: unknown): string {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    switch (code) {
        case "auth/invalid-email":
            return "Settings.Cloud.Error.InvalidEmail";
        case "auth/invalid-credential":
        case "auth/wrong-password":
        case "auth/user-not-found":
            return "Settings.Cloud.Error.WrongCredentials";
        case "auth/email-already-in-use":
            return "Settings.Cloud.Error.EmailInUse";
        case "auth/weak-password":
            return "Settings.Cloud.Error.WeakPassword";
        case "auth/too-many-requests":
        case "functions/resource-exhausted":
            return "Settings.Cloud.Error.TooManyRequests";
        case "auth/network-request-failed":
        case "functions/unavailable":
            return "Settings.Cloud.Error.Network";
        case "functions/unauthenticated":
            return "Settings.Cloud.Error.LichessRejected";
        case "functions/permission-denied":
        case "permission-denied":
            return "Settings.Cloud.Error.NotAllowed";
        case "functions/not-found":
            return "Settings.Cloud.Error.NotDeployed";
        case "chesscom/invalid":
            return "Settings.Cloud.Error.ChessComInvalid";
        default:
            return "Settings.Cloud.Error.Unknown";
    }
}
