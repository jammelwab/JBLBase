import {
  Alert,
  Button,
  Group,
  Modal,
  NumberInput,
  Progress,
  Select,
  Stack,
  Text,
} from "@mantine/core";
import { IconAlertCircle, IconTargetArrow } from "@tabler/icons-react";
import { useAtom, useAtomValue } from "jotai";
import { AnalysisTime, useAnalysisClock } from "@/components/common/AnalysisTime";
import EnginePowerControl from "@/components/common/EnginePowerControl";
import { atomWithStorage } from "jotai/utils";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { bucket, trackUsage } from "@/utils/usageStats";
import { commands, type TacticSearchResult } from "@/bindings";
import { useProgress } from "@/hooks/useProgress";
import { enginesAtom } from "@/state/atoms";
import { enginePowerAtom, engineOptions } from "@/utils/enginePower";
import type { LocalEngine } from "@/utils/engines";
import type { Repertoire } from "@/utils/repertoires";
import {
  countSolverPositions,
  DEFAULT_TACTIC_DEPTH,
  linesOfTree,
  repertoireTacticsPath,
} from "@/utils/tactics";

const tacticSearchSettingsAtom = atomWithStorage("tactic-search-settings", {
  engine: "",
  depth: DEFAULT_TACTIC_DEPTH,
});

/**
 * Lets an engine look through every position of a repertoire for tactics of its owner and
 * files them as puzzles for the puzzle trainer.
 */
export default function TacticSearchModal({
  repertoire,
  onClose,
}: {
  repertoire: Repertoire;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const engines = useAtomValue(enginesAtom);
  const localEngines = useMemo(
    () => (engines ?? []).filter((e): e is LocalEngine => e.type === "local"),
    [engines],
  );
  const [settings, setSettings] = useAtom(tacticSearchSettingsAtom);
  const engine = localEngines.find((e) => e.id === settings.engine) ?? localEngines[0];

  const id = `tactics_${repertoire.file.path}`;
  const { progress, clear } = useProgress(id);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<TacticSearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const lines = useMemo(() => linesOfTree(repertoire.root), [repertoire.root]);
  const positions = useMemo(
    () => countSolverPositions(repertoire.root, repertoire.color),
    [repertoire.root, repertoire.color],
  );
  const power = useAtomValue(enginePowerAtom);
  const clock = useAnalysisClock("tactics", settings.depth);

  async function search() {
    if (!engine) return;
    setError(null);
    setResult(null);
    setRunning(true);
    clock.start();
    let done = 0;
    try {
      const res = await commands.findTacticsInLines(id, {
        engine: engine.path,
        uciOptions: engineOptions(engine.settings ?? undefined, power),
        depth: settings.depth,
        fen: repertoire.root.fen,
        lines,
        solver: repertoire.color,
        source: `${repertoire.owner} / ${repertoire.name} (${repertoire.color})`,
        dest: await repertoireTacticsPath(),
      });
      if (res.status === "ok") {
        setResult(res.data);
        done = res.data.positions;
        trackUsage("tactic_search", { depth: settings.depth, lines: bucket(lines.length) });
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
    if (running) commands.cancelAnalysis(id);
    onClose();
  }

  return (
    <Modal opened onClose={close} title={t("Repertoire.Tactics.Title", { name: repertoire.name })}>
      <Stack>
        <Text size="sm" c="dimmed">
          {t("Repertoire.Tactics.Desc")}
        </Text>
        {localEngines.length === 0 ? (
          <Alert icon={<IconAlertCircle size="1rem" />} color="yellow">
            {t("Repertoire.Tactics.NoEngine")}
          </Alert>
        ) : (
          <>
            <Select
              allowDeselect={false}
              label={t("Common.Engine")}
              data={localEngines.map((e) => ({ value: e.id, label: e.name }))}
              value={engine?.id ?? null}
              onChange={(value) => value && setSettings({ ...settings, engine: value })}
              disabled={running}
            />
            <NumberInput
              label={t("Repertoire.Tactics.Depth")}
              description={t("Repertoire.Tactics.DepthHint")}
              min={8}
              max={40}
              value={settings.depth}
              onChange={(value) =>
                typeof value === "number" && setSettings({ ...settings, depth: value })
              }
              disabled={running}
            />
            <EnginePowerControl disabled={running} />
            <AnalysisTime
              kind="tactics"
              depth={settings.depth}
              units={positions}
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
              {t("Repertoire.Tactics.Running", { percent: Math.floor(progress) })}
            </Text>
          </Stack>
        )}
        {result && (
          <Alert icon={<IconTargetArrow size="1rem" />} color="green">
            {t("Repertoire.Tactics.Result", {
              count: result.found,
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
            <Button variant="default" onClick={() => commands.cancelAnalysis(id)}>
              {t("Common.Cancel")}
            </Button>
          ) : (
            <Button
              leftSection={<IconTargetArrow size="1rem" />}
              onClick={search}
              disabled={!engine || lines.length === 0}
            >
              {t("Repertoire.Tactics.Start")}
            </Button>
          )}
        </Group>
      </Stack>
    </Modal>
  );
}
