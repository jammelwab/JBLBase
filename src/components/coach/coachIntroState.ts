import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import type { CoachEntry } from "./coachLessonsData";

// Einführung beim ersten Start (1.2.8): fünf kurze Schritte. „Gesehen“ und
// die Antwort auf „Wie stark bist du?“ wandern mit dem Coach-Stand ans Konto.
export type CoachIntroState = {
    done: boolean;
    entry: CoachEntry | null;
    // „Später“ gedrückt; die Coach-Karte erinnert dann einmal daran
    later: boolean;
    reminded: boolean;
};

export const coachIntroAtom = atomWithStorage<CoachIntroState>("jbl-coach-intro", {
    done: false,
    entry: null,
    later: false,
    reminded: false,
});

// Aus dem Fragezeichen-Menü oder von der Coach-Karte geöffnet
export const coachIntroOpenAtom = atom(false);

export const INTRO_STEPS = 5;
// Ab diesem Schritt (von 0 gezählt) ist „Später“ sichtbar
export const INTRO_LATER_FROM = 1;

// Kommt die Einführung von selbst? Erst nach dem ersten Abgleich, damit sie
// auf dem zweiten Rechner nicht noch einmal erscheint.
export function introDue(state: CoachIntroState, signedIn: boolean, synced: boolean): boolean {
    return signedIn && synced && !state.done && !state.later;
}

// Erinnert die Karte an die verschobene Einführung?
export function introReminder(state: CoachIntroState): boolean {
    return !state.done && state.later && !state.reminded;
}
