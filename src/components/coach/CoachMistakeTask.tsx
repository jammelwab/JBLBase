import { Badge, Box, Button, Card, Group, Paper, Stack, Text } from "@mantine/core";
import type { Key } from "@lichess-org/chessground/types";
import { IconTargetArrow } from "@tabler/icons-react";
import { useSetAtom } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Chessground } from "@/chessground/Chessground";
import { boardMoves, sanToSquares, squaresToSan } from "@/utils/gamesTree";
import CoachFigure, { type CoachFigureHandle } from "./CoachFigure";
import { lineSteps, solutionMotif } from "./coachDeep";
import { type CoachMistake, coachMistakeDoneAtom, XP } from "./coachProgress";

// Erste Aufgabe nach einer Niederlage: der schlimmste eigene Zug der Partie.
// Zwei Versuche, danach zeigt JBL die Lösung.
export default function CoachMistakeTask({ mistake }: { mistake: CoachMistake }) {
  const { t } = useTranslation();
  const done = useSetAtom(coachMistakeDoneAtom);
  const { turn, dests } = useMemo(() => boardMoves(mistake.fen), [mistake.fen]);
  const [tries, setTries] = useState(0);
  const [state, setState] = useState<"open" | "solved" | "shown">("open");
  // Neuer Schlüssel setzt das Brett nach einem falschen Zug zurück
  const [resetKey, setResetKey] = useState(0);
  const [lastMove, setLastMove] = useState<Key[] | undefined>(undefined);
  // Der gefundene Zug: das Brett bleibt danach stehen
  const [found, setFound] = useState<string | null>(null);
  const figure = useRef<CoachFigureHandle>(null);

  const play = (san: string) => {
    const squares = sanToSquares(mistake.fen, san);
    if (mistake.solutions.includes(san)) {
      setState("solved");
      setFound(san);
      if (squares) setLastMove(squares as Key[]);
      return;
    }
    setTries((n) => n + 1);
    // Brett zurück auf die Ausgangsstellung
    setResetKey((k) => k + 1);
    if (tries + 1 >= 2) {
      setState("shown");
      const s = sanToSquares(mistake.fen, mistake.solutions[0]);
      if (s) setLastMove(s as Key[]);
    }
  };

  const solution = mistake.solutions[0];
  const arrow = state === "shown" ? sanToSquares(mistake.fen, solution) : null;
  const firstTry = state === "solved" && tries === 0;
  const fen = found ? (lineSteps(mistake.fen, [found], 1)[0]?.fen ?? mistake.fen) : mistake.fen;
  // Steckt ein Taktikmotiv in der Lösung, erklärt JBL es
  const motif = useMemo(
    () => (found ? solutionMotif(mistake.fen, found, mistake.before, solution) : null),
    [found, mistake.fen, mistake.before, solution],
  );
  useEffect(() => {
    if (motif) figure.current?.play("good");
  }, [motif]);

  return (
    <Card
      withBorder
      radius="md"
      p="lg"
      style={{ borderColor: "var(--mantine-color-orange-6)", borderWidth: 2 }}
    >
      <Group align="flex-start" wrap="wrap" gap="lg">
        <Box w={240} h={240} style={{ flexShrink: 0 }}>
          <Chessground
            key={resetKey}
            coordinates={false}
            viewOnly={state !== "open"}
            turnColor={turn}
            orientation={turn}
            fen={fen}
            lastMove={lastMove}
            movable={{
              free: false,
              color: state === "open" ? turn : undefined,
              dests: dests as never,
              showDests: true,
              events: {
                after: (orig, dest) => {
                  const san = squaresToSan(mistake.fen, orig, dest);
                  if (san) play(san);
                },
              },
            }}
            drawable={{
              enabled: false,
              visible: true,
              autoShapes: arrow
                ? [{ orig: arrow[0] as Key, dest: arrow[1] as Key, brush: "green" }]
                : [],
            }}
          />
        </Box>
        <Stack gap="sm" style={{ flex: "1 1 220px", minWidth: 0 }}>
          <Group gap="xs">
            <IconTargetArrow size={28} />
            <Text fw={600}>{t("Coach.Mistake.Title")}</Text>
          </Group>
          <Text size="sm" c="dimmed">
            {t("Coach.Mistake.Desc", { move: mistake.played })}
          </Text>
          {state === "open" && tries > 0 && (
            <Text size="sm" c="orange">
              {t("Coach.Mistake.TryAgain")}
            </Text>
          )}
          {state === "solved" && (
            <Text size="sm" c="teal">
              {t("Coach.Mistake.Solved")}
              {firstTry && ` ${t("Coach.Mistake.FirstTry", { xp: XP.mistakeFirstTry })}`}
            </Text>
          )}
          {motif && (
            <Group wrap="nowrap" align="flex-start" gap="sm">
              <Box style={{ flexShrink: 0, lineHeight: 0 }}>
                <CoachFigure ref={figure} size={72} title={t("Coach.Card.Title")} />
              </Box>
              <Paper
                radius="md"
                p="sm"
                bg="var(--mantine-color-default-hover)"
                style={{ flex: 1, minWidth: 0 }}
              >
                <Badge color="orange" variant="light" mb={6}>
                  {motif.id === "mate"
                    ? t("Coach.Mistake.MateName")
                    : t(`Coach.Deep.Motif.${motif.id}.Name`)}
                </Badge>
                <Text size="sm" lh={1.5}>
                  {t(`Coach.Mistake.Motif.${motif.id}`, {
                    square: motif.square ?? "",
                    n: motif.mateIn ?? 0,
                  })}
                </Text>
              </Paper>
            </Group>
          )}
          {state === "shown" && (
            <Text size="sm">{t("Coach.Mistake.Shown", { move: solution })}</Text>
          )}
          {state !== "open" ? (
            <Button color="orange" radius="md" onClick={() => done(state === "solved", firstTry)}>
              {t("Coach.Mistake.Continue")}
            </Button>
          ) : (
            <Button
              variant="subtle"
              color="gray"
              radius="md"
              onClick={() => {
                setState("shown");
                const s = sanToSquares(mistake.fen, solution);
                if (s) setLastMove(s as Key[]);
              }}
            >
              {t("Coach.Mistake.Show")}
            </Button>
          )}
        </Stack>
      </Group>
    </Card>
  );
}
