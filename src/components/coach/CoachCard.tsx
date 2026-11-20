import { Box, Button, Card, Stack, Text, UnstyledButton } from "@mantine/core";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import CoachFigure, { type CoachFigureHandle } from "./CoachFigure";
import { CoachLevel } from "./CoachPage";
import { useCoach } from "./useCoach";

// Der Coach winkt nur einmal pro Programmstart, nicht bei jedem neuen Tab.
let greeted = false;

// Karte auf dem Startbildschirm: zeigt immer die nächste Coach-Aufgabe.
export default function CoachCard({ id }: { id: string }) {
  const { t } = useTranslation();
  const figure = useRef<CoachFigureHandle>(null);
  const { next, dueCount, actions } = useCoach(id);

  useEffect(() => {
    if (greeted) return;
    greeted = true;
    const timer = setTimeout(() => figure.current?.play("hello"), 400);
    return () => clearTimeout(timer);
  }, []);

  return (
    <Card shadow="sm" p="lg" radius="md" withBorder data-tour="home-coach">
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
          <CoachLevel size="xs" />
          <Text size="xs" c="dimmed" mt={6}>
            {t("Coach.Card.NextLabel")}
          </Text>
          <Text size="sm" fw={500}>
            {next === "done"
              ? t("Coach.Card.AllDone")
              : next === "repertoire"
                ? t("Coach.Task.repertoire.Desc", { count: dueCount })
                : t(`Coach.Task.${next}.Title`)}
          </Text>
        </Box>

        <Stack gap={6} w="100%">
          {next !== "done" && (
            <Button variant="filled" color="orange" fullWidth radius="md" onClick={actions[next]}>
              {t(`Coach.Task.${next}.Button`)}
            </Button>
          )}
          <Button
            variant={next === "done" ? "filled" : "light"}
            color={next === "done" ? "orange" : undefined}
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
