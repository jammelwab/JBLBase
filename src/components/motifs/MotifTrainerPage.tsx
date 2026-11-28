import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Chip,
  Group,
  Menu,
  MultiSelect,
  Paper,
  Progress,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Title,
} from "@mantine/core";
import type { Key } from "@lichess-org/chessground/types";
import { notifications } from "@mantine/notifications";
import {
  IconArrowBack,
  IconBulb,
  IconCheck,
  IconDots,
  IconFileImport,
  IconLock,
  IconPlayerPlay,
  IconRefresh,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import type { Role } from "chessops";
import { useAtom, useAtomValue } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Chessground } from "@/chessground/Chessground";
import { cloudAccountAtom } from "@/utils/cloud/sync";
import { boardMoves, sanToSquares, squaresToSan } from "@/utils/gamesTree";
import CoachBoard from "../coach/CoachBoard";
import { playCoachTone } from "../coach/coachSound";
import {
  fenAfter,
  judgeMotifMove,
  MOTIF_LEVELS,
  type MotifCollection,
  type MotifLevel,
  parseMotifCollection,
  sideToMove,
} from "./motifImport";
import {
  buildSession,
  countLines,
  MOTIF_MODES,
  type MotifMode,
  type MotifTask,
  type SessionFilter,
} from "./motifSession";
import {
  addMotifCollection,
  canUseMotifTrainer,
  extendMotifCollection,
  loadMotifCollections,
  motifCollectionsAtom,
  motifLoadedAtom,
  motifProgressAtom,
  recordLine,
  removeMotifCollection,
  setChapterLevel,
} from "./motifStore";

const arrow = (sq: [string, string] | null, brush = "green") =>
  sq ? [{ orig: sq[0] as Key, dest: sq[1] as Key, brush }] : [];

async function pickPgnFiles(): Promise<{ name: string; text: string }[]> {
  const picked = await open({ multiple: true, filters: [{ name: "PGN", extensions: ["pgn"] }] });
  if (!picked) return [];
  const paths = (Array.isArray(picked) ? picked : [picked]).sort();
  return Promise.all(paths.map(async (path) => ({ name: path, text: await readTextFile(path) })));
}

// Motiv-Trainer (1.2.32): Reversing Mate. Nur für Konten mit dem Recht "motifTrainer".
export default function MotifTrainerPage() {
  const { t } = useTranslation();
  const account = useAtomValue(cloudAccountAtom);
  const allowed = canUseMotifTrainer(account);
  const [session, setSession] = useState<{ tasks: MotifTask[]; mode: MotifMode } | null>(null);

  useEffect(() => {
    if (allowed) void loadMotifCollections();
  }, [allowed]);

  if (!allowed) {
    return (
      <Stack align="center" justify="center" h="100%" p="xl" gap="sm">
        <IconLock size={48} style={{ opacity: 0.4 }} />
        <Title order={3}>{t("Motifs.Title")}</Title>
        <Text c="dimmed" ta="center" maw={420}>
          {t("Motifs.Locked")}
        </Text>
      </Stack>
    );
  }

  return (
    <ScrollArea h="100%" type="auto">
      <Stack gap="lg" p="md" maw={1150} mx="auto">
        {session ? (
          <MotifRun tasks={session.tasks} mode={session.mode} onExit={() => setSession(null)} />
        ) : (
          <MotifSetup onStart={(tasks, mode) => setSession({ tasks, mode })} />
        )}
      </Stack>
    </ScrollArea>
  );
}

// ---------- Auswahl ----------

function MotifSetup({ onStart }: { onStart: (tasks: MotifTask[], mode: MotifMode) => void }) {
  const { t } = useTranslation();
  const collections = useAtomValue(motifCollectionsAtom);
  const loaded = useAtomValue(motifLoadedAtom);
  const progress = useAtomValue(motifProgressAtom);
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const collection = collections.find((c) => c.id === collectionId) ?? collections[0] ?? null;
  const [mode, setMode] = useState<MotifMode>("reversing");
  const [levels, setLevels] = useState<MotifLevel[]>([...MOTIF_LEVELS]);
  const [chapterIds, setChapterIds] = useState<string[]>([]);
  const [onlyMistakes, setOnlyMistakes] = useState(false);
  const [withForwarding, setWithForwarding] = useState(true);
  const [busy, setBusy] = useState(false);

  const filter: SessionFilter = { mode, levels, chapterIds, onlyMistakes, withForwarding };
  const tasks = useMemo(
    () => (collection ? buildSession(collection, filter, progress) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [collection, mode, levels, chapterIds, onlyMistakes, withForwarding, progress],
  );

  async function importFiles(into?: MotifCollection) {
    setBusy(true);
    try {
      const files = await pickPgnFiles();
      if (files.length === 0) return;
      const name = into?.name ?? files[0].name.split(/[\\/]/).slice(-2, -1)[0] ?? "Motive";
      const { collection: parsed, skipped } = parseMotifCollection(name, files);
      const counts = countLines(parsed);
      if (counts.patterns === 0) {
        notifications.show({ color: "red", title: t("Motifs.Import.Empty"), message: "" });
        return;
      }
      if (into) await extendMotifCollection(into.id, parsed);
      else {
        await addMotifCollection(parsed);
        setCollectionId(parsed.id);
      }
      notifications.show({
        color: skipped.length ? "yellow" : "teal",
        title: t("Motifs.Import.Done", { patterns: counts.patterns }),
        message: skipped.length
          ? t("Motifs.Import.Skipped", {
              count: skipped.length,
              list: skipped.slice(0, 5).join(", "),
            })
          : t("Motifs.Import.Counts", counts),
      });
    } catch (e) {
      notifications.show({
        color: "red",
        title: t("Motifs.Import.Failed"),
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Group justify="space-between" align="flex-end">
        <Stack gap={2}>
          <Title order={2}>{t("Motifs.Title")}</Title>
          <Text c="dimmed" size="sm" maw={640}>
            {t("Motifs.Subtitle")}
          </Text>
        </Stack>
        <Button
          leftSection={<IconFileImport size={18} />}
          variant="light"
          loading={busy}
          onClick={() => void importFiles()}
        >
          {t("Motifs.Import.Button")}
        </Button>
      </Group>

      {loaded && collections.length === 0 && (
        <Alert color="blue" title={t("Motifs.Empty.Title")}>
          <Text size="sm" style={{ whiteSpace: "pre-line" }}>
            {t("Motifs.Empty.Text")}
          </Text>
        </Alert>
      )}

      {collection && (
        <>
          <Group gap="sm" align="flex-end">
            {collections.length > 1 && (
              <Select
                label={t("Motifs.Collection")}
                data={collections.map((c) => ({ value: c.id, label: c.name }))}
                value={collection.id}
                onChange={setCollectionId}
                allowDeselect={false}
                w={260}
              />
            )}
            <CollectionStats collection={collection} />
            <Menu position="bottom-end">
              <Menu.Target>
                <ActionIcon variant="subtle" aria-label={t("Motifs.More")}>
                  <IconDots size={18} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item
                  leftSection={<IconFileImport size={14} />}
                  onClick={() => void importFiles(collection)}
                >
                  {t("Motifs.Import.AddChapters")}
                </Menu.Item>
                <Menu.Item
                  color="red"
                  leftSection={<IconTrash size={14} />}
                  onClick={() => void removeMotifCollection(collection.id)}
                >
                  {t("Motifs.Remove")}
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>

          <Card withBorder radius="md" p="lg">
            <Stack gap="md">
              <SegmentedControl
                value={mode}
                onChange={(v) => setMode(v as MotifMode)}
                data={MOTIF_MODES.map((m) => ({ value: m, label: t(`Motifs.Mode.${m}`) }))}
              />
              <Text size="sm" c="dimmed">
                {t(`Motifs.ModeHelp.${mode}`)}
              </Text>
              <Stack gap={6}>
                <Text size="sm" fw={500}>
                  {t("Motifs.Levels")}
                </Text>
                <Chip.Group multiple value={levels} onChange={(v) => setLevels(v as MotifLevel[])}>
                  <Group gap="xs">
                    {MOTIF_LEVELS.map((l) => (
                      <Chip key={l} value={l} size="sm">
                        {t(`Motifs.Level.${l}`)}
                      </Chip>
                    ))}
                  </Group>
                </Chip.Group>
              </Stack>
              <MultiSelect
                label={t("Motifs.Chapters")}
                placeholder={chapterIds.length ? undefined : t("Motifs.AllChapters")}
                data={collection.chapters
                  .filter((c) => c.patterns.length > 0)
                  .map((c) => ({ value: c.id, label: c.title }))}
                value={chapterIds}
                onChange={setChapterIds}
                clearable
                searchable
              />
              <Group gap="lg">
                {mode !== "test1" && (
                  <Switch
                    checked={withForwarding}
                    onChange={(e) => setWithForwarding(e.currentTarget.checked)}
                    label={t("Motifs.WithForwarding")}
                  />
                )}
                <Checkbox
                  checked={onlyMistakes}
                  onChange={(e) => setOnlyMistakes(e.currentTarget.checked)}
                  label={t("Motifs.OnlyMistakes")}
                />
              </Group>
              <Group justify="space-between">
                <Text size="sm" c="dimmed">
                  {t("Motifs.TaskCount", { count: tasks.length })}
                </Text>
                <Button
                  leftSection={<IconPlayerPlay size={18} />}
                  disabled={tasks.length === 0}
                  onClick={() => onStart(tasks, mode)}
                >
                  {t("Motifs.Start")}
                </Button>
              </Group>
            </Stack>
          </Card>

          <ChapterList collection={collection} />
        </>
      )}
    </>
  );
}

function CollectionStats({ collection }: { collection: MotifCollection }) {
  const { t } = useTranslation();
  const c = countLines(collection);
  return (
    <Group gap={6} style={{ flex: 1 }}>
      <Badge variant="light">{t("Motifs.Stat.Patterns", { count: c.patterns })}</Badge>
      <Badge variant="light" color="teal">
        {t("Motifs.Stat.Mate1", { count: c.mate1 })}
      </Badge>
      <Badge variant="light" color="grape">
        {t("Motifs.Stat.Longer", { count: c.longer })}
      </Badge>
      <Badge variant="light" color="orange">
        {t("Motifs.Stat.Forwarding", { count: c.forwarding })}
      </Badge>
    </Group>
  );
}

function ChapterList({ collection }: { collection: MotifCollection }) {
  const { t } = useTranslation();
  const progress = useAtomValue(motifProgressAtom);
  return (
    <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
      {collection.chapters.map((chapter) => {
        const lines = chapter.patterns.flatMap((p) => [...p.steps, ...p.forwarding]);
        const done = lines.filter((l) => progress[l.id]?.last === "ok").length;
        return (
          <Paper key={chapter.id} withBorder radius="md" p="md">
            <Stack gap={6}>
              <Group justify="space-between" wrap="nowrap">
                <Text fw={600} lineClamp={1}>
                  {chapter.title}
                </Text>
                <Select
                  size="xs"
                  w={140}
                  aria-label={t("Motifs.Levels")}
                  data={MOTIF_LEVELS.map((l) => ({ value: l, label: t(`Motifs.Level.${l}`) }))}
                  value={chapter.level}
                  allowDeselect={false}
                  onChange={(v) =>
                    v && void setChapterLevel(collection.id, chapter.id, v as MotifLevel)
                  }
                />
              </Group>
              <Text size="xs" c="dimmed">
                {t("Motifs.ChapterCounts", {
                  patterns: chapter.patterns.length,
                  lines: lines.length,
                })}
              </Text>
              {lines.length > 0 && (
                <Progress value={(done / lines.length) * 100} color="teal" size="sm" />
              )}
            </Stack>
          </Paper>
        );
      })}
    </SimpleGrid>
  );
}

// ---------- Lösen ----------

type Result = { lineId: string; ok: boolean };

function MotifRun({
  tasks,
  mode,
  onExit,
}: {
  tasks: MotifTask[];
  mode: MotifMode;
  onExit: () => void;
}) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<Result[]>([]);
  const [, setProgress] = useAtom(motifProgressAtom);
  const task = tasks[index];

  const finish = (ok: boolean) => {
    setResults((r) => [...r, { lineId: task.line.id, ok }]);
    setProgress((p) => recordLine(p, task.line.id, ok));
  };

  if (!task) {
    const right = results.filter((r) => r.ok).length;
    return (
      <Stack align="center" gap="md" py="xl">
        <Title order={2}>{t("Motifs.Summary.Title")}</Title>
        <Text size="lg">{t("Motifs.Summary.Score", { right, total: results.length })}</Text>
        <Progress
          w={320}
          value={results.length ? (right / results.length) * 100 : 0}
          color="teal"
          size="lg"
        />
        <Group>
          <Button variant="light" leftSection={<IconArrowBack size={18} />} onClick={onExit}>
            {t("Motifs.Back")}
          </Button>
          <Button
            leftSection={<IconRefresh size={18} />}
            onClick={() => {
              setIndex(0);
              setResults([]);
            }}
          >
            {t("Motifs.Again")}
          </Button>
        </Group>
      </Stack>
    );
  }

  return (
    <>
      <Group justify="space-between">
        <Button variant="subtle" leftSection={<IconArrowBack size={16} />} onClick={onExit}>
          {t("Motifs.Back")}
        </Button>
        <Group gap="sm">
          <Badge variant="light">{t(`Motifs.Mode.${mode}`)}</Badge>
          <Text size="sm" c="dimmed">
            {t("Motifs.TaskOf", { n: index + 1, total: tasks.length })}
          </Text>
        </Group>
      </Group>
      <Progress value={(index / tasks.length) * 100} size="xs" />
      <MotifSolve
        key={`${index}-${task.line.id}`}
        task={task}
        showTitles={mode === "reversing"}
        onFinish={finish}
        onNext={() => setIndex((i) => i + 1)}
      />
    </>
  );
}

type SolveState = "play" | "wrong" | "solved" | "shown";

function MotifSolve({
  task,
  showTitles,
  onFinish,
  onNext,
}: {
  task: MotifTask;
  showTitles: boolean;
  onFinish: (ok: boolean) => void;
  onNext: () => void;
}) {
  const { t } = useTranslation();
  const { line, template, chapter, pattern, forwarding } = task;
  const solver = sideToMove(line.fen);
  const [ply, setPly] = useState(0);
  const [state, setState] = useState<SolveState>("play");
  const [mistakes, setMistakes] = useState(0);
  const [resetKey, setResetKey] = useState(0);
  const [aid, setAid] = useState(true);
  const [hint, setHint] = useState(false);
  const reported = useRef(false);

  const fen = useMemo(() => fenAfter(line, ply), [line, ply]);
  const { dests } = useMemo(() => boardMoves(fen), [fen]);
  const lastMove = useMemo(() => {
    if (ply === 0) return undefined;
    const sq = sanToSquares(fenAfter(line, ply - 1), line.moves[ply - 1].san);
    return sq ? (sq as Key[]) : undefined;
  }, [line, ply]);
  const done = ply >= line.moves.length;
  const solverToMove = !done && sideToMove(fen) === solver;

  const report = (ok: boolean) => {
    if (reported.current) return;
    reported.current = true;
    onFinish(ok);
  };

  // Gegner antwortet von selbst
  useEffect(() => {
    if (done || solverToMove || state === "shown") return;
    const timer = setTimeout(() => setPly((p) => p + 1), 550);
    return () => clearTimeout(timer);
  }, [done, solverToMove, state]);

  useEffect(() => {
    if (!done || state === "shown") return;
    setState("solved");
    playCoachTone(mistakes === 0 && !hint ? "brilliant" : "good");
    report(mistakes === 0 && !hint);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  const play = (orig: string, dest: string, promotion?: Role) => {
    const san = squaresToSan(fen, orig, dest, promotion);
    if (san && judgeMotifMove(line, ply, fen, san) === "right") {
      setHint(false);
      setState("play");
      setPly((p) => p + 1);
      return;
    }
    setMistakes((m) => m + 1);
    setState("wrong");
    playCoachTone("mistake");
    setResetKey((k) => k + 1);
  };

  const showSolution = () => {
    setState("shown");
    report(false);
  };

  // Gezeigte Lösung Zug für Zug abspielen
  useEffect(() => {
    if (state !== "shown" || done) return;
    const timer = setTimeout(() => setPly((p) => p + 1), 800);
    return () => clearTimeout(timer);
  }, [state, done, ply]);

  const nextSan = line.moves[ply]?.san;
  const hintArrow = hint && solverToMove && nextSan ? sanToSquares(fen, nextSan) : null;
  const playedComments = line.moves.slice(0, ply).filter((m) => m.comment);

  const templateArrow = template ? sanToSquares(template.fen, template.moves[0].san) : null;

  const say =
    state === "solved"
      ? mistakes === 0 && !hint
        ? t("Motifs.Say.Perfect")
        : t("Motifs.Say.Solved")
      : state === "shown"
        ? t("Motifs.Say.Shown")
        : state === "wrong"
          ? t("Motifs.Say.Wrong")
          : solverToMove
            ? t(`Motifs.Say.Turn.${solver}`, { n: line.mateIn - Math.floor(ply / 2) })
            : t("Motifs.Say.Opponent");

  return (
    <Group align="flex-start" gap="xl" wrap="wrap" justify="center">
      <Box w={520} maw="100%" style={{ aspectRatio: "1 / 1", flexShrink: 0 }}>
        <CoachBoard
          key={resetKey}
          fen={fen}
          orientation={solver}
          turnColor={sideToMove(fen)}
          lastMove={lastMove}
          check={/[+#]$/.test(line.moves[ply - 1]?.san ?? "")}
          viewOnly={!solverToMove || state === "shown"}
          movable={{
            free: false,
            color: solverToMove && state !== "shown" ? solver : undefined,
            dests: dests as never,
            showDests: true,
          }}
          onMove={play}
          drawable={{ enabled: true, visible: true, autoShapes: arrow(hintArrow, "blue") }}
        />
      </Box>

      <Stack w={380} maw="100%" gap="sm">
        <Group gap={6}>
          {showTitles && <Badge variant="outline">{chapter.title}</Badge>}
          <Badge color={line.mateIn === 1 ? "teal" : "grape"}>
            {t("Motifs.MateIn", { count: line.mateIn })}
          </Badge>
          {showTitles && (
            <Badge variant="light" color={forwarding ? "orange" : "blue"}>
              {forwarding ? t("Motifs.Forwarding") : t("Motifs.Step", { step: line.step })}
            </Badge>
          )}
          <Badge variant="light" color="gray">
            {t(`Motifs.Level.${chapter.level}`)}
          </Badge>
        </Group>
        {showTitles && (
          <Text fw={600} size="lg">
            {pattern.title}
          </Text>
        )}

        <Paper
          withBorder
          p="sm"
          radius="md"
          style={{
            borderColor:
              state === "solved"
                ? "var(--mantine-color-teal-6)"
                : state === "wrong"
                  ? "var(--mantine-color-orange-6)"
                  : undefined,
          }}
          aria-live="polite"
        >
          <Group gap="xs" wrap="nowrap">
            {state === "solved" ? (
              <IconCheck color="var(--mantine-color-teal-6)" />
            ) : state === "wrong" ? (
              <IconX color="var(--mantine-color-orange-6)" />
            ) : null}
            <Text>{say}</Text>
          </Group>
        </Paper>

        {forwarding && line.forwardFrom !== undefined && showTitles && (
          <Text size="sm" c="dimmed">
            {t("Motifs.ForwardingHelp", {
              move: `${Math.floor(line.forwardFrom / 2) + 1}...${line.moves[line.forwardFrom].san}`,
            })}
          </Text>
        )}

        {template && (
          <Paper withBorder p="sm" radius="md">
            <Group justify="space-between" mb={aid ? "xs" : 0}>
              <Text size="sm" fw={500}>
                {t("Motifs.Aid.Title")}
              </Text>
              <Switch
                size="xs"
                checked={aid}
                onChange={(e) => setAid(e.currentTarget.checked)}
                aria-label={t("Motifs.Aid.Title")}
              />
            </Group>
            {aid && (
              <Group align="flex-start" wrap="nowrap" gap="sm">
                <Box w={180} h={180} style={{ flexShrink: 0 }}>
                  <Chessground
                    fen={template.fen}
                    orientation={solver}
                    viewOnly
                    coordinates={false}
                    drawable={{
                      enabled: false,
                      visible: true,
                      autoShapes: arrow(templateArrow),
                    }}
                  />
                </Box>
                <Text size="xs" c="dimmed">
                  {t("Motifs.Aid.Text", { move: template.moves[0].san })}
                </Text>
              </Group>
            )}
          </Paper>
        )}

        <ScrollArea.Autosize mah={300} type="auto">
          <Stack gap={6}>
            {ply === 0 && line.intro && showTitles && (
              <Text size="sm" style={{ whiteSpace: "pre-line" }}>
                {line.intro}
              </Text>
            )}
            <MoveList line={line} ply={ply} />
            {(state === "solved" || state === "shown") &&
              playedComments.map((m, i) => (
                <Text key={i} size="sm" style={{ whiteSpace: "pre-line" }}>
                  <b>{m.san}</b> {m.comment}
                </Text>
              ))}
            {state !== "solved" && state !== "shown" && ply > 0 && line.moves[ply - 1].comment && (
              <Text size="sm" c="dimmed" style={{ whiteSpace: "pre-line" }}>
                {line.moves[ply - 1].comment}
              </Text>
            )}
          </Stack>
        </ScrollArea.Autosize>

        <Group gap="xs">
          {state === "solved" || (state === "shown" && done) ? (
            <Button onClick={onNext} rightSection={<IconPlayerPlay size={16} />}>
              {t("Motifs.Next")}
            </Button>
          ) : (
            <>
              <Button
                variant="light"
                leftSection={<IconBulb size={16} />}
                disabled={!solverToMove || hint || state === "shown"}
                onClick={() => {
                  setHint(true);
                  report(false);
                }}
              >
                {t("Motifs.Hint")}
              </Button>
              <Button
                variant="light"
                color="gray"
                disabled={state === "shown"}
                onClick={showSolution}
              >
                {t("Motifs.ShowSolution")}
              </Button>
            </>
          )}
        </Group>
      </Stack>
    </Group>
  );
}

function MoveList({ line, ply }: { line: MotifTask["line"]; ply: number }) {
  const startBlack = sideToMove(line.fen) === "black";
  const parts: string[] = [];
  line.moves.slice(0, ply).forEach((m, i) => {
    const abs = i + (startBlack ? 1 : 0);
    const no = Math.floor(abs / 2) + 1;
    if (abs % 2 === 0) parts.push(`${no}.${m.san}`);
    else parts.push(i === 0 ? `${no}...${m.san}` : m.san);
  });
  if (parts.length === 0) return null;
  return (
    <Text size="sm" ff="monospace">
      {parts.join(" ")}
    </Text>
  );
}
