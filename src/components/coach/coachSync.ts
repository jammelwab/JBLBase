import type { createStore } from "jotai";
import { atomWithStorage } from "jotai/utils";
import {
    type CoachStreak,
    coachLockAtom,
    coachMateDrillAtom,
    coachMistakeAtom,
    coachStreakAtom,
} from "./coachProgress";
import {
    coachBestEstimateAtom,
    coachBonusTrackAtom,
    coachDuelChampionAtom,
    coachExtraFramesAtom,
    coachExtraItemsAtom,
    coachExtraTitlesAtom,
    coachFrameAtom,
    coachOutfitAtom,
    coachQuestAtom,
    coachResultsAtom,
    coachShownTitleAtom,
    coachTrophiesAtom,
} from "./coachRewards";
import { coachAttackAtom, coachLambruscoDayAtom, coachPatriciaWinsAtom } from "./coachEggs";
import { coachBossAtom } from "./coachBoss";
import { coachIntroAtom } from "./coachIntroState";
import { coachLessonAnnouncedAtom, coachLessonsDoneAtom } from "./coachLessonsData";
import { coachDayAtom, coachStrengthAtom, coachXpOthersAtom, coachXpOwnAtom } from "./coachState";

// Abgleich des Coach-Stands zwischen den Rechnern eines Kontos.
//
// - XP: jeder Rechner schreibt nur seinen eigenen Anteil (xpByDevice).
// - Gesammeltes (Trophäen, Verzierungen, Rahmen, Titel): Vereinigung.
// - Serie: die mit dem späteren letzten Tag, bei Gleichstand die längere.
// - Bestmarke der Stärke-Schätzung: das Maximum.
// - Alles andere (Stärke, Sperre, eigener Fehler, Outfit, Tagesstand, ...)
//   ist ein Bündel, bei dem die letzte Änderung gewinnt.

type Store = ReturnType<typeof createStore>;

const SET_ATOMS = {
    trophies: coachTrophiesAtom,
    items: coachExtraItemsAtom,
    frames: coachExtraFramesAtom,
    titles: coachExtraTitlesAtom,
    lessons: coachLessonsDoneAtom,
} as const;

const BUNDLE_ATOMS = {
    strength: coachStrengthAtom,
    lock: coachLockAtom,
    mistake: coachMistakeAtom,
    bonusTrack: coachBonusTrackAtom,
    outfit: coachOutfitAtom,
    frame: coachFrameAtom,
    title: coachShownTitleAtom,
    quest: coachQuestAtom,
    day: coachDayAtom,
    results: coachResultsAtom,
    attack: coachAttackAtom,
    patriciaWins: coachPatriciaWinsAtom,
    lambrusco: coachLambruscoDayAtom,
    mateDrill: coachMateDrillAtom,
    boss: coachBossAtom,
    duelChampion: coachDuelChampionAtom,
    intro: coachIntroAtom,
    lessonAnnounced: coachLessonAnnouncedAtom,
} as const;

export type CoachSets = Record<keyof typeof SET_ATOMS, string[]>;
export type CoachBundle = Record<keyof typeof BUNDLE_ATOMS, unknown>;

export type CoachCloudState = {
    xpByDevice: Record<string, number>;
    sets: CoachSets;
    streak: CoachStreak;
    best: number;
    bundle: CoachBundle;
    // Zeitpunkt der letzten Änderung am Bündel (ms, Uhr des Rechners)
    bundleAt: number;
};

export type CoachLocalState = {
    xpOwn: number;
    sets: CoachSets;
    streak: CoachStreak;
    best: number;
    bundle: CoachBundle;
};

// Was beim letzten Abgleich herauskam, um lokale Änderungen zu erkennen
export type CoachSyncMark = { hash: string; at: number };
export const coachSyncMarkAtom = atomWithStorage<CoachSyncMark | null>("jbl-coach-sync", null);

export function bundleHash(b: CoachBundle): string {
    return JSON.stringify(
        Object.keys(b)
            .sort()
            .map((k) => [k, b[k as keyof CoachBundle]]),
    );
}

function union(a: readonly string[] = [], b: readonly string[] = []): string[] {
    return [...new Set([...a, ...b])];
}

export function mergeStreak(a: CoachStreak, b: CoachStreak | undefined): CoachStreak {
    if (!b || !b.last) return a;
    if (!a.last) return b;
    if (a.last !== b.last) return a.last > b.last ? a : b;
    return b.days > a.days ? b : a;
}

function isStreak(x: unknown): x is CoachStreak {
    return (
        !!x &&
        typeof x === "object" &&
        typeof (x as CoachStreak).last === "string" &&
        typeof (x as CoachStreak).days === "number"
    );
}

// Liest den Cloud-Stand vorsichtig; Unbekanntes wird ignoriert.
export function parseCloudState(data: unknown): CoachCloudState | null {
    if (!data || typeof data !== "object") return null;
    const d = data as Record<string, unknown>;
    const xp: Record<string, number> = {};
    if (d.xpByDevice && typeof d.xpByDevice === "object") {
        for (const [k, v] of Object.entries(d.xpByDevice as Record<string, unknown>))
            if (typeof v === "number" && Number.isFinite(v) && v >= 0) xp[k] = v;
    }
    const rawSets = (d.sets && typeof d.sets === "object" ? d.sets : {}) as Record<string, unknown>;
    const sets = {} as CoachSets;
    for (const k of Object.keys(SET_ATOMS) as (keyof CoachSets)[]) {
        const v = rawSets[k];
        sets[k] = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    }
    const bundle = (d.bundle && typeof d.bundle === "object" ? d.bundle : {}) as CoachBundle;
    return {
        xpByDevice: xp,
        sets,
        streak: isStreak(d.streak) ? d.streak : { last: "", days: 0, bridgedWeek: null },
        best: typeof d.best === "number" ? d.best : 0,
        bundle,
        bundleAt: typeof d.bundleAt === "number" ? d.bundleAt : 0,
    };
}

export type CoachMergeResult = {
    // Neuer lokaler Stand
    local: CoachLocalState;
    xpOthers: number;
    // Neuer Cloud-Stand und ob er geschrieben werden muss
    cloud: CoachCloudState;
    write: boolean;
    mark: CoachSyncMark;
};

export function mergeCoach(
    local: CoachLocalState,
    remote: CoachCloudState | null,
    mark: CoachSyncMark | null,
    device: string,
    now: number,
): CoachMergeResult {
    const localHash = bundleHash(local.bundle);
    const localChanged = !mark || mark.hash !== localHash;
    const localAt = localChanged ? now : mark.at;

    const remoteNewer =
        !!remote && remote.bundleAt > localAt && Object.keys(remote.bundle).length > 0;
    // Felder, die im Cloud-Bündel fehlen (ältere Fassung), behält man lokal
    const bundle = remoteNewer ? { ...local.bundle, ...remote.bundle } : local.bundle;
    const bundleAt = remoteNewer ? remote.bundleAt : localAt;

    const sets = {} as CoachSets;
    for (const k of Object.keys(SET_ATOMS) as (keyof CoachSets)[])
        sets[k] = union(local.sets[k], remote?.sets[k]);

    const streak = mergeStreak(local.streak, remote?.streak);
    const best = Math.max(local.best, remote?.best ?? 0);
    const xpByDevice = { ...remote?.xpByDevice, [device]: local.xpOwn };
    const xpOthers = Object.entries(xpByDevice)
        .filter(([k]) => k !== device)
        .reduce((s, [, v]) => s + v, 0);

    const cloud: CoachCloudState = { xpByDevice, sets, streak, best, bundle, bundleAt };
    const write = !remote || JSON.stringify(canon(remote)) !== JSON.stringify(canon(cloud));
    return {
        local: { xpOwn: local.xpOwn, sets, streak, best, bundle },
        xpOthers,
        cloud,
        write,
        mark: { hash: bundleHash(bundle), at: bundleAt },
    };
}

// Feste Reihenfolge der Schlüssel, damit der Vergleich nicht an ihr hängt
function canon(c: CoachCloudState) {
    const sortObj = (o: Record<string, unknown>) =>
        Object.fromEntries(
            Object.keys(o)
                .sort()
                .map((k) => [k, o[k]]),
        );
    return {
        xpByDevice: sortObj(c.xpByDevice),
        sets: Object.fromEntries(
            Object.keys(c.sets)
                .sort()
                .map((k) => [k, [...c.sets[k as keyof CoachSets]].sort()]),
        ),
        streak: c.streak,
        best: c.best,
        bundle: bundleHash(c.bundle),
        bundleAt: c.bundleAt,
    };
}

export function readLocal(store: Store): CoachLocalState {
    const sets = {} as CoachSets;
    for (const [k, a] of Object.entries(SET_ATOMS))
        sets[k as keyof CoachSets] = [...store.get(a as never as typeof coachTrophiesAtom)];
    const bundle = {} as CoachBundle;
    for (const [k, a] of Object.entries(BUNDLE_ATOMS))
        bundle[k as keyof CoachBundle] = store.get(a as never);
    return {
        xpOwn: store.get(coachXpOwnAtom),
        sets,
        streak: store.get(coachStreakAtom),
        best: store.get(coachBestEstimateAtom),
        bundle,
    };
}

export function applyLocal(store: Store, r: CoachMergeResult) {
    for (const [k, a] of Object.entries(SET_ATOMS)) {
        const next = r.local.sets[k as keyof CoachSets];
        if (next.length !== store.get(a as never as typeof coachTrophiesAtom).length)
            store.set(a as never, next as never);
    }
    const current = readLocal(store).bundle;
    for (const [k, a] of Object.entries(BUNDLE_ATOMS)) {
        const key = k as keyof CoachBundle;
        if (JSON.stringify(current[key]) !== JSON.stringify(r.local.bundle[key]))
            store.set(a as never, r.local.bundle[key] as never);
    }
    if (JSON.stringify(store.get(coachStreakAtom)) !== JSON.stringify(r.local.streak))
        store.set(coachStreakAtom, r.local.streak);
    if (store.get(coachBestEstimateAtom) !== r.local.best)
        store.set(coachBestEstimateAtom, r.local.best);
    if (store.get(coachXpOthersAtom) !== r.xpOthers) store.set(coachXpOthersAtom, r.xpOthers);
    store.set(coachSyncMarkAtom, r.mark);
}
