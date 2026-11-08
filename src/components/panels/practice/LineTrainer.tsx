import type { DrawShape } from "@lichess-org/chessground/draw";
import {
  Alert,
  Badge,
  Button,
  Group,
  Progress,
  SegmentedControl,
  Stack,
  Text,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconPlayerPlay, IconPlayerStop } from "@tabler/icons-react";
import { makeSquare, type NormalMove } from "chessops";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import { updateCardPerformance } from "@/components/files/opening";
import {
  currentEvalOpenAtom,
  currentInvisibleAtom,
  currentLineTrainerBoardAtom,
  currentTabAtom,
  deckAtomFamily,
} from "@/state/atoms";
import {
  alternatives,
  buildLines,
  isUserTurn,
  type Line,
  MOVE_SECONDS,
  nodesOfLine,
  planSession,
  repeatItem,
  type SessionItem,
} from "@/utils/lineTrainer";
import { getTabFile, getTabGameNumber } from "@/utils/tabs";
import type { TreeNode } from "@/utils/treeReducer";

const OPPONENT_DELAY = 600;
const OPPONENT_DELAY_WITH_ALTERNATIVES = 1600;
const LINE_PAUSE = 700;

// done: the line is finished, the next one starts after a short pause
type Phase = "opponent" | "user" | "wrong" | "done";

type Session = {
  items: SessionItem[];
  index: number;
  ply: number;
  phase: Phase;
  deadline: number;
  // Items already queued for a repeat, so a line comes back only once per miss
  repeated: Set<number>;
  // Number of items planned at the start; the ones after it are repeats
  planned: number;
  correct: number;
  wrong: number;
};

function arrow(node: TreeNode, brush: string): DrawShape | null {
  if (!node.move || !("from" in node.move)) return null;
  const move = node.move as NormalMove;
  return { orig: makeSquare(move.from), dest: makeSquare(move.to), brush };
}

export default function LineTrainer() {
  const { t } = useTranslation();
  const store = useContext(TreeStateContext)!;
  const root = useStore(store, (s) => s.root);
  const headers = useStore(store, (s) => s.headers);
  const goToMove = useStore(store, (s) => s.goToMove);
  const color = headers.orientation || "white";
  const start = useMemo(() => headers.start ?? [], [headers.start]);

  const currentTab = useAtomValue(currentTabAtom);
  const tabFile = getTabFile(currentTab);
  const [deck, setDeck] = useAtom(
    deckAtomFamily({ file: tabFile?.path || "", game: getTabGameNumber(currentTab) }),
  );
  const setBoard = useSetAtom(currentLineTrainerBoardAtom);
  const setInvisible = useSetAtom(currentInvisibleAtom);
  const setEvalOpen = useSetAtom(currentEvalOpenAtom);

  const lines = useMemo(() => buildLines(root, start), [root, start]);
  const [mode, setMode] = useState<"due" | "all">("due");
  const [session, setSession] = useState<Session | null>(null);
  const [finished, setFinished] = useState<{ correct: number; wrong: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // A line needs training when one of your positions on it is new or due
  const isDue = useCallback(
    (line: Line) => {
      const nodes = nodesOfLine(root, line);
      const time = Date.now();
      return nodes.slice(start.length, -1).some((node) => {
        if (!isUserTurn(node, color)) return false;
        const card = deck.positions.find((p) => p.fen === node.fen)?.card;
        return !card || card.reps === 0 || new Date(card.due).getTime() <= time;
      });
    },
    [root, start.length, color, deck.positions],
  );
  const dueCount = useMemo(() => lines.filter(isDue).length, [lines, isDue]);

  const item = session ? session.items[session.index] : null;
  const line = item ? lines[item.line] : null;
  const nodes = useMemo(() => (line ? nodesOfLine(root, line) : []), [root, line]);
  const alts = useMemo(() => {
    if (!session || !line || session.phase === "done") return [];
    // The other opponent moves at the position before the move just played (or about to be)
    const ply = session.phase === "opponent" ? session.ply : session.ply - 1;
    if (ply < 0 || ply >= line.length || isUserTurn(nodes[ply], color)) return [];
    return alternatives(root, line, ply);
  }, [session, line, nodes, root, color]);

  const grade = useCallback(
    (node: TreeNode, value: 1 | 3) => {
      const i = deck.positions.findIndex((p) => p.fen === node.fen);
      if (i >= 0) updateCardPerformance(setDeck, i, deck.positions[i].card, value);
    },
    [deck.positions, setDeck],
  );

  const stop = useCallback(() => {
    setSession(null);
    setBoard({ active: false, onMove: null, shapes: [] });
    setInvisible(false);
    setEvalOpen(true);
  }, [setBoard, setInvisible, setEvalOpen]);

  // Leaving the tab ends the session
  useEffect(() => () => setBoard({ active: false, onMove: null, shapes: [] }), [setBoard]);

  const phaseAt = useCallback(
    (lineNodes: TreeNode[], ply: number): Phase =>
      isUserTurn(lineNodes[ply], color) ? "user" : "opponent",
    [color],
  );

  const begin = useCallback(
    (
      items: SessionItem[],
      index: number,
      base: Omit<Session, "items" | "index" | "ply" | "phase" | "deadline">,
    ) => {
      if (index >= items.length) {
        setFinished({ correct: base.correct, wrong: base.wrong });
        stop();
        return;
      }
      const it = items[index];
      const l = lines[it.line];
      goToMove(l.slice(0, it.startPly));
      setSession({
        ...base,
        items,
        index,
        ply: it.startPly,
        phase: phaseAt(nodesOfLine(root, l), it.startPly),
        deadline: Date.now() + MOVE_SECONDS * 1000,
      });
    },
    [lines, goToMove, phaseAt, root, stop],
  );

  function startSession() {
    const minPly = start.length;
    const items = planSession(lines, mode === "due" ? isDue : () => true, minPly);
    if (items.length === 0) return;
    setFinished(null);
    setInvisible(true);
    setEvalOpen(false);
    begin(items, 0, { repeated: new Set(), planned: items.length, correct: 0, wrong: 0 });
  }

  // Move on to `ply` within the current line, or to the next line when it is done
  const advance = useCallback(
    (s: Session, ply: number) => {
      const l = lines[s.items[s.index].line];
      if (ply >= l.length) {
        // The pause before the next line runs in an effect, so stopping the session
        // during it really stops (a bare timeout used to start the next line anyway)
        setSession({ ...s, ply, phase: "done", deadline: Infinity });
        return;
      }
      setSession({
        ...s,
        ply,
        phase: phaseAt(nodesOfLine(root, l), ply),
        deadline: Date.now() + MOVE_SECONDS * 1000,
      });
    },
    [lines, phaseAt, root],
  );

  const miss = useCallback(
    (s: Session, reason: "wrong" | "time") => {
      const l = lines[s.items[s.index].line];
      const expected = nodesOfLine(root, l)[s.ply + 1];
      grade(nodesOfLine(root, l)[s.ply], 1);
      const items = [...s.items];
      const repeated = new Set(s.repeated);
      if (!repeated.has(s.index)) {
        repeated.add(s.index);
        items.push(repeatItem(s.items[s.index].line, s.ply, start.length));
      }
      notifications.show({
        color: "red",
        title: reason === "time" ? t("Practice.Lines.TimeUp") : t("Common.Incorrect"),
        message: t("Board.Practice.CorrectMoveWas", { move: expected.san }),
      });
      setSession({ ...s, items, repeated, phase: "wrong", wrong: s.wrong + 1, deadline: Infinity });
    },
    [lines, root, grade, start.length, t],
  );

  const onMove = useCallback(
    (san: string) => {
      if (!session || (session.phase !== "user" && session.phase !== "wrong")) return;
      const l = lines[session.items[session.index].line];
      const lineNodes = nodesOfLine(root, l);
      const node = lineNodes[session.ply];
      const expected = lineNodes[session.ply + 1];
      if (san === expected.san) {
        if (session.phase === "user") grade(node, 3);
        goToMove(l.slice(0, session.ply + 1));
        advance(
          { ...session, correct: session.phase === "user" ? session.correct + 1 : session.correct },
          session.ply + 1,
        );
        return;
      }
      if (session.phase === "wrong") return;
      if (node.children.some((c) => c.san === san)) {
        notifications.show({
          color: "blue",
          message: t("Practice.Lines.OtherRepertoireMove", { move: san }),
        });
        return;
      }
      miss(session, "wrong");
    },
    [session, lines, root, grade, goToMove, advance, miss, t],
  );

  const onMoveRef = useRef(onMove);
  useEffect(() => {
    onMoveRef.current = onMove;
  }, [onMove]);

  // Opponent moves are played after a short pause, longer when other moves are shown
  useEffect(() => {
    if (!session || session.phase !== "opponent" || !line) return;
    if (session.ply >= line.length) return;
    const delay = alts.length > 0 ? OPPONENT_DELAY_WITH_ALTERNATIVES : OPPONENT_DELAY;
    const timer = setTimeout(() => {
      goToMove(line.slice(0, session.ply + 1));
      advance(session, session.ply + 1);
    }, delay);
    return () => clearTimeout(timer);
  }, [session, line, alts.length, goToMove, advance]);

  useEffect(() => {
    if (!session || session.phase !== "done") return;
    const timer = setTimeout(() => begin(session.items, session.index + 1, session), LINE_PAUSE);
    return () => clearTimeout(timer);
  }, [session, begin]);

  // The clock for your move
  useEffect(() => {
    if (!session || session.phase !== "user") return;
    const tick = setInterval(() => setNow(Date.now()), 200);
    const timeout = setTimeout(() => miss(session, "time"), session.deadline - Date.now());
    return () => {
      clearInterval(tick);
      clearTimeout(timeout);
    };
  }, [session, miss]);

  // What the board draws and whether it takes moves
  useEffect(() => {
    if (!session || !line) return;
    const shapes: DrawShape[] = [];
    for (const alt of alts) {
      const a = arrow(alt, "blue");
      if (a) shapes.push(a);
    }
    if (session.phase === "wrong") {
      const a = arrow(nodes[session.ply + 1], "green");
      if (a) shapes.push(a);
    }
    const takesMoves = session.phase === "user" || session.phase === "wrong";
    setBoard({
      active: true,
      onMove: takesMoves ? (san: string) => onMoveRef.current(san) : null,
      shapes,
    });
  }, [session, line, alts, nodes, setBoard]);

  if (lines.length === 0) {
    return <Alert>{t("Practice.Lines.Empty")}</Alert>;
  }

  if (!session) {
    return (
      <Stack gap="sm" p="sm">
        <Text size="sm">{t("Practice.Lines.Help", { seconds: MOVE_SECONDS })}</Text>
        {finished && (
          <Alert color="green">
            {t("Practice.Lines.Finished", { correct: finished.correct, wrong: finished.wrong })}
          </Alert>
        )}
        <SegmentedControl
          value={mode}
          onChange={(v) => setMode(v as "due" | "all")}
          data={[
            { value: "due", label: t("Practice.Lines.Due", { count: dueCount }) },
            { value: "all", label: t("Practice.Lines.All", { count: lines.length }) },
          ]}
        />
        <Button
          leftSection={<IconPlayerPlay size="1rem" />}
          disabled={mode === "due" && dueCount === 0}
          onClick={startSession}
        >
          {t("Practice.Lines.Start")}
        </Button>
      </Stack>
    );
  }

  const remaining =
    session.phase === "user" ? Math.max(0, (session.deadline - now) / 1000) : MOVE_SECONDS;
  const isRepeat = session.index >= session.planned;

  return (
    <Stack gap="sm" p="sm">
      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          {t("Practice.Lines.Progress", {
            current: Math.min(session.index + 1, session.items.length),
            total: session.items.length,
          })}
          {isRepeat ? ` · ${t("Practice.Lines.Repeat")}` : ""}
        </Text>
        <Group gap="xs">
          <Badge color="green" variant="light">
            {session.correct}
          </Badge>
          <Badge color="red" variant="light">
            {session.wrong}
          </Badge>
        </Group>
      </Group>

      <Text fw={600}>
        {session.phase === "user"
          ? t("Practice.Lines.YourMove")
          : session.phase === "wrong"
            ? t("Practice.Lines.PlayCorrect", { move: nodes[session.ply + 1]?.san })
            : t("Practice.Lines.OpponentMoves")}
      </Text>

      <Progress
        value={(remaining / MOVE_SECONDS) * 100}
        color={remaining < 10 ? "red" : "blue"}
        animated={session.phase === "user"}
      />

      {alts.length > 0 && (
        <Text size="sm">
          <Text span c="blue" fw={600}>
            {t("Practice.Lines.Alternatives")}
          </Text>{" "}
          {alts.map((a) => a.san).join(", ")}
        </Text>
      )}

      <Button
        variant="default"
        leftSection={<IconPlayerStop size="1rem" />}
        onClick={() => {
          setFinished({ correct: session.correct, wrong: session.wrong });
          stop();
        }}
      >
        {t("Practice.Lines.Stop")}
      </Button>
    </Stack>
  );
}
