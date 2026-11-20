import type { GoMode } from "@/bindings";
import type { EngineSettings, LocalEngine } from "@/utils/engines";
import type { CoachAnimation } from "./CoachFigure";
import { COACH_STRENGTHS, type CoachStrengthId } from "./coachState";

// Unter 1320 Elo kann Stockfish nicht per UCI_Elo begrenzen. Dort spielt JBL mit
// Skill Level 0 und wenig Suchtiefe. Die Werte sind eine erste Schätzung und
// werden noch an echten Partien geeicht.
export function jblEngineSetup(strength: CoachStrengthId): {
    go: GoMode;
    options: { name: string; value: string }[];
} {
    const elo = COACH_STRENGTHS.find((s) => s.id === strength)?.elo ?? 1200;
    if (elo < 1320) {
        const depth = elo < 700 ? 1 : elo < 1000 ? 3 : 5;
        return {
            go: { t: "Depth", c: depth },
            options: [{ name: "Skill Level", value: "0" }],
        };
    }
    return {
        go: { t: "Time", c: elo >= 2300 ? 1500 : 1000 },
        options: [
            { name: "UCI_LimitStrength", value: "true" },
            { name: "UCI_Elo", value: String(Math.min(3190, elo === 2800 ? 2850 : elo)) },
        ],
    };
}

// Stockfish aus den eingerichteten Engines, sonst nichts.
export function findStockfish(engines: unknown[] | null | undefined): LocalEngine | null {
    const local = (engines ?? []).filter(
        (e): e is LocalEngine => (e as LocalEngine)?.type === "local",
    );
    return local.find((e) => /stockfish/i.test(e.name)) ?? null;
}

// Die Engine-Einstellungen für JBL: die eigenen Einstellungen der Engine, ohne
// die Stärke-Optionen, plus die von JBL.
export function jblEngineSettings(engine: LocalEngine, strength: CoachStrengthId): EngineSettings {
    const { options } = jblEngineSetup(strength);
    const names = new Set([...options.map((o) => o.name), "MultiPV"]);
    return [...(engine.settings ?? []).filter((s) => !names.has(s.name)), ...options];
}

export type CoachReaction =
    | "brilliant"
    | "good"
    | "interesting"
    | "dubious"
    | "mistake"
    | "blunder"
    | "missedMate";

export function reactionFor(annotation: string, allowsMateInOne: boolean): CoachReaction | null {
    if (allowsMateInOne) return "missedMate";
    switch (annotation) {
        case "!!":
            return "brilliant";
        case "!":
            return "good";
        case "!?":
            return "interesting";
        case "?!":
            return "dubious";
        case "?":
            return "mistake";
        case "??":
            return "blunder";
        default:
            return null;
    }
}

export const REACTION_ANIMATION: Record<CoachReaction, CoachAnimation> = {
    brilliant: "bril",
    good: "good",
    interesting: "int",
    dubious: "dub",
    mistake: "mis",
    blunder: "blu",
    missedMate: "blu",
};

export const REACTION_SIGN: Record<CoachReaction, string> = {
    brilliant: "!!",
    good: "!",
    interesting: "!?",
    dubious: "?!",
    mistake: "?",
    blunder: "??",
    missedMate: "??",
};

// So viele Fassungen hat jeder Spruch in den Übersetzungen (Coach.Line.<key>.<n>).
export const LINE_VARIANTS: Record<string, number> = {
    brilliant: 3,
    good: 3,
    interesting: 2,
    dubious: 2,
    mistake: 2,
    blunder: 2,
    missedMate: 1,
    start: 2,
    win: 2,
    loss: 2,
    draw: 1,
    levelUp: 1,
    bonusTrack: 2,
    tired: 2,
};

// Wählt eine Fassung und meidet die zuletzt gezeigten.
export function pickLine(key: string, recent: string[], rand = Math.random): string {
    const n = LINE_VARIANTS[key] ?? 1;
    const all = Array.from({ length: n }, (_, i) => `${key}.${i + 1}`);
    const fresh = all.filter((k) => !recent.includes(k));
    const pool = fresh.length > 0 ? fresh : all;
    return pool[Math.floor(rand() * pool.length)];
}

// Lesezeit der Sprechblase: 1,5 s plus 60 ms pro Zeichen, höchstens 6 s.
export function readingTime(text: string): number {
    return Math.min(6000, 1500 + 60 * text.length);
}
