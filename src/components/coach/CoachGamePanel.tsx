import { Box, Button, Group, Paper, Text } from "@mantine/core";
import { IconArrowBackUp } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Outcome } from "@/bindings";
import CoachFigure, { type CoachAnimation, type CoachFigureHandle } from "./CoachFigure";
import { pickLine, REACTION_ANIMATION, REACTION_SIGN, readingTime } from "./coachGame";
import type { CoachComment } from "./useCoachCommentary";

const SIGN_COLOR: Record<string, string> = {
  "!!": "#1baca6",
  "!": "#4f86c6",
  "!?": "#b45fc9",
  "?!": "#d9a514",
  "?": "#e07b24",
  "??": "#cf3a33",
};

type Bubble = { sign: string | null; text: string; key: number };

// JBL neben dem Brett: reagiert auf deine Züge und spricht in einer Sprechblase.
export default function CoachGamePanel({
  comment,
  gameState,
  result,
  humanColor,
  lastPly,
  onTakeBack,
  rootHalfMoves,
}: {
  comment: CoachComment | null;
  gameState: "settingUp" | "playing" | "gameOver";
  result: Outcome | undefined;
  humanColor: "white" | "black" | null;
  lastPly: number;
  onTakeBack: (keepPlies: number) => void;
  rootHalfMoves: number;
}) {
  const { t } = useTranslation();
  const figure = useRef<CoachFigureHandle>(null);
  const recent = useRef<string[]>([]);
  const [bubble, setBubble] = useState<Bubble | null>(null);
  const [hover, setHover] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Erst die Bewegung, dann der Satz: die Blase kommt 300 ms nach dem Start
  // der Animation und bleibt so lange, wie man zum Lesen braucht.
  const deliver = (
    anim: CoachAnimation | null,
    lineKey: string,
    sign: string | null,
    extra = "",
  ) => {
    const key = pickLine(lineKey, recent.current);
    recent.current = [key, ...recent.current].slice(0, 20);
    const text = `${t(`Coach.Line.${key}`)}${extra ? ` ${extra}` : ""}`;
    timers.current.forEach(clearTimeout);
    timers.current = [];
    if (anim) figure.current?.play(anim);
    timers.current.push(
      setTimeout(() => setBubble({ sign, text, key: Date.now() }), anim ? 300 : 0),
    );
  };

  // Ausblenden nach der Lesezeit, aber nicht, solange die Maus darauf ist.
  useEffect(() => {
    if (!bubble || hover) return;
    const timer = setTimeout(() => setBubble(null), readingTime(bubble.text));
    return () => clearTimeout(timer);
  }, [bubble, hover]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // Zugkommentare
  const lastComment = useRef(0);
  useEffect(() => {
    if (!comment || comment.id === lastComment.current) return;
    lastComment.current = comment.id;
    const sign = REACTION_SIGN[comment.reaction];
    const better =
      comment.best && ["dubious", "mistake", "blunder"].includes(comment.reaction)
        ? t("Coach.Line.Better", { move: comment.best })
        : "";
    deliver(REACTION_ANIMATION[comment.reaction], comment.reaction, sign, better);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comment]);

  // Start und Ende der Partie
  const lastState = useRef(gameState);
  useEffect(() => {
    const prev = lastState.current;
    lastState.current = gameState;
    if (prev === gameState) return;
    if (gameState === "playing") deliver("hello", "start", null);
    if (gameState === "gameOver" && humanColor && result && result !== "*") {
      const won = (result === "1-0") === (humanColor === "white") && result !== "1/2-1/2";
      if (result === "1/2-1/2") deliver(null, "draw", null);
      else deliver(won ? "win" : "loss", won ? "win" : "loss", null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState, result]);

  // Zurücknehmen nach ? oder ??, aber nie nach zugelassenem Matt in 1.
  const offerTakeBack =
    gameState === "playing" &&
    comment !== null &&
    (comment.reaction === "mistake" || comment.reaction === "blunder") &&
    lastPly - comment.ply <= 1;

  return (
    <Paper withBorder radius="md" p="sm" data-tour="coach-game">
      <Group wrap="nowrap" align="flex-start" gap="sm">
        <Box style={{ flexShrink: 0, lineHeight: 0 }}>
          <CoachFigure ref={figure} size={96} title={t("Coach.Card.Title")} />
        </Box>
        <Box
          style={{ flex: 1, minWidth: 0, minHeight: 72 }}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          aria-live="polite"
        >
          {bubble ? (
            <Paper key={bubble.key} radius="md" p="xs" bg="var(--mantine-color-default-hover)">
              <Text size="sm">
                {bubble.sign && (
                  <Text span fw={800} mr={6} c={SIGN_COLOR[bubble.sign]}>
                    {bubble.sign}
                  </Text>
                )}
                {bubble.text}
              </Text>
            </Paper>
          ) : (
            <Text size="sm" c="dimmed">
              {t("Coach.Game.Watching")}
            </Text>
          )}
          {offerTakeBack && (
            <Button
              mt="xs"
              size="xs"
              variant="light"
              color="orange"
              leftSection={<IconArrowBackUp size={14} />}
              onClick={() => comment && onTakeBack(Math.max(0, comment.ply - 1 - rootHalfMoves))}
            >
              {t("Coach.Game.TakeBack")}
            </Button>
          )}
        </Box>
      </Group>
    </Paper>
  );
}
