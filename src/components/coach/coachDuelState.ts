import { makeUci, parseUci } from "chessops";
import { Chess } from "chessops/chess";
import { makeFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { coachProfileAtom } from "./coachProfile";
import { coachDuelChampionAtom, coachExtraFramesAtom } from "./coachRewards";

// Duell Aaron gegen Ben: Nur wer im Coach-Profil einen Rivalen hat, sieht
// dessen Level und kann ihn zu einer Partie herausfordern. Die Züge laufen
// über Firebase (duels/{id}), live oder wie Fernschach.

export type RivalState = { uid: string; name: string; level: number; xp: number };

export const coachRivalAtom = atomWithStorage<RivalState | null>("jbl-coach-rival", null);
// Wer zuletzt vorn lag, um „hat dich überholt“ nur einmal zu sagen
export const coachRivalAheadAtom = atomWithStorage<"me" | "rival" | null>(
    "jbl-coach-rival-ahead",
    null,
);
// Was zuletzt für den Rivalen veröffentlicht wurde ("level|xp|name")
export const coachRivalMarkAtom = atomWithStorage<string>("jbl-coach-rival-mark", "");
// Duelle, deren Ergebnis schon verbucht ist
export const coachDuelsSeenAtom = atomWithStorage<string[]>("jbl-coach-duels-seen", []);

export const hasRivalAtom = atom((get) => !!get(coachProfileAtom).rival);

export function parseRival(uid: string, data: unknown): RivalState | null {
    if (!data || typeof data !== "object") return null;
    const d = data as Record<string, unknown>;
    if (typeof d.level !== "number" || typeof d.xp !== "number") return null;
    return {
        uid,
        name: typeof d.name === "string" && d.name ? d.name.slice(0, 40) : "?",
        level: d.level,
        xp: d.xp,
    };
}

// Wer liegt vorn? Bei gleichem Level entscheiden die XP.
export function leader(me: { level: number; xp: number }, rival: RivalState): "me" | "rival" {
    if (me.level !== rival.level) return me.level > rival.level ? "me" : "rival";
    return me.xp >= rival.xp ? "me" : "rival";
}

// Hat jemand überholt, seit es zuletzt gesagt wurde?
export function overtake(
    before: "me" | "rival" | null,
    now: "me" | "rival",
): "overtaken" | "overtook" | null {
    if (!before || before === now) return null;
    return now === "rival" ? "overtaken" : "overtook";
}

// ---------- Duell-Partien ----------

export type DuelResult = "*" | "1-0" | "0-1" | "1/2-1/2";
export type DuelReason = "mate" | "resign" | "stalemate" | "draw";

export type Duel = {
    id: string;
    players: [string, string];
    white: string;
    black: string;
    names: Record<string, string>;
    // Züge als UCI
    moves: string[];
    result: DuelResult;
    reason: DuelReason | null;
    updatedAt: number;
};

export function parseDuel(id: string, data: unknown): Duel | null {
    if (!data || typeof data !== "object") return null;
    const d = data as Record<string, unknown>;
    const players = d.players;
    if (!Array.isArray(players) || players.length !== 2) return null;
    if (typeof d.white !== "string" || typeof d.black !== "string") return null;
    const names: Record<string, string> = {};
    if (d.names && typeof d.names === "object")
        for (const [k, v] of Object.entries(d.names as Record<string, unknown>))
            if (typeof v === "string") names[k] = v;
    const result = ["1-0", "0-1", "1/2-1/2"].includes(d.result as string)
        ? (d.result as DuelResult)
        : "*";
    const at = d.updatedAt as { toMillis?: () => number } | undefined;
    return {
        id,
        players: [String(players[0]), String(players[1])],
        white: d.white,
        black: d.black,
        names,
        moves: Array.isArray(d.moves)
            ? d.moves.filter((m): m is string => typeof m === "string")
            : [],
        result,
        reason: typeof d.reason === "string" ? (d.reason as DuelReason) : null,
        updatedAt: typeof at?.toMillis === "function" ? at.toMillis() : 0,
    };
}

// Stellung nach den Zügen; ungültige Züge brechen ab
export function duelPosition(moves: readonly string[]): { pos: Chess; sans: string[] } {
    const pos = Chess.default();
    const sans: string[] = [];
    for (const uci of moves) {
        const move = parseUci(uci);
        if (!move || !pos.isLegal(move)) break;
        sans.push(makeSan(pos, move));
        pos.play(move);
    }
    return { pos, sans };
}

export function duelFen(moves: readonly string[]): string {
    return makeFen(duelPosition(moves).pos.toSetup());
}

export function duelTurn(duel: Duel): string {
    return duel.moves.length % 2 === 0 ? duel.white : duel.black;
}

// Ergebnis nach einem Zug: Matt, Patt oder zu wenig Material
export function duelOutcome(moves: readonly string[]): {
    result: DuelResult;
    reason: DuelReason | null;
} {
    const { pos } = duelPosition(moves);
    if (pos.isCheckmate()) return { result: pos.turn === "white" ? "0-1" : "1-0", reason: "mate" };
    if (pos.isStalemate()) return { result: "1/2-1/2", reason: "stalemate" };
    if (pos.isInsufficientMaterial()) return { result: "1/2-1/2", reason: "draw" };
    return { result: "*", reason: null };
}

export function duelWinner(duel: Duel): string | null {
    if (duel.result === "1-0") return duel.white;
    if (duel.result === "0-1") return duel.black;
    return null;
}

export function playDuelMove(moves: readonly string[], uci: string): string[] | null {
    const { pos } = duelPosition(moves);
    const move = parseUci(uci);
    if (!move || !pos.isLegal(move)) return null;
    return [...moves, makeUci(move)];
}

// Ein fertiges Duell verbuchen: Der Sieger wird Duell-Champion und bekommt
// den Duell-Rahmen, der Verlierer gibt den Titel ab. Remis ändert nichts.
export const settleDuelAtom = atom(
    null,
    (get, set, duel: Duel, me: string): "won" | "lost" | "draw" | null => {
        if (duel.result === "*" || !duel.players.includes(me)) return null;
        const seen = get(coachDuelsSeenAtom);
        if (seen.includes(duel.id)) return null;
        set(coachDuelsSeenAtom, [...seen, duel.id].slice(-200));
        const winner = duelWinner(duel);
        if (!winner) return "draw";
        if (winner === me) {
            set(coachDuelChampionAtom, true);
            const frames = get(coachExtraFramesAtom);
            if (!frames.includes("duel")) set(coachExtraFramesAtom, [...frames, "duel"]);
            return "won";
        }
        set(coachDuelChampionAtom, false);
        return "lost";
    },
);
