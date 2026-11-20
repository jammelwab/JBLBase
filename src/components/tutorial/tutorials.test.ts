import { describe, expect, it } from "vitest";
import de from "@/translation/de-DE.json";
import en from "@/translation/en-US.json";
import { availableTutorials, TUTORIALS, tutorialsForPage } from "./tutorials";

const texts: Record<string, Record<string, string>> = {
    "de-DE": de.translation,
    "en-US": en.translation,
};

// The app's components as text, to look for the data-tour marks
const sources = import.meta.glob(["../**/*.tsx", "!../**/*.test.tsx"], {
    query: "?raw",
    import: "default",
    eager: true,
}) as Record<string, string>;

describe("tutorials", () => {
    it("have a title, description and texts for every step in German and English", () => {
        for (const [locale, t] of Object.entries(texts)) {
            for (const tutorial of TUTORIALS) {
                const keys = [
                    `Tutorial.${tutorial.id}.Title`,
                    `Tutorial.${tutorial.id}.Desc`,
                    ...tutorial.steps.flatMap((s) => [
                        `Tutorial.${tutorial.id}.${s.id}.Title`,
                        `Tutorial.${tutorial.id}.${s.id}.Body`,
                    ]),
                ];
                for (const key of keys) expect(t[key], `${locale}: ${key}`).toBeTruthy();
            }
        }
    });

    it("point only at elements that exist in the app", () => {
        const code = Object.values(sources).join("\n");
        for (const tutorial of TUTORIALS) {
            for (const step of tutorial.steps) {
                const targets = step.target ? [step.target].flat() : [];
                for (const target of targets) {
                    expect(
                        code.includes(`"${target}"`),
                        `${tutorial.id}.${step.id}: ${target}`,
                    ).toBe(true);
                }
            }
        }
    });

    it("continue only with tutorials that exist", () => {
        for (const tutorial of TUTORIALS) {
            if (tutorial.next) expect(TUTORIALS.map((t) => t.id)).toContain(tutorial.next);
        }
    });

    it("offer the right ones per page", () => {
        const ids = (path: string, admin = false) => tutorialsForPage(path, admin).map((t) => t.id);
        expect(ids("/databases/Lichess")).toEqual(["Databases"]);
        expect(ids("/")).toEqual(["Board", "Home", "Puzzles"]);
        expect(ids("/settings")).toEqual(["Account", "Settings"]);
        expect(ids("/settings", true)).toEqual(["Account", "Settings", "Admin"]);
        expect(availableTutorials(false).some((t) => t.adminOnly)).toBe(false);
    });
});
