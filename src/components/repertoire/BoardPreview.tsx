import { ActionIcon, Box, Button, Group, Paper, Text } from "@mantine/core";
import { IconArrowBackUp, IconArrowsDiagonal2, IconPlus, IconX } from "@tabler/icons-react";
import type { DrawBrushes, DrawShape } from "@lichess-org/chessground/draw";
import type { Key } from "@lichess-org/chessground/types";
import { useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import useSWR from "swr";
import { Chessground } from "@/chessground/Chessground";
import { boardMoves, playLine, sanToSquares, squaresToSan } from "@/utils/gamesTree";
import { hasLichessToken, lichessMoveCounts } from "@/utils/repertoireExplorer";
import { positionKey } from "@/utils/repertoireTree";
import { formatScore, getWinChance } from "@/utils/score";
import { type PreviewEvalState, PREVIEW_EVAL_DEPTH, usePreviewEval } from "./usePreviewEval";

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
// The eval bar left of the board, and the gap between them
const BAR = 10;
const BAR_GAP = 6;
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

// A thin bar like the big board's: White's share of the winning chances, White at the bottom
// when White is at the bottom of the board.
function SmallEvalBar({
  evaluation,
  orientation,
  height,
}: {
  evaluation: PreviewEvalState;
  orientation: "white" | "black";
  height: number;
}) {
  const value = evaluation.state === "done" ? evaluation.eval.score.value : null;
  const white = !value
    ? 50
    : value.type === "cp"
      ? getWinChance(value.value)
      : value.value > 0
        ? 100
        : 0;
  const whiteBox = (
    <Box
      style={{
        height: `${white}%`,
        background: "var(--mantine-color-gray-1)",
        transition: "height 0.25s ease",
      }}
    />
  );
  const blackBox = (
    <Box
      style={{
        height: `${100 - white}%`,
        background: "var(--mantine-color-dark-5)",
        transition: "height 0.25s ease",
      }}
    />
  );
  return (
    <Box
      w={BAR}
      h={height}
      style={{
        flexShrink: 0,
        borderRadius: 3,
        overflow: "hidden",
        border: "1px solid var(--mantine-color-default-border)",
        display: "flex",
        flexDirection: "column",
        opacity: value ? 1 : 0.45,
      }}
    >
      {orientation === "white" ? [blackBox, whiteBox] : [whiteBox, blackBox]}
    </Box>
  );
}

function EvalLine({ evaluation }: { evaluation: PreviewEvalState }) {
  const { t } = useTranslation();
  let text: string | null = null;
  if (evaluation.state === "done") {
    const { score, engine, depth, stored } = evaluation.eval;
    text = t(stored ? "Repertoire.Preview.EvalStored" : "Repertoire.Preview.EvalCalculated", {
      score: formatScore(score.value),
      engine,
      depth,
    });
  } else if (evaluation.state === "calculating") {
    text = t("Repertoire.Preview.EvalCalculating", {
      engine: evaluation.engine,
      depth: PREVIEW_EVAL_DEPTH,
    });
  } else if (evaluation.state === "none" && evaluation.reason === "noEngine") {
    text = t("Repertoire.Preview.EvalNoEngine");
  }
  if (!text) return null;
  return (
    <Text size="xs" c={evaluation.state === "done" ? undefined : "dimmed"}>
      {text}
    </Text>
  );
}

// Where the line on the small board is, compared with the repertoire: on one of its lines, at a
// position it reaches by another move order, or outside it.
export type LineStatus = "in" | "transposition" | "out";

const STATUS_COLOR: Record<LineStatus, string> = {
  in: "var(--mantine-color-green-6)",
  transposition: "var(--mantine-color-violet-5)",
  out: "var(--mantine-color-orange-6)",
};

// A small board in the corner of the tree that shows the move you clicked, with the line
// that leads there. White moves are light chips, black moves dark ones. With `onMove` you can
// play on it, and the tree follows.
export default function BoardPreview({
  rootFen,
  rootHalfMoves,
  line,
  orientation,
  weights,
  onOpen,
  onClose,
  onMove,
  onBack,
  status,
  onAdd,
  known,
}: {
  rootFen: string;
  rootHalfMoves: number;
  line: string[];
  orientation: "white" | "black";
  // Lines behind each repertoire move, by position (see repertoireWeights), for the green arrows.
  // Without it (a database tree) the repertoire row is left out.
  weights?: Map<string, Map<string, number>>;
  onOpen?: () => void;
  onClose: () => void;
  // A move played on the board, as SAN
  onMove?: (san: string) => void;
  // Takes the last move back
  onBack?: () => void;
  status?: LineStatus;
  // Adds the line to the repertoire, offered when it leaves it
  onAdd?: () => void;
  // How many moves of `line` are on a repertoire line; the rest get an orange frame
  known?: number;
}) {
  const { t } = useTranslation();
  const { fen, lastMove } = useMemo(() => playLine(rootFen, line), [rootFen, line]);
  const { turn, dests } = useMemo(() => boardMoves(fen), [fen]);
  const evaluation = usePreviewEval(fen);
  // The newest move stays in sight when the line gets long
  const movesRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    movesRef.current?.scrollTo({ top: movesRef.current.scrollHeight });
  }, [line]);
  // Most lines first
  const repertoireMoves = useMemo(
    () =>
      [...(weights?.get(positionKey(fen)) ?? new Map<string, number>())]
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
      ? Math.min(parent.clientWidth - 40 - BAR - BAR_GAP, parent.clientHeight - extra - 24)
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
      w={size + 20 + BAR + BAR_GAP}
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
        <Group gap={2} wrap="nowrap">
          {onBack && line.length > 0 && (
            <ActionIcon
              size="sm"
              variant="subtle"
              color="gray"
              title={t("Repertoire.Preview.Back")}
              onClick={onBack}
            >
              <IconArrowBackUp size="0.9rem" />
            </ActionIcon>
          )}
          <ActionIcon size="sm" variant="subtle" color="gray" onClick={onClose}>
            <IconX size="0.9rem" />
          </ActionIcon>
        </Group>
      </Group>
      <Group gap={BAR_GAP} wrap="nowrap" align="flex-start">
        <SmallEvalBar evaluation={evaluation} orientation={orientation} height={size} />
        <Box w={size} h={size} title={onMove ? t("Repertoire.Preview.PlayHint") : undefined}>
          <Chessground
            coordinates={false}
            viewOnly={!onMove}
            turnColor={turn}
            movable={{
              free: false,
              color: onMove ? turn : undefined,
              dests: dests as never,
              showDests: true,
              events: {
                after: (orig, dest) => {
                  const san = squaresToSan(fen, orig, dest);
                  if (san) onMove?.(san);
                },
              },
            }}
            fen={fen}
            orientation={orientation}
            lastMove={lastMove ? (lastMove as Key[]) : undefined}
            drawable={{ enabled: false, visible: true, autoShapes: shapes, brushes: BRUSHES }}
          />
        </Box>
      </Group>
      {status && (
        <Box mt={6}>
          <Group gap={6} wrap="nowrap">
            <Box
              w={8}
              h={8}
              style={{ borderRadius: 4, background: STATUS_COLOR[status], flexShrink: 0 }}
            />
            <Text size="xs" fw={600} c={STATUS_COLOR[status]}>
              {status === "in"
                ? t("Repertoire.Preview.InRepertoire")
                : status === "transposition"
                  ? t("Repertoire.Preview.Transposition")
                  : t("Repertoire.Preview.OutOfRepertoire")}
            </Text>
          </Group>
          {status === "out" && onAdd && (
            <Button
              size="compact-xs"
              variant="light"
              color="orange"
              fullWidth
              mt={4}
              leftSection={<IconPlus size="0.8rem" />}
              onClick={onAdd}
            >
              {t("Repertoire.Preview.AddLine")}
            </Button>
          )}
        </Box>
      )}
      <Box mt={6}>
        <EvalLine evaluation={evaluation} />
        {weights && (
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
        )}
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
      <Box
        ref={movesRef}
        mt={6}
        mah={88}
        style={{
          overflowY: "auto",
          lineHeight: 1.9,
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          rowGap: 2,
        }}
      >
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
                  border:
                    known !== undefined && i >= known
                      ? "1px dashed var(--mantine-color-orange-6)"
                      : "1px solid var(--mantine-color-default-border)",
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
