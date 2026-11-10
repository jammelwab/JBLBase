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
    return onIdTokenChanged(auth, async (user) => {
        listener(user ? await toCloudAccount(user) : null);
    });
}

export async function signInWithEmail(email: string, password: string) {
    const auth = await cloudAuth();
    const { signInWithEmailAndPassword } = await import("firebase/auth");
    await signInWithEmailAndPassword(auth, email.trim(), password);
}

export async function registerWithEmail(email: string, password: string) {
    const auth = await cloudAuth();
    const { createUserWithEmailAndPassword, sendEmailVerification } = await import("firebase/auth");
    const { user } = await createUserWithEmailAndPassword(auth, email.trim(), password);
    await sendEmailVerification(user).catch(() => {});
}

export async function resetPassword(email: string) {
    const auth = await cloudAuth();
    const { sendPasswordResetEmail } = await import("firebase/auth");
    await sendPasswordResetEmail(auth, email.trim());
}

export async function resendVerification() {
    const auth = await cloudAuth();
    const { sendEmailVerification } = await import("firebase/auth");
    if (auth.currentUser) await sendEmailVerification(auth.currentUser);
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
    return { uid: user.uid, username: data.username };
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
            return "Settings.Cloud.Error.TooManyRequests";
        case "auth/network-request-failed":
        case "functions/unavailable":
            return "Settings.Cloud.Error.Network";
        case "functions/unauthenticated":
            return "Settings.Cloud.Error.LichessRejected";
        case "chesscom/invalid":
            return "Settings.Cloud.Error.ChessComInvalid";
        default:
            return "Settings.Cloud.Error.Unknown";
    }
}
