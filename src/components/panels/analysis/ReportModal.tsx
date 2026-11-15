import {
  Alert,
  Button,
  Checkbox,
  Chip,
  Group,
  Modal,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Text,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { IconInfoCircle } from "@tabler/icons-react";
import { makeFen } from "chessops/fen";
import { useAtom, useAtomValue } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { memo, useContext, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";
import { commands, type GoMode } from "@/bindings";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import { enginesAtom, referenceDbAtom } from "@/state/atoms";
import { parseSanOrUci, positionFromFen } from "@/utils/chessops";
import { cloudAccountAtom } from "@/utils/cloud/sync";
import type { LocalEngine } from "@/utils/engines";

type LimitMode = "Time" | "Depth" | "Nodes";
type ReportGoMode = Exclude<GoMode, { t: "Infinite" }>;

const DEFAULT_GO_MODES: Record<LimitMode, ReportGoMode> = {
  Time: { t: "Time", c: 1000 },
  Depth: { t: "Depth", c: 20 },
  Nodes: { t: "Nodes", c: 1000000 },
};
const TIME_PRESETS = [500, 1000, 3000, 10000];
const DEPTH_PRESETS = [16, 20, 24, 28];

// Normal accounts keep deeper results only until the app closes (see eval_cache.rs).
const USER_MAX_STORE_DEPTH = 28;

function Presets({
  values,
  current,
  format,
  onPick,
}: {
  values: number[];
  current: number;
  format: (v: number) => string;
  onPick: (v: number) => void;
}) {
  return (
    <Group gap={4} wrap="nowrap" mb={6}>
      {values.map((v) => (
        <Chip key={v} size="xs" checked={v === current} onChange={() => onPick(v)}>
          {format(v)}
        </Chip>
      ))}
    </Group>
  );
}

const reportSettingsAtom = atomWithStorage("report-settings", {
  novelty: true,
  reversed: true,
  variations: true,
  goMode: { t: "Time", c: 500 } as ReportGoMode,
  engine: "",
});

// How many plies from the start are named opening theory ("Buch" in the report).
async function countBookPlies(initialFen: string, moves: string[]): Promise<number> {
  const [pos] = positionFromFen(initialFen);
  if (!pos) return 0;
  let plies = 0;
  for (const san of moves) {
    const move = parseSanOrUci(pos, san);
    if (!move) break;
    pos.play(move);
    const res = await commands.getOpeningFromFens([makeFen(pos.toSetup())]);
    if (res.status !== "ok") break;
    plies++;
  }
  return plies;
}

function ReportModal({
  tab,
  initialFen,
  moves,
  reportingMode,
  closeReportingMode,
  setInProgress,
}: {
  tab: string;
  initialFen: string;
  moves: string[];
  reportingMode: boolean;
  closeReportingMode: () => void;
  setInProgress: (value: boolean) => void;
}) {
  const { t } = useTranslation();

  const referenceDb = useAtomValue(referenceDbAtom);
  const engines = useAtomValue(enginesAtom);
  const localEngines = useMemo(
    () => (engines ?? []).filter((e): e is LocalEngine => e.type === "local"),
    [engines],
  );
  const store = useContext(TreeStateContext)!;
  const addAnalysis = useStore(store, (s) => s.addAnalysis);

  const [reportSettings, setReportSettings] = useAtom(reportSettingsAtom);
  const account = useAtomValue(cloudAccountAtom);

  const form = useForm({
    initialValues: reportSettings,
    validate: {
      engine: (value) => {
        if (!value) return t("Board.Analysis.EngineRequired");
      },
      novelty: (value) => {
        if (value && !referenceDb) return t("Board.Analysis.RefDBRequired");
      },
    },
  });

  useEffect(() => {
    const engine =
      localEngines.length === 0
        ? ""
        : !reportSettings.engine || !localEngines.some((l) => l.id === reportSettings.engine)
          ? localEngines[0].id
          : reportSettings.engine;

    form.setValues({ ...reportSettings, engine });
  }, [localEngines, reportSettings]);

  const goMode = form.values.goMode;
  const positions = moves.length + 1;
  const depthCapped =
    !!account &&
    account.role !== "admin" &&
    goMode.t === "Depth" &&
    goMode.c > USER_MAX_STORE_DEPTH;

  function analyze() {
    setReportSettings(form.values);
    setInProgress(true);
    closeReportingMode();
    const engine = localEngines.find((e) => e.id === form.values.engine);
    const engineSettings = (engine?.settings ?? []).map((s) => ({
      ...s,
      value: s.value?.toString() ?? "",
    }));

    commands
      .analyzeGame(
        `report_${tab}`,
        engine?.path ?? "",
        form.values.goMode,
        {
          annotateNovelties: form.values.novelty,
          fen: initialFen,
          referenceDb,
          reversed: form.values.reversed,
          moves,
        },
        engineSettings,
      )
      .then(async (analysis) => {
        if (analysis.status === "ok") {
          addAnalysis(analysis.data, {
            showVariations: form.values.variations,
            source: { engine: engine?.name ?? "", goMode: form.values.goMode },
            bookPlies: await countBookPlies(initialFen, moves),
          });
        }
      })
      .finally(() => setInProgress(false));
  }

  return (
    <Modal
      opened={reportingMode}
      onClose={closeReportingMode}
      title={t("Board.Analysis.GenerateReport")}
    >
      <form onSubmit={form.onSubmit(() => analyze())}>
        <Stack>
          <Stack gap={4}>
            <Text fw={500} fz="sm">
              {t("Board.Analysis.ReportEngine")}
            </Text>
            {localEngines.length === 0 ? (
              <Text c="red" fz="sm">
                {t("Board.Analysis.EngineRequired")}
              </Text>
            ) : localEngines.length <= 4 ? (
              <SegmentedControl
                fullWidth
                data={localEngines.map((e) => ({ value: e.id, label: e.name }))}
                value={form.values.engine}
                onChange={(v) => form.setFieldValue("engine", v)}
              />
            ) : (
              <Select
                allowDeselect={false}
                data={localEngines.map((e) => ({ value: e.id, label: e.name }))}
                {...form.getInputProps("engine")}
              />
            )}
          </Stack>

          <Stack gap={4}>
            <Text fw={500} fz="sm">
              {t("Board.Analysis.ReportLimit")}
            </Text>
            <SegmentedControl
              fullWidth
              data={[
                { label: t("Board.Analysis.TimePerMove"), value: "Time" },
                { label: t("GoMode.Depth"), value: "Depth" },
                { label: t("GoMode.Nodes"), value: "Nodes" },
              ]}
              value={goMode.t}
              onChange={(v) => {
                if (v === goMode.t) return;
                form.setFieldValue("goMode", DEFAULT_GO_MODES[v as LimitMode]);
              }}
            />
            {goMode.t === "Time" && (
              <Group wrap="nowrap" align="end">
                <NumberInput
                  style={{ flex: 1 }}
                  label={t("Board.Analysis.SecondsPerMove")}
                  min={0.1}
                  max={600}
                  step={0.5}
                  decimalScale={1}
                  value={goMode.c / 1000}
                  onChange={(v) =>
                    form.setFieldValue("goMode", {
                      t: "Time",
                      c: Math.max(100, Math.round((Number(v) || 0.1) * 1000)),
                    })
                  }
                />
                <Presets
                  values={TIME_PRESETS}
                  current={goMode.c}
                  format={(ms) => `${ms / 1000} s`}
                  onPick={(c) => form.setFieldValue("goMode", { t: "Time", c })}
                />
              </Group>
            )}
            {goMode.t === "Depth" && (
              <Group wrap="nowrap" align="end">
                <NumberInput
                  style={{ flex: 1 }}
                  label={t("GoMode.Depth")}
                  min={1}
                  max={99}
                  value={goMode.c}
                  onChange={(v) =>
                    form.setFieldValue("goMode", {
                      t: "Depth",
                      c: Math.max(1, Math.round(Number(v) || 1)),
                    })
                  }
                />
                <Presets
                  values={DEPTH_PRESETS}
                  current={goMode.c}
                  format={(d) => `${d}`}
                  onPick={(c) => form.setFieldValue("goMode", { t: "Depth", c })}
                />
              </Group>
            )}
            {goMode.t === "Nodes" && (
              <NumberInput
                label={t("GoMode.Nodes")}
                min={1000}
                step={100000}
                thousandSeparator="."
                decimalSeparator=","
                value={goMode.c}
                onChange={(v) =>
                  form.setFieldValue("goMode", {
                    t: "Nodes",
                    c: Math.max(1000, Math.round(Number(v) || 1000)),
                  })
                }
              />
            )}
            <Text fz="xs" c="dimmed">
              {goMode.t === "Time"
                ? t("Board.Analysis.ReportEstimate", {
                    count: positions,
                    minutes: Math.max(1, Math.ceil((positions * goMode.c) / 60000)),
                  })
                : t("Board.Analysis.ReportPositions", { count: positions })}
            </Text>
            {depthCapped && (
              <Alert color="yellow" variant="light" p="xs" icon={<IconInfoCircle size={16} />}>
                <Text fz="xs">
                  {t("Board.Analysis.ReportDepthCap", { depth: USER_MAX_STORE_DEPTH })}
                </Text>
              </Alert>
            )}
          </Stack>

          <Checkbox
            label={t("Board.Analysis.Reversed")}
            description={t("Board.Analysis.Reversed.Desc")}
            {...form.getInputProps("reversed", { type: "checkbox" })}
          />

          <Checkbox
            label={t("Board.Analysis.AnnotateNovelties")}
            description={t("Board.Analysis.AnnotateNovelties.Desc")}
            {...form.getInputProps("novelty", { type: "checkbox" })}
          />

          <Checkbox
            label={t("Board.Analysis.ShowVariations")}
            description={t("Board.Analysis.ShowVariations.Desc")}
            {...form.getInputProps("variations", { type: "checkbox" })}
          />

          <Group justify="right">
            <Button type="submit">{t("Board.Analysis.Analyze")}</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

export default memo(ReportModal);
