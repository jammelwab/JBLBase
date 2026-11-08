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
