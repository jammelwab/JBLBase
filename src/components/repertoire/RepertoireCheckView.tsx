import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Paper,
  Progress,
  ScrollArea,
  Select,
  Stack,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconArrowLeft, IconBulb, IconChessKnight, IconPlus } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import { useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { activeTabAtom, tabsAtom } from "@/state/atoms";
import { updatePersistedState } from "@/state/store/debouncedStorage";
import { openFile } from "@/utils/files";
import { lineText, lineTree } from "@/utils/gamesTree";
import { hasLichessToken, lichessMoveCounts } from "@/utils/repertoireExplorer";
import { findGaps, mostPlayed, type RepertoireGap } from "@/utils/repertoireGaps";
import type { MoveCount } from "@/utils/repertoireTree";
import { addLineToRepertoire, type Repertoire } from "@/utils/repertoires";
import type { TreeNode, TreeState } from "@/utils/treeReducer";
import { ColorDot } from "./RepertoireLabel";
import { useOpenLine } from "./useOpenLine";
import { usePositionData } from "./usePositionData";

// How many positions the check asks Lichess about at most, and how many at a time
const REQUEST_LIMIT = 150;
const BATCH = 12;
const SHOWN = 40;

function percent(value: number) {
  if (value > 0 && value < 0.01) return "<1 %";
  return `${Math.round(value * 100)} %`;
}

// "3. Nf3" or "2… e6", for a move played after `halfMoves` half-moves
function numbered(halfMoves: number, san: string) {
  const number = Math.floor(halfMoves / 2) + 1;
  return halfMoves % 2 === 0 ? `${number}. ${san}` : `${number}… ${san}`;
}

function lastFen(rootFen: string, rootHalfMoves: number, line: string[]): string {
  let node: TreeNode = lineTree(rootFen, rootHalfMoves, line);
  while (node.children.length > 0) node = node.children[0];
  return node.fen;
}

const gapId = (gap: RepertoireGap) => `${gap.line.join(" ")}|${gap.move ?? ""}`;

// Help while building a repertoire: where it has gaps, ordered by how often a game gets there,
// with the next step on top. Gaps are opponent moves that are often played (Lichess) but have
// no line yet, and lines that stop after an opponent move.
export default function RepertoireCheckView({
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
  const { root, color } = repertoire;
  const [minShare, setMinShare] = useState("0.05");
  const [maxMoves, setMaxMoves] = useState("10");
  const [adding, setAdding] = useState<string | null>(null);
  const showLichess = hasLichessToken();

  const [requested, setRequested] = useState<string[]>([]);
  const counts = usePositionData<MoveCount[]>(requested, lichessMoveCounts, showLichess);
  const scan = useMemo(
    () =>
      findGaps(root, counts, {
        color,
        minShare: Number(minShare),
        maxDepth: Number(maxMoves) * 2,
      }),
    [root, counts, color, minShare, maxMoves],
  );
  const pending = requested.filter((fen) => !counts.has(fen)).length;

  // Asks for the next positions once the last ones are in: the most reached first, so the
  // numbers that matter most come first and the list gets more exact step by step
  useEffect(() => {
    if (!showLichess || pending >= 3 || requested.length >= REQUEST_LIMIT) return;
    const have = new Set(requested);
    const more = scan.wanted
      .filter((w) => !have.has(w.fen) && w.reach >= 0.003)
      .slice(0, BATCH)
      .map((w) => w.fen);
    if (more.length > 0) setRequested((prev) => [...prev, ...more].slice(0, REQUEST_LIMIT));
  }, [showLichess, pending, requested, scan]);

  const openLine = useOpenLine(root.fen, root.halfMoves, color);
  // Opens the repertoire itself at the gap, so the moves played there go right into it
  const openAt = useCallback(
    async (gap: RepertoireGap) => {
      if (repertoire.parts) {
        await openLine(gap.move ? [...gap.line, gap.move] : gap.line);
        return;
      }
      const id = await openFile(repertoire.file, setTabs, setActiveTab);
      updatePersistedState<TreeState>(id, (state) => ({ ...state, position: gap.path }));
      navigate({ to: "/" });
    },
    [repertoire, openLine, setTabs, setActiveTab, navigate],
  );

  // Takes the gap into the repertoire: the missing opponent move and the move played most
  // often after it, or the most played answer where the user has no move yet
  async function addGap(gap: RepertoireGap) {
    setAdding(gapId(gap));
    try {
      let line = gap.move ? [...gap.line, gap.move] : gap.line;
      const after = gap.move
        ? await lichessMoveCounts(lastFen(root.fen, root.halfMoves, line)).catch(() => undefined)
        : counts.get(gap.fen);
      const best = mostPlayed(after);
      if (best) line = [...line, best.san];
      if (line.length === 0) return;
      const result = await addLineToRepertoire(
        repertoire.file,
        lineTree(root.fen, root.halfMoves, line),
        line.map(() => 0),
        { withVariations: false, label: t("Repertoire.Check.Source") },
      );
      if (!result.ok) throw new Error(t("Repertoire.Add.DifferentStart"));
      notifications.show({
        color: "green",
        title: repertoire.name,
        message: t("Repertoire.Check.Added", { line: lineText(line, root.halfMoves) }),
      });
    } catch (e) {
      notifications.show({
        color: "red",
        title: t("Repertoire.Add.Failed"),
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setAdding(null);
    }
  }

  const describe = (gap: RepertoireGap) => {
    if (gap.kind === "extend") {
      const move = numbered(root.halfMoves + gap.line.length, gap.move!);
      return t("Repertoire.Check.ExtendText", { where: lineText(gap.line, root.halfMoves), move });
    }
    if (gap.kind === "reply") {
      const move = numbered(root.halfMoves + gap.line.length, gap.move!);
      return gap.line.length === 0
        ? t("Repertoire.Check.ReplyAtStart", { move })
        : t("Repertoire.Check.ReplyText", { where: lineText(gap.line, root.halfMoves), move });
    }
    return gap.line.length === 0
      ? t("Repertoire.Check.FirstMove")
      : t("Repertoire.Check.AnswerText", { where: lineText(gap.line, root.halfMoves) });
  };
  const reachText = (gap: RepertoireGap) =>
    gap.exact && gap.line.length + (gap.move ? 1 : 0) > 0
      ? t("Repertoire.Check.Reach", { share: percent(gap.reach) })
      : t("Repertoire.Check.AtMove", {
          count: Math.floor((root.halfMoves + gap.line.length) / 2) + 1,
        });

  const top = scan.gaps[0];
  const topSuggestion = top?.kind === "answer" ? mostPlayed(counts.get(top.fen)) : null;
  const coverage = 1 - scan.leaking;

  return (
    <ScrollArea h="100%">
      <Stack gap="sm" maw={1000}>
        <Group justify="space-between" align="flex-end">
          <Group gap="sm">
            <ActionIcon
              variant="subtle"
              data-tour="rep-view-back"
              aria-label={t("Common.Back")}
              onClick={onBack}
            >
              <IconArrowLeft size="1.2rem" />
            </ActionIcon>
            <ColorDot color={color} />
            <Title order={3}>{t("Repertoire.Check.Title", { name: repertoire.name })}</Title>
          </Group>
          <Group gap="sm" align="flex-end">
            <Select
              size="xs"
              w={170}
              allowDeselect={false}
              label={t("Repertoire.Check.MinShare")}
              data={["0.02", "0.05", "0.1", "0.2"].map((v) => ({
                value: v,
                label: t("Repertoire.Check.FromShare", { share: percent(Number(v)) }),
              }))}
              value={minShare}
              onChange={(v) => v && setMinShare(v)}
            />
            <Select
              size="xs"
              w={150}
              allowDeselect={false}
              label={t("Repertoire.Check.Depth")}
              data={["5", "10", "15", "25"].map((v) => ({
                value: v,
                label: t("Repertoire.Check.UpToMove", { count: Number(v) }),
              }))}
              value={maxMoves}
              onChange={(v) => v && setMaxMoves(v)}
            />
          </Group>
        </Group>
        <Text size="sm" c="dimmed">
          {t("Repertoire.Check.Help")}
        </Text>

        {!showLichess && (
          <Alert color="blue" variant="light" py="xs">
            <Text size="sm">{t("Repertoire.Check.NoLichess")}</Text>
          </Alert>
        )}

        {showLichess && (
          <Paper withBorder p="sm">
            <Group justify="space-between" mb={6}>
              <Text size="sm" fw={600}>
                {t("Repertoire.Check.Coverage", { share: percent(coverage) })}
              </Text>
              {pending > 0 && (
                <Group gap={6}>
                  <Loader size="xs" />
                  <Text size="xs" c="dimmed">
                    {t("Repertoire.Check.Loading", { count: counts.size })}
                  </Text>
                </Group>
              )}
            </Group>
            <Progress value={coverage * 100} color={coverage > 0.8 ? "green" : "yellow"} />
            <Text size="xs" c="dimmed" mt={6}>
              {t("Repertoire.Check.CoverageHint", { count: Number(maxMoves) })}
            </Text>
          </Paper>
        )}

        {top ? (
          <Paper withBorder p="md" bg="var(--mantine-primary-color-light)">
            <Group gap="xs" mb={6}>
              <IconBulb size="1.2rem" />
              <Text fw={600}>{t("Repertoire.Check.NextStep")}</Text>
            </Group>
            <Text size="sm">{describe(top)}</Text>
            <Text size="xs" c="dimmed" mb="sm">
              {reachText(top)}
              {topSuggestion &&
                ` · ${t("Repertoire.Check.Popular", {
                  move: topSuggestion.san,
                  share: percent(topSuggestion.share),
                })}`}
            </Text>
            <Text size="sm" mb="sm">
              {t(
                top.kind === "answer" ? "Repertoire.Check.AnswerHow" : "Repertoire.Check.ReplyHow",
              )}
            </Text>
            <Group gap="xs">
              <Button
                size="xs"
                leftSection={<IconChessKnight size="1rem" />}
                onClick={() => openAt(top)}
              >
                {t("Repertoire.Check.OpenBoard")}
              </Button>
              {!repertoire.parts && showLichess && (
                <Tooltip label={t("Repertoire.Check.AddSuggestionHint")} multiline w={280}>
                  <Button
                    size="xs"
                    variant="default"
                    leftSection={<IconPlus size="1rem" />}
                    loading={adding === gapId(top)}
                    onClick={() => addGap(top)}
                  >
                    {t("Repertoire.Check.AddSuggestion")}
                  </Button>
                </Tooltip>
              )}
            </Group>
          </Paper>
        ) : (
          pending === 0 && (
            <Alert color="green" variant="light">
              {t("Repertoire.Check.NoGaps")}
            </Alert>
          )
        )}

        {scan.gaps.length > 1 && (
          <Stack gap={6}>
            <Text fw={600} size="sm">
              {t("Repertoire.Check.AllGaps", { count: scan.gaps.length })}
            </Text>
            {scan.gaps.slice(1, SHOWN).map((gap) => {
              const suggestion = gap.kind === "answer" ? mostPlayed(counts.get(gap.fen)) : null;
              return (
                <Paper key={gapId(gap)} withBorder p="xs">
                  <Group justify="space-between" wrap="nowrap">
                    <Stack gap={2} style={{ minWidth: 0 }}>
                      <Group gap="xs" wrap="nowrap">
                        <Badge
                          size="sm"
                          variant="light"
                          color={
                            gap.kind === "reply"
                              ? "orange"
                              : gap.kind === "answer"
                                ? "yellow"
                                : "blue"
                          }
                          style={{ flexShrink: 0 }}
                        >
                          {t(
                            gap.kind === "reply"
                              ? "Repertoire.Check.KindReply"
                              : gap.kind === "answer"
                                ? "Repertoire.Check.KindAnswer"
                                : "Repertoire.Check.KindExtend",
                          )}
                        </Badge>
                        <Text size="sm" truncate="end">
                          {describe(gap)}
                        </Text>
                      </Group>
                      <Text size="xs" c="dimmed">
                        {reachText(gap)}
                        {suggestion &&
                          ` · ${t("Repertoire.Check.Popular", {
                            move: suggestion.san,
                            share: percent(suggestion.share),
                          })}`}
                      </Text>
                    </Stack>
                    <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
                      <Tooltip label={t("Repertoire.Check.OpenBoard")}>
                        <ActionIcon
                          variant="subtle"
                          aria-label={t("Repertoire.Check.OpenBoard")}
                          onClick={() => openAt(gap)}
                        >
                          <IconChessKnight size="1rem" />
                        </ActionIcon>
                      </Tooltip>
                      {!repertoire.parts && showLichess && (
                        <Tooltip label={t("Repertoire.Check.AddSuggestionHint")} multiline w={280}>
                          <ActionIcon
                            variant="subtle"
                            color="green"
                            aria-label={t("Repertoire.Check.AddSuggestion")}
                            loading={adding === gapId(gap)}
                            onClick={() => addGap(gap)}
                          >
                            <IconPlus size="1rem" />
                          </ActionIcon>
                        </Tooltip>
                      )}
                    </Group>
                  </Group>
                </Paper>
              );
            })}
          </Stack>
        )}
      </Stack>
    </ScrollArea>
  );
}
