import { atomWithStorage } from "jotai/utils";

// ---------- Coach-Profil (nur vom Admin eingetragen) ----------

export type CoachProfile = {
    // "MM-TT", ohne Jahr
    birthday?: string;
    // Persönliche Easter Eggs, z. B. "aaron", "ben"
    eggs: string[];
    // Wie JBL den Spieler anspricht
    name?: string;
    // Konto des Rivalen im Duell
    rival?: string;
};

export const coachProfileAtom = atomWithStorage<CoachProfile>("jbl-coach-profile", { eggs: [] });

export function parseCoachProfile(data: unknown): CoachProfile {
    if (!data || typeof data !== "object") return { eggs: [] };
    const d = data as Record<string, unknown>;
    return {
        birthday:
            typeof d.birthday === "string" && /^\d{2}-\d{2}$/.test(d.birthday)
                ? d.birthday
                : undefined,
        eggs: Array.isArray(d.eggs)
            ? d.eggs.filter((x): x is string => typeof x === "string").map((x) => x.toLowerCase())
            : [],
        name: typeof d.name === "string" && d.name.trim() ? d.name.trim() : undefined,
        rival: typeof d.rival === "string" && d.rival ? d.rival : undefined,
    };
}
