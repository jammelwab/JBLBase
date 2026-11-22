import { atom } from "jotai";

// Sprachwahl beim ersten Start (1.2.14). Die Sprache liegt wie bisher unter
// "i18nextLng" im localStorage und damit im Profil des Kontos: jedes Konto
// hat seine eigene Sprache. "language-asked" merkt sich, dass gefragt wurde.

export const LANGUAGES = [
    "en-US",
    "en-GB",
    "pt-PT",
    "zh-CN",
    "ru-RU",
    "uk-UA",
    "be-BY",
    "nb-NO",
    "pl-PL",
    "es-ES",
    "it-IT",
    "fr-FR",
    "tr-TR",
    "ko-KR",
    "zh-TW",
    "de-DE",
] as const;

export type Language = (typeof LANGUAGES)[number];

export const LANGUAGE_KEY = "i18nextLng";
export const LANGUAGE_ASKED_KEY = "language-asked";

// Name jeder Sprache in ihr selbst
export const LANGUAGE_NAMES: Record<Language, string> = {
    "be-BY": "Беларуская",
    "zh-CN": "简体中文",
    "zh-TW": "繁體中文",
    "en-GB": "English (UK)",
    "en-US": "English",
    "fr-FR": "Français",
    "pl-PL": "Polski",
    "nb-NO": "Norsk bokmål",
    "pt-PT": "Português",
    "ru-RU": "Русский",
    "es-ES": "Español",
    "it-IT": "Italiano",
    "uk-UA": "Українська",
    "tr-TR": "Türkçe",
    "ko-KR": "한국어",
    "de-DE": "Deutsch",
};

// Passende App-Sprache zu einer Systemsprache wie "de-AT", "de_CH" oder "en"
export function matchLanguage(locale: string | null | undefined): Language | null {
    if (!locale) return null;
    const norm = locale.replace("_", "-").split(/[.@]/)[0].toLowerCase();
    const exact = LANGUAGES.find((l) => l.toLowerCase() === norm);
    if (exact) return exact;
    const base = norm.split("-")[0];
    if (base === "en") return "en-US";
    if (base === "zh") return /-(tw|hk|mo|hant)/.test(norm) ? "zh-TW" : "zh-CN";
    // Bokmål und Nynorsk: beides Norwegisch
    if (base === "no" || base === "nn") return "nb-NO";
    return LANGUAGES.find((l) => l.toLowerCase().startsWith(`${base}-`)) ?? null;
}

// Erste unterstützte Sprache aus der Liste des Systems, sonst Englisch
export function systemLanguage(locales: readonly (string | null | undefined)[]): Language {
    for (const l of locales) {
        const match = matchLanguage(l);
        if (match) return match;
    }
    return "en-US";
}

// Die beiden Angebote: die Systemsprache und Englisch. Ist das System schon
// Englisch, ist Deutsch die zweite Wahl.
export function languageOptions(system: Language): [Language, Language] {
    return [system, system.startsWith("en") ? "de-DE" : "en-US"];
}

function read(storage: Storage, key: string): string | null {
    try {
        return storage.getItem(key);
    } catch {
        return null;
    }
}

// Fragen, wenn das Profil noch keine Sprache hat. Wer vor 1.2.14 schon eine
// Sprache hatte, wird nicht gefragt. "0" heißt: gefragt, aber noch keine
// Antwort (die App wurde vorher geschlossen), also beim nächsten Start wieder.
export function needsLanguageChoice(storage: Storage = localStorage): boolean {
    const asked = read(storage, LANGUAGE_ASKED_KEY);
    if (asked === "1") return false;
    if (asked === null && read(storage, LANGUAGE_KEY)) {
        markLanguageChosen(storage);
        return false;
    }
    try {
        storage.setItem(LANGUAGE_ASKED_KEY, "0");
    } catch {}
    return true;
}

export function markLanguageChosen(storage: Storage = localStorage) {
    try {
        storage.setItem(LANGUAGE_ASKED_KEY, "1");
    } catch {}
}

// Die Frage nach der Sprache ist offen (mit der erkannten Systemsprache)
export const languagePromptAtom = atom<Language | null>(null);
