import { Chess } from "chessops/chess";
import { makeFen } from "chessops/fen";
import { makeSan, parseSan } from "chessops/san";
import { createStore } from "jotai";
import { describe, expect, it } from "vitest";
import { createNode, defaultTree, type TreeNode } from "@/utils/treeReducer";
import {
    BOSS_BOOK_MAX,
    bossChallenge,
    buildBossBook,
    coachBossAtom,
    packBossBook,
    sanTokens,
    unpackBossBook,
} from "./coachBoss";
import { epdOf } from "./coachDiary";
import {
    coachDuelsSeenAtom,
    type Duel,
    duelOutcome,
    duelTurn,
    leader,
    overtake,
    parseDuel,
    parseRival,
    playDuelMove,
    settleDuelAtom,
} from "./coachDuelState";
import { computeReceipt, finishCoachGameAtom } from "./coachProgress";
import {
    coachDuelChampionAtom,
    coachExtraFramesAtom,
    coachSpecialTitlesAtom,
    coachTrophiesAtom,
} from "./coachRewards";
import { coachXpAtom } from "./coachState";

function tree(line: string[]): TreeNode {
    const root = defaultTree().root;
    let node = root;
    const pos = Chess.default();
    for (const san of line) {
        const move = parseSan(pos, san)!;
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

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -";

describe("Boss-Challenge", () => {
    const state = { pending: false, week: null };
    const win = { result: "win" as const, level: 6, isAdmin: false, wasBoss: false };

    it("fordert nach einem Sieg ab Level 5 mit 10 % heraus", () => {
        expect(bossChallenge(state, win, "2026-11-21", () => 0.05)).toEqual({
            pending: true,
            week: "2026-W47",
        });
        expect(bossChallenge(state, win, "2026-11-21", () => 0.5).pending).toBe(false);
        expect(bossChallenge(state, { ...win, level: 4 }, "2026-11-21", () => 0).pending).toBe(
            false,
        );
        expect(
            bossChallenge(state, { ...win, result: "draw" }, "2026-11-21", () => 0).pending,
        ).toBe(false);
    });
    it("höchstens einmal pro Woche, nie für den Admin", () => {
        const s = { pending: false, week: "2026-W47" };
        expect(bossChallenge(s, win, "2026-11-22", () => 0).pending).toBe(false);
        expect(bossChallenge(s, win, "2026-11-23", () => 0).pending).toBe(true);
        expect(bossChallenge(state, { ...win, isAdmin: true }, "2026-11-21", () => 0).pending).toBe(
            false,
        );
    });
    it("nach der Boss-Partie ist die Challenge vorbei", () => {
        const s = { pending: true, week: "2026-W47" };
        expect(bossChallenge(s, { ...win, wasBoss: true }, "2026-11-21", () => 0)).toEqual({
            pending: false,
            week: "2026-W47",
        });
    });
    it("dreifache XP und Trophäe für den Sieg gegen den Boss", () => {
        const plain = computeReceipt({
            result: "win",
            strength: "medium",
            brilliants: 0,
            goods: 0,
            blunders: 1,
            takebacks: 0,
            streakDays: 0,
            gameOfDay: 1,
        });
        const boss = computeReceipt({
            result: "win",
            strength: "medium",
            brilliants: 0,
            goods: 0,
            blunders: 1,
            takebacks: 0,
            streakDays: 0,
            gameOfDay: 1,
            bossWin: true,
        });
        expect(boss.total).toBe(plain.total * 3);
        expect(boss.lines.find((l) => l.key === "boss")?.xp).toBe(plain.total * 2);

        const store = createStore();
        store.set(coachBossAtom, { pending: true, week: "2020-W01" });
        const done = store.set(
            finishCoachGameAtom,
            {
                result: "win",
                strength: "fairlyHard",
                brilliants: 0,
                goods: 0,
                blunders: 0,
                takebacks: 0,
                boss: true,
            },
            () => 0.9,
        );
        expect(done.trophies).toContain("bossBeaten");
        expect(store.get(coachTrophiesAtom)).toContain("bossBeaten");
        expect(store.get(coachBossAtom).pending).toBe(false);
        expect(done.bossNext).toBe(false);
    });
    it("meldet eine neue Challenge nach einem normalen Sieg", () => {
        const store = createStore();
        store.set(coachXpAtom, 100_000);
        const done = store.set(
            finishCoachGameAtom,
            {
                result: "win",
                strength: "medium",
                brilliants: 0,
                goods: 0,
                blunders: 0,
                takebacks: 0,
            },
            () => 0.01,
        );
        expect(done.bossNext).toBe(true);
        expect(store.get(coachBossAtom).pending).toBe(true);
    });
});

describe("Boss-Buch", () => {
    it("liest SAN-Züge aus einer PGN", () => {
        expect(sanTokens("1. e4 {gut} e5 (1... c5 2. Nf3) 2. Nf3?! Nc6 $1 1-0")).toEqual([
            "e4",
            "e5",
            "Nf3",
            "Nc6",
        ]);
    });
    it("Repertoire hat Vorrang, sonst zählen die Partien", () => {
        const rep = [{ root: tree(["e4", "e5", "Nf3"]), color: "white" as const }];
        const games = [
            { movetext: "1. d4 d5 2. c4", color: "white" as const },
            { movetext: "1. e4 e5 2. Bc4", color: "white" as const },
            { movetext: "1. d4 Nf6", color: "white" as const },
            { movetext: "1. e4 c5", color: "black" as const },
        ];
        const book = buildBossBook(rep, games);
        const at = (epd: string) => book.filter((m) => m.epd === epd).map((m) => [m.uci, m.weight]);
        expect(at(START)).toEqual([["e2e4", 1000]]);
        let n = tree(["e4", "e5"]);
        while (n.children.length) n = n.children[0];
        expect(at(epdOf(n.fen))).toEqual([["g1f3", 1000]]);
        let d4 = tree(["d4", "d5"]);
        while (d4.children.length) d4 = d4.children[0];
        expect(at(epdOf(d4.fen))).toEqual([["c2c4", 1]]);
        let e4 = tree(["e4"]);
        while (e4.children.length) e4 = e4.children[0];
        expect(at(epdOf(e4.fen))).toEqual([["c7c5", 1]]);
    });
    it("packt und entpackt", () => {
        const book = [{ epd: START, uci: "e2e4", weight: 3 }];
        expect(unpackBossBook({ moves: packBossBook(book) })).toEqual(book);
        expect(unpackBossBook({ moves: ["kaputt", 5, `${START}|e2e4|0`] })).toEqual([]);
        expect(unpackBossBook(null)).toEqual([]);
        expect(BOSS_BOOK_MAX).toBeLessThanOrEqual(8000);
    });
});

describe("Duell", () => {
    const duel = (over: Partial<Duel> = {}): Duel => ({
        id: "d1",
        players: ["a", "b"],
        white: "a",
        black: "b",
        names: { a: "Aaron", b: "Ben" },
        moves: [],
        result: "*",
        reason: null,
        updatedAt: 0,
        ...over,
    });

    it("Rivale und Überholen", () => {
        const r = parseRival("b", { level: 5, xp: 600, name: "Ben" })!;
        expect(r).toEqual({ uid: "b", name: "Ben", level: 5, xp: 600 });
        expect(parseRival("b", { level: "5" })).toBeNull();
        expect(leader({ level: 7, xp: 900 }, r)).toBe("me");
        expect(leader({ level: 5, xp: 500 }, r)).toBe("rival");
        expect(overtake("me", "rival")).toBe("overtaken");
        expect(overtake("rival", "me")).toBe("overtook");
        expect(overtake(null, "me")).toBeNull();
        expect(overtake("me", "me")).toBeNull();
    });
    it("Züge, Zugrecht und Ende", () => {
        expect(duelTurn(duel())).toBe("a");
        expect(duelTurn(duel({ moves: ["e2e4"] }))).toBe("b");
        expect(playDuelMove([], "e2e5")).toBeNull();
        let moves: string[] = [];
        for (const m of ["f2f3", "e7e5", "g2g4", "d8h4"]) moves = playDuelMove(moves, m)!;
        expect(duelOutcome(moves)).toEqual({ result: "0-1", reason: "mate" });
        expect(duelOutcome(["e2e4"])).toEqual({ result: "*", reason: null });
    });
    it("liest Duelle vorsichtig", () => {
        expect(parseDuel("x", { players: ["a"] })).toBeNull();
        const d = parseDuel("x", {
            players: ["a", "b"],
            white: "a",
            black: "b",
            moves: ["e2e4", 3],
            result: "1-0",
            names: { a: "Aaron" },
        })!;
        expect(d.moves).toEqual(["e2e4"]);
        expect(d.result).toBe("1-0");
    });
    it("Sieger wird Champion, bis der andere gewinnt; Remis ändert nichts", () => {
        const store = createStore();
        expect(store.set(settleDuelAtom, duel({ id: "1", result: "1-0" }), "a")).toBe("won");
        expect(store.get(coachSpecialTitlesAtom)).toContain("DuelChampion");
        expect(store.get(coachExtraFramesAtom)).toContain("duel");
        // Dasselbe Duell zählt nur einmal
        expect(store.set(settleDuelAtom, duel({ id: "1", result: "1-0" }), "a")).toBeNull();
        expect(store.set(settleDuelAtom, duel({ id: "2", result: "1/2-1/2" }), "a")).toBe("draw");
        expect(store.get(coachDuelChampionAtom)).toBe(true);
        expect(store.set(settleDuelAtom, duel({ id: "3", result: "0-1" }), "a")).toBe("lost");
        expect(store.get(coachSpecialTitlesAtom)).not.toContain("DuelChampion");
        expect(store.get(coachDuelsSeenAtom)).toEqual(["1", "2", "3"]);
        expect(store.set(settleDuelAtom, duel({ id: "4" }), "a")).toBeNull();
    });
});
