import { describe, expect, it } from "vitest";
import {
    LANGUAGE_ASKED_KEY,
    LANGUAGE_KEY,
    languageOptions,
    markLanguageChosen,
    matchLanguage,
    needsLanguageChoice,
    systemLanguage,
} from "./language";

function memoryStorage(init: Record<string, string> = {}): Storage {
    const data = new Map(Object.entries(init));
    return {
        get length() {
            return data.size;
        },
        key: (i) => [...data.keys()][i] ?? null,
        getItem: (k) => data.get(k) ?? null,
        setItem: (k, v) => void data.set(k, String(v)),
        removeItem: (k) => void data.delete(k),
        clear: () => data.clear(),
    };
}

describe("Sprache", () => {
    it("findet die App-Sprache zur Systemsprache", () => {
        expect(matchLanguage("de-DE")).toBe("de-DE");
        expect(matchLanguage("de-AT")).toBe("de-DE");
        expect(matchLanguage("de_CH.UTF-8")).toBe("de-DE");
        expect(matchLanguage("de")).toBe("de-DE");
        expect(matchLanguage("en-GB")).toBe("en-GB");
        expect(matchLanguage("en-DE")).toBe("en-US");
        expect(matchLanguage("zh-Hant-TW")).toBe("zh-TW");
        expect(matchLanguage("zh-Hans")).toBe("zh-CN");
        expect(matchLanguage("nn-NO")).toBe("nb-NO");
        expect(matchLanguage("ja-JP")).toBeNull();
        expect(matchLanguage(null)).toBeNull();
    });

    it("nimmt die erste unterstützte Systemsprache, sonst Englisch", () => {
        expect(systemLanguage([null, "ja-JP", "fr-CA"])).toBe("fr-FR");
        expect(systemLanguage(["ja-JP"])).toBe("en-US");
    });

    it("bietet Systemsprache und Englisch an, bei englischem System Deutsch", () => {
        expect(languageOptions("de-DE")).toEqual(["de-DE", "en-US"]);
        expect(languageOptions("en-GB")).toEqual(["en-GB", "de-DE"]);
    });

    it("fragt beim ersten Start, bis eine Sprache gewählt ist", () => {
        const s = memoryStorage();
        expect(needsLanguageChoice(s)).toBe(true);
        // i18next speichert die Startsprache schon vor der Antwort
        s.setItem(LANGUAGE_KEY, "de-DE");
        expect(needsLanguageChoice(s)).toBe(true);
        markLanguageChosen(s);
        expect(needsLanguageChoice(s)).toBe(false);
    });

    it("fragt nicht, wer schon vorher eine Sprache hatte", () => {
        const s = memoryStorage({ [LANGUAGE_KEY]: "de-DE" });
        expect(needsLanguageChoice(s)).toBe(false);
        expect(s.getItem(LANGUAGE_ASKED_KEY)).toBe("1");
    });
});
