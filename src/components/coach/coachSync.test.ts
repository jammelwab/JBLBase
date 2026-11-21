import { createStore } from "jotai";
import { describe, expect, it } from "vitest";
import de from "@/translation/de-DE.json";
import en from "@/translation/en-US.json";
import { birthdayState, birthdayYear } from "./coachBirthday";
import { coachLockAtom, coachStreakAtom } from "./coachProgress";
import { parseCoachProfile } from "./coachProfile";
import { coachTrophiesAtom } from "./coachRewards";
import { coachXpAtom, coachXpOthersAtom, coachXpOwnAtom } from "./coachState";
import {
    applyLocal,
    bundleHash,
    type CoachLocalState,
    mergeCoach,
    mergeStreak,
    parseCloudState,
    readLocal,
} from "./coachSync";

const local = (over: Partial<CoachLocalState> = {}): CoachLocalState => ({
    xpOwn: 100,
    sets: { trophies: ["firstWin"], items: [], frames: [], titles: [], lessons: [] },
    streak: { last: "2026-11-20", days: 3, bridgedWeek: null },
    best: 1200,
    bundle: { lock: 0, outfit: [] } as never,
    ...over,
});

describe("Coach-Sync", () => {
    it("zählt XP pro Rechner und vereinigt Gesammeltes", () => {
        const remote = parseCloudState({
            xpByDevice: { a: 100, b: 250 },
            sets: { trophies: ["streak7"], items: ["partyHat"] },
            streak: { last: "2026-11-21", days: 4, bridgedWeek: null },
            best: 1300,
            bundle: { lock: 3, outfit: ["scarf"] },
            bundleAt: 50,
        });
        const r = mergeCoach(
            local(),
            remote,
            { hash: bundleHash(local().bundle), at: 10 },
            "a",
            999,
        );
        expect(r.xpOthers).toBe(250);
        expect(r.cloud.xpByDevice).toEqual({ a: 100, b: 250 });
        expect(r.local.sets.trophies).toEqual(["firstWin", "streak7"]);
        expect(r.local.sets.items).toEqual(["partyHat"]);
        expect(r.local.streak.days).toBe(4);
        expect(r.local.best).toBe(1300);
        // lokal unverändert seit dem letzten Abgleich, die Cloud ist neuer
        expect(r.local.bundle).toEqual({ lock: 3, outfit: ["scarf"] });
        expect(r.write).toBe(true);
    });

    it("behält lokale Änderungen, wenn sie neuer sind", () => {
        const remote = parseCloudState({ bundle: { lock: 3 }, bundleAt: 50 });
        const r = mergeCoach(local(), remote, { hash: "alt", at: 10 }, "a", 999);
        expect(r.local.bundle).toEqual({ lock: 0, outfit: [] });
        expect(r.cloud.bundleAt).toBe(999);
    });

    it("schreibt nicht, wenn sich nichts geändert hat", () => {
        const first = mergeCoach(local(), null, null, "a", 5);
        const again = mergeCoach(local(), first.cloud, first.mark, "a", 9);
        expect(again.write).toBe(false);
    });

    it("nimmt die Serie mit dem späteren Tag", () => {
        const a = { last: "2026-11-20", days: 9, bridgedWeek: null };
        const b = { last: "2026-11-21", days: 2, bridgedWeek: null };
        expect(mergeStreak(a, b)).toBe(b);
        expect(mergeStreak(a, { ...a, days: 10 }).days).toBe(10);
    });

    it("liest und schreibt den Stand im Store", () => {
        const store = createStore();
        store.set(coachXpOwnAtom, 40);
        store.set(coachLockAtom, 0);
        const remote = parseCloudState({
            xpByDevice: { other: 60 },
            sets: { trophies: ["firstWin"] },
            bundle: { lock: 2 },
            bundleAt: Date.now() + 1000,
        });
        const r = mergeCoach(readLocal(store), remote, null, "me", 0);
        applyLocal(store, r);
        expect(store.get(coachXpOthersAtom)).toBe(60);
        expect(store.get(coachXpAtom)).toBe(100);
        expect(store.get(coachTrophiesAtom)).toEqual(["firstWin"]);
        expect(store.get(coachLockAtom)).toBe(2);
        expect(store.get(coachStreakAtom).days).toBe(0);
        // Neue XP landen im eigenen Anteil
        store.set(coachXpAtom, 130);
        expect(store.get(coachXpOwnAtom)).toBe(70);
    });
});

describe("Coach-Profil und Geburtstag", () => {
    it("liest nur gültige Felder", () => {
        expect(
            parseCoachProfile({ birthday: "11-21", eggs: ["Aaron", 3], name: " Aaron " }),
        ).toEqual({
            birthday: "11-21",
            eggs: ["aaron"],
            name: "Aaron",
            rival: undefined,
        });
        expect(parseCoachProfile({ birthday: "21.11." }).birthday).toBeUndefined();
    });

    it("feiert am Tag und bis zu 3 Tage nachträglich, auch über den Jahreswechsel", () => {
        expect(birthdayState("11-21", "2026-11-21")).toBe("today");
        expect(birthdayState("11-21", "2026-11-24")).toBe("late");
        expect(birthdayState("11-21", "2026-11-25")).toBeNull();
        expect(birthdayState("11-21", "2026-11-20")).toBeNull();
        expect(birthdayState("12-31", "2027-01-02")).toBe("late");
        expect(birthdayYear("12-31", "2027-01-02")).toBe(2026);
        expect(birthdayState(undefined, "2026-11-21")).toBeNull();
    });

    it("hat die Texte auf Deutsch und Englisch", () => {
        for (const t of [de.translation, en.translation] as Record<string, string>[])
            for (const k of ["Title", "Late", "Hint", "Blow", "Gift", "Thanks"])
                expect(t[`Coach.Birthday.${k}`]).toBeTruthy();
    });
});
