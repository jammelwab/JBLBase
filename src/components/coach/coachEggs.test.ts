import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { makeSan, parseSan } from "chessops/san";
import { createStore } from "jotai";
import { describe, expect, it } from "vitest";
import de from "@/translation/de-DE.json";
import en from "@/translation/en-US.json";
import { createNode, defaultTree, type TreeNode } from "@/utils/treeReducer";
import { epdIndex, epdOf } from "./coachDiary";
import {
    aprilFoolsBook,
    BUNNY_HUNTER_WINS,
    coachPatriciaWinsAtom,
    type EggInput,
    finishCoachEggsAtom,
    findPatricia,
    humanKingMate,
    humanKnightPromotion,
    isAprilFools,
    isEnPassant,
    MATE_DRILL_TASKS,
    catchBunnyAtom,
    patriciaEngineSetup,
    patriciaSkillLevel,
    repertoireToMate,
} from "./coachEggs";
import { LINE_VARIANTS } from "./coachGame";
import { planCoachGame } from "./coachPlan";
import { coachProfileAtom } from "./coachProfile";
import { coachLockAtom, coachMateDrillAtom, coachPuzzleDoneAtom } from "./coachProgress";
import {
    coachExtraFramesAtom,
    coachExtraItemsAtom,
    coachExtraTitlesAtom,
    coachTrophiesAtom,
} from "./coachRewards";

function tree(line: string[], fen?: string): TreeNode {
    const root = defaultTree(fen).root;
    let node = root;
    const pos = fen ? Chess.fromSetup(parseFen(fen).unwrap()).unwrap() : Chess.default();
    for (const san of line) {
        const move = parseSan(pos, san)!;
        expect(move).toBeTruthy();
        const s = makeSan(pos, move);
        pos.play(move);
        const child = createNode({
            move,
            san: s,
            fen: makeFen(pos.toSetup()),
            halfMoves: node.halfMoves + 1,
        });
        node.children.push(child);
        node = child;
    }
    return root;
}

const base: EggInput = {
    result: "win",
    attack: false,
    brilliants: 0,
    blunders: 0,
    takebacks: 0,
    missedMate: false,
    kingMate: false,
    knightPromotion: false,
    repertoireMate: false,
};

describe("Patricia", () => {
    it("findet Patricia unter den Engines", () => {
        expect(
            findPatricia([
                { type: "local", name: "Stockfish", path: "/sf" },
                { type: "local", name: "Patricia 5.1", path: "/p" },
            ])?.name,
        ).toBe("Patricia 5.1");
        expect(findPatricia([])).toBeNull();
    });
    it("wählt die nächste Stufe", () => {
        expect(patriciaSkillLevel(400)).toBe(1);
        expect(patriciaSkillLevel(1200)).toBe(4);
        expect(patriciaSkillLevel(1750)).toBe(9);
        expect(patriciaSkillLevel(3500)).toBe(20);
        expect(patriciaEngineSetup("medium").options[0].name).toBe("Skill_Level");
    });
    it("zählt Siege und vergibt Hasenjäger und Bass schlägt Hase", () => {
        const store = createStore();
        store.set(coachPatriciaWinsAtom, BUNNY_HUNTER_WINS - 1);
        const r = store.set(
            finishCoachEggsAtom,
            { ...base, attack: true, brilliants: 1 },
            () => 0.9,
        );
        expect(r.bunnyBlast).toBe(true);
        expect(r.trophies).toEqual(["bassBeatsBunny", "bunnyHunter"]);
        expect(store.get(coachExtraFramesAtom)).toContain("carrot");
        expect(store.get(coachExtraTitlesAtom)).toContain("BunnyHunter");
        expect(store.get(coachTrophiesAtom)).toContain("bunnyHunter");
    });
    it("Sticheleien nur manchmal", () => {
        const store = createStore();
        expect(
            store.set(finishCoachEggsAtom, { ...base, attack: true, result: "loss" }, () => 0.1)
                .lines,
        ).toEqual(["patriciaLoss"]);
        expect(
            store.set(finishCoachEggsAtom, { ...base, attack: true, result: "loss" }, () => 0.9)
                .lines,
        ).toEqual([]);
        expect(store.get(coachPatriciaWinsAtom)).toBe(0);
    });
    it("Hasenohren nur einmal neu", () => {
        const store = createStore();
        expect(store.set(catchBunnyAtom)).toBe(true);
        expect(store.set(catchBunnyAtom)).toBe(false);
        expect(store.get(coachExtraItemsAtom)).toEqual(["bunnyEars"]);
    });
});

describe("Aaron", () => {
    it("Matt in 1 übersehen: Strafzettel und fünf Matt-Aufgaben", () => {
        const store = createStore();
        store.set(coachProfileAtom, { eggs: ["aaron"], name: "Aaron" });
        store.set(coachLockAtom, 3);
        const r = store.set(finishCoachEggsAtom, { ...base, result: "loss", missedMate: true });
        expect(r.penalty).toBe(true);
        expect(r.lines).toEqual(["aaronMate"]);
        expect(store.get(coachLockAtom)).toBe(MATE_DRILL_TASKS);
        expect(store.get(coachMateDrillAtom)).toBe(true);
        for (let i = 0; i < MATE_DRILL_TASKS; i++) store.set(coachPuzzleDoneAtom, true);
        expect(store.get(coachLockAtom)).toBe(0);
        expect(store.get(coachMateDrillAtom)).toBe(false);
    });
    it("nicht für andere Spieler", () => {
        const store = createStore();
        const r = store.set(finishCoachEggsAtom, { ...base, result: "loss", missedMate: true });
        expect(r.penalty).toBe(false);
    });
    it("OberBoss nur fehlerfrei", () => {
        const store = createStore();
        store.set(coachProfileAtom, { eggs: ["aaron"] });
        expect(
            store.set(finishCoachEggsAtom, { ...base, repertoireMate: true, takebacks: 1 }).titles,
        ).toEqual([]);
        const r = store.set(finishCoachEggsAtom, { ...base, repertoireMate: true });
        expect(r.titles).toEqual(["OberBoss"]);
        expect(r.frames).toEqual(["oberBoss"]);
    });
    it("repertoireToMate", () => {
        const mate = ["f3", "e5", "g4", "Qh4#"];
        const rep = tree(mate);
        expect(repertoireToMate(tree(mate), "black", epdIndex(rep))).toBe(true);
        expect(repertoireToMate(tree(["f3", "e5", "g4"]), "black", epdIndex(rep))).toBe(false);
        expect(repertoireToMate(tree(["f3", "e6", "g4", "Qh4#"]), "black", epdIndex(rep))).toBe(
            false,
        );
    });
});

describe("Für alle", () => {
    it("en passant", () => {
        const fen = "rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3";
        expect(isEnPassant(fen, "e5f6")).toBe(true);
        expect(isEnPassant(fen, "e5e6")).toBe(false);
        expect(isEnPassant(fen, "d2d4")).toBe(false);
    });
    it("Matt mit dem König", () => {
        // Der König zieht weg und deckt den Turm auf
        const t = tree(["Kg5#"], "6rk/6p1/8/8/7K/8/8/7R w - - 0 1");
        expect(humanKingMate(t, "white")).toBe(true);
        expect(humanKingMate(t, "black")).toBe(false);
        expect(humanKingMate(tree(["Kg5"], "6rk/6p1/8/8/7K/8/8/R7 w - - 0 1"), "white")).toBe(
            false,
        );
    });
    it("Springer-Unterverwandlung", () => {
        const t = tree(["e8=N"], "7k/4P3/8/8/8/8/8/K7 w - - 0 1");
        expect(humanKnightPromotion(t, "white")).toBe(true);
        expect(humanKnightPromotion(t, "black")).toBe(false);
    });
    it("Sprüche bei Sieg mit Springer oder Königsmatt", () => {
        const store = createStore();
        const r = store.set(finishCoachEggsAtom, {
            ...base,
            knightPromotion: true,
            kingMate: true,
        });
        expect(r.lines).toEqual(["knightPromo", "kingMate"]);
        expect(r.titles).toEqual(["KingWalker"]);
    });
    it("1. April: 1.e4 e5 2.Ke2, nur wenn JBL Weiß hat", () => {
        expect(isAprilFools("2027-04-01")).toBe(true);
        expect(isAprilFools("2027-04-02")).toBe(false);
        const plan = planCoachGame("black", [], null, false, () => 0.9, "2027-04-01");
        expect(plan.book.slice(0, 2)).toEqual(aprilFoolsBook());
        expect(plan.announce).toEqual(["aprilFools"]);
        expect(planCoachGame("white", [], null, false, () => 0.9, "2027-04-01").book).toEqual([]);
        let n = tree(["e4", "e5"]);
        while (n.children.length > 0) n = n.children[0];
        expect(aprilFoolsBook()[1].epd).toBe(epdOf(n.fen));
    });
    it("alle Sprüche und Texte sind übersetzt", () => {
        const keys = [
            "attack",
            "patriciaWin",
            "patriciaLoss",
            "bassBeatsBunny",
            "knightPromo",
            "kingMate",
            "enPassant",
            "aaronMate",
            "oberBoss",
            "lambrusco",
            "aprilFools",
        ];
        for (const lang of [de, en]) {
            const tr = lang.translation as Record<string, string>;
            for (const k of keys)
                for (let i = 1; i <= LINE_VARIANTS[k]; i++)
                    expect(tr[`Coach.Line.${k}.${i}`], `${k}.${i}`).toBeTruthy();
            for (const k of ["TicketTitle", "TicketText", "Caught", "Again", "EarsLabel"])
                expect(tr[`Coach.Egg.${k}`]).toBeTruthy();
        }
    });
});
