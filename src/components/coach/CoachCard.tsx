import { Box, Button, Card, Progress, Select, Stack, Text, UnstyledButton } from "@mantine/core";
import { useAtom, useAtomValue } from "jotai";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import CoachFigure, { type CoachAnimation, type CoachFigureHandle } from "./CoachFigure";
import {
  COACH_STRENGTHS,
  type CoachStrengthId,
  coachStrengthAtom,
  coachTitleKey,
  coachXpAtom,
  levelProgress,
} from "./coachState";

// Der Coach winkt nur einmal pro Programmstart, nicht bei jedem neuen Tab.
let greeted = false;

export default function CoachCard({ onPlay }: { onPlay: () => void }) {
  const { t } = useTranslation();
  const figure = useRef<CoachFigureHandle>(null);
  const [strength, setStrength] = useAtom(coachStrengthAtom);
  const xp = useAtomValue(coachXpAtom);
  const { level, intoLevel, needed } = levelProgress(xp);
  const [line, setLine] = useState(() => t("Coach.Card.Status.Ready"));

  useEffect(() => {
    if (greeted) return;
    greeted = true;
    const timer = setTimeout(() => figure.current?.play("hello"), 400);
    return () => clearTimeout(timer);
  }, []);

  const poke = () => {
    const moods: [CoachAnimation, string][] = [
      ["hello", t("Coach.Card.Poke.Hello")],
      ["think", t("Coach.Card.Poke.Think")],
      ["good", t("Coach.Card.Poke.Good")],
    ];
    const [anim, text] = moods[Math.floor(Math.random() * moods.length)];
    setLine(text);
    figure.current?.play(anim);
  };

  const strengthData = COACH_STRENGTHS.map((s) => ({
    value: s.id,
    label: `${t(`Coach.Strength.${s.id}`)} · ${t("Coach.Strength.Elo", { elo: s.elo })}${s.id === "veryHard" ? "+" : ""}`,
  }));

  return (
    <Card shadow="sm" p="lg" radius="md" withBorder data-tour="home-coach">
      <Stack align="center" h="100%" justify="space-between" gap="xs">
        <UnstyledButton
          onClick={poke}
          aria-label={t("Coach.Card.Poke.Label")}
          style={{ borderRadius: "var(--mantine-radius-md)", lineHeight: 0 }}
        >
          <CoachFigure ref={figure} size={110} title={t("Coach.Card.Title")} />
        </UnstyledButton>

        <Box style={{ textAlign: "center", width: "100%" }}>
          <Text fw={500}>{t("Coach.Card.Title")}</Text>
          <Text size="xs" c="dimmed">
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
          <Text size="sm" mt={4} aria-live="polite">
            {line}
          </Text>
        </Box>

        <Stack gap={6} w="100%">
          <Select
            size="xs"
            radius="md"
            aria-label={t("Coach.Strength.Label")}
            data={strengthData}
            value={strength}
            allowDeselect={false}
            onChange={(v) => v && setStrength(v as CoachStrengthId)}
            comboboxProps={{ withinPortal: true }}
          />
          <Button variant="filled" color="orange" fullWidth radius="md" onClick={onPlay}>
            {t("Coach.Card.Play")}
          </Button>
        </Stack>
      </Stack>
    </Card>
  );
}
