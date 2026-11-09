import { ActionIcon, Box, Button, Group, Paper, Text } from "@mantine/core";
import { IconArrowsDiagonal2, IconX } from "@tabler/icons-react";
import type { DrawBrushes, DrawShape } from "@lichess-org/chessground/draw";
import type { Key } from "@lichess-org/chessground/types";
import { useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { type PointerEvent as ReactPointerEvent, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import useSWR from "swr";
import { Chessground } from "@/chessground/Chessground";
import { playLine, sanToSquares } from "@/utils/gamesTree";
import { hasLichessToken, lichessMoveCounts } from "@/utils/repertoireExplorer";
import { positionKey } from "@/utils/repertoireTree";

const REPERTOIRE_ARROW = "#15781b";
const LICHESS_ARROW = "#1c7ed6";

// The arrows are chessground "brushes"; these are ours so they don't depend on its defaults.
// The repertoire move with the most lines behind it gets the strong arrow, the others a thin one.
const BRUSHES = {
  repertoire: { key: "r", color: REPERTOIRE_ARROW, opacity: 1, lineWidth: 15 },
  repertoireSide: { key: "s", color: REPERTOIRE_ARROW, opacity: 0.5, lineWidth: 6 },
  lichess: { key: "l", color: LICHESS_ARROW, opacity: 0.75, lineWidth: 7 },
} as unknown as DrawBrushes;

const MIN_SIZE = 180;
const MAX_SIZE = 720;
const DEFAULT_SIZE = 252;
// The board size is kept for next time
const previewSizeAtom = atomWithStorage("repertoire-preview-size", DEFAULT_SIZE);

function percent(value: number) {
  return `${Math.round(value * 100)} %`;
}

function Arrow({ color }: { color: string }) {
  return (
    <svg width="18" height="10" viewBox="0 0 18 10" style={{ flexShrink: 0, marginTop: 4 }}>
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
  weights,
  onOpen,
  onClose,
}: {
  rootFen: string;
  rootHalfMoves: number;
  line: string[];
  orientation: "white" | "black";
  // Lines behind each repertoire move, by position (see repertoireWeights), for the green arrows
  weights: Map<string, Map<string, number>>;
  onOpen?: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { fen, lastMove } = useMemo(() => playLine(rootFen, line), [rootFen, line]);
  // Most lines first
  const repertoireMoves = useMemo(
    () =>
      [...(weights.get(positionKey(fen)) ?? new Map<string, number>())]
        .map(([san, lines]) => ({ san, lines }))
        .sort((a, b) => b.lines - a.lines),
    [weights, fen],
  );
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
    // Thin ones first, so the strong arrow is drawn on top
    for (const m of repertoireMoves.slice(1)) add(m.san, "repertoireSide");
    if (repertoireMoves.length > 0) add(repertoireMoves[0].san, "repertoire");
    return out;
  }, [fen, lichessTop, repertoireMoves]);

  const [storedSize, setSize] = useAtom(previewSizeAtom);
  const size = Math.min(Math.max(storedSize, MIN_SIZE), MAX_SIZE);
  const paperRef = useRef<HTMLDivElement>(null);
  // Dragging the top-left corner: the box grows up and to the left, as it sits bottom-right
  const startResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startY = e.clientY;
    const start = size;
    const paper = paperRef.current;
    const parent = paper?.parentElement;
    // What the box needs besides the board, and room so it stays inside the tree
    const extra = paper ? paper.offsetHeight - size : 200;
    const limit = parent
      ? Math.min(parent.clientWidth - 40, parent.clientHeight - extra - 24)
      : MAX_SIZE;
    const move = (ev: PointerEvent) => {
      const delta = Math.max(startX - ev.clientX, startY - ev.clientY);
      const next = Math.round(start + delta);
      setSize(Math.max(MIN_SIZE, Math.min(next, limit, MAX_SIZE)));
    };
    const stop = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
      handle.removeEventListener("pointercancel", stop);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
  };

  return (
    <Paper
      ref={paperRef}
      withBorder
      shadow="md"
      p="xs"
      pos="absolute"
      right={12}
      bottom={12}
      w={size + 20}
      style={{ zIndex: 2 }}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <Group justify="space-between" mb={6} wrap="nowrap">
        <Group gap={6} wrap="nowrap">
          <Box
            title={t("Repertoire.Preview.Resize")}
            onPointerDown={startResize}
            onDoubleClick={() => setSize(DEFAULT_SIZE)}
            style={{
              cursor: "nwse-resize",
              display: "flex",
              color: "var(--mantine-color-dimmed)",
              touchAction: "none",
            }}
          >
            <IconArrowsDiagonal2 size="0.95rem" />
          </Box>
          <Text size="xs" fw={600}>
            {t("Repertoire.Preview.Title")}
          </Text>
        </Group>
        <ActionIcon size="sm" variant="subtle" color="gray" onClick={onClose}>
          <IconX size="0.9rem" />
        </ActionIcon>
      </Group>
      <Box w={size} h={size}>
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
        <Group gap={6} wrap="nowrap" align="flex-start">
          <Arrow color={REPERTOIRE_ARROW} />
          <Text size="xs">
            {repertoireMoves.length > 0
              ? t("Repertoire.Preview.RepertoireMoves", {
                  moves: [
                    ...repertoireMoves
                      .slice(0, 3)
                      .map((m) =>
                        t("Repertoire.Preview.MoveLines", { move: m.san, count: m.lines }),
                      ),
                    ...(repertoireMoves.length > 3
                      ? [t("Repertoire.Preview.More", { more: repertoireMoves.length - 3 })]
                      : []),
                  ].join(", "),
                })
              : t("Repertoire.Preview.NoRepertoireMove")}
          </Text>
        </Group>
        {showLichess && (
          <Group gap={6} wrap="nowrap" align="flex-start">
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
