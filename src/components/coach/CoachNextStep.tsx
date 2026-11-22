import { Badge, Box, Button, Card, Group, Progress, Stack, Text, Title } from "@mantine/core";
import {
  IconArrowRight,
  IconBook2,
  IconCalendarCheck,
  IconChess,
  IconConfetti,
  IconCrown,
  IconLock,
  IconBolt,
  IconPuzzle,
  IconRoute,
  IconTargetArrow,
} from "@tabler/icons-react";
import { useSetAtom } from "jotai";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { StrengthSelect } from "./CoachPage";
import CoachMistakeTask from "./CoachMistakeTask";
import { coachLessonAnnouncedAtom, coachOpenLessonAtom } from "./coachLessonsData";
import {
  PATH_STEP_XP,
  type PathStep,
  type PathStepId,
  pathStep,
  skipPathStepAtom,
} from "./coachPath";
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
  path: <IconRoute size={40} />,
  done: <IconConfetti size={40} />,
};

const PATH_ICONS: Record<PathStepId, ReactNode> = {
  puzzles: <IconPuzzle size={28} />,
  play: <IconChess size={28} />,
  tactic: <IconBolt size={28} />,
  addLine: <IconBook2 size={28} />,
};

// Ein Schritt des weiteren Pfads: Text und Knopf
function usePathStepView(coach: Coach) {
  const { t } = useTranslation();
  const { actions } = coach;
  return (
    step: PathStep,
  ): { title: string; desc: string; button: string | null; onClick: (() => void) | null } => {
    switch (step.id) {
      case "puzzles":
        return {
          title: t("Coach.Path.Step.puzzles", { count: step.target }),
          desc: t("Coach.Path.Desc.puzzles"),
          button: t("Coach.Task.puzzles.Button"),
          onClick: actions.puzzles,
        };
      case "play":
        return {
          title: t("Coach.Path.Step.play"),
          desc: t("Coach.Path.Desc.play"),
          button: t("Coach.Task.play.Button"),
          onClick: actions.play,
        };
      case "tactic": {
        const theme = step.theme ?? "fork";
        return {
          title: t("Coach.Path.Step.tactic", {
            count: step.target,
            theme: t(`Coach.Path.Theme.${theme}`),
          }),
          desc: t("Coach.Path.Desc.tactic"),
          button: t("Coach.Task.puzzles.Button"),
          onClick: () => actions.tactic(theme),
        };
      }
      case "addLine":
        return {
          title: t("Coach.Path.Step.addLine"),
          desc: t("Coach.Path.Desc.addLine"),
          button: t("Coach.NewLine.Open"),
          onClick: actions.addLine,
        };
    }
  };
}

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
  const { step, actions, lock, lesson, unlocked, reps, dueCount, quest, path } = coach;
  const pathView = usePathStepView(coach);

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
    case "path": {
      const current = pathStep(path.index);
      const view = pathView(current);
      return {
        ...view,
        progress: current.target > 1 ? { value: path.progress, target: current.target } : null,
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
            {step === "done"
              ? t("Coach.Page.Done")
              : step === "path"
                ? t("Coach.Path.Badge")
                : t("Coach.Page.Next")}
          </Badge>
          {step === "path" && (
            <Text size="sm" c="dimmed">
              {t("Coach.Path.Intro", { xp: PATH_STEP_XP })}
            </Text>
          )}
          {taskIndex >= 0 && (
            <Text size="sm" c="dimmed">
              {t("Coach.Step.Of", { n: taskIndex + 1, total: tasks.length })}
            </Text>
          )}
        </Group>

        {step === "mistake" && mistake ? (
          <CoachMistakeTask mistake={mistake} />
        ) : step === "path" ? (
          <CoachPathSteps coach={coach} />
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
              <Stack gap={6} style={{ flexShrink: 0 }} miw={220}>
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
        <FreePlay coach={coach} mainOnClick={view.onClick} />
      </Stack>
    </Card>
  );
}

// Ist der große Knopf schon „Gegen JBL spielen“?
export function mainIsPlay(coach: Coach, mainOnClick: (() => void) | null | undefined) {
  return (
    coach.step === "play" ||
    mainOnClick === coach.actions.play ||
    (coach.step === "path" && pathStep(coach.path.index).id === "play")
  );
}

// Gegen JBL spielen geht immer, außer nach einer Niederlage (Sperre)
function FreePlay({
  coach,
  mainOnClick,
}: {
  coach: Coach;
  mainOnClick: (() => void) | null | undefined;
}) {
  const { t } = useTranslation();
  if (coach.step === "mistake" || coach.step === "locked" || mainIsPlay(coach, mainOnClick))
    return null;
  const locked = coach.lock > 0;
  return (
    <Group
      gap="sm"
      wrap="wrap"
      pt="sm"
      style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}
    >
      <Text size="sm" c="dimmed" style={{ flex: "1 1 220px" }}>
        {locked ? t("Coach.FreePlay.Locked", { count: coach.lock }) : t("Coach.FreePlay.Desc")}
      </Text>
      {!locked && (
        <Group gap={6} wrap="nowrap">
          <StrengthSelect />
          <Button
            variant="light"
            color="orange"
            radius="md"
            leftSection={<IconChess size={18} />}
            onClick={coach.actions.play}
          >
            {t("Coach.Task.play.Button")}
          </Button>
        </Group>
      )}
    </Group>
  );
}

// Der weitere Pfad: der aktuelle Schritt groß, der nächste klein darunter
function CoachPathSteps({ coach }: { coach: Coach }) {
  const { t } = useTranslation();
  const view = usePathStepView(coach);
  const skip = useSetAtom(skipPathStepAtom);
  const { path } = coach;
  const current = pathStep(path.index);
  const next = pathStep(path.index + 1);
  const now = view(current);
  const then = view(next);
  return (
    <Stack gap="sm">
      <Group wrap="wrap" align="center" gap="lg">
        <Box c="orange" style={{ flexShrink: 0 }}>
          {PATH_ICONS[current.id]}
        </Box>
        <Stack gap={4} style={{ flex: "1 1 260px", minWidth: 0 }}>
          <Title order={3}>{now.title}</Title>
          <Text c="dimmed">{now.desc}</Text>
          {current.target > 1 && (
            <Box maw={360} mt={4}>
              <Progress
                size="md"
                radius="xl"
                color="orange"
                value={(path.progress / current.target) * 100}
                aria-label={now.title}
              />
              <Text size="xs" c="dimmed" mt={2}>
                {path.progress} / {current.target}
              </Text>
            </Box>
          )}
        </Stack>
        <Stack gap={6} style={{ flexShrink: 0 }} miw={220}>
          {current.id === "play" && <StrengthSelect />}
          {now.button && now.onClick && (
            <Button
              size="md"
              radius="md"
              color="orange"
              rightSection={<IconArrowRight size={18} />}
              onClick={now.onClick}
            >
              {now.button}
            </Button>
          )}
          <Button size="xs" variant="subtle" color="gray" onClick={skip}>
            {t("Coach.Path.Skip")}
          </Button>
        </Stack>
      </Group>
      <Group
        wrap="nowrap"
        gap="sm"
        p="sm"
        style={{
          borderRadius: "var(--mantine-radius-md)",
          border: "1px dashed var(--mantine-color-default-border)",
          opacity: 0.75,
        }}
      >
        <Box c="dimmed" style={{ flexShrink: 0 }}>
          {PATH_ICONS[next.id]}
        </Box>
        <Box style={{ minWidth: 0 }}>
          <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
            {t("Coach.Path.Then")}
          </Text>
          <Text size="sm" fw={500}>
            {then.title}
          </Text>
        </Box>
      </Group>
    </Stack>
  );
}
