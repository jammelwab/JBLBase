import { Box, Button, Card, Group, Stack, Text, UnstyledButton } from "@mantine/core";
import { useSetAtom } from "jotai";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import CoachBirthday from "./CoachBirthday";
import CoachFigure, { type CoachFigureHandle } from "./CoachFigure";
import { RivalBar } from "./CoachDuel";
import { CoachLevel } from "./CoachPage";
import { coachIntroAtom, coachIntroOpenAtom } from "./coachIntroState";
import { coachLessonAnnouncedAtom, coachOpenLessonAtom } from "./coachLessonsData";
import { useCoach } from "./useCoach";

// Der Coach winkt nur einmal pro Programmstart, nicht bei jedem neuen Tab.
let greeted = false;

// Karte auf dem Startbildschirm: zeigt immer die nächste Coach-Aufgabe.
export default function CoachCard({ id }: { id: string }) {
  const { t } = useTranslation();
  const figure = useRef<CoachFigureHandle>(null);
  const { next, dueCount, actions, lock, streak, boss, lesson, unlocked, remindIntro } =
    useCoach(id);
  const setAnnounced = useSetAtom(coachLessonAnnouncedAtom);
  const openLesson = useSetAtom(coachOpenLessonAtom);
  const openIntro = useSetAtom(coachIntroOpenAtom);
  const setIntro = useSetAtom(coachIntroAtom);
  const showLesson = lock === 0 && lesson !== null;
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
            {lock > 0
              ? t("Coach.Card.Locked", { count: lock })
              : showLesson
                ? t("Coach.Lessons.New", { name: t(`Coach.Lesson.${lesson.id}.Title`) })
                : boss
                  ? t("Coach.Boss.Card")
                  : next === "done"
                    ? t("Coach.Card.AllDone")
                    : next === "repertoire"
                      ? t("Coach.Task.repertoire.Desc", { count: dueCount })
                      : t(`Coach.Task.${next}.Title`)}
          </Text>
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
          {showLesson ? (
            <Button
              variant="filled"
              color="orange"
              fullWidth
              radius="md"
              onClick={() => {
                setAnnounced(unlocked);
                openLesson(lesson.id);
                actions.openCoach();
              }}
            >
              {t("Coach.Lessons.Open")}
            </Button>
          ) : (
            next !== "done" && (
              <Button variant="filled" color="orange" fullWidth radius="md" onClick={actions[next]}>
                {t(`Coach.Task.${next}.Button`)}
              </Button>
            )
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
