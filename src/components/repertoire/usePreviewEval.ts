import { useAtomValue } from "jotai";
import { useEffect, useMemo, useState } from "react";
import { commands, type Score } from "@/bindings";
import { enginesAtom } from "@/state/atoms";
import { enginePowerAtom, engineOptions } from "@/utils/enginePower";
import type { LocalEngine } from "@/utils/engines";

// How deep the engine looks when the position is not in the position store yet. Deep enough
// for a sensible number, quick enough that the bar keeps up while you click through a tree.
export const PREVIEW_EVAL_DEPTH = 18;
// Clicking quickly through moves should not start an engine for every one of them
const ENGINE_DELAY_MS = 350;

export type PreviewEval = {
    // From White's point of view
    score: Score;
    depth: number;
    engine: string;
    // Read from the position store rather than calculated just now
    stored: boolean;
};

export type PreviewEvalState =
    | { state: "loading" }
    | { state: "calculating"; engine: string }
    | { state: "done"; eval: PreviewEval }
    | { state: "none"; reason: "noEngine" | "failed" };

let runs = 0;

// The evaluation for the small board: the deepest one in the position store, otherwise a short
// engine run (which then lands in the store, so the next time it is there right away).
export function usePreviewEval(fen: string): PreviewEvalState {
    const engines = useAtomValue(enginesAtom);
    const power = useAtomValue(enginePowerAtom);
    // Stockfish first, as the steadier judge; otherwise whichever engine is installed
    const engine = useMemo(() => {
        const local = (engines ?? []).filter((e): e is LocalEngine => e.type === "local");
        return local.find((e) => /stockfish/i.test(e.name)) ?? local[0] ?? null;
    }, [engines]);
    const [result, setResult] = useState<{ fen: string; value: PreviewEvalState } | null>(null);

    useEffect(() => {
        let cancelled = false;
        let runId: string | null = null;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const set = (value: PreviewEvalState) => {
            if (!cancelled) setResult({ fen, value });
        };

        const calculate = async () => {
            if (!engine) return set({ state: "none", reason: "noEngine" });
            set({ state: "calculating", engine: engine.name });
            runId = `repertoire_preview_${++runs}`;
            const res = await commands.analyzeGame(
                runId,
                engine.path,
                { t: "Depth", c: PREVIEW_EVAL_DEPTH },
                { fen, moves: [], annotateNovelties: false, referenceDb: null, reversed: false },
                engineOptions(engine.settings ?? undefined, power),
            );
            runId = null;
            const best = res.status === "ok" ? res.data[0]?.best[0] : undefined;
            if (!best) return set({ state: "none", reason: "failed" });
            set({
                state: "done",
                eval: { score: best.score, depth: best.depth, engine: engine.name, stored: false },
            });
        };

        (async () => {
            const cached = await commands.getCachedEvals(fen).catch(() => null);
            if (cancelled) return;
            // Entries of a weakened engine (e.g. "Stockfish [Skill Level=5]") only when nothing
            // else is stored
            const all = cached?.status === "ok" ? cached.data : [];
            const full = all.filter((e) => !e.engine.includes("["));
            const deepest =
                all.length > 0
                    ? (full.length > 0 ? full : all).reduce<(typeof all)[number] | null>(
                          (best, e) => (!best || e.depth > best.depth ? e : best),
                          null,
                      )
                    : null;
            if (deepest) {
                set({
                    state: "done",
                    eval: {
                        score: deepest.score,
                        depth: deepest.depth,
                        engine: deepest.engine,
                        stored: true,
                    },
                });
                return;
            }
            timer = setTimeout(() => {
                if (!cancelled) calculate().catch(() => set({ state: "none", reason: "failed" }));
            }, ENGINE_DELAY_MS);
        })();

        return () => {
            cancelled = true;
            clearTimeout(timer);
            if (runId) commands.cancelAnalysis(runId).catch(() => {});
        };
    }, [fen, engine, power]);

    return result?.fen === fen ? result.value : { state: "loading" };
}
