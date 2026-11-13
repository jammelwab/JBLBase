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
  Select,
  Stack,
  Switch,
  Text,
  Textarea,
} from "@mantine/core";
import { IconAlertCircle, IconCheck, IconFlag, IconTrash } from "@tabler/icons-react";
import { parseUci } from "chessops";
import { makeSan } from "chessops/san";
import { useAtom, useAtomValue } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import useSWR from "swr";
import { commands, type PuzzleReport } from "@/bindings";
import { AnalysisTime, useAnalysisClock } from "@/components/common/AnalysisTime";
import EnginePowerControl from "@/components/common/EnginePowerControl";
import { useProgress } from "@/hooks/useProgress";
import { enginesAtom } from "@/state/atoms";
import { positionFromFen } from "@/utils/chessops";
import { enginePowerAtom, engineOptions } from "@/utils/enginePower";
import type { LocalEngine } from "@/utils/engines";
import type { Puzzle } from "@/utils/puzzles";
import { unwrap } from "@/utils/unwrap";

const REASONS = ["wrongSolution", "otherSolution", "rating", "other"] as const;
const CHECK_ID = "puzzle_report_check";
export const DEFAULT_CHECK_DEPTH = 30;

const reviewSettingsAtom = atomWithStorage("puzzle-review-settings", {
  engine: "",
  depth: DEFAULT_CHECK_DEPTH,
});

// "1. e4 e5 2. Nf3" from a FEN and UCI moves; the UCI moves where they cannot be read.
export function movesToSan(fen: string, moves: string): string {
  const [pos] = positionFromFen(fen);
  const list = moves.split(" ").filter(Boolean);
  if (!pos) return list.join(" ");
  const out: string[] = [];
  for (const uci of list) {
    const move = parseUci(uci);
    if (!move || !pos.isLegal(move)) return list.join(" ");
    const san = makeSan(pos, move);
    if (pos.turn === "white") out.push(`${pos.fullmoves}. ${san}`);
    else out.push(out.length === 0 ? `${pos.fullmoves}... ${san}` : san);
    pos.play(move);
  }
  return out.join(" ");
}

function fileName(path: string) {
  return (path.split(/[\\/]/).pop() ?? path).replace(/\.(duckdb|db3)$/i, "");
}

/**
 * Reports the puzzle on the board as wrong. The report waits in the review area until it is
 * checked and decided.
 */
export function ReportPuzzleModal({
  puzzle,
  db,
  onClose,
}: {
  puzzle: Puzzle;
  db: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState<string>("wrongSolution");
  const [note, setNote] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setError(null);
    const res = await commands.reportPuzzle({
      db,
      fen: puzzle.fen,
      moves: puzzle.moves.join(" "),
      rating: puzzle.rating,
      reason,
      note: note.trim(),
    });
    if (res.status === "ok") setSent(true);
    else setError(res.error);
  }

  return (
    <Modal opened onClose={onClose} title={t("Puzzle.Report.Title")}>
      <Stack>
        {sent ? (
          <>
            <Alert icon={<IconCheck size="1rem" />} color="green">
              {t("Puzzle.Report.Sent")}
            </Alert>
            <Group justify="flex-end">
              <Button onClick={onClose}>{t("Common.Close")}</Button>
            </Group>
          </>
        ) : (
          <>
            <Text size="sm" c="dimmed">
              {t("Puzzle.Report.Desc")}
            </Text>
            <Text size="sm">{movesToSan(puzzle.fen, puzzle.moves.join(" "))}</Text>
            <Select
              allowDeselect={false}
              label={t("Puzzle.Report.Reason")}
              data={REASONS.map((r) => ({ value: r, label: t(`Puzzle.Report.Reasons.${r}`) }))}
              value={reason}
              onChange={(value) => value && setReason(value)}
            />
            <Textarea
              label={t("Puzzle.Report.Note")}
              autosize
              minRows={2}
              value={note}
              onChange={(e) => setNote(e.currentTarget.value)}
            />
            {error && (
              <Alert icon={<IconAlertCircle size="1rem" />} color="red">
                {error}
              </Alert>
            )}
            <Group justify="flex-end">
              <Button leftSection={<IconFlag size="1rem" />} onClick={send}>
                {t("Puzzle.Report.Send")}
              </Button>
            </Group>
          </>
        )}
      </Stack>
    </Modal>
  );
}

function ReportCard({
  report,
  busy,
  onResolve,
  onRemove,
}: {
  report: PuzzleReport;
  busy: boolean;
  onResolve: (verdict: string) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const suggestion = report.suggestion;
  const resolved = report.status === "resolved";
  const variant = (verdict: string) => (suggestion === verdict ? "filled" : "default");
  return (
    <Paper withBorder p="sm">
      <Stack gap={6}>
        <Group justify="space-between" wrap="nowrap">
          <Group gap="xs">
            <Text fw={600} size="sm">
              {fileName(report.db)}
            </Text>
            <Badge variant="light" tt="none">
              {report.rating}
            </Badge>
            <Badge variant="light" color="gray" tt="none">
              {t(`Puzzle.Report.Reasons.${report.reason}`, report.reason)}
            </Badge>
          </Group>
          <Badge
            color={resolved ? "gray" : report.status === "checked" ? "blue" : "yellow"}
            tt="none"
          >
            {resolved
              ? t(`Puzzle.Reports.Verdict.${report.resolution}`, report.resolution ?? "")
              : t(`Puzzle.Reports.Status.${report.status}`, report.status)}
          </Badge>
        </Group>
        <Text size="sm">
          {t("Puzzle.Reports.Solution")}: {movesToSan(report.fen, report.moves)}
        </Text>
        {report.note && (
          <Text size="xs" c="dimmed">
            „{report.note}“
          </Text>
        )}
        {suggestion && (
          <Alert
            color={
              suggestion === "confirmed" ? "green" : suggestion === "corrected" ? "blue" : "red"
            }
            p="xs"
          >
            <Text size="sm" fw={600}>
              {t("Puzzle.Reports.Suggestion", {
                verdict: t(`Puzzle.Reports.Verdict.${suggestion}`),
                depth: report.checkDepth,
              })}
            </Text>
            <Text size="sm">
              {t(`Puzzle.Reports.Why.${report.checkReason}`, report.checkReason ?? "")}
            </Text>
            {report.newMoves && (
              <Text size="sm">
                {t("Puzzle.Reports.NewSolution")}: {movesToSan(report.fen, report.newMoves)}
                {report.newRating !== null && ` (${report.newRating})`}
              </Text>
            )}
          </Alert>
        )}
        <Group gap="xs" justify="flex-end">
          {!resolved && (
            <>
              <Button
                size="xs"
                variant={variant("confirmed")}
                disabled={busy}
                onClick={() => onResolve("confirmed")}
              >
                {t("Puzzle.Reports.Confirm")}
              </Button>
              <Button
                size="xs"
                variant={variant("corrected")}
                disabled={busy || !report.newMoves}
                onClick={() => onResolve("corrected")}
              >
                {t("Puzzle.Reports.Correct")}
              </Button>
              <Button
                size="xs"
                color="red"
                variant={variant("deleted")}
                disabled={busy}
                onClick={() => onResolve("deleted")}
              >
                {t("Puzzle.Reports.Delete")}
              </Button>
            </>
          )}
          <Button
            size="xs"
            variant="subtle"
            color="gray"
            leftSection={<IconTrash size="0.9rem" />}
            disabled={busy}
            onClick={onRemove}
          >
            {t("Puzzle.Reports.Remove")}
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}

/**
 * The review area: every reported puzzle, the deep engine check, and the decisions.
 */
export function ReportedPuzzlesModal({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const engines = useAtomValue(enginesAtom);
  const localEngines = useMemo(
    () => (engines ?? []).filter((e): e is LocalEngine => e.type === "local"),
    [engines],
  );
  const [settings, setSettings] = useAtom(reviewSettingsAtom);
  const engine = localEngines.find((e) => e.id === settings.engine) ?? localEngines[0];
  const power = useAtomValue(enginePowerAtom);
  const [showResolved, setShowResolved] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { progress, clear } = useProgress(CHECK_ID);
  const clock = useAnalysisClock("review", settings.depth);

  const { data: reports, mutate } = useSWR(
    ["puzzle-reports", showResolved],
    async () => unwrap(await commands.listPuzzleReports(showResolved)),
    { refreshInterval: running ? 3000 : 0 },
  );
  const open = (reports ?? []).filter((r) => r.status !== "resolved");
  const unchecked = open.filter((r) => r.status === "open");

  useEffect(() => () => void commands.cancelAnalysis(CHECK_ID), []);

  async function check(ids: number[]) {
    if (!engine) return;
    setError(null);
    setRunning(true);
    clock.start();
    let done = 0;
    try {
      const res = await commands.checkPuzzleReports(CHECK_ID, {
        engine: engine.path,
        uciOptions: engineOptions(engine.settings ?? undefined, power),
        depth: settings.depth,
        ids,
      });
      if (res.status === "ok") done = res.data;
      else if (!/cancel/i.test(res.error)) setError(res.error);
    } catch (e) {
      setError(String(e));
    } finally {
      clock.finish(done);
      clear();
      setRunning(false);
      mutate();
    }
  }

  async function act(action: Promise<{ status: string; error?: string }>) {
    setError(null);
    const res = await action;
    if (res.status === "error") setError(res.error ?? "");
    mutate();
    onChanged();
  }

  return (
    <Modal opened onClose={onClose} size="xl" title={t("Puzzle.Reports.Title")}>
      <Stack>
        <Text size="sm" c="dimmed">
          {t("Puzzle.Reports.Desc")}
        </Text>
        {localEngines.length === 0 ? (
          <Alert icon={<IconAlertCircle size="1rem" />} color="yellow">
            {t("Repertoire.Tactics.NoEngine")}
          </Alert>
        ) : (
          <Paper withBorder p="sm">
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
                <NumberInput
                  w={120}
                  label={t("Repertoire.Tactics.Depth")}
                  min={12}
                  max={50}
                  value={settings.depth}
                  onChange={(value) =>
                    typeof value === "number" && setSettings({ ...settings, depth: value })
                  }
                  disabled={running}
                />
                <EnginePowerControl disabled={running} />
              </Group>
              <Group>
                {running ? (
                  <Button variant="default" onClick={() => commands.cancelAnalysis(CHECK_ID)}>
                    {t("Common.Cancel")}
                  </Button>
                ) : (
                  <Button
                    disabled={!engine || unchecked.length === 0}
                    onClick={() => check(unchecked.map((r) => r.id))}
                  >
                    {t("Puzzle.Reports.CheckAll", { count: unchecked.length })}
                  </Button>
                )}
                <AnalysisTime
                  kind="review"
                  depth={settings.depth}
                  units={unchecked.length}
                  running={running}
                  elapsed={clock.elapsed}
                  progress={progress}
                />
              </Group>
              {running && <Progress value={progress} animated />}
            </Stack>
          </Paper>
        )}
        {error && (
          <Alert icon={<IconAlertCircle size="1rem" />} title={t("Common.Error")} color="red">
            {error}
          </Alert>
        )}
        <Switch
          label={t("Puzzle.Reports.ShowResolved")}
          checked={showResolved}
          onChange={(e) => setShowResolved(e.currentTarget.checked)}
        />
        <ScrollArea.Autosize mah={480}>
          <Stack gap="xs">
            {(reports ?? []).length === 0 && (
              <Text c="dimmed" ta="center" py="md">
                {t("Puzzle.Reports.Empty")}
              </Text>
            )}
            {(reports ?? []).map((report) => (
              <ReportCard
                key={report.id}
                report={report}
                busy={running}
                onResolve={(verdict) => act(commands.resolvePuzzleReport(report.id, verdict))}
                onRemove={() => act(commands.deletePuzzleReport(report.id))}
              />
            ))}
          </Stack>
        </ScrollArea.Autosize>
      </Stack>
    </Modal>
  );
}
