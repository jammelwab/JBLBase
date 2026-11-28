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

// 1.2.34: Stichproben mit Stockfish zeigten viele falsche Motive
describe("keine falschen Motive (1.2.34)", () => {
    it("kein Spieß, wenn dahinter nur ein Bauer steht", () => {
        // Te8 greift die Dame e5 an, dahinter steht nur der Bauer e2
        expect(ids("4r1k1/8/8/4Q3/8/8/4P3/6K1 b - - 0 1", ["Re8"])).not.toContain("skewer");
        expect(ids("6k1/8/8/4Q3/8/8/4P3/4r1K1 b - - 0 1", ["Re1"])).not.toContain("skewer");
    });

    it("kein Spieß Dame gegen Dame, wenn die Dame gedeckt ist", () => {
        // Dd8-e8: Dame gegen Dame auf der e-Linie, hinter der weißen Dame
        // der Turm e1, die Dame e5 kann zurückschlagen
        expect(ids("3q2k1/8/8/4Q3/8/8/8/4R1K1 b - - 0 1", ["Qe8"])).not.toContain("skewer");
    });

    it("keine Fesselung eines Bauern", () => {
        // Lc5 „fesselt“ den Bauern f2 an den Springer g1: kein Motiv
        expect(ids("4k3/8/8/8/8/8/5P2/4K1N1 b - - 0 1", ["Bc5"])).not.toContain("pin");
    });

    it("keine Fesselung, wenn die vordere Figur den Angreifer schlagen kann", () => {
        // Td1 gegen den Turm f1 vor dem König g1: Txd1 geht einfach
        expect(ids("3r2k1/8/8/8/8/8/8/5RK1 b - - 0 1", ["Rd1"])).not.toContain("pin");
    });

    it("keine Gabel, wenn man die gabelnde Figur einfach schlägt", () => {
        // Sc2+ auf König und Turm, aber der Turm c1 schlägt den Springer
        expect(ids("4k3/8/8/8/1n6/8/8/R1R1K3 b - - 0 1", ["Nc2+"])).not.toContain("fork");
    });

    it("keine ungedeckte Figur, wenn es ein Abtausch war", () => {
        // Dein Läufer hat auf c4 einen Läufer geschlagen, dxc4 schlägt zurück
        expect(
            detectMotifs("4k3/8/8/3p4/2B5/8/8/4K3 b - - 0 1", ["dxc4"], null, {
                square: "c4",
                value: 3,
            }).map((m) => m.id),
        ).not.toContain("hanging");
        expect(ids("4k3/8/8/3p4/2B5/8/8/4K3 b - - 0 1", ["dxc4"])).toContain("hanging");
    });

    it("echte Motive bleiben", () => {
        // Lb5 (gedeckt durch a4) spießt die Dame d7 und den Turm e8 auf
        expect(ids("4r1k1/3q4/8/8/P7/3B4/8/6K1 w - - 0 1", ["Bb5"])).toContain("skewer");
        // Ungedeckt schlägt die Dame den Läufer einfach
        expect(ids("4r1k1/3q4/8/8/8/3B4/8/6K1 w - - 0 1", ["Bb5"])).not.toContain("skewer");
    });
});
