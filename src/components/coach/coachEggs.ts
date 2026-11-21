import { parseUci } from "chessops";
import { Chess } from "chessops/chess";
import { parseFen } from "chessops/fen";
import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import type { BookMove, GoMode } from "@/bindings";
import type { LocalEngine } from "@/utils/engines";
import type { TreeNode } from "@/utils/treeReducer";
import { epdOf } from "./coachDiary";
import { coachProfileAtom } from "./coachProfile";
import {
    awardTrophyAtom,
    type CoachExtraTitle,
    type CoachFrameId,
    type CoachItemId,
    type CoachTrophyId,
    coachExtraFramesAtom,
    coachExtraItemsAtom,
    coachExtraTitlesAtom,
} from "./coachRewards";
import { COACH_STRENGTHS, type CoachStrengthId } from "./coachState";
import { coachLockAtom, coachMateDrillAtom } from "./coachProgress";
import { isBirthdayAtom } from "./coachBirthday";

// Easter Eggs und der Angriffsmodus mit Patricia. Die Auslöser stehen nur
// hier im Code, nirgends in der App.

// ---------- Angriffsmodus (Patricia) ----------

export const ATTACK_LEVEL = 5;
export const coachAttackAtom = atomWithStorage<boolean>("jbl-coach-attack", false);
export const coachPatriciaWinsAtom = atomWithStorage<number>("jbl-coach-patricia-wins", 0);
export const BUNNY_HUNTER_WINS = 10;
// Sticheleien gegen Patricia: etwa jede fünfte passende Gelegenheit
export const TEASE_CHANCE = 0.2;

export function findPatricia(engines: unknown[] | null | undefined): LocalEngine | null {
    const local = (engines ?? []).filter(
        (e): e is LocalEngine => (e as LocalEngine)?.type === "local",
    );
    return local.find((e) => /patricia/i.test(e.name) || /patricia/i.test(e.path)) ?? null;
}

// Patricias Stufen (Skill_Level 1 bis 20) und ihre Elo laut README
const PATRICIA_LEVELS = [
    500, 800, 1000, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900, 2000, 2100, 2200, 2300, 2400,
    2500, 2650, 2800, 3000,
];

export function patriciaSkillLevel(elo: number): number {
    let best = 0;
    for (let i = 1; i < PATRICIA_LEVELS.length; i++)
        if (Math.abs(PATRICIA_LEVELS[i] - elo) < Math.abs(PATRICIA_LEVELS[best] - elo)) best = i;
    return best + 1;
}

export function patriciaEngineSetup(strength: CoachStrengthId): {
    go: GoMode;
    options: { name: string; value: string }[];
} {
    const elo = COACH_STRENGTHS.find((s) => s.id === strength)?.elo ?? 1200;
    return {
        go: { t: "Time", c: elo >= 2300 ? 1500 : 1000 },
        options: [{ name: "Skill_Level", value: String(patriciaSkillLevel(elo)) }],
    };
}

// ---------- Persönliche Eggs ----------

export type CoachEgg = "aaron" | "ben";

export const coachEggsAtom = atom((get) => {
    const eggs = get(coachProfileAtom).eggs ?? [];
    return { aaron: eggs.includes("aaron"), ben: eggs.includes("ben") };
});

// Ben: die Lambrusco-Schubkarre höchstens einmal am Tag
export const coachLambruscoDayAtom = atomWithStorage<string>("jbl-coach-lambrusco", "");

// Aaron: nach übersehenem Matt in 1 fünf Matt-in-1-Aufgaben statt drei
export const MATE_DRILL_TASKS = 5;
export const MATE_DRILL_THEME = "mateIn1";

// ---------- Hasenohren auf der Coach-Seite ----------

export const EARS_CHANCE = 1 / 50;
export const EARS_WINDOW_MS = 3000;

// ---------- Für alle ----------

const START_EPD = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -";
const AFTER_E4_E5 = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -";

export function isAprilFools(day: string): boolean {
    return day.slice(5) === "04-01";
}

// Am 1. April eröffnet JBL mit 1.e4 e5 2.Ke2 und tut, als wäre nichts.
export function aprilFoolsBook(): BookMove[] {
    return [
        { epd: START_EPD, uci: "e2e4", weight: 1000 },
        { epd: AFTER_E4_E5, uci: "e1e2", weight: 1000 },
    ];
}

// Schlägt der Zug en passant?
export function isEnPassant(fenBefore: string, uci: string): boolean {
    const setup = parseFen(fenBefore);
    const move = parseUci(uci);
    if (!setup.isOk || !move || !("from" in move)) return false;
    const pos = Chess.fromSetup(setup.value);
    if (!pos.isOk) return false;
    const p = pos.value;
    const piece = p.board.get(move.from);
    return (
        piece?.role === "pawn" &&
        move.to === p.epSquare &&
        move.from % 8 !== move.to % 8 &&
        !p.board.has(move.to)
    );
}

function mainLine(root: TreeNode): TreeNode[] {
    const out: TreeNode[] = [];
    let n = root;
    while (n.children.length > 0) {
        n = n.children[0];
        out.push(n);
    }
    return out;
}

const moverOf = (n: TreeNode) => (n.halfMoves % 2 === 1 ? "white" : "black");

// Matt mit dem König als letzter ziehender Figur (z. B. durch Rochade
// oder Abzug)
export function humanKingMate(root: TreeNode, humanColor: "white" | "black"): boolean {
    const last = mainLine(root).at(-1);
    if (!last?.san || moverOf(last) !== humanColor) return false;
    return last.san.endsWith("#") && (last.san.startsWith("K") || last.san.startsWith("O-O"));
}

// Eine Unterverwandlung in einen Springer in einer gewonnenen Partie
export function humanKnightPromotion(root: TreeNode, humanColor: "white" | "black"): boolean {
    return mainLine(root).some((n) => moverOf(n) === humanColor && /=N/.test(n.san ?? ""));
}

// OberBoss: Die ganze Partie lief im Repertoire, und das Repertoire geht
// bis zum Matt, das der Spieler selbst setzt.
export function repertoireToMate(
    root: TreeNode,
    humanColor: "white" | "black",
    index: Map<string, string[]>,
): boolean {
    let prev = root;
    const line = mainLine(root);
    const last = line.at(-1);
    if (!last?.san?.endsWith("#") || moverOf(last) !== humanColor) return false;
    for (const n of line) {
        if (moverOf(n) === humanColor && !index.get(epdOf(prev.fen))?.includes(n.san ?? ""))
            return false;
        prev = n;
    }
    return true;
}

// ---------- Auswertung am Ende der Partie ----------

export type EggInput = {
    result: "win" | "draw" | "loss";
    attack: boolean;
    brilliants: number;
    blunders: number;
    takebacks: number;
    // Partie durch ein übersehenes Matt in 1 verloren
    missedMate: boolean;
    kingMate: boolean;
    knightPromotion: boolean;
    repertoireMate: boolean;
};

export type EggResult = {
    // Sätze, die JBL danach sagt (Schlüssel unter Coach.Line)
    lines: string[];
    trophies: CoachTrophyId[];
    titles: CoachExtraTitle[];
    frames: CoachFrameId[];
    items: CoachItemId[];
    // Patricia wurde mit einem !! besiegt: der Hase fliegt
    bunnyBlast: boolean;
    // Aaron: Strafzettel und fünf Matt-in-1-Aufgaben
    penalty: boolean;
};

function addTo<T extends string>(list: readonly T[], id: T): T[] | null {
    return list.includes(id) ? null : [...list, id];
}

export const finishCoachEggsAtom = atom(
    null,
    (get, set, g: EggInput, random: () => number = Math.random): EggResult => {
        const eggs = get(coachEggsAtom);
        const out: EggResult = {
            lines: [],
            trophies: [],
            titles: [],
            frames: [],
            items: [],
            bunnyBlast: false,
            penalty: false,
        };
        const title = (id: CoachExtraTitle) => {
            const next = addTo(get(coachExtraTitlesAtom), id);
            if (next) {
                set(coachExtraTitlesAtom, next);
                out.titles.push(id);
            }
        };
        const frame = (id: CoachFrameId) => {
            const next = addTo(get(coachExtraFramesAtom), id);
            if (next) {
                set(coachExtraFramesAtom, next);
                out.frames.push(id);
            }
        };
        const trophy = (id: CoachTrophyId) => {
            if (set(awardTrophyAtom, id)) out.trophies.push(id);
        };

        if (g.attack) {
            if (g.result === "win") {
                const wins = get(coachPatriciaWinsAtom) + 1;
                set(coachPatriciaWinsAtom, wins);
                if (g.brilliants > 0) {
                    out.bunnyBlast = true;
                    out.lines.push("bassBeatsBunny");
                    trophy("bassBeatsBunny");
                }
                if (wins >= BUNNY_HUNTER_WINS) {
                    trophy("bunnyHunter");
                    frame("carrot");
                    title("BunnyHunter");
                }
                if (random() < TEASE_CHANCE) out.lines.push("patriciaWin");
            } else if (g.result === "loss" && random() < TEASE_CHANCE)
                out.lines.push("patriciaLoss");
        }

        if (g.result === "win" && g.knightPromotion) out.lines.push("knightPromo");
        if (g.result === "win" && g.kingMate) {
            title("KingWalker");
            out.lines.push("kingMate");
        }

        if (eggs.aaron) {
            if (g.missedMate && g.result === "loss" && !get(isBirthdayAtom)) {
                out.penalty = true;
                out.lines.push("aaronMate");
                set(coachLockAtom, MATE_DRILL_TASKS);
                set(coachMateDrillAtom, true);
            }
            if (g.result === "win" && g.repertoireMate && g.blunders === 0 && g.takebacks === 0) {
                title("OberBoss");
                frame("oberBoss");
                out.lines.push("oberBoss");
            }
        }
        return out;
    },
);

// Patricias Ohren wurden rechtzeitig angeklickt: die Hasenohren als Verzierung
export const catchBunnyAtom = atom(null, (get, set): boolean => {
    const next = addTo(get(coachExtraItemsAtom), "bunnyEars");
    if (next) set(coachExtraItemsAtom, next);
    return next !== null;
});
