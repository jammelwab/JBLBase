import { CloudBillingClient } from "@google-cloud/billing";
import { setGlobalOptions } from "firebase-functions/v2";
import { logger } from "firebase-functions/v2";
import { createHash } from "node:crypto";
import { createTransport } from "nodemailer";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onMessagePublished } from "firebase-functions/v2/pubsub";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { budgetExceeded, parseNotification } from "./budget.js";
import { type MailKind, maySend, parseEmail, parseLang, renderMail } from "./mail.js";
import { lichessListed, lichessUid, parseLichessAccount, parseToken } from "./lichess.js";
import Anthropic from "@anthropic-ai/sdk";
import {
    EXPLAIN_DAILY_LIMIT,
    EXPLAIN_DEEP_MAX_TOKENS,
    EXPLAIN_MAX_TOKENS,
    EXPLAIN_MODEL,
    EXPLAIN_SYSTEM,
    eventPrompt,
    explainPrompt,
    isMember,
    nextUsage,
    parseEventRequest,
    parseExplainRequest,
    parseReportRequest,
    REPORT_MAX_TOKENS,
    REPORT_SYSTEM,
    reportPrompt,
    SAY_DAILY_LIMIT,
    SAY_MAX_TOKENS,
    SAY_SYSTEM,
    trimAnswer,
} from "./explain.js";
import { cacheKey, eventKey, reportKey } from "./explainKey.js";

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
    // Shared repertoires (#120): the account's own shares, the ones it accepted, and
    // invitations still waiting for one of its addresses
    const token: Record<string, unknown> = request.auth?.token ?? {};
    const keys = [
        token.email && token.email_verified ? `email:${String(token.email).toLowerCase()}` : null,
        typeof token.lichess === "string" ? `lichess:${token.lichess.toLowerCase()}` : null,
    ].filter((k): k is string => !!k);
    const shares = db.collection("shares");
    const found = [
        await shares.where("ownerUid", "==", uid).get(),
        await shares.where("recipientUid", "==", uid).get(),
        ...(await Promise.all(keys.map((k) => shares.where("recipientKey", "==", k).get()))),
    ];
    const refs = new Map(found.flatMap((q) => q.docs.map((d) => [d.id, d.ref] as const)));
    await Promise.all([...refs.values()].map((ref) => ref.delete()));
    try {
        await getAuth().deleteUser(uid);
    } catch (e) {
        if ((e as { code?: string }).code !== "auth/user-not-found") throw e;
    }
    logger.info("Account deleted", { uid });
    return { deleted: true };
});

// ---------------------------------------------------------------------------
// Own e-mails (confirmation, password reset) in the JBLBase design.
//
// Firebase does not allow changing the text of its own mails, so these are
// sent by SMTP from a normal mailbox (default: GMX, mail.gmx.net:587).
// Two secrets are needed, set in the Cloud Shell, never in the repository:
//   firebase functions:secrets:set SMTP_USER       (mailbox address)
//   firebase functions:secrets:set SMTP_PASSWORD   (mailbox password)
// Set both before deploying these functions. As long as they are not
// deployed, the app falls back to Firebase's standard mails.

const SMTP_USER = defineSecret("SMTP_USER");
const SMTP_PASSWORD = defineSecret("SMTP_PASSWORD");
/** Another provider: set SMTP_HOST / SMTP_PORT as environment variables. */
const SMTP_HOST = process.env.SMTP_HOST ?? "mail.gmx.net";
const SMTP_PORT = Number(process.env.SMTP_PORT ?? 587);

/**
 * Remembers when a mail of this kind last went to this address and refuses
 * a new one within MAIL_INTERVAL_MS. Keyed by a hash, so the collection
 * holds no addresses. Clients cannot read or write mailLimits (rules).
 */
async function claimMailSlot(kind: MailKind, email: string) {
    const id = createHash("sha256").update(`${kind}\n${email}`).digest("hex");
    const ref = getFirestore().doc(`mailLimits/${id}`);
    const now = Date.now();
    const allowed = await getFirestore().runTransaction(async (tx) => {
        const last = (await tx.get(ref)).get("sentAt") as number | undefined;
        if (!maySend(last, now)) return false;
        tx.set(ref, { sentAt: now });
        return true;
    });
    if (!allowed) throw new HttpsError("resource-exhausted", "Please wait a minute");
}

async function sendMail(kind: MailKind, data: unknown, email: string, link: string) {
    const user = SMTP_USER.value();
    const pass = SMTP_PASSWORD.value();
    if (!user || !pass) throw new HttpsError("failed-precondition", "Mail sending not set up");
    const mail = renderMail(kind, parseLang(data), { email, link });
    const transport = createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_PORT === 465,
        requireTLS: SMTP_PORT !== 465,
        auth: { user, pass },
        connectionTimeout: 10_000,
    });
    try {
        await transport.sendMail({
            from: { name: "JBLBase", address: user },
            to: email,
            subject: mail.subject,
            html: mail.html,
            text: mail.text,
        });
    } catch (e) {
        logger.error("SMTP refused the mail", { kind, error: String(e) });
        throw new HttpsError("unavailable", "Mail could not be sent");
    } finally {
        transport.close();
    }
    logger.info("Mail sent", { kind });
}

/** Sends the caller the confirmation mail for their e-mail address. */
export const sendVerificationMail = onCall(
    { cors: true, timeoutSeconds: 20, secrets: [SMTP_USER, SMTP_PASSWORD] },
    async (request) => {
        const uid = request.auth?.uid;
        if (!uid) throw new HttpsError("unauthenticated", "Not signed in");
        const user = await getAuth().getUser(uid);
        if (!user.email || user.emailVerified) return { sent: false };
        const email = user.email.toLowerCase();
        await claimMailSlot("verify", email);
        const link = await getAuth().generateEmailVerificationLink(email);
        await sendMail("verify", request.data, email, link);
        return { sent: true };
    },
);

/**
 * Sends the password reset mail. Answers the same whether or not the address
 * has an account, so nobody can find out which addresses are registered.
 */
export const sendPasswordResetMail = onCall(
    { cors: true, timeoutSeconds: 20, secrets: [SMTP_USER, SMTP_PASSWORD] },
    async (request) => {
        const email = parseEmail(request.data);
        if (!email) throw new HttpsError("invalid-argument", "Invalid e-mail address");
        await claimMailSlot("reset", email);
        const user = await getAuth()
            .getUserByEmail(email)
            .catch(() => null);
        if (!user) return { sent: true };
        const link = await getAuth().generatePasswordResetLink(email);
        await sendMail("reset", request.data, email, link);
        return { sent: true };
    },
);

// ---------- JBL Coach: „Warum?“ (1.2.9) ----------
//
// Claude Haiku formuliert die Fakten aus Stockfish. Der Schlüssel liegt als
// Secret in Firebase, nie in der App:
//   firebase functions:secrets:set ANTHROPIC_API_KEY
// Antworten werden in coachExplanations/{key} gemerkt (Stellung, Zug,
// Lernstufe, Sprache), das Tageslimit steht in coachExplainUsage/{uid}.
// Beide Sammlungen sind für die App gesperrt, nur diese Funktion schreibt.

const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");

export const coachExplain = onCall(
    // minInstances 0: kalt dauert der erste Spruch etwas länger, die App wartet höchstens 4 s
    { cors: true, timeoutSeconds: 30, secrets: [ANTHROPIC_API_KEY] },
    async (request) => {
        const auth = request.auth;
        if (!auth) throw new HttpsError("unauthenticated", "Not signed in");
        const report = parseReportRequest(request.data);
        const event = report ? null : parseEventRequest(request.data);
        const req = report || event ? null : parseExplainRequest(request.data);
        if (!report && !event && !req) throw new HttpsError("invalid-argument", "Bad request");

        const db = getFirestore();
        const access = await db.doc("config/access").get();
        if (!isMember(auth.token, access.data())) {
            throw new HttpsError("permission-denied", "Not a member");
        }

        const key = report ? reportKey(report) : event ? eventKey(event) : cacheKey(req!);
        const cached = await db.doc(`coachExplanations/${key}`).get();
        const cachedText = cached.data()?.text;
        if (typeof cachedText === "string" && cachedText) {
            return { text: cachedText, cached: true };
        }

        // Nur neue Antworten zählen zum Tageslimit. Kurze Sprüche während der
        // Partie (say, event) haben ein eigenes, höheres Limit.
        // Bericht und kurze Sprüche zählen zum hohen Limit
        const short = report !== null || event !== null || req!.mode === "say";
        const day = new Date().toISOString().slice(0, 10);
        const usageRef = db.doc(`${short ? "coachSayUsage" : "coachExplainUsage"}/${auth.uid}`);
        const allowed = await db.runTransaction(async (tx) => {
            const next = nextUsage(
                (await tx.get(usageRef)).data(),
                day,
                short ? SAY_DAILY_LIMIT : EXPLAIN_DAILY_LIMIT,
            );
            if (next.allowed) tx.set(usageRef, next.usage);
            return next.allowed;
        });
        if (!allowed) throw new HttpsError("resource-exhausted", "Daily limit reached");

        const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });
        const response = await client.messages.create({
            model: EXPLAIN_MODEL,
            max_tokens: report
                ? REPORT_MAX_TOKENS
                : short
                  ? SAY_MAX_TOKENS
                  : req!.mode === "deep"
                    ? EXPLAIN_DEEP_MAX_TOKENS
                    : EXPLAIN_MAX_TOKENS,
            // Wenig Denkaufwand: nur formulieren, nicht rechnen
            thinking: { type: "disabled" },
            output_config: { effort: "low" },
            system: report ? REPORT_SYSTEM : short ? SAY_SYSTEM : EXPLAIN_SYSTEM,
            messages: [
                {
                    role: "user",
                    content: report
                        ? reportPrompt(report)
                        : event
                          ? eventPrompt(event)
                          : explainPrompt(req!),
                },
            ],
        });
        if (response.stop_reason === "refusal") {
            throw new HttpsError("unavailable", "No explanation");
        }
        const text = trimAnswer(
            response.content
                .filter((b) => b.type === "text")
                .map((b) => b.text)
                .join(" "),
            report ? 900 : short ? 240 : req!.mode === "deep" ? 1400 : 600,
        );
        if (!text) throw new HttpsError("unavailable", "No explanation");

        await db.doc(`coachExplanations/${key}`).set({
            text,
            model: EXPLAIN_MODEL,
            createdAt: new Date(),
        });
        logger.info("Coach explanation", {
            uid: auth.uid,
            input: response.usage.input_tokens,
            output: response.usage.output_tokens,
        });
        return { text, cached: false };
    },
);
