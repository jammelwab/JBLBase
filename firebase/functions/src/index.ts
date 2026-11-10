import { CloudBillingClient } from "@google-cloud/billing";
import { setGlobalOptions } from "firebase-functions/v2";
import { logger } from "firebase-functions/v2";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onMessagePublished } from "firebase-functions/v2/pubsub";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { budgetExceeded, parseNotification } from "./budget.js";
import { lichessListed, lichessUid, parseLichessAccount, parseToken } from "./lichess.js";

// All functions run in Frankfurt with at most one instance, so a bug or an
// attack can never scale up costs.
setGlobalOptions({ region: "europe-west3", maxInstances: 1 });

/** Pub/Sub topic the budget in Cloud Billing publishes to. */
export const BUDGET_TOPIC = "budget-alerts";

const billing = new CloudBillingClient();
initializeApp();

/**
 * Cost brake: when the monthly budget is used up, detach the billing
 * account from this project. Firestore and Functions then stop working
 * until billing is linked again by hand in the console.
 *
 * Set the environment variable BUDGET_GUARD_DRY_RUN=true to only log.
 */
export const budgetGuard = onMessagePublished(BUDGET_TOPIC, async (event) => {
    const notification = parseNotification(event.data.message.data);
    logger.info("Budget notification", notification);

    if (!budgetExceeded(notification)) return;

    const projectId = process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT;
    if (!projectId) {
        logger.error("Project id unknown, billing not changed");
        return;
    }
    const name = `projects/${projectId}`;

    const [info] = await billing.getProjectBillingInfo({ name });
    if (!info.billingEnabled) {
        logger.info("Billing already disabled");
        return;
    }

    if (process.env.BUDGET_GUARD_DRY_RUN === "true") {
        logger.warn("Budget exceeded, dry run: billing stays enabled");
        return;
    }

    await billing.updateProjectBillingInfo({
        name,
        projectBillingInfo: { billingAccountName: "" },
    });
    logger.warn(`Budget exceeded, billing disabled for ${projectId}`);
});

/**
 * Sign in with Lichess. The app sends the Lichess OAuth access token it got
 * from the normal Lichess login; this function asks Lichess whose token it
 * is and answers with a Firebase custom token for the uid "lichess:<id>".
 * The Lichess token is used once and never stored.
 *
 * Creating custom tokens needs the role "Service Account Token Creator" for
 * the function's service account (see SETUP.md).
 */
export const lichessLogin = onCall({ cors: true, timeoutSeconds: 15 }, async (request) => {
    const token = parseToken(request.data);
    if (!token) throw new HttpsError("invalid-argument", "Lichess token missing");

    const res = await fetch("https://lichess.org/api/account", {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 401) throw new HttpsError("unauthenticated", "Lichess token rejected");
    if (!res.ok) throw new HttpsError("unavailable", `Lichess answered ${res.status}`);

    const account = parseLichessAccount(await res.json());
    if (!account) throw new HttpsError("internal", "Unexpected Lichess answer");

    const uid = lichessUid(account);
    const auth = getAuth();

    // Private cloud: only listed accounts (or existing admins) get an account.
    const access = await getFirestore().doc("config/access").get();
    if (!lichessListed(access.data(), account)) {
        const existing = await auth.getUser(uid).catch(() => null);
        if (existing?.customClaims?.admin !== true) {
            logger.info("Lichess login refused, not on the allowlist");
            throw new HttpsError("permission-denied", "Account not on the allowlist");
        }
    }

    try {
        await auth.updateUser(uid, { displayName: account.username });
    } catch {
        await auth.createUser({ uid, displayName: account.username });
    }
    const customToken = await auth.createCustomToken(uid, { lichess: account.username });
    logger.info("Lichess login", { uid });
    return { token: customToken, username: account.username };
});

/**
 * Deletes the caller's account: everything below users/{uid} (profile,
 * repertoires, training, evaluations, consent records) and the Firebase
 * account itself. Runs on the server, so it works without a fresh sign-in
 * and also removes subcollections, which the app cannot list.
 */
export const deleteAccount = onCall({ cors: true, timeoutSeconds: 120 }, async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Not signed in");

    const db = getFirestore();
    await db.recursiveDelete(db.doc(`users/${uid}`));
    try {
        await getAuth().deleteUser(uid);
    } catch (e) {
        if ((e as { code?: string }).code !== "auth/user-not-found") throw e;
    }
    logger.info("Account deleted", { uid });
    return { deleted: true };
});
