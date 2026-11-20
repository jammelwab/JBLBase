import { createStore } from "jotai";
import { describe, expect, it } from "vitest";
import de from "@/translation/de-DE.json";
import en from "@/translation/en-US.json";
import {
    coachLockAtom,
    coachMistakeAtom,
    coachMistakeDoneAtom,
    computeReceipt,
    finishCoachGameAtom,
} from "./coachProgress";
import {
    advanceQuest,
    COACH_FRAMES,
    COACH_ITEMS,
    COACH_TROPHIES,
    coachBonusTrackAtom,
    coachTrophiesAtom,
    currentQuest,
    DAILY_QUESTS,
    estimateStrength,
    EXTRA_TITLES,
    itemsUnlockedBetween,
    questForDay,
    shownTitle,
    toggleOutfit,
    unlockedItems,
} from "./coachRewards";

describe("Verzierungen", () => {
    it("schaltet nach Level frei und ersetzt Teile an derselben Stelle", () => {
        expect(unlockedItems(1, [])).toEqual([]);
        expect(unlockedItems(4, [])).toEqual(["sunglasses", "scarf", "beanie"]);
        expect(unlockedItems(1, ["partyHat"])).toEqual(["partyHat"]);
        expect(toggleOutfit(["beanie", "scarf"], "headphones")).toEqual(["scarf", "headphones"]);
        expect(toggleOutfit(["beanie"], "beanie")).toEqual([]);
        expect(itemsUnlockedBetween(1, 3)).toEqual(["sunglasses", "scarf"]);
    });

    it("zeigt nur freigeschaltete Titel", () => {
        expect(shownTitle(1, "KingMaker", [])).toBe("PawnPusher");
        expect(shownTitle(20, "KnightFan", [])).toBe("KnightFan");
        expect(shownTitle(1, "OberBoss", ["OberBoss"])).toBe("OberBoss");
    });
});

describe("Tagesaufgabe", () => {
    it("ist pro Tag fest und zählt bis zum Ziel", () => {
        expect(questForDay("2026-11-21")).toBe(questForDay("2026-11-21"));
        const q = { day: "d", id: "puzzles" as const, progress: 0, done: false };
        let r = advanceQuest(q, "puzzles");
        r = advanceQuest(r.quest, "puzzles");
        expect(r.completed).toBe(false);
        r = advanceQuest(r.quest, "puzzles");
        expect(r.completed).toBe(true);
        expect(advanceQuest(r.quest, "puzzles").completed).toBe(false);
        expect(advanceQuest(q, "win").quest).toBe(q);
        expect(currentQuest(r.quest, "neu").progress).toBe(0);
    });
});

describe("Stärke-Schätzung", () => {
    it("braucht 5 Partien und liegt bei 50 % auf der Stufe", () => {
        const four = Array.from({ length: 4 }, () => ({ elo: 1500, score: 0.5 }));
        expect(estimateStrength(four)).toBeNull();
        const est = estimateStrength([...four, { elo: 1500, score: 0.5 }]) ?? 0;
        expect(Math.abs(est - 1500)).toBeLessThanOrEqual(10);
        const wins = estimateStrength(Array.from({ length: 6 }, () => ({ elo: 1200, score: 1 })));
        expect(wins).toBeGreaterThan(1400);
        expect(wins).toBeLessThan(2000);
    });
});

describe("Kassenzettel mit Extras", () => {
    it("rechnet Tagesaufgabe und Bonus-Track vor dem Geburtstag", () => {
        const r = computeReceipt({
            result: "loss",
            strength: "fairlyEasy",
            brilliants: 0,
            goods: 0,
            blunders: 1,
            takebacks: 0,
            streakDays: 0,
            gameOfDay: 1,
            questXp: 40,
            bonusTrack: true,
            birthday: true,
        });
        // (20 + 40) × 2 × 2
        expect(r.total).toBe(240);
        expect(r.lines.map((l) => l.key)).toEqual([
            "played",
            "quest",
            "bonusTrack",
            "birthday",
            "total",
        ]);
    });
});

describe("Partieende", () => {
    const game = {
        strength: "hard" as const,
        brilliants: 1,
        goods: 0,
        blunders: 0,
        takebacks: 0,
    };

    it("vergibt Trophäen, lost den Bonus-Track und merkt sich den Fehler", () => {
        const store = createStore();
        const won = store.set(finishCoachGameAtom, { ...game, result: "win" }, () => 0);
        expect(won.trophies).toEqual(
            expect.arrayContaining(["firstWin", "firstBrilliant", "cleanWin", "beatHard"]),
        );
        expect(store.get(coachTrophiesAtom)).toContain("firstWin");
        expect(won.bonusNext).toBe(true);
        expect(store.get(coachBonusTrackAtom)).toBe(true);

        const mistake = { fen: "8/8/8/8/8/8/8/8 w - - 0 1", played: "Kh1", solutions: ["Kg1"] };
        const lost = store.set(
            finishCoachGameAtom,
            { ...game, result: "loss", mistake },
            () => 0.99,
        );
        expect(lost.trophies).toEqual([]);
        expect(lost.lines.some((l) => l.key === "bonusTrack")).toBe(true);
        expect(store.get(coachBonusTrackAtom)).toBe(false);
        expect(store.get(coachMistakeAtom)).toEqual(mistake);
        expect(store.get(coachLockAtom)).toBe(3);

        store.set(coachMistakeDoneAtom, true);
        expect(store.get(coachMistakeAtom)).toBeNull();
        expect(store.get(coachLockAtom)).toBe(2);
    });
});

describe("Übersetzungen der Belohnungen", () => {
    it("gibt es auf Deutsch und Englisch", () => {
        const keys = [
            ...COACH_ITEMS.map((i) => `Coach.Item.${i.id}`),
            ...COACH_FRAMES.map((f) => `Coach.Frame.${f.id}`),
            ...EXTRA_TITLES.map((x) => `Coach.Title.${x}`),
            ...COACH_TROPHIES.flatMap((x) => [`Coach.Trophy.${x}.Title`, `Coach.Trophy.${x}.Desc`]),
            ...DAILY_QUESTS.map((q) => `Coach.Quest.${q.id}`),
            "Coach.Receipt.quest",
            "Coach.Receipt.bonusTrack",
        ];
        for (const t of [de.translation, en.translation] as Record<string, string>[]) {
            for (const k of keys) expect(t[k]).toBeTruthy();
        }
    });
});
