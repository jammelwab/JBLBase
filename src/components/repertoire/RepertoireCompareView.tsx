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
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import {
  IconArrowLeft,
  IconChevronDown,
  IconChevronRight,
  IconExternalLink,
} from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import { useSetAtom } from "jotai";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import useSWR from "swr";
import { activeTabAtom, tabsAtom } from "@/state/atoms";
import {
  childNodes,
  collectIssues,
  type GameMoveStatus,
  type GameNode,
  type Issue,
  lineText,
} from "@/utils/gamesTree";
import { hasOwnGames, ownMoveCounts } from "@/utils/repertoireExplorer";
import type { Repertoire } from "@/utils/repertoires";
import { createTab } from "@/utils/tabs";
import { defaultTree } from "@/utils/treeReducer";
import { ColorDot } from "./RepertoireLabel";

const INDENT = 22;

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
  minGames: number;
  expanded: Set<string>;
  toggle: (key: string) => void;
  openLine: (line: string[]) => void;
};

function moveLabel(node: GameNode) {
  const number = Math.ceil(node.halfMoves / 2);
  return node.halfMoves % 2 === 1 ? `${number}. ${node.san}` : `${number}… ${node.san}`;
}

// One position of your games tree, loaded when it is opened.
function GameRows({
  parent,
  depth,
  ctx,
}: {
  parent: { fen: string; halfMoves: number; line: string[] };
  depth: number;
  ctx: CompareContext;
}) {
  const { t } = useTranslation();
  const { repertoire } = ctx;
  const { data: stats } = useSWR(["own-moves", repertoire.color, parent.fen], () =>
    ownMoveCounts(parent.fen, repertoire.color),
  );
  const nodes = useMemo(
    () =>
      stats ? childNodes(parent, stats, repertoire.color, repertoire.index, ctx.minGames) : [],
    [stats, parent, repertoire, ctx.minGames],
  );

  if (!stats) return <Loader size="xs" ml={depth * INDENT + 26} my={4} />;
  if (nodes.length === 0 && depth === 0) {
    return (
      <Text size="sm" c="dimmed">
        {t("Repertoire.Compare.NoGames", { count: ctx.minGames })}
      </Text>
    );
  }

  return (
    <>
      {nodes.map((node) => {
        const key = node.line.join(" ");
        const isOpen = ctx.expanded.has(key);
        return (
          <Box key={key}>
            <Group gap={6} wrap="nowrap" pl={depth * INDENT} py={2}>
              <ActionIcon size="sm" variant="subtle" color="gray" onClick={() => ctx.toggle(key)}>
                {isOpen ? <IconChevronDown size="0.9rem" /> : <IconChevronRight size="0.9rem" />}
              </ActionIcon>
              <UnstyledButton onClick={() => ctx.openLine(node.line)}>
                <Text size="sm" c={node.status === "outside" ? "dimmed" : undefined}>
                  {moveLabel(node)}
                </Text>
              </UnstyledButton>
              {node.status !== "outside" && (
                <Badge size="xs" variant="light" color={STATUS_COLOR[node.status]}>
                  {t(STATUS_LABEL[node.status])}
                </Badge>
              )}
              <Text size="xs" c="dimmed" ml="auto">
                {t("Repertoire.Compare.Games", { count: node.games })}
              </Text>
              <Tooltip label={t("Repertoire.Compare.ScoreHint")} openDelay={300}>
                <Text size="xs" c="dimmed" w={40} ta="right">
                  {percent(node.score)}
                </Text>
              </Tooltip>
            </Group>
            {isOpen && <GameRows parent={node} depth={depth + 1} ctx={ctx} />}
          </Box>
        );
      })}
    </>
  );
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
  const navigate = useNavigate();
  const setTabs = useSetAtom(tabsAtom);
  const setActiveTab = useSetAtom(activeTabAtom);
  const [minGames, setMinGames] = useState(2);
  const [expanded, setExpanded] = useState(() => new Set<string>());
  const { data: ownAvailable } = useSWR("own-games-available", hasOwnGames);

  const { root } = repertoire;
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
        (fen) => ownMoveCounts(fen, repertoire.color),
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

  const openLine = useCallback(
    async (line: string[]) => {
      const tree = defaultTree(root.fen);
      await createTab({
        tab: { name: lineText(line, root.halfMoves), type: "analysis" },
        setTabs,
        setActiveTab,
        pgn: `${lineText(line, root.halfMoves, "...")} *`,
        headers: { ...tree.headers, orientation: repertoire.color },
        position: line.map(() => 0),
      });
      navigate({ to: "/" });
    },
    [root, repertoire.color, setTabs, setActiveTab, navigate],
  );

  const ctx: CompareContext = { repertoire, minGames, expanded, toggle, openLine };
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
              <Text fw={600} size="sm" mb="xs">
                {t("Repertoire.Compare.GamesTree")}
              </Text>
              <GameRows parent={rootNode} depth={0} ctx={ctx} />
            </Paper>
          </>
        )}
      </Stack>
    </ScrollArea>
  );
}
