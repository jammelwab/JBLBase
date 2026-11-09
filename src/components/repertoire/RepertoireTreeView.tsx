import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Group,
  Paper,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { IconArrowLeft, IconArrowsExchange } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import { useSetAtom } from "jotai";
import { notifications } from "@mantine/notifications";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import useSWR from "swr";
import { activeTabAtom, tabsAtom } from "@/state/atoms";
import { updatePersistedState } from "@/state/store/debouncedStorage";
import { openFile } from "@/utils/files";
import { lineText, lineTree, playLine } from "@/utils/gamesTree";
import {
  hasLichessToken,
  hasOwnGames,
  ownGamesKey,
  lichessMoveCounts,
  ownMoveCounts,
} from "@/utils/repertoireExplorer";
import {
  findPosition,
  type MoveCount,
  moveShares,
  nodesOnPath,
  pathForLine,
  orderBy,
  positionKey,
  repertoireSizes,
  repertoireWeights,
} from "@/utils/repertoireTree";
import { addLineToRepertoire, type Repertoire } from "@/utils/repertoires";
import type { TreeNode, TreeState } from "@/utils/treeReducer";
import BoardPreview, { type LineStatus } from "./BoardPreview";
import { ColorDot } from "./RepertoireLabel";
import TreeDiagram, { type DiagramLink, type DiagramNode } from "./TreeDiagram";
import { useOpenLine } from "./useOpenLine";
import { usePositionData } from "./usePositionData";

const LICHESS_COLOR = "var(--mantine-color-blue-5)";
const OWN_COLOR = "var(--mantine-color-teal-5)";
// Same green as the repertoire arrows on the small board
export const REPERTOIRE_COLOR = "#2f9e44";
const TRANSPOSITION_COLOR = "var(--mantine-color-violet-5)";

function percent(value: number | undefined) {
  if (value === undefined) return "–";
  if (value > 0 && value < 0.01) return "<1 %";
  return `${Math.round(value * 100)} %`;
}

export function moveLabel(node: { halfMoves: number; san: string | null }) {
  const number = Math.ceil(node.halfMoves / 2);
  return node.halfMoves % 2 === 1 ? `${number}. ${node.san}` : `${number}… ${node.san}`;
}

function countMoves(node: TreeNode): number {
  let n = 0;
  for (const c of node.children) n += 1 + countMoves(c);
  return n;
}

function allKeys(node: TreeNode, path: number[] = [], out: string[] = []) {
  node.children.forEach((c, i) => {
    const p = [...path, i];
    if (c.children.length > 0) out.push(p.join(","));
    allKeys(c, p, out);
  });
  return out;
}

// The first moves are open, deeper ones are collapsed.
function initialKeys(root: TreeNode) {
  return allKeys(root).filter((k) => k.split(",").length <= 3);
}

// The same position reached by different move orders.
function findTranspositions(root: TreeNode) {
  const paths = new Map<string, number[][]>();
  const walk = (node: TreeNode, path: number[]) => {
    node.children.forEach((child, i) => {
      const childPath = [...path, i];
      const key = positionKey(child.fen);
      paths.set(key, [...(paths.get(key) ?? []), childPath]);
      walk(child, childPath);
    });
  };
  walk(root, []);
  for (const [key, list] of paths) if (list.length < 2) paths.delete(key);
  return paths;
}

const idOf = (path: number[]) => (path.length === 0 ? "root" : path.join(","));

// Positions whose moves are visible, so their counts are needed
function openPositions(root: TreeNode, expanded: Set<string>) {
  const fens: string[] = [];
  const walk = (node: TreeNode, path: number[]) => {
    if (path.length > 0 && !expanded.has(idOf(path))) return;
    if (node.children.length === 0) return;
    fens.push(node.fen);
    node.children.forEach((c, i) => walk(c, [...path, i]));
  };
  walk(root, []);
  return fens;
}

export default function RepertoireTreeView({
  repertoire,
  onBack,
}: {
  repertoire: Repertoire;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setTabs = useSetAtom(tabsAtom);
  const setActiveTab = useSetAtom(activeTabAtom);
  const [expanded, setExpanded] = useState(() => new Set(initialKeys(repertoire.root)));
  const [highlight, setHighlight] = useState<string | null>(null);
  // The line on the small board, the repertoire node it is at (`known` of its moves are on a
  // repertoire line) and whether it is in the repertoire
  const [selected, setSelected] = useState<{
    line: string[];
    path: number[];
    known: number;
    status: LineStatus;
  } | null>(null);
  const select = useCallback(
    (id: string, path: number[], extra?: string) => {
      const line = nodesOnPath(repertoire.root, path).map((n) => n.san!);
      setSelected({
        line: extra ? [...line, extra] : line,
        path,
        known: path.length,
        status: extra ? "out" : "in",
      });
      setHighlight(id);
    },
    [repertoire.root],
  );
  const [focus, setFocus] = useState<{ id: string } | null>(null);
  const { data: ownAvailable } = useSWR(ownGamesKey(repertoire.owner), () =>
    hasOwnGames(repertoire.owner),
  );

  const showLichess = hasLichessToken();
  const showOwn = !!ownAvailable;
  const { root, color } = repertoire;

  const fens = useMemo(() => openPositions(root, expanded), [root, expanded]);
  const lichess = usePositionData<MoveCount[]>(fens, lichessMoveCounts, showLichess);
  const loadOwn = useCallback(
    (fen: string) => ownMoveCounts(fen, color, repertoire.owner),
    [color, repertoire.owner],
  );
  const own = usePositionData<MoveCount[]>(fens, loadOwn, showOwn);

  const transpositions = useMemo(() => findTranspositions(root), [root]);
  const sizes = useMemo(() => repertoireSizes(root), [root]);
  const weights = useMemo(() => repertoireWeights(root), [root]);

  const toggle = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const openLine = useOpenLine(repertoire.root.fen, repertoire.root.halfMoves, repertoire.color);
  const open = useCallback(
    async (path: number[]) => {
      // A folder looked at as a whole has no file to open, so the line opens on its own
      if (repertoire.parts) {
        await openLine(nodesOnPath(repertoire.root, path).map((n) => n.san!));
        return;
      }
      const id = await openFile(repertoire.file, setTabs, setActiveTab);
      updatePersistedState<TreeState>(id, (state) => ({ ...state, position: path }));
      navigate({ to: "/" });
    },
    [repertoire, openLine, setTabs, setActiveTab, navigate],
  );

  // Opens everything above `path` and moves the view there
  const reveal = useCallback((path: number[]) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      for (let i = 1; i < path.length; i++) next.add(path.slice(0, i).join(","));
      return next;
    });
    setHighlight(idOf(path));
    setFocus({ id: idOf(path) });
  }, []);

  // Puts a line on the small board and moves the tree along: to the move if the repertoire
  // has it, to the same position reached by another move order, or to where the line left it.
  const follow = useCallback(
    (line: string[], focusView = true) => {
      const path = pathForLine(root, line);
      let target = path;
      let status: LineStatus = "in";
      if (path.length < line.length) {
        const elsewhere = findPosition(root, playLine(root.fen, line).fen);
        if (elsewhere) {
          target = elsewhere;
          status = "transposition";
        } else {
          status = "out";
        }
      }
      setSelected({ line, path: target, known: path.length, status });
      if (focusView) reveal(target);
      else setHighlight(idOf(target));
    },
    [root, reveal],
  );

  // After the repertoire changed (a line was added), the board's line is checked again
  const selectedRef = useRef(selected);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);
  useEffect(() => {
    if (selectedRef.current) follow(selectedRef.current.line, false);
  }, [follow]);

  const addLine = useCallback(
    async (line: string[]) => {
      try {
        const result = await addLineToRepertoire(
          repertoire.file,
          lineTree(root.fen, root.halfMoves, line),
          line.map(() => 0),
          { withVariations: false, label: lineText(line, root.halfMoves) },
        );
        if (!result.ok) throw new Error(t("Repertoire.Add.DifferentStart"));
        notifications.show({
          color: "green",
          title: repertoire.name,
          message: t("Repertoire.Add.Added", { count: result.added }),
        });
      } catch (e) {
        notifications.show({
          color: "red",
          title: t("Repertoire.Add.Failed"),
          message: e instanceof Error ? e.message : String(e),
        });
      }
    },
    [repertoire.file, repertoire.name, root.fen, root.halfMoves, t],
  );

  const { diagram, links } = useMemo(() => {
    // Moves that are not in the repertoire (ghost, "other") get an empty repertoire bar
    type Rep = { share: number; lines: number; moves: number } | null;
    const bars = (
      lichessShare: number | undefined,
      ownShare: number | undefined,
      rep: Rep = null,
    ) => [
      ...(showLichess ? [{ value: lichessShare, color: LICHESS_COLOR }] : []),
      { value: rep?.share ?? 0, color: REPERTOIRE_COLOR },
      ...(showOwn ? [{ value: ownShare, color: OWN_COLOR }] : []),
    ];
    const barTitle = (
      lichessShare: number | undefined,
      ownShare: number | undefined,
      rep: Rep = null,
    ) =>
      [
        showLichess ? `${t("Repertoire.Tree.LichessLegend")}: ${percent(lichessShare)}` : null,
        rep
          ? t("Repertoire.Tree.RepertoireShare", {
              share: percent(rep.share),
              lines: rep.lines,
              moves: rep.moves,
            })
          : null,
        showOwn ? `${t("Repertoire.Tree.OwnLegend")}: ${percent(ownShare)}` : null,
      ]
        .filter(Boolean)
        .join("\n");

    const visible = new Set<string>();

    const build = (
      node: TreeNode,
      path: number[],
      shares: { lichess?: number; own?: number; rep?: Rep },
    ): DiagramNode => {
      const id = idOf(path);
      visible.add(id);
      const isRoot = path.length === 0;
      const isOpen = isRoot || expanded.has(id);
      const mine = !isRoot && node.halfMoves % 2 === (color === "white" ? 1 : 0);
      const children: DiagramNode[] = [];

      if (isOpen && node.children.length > 0) {
        const sans = node.children.map((c) => c.san!);
        const lichessShares = lichess.get(node.fen) && moveShares(lichess.get(node.fen)!, sans);
        const ownCounts = own.get(node.fen);
        const ownShares = ownCounts && moveShares(ownCounts, sans);
        const opponentMoves = (node.halfMoves % 2 === 0 ? "white" : "black") !== color;
        const lines = sizes.get(node)!.lines;
        const lichessGames = new Map(
          (lichess.get(node.fen) ?? []).map((m) => [m.san, m.games] as const),
        );
        // Your own moves: the one with the most repertoire behind it first. The opponent's
        // moves: the most played on Lichess first, then by repertoire.
        const order = orderBy(node.children, (child) => {
          const size = sizes.get(child)!;
          return opponentMoves
            ? [lichessGames.get(child.san!) ?? 0, size.lines, size.moves]
            : [size.lines, size.moves];
        });
        for (const i of order) {
          const child = node.children[i];
          const size = sizes.get(child)!;
          children.push(
            build(child, [...path, i], {
              lichess: lichessShares?.shares.get(child.san!),
              own: ownShares?.shares.get(child.san!),
              rep: { share: size.lines / lines, lines: size.lines, moves: size.moves },
            }),
          );
        }

        if (opponentMoves && showOwn && ownShares && ownShares.other > 0) {
          children.push({
            id: `${id}:other`,
            label: t("Repertoire.Tree.Other"),
            kind: "other",
            children: [],
            bars: bars(lichessShares?.other, ownShares.other),
            title: barTitle(lichessShares?.other, ownShares.other),
          });
        }
        const missing = opponentMoves ? lichessShares?.topMissing : null;
        if (missing) {
          const ownMissing = ownCounts
            ? moveShares(ownCounts, [missing.san]).shares.get(missing.san)
            : undefined;
          children.push({
            id: `${id}:missing`,
            label: moveLabel({ halfMoves: node.halfMoves + 1, san: missing.san }),
            kind: "ghost",
            children: [],
            bars: bars(missing.share, ownMissing),
            title: `${t("Repertoire.Tree.Missing")}\n${barTitle(missing.share, ownMissing)}\n${t("Repertoire.Tree.MissingHint")}`,
            side: node.halfMoves % 2 === 0 ? "white" : "black",
            onClick: () => select(`${id}:missing`, path, missing.san),
          });
        }
      }

      const group = isRoot ? undefined : transpositions.get(positionKey(node.fen));
      let marker: DiagramNode["marker"];
      let transpositionTitle = "";
      if (group) {
        const self = group.findIndex((p) => idOf(p) === id);
        const next = group[(self + 1) % group.length];
        marker = { color: TRANSPOSITION_COLOR, onClick: () => reveal(next) };
        transpositionTitle = [
          t("Repertoire.Tree.Transposition"),
          ...group
            .filter((_, i) => i !== self)
            .map((p) =>
              lineText(
                nodesOnPath(root, p).map((n) => n.san!),
                root.halfMoves,
              ),
            ),
          t("Repertoire.Tree.TranspositionHint"),
        ].join("\n");
      }

      return {
        id,
        label: isRoot
          ? t("Repertoire.Diagram.Start")
          : `${moveLabel(node)}${node.annotations.join("")}`,
        kind: isRoot ? "root" : mine ? "mine" : "theirs",
        side: isRoot ? undefined : node.halfMoves % 2 === 1 ? "white" : "black",
        children,
        toggle:
          !isRoot && node.children.length > 0
            ? { open: isOpen, hidden: countMoves(node), onToggle: () => toggle(id) }
            : undefined,
        onClick: () => select(id, path),
        bars: isRoot ? undefined : bars(shares.lichess, shares.own, shares.rep),
        marker,
        title: [isRoot ? "" : barTitle(shares.lichess, shares.own, shares.rep), transpositionTitle]
          .filter(Boolean)
          .join("\n\n"),
      };
    };

    const diagram = build(root, [], {});

    // Dashed arrows from every other move order to the first one that is visible
    const links: DiagramLink[] = [];
    for (const group of transpositions.values()) {
      const shown = group.map(idOf).filter((id) => visible.has(id));
      for (const from of shown.slice(1)) {
        links.push({ from, to: shown[0], color: TRANSPOSITION_COLOR });
      }
    }
    return { diagram, links };
  }, [
    root,
    color,
    expanded,
    lichess,
    own,
    showLichess,
    showOwn,
    transpositions,
    sizes,
    select,
    toggle,
    reveal,
    t,
  ]);

  return (
    <Stack gap="sm" h="100%">
      <Group justify="space-between">
        <Group gap="sm">
          <ActionIcon variant="subtle" onClick={onBack}>
            <IconArrowLeft size="1.2rem" />
          </ActionIcon>
          <ColorDot color={repertoire.color} />
          <Title order={3}>{repertoire.name}</Title>
          {repertoire.parts && (
            <Badge variant="light" color="gray">
              {t("Repertoire.Folder.Combined", { count: repertoire.parts.length })}
            </Badge>
          )}
        </Group>
        <Group gap="xs">
          <Button
            size="xs"
            variant="default"
            onClick={() => setExpanded(new Set(allKeys(repertoire.root)))}
          >
            {t("Repertoire.Tree.ExpandAll")}
          </Button>
          <Button size="xs" variant="default" onClick={() => setExpanded(new Set())}>
            {t("Repertoire.Tree.CollapseAll")}
          </Button>
        </Group>
      </Group>

      <Group gap="lg">
        {showLichess && (
          <Group gap={6}>
            <Box w={14} h={6} style={{ borderRadius: 3, background: LICHESS_COLOR }} />
            <Text size="xs" c="dimmed">
              {t("Repertoire.Tree.LichessLegend")}
            </Text>
          </Group>
        )}
        <Group gap={6}>
          <Box w={14} h={6} style={{ borderRadius: 3, background: REPERTOIRE_COLOR }} />
          <Text size="xs" c="dimmed">
            {t("Repertoire.Tree.RepertoireLegend")}
          </Text>
        </Group>
        {showOwn && (
          <Group gap={6}>
            <Box w={14} h={6} style={{ borderRadius: 3, background: OWN_COLOR }} />
            <Text size="xs" c="dimmed">
              {t("Repertoire.Tree.OwnLegend")}
            </Text>
          </Group>
        )}
        {transpositions.size > 0 && (
          <Group gap={6}>
            <IconArrowsExchange size="0.9rem" color={TRANSPOSITION_COLOR} />
            <Text size="xs" c="dimmed">
              {t("Repertoire.Tree.TranspositionLegend", { count: transpositions.size })}
            </Text>
          </Group>
        )}
        <Text size="xs" c="dimmed">
          {t("Repertoire.Tree.SortHint")}
        </Text>
        <Text size="xs" c="dimmed">
          {t("Repertoire.Diagram.Help")}
        </Text>
      </Group>

      {!showLichess && (
        <Alert color="gray" py="xs">
          <Text size="sm">{t("Repertoire.Tree.NoLichess")}</Text>
        </Alert>
      )}
      {ownAvailable === false && (
        <Alert color="gray" py="xs">
          <Text size="sm">{t("Repertoire.Tree.NoOwnGames")}</Text>
        </Alert>
      )}

      <Paper withBorder flex={1} pos="relative" style={{ minHeight: 0, overflow: "hidden" }}>
        {repertoire.root.children.length === 0 ? (
          <Text c="dimmed" size="sm" p="sm">
            {t("Repertoire.Tree.Empty")}
          </Text>
        ) : (
          <TreeDiagram root={diagram} links={links} highlight={highlight} focus={focus} />
        )}
        {selected && (
          <BoardPreview
            rootFen={root.fen}
            rootHalfMoves={root.halfMoves}
            line={selected.line}
            orientation={color}
            weights={weights}
            onOpen={() =>
              selected.status === "in" ? open(selected.path) : openLine(selected.line)
            }
            onMove={(san) => follow([...selected.line, san])}
            onBack={() => follow(selected.line.slice(0, -1))}
            status={selected.status}
            known={selected.known}
            onAdd={repertoire.parts ? undefined : () => addLine(selected.line)}
            onClose={() => {
              setSelected(null);
              setHighlight(null);
            }}
          />
        )}
      </Paper>
    </Stack>
  );
}
