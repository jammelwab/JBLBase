import {
  Badge,
  Box,
  Button,
  Card,
  Group,
  Modal,
  SimpleGrid,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from "@mantine/core";
import type { Key } from "@lichess-org/chessground/types";
import { IconCheck, IconLock, IconMedal } from "@tabler/icons-react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Chessground } from "@/chessground/Chessground";
import { boardMoves, sanToSquares } from "@/utils/gamesTree";
import CoachFigure, { type CoachFigureHandle } from "./CoachFigure";
import { coachIntroAtom } from "./coachIntroState";
import { playCoachTone } from "./coachSound";
import {
  coachLessonAnnouncedAtom,
  coachLessonsDoneAtom,
  coachOpenLessonAtom,
  completeLessonAtom,
  judgeTask,
  LESSON_PATHS,
  LESSONS,
  type Lesson,
  unlockedLessons,
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
  const unlocked = unlockedLessons(level, entry);
  const [open, setOpen] = useAtom(coachOpenLessonAtom);
  const [announced, setAnnounced] = useAtom(coachLessonAnnouncedAtom);
  const lesson = LESSONS.find((l) => l.id === open) ?? null;

  return (
    <>
      <Group justify="space-between" align="baseline">
        <Title order={3}>{t("Coach.Lessons.Title")}</Title>
        <Text size="sm" c="dimmed">
          {t("Coach.Lessons.Progress", { done: done.length, total: LESSONS.length })}
        </Text>
      </Group>
      <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} data-tour="coach-lessons">
        {LESSON_PATHS.map((path) => (
          <Card key={path} withBorder radius="md" p="md">
            <Text fw={600} mb={6}>
              {t(`Coach.Lessons.Path.${path}`)}
            </Text>
            <Stack gap={6}>
              {LESSONS.map((l, i) => ({ l, i }))
                .filter(({ l }) => l.path === path)
                .map(({ l, i }) => {
                  const isDone = done.includes(l.id);
                  const locked = i >= unlocked;
                  return (
                    <UnstyledButton
                      key={l.id}
                      disabled={locked}
                      onClick={() => {
                        // Wer eine Lektion öffnet, hat die Meldung gesehen
                        if (announced < unlocked) setAnnounced(unlocked);
                        setOpen(l.id);
                      }}
                      p={8}
                      style={{
                        borderRadius: "var(--mantine-radius-sm)",
                        border: "1px solid var(--mantine-color-default-border)",
                        opacity: locked ? 0.55 : 1,
                        cursor: locked ? "not-allowed" : "pointer",
                      }}
                    >
                      <Group gap={8} wrap="nowrap">
                        {isDone ? (
                          <IconCheck size={18} color="var(--mantine-color-teal-6)" />
                        ) : locked ? (
                          <IconLock size={18} />
                        ) : (
                          <IconMedal size={18} color="var(--mantine-color-orange-6)" />
                        )}
                        <Box style={{ minWidth: 0 }}>
                          <Text size="sm" fw={500}>
                            {t("Coach.Lessons.Number", { n: i + 1 })}{" "}
                            {t(`Coach.Lesson.${l.id}.Title`)}
                          </Text>
                          {locked && (
                            <Text size="xs" c="dimmed">
                              {t("Coach.Lessons.Locked", { level: i - unlocked + level + 1 })}
                            </Text>
                          )}
                        </Box>
                      </Group>
                    </UnstyledButton>
                  );
                })}
            </Stack>
          </Card>
        ))}
      </SimpleGrid>
      <Modal
        opened={lesson !== null}
        onClose={() => setOpen(null)}
        title={lesson ? t(`Coach.Lesson.${lesson.id}.Title`) : ""}
        centered
        size="auto"
      >
        {lesson && <LessonView key={lesson.id} lesson={lesson} onClose={() => setOpen(null)} />}
      </Modal>
    </>
  );
}

const BOARD = 320;

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
      <Stack gap="sm" maw={BOARD + 40} align="center">
        <Group wrap="nowrap" align="flex-start" gap="sm">
          <CoachFigure size={56} title={t("Coach.Card.Title")} />
          <Text size="sm">{t(`Coach.Lesson.${lesson.id}.Text`)}</Text>
        </Group>
        <Box w={BOARD} h={BOARD}>
          <Chessground
            coordinates={false}
            viewOnly
            fen={ex.fen}
            orientation={turn}
            drawable={{ enabled: false, visible: true, autoShapes: arrowShapes(ex.arrows) }}
          />
        </Box>
        <Group>
          <Button color="orange" radius="md" onClick={() => setStep(0)}>
            {t("Coach.Lessons.Start")}
          </Button>
        </Group>
      </Stack>
    );
  }

  if (finished)
    return (
      <Stack gap="sm" align="center" maw={BOARD + 40}>
        <CoachFigure ref={figure} size={110} title={t("Coach.Card.Title")} />
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

  return (
    <Stack gap="sm" align="center" maw={BOARD + 40}>
      <Group gap={6}>
        {lesson.tasks.map((_, i) => (
          <Box
            key={i}
            w={10}
            h={10}
            style={{
              borderRadius: 5,
              background:
                i < index || (i === index && state === "right")
                  ? "var(--mantine-color-teal-6)"
                  : i === index
                    ? "var(--mantine-color-orange-6)"
                    : "var(--mantine-color-gray-4)",
            }}
          />
        ))}
      </Group>
      <Text size="sm" ta="center">
        {t(`Coach.Lessons.Turn.${turn}`)} {t(`Coach.Lessons.Check.${lesson.check}`)}
      </Text>
      <Box w={BOARD} h={BOARD}>
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
      </Box>
      <Text
        size="sm"
        c={state === "right" ? "teal" : state === "wrong" ? "orange" : "dimmed"}
        aria-live="polite"
      >
        {state === "right"
          ? t("Coach.Lessons.Right")
          : state === "wrong"
            ? t("Coach.Lessons.Wrong")
            : state === "shown"
              ? t("Coach.Lessons.Shown")
              : t("Coach.Lessons.Task", { n: index + 1, total: lesson.tasks.length })}
      </Text>
      {state === "wrong" && (
        <Button size="xs" variant="subtle" color="gray" onClick={() => setState("shown")}>
          {t("Coach.Lessons.Show")}
        </Button>
      )}
    </Stack>
  );
}
