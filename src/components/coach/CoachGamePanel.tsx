import { Box, Button, Group, Paper, Text } from "@mantine/core";
import { IconArrowBackUp } from "@tabler/icons-react";
import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Outcome } from "@/bindings";
import CoachFigure, { type CoachAnimation, type CoachFigureHandle } from "./CoachFigure";
import { pickLine, REACTION_ANIMATION, REACTION_SIGN, readingTime } from "./coachGame";
import CoachReceipt from "./CoachReceipt";
import { type CoachMistake, finishCoachGameAtom, type ReceiptLine } from "./coachProgress";
import { coachBonusTrackAtom, DAILY_QUEST_XP } from "./coachRewards";
import type { CoachStrengthId } from "./coachState";
import type { CoachComment } from "./useCoachCommentary";
import type { TreeNode } from "@/utils/treeReducer";
import { addLineToRepertoire } from "@/utils/repertoires";
import {
  addToDiary,
  coachDiaryAtom,
  diaryGame,
  epdOf,
  type RepertoireDeparture,
  repertoireDeparture,
} from "./coachDiary";
import type { CoachPlan } from "./coachPlan";
import { today } from "./coachState";

const SIGN_COLOR: Record<string, string> = {
  "!!": "#1baca6",
  "!": "#4f86c6",
  "!?": "#b45fc9",
  "?!": "#d9a514",
  "?": "#e07b24",
  "??": "#cf3a33",
};

type Bubble = { sign: string | null; text: string; key: number };
type Say = { anim: CoachAnimation | null; text: string; sign: string | null };

// Wie schlimm ein Fehler ist, um den schlimmsten der Partie zu finden
const SEVERITY: Record<string, number> = { missedMate: 4, blunder: 3, mistake: 2, dubious: 1 };

// JBL neben dem Brett: reagiert auf deine Züge und spricht in einer Sprechblase.
export default function CoachGamePanel({
  comment,
  gameState,
  result,
  humanColor,
  lastPly,
  onTakeBack,
  rootHalfMoves,
  strength,
  takebacks,
  plan,
  root,
}: {
  comment: CoachComment | null;
  gameState: "settingUp" | "playing" | "gameOver";
  result: Outcome | undefined;
  humanColor: "white" | "black" | null;
  lastPly: number;
  onTakeBack: (keepPlies: number) => void;
  rootHalfMoves: number;
  // Stärke, mit der diese Partie gestartet wurde
  strength: CoachStrengthId;
  takebacks: number;
  plan: CoachPlan | null;
  root: TreeNode;
}) {
  const { t } = useTranslation();
  const figure = useRef<CoachFigureHandle>(null);
  const recent = useRef<string[]>([]);
  const [bubble, setBubble] = useState<Bubble | null>(null);
  const [hover, setHover] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const finishGame = useSetAtom(finishCoachGameAtom);
  const stats = useRef({ brilliants: 0, goods: 0, blunders: 0 });
  const worst = useRef<{ severity: number; mistake: CoachMistake } | null>(null);
  const bonusTrack = useAtomValue(coachBonusTrackAtom);
  const [receipt, setReceipt] = useState<{
    lines: ReceiptLine[];
    lock: number;
  } | null>(null);

  const line = (lineKey: string, extra = "") => {
    const key = pickLine(lineKey, recent.current);
    recent.current = [key, ...recent.current].slice(0, 20);
    return `${t(`Coach.Line.${key}`)}${extra ? ` ${extra}` : ""}`;
  };

  // Erst die Bewegung, dann der Satz: die Blase kommt 300 ms nach dem Start
  // der Animation und bleibt so lange, wie man zum Lesen braucht. Mehrere
  // Sätze kommen nacheinander, nie zwei auf einmal.
  const speak = (items: Say[], startDelay = 0) => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    let at = startDelay;
    for (const item of items) {
      timers.current.push(
        setTimeout(() => {
          if (item.anim) figure.current?.play(item.anim);
          timers.current.push(
            setTimeout(
              () => setBubble({ sign: item.sign, text: item.text, key: Date.now() }),
              item.anim ? 300 : 0,
            ),
          );
        }, at),
      );
      at += (item.anim ? 300 : 0) + readingTime(item.text) + 300;
    }
  };

  const deliver = (anim: CoachAnimation | null, lineKey: string, sign: string | null, extra = "") =>
    speak([{ anim, text: line(lineKey, extra), sign }]);

  // Ausblenden nach der Lesezeit, aber nicht, solange die Maus darauf ist.
  useEffect(() => {
    if (!bubble || hover) return;
    const timer = setTimeout(() => setBubble(null), readingTime(bubble.text));
    return () => clearTimeout(timer);
  }, [bubble, hover]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // Zugkommentare
  const setDiary = useSetAtom(coachDiaryAtom);
  // Zeichen der eigenen Züge (Ply -> "?", "??", ...) fürs Tagebuch
  const marks = useRef<Record<number, string>>({});
  const reported = useRef({ own: false, end: false });
  const [departure, setDeparture] = useState<RepertoireDeparture | null>(null);
  const [added, setAdded] = useState<"no" | "busy" | "done" | "failed">("no");

  const lastComment = useRef(0);
  useEffect(() => {
    if (!comment || comment.id === lastComment.current) return;
    lastComment.current = comment.id;
    if (comment.reaction === "brilliant") stats.current.brilliants++;
    if (comment.reaction === "good") stats.current.goods++;
    marks.current[comment.ply] = REACTION_SIGN[comment.reaction];
    if (comment.reaction === "blunder" || comment.reaction === "missedMate")
      stats.current.blunders++;
    const severity = SEVERITY[comment.reaction] ?? 0;
    if (
      severity > 0 &&
      comment.solutions.length > 0 &&
      (!worst.current || severity > worst.current.severity)
    )
      worst.current = {
        severity,
        mistake: { fen: comment.fen, played: comment.san, solutions: comment.solutions },
      };
    const sign = REACTION_SIGN[comment.reaction];
    const better =
      comment.best && ["dubious", "mistake", "blunder"].includes(comment.reaction)
        ? t("Coach.Line.Better", { move: comment.best })
        : "";
    deliver(REACTION_ANIMATION[comment.reaction], comment.reaction, sign, better);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comment]);

  // Eröffnungs-Sparring: JBL sagt sofort, wenn du dein Repertoire verlässt
  // oder es zu Ende ist.
  useEffect(() => {
    if (!plan?.sparring || !plan.index || gameState !== "playing" || !humanColor) return;
    if (!reported.current.own) {
      const d = repertoireDeparture(root, humanColor, plan.index);
      if (d?.kind === "own") {
        reported.current.own = true;
        speak([
          {
            anim: "dub",
            text: line("offBook", t("Coach.Game.Expected", { moves: d.expected.join(", ") })),
            sign: null,
          },
        ]);
        return;
      }
    }
    if (!reported.current.end && !reported.current.own) {
      let n = root;
      while (n.children.length > 0) n = n.children[0];
      const known = plan.index.get(epdOf(n.fen));
      if (n !== root && known && known.length === 0) {
        reported.current.end = true;
        speak([{ anim: "think", text: line("repEnd"), sign: null }]);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, plan, gameState]);

  const addLine = async () => {
    if (!plan?.repertoire || !departure || departure.kind !== "gap") return;
    setAdded("busy");
    try {
      const r = await addLineToRepertoire(plan.repertoire.file, root, departure.path, {
        withVariations: false,
        label: "JBL Coach",
      });
      setAdded(r.ok ? "done" : "failed");
    } catch {
      setAdded("failed");
    }
  };

  // Start und Ende der Partie
  const lastState = useRef(gameState);
  useEffect(() => {
    const prev = lastState.current;
    lastState.current = gameState;
    if (prev === gameState) return;
    if (gameState === "playing") {
      stats.current = { brilliants: 0, goods: 0, blunders: 0 };
      worst.current = null;
      marks.current = {};
      reported.current = { own: false, end: false };
      setDeparture(null);
      setAdded("no");
      setReceipt(null);
      speak([
        { anim: "hello", text: line("start"), sign: null },
        ...(plan?.announce ?? []).map((key) => ({ anim: null, text: line(key), sign: null })),
        ...(bonusTrack ? [{ anim: "bril" as const, text: line("bonusTrack"), sign: null }] : []),
      ]);
    }
    if (gameState === "gameOver" && humanColor && result && result !== "*") {
      const outcome =
        result === "1/2-1/2"
          ? ("draw" as const)
          : (result === "1-0") === (humanColor === "white")
            ? ("win" as const)
            : ("loss" as const);
      setDiary((d) => addToDiary(d, diaryGame(root, humanColor, outcome, marks.current, today())));
      if (plan?.index) setDeparture(repertoireDeparture(root, humanColor, plan.index));
      const done = finishGame({
        result: outcome,
        strength,
        takebacks,
        ...stats.current,
        mistake: worst.current?.mistake ?? null,
      });
      // Erst die Reaktion, dann der Kassenzettel, danach was neu ist
      const after: Say[] = [];
      if (done.levelAfter > done.levelBefore) {
        after.push({
          anim: "win",
          text: line("levelUp", t("Coach.Game.NewLevel", { level: done.levelAfter })),
          sign: null,
        });
        for (const item of done.newItems)
          after.push({
            anim: null,
            text: t("Coach.Game.NewItem", { item: t(`Coach.Item.${item}`) }),
            sign: null,
          });
      }
      for (const trophy of done.trophies)
        after.push({
          anim: "good",
          text: t("Coach.Game.Trophy", { trophy: t(`Coach.Trophy.${trophy}.Title`) }),
          sign: null,
        });
      if (done.questDone)
        after.push({
          anim: null,
          text: t("Coach.Game.QuestDone", { xp: DAILY_QUEST_XP }),
          sign: null,
        });
      if (done.newBest && done.estimate)
        after.push({
          anim: "good",
          text: t("Coach.Game.NewBest", { elo: done.estimate }),
          sign: null,
        });
      if (done.lines.some((l) => l.key === "tired"))
        after.push({ anim: "think", text: line("tired"), sign: null });
      speak([
        outcome === "draw"
          ? { anim: null, text: line("draw"), sign: null }
          : { anim: outcome, text: line(outcome), sign: null },
        ...after,
      ]);
      timers.current.push(
        setTimeout(() => setReceipt({ lines: done.lines, lock: done.lock }), 2400),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState, result]);

  // Zurücknehmen nach ? oder ??, aber nie nach zugelassenem Matt in 1.
  const offerTakeBack =
    gameState === "playing" &&
    comment !== null &&
    (comment.reaction === "mistake" || comment.reaction === "blunder") &&
    lastPly - comment.ply <= 1;

  return (
    <Paper withBorder radius="md" p="sm" data-tour="coach-game">
      <Group wrap="nowrap" align="flex-start" gap="sm">
        <Box style={{ flexShrink: 0, lineHeight: 0 }}>
          <CoachFigure ref={figure} size={96} title={t("Coach.Card.Title")} />
        </Box>
        <Box
          style={{ flex: 1, minWidth: 0, minHeight: 72 }}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          aria-live="polite"
        >
          {bubble ? (
            <Paper key={bubble.key} radius="md" p="xs" bg="var(--mantine-color-default-hover)">
              <Text size="sm">
                {bubble.sign && (
                  <Text span fw={800} mr={6} c={SIGN_COLOR[bubble.sign]}>
                    {bubble.sign}
                  </Text>
                )}
                {bubble.text}
              </Text>
            </Paper>
          ) : (
            <Text size="sm" c="dimmed">
              {t("Coach.Game.Watching")}
            </Text>
          )}
          {receipt && <CoachReceipt lines={receipt.lines} lock={receipt.lock} />}
          {receipt && departure && (
            <Paper withBorder radius="md" p="xs" mt="xs">
              <Text size="sm">
                {departure.kind === "own"
                  ? t("Coach.Game.LeftOwn", {
                      move: departure.played,
                      expected: departure.expected.join(", "),
                    })
                  : departure.played
                    ? t("Coach.Game.LeftGap", { move: departure.jbl, reply: departure.played })
                    : t("Coach.Game.LeftGapNoReply", { move: departure.jbl })}
              </Text>
              {departure.kind === "gap" && departure.played && (
                <Button
                  mt={6}
                  size="xs"
                  variant="light"
                  color="orange"
                  loading={added === "busy"}
                  disabled={added === "done"}
                  onClick={addLine}
                >
                  {added === "done"
                    ? t("Coach.Game.LineAdded")
                    : added === "failed"
                      ? t("Coach.Game.LineFailed")
                      : t("Coach.Game.AddLine")}
                </Button>
              )}
            </Paper>
          )}
          {offerTakeBack && (
            <Button
              mt="xs"
              size="xs"
              variant="light"
              color="orange"
              leftSection={<IconArrowBackUp size={14} />}
              onClick={() => comment && onTakeBack(Math.max(0, comment.ply - 1 - rootHalfMoves))}
            >
              {t("Coach.Game.TakeBack")}
            </Button>
          )}
        </Box>
      </Group>
    </Paper>
  );
}
