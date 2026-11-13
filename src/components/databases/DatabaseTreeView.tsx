import { ActionIcon, Box, Group, Loader, NumberInput, Stack, Text, Tooltip } from "@mantine/core";
import { IconSwitchVertical } from "@tabler/icons-react";
import { INITIAL_FEN } from "chessops/fen";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import BoardPreview from "@/components/repertoire/BoardPreview";
import TreeDiagram, { type DiagramNode, expandLine } from "@/components/repertoire/TreeDiagram";
import { useOpenLine } from "@/components/repertoire/useOpenLine";
import { usePositionData } from "@/components/repertoire/usePositionData";
import { type DatabaseMove, DEFAULT_MIN_SHARE, frequentMoves } from "@/utils/databaseTree";
import { type SuccessDatabaseInfo, searchPosition } from "@/utils/db";
import type { MoveStat } from "@/utils/gamesTree";

const SHARE_COLOR = "var(--mantine-color-blue-5)";

function percent(value: number) {
  return `${Math.round(value * 100)} %`;
}

// Short enough for the box of a move: 5200, 52k, 1,2 Mio
function shortCount(games: number, locale: string) {
  if (games < 10000) return String(games);
  return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 })
    .format(games)
    .replace(/\.$/, "");
}

function moveLabel(move: DatabaseMove) {
  const number = Math.ceil(move.halfMoves / 2);
  return move.halfMoves % 2 === 1 ? `${number}. ${move.san}` : `${number}… ${move.san}`;
}

// A database as a drawn opening tree. Positions are counted as they are opened, and only moves
// with a real share of the games (15 % by default) are shown, so a database with a million
// games does not turn into a giant tree.
export default function DatabaseTreeView({ database }: { database: SuccessDatabaseInfo }) {
  const { t, i18n } = useTranslation();
  const [minPercent, setMinPercent] = useState(DEFAULT_MIN_SHARE * 100);
  const minShare = minPercent / 100;
  const [expanded, setExpanded] = useState(() => new Set<string>());
  const [selected, setSelected] = useState<{ id: string; line: string[] } | null>(null);
  const [focus, setFocus] = useState<{ id: string } | null>(null);
  // A line played on the small board: the tree opens down to it and moves there
  const follow = useCallback((line: string[]) => {
    const id = line.length === 0 ? "root" : line.join(" ");
    setExpanded((prev) => expandLine(prev, line, 1));
    setSelected({ id, line });
    setFocus({ id });
  }, []);
  const [orientation, setOrientation] = useState<"white" | "black">("white");

  const loadStats = useCallback(
    async (fen: string): Promise<MoveStat[]> => {
      const [openings] = await searchPosition(
        { path: database.file, position: { fen, type_: "exact" } },
        "database-tree",
      );
      return openings.map((op) => ({
        san: op.move,
        games: op.total,
        white: op.white,
        draw: op.draw,
        black: op.black,
      }));
    },
    [database.file],
  );
  const [openFens, setOpenFens] = useState<string[]>([INITIAL_FEN]);
  const stats = usePositionData<MoveStat[]>(openFens, loadStats, true);

  const toggle = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const openLine = useOpenLine(INITIAL_FEN, 0, orientation);

  const { diagram, fens } = useMemo(() => {
    const fens: string[] = [];
    const build = (
      parent: { fen: string; halfMoves: number; line: string[] },
      move: DatabaseMove | null,
    ): DiagramNode => {
      const id = move ? move.line.join(" ") : "root";
      // The start and the first moves begin open; `expanded` holds the ones you switched
      const openByDefault = parent.line.length <= 1;
      const isOpen = move === null || openByDefault !== expanded.has(id);
      const loaded = stats.get(parent.fen);
      if (isOpen) fens.push(parent.fen);
      const kids = isOpen && loaded ? frequentMoves(parent, loaded, minShare) : [];
      return {
        id,
        label: move ? moveLabel(move) : t("Repertoire.Diagram.Start"),
        kind: move ? "theirs" : "root",
        side: move ? (move.halfMoves % 2 === 1 ? "white" : "black") : undefined,
        note: move
          ? `${shortCount(move.games, i18n.language)} · ${percent(move.share)}`
          : undefined,
        bars: move ? [{ value: move.share, color: SHARE_COLOR }] : undefined,
        title: move
          ? [
              t("Databases.Tree.Games", { count: move.games }),
              t("Databases.Tree.Share", { share: percent(move.share) }),
              t("Databases.Tree.Results", {
                white: percent(move.white / move.games),
                draw: percent(move.draw / move.games),
                black: percent(move.black / move.games),
              }),
            ].join("\n")
          : undefined,
        children: kids.map((k) => build(k, k)),
        toggle:
          move === null || (loaded && kids.length === 0 && isOpen)
            ? undefined
            : { open: isOpen, hidden: 0, onToggle: () => toggle(id) },
        onClick: move ? () => setSelected({ id, line: move.line }) : undefined,
      };
    };
    const diagram = build({ fen: INITIAL_FEN, halfMoves: 0, line: [] }, null);
    return { diagram, fens };
  }, [expanded, stats, minShare, toggle, t, i18n.language]);

  const fensKey = fens.join("\n");
  useEffect(() => {
    setOpenFens(fensKey.split("\n"));
  }, [fensKey]);

  const rootLoaded = stats.has(INITIAL_FEN);

  return (
    <Stack h="100%" gap="xs">
      <Group justify="space-between" align="flex-end" wrap="nowrap">
        <Text size="sm" c="dimmed" style={{ flex: 1 }}>
          {t("Databases.Tree.Help", { share: minPercent })} {t("Repertoire.Diagram.Help")}
        </Text>
        <Group gap="xs" align="flex-end" wrap="nowrap">
          <NumberInput
            size="xs"
            w={220}
            min={0}
            max={100}
            suffix=" %"
            value={minPercent}
            onChange={(v) => setMinPercent(Math.min(100, Math.max(0, Number(v) || 0)))}
            label={t("Databases.Tree.MinShare")}
          />
          <Tooltip label={t("Databases.Tree.FlipBoard")}>
            <ActionIcon
              variant="default"
              size="input-xs"
              onClick={() => setOrientation((o) => (o === "white" ? "black" : "white"))}
            >
              <IconSwitchVertical size="1rem" />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>
      {!rootLoaded ? (
        <Group gap="xs">
          <Loader size="xs" />
          <Text size="sm" c="dimmed">
            {t("Databases.Tree.Loading")}
          </Text>
        </Group>
      ) : diagram.children.length === 0 ? (
        <Text size="sm" c="dimmed">
          {t("Databases.Tree.Empty")}
        </Text>
      ) : (
        <Box flex={1} mih={0} pos="relative">
          <TreeDiagram root={diagram} highlight={selected?.id ?? null} focus={focus} />
          {selected && (
            <BoardPreview
              rootFen={INITIAL_FEN}
              rootHalfMoves={0}
              line={selected.line}
              orientation={orientation}
              onOpen={() => openLine(selected.line)}
              onMove={(san) => follow([...selected.line, san])}
              onBack={() => follow(selected.line.slice(0, -1))}
              onClose={() => setSelected(null)}
            />
          )}
        </Box>
      )}
    </Stack>
  );
}
