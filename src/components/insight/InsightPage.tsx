import {
  Alert,
  Badge,
  Button,
  Group,
  NumberInput,
  Paper,
  Progress,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconChartBar,
  IconPlayerPlay,
  IconTargetArrow,
} from "@tabler/icons-react";
import { useAtom, useAtomValue } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import useSWR from "swr";
import {
  commands,
  type InsightGroup,
  type InsightRunResult,
  type InsightSummary,
} from "@/bindings";
import { useProgress } from "@/hooks/useProgress";
import { enginesAtom, sessionsAtom } from "@/state/atoms";
import { getDatabases } from "@/utils/db";
import type { LocalEngine } from "@/utils/engines";
import {
  DEFAULT_INSIGHT_DEPTH,
  gameTacticsPath,
  INSIGHT_DEPTHS,
  insightAccounts,
  monthLabel,
  moveNumber,
} from "@/utils/insight";
import { unwrap } from "@/utils/unwrap";
import {
  tooltipContentStyle,
  tooltipCursorStyle,
} from "../home/PersonalCardPanels/RatingsPanel.styles";

const PROGRESS_ID = "insight";

const insightSettingsAtom = atomWithStorage("insight-settings", {
  engine: "",
  depth: DEFAULT_INSIGHT_DEPTH as number,
  maxGames: 50 as number | null,
});

function percent(value: number) {
  return `${value.toFixed(1)} %`;
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Paper withBorder p="md">
      <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
        {label}
      </Text>
      <Text fz={28} fw={700} lh={1.2}>
        {value}
      </Text>
      {hint && (
        <Text size="xs" c="dimmed">
          {hint}
        </Text>
      )}
    </Paper>
  );
}

function GroupTable({
  title,
  groups,
  label,
}: {
  title: string;
  groups: InsightGroup[];
  label: (key: string) => string;
}) {
  const { t } = useTranslation();
  if (groups.length === 0) return null;
  return (
    <Paper withBorder p="md">
      <Text fw={600} mb="xs">
        {title}
      </Text>
      <Table verticalSpacing={4} fz="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th />
            <Table.Th ta="right">{t("Insight.Games")}</Table.Th>
            <Table.Th ta="right">{t("Insight.Accuracy")}</Table.Th>
            <Table.Th ta="right">{t("Insight.Score")}</Table.Th>
            <Table.Th ta="right">{t("Insight.BlundersPerGame")}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {groups.map((group) => (
            <Table.Tr key={group.key}>
              <Table.Td>{label(group.key)}</Table.Td>
              <Table.Td ta="right">{group.games}</Table.Td>
              <Table.Td ta="right">{percent(group.accuracy)}</Table.Td>
              <Table.Td ta="right">{percent(group.score)}</Table.Td>
              <Table.Td ta="right">{group.blunders.toFixed(2)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Paper>
  );
}

function Statistics({ summary }: { summary: InsightSummary }) {
  const { t } = useTranslation();
  const months = useMemo(
    () =>
      summary.byMonth.map((m) => ({
        month: monthLabel(m.key),
        accuracy: Math.round(m.accuracy * 10) / 10,
        games: m.games,
      })),
    [summary.byMonth],
  );
  const named = (prefix: string) => (key: string) => t(`${prefix}.${key}`, key);

  return (
    <Stack>
      <SimpleGrid cols={{ base: 2, md: 5 }}>
        <Tile label={t("Insight.Games")} value={summary.games.toString()} />
        <Tile label={t("Insight.Accuracy")} value={percent(summary.accuracy)} />
        <Tile label={t("Insight.OpponentAccuracy")} value={percent(summary.opponentAccuracy)} />
        <Tile
          label={t("Insight.Acpl")}
          value={summary.acpl.toFixed(0)}
          hint={t("Insight.AcplHint")}
        />
        <Tile
          label={t("Insight.MissedTactics")}
          value={summary.missedTactics.toString()}
          hint={t("Insight.MissedTacticsHint")}
        />
      </SimpleGrid>

      {months.length > 1 && (
        <Paper withBorder p="md">
          <Text fw={600} mb="xs">
            {t("Insight.AccuracyByMonth")}
          </Text>
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={months} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                <CartesianGrid
                  stroke="var(--mantine-color-default-border)"
                  strokeOpacity={0.5}
                  vertical={false}
                />
                <XAxis
                  dataKey="month"
                  axisLine={false}
                  tickLine={false}
                  minTickGap={40}
                  tick={{ fontSize: 11 }}
                  tickMargin={8}
                />
                <YAxis
                  domain={[
                    (min: number) => Math.max(0, Math.floor(min / 5) * 5 - 5),
                    (max: number) => Math.min(100, Math.ceil(max / 5) * 5),
                  ]}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11 }}
                />
                <Tooltip
                  contentStyle={tooltipContentStyle}
                  cursor={tooltipCursorStyle}
                  formatter={(value, _name, item) => [
                    `${value} % (${t("Insight.GamesCount", { count: item.payload.games })})`,
                    t("Insight.Accuracy"),
                  ]}
                />
                <Line
                  name={t("Insight.Accuracy")}
                  dataKey="accuracy"
                  stroke="var(--mantine-primary-color-4)"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Paper>
      )}

      <SimpleGrid cols={{ base: 1, lg: 2 }}>
        <Paper withBorder p="md">
          <Text fw={600} mb="xs">
            {t("Insight.ByPhase")}
          </Text>
          <Table verticalSpacing={4} fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th />
                <Table.Th ta="right">{t("Insight.Moves")}</Table.Th>
                <Table.Th ta="right">{t("Insight.Accuracy")}</Table.Th>
                <Table.Th ta="right">?!</Table.Th>
                <Table.Th ta="right">?</Table.Th>
                <Table.Th ta="right">??</Table.Th>
                <Table.Th ta="right">{t("Insight.BlundersPer100")}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {summary.phases.map((phase) => (
                <Table.Tr key={phase.phase}>
                  <Table.Td>{t(`Insight.Phase.${phase.phase}`, phase.phase)}</Table.Td>
                  <Table.Td ta="right">{phase.moves}</Table.Td>
                  <Table.Td ta="right">{percent(phase.accuracy)}</Table.Td>
                  <Table.Td ta="right">{phase.inaccuracies}</Table.Td>
                  <Table.Td ta="right">{phase.mistakes}</Table.Td>
                  <Table.Td ta="right">{phase.blunders}</Table.Td>
                  <Table.Td ta="right">
                    {phase.moves > 0 ? ((phase.blunders / phase.moves) * 100).toFixed(1) : "-"}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Paper>
        <GroupTable
          title={t("Insight.ByColor")}
          groups={summary.byColor}
          label={named("Insight.Color")}
        />
        <GroupTable
          title={t("Insight.BySpeed")}
          groups={summary.bySpeed}
          label={named("Insight.Speed")}
        />
        <GroupTable
          title={t("Insight.ByResult")}
          groups={summary.byResult}
          label={named("Insight.Result")}
        />
      </SimpleGrid>
      <GroupTable title={t("Insight.ByOpening")} groups={summary.byOpening} label={(key) => key} />

      {summary.worst.length > 0 && (
        <Paper withBorder p="md">
          <Text fw={600} mb="xs">
            {t("Insight.Worst")}
          </Text>
          <Table verticalSpacing={4} fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t("Insight.Game")}</Table.Th>
                <Table.Th>{t("Insight.Move")}</Table.Th>
                <Table.Th>{t("Insight.Played")}</Table.Th>
                <Table.Th>{t("Insight.Best")}</Table.Th>
                <Table.Th ta="right">{t("Insight.Loss")}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {summary.worst.map((error) => (
                <Table.Tr key={`${error.game}-${error.ply}`}>
                  <Table.Td>
                    {error.white} – {error.black}
                    <Text span c="dimmed" size="xs" ml={6}>
                      {error.date}
                    </Text>
                  </Table.Td>
                  <Table.Td>{moveNumber(error.ply)}</Table.Td>
                  <Table.Td>{error.played}</Table.Td>
                  <Table.Td>{error.best}</Table.Td>
                  <Table.Td ta="right">{percent(error.loss)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Paper>
      )}
    </Stack>
  );
}

export default function InsightPage() {
  const { t } = useTranslation();
  const sessions = useAtomValue(sessionsAtom);
  const engines = useAtomValue(enginesAtom);
  const localEngines = useMemo(
    () => (engines ?? []).filter((e): e is LocalEngine => e.type === "local"),
    [engines],
  );
  const [settings, setSettings] = useAtom(insightSettingsAtom);
  const engine = localEngines.find((e) => e.id === settings.engine) ?? localEngines[0];

  const { data: databases } = useSWR("insight-databases", getDatabases);
  const accounts = useMemo(() => insightAccounts(sessions, databases ?? []), [sessions, databases]);

  const [player, setPlayer] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<InsightRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { progress, clear } = useProgress(PROGRESS_ID);

  // While a run is going, the numbers grow game by game.
  const refresh = running ? 5000 : 0;
  const { data: summary, mutate: reloadSummary } = useSWR(
    ["insight-summary", player],
    async () => unwrap(await commands.insightSummary(player)),
    { refreshInterval: refresh },
  );
  const { data: status, mutate: reloadStatus } = useSWR(
    accounts.length > 0 ? ["insight-status", accounts, settings.depth] : null,
    async () => unwrap(await commands.insightStatus(accounts, settings.depth)),
    { refreshInterval: refresh },
  );
  const total = status?.reduce((sum, s) => sum + s.total, 0) ?? 0;
  const analysed = status?.reduce((sum, s) => sum + s.analysed, 0) ?? 0;

  // Leaving the page must not leave the engine running unseen.
  useEffect(() => () => void commands.cancelAnalysis(PROGRESS_ID), []);

  async function analyse() {
    if (!engine) return;
    setError(null);
    setLastRun(null);
    setRunning(true);
    try {
      const res = await commands.insightAnalyze(PROGRESS_ID, {
        engine: engine.path,
        uciOptions: (engine.settings ?? []).map((s) => ({
          name: s.name,
          value: s.value?.toString() ?? "",
        })),
        depth: settings.depth,
        accounts,
        maxGames: settings.maxGames,
        tacticsDest: await gameTacticsPath(),
      });
      if (res.status === "ok") setLastRun(res.data);
      else setError(res.error);
    } catch (e) {
      setError(String(e));
    } finally {
      clear();
      setRunning(false);
      reloadSummary();
      reloadStatus();
    }
  }

  return (
    <ScrollArea h="100%" px="md" py="sm">
      <Stack maw={1200} mx="auto">
        <Group gap="xs">
          <IconChartBar size="1.6rem" />
          <Title order={2}>{t("SideBar.Insight")}</Title>
        </Group>
        <Text c="dimmed" size="sm">
          {t("Insight.Desc")}
        </Text>

        <Paper withBorder p="md">
          {accounts.length === 0 ? (
            <Alert icon={<IconAlertCircle size="1rem" />} color="yellow">
              {t("Insight.NoAccounts")}
            </Alert>
          ) : localEngines.length === 0 ? (
            <Alert icon={<IconAlertCircle size="1rem" />} color="yellow">
              {t("Repertoire.Tactics.NoEngine")}
            </Alert>
          ) : (
            <Stack gap="sm">
              <Group align="flex-end">
                <Select
                  allowDeselect={false}
                  label={t("Common.Engine")}
                  data={localEngines.map((e) => ({ value: e.id, label: e.name }))}
                  value={engine?.id ?? null}
                  onChange={(value) => value && setSettings({ ...settings, engine: value })}
                  disabled={running}
                />
                <Stack gap={2}>
                  <Text size="sm" fw={500}>
                    {t("Repertoire.Tactics.Depth")}
                  </Text>
                  <SegmentedControl
                    data={INSIGHT_DEPTHS.map((d) => d.toString())}
                    value={settings.depth.toString()}
                    onChange={(value) => setSettings({ ...settings, depth: Number(value) })}
                    disabled={running}
                  />
                </Stack>
                <NumberInput
                  label={t("Insight.MaxGames")}
                  placeholder={t("Insight.MaxGamesAll")}
                  min={1}
                  w={170}
                  value={settings.maxGames ?? ""}
                  onChange={(value) =>
                    setSettings({ ...settings, maxGames: typeof value === "number" ? value : null })
                  }
                  disabled={running}
                />
                {running ? (
                  <Button variant="default" onClick={() => commands.cancelAnalysis(PROGRESS_ID)}>
                    {t("Insight.Stop")}
                  </Button>
                ) : (
                  <Button
                    leftSection={<IconPlayerPlay size="1rem" />}
                    onClick={analyse}
                    disabled={!engine || (status !== undefined && analysed >= total)}
                  >
                    {t("Insight.Start")}
                  </Button>
                )}
              </Group>
              <Group gap="xs">
                {status?.map((s) => (
                  <Badge key={s.file} variant="light" size="lg" tt="none">
                    {t("Insight.AccountStatus", {
                      player: s.player,
                      analysed: s.analysed,
                      total: s.total,
                    })}
                  </Badge>
                ))}
              </Group>
              {running && (
                <Stack gap={4}>
                  <Progress value={progress} animated />
                  <Text size="xs" c="dimmed">
                    {t("Insight.Running")}
                  </Text>
                </Stack>
              )}
              {lastRun && (
                <Alert icon={<IconTargetArrow size="1rem" />} color="green">
                  {t("Insight.RunResult", {
                    count: lastRun.analysed,
                    remaining: lastRun.remaining,
                    tactics: lastRun.missedTactics,
                    calculated: lastRun.calculated,
                  })}
                  {lastRun.failed > 0 && ` ${t("Insight.RunFailed", { count: lastRun.failed })}`}
                </Alert>
              )}
              {error && (
                <Alert icon={<IconAlertCircle size="1rem" />} title={t("Common.Error")} color="red">
                  {error}
                </Alert>
              )}
            </Stack>
          )}
        </Paper>

        {summary && summary.players.length > 1 && (
          <Select
            w={260}
            label={t("Insight.Player")}
            placeholder={t("Insight.AllPlayers")}
            clearable
            data={summary.players}
            value={player}
            onChange={setPlayer}
          />
        )}
        {summary && summary.games > 0 ? (
          <Statistics summary={summary} />
        ) : (
          <Text c="dimmed" ta="center" py="xl">
            {t("Insight.Empty")}
          </Text>
        )}
      </Stack>
    </ScrollArea>
  );
}
