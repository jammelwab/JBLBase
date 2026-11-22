import {
  Alert,
  Badge,
  Box,
  Button,
  Chip,
  Group,
  Loader,
  Modal,
  Paper,
  Radio,
  SegmentedControl,
  Stack,
  Stepper,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import type { Key } from "@lichess-org/chessground/types";
import { IconArrowBackUp, IconCheck, IconRefresh } from "@tabler/icons-react";
import { useLoaderData } from "@tanstack/react-router";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Chessground } from "@/chessground/Chessground";
import type { FileMetadata } from "@/components/files/file";
import { boardMoves, sanToSquares, squaresToSan } from "@/utils/gamesTree";
import {
  addLineToRepertoire,
  createRepertoire,
  useMainOwner,
  useRepertoires,
} from "@/utils/repertoires";
import { mergeLine } from "@/utils/repertoireTree";
import type { TreeNode } from "@/utils/treeReducer";
import CoachFigure from "./CoachFigure";
import {
  coachLineToolsAtom,
  EnginePanel,
  LichessPanel,
  type LineTool,
  RepertoireTreePanel,
} from "./CoachLineTools";
import { coachDiaryAtom } from "./coachDiary";
import {
  coachLineWizardAtom,
  knownPrefix,
  type LineColor,
  type LineSuggestion,
  lineSuggestions,
  lineText,
  lineTree,
  moverAfter,
  nodeAfter,
  playLine,
  suggestionStart,
} from "./coachLines";
import { coachPathEventAtom } from "./coachPath";

type Target = { file: FileMetadata; name: string; color: LineColor; root: TreeNode };

// JBL spricht: kleine Figur mit Sprechblase
function Say({ children }: { children: React.ReactNode }) {
  return (
    <Group gap="sm" wrap="nowrap" align="flex-start">
      <Box style={{ flexShrink: 0 }}>
        <CoachFigure size={56} />
      </Box>
      <Paper withBorder radius="md" p="sm" style={{ flex: 1 }}>
        <Text size="sm">{children}</Text>
      </Paper>
    </Group>
  );
}

// Neue Linie mit JBL: Repertoire wählen, Vorschlag, ausprobieren, bestätigen.
export default function CoachLineWizard({ tabId }: { tabId: string }) {
  const [open, setOpen] = useAtom(coachLineWizardAtom);
  if (open !== tabId) return null;
  return <Wizard onClose={() => setOpen(null)} />;
}

function Wizard({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const [target, setTarget] = useState<Target | null>(null);
  const [suggestion, setSuggestion] = useState<LineSuggestion | null>(null);
  const [moves, setMoves] = useState<string[]>([]);
  const [added, setAdded] = useState<number | null>(null);

  const startLine = (s: LineSuggestion | null) => {
    setSuggestion(s);
    setMoves(s ? suggestionStart(s) : []);
    setStep(2);
  };

  return (
    <Modal opened onClose={onClose} size={1040} title={t("Coach.NewLine.Title")} centered>
      <Stepper active={step} size="sm" allowNextStepsSelect={false} onStepClick={setStep}>
        <Stepper.Step label={t("Coach.NewLine.Step.Choose")}>
          <ChooseStep
            onChosen={(next) => {
              setTarget(next);
              setStep(1);
            }}
          />
        </Stepper.Step>
        <Stepper.Step label={t("Coach.NewLine.Step.Suggest")}>
          {target && <SuggestStep target={target} onStart={startLine} />}
        </Stepper.Step>
        <Stepper.Step label={t("Coach.NewLine.Step.Try")}>
          {target && (
            <TryStep
              target={target}
              moves={moves}
              setMoves={setMoves}
              start={suggestion ? suggestionStart(suggestion) : []}
              onBack={() => setStep(1)}
              onNext={() => setStep(3)}
            />
          )}
        </Stepper.Step>
        <Stepper.Step label={t("Coach.NewLine.Step.Confirm")}>
          {target && (
            <ConfirmStep
              target={target}
              moves={moves}
              added={added}
              onBack={() => setStep(2)}
              onAdded={(n, root) => {
                setAdded(n);
                setTarget({ ...target, root });
              }}
              onAnother={() => {
                setAdded(null);
                setMoves([]);
                setStep(1);
              }}
              onClose={onClose}
            />
          )}
        </Stepper.Step>
      </Stepper>
    </Modal>
  );
}

// Schritt 1: welches Repertoire (oder ein neues)
export function ChooseStep({ onChosen }: { onChosen: (target: Target) => void }) {
  const { t } = useTranslation();
  const { documentDir } = useLoaderData({ from: "/" });
  const { data, isLoading } = useRepertoires(documentDir);
  const owner = useMainOwner();
  const own = useMemo(
    () => (data ?? []).filter((r) => r.owner === owner && !r.shared && !r.parts),
    [data, owner],
  );
  const [selected, setSelected] = useState<string>("new");
  const [color, setColor] = useState<LineColor>("white");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (isLoading) return <Loader size="sm" />;
  const value = own.some((r) => r.file.path === selected)
    ? selected
    : own.length
      ? selected
      : "new";
  const creating = value === "new";

  const next = async () => {
    setError(null);
    if (!creating) {
      const r = own.find((x) => x.file.path === value);
      if (r) onChosen({ file: r.file, name: r.name, color: r.color, root: r.root });
      return;
    }
    const fileName =
      name.trim() ||
      t(color === "white" ? "Coach.NewLine.DefaultWhite" : "Coach.NewLine.DefaultBlack");
    setBusy(true);
    const result = await createRepertoire({ name: fileName, color, owner, dir: documentDir });
    setBusy(false);
    if (!result.isOk) {
      setError(t("Coach.NewLine.CreateFailed"));
      return;
    }
    onChosen({ file: result.value, name: fileName, color, root: lineTree([])!.root });
  };

  return (
    <Stack gap="md" mt="md">
      <Say>
        {own.length === 0 ? t("Coach.NewLine.Say.NoRepertoire") : t("Coach.NewLine.Say.Choose")}
      </Say>
      <Radio.Group value={value} onChange={setSelected}>
        <Stack gap={6}>
          {own.map((r) => (
            <Radio
              key={r.file.path}
              value={r.file.path}
              label={`${r.name} · ${t(r.color === "white" ? "Coach.NewLine.White" : "Coach.NewLine.Black")} · ${t("Coach.NewLine.Moves", { count: r.stats.moves })}`}
            />
          ))}
          <Radio value="new" label={t("Coach.NewLine.New")} />
        </Stack>
      </Radio.Group>
      {creating && (
        <Paper withBorder p="sm" radius="md">
          <Stack gap="xs">
            <Text size="sm" c="dimmed">
              {t("Coach.NewLine.NewHelp")}
            </Text>
            <SegmentedControl
              value={color}
              onChange={(v) => setColor(v as LineColor)}
              data={[
                { value: "white", label: t("Coach.NewLine.White") },
                { value: "black", label: t("Coach.NewLine.Black") },
              ]}
            />
            <TextInput
              label={t("Coach.NewLine.Name")}
              placeholder={t(
                color === "white" ? "Coach.NewLine.DefaultWhite" : "Coach.NewLine.DefaultBlack",
              )}
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
            />
          </Stack>
        </Paper>
      )}
      {error && <Alert color="red">{error}</Alert>}
      <Group justify="flex-end">
        <Button color="orange" onClick={next} loading={busy}>
          {creating ? t("Coach.NewLine.CreateAndNext") : t("Coach.NewLine.Next")}
        </Button>
      </Group>
    </Stack>
  );
}

// Schritt 2: JBLs Vorschläge, wo es weitergeht
export function SuggestStep({
  target,
  onStart,
}: {
  target: Target;
  onStart: (s: LineSuggestion | null) => void;
}) {
  const { t } = useTranslation();
  const diary = useAtomValue(coachDiaryAtom);
  const list = useMemo(
    () => lineSuggestions(target.root, target.color, diary),
    [target.root, target.color, diary],
  );
  const empty = target.root.children.length === 0;

  const describe = (s: LineSuggestion) => {
    const at = s.moves.length ? lineText(s.moves) : t("Coach.NewLine.FromStart");
    switch (s.kind) {
      case "gap":
        return t("Coach.NewLine.Suggest.gap", {
          at,
          move: lineText([s.move], s.moves.length),
          count: s.count,
        });
      case "common":
        return t("Coach.NewLine.Suggest.common", { at, move: lineText([s.move], s.moves.length) });
      case "short":
        return t("Coach.NewLine.Suggest.short", { at });
      case "start":
        return s.moves.length
          ? t("Coach.NewLine.Suggest.startBlack", { move: lineText(s.moves) })
          : t("Coach.NewLine.Suggest.startWhite");
    }
  };

  return (
    <Stack gap="md" mt="md">
      <Say>
        {empty
          ? t("Coach.NewLine.Say.Empty", { name: target.name })
          : list.length
            ? t("Coach.NewLine.Say.Suggest", { name: target.name })
            : t("Coach.NewLine.Say.NoSuggestion")}
      </Say>
      <Stack gap={6}>
        {list.map((s) => (
          <UnstyledButton
            key={`${s.kind}:${suggestionStart(s).join(" ")}`}
            onClick={() => onStart(s)}
          >
            <Paper withBorder radius="md" p="sm">
              <Group justify="space-between" wrap="nowrap" gap="sm">
                <Text size="sm">{describe(s)}</Text>
                <Badge color="orange" variant="light" style={{ flexShrink: 0 }}>
                  {t(`Coach.NewLine.Kind.${s.kind}`)}
                </Badge>
              </Group>
            </Paper>
          </UnstyledButton>
        ))}
        <Button variant="subtle" color="gray" onClick={() => onStart(null)}>
          {t("Coach.NewLine.OwnWay")}
        </Button>
      </Stack>
    </Stack>
  );
}

// Schritt 3: auf dem Brett ausprobieren, nichts wird gespeichert
export function TryStep({
  target,
  moves,
  setMoves,
  start,
  onBack,
  onNext,
}: {
  target: Target;
  moves: string[];
  setMoves: (moves: string[]) => void;
  start: string[];
  onBack: () => void;
  onNext: () => void;
}) {
  const { t } = useTranslation();
  const played = playLine(moves);
  const fen = played?.fen ?? "";
  const { turn, dests } = useMemo(() => boardMoves(fen), [fen]);
  const known = knownPrefix(target.root, moves);
  const here = known === moves.length ? nodeAfter(target.root, moves) : null;
  const inRepertoire = (here?.children ?? []).map((c) => c.san ?? "").filter(Boolean);
  const mine = moverAfter(moves) === target.color;
  const last = moves.length
    ? sanToSquares(playLine(moves.slice(0, -1))?.fen ?? "", moves.at(-1)!)
    : null;
  const newMoves = moves.length - known;
  const [tools, setTools] = useAtom(coachLineToolsAtom);

  const play = (san: string) => setMoves([...moves, san]);

  return (
    <Stack gap="md" mt="md">
      <Say>
        {mine
          ? inRepertoire.length
            ? t("Coach.NewLine.Say.YourMoveKnown")
            : t("Coach.NewLine.Say.YourMove")
          : t("Coach.NewLine.Say.TheirMove")}
      </Say>
      <Group align="flex-start" wrap="wrap" gap="lg">
        <Stack gap="xs" style={{ flexShrink: 0 }}>
          <Box w={360} h={360}>
            <Chessground
              key={moves.join(" ")}
              coordinates
              orientation={target.color}
              turnColor={turn}
              fen={fen}
              lastMove={last ? (last as Key[]) : undefined}
              movable={{
                free: false,
                color: turn,
                dests: dests as never,
                showDests: true,
                events: {
                  after: (orig, dest) => {
                    const san = squaresToSan(fen, orig, dest);
                    if (san) play(san);
                  },
                },
              }}
            />
          </Box>
          <Group gap="xs" justify="center">
            <Button
              size="xs"
              variant="default"
              leftSection={<IconArrowBackUp size={14} />}
              disabled={moves.length === 0}
              onClick={() => setMoves(moves.slice(0, -1))}
            >
              {t("Coach.NewLine.Undo")}
            </Button>
            <Button
              size="xs"
              variant="default"
              leftSection={<IconRefresh size={14} />}
              onClick={() => setMoves(start)}
            >
              {t("Coach.NewLine.Restart")}
            </Button>
          </Group>
        </Stack>
        <Stack gap="sm" style={{ flex: "1 1 300px", minWidth: 0 }}>
          <Paper withBorder radius="md" p="sm">
            <Text size="xs" c="dimmed" fw={600} tt="uppercase">
              {t("Coach.NewLine.YourLine")}
            </Text>
            {moves.length === 0 ? (
              <Text size="sm" c="dimmed">
                {t("Coach.NewLine.FromStart")}
              </Text>
            ) : (
              <Text size="sm">
                <Text span c="dimmed">
                  {lineText(moves.slice(0, known))}
                </Text>{" "}
                <Text span fw={700} c="orange">
                  {lineText(moves.slice(known), known)}
                </Text>
              </Text>
            )}
            <Text size="xs" c="dimmed" mt={4}>
              {t("Coach.NewLine.Legend")}
            </Text>
            {inRepertoire.length > 0 && (
              <Group gap={4} wrap="wrap" mt={6}>
                <Text size="xs" c="dimmed">
                  {t("Coach.NewLine.InRepertoire")}
                </Text>
                {inRepertoire.map((san) => (
                  <Button
                    key={san}
                    size="compact-xs"
                    variant="light"
                    color="gray"
                    onClick={() => play(san)}
                  >
                    {san}
                  </Button>
                ))}
              </Group>
            )}
          </Paper>
          <Chip.Group multiple value={tools} onChange={(v) => setTools(v as LineTool[])}>
            <Group gap={6}>
              <Chip size="xs" value="tree" color="orange">
                {t("Coach.NewLine.Tools.Tree")}
              </Chip>
              <Chip size="xs" value="engine" color="orange">
                {t("Coach.NewLine.Tools.Engine")}
              </Chip>
              <Chip size="xs" value="lichess" color="orange">
                {t("Coach.NewLine.Tools.Lichess")}
              </Chip>
            </Group>
          </Chip.Group>
          {tools.includes("tree") && (
            <Paper withBorder radius="md" p="sm">
              <Text size="xs" c="dimmed" fw={600} tt="uppercase" mb={4}>
                {t("Coach.NewLine.Tools.TreeTitle", { name: target.name })}
              </Text>
              <RepertoireTreePanel root={target.root} current={moves} onPick={setMoves} />
            </Paper>
          )}
          {tools.includes("engine") && fen && (
            <Paper withBorder radius="md" p="sm">
              <Text size="xs" c="dimmed" fw={600} tt="uppercase" mb={4}>
                {t("Coach.NewLine.Tools.EngineTitle")}
              </Text>
              <EnginePanel fen={fen} onPlay={play} />
            </Paper>
          )}
          {tools.includes("lichess") && fen && (
            <Paper withBorder radius="md" p="sm">
              <Text size="xs" c="dimmed" fw={600} tt="uppercase" mb={4}>
                {t("Coach.NewLine.Tools.LichessTitle")}
              </Text>
              <LichessPanel fen={fen} onPlay={play} />
            </Paper>
          )}
        </Stack>
      </Group>
      <Alert color="blue" variant="light" p="xs">
        <Text size="xs">{t("Coach.NewLine.OnlyTrying")}</Text>
      </Alert>
      <Group justify="space-between">
        <Button variant="subtle" color="gray" onClick={onBack}>
          {t("Coach.NewLine.Back")}
        </Button>
        <Button color="orange" disabled={newMoves === 0} onClick={onNext}>
          {newMoves === 0
            ? t("Coach.NewLine.NothingNew")
            : t("Coach.NewLine.ToConfirm", { count: newMoves })}
        </Button>
      </Group>
    </Stack>
  );
}

// Schritt 4: erst hier kommt die Linie ins Repertoire
export function ConfirmStep({
  target,
  moves,
  added,
  onBack,
  onAdded,
  onAnother,
  onClose,
}: {
  target: Target;
  moves: string[];
  added: number | null;
  onBack: () => void;
  onAdded: (n: number, root: TreeNode) => void;
  onAnother: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const pathEvent = useSetAtom(coachPathEventAtom);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const known = knownPrefix(target.root, moves);

  const confirm = async () => {
    const tree = lineTree(moves);
    if (!tree) return;
    setBusy(true);
    setError(null);
    try {
      const result = await addLineToRepertoire(target.file, tree.root, tree.path, {
        withVariations: false,
        label: t("Coach.NewLine.Label"),
      });
      if (!result.ok) {
        setError(t("Coach.NewLine.AddFailed"));
        return;
      }
      if (result.added > 0) pathEvent("line");
      // Die Linie gehört jetzt zum Repertoire: für die nächste Runde merken
      const merged = lineTree([])!.root;
      merged.children = target.root.children;
      mergeLine(merged, tree.root, tree.path);
      onAdded(result.added, merged);
    } catch {
      setError(t("Coach.NewLine.AddFailed"));
    } finally {
      setBusy(false);
    }
  };

  if (added !== null)
    return (
      <Stack gap="md" mt="md">
        <Say>{t("Coach.NewLine.Say.Added", { count: added, name: target.name })}</Say>
        <Group justify="flex-end">
          <Button variant="default" onClick={onAnother}>
            {t("Coach.NewLine.Another")}
          </Button>
          <Button color="orange" leftSection={<IconCheck size={16} />} onClick={onClose}>
            {t("Coach.NewLine.Done")}
          </Button>
        </Group>
      </Stack>
    );

  return (
    <Stack gap="md" mt="md">
      <Say>{t("Coach.NewLine.Say.Confirm", { name: target.name })}</Say>
      <Paper withBorder radius="md" p="md">
        <Text size="sm">
          <Text span c="dimmed">
            {lineText(moves.slice(0, known))}
          </Text>{" "}
          <Text span fw={700} c="orange">
            {lineText(moves.slice(known), known)}
          </Text>
        </Text>
        <Text size="xs" c="dimmed" mt={6}>
          {t("Coach.NewLine.NewMoves", { count: moves.length - known })}
        </Text>
      </Paper>
      {error && <Alert color="red">{error}</Alert>}
      <Group justify="space-between">
        <Button variant="subtle" color="gray" onClick={onBack}>
          {t("Coach.NewLine.BackToBoard")}
        </Button>
        <Button color="orange" loading={busy} onClick={confirm}>
          {t("Coach.NewLine.Add", { name: target.name })}
        </Button>
      </Group>
    </Stack>
  );
}
