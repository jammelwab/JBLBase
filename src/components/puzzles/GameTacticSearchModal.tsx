import {
  Alert,
  Button,
  Chip,
  Group,
  Modal,
  MultiSelect,
  NumberInput,
  Progress,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { IconAlertCircle, IconTargetArrow } from "@tabler/icons-react";
import { useAtom, useAtomValue } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import useSWR from "swr";
import { AnalysisTime, useAnalysisClock } from "@/components/common/AnalysisTime";
import EnginePowerControl from "@/components/common/EnginePowerControl";
import { commands, type GameFilter, type GameTacticResult, type TacticKind } from "@/bindings";
import { useProgress } from "@/hooks/useProgress";
import { enginesAtom, sessionsAtom } from "@/state/atoms";
import { getDatabases } from "@/utils/db";
import { enginePowerAtom, engineOptions } from "@/utils/enginePower";
import type { LocalEngine } from "@/utils/engines";
import { type Period, PERIODS, periodRange, RESULTS, SPEEDS } from "@/utils/gameTactics";
import {
  accountKey,
  accountLabel,
  extraAccountsAtom,
  gameTacticsPath,
  insightAccounts,
  mergeAccounts,
} from "@/utils/insight";
import { DEFAULT_TACTIC_DEPTH } from "@/utils/tactics";
import { bucket, trackUsage } from "@/utils/usageStats";
import TacticCriteriaControl, { DEFAULT_TACTIC_CRITERIA } from "./TacticCriteriaControl";

const PROGRESS_ID = "game_tactics";

const DEFAULT_SETTINGS = {
  engine: "",
  depth: DEFAULT_TACTIC_DEPTH as number,
  // Account keys; empty for every account.
  accounts: [] as string[],
  color: "both" as "both" | "white" | "black",
  period: "all" as Period,
  since: "",
  until: "",
  speeds: [] as string[],
  results: [] as string[],
  maxGames: 100 as number | null,
  kind: "both" as TacticKind,
  criteria: DEFAULT_TACTIC_CRITERIA,
};

const gameTacticSettingsAtom = atomWithStorage("game-tactic-settings", DEFAULT_SETTINGS);

/**
 * Looks through the own games for tactics, the found and the missed ones, and files them as
 * puzzles in the puzzle database “Partien-Taktiken”. Which games, how strict and with which
 * engine is up to the user.
 */
export default function GameTacticSearchModal({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone?: () => void;
}) {
  const { t } = useTranslation();
  const engines = useAtomValue(enginesAtom);
  const localEngines = useMemo(
    () => (engines ?? []).filter((e): e is LocalEngine => e.type === "local"),
    [engines],
  );
  const [stored, setSettings] = useAtom(gameTacticSettingsAtom);
  // Older saved settings may lack newer fields.
  const settings = { ...DEFAULT_SETTINGS, ...stored };
  const update = (patch: Partial<typeof settings>) => setSettings({ ...settings, ...patch });
  const engine = localEngines.find((e) => e.id === settings.engine) ?? localEngines[0];

  const sessions = useAtomValue(sessionsAtom);
  const { data: databases } = useSWR("insight-databases", getDatabases);
  const extraAccounts = useAtomValue(extraAccountsAtom);
  const allAccounts = useMemo(
    () => mergeAccounts(insightAccounts(sessions, databases ?? []), extraAccounts),
    [sessions, databases, extraAccounts],
  );
  const chosenAccounts = useMemo(() => {
    const picked = allAccounts.filter((a) => settings.accounts.includes(accountKey(a)));
    return picked.length > 0 ? picked : allAccounts;
  }, [allAccounts, settings.accounts]);

  const range = periodRange(settings.period, settings);
  const filter: GameFilter = {
    accounts: chosenAccounts,
    color: settings.color === "both" ? null : settings.color,
    since: range.since,
    until: range.until,
    speeds: settings.speeds,
    results: settings.results,
    maxGames: settings.maxGames,
  };
  const [debouncedFilter] = useDebouncedValue(filter, 300);
  const { data: gameCount } = useSWR(
    chosenAccounts.length > 0 ? ["tactic-game-count", JSON.stringify(debouncedFilter)] : null,
    async () => {
      const res = await commands.countTacticGames(debouncedFilter);
      return res.status === "ok" ? res.data : null;
    },
  );

  const { progress, clear } = useProgress(PROGRESS_ID);
  const power = useAtomValue(enginePowerAtom);
  const clock = useAnalysisClock("gameTactics", settings.depth);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<GameTacticResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    if (!engine) return;
    setError(null);
    setResult(null);
    setRunning(true);
    clock.start();
    let done = 0;
    try {
      const res = await commands.findTacticsInGames(PROGRESS_ID, {
        engine: engine.path,
        uciOptions: engineOptions(engine.settings ?? undefined, power),
        depth: settings.depth,
        filter,
        kind: settings.kind,
        strictness: settings.criteria.strictness,
        minSolverMoves: settings.criteria.minSolverMoves,
        maxEngines: null,
        dest: await gameTacticsPath(),
      });
      if (res.status === "ok") {
        setResult(res.data);
        done = res.data.games;
        trackUsage("game_tactic_search", {
          depth: settings.depth,
          games: bucket(res.data.games),
          strictness: settings.criteria.strictness,
          kind: settings.kind,
        });
        onDone?.();
      } else if (!/cancel/i.test(res.error)) setError(res.error);
    } catch (e) {
      setError(String(e));
    } finally {
      clock.finish(done);
      clear();
      setRunning(false);
    }
  }

  function close() {
    if (running) commands.cancelAnalysis(PROGRESS_ID);
    onClose();
  }

  const toggle = (list: string[], value: string) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  return (
    <Modal opened onClose={close} size="lg" title={t("GameTactics.Title")}>
      <Stack>
        <Text size="sm" c="dimmed">
          {t("GameTactics.Desc")}
        </Text>
        {localEngines.length === 0 ? (
          <Alert icon={<IconAlertCircle size="1rem" />} color="yellow">
            {t("Repertoire.Tactics.NoEngine")}
          </Alert>
        ) : allAccounts.length === 0 ? (
          <Alert icon={<IconAlertCircle size="1rem" />} color="yellow">
            {t("GameTactics.NoAccounts")}
          </Alert>
        ) : (
          <>
            <Text fw={600} size="sm">
              {t("GameTactics.Games")}
            </Text>
            <MultiSelect
              label={t("GameTactics.Players")}
              placeholder={settings.accounts.length === 0 ? t("GameTactics.AllPlayers") : undefined}
              data={allAccounts.map((a) => ({ value: accountKey(a), label: accountLabel(a) }))}
              value={settings.accounts.filter((k) => allAccounts.some((a) => accountKey(a) === k))}
              onChange={(accounts) => update({ accounts })}
              clearable
              disabled={running}
            />
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <Stack gap={2}>
                <Text size="sm" fw={500}>
                  {t("GameTactics.Color")}
                </Text>
                <SegmentedControl
                  data={[
                    { value: "both", label: t("GameTactics.BothColors") },
                    { value: "white", label: t("Insight.Color.white") },
                    { value: "black", label: t("Insight.Color.black") },
                  ]}
                  value={settings.color}
                  onChange={(color) => update({ color: color as typeof settings.color })}
                  disabled={running}
                />
              </Stack>
              <Select
                label={t("GameTactics.Period")}
                allowDeselect={false}
                data={PERIODS.map((p) => ({ value: p, label: t(`GameTactics.Periods.${p}`) }))}
                value={settings.period}
                onChange={(period) => period && update({ period: period as Period })}
                disabled={running}
              />
            </SimpleGrid>
            {settings.period === "custom" && (
              <SimpleGrid cols={2}>
                <TextInput
                  type="date"
                  label={t("GameTactics.Since")}
                  value={settings.since}
                  onChange={(e) => update({ since: e.currentTarget.value })}
                  disabled={running}
                />
                <TextInput
                  type="date"
                  label={t("GameTactics.Until")}
                  value={settings.until}
                  onChange={(e) => update({ until: e.currentTarget.value })}
                  disabled={running}
                />
              </SimpleGrid>
            )}
            <Stack gap={4}>
              <Text size="sm" fw={500}>
                {t("GameTactics.Speeds")}
              </Text>
              <Group gap={6}>
                {SPEEDS.map((speed) => (
                  <Chip
                    key={speed}
                    size="xs"
                    checked={settings.speeds.includes(speed)}
                    onChange={() => update({ speeds: toggle(settings.speeds, speed) })}
                    disabled={running}
                  >
                    {t(`Insight.Speed.${speed}`)}
                  </Chip>
                ))}
              </Group>
            </Stack>
            <Stack gap={4}>
              <Text size="sm" fw={500}>
                {t("GameTactics.Results")}
              </Text>
              <Group gap={6}>
                {RESULTS.map((r) => (
                  <Chip
                    key={r}
                    size="xs"
                    checked={settings.results.includes(r)}
                    onChange={() => update({ results: toggle(settings.results, r) })}
                    disabled={running}
                  >
                    {t(`Insight.Result.${r}`)}
                  </Chip>
                ))}
              </Group>
              <Text size="xs" c="dimmed">
                {t("GameTactics.NoneMeansAll")}
              </Text>
            </Stack>
            <NumberInput
              label={t("GameTactics.MaxGames")}
              description={t("GameTactics.MaxGamesHint")}
              min={1}
              max={100000}
              placeholder={t("GameTactics.AllGames")}
              value={settings.maxGames ?? ""}
              onChange={(n) => update({ maxGames: typeof n === "number" ? n : null })}
              disabled={running}
            />
            <Text size="sm" c={gameCount === 0 ? "red" : undefined}>
              {gameCount === undefined || gameCount === null
                ? t("GameTactics.Counting")
                : t("GameTactics.Chosen", { count: gameCount })}
            </Text>

            <Text fw={600} size="sm" mt="xs">
              {t("GameTactics.Which")}
            </Text>
            <SegmentedControl
              data={[
                { value: "missed", label: t("GameTactics.Kind.missed") },
                { value: "played", label: t("GameTactics.Kind.played") },
                { value: "both", label: t("GameTactics.Kind.both") },
              ]}
              value={settings.kind}
              onChange={(kind) => update({ kind: kind as TacticKind })}
              disabled={running}
            />
            <TacticCriteriaControl
              value={settings.criteria}
              onChange={(criteria) => update({ criteria })}
              disabled={running}
            />

            <Text fw={600} size="sm" mt="xs">
              {t("Common.Engine")}
            </Text>
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <Select
                allowDeselect={false}
                label={t("Common.Engine")}
                data={localEngines.map((e) => ({ value: e.id, label: e.name }))}
                value={engine?.id ?? null}
                onChange={(value) => value && update({ engine: value })}
                disabled={running}
              />
              <NumberInput
                label={t("Repertoire.Tactics.Depth")}
                min={8}
                max={40}
                value={settings.depth}
                onChange={(value) => typeof value === "number" && update({ depth: value })}
                disabled={running}
              />
            </SimpleGrid>
            <Text size="xs" c="dimmed">
              {t("GameTactics.DepthHint")}
            </Text>
            <EnginePowerControl disabled={running} />
            <AnalysisTime
              kind="gameTactics"
              depth={settings.depth}
              units={gameCount ?? 0}
              running={running}
              elapsed={clock.elapsed}
              progress={progress}
            />
          </>
        )}
        {running && (
          <Stack gap={4}>
            <Progress value={progress} animated />
            <Text size="xs" c="dimmed">
              {t("GameTactics.Running", { percent: Math.floor(progress) })}
            </Text>
          </Stack>
        )}
        {result && (
          <Alert icon={<IconTargetArrow size="1rem" />} color="green">
            {t("GameTactics.Result", {
              count: result.found,
              games: result.games,
              played: result.played,
              missed: result.missed,
              positions: result.positions,
              calculated: result.calculated,
            })}
            {(result.duplicates > 0 || result.rejected > 0) &&
              ` ${t("Repertoire.Tactics.Skipped", {
                added: result.added,
                duplicates: result.duplicates,
                rejected: result.rejected,
              })}`}
          </Alert>
        )}
        {error && (
          <Alert icon={<IconAlertCircle size="1rem" />} title={t("Common.Error")} color="red">
            {error}
          </Alert>
        )}
        <Group justify="flex-end">
          {running ? (
            <Button variant="default" onClick={() => commands.cancelAnalysis(PROGRESS_ID)}>
              {t("Common.Cancel")}
            </Button>
          ) : (
            <Button
              leftSection={<IconTargetArrow size="1rem" />}
              onClick={search}
              disabled={!engine || chosenAccounts.length === 0 || gameCount === 0}
            >
              {t("Repertoire.Tactics.Start")}
            </Button>
          )}
        </Group>
      </Stack>
    </Modal>
  );
}
