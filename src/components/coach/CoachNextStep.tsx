import { Badge, Box, Button, Card, Group, Progress, Stack, Text, Title } from "@mantine/core";
import {
  IconArrowRight,
  IconBook2,
  IconCalendarCheck,
  IconChess,
  IconConfetti,
  IconCrown,
  IconLock,
  IconPuzzle,
  IconTargetArrow,
} from "@tabler/icons-react";
import { useSetAtom } from "jotai";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { StrengthSelect } from "./CoachPage";
import CoachMistakeTask from "./CoachMistakeTask";
import { coachLessonAnnouncedAtom, coachOpenLessonAtom } from "./coachLessonsData";
import type { CoachMistake } from "./coachProgress";
import { DAILY_QUEST_XP, questTarget } from "./coachRewards";
import { type CoachStepId, REPS_PER_DAY } from "./coachState";
import type { useCoach } from "./useCoach";

type Coach = ReturnType<typeof useCoach>;

const ICONS: Record<CoachStepId, ReactNode> = {
  mistake: <IconTargetArrow size={40} />,
  locked: <IconLock size={40} />,
  lesson: <IconBook2 size={40} />,
  boss: <IconCrown size={40} />,
  repertoire: <IconTargetArrow size={40} />,
  play: <IconChess size={40} />,
  puzzles: <IconPuzzle size={40} />,
  quest: <IconCalendarCheck size={40} />,
  done: <IconConfetti size={40} />,
};

export type CoachStepView = {
  title: string;
  desc: string;
  button: string | null;
  onClick: (() => void) | null;
  // Fortschritt, wenn der Schritt aus mehreren Teilen besteht
  progress: { value: number; target: number } | null;
};

// Texte und Knopf für den nächsten Schritt; Startkarte und Coach-Seite teilen sie.
export function useCoachStepView(coach: Coach): CoachStepView {
  const { t } = useTranslation();
  const setAnnounced = useSetAtom(coachLessonAnnouncedAtom);
  const openLesson = useSetAtom(coachOpenLessonAtom);
  const { step, actions, lock, lesson, unlocked, reps, dueCount, quest } = coach;

  switch (step) {
    case "mistake":
      return {
        title: t("Coach.Step.mistake.Title"),
        desc: t("Coach.Step.mistake.Desc"),
        button: t("Coach.Step.mistake.Button"),
        onClick: actions.openCoach,
        progress: null,
      };
    case "locked":
      return {
        title: t("Coach.Step.locked.Title"),
        desc: t("Coach.Step.locked.Desc", { count: lock }),
        button: t("Coach.Task.puzzles.Button"),
        onClick: actions.puzzles,
        progress: null,
      };
    case "lesson":
      return {
        title: t("Coach.Lessons.New", { name: lesson ? t(`Coach.Lesson.${lesson.id}.Title`) : "" }),
        desc: t("Coach.Step.lesson.Desc"),
        button: t("Coach.Step.lesson.Button"),
        onClick: () => {
          if (!lesson) return;
          setAnnounced(unlocked);
          openLesson(lesson.id);
          actions.openCoach();
        },
        progress: null,
      };
    case "boss":
      return {
        title: t("Coach.Step.boss.Title"),
        desc: t("Coach.Boss.Card"),
        button: t("Coach.Task.play.Button"),
        onClick: actions.play,
        progress: null,
      };
    case "repertoire": {
      const left = Math.max(1, Math.min(REPS_PER_DAY - reps, dueCount));
      return {
        title: t("Coach.Task.repertoire.Title"),
        desc: t("Coach.Step.repertoire.Desc", { count: left }),
        button: t("Coach.Step.repertoire.Button"),
        onClick: actions.repertoire,
        progress: { value: reps, target: REPS_PER_DAY },
      };
    }
    case "play":
      return {
        title: t("Coach.Task.play.Title"),
        desc: t("Coach.Step.play.Desc"),
        button: t("Coach.Task.play.Button"),
        onClick: actions.play,
        progress: null,
      };
    case "puzzles":
      return {
        title: t("Coach.Task.puzzles.Title"),
        desc: t("Coach.Step.puzzles.Desc"),
        button: t("Coach.Task.puzzles.Button"),
        onClick: actions.puzzles,
        progress: null,
      };
    case "quest": {
      const repertoireQuest = quest.id === "repertoire";
      return {
        title: t("Coach.Step.quest.Title", { xp: DAILY_QUEST_XP }),
        desc: t(`Coach.Quest.${quest.id}`),
        button: repertoireQuest
          ? dueCount > 0
            ? t("Coach.Step.repertoire.Button")
            : null
          : quest.id === "puzzles"
            ? t("Coach.Task.puzzles.Button")
            : t("Coach.Task.play.Button"),
        onClick: repertoireQuest
          ? dueCount > 0
            ? actions.repertoire
            : null
          : quest.id === "puzzles"
            ? actions.puzzles
            : actions.play,
        progress: { value: quest.progress, target: questTarget(quest.id) },
      };
    }
    case "done":
      return {
        title: t("Coach.Card.AllDone"),
        desc: t("Coach.Step.done.Desc"),
        button: null,
        onClick: null,
        progress: null,
      };
  }
}

// Die große Karte oben auf der Coach-Seite: genau ein nächster Schritt.
export default function CoachNextStep({
  coach,
  mistake,
}: {
  coach: Coach;
  mistake: CoachMistake | null;
}) {
  const { t } = useTranslation();
  const view = useCoachStepView(coach);
  const { step, tasks } = coach;
  const taskIndex = tasks.findIndex((task) => task.id === step);

  return (
    <Card
      withBorder
      radius="md"
      p="xl"
      data-tour="coach-next"
      style={{
        borderColor: `var(--mantine-color-${step === "done" ? "teal" : "orange"}-6)`,
        borderWidth: 2,
      }}
    >
      <Stack gap="md">
        <Group gap="xs">
          <Badge color={step === "done" ? "teal" : "orange"} size="lg">
            {step === "done" ? t("Coach.Page.Done") : t("Coach.Page.Next")}
          </Badge>
          {taskIndex >= 0 && (
            <Text size="sm" c="dimmed">
              {t("Coach.Step.Of", { n: taskIndex + 1, total: tasks.length })}
            </Text>
          )}
        </Group>

        {step === "mistake" && mistake ? (
          <CoachMistakeTask mistake={mistake} />
        ) : (
          <Group wrap="wrap" align="center" gap="lg">
            <Box c={step === "done" ? "teal" : "orange"} style={{ flexShrink: 0 }}>
              {ICONS[step]}
            </Box>
            <Stack gap={4} style={{ flex: "1 1 260px", minWidth: 0 }}>
              <Title order={3}>{view.title}</Title>
              <Text c="dimmed">{view.desc}</Text>
              {view.progress && (
                <Box maw={360} mt={4}>
                  <Progress
                    size="md"
                    radius="xl"
                    color="orange"
                    value={(view.progress.value / view.progress.target) * 100}
                    aria-label={view.title}
                  />
                  <Text size="xs" c="dimmed" mt={2}>
                    {view.progress.value} / {view.progress.target}
                  </Text>
                </Box>
              )}
            </Stack>
            {view.button && view.onClick && (
              <Stack gap={6} style={{ flexShrink: 0 }} w={220}>
                {step === "play" && <StrengthSelect />}
                <Button
                  size="md"
                  radius="md"
                  color="orange"
                  rightSection={<IconArrowRight size={18} />}
                  onClick={view.onClick}
                >
                  {view.button}
                </Button>
              </Stack>
            )}
          </Group>
        )}
      </Stack>
    </Card>
  );
}
