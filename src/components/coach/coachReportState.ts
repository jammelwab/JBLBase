import { atom } from "jotai";

// Nach der Partie gegen JBL (1.2.14): „Analyse“ öffnet erst den Partiebericht,
// und aus dem Bericht geht es weiter zur Analyse. Zähler, damit jeder Klick
// zählt.
export const coachReportOpenAtom = atom(0);
export const coachAnalyzeAtom = atom(0);
