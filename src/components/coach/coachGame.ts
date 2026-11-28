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

// Wie oft JBL auf den leichten Stufen wie ein Anfänger zieht (zufälliger
// Zug statt Suche, 1.2.14): Skill Level 0 allein spielt viel zu gut.
export function jblRandomMoveChance(strength: CoachStrengthId): number {
    const elo = COACH_STRENGTHS.find((s) => s.id === strength)?.elo ?? 1200;
    if (elo <= 600) return 0.4;
    if (elo <= 900) return 0.2;
    if (elo <= 1200) return 0.07;
    return 0;
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
    | "missedMate"
    // Theorie: der Zug steht im Eröffnungsbuch
    | "book"
    // Ein ordentlicher Zug ohne Besonderheit
    | "solid";

// Jeder eigene Zug bekommt eine Einordnung. Theorie geht vor kleinen
// Ungenauigkeiten (?!), aber nicht vor echten Fehlern und nicht vor !!.
export function reactionFor(
    annotation: string,
    allowsMateInOne: boolean,
    inBook = false,
): CoachReaction {
    if (allowsMateInOne) return "missedMate";
    if (inBook && annotation !== "!!" && annotation !== "?" && annotation !== "??") return "book";
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
            return "solid";
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
    book: "think",
    solid: "good",
};

export const REACTION_SIGN: Record<CoachReaction, string> = {
    brilliant: "!!",
    good: "!",
    interesting: "!?",
    dubious: "?!",
    mistake: "?",
    blunder: "??",
    missedMate: "??",
    book: "",
    solid: "",
};

// So viele Fassungen hat jeder Spruch in den Übersetzungen (Coach.Line.<key>.<n>).
export const LINE_VARIANTS: Record<string, number> = {
    brilliant: 3,
    good: 6,
    interesting: 3,
    dubious: 4,
    mistake: 4,
    blunder: 4,
    missedMate: 1,
    book: 5,
    solid: 10,
    start: 2,
    win: 2,
    loss: 2,
    draw: 1,
    levelUp: 1,
    bonusTrack: 2,
    tired: 2,
    offBook: 2,
    repEnd: 1,
    sparring: 1,
    variety: 2,
    noRepertoire: 1,
    attack: 2,
    patriciaWin: 1,
    patriciaLoss: 1,
    bassBeatsBunny: 1,
    knightPromo: 1,
    kingMate: 1,
    enPassant: 2,
    aaronMate: 2,
    oberBoss: 1,
    lambrusco: 1,
    aprilFools: 1,
    bossStart: 2,
    bossWin: 2,
    bossOther: 1,
    bossNext: 1,
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

// Zeichen in der Zugliste für jeden Zug der Partie gegen JBL (1.2.14), auch
// für JBLs Züge: Theorie bekommt keins (nur Farbe), sonst das Zeichen der
// Engine-Prüfung, N für den ersten Zug aus dem Buch, □ für den einzigen
// guten Zug.
export function notationSign(o: {
    annotation: string;
    allowsMateInOne: boolean;
    inBook: boolean;
    prevInBook: boolean;
    onlyMove: boolean;
}): string {
    if (o.allowsMateInOne) return "??";
    if (o.inBook && o.annotation !== "!!" && o.annotation !== "?" && o.annotation !== "??")
        return "";
    if (o.annotation) return o.annotation;
    if (o.prevInBook && !o.inBook) return "N";
    if (o.onlyMove) return "□";
    return "";
}

// Lässt der Zug ein Matt in 1 zu, das vorher nicht schon unvermeidlich war?
// (1.2.34) Stand der Spieler schon im erzwungenen Matt, ist jeder Zug
// „Matt in 1 zugelassen“; dafür gibt es kein ?? und keine Strafe.
// before: beste Bewertung vor dem Zug, after: nach dem Zug, beide aus Sicht
// von Weiß; sign: +1 für Weiß, -1 für Schwarz.
export function allowsNewMateInOne(
    before: { type: string; value: number } | null | undefined,
    after: { type: string; value: number },
    mover: "white" | "black",
): boolean {
    const sign = mover === "white" ? 1 : -1;
    const lostAfter =
        after.type === "mate" && Math.abs(after.value) === 1 && after.value * sign < 0;
    if (!lostAfter) return false;
    const lostBefore = before?.type === "mate" && before.value * sign < 0;
    return !lostBefore;
}

// So viel schlechter muss der zweitbeste Zug sein, damit der beste „einzig“ ist
export const ONLY_MOVE_MARGIN_CP = 150;

// Einziger Zug: gespielt wurde der beste, und der zweitbeste verliert deutlich
export function isOnlyMove(played: string, best: { san: string | null; score: number }[]): boolean {
    if (best.length < 2 || !best[0].san || best[0].san !== played) return false;
    return best[0].score - best[1].score >= ONLY_MOVE_MARGIN_CP;
}

// Bewertung nach dem gespielten Zug (1.2.19): Steht der Zug unter den besten
// Zügen der Stellung davor, zählt dessen Bewertung aus derselben Suche. Sonst
// bekommt ein bester Zug durch das Rauschen zweier Suchen schnell ein ?!.
export function playedScore<S>(
    played: string,
    best: { sanMoves: string[]; score: { value: S } }[],
    after: S,
): S {
    return best.find((b) => b.sanMoves[0] === played)?.score.value ?? after;
}

// Optionen der Engine für die Prüfung: ohne Stärke-Begrenzung, damit JBL mit
// voller Stärke bewertet
const STRENGTH_OPTIONS = new Set(["UCI_LimitStrength", "UCI_Elo", "Skill Level", "MultiPV"]);
export function checkEngineOptions<O extends { name: string }>(options: O[]): O[] {
    return options.filter((o) => !STRENGTH_OPTIONS.has(o.name));
}

// Was JBL in dieser Sitzung zuletzt gesagt hat (1.2.19): Claude bekommt es
// mit, damit er sich nicht wiederholt, und ein Satz, der gerade schon kam,
// wird durch einen festen Spruch ersetzt.
const RECENT_SAYS = 12;
let recentSays: string[] = [];

export function rememberSaid(text: string) {
    const t = text.trim();
    if (t) recentSays = [t, ...recentSays.filter((s) => s !== t)].slice(0, RECENT_SAYS);
}

export function recentlySaid(n = RECENT_SAYS): string[] {
    return recentSays.slice(0, n);
}

export function saidRecently(text: string): boolean {
    const norm = (s: string) =>
        s
            .toLowerCase()
            .replace(/[^\p{L}\d]+/gu, " ")
            .trim();
    const t = norm(text);
    return recentSays.some((s) => norm(s) === t);
}
