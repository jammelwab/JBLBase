import { Box, Button, Group, Paper, ScrollArea, Stack, Text } from "@mantine/core";
import { IconArrowBackUp, IconBulb, IconReport } from "@tabler/icons-react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { makeUci } from "chessops";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Outcome } from "@/bindings";
import CoachFigure, { type CoachAnimation, type CoachFigureHandle } from "./CoachFigure";
import { pickLine, REACTION_ANIMATION, REACTION_SIGN, readingTime } from "./coachGame";
import CoachReceipt from "./CoachReceipt";
import CoachDeepDive from "./CoachDeepDive";
import CoachReport, { type CoachReportData } from "./CoachReport";
import { askCoach, countReactions } from "./coachCloud";
import { DEEP_REACTIONS, motifsFor, type ReportMove, reportMoments } from "./coachDeep";
import { coachIntroAtom } from "./coachIntroState";
import { cloudAccountAtom } from "@/utils/cloud/sync";
import CoachWhy from "./CoachWhy";
import { playCoachTone } from "./coachSound";
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
import {
  coachEggsAtom,
  coachLambruscoDayAtom,
  finishCoachEggsAtom,
  humanKingMate,
  humanKnightPromotion,
  isEnPassant,
  MATE_DRILL_TASKS,
  repertoireToMate,
} from "./coachEggs";
import { BunnyBlast, CoachDog, LambruscoCart, PenaltyTicket } from "./CoachEggArt";
import { coachProfileAtom } from "./coachProfile";
import { useIsAdmin } from "@/components/tutorial/tutorialState";

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

// So viele Sätze bleiben im Verlauf
const LOG_MAX = 60;

// So lange warten Start und Ende höchstens auf Claude
const EVENT_TIMEOUT_MS = 2500;
// Der Bericht erscheint, wenn JBL die ersten Sätze gesagt hat
const REPORT_DELAY_MS = 6500;

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
  attack = false,
  boss = false,
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
  // JBL im Angriffsmodus: Patricia spielt
  attack?: boolean;
  // Boss-Challenge: „Jannick“ spielt
  boss?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const figure = useRef<CoachFigureHandle>(null);
  const account = useAtomValue(cloudAccountAtom);
  const stage = useAtomValue(coachIntroAtom).entry ?? "knows";
  // Bewertete eigene Züge dieser Partie für den Bericht
  const history = useRef<ReportMove[]>([]);
  const opening = useRef<string | null>(null);
  const [report, setReport] = useState<CoachReportData | null>(null);
  const [reportReady, setReportReady] = useState<CoachReportData | null>(null);
  const [deep, setDeep] = useState<CoachComment | null>(null);
  // Jede neue Partie oder jedes Ende macht ältere Claude-Antworten ungültig
  const speechGen = useRef(0);
  const recent = useRef<string[]>([]);
  // Alles, was JBL in dieser Partie gesagt hat, zum Nachlesen
  const [log, setLog] = useState<Bubble[]>([]);
  const logView = useRef<HTMLDivElement>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const finishGame = useSetAtom(finishCoachGameAtom);
  const stats = useRef({ brilliants: 0, goods: 0, blunders: 0 });
  const worst = useRef<{ severity: number; mistake: CoachMistake } | null>(null);
  const bonusTrack = useAtomValue(coachBonusTrackAtom);
  const [receipt, setReceipt] = useState<{
    lines: ReceiptLine[];
    lock: number;
  } | null>(null);

  const profile = useAtomValue(coachProfileAtom);
  const isAdmin = useIsAdmin();
  const line = (lineKey: string, extra = "") => {
    const key = pickLine(lineKey, recent.current);
    recent.current = [key, ...recent.current].slice(0, 20);
    return `${t(`Coach.Line.${key}`, { name: profile.name ?? "", interpolation: { escapeValue: false } })}${extra ? ` ${extra}` : ""}`;
  };

  // Easter Eggs während der Partie
  const eggs = useAtomValue(coachEggsAtom);
  const finishEggs = useSetAtom(finishCoachEggsAtom);
  const [lambruscoDay, setLambruscoDay] = useAtom(coachLambruscoDayAtom);
  const lambrusco = useRef(false);
  const [dog, setDog] = useState(false);
  const [cart, setCart] = useState(false);
  const [blast, setBlast] = useState(false);
  const [penalty, setPenalty] = useState(false);
  const checkedPly = useRef(0);

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
              () =>
                setLog((l) =>
                  [
                    ...l,
                    { sign: item.sign, text: item.text, key: Date.now() + Math.random() },
                  ].slice(-LOG_MAX),
                ),
              item.anim ? 300 : 0,
            ),
          );
        }, at),
      );
      at += (item.anim ? 300 : 0) + readingTime(item.text) + 300;
    }
  };

  // Satz zu Start und Ende von Claude, sonst der feste Spruch
  const eventText = async (event: "start" | "win" | "loss" | "draw", fallback: string) => {
    if (!account) return fallback;
    const answer = await askCoach(
      {
        event,
        stage,
        lang: i18n.language.startsWith("en") ? "en" : "de",
        variant: 1 + Math.floor(Math.random() * 5),
      },
      EVENT_TIMEOUT_MS,
    );
    return answer ?? fallback;
  };

  const deliver = (anim: CoachAnimation | null, lineKey: string, sign: string | null, extra = "") =>
    speak([{ anim, text: line(lineKey, extra), sign }]);

  // Immer den neuesten Satz zeigen
  useEffect(() => {
    const el = logView.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [log]);

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
    if (comment.opening) opening.current = comment.opening;
    const motif = (SEVERITY[comment.reaction] ?? 0) > 0 ? (motifsFor(comment)[0] ?? null) : null;
    history.current = [
      ...history.current.filter((m) => m.ply !== comment.ply),
      {
        reaction: comment.reaction,
        ply: comment.ply,
        san: comment.san,
        best: comment.best,
        sign: REACTION_SIGN[comment.reaction],
        motif: motif?.id ?? null,
        motifText: motif?.text ?? null,
      },
    ];
    if (comment.reaction === "brilliant") {
      stats.current.brilliants++;
      // Aaron: sein Hund kommt und schaut für den Rest der Partie zu
      if (eggs.aaron && !dog) setDog(true);
      // Ben: Lambrusco, höchstens einmal am Tag (+10 % XP)
      if (eggs.ben && !lambrusco.current && lambruscoDay !== today()) {
        lambrusco.current = true;
        setLambruscoDay(today());
        setCart(true);
        timers.current.push(setTimeout(() => setCart(false), 5600));
        playCoachTone("brilliant");
        speak([
          { anim: "bril", text: line("brilliant"), sign: "!!" },
          { anim: "good", text: line("lambrusco"), sign: null },
        ]);
        marks.current[comment.ply] = "!!";
        return;
      }
    }
    // Theorie und solide Züge: kurzer Kommentar, kein Zeichen, kein Ton
    if (comment.reaction === "book" || comment.reaction === "solid") {
      if (comment.text) {
        speak([{ anim: REACTION_ANIMATION[comment.reaction], text: comment.text, sign: null }]);
        return;
      }
      const extra =
        comment.reaction === "book" && comment.opening
          ? t("Coach.Line.BookName", {
              name: comment.opening,
              interpolation: { escapeValue: false },
            })
          : "";
      deliver(REACTION_ANIMATION[comment.reaction], comment.reaction, null, extra);
      return;
    }
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
        mistake: {
          fen: comment.fen,
          played: comment.san,
          solutions: comment.solutions,
          before: comment.before,
        },
      };
    const sign = REACTION_SIGN[comment.reaction];
    const better =
      comment.best && ["dubious", "mistake", "blunder"].includes(comment.reaction)
        ? t("Coach.Line.Better", { move: comment.best })
        : "";
    playCoachTone(comment.reaction === "missedMate" ? "blunder" : comment.reaction);
    // Claudes Satz, sonst der feste Spruch
    if (comment.text)
      speak([{ anim: REACTION_ANIMATION[comment.reaction], text: comment.text, sign }]);
    else deliver(REACTION_ANIMATION[comment.reaction], comment.reaction, sign, better);
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

  // En passant: JBL macht einen Salto
  useEffect(() => {
    if (gameState !== "playing" || !humanColor) return;
    let prev = root;
    let n = root;
    while (n.children.length > 0) {
      prev = n;
      n = n.children[0];
    }
    if (!n.move || n.halfMoves <= checkedPly.current) return;
    checkedPly.current = n.halfMoves;
    const mover = n.halfMoves % 2 === 1 ? "white" : "black";
    if (mover === humanColor && isEnPassant(prev.fen, makeUci(n.move)))
      speak([{ anim: "salto", text: line("enPassant"), sign: null }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, gameState]);

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
      setLog([]);
      setDog(false);
      setCart(false);
      setBlast(false);
      setPenalty(false);
      lambrusco.current = false;
      checkedPly.current = 0;
      history.current = [];
      opening.current = null;
      setReport(null);
      setReportReady(null);
      setDeep(null);
      const gen = ++speechGen.current;
      const rest: Say[] = [
        ...(attack ? [{ anim: "think" as const, text: line("attack"), sign: null }] : []),
        ...(plan?.announce ?? []).map((key) => ({ anim: null, text: line(key), sign: null })),
        ...(bonusTrack ? [{ anim: "bril" as const, text: line("bonusTrack"), sign: null }] : []),
      ];
      if (boss) speak([{ anim: "think", text: line("bossStart"), sign: null }, ...rest]);
      else
        void eventText("start", line("start")).then((text) => {
          if (gen === speechGen.current) speak([{ anim: "hello", text, sign: null }, ...rest]);
        });
    }
    if (gameState === "gameOver" && humanColor && result && result !== "*") {
      const outcome =
        result === "1/2-1/2"
          ? ("draw" as const)
          : (result === "1-0") === (humanColor === "white")
            ? ("win" as const)
            : ("loss" as const);
      playCoachTone(outcome);
      setDiary((d) => addToDiary(d, diaryGame(root, humanColor, outcome, marks.current, today())));
      if (plan?.index) setDeparture(repertoireDeparture(root, humanColor, plan.index));
      const done = finishGame({
        result: outcome,
        strength,
        takebacks,
        ...stats.current,
        mistake: worst.current?.mistake ?? null,
        lambrusco: lambrusco.current,
        boss,
        isAdmin,
      });
      const egg = finishEggs({
        result: outcome,
        attack,
        brilliants: stats.current.brilliants,
        blunders: stats.current.blunders,
        takebacks,
        missedMate: worst.current?.severity === SEVERITY.missedMate,
        kingMate: humanKingMate(root, humanColor),
        knightPromotion: humanKnightPromotion(root, humanColor),
        repertoireMate: !!plan?.index && repertoireToMate(root, humanColor, plan.index),
      });
      const lock = egg.penalty ? MATE_DRILL_TASKS : done.lock;
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
      for (const key of egg.lines)
        after.push({
          anim:
            key === "aaronMate"
              ? "facepalm"
              : key === "bassBeatsBunny"
                ? "bril"
                : key === "patriciaLoss"
                  ? "dub"
                  : "good",
          text: line(key),
          sign: null,
        });
      for (const title of egg.titles)
        after.push({
          anim: null,
          text: t("Coach.Game.NewTitle", { title: t(`Coach.Title.${title}`) }),
          sign: null,
        });
      for (const frame of egg.frames)
        after.push({
          anim: null,
          text: t("Coach.Game.NewFrame", { frame: t(`Coach.Frame.${frame}`) }),
          sign: null,
        });
      if (egg.bunnyBlast) {
        timers.current.push(setTimeout(() => setBlast(true), 900));
        timers.current.push(setTimeout(() => setBlast(false), 3400));
      }
      if (egg.penalty) timers.current.push(setTimeout(() => setPenalty(true), 1800));
      for (const trophy of [...done.trophies, ...egg.trophies])
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
      if (boss)
        after.unshift({
          anim: outcome === "win" ? "win" : "think",
          text: line(outcome === "win" ? "bossWin" : "bossOther"),
          sign: null,
        });
      if (done.bossNext) after.push({ anim: "think", text: line("bossNext"), sign: null });
      if (done.lines.some((l) => l.key === "tired"))
        after.push({ anim: "think", text: line("tired"), sign: null });
      const gen = ++speechGen.current;
      void eventText(outcome, line(outcome)).then((text) => {
        if (gen !== speechGen.current) return;
        speak([{ anim: outcome === "draw" ? null : outcome, text, sign: null }, ...after]);
      });
      timers.current.push(setTimeout(() => setReceipt({ lines: done.lines, lock }), 2400));
      // Der Partiebericht kommt von selbst, wenn JBL fertig gesprochen hat
      const data: CoachReportData = {
        id: gen,
        outcome,
        opening: opening.current,
        counts: countReactions(history.current.map((m) => m.reaction)),
        moments: reportMoments(history.current),
      };
      setReportReady(data);
      timers.current.push(setTimeout(() => setReport(data), REPORT_DELAY_MS));
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
          {dog && (
            <Box mt={4} ta="center">
              <CoachDog size={64} />
            </Box>
          )}
        </Box>
        {cart && <LambruscoCart />}
        {blast && <BunnyBlast />}
        <Box style={{ flex: 1, minWidth: 0, minHeight: 72 }} aria-live="polite">
          {log.length > 0 ? (
            <ScrollArea.Autosize mah={170} viewportRef={logView} type="auto" offsetScrollbars>
              <Stack gap={6}>
                {log.map((b, i) => {
                  const latest = i === log.length - 1;
                  return (
                    <Paper
                      key={b.key}
                      radius="md"
                      p="xs"
                      bg={latest ? "var(--mantine-color-default-hover)" : "transparent"}
                      withBorder={!latest}
                    >
                      <Text size="sm" c={latest ? undefined : "dimmed"}>
                        {b.sign && (
                          <Text span fw={800} mr={6} c={SIGN_COLOR[b.sign]}>
                            {b.sign}
                          </Text>
                        )}
                        {b.text}
                      </Text>
                    </Paper>
                  );
                })}
              </Stack>
            </ScrollArea.Autosize>
          ) : (
            <Text size="sm" c="dimmed">
              {t("Coach.Game.Watching")}
            </Text>
          )}
          {gameState !== "settingUp" && comment && DEEP_REACTIONS.includes(comment.reaction) ? (
            <Button
              mt="xs"
              size="xs"
              variant="light"
              color="red"
              leftSection={<IconBulb size={14} />}
              onClick={() => setDeep(comment)}
            >
              {t("Coach.Deep.Button", { move: comment.san, sign: REACTION_SIGN[comment.reaction] })}
            </Button>
          ) : (
            gameState !== "settingUp" && <CoachWhy comment={comment} />
          )}
          {gameState === "gameOver" && reportReady && (
            <Button
              mt="xs"
              ml={6}
              size="xs"
              variant="light"
              color="orange"
              leftSection={<IconReport size={14} />}
              onClick={() => setReport(reportReady)}
            >
              {t("Coach.Report.Open")}
            </Button>
          )}
          {penalty && (
            <Box mt="xs">
              <PenaltyTicket
                title={t("Coach.Egg.TicketTitle")}
                text={t("Coach.Egg.TicketText", { count: MATE_DRILL_TASKS })}
              />
            </Box>
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
      <CoachDeepDive comment={deep} onClose={() => setDeep(null)} />
      <CoachReport report={report} onClose={() => setReport(null)} />
    </Paper>
  );
}
