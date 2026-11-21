import { Button, Card, Group, Text } from "@mantine/core";
import { IconCrown } from "@tabler/icons-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cloudFirestore } from "@/utils/cloud/auth";
import { uploadBossBook } from "@/utils/cloud/coachCloud";
import { buildMyBossBook } from "./coachBossBuild";

// Admin-Übersicht: das Boss-Buch aus den eigenen Repertoires und
// Chess.com-Partien neu bauen und hochladen.
export default function BossBookAdmin() {
  const { t } = useTranslation();
  const [state, setState] = useState<
    | { kind: "idle" | "busy" }
    | { kind: "done"; moves: number; repertoires: number; games: number }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  const run = async () => {
    setState({ kind: "busy" });
    try {
      const { book, repertoires, games } = await buildMyBossBook();
      await uploadBossBook(await cloudFirestore(), book);
      setState({ kind: "done", moves: book.length, repertoires, games });
    } catch (e) {
      setState({ kind: "error", message: String(e) });
    }
  };

  return (
    <Card withBorder radius="md" p="md">
      <Group wrap="nowrap" align="center" gap="md">
        <IconCrown size={28} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text fw={600}>{t("Coach.Boss.AdminTitle")}</Text>
          <Text size="sm" c="dimmed">
            {state.kind === "done"
              ? t("Coach.Boss.AdminDone", {
                  moves: state.moves,
                  repertoires: state.repertoires,
                  games: state.games,
                })
              : state.kind === "error"
                ? t("Coach.Boss.AdminError", { message: state.message })
                : t("Coach.Boss.AdminDesc")}
          </Text>
        </div>
        <Button variant="light" loading={state.kind === "busy"} onClick={() => void run()}>
          {t("Coach.Boss.AdminUpdate")}
        </Button>
      </Group>
    </Card>
  );
}
