import { Button, Group, Modal, Paper, SimpleGrid, Stack, Table, Text } from "@mantine/core";
import dayjs from "dayjs";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import { accuracyPercent } from "@/utils/puzzleStats";
import ConfirmModal from "../common/ConfirmModal";
import { resetPuzzleStats, usePuzzleStats } from "./usePuzzleStats";

function Tile({ label, value }: { label: string; value: string | number }) {
  return (
    <Paper withBorder p="xs">
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text fw={700} size="lg">
        {value}
      </Text>
    </Paper>
  );
}

function PuzzleStatsModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const stats = usePuzzleStats();
  const [confirmReset, setConfirmReset] = useState(false);

  const accuracy = accuracyPercent(stats);
  const avgTime = stats.attempts > 0 ? stats.timeMs / stats.attempts / 1000 : null;
  const history = stats.history.map((point, i) => ({ n: i + 1, elo: point.elo }));
  const lastStreaks = stats.streaks.slice(-10).reverse();

  return (
    <Modal opened={opened} onClose={onClose} title={t("Puzzle.Stats.Title")} size="lg">
      <ConfirmModal
        title={t("Puzzle.Stats.Reset")}
        description={t("Puzzle.Stats.ResetDesc")}
        opened={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={async () => {
          await resetPuzzleStats();
          setConfirmReset(false);
        }}
      />
      <Stack gap="md">
        <SimpleGrid cols={4} spacing="sm">
          <Tile label={t("Puzzle.Elo")} value={stats.elo} />
          <Tile label={t("Puzzle.Stats.PeakElo")} value={stats.peakElo} />
          <Tile label={t("Puzzle.Stats.BestStreak")} value={stats.bestStreak} />
          <Tile label={t("Puzzle.Stats.CurrentStreak")} value={stats.run.length} />
          <Tile label={t("Puzzle.Stats.Attempts")} value={stats.attempts} />
          <Tile label={t("Puzzle.Stats.Solved")} value={stats.solved} />
          <Tile label={t("Puzzle.Accuracy")} value={accuracy !== null ? `${accuracy}%` : "-"} />
          <Tile
            label={t("Puzzle.AvgTime")}
            value={avgTime !== null ? `${avgTime.toFixed(1)}s` : "-"}
          />
        </SimpleGrid>

        {history.length > 1 && (
          <div>
            <Text fw={600} mb="xs">
              {t("Puzzle.Stats.EloHistory")}
            </Text>
            <div style={{ height: 180 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={history} margin={{ top: 8, right: 8, bottom: 0, left: -10 }}>
                  <CartesianGrid
                    stroke="var(--mantine-color-default-border)"
                    strokeOpacity={0.5}
                    vertical={false}
                  />
                  <YAxis
                    domain={[
                      (min: number) => Math.floor(min / 50) * 50,
                      (max: number) => Math.ceil(max / 50) * 50,
                    ]}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 11 }}
                  />
                  <Tooltip
                    labelFormatter={() => ""}
                    contentStyle={{
                      backgroundColor: "var(--mantine-color-body)",
                      border: "1px solid var(--mantine-color-default-border)",
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="elo"
                    name={t("Puzzle.Elo")}
                    stroke="var(--mantine-primary-color-filled)"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {lastStreaks.length > 0 && (
          <div>
            <Text fw={600} mb="xs">
              {t("Puzzle.Stats.LastStreaks")}
            </Text>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t("Puzzle.Stats.Date")}</Table.Th>
                  <Table.Th>{t("Puzzle.Streak")}</Table.Th>
                  <Table.Th>{t("Puzzle.Stats.TopRating")}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {lastStreaks.map((streak, i) => (
                  <Table.Tr key={`${streak.date}-${i}`}>
                    <Table.Td>{dayjs(streak.date).format("DD.MM.YYYY HH:mm")}</Table.Td>
                    <Table.Td>{streak.length}</Table.Td>
                    <Table.Td>{streak.topRating || "-"}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </div>
        )}

        <Group justify="space-between">
          <Text size="xs" c="dimmed">
            {t("Puzzle.Stats.Stored")}
          </Text>
          <Button
            variant="subtle"
            color="red"
            size="xs"
            disabled={stats.attempts === 0}
            onClick={() => setConfirmReset(true)}
          >
            {t("Puzzle.Stats.Reset")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export default PuzzleStatsModal;
