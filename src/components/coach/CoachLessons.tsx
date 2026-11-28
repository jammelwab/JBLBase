import {
  Badge,
  Box,
  Button,
  Card,
  Group,
  Modal,
  Progress,
  SimpleGrid,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from "@mantine/core";
import type { Key } from "@lichess-org/chessground/types";
import { IconCircleCheck, IconLock, IconMedal } from "@tabler/icons-react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Chessground } from "@/chessground/Chessground";
import { boardMoves, sanToSquares } from "@/utils/gamesTree";
import type { Role } from "chessops";
import CoachBoard, { PROMOTION_LETTER } from "./CoachBoard";
import CoachFigure, { type CoachFigureHandle } from "./CoachFigure";
import CoachStage from "./CoachStage";
import { coachIntroAtom } from "./coachIntroState";
import { playCoachTone } from "./coachSound";
import {
  coachLessonAnnouncedAtom,
  coachLessonsDoneAtom,
  coachOpenLessonAtom,
  completeLessonAtom,
  BASE_LESSONS,
  extraLessonLevel,
  exampleLine,
  judgeTask,
  LESSON_PATHS,
  LESSONS,
  type Lesson,
  type LineStep,
  playedSan,
  playLine,
  taskLine,
  unlockedLessons,
  visibleLessons,
} from "./coachLessonsData";
import { coachXpAtom, levelProgress } from "./coachState";

const arrowShapes = (arrows: [string, string][], brush = "green") =>
  arrows.map(([a, b]) => ({ orig: a as Key, dest: b as Key, brush }));

// Spielt eine Zugfolge Schritt für Schritt ab (1.2.33). -1: noch nicht
// gestartet; danach der Index des gezeigten Zugs.
const LINE_MS = 1100;
function useLinePlayer(steps: LineStep[]) {
  const [k, setK] = useState(-1);
  const [started, setStarted] = useState(false);
  const playing = started && k < steps.length - 1;
  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => setK((i) => i + 1), k < 0 ? 300 : LINE_MS);
    return () => clearTimeout(timer);
  }, [playing, k]);
  return {
    k,
    step: k >= 0 ? (steps[k] ?? null) : null,
    playing,
    done: started && !playing,
    start: () => {
      setK(-1);
      setStarted(true);
    },
  };
}

// Der Lernpfad auf der Coach-Seite: vier Pfade, jede Lektion als Kachel.
export default function CoachLessons() {
  const { t } = useTranslation();
  const done = useAtomValue(coachLessonsDoneAtom);
  const { level } = levelProgress(useAtomValue(coachXpAtom));
  const entry = useAtomValue(coachIntroAtom).entry;
  const unlocked = unlockedLessons(level, entry, done);
  // Weitere Reihen erscheinen erst, wenn die Reihe davor geschafft ist
  const visible = visibleLessons(done);
  const total = visible;
  const doneVisible = LESSONS.slice(0, visible).filter((l) => done.includes(l.id)).length;
  const [open, setOpen] = useAtom(coachOpenLessonAtom);
  const [announced, setAnnounced] = useAtom(coachLessonAnnouncedAtom);
  const lesson = LESSONS.find((l) => l.id === open) ?? null;

  // Die erste freie, noch nicht gemachte Lektion: „Weiter mit …“
  const nextIndex = LESSONS.findIndex((l, i) => i < unlocked && !done.includes(l.id));
  const next = nextIndex >= 0 ? LESSONS[nextIndex] : null;
  const start = (id: string) => {
    // Wer eine Lektion öffnet, hat die Meldung gesehen
    if (announced < unlocked) setAnnounced(unlocked);
    setOpen(id);
  };

  return (
    <>
      <Title order={3}>{t("Coach.Lessons.Title")}</Title>
      <Card withBorder radius="md" p={0} data-tour="coach-lessons">
        <Group justify="space-between" gap="md" px="lg" py="md" wrap="wrap">
          <Box style={{ flex: "1 1 240px", minWidth: 0 }}>
            <Text fw={600}>
              {next
                ? t("Coach.Lessons.Continue", {
                    n: nextIndex + 1,
                    name: t(`Coach.Lesson.${next.id}.Title`),
                  })
                : doneVisible >= LESSONS.length
                  ? t("Coach.Lessons.AllDone")
                  : t("Coach.Lessons.WaitLevel")}
            </Text>
            <Progress
              mt={8}
              size="sm"
              radius="xl"
              color="orange"
              value={(doneVisible / total) * 100}
              aria-label={t("Coach.Lessons.Title")}
            />
            <Text size="xs" c="dimmed" mt={2}>
              {t("Coach.Lessons.Progress", { done: doneVisible, total })}
            </Text>
          </Box>
          {next && (
            <Button radius="md" variant="light" color="orange" onClick={() => start(next.id)}>
              {t("Coach.Step.lesson.Button")}
            </Button>
          )}
        </Group>
        {LESSON_PATHS.map((path) => {
          const items = LESSONS.map((l, i) => ({ l, i })).filter(
            ({ l, i }) => l.path === path && i < visible,
          );
          if (items.length === 0) return null;
          const pathDone = items.filter(({ l }) => done.includes(l.id)).length;
          return (
            <Group
              key={path}
              gap="md"
              px="lg"
              py="sm"
              wrap="wrap"
              align="center"
              style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}
            >
              <Box w={160}>
                <Text fw={600} size="sm">
                  {t(`Coach.Lessons.Path.${path}`)}
                </Text>
                <Text size="xs" c="dimmed">
                  {pathDone} / {items.length}
                </Text>
              </Box>
              <SimpleGrid cols={{ base: 1, xs: 3 }} spacing="xs" style={{ flex: "1 1 460px" }}>
                {items.map(({ l, i }) => {
                  const isDone = done.includes(l.id);
                  const locked = i >= unlocked;
                  const isNext = i === nextIndex;
                  return (
                    <UnstyledButton
                      key={l.id}
                      disabled={locked}
                      onClick={() => start(l.id)}
                      px="sm"
                      py={6}
                      mih={52}
                      style={{
                        borderRadius: "var(--mantine-radius-md)",
                        border: `1px solid ${isNext ? "var(--mantine-color-orange-6)" : "var(--mantine-color-default-border)"}`,
                        opacity: locked ? 0.5 : 1,
                        cursor: locked ? "not-allowed" : "pointer",
                      }}
                    >
                      <Group gap={10} wrap="nowrap" h="100%">
                        {isDone ? (
                          <IconCircleCheck size={20} color="var(--mantine-color-teal-6)" />
                        ) : locked ? (
                          <IconLock size={20} />
                        ) : (
                          <IconMedal
                            size={20}
                            color={isNext ? "var(--mantine-color-orange-6)" : undefined}
                          />
                        )}
                        <Box style={{ minWidth: 0 }}>
                          <Text size="sm" fw={500} lineClamp={2} lh={1.3}>
                            {t("Coach.Lessons.Number", { n: i + 1 })}{" "}
                            {t(`Coach.Lesson.${l.id}.Title`)}
                          </Text>
                          {locked && (
                            <Text size="xs" c="dimmed">
                              {i < BASE_LESSONS
                                ? t("Coach.Lessons.Locked", { level: i - unlocked + level + 1 })
                                : level < extraLessonLevel(i)
                                  ? t("Coach.Lessons.Locked", { level: extraLessonLevel(i) })
                                  : t("Coach.Lessons.After", { n: i })}
                            </Text>
                          )}
                        </Box>
                      </Group>
                    </UnstyledButton>
                  );
                })}
              </SimpleGrid>
            </Group>
          );
        })}
      </Card>
      <Modal
        opened={lesson !== null}
        onClose={() => setOpen(null)}
        title={lesson ? t(`Coach.Lesson.${lesson.id}.Title`) : ""}
        centered
        size="auto"
        padding="xl"
        styles={{ title: { fontWeight: 700, fontSize: "var(--mantine-font-size-xl)" } }}
      >
        {lesson && <LessonView key={lesson.id} lesson={lesson} onClose={() => setOpen(null)} />}
      </Modal>
    </>
  );
}

const BOARD = 480;

function LessonView({ lesson, onClose }: { lesson: Lesson; onClose: () => void }) {
  const { t } = useTranslation();
  const complete = useSetAtom(completeLessonAtom);
  const figure = useRef<CoachFigureHandle>(null);
  // -1: Einführung mit Beispiel, 0..2: Aufgaben, 3: fertig
  const [step, setStep] = useState(-1);
  const [xp, setXp] = useState(0);
  const finished = step >= lesson.tasks.length;

  useEffect(() => {
    if (!finished) return;
    const timer = setTimeout(() => figure.current?.play("win"), 200);
    return () => clearTimeout(timer);
  }, [finished]);

  const solved = () => {
    if (step + 1 >= lesson.tasks.length) {
      setXp(complete(lesson.id));
      playCoachTone("lesson");
    }
    setStep(step + 1);
  };

  if (step === -1) return <LessonExample lesson={lesson} onStart={() => setStep(0)} />;

  if (finished)
    return (
      <Stack gap="sm" align="center" justify="center" w={BOARD + 340} mih={BOARD}>
        <CoachFigure ref={figure} size={180} title={t("Coach.Card.Title")} />
        <Text fw={600}>
          {t("Coach.Lessons.Done", { name: t(`Coach.Lesson.${lesson.id}.Title`) })}
        </Text>
        <Badge size="lg" color="orange" variant="light" leftSection={<IconMedal size={16} />}>
          {t(`Coach.Lesson.${lesson.id}.Title`)}
        </Badge>
        <Text size="sm" c="dimmed">
          {xp > 0 ? t("Coach.Lessons.Xp", { xp }) : t("Coach.Lessons.Again")}
        </Text>
        <Button color="orange" radius="md" onClick={onClose}>
          {t("Coach.Lessons.Close")}
        </Button>
      </Stack>
    );

  return <LessonTaskView key={step} lesson={lesson} index={step} onSolved={solved} />;
}

// Einführung: Beispiel mit Pfeilen; „Zeig, wie es weitergeht“ spielt die
// Folge vor (1.2.33)
function LessonExample({ lesson, onStart }: { lesson: Lesson; onStart: () => void }) {
  const { t } = useTranslation();
  const figure = useRef<CoachFigureHandle>(null);
  const ex = lesson.example;
  const turn = ex.fen.split(" ")[1] === "b" ? "black" : "white";
  const steps = useMemo(() => playLine(ex.fen, exampleLine(lesson)), [ex.fen, lesson]);
  const line = useLinePlayer(steps);
  return (
    <CoachStage
      figure={figure}
      say={
        line.step
          ? `${t("Coach.Lessons.LineMove", { n: line.k + 1, total: steps.length })} ${line.step.san}`
          : t(`Coach.Lesson.${lesson.id}.Text`)
      }
      actions={
        <Group gap="xs">
          {steps.length > 0 && (
            <Button
              variant="light"
              color="orange"
              radius="md"
              size="md"
              disabled={line.playing}
              onClick={line.start}
            >
              {line.done ? t("Coach.Lessons.LineAgain") : t("Coach.Lessons.LineShow")}
            </Button>
          )}
          <Button color="orange" radius="md" size="md" onClick={onStart}>
            {t("Coach.Lessons.Start")}
          </Button>
        </Group>
      }
    >
      <Chessground
        coordinates={false}
        viewOnly
        fen={line.step?.fen ?? ex.fen}
        orientation={turn}
        lastMove={line.step ? (line.step.lastMove as Key[]) : undefined}
        drawable={{
          enabled: false,
          visible: true,
          autoShapes: line.step ? [] : arrowShapes(ex.arrows),
        }}
      />
    </CoachStage>
  );
}

function LessonTaskView({
  lesson,
  index,
  onSolved,
}: {
  lesson: Lesson;
  index: number;
  onSolved: () => void;
}) {
  const { t } = useTranslation();
  const task = lesson.tasks[index];
  const { turn, dests } = useMemo(() => boardMoves(task.fen), [task.fen]);
  const [state, setState] = useState<"open" | "wrong" | "right" | "shown">("open");
  // Nach der richtigen Lösung: die Folge, die das Motiv zeigt
  const [line, setLine] = useState<LineStep[]>([]);
  const player = useLinePlayer(line);
  const [resetKey, setResetKey] = useState(0);
  const arrow = state === "shown" ? sanToSquares(task.fen, task.solutions[0]) : null;
  const figure = useRef<CoachFigureHandle>(null);

  // JBL reagiert auf jeden Versuch
  useEffect(() => {
    if (state === "right") figure.current?.play("good");
    else if (state === "wrong") figure.current?.play("dub");
  }, [state, resetKey]);

  // Ohne Folge geht es wie bisher gleich weiter, mit Folge erst nach „Weiter“
  useEffect(() => {
    if (state !== "right" || line.length > 0) return;
    const timer = setTimeout(onSolved, 900);
    return () => clearTimeout(timer);
  }, [state, onSolved, line.length]);

  const play = (orig: string, dest: string, promotion?: Role) => {
    const promo = promotion ? PROMOTION_LETTER[promotion] : "";
    const uci = `${orig}${dest}${promo}`;
    const verdict = judgeTask(lesson, task, uci);
    if (verdict === "right") {
      const san = playedSan(task, uci) ?? "";
      const steps = playLine(task.fen, taskLine(lesson, index, san));
      // Nur zeigen, wenn nach der Lösung wirklich noch etwas kommt
      if (steps.length > 1) {
        setLine(steps);
        player.start();
      }
      return setState("right");
    }
    setState((s) => (s === "shown" ? s : "wrong"));
    setResetKey((k) => k + 1);
  };

  const say =
    state === "right"
      ? line.length > 1
        ? player.done
          ? t("Coach.Lessons.LineDone")
          : t("Coach.Lessons.RightLine")
        : t("Coach.Lessons.Right")
      : state === "wrong"
        ? t("Coach.Lessons.Wrong")
        : state === "shown"
          ? t("Coach.Lessons.Shown")
          : `${t(`Coach.Lessons.Turn.${turn}`)} ${t(`Coach.Lessons.Check.${lesson.check}`)}`;

  return (
    <CoachStage
      figure={figure}
      say={say}
      tone={state === "right" ? "right" : state === "wrong" ? "wrong" : "default"}
      top={
        <Group gap={8} align="center">
          {lesson.tasks.map((_, i) => (
            <Box
              key={i}
              w={12}
              h={12}
              style={{
                borderRadius: 6,
                background:
                  i < index || (i === index && state === "right")
                    ? "var(--mantine-color-teal-6)"
                    : i === index
                      ? "var(--mantine-color-orange-6)"
                      : "var(--mantine-color-gray-4)",
              }}
            />
          ))}
          <Text size="sm" c="dimmed">
            {t("Coach.Lessons.Task", { n: index + 1, total: lesson.tasks.length })}
          </Text>
        </Group>
      }
      actions={
        state === "wrong" ? (
          <Button variant="light" color="gray" radius="md" onClick={() => setState("shown")}>
            {t("Coach.Lessons.Show")}
          </Button>
        ) : state === "right" && line.length > 1 ? (
          <Group gap="xs">
            <Button
              variant="light"
              color="orange"
              radius="md"
              disabled={player.playing}
              onClick={player.start}
            >
              {t("Coach.Lessons.LineAgain")}
            </Button>
            <Button color="orange" radius="md" disabled={player.playing} onClick={onSolved}>
              {t("Coach.Lessons.Next")}
            </Button>
          </Group>
        ) : null
      }
    >
      {line.length > 1 ? (
        <Chessground
          coordinates={false}
          viewOnly
          fen={(player.step ?? line[0]).fen}
          orientation={turn}
          lastMove={(player.step ?? line[0]).lastMove as Key[]}
        />
      ) : (
        <CoachBoard
          key={resetKey}
          coordinates={false}
          viewOnly={state === "right"}
          fen={task.fen}
          orientation={turn}
          turnColor={turn}
          movable={{
            free: false,
            color: state === "right" ? undefined : turn,
            dests: dests as never,
            showDests: true,
          }}
          onMove={(o, d, promo) => play(o, d, promo)}
          drawable={{
            enabled: false,
            visible: true,
            autoShapes: arrow ? arrowShapes([arrow]) : [],
          }}
        />
      )}
    </CoachStage>
  );
}
