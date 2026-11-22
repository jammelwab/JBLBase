import {
  ActionIcon,
  Box,
  Group,
  Loader,
  ScrollArea,
  Stack,
  Text,
  UnstyledButton,
} from "@mantine/core";
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import { useAtomValue } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import useSWR from "swr";
import { type BestMoves, commands } from "@/bindings";
import { enginesAtom } from "@/state/atoms";
import { enginePowerAtom, engineOptions } from "@/utils/enginePower";
import type { LocalEngine } from "@/utils/engines";
import { hasLichessToken, lichessMoveCounts } from "@/utils/repertoireExplorer";
import { formatScore } from "@/utils/score";
import type { TreeNode } from "@/utils/treeReducer";
import { lineText } from "./coachLines";

// Werkzeuge beim Ausprobieren im Linien-Assistenten (1.2.18): Repertoire-Baum,
// Engine mit den besten Zügen und die meistgespielten Züge auf Lichess.

export type LineTool = "tree" | "engine" | "lichess";
export const coachLineToolsAtom = atomWithStorage<LineTool[]>("jbl-coach-line-tools", ["tree"]);

// ---------- Repertoire-Baum ----------

function TreeRow({
  node,
  moves,
  current,
  open,
  toggle,
  onPick,
}: {
  node: TreeNode;
  moves: string[];
  current: string[];
  open: Set<string>;
  toggle: (key: string) => void;
  onPick: (moves: string[]) => void;
}) {
  const key = moves.join(" ");
  const onLine = moves.length <= current.length && moves.every((m, i) => current[i] === m);
  const isCurrent = onLine && moves.length === current.length;
  const expanded = open.has(key);
  const hasChildren = node.children.length > 0;
  return (
    <Box>
      <Group gap={2} wrap="nowrap" pl={Math.min(moves.length - 1, 12) * 12}>
        <ActionIcon
          size="xs"
          variant="transparent"
          color="gray"
          disabled={!hasChildren}
          onClick={() => toggle(key)}
          aria-label={key}
        >
          {hasChildren ? (
            expanded ? (
              <IconChevronDown size={12} />
            ) : (
              <IconChevronRight size={12} />
            )
          ) : null}
        </ActionIcon>
        <UnstyledButton onClick={() => onPick(moves)}>
          <Text
            size="sm"
            fw={isCurrent ? 700 : onLine ? 600 : 400}
            c={isCurrent ? "orange" : onLine ? undefined : "dimmed"}
          >
            {lineText([moves.at(-1)!], moves.length - 1)}
          </Text>
        </UnstyledButton>
      </Group>
      {expanded &&
        node.children.map((child) =>
          child.san ? (
            <TreeRow
              key={child.san}
              node={child}
              moves={[...moves, child.san]}
              current={current}
              open={open}
              toggle={toggle}
              onPick={onPick}
            />
          ) : null,
        )}
    </Box>
  );
}

export function RepertoireTreePanel({
  root,
  current,
  onPick,
}: {
  root: TreeNode;
  current: string[];
  onPick: (moves: string[]) => void;
}) {
  const { t } = useTranslation();
  // Aufgeklappt ist der Weg zur aktuellen Stellung, dazu was man selbst
  // auf- oder zuklappt
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const onPath = new Set(current.map((_, i) => current.slice(0, i + 1).join(" ")));
  const open = new Set([...opened, ...[...onPath].filter((k) => !closed.has(k))]);
  const flip = (set: Set<string>, key: string, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(key);
    else next.delete(key);
    return next;
  };
  const toggle = (key: string) => {
    const isOpen = open.has(key);
    setOpened((prev) => flip(prev, key, !isOpen));
    setClosed((prev) => flip(prev, key, isOpen));
  };
  if (root.children.length === 0)
    return (
      <Text size="sm" c="dimmed">
        {t("Coach.NewLine.Tools.TreeEmpty")}
      </Text>
    );
  return (
    <ScrollArea.Autosize mah={240} type="auto">
      <Stack gap={0}>
        {root.children.map((child) =>
          child.san ? (
            <TreeRow
              key={child.san}
              node={child}
              moves={[child.san]}
              current={current}
              open={open}
              toggle={toggle}
              onPick={onPick}
            />
          ) : null,
        )}
      </Stack>
    </ScrollArea.Autosize>
  );
}

// ---------- Engine ----------

const ENGINE_DEPTH = 16;
let runs = 0;

type EngineState =
  | { state: "calculating"; engine: string }
  | { state: "done"; engine: string; lines: BestMoves[] }
  | { state: "none"; reason: "noEngine" | "failed" };

function useTopMoves(fen: string): EngineState {
  const engines = useAtomValue(enginesAtom);
  const power = useAtomValue(enginePowerAtom);
  const engine = useMemo(() => {
    const local = (engines ?? []).filter((e): e is LocalEngine => e.type === "local");
    return local.find((e) => /stockfish/i.test(e.name)) ?? local[0] ?? null;
  }, [engines]);
  const [result, setResult] = useState<{ fen: string; value: EngineState } | null>(null);

  useEffect(() => {
    if (!engine) return;
    let cancelled = false;
    const runId = `coach_line_${++runs}`;
    let started = false;
    const timer = setTimeout(async () => {
      started = true;
      const options = engineOptions(engine.settings ?? undefined, power).filter(
        (o) => o.name !== "MultiPV",
      );
      const res = await commands
        .analyzeGame(
          runId,
          engine.path,
          { t: "Depth", c: ENGINE_DEPTH },
          { fen, moves: [], annotateNovelties: false, referenceDb: null, reversed: false },
          [...options, { name: "MultiPV", value: "3" }],
        )
        .catch(() => null);
      if (cancelled) return;
      const lines = res?.status === "ok" ? (res.data[0]?.best ?? []) : [];
      setResult({
        fen,
        value: lines.length
          ? { state: "done", engine: engine.name, lines }
          : { state: "none", reason: "failed" },
      });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (started) commands.cancelAnalysis(runId).catch(() => {});
    };
  }, [fen, engine, power]);

  if (!engine) return { state: "none", reason: "noEngine" };
  return result?.fen === fen ? result.value : { state: "calculating", engine: engine.name };
}

export function EnginePanel({ fen, onPlay }: { fen: string; onPlay: (san: string) => void }) {
  const { t } = useTranslation();
  const state = useTopMoves(fen);
  if (state.state === "none")
    return (
      <Text size="sm" c="dimmed">
        {state.reason === "noEngine"
          ? t("Coach.NewLine.Tools.NoEngine")
          : t("Coach.NewLine.Tools.EngineFailed")}
      </Text>
    );
  if (state.state === "calculating")
    return (
      <Group gap="xs">
        <Loader size="xs" />
        <Text size="sm" c="dimmed">
          {t("Coach.NewLine.Tools.Calculating", { engine: state.engine })}
        </Text>
      </Group>
    );
  return (
    <Stack gap={4}>
      {state.lines.slice(0, 3).map((line) => {
        const san = line.sanMoves[0];
        if (!san) return null;
        return (
          <UnstyledButton key={`${line.multipv}-${san}`} onClick={() => onPlay(san)}>
            <Group gap="sm" wrap="nowrap">
              <Text size="sm" fw={700} w={56} ta="right" ff="monospace">
                {formatScore(line.score.value)}
              </Text>
              <Text size="sm" fw={600}>
                {san}
              </Text>
              <Text size="xs" c="dimmed" truncate>
                {line.sanMoves.slice(1, 5).join(" ")}
              </Text>
            </Group>
          </UnstyledButton>
        );
      })}
      <Text size="xs" c="dimmed">
        {t("Coach.NewLine.Tools.EngineNote", {
          engine: state.engine,
          depth: state.lines[0]?.depth ?? ENGINE_DEPTH,
        })}
      </Text>
    </Stack>
  );
}

// ---------- Lichess ----------

export function LichessPanel({ fen, onPlay }: { fen: string; onPlay: (san: string) => void }) {
  const { t } = useTranslation();
  const enabled = hasLichessToken();
  const { data, error, isLoading } = useSWR(enabled ? ["coach-line-lichess", fen] : null, () =>
    lichessMoveCounts(fen),
  );
  if (!enabled)
    return (
      <Text size="sm" c="dimmed">
        {t("Coach.NewLine.Tools.NoLichess")}
      </Text>
    );
  if (isLoading) return <Loader size="xs" />;
  if (error)
    return (
      <Text size="sm" c="dimmed">
        {t("Coach.NewLine.Tools.LichessFailed")}
      </Text>
    );
  const total = (data ?? []).reduce((sum, c) => sum + c.games, 0);
  const top = [...(data ?? [])].sort((a, b) => b.games - a.games).slice(0, 3);
  if (total === 0)
    return (
      <Text size="sm" c="dimmed">
        {t("Coach.NewLine.Tools.NoGames")}
      </Text>
    );
  return (
    <Stack gap={4}>
      {top.map((c) => (
        <UnstyledButton key={c.san} onClick={() => onPlay(c.san)}>
          <Group gap="sm" wrap="nowrap">
            <Text size="sm" fw={700} w={56} ta="right">
              {Math.round((c.games / total) * 100)} %
            </Text>
            <Text size="sm" fw={600}>
              {c.san}
            </Text>
            <Text size="xs" c="dimmed">
              {t("Coach.NewLine.Tools.Games", { count: c.games })}
            </Text>
          </Group>
        </UnstyledButton>
      ))}
    </Stack>
  );
}
