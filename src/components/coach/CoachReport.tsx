import { Badge, Box, Button, Group, Loader, Modal, Paper, Stack, Text } from "@mantine/core";
import { IconZoomCheck } from "@tabler/icons-react";
import { useAtomValue } from "jotai";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cloudAccountAtom } from "@/utils/cloud/sync";
import CoachFigure, { type CoachFigureHandle } from "./CoachFigure";
import { askCoach, type CoachReportCounts } from "./coachCloud";
import { moveNumber, type ReportMove } from "./coachDeep";
import { coachIntroAtom } from "./coachIntroState";

export type CoachReportData = {
  // Laufende Nummer der Partie, damit Claude nur einmal gefragt wird
  id: number;
  outcome: "win" | "loss" | "draw";
  opening: string | null;
  counts: CoachReportCounts;
  moments: ReportMove[];
};

const CHIPS: { key: keyof CoachReportCounts; color: string }[] = [
  { key: "book", color: "indigo" },
  { key: "solid", color: "green" },
  { key: "good", color: "teal" },
  { key: "dubious", color: "yellow" },
  { key: "mistake", color: "orange" },
  { key: "blunder", color: "red" },
];

// Wie lange der Bericht höchstens auf Claude wartet
const REPORT_TIMEOUT_MS = 9000;

// Automatischer Partiebericht nach jeder Partie gegen JBL (1.2.12)
export default function CoachReport({
  report,
  pending = false,
  onClose,
  onAnalyze,
}: {
  report: CoachReportData | null;
  // Bericht angefordert, aber noch nicht fertig
  pending?: boolean;
  onClose: () => void;
  // Weiter zur Analyse der Partie
  onAnalyze?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Modal
      opened={report !== null || pending}
      onClose={onClose}
      title={t("Coach.Report.Title")}
      centered
      size="lg"
      padding="xl"
      styles={{ title: { fontWeight: 700, fontSize: "var(--mantine-font-size-xl)" } }}
    >
      {report ? (
        <ReportView key={report.id} report={report} onClose={onClose} onAnalyze={onAnalyze} />
      ) : (
        <Group gap="xs" wrap="nowrap">
          <Loader size="xs" color="orange" />
          <Text size="sm">{t("Coach.Report.Writing")}</Text>
        </Group>
      )}
    </Modal>
  );
}

// Schon geschriebene Berichte: beim zweiten Öffnen nicht noch einmal fragen
const written = new Map<number, string | null>();

function ReportView({
  report,
  onClose,
  onAnalyze,
}: {
  report: CoachReportData;
  onClose: () => void;
  onAnalyze?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const account = useAtomValue(cloudAccountAtom);
  const stage = useAtomValue(coachIntroAtom).entry ?? "knows";
  const figure = useRef<CoachFigureHandle>(null);
  const [text, setText] = useState<string | null>(written.get(report.id) ?? null);
  const [busy, setBusy] = useState(!!account && !written.has(report.id));

  useEffect(() => {
    figure.current?.play(
      report.outcome === "win" ? "win" : report.outcome === "loss" ? "good" : "think",
    );
    if (!account || written.has(report.id)) return;
    let alive = true;
    void askCoach(
      {
        mode: "report",
        result: report.outcome,
        opening: report.opening,
        counts: report.counts,
        moments: report.moments.map((m) => ({
          move: m.san,
          mark: m.sign,
          best: m.best,
          motif: m.motifText,
        })),
        stage,
        lang: i18n.language.startsWith("en") ? "en" : "de",
      },
      REPORT_TIMEOUT_MS,
    ).then((answer) => {
      written.set(report.id, answer);
      if (!alive) return;
      setText(answer);
      setBusy(false);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ohne Claude: ein Satz aus den Zahlen
  const c = report.counts;
  const errors = c.mistake + c.blunder;
  const local = t(`Coach.Report.Local.${report.outcome}`, {
    good: c.good + c.book + c.solid,
    errors,
  });

  return (
    <Stack gap="md">
      <Group wrap="nowrap" align="flex-start" gap="md">
        <Box style={{ flexShrink: 0, lineHeight: 0 }}>
          <CoachFigure ref={figure} size={110} title={t("Coach.Card.Title")} />
        </Box>
        <Paper radius="md" p="sm" bg="var(--mantine-color-default-hover)" style={{ flex: 1 }}>
          {busy ? (
            <Group gap="xs" wrap="nowrap">
              <Loader size="xs" color="orange" />
              <Text size="sm">{t("Coach.Report.Writing")}</Text>
            </Group>
          ) : (
            <Text size="sm" lh={1.5} style={{ whiteSpace: "pre-line" }}>
              {text ?? local}
            </Text>
          )}
        </Paper>
      </Group>

      <Group gap={6}>
        <Badge
          size="lg"
          variant="filled"
          color={report.outcome === "win" ? "teal" : report.outcome === "loss" ? "red" : "gray"}
        >
          {t(`Coach.Report.Result.${report.outcome}`)}
        </Badge>
        {report.opening && (
          <Badge size="lg" variant="light" color="indigo">
            {report.opening}
          </Badge>
        )}
      </Group>

      <Box>
        <Text fw={600} size="sm" mb={6}>
          {t("Coach.Report.Moves")}
        </Text>
        <Group gap={6}>
          {CHIPS.map(({ key, color }) => (
            <Badge
              key={key}
              size="lg"
              variant={c[key] > 0 ? "light" : "outline"}
              color={c[key] > 0 ? color : "gray"}
            >
              {t(`Coach.Report.Count.${key}`, { count: c[key] })}
            </Badge>
          ))}
        </Group>
      </Box>

      {report.moments.length > 0 && (
        <Box>
          <Text fw={600} size="sm" mb={6}>
            {t("Coach.Report.Moments")}
          </Text>
          <Stack gap={6}>
            {report.moments.map((m) => (
              <Paper key={m.ply} withBorder radius="md" px="sm" py={6}>
                <Group gap="xs" wrap="wrap">
                  <Text size="sm" fw={700}>
                    {moveNumber(m.ply)}
                    {m.san}
                    {m.sign}
                  </Text>
                  {m.best && (
                    <Text size="sm" c="dimmed">
                      {t("Coach.Report.Better", { move: m.best })}
                    </Text>
                  )}
                  {m.motif && (
                    <Badge size="sm" variant="light" color="orange">
                      {t(`Coach.Deep.Motif.${m.motif}.Name`)}
                    </Badge>
                  )}
                </Group>
              </Paper>
            ))}
          </Stack>
        </Box>
      )}

      <Group justify="flex-end">
        {onAnalyze && (
          <Button
            variant="default"
            radius="md"
            leftSection={<IconZoomCheck size={18} />}
            onClick={onAnalyze}
          >
            {t("Coach.Report.Analyze")}
          </Button>
        )}
        <Button color="orange" radius="md" onClick={onClose}>
          {t("Coach.Lessons.Close")}
        </Button>
      </Group>
    </Stack>
  );
}
