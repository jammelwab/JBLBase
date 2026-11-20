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
} from "@tabler/icons-react";
import { useAtom, useAtomValue } from "jotai";
import { type ReactNode, useRef } from "react";
import { useTranslation } from "react-i18next";
import CoachFigure, { type CoachFigureHandle } from "./CoachFigure";
import {
  COACH_STRENGTHS,
  type CoachStrengthId,
  coachStrengthAtom,
  coachTitleKey,
  coachXpAtom,
  levelProgress,
} from "./coachState";
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

export function CoachLevel({ size = "sm" }: { size?: "xs" | "sm" }) {
  const { t } = useTranslation();
  const xp = useAtomValue(coachXpAtom);
  const { level, intoLevel, needed } = levelProgress(xp);
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
        {t("Coach.Card.Xp", { xp: intoLevel, needed })}
      </Text>
    </Box>
  );
}

export default function CoachPage({ id }: { id: string }) {
  const { t } = useTranslation();
  const figure = useRef<CoachFigureHandle>(null);
  const { next, tasks, dueCount, actions } = useCoach(id);

  const soon = [
    { key: "Lessons", icon: <IconBook size={28} /> },
    { key: "Gaps", icon: <IconSearch size={28} /> },
    { key: "Memory", icon: <IconBrain size={28} /> },
  ];

  return (
    <ScrollArea h="100%" type="auto">
      <Stack gap="lg" p="md" maw={1100} mx="auto">
        <Card withBorder radius="md" p="lg" data-tour="coach-header">
          <Group wrap="nowrap" align="center" gap="xl">
            <UnstyledButton
              onClick={() => figure.current?.play(next === "done" ? "win" : "hello")}
              aria-label={t("Coach.Card.Poke.Label")}
              style={{ lineHeight: 0, flexShrink: 0 }}
            >
              <CoachFigure ref={figure} size={160} title={t("Coach.Card.Title")} />
            </UnstyledButton>
            <Stack gap="xs" style={{ flex: 1, minWidth: 0 }}>
              <Title order={2}>{t("Coach.Card.Title")}</Title>
              <Text size="lg" aria-live="polite">
                {t(`Coach.Say.${next}`, { count: dueCount })}
              </Text>
              <Box maw={360}>
                <CoachLevel />
              </Box>
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
                    {task.id === "repertoire" && dueCount === 0
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
                    disabled={task.id === "repertoire" && dueCount === 0}
                    onClick={actions[task.id]}
                  >
                    {t(`Coach.Task.${task.id}.Button`)}
                  </Button>
                </Stack>
              </Stack>
            </Card>
          ))}
        </SimpleGrid>

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
      </Stack>
    </ScrollArea>
  );
}
