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
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import {
  IconBook,
  IconChess,
  IconPuzzle,
  IconSearch,
  IconTargetArrow,
  IconBrain,
  IconLock,
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
} from "./coachState";
import { useIsAdmin } from "@/components/tutorial/tutorialState";
import { useCoach } from "./useCoach";

// Vitrine: Plätze für Titel, Rahmen, Verzierungen und Trophäen. Freigeschaltet
// wird in einer späteren Etappe, bis dahin sind alle Plätze leer.
const SHOWCASE = [
  { key: "Titles", slots: 3, round: false },
  { key: "Frames", slots: 3, round: false },
  { key: "Gimmicks", slots: 5, round: true },
  { key: "Trophies", slots: 5, round: true },
] as const;

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
  const { next, tasks, dueCount, actions, lock, streak } = useCoach(id);
  const isAdmin = useIsAdmin();
  const { level } = levelProgress(useAtomValue(coachXpAtom));
  const [showSoon, setShowSoon] = useAtom(coachShowSoonAtom);

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
              {/* Rahmen um die Figur: später der ausgerüstete Rahmen (Duell, OberBoss) */}
              <Box
                p="sm"
                style={{
                  border: "2px solid var(--mantine-color-default-border)",
                  borderRadius: "var(--mantine-radius-lg)",
                }}
              >
                <UnstyledButton
                  onClick={() => figure.current?.play(next === "done" ? "win" : "hello")}
                  aria-label={t("Coach.Card.Poke.Label")}
                  style={{ lineHeight: 0 }}
                >
                  <CoachFigure ref={figure} size={180} title={t("Coach.Card.Title")} />
                </UnstyledButton>
              </Box>
              <Text size="xs" c="dimmed">
                {t("Coach.Showcase.FrameDefault")}
              </Text>
            </Stack>

            <Stack gap="sm" style={{ flex: "1 1 280px", minWidth: 0 }}>
              <Group gap="sm" align="center">
                <Title order={2}>{t("Coach.Card.Title")}</Title>
                <Badge variant="light" color="orange" size="lg">
                  {t(`Coach.Title.${coachTitleKey(level)}`)}
                </Badge>
              </Group>
              <Text size="lg" aria-live="polite">
                {lock > 0 ? t("Coach.Say.locked") : t(`Coach.Say.${next}`, { count: dueCount })}
              </Text>
              <Box maw={380}>
                <CoachLevel streak={streak} />
              </Box>
            </Stack>

            <Stack gap="md" style={{ flex: "1 1 300px", minWidth: 0 }} data-tour="coach-showcase">
              {SHOWCASE.map((row) => (
                <Box key={row.key}>
                  <Text size="sm" fw={600} mb={6}>
                    {t(`Coach.Showcase.${row.key}`)}
                  </Text>
                  <Group gap="xs">
                    {Array.from({ length: row.slots }, (_, i) => (
                      <Tooltip key={i} label={t("Coach.Showcase.Locked")}>
                        <Box
                          w={row.round ? 44 : 64}
                          h={44}
                          c="dimmed"
                          style={{
                            display: "grid",
                            placeItems: "center",
                            border: "1px dashed var(--mantine-color-default-border)",
                            borderRadius: row.round ? "50%" : "var(--mantine-radius-md)",
                            opacity: 0.6,
                          }}
                        >
                          <IconLock size={16} />
                        </Box>
                      </Tooltip>
                    ))}
                  </Group>
                </Box>
              ))}
            </Stack>
          </Group>
        </Card>

        <Title order={3}>{t("Coach.Page.Today")}</Title>
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
