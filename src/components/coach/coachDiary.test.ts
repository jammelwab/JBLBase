import { Chess } from "chessops/chess";
import { INITIAL_FEN, makeFen } from "chessops/fen";
import { makeSan, parseSan } from "chessops/san";
import { describe, expect, it } from "vitest";
import { createNode, defaultTree, type TreeNode } from "@/utils/treeReducer";
import {
    addToDiary,
    DIARY_GAMES,
    type DiaryGame,
    diaryGame,
    diaryGaps,
    epdIndex,
    epdOf,
    repertoireBook,
    repertoireDeparture,
    steeringBook,
    varietyBook,
} from "./coachDiary";
import { pickRepertoire, planCoachGame } from "./coachPlan";
import { formatLine, diarySummary } from "./CoachHints";

// Baum aus Zuglisten; die erste Liste ist die Hauptlinie
function tree(...lines: string[][]): TreeNode {
    const root = defaultTree().root;
    for (const line of lines) {
        let node = root;
        const pos = Chess.default();
        for (const san of line) {
            const move = parseSan(pos, san)!;
            expect(move).toBeTruthy();
            const s = makeSan(pos, move);
            pos.play(move);
            let child = node.children.find((c) => c.san === s);
            if (!child) {
                child = createNode({
                    move,
                    san: s,
                    fen: makeFen(pos.toSetup()),
                    halfMoves: node.halfMoves + 1,
                });
                node.children.push(child);
            }
            node = child;
        }
    }
    return root;
}

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -";

function game(
    line: string[],
    color: "white" | "black",
    marks: Record<number, string> = {},
    result: DiaryGame["result"] = "loss",
): DiaryGame {
    return diaryGame(tree(line), color, result, marks, "2026-11-20");
}

describe("epdOf", () => {
    it("lässt en passant weg, wenn es nicht geht", () => {
        const fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";
        expect(epdOf(fen)).toBe("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -");
    });
    it("behält en passant, wenn es geht", () => {
        const fen = "rnbqkbnr/ppp1pppp/8/8/3pP3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 3";
        expect(epdOf(fen).endsWith(" e3")).toBe(true);
    });
    it("Startstellung", () => {
        expect(epdOf(INITIAL_FEN)).toBe(START);
    });
});

describe("Tagebuch", () => {
    it("merkt sich Züge, eigene Züge und Bewertungen", () => {
        const g = game(["e4", "e5", "Nf3", "Nc6"], "white", { 3: "?" });
        expect(g.moves.map((m) => m.s)).toEqual(["e4", "e5", "Nf3", "Nc6"]);
        expect(g.moves.map((m) => m.h ?? 0)).toEqual([1, 0, 1, 0]);
        expect(g.moves[2].x).toBe("?");
        expect(g.moves[0].e).toBe(START);
        expect(g.moves[0].u).toBe("e2e4");
    });
    it("hält höchstens DIARY_GAMES Partien", () => {
        let d: DiaryGame[] = [];
        const g = game(["e4"], "white");
        for (let i = 0; i < DIARY_GAMES + 5; i++) d = addToDiary(d, g);
        expect(d.length).toBe(DIARY_GAMES);
    });
});

describe("steeringBook", () => {
    it("steuert JBLs Züge bis zum Fehler an", () => {
        const g = game(["e4", "c5", "Nf3", "d6", "d4"], "white", { 5: "??" });
        const book = steeringBook([g, g], "white");
        expect(book.map((b) => b.uci).sort()).toEqual(["c7c5", "d7d6"]);
        expect(book[0].weight).toBe(6);
    });
    it("ignoriert Partien ohne Fehler und andere Farbe", () => {
        expect(steeringBook([game(["e4", "c5"], "white")], "white")).toEqual([]);
        const g = game(["e4", "c5", "Nf3"], "white", { 3: "?" });
        expect(steeringBook([g], "black")).toEqual([]);
    });
});

describe("varietyBook", () => {
    it("antwortet anders, wenn Weiß dreimal dasselbe spielt", () => {
        const g = game(["e4", "c5"], "white");
        const plan = varietyBook([g, g, g], "white", () => 0);
        expect(plan.announce).toBe(true);
        expect(plan.book).toHaveLength(1);
        expect(plan.book[0].uci).toBe("e7e5");
        expect(plan.book[0].epd).toBe("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -");
    });
    it("eröffnet anders gegen Schwarz", () => {
        const g = game(["e4", "c5"], "black");
        const plan = varietyBook([g, g, g], "black", () => 0);
        expect(plan.book[0]).toEqual({ epd: START, uci: "d2d4", weight: 1 });
    });
    it("nichts bei Abwechslung oder zu wenigen Partien", () => {
        const a = game(["e4", "c5"], "white");
        const b = game(["d4", "d5"], "white");
        expect(varietyBook([a, b, a], "white").announce).toBe(false);
        expect(varietyBook([a, a], "white").announce).toBe(false);
    });
});

describe("Repertoire", () => {
    const rep = tree(["e4", "e5", "Nf3", "Nc6", "Bb5"], ["e4", "c5", "Nf3"], ["e4", "e6", "d4"]);

    it("repertoireBook enthält nur Gegnerzüge, gewichtet nach Linien", () => {
        const book = repertoireBook(rep, "white");
        const ucis = book.map((b) => b.uci).sort();
        expect(ucis).toEqual(["b8c6", "c7c5", "e7e5", "e7e6"]);
        expect(book.every((b) => b.weight === 1)).toBe(true);
        const asBlack = repertoireBook(rep, "black");
        const e4 = asBlack.find((b) => b.uci === "e2e4")!;
        expect(e4.weight).toBe(3);
    });

    it("diaryGaps findet Stellungen ohne Repertoire-Antwort", () => {
        const idx = epdIndex(rep);
        const g = game(["e4", "d5", "exd5"], "white");
        const gaps = diaryGaps([g, g, game(["e4", "e5", "Nf3"], "white")], "white", idx);
        expect(gaps).toHaveLength(1);
        expect(gaps[0].count).toBe(2);
        expect(gaps[0].line).toEqual(["e4", "d5"]);
        expect(formatLine(gaps[0].line)).toBe("1.e4 d5");
    });

    it("diaryGaps zählt nicht, wenn der Spieler selbst abweicht", () => {
        const g = game(["d4", "d5"], "white");
        expect(diaryGaps([g], "white", epdIndex(rep))).toEqual([]);
    });

    it("repertoireDeparture: eigener Zug", () => {
        const d = repertoireDeparture(tree(["e4", "e5", "Bc4"]), "white", epdIndex(rep));
        expect(d).toMatchObject({ kind: "own", ply: 3, played: "Bc4", expected: ["Nf3"] });
    });

    it("repertoireDeparture: Lücke mit Antwort", () => {
        const d = repertoireDeparture(tree(["e4", "d5", "exd5"]), "white", epdIndex(rep));
        expect(d).toEqual({ kind: "gap", ply: 2, jbl: "d5", played: "exd5", path: [0, 0, 0] });
    });

    it("repertoireDeparture: am Ende des Repertoires nichts", () => {
        const d = repertoireDeparture(tree(["e4", "c5", "Nf3", "d6"]), "white", epdIndex(rep));
        expect(d).toBeNull();
    });
});

describe("planCoachGame", () => {
    const rep = {
        root: tree(["e4", "e5", "Nf3"]),
    } as unknown as Parameters<typeof planCoachGame>[2];

    it("Sparring nutzt das Repertoire", () => {
        const plan = planCoachGame("white", [], rep, true);
        expect(plan.sparring).toBe(true);
        expect(plan.announce).toEqual(["sparring"]);
        expect(plan.book.map((b) => b.uci)).toEqual(["e7e5"]);
    });
    it("Sparring ohne Repertoire sagt es an", () => {
        const plan = planCoachGame("white", [], null, true, () => 0.9);
        expect(plan.sparring).toBe(false);
        expect(plan.announce).toEqual(["noRepertoire"]);
    });
    it("steuert nur manchmal", () => {
        const g = game(["e4", "c5", "Nf3"], "white", { 3: "?" });
        expect(planCoachGame("white", [g], null, false, () => 0.9).book).toEqual([]);
        expect(planCoachGame("white", [g], null, false, () => 0.1).book).toHaveLength(1);
    });
    it("pickRepertoire nimmt das Hauptrepertoire, sonst das größte", () => {
        const r = (name: string, leaves: number, main = false) =>
            ({ name, color: "white", owner: "me", main, stats: { leaves } }) as never;
        expect(pickRepertoire([r("a", 5), r("b", 9)], "white", "me")).toMatchObject({ name: "b" });
        expect(pickRepertoire([r("a", 5, true), r("b", 9)], "white", "me")).toMatchObject({
            name: "a",
        });
        expect(pickRepertoire([r("a", 5)], "black", "me")).toBeNull();
    });
});

describe("diarySummary", () => {
    it("zählt Ergebnisse, Eröffnungen und Problemstellen", () => {
        const s = diarySummary([
            game(["e4", "c5", "Nf3"], "white", { 3: "?" }, "win"),
            game(["e4", "e5"], "white", {}, "draw"),
            game(["d4", "Nf6"], "black", {}, "loss"),
        ]);
        expect(s).toMatchObject({ games: 3, wins: 1, draws: 1, losses: 1 });
        expect(s.firsts).toEqual([
            ["1.e4", 2],
            ["1.d4 Nf6", 1],
        ]);
        expect(s.trouble).toEqual([["1.e4 c5 2.Nf3", 1]]);
    });
});
