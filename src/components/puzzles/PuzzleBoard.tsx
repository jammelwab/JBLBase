import { Box, Button, Group, Paper, Stack, Text, TextInput } from "@mantine/core";
import { useElementSize, useForceUpdate } from "@mantine/hooks";
import { IconEyeOff } from "@tabler/icons-react";
import { type Move, makeUci, type NormalMove, parseSquare, parseUci } from "chessops";
import { chessgroundDests, chessgroundMove } from "chessops/compat";
import { parseFen } from "chessops/fen";
import equal from "fast-deep-equal";
import { useAtom, useAtomValue } from "jotai";
import { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";
import { Chessground } from "@/chessground/Chessground";
import {
  eraseDrawablesOnClickAtom,
  jumpToNextPuzzleAtom,
  moveHighlightAtom,
  puzzleBlindSecondsAtom,
  puzzleBlindSquareNamesAtom,
  puzzleBlindTextInputAtom,
  showCoordinatesAtom,
  showDestsAtom,
} from "@/state/atoms";
import classes from "@/styles/Chessboard.module.css";
import { positionFromFen } from "@/utils/chessops";
import { localSan, parseMoveInput } from "@/utils/moveInput";
import type { Completion, Puzzle } from "@/utils/puzzles";
import { getNodeAtPath, treeIteratorMainLine } from "@/utils/treeReducer";
import PromotionModal from "../boards/PromotionModal";
import { TreeStateContext } from "../common/TreeStateContext";
import blindClasses from "./BlindPuzzle.module.css";

/** The puzzle moves played so far, numbered, in the app's notation. */
function numberedMoves(fen: string, moves: string[], language: string) {
  const [pos] = positionFromFen(fen);
  if (!pos) return [];
  const result: { text: string; byOpponent: boolean }[] = [];
  for (const [i, uci] of moves.entries()) {
    const move = parseUci(uci);
    if (!move || !pos.isLegal(move)) break;
    const prefix = pos.turn === "white" ? `${pos.fullmoves}. ` : `${pos.fullmoves}… `;
    result.push({ text: prefix + localSan(pos, move, language), byOpponent: i % 2 === 0 });
    pos.play(move);
  }
  return result;
}

function PuzzleBoard({
  puzzles,
  currentPuzzle,
  changeCompletion,
  generatePuzzle,
  db,
}: {
  puzzles: Puzzle[];
  currentPuzzle: number;
  changeCompletion: (completion: Completion) => Promise<void>;
  generatePuzzle: (db: string) => Promise<void>;
  db: string | null;
}) {
  const store = useContext(TreeStateContext)!;
  const root = useStore(store, (s) => s.root);
  const position = useStore(store, (s) => s.position);
  const moveHighlight = useAtomValue(moveHighlightAtom);
  const showDests = useAtomValue(showDestsAtom);
  const boardShapes = useStore(store, (s) => s.currentNode().shapes);
  const setShapes = useStore(store, (s) => s.setShapes);
  const clearShapes = useStore(store, (s) => s.clearShapes);
  const eraseDrawablesOnClick = useAtomValue(eraseDrawablesOnClickAtom);
  const makeMove = useStore(store, (s) => s.makeMove);
  const makeMoves = useStore(store, (s) => s.makeMoves);
  const reset = useForceUpdate();
  const { t, i18n } = useTranslation();
  const [jumpToNextPuzzleImmediately] = useAtom(jumpToNextPuzzleAtom);

  const currentNode = getNodeAtPath(root, position);

  let puzzle: Puzzle | null = null;
  if (puzzles.length > 0) {
    puzzle = puzzles[currentPuzzle];
  }
  const [ended, setEnded] = useState(false);

  const [pos] = positionFromFen(currentNode.fen);

  const treeIter = treeIteratorMainLine(root);
  treeIter.next();
  let currentMove = 0;
  if (puzzle) {
    for (const { node } of treeIter) {
      if (node.move && makeUci(node.move) === puzzle.moves[currentMove]) {
        currentMove++;
      } else {
        break;
      }
    }
  }
  const orientation = puzzle?.fen
    ? parseFen(puzzle.fen).unwrap().turn === "white"
      ? "black"
      : "white"
    : "white";
  const [pendingMove, setPendingMove] = useState<NormalMove | null>(null);

  const dests = pos ? chessgroundDests(pos) : new Map();
  const turn = pos?.turn || "white";
  const showCoordinates = useAtomValue(showCoordinatesAtom);

  // Blind mode: the position shows for a few seconds, then the pieces vanish
  const blindSeconds = useAtomValue(puzzleBlindSecondsAtom);
  const squareNames = useAtomValue(puzzleBlindSquareNamesAtom);
  const textInput = useAtomValue(puzzleBlindTextInputAtom);
  const blind = blindSeconds > 0;
  const [phase, setPhase] = useState<"preview" | "hidden" | "off">(() =>
    blind && puzzle?.completion === "incomplete" ? "preview" : "off",
  );
  const [remaining, setRemaining] = useState(blindSeconds);

  // The board stays mounted from puzzle to puzzle: a new board would start
  // without its size for a moment and the screen would flash dark. So the
  // state of one puzzle starts over here when the next one comes.
  const puzzleKey = `${currentPuzzle}:${puzzle?.fen ?? ""}`;
  const [shownPuzzle, setShownPuzzle] = useState(puzzleKey);
  const [typed, setTyped] = useState("");
  const [typedError, setTypedError] = useState(false);
  if (shownPuzzle !== puzzleKey) {
    setShownPuzzle(puzzleKey);
    setEnded(false);
    setPendingMove(null);
    setTyped("");
    setTypedError(false);
    setPhase(blind && puzzle?.completion === "incomplete" ? "preview" : "off");
    setRemaining(blindSeconds);
  }
  useEffect(() => {
    if (!blind) setPhase("off");
  }, [blind]);
  useEffect(() => {
    if (phase !== "preview") return;
    // The countdown starts anew with every puzzle
    const previewEnd = Date.now() + blindSeconds * 1000;
    const tick = () => {
      const left = Math.max(0, Math.ceil((previewEnd - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) setPhase("hidden");
    };
    tick();
    const interval = setInterval(tick, 200);
    return () => clearInterval(interval);
  }, [phase, shownPuzzle, blindSeconds]);
  // A finished puzzle shows its pieces again
  const solving = puzzle?.completion === "incomplete";
  const piecesHidden = phase === "hidden" && solving;
  const inPreview = phase === "preview" && solving;
  const blindActive = phase !== "off" && solving;
  // Hidden pieces: square names on every square, or none at all
  const coordinates = piecesHidden ? (squareNames ? "all" : "no") : showCoordinates;

  const canMove =
    !!puzzle &&
    !inPreview &&
    equal(position, Array(currentMove).fill(0)) &&
    (puzzle.completion === "incomplete" || puzzle.completion === "incorrect");

  const played =
    puzzle && blindActive
      ? numberedMoves(puzzle.fen, puzzle.moves.slice(0, currentMove), i18n.language)
      : [];
  const lastOpponentMove = [...played].reverse().find((m) => m.byOpponent);

  function submitTyped() {
    if (!pos || !canMove) return;
    const move = parseMoveInput(pos, typed);
    if (!move) {
      setTypedError(true);
      return;
    }
    setTyped("");
    setTypedError(false);
    checkMove(move);
  }

  async function checkMove(move: Move) {
    if (!pos) return;
    if (!puzzle) return;

    const newPos = pos.clone();
    const uci = makeUci(move);
    newPos.play(move);

    if (puzzle.moves[currentMove] === uci || newPos.isCheckmate()) {
      if (currentMove === puzzle.moves.length - 1) {
        if (puzzle.completion !== "incorrect") {
          await changeCompletion("correct");
        }
        setEnded(false);

        if (db && jumpToNextPuzzleImmediately) {
          await generatePuzzle(db);
          reset();
          return;
        }
      }
      const newMoves = puzzle.moves.slice(currentMove, currentMove + 2);
      makeMoves({
        payload: newMoves,
        mainline: true,
        changeHeaders: false,
      });
      // Blind: after the opponent's reply the new position shows again, so
      // an unexpected defence does not leave you solving a position you
      // never saw
      if (blind && phase !== "off" && currentMove + 2 < puzzle.moves.length) {
        setPhase("preview");
      }
    } else {
      makeMove({
        payload: move,
        changePosition: false,
        changeHeaders: false,
      });
      if (!ended) {
        await changeCompletion("incorrect");
      }
      setEnded(true);
    }
    reset();
  }

  const { ref: parentRef, height: parentHeight } = useElementSize();

  return (
    <Stack w="100%" h="100%" gap="xs">
      {blindActive && (
        <Paper withBorder p="xs">
          <Stack gap={4}>
            <Group justify="space-between" wrap="nowrap">
              <Text fw={600}>
                {inPreview
                  ? t("Puzzle.Blind.Memorize", { seconds: remaining })
                  : t("Puzzle.Blind.Hidden")}
              </Text>
              {inPreview && (
                <Button
                  size="xs"
                  variant="light"
                  leftSection={<IconEyeOff size={16} />}
                  onClick={() => setPhase("hidden")}
                >
                  {t("Puzzle.Blind.HideNow")}
                </Button>
              )}
            </Group>
            {lastOpponentMove && (
              <Text size="lg">
                {t("Puzzle.Blind.OpponentPlayed")}{" "}
                <Text span fw={700} ff="monospace" fz="lg">
                  {lastOpponentMove.text}
                </Text>
              </Text>
            )}
            {played.length > 1 && (
              <Text size="sm" c="dimmed" ff="monospace">
                {played.map((m) => m.text).join("  ")}
              </Text>
            )}
            {textInput && (
              <Group gap="xs" wrap="nowrap" align="flex-start">
                <TextInput
                  style={{ flex: 1 }}
                  size="sm"
                  aria-label={t("Puzzle.Blind.TextInput")}
                  placeholder={t("Puzzle.Blind.InputPlaceholder")}
                  value={typed}
                  disabled={!canMove}
                  error={typedError ? t("Puzzle.Blind.InputInvalid") : undefined}
                  onChange={(e) => {
                    setTyped(e.currentTarget.value);
                    setTypedError(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitTyped();
                  }}
                  autoComplete="off"
                  spellCheck={false}
                />
                <Button size="sm" disabled={!canMove || !typed.trim()} onClick={submitTyped}>
                  {t("Puzzle.Blind.Submit")}
                </Button>
              </Group>
            )}
          </Stack>
        </Paper>
      )}
      <Box w="100%" flex={1} mih={0} ref={parentRef}>
        <Box
          className={`${classes.chessboard} ${piecesHidden ? blindClasses.hidden : ""}`}
          onClick={() => {
            if (eraseDrawablesOnClick) clearShapes();
          }}
          style={{
            maxWidth: parentHeight,
          }}
        >
          <PromotionModal
            pendingMove={pendingMove}
            cancelMove={() => setPendingMove(null)}
            confirmMove={async (p) => {
              if (pendingMove) {
                await checkMove({ ...pendingMove, promotion: p });
                setPendingMove(null);
              }
            }}
            turn={turn}
            orientation={orientation}
          />
          <Chessground
            animation={{
              // A new puzzle appears at once instead of sliding the old pieces over
              enabled: currentMove > 1,
            }}
            // Chessground draws coordinates only when it starts, so a change needs a new board
            key={coordinates}
            coordinates={coordinates !== "no"}
            coordinatesOnSquares={coordinates === "all"}
            orientation={orientation}
            drawable={{
              enabled: true,
              visible: true,
              autoShapes: boardShapes,
              onChange: (shapes) => {
                setShapes(shapes);
              },
            }}
            movable={{
              free: false,
              color: canMove ? turn : undefined,
              dests,
              // Move dots would give away where the pieces are
              showDests: showDests && !piecesHidden,
              events: {
                after: (orig, dest) => {
                  const from = parseSquare(orig)!;
                  const to = parseSquare(dest)!;
                  const move: NormalMove = { from, to };
                  if (
                    pos?.board.get(from)?.role === "pawn" &&
                    ((dest[1] === "8" && turn === "white") || (dest[1] === "1" && turn === "black"))
                  ) {
                    setPendingMove(move);
                  } else {
                    checkMove(move);
                  }
                },
              },
            }}
            lastMove={
              moveHighlight && currentNode.move && !piecesHidden
                ? chessgroundMove(currentNode.move)
                : undefined
            }
            turnColor={turn}
            fen={currentNode.fen}
            check={moveHighlight && !piecesHidden && pos?.isCheck()}
          />
        </Box>
      </Box>
    </Stack>
  );
}

export default PuzzleBoard;
