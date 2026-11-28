import { ActionIcon, Badge, Box, Button, Card, Group, Paper, Stack, Text } from "@mantine/core";
import type { Key } from "@lichess-org/chessground/types";
import { IconChevronLeft, IconChevronRight, IconTargetArrow } from "@tabler/icons-react";
import { useSetAtom } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { boardMoves, sanToSquares, squaresToSan } from "@/utils/gamesTree";
import CoachFigure, { type CoachFigureHandle } from "./CoachFigure";
import { linePoint, lineSteps, moveNumber, solutionMotif } from "./coachDeep";
import { type CoachMistake, coachMistakeDoneAtom, XP } from "./coachProgress";
import CoachBoard from "./CoachBoard";

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
  const firstTry = state === "solved" && tries === 0;
  // Nach der Lösung (gefunden oder gezeigt) spielt JBL die Folge des besten
  // Zugs vor, so weit, bis man sieht, was er bringt (1.2.34)
  const shownMove = state === "solved" ? found : state === "shown" ? solution : null;
  const follow = useMemo(() => {
    const line = mistake.line ?? [];
    if (!shownMove || line[0] !== shownMove) return [];
    const point = linePoint(mistake.fen, line);
    return lineSteps(mistake.fen, line, Math.max(1, point.plies));
  }, [mistake.fen, mistake.line, shownMove]);
  const followPoint = useMemo(() => linePoint(mistake.fen, mistake.line ?? []), [mistake]);
  const [step, setStep] = useState(1);
  const current = follow.length > 0 ? follow[Math.min(step, follow.length) - 1] : null;
  const arrow =
    current !== null
      ? [current.from, current.to]
      : state === "shown"
        ? sanToSquares(mistake.fen, solution)
        : null;
  const fen = current
    ? current.fen
    : found
      ? (lineSteps(mistake.fen, [found], 1)[0]?.fen ?? mistake.fen)
      : mistake.fen;
  // Ply der Ausgangsstellung, für die Zugnummern der Folge
  const basePly =
    (Number(mistake.fen.split(" ")[5]) || 1) * 2 - (mistake.fen.split(" ")[1] === "w" ? 1 : 0);
  // Steckt ein Taktikmotiv in der Lösung, erklärt JBL es, auch wenn er sie
  // zeigen musste
  const motif = useMemo(
    () => (shownMove ? solutionMotif(mistake.fen, shownMove, mistake.before, solution) : null),
    [shownMove, mistake.fen, mistake.before, solution],
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
          <CoachBoard
            key={resetKey}
            coordinates={false}
            viewOnly={state !== "open"}
            turnColor={turn}
            orientation={turn}
            fen={fen}
            lastMove={current ? ([current.from, current.to] as Key[]) : lastMove}
            movable={{
              free: false,
              color: state === "open" ? turn : undefined,
              dests: dests as never,
              showDests: true,
            }}
            onMove={(orig, dest, promotion) => {
              const san = squaresToSan(mistake.fen, orig, dest, promotion);
              if (san) play(san);
            }}
            drawable={{
              enabled: false,
              visible: true,
              autoShapes: arrow
                ? [
                    {
                      orig: arrow[0] as Key,
                      dest: arrow[1] as Key,
                      // Deine Züge grün, die des Gegners rot
                      brush: current && step % 2 === 0 ? "red" : "green",
                    },
                  ]
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
          {follow.length > 1 && current && (
            <Stack gap={4}>
              <Text size="xs" c="dimmed">
                {t(step % 2 === 1 ? "Coach.Mistake.StepYou" : "Coach.Mistake.StepThem", {
                  move: `${moveNumber(basePly + step - 1)}${current.san}`,
                })}
                {step === follow.length && followPoint.kind !== "quiet" && (
                  <Text span fw={600} c="var(--mantine-color-text)">
                    {" "}
                    {followPoint.kind === "mate"
                      ? t("Coach.Deep.EndMate")
                      : t("Coach.Deep.EndGain", { count: followPoint.gain })}
                  </Text>
                )}
              </Text>
              <Group gap={6}>
                <ActionIcon
                  variant="light"
                  color="gray"
                  disabled={step <= 1}
                  onClick={() => setStep(step - 1)}
                  aria-label={t("Coach.Deep.Prev")}
                >
                  <IconChevronLeft size={18} />
                </ActionIcon>
                <Text size="sm" fw={600}>
                  {t("Coach.Deep.StepOf", { n: step, total: follow.length })}
                </Text>
                <ActionIcon
                  variant="light"
                  color="gray"
                  disabled={step >= follow.length}
                  onClick={() => setStep(step + 1)}
                  aria-label={t("Coach.Deep.Next")}
                >
                  <IconChevronRight size={18} />
                </ActionIcon>
              </Group>
            </Stack>
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
