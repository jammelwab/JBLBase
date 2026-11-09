import { ActionIcon, Box, Button, Group, Paper, Text } from "@mantine/core";
import { IconX } from "@tabler/icons-react";
import type { DrawBrushes, DrawShape } from "@lichess-org/chessground/draw";
import type { Key } from "@lichess-org/chessground/types";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import useSWR from "swr";
import { Chessground } from "@/chessground/Chessground";
import { playLine, sanToSquares } from "@/utils/gamesTree";
import { hasLichessToken, lichessMoveCounts } from "@/utils/repertoireExplorer";
import { positionKey } from "@/utils/repertoireTree";

const REPERTOIRE_ARROW = "#15781b";
const LICHESS_ARROW = "#1c7ed6";

// The arrows are chessground "brushes"; these two are ours so they don't depend on its defaults
const BRUSHES = {
  repertoire: { key: "r", color: REPERTOIRE_ARROW, opacity: 0.85, lineWidth: 10 },
  lichess: { key: "l", color: LICHESS_ARROW, opacity: 0.75, lineWidth: 7 },
} as unknown as DrawBrushes;

function percent(value: number) {
  return `${Math.round(value * 100)} %`;
}

function Arrow({ color }: { color: string }) {
  return (
    <svg width="18" height="10" viewBox="0 0 18 10" style={{ flexShrink: 0 }}>
      <line x1="1" y1="5" x2="12" y2="5" stroke={color} strokeWidth="3" />
      <path d="M11,1 L17,5 L11,9 z" fill={color} />
    </svg>
  );
}

// A small board in the corner of the tree that shows the move you clicked, with the line
// that leads there. White moves are light chips, black moves dark ones.
export default function BoardPreview({
  rootFen,
  rootHalfMoves,
  line,
  orientation,
  index,
  onOpen,
  onClose,
}: {
  rootFen: string;
  rootHalfMoves: number;
  line: string[];
  orientation: "white" | "black";
  // The repertoire by position, for the green arrows (your moves from this position)
  index: Map<string, string[]>;
  onOpen?: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { fen, lastMove } = useMemo(() => playLine(rootFen, line), [rootFen, line]);
  const repertoireMoves = useMemo(() => index.get(positionKey(fen)) ?? [], [index, fen]);
  const showLichess = hasLichessToken();
  const { data: lichess } = useSWR(showLichess ? ["lichess-moves", fen] : null, () =>
    lichessMoveCounts(fen),
  );
  const lichessTotal = (lichess ?? []).reduce((sum, m) => sum + m.games, 0);
  const lichessTop = (lichess ?? []).reduce<{ san: string; games: number } | null>(
    (best, m) => (!best || m.games > best.games ? m : best),
    null,
  );

  // Blue first, so a green arrow on the same move is drawn on top of it
  const shapes = useMemo(() => {
    const out: DrawShape[] = [];
    const add = (san: string, brush: string) => {
      const squares = sanToSquares(fen, san);
      if (squares) out.push({ orig: squares[0] as Key, dest: squares[1] as Key, brush });
    };
    if (lichessTop) add(lichessTop.san, "lichess");
    for (const san of repertoireMoves) add(san, "repertoire");
    return out;
  }, [fen, lichessTop, repertoireMoves]);

  return (
    <Paper
      withBorder
      shadow="md"
      p="xs"
      pos="absolute"
      right={12}
      bottom={12}
      w={272}
      style={{ zIndex: 2 }}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <Group justify="space-between" mb={6} wrap="nowrap">
        <Text size="xs" fw={600}>
          {t("Repertoire.Preview.Title")}
        </Text>
        <ActionIcon size="sm" variant="subtle" color="gray" onClick={onClose}>
          <IconX size="0.9rem" />
        </ActionIcon>
      </Group>
      <Box w={252} h={252}>
        <Chessground
          coordinates={false}
          viewOnly
          fen={fen}
          orientation={orientation}
          lastMove={lastMove ? (lastMove as Key[]) : undefined}
          drawable={{ enabled: false, visible: true, autoShapes: shapes, brushes: BRUSHES }}
        />
      </Box>
      <Box mt={6}>
        <Group gap={6} wrap="nowrap">
          <Arrow color={REPERTOIRE_ARROW} />
          <Text size="xs">
            {repertoireMoves.length > 0
              ? t("Repertoire.Preview.RepertoireMoves", { moves: repertoireMoves.join(", ") })
              : t("Repertoire.Preview.NoRepertoireMove")}
          </Text>
        </Group>
        {showLichess && (
          <Group gap={6} wrap="nowrap">
            <Arrow color={LICHESS_ARROW} />
            <Text size="xs">
              {lichess === undefined
                ? t("Repertoire.Preview.LichessLoading")
                : lichessTop && lichessTotal > 0
                  ? t("Repertoire.Preview.LichessTop", {
                      move: lichessTop.san,
                      share: percent(lichessTop.games / lichessTotal),
                    })
                  : t("Repertoire.Preview.LichessNone")}
            </Text>
          </Group>
        )}
      </Box>
      <Box mt={6} mah={88} style={{ overflowY: "auto", lineHeight: 1.9 }}>
        {line.map((san, i) => {
          const half = rootHalfMoves + i + 1;
          const white = half % 2 === 1;
          const number = Math.ceil(half / 2);
          return (
            <span key={i} style={{ whiteSpace: "nowrap", marginRight: 4 }}>
              {(white || i === 0) && (
                <Text span size="xs" c="dimmed" mr={2}>
                  {white ? `${number}.` : `${number}…`}
                </Text>
              )}
              <Text
                span
                size="xs"
                fw={600}
                px={5}
                py={1}
                style={{
                  borderRadius: 4,
                  background: white ? "#f8f9fa" : "#1f2023",
                  color: white ? "#1a1b1e" : "#f1f3f5",
                  border: "1px solid var(--mantine-color-default-border)",
                }}
              >
                {san}
              </Text>
            </span>
          );
        })}
        {line.length === 0 && (
          <Text size="xs" c="dimmed">
            {t("Repertoire.Preview.Start")}
          </Text>
        )}
      </Box>
      {onOpen && (
        <Button size="xs" variant="light" fullWidth mt={6} onClick={onOpen}>
          {t("Repertoire.Preview.Open")}
        </Button>
      )}
    </Paper>
  );
}
