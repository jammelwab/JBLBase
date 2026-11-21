import {
  Badge,
  Box,
  Button,
  Card,
  Group,
  Progress,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Title,
  UnstyledButton,
} from "@mantine/core";
import {
  IconBook,
  IconChess,
  IconPuzzle,
  IconSearch,
  IconTargetArrow,
  IconBrain,
  IconCalendarCheck,
} from "@tabler/icons-react";
import { useAtom, useAtomValue } from "jotai";
import { type ReactNode, useRef } from "react";
import { useTranslation } from "react-i18next";
import CoachFigure, { type CoachFigureHandle } from "./CoachFigure";
import {
  COACH_STRENGTHS,
  type CoachStrengthId,
  coachShowSoonAtom,
  coachStrengthAtom,
  coachTitleKey,
  coachXpAtom,
  levelProgress,
  today,
} from "./coachState";
import { useIsAdmin } from "@/components/tutorial/tutorialState";
import CoachMistakeTask from "./CoachMistakeTask";
import { coachMistakeAtom } from "./coachProgress";
import {
  coachBestEstimateAtom,
  coachExtraTitlesAtom,
  coachFrameAtom,
  coachQuestAtom,
  coachResultsAtom,
  coachShownTitleAtom,
  currentQuest,
  DAILY_QUEST_XP,
  estimateStrength,
  frameColor,
  questTarget,
  shownTitle,
} from "./coachRewards";
import CoachShowcase from "./CoachShowcase";
import CoachHints from "./CoachHints";
import { CarrotBadge } from "./CoachEggArt";
import { PatriciaEars, PatriciaPopup, usePatriciaPeek } from "./PatriciaPeek";
import { useCoach } from "./useCoach";

const TASK_ICONS: Record<string, ReactNode> = {
  repertoire: <IconTargetArrow size={36} />,
  play: <IconChess size={36} />,
  puzzles: <IconPuzzle size={36} />,
};

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
  return (
    <Box w="100%">
      <Text size={size} c="dimmed">
        {t("Coach.Card.Level", { level, title: t(`Coach.Title.${coachTitleKey(level)}`) })}
      </Text>
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
  const { next, tasks, dueCount, actions, lock, streak } = useCoach(id);
  const isAdmin = useIsAdmin();
  const { level } = levelProgress(useAtomValue(coachXpAtom));
  const [showSoon, setShowSoon] = useAtom(coachShowSoonAtom);
  const frame = useAtomValue(coachFrameAtom);
  const title = shownTitle(
    level,
    useAtomValue(coachShownTitleAtom),
    useAtomValue(coachExtraTitlesAtom),
  );
  const mistake = useAtomValue(coachMistakeAtom);
  const estimate = estimateStrength(useAtomValue(coachResultsAtom));
  const best = useAtomValue(coachBestEstimateAtom);
  const quest = currentQuest(useAtomValue(coachQuestAtom), today());

  const soon = [
    { key: "Lessons", icon: <IconBook size={28} /> },
    { key: "Gaps", icon: <IconSearch size={28} /> },
    { key: "Memory", icon: <IconBrain size={28} /> },
  ];

  return (
    <ScrollArea h="100%" type="auto">
      <Stack gap="lg" p="md" maw={1100} mx="auto">
        <Card withBorder radius="md" px="xl" pt={36} pb="xl" data-tour="coach-header">
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
                  onClick={() => figure.current?.play(next === "done" ? "win" : "hello")}
                  aria-label={t("Coach.Card.Poke.Label")}
                  pos="relative"
                  style={{ lineHeight: 0, zIndex: 1 }}
                >
                  <CoachFigure ref={figure} size={180} title={t("Coach.Card.Title")} />
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
                {lock > 0 ? t("Coach.Say.locked") : t(`Coach.Say.${next}`, { count: dueCount })}
              </Text>
              <Box maw={380}>
                <CoachLevel streak={streak} />
                {estimate !== null && (
                  <Text size="xs" c="dimmed" mt={2}>
                    {t("Coach.Page.Estimate", { elo: estimate, best: Math.max(best, estimate) })}
                  </Text>
                )}
              </Box>
            </Stack>

            <Box style={{ flex: "1 1 300px", minWidth: 0 }} data-tour="coach-showcase">
              <CoachShowcase level={level} />
            </Box>
          </Group>
        </Card>

        <Title order={3}>{t("Coach.Page.Today")}</Title>
        {lock > 0 && mistake && <CoachMistakeTask mistake={mistake} />}
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          {tasks.map((task) => (
            <Card
              key={task.id}
              withBorder
              radius="md"
              p="lg"
              style={
                task.id === next
                  ? { borderColor: "var(--mantine-color-orange-6)", borderWidth: 2 }
                  : undefined
              }
            >
              <Stack h="100%" justify="space-between" gap="sm">
                <Group justify="space-between" align="flex-start">
                  {TASK_ICONS[task.id]}
                  {task.id === next ? (
                    <Badge color="orange">{t("Coach.Page.Next")}</Badge>
                  ) : task.done ? (
                    <Badge color="teal" variant="light">
                      {t("Coach.Page.Done")}
                    </Badge>
                  ) : null}
                </Group>
                <Box>
                  <Text fw={600}>{t(`Coach.Task.${task.id}.Title`)}</Text>
                  <Text size="sm" c="dimmed">
                    {task.locked
                      ? t("Coach.Card.Locked", { count: lock })
                      : task.id === "repertoire" && dueCount === 0
                        ? t("Coach.Task.repertoire.Nothing")
                        : t(`Coach.Task.${task.id}.Desc`, { count: dueCount })}
                  </Text>
                </Box>
                <Stack gap={6}>
                  {task.id === "play" && <StrengthSelect />}
                  <Button
                    radius="md"
                    variant={task.id === next ? "filled" : "light"}
                    color={task.id === next ? "orange" : undefined}
                    disabled={(task.id === "repertoire" && dueCount === 0) || task.locked}
                    onClick={actions[task.id]}
                  >
                    {t(`Coach.Task.${task.id}.Button`)}
                  </Button>
                </Stack>
              </Stack>
            </Card>
          ))}
        </SimpleGrid>

        <Card withBorder radius="md" p="md">
          <Group wrap="nowrap" align="center" gap="md">
            <IconCalendarCheck size={32} />
            <Box style={{ flex: 1, minWidth: 0 }}>
              <Group justify="space-between" gap="xs">
                <Text fw={600}>
                  {t("Coach.Quest.Label")}: {t(`Coach.Quest.${quest.id}`)}
                </Text>
                {quest.done ? (
                  <Badge color="teal" variant="light">
                    {t("Coach.Page.Done")}
                  </Badge>
                ) : (
                  <Badge color="orange" variant="light">
                    +{DAILY_QUEST_XP} XP
                  </Badge>
                )}
              </Group>
              <Progress
                mt={6}
                size="sm"
                radius="xl"
                color={quest.done ? "teal" : "orange"}
                value={(quest.progress / questTarget(quest.id)) * 100}
                aria-label={t("Coach.Quest.Label")}
              />
              <Text size="xs" c="dimmed" mt={2}>
                {quest.progress} / {questTarget(quest.id)}
              </Text>
            </Box>
          </Group>
        </Card>

        <CoachHints level={level} />

        {isAdmin && (
          <Switch
            label={t("Coach.Page.ShowSoon")}
            checked={showSoon}
            onChange={(e) => setShowSoon(e.currentTarget.checked)}
          />
        )}
        {isAdmin && showSoon && (
          <>
            <Title order={3}>{t("Coach.Page.Soon")}</Title>
            <SimpleGrid cols={{ base: 1, sm: 3 }}>
              {soon.map((s) => (
                <Card key={s.key} withBorder radius="md" p="md" style={{ opacity: 0.7 }}>
                  <Group wrap="nowrap" align="flex-start">
                    <Box c="dimmed">{s.icon}</Box>
                    <Box>
                      <Group gap="xs">
                        <Text fw={600}>{t(`Coach.Soon.${s.key}.Title`)}</Text>
                        <Badge size="xs" variant="light" color="gray">
                          {t("Coach.Page.SoonBadge")}
                        </Badge>
                      </Group>
                      <Text size="sm" c="dimmed">
                        {t(`Coach.Soon.${s.key}.Desc`)}
                      </Text>
                    </Box>
                  </Group>
                </Card>
              ))}
            </SimpleGrid>
          </>
        )}
      </Stack>
    </ScrollArea>
  );
}
