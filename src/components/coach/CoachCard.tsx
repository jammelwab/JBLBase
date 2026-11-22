import { Box, Button, Card, Group, Stack, Text, UnstyledButton } from "@mantine/core";
import { useSetAtom } from "jotai";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import CoachBirthday from "./CoachBirthday";
import CoachFigure, { type CoachFigureHandle } from "./CoachFigure";
import { RivalBar } from "./CoachDuel";
import { CoachLevel } from "./CoachPage";
import { coachIntroAtom, coachIntroOpenAtom } from "./coachIntroState";
import { useCoachStepView } from "./CoachNextStep";
import { useCoach } from "./useCoach";

// Der Coach winkt nur einmal pro Programmstart, nicht bei jedem neuen Tab.
let greeted = false;

// Karte auf dem Startbildschirm: zeigt immer die nächste Coach-Aufgabe.
export default function CoachCard({ id }: { id: string }) {
  const { t } = useTranslation();
  const figure = useRef<CoachFigureHandle>(null);
  const coach = useCoach(id);
  const { step, actions, streak, remindIntro } = coach;
  const view = useCoachStepView(coach);
  const openIntro = useSetAtom(coachIntroOpenAtom);
  const setIntro = useSetAtom(coachIntroAtom);
  const remindDone = () => setIntro((s) => ({ ...s, reminded: true }));

  useEffect(() => {
    if (greeted) return;
    greeted = true;
    const timer = setTimeout(() => figure.current?.play("hello"), 400);
    return () => clearTimeout(timer);
  }, []);

  return (
    <Card shadow="sm" p="lg" radius="md" withBorder data-tour="home-coach">
      <CoachBirthday />
      <Stack align="center" h="100%" justify="space-between" gap="xs">
        <UnstyledButton
          onClick={actions.openCoach}
          aria-label={t("Coach.Card.Open")}
          style={{ borderRadius: "var(--mantine-radius-md)", lineHeight: 0 }}
        >
          <CoachFigure ref={figure} size={110} title={t("Coach.Card.Title")} />
        </UnstyledButton>

        <Box style={{ textAlign: "center", width: "100%" }}>
          <Text fw={500}>{t("Coach.Card.Title")}</Text>
          <CoachLevel size="xs" streak={streak} />
          <RivalBar />
          <Text size="xs" c="dimmed" mt={6}>
            {t("Coach.Card.NextLabel")}
          </Text>
          <Text size="sm" fw={500}>
            {view.title}
          </Text>
          {view.progress && (
            <Text size="xs" c="dimmed">
              {view.progress.value} / {view.progress.target}
            </Text>
          )}
        </Box>

        <Stack gap={6} w="100%">
          {remindIntro && (
            <Group gap={4} justify="center" wrap="nowrap">
              <Text size="xs" c="dimmed">
                {t("Coach.Intro.Reminder")}
              </Text>
              <Button
                size="compact-xs"
                variant="subtle"
                color="orange"
                onClick={() => {
                  remindDone();
                  openIntro(true);
                }}
              >
                {t("Coach.Intro.Start")}
              </Button>
              <Button size="compact-xs" variant="subtle" color="gray" onClick={remindDone}>
                {t("Coach.Intro.NoThanks")}
              </Button>
            </Group>
          )}
          {view.button && view.onClick && (
            <Button variant="filled" color="orange" fullWidth radius="md" onClick={view.onClick}>
              {view.button}
            </Button>
          )}
          <Button
            variant={step === "done" ? "filled" : "light"}
            color={step === "done" ? "orange" : undefined}
            fullWidth
            radius="md"
            onClick={actions.openCoach}
          >
            {t("Coach.Card.Open")}
          </Button>
        </Stack>
      </Stack>
    </Card>
  );
}
