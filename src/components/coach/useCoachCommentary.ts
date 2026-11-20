import { makeUci } from "chessops";
import { useAtomValue } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";
import { commands } from "@/bindings";
import { enginesAtom } from "@/state/atoms";
import { normalizeScore, getAnnotation } from "@/utils/score";
import type { TreeNode } from "@/utils/treeReducer";
import { type CoachReaction, findStockfish, reactionFor } from "./coachGame";

// Wie tief JBL die Züge des Spielers prüft: schnell genug, dass der Kommentar
// kommt, bevor man den nächsten Zug überlegt.
const CHECK_DEPTH = 12;

export type CoachComment = {
    // Laufende Nummer, damit dieselbe Reaktion zweimal hintereinander auffällt
    id: number;
    reaction: CoachReaction;
    // Ply des bewerteten Zugs (1 = erster Zug von Weiß)
    ply: number;
    san: string;
    // Was die Engine stattdessen gespielt hätte (SAN), falls anders
    best: string | null;
    // Stellung vor dem Zug und die Züge, die dort gut gewesen wären
    fen: string;
    solutions: string[];
};

// Zweitbester Zug zählt mit, wenn er höchstens so viel schlechter ist.
const SOLUTION_MARGIN_CP = 30;

let runs = 0;

// Bewertet jeden neuen Zug des Spielers und meldet eine Reaktion, wenn er
// auffällt (!!, !, !?, ?!, ?, ?? oder Matt in 1 zugelassen).
export function useCoachCommentary(
    root: TreeNode,
    humanColor: "white" | "black" | null,
    active: boolean,
): CoachComment | null {
    const engines = useAtomValue(enginesAtom);
    const engine = useMemo(() => findStockfish(engines), [engines]);
    const [comment, setComment] = useState<CoachComment | null>(null);
    const checked = useRef(new Set<string>());

    // Hauptlinie als Liste der Knoten
    const line = useMemo(() => {
        const nodes: TreeNode[] = [root];
        let n = root;
        while (n.children.length > 0) {
            n = n.children[0];
            nodes.push(n);
        }
        return nodes;
    }, [root]);

    useEffect(() => {
        if (!active || !engine || !humanColor || line.length < 2) return;
        const last = line[line.length - 1];
        const before = line[line.length - 2];
        if (!last.move) return;
        // Wer hat den letzten Zug gemacht? Ungerade halfMoves = Weiß
        const mover = last.halfMoves % 2 === 1 ? "white" : "black";
        if (mover !== humanColor) return;
        const key = `${before.fen}|${makeUci(last.move)}`;
        if (checked.current.has(key)) return;
        checked.current.add(key);

        let cancelled = false;
        const runId = `coach_comment_${++runs}`;
        (async () => {
            const res = await commands.analyzeGame(
                runId,
                engine.path,
                { t: "Depth", c: CHECK_DEPTH },
                {
                    fen: before.fen,
                    moves: [makeUci(last.move!)],
                    annotateNovelties: false,
                    referenceDb: null,
                    reversed: false,
                },
                [{ name: "MultiPV", value: "2" }],
            );
            if (cancelled || res.status !== "ok" || res.data.length < 2) return;
            const [pre, post] = res.data;
            const preBest = pre.best[0];
            const postBest = post.best[0];
            if (!preBest || !postBest) return;
            const annotation = getAnnotation(
                null,
                preBest.score.value,
                postBest.score.value,
                humanColor,
                pre.best,
                post.is_sacrifice,
                last.san ?? "",
            );
            const after = postBest.score.value;
            const allowsMateInOne =
                after.type === "mate" &&
                Math.abs(after.value) === 1 &&
                normalizeScore(after, humanColor) < 0;
            const reaction = reactionFor(annotation, allowsMateInOne);
            if (!reaction) return;
            const engineMove = preBest.sanMoves[0] ?? null;
            const bestScore = normalizeScore(preBest.score.value, humanColor);
            const solutions = pre.best
                .filter(
                    (b, i) =>
                        i === 0 ||
                        bestScore - normalizeScore(b.score.value, humanColor) <= SOLUTION_MARGIN_CP,
                )
                .map((b) => b.sanMoves[0])
                .filter((m): m is string => !!m && m !== last.san);
            setComment((prev) => ({
                id: (prev?.id ?? 0) + 1,
                reaction,
                ply: last.halfMoves,
                san: last.san ?? "",
                best: engineMove && engineMove !== last.san ? engineMove : null,
                fen: before.fen,
                solutions,
            }));
        })().catch(() => {});

        return () => {
            cancelled = true;
            commands.cancelAnalysis(runId).catch(() => {});
        };
    }, [active, engine, humanColor, line]);

    // Neue Partie: alles vergessen
    useEffect(() => {
        if (line.length <= 1) checked.current.clear();
    }, [line.length]);

    return line.length <= 1 ? null : comment;
}
