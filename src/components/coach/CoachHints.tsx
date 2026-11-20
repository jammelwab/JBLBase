import { Badge, Box, Button, Card, Group, Modal, Stack, Table, Text } from "@mantine/core";
import { IconBook2, IconNotebook } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import useSWR from "swr";
import { getMainOwner, repertoireVersionAtom } from "@/utils/repertoires";
import { coachDiaryAtom, type DiaryGame, diaryGaps, epdIndex } from "./coachDiary";
import { loadOwnRepertoires, pickRepertoire } from "./coachPlan";

// Ab diesem Level darf man einmal ins Tagebuch schauen
export const DIARY_LEVEL = 10;

export function formatLine(sans: string[]): string {
  return sans.map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}.${s}` : s)).join(" ");
}

type Hint =
  | { kind: "noRepertoire"; color: "white" | "black" }
  | { kind: "gap"; color: "white" | "black"; line: string; count: number };

// Was das Tagebuch über den Spieler weiß, kurz zusammengefasst
export function diarySummary(diary: readonly DiaryGame[]) {
  const games = diary.length;
  const wins = diary.filter((g) => g.result === "win").length;
  const draws = diary.filter((g) => g.result === "draw").length;
  const firsts = new Map<string, number>();
  for (const g of diary) {
    const first = g.moves.find((m) => m.h);
    if (!first) continue;
    const key = g.color === "white" ? `1.${first.s}` : `1.${g.moves[0]?.s} ${first.s}`;
    firsts.set(key, (firsts.get(key) ?? 0) + 1);
  }
  const trouble = new Map<string, number>();
  for (const g of diary) {
    const line: string[] = [];
    for (const m of g.moves) {
      if (m.h && (m.x === "?" || m.x === "??")) {
        const key = formatLine([...line, m.s]);
        trouble.set(key, (trouble.get(key) ?? 0) + 1);
        break;
      }
      line.push(m.s);
    }
  }
  const top = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1]).slice(0, 5);
  return {
    games,
    wins,
    draws,
    losses: games - wins - draws,
    firsts: top(firsts),
    trouble: top(trouble),
  };
}

// Hinweise des Coaches zum Repertoire und, ab Level 10, das Tagebuch.
export default function CoachHints({ level }: { level: number }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const diary = useAtomValue(coachDiaryAtom);
  const version = useAtomValue(repertoireVersionAtom);
  const { data: repertoires } = useSWR(["coach-repertoires", version], loadOwnRepertoires, {
    revalidateOnFocus: false,
  });
  const [diaryOpen, setDiaryOpen] = useState(false);

  const hint = useMemo<Hint | null>(() => {
    if (!repertoires) return null;
    const owner = getMainOwner();
    const gaps: Hint[] = [];
    for (const color of ["white", "black"] as const) {
      const rep = pickRepertoire(repertoires, color, owner);
      if (!rep) return { kind: "noRepertoire", color };
      const [gap] = diaryGaps(diary, color, epdIndex(rep.root));
      if (gap && gap.count >= 2)
        gaps.push({ kind: "gap", color, line: formatLine(gap.line), count: gap.count });
    }
    return (
      gaps.sort((a, b) => (b.kind === "gap" ? b.count : 0) - (a.kind === "gap" ? a.count : 0))[0] ??
      null
    );
  }, [repertoires, diary]);

  const summary = useMemo(() => diarySummary(diary), [diary]);
  const canRead = level >= DIARY_LEVEL;

  return (
    <>
      {hint && (
        <Card withBorder radius="md" p="md">
          <Group wrap="nowrap" align="center" gap="md">
            <IconBook2 size={32} />
            <Box style={{ flex: 1, minWidth: 0 }}>
              <Text fw={600}>{t("Coach.Hint.Title")}</Text>
              <Text size="sm" c="dimmed">
                {hint.kind === "noRepertoire"
                  ? t(`Coach.Hint.NoRepertoire.${hint.color}`)
                  : t("Coach.Hint.Gap", { line: hint.line, count: hint.count })}
              </Text>
            </Box>
            <Button
              variant="light"
              radius="md"
              onClick={() => void navigate({ to: "/repertoires" })}
            >
              {t("Coach.Hint.Open")}
            </Button>
          </Group>
        </Card>
      )}
      <Card withBorder radius="md" p="md" style={canRead ? undefined : { opacity: 0.7 }}>
        <Group wrap="nowrap" align="center" gap="md">
          <IconNotebook size={32} />
          <Box style={{ flex: 1, minWidth: 0 }}>
            <Group gap="xs">
              <Text fw={600}>{t("Coach.Diary.Title")}</Text>
              {!canRead && (
                <Badge size="xs" variant="light" color="gray">
                  {t("Coach.Showcase.FromLevel", { level: DIARY_LEVEL })}
                </Badge>
              )}
            </Group>
            <Text size="sm" c="dimmed">
              {canRead ? t("Coach.Diary.Desc") : t("Coach.Diary.Locked")}
            </Text>
          </Box>
          {canRead && (
            <Button variant="light" radius="md" onClick={() => setDiaryOpen(true)}>
              {t("Coach.Diary.Open")}
            </Button>
          )}
        </Group>
      </Card>
      <Modal
        opened={diaryOpen}
        onClose={() => setDiaryOpen(false)}
        title={t("Coach.Diary.Title")}
        centered
        size="lg"
      >
        <Stack gap="sm">
          <Text size="sm">
            {t("Coach.Diary.Games", {
              games: summary.games,
              wins: summary.wins,
              draws: summary.draws,
              losses: summary.losses,
            })}
          </Text>
          {summary.firsts.length > 0 && (
            <Box>
              <Text fw={600} size="sm" mb={4}>
                {t("Coach.Diary.Openings")}
              </Text>
              <Table>
                <Table.Tbody>
                  {summary.firsts.map(([line, n]) => (
                    <Table.Tr key={line}>
                      <Table.Td>{line}</Table.Td>
                      <Table.Td ta="right">{n}×</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Box>
          )}
          {summary.trouble.length > 0 && (
            <Box>
              <Text fw={600} size="sm" mb={4}>
                {t("Coach.Diary.Trouble")}
              </Text>
              <Table>
                <Table.Tbody>
                  {summary.trouble.map(([line, n]) => (
                    <Table.Tr key={line}>
                      <Table.Td>{line}</Table.Td>
                      <Table.Td ta="right">{n}×</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Box>
          )}
          <Text size="xs" c="dimmed">
            {t("Coach.Diary.Note")}
          </Text>
        </Stack>
      </Modal>
    </>
  );
}
