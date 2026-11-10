// E-mails JBLBase sends itself (instead of Firebase's fixed default text):
// address confirmation and password reset. The links come from the Admin SDK
// (generateEmailVerificationLink / generatePasswordResetLink) and lead to the
// normal Firebase action page.

export type MailKind = "verify" | "reset";
export type MailLang = "de" | "en";

/** At most one mail of a kind per address in this time. */
export const MAIL_INTERVAL_MS = 60_000;

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

/** The e-mail address in a request; null when missing or malformed. */
export function parseEmail(data: unknown): string | null {
    if (!data || typeof data !== "object") return null;
    const email = (data as { email?: unknown }).email;
    if (typeof email !== "string") return null;
    const trimmed = email.trim().toLowerCase();
    return trimmed.length <= 320 && EMAIL.test(trimmed) ? trimmed : null;
}

/** Language of the mail; German unless the app asks for English. */
export function parseLang(data: unknown): MailLang {
    if (!data || typeof data !== "object") return "de";
    const lang = (data as { lang?: unknown }).lang;
    return typeof lang === "string" && lang.toLowerCase().startsWith("en") ? "en" : "de";
}

/** Whether another mail may go out, given when the last one was sent. */
export function maySend(lastSentMs: number | undefined, nowMs: number): boolean {
    return lastSentMs === undefined || nowMs - lastSentMs >= MAIL_INTERVAL_MS;
}

export function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

type Texts = {
    subject: string;
    title: string;
    hello: string;
    intro: (email: string) => string;
    button: string;
    fallback: string;
    ignore: string;
};

const TEXTS: Record<MailKind, Record<MailLang, Texts>> = {
    verify: {
        de: {
            subject: "Bestätige deine E-Mail-Adresse für JBLBase",
            title: "Bitte bestätige deine E-Mail-Adresse",
            hello: "Hallo,",
            intro: (email) =>
                `schön, dass du dabei bist! Du hast mit <strong>${email}</strong> ein JBLBase-Konto erstellt. Bestätige deine Adresse, damit deine Repertoires und dein Training sicher auf all deinen Geräten synchronisiert werden.`,
            button: "E-Mail-Adresse bestätigen",
            fallback: "Falls der Knopf nicht funktioniert, kopiere diesen Link in deinen Browser:",
            ignore: "Du hast kein Konto erstellt? Dann kannst du diese E-Mail einfach ignorieren, es passiert nichts.",
        },
        en: {
            subject: "Confirm your e-mail address for JBLBase",
            title: "Please confirm your e-mail address",
            hello: "Hello,",
            intro: (email) =>
                `great to have you! You created a JBLBase account with <strong>${email}</strong>. Confirm your address so your repertoires and training sync safely across all your devices.`,
            button: "Confirm e-mail address",
            fallback: "If the button does not work, copy this link into your browser:",
            ignore: "You did not create an account? Then just ignore this e-mail, nothing will happen.",
        },
    },
    reset: {
        de: {
            subject: "Neues Passwort für JBLBase",
            title: "Neues Passwort festlegen",
            hello: "Hallo,",
            intro: (email) =>
                `für dein JBLBase-Konto <strong>${email}</strong> wurde ein neues Passwort angefordert. Über den Knopf legst du es fest.`,
            button: "Passwort zurücksetzen",
            fallback: "Falls der Knopf nicht funktioniert, kopiere diesen Link in deinen Browser:",
            ignore: "Du hast das nicht angefordert? Dann ignoriere diese E-Mail, dein Passwort bleibt unverändert.",
        },
        en: {
            subject: "New password for JBLBase",
            title: "Set a new password",
            hello: "Hello,",
            intro: (email) =>
                `a new password was requested for your JBLBase account <strong>${email}</strong>. Use the button to set it.`,
            button: "Reset password",
            fallback: "If the button does not work, copy this link into your browser:",
            ignore: "You did not request this? Then ignore this e-mail, your password stays the same.",
        },
    },
};

const FOOTER: Record<MailLang, string> = {
    de: "JBLBase ist ein Open-Source-Projekt für Schachtraining.",
    en: "JBLBase is an open-source project for chess training.",
};

export type RenderedMail = { subject: string; html: string; text: string };

/** Subject, HTML and plain-text body of a mail. */
export function renderMail(
    kind: MailKind,
    lang: MailLang,
    { email, link }: { email: string; link: string },
): RenderedMail {
    const t = TEXTS[kind][lang];
    const e = escapeHtml(email);
    const l = escapeHtml(link);
    const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
    const html = `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(t.subject)}</title></head>
<body style="margin:0;padding:0;background:#1f2023;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#1f2023;padding:32px 16px;font-family:${font};"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#2b2c30;border:1px solid #3a3b40;border-radius:12px;"><tr><td style="padding:32px;color:#e9ecef;">
<p style="margin:0 0 4px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#4dabf7;font-weight:600;">JBLBase</p>
<h1 style="margin:0 0 20px;font-size:22px;line-height:1.3;color:#ffffff;">${t.title}</h1>
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;">${t.hello}</p>
<p style="margin:0 0 24px;font-size:15px;line-height:1.6;">${t.intro(e)}</p>
<p style="margin:0 0 28px;text-align:center;"><a href="${l}" style="display:inline-block;background:#228be6;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 28px;border-radius:8px;">${t.button}</a></p>
<p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#adb5bd;">${t.fallback}</p>
<p style="margin:0 0 24px;font-size:12px;line-height:1.5;word-break:break-all;"><a href="${l}" style="color:#4dabf7;">${l}</a></p>
<hr style="border:none;border-top:1px solid #3a3b40;margin:0 0 16px;">
<p style="margin:0;font-size:12px;line-height:1.6;color:#868e96;">${t.ignore}<br>${FOOTER[lang]}</p>
</td></tr></table>
</td></tr></table>
</body></html>`;
    const text = [
        t.title,
        "",
        t.hello,
        t.intro(email).replace(/<\/?strong>/g, ""),
        "",
        `${t.button}: ${link}`,
        "",
        t.ignore,
        FOOTER[lang],
    ].join("\n");
    return { subject: t.subject, html, text };
}
