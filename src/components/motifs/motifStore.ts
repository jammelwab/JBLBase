// Motiv-Trainer: Sammlungen und Fortschritt.
// Die Aufgaben bleiben auf dem Gerät (App-Datenordner, motif_trainer.json):
// es sind gekaufte Kursinhalte, die nicht in die Cloud gehören.

import { BaseDirectory, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { warn } from "@tauri-apps/plugin-log";
import { atom, getDefaultStore } from "jotai";
import { atomWithStorage } from "jotai/utils";
import type { CloudAccount } from "@/utils/cloud/auth";
import type { MotifCollection, MotifLevel } from "./motifImport";

export const MOTIF_FILE = "motif_trainer.json";
const options = { baseDir: BaseDirectory.AppData };
const store = getDefaultStore();

/**
 * Darf das Konto den Motiv-Trainer nutzen? Admins immer, sonst mit dem
 * Einzelrecht "motifTrainer" aus der Rechteverwaltung (Custom Claim perms).
 */
export function canUseMotifTrainer(account: CloudAccount | null | undefined): boolean {
    if (!account) return false;
    if (account.role === "admin") return true;
    const perms = (account as { perms?: Record<string, boolean | undefined> }).perms;
    return perms?.motifTrainer === true;
}

export const motifCollectionsAtom = atom<MotifCollection[]>([]);
export const motifLoadedAtom = atom(false);

let loading: Promise<void> | null = null;

export function loadMotifCollections(): Promise<void> {
    loading ??= readTextFile(MOTIF_FILE, options)
        .then((text) => {
            const data = JSON.parse(text) as { collections?: MotifCollection[] };
            if (Array.isArray(data.collections)) store.set(motifCollectionsAtom, data.collections);
        })
        .catch(() => {})
        .finally(() => store.set(motifLoadedAtom, true));
    return loading;
}

function save(collections: MotifCollection[]) {
    store.set(motifCollectionsAtom, collections);
    writeTextFile(MOTIF_FILE, JSON.stringify({ version: 1, collections }), options).catch((e) =>
        warn(`Could not save ${MOTIF_FILE}: ${e}`),
    );
}

export async function addMotifCollection(collection: MotifCollection) {
    await loadMotifCollections();
    save([...store.get(motifCollectionsAtom), collection]);
}

/** Weitere Kapitel in eine vorhandene Sammlung */
export async function extendMotifCollection(id: string, more: MotifCollection) {
    await loadMotifCollections();
    save(
        store
            .get(motifCollectionsAtom)
            .map((c) => (c.id === id ? { ...c, chapters: [...c.chapters, ...more.chapters] } : c)),
    );
}

export async function removeMotifCollection(id: string) {
    await loadMotifCollections();
    save(store.get(motifCollectionsAtom).filter((c) => c.id !== id));
}

export async function setChapterLevel(collectionId: string, chapterId: string, level: MotifLevel) {
    await loadMotifCollections();
    save(
        store.get(motifCollectionsAtom).map((c) =>
            c.id !== collectionId
                ? c
                : {
                      ...c,
                      chapters: c.chapters.map((ch) =>
                          ch.id === chapterId ? { ...ch, level } : ch,
                      ),
                  },
        ),
    );
}

// ---------- Fortschritt ----------

export type LineResult = { ok: number; bad: number; last: "ok" | "bad"; at: string };
export type MotifProgress = Record<string, LineResult>;

export const motifProgressAtom = atomWithStorage<MotifProgress>("jbl-motif-progress", {});

export function recordLine(progress: MotifProgress, lineId: string, ok: boolean): MotifProgress {
    const prev = progress[lineId] ?? { ok: 0, bad: 0, last: "ok", at: "" };
    return {
        ...progress,
        [lineId]: {
            ok: prev.ok + (ok ? 1 : 0),
            bad: prev.bad + (ok ? 0 : 1),
            last: ok ? "ok" : "bad",
            at: new Date().toISOString(),
        },
    };
}
