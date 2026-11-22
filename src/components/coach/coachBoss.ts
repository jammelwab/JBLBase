import { makeUci, parseUci } from "chessops";
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { makeSan, parseSan } from "chessops/san";
import { atomWithStorage } from "jotai/utils";
import type { BookMove, GoMode } from "@/bindings";
import { sameName } from "@/utils/accountDatabase";
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
// Repertoire-Züge haben Vorrang vor allem, was der Boss sonst gespielt hat.
// Die Hauptvariante (erster Zug im Baum) spielt er meistens, Nebenvarianten
// seltener (1.2.19).
export const REPERTOIRE_WEIGHT = 1000;
export const SIDELINE_WEIGHT = 200;

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

function keepMax(map: Counts, epd: string, uci: string, w: number) {
    const m = map.get(epd) ?? new Map<string, number>();
    m.set(uci, Math.max(m.get(uci) ?? 0, w));
    map.set(epd, m);
}

export type BossGame = { movetext: string; color: "white" | "black"; fen?: string };
// Eine PGN aus dem Chess.com-Archiv als Boss-Partie, wenn der Boss mitspielt
export function bossGameFromPgn(pgn: string, player: string): BossGame | null {
    const header = (name: string) =>
        pgn.match(new RegExp(`\\[${name}\\s+"([^"]*)"\\]`))?.[1] ?? null;
    const white = header("White");
    const black = header("Black");
    const color =
        white && sameName(white, player)
            ? "white"
            : black && sameName(black, player)
              ? "black"
              : null;
    if (!color) return null;
    const movetext = pgn.replace(/^\s*\[[^\]]*\]\s*$/gm, "").trim();
    const fen = header("FEN");
    return { movetext, color, ...(fen ? { fen } : {}) };
}

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
            node.children.forEach((child, i) => {
                stack.push(child);
                if (turn === color && child.move)
                    keepMax(
                        rep,
                        epd,
                        makeUci(child.move),
                        i === 0 ? REPERTOIRE_WEIGHT : SIDELINE_WEIGHT,
                    );
            });
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
        for (const [uci, weight] of moves) out.push({ epd, uci, weight });
    for (const [epd, moves] of played)
        for (const [uci, n] of moves) out.push({ epd, uci, weight: Math.min(500, n) });
    // Bei zu vielen Einträgen fallen die seltensten Partiezüge weg
    out.sort((a, b) => b.weight - a.weight);
    return out.slice(0, BOSS_BOOK_MAX);
}

export type BossBookSummary = {
    // Was der Boss als Weiß im ersten Zug spielt
    white: { san: string; share: number }[];
    // Was er als Schwarz auf die häufigsten ersten Züge antwortet
    black: { against: string; replies: { san: string; share: number }[] }[];
};

const SUMMARY_OPENINGS = ["e4", "d4", "c4", "Nf3"];

function bookReplies(book: BookMove[], pos: Chess): { san: string; share: number }[] {
    const epd = epdOf(makeFen(pos.toSetup()));
    const moves = book.filter((m) => m.epd === epd);
    const total = moves.reduce((sum, m) => sum + m.weight, 0);
    const out: { san: string; share: number }[] = [];
    for (const m of [...moves].sort((a, b) => b.weight - a.weight)) {
        const move = parseUci(m.uci);
        if (!move || !pos.isLegal(move)) continue;
        out.push({ san: makeSan(pos, move), share: Math.round((m.weight / total) * 100) });
    }
    return out.slice(0, 3);
}

// Zum Nachprüfen in der Admin-Übersicht: die ersten Züge des Bosses
export function bossBookSummary(book: BookMove[]): BossBookSummary {
    const start = Chess.default();
    const black = SUMMARY_OPENINGS.map((against) => {
        const pos = start.clone();
        const move = parseSan(pos, against);
        if (move) pos.play(move);
        return { against, replies: move ? bookReplies(book, pos) : [] };
    });
    return { white: bookReplies(book, start), black };
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
