import { describe, expect, it } from "vitest";
import { parseExplainRequest } from "../../../firebase/functions/src/explain";
import { evalText, explainError, explainMotifs } from "./coachExplain";
import { COACH_TONES, playCoachTone } from "./coachSound";

describe("Warum?", () => {
    it("Bewertung aus Sicht des Spielers", () => {
        expect(evalText({ type: "cp", value: 130 }, "white")).toBe("+1.3");
        expect(evalText({ type: "cp", value: 130 }, "black")).toBe("-1.3");
        expect(evalText({ type: "cp", value: 0 }, "black")).toBe("+0.0");
        expect(evalText({ type: "cp", value: 50_000 }, "white")).toBe("+99.0");
        expect(evalText({ type: "mate", value: -2 }, "white")).toBe("-M2");
        expect(evalText({ type: "mate", value: -2 }, "black")).toBe("+M2");
    });
    it("Motive als Stichworte", () => {
        expect(explainMotifs({ allowsMateInOne: true, sacrifice: true })).toEqual([
            "allows mate in 1",
            "sacrifice",
        ]);
        expect(explainMotifs({ allowsMateInOne: false, sacrifice: false })).toEqual([]);
    });
    it("Fehler der Cloud-Funktion", () => {
        expect(explainError({ code: "functions/resource-exhausted" })).toBe("limit");
        expect(explainError({ code: "functions/unavailable" })).toBe("offline");
        expect(explainError(new Error("x"))).toBe("failed");
    });
    it("was die App schickt, nimmt die Cloud-Funktion an", () => {
        const facts = {
            fen: "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 4 4",
            move: "Qxf7#",
            best: null,
            line: [],
            before: evalText({ type: "mate", value: 1 }, "white"),
            after: evalText({ type: "mate", value: 0 }, "white"),
            mark: "!",
            motifs: explainMotifs({ allowsMateInOne: false, sacrifice: true }),
            stage: "knows",
            lang: "de",
        };
        expect(parseExplainRequest(facts)).not.toBeNull();
        const black = {
            ...facts,
            fen: "rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq g3 0 2",
            move: "Qh4#",
            line: ["exd8=Q+", "Kxd8", "O-O-O"],
            before: evalText({ type: "cp", value: -2345 }, "black"),
            mark: "??",
            motifs: explainMotifs({ allowsMateInOne: true, sacrifice: false }),
        };
        expect(parseExplainRequest(black)).not.toBeNull();
    });
});

describe("Coach-Töne", () => {
    it("leise, kurz und hörbar", () => {
        for (const notes of Object.values(COACH_TONES)) {
            expect(notes.length).toBeGreaterThan(0);
            for (const n of notes) {
                expect(n.f).toBeGreaterThan(100);
                expect(n.f).toBeLessThan(2000);
                expect(n.at + n.dur).toBeLessThan(1.5);
            }
        }
    });
    it("ohne Audio passiert nichts", () => {
        expect(() => playCoachTone("win")).not.toThrow();
    });
});
