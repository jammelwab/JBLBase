import { Badge, Box, Button, Card, Group, Modal, Progress, Stack, Text } from "@mantine/core";
import type { Key } from "@lichess-org/chessground/types";
import { IconSwords } from "@tabler/icons-react";
import type { Role } from "chessops";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useEffect, useMemo, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { cloudFirestoreLive } from "@/utils/cloud/auth";
import { createDuel, listenDuels, updateDuel } from "@/utils/cloud/duelCloud";
import { cloudAccountAtom } from "@/utils/cloud/sync";
import { boardMoves } from "@/utils/gamesTree";
import {
  coachRivalAheadAtom,
  coachRivalAtom,
  type Duel,
  duelFen,
  duelOutcome,
  duelPosition,
  duelTurn,
  duelWinner,
  hasRivalAtom,
  leader,
  overtake,
  playDuelMove,
  settleDuelAtom,
} from "./coachDuelState";
import { coachProfileAtom } from "./coachProfile";
import { coachXpAtom, levelProgress } from "./coachState";
import CoachBoard, { PROMOTION_LETTER } from "./CoachBoard";

// Zweiter Balken mit dem Level des Rivalen, nur für die beiden sichtbar.
export function RivalBar({ size = "xs" }: { size?: "xs" | "sm" }) {
  const { t } = useTranslation();
  const rival = useAtomValue(coachRivalAtom);
  const hasRival = useAtomValue(hasRivalAtom);
  const xp = useAtomValue(coachXpAtom);
  const [ahead, setAhead] = useAtom(coachRivalAheadAtom);
  const { level } = levelProgress(xp);
  const now = rival ? leader({ level, xp }, rival) : null;
  // Beim ersten Blick sagen, wer überholt hat; danach merken
  const [news] = useState(() => (now ? overtake(ahead, now) : null));
  useEffect(() => {
    if (now && now !== ahead) setAhead(now);
  }, [now, ahead, setAhead]);
  if (!hasRival || !rival) return null;
  const rivalProgress = levelProgress(rival.xp);
  return (
    <Box w="100%" mt={6}>
      <Text size={size} c="dimmed">
        {t("Coach.Duel.Bar", { me: level, name: rival.name, rival: rival.level })}
      </Text>
      <Progress
        value={rivalProgress.needed ? (rivalProgress.intoLevel / rivalProgress.needed) * 100 : 0}
        size="xs"
        radius="xl"
        color="gray"
        mt={4}
        aria-label={t("Coach.Duel.BarLabel", { name: rival.name })}
      />
      {news && (
        <Text size="xs" mt={2} c={news === "overtaken" ? "red" : "teal"} fw={600}>
          {news === "overtaken"
            ? t("Coach.Duel.Overtaken", { name: rival.name })
            : t("Coach.Duel.Overtook", { name: rival.name })}
        </Text>
      )}
    </Box>
  );
}

function resultText(t: TFunction, duel: Duel, me: string) {
  if (duel.result === "*") return "";
  const winner = duelWinner(duel);
  if (!winner) return t("Coach.Duel.Draw");
  return winner === me ? t("Coach.Duel.Won") : t("Coach.Duel.Lost");
}

// Duell-Karte auf der Coach-Seite: herausfordern und offene Partien.
export default function CoachDuel() {
  const { t } = useTranslation();
  const hasRival = useAtomValue(hasRivalAtom);
  const rival = useAtomValue(coachRivalAtom);
  const account = useAtomValue(cloudAccountAtom);
  const profile = useAtomValue(coachProfileAtom);
  const settle = useSetAtom(settleDuelAtom);
  const [duels, setDuels] = useState<Duel[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uid = account?.uid ?? null;

  useEffect(() => {
    if (!hasRival || !uid) return;
    let stop: (() => void) | null = null;
    let cancelled = false;
    void cloudFirestoreLive().then((lf) => {
      if (cancelled) return;
      stop = listenDuels(
        lf,
        uid,
        (list) => {
          setDuels(list);
          for (const d of list) settle(d, uid);
        },
        (e) => setError(String(e)),
      );
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [hasRival, uid, settle]);

  if (!hasRival || !uid) return null;
  const rivalUid = profile.rival!;
  const rivalName = rival?.name ?? "?";
  const running = duels.filter((d) => d.result === "*");
  const finished = duels.filter((d) => d.result !== "*").slice(0, 3);
  const current = duels.find((d) => d.id === open) ?? null;

  const challenge = async () => {
    setBusy(true);
    setError(null);
    try {
      const id = await createDuel(
        await cloudFirestoreLive(),
        { uid, name: profile.name ?? "" },
        { uid: rivalUid, name: rivalName },
        Math.random() < 0.5,
      );
      setOpen(id);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card withBorder radius="md" p="md">
      <Group wrap="nowrap" align="flex-start" gap="md">
        <IconSwords size={32} />
        <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
          <Text fw={600}>{t("Coach.Duel.Title", { name: rivalName })}</Text>
          {running.length === 0 && (
            <Text size="sm" c="dimmed">
              {t("Coach.Duel.Desc", { name: rivalName })}
            </Text>
          )}
          {running.map((d) => (
            <Group key={d.id} gap="xs">
              <Text size="sm">
                {duelTurn(d) === uid
                  ? t("Coach.Duel.YourTurn", { moves: Math.ceil(d.moves.length / 2) })
                  : t("Coach.Duel.TheirTurn", { name: rivalName })}
              </Text>
              <Button size="compact-xs" variant="light" onClick={() => setOpen(d.id)}>
                {t("Coach.Duel.Open")}
              </Button>
            </Group>
          ))}
          {finished.map((d) => (
            <Text key={d.id} size="xs" c="dimmed">
              {resultText(t, d, uid)}
            </Text>
          ))}
          {error && (
            <Text size="xs" c="red">
              {t("Coach.Duel.Error")}
            </Text>
          )}
        </Stack>
        <Button variant="light" radius="md" loading={busy} onClick={() => void challenge()}>
          {t("Coach.Duel.Challenge")}
        </Button>
      </Group>
      <Modal
        opened={current !== null}
        onClose={() => setOpen(null)}
        title={t("Coach.Duel.Title", { name: rivalName })}
        centered
        size="auto"
      >
        {current && <DuelBoard duel={current} me={uid} />}
      </Modal>
    </Card>
  );
}

function DuelBoard({ duel, me }: { duel: Duel; me: string }) {
  const { t } = useTranslation();
  const fen = useMemo(() => duelFen(duel.moves), [duel.moves]);
  const { turn, dests } = useMemo(() => boardMoves(fen), [fen]);
  const myColor = duel.white === me ? "white" : "black";
  const myTurn = duel.result === "*" && duelTurn(duel) === me;
  const [sending, setSending] = useState(false);
  const last = duel.moves.at(-1);
  const lastMove = last ? ([last.slice(0, 2), last.slice(2, 4)] as Key[]) : undefined;
  const sans = useMemo(() => duelPosition(duel.moves).sans, [duel.moves]);
  const other = duel.players.find((p) => p !== me) ?? "";

  const send = async (moves: string[], result = duelOutcome(moves)) => {
    setSending(true);
    try {
      await updateDuel(await cloudFirestoreLive(), duel.id, moves, result.result, result.reason);
    } finally {
      setSending(false);
    }
  };

  const move = (orig: string, dest: string, promotion?: Role) => {
    const promo = promotion ? PROMOTION_LETTER[promotion] : "";
    const next = playDuelMove(duel.moves, `${orig}${dest}${promo}`);
    if (next) void send(next);
  };

  return (
    <Stack gap="sm" align="center">
      <Group gap="xs">
        <Badge variant="light" color={myTurn ? "orange" : "gray"}>
          {duel.result !== "*"
            ? resultText(t, duel, me)
            : myTurn
              ? t("Coach.Duel.YourMove")
              : t("Coach.Duel.Waiting", { name: duel.names[other] ?? "?" })}
        </Badge>
      </Group>
      <Box w={360} h={360}>
        <CoachBoard
          coordinates={false}
          fen={fen}
          orientation={myColor}
          turnColor={turn}
          lastMove={lastMove}
          viewOnly={!myTurn || sending}
          movable={{
            free: false,
            color: myTurn ? myColor : undefined,
            dests: dests as never,
            showDests: true,
          }}
          onMove={(o, d, promotion) => move(o, d, promotion)}
        />
      </Box>
      <Text size="xs" c="dimmed" maw={360} ta="center">
        {sans.length > 0
          ? sans.map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}.${s}` : s)).join(" ")
          : t("Coach.Duel.NoMoves")}
      </Text>
      {duel.result === "*" && (
        <Button
          size="xs"
          variant="subtle"
          color="red"
          onClick={() =>
            void send(duel.moves, {
              result: myColor === "white" ? "0-1" : "1-0",
              reason: "resign",
            })
          }
        >
          {t("Coach.Duel.Resign")}
        </Button>
      )}
    </Stack>
  );
}
