import { Box, Group, Stack, Text, Tooltip, UnstyledButton } from "@mantine/core";
import { IconLock, IconTrophy } from "@tabler/icons-react";
import { useAtom, useAtomValue } from "jotai";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import CoachFigure from "./CoachFigure";
import {
  COACH_FRAMES,
  COACH_ITEMS,
  COACH_TROPHIES,
  coachExtraFramesAtom,
  coachExtraItemsAtom,
  coachExtraTitlesAtom,
  coachFrameAtom,
  coachOutfitAtom,
  coachShownTitleAtom,
  coachTrophiesAtom,
  shownTitle,
  toggleOutfit,
  unlockedFrames,
  unlockedItems,
  unlockedTitles,
} from "./coachRewards";

// Trophäen, deren Bedingung geheim bleibt, bis man sie hat
const SECRET_TROPHIES = new Set(["bossBeaten", "bassBeatsBunny", "bunnyHunter"]);

function Slot({
  round,
  wide,
  active,
  locked,
  color,
  label,
  onClick,
  children,
}: {
  round?: boolean;
  wide?: boolean;
  active?: boolean;
  locked?: boolean;
  color?: string;
  label: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  const box = (
    <Box
      w={round ? 48 : wide ? 112 : 64}
      h={48}
      c={locked ? "dimmed" : undefined}
      style={{
        display: "grid",
        placeItems: "center",
        border: locked
          ? "1px dashed var(--mantine-color-default-border)"
          : `2px solid ${active ? "var(--mantine-color-orange-6)" : (color ?? "var(--mantine-color-default-border)")}`,
        borderRadius: round ? "50%" : "var(--mantine-radius-md)",
        opacity: locked ? 0.6 : 1,
        background: active ? "var(--mantine-color-orange-light)" : undefined,
        overflow: "hidden",
      }}
    >
      {children}
    </Box>
  );
  return (
    <Tooltip label={label} multiline maw={240}>
      {onClick && !locked ? (
        <UnstyledButton onClick={onClick} aria-label={label} aria-pressed={active}>
          {box}
        </UnstyledButton>
      ) : (
        box
      )}
    </Tooltip>
  );
}

// Vitrine auf der Coach-Seite: Titel, Rahmen, Verzierungen und Trophäen.
// Freigeschaltetes lässt sich anklicken und ausrüsten.
export default function CoachShowcase({ level }: { level: number }) {
  const { t } = useTranslation();
  const extraTitles = useAtomValue(coachExtraTitlesAtom);
  const [chosenTitle, setChosenTitle] = useAtom(coachShownTitleAtom);
  const extraFrames = useAtomValue(coachExtraFramesAtom);
  const [frame, setFrame] = useAtom(coachFrameAtom);
  const extraItems = useAtomValue(coachExtraItemsAtom);
  const [outfit, setOutfit] = useAtom(coachOutfitAtom);
  const trophies = useAtomValue(coachTrophiesAtom);

  const titles = unlockedTitles(level, extraTitles);
  const current = shownTitle(level, chosenTitle, extraTitles);
  const frames = unlockedFrames(level, extraFrames);
  const items = unlockedItems(level, extraItems);
  const lockedLabel = (lvl: number | null) =>
    lvl === null ? t("Coach.Showcase.Secret") : t("Coach.Showcase.FromLevel", { level: lvl });

  return (
    <Stack gap="md">
      <Box>
        <Text size="sm" fw={600} mb={6}>
          {t("Coach.Showcase.Titles")}
        </Text>
        <Group gap="xs">
          {titles.map((key) => (
            <Slot
              key={key}
              wide
              active={key === current}
              label={t("Coach.Showcase.ShowTitle")}
              onClick={() => setChosenTitle(key)}
            >
              <Text size="xs" fw={600} ta="center" px={4} lh={1.1}>
                {t(`Coach.Title.${key}`)}
              </Text>
            </Slot>
          ))}
          {titles.length < 3 &&
            Array.from({ length: 3 - titles.length }, (_, i) => (
              <Slot key={`l${i}`} wide locked label={t("Coach.Showcase.Locked")}>
                <IconLock size={16} />
              </Slot>
            ))}
        </Group>
      </Box>

      <Box>
        <Text size="sm" fw={600} mb={6}>
          {t("Coach.Showcase.Frames")}
        </Text>
        <Group gap="xs">
          {COACH_FRAMES.filter((f) => f.level !== null || frames.includes(f.id)).map((f) => {
            const owned = frames.includes(f.id);
            return (
              <Slot
                key={f.id}
                locked={!owned}
                active={owned && frame === f.id}
                color={f.color}
                label={owned ? t(`Coach.Frame.${f.id}`) : lockedLabel(f.level)}
                onClick={() => setFrame(f.id)}
              >
                {owned ? (
                  <Box w={30} h={30} style={{ border: `4px solid ${f.color}`, borderRadius: 6 }} />
                ) : (
                  <IconLock size={16} />
                )}
              </Slot>
            );
          })}
        </Group>
      </Box>

      <Box>
        <Text size="sm" fw={600} mb={6}>
          {t("Coach.Showcase.Gimmicks")}
        </Text>
        <Group gap="xs">
          {COACH_ITEMS.filter((i) => i.level !== null || items.includes(i.id)).map((i) => {
            const owned = items.includes(i.id);
            return (
              <Slot
                key={i.id}
                round
                locked={!owned}
                active={owned && outfit.includes(i.id)}
                label={owned ? t(`Coach.Item.${i.id}`) : lockedLabel(i.level)}
                onClick={() => setOutfit(toggleOutfit(outfit, i.id))}
              >
                {owned ? (
                  <Box style={{ lineHeight: 0 }}>
                    <CoachFigure
                      size={42}
                      headOnly
                      outfit={[i.id]}
                      title={t(`Coach.Item.${i.id}`)}
                    />
                  </Box>
                ) : (
                  <IconLock size={16} />
                )}
              </Slot>
            );
          })}
        </Group>
      </Box>

      <Box>
        <Text size="sm" fw={600} mb={6}>
          {t("Coach.Showcase.Trophies")}
        </Text>
        <Group gap="xs">
          {COACH_TROPHIES.map((id) => {
            const owned = trophies.includes(id);
            const label = owned
              ? `${t(`Coach.Trophy.${id}.Title`)}: ${t(`Coach.Trophy.${id}.Desc`)}`
              : SECRET_TROPHIES.has(id)
                ? t("Coach.Showcase.Secret")
                : t(`Coach.Trophy.${id}.Desc`);
            return (
              <Slot key={id} round locked={!owned} label={label}>
                {owned ? (
                  <IconTrophy size={22} color="var(--mantine-color-orange-6)" />
                ) : (
                  <IconLock size={16} />
                )}
              </Slot>
            );
          })}
        </Group>
      </Box>
    </Stack>
  );
}
