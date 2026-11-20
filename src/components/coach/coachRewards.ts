import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { COACH_STRENGTHS, type CoachStrengthId, coachTitleKey } from "./coachState";

// ---------- Verzierungen für die Figur ----------

// Jede Verzierung sitzt an einer Stelle; pro Stelle trägt JBL höchstens eine.
export type CoachItemSlot = "eyes" | "head" | "neck" | "color";

export const COACH_ITEMS = [
    { id: "sunglasses", slot: "eyes", level: 2 },
    { id: "scarf", slot: "neck", level: 3 },
    { id: "beanie", slot: "head", level: 4 },
    { id: "headphones", slot: "head", level: 5 },
    { id: "bowtie", slot: "neck", level: 6 },
    { id: "blueBox", slot: "color", level: 8 },
    { id: "crown", slot: "head", level: 15 },
    // Nur über Easter Eggs und besondere Tage
    { id: "partyHat", slot: "head", level: null },
    { id: "bunnyEars", slot: "head", level: null },
    { id: "medal", slot: "neck", level: null },
] as const satisfies readonly { id: string; slot: CoachItemSlot; level: number | null }[];

export type CoachItemId = (typeof COACH_ITEMS)[number]["id"];

// Verzierungen, die man außerhalb der Level bekommen hat
export const coachExtraItemsAtom = atomWithStorage<CoachItemId[]>("jbl-coach-items", []);
// Was JBL gerade trägt
export const coachOutfitAtom = atomWithStorage<CoachItemId[]>("jbl-coach-outfit", []);

export function unlockedItems(level: number, extra: readonly string[]): CoachItemId[] {
    return COACH_ITEMS.filter(
        (i) => (i.level !== null && level >= i.level) || extra.includes(i.id),
    ).map((i) => i.id);
}

export function itemSlot(id: string): CoachItemSlot | undefined {
    return COACH_ITEMS.find((i) => i.id === id)?.slot;
}

// An- oder ablegen; ein neues Teil ersetzt das alte an derselben Stelle.
export function toggleOutfit(outfit: readonly CoachItemId[], id: CoachItemId): CoachItemId[] {
    if (outfit.includes(id)) return outfit.filter((x) => x !== id);
    const slot = itemSlot(id);
    return [...outfit.filter((x) => itemSlot(x) !== slot), id];
}

// Neu freigeschaltete Verzierungen beim Aufstieg von Level a auf b
export function itemsUnlockedBetween(a: number, b: number): CoachItemId[] {
    return COACH_ITEMS.filter((i) => i.level !== null && i.level > a && i.level <= b).map(
        (i) => i.id,
    );
}

// ---------- Rahmen ----------

export const COACH_FRAMES = [
    { id: "standard", level: 1, color: "var(--mantine-color-default-border)" },
    { id: "bronze", level: 5, color: "#b4733c" },
    { id: "silver", level: 10, color: "#a9b0bb" },
    { id: "gold", level: 20, color: "#e2b33c" },
    { id: "duel", level: null, color: "#cf3a33" },
    { id: "oberBoss", level: null, color: "#f2c94c" },
    { id: "carrot", level: null, color: "#f58220" },
] as const;

export type CoachFrameId = (typeof COACH_FRAMES)[number]["id"];

export const coachExtraFramesAtom = atomWithStorage<CoachFrameId[]>("jbl-coach-frames", []);
export const coachFrameAtom = atomWithStorage<CoachFrameId>("jbl-coach-frame", "standard");

export function unlockedFrames(level: number, extra: readonly string[]): CoachFrameId[] {
    return COACH_FRAMES.filter(
        (f) => (f.level !== null && level >= f.level) || extra.includes(f.id),
    ).map((f) => f.id);
}

export function frameColor(id: string): string {
    return (COACH_FRAMES.find((f) => f.id === id) ?? COACH_FRAMES[0]).color;
}

// ---------- Titel ----------

// Level-Titel kommen aus coachState; dazu Titel aus besonderen Momenten.
export const EXTRA_TITLES = ["DuelChampion", "OberBoss", "KingWalker", "BunnyHunter"] as const;
export type CoachExtraTitle = (typeof EXTRA_TITLES)[number];

export const coachExtraTitlesAtom = atomWithStorage<CoachExtraTitle[]>("jbl-coach-titles", []);
// Gewählter Titel; null = der aktuelle Level-Titel
export const coachShownTitleAtom = atomWithStorage<string | null>("jbl-coach-title", null);

const LEVEL_TITLE_STEPS = [1, 4, 6, 8, 12, 20];

export function unlockedTitles(level: number, extra: readonly string[]): string[] {
    const fromLevel = LEVEL_TITLE_STEPS.filter((l) => level >= l).map((l) => coachTitleKey(l));
    return [...new Set([...fromLevel, ...extra])];
}

export function shownTitle(level: number, chosen: string | null, extra: readonly string[]) {
    if (chosen && unlockedTitles(level, extra).includes(chosen)) return chosen;
    return coachTitleKey(level);
}

// ---------- Trophäen ----------

export const COACH_TROPHIES = [
    "firstWin",
    "firstBrilliant",
    "cleanWin",
    "beatHard",
    "streak7",
    "streak30",
    "level10",
    "bossBeaten",
    "bassBeatsBunny",
    "bunnyHunter",
] as const;

export type CoachTrophyId = (typeof COACH_TROPHIES)[number];

export const coachTrophiesAtom = atomWithStorage<CoachTrophyId[]>("jbl-coach-trophies", []);

export const awardTrophyAtom = atom(null, (get, set, id: CoachTrophyId): boolean => {
    const have = get(coachTrophiesAtom);
    if (have.includes(id)) return false;
    set(coachTrophiesAtom, [...have, id]);
    return true;
});

// Trophäen, die eine Partie gegen JBL einbringt
export function trophiesForGame(g: {
    result: "win" | "draw" | "loss";
    strength: CoachStrengthId;
    brilliants: number;
    blunders: number;
    takebacks: number;
    streakDays: number;
    level: number;
}): CoachTrophyId[] {
    const out: CoachTrophyId[] = [];
    if (g.result === "win") out.push("firstWin");
    if (g.brilliants > 0) out.push("firstBrilliant");
    if (g.result === "win" && g.blunders === 0 && g.takebacks === 0) out.push("cleanWin");
    if (g.result === "win" && (g.strength === "hard" || g.strength === "veryHard"))
        out.push("beatHard");
    if (g.streakDays >= 7) out.push("streak7");
    if (g.streakDays >= 30) out.push("streak30");
    if (g.level >= 10) out.push("level10");
    return out;
}

// ---------- Bonus-Track ----------

// Ab und zu, nie angekündigt: die nächste Partie bringt doppelte XP.
export const coachBonusTrackAtom = atomWithStorage<boolean>("jbl-coach-bonus-track", false);
export const BONUS_TRACK_CHANCE = 0.1;

// ---------- Tagesaufgabe ----------

export const DAILY_QUESTS = [
    { id: "findGood", target: 1 },
    { id: "win", target: 1 },
    { id: "puzzles", target: 3 },
    { id: "repertoire", target: 10 },
    { id: "clean", target: 1 },
] as const;

export type DailyQuestId = (typeof DAILY_QUESTS)[number]["id"];
export const DAILY_QUEST_XP = 40;

export type DailyQuest = { day: string; id: DailyQuestId; progress: number; done: boolean };

export const coachQuestAtom = atomWithStorage<DailyQuest | null>("jbl-coach-quest", null);

// Jeden Tag eine andere Aufgabe, für alle am selben Tag dieselbe.
export function questForDay(day: string): DailyQuestId {
    let h = 0;
    for (const c of day) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return DAILY_QUESTS[h % DAILY_QUESTS.length].id;
}

export function questTarget(id: DailyQuestId): number {
    return DAILY_QUESTS.find((q) => q.id === id)?.target ?? 1;
}

export function currentQuest(stored: DailyQuest | null, day: string): DailyQuest {
    if (stored && stored.day === day) return stored;
    return { day, id: questForDay(day), progress: 0, done: false };
}

// Fortschritt eintragen. Gibt zurück, ob die Aufgabe damit gerade fertig wurde.
export function advanceQuest(
    q: DailyQuest,
    event: DailyQuestId,
    amount = 1,
): { quest: DailyQuest; completed: boolean } {
    if (q.done || q.id !== event || amount <= 0) return { quest: q, completed: false };
    const progress = Math.min(questTarget(q.id), q.progress + amount);
    const done = progress >= questTarget(q.id);
    return { quest: { ...q, progress, done }, completed: done };
}

// ---------- Stärke-Schätzung ----------

export type CoachResult = { elo: number; score: number };

// Die letzten 30 Ergebnisse gegen JBL (Stufen-Elo und 1 / 0,5 / 0)
export const coachResultsAtom = atomWithStorage<CoachResult[]>("jbl-coach-results", []);
export const coachBestEstimateAtom = atomWithStorage<number>("jbl-coach-best-estimate", 0);
export const ESTIMATE_MIN_GAMES = 5;

export function strengthElo(id: CoachStrengthId): number {
    return COACH_STRENGTHS.find((s) => s.id === id)?.elo ?? 1200;
}

// Leistungszahl: die Elo, bei der die erwartete Punktzahl gegen die
// gespielten Stufen der erreichten entspricht. 100 Punkte Puffer an den
// Rändern, damit 100 % oder 0 % nicht ins Unendliche laufen.
export function estimateStrength(results: readonly CoachResult[]): number | null {
    if (results.length < ESTIMATE_MIN_GAMES) return null;
    const n = results.length;
    const score = Math.min(
        n - 0.5,
        Math.max(
            0.5,
            results.reduce((s, r) => s + r.score, 0),
        ),
    );
    const expected = (r: number) =>
        results.reduce((s, x) => s + 1 / (1 + 10 ** ((x.elo - r) / 400)), 0);
    let lo = 0;
    let hi = 3400;
    for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (expected(mid) < score) lo = mid;
        else hi = mid;
    }
    return Math.round((lo + hi) / 2 / 10) * 10;
}
