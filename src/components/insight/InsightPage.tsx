import {
  Alert,
  Badge,
  Button,
  Group,
  Modal,
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
  TextInput,
  Title,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconChartBar,
  IconDownload,
  IconPlayerPlay,
  IconTargetArrow,
  IconUserPlus,
} from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { bucket, trackUsage } from "@/utils/usageStats";
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
import { AnalysisTime, useAnalysisClock } from "@/components/common/AnalysisTime";
import EnginePowerControl from "@/components/common/EnginePowerControl";
import {
  commands,
  type InsightAccount,
  type InsightError,
  type InsightGroup,
  type InsightRunResult,
  type InsightSummary,
} from "@/bindings";
import { useProgress } from "@/hooks/useProgress";
import { activeTabAtom, enginesAtom, sessionsAtom, tabsAtom } from "@/state/atoms";
import { getDatabases } from "@/utils/db";
import { enginePowerAtom, engineOptions } from "@/utils/enginePower";
import type { LocalEngine } from "@/utils/engines";
import {
  DEFAULT_INSIGHT_DEPTH,
  extraAccountsAtom,
  gameTacticsPath,
  INSIGHT_DEPTHS,
  accountKey,
  accountLabel,
  insightAccounts,
  mergeAccounts,
  monthLabel,
  moveNumber,
} from "@/utils/insight";
import {
  findReferenceDatabase,
  importLichessPuzzles,
  LICHESS_PUZZLE_PROGRESS,
} from "@/utils/lichessPuzzles";
import { createTab } from "@/utils/tabs";
import { defaultTree } from "@/utils/treeReducer";
import { repertoireTacticsPath } from "@/utils/tactics";
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

// The player looked at; empty for every account together.
const insightPlayerAtom = atomWithStorage<string>("insight-player", "");

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

// Opens an analysed game on a new board, at the given move, with Insight's marks.
function useOpenGame(accounts: InsightAccount[]) {
  const setTabs = useSetAtom(tabsAtom);
  const setActiveTab = useSetAtom(activeTabAtom);
  const navigate = useNavigate();
  return async (move: InsightError) => {
    const game = unwrap(await commands.insightGame(move.game, accounts));
    const base = defaultTree(game.fen ?? undefined).headers;
    await createTab({
      tab: { name: `${game.white} - ${game.black}`, type: "analysis" },
      setTabs,
      setActiveTab,
      pgn: game.pgn,
      headers: {
        ...base,
        white: game.white,
        black: game.black,
        date: game.date || null,
        result: (game.result || "*") as typeof base.result,
        site: game.site,
        time_control: game.timeControl || null,
        white_elo: game.whiteElo,
        black_elo: game.blackElo,
        orientation: game.whiteSide ? "white" : "black",
      },
      // The position after the marked move.
      position: Array(move.ply + 1).fill(0),
    });
    void navigate({ to: "/" });
  };
}

function MoveTable({
  title,
  hint,
  moves,
  brilliant,
  onOpen,
}: {
  title: string;
  hint: string;
  moves: InsightError[];
  brilliant?: boolean;
  onOpen: (move: InsightError) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  if (moves.length === 0) return null;
  const open = (move: InsightError) => {
    setError(null);
    onOpen(move).catch((e) => setError(String(e)));
  };
  const mark = (move: InsightError) => ({ 1: "?!", 2: "?", 3: "??", 4: "!!" })[move.class] ?? "";
  return (
    <Paper withBorder p="md">
      <Text fw={600}>{title}</Text>
      <Text size="xs" c="dimmed" mb="xs">
        {hint}
      </Text>
      <Table verticalSpacing={4} fz="sm" highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t("Insight.Game")}</Table.Th>
            <Table.Th>{t("Insight.Move")}</Table.Th>
            <Table.Th>{t("Insight.Played")}</Table.Th>
            {!brilliant && <Table.Th>{t("Insight.Best")}</Table.Th>}
            {brilliant ? (
              <Table.Th>{t("Insight.GamePhase")}</Table.Th>
            ) : (
              <Table.Th ta="right">{t("Insight.Loss")}</Table.Th>
            )}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {moves.map((move) => (
            <Table.Tr
              key={`${move.game}-${move.ply}`}
              style={{ cursor: "pointer" }}
              title={t("Insight.OpenGame")}
              aria-label={`${t("Insight.OpenGame")}: ${move.white} – ${move.black}, ${moveNumber(move.ply)} ${move.played}`}
              tabIndex={0}
              onClick={() => open(move)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  open(move);
                }
              }}
            >
              <Table.Td>
                {move.white} – {move.black}
                <Text span c="dimmed" size="xs" ml={6}>
                  {move.date}
                </Text>
              </Table.Td>
              <Table.Td>{moveNumber(move.ply)}</Table.Td>
              <Table.Td>
                {move.played}
                <Text span fw={700} c={brilliant ? "cyan" : "red"}>
                  {mark(move)}
                </Text>
              </Table.Td>
              {!brilliant && <Table.Td>{move.best}</Table.Td>}
              {brilliant ? (
                <Table.Td>{t(`Insight.Phase.${move.phase}`, move.phase)}</Table.Td>
              ) : (
                <Table.Td ta="right">{percent(move.loss)}</Table.Td>
              )}
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {error && (
        <Alert icon={<IconAlertCircle size="1rem" />} color="red" mt="xs">
          {error}
        </Alert>
      )}
    </Paper>
  );
}

function Statistics({
  summary,
  accounts,
}: {
  summary: InsightSummary;
  accounts: InsightAccount[];
}) {
  const openGame = useOpenGame(accounts);
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
      <SimpleGrid cols={{ base: 2, md: 3, lg: 6 }}>
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
        <Tile
          label={t("Insight.Brilliants")}
          value={summary.brilliants.toString()}
          hint={t("Insight.BrilliantsHint")}
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
      <SimpleGrid cols={{ base: 1, lg: 2 }}>
        <GroupTable
          title={t("Insight.OpeningsWhite")}
          groups={summary.byOpeningWhite}
          label={(key) => key}
        />
        <GroupTable
          title={t("Insight.OpeningsBlack")}
          groups={summary.byOpeningBlack}
          label={(key) => key}
        />
      </SimpleGrid>

      <MoveTable
        title={t("Insight.Worst")}
        hint={t("Insight.ClickToOpen")}
        moves={summary.worst}
        onOpen={openGame}
      />
      <MoveTable
        title={t("Insight.BrilliantMoves")}
        hint={t("Insight.ClickToOpen")}
        moves={summary.brilliant}
        brilliant
        onOpen={openGame}
      />
    </Stack>
  );
}

const CALIBRATION_ID = "rating_calibration";
const RERATE_ID = "rating_rerate";

/**
 * Estimates the rating of our own puzzles: the estimate is first fitted to the ratings of
 * real Lichess puzzles (once, or again on request), then every puzzle found in the
 * repertoire and the games is rated anew with it.
 */
function RatingCalibration({ engine }: { engine: LocalEngine | undefined }) {
  const { t } = useTranslation();
  const [samples, setSamples] = useState<number>(2000);
  // Which step runs: fitting the estimate, or rating our own puzzles.
  const [step, setStep] = useState<"calibrate" | "rerate" | null>(null);
  const running = step !== null;
  const [rated, setRated] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const calibrating = useProgress(CALIBRATION_ID);
  const rerating = useProgress(RERATE_ID);
  const { data: calibration, mutate } = useSWR("rating-calibration", async () =>
    unwrap(await commands.getRatingCalibration()),
  );
  // Looked for anew each time the page opens, so a download from the puzzle tab counts.
  const {
    data: reference,
    isLoading: searching,
    mutate: findAgain,
  } = useSWR("lichess-reference-db", findReferenceDatabase, { revalidateOnMount: true });
  const lichessDb = reference?.path ?? null;
  const download = useProgress(LICHESS_PUZZLE_PROGRESS);
  const [downloading, setDownloading] = useState(false);

  async function downloadLichess() {
    setError(null);
    setDownloading(true);
    try {
      const res = await importLichessPuzzles(null);
      if (res.status === "error") setError(res.error);
    } catch (e) {
      setError(String(e));
    } finally {
      setDownloading(false);
      download.clear();
      findAgain();
    }
  }

  useEffect(
    () => () => {
      void commands.cancelAnalysis(CALIBRATION_ID);
      void commands.cancelAnalysis(RERATE_ID);
    },
    [],
  );

  // Fits the estimate to the Lichess ratings. Returns whether it worked.
  async function runCalibration(): Promise<boolean> {
    if (!engine || !lichessDb) return false;
    setStep("calibrate");
    try {
      const res = await commands.calibrateRating(CALIBRATION_ID, engine.path, lichessDb, samples);
      if (res.status === "error") {
        if (!/cancel/i.test(res.error)) setError(res.error);
        return false;
      }
      return true;
    } finally {
      calibrating.clear();
      mutate();
    }
  }

  async function rerate() {
    if (!engine) return;
    setStep("rerate");
    try {
      const files = [await repertoireTacticsPath(), await gameTacticsPath()];
      const res = await commands.rerateTactics(RERATE_ID, engine.path, files);
      if (res.status === "error") {
        if (!/cancel/i.test(res.error)) setError(res.error);
      } else {
        setRated(res.data);
      }
    } finally {
      rerating.clear();
    }
  }

  // The main button: calibrate first when that has not happened yet, then rate.
  async function estimate() {
    setError(null);
    setRated(null);
    try {
      if (!calibration && !(await runCalibration())) return;
      await rerate();
    } catch (e) {
      setError(String(e));
    } finally {
      setStep(null);
    }
  }

  async function recalibrate() {
    setError(null);
    setRated(null);
    try {
      await runCalibration();
    } catch (e) {
      setError(String(e));
    } finally {
      setStep(null);
    }
  }

  function cancel() {
    void commands.cancelAnalysis(step === "rerate" ? RERATE_ID : CALIBRATION_ID);
  }

  const progress = step === "rerate" ? rerating.progress : calibrating.progress;

  return (
    <Paper withBorder p="md">
      <Stack gap="sm">
        <Text fw={600}>{t("Insight.Calibration.Title")}</Text>
        <Text size="sm" c="dimmed">
          {t("Insight.Calibration.Desc")}
        </Text>
        {!searching && !lichessDb && (
          <Alert icon={<IconAlertCircle size="1rem" />} color="yellow">
            <Stack gap="xs" align="flex-start">
              <Text size="sm">{t("Insight.Calibration.NoLichess")}</Text>
              {downloading ? (
                <Stack gap={4} w="100%">
                  <Progress value={download.progress} animated />
                  <Text size="xs" c="dimmed">
                    {t("Puzzle.Lichess.Importing")} {Math.floor(download.progress)} %
                  </Text>
                </Stack>
              ) : (
                <Button
                  size="xs"
                  leftSection={<IconDownload size="0.9rem" />}
                  onClick={downloadLichess}
                >
                  {t("Puzzle.Lichess.Download")}
                </Button>
              )}
            </Stack>
          </Alert>
        )}
        {lichessDb && (
          <>
            <Group>
              {running ? (
                <Button variant="default" onClick={cancel}>
                  {t("Common.Cancel")}
                </Button>
              ) : (
                <Button
                  leftSection={<IconTargetArrow size="1rem" />}
                  onClick={estimate}
                  disabled={!engine}
                >
                  {t("Insight.Calibration.Estimate")}
                </Button>
              )}
            </Group>
            {!engine && (
              <Text size="xs" c="dimmed">
                {t("Insight.Calibration.NeedsEngine")}
              </Text>
            )}
            {running && (
              <Stack gap={4}>
                <Progress value={progress} animated />
                <Text size="xs" c="dimmed">
                  {step === "calibrate"
                    ? t("Insight.Calibration.StepCalibrate")
                    : t("Insight.Calibration.StepRerate")}{" "}
                  {Math.floor(progress)} %
                </Text>
              </Stack>
            )}
            {rated !== null && !running && (
              <Text size="sm">{t("Insight.Calibration.Rated", { count: rated })}</Text>
            )}
          </>
        )}
        {reference && (
          <Text size="xs" c="dimmed">
            {t("Insight.Calibration.Using", {
              name: reference.title,
              puzzles: reference.puzzleCount.toLocaleString(),
            })}
          </Text>
        )}
        <Text size="sm">
          {calibration
            ? t("Insight.Calibration.Status", {
                samples: calibration.samples,
                error: Math.round(calibration.meanError),
                before: Math.round(calibration.defaultError),
                date: new Date(calibration.calibratedAt * 1000).toLocaleDateString(),
              })
            : t("Insight.Calibration.NotYet")}
        </Text>
        {lichessDb && (
          <Group align="flex-end">
            <NumberInput
              label={t("Insight.Calibration.Samples")}
              min={200}
              max={50000}
              step={500}
              w={170}
              value={samples}
              onChange={(value) => typeof value === "number" && setSamples(value)}
              disabled={running}
            />
            <Button variant="default" onClick={recalibrate} disabled={!engine || running}>
              {calibration ? t("Insight.Calibration.Again") : t("Insight.Calibration.Start")}
            </Button>
            {calibration && !running && (
              <Button
                variant="subtle"
                color="gray"
                onClick={async () => {
                  await commands.resetRatingCalibration();
                  mutate();
                }}
              >
                {t("Insight.Calibration.Reset")}
              </Button>
            )}
          </Group>
        )}
        {error && (
          <Alert icon={<IconAlertCircle size="1rem" />} title={t("Common.Error")} color="red">
            {error}
          </Alert>
        )}
      </Stack>
    </Paper>
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
  const [extraAccounts, setExtraAccounts] = useAtom(extraAccountsAtom);
  const allAccounts = useMemo(
    () => mergeAccounts(insightAccounts(sessions, databases ?? []), extraAccounts),
    [sessions, databases, extraAccounts],
  );
  const [selected, setSelected] = useAtom(insightPlayerAtom);
  const chosen = allAccounts.find((a) => accountKey(a) === selected);
  const accounts = useMemo(() => (chosen ? [chosen] : allAccounts), [chosen, allAccounts]);
  const player = chosen?.player ?? null;
  const [adding, setAdding] = useState(false);
  const power = useAtomValue(enginePowerAtom);
  const clock = useAnalysisClock("insight", settings.depth);
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
  const waiting = Math.max(0, total - analysed);
  const thisRun = settings.maxGames ? Math.min(waiting, settings.maxGames) : waiting;

  // Leaving the page must not leave the engine running unseen.
  useEffect(() => () => void commands.cancelAnalysis(PROGRESS_ID), []);

  async function analyse() {
    if (!engine) return;
    setError(null);
    setLastRun(null);
    setRunning(true);
    clock.start();
    let done = 0;
    try {
      const res = await commands.insightAnalyze(PROGRESS_ID, {
        engine: engine.path,
        uciOptions: engineOptions(engine.settings ?? undefined, power),
        depth: settings.depth,
        accounts,
        maxGames: settings.maxGames,
        tacticsDest: await gameTacticsPath(),
      });
      if (res.status === "ok") {
        setLastRun(res.data);
        done = res.data.analysed;
        trackUsage("insight_run", {
          depth: settings.depth,
          games: bucket(res.data.analysed),
        });
      } else setError(res.error);
    } catch (e) {
      setError(String(e));
    } finally {
      clock.finish(done);
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

        <Group align="flex-end">
          <Select
            w={300}
            allowDeselect={false}
            label={t("Insight.Player")}
            data={[
              { value: "", label: t("Insight.AllPlayers") },
              ...allAccounts.map((a) => ({ value: accountKey(a), label: accountLabel(a) })),
            ]}
            value={chosen ? selected : ""}
            onChange={(value) => setSelected(value ?? "")}
            disabled={running}
          />
          <Button
            variant="default"
            leftSection={<IconUserPlus size="1rem" />}
            onClick={() => setAdding(true)}
            disabled={running}
          >
            {t("Insight.AddPlayer")}
          </Button>
          {chosen && extraAccounts.some((a) => accountKey(a) === selected) && (
            <Button
              variant="subtle"
              color="gray"
              disabled={running}
              onClick={() => {
                setExtraAccounts(extraAccounts.filter((a) => accountKey(a) !== selected));
                setSelected("");
              }}
            >
              {t("Insight.RemovePlayer")}
            </Button>
          )}
        </Group>
        {adding && (
          <AddPlayerModal
            databases={(databases ?? []).flatMap((db) =>
              db.type === "success" ? [{ file: db.file, title: db.title || db.filename }] : [],
            )}
            onClose={() => setAdding(false)}
            onAdd={(account) => {
              setExtraAccounts(mergeAccounts(extraAccounts, [account]));
              setSelected(accountKey(account));
              setAdding(false);
            }}
          />
        )}

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
                <EnginePowerControl disabled={running} />
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
              <AnalysisTime
                kind="insight"
                depth={settings.depth}
                units={thisRun}
                running={running}
                elapsed={clock.elapsed}
                progress={progress}
              />
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

        {summary && summary.games > 0 ? (
          <>
            {summary.outdated > 0 && (
              <Alert icon={<IconAlertCircle size="1rem" />} color="blue">
                {t("Insight.Outdated", { count: summary.outdated })}
              </Alert>
            )}
            <Statistics summary={summary} accounts={allAccounts} />
          </>
        ) : (
          <Text c="dimmed" ta="center" py="xl">
            {t("Insight.Empty")}
          </Text>
        )}
        <RatingCalibration engine={engine} />
      </Stack>
    </ScrollArea>
  );
}

/**
 * Adds a player whose games are in one of the databases, without a connected account.
 */
function AddPlayerModal({
  databases,
  onClose,
  onAdd,
}: {
  databases: { file: string; title: string }[];
  onClose: () => void;
  onAdd: (account: InsightAccount) => void;
}) {
  const { t } = useTranslation();
  const [file, setFile] = useState<string | null>(databases[0]?.file ?? null);
  const [name, setName] = useState("");
  return (
    <Modal opened onClose={onClose} title={t("Insight.AddPlayer")}>
      <Stack>
        <Text size="sm" c="dimmed">
          {t("Insight.AddPlayerDesc")}
        </Text>
        <Select
          allowDeselect={false}
          label={t("Insight.Database")}
          data={databases.map((db) => ({ value: db.file, label: db.title }))}
          value={file}
          onChange={setFile}
        />
        <TextInput
          label={t("Insight.PlayerName")}
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
        />
        <Group justify="flex-end">
          <Button
            disabled={!file || name.trim() === ""}
            onClick={() => file && onAdd({ file, player: name.trim() })}
          >
            {t("Insight.AddPlayer")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
