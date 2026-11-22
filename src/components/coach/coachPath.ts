import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { coachLockAtom } from "./coachProgress";
import { coachQuestAtom, currentQuest } from "./coachRewards";
import { coachDayAtom, coachXpAtom, today } from "./coachState";

// Der weitere Pfad (1.2.15): ist der Tagesplan geschafft, geht es Schritt für
// Schritt weiter. Die Schritte laufen im Kreis, die Taktik-Themen wechseln,
// und angezeigt werden immer die nächsten zwei.

export type PathEvent = "puzzle" | "game" | "line";
export type PathStepId = "puzzles" | "play" | "tactic" | "addLine";

export type PathStep = {
    id: PathStepId;
    // Wie oft das Ereignis eintreten muss
    target: number;
    // Puzzle-Thema für Taktik-Schritte (Lichess-Themen)
    theme: string | null;
};

const CYCLE: { id: PathStepId; target: number }[] = [
    { id: "puzzles", target: 5 },
    { id: "play", target: 1 },
    { id: "tactic", target: 3 },
    { id: "addLine", target: 1 },
    { id: "tactic", target: 3 },
    { id: "play", target: 1 },
];

// Taktik-Themen der Reihe nach, passend zu den Lektionen
export const PATH_THEMES = [
    "fork",
    "pin",
    "skewer",
    "discoveredAttack",
    "deflection",
    "attraction",
    "doubleCheck",
    "mateIn2",
    "backRankMate",
    "trappedPiece",
] as const;

export const PATH_STEP_XP = 15;

export function pathStep(index: number): PathStep {
    const base = CYCLE[index % CYCLE.length];
    // Jeder Taktik-Schritt bekommt das nächste Thema
    const tactics = CYCLE.filter((s) => s.id === "tactic").length;
    const round = Math.floor(index / CYCLE.length);
    const nth = CYCLE.slice(0, index % CYCLE.length).filter((s) => s.id === "tactic").length;
    const theme =
        base.id === "tactic" ? PATH_THEMES[(round * tactics + nth) % PATH_THEMES.length] : null;
    return { ...base, theme };
}

const EVENT_OF: Record<PathStepId, PathEvent> = {
    puzzles: "puzzle",
    tactic: "puzzle",
    play: "game",
    addLine: "line",
};

export type PathState = { index: number; progress: number };

export const coachPathAtom = atomWithStorage<PathState>("jbl-coach-path", {
    index: 0,
    progress: 0,
});

// Läuft der weitere Pfad? Erst wenn Partie, Puzzles und Tagesaufgabe des
// Tages geschafft sind und keine Sperre gilt.
export const coachPathActiveAtom = atom((get) => {
    const day = get(coachDayAtom);
    const now = today();
    return (
        get(coachLockAtom) === 0 &&
        day.day === now &&
        day.played &&
        day.puzzles &&
        currentQuest(get(coachQuestAtom), now).done
    );
});

// Ein Ereignis zählt für den aktuellen Schritt; gibt die XP zurück, wenn der
// Schritt damit fertig ist.
export function advancePath(
    state: PathState,
    event: PathEvent,
): { state: PathState; done: boolean } {
    const step = pathStep(state.index);
    if (EVENT_OF[step.id] !== event) return { state, done: false };
    const progress = state.progress + 1;
    if (progress < step.target) return { state: { ...state, progress }, done: false };
    return { state: { index: state.index + 1, progress: 0 }, done: true };
}

export const coachPathEventAtom = atom(null, (get, set, event: PathEvent): number => {
    if (!get(coachPathActiveAtom)) return 0;
    const { state, done } = advancePath(get(coachPathAtom), event);
    set(coachPathAtom, state);
    if (!done) return 0;
    set(coachXpAtom, get(coachXpAtom) + PATH_STEP_XP);
    return PATH_STEP_XP;
});

// Schritt überspringen (ohne XP), z. B. wenn es kein Repertoire gibt
export const skipPathStepAtom = atom(null, (get, set) => {
    const { index } = get(coachPathAtom);
    set(coachPathAtom, { index: index + 1, progress: 0 });
});
