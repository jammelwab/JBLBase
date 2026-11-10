import { describe, expect, it } from "vitest";
import { PRIVACY_VERSION, TERMS_VERSION, privacyText, termsText } from "@/legal/legal";
import { consentDocId, PENDING_MAX_AGE_MS, parsePendingConsent } from "./consent";

const now = 1_800_000_000_000;
const pending = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
        terms: TERMS_VERSION,
        privacy: PRIVACY_VERSION,
        method: "register",
        ageConfirmed: true,
        at: now - 1000,
        ...over,
    });

describe("consent", () => {
    it("names the record after both versions", () => {
        expect(consentDocId("a", "b")).toBe("a_b");
        expect(consentDocId()).toBe(`${TERMS_VERSION}_${PRIVACY_VERSION}`);
    });

    it("accepts a recent agreement to the current versions", () => {
        expect(parsePendingConsent(pending(), now)?.method).toBe("register");
        expect(parsePendingConsent(pending({ method: "lichess" }), now)?.method).toBe("lichess");
    });

    it("rejects old, foreign or incomplete agreements", () => {
        expect(parsePendingConsent(null, now)).toBeNull();
        expect(parsePendingConsent("{", now)).toBeNull();
        expect(parsePendingConsent(pending({ terms: "2000-01-01" }), now)).toBeNull();
        expect(parsePendingConsent(pending({ privacy: "2000-01-01" }), now)).toBeNull();
        expect(parsePendingConsent(pending({ ageConfirmed: false }), now)).toBeNull();
        expect(parsePendingConsent(pending({ method: "other" }), now)).toBeNull();
        expect(parsePendingConsent(pending({ at: now - PENDING_MAX_AGE_MS - 1 }), now)).toBeNull();
        expect(parsePendingConsent(pending({ at: now + 60_000 }), now)).toBeNull();
    });

    it("ships both texts with their version", () => {
        expect(termsText).toContain(`Version ${TERMS_VERSION}`);
        expect(privacyText).toContain(`Version ${PRIVACY_VERSION}`);
    });
});
