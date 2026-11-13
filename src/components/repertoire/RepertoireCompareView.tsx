import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Group,
  Loader,
  NumberInput,
  Paper,
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { IconArrowLeft, IconExternalLink } from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import useSWR from "swr";
import {
  childNodes,
  collectIssues,
  type GameMoveStatus,
  type GameNode,
  type Issue,
  lineText,
  type MoveStat,
} from "@/utils/gamesTree";
import {
  hasLichessToken,
  hasOwnGames,
  lichessMoveCounts,
  ownGamesKey,
  ownMoveCounts,
} from "@/utils/repertoireExplorer";
import { type MoveCount, repertoireWeights } from "@/utils/repertoireTree";
import type { Repertoire } from "@/utils/repertoires";
import BoardPreview from "./BoardPreview";
import { ColorDot } from "./RepertoireLabel";
import TreeDiagram, { type DiagramNode, expandLine } from "./TreeDiagram";
import { useOpenLine } from "./useOpenLine";
import { usePositionData } from "./usePositionData";

const LICHESS_COLOR = "var(--mantine-color-blue-5)";
const OWN_COLOR = "var(--mantine-color-teal-5)";

const STATUS_COLOR: Record<GameMoveStatus, string> = {
  book: "green",
  deviation: "red",
  surprise: "orange",
  end: "blue",
  outside: "gray",
};

const STATUS_LABEL: Record<GameMoveStatus, string> = {
  book: "Repertoire.Compare.Status.Book",
  deviation: "Repertoire.Compare.Status.Deviation",
  surprise: "Repertoire.Compare.Status.Surprise",
  end: "Repertoire.Compare.Status.End",
  outside: "Repertoire.Compare.Status.Outside",
};

function percent(value: number) {
  return `${Math.round(value * 100)} %`;
}

type CompareContext = {
  repertoire: Repertoire;
  openLine: (line: string[]) => void;
};

function moveLabel(node: GameNode) {
  const number = Math.ceil(node.halfMoves / 2);
  return node.halfMoves % 2 === 1 ? `${number}. ${node.san}` : `${number}… ${node.san}`;
}

function IssueList({
  title,
  hint,
  color,
  issues,
  ctx,
  startHalfMoves,
}: {
  title: string;
  hint: string;
  color: string;
  issues: Issue[];
  ctx: CompareContext;
  startHalfMoves: number;
}) {
  const { t } = useTranslation();
  return (
    <Paper withBorder p="sm">
      <Stack gap={6}>
        <Group gap={6}>
          <Badge color={color} variant="light">
            {issues.length}
          </Badge>
          <Text fw={600} size="sm">
            {title}
          </Text>
        </Group>
        <Text size="xs" c="dimmed">
          {hint}
        </Text>
        {issues.length === 0 ? (
          <Text size="sm" c="dimmed" fs="italic">
            {t("Repertoire.Compare.Nothing")}
          </Text>
        ) : (
          issues.slice(0, 12).map((issue) => (
            <UnstyledButton key={issue.line.join(" ")} onClick={() => ctx.openLine(issue.line)}>
              <Group gap={6} wrap="nowrap">
                <Text size="sm" style={{ flex: 1 }} lineClamp={2}>
                  {lineText(issue.line, startHalfMoves)}
                </Text>
                <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
                  {t("Repertoire.Compare.Games", { count: issue.games })} · {percent(issue.score)}
                </Text>
                <IconExternalLink size="0.8rem" style={{ flexShrink: 0 }} />
              </Group>
            </UnstyledButton>
          ))
        )}
      </Stack>
    </Paper>
  );
}

// Your own games next to the repertoire: where they leave it, and the full games tree.
export default function RepertoireCompareView({
  repertoire,
  onBack,
}: {
  repertoire: Repertoire;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const [minGames, setMinGames] = useState(2);
  const [expanded, setExpanded] = useState(() => new Set<string>());
  const { data: ownAvailable } = useSWR(ownGamesKey(repertoire.owner), () =>
    hasOwnGames(repertoire.owner),
  );

  const { root } = repertoire;
  const weights = useMemo(() => repertoireWeights(root), [root]);
  const rootNode = useMemo(
    () => ({ fen: root.fen, halfMoves: root.halfMoves, line: [] as string[] }),
    [root],
  );

  const { data: issues, isLoading } = useSWR(
    ownAvailable
      ? ["compare-issues", repertoire.file.path, repertoire.stats.moves, root.fen, minGames]
      : null,
    () =>
      collectIssues(
        root.fen,
        root.halfMoves,
        repertoire.color,
        repertoire.index,
        (fen) => ownMoveCounts(fen, repertoire.color, repertoire.owner),
        { minGames },
      ),
  );

  const toggle = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const openLine = useOpenLine(root.fen, root.halfMoves, repertoire.color);

  const loadStats = useCallback(
    (fen: string) => ownMoveCounts(fen, repertoire.color, repertoire.owner),
    [repertoire.color, repertoire.owner],
  );
  const [openFens, setOpenFens] = useState<string[]>([root.fen]);
  const stats = usePositionData<MoveStat[]>(openFens, loadStats, ownAvailable === true);
  const showLichess = hasLichessToken();
  const lichess = usePositionData<MoveCount[]>(openFens, lichessMoveCounts, showLichess);
  const [selected, setSelected] = useState<{ id: string; line: string[] } | null>(null);
  const [focus, setFocus] = useState<{ id: string } | null>(null);
  // A line played on the small board: the tree opens down to it and moves there
  const follow = useCallback((line: string[]) => {
    const id = line.length === 0 ? "root" : line.join(" ");
    setExpanded((prev) => expandLine(prev, line, 2));
    setSelected({ id, line });
    setFocus({ id });
  }, []);

  // Your games as a drawn tree; positions are loaded as they are opened
  const { diagram, fens } = useMemo(() => {
    const fens: string[] = [];
    const build = (
      parent: { fen: string; halfMoves: number; line: string[] },
      node: GameNode | null,
      info: { lichess?: number; own?: number; top?: { san: string; share: number } } = {},
    ): DiagramNode => {
      const id = parent.line.length === 0 ? "root" : parent.line.join(" ");
      // The first moves start open; `expanded` holds the ones you switched
      const openByDefault = parent.line.length <= 2;
      const isOpen = node === null || openByDefault !== expanded.has(id);
      const loaded = stats.get(parent.fen);
      if (isOpen) fens.push(parent.fen);
      const kids =
        isOpen && loaded
          ? childNodes(parent, loaded, repertoire.color, repertoire.index, minGames)
          : [];
      const mine = node !== null && node.halfMoves % 2 === (repertoire.color === "white" ? 1 : 0);
      // Shares of the moves from this position, for the bars of the moves below
      const ownTotal = (loaded ?? []).reduce((sum, m) => sum + m.games, 0);
      const lichessCounts = lichess.get(parent.fen);
      const lichessTotal = (lichessCounts ?? []).reduce((sum, m) => sum + m.games, 0);
      const top = lichessCounts?.reduce<MoveCount | null>(
        (best, m) => (!best || m.games > best.games ? m : best),
        null,
      );
      const childInfo = (k: GameNode) => ({
        own: ownTotal > 0 ? k.games / ownTotal : undefined,
        lichess:
          lichessCounts && lichessTotal > 0
            ? (lichessCounts.find((m) => m.san === k.san)?.games ?? 0) / lichessTotal
            : undefined,
        top:
          top && lichessTotal > 0 ? { san: top.san, share: top.games / lichessTotal } : undefined,
      });
      // Your move is not the one most players choose on Lichess
      const offMainLine = !!node && mine && !!info.top && info.top.san !== node.san;
      return {
        id,
        label: node ? moveLabel(node) : t("Repertoire.Diagram.Start"),
        kind:
          node === null ? "root" : node.status === "outside" ? "theirs" : mine ? "mine" : "theirs",
        accent:
          node && node.status !== "outside"
            ? `var(--mantine-color-${STATUS_COLOR[node.status]}-6)`
            : undefined,
        side: node ? (node.halfMoves % 2 === 1 ? "white" : "black") : undefined,
        note: node
          ? `${t("Repertoire.Compare.Games", { count: node.games })} · ${percent(node.score)}`
          : undefined,
        bars: node
          ? [
              ...(showLichess ? [{ value: info.lichess, color: LICHESS_COLOR }] : []),
              { value: info.own, color: OWN_COLOR },
            ]
          : undefined,
        flag: offMainLine ? { color: "var(--mantine-color-orange-6)" } : undefined,
        title: node
          ? [
              node.status !== "outside" ? t(STATUS_LABEL[node.status]) : "",
              `${t("Repertoire.Compare.ScoreHint")}: ${percent(node.score)}`,
              showLichess
                ? `${t("Repertoire.Tree.LichessLegend")}: ${percent(info.lichess ?? 0)}`
                : "",
              `${t("Repertoire.Tree.OwnLegend")}: ${percent(info.own ?? 0)}`,
              offMainLine
                ? t("Repertoire.Compare.LichessTop", {
                    move: info.top!.san,
                    share: percent(info.top!.share),
                  })
                : "",
            ]
              .filter(Boolean)
              .join("\n")
          : undefined,
        children: kids.map((k) => build(k, k, childInfo(k))),
        toggle:
          node === null || (loaded && kids.length === 0 && isOpen)
            ? undefined
            : { open: isOpen, hidden: 0, onToggle: () => toggle(id) },
        onClick: node ? () => setSelected({ id, line: node.line }) : undefined,
      };
    };
    const diagram = build(rootNode, null);
    return { diagram, fens };
  }, [rootNode, expanded, stats, lichess, showLichess, repertoire, minGames, toggle, t]);

  const fensKey = fens.join("\n");
  useEffect(() => {
    setOpenFens(fensKey.split("\n"));
  }, [fensKey]);

  const ctx: CompareContext = { repertoire, openLine };
  const byKind = (kind: Issue["kind"]) => (issues ?? []).filter((i) => i.kind === kind);

  return (
    <ScrollArea h="100%">
      <Stack gap="sm">
        <Group justify="space-between">
          <Group gap="sm">
            <ActionIcon variant="subtle" onClick={onBack}>
              <IconArrowLeft size="1.2rem" />
            </ActionIcon>
            <ColorDot color={repertoire.color} />
            <Title order={3}>{t("Repertoire.Compare.Title", { name: repertoire.name })}</Title>
            {repertoire.parts && (
              <Badge variant="light" color="gray">
                {t("Repertoire.Folder.Combined", { count: repertoire.parts.length })}
              </Badge>
            )}
          </Group>
          <NumberInput
            size="xs"
            w={190}
            min={1}
            max={100}
            value={minGames}
            onChange={(v) => setMinGames(Math.max(1, Number(v) || 1))}
            label={t("Repertoire.Compare.MinGames")}
          />
        </Group>
        <Text size="sm" c="dimmed">
          {t("Repertoire.Compare.Help", { games: minGames })}
        </Text>

        {ownAvailable === false ? (
          <Alert color="gray" py="xs">
            <Text size="sm">{t("Repertoire.Tree.NoOwnGames")}</Text>
          </Alert>
        ) : (
          <>
            {isLoading || !issues ? (
              <Group gap="xs">
                <Loader size="xs" />
                <Text size="sm" c="dimmed">
                  {t("Repertoire.Compare.Loading")}
                </Text>
              </Group>
            ) : (
              <SimpleGrid cols={{ base: 1, md: 3 }}>
                <IssueList
                  title={t("Repertoire.Compare.Surprises")}
                  hint={t("Repertoire.Compare.SurprisesHint")}
                  color={STATUS_COLOR.surprise}
                  issues={byKind("surprise")}
                  ctx={ctx}
                  startHalfMoves={root.halfMoves}
                />
                <IssueList
                  title={t("Repertoire.Compare.Deviations")}
                  hint={t("Repertoire.Compare.DeviationsHint")}
                  color={STATUS_COLOR.deviation}
                  issues={byKind("deviation")}
                  ctx={ctx}
                  startHalfMoves={root.halfMoves}
                />
                <IssueList
                  title={t("Repertoire.Compare.Ends")}
                  hint={t("Repertoire.Compare.EndsHint")}
                  color={STATUS_COLOR.end}
                  issues={byKind("end")}
                  ctx={ctx}
                  startHalfMoves={root.halfMoves}
                />
              </SimpleGrid>
            )}

            <Paper withBorder p="sm">
              <Group justify="space-between" mb="xs">
                <Text fw={600} size="sm">
                  {t("Repertoire.Compare.GamesTree")}
                </Text>
                <Text size="xs" c="dimmed">
                  {t("Repertoire.Diagram.Help")}
                </Text>
              </Group>
              <Group gap="lg" mb="xs">
                {showLichess && (
                  <Group gap={6}>
                    <Box w={14} h={6} style={{ borderRadius: 3, background: LICHESS_COLOR }} />
                    <Text size="xs" c="dimmed">
                      {t("Repertoire.Tree.LichessLegend")}
                    </Text>
                  </Group>
                )}
                <Group gap={6}>
                  <Box w={14} h={6} style={{ borderRadius: 3, background: OWN_COLOR }} />
                  <Text size="xs" c="dimmed">
                    {t("Repertoire.Tree.OwnLegend")}
                  </Text>
                </Group>
                {showLichess && (
                  <Group gap={6}>
                    <Box
                      w={16}
                      h={16}
                      style={{
                        borderRadius: 8,
                        background: "var(--mantine-color-orange-6)",
                        color: "white",
                        fontSize: 11,
                        fontWeight: 700,
                        textAlign: "center",
                        lineHeight: "16px",
                      }}
                    >
                      L
                    </Box>
                    <Text size="xs" c="dimmed">
                      {t("Repertoire.Compare.LichessFlagLegend")}
                    </Text>
                  </Group>
                )}
              </Group>
              {stats.has(root.fen) && diagram.children.length === 0 ? (
                <Text size="sm" c="dimmed">
                  {t("Repertoire.Compare.NoGames", { count: minGames })}
                </Text>
              ) : (
                <Box h={560} pos="relative">
                  <TreeDiagram root={diagram} highlight={selected?.id ?? null} focus={focus} />
                  {selected && (
                    <BoardPreview
                      rootFen={root.fen}
                      rootHalfMoves={root.halfMoves}
                      line={selected.line}
                      orientation={repertoire.color}
                      weights={weights}
                      onOpen={() => openLine(selected.line)}
                      onMove={(san) => follow([...selected.line, san])}
                      onBack={() => follow(selected.line.slice(0, -1))}
                      onClose={() => setSelected(null)}
                    />
                  )}
                </Box>
              )}
            </Paper>
          </>
        )}
      </Stack>
    </ScrollArea>
  );
}
