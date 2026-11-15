// Terms of use and privacy policy of the JBLBase account (German only: the
// service is run from Germany).
//
// Raise a version when its text changes in substance. Signed-in users are
// then asked to agree again before the sync goes on (see ConsentGate).

import privacyText from "./DATENSCHUTZ.md?raw";
import termsText from "./NUTZUNGSBEDINGUNGEN.md?raw";

export const TERMS_VERSION = "2026-11-10";
export const PRIVACY_VERSION = "2026-11-12";

/** Minimum age without the consent of a parent (Art. 8 GDPR, Germany). */
export const MIN_AGE = 16;

export { privacyText, termsText };

export type LegalDocument = "terms" | "privacy";

export function legalText(doc: LegalDocument): string {
    return doc === "terms" ? termsText : privacyText;
}
