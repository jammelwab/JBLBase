import { Text } from "@mantine/core";
import { useAtom, useAtomValue } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type AnalysisKind,
  analysisSpeedsAtom,
  estimateSeconds,
  formatDuration,
  recordSpeed,
  remainingSeconds,
} from "@/utils/analysisTime";
import { enginePowerAtom } from "@/utils/enginePower";

/**
 * Measures how long a run of a long analysis takes. `finish(units)` remembers the speed, so
 * that the next estimate is based on this computer.
 */
export function useAnalysisClock(kind: AnalysisKind, depth: number) {
  const power = useAtomValue(enginePowerAtom);
  const [, setSpeeds] = useAtom(analysisSpeedsAtom);
  const startedAt = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      if (startedAt.current !== null) setElapsed((Date.now() - startedAt.current) / 1000);
    }, 1000);
    return () => clearInterval(timer);
  }, [running]);

  const start = useCallback(() => {
    startedAt.current = Date.now();
    setElapsed(0);
    setRunning(true);
  }, []);

  const finish = useCallback(
    (units: number) => {
      const begun = startedAt.current;
      startedAt.current = null;
      setRunning(false);
      if (begun === null) return;
      const seconds = (Date.now() - begun) / 1000;
      setSpeeds((speeds) => recordSpeed(speeds, kind, depth, power, seconds, units));
    },
    [kind, depth, power, setSpeeds],
  );

  return { start, finish, elapsed, running };
}

/**
 * Before a run: how long it will take for `units`. During a run: how long it still needs.
 */
export function AnalysisTime({
  kind,
  depth,
  units,
  running,
  elapsed,
  progress,
}: {
  kind: AnalysisKind;
  depth: number;
  units: number;
  running: boolean;
  elapsed: number;
  progress: number;
}) {
  const { t } = useTranslation();
  const speeds = useAtomValue(analysisSpeedsAtom);
  const power = useAtomValue(enginePowerAtom);

  if (running) {
    const remaining = remainingSeconds(elapsed, progress);
    return (
      <Text size="xs" c="dimmed">
        {t("Eta.Elapsed", { time: formatDuration(elapsed, t) })}
        {" · "}
        {remaining === null
          ? t("Eta.Measuring")
          : t("Eta.Remaining", { time: formatDuration(remaining, t) })}
      </Text>
    );
  }
  if (units <= 0) return null;
  const { seconds, measured } = estimateSeconds(speeds, kind, depth, power, units);
  return (
    <Text size="xs" c="dimmed">
      {t("Eta.Estimate", { time: formatDuration(seconds, t) })}
      {!measured && ` ${t("Eta.Guess")}`}
    </Text>
  );
}
