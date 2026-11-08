import { expect, test } from "vitest";
import de from "@/translation/de-DE.json";
import en from "@/translation/en-US.json";

// Keys outside "translation" are never loaded, the app then shows the raw key
test("all texts live inside the translation namespace", () => {
    expect(Object.keys(en)).toEqual(["translation"]);
    expect(Object.keys(de)).toEqual(["translation"]);
});

test("English and German texts are filled in", () => {
    const empty = (texts: Record<string, string | null>) =>
        Object.entries(texts)
            .filter(([, v]) => !v)
            .map(([k]) => k);
    expect(empty(en.translation)).toEqual([]);
    expect(empty(de.translation)).toEqual([]);
});

// German is the main language of JBLBase: without a German text the English one shows up
// (e.g. the keyboard shortcuts in the settings and the FEN errors were English).
test("every English text has a German translation", () => {
    const missing = Object.keys(en.translation).filter(
        // _zero plurals are an English extra, German uses _one/_other
        (key) => !key.endsWith("_zero") && !(key in de.translation),
    );
    expect(missing).toEqual([]);
});
