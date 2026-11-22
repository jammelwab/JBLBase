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
  judgeTask,
  LESSON_PATHS,
  LESSONS,
  type Lesson,
  unlockedLessons,
  visibleLessons,
} from "./coachLessonsData";
import { coachXpAtom, levelProgress } from "./coachState";

const arrowShapes = (arrows: [string, string][], brush = "green") =>
  arrows.map(([a, b]) => ({ orig: a as Key, dest: b as Key, brush }));

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

  if (step === -1) {
    const ex = lesson.example;
    const turn = ex.fen.split(" ")[1] === "b" ? "black" : "white";
    return (
      <CoachStage
        figure={figure}
        say={t(`Coach.Lesson.${lesson.id}.Text`)}
        actions={
          <Button color="orange" radius="md" size="md" onClick={() => setStep(0)}>
            {t("Coach.Lessons.Start")}
          </Button>
        }
      >
        <Chessground
          coordinates={false}
          viewOnly
          fen={ex.fen}
          orientation={turn}
          drawable={{ enabled: false, visible: true, autoShapes: arrowShapes(ex.arrows) }}
        />
      </CoachStage>
    );
  }

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
  const [resetKey, setResetKey] = useState(0);
  const arrow = state === "shown" ? sanToSquares(task.fen, task.solutions[0]) : null;
  const figure = useRef<CoachFigureHandle>(null);

  // JBL reagiert auf jeden Versuch
  useEffect(() => {
    if (state === "right") figure.current?.play("good");
    else if (state === "wrong") figure.current?.play("dub");
  }, [state, resetKey]);

  useEffect(() => {
    if (state !== "right") return;
    const timer = setTimeout(onSolved, 900);
    return () => clearTimeout(timer);
  }, [state, onSolved]);

  const play = (orig: string, dest: string) => {
    const verdict = judgeTask(lesson, task, `${orig}${dest}`);
    if (verdict === "right") return setState("right");
    setState((s) => (s === "shown" ? s : "wrong"));
    setResetKey((k) => k + 1);
  };

  const say =
    state === "right"
      ? t("Coach.Lessons.Right")
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
        state === "wrong" && (
          <Button variant="light" color="gray" radius="md" onClick={() => setState("shown")}>
            {t("Coach.Lessons.Show")}
          </Button>
        )
      }
    >
      <Chessground
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
          events: { after: (o, d) => play(o, d) },
        }}
        drawable={{
          enabled: false,
          visible: true,
          autoShapes: arrow ? arrowShapes([arrow]) : [],
        }}
      />
    </CoachStage>
  );
}
