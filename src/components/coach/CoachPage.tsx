import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Group,
  Progress,
  ScrollArea,
  Select,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from "@mantine/core";
import {
  IconCalendarCheck,
  IconChess,
  IconCircleCheck,
  IconMinus,
  IconPlus,
  IconPuzzle,
  IconTargetArrow,
} from "@tabler/icons-react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { type ReactNode, useRef } from "react";
import { useTranslation } from "react-i18next";
import CoachFigure, { type CoachFigureHandle } from "./CoachFigure";
import { useCan } from "@/components/tutorial/tutorialState";
import {
  adminLevelXp,
  COACH_STRENGTHS,
  type CoachStrengthId,
  coachStrengthAtom,
  coachTitleKey,
  coachXpAtom,
  coachXpOthersAtom,
  levelProgress,
  REPS_PER_DAY,
} from "./coachState";
import CoachLineWizard from "./CoachLineWizard";
import CoachNextStep from "./CoachNextStep";
import { coachMistakeAtom } from "./coachProgress";
import {
  coachBestEstimateAtom,
  coachSpecialTitlesAtom,
  coachFrameAtom,
  coachResultsAtom,
  coachShownTitleAtom,
  DAILY_QUEST_XP,
  estimateStrength,
  frameColor,
  questTarget,
  shownTitle,
} from "./coachRewards";
import CoachShowcase from "./CoachShowcase";
import CoachHints from "./CoachHints";
import CoachLessons from "./CoachLessons";
import CoachDuel, { RivalBar } from "./CoachDuel";
import { CarrotBadge } from "./CoachEggArt";
import { PatriciaEars, PatriciaPopup, usePatriciaPeek } from "./PatriciaPeek";
import { useCoach } from "./useCoach";

const TASK_ICONS: Record<string, ReactNode> = {
  repertoire: <IconTargetArrow size={24} />,
  play: <IconChess size={24} />,
  puzzles: <IconPuzzle size={24} />,
};

// Eine Zeile im Tagesplan: Symbol, Text, Status und ein kleiner Knopf.
function PlanRow({
  icon,
  title,
  desc,
  status,
  button,
}: {
  icon: ReactNode;
  title: string;
  desc: string;
  status: "now" | "done" | "open" | "bonus";
  button: { label: string; onClick: () => void; disabled: boolean } | null;
}) {
  const { t } = useTranslation();
  return (
    <Group
      wrap="nowrap"
      gap="md"
      px="lg"
      py="sm"
      style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}
      opacity={status === "done" ? 0.6 : 1}
    >
      <Box
        c={status === "done" ? "teal" : status === "now" ? "orange" : "dimmed"}
        style={{ lineHeight: 0 }}
      >
        {status === "done" ? <IconCircleCheck size={24} /> : icon}
      </Box>
      <Box style={{ flex: 1, minWidth: 0 }}>
        <Text fw={600} size="sm" td={status === "done" ? "line-through" : undefined}>
          {title}
        </Text>
        <Text size="xs" c="dimmed">
          {desc}
        </Text>
      </Box>
      {status === "now" && (
        <Badge color="orange" variant="light">
          {t("Coach.Page.Now")}
        </Badge>
      )}
      {status === "bonus" && (
        <Badge color="gray" variant="light">
          {t("Coach.Page.Bonus")}
        </Badge>
      )}
      {button && status !== "done" && (
        <Button
          size="compact-sm"
          variant="subtle"
          color="gray"
          disabled={button.disabled}
          onClick={button.onClick}
        >
          {button.label}
        </Button>
      )}
    </Group>
  );
}

export function StrengthSelect() {
  const { t } = useTranslation();
  const [strength, setStrength] = useAtom(coachStrengthAtom);
  return (
    <Select
      size="xs"
      radius="md"
      aria-label={t("Coach.Strength.Label")}
      data={COACH_STRENGTHS.map((s) => ({
        value: s.id,
        label: `${t(`Coach.Strength.${s.id}`)} · ${t("Coach.Strength.Elo", { elo: s.elo })}${s.id === "veryHard" ? "+" : ""}`,
      }))}
      value={strength}
      allowDeselect={false}
      miw={190}
      // Kein markierter Text im Feld, es ist nur eine Auswahl
      styles={{ input: { userSelect: "none", cursor: "pointer" } }}
      onDropdownClose={() => {
        const el = document.activeElement;
        if (el instanceof HTMLInputElement) {
          el.setSelectionRange(0, 0);
          el.blur();
        }
      }}
      onChange={(v) => v && setStrength(v as CoachStrengthId)}
      comboboxProps={{ withinPortal: true }}
    />
  );
}

export function CoachLevel({ size = "sm", streak = 0 }: { size?: "xs" | "sm"; streak?: number }) {
  const { t } = useTranslation();
  const xp = useAtomValue(coachXpAtom);
  const { level, intoLevel, needed } = levelProgress(xp);
  const left = needed - intoLevel;
  // Admins und das Recht coachTest (1.2.35)
  const canTest = useCan("coachTest");
  const setXp = useSetAtom(coachXpAtom);
  const othersXp = useAtomValue(coachXpOthersAtom);
  const setLevel = (target: number) => setXp(adminLevelXp(target, othersXp));
  return (
    <Box w="100%">
      <Group gap={6} wrap="nowrap" justify={size === "xs" ? "center" : "space-between"}>
        <Text size={size} c="dimmed">
          {t("Coach.Card.Level", { level, title: t(`Coach.Title.${coachTitleKey(level)}`) })}
        </Text>
        {/* Nur für Admins und das Recht coachTest: Level zum Testen von Hand setzen */}
        {canTest && (
          <Group gap={2} wrap="nowrap" data-coach-admin-level>
            <ActionIcon
              size="xs"
              variant="light"
              color="orange"
              aria-label={t("Coach.Admin.LevelDown")}
              title={t("Coach.Admin.LevelDown")}
              disabled={level <= 1}
              onClick={(e) => {
                e.stopPropagation();
                setLevel(level - 1);
              }}
            >
              <IconMinus size={12} />
            </ActionIcon>
            <ActionIcon
              size="xs"
              variant="light"
              color="orange"
              aria-label={t("Coach.Admin.LevelUp")}
              title={t("Coach.Admin.LevelUp")}
              onClick={(e) => {
                e.stopPropagation();
                setLevel(level + 1);
              }}
            >
              <IconPlus size={12} />
            </ActionIcon>
          </Group>
        )}
      </Group>
      <Progress
        value={needed ? (intoLevel / needed) * 100 : 0}
        size="sm"
        radius="xl"
        color="orange"
        mt={6}
        aria-label={t("Coach.Card.XpLabel")}
      />
      <Text size="xs" c="dimmed" mt={2}>
        {needed && intoLevel / needed >= 0.8
          ? t("Coach.Card.AlmostThere", { xp: left, level: level + 1 })
          : t("Coach.Card.Xp", { xp: intoLevel, needed })}
      </Text>
      {streak > 0 && (
        <Text size="xs" mt={2} c="orange">
          {t("Coach.Card.Streak", { days: Math.min(streak, 365) })}
        </Text>
      )}
    </Box>
  );
}

export default function CoachPage({ id }: { id: string }) {
  const { t } = useTranslation();
  const figure = useRef<CoachFigureHandle>(null);
  const [bunny, setBunny] = usePatriciaPeek();
  const coach = useCoach(id);
  const { step, tasks, dueCount, actions, lock, streak, quest, reps } = coach;
  const { level } = levelProgress(useAtomValue(coachXpAtom));
  const frame = useAtomValue(coachFrameAtom);
  const title = shownTitle(
    level,
    useAtomValue(coachShownTitleAtom),
    useAtomValue(coachSpecialTitlesAtom),
  );
  const mistake = useAtomValue(coachMistakeAtom);
  const estimate = estimateStrength(useAtomValue(coachResultsAtom));
  const best = useAtomValue(coachBestEstimateAtom);

  return (
    <ScrollArea h="100%" type="auto">
      <Stack gap="lg" p="md" maw={1100} mx="auto">
        <Card withBorder radius="md" px="xl" pt="xl" pb="lg" data-tour="coach-header">
          <Group wrap="wrap" align="flex-start" gap={40}>
            <Stack align="center" gap={6} style={{ flexShrink: 0 }}>
              <Box
                p="sm"
                pos="relative"
                style={{
                  border: `${frame === "standard" ? 2 : 5}px solid ${frameColor(frame)}`,
                  borderRadius: "var(--mantine-radius-lg)",
                }}
              >
                <PatriciaEars stage={bunny} setStage={setBunny} figure={figure} />
                <UnstyledButton
                  onClick={() => figure.current?.play(step === "done" ? "win" : "hello")}
                  aria-label={t("Coach.Card.Poke.Label")}
                  pos="relative"
                  style={{ lineHeight: 0, zIndex: 1 }}
                >
                  <CoachFigure ref={figure} size={140} title={t("Coach.Card.Title")} />
                </UnstyledButton>
                {frame === "carrot" && (
                  <Box pos="absolute" right={-14} bottom={-14} style={{ lineHeight: 0, zIndex: 2 }}>
                    <CarrotBadge />
                  </Box>
                )}
              </Box>
              <PatriciaPopup stage={bunny} />
              <Text size="xs" c="dimmed">
                {t("Coach.Showcase.Frame", { name: t(`Coach.Frame.${frame}`) })}
              </Text>
            </Stack>

            <Stack gap="sm" style={{ flex: "1 1 280px", minWidth: 0 }}>
              <Group gap="sm" align="center">
                <Title order={2}>{t("Coach.Card.Title")}</Title>
                <Badge variant="light" color="orange" size="lg">
                  {t(`Coach.Title.${title}`)}
                </Badge>
              </Group>
              <Text size="lg" aria-live="polite">
                {t(`Coach.Say.${step}`, { count: dueCount })}
              </Text>
              <Box maw={380}>
                <CoachLevel streak={streak} />
                <RivalBar />
                {estimate !== null && (
                  <Text size="xs" c="dimmed" mt={2}>
                    {t("Coach.Page.Estimate", { elo: estimate, best: Math.max(best, estimate) })}
                  </Text>
                )}
              </Box>
            </Stack>
          </Group>
        </Card>

        <CoachNextStep coach={coach} mistake={mistake} />
        <CoachLineWizard tabId={id} />

        <Card withBorder radius="md" p={0}>
          <Group justify="space-between" px="lg" pt="md" pb="xs">
            <Title order={4}>{t("Coach.Page.Today")}</Title>
            <Text size="sm" c="dimmed">
              {t("Coach.Page.DoneCount", {
                done: tasks.filter((task) => task.done).length,
                total: tasks.length,
              })}
            </Text>
          </Group>
          {tasks.map((task, i) => (
            <PlanRow
              key={task.id}
              icon={TASK_ICONS[task.id]}
              title={`${i + 1}. ${t(`Coach.Task.${task.id}.Title`)}`}
              desc={
                task.locked
                  ? t("Coach.Card.Locked", { count: lock })
                  : task.id === "repertoire"
                    ? dueCount === 0
                      ? t("Coach.Task.repertoire.Nothing")
                      : t("Coach.Task.repertoire.Reps", { reps, target: REPS_PER_DAY })
                    : t(`Coach.Task.${task.id}.Desc`, { count: dueCount })
              }
              status={task.id === step ? "now" : task.done ? "done" : "open"}
              button={
                task.id === step
                  ? null
                  : {
                      label: t(`Coach.Task.${task.id}.Button`),
                      onClick: actions[task.id],
                      disabled: (task.id === "repertoire" && dueCount === 0) || !!task.locked,
                    }
              }
            />
          ))}
          <PlanRow
            icon={<IconCalendarCheck size={24} />}
            title={`${t("Coach.Quest.Label")}: ${t(`Coach.Quest.${quest.id}`)}`}
            desc={`${quest.progress} / ${questTarget(quest.id)} · +${DAILY_QUEST_XP} XP`}
            status={step === "quest" ? "now" : quest.done ? "done" : "bonus"}
            button={null}
          />
        </Card>

        <CoachLessons />

        <Stack gap="sm">
          <Title order={3}>{t("Coach.Page.Showcase")}</Title>
          <Card withBorder radius="md" p="lg" data-tour="coach-showcase">
            <CoachShowcase level={level} />
          </Card>
        </Stack>

        <Stack gap="sm">
          <Title order={3}>{t("Coach.Page.More")}</Title>
          <CoachHints level={level} />
          <CoachDuel />
        </Stack>
      </Stack>
    </ScrollArea>
  );
}
