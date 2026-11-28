import { describe, expect, it } from "vitest";
import { countReactions } from "./coachCloud";
import {
    firstView,
    linePoint,
    lineSteps,
    solutionMotif,
    mateInFromEval,
    moveNumber,
    type ReportMove,
    reportMoments,
} from "./coachDeep";

const move = (ply: number, reaction: ReportMove["reaction"], sign = ""): ReportMove => ({
    reaction,
    ply,
    san: "e4",
    best: null,
    sign,
    motif: null,
    motifText: null,
});

describe("coachDeep", () => {
    it("reads a mate for the opponent from the eval", () => {
        expect(mateInFromEval("-M3")).toBe(3);
        expect(mateInFromEval("+M2")).toBeNull();
        expect(mateInFromEval("-1.5")).toBeNull();
    });

    it("picks the three worst moments in game order", () => {
        const moves = [
            move(1, "book"),
            move(3, "dubious", "?!"),
            move(5, "blunder", "??"),
            move(7, "mistake", "?"),
            move(9, "dubious", "?!"),
            move(11, "missedMate", "??"),
        ];
        expect(reportMoments(moves).map((m) => m.ply)).toEqual([5, 7, 11]);
    });

    it("writes move numbers", () => {
        expect(moveNumber(1)).toBe("1.");
        expect(moveNumber(4)).toBe("2...");
    });

    it("counts reactions for the report", () => {
        expect(
            countReactions([
                "book",
                "solid",
                "brilliant",
                "good",
                "dubious",
                "missedMate",
                "blunder",
            ]),
        ).toEqual({ book: 1, solid: 1, good: 2, dubious: 1, mistake: 0, blunder: 2 });
    });
});

describe("lineSteps", () => {
    it("walks the engine line up to four half-moves", () => {
        const fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
        const steps = lineSteps(fen, ["e5", "Nf3", "Nc6", "Bb5", "a6"]);
        expect(steps.map((s) => s.san)).toEqual(["e5", "Nf3", "Nc6", "Bb5"]);
        expect(steps[1]).toMatchObject({ from: "g1", to: "f3" });
        expect(lineSteps(fen, ["e5", "Qxf7"])).toHaveLength(1);
    });
});

describe("solutionMotif", () => {
    it("finds a fork in the found move", () => {
        const m = solutionMotif("r3k3/8/8/3N4/8/8/8/4K3 w - - 0 1", "Nc7+", "+5.0", "Nc7+");
        expect(m).toEqual({ id: "fork", square: "c7", mateIn: null });
    });
    it("finds a free piece", () => {
        const m = solutionMotif("4k3/8/8/3n4/8/8/3Q4/4K3 w - - 0 1", "Qxd5", "+9.0", "Qxd5");
        expect(m).toEqual({ id: "hanging", square: "d5", mateIn: null });
    });
    it("names a mate only for the engine's best move", () => {
        const fen = "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1";
        expect(solutionMotif(fen, "Ra8#", "+M1", "Ra8#")).toEqual({
            id: "mate",
            square: null,
            mateIn: 1,
        });
        expect(solutionMotif(fen, "Kf2", "+M1", "Ra8#")).toBeNull();
    });
    it("stays quiet without a motif", () => {
        expect(solutionMotif("4k3/8/8/8/8/8/8/4K2R w - - 0 1", "Kf1", "+5.0", "Kf1")).toBeNull();
    });
});

// 1.2.34: Stellungen aus Stockfish-Stichproben gegen JBL
describe("linePoint: so viele Züge, wie der Punkt braucht", () => {
    it("zeigt einen Damenverlust bis nach dem Rückschlag", () => {
        // 8.Dxe5?? Ld6 9.Dxe4 Sxe4 10.Sxe4: am Ende fehlt Weiß Material
        const fenAfter = "rnbq1k1r/pp3ppp/2p2n2/2b1Q3/4p3/1BN2N2/PPPP1PPP/R1B1K2R b KQ - 0 8";
        const p = linePoint(fenAfter, ["Bd6", "Qxe4", "Nxe4", "Nxe4", "Be7", "Ne5", "Be6", "Bxe6"]);
        // 15...Lxe6 am Ende des Ausschnitts wird noch zurückgeschlagen: zählt nicht
        expect(p).toEqual({ plies: 4, kind: "material", gain: 5 });
    });

    it("zeigt ein verpasstes Matt bis zum Matt", () => {
        const fen = "4r1k1/ppp2pp1/4q2p/bB6/P2P2b1/2N2N2/1PP2PKP/R2Q3R b - - 0 20";
        expect(linePoint(fen, ["Bh3+", "Kg1", "Qg4#"])).toEqual({
            plies: 3,
            kind: "mate",
            gain: 0,
        });
    });

    it("zeigt beim verpassten Rückschlag den Rückschlag und die Antwort", () => {
        const fen = "rnbq1rk1/ppp2pp1/3b1B1p/3Pp3/P7/3P1N2/1PP2PPP/RN1QKB1R b KQ - 0 8";
        const p = linePoint(fen, ["Qxf6", "Be2", "c6", "c4", "Bb4+", "Nc3", "cxd5", "cxd5"]);
        expect(p).toEqual({ plies: 2, kind: "material", gain: 3 });
        // Die Antwort des Gegners nach 8...Lb4+ gewinnt nichts dazu: ruhig
        const after = "rnbq1rk1/ppp2pp1/5B1p/3Pp3/Pb6/3P1N2/1PP2PPP/RN1QKB1R w KQ - 1 9";
        const a = linePoint(after, ["c3", "Qxf6", "cxb4", "Na6", "Nc3", "Nxb4", "Be2", "Rd8"]);
        expect(a.kind).toBe("quiet");
        expect(a.plies).toBe(2);
        expect(firstView(a, p)).toBe("better");
    });

    it("zeigt einen Qualitätsverlust bis der Gegner zurückgewinnt", () => {
        // 21.Lxe8 Dg4+ 22.Kf1 Dh3+ 23.Ke1 Lxf3: am Ende fehlen Schwarz 2 Bauern,
        // also bis 23...Lxf3 zeigen und nicht schon nach 2 Halbzügen aufhören
        const fenAfter = "4r1k1/ppp2pp1/4q2p/bB5b/P2P4/2N2N2/1PP2PKP/R2Q3R w - - 1 21";
        const line = ["Bxe8", "Qg4+", "Kf1", "Qh3+", "Ke1", "Bxf3", "Qd3", "Bb4"];
        const answer = linePoint(fenAfter, line);
        expect(answer).toEqual({ plies: 6, kind: "material", gain: 2 });
        // Matt in 2 verpasst: das zeigt das Fenster zuerst
        const fen = "4r1k1/ppp2pp1/4q2p/bB6/P2P2b1/2N2N2/1PP2PKP/R2Q3R b - - 0 20";
        expect(firstView(answer, linePoint(fen, ["Bh3+", "Kg1", "Qg4#"]))).toBe("better");
    });

    it("bleibt bei einer ruhigen Linie bei 2 Halbzügen", () => {
        const fen = "r1b1k2r/ppqnbpp1/2pp1n1p/3Pp3/2P1P3/P1N2N2/1PQ1BPPP/R1B1K2R w KQkq - 0 10";
        const p = linePoint(fen, ["Be3", "Nf8", "h3", "Ng6", "O-O", "O-O", "Rfc1", "c5"]);
        expect(p).toEqual({ plies: 2, kind: "quiet", gain: 0 });
        expect(linePoint(fen, [])).toEqual({ plies: 0, kind: "quiet", gain: 0 });
    });
});
