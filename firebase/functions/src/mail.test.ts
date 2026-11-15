import assert from "node:assert/strict";
import { test } from "node:test";
import {
    escapeHtml,
    LOGO_URL,
    maySend,
    MAIL_INTERVAL_MS,
    parseEmail,
    parseLang,
    renderMail,
} from "./mail.js";

test("parseEmail accepts and normalises addresses", () => {
    assert.equal(parseEmail({ email: "  Spieler@Example.COM " }), "spieler@example.com");
    assert.equal(parseEmail({ email: "kein-at" }), null);
    assert.equal(parseEmail({ email: "a b@example.com" }), null);
    assert.equal(parseEmail({ email: 3 }), null);
    assert.equal(parseEmail(null), null);
});

test("parseLang defaults to German", () => {
    assert.equal(parseLang({ lang: "en-US" }), "en");
    assert.equal(parseLang({ lang: "de" }), "de");
    assert.equal(parseLang({}), "de");
    assert.equal(parseLang(undefined), "de");
});

test("maySend limits to one mail per interval", () => {
    assert.equal(maySend(undefined, 1000), true);
    assert.equal(maySend(1000, 1000 + MAIL_INTERVAL_MS - 1), false);
    assert.equal(maySend(1000, 1000 + MAIL_INTERVAL_MS), true);
});

test("renderMail escapes the address and contains the link", () => {
    const link = "https://jblbase.firebaseapp.com/__/auth/action?mode=verifyEmail&oobCode=x";
    const mail = renderMail("verify", "de", { email: "<b>@example.com", link });
    assert.equal(mail.subject, "Bestätige deine E-Mail-Adresse für JBLBase");
    assert.ok(mail.html.includes(escapeHtml(link)));
    assert.ok(mail.html.includes("&lt;b&gt;@example.com"));
    assert.ok(!mail.html.includes("<b>@example.com"));
    assert.ok(mail.text.includes(link));
    assert.ok(mail.html.includes(LOGO_URL));
    assert.ok(!mail.text.includes("<strong>"));
});

test("renderMail has English and reset variants", () => {
    const mail = renderMail("reset", "en", { email: "a@example.com", link: "https://x.test/r" });
    assert.equal(mail.subject, "New password for JBLBase");
    assert.ok(mail.html.includes("Reset password"));
});
