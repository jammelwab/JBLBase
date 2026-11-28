import { describe, expect, it } from "vitest";
import de from "@/translation/de-DE.json";
import en from "@/translation/en-US.json";
import {
    allowsNewMateInOne,
    checkEngineOptions,
    playedScore,
    jblEngineSettings,
    jblEngineSetup,
    jblRandomMoveChance,
    LINE_VARIANTS,
    pickLine,
    reactionFor,
    readingTime,
} from "./coachGame";
import { COACH_STRENGTHS } from "./coachState";

describe("JBL als Gegner", () => {
    it("begrenzt Stockfish ab 1320 Elo per UCI_Elo, darunter per Skill Level", () => {
        expect(jblEngineSetup("veryEasy").options).toEqual([{ name: "Skill Level", value: "0" }]);
        expect(jblEngineSetup("veryEasy").go).toEqual({ t: "Depth", c: 1 });
        const medium = jblEngineSetup("medium").options;
        expect(medium).toContainEqual({ name: "UCI_LimitStrength", value: "true" });
        expect(medium).toContainEqual({ name: "UCI_Elo", value: "1500" });
        const elos = COACH_STRENGTHS.flatMap((s) =>
            jblEngineSetup(s.id).options.filter((o) => o.name === "UCI_Elo"),
        ).map((o) => Number(o.value));
        expect(elos.length).toBeGreaterThan(0);
        expect(Math.min(...elos)).toBeGreaterThanOrEqual(1320);
    });

    it("ersetzt Stärke-Optionen der Engine und lässt den Rest", () => {
        const engine = {
            type: "local" as const,
            id: "x",
            name: "Stockfish 19",
            version: "19",
            path: "/sf",
            settings: [
                { name: "Threads", value: 4 },
                { name: "UCI_Elo", value: 3000 },
                { name: "MultiPV", value: 3 },
            ],
        };
        const settings = jblEngineSettings(engine, "hard");
        expect(settings).toContainEqual({ name: "Threads", value: 4 });
        expect(settings).toContainEqual({ name: "UCI_Elo", value: "2300" });
        expect(settings.filter((s) => s.name === "UCI_Elo")).toHaveLength(1);
        expect(settings.some((s) => s.name === "MultiPV")).toBe(false);
    });
});

describe("JBLs Kommentare", () => {
    it("ordnet Zeichen einer Reaktion zu, Matt in 1 geht vor", () => {
        expect(reactionFor("??", false)).toBe("blunder");
        expect(reactionFor("!!", false)).toBe("brilliant");
        expect(reactionFor("", false)).toBe("solid");
        expect(reactionFor("", false, true)).toBe("book");
        expect(reactionFor("?!", false, true)).toBe("book");
        expect(reactionFor("?", false, true)).toBe("mistake");
        expect(reactionFor("!!", false, true)).toBe("brilliant");
        expect(reactionFor("!", true)).toBe("missedMate");
    });

    it("wiederholt nicht die zuletzt gezeigte Fassung", () => {
        expect(pickLine("good", ["good.1", "good.2"], () => 0)).toBe("good.3");
        expect(pickLine("missedMate", ["missedMate.1"], () => 0)).toBe("missedMate.1");
    });

    it("lässt längere Sätze länger stehen, höchstens 6 s", () => {
        expect(readingTime("kurz")).toBeLessThan(readingTime("ein deutlich längerer Satz"));
        expect(readingTime("x".repeat(500))).toBe(6000);
    });

    it("hat jede Fassung auf Deutsch und Englisch", () => {
        for (const t of [de.translation, en.translation] as Record<string, string>[]) {
            for (const [key, n] of Object.entries(LINE_VARIANTS)) {
                for (let i = 1; i <= n; i++)
                    expect(t[`Coach.Line.${key}.${i}`], `${key}.${i}`).toBeTruthy();
            }
        }
    });
});

describe("jblRandomMoveChance", () => {
    it("lets the easy levels play like beginners, the strong ones not", () => {
        expect(jblRandomMoveChance("veryEasy")).toBeGreaterThan(jblRandomMoveChance("easy"));
        expect(jblRandomMoveChance("easy")).toBeGreaterThan(jblRandomMoveChance("fairlyEasy"));
        expect(jblRandomMoveChance("medium")).toBe(0);
        expect(jblRandomMoveChance("veryHard")).toBe(0);
    });
});

describe("Zugbewertung (1.2.19)", () => {
    const best = [
        { sanMoves: ["Nf3", "Nc6"], score: { value: { type: "cp", value: 40 } } },
        { sanMoves: ["d4", "d5"], score: { value: { type: "cp", value: 25 } } },
    ];
    it("nimmt für einen der besten Züge die Bewertung aus derselben Suche", () => {
        expect(playedScore("Nf3", best, { type: "cp", value: -30 })).toEqual({
            type: "cp",
            value: 40,
        });
        expect(playedScore("d4", best, { type: "cp", value: -30 })).toEqual({
            type: "cp",
            value: 25,
        });
        expect(playedScore("h4", best, { type: "cp", value: -30 })).toEqual({
            type: "cp",
            value: -30,
        });
    });
    it("prüft ohne Stärke-Begrenzung", () => {
        expect(
            checkEngineOptions([
                { name: "Threads", value: "4" },
                { name: "UCI_LimitStrength", value: "true" },
                { name: "UCI_Elo", value: "1500" },
                { name: "Skill Level", value: "3" },
                { name: "MultiPV", value: "1" },
            ]),
        ).toEqual([{ name: "Threads", value: "4" }]);
    });
});

describe("Matt in 1 zugelassen (1.2.34)", () => {
    const m = (value: number) => ({ type: "mate", value });
    const cp = (value: number) => ({ type: "cp", value });
    it("zählt, wenn vorher noch kein Matt drohte", () => {
        expect(allowsNewMateInOne(cp(50), m(-1), "white")).toBe(true);
        expect(allowsNewMateInOne(cp(-50), m(1), "black")).toBe(true);
        // Eigenes Matt verpasst, aber noch kein Matt gegen dich
        expect(allowsNewMateInOne(m(3), m(-1), "white")).toBe(true);
    });
    it("zählt nicht, wenn das Matt schon unvermeidlich war", () => {
        // Stichprobe: 41...Kd8, jeder Zug erlaubt Th8#
        expect(allowsNewMateInOne(m(1), m(1), "black")).toBe(false);
        expect(allowsNewMateInOne(m(-3), m(-1), "white")).toBe(false);
    });
    it("zählt nicht ohne Matt für den Gegner", () => {
        expect(allowsNewMateInOne(cp(0), m(1), "white")).toBe(false);
        expect(allowsNewMateInOne(cp(0), cp(-900), "white")).toBe(false);
    });
});
