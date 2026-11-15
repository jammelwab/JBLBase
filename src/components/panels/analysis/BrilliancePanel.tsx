import {
  Accordion,
  Badge,
  Button,
  Group,
  NumberInput,
  Paper,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Text,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconSparkles } from "@tabler/icons-react";
import { atom, useAtom, useAtomValue } from "jotai";
import { atomFamily, atomWithStorage } from "jotai/utils";
import { memo, useCallback, useContext, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";
import { type BrillianceFind, type BrillianceResult, commands } from "@/bindings";
import ProgressButton from "@/components/common/ProgressButton";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import { activeTabAtom, enginesAtom, moveNotationTypeAtom } from "@/state/atoms";
import { addPieceSymbol } from "@/utils/annotation";
import { numberedLine, numberedMove, pickBrillianceEngine } from "@/utils/brilliance";
import type { LocalEngine } from "@/utils/engines";
import ScoreBubble from "./ScoreBubble";

export type BrillianceSettings = {
  engine: string;
  hero: "turn" | "white" | "black" | "both";
  depth: number;
  clubDepth: number;
  maxPlies: number;
  maxPositions: number;
  lines: number;
  clubReplies: number;
  clubTolerance: number;
  minSacrifice: number;
};

export const DEFAULT_BRILLIANCE_SETTINGS: BrillianceSettings = {
  engine: "",
  hero: "turn",
  depth: 18,
  clubDepth: 8,
  maxPlies: 8,
  maxPositions: 40,
  lines: 4,
  clubReplies: 3,
  clubTolerance: 150,
  minSacrifice: 200,
};

const brillianceSettingsAtom = atomWithStorage<BrillianceSettings>(
  "brilliance-settings",
  DEFAULT_BRILLIANCE_SETTINGS,
);

type SearchState = {
  // Where the search started, so a find can be put on the board later.
  startPosition: number[];
  startFen: string;
  result: BrillianceResult | null;
  error: string | null;
};

// Results stay per board tab while the panel is closed or another tab is shown.
const searchFamily = atomFamily((_tab: string) => atom<SearchState | null>(null));
const inProgressFamily = atomFamily((_tab: string) => atom(false));

function BrilliancePanel() {
  const { t } = useTranslation();
  const activeTab = useAtomValue(activeTabAtom)!;
  const store = useContext(TreeStateContext)!;
  const currentFen = useStore(store, (s) => s.currentNode().fen);

  const engines = useAtomValue(enginesAtom);
  const localEngines = useMemo(
    () => (engines ?? []).filter((e): e is LocalEngine => e.type === "local"),
    [engines],
  );
  const [settings, setSettings] = useAtom(brillianceSettingsAtom);
  const s = useMemo(() => ({ ...DEFAULT_BRILLIANCE_SETTINGS, ...settings }), [settings]);
  const engineId = pickBrillianceEngine(localEngines, s.engine);
  const engine = localEngines.find((e) => e.id === engineId);

  const [search, setSearch] = useAtom(searchFamily(activeTab));
  const [inProgress, setInProgress] = useAtom(inProgressFamily(activeTab));
  const id = `brilliance_${activeTab}`;

  const update = (patch: Partial<BrillianceSettings>) => setSettings({ ...s, ...patch });

  const start = useCallback(() => {
    if (!engine) return;
    const state = store.getState();
    const startFen = state.currentNode().fen;
    const startPosition = [...state.position];
    setInProgress(true);
    setSearch({ startPosition, startFen, result: null, error: null });
    const uciOptions = (engine.settings ?? [])
      .filter((o) => o.name !== "MultiPV")
      .map((o) => ({ name: o.name, value: o.value?.toString() ?? "" }));
    commands
      .findBrilliancies(
        id,
        engine.path,
        {
          fen: startFen,
          moves: [],
          hero: s.hero,
          goMode: { t: "Depth", c: s.depth },
          clubDepth: s.clubDepth,
          maxPlies: s.maxPlies,
          lines: s.lines,
          clubReplies: s.clubReplies,
          clubTolerance: s.clubTolerance,
          minSacrifice: s.minSacrifice,
          maxPositions: s.maxPositions,
        },
        uciOptions,
      )
      .then((res) => {
        if (res.status === "ok") {
          setSearch({ startPosition, startFen, result: res.data, error: null });
        } else if (!String(res.error).includes("cancel")) {
          setSearch({ startPosition, startFen, result: null, error: String(res.error) });
        } else {
          setSearch(null);
        }
      })
      .finally(() => setInProgress(false));
  }, [engine, store, id, s, setSearch, setInProgress]);

  const cancel = useCallback(() => {
    commands.cancelAnalysis(id);
  }, [id]);

  const putOnBoard = useCallback(
    (find: BrillianceFind) => {
      if (!search) return;
      const state = store.getState();
      const startNode = state.getNode(search.startPosition);
      if (!startNode || startNode.fen !== search.startFen) {
        notifications.show({
          color: "red",
          title: t("Board.Analysis.Brilliance.StartGone"),
          message: t("Board.Analysis.Brilliance.StartGone.Desc"),
        });
        return;
      }
      state.goToMove(search.startPosition);
      state.makeMoves({ payload: [...find.pathUci, find.moveUci] });
      const at = [...store.getState().position];
      const node = store.getState().currentNode();
      const annotation = find.annotation === "!!" ? "!!" : "!";
      if (!node.annotations.includes(annotation)) {
        store.getState().setAnnotation(annotation);
      }
      if (find.continuationUci.length > 0) {
        store.getState().makeMoves({ payload: find.continuationUci.slice(0, 12) });
      }
      store.getState().goToMove(at);
    },
    [search, store, t],
  );

  const engineOptions = localEngines.map((e) => ({ value: e.id, label: e.name }));
  const finds = search?.result?.finds ?? [];
  const moved = search && search.startFen !== currentFen;

  return (
    <ScrollArea offsetScrollbars>
      <Stack mb="lg" gap="xs" mr="xs">
        <Text size="sm" c="dimmed">
          {t("Board.Analysis.Brilliance.Desc")}
        </Text>
        <Select
          label={t("Common.Engine")}
          allowDeselect={false}
          data={engineOptions}
          value={engineId || null}
          onChange={(v) => v && update({ engine: v })}
          placeholder={t("Board.Analysis.Brilliance.NoEngine")}
          disabled={inProgress}
        />
        <div>
          <Text size="sm" fw={500} mb={4}>
            {t("Board.Analysis.Brilliance.Side")}
          </Text>
          <SegmentedControl
            fullWidth
            size="xs"
            value={s.hero}
            disabled={inProgress}
            onChange={(v) => update({ hero: v as BrillianceSettings["hero"] })}
            data={[
              { value: "turn", label: t("Board.Analysis.Brilliance.SideToMove") },
              { value: "white", label: t("Board.Analysis.Brilliance.White") },
              { value: "black", label: t("Board.Analysis.Brilliance.Black") },
              { value: "both", label: t("Board.Analysis.Brilliance.BothSides") },
            ]}
          />
        </div>
        <SimpleGrid cols={2} spacing="xs">
          <NumberInput
            label={t("Board.Analysis.Brilliance.Depth")}
            description={t("Board.Analysis.Brilliance.Depth.Desc")}
            min={6}
            max={40}
            value={s.depth}
            disabled={inProgress}
            onChange={(v) => update({ depth: Number(v) || DEFAULT_BRILLIANCE_SETTINGS.depth })}
          />
          <NumberInput
            label={t("Board.Analysis.Brilliance.ClubDepth")}
            description={t("Board.Analysis.Brilliance.ClubDepth.Desc")}
            min={0}
            max={14}
            value={s.clubDepth}
            disabled={inProgress}
            onChange={(v) => update({ clubDepth: Number(v) || 0 })}
          />
          <NumberInput
            label={t("Board.Analysis.Brilliance.Plies")}
            description={t("Board.Analysis.Brilliance.Plies.Desc")}
            min={1}
            max={20}
            value={s.maxPlies}
            disabled={inProgress}
            onChange={(v) => update({ maxPlies: Number(v) || 1 })}
          />
          <NumberInput
            label={t("Board.Analysis.Brilliance.Positions")}
            description={t("Board.Analysis.Brilliance.Positions.Desc")}
            min={1}
            max={500}
            value={s.maxPositions}
            disabled={inProgress}
            onChange={(v) => update({ maxPositions: Number(v) || 1 })}
          />
        </SimpleGrid>
        <Accordion variant="contained" chevronPosition="left">
          <Accordion.Item value="more">
            <Accordion.Control>
              <Text size="sm">{t("Board.Analysis.Brilliance.More")}</Text>
            </Accordion.Control>
            <Accordion.Panel>
              <SimpleGrid cols={2} spacing="xs">
                <Select
                  label={t("Board.Analysis.Brilliance.MinSacrifice")}
                  allowDeselect={false}
                  disabled={inProgress}
                  value={String(s.minSacrifice)}
                  onChange={(v) => v && update({ minSacrifice: Number(v) })}
                  data={[
                    { value: "90", label: t("Board.Analysis.Brilliance.Sac.Pawn") },
                    { value: "200", label: t("Board.Analysis.Brilliance.Sac.Exchange") },
                    { value: "300", label: t("Board.Analysis.Brilliance.Sac.Piece") },
                    { value: "500", label: t("Board.Analysis.Brilliance.Sac.Rook") },
                  ]}
                />
                <NumberInput
                  label={t("Board.Analysis.Brilliance.Lines")}
                  min={2}
                  max={8}
                  value={s.lines}
                  disabled={inProgress}
                  onChange={(v) => update({ lines: Number(v) || 2 })}
                />
                <NumberInput
                  label={t("Board.Analysis.Brilliance.ClubReplies")}
                  description={t("Board.Analysis.Brilliance.ClubReplies.Desc")}
                  min={1}
                  max={6}
                  value={s.clubReplies}
                  disabled={inProgress}
                  onChange={(v) => update({ clubReplies: Number(v) || 1 })}
                />
                <NumberInput
                  label={t("Board.Analysis.Brilliance.Tolerance")}
                  description={t("Board.Analysis.Brilliance.Tolerance.Desc")}
                  min={0}
                  max={1000}
                  step={10}
                  value={s.clubTolerance}
                  disabled={inProgress}
                  onChange={(v) => update({ clubTolerance: Number(v) || 0 })}
                />
              </SimpleGrid>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>

        <ProgressButton
          id={id}
          redoable
          disabled={!engine}
          leftIcon={<IconSparkles size="0.875rem" />}
          onClick={start}
          onCancel={cancel}
          initInstalled={false}
          labels={{
            action: t("Board.Analysis.Brilliance.Start"),
            completed: t("Board.Analysis.Brilliance.Again"),
            inProgress: t("Board.Analysis.Brilliance.Searching"),
          }}
          inProgress={inProgress}
          setInProgress={setInProgress}
        />

        {search?.error && (
          <Text c="red" size="sm">
            {search.error}
          </Text>
        )}
        {search?.result && (
          <Text size="sm" c="dimmed">
            {t("Board.Analysis.Brilliance.Summary", {
              count: finds.length,
              positions: search.result.positions,
              engine: search.result.engineName,
            })}
            {moved ? ` ${t("Board.Analysis.Brilliance.OtherStart")}` : ""}
          </Text>
        )}
        {finds.map((find, i) => (
          <FindCard
            key={`${find.pathUci.join(" ")}:${find.moveUci}:${i}`}
            find={find}
            startFen={search!.startFen}
            onPut={() => putOnBoard(find)}
          />
        ))}
      </Stack>
    </ScrollArea>
  );
}

function FindCard({
  find,
  startFen,
  onPut,
}: {
  find: BrillianceFind;
  startFen: string;
  onPut: () => void;
}) {
  const { t } = useTranslation();
  const notation = useAtomValue(moveNotationTypeAtom);
  const sym = (san: string) => (notation === "symbols" ? addPieceSymbol(san) : san);
  const tagLabel: Record<string, string> = {
    sacrifice: t("Board.Analysis.Brilliance.Tag.Sacrifice"),
    hidden: t("Board.Analysis.Brilliance.Tag.Hidden"),
    onlyMove: t("Board.Analysis.Brilliance.Tag.OnlyMove"),
    mate: t("Board.Analysis.Brilliance.Tag.Mate"),
  };
  const path = numberedLine(startFen, find.pathSan.map(sym));
  const continuation = find.continuationSan.slice(0, 6).map(sym).join(" ");

  return (
    <Paper withBorder p="xs">
      <Stack gap={6}>
        <Group justify="space-between" wrap="nowrap">
          <Group gap="xs" wrap="nowrap">
            <Text fw={700} size="lg" c={find.annotation === "!!" ? "cyan" : "teal"}>
              {numberedMove(find.fen, sym(find.moveSan))}
              {find.annotation}
            </Text>
            <ScoreBubble size="sm" score={find.score} />
          </Group>
          <Button size="compact-xs" variant="light" onClick={onPut}>
            {t("Board.Analysis.Brilliance.PutOnBoard")}
          </Button>
        </Group>
        <Group gap={4}>
          {find.tags.map((tag) => (
            <Badge key={tag} size="xs" variant="light" color={tag === "sacrifice" ? "red" : "blue"}>
              {tag === "sacrifice"
                ? `${tagLabel[tag]} ${(find.sacrifice / 100).toFixed(1)}`
                : (tagLabel[tag] ?? tag)}
            </Badge>
          ))}
          {find.clubMoves > 0 && (
            <Badge size="xs" variant="light" color="orange">
              {t("Board.Analysis.Brilliance.Tag.Club")}
            </Badge>
          )}
        </Group>
        <Text size="xs" c="dimmed">
          {path
            ? t("Board.Analysis.Brilliance.After", { line: path })
            : t("Board.Analysis.Brilliance.Now")}
        </Text>
        {continuation && <Text size="xs">… {continuation}</Text>}
      </Stack>
    </Paper>
  );
}

export default memo(BrilliancePanel);
