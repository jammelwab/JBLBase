import { ActionIcon, Alert, Box, Button, Group, Paper, Stack, Text, Title } from "@mantine/core";
import { IconArrowLeft, IconArrowsExchange } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import { useSetAtom } from "jotai";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import useSWR from "swr";
import { activeTabAtom, tabsAtom } from "@/state/atoms";
import { updatePersistedState } from "@/state/store/debouncedStorage";
import { openFile } from "@/utils/files";
import { lineText } from "@/utils/gamesTree";
import {
  hasLichessToken,
  hasOwnGames,
  lichessMoveCounts,
  ownMoveCounts,
} from "@/utils/repertoireExplorer";
import { type MoveCount, moveShares, nodesOnPath, positionKey } from "@/utils/repertoireTree";
import { MAIN_OWNER, type Repertoire } from "@/utils/repertoires";
import type { TreeNode, TreeState } from "@/utils/treeReducer";
import BoardPreview from "./BoardPreview";
import { ColorDot } from "./RepertoireLabel";
import TreeDiagram, { type DiagramLink, type DiagramNode } from "./TreeDiagram";
import { usePositionData } from "./usePositionData";

const LICHESS_COLOR = "var(--mantine-color-blue-5)";
const OWN_COLOR = "var(--mantine-color-teal-5)";
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
  // The move shown on the small board: its line and the position to open on the big board
  const [selected, setSelected] = useState<{ line: string[]; path: number[] } | null>(null);
  const select = useCallback(
    (id: string, path: number[], extra?: string) => {
      const line = nodesOnPath(repertoire.root, path).map((n) => n.san!);
      setSelected({ line: extra ? [...line, extra] : line, path });
      setHighlight(id);
    },
    [repertoire.root],
  );
  const [focus, setFocus] = useState<{ id: string } | null>(null);
  const { data: ownAvailable } = useSWR("own-games-available", hasOwnGames);

  const showLichess = hasLichessToken();
  const showOwn = repertoire.owner === MAIN_OWNER && !!ownAvailable;
  const { root, color } = repertoire;

  const fens = useMemo(() => openPositions(root, expanded), [root, expanded]);
  const lichess = usePositionData<MoveCount[]>(fens, lichessMoveCounts, showLichess);
  const loadOwn = useCallback((fen: string) => ownMoveCounts(fen, color), [color]);
  const own = usePositionData<MoveCount[]>(fens, loadOwn, showOwn);

  const transpositions = useMemo(() => findTranspositions(root), [root]);

  const toggle = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const open = useCallback(
    async (path: number[]) => {
      const id = await openFile(repertoire.file, setTabs, setActiveTab);
      updatePersistedState<TreeState>(id, (state) => ({ ...state, position: path }));
      navigate({ to: "/" });
    },
    [repertoire.file, setTabs, setActiveTab, navigate],
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

  const { diagram, links } = useMemo(() => {
    const bars = (lichessShare: number | undefined, ownShare: number | undefined) => [
      ...(showLichess ? [{ value: lichessShare, color: LICHESS_COLOR }] : []),
      ...(showOwn ? [{ value: ownShare, color: OWN_COLOR }] : []),
    ];
    const barTitle = (lichessShare: number | undefined, ownShare: number | undefined) =>
      [
        showLichess ? `${t("Repertoire.Tree.LichessLegend")}: ${percent(lichessShare)}` : null,
        showOwn ? `${t("Repertoire.Tree.OwnLegend")}: ${percent(ownShare)}` : null,
      ]
        .filter(Boolean)
        .join("\n");

    const visible = new Set<string>();

    const build = (
      node: TreeNode,
      path: number[],
      shares: { lichess?: number; own?: number },
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
        node.children.forEach((child, i) => {
          children.push(
            build(child, [...path, i], {
              lichess: lichessShares?.shares.get(child.san!),
              own: ownShares?.shares.get(child.san!),
            }),
          );
        });

        const opponentMoves = (node.halfMoves % 2 === 0 ? "white" : "black") !== color;
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
        bars: isRoot ? undefined : bars(shares.lichess, shares.own),
        marker,
        title: [isRoot ? "" : barTitle(shares.lichess, shares.own), transpositionTitle]
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
          {t("Repertoire.Diagram.Help")}
        </Text>
      </Group>

      {!showLichess && (
        <Alert color="gray" py="xs">
          <Text size="sm">{t("Repertoire.Tree.NoLichess")}</Text>
        </Alert>
      )}
      {repertoire.owner === MAIN_OWNER && ownAvailable === false && (
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
            index={repertoire.index}
            onOpen={() => open(selected.path)}
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
