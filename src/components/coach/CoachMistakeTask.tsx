import { Box, Button, Card, Group, Stack, Text } from "@mantine/core";
import type { Key } from "@lichess-org/chessground/types";
import { IconTargetArrow } from "@tabler/icons-react";
import { useSetAtom } from "jotai";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Chessground } from "@/chessground/Chessground";
import { boardMoves, sanToSquares, squaresToSan } from "@/utils/gamesTree";
import { type CoachMistake, coachMistakeDoneAtom } from "./coachProgress";

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

  const play = (san: string) => {
    const squares = sanToSquares(mistake.fen, san);
    if (mistake.solutions.includes(san)) {
      setState("solved");
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
            fen={mistake.fen}
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
            </Text>
          )}
          {state === "shown" && (
            <Text size="sm">{t("Coach.Mistake.Shown", { move: solution })}</Text>
          )}
          {state !== "open" ? (
            <Button color="orange" radius="md" onClick={() => done(state === "solved")}>
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
