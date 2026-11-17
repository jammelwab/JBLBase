import { Group, Paper, Text, Tooltip, UnstyledButton } from "@mantine/core";
import { IconBulb } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import useSWR from "swr";
import { hasLichessToken, lichessMoveCounts } from "@/utils/repertoireExplorer";
import type { RepertoireColor } from "@/utils/repertoires";

// From this share on, an opponent move without an answer gets a hint
const MIN_SHARE = 0.05;

function percent(value: number) {
  if (value > 0 && value < 0.01) return "<1 %";
  return `${Math.round(value * 100)} %`;
}

// Help while building a repertoire on the board: in a position of the repertoire, which often
// played opponent moves still have no line, and where the user has no move yet, what is played
// most. A click plays the move, so it can be added right away.
export default function RepertoireBuildHints({
  fen,
  color,
  moves,
  onPlay,
}: {
  fen: string;
  // The repertoire's color
  color: RepertoireColor;
  // The repertoire's moves in this position
  moves: string[];
  onPlay: (san: string) => void;
}) {
  const { t } = useTranslation();
  const enabled = hasLichessToken();
  const { data } = useSWR(enabled ? ["repertoire-build-hints", fen] : null, () =>
    lichessMoveCounts(fen),
  );
  if (!enabled || !data) return null;
  const total = data.reduce((sum, c) => sum + c.games, 0);
  if (total === 0) return null;
  const sideToMove: RepertoireColor = fen.split(" ")[1] === "b" ? "black" : "white";
  const mine = sideToMove === color;

  const sorted = [...data].sort((a, b) => b.games - a.games);
  const list = mine
    ? moves.length > 0
      ? []
      : sorted.slice(0, 3)
    : sorted.filter((c) => c.games / total >= MIN_SHARE && !moves.includes(c.san)).slice(0, 5);
  if (list.length === 0) return null;

  return (
    <Paper withBorder p="sm" bg="var(--mantine-color-yellow-light)">
      <Group gap={6} mb={6} wrap="nowrap">
        <IconBulb size="1rem" style={{ flexShrink: 0 }} />
        <Text size="sm" fw={600}>
          {mine ? t("Repertoire.Hints.NoMove") : t("Repertoire.Hints.Unanswered")}
        </Text>
      </Group>
      <Group gap={4} wrap="wrap">
        {list.map((c) => (
          <Tooltip
            key={c.san}
            label={t("Repertoire.Hints.PlayHint", { move: c.san })}
            openDelay={300}
          >
            <UnstyledButton
              onClick={() => onPlay(c.san)}
              px={8}
              py={2}
              style={{
                borderRadius: 4,
                fontSize: "0.875rem",
                background: mine
                  ? "var(--mantine-color-green-light)"
                  : "var(--mantine-color-orange-light)",
              }}
            >
              <b>{c.san}</b> {percent(c.games / total)}
            </UnstyledButton>
          </Tooltip>
        ))}
      </Group>
      <Text size="xs" c="dimmed" mt={6}>
        {mine ? t("Repertoire.Hints.NoMoveHelp") : t("Repertoire.Hints.UnansweredHelp")}
      </Text>
    </Paper>
  );
}
