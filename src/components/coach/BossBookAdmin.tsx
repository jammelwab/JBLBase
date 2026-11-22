import { Button, Card, Group, Stack, Text } from "@mantine/core";
import { IconCrown } from "@tabler/icons-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cloudFirestore } from "@/utils/cloud/auth";
import { uploadBossBook } from "@/utils/cloud/coachCloud";
import { BOSS_CHESSCOM, type BossBuild, buildMyBossBook } from "./coachBossBuild";

// Admin-Übersicht: das Boss-Buch aus den eigenen Repertoires und den
// Chess.com-Partien von jbl_Mix3r neu bauen und hochladen. Danach zeigt die
// Karte, was der Boss in den ersten Zügen spielt, zum Nachprüfen.
export default function BossBookAdmin() {
  const { t } = useTranslation();
  const [state, setState] = useState<
    | { kind: "idle" | "busy" }
    | { kind: "done"; build: BossBuild }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  const run = async () => {
    setState({ kind: "busy" });
    try {
      const build = await buildMyBossBook();
      if (build.book.length === 0) throw new Error(t("Coach.Boss.AdminEmpty"));
      await uploadBossBook(await cloudFirestore(), build.book);
      setState({ kind: "done", build });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  const shares = (moves: { san: string; share: number }[]) =>
    moves.length
      ? moves.map((m) => `${m.san} (${m.share} %)`).join(", ")
      : t("Coach.Boss.AdminNoMove");

  return (
    <Card withBorder radius="md" p="md">
      <Group wrap="nowrap" align="center" gap="md">
        <IconCrown size={28} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text fw={600}>{t("Coach.Boss.AdminTitle")}</Text>
          <Text size="sm" c="dimmed">
            {state.kind === "done"
              ? t("Coach.Boss.AdminDone", {
                  moves: state.build.book.length,
                  repertoires: state.build.repertoires.length,
                  games: state.build.games,
                })
              : state.kind === "error"
                ? t("Coach.Boss.AdminError", { message: state.message })
                : t("Coach.Boss.AdminDesc", { account: BOSS_CHESSCOM })}
          </Text>
        </div>
        <Button variant="light" loading={state.kind === "busy"} onClick={() => void run()}>
          {t("Coach.Boss.AdminUpdate")}
        </Button>
      </Group>
      {state.kind === "done" && (
        <Stack gap={4} mt="sm" pl={44}>
          <Text size="sm">
            {t("Coach.Boss.AdminRepertoires", {
              names:
                state.build.repertoires
                  .map(
                    (r) =>
                      `${r.name} (${t(r.color === "white" ? "Coach.Boss.White" : "Coach.Boss.Black")})`,
                  )
                  .join(", ") || "–",
            })}
          </Text>
          <Text size="sm">
            {t(
              state.build.source === "chesscom"
                ? "Coach.Boss.AdminGamesOnline"
                : "Coach.Boss.AdminGamesLocal",
              { count: state.build.games, account: BOSS_CHESSCOM },
            )}
          </Text>
          <Text size="sm">
            {t("Coach.Boss.AdminAsWhite", { moves: shares(state.build.summary.white) })}
          </Text>
          {state.build.summary.black.map((b) => (
            <Text size="sm" key={b.against}>
              {t("Coach.Boss.AdminAsBlack", {
                against: `1.${b.against}`,
                moves: shares(b.replies),
              })}
            </Text>
          ))}
        </Stack>
      )}
    </Card>
  );
}
