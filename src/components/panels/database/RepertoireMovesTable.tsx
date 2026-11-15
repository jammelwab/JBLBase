import { Box, Group, Progress, Select, Text, Tooltip } from "@mantine/core";
import { IconCheck, IconPinFilled } from "@tabler/icons-react";
import { useLoaderData } from "@tanstack/react-router";
import { useAtom } from "jotai";
import { DataTable } from "mantine-datatable";
import { memo, useContext, useMemo } from "react";
import useSWR from "swr";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import { moveNotationTypeAtom, repertoireDbSourceAtom } from "@/state/atoms";
import { addPieceSymbol } from "@/utils/annotation";
import { formatNumber } from "@/utils/format";
import { combineTrees, findMainRepertoire, folderLabel } from "@/utils/repertoireFolders";
import { lichessMoveCounts, masterMoveCounts } from "@/utils/repertoireExplorer";
import {
  explorerHints,
  positionKey,
  type RepertoireMoveRow,
  repertoireMovesAt,
  repertoireWeights,
  topMove,
} from "@/utils/repertoireTree";
import {
  DEFAULT_MAIN_OWNER,
  type Repertoire,
  useMainOwner,
  useRepertoires,
} from "@/utils/repertoires";
import type { TreeNode } from "@/utils/treeReducer";

const MINE = "mine";

export const LICHESS_DOT = "var(--mantine-color-blue-5)";
export const MASTER_DOT = "var(--mantine-color-red-6)";

function Dot({ color, label }: { color: string; label: string }) {
  return (
    <Tooltip label={label}>
      <Box w={8} h={8} bg={color} style={{ borderRadius: "50%", flexShrink: 0 }} />
    </Tooltip>
  );
}

// The most played move on Lichess and in the masters database, per position
export function useExplorerTops(fen: string, enabled = true) {
  const { data: lichess } = useSWR(enabled ? ["explorer-lichess", fen] : null, () =>
    lichessMoveCounts(fen),
  );
  const { data: master } = useSWR(enabled ? ["explorer-master", fen] : null, () =>
    masterMoveCounts(fen),
  );
  return { lichess, master, lichessTop: topMove(lichess), masterTop: topMove(master) };
}

// Weights are worked out once per repertoire tree, not on every move
const weightsCache = new WeakMap<TreeNode, Map<string, Map<string, number>>>();
function weightsOf(root: TreeNode) {
  let weights = weightsCache.get(root);
  if (!weights) {
    weights = repertoireWeights(root);
    weightsCache.set(root, weights);
  }
  return weights;
}

function repertoireLabel(r: Repertoire, mainOwner: string) {
  const folder = r.folder ? `${folderLabel(r.folder)} › ` : "";
  const owner = r.owner === mainOwner ? "" : ` (${r.owner})`;
  return `${folder}${r.name}${owner}`;
}

// The selector for the database panel's header: all of your own repertoires or one of them
export function RepertoireSourceSelect() {
  const { t } = useTranslation();
  const { documentDir } = useLoaderData({ from: "/" });
  const { data: repertoires } = useRepertoires(documentDir);
  const mainOwner = useMainOwner();
  const [source, setSource] = useAtom(repertoireDbSourceAtom);
  // Pinned at the top: all mine, then the main repertoires for White and Black.
  // The rest sorted by folder and name ("02_…" after "01_…").
  const { data, pinned } = useMemo(() => {
    const list = repertoires ?? [];
    const mains = (["white", "black"] as const)
      .map((color) => findMainRepertoire(list, mainOwner, color, [DEFAULT_MAIN_OWNER]))
      .filter((r): r is Repertoire => !!r);
    const byName = (r: Repertoire) => [r.folder, r.name].filter(Boolean).join("/");
    const rest = list
      .filter((r) => !mains.includes(r))
      .sort((a, b) => byName(a).localeCompare(byName(b), undefined, { numeric: true }));
    const option = (r: Repertoire) => ({
      value: r.file.path,
      label: repertoireLabel(r, mainOwner),
    });
    return {
      data: [
        { value: MINE, label: t("Board.Database.Repertoire.AllMine") },
        ...mains.map(option),
        ...rest.map(option),
      ],
      pinned: new Set([MINE, ...mains.map((r) => r.file.path)]),
    };
  }, [repertoires, mainOwner, t]);
  return (
    <Select
      data={data}
      renderOption={({ option, checked }) => (
        <Group gap={6} wrap="nowrap">
          {checked && <IconCheck size="0.9rem" style={{ flexShrink: 0 }} />}
          {pinned.has(option.value) && (
            <IconPinFilled
              size="0.9rem"
              color="var(--mantine-color-dimmed)"
              style={{ flexShrink: 0 }}
            />
          )}
          <Text
            size="sm"
            fw={pinned.has(option.value) ? 600 : undefined}
            style={{ wordBreak: "break-word" }}
          >
            {option.label}
          </Text>
        </Group>
      )}
      value={data.some((d) => d.value === source) ? source : MINE}
      onChange={(value) => setSource(value ?? MINE)}
      size="sm"
      flex={1}
      maw={240}
      comboboxProps={{ width: 360, position: "bottom-start" }}
      allowDeselect={false}
      searchable
    />
  );
}

// The repertoire moves in a position, with the lines behind each. "All mine" counts every
// line once, also when it is in several repertoires (the main repertoire has them all).
export function useRepertoireMoves(
  fen: string,
  enabled = true,
): { rows: RepertoireMoveRow[]; loading: boolean } {
  const { documentDir } = useLoaderData({ from: "/" });
  const { data: repertoires, isLoading } = useRepertoires(documentDir);
  const mainOwner = useMainOwner();
  const [source] = useAtom(repertoireDbSourceAtom);

  const chosen = useMemo(() => {
    const all = repertoires ?? [];
    const one = all.find((r) => r.file.path === source);
    return one ? [one] : all.filter((r) => r.owner === mainOwner);
  }, [repertoires, source, mainOwner]);
  const combined = useMemo(
    () =>
      !enabled
        ? undefined
        : chosen.length > 1
          ? combineTrees(chosen.map((r) => r.root))
          : chosen[0]?.root,
    [chosen, enabled],
  );

  const rows = useMemo(() => {
    if (!combined) return [];
    const key = positionKey(fen);
    return repertoireMovesAt([{ name: "", color: "white", weights: weightsOf(combined) }], fen).map(
      (row) => ({
        ...row,
        repertoires: chosen
          .filter((r) => weightsOf(r.root).get(key)?.has(row.move))
          .map((r) => ({ name: r.name, color: r.color })),
      }),
    );
  }, [combined, chosen, fen]);
  return { rows, loading: isLoading };
}

// Your repertoire as a database, shown like the other databases: the moves in the current
// position with their share. A click plays the move.
function RepertoireMovesTable({ fen }: { fen: string }) {
  const { t } = useTranslation();
  const store = useContext(TreeStateContext)!;
  const makeMove = useStore(store, (s) => s.makeMove);
  const [moveNotationType] = useAtom(moveNotationTypeAtom);
  const { rows, loading } = useRepertoireMoves(fen);
  const { lichessTop, masterTop } = useExplorerTops(fen);
  // A blue (Lichess) or red (masters) dot where the most played move isn't your main move
  const hints = explorerHints(
    rows.map((r) => r.move),
    { lichess: lichessTop, master: masterTop },
  );

  const grandTotal = rows.reduce((sum, r) => sum + r.lines, 0);
  const records = [
    ...rows.map((r) => ({ move: r.move, total: r.lines, repertoires: r.repertoires })),
    // Most played, but not in your repertoire
    ...hints.missing.map((move) => ({
      move,
      total: 0,
      repertoires: [] as (typeof rows)[0]["repertoires"],
    })),
  ];
  if (records.length > 0) records.push({ move: "Total", total: grandTotal, repertoires: [] });

  return (
    <DataTable
      withTableBorder
      highlightOnHover
      records={records}
      fetching={loading}
      idAccessor="move"
      rowStyle={(_, i) =>
        i === records.length - 1
          ? { fontWeight: 700, position: "sticky", bottom: 0, zIndex: 10 }
          : {}
      }
      columns={[
        {
          accessor: "move",
          width: 100,
          render: ({ move, total }) => (
            <Group gap={6} wrap="nowrap">
              <Text fz="sm" c={total === 0 && move !== "Total" ? "dimmed" : undefined}>
                {moveNotationType === "symbols" && move !== "Total" ? addPieceSymbol(move) : move}
              </Text>
              {hints.lichess === move && (
                <Dot color={LICHESS_DOT} label={t("Board.Database.Repertoire.LichessTop")} />
              )}
              {hints.master === move && (
                <Dot color={MASTER_DOT} label={t("Board.Database.Repertoire.MasterTop")} />
              )}
            </Group>
          ),
        },
        {
          accessor: "total",
          width: 180,
          render: ({ move, total }) => (
            <Group>
              {move !== "Total" && (
                <Text fz="sm">{grandTotal > 0 ? ((total / grandTotal) * 100).toFixed(0) : 0}%</Text>
              )}
              <Text fz="sm" flex={1} ta="right">
                {formatNumber(total)}
              </Text>
            </Group>
          ),
        },
        {
          accessor: "results",
          render: ({ move, total, repertoires }) => {
            if (move === "Total" || total === 0) return null;
            const percent = grandTotal > 0 ? (total / grandTotal) * 100 : 0;
            return (
              <Tooltip
                label={repertoires.map((r) => r.name).join(", ")}
                disabled={repertoires.length === 0}
                multiline
                maw={320}
              >
                <Progress.Root size="xl">
                  <Progress.Section value={percent} color="green">
                    <Progress.Label>{percent > 10 ? `${percent.toFixed(1)}%` : ""}</Progress.Label>
                  </Progress.Section>
                </Progress.Root>
              </Tooltip>
            );
          },
        },
      ]}
      onRowClick={({ record }) => {
        if (record.move !== "Total") makeMove({ payload: record.move });
      }}
    />
  );
}

export default memo(RepertoireMovesTable);
