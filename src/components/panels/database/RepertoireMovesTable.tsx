import { Badge, Group, Progress, Select, Stack, Text, Tooltip } from "@mantine/core";
import { useLoaderData } from "@tanstack/react-router";
import { useAtom } from "jotai";
import { DataTable } from "mantine-datatable";
import { memo, useContext, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import { ColorDot } from "@/components/repertoire/RepertoireLabel";
import { repertoireDbSourceAtom } from "@/state/atoms";
import { addPieceSymbol } from "@/utils/annotation";
import { moveNotationTypeAtom } from "@/state/atoms";
import { repertoireMovesAt, repertoireWeights } from "@/utils/repertoireTree";
import { type Repertoire, useMainOwner, useRepertoires } from "@/utils/repertoires";

const MINE = "mine";

// Weights are worked out once per repertoire tree, not on every move
const weightsCache = new WeakMap<object, Map<string, Map<string, number>>>();
function weightsOf(repertoire: Repertoire) {
  let weights = weightsCache.get(repertoire.root);
  if (!weights) {
    weights = repertoireWeights(repertoire.root);
    weightsCache.set(repertoire.root, weights);
  }
  return weights;
}

function repertoireLabel(r: Repertoire, mainOwner: string) {
  const folder = r.folder ? `${r.folder.replaceAll("/", " › ")} › ` : "";
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
  const data = [
    { value: MINE, label: t("Board.Database.Repertoire.AllMine") },
    ...(repertoires ?? []).map((r) => ({
      value: r.file.path,
      label: repertoireLabel(r, mainOwner),
    })),
  ];
  return (
    <Select
      data={data}
      value={data.some((d) => d.value === source) ? source : MINE}
      onChange={(value) => setSource(value ?? MINE)}
      size="sm"
      flex={1}
      maw={240}
      allowDeselect={false}
      searchable
    />
  );
}

// Your repertoire as a "database": the moves it has in the current position, with the lines
// behind each move. A click plays the move.
function RepertoireMovesTable({ fen }: { fen: string }) {
  const { t } = useTranslation();
  const store = useContext(TreeStateContext)!;
  const makeMove = useStore(store, (s) => s.makeMove);
  const [moveNotationType] = useAtom(moveNotationTypeAtom);
  const { documentDir } = useLoaderData({ from: "/" });
  const { data: repertoires, isLoading } = useRepertoires(documentDir);
  const mainOwner = useMainOwner();
  const [source] = useAtom(repertoireDbSourceAtom);

  const chosen = useMemo(() => {
    const all = repertoires ?? [];
    const one = all.find((r) => r.file.path === source);
    return one ? [one] : all.filter((r) => r.owner === mainOwner);
  }, [repertoires, source, mainOwner]);

  const rows = useMemo(
    () =>
      repertoireMovesAt(
        chosen.map((r) => ({ name: r.name, color: r.color, weights: weightsOf(r) })),
        fen,
      ),
    [chosen, fen],
  );
  const total = rows.reduce((sum, r) => sum + r.lines, 0);

  if (!isLoading && chosen.length === 0) {
    return (
      <Text size="sm" c="dimmed" pt="sm">
        {t("Board.Database.Repertoire.NoRepertoires")}
      </Text>
    );
  }

  return (
    <DataTable
      withTableBorder
      highlightOnHover
      records={rows}
      fetching={isLoading}
      idAccessor="move"
      noRecordsText={t("Board.Database.Repertoire.NotInRepertoire")}
      minHeight={rows.length === 0 ? 120 : undefined}
      columns={[
        {
          accessor: "move",
          title: t("Board.Database.Repertoire.Move"),
          width: 90,
          render: ({ move }) => (
            <Text fz="sm" fw={600}>
              {moveNotationType === "symbols" ? addPieceSymbol(move) : move}
            </Text>
          ),
        },
        {
          accessor: "lines",
          title: t("Board.Database.Repertoire.Lines"),
          width: 170,
          render: ({ lines }) => (
            <Group gap="xs" wrap="nowrap">
              <Progress
                value={total > 0 ? (lines / total) * 100 : 0}
                color="green"
                size="md"
                flex={1}
              />
              <Text fz="sm" w={36} ta="right">
                {lines}
              </Text>
            </Group>
          ),
        },
        {
          accessor: "repertoires",
          title: t("Board.Database.Repertoire.In"),
          render: ({ repertoires: list }) => (
            <Group gap={4}>
              {list.map((r) => (
                <Tooltip key={r.name} label={r.name}>
                  <Badge
                    variant="default"
                    size="sm"
                    leftSection={<ColorDot color={r.color} />}
                    maw={180}
                    tt="none"
                  >
                    {r.name}
                  </Badge>
                </Tooltip>
              ))}
            </Group>
          ),
        },
      ]}
      onRowClick={({ record }) => makeMove({ payload: record.move })}
    />
  );
}

export function RepertoireNoGames() {
  const { t } = useTranslation();
  return (
    <Stack pt="sm">
      <Text size="sm" c="dimmed">
        {t("Board.Database.Repertoire.NoGames")}
      </Text>
    </Stack>
  );
}

export default memo(RepertoireMovesTable);
