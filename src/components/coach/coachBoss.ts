import { makeUci } from "chessops";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { parseSan } from "chessops/san";
import { atomWithStorage } from "jotai/utils";
import type { BookMove, GoMode } from "@/bindings";
import type { TreeNode } from "@/utils/treeReducer";
import { epdOf } from "./coachDiary";
import { isoWeek } from "./coachProgress";

// Boss-Challenge: Selten fordert der Boss heraus. Statt JBL spielt man gegen
// „Jannick“: erst seine Repertoire-Züge, dann Züge aus seinen Chess.com-
// Partien, sonst Stockfish mit ca. 1800.

export const BOSS_LEVEL = 5;
export const BOSS_CHANCE = 0.1;
export const BOSS_ELO = 1800;
export const BOSS_NAME = "Jannick";
// So viele Halbzüge einer Partie kommen ins Boss-Buch
export const BOSS_BOOK_PLIES = 24;
// Höchstens so viele Einträge (ein Firestore-Dokument hat 1 MB)
export const BOSS_BOOK_MAX = 8000;
// Repertoire-Züge haben Vorrang vor allem, was der Boss sonst gespielt hat
const REPERTOIRE_WEIGHT = 1000;

// Steht eine Boss-Partie an? Und in welcher Woche kam die letzte?
export type CoachBossState = { pending: boolean; week: string | null };
export const coachBossAtom = atomWithStorage<CoachBossState>("jbl-coach-boss", {
    pending: false,
    week: null,
});

// Das Boss-Buch aus der Cloud, lokal gemerkt
export const coachBossBookAtom = atomWithStorage<BookMove[]>("jbl-coach-boss-book", []);

// Nach einem Sieg: fordert der Boss heraus?
export function bossChallenge(
    state: CoachBossState,
    g: { result: "win" | "draw" | "loss"; level: number; isAdmin: boolean; wasBoss: boolean },
    day: string,
    random: () => number,
): CoachBossState {
    const done = g.wasBoss ? { ...state, pending: false } : state;
    if (g.isAdmin || g.wasBoss || done.pending) return done;
    if (g.result !== "win" || g.level < BOSS_LEVEL) return done;
    const week = isoWeek(day);
    if (done.week === week) return done;
    if (random() >= BOSS_CHANCE) return done;
    return { pending: true, week };
}

export function bossEngineSetup(): { go: GoMode; options: { name: string; value: string }[] } {
    return {
        go: { t: "Time", c: 1000 },
        options: [
            { name: "UCI_LimitStrength", value: "true" },
            { name: "UCI_Elo", value: String(BOSS_ELO) },
        ],
    };
}

// SAN-Züge aus dem Zugteil einer PGN, ohne Kommentare, Varianten und Nummern
export function sanTokens(movetext: string): string[] {
    let text = movetext.replace(/\{[^}]*\}/g, " ").replace(/;[^\n]*/g, " ");
    // Varianten von innen nach außen entfernen
    for (let prev = ""; prev !== text;) {
        prev = text;
        text = text.replace(/\([^()]*\)/g, " ");
    }
    return text
        .split(/\s+/)
        .map((t) => t.replace(/^\d+\.+/, "").replace(/[!?]+$/, ""))
        .filter((t) => t && !/^\$\d+$/.test(t) && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t));
}

type Counts = Map<string, Map<string, number>>;

function count(map: Counts, epd: string, uci: string, n = 1) {
    const m = map.get(epd) ?? new Map<string, number>();
    m.set(uci, (m.get(uci) ?? 0) + n);
    map.set(epd, m);
}

export type BossGame = { movetext: string; color: "white" | "black"; fen?: string };
export type BossRepertoire = { root: TreeNode; color: "white" | "black" };

// Das Boss-Buch: Stellung -> eigene Züge des Bosses. Steht eine Stellung im
// Repertoire, zählen nur die Repertoire-Züge.
export function buildBossBook(repertoires: BossRepertoire[], games: BossGame[]): BookMove[] {
    const rep: Counts = new Map();
    for (const { root, color } of repertoires) {
        const stack = [root];
        while (stack.length > 0) {
            const node = stack.pop()!;
            const turn = node.halfMoves % 2 === 0 ? "white" : "black";
            const epd = epdOf(node.fen);
            for (const child of node.children) {
                stack.push(child);
                if (turn === color && child.move) count(rep, epd, makeUci(child.move));
            }
        }
    }
    const played: Counts = new Map();
    for (const g of games) {
        const setup = g.fen ? parseFen(g.fen) : null;
        const pos = setup?.isOk ? Chess.fromSetup(setup.value) : null;
        const p = pos?.isOk ? pos.value : Chess.default();
        let ply = 0;
        for (const san of sanTokens(g.movetext)) {
            if (ply >= BOSS_BOOK_PLIES) break;
            const move = parseSan(p, san);
            if (!move) break;
            if (p.turn === g.color) {
                const epd = epdOf(makeFen(p.toSetup()));
                if (!rep.has(epd)) count(played, epd, makeUci(move));
            }
            p.play(move);
            ply++;
        }
    }
    const out: BookMove[] = [];
    for (const [epd, moves] of rep)
        for (const [uci] of moves) out.push({ epd, uci, weight: REPERTOIRE_WEIGHT });
    for (const [epd, moves] of played)
        for (const [uci, n] of moves) out.push({ epd, uci, weight: Math.min(500, n) });
    // Bei zu vielen Einträgen fallen die seltensten Partiezüge weg
    out.sort((a, b) => b.weight - a.weight);
    return out.slice(0, BOSS_BOOK_MAX);
}

// Kompakt für Firestore: "epd|uci|weight"
export function packBossBook(book: BookMove[]): string[] {
    return book.map((m) => `${m.epd}|${m.uci}|${m.weight}`);
}

export function unpackBossBook(data: unknown): BookMove[] {
    const moves = (data as { moves?: unknown } | null)?.moves;
    if (!Array.isArray(moves)) return [];
    const out: BookMove[] = [];
    for (const s of moves) {
        if (typeof s !== "string") continue;
        const [epd, uci, w] = s.split("|");
        const weight = Number(w);
        if (epd && uci && Number.isFinite(weight) && weight > 0)
            out.push({ epd, uci, weight: Math.min(1000, Math.round(weight)) });
    }
    return out;
}
