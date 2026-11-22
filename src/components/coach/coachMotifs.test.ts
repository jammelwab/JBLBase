import { describe, expect, it } from "vitest";
import { detectMotifs } from "./coachMotifs";

// Stellung nach deinem Zug (Schwarz, also der Gegner, am Zug) und seine Antwort
const ids = (fen: string, line: string[], mate: number | null = null) =>
    detectMotifs(fen, line, mate).map((m) => m.id);

describe("Taktikmotive in der Antwort des Gegners", () => {
    it("erkennt die Springergabel auf König und Turm", () => {
        expect(ids("4k3/8/8/8/1n6/8/8/R3K3 b - - 0 1", ["Nc2+"])).toContain("fork");
    });

    it("erkennt eine Fesselung an den König", () => {
        // Bb4: der Springer c3 steht vor dem König e1
        expect(ids("4k3/8/8/2b5/8/2N5/8/4K3 b - - 0 1", ["Bb4"])).toContain("pin");
    });

    it("erkennt den Spieß durch den König", () => {
        // Ra1+: der König e1 muss weg, dahinter hängt der Turm h1
        expect(ids("4k3/8/8/8/8/8/r7/4K2R b - - 0 1", ["Ra1+"])).toContain("skewer");
    });

    it("erkennt eine ungedeckte Figur und Matt", () => {
        expect(ids("4k3/8/8/8/8/2q5/8/2B4K b - - 0 1", ["Qxc1+"])).toContain("hanging");
        expect(ids("4k3/8/8/8/8/8/8/4K3 b - - 0 1", [], 2)).toEqual(["mate"]);
    });

    it("bleibt still bei einem ruhigen Zug", () => {
        expect(ids("4k3/8/8/8/8/8/8/R3K3 b - - 0 1", ["Kd7"])).toEqual([]);
        expect(ids("kein fen", ["e4"])).toEqual([]);
    });

    it("hält die Stichworte kurz genug für die Cloud", () => {
        for (const m of detectMotifs("4k3/8/8/8/1n6/8/8/R3K3 b - - 0 1", ["Nc2+"], 3))
            expect(m.text).toMatch(/^[\p{L}\d .,+#-]{1,40}$/u);
    });
});
