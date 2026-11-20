import { Box, Button, Group, Modal, Stack, Text, Title, UnstyledButton } from "@mantine/core";
import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BIRTHDAY_XP,
  birthdayYear,
  coachBirthdayCelebratedAtom,
  pendingBirthdayAtom,
} from "./coachBirthday";
import CoachFigure, { type CoachFigureHandle } from "./CoachFigure";
import { coachProfileAtom } from "./coachProfile";
import { coachExtraItemsAtom } from "./coachRewards";
import { coachXpAtom, today } from "./coachState";

// Torte mit Kerzen; ausgepustet steigen nur noch Rauchfäden auf.
function Cake({ out }: { out: boolean }) {
  return (
    <svg viewBox="0 0 120 110" width={120} height={110} aria-hidden="true">
      <rect
        x="14"
        y="58"
        width="92"
        height="40"
        rx="8"
        fill="#f6d6c2"
        stroke="#111"
        strokeWidth="3"
      />
      <path
        d="M14 70 Q26 80 38 70 Q50 80 62 70 Q74 80 86 70 Q98 80 106 70"
        fill="none"
        stroke="#f58220"
        strokeWidth="5"
      />
      <rect
        x="6"
        y="96"
        width="108"
        height="8"
        rx="4"
        fill="#d9dde3"
        stroke="#111"
        strokeWidth="2"
      />
      {[34, 60, 86].map((x) => (
        <g key={x}>
          <rect
            x={x - 3}
            y="36"
            width="6"
            height="22"
            rx="2"
            fill="#4f86c6"
            stroke="#111"
            strokeWidth="2"
          />
          {out ? (
            <path
              d={`M${x} 32 q-4 -6 0 -12 q4 -6 0 -12`}
              fill="none"
              stroke="#9a9ca6"
              strokeWidth="2"
            />
          ) : (
            <ellipse cx={x} cy="29" rx="5" ry="8" fill="#ffd27a" stroke="#f58220" strokeWidth="2" />
          )}
        </g>
      ))}
    </svg>
  );
}

// Geburtstagsfeier beim ersten Öffnen des Tages: Partyhütchen, Torte,
// Kerzen auspusten, 250 XP und das Partyhütchen zum Behalten.
export default function CoachBirthday() {
  const { t } = useTranslation();
  const pending = useAtomValue(pendingBirthdayAtom);
  const profile = useAtomValue(coachProfileAtom);
  const setCelebrated = useSetAtom(coachBirthdayCelebratedAtom);
  const setXp = useSetAtom(coachXpAtom);
  const xp = useAtomValue(coachXpAtom);
  const setItems = useSetAtom(coachExtraItemsAtom);
  const figure = useRef<CoachFigureHandle>(null);
  const [out, setOut] = useState(false);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => figure.current?.play("hello"), 500);
    return () => clearTimeout(timer);
  }, [pending]);

  if (!pending || !profile.birthday) return null;
  const name = profile.name ?? "";

  const blow = () => {
    if (out) return;
    setOut(true);
    figure.current?.play("win");
    setXp(xp + BIRTHDAY_XP);
    setItems((prev) => (prev.includes("partyHat") ? prev : [...prev, "partyHat"]));
  };

  const close = () => {
    // Erst beim Schließen als gefeiert merken, damit die Feier nicht mitten drin verschwindet
    if (out) setCelebrated(birthdayYear(profile.birthday!, today()));
    setOpen(false);
  };

  return (
    <Modal opened={open} onClose={close} centered withCloseButton={false} radius="lg" size="md">
      <Stack align="center" gap="sm" py="sm">
        <Title order={3} ta="center">
          {pending === "late"
            ? t("Coach.Birthday.Late", { name })
            : t("Coach.Birthday.Title", { name })}
        </Title>
        <Group gap="lg" align="flex-end" wrap="nowrap">
          <CoachFigure
            ref={figure}
            size={150}
            outfit={["partyHat"]}
            title={t("Coach.Card.Title")}
          />
          <UnstyledButton onClick={blow} aria-label={t("Coach.Birthday.Blow")} disabled={out}>
            <Cake out={out} />
          </UnstyledButton>
        </Group>
        <Box ta="center">
          {out ? (
            <Text>{t("Coach.Birthday.Gift", { xp: BIRTHDAY_XP })}</Text>
          ) : (
            <Text c="dimmed">{t("Coach.Birthday.Hint")}</Text>
          )}
        </Box>
        {out ? (
          <Button color="orange" radius="md" onClick={close}>
            {t("Coach.Birthday.Thanks")}
          </Button>
        ) : (
          <Button color="orange" radius="md" onClick={blow}>
            {t("Coach.Birthday.Blow")}
          </Button>
        )}
      </Stack>
    </Modal>
  );
}
