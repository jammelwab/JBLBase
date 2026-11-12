import {
  ActionIcon,
  Box,
  Group,
  Loader,
  NumberInput,
  SegmentedControl,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { IconSwitchVertical } from "@tabler/icons-react";
import { INITIAL_FEN } from "chessops/fen";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import BoardPreview from "@/components/repertoire/BoardPreview";
import TreeDiagram, { type DiagramNode } from "@/components/repertoire/TreeDiagram";
import { useOpenLine } from "@/components/repertoire/useOpenLine";
import { PlayerSearchInput } from "./PlayerSearchInput";
import { usePositionData } from "@/components/repertoire/usePositionData";
import { type DatabaseMove, DEFAULT_MIN_SHARE, frequentMoves } from "@/utils/databaseTree";
import { sessionsAtom } from "@/state/atoms";
import { accountDatabaseFilename, sameName } from "@/utils/accountDatabase";
import { query_players, type SuccessDatabaseInfo, searchPosition } from "@/utils/db";
import type { MoveStat } from "@/utils/gamesTree";
import { sessionUsername } from "@/utils/session";

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

type PlayerColor = "any" | "white" | "black";

function moveSide(move: DatabaseMove): "white" | "black" {
  return move.halfMoves % 2 === 1 ? "white" : "black";
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
  const [orientation, setOrientation] = useState<"white" | "black">("white");
  // One player's games only, and which color they had: "As White" shows what they play with
  // White and what their opponents answer.
  const [player, setPlayer] = useState<string>();
  const [color, setColor] = useState<PlayerColor>("any");
  const [debouncedPlayer] = useDebouncedValue(player?.trim() || undefined, 400);

  // A database of your own account starts with your games as White
  const sessions = useAtomValue(sessionsAtom);
  const accountName = useMemo(() => {
    for (const session of sessions) {
      const names = [
        session.lichess && ([sessionUsername(session), "lichess"] as const),
        session.chessCom && ([session.chessCom.username, "chesscom"] as const),
      ];
      for (const entry of names) {
        if (entry && sameName(database.filename, accountDatabaseFilename(entry[0], entry[1])))
          return entry[0];
      }
    }
    return undefined;
  }, [sessions, database.filename]);
  useEffect(() => {
    if (!accountName) return;
    let active = true;
    // The name as the games spell it: "beispielkonto" can be "BeispielKonto" there
    query_players(database.file, {
      name: accountName,
      options: { skipCount: true, pageSize: 50, sort: "name", direction: "asc" },
    })
      .then((res) => res.data.find((p) => sameName(p.name, accountName))?.name ?? accountName)
      .catch(() => accountName)
      .then((name) => {
        if (!active) return;
        setPlayer((prev) => prev ?? name);
        setColor("white");
        setOrientation("white");
      });
    return () => {
      active = false;
    };
  }, [accountName, database.file]);

  const filterKey = debouncedPlayer ? `${debouncedPlayer}|${color}` : "";
  const loadStats = useCallback(
    async (key: string): Promise<MoveStat[]> => {
      const fen = key.slice(key.lastIndexOf("|") + 1);
      const [openings] = await searchPosition(
        {
          path: database.file,
          position: { fen, type_: "exact" },
          ...(debouncedPlayer
            ? {
                player1: debouncedPlayer,
                sides: color === "white" ? "WhiteBlack" : color === "black" ? "BlackWhite" : "Any",
              }
            : {}),
        },
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
    [database.file, debouncedPlayer, color],
  );
  const [openFens, setOpenFens] = useState<string[]>([INITIAL_FEN]);
  // Counted per filter, so switching between White and Black does not mix the numbers
  const statKeys = useMemo(
    () => openFens.map((fen) => `${filterKey}|${fen}`),
    [openFens, filterKey],
  );
  const allStats = usePositionData<MoveStat[]>(statKeys, loadStats, true);
  const stats = useMemo(
    () => ({
      get: (fen: string) => allStats.get(`${filterKey}|${fen}`),
      has: (fen: string) => allStats.has(`${filterKey}|${fen}`),
    }),
    [allStats, filterKey],
  );
  const mineColor = debouncedPlayer && color !== "any" ? color : null;

  function changeColor(next: PlayerColor) {
    setColor(next);
    if (next !== "any") setOrientation(next);
    setSelected(null);
  }

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
        // The moves of the chosen player get the strong frame
        kind: move ? (moveSide(move) === mineColor ? "mine" : "theirs") : "root",
        side: move ? moveSide(move) : undefined,
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
  }, [expanded, stats, minShare, mineColor, toggle, t, i18n.language]);

  const fensKey = fens.join("\n");
  useEffect(() => {
    setOpenFens(fensKey.split("\n"));
  }, [fensKey]);

  const rootLoaded = stats.has(INITIAL_FEN);

  return (
    <Stack h="100%" gap="xs">
      <Group gap="xs" align="flex-end">
        <Box w={240}>
          <Text size="xs" fw={500} mb={2}>
            {t("Databases.Tree.Player")}
          </Text>
          <PlayerSearchInput
            label={t("Databases.Tree.PlayerPlaceholder")}
            file={database.file}
            value={player}
            setValue={(value) => {
              setPlayer(value);
              setSelected(null);
            }}
          />
        </Box>
        <Tooltip label={t("Databases.Tree.ColorHint")} disabled={!!debouncedPlayer}>
          <SegmentedControl
            disabled={!debouncedPlayer}
            value={debouncedPlayer ? color : "any"}
            onChange={(value) => changeColor(value as PlayerColor)}
            data={[
              { value: "white", label: t("Home.Personal.AsWhite") },
              { value: "black", label: t("Home.Personal.AsBlack") },
              { value: "any", label: t("Databases.Tree.BothColors") },
            ]}
          />
        </Tooltip>
        <Box style={{ flex: 1 }} />
        <NumberInput
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
            size="input-sm"
            onClick={() => setOrientation((o) => (o === "white" ? "black" : "white"))}
          >
            <IconSwitchVertical size="1rem" />
          </ActionIcon>
        </Tooltip>
      </Group>
      <Text size="sm" c="dimmed">
        {mineColor && debouncedPlayer
          ? `${t(mineColor === "white" ? "Databases.Tree.MineWhite" : "Databases.Tree.MineBlack", { player: debouncedPlayer })} `
          : ""}
        {t("Databases.Tree.Help", { share: minPercent })} {t("Repertoire.Diagram.Help")}
      </Text>
      {!rootLoaded ? (
        <Group gap="xs">
          <Loader size="xs" />
          <Text size="sm" c="dimmed">
            {t("Databases.Tree.Loading")}
          </Text>
        </Group>
      ) : diagram.children.length === 0 ? (
        <Text size="sm" c="dimmed">
          {debouncedPlayer
            ? t("Databases.Tree.EmptyPlayer", { player: debouncedPlayer })
            : t("Databases.Tree.Empty")}
        </Text>
      ) : (
        <Box flex={1} mih={0} pos="relative">
          <TreeDiagram root={diagram} highlight={selected?.id ?? null} />
          {selected && (
            <BoardPreview
              rootFen={INITIAL_FEN}
              rootHalfMoves={0}
              line={selected.line}
              orientation={orientation}
              onOpen={() => openLine(selected.line)}
              onClose={() => setSelected(null)}
            />
          )}
        </Box>
      )}
    </Stack>
  );
}
