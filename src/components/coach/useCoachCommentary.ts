import { makeUci } from "chessops";
import { useAtomValue } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";
import { commands } from "@/bindings";
import { enginesAtom } from "@/state/atoms";
import { enginePowerAtom, engineOptions } from "@/utils/enginePower";
import { normalizeScore, getAnnotation } from "@/utils/score";
import type { TreeNode } from "@/utils/treeReducer";
import { evalText, explainMotifs } from "./coachExplain";
import {
    checkEngineOptions,
    type CoachReaction,
    findStockfish,
    isOnlyMove,
    notationSign,
    playedScore,
    REACTION_SIGN,
    recentlySaid,
    reactionFor,
} from "./coachGame";
import { coachIntroAtom } from "./coachIntroState";
import { askCoachExplain } from "@/utils/cloud/auth";
import { cloudAccountAtom } from "@/utils/cloud/sync";
import { useTranslation } from "react-i18next";

// Wie tief JBL die Züge prüft (1.2.19: 16 statt 12, Tiefe 12 schwankte zu
// sehr). Die Stellungen davor kommen meist schon aus dem Zwischenspeicher.
export const CHECK_DEPTH = 16;

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
    // Fakten für „Warum?“: Bewertung vorher und nachher aus Sicht des
    // Spielers, die Folgevariante der Engine und erkannte Motive
    before: string;
    after: string;
    line: string[];
    motifs: string[];
    // Name der Eröffnung, wenn der Zug Theorie ist
    opening: string | null;
    // Stellung nach dem Zug
    fenAfter: string;
    // Was JBL dazu sagt, von Claude formuliert; null: die festen Sprüche
    text: string | null;
};

// So lange wartet die Partie höchstens auf Claude, dann gilt der feste Spruch
export const SAY_TIMEOUT_MS = 5000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
    return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

// Zweitbester Zug zählt mit, wenn er höchstens so viel schlechter ist.
const SOLUTION_MARGIN_CP = 30;

let runs = 0;

// Bewertet jeden neuen Zug des Spielers: Theorie, solide, oder ein Zeichen
// (!!, !, !?, ?!, ?, ??, Matt in 1 zugelassen).
export function useCoachCommentary(
    root: TreeNode,
    humanColor: "white" | "black" | null,
    active: boolean,
): {
    comment: CoachComment | null;
    enabled: boolean;
    // Zeichen für die Zugliste je Stellung nach dem Zug, für beide Seiten
    signs: Record<string, string>;
} {
    const { i18n } = useTranslation();
    const account = useAtomValue(cloudAccountAtom);
    const stage = useAtomValue(coachIntroAtom).entry ?? "knows";
    const say = useRef({ account, stage, lang: "de" as "de" | "en" });
    say.current = { account, stage, lang: i18n.language.startsWith("en") ? "en" : "de" };
    const engines = useAtomValue(enginesAtom);
    const engine = useMemo(() => findStockfish(engines), [engines]);
    const power = useAtomValue(enginePowerAtom);
    const options = useMemo(
        () => checkEngineOptions(engineOptions(engine?.settings ?? undefined, power)),
        [engine, power],
    );
    const [comment, setComment] = useState<CoachComment | null>(null);
    const [signs, setSigns] = useState<Record<string, string>>({});
    const checked = useRef(new Set<string>());
    const running = useRef(new Set<string>());
    const generation = useRef(0);

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
        // JBLs Züge bekommen nur ein Zeichen in der Zugliste, keinen Kommentar
        const isHuman = mover === humanColor;
        const key = `${before.fen}|${makeUci(last.move)}`;
        if (checked.current.has(key)) return;
        checked.current.add(key);

        // Die Prüfung läuft weiter, auch wenn JBL schon geantwortet hat; nur
        // eine neue Partie oder das Schließen bricht sie ab.
        const runId = `coach_comment_${++runs}`;
        const gen = generation.current;
        running.current.add(runId);
        const cancelled = () => gen !== generation.current;
        (async () => {
            const [book, prevBook] = await Promise.all([
                commands.getOpeningFromFen(last.fen).catch(() => null),
                line.length > 2
                    ? commands.getOpeningFromFen(before.fen).catch(() => null)
                    : Promise.resolve({ status: "ok" as const, data: "start" }),
            ]);
            const opening = book?.status === "ok" ? book.data : null;
            const prevInBook = prevBook?.status === "ok" && !!prevBook.data;
            // Ab dem dritten Zug auch die Stellung vor dem Zug des Gegners, damit
            // ein ! nur kommt, wenn man dessen Fehler wirklich bestraft
            const prior = line.length > 2 ? line[line.length - 3] : null;
            const start = prior && before.move ? prior : before;
            const moves =
                start === prior
                    ? [makeUci(before.move!), makeUci(last.move!)]
                    : [makeUci(last.move!)];
            const res = await commands.analyzeGame(
                runId,
                engine.path,
                { t: "Depth", c: CHECK_DEPTH },
                {
                    fen: start.fen,
                    moves,
                    annotateNovelties: false,
                    referenceDb: null,
                    reversed: false,
                },
                [...options, { name: "MultiPV", value: "2" }],
            );
            if (cancelled() || res.status !== "ok" || res.data.length < moves.length + 1) return;
            const [pre, post] = res.data.slice(-2);
            const prevprev = moves.length === 2 ? (res.data[0].best[0]?.score.value ?? null) : null;
            const preBest = pre.best[0];
            const postBest = post.best[0];
            if (!preBest || !postBest) return;
            const afterScore = playedScore(last.san ?? "", pre.best, postBest.score.value);
            const annotation = getAnnotation(
                prevprev,
                preBest.score.value,
                afterScore,
                mover,
                pre.best,
                post.is_sacrifice,
                last.san ?? "",
            );
            const allowsMate =
                postBest.score.value.type === "mate" &&
                Math.abs(postBest.score.value.value) === 1 &&
                normalizeScore(postBest.score.value, mover) < 0;
            const sign = notationSign({
                annotation,
                allowsMateInOne: allowsMate,
                inBook: opening !== null,
                prevInBook,
                onlyMove: isOnlyMove(
                    last.san ?? "",
                    pre.best.map((b) => ({
                        san: b.sanMoves[0] ?? null,
                        score: normalizeScore(b.score.value, mover),
                    })),
                ),
            });
            if (cancelled()) return;
            if (sign) setSigns((m) => ({ ...m, [last.fen]: sign }));
            if (!isHuman) return;
            const after = postBest.score.value;
            const allowsMateInOne =
                after.type === "mate" &&
                Math.abs(after.value) === 1 &&
                normalizeScore(after, humanColor) < 0;
            const reaction = reactionFor(annotation, allowsMateInOne, opening !== null);
            const engineMove0 = preBest.sanMoves[0] ?? null;
            const beforeText = evalText(preBest.score.value, humanColor);
            const afterText = evalText(afterScore, humanColor);
            const followLine = postBest.sanMoves.slice(0, 6);
            const motifs = explainMotifs({ allowsMateInOne, sacrifice: post.is_sacrifice });
            // Claude formuliert den Satz zum Zug; die Partie wartet darauf
            let text: string | null = null;
            const { account: acc, stage: st, lang } = say.current;
            if (acc) {
                text = await withTimeout(
                    askCoachExplain({
                        mode: "say",
                        fen: before.fen,
                        move: last.san ?? "",
                        best: engineMove0 && engineMove0 !== last.san ? engineMove0 : null,
                        line: followLine,
                        before: beforeText,
                        after: afterText,
                        mark: REACTION_SIGN[reaction] || (reaction === "book" ? "book" : "solid"),
                        motifs,
                        stage: st,
                        lang,
                        opening,
                        // Abwechslung (1.2.19): eine von drei Fassungen, der
                        // Halbzug und was JBL zuletzt gesagt hat
                        variant: 1 + Math.floor(Math.random() * 3),
                        ply: last.halfMoves,
                        recent: recentlySaid(4),
                    }).catch(() => null),
                    SAY_TIMEOUT_MS,
                );
            }
            if (cancelled()) return;
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
                before: beforeText,
                after: afterText,
                line: followLine,
                motifs,
                opening,
                fenAfter: last.fen,
                text,
            }));
        })()
            .catch(() => {})
            .finally(() => running.current.delete(runId));
    }, [active, engine, options, humanColor, line]);

    // Neue Partie oder Ende: laufende Prüfungen abbrechen, alles vergessen
    const stopAll = () => {
        generation.current++;
        for (const id of running.current) commands.cancelAnalysis(id).catch(() => {});
        running.current.clear();
    };
    useEffect(() => {
        if (line.length <= 1) {
            checked.current.clear();
            setSigns({});
            stopAll();
        }
    }, [line.length]);
    useEffect(() => stopAll, []);

    return {
        comment: line.length <= 1 ? null : comment,
        enabled: active && !!engine && !!humanColor,
        signs: line.length <= 1 ? {} : signs,
    };
}
