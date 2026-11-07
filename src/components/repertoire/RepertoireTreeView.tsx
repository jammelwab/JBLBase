import {
  ActionIcon,
  Alert,
  Box,
  Button,
  Group,
  Paper,
  ScrollArea,
  Stack,
  Text,
  Title,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { IconArrowLeft, IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import { useSetAtom } from "jotai";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import useSWR from "swr";
import { activeTabAtom, tabsAtom } from "@/state/atoms";
import { updatePersistedState } from "@/state/store/debouncedStorage";
import { openFile } from "@/utils/files";
import {
  hasLichessToken,
  hasOwnGames,
  lichessMoveCounts,
  ownMoveCounts,
} from "@/utils/repertoireExplorer";
import { moveShares } from "@/utils/repertoireTree";
import { MAIN_OWNER, type Repertoire } from "@/utils/repertoires";
import type { TreeNode, TreeState } from "@/utils/treeReducer";
import { ColorDot } from "./RepertoireLabel";

const LICHESS_COLOR = "var(--mantine-color-blue-5)";
const OWN_COLOR = "var(--mantine-color-teal-5)";
const INDENT = 22;

function percent(value: number) {
  if (value > 0 && value < 0.01) return "<1 %";
  return `${Math.round(value * 100)} %`;
}

function ShareBar({
  value,
  color,
  label,
}: {
  value: number | undefined;
  color: string;
  label: string;
}) {
  return (
    <Tooltip label={label} openDelay={300}>
      <Group gap={4} wrap="nowrap" w={92}>
        <Box
          w={52}
          h={6}
          style={{ borderRadius: 3, background: "var(--mantine-color-default-border)" }}
        >
          {value !== undefined && (
            <Box
              h="100%"
              w={`${Math.max(value * 100, value > 0 ? 3 : 0)}%`}
              style={{ borderRadius: 3, background: color }}
            />
          )}
        </Box>
        <Text size="xs" c="dimmed" w={36} ta="right">
          {value === undefined ? "–" : percent(value)}
        </Text>
      </Group>
    </Tooltip>
  );
}

function moveLabel(node: TreeNode) {
  const number = Math.ceil(node.halfMoves / 2);
  return node.halfMoves % 2 === 1 ? `${number}. ${node.san}` : `${number}… ${node.san}`;
}

type TreeContext = {
  repertoire: Repertoire;
  showOwn: boolean;
  showLichess: boolean;
  expanded: Set<string>;
  toggle: (key: string) => void;
  open: (path: number[]) => void;
};

function Bars({
  lichess,
  own,
  ctx,
}: {
  lichess: number | undefined;
  own: number | undefined;
  ctx: TreeContext;
}) {
  const { t } = useTranslation();
  return (
    <Group gap="xs" wrap="nowrap" ml="auto">
      {ctx.showLichess && (
        <ShareBar value={lichess} color={LICHESS_COLOR} label={t("Repertoire.Tree.LichessBar")} />
      )}
      {ctx.showOwn && (
        <ShareBar value={own} color={OWN_COLOR} label={t("Repertoire.Tree.OwnBar")} />
      )}
    </Group>
  );
}

// The moves from one position, with their bars, and below them what the repertoire lacks.
function Children({ parent, path, ctx }: { parent: TreeNode; path: number[]; ctx: TreeContext }) {
  const { t } = useTranslation();
  const { repertoire } = ctx;
  const { data: lichess } = useSWR(ctx.showLichess ? ["lichess-moves", parent.fen] : null, () =>
    lichessMoveCounts(parent.fen),
  );
  const { data: own } = useSWR(
    ctx.showOwn ? ["own-moves", repertoire.color, parent.fen] : null,
    () => ownMoveCounts(parent.fen, repertoire.color),
  );

  const sans = useMemo(() => parent.children.map((c) => c.san!), [parent]);
  const lichessShares = useMemo(() => lichess && moveShares(lichess, sans), [lichess, sans]);
  const ownShares = useMemo(() => own && moveShares(own, sans), [own, sans]);

  const sideToMove = parent.halfMoves % 2 === 0 ? "white" : "black";
  const opponentMoves = sideToMove !== repertoire.color;
  const depth = path.length;

  return (
    <>
      {parent.children.map((child, i) => {
        const childPath = [...path, i];
        const key = childPath.join(",");
        const isOpen = ctx.expanded.has(key);
        const mine = child.halfMoves % 2 === (repertoire.color === "white" ? 1 : 0);
        return (
          <Box key={key}>
            <Group gap={4} wrap="nowrap" pl={depth * INDENT} py={2} style={{ borderRadius: 4 }}>
              {child.children.length > 0 ? (
                <ActionIcon size="sm" variant="subtle" color="gray" onClick={() => ctx.toggle(key)}>
                  {isOpen ? <IconChevronDown size="0.9rem" /> : <IconChevronRight size="0.9rem" />}
                </ActionIcon>
              ) : (
                <Box w={22} />
              )}
              <UnstyledButton onClick={() => ctx.open(childPath)}>
                <Text size="sm" fw={mine ? 700 : 400} c={mine ? undefined : "dimmed"}>
                  {moveLabel(child)}
                  {child.annotations.join("")}
                </Text>
              </UnstyledButton>
              {!isOpen && child.children.length > 0 && (
                <Text size="xs" c="dimmed">
                  ({t("Repertoire.MoveCount", { count: countMoves(child) })})
                </Text>
              )}
              <Bars
                lichess={lichessShares?.shares.get(child.san!)}
                own={ownShares?.shares.get(child.san!)}
                ctx={ctx}
              />
            </Group>
            {isOpen && <Children parent={child} path={childPath} ctx={ctx} />}
          </Box>
        );
      })}

      {opponentMoves && ctx.showOwn && ownShares && ownShares.other > 0 && (
        <Group gap={4} wrap="nowrap" pl={depth * INDENT + 26} py={2}>
          <Text size="sm" c="dimmed" fs="italic">
            {t("Repertoire.Tree.Other")}
          </Text>
          <Bars lichess={lichessShares?.other} own={ownShares.other} ctx={ctx} />
        </Group>
      )}

      {opponentMoves && lichessShares?.topMissing && (
        <Tooltip label={t("Repertoire.Tree.MissingHint")} openDelay={300}>
          <UnstyledButton
            onClick={() => ctx.open(path)}
            display="block"
            w="100%"
            pl={depth * INDENT + 26}
            py={2}
            style={{ opacity: 0.45 }}
          >
            <Group gap={6} wrap="nowrap">
              <Text size="sm" style={{ textDecoration: "underline dashed" }}>
                {moveLabel({
                  ...parent,
                  san: lichessShares.topMissing.san,
                  halfMoves: parent.halfMoves + 1,
                })}
              </Text>
              <Text size="xs">{t("Repertoire.Tree.Missing")}</Text>
              <Bars
                lichess={lichessShares.topMissing.share}
                own={
                  own
                    ? moveShares(own, [lichessShares.topMissing.san]).shares.get(
                        lichessShares.topMissing.san,
                      )
                    : undefined
                }
                ctx={ctx}
              />
            </Group>
          </UnstyledButton>
        </Tooltip>
      )}
    </>
  );
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
  return allKeys(root).filter((k) => k.split(",").length <= 2);
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
  const { data: ownAvailable } = useSWR("own-games-available", hasOwnGames);

  const showLichess = hasLichessToken();
  const showOwn = repertoire.owner === MAIN_OWNER && !!ownAvailable;

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

  const ctx: TreeContext = { repertoire, showOwn, showLichess, expanded, toggle, open };

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

      <Paper withBorder p="sm" flex={1} style={{ minHeight: 0 }}>
        <ScrollArea h="100%">
          {repertoire.root.children.length === 0 ? (
            <Text c="dimmed" size="sm">
              {t("Repertoire.Tree.Empty")}
            </Text>
          ) : (
            <Children parent={repertoire.root} path={[]} ctx={ctx} />
          )}
        </ScrollArea>
      </Paper>
    </Stack>
  );
}
