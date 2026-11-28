// Motiv-Trainer: welche Aufgaben in welcher Reihenfolge.
//
// - reversing: je Mattbild erst Matt in 1 (A), dann dieselbe Stellung von
//   weiter vorn (B, C …), danach die Weiterführungen. Die Matt-in-1-Stellung
//   steht beim Lösen als Hilfe daneben.
// - test1: nur die Matt-in-1-Aufgaben, gemischt, ohne Hilfe.
// - test2: nur Matt in 2 und mehr (inkl. Weiterführungen), gemischt, ohne Hilfe.

import type {
    MotifChapter,
    MotifCollection,
    MotifLevel,
    MotifLine,
    MotifPattern,
} from "./motifImport";
import type { MotifProgress } from "./motifStore";

export type MotifMode = "reversing" | "test1" | "test2";
export const MOTIF_MODES: MotifMode[] = ["reversing", "test1", "test2"];

export type MotifTask = {
    chapter: MotifChapter;
    pattern: MotifPattern;
    line: MotifLine;
    /** Matt-in-1-Linie desselben Mattbilds als Hilfe (nur im Lernmodus) */
    template?: MotifLine;
    forwarding: boolean;
};

export type SessionFilter = {
    mode: MotifMode;
    levels: MotifLevel[];
    /** leer = alle Kapitel */
    chapterIds: string[];
    /** nur Aufgaben, deren letzter Versuch falsch war */
    onlyMistakes: boolean;
    withForwarding: boolean;
};

function shuffle<T>(list: T[], random: () => number): T[] {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

export function buildSession(
    collection: MotifCollection,
    filter: SessionFilter,
    progress: MotifProgress = {},
    random: () => number = Math.random,
): MotifTask[] {
    const chapters = collection.chapters.filter(
        (c) =>
            filter.levels.includes(c.level) &&
            (filter.chapterIds.length === 0 || filter.chapterIds.includes(c.id)),
    );
    const tasks: MotifTask[] = [];
    for (const chapter of chapters) {
        for (const pattern of chapter.patterns) {
            const template = pattern.steps.find((s) => s.mateIn === 1);
            const extra = filter.withForwarding ? pattern.forwarding : [];
            const lines =
                filter.mode === "test1"
                    ? pattern.steps.filter((s) => s.mateIn === 1)
                    : filter.mode === "test2"
                      ? [...pattern.steps.filter((s) => s.mateIn > 1), ...extra]
                      : [...pattern.steps, ...extra];
            for (const line of lines) {
                const forwarding = line.forwardFrom !== undefined;
                tasks.push({
                    chapter,
                    pattern,
                    line,
                    template:
                        filter.mode === "reversing" && template && template.id !== line.id
                            ? template
                            : undefined,
                    forwarding,
                });
            }
        }
    }
    const picked = filter.onlyMistakes
        ? tasks.filter((t) => progress[t.line.id]?.last === "bad")
        : tasks;
    return filter.mode === "reversing" ? picked : shuffle(picked, random);
}

export function countLines(collection: MotifCollection) {
    let patterns = 0;
    let mate1 = 0;
    let longer = 0;
    let forwarding = 0;
    for (const chapter of collection.chapters)
        for (const p of chapter.patterns) {
            patterns++;
            mate1 += p.steps.filter((s) => s.mateIn === 1).length;
            longer += p.steps.filter((s) => s.mateIn > 1).length;
            forwarding += p.forwarding.length;
        }
    return { patterns, mate1, longer, forwarding };
}
