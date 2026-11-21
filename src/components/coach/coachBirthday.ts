import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { coachProfileAtom } from "./coachProfile";
import { today } from "./coachState";

// Geburtstag: der Admin trägt ihn im Coach-Profil ein ("MM-TT"). Gefeiert
// wird einmal im Jahr nach der Uhr des Rechners; wer an dem Tag nicht da
// war, bekommt bis zu 3 Tage später ein „Nachträglich alles Gute!“.

export const BIRTHDAY_XP = 250;
export const LATE_DAYS = 3;

// Jahr der letzten Feier
export const coachBirthdayCelebratedAtom = atomWithStorage<number>("jbl-coach-birthday", 0);

function dayNumber(day: string): number {
    const [y, m, d] = day.split("-").map(Number);
    return Date.UTC(y, m - 1, d) / 86400000;
}

// "today", "late" (1 bis 3 Tage danach) oder null
export function birthdayState(birthday: string | undefined, day: string): "today" | "late" | null {
    if (!birthday || !/^\d{2}-\d{2}$/.test(birthday)) return null;
    const year = Number(day.slice(0, 4));
    for (const y of [year, year - 1]) {
        const diff = dayNumber(day) - dayNumber(`${y}-${birthday}`);
        if (diff === 0) return "today";
        if (diff > 0 && diff <= LATE_DAYS) return "late";
    }
    return null;
}

// Das Jahr, zu dem der Geburtstag gehört (für „schon gefeiert“)
export function birthdayYear(birthday: string, day: string): number {
    const year = Number(day.slice(0, 4));
    return dayNumber(day) >= dayNumber(`${year}-${birthday}`) ? year : year - 1;
}

// Ist heute der Geburtstag? (Partyhut, doppelte XP, keine Sperre)
export const isBirthdayAtom = atom(
    (get) => birthdayState(get(coachProfileAtom).birthday, today()) === "today",
);

// Steht eine Feier an, die noch nicht stattgefunden hat?
export const pendingBirthdayAtom = atom((get) => {
    const { birthday } = get(coachProfileAtom);
    const day = today();
    const state = birthdayState(birthday, day);
    if (!state || !birthday) return null;
    if (get(coachBirthdayCelebratedAtom) === birthdayYear(birthday, day)) return null;
    return state;
});
