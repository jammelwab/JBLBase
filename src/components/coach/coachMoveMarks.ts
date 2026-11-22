import { atom } from "jotai";

// Einordnung der eigenen Züge in der Partie gegen JBL, die kein Zeichen haben
// (Theorie, solider Zug), nach der Stellung nach dem Zug. Färbt die Zugliste.
export type CoachMoveMark = "book" | "solid";

export const coachMoveMarksAtom = atom<Record<string, CoachMoveMark>>({});
