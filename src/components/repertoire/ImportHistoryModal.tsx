import { Alert, Badge, Button, Group, Loader, Modal, Paper, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconArrowBackUp } from "@tabler/icons-react";
import { useAtomValue } from "jotai";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import useSWR from "swr";
import {
  getImportHistory,
  type Repertoire,
  repertoireVersionAtom,
  undoImport,
} from "@/utils/repertoires";

// The imports into one repertoire, newest first, each with a button that puts the repertoire
// back to how it was before.
export default function ImportHistoryModal({
  repertoire,
  onClose,
}: {
  repertoire: Repertoire | null;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const version = useAtomValue(repertoireVersionAtom);
  const { data: entries, mutate } = useSWR(
    repertoire ? ["repertoire-history", repertoire.file.path, version] : null,
    () => getImportHistory(repertoire!.file),
  );
  // The import whose undo waits for a second click
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function undo(id: string) {
    if (!repertoire) return;
    setBusy(true);
    try {
      const undone = await undoImport(repertoire.file, id);
      await mutate();
      setConfirming(null);
      if (undone) {
        notifications.show({
          color: "green",
          title: repertoire.name,
          message: t("Repertoire.History.Undone", { imports: undone.length }),
        });
      }
    } catch (e) {
      notifications.show({
        color: "red",
        title: t("Repertoire.History.UndoFailed"),
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  }

  const date = (ms: number) =>
    new Date(ms).toLocaleString(i18n.language.replace("_", "-"), {
      dateStyle: "medium",
      timeStyle: "short",
    });

  return (
    <Modal
      opened={!!repertoire}
      onClose={() => {
        setConfirming(null);
        onClose();
      }}
      title={t("Repertoire.History.Title", { name: repertoire?.name ?? "" })}
      size="lg"
    >
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          {t("Repertoire.History.Help")}
        </Text>
        {entries === undefined ? (
          <Loader size="sm" />
        ) : entries.length === 0 ? (
          <Text size="sm" c="dimmed">
            {t("Repertoire.History.Empty")}
          </Text>
        ) : (
          entries.map((entry, index) => (
            <Paper key={entry.id} withBorder p="sm">
              <Group justify="space-between" wrap="nowrap" align="flex-start">
                <Stack gap={2} style={{ minWidth: 0 }}>
                  <Group gap="xs">
                    <Badge
                      size="sm"
                      variant="light"
                      color={entry.kind === "course" ? "grape" : "blue"}
                    >
                      {entry.kind === "course"
                        ? t("Repertoire.History.Course")
                        : t("Repertoire.History.Line")}
                    </Badge>
                    <Text size="xs" c="dimmed">
                      {date(entry.date)}
                    </Text>
                  </Group>
                  <Text size="sm" fw={500} lineClamp={2}>
                    {entry.source || t("Repertoire.History.NoSource")}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {t("Repertoire.History.Added", { moves: entry.added })}
                  </Text>
                </Stack>
                {confirming !== entry.id && (
                  <Button
                    size="xs"
                    variant="default"
                    leftSection={<IconArrowBackUp size="0.9rem" />}
                    onClick={() => setConfirming(entry.id)}
                  >
                    {t("Repertoire.History.Undo")}
                  </Button>
                )}
              </Group>
              {confirming === entry.id && (
                <Alert color="orange" mt="sm" p="xs">
                  <Stack gap="xs">
                    <Text size="sm">
                      {index === 0
                        ? t("Repertoire.History.Confirm")
                        : t("Repertoire.History.ConfirmLater", { count: index })}
                    </Text>
                    <Group gap="xs">
                      <Button
                        size="xs"
                        color="orange"
                        loading={busy}
                        onClick={() => undo(entry.id)}
                      >
                        {t("Repertoire.History.UndoNow")}
                      </Button>
                      <Button
                        size="xs"
                        variant="subtle"
                        color="gray"
                        onClick={() => setConfirming(null)}
                      >
                        {t("Common.Cancel")}
                      </Button>
                    </Group>
                  </Stack>
                </Alert>
              )}
            </Paper>
          ))
        )}
      </Stack>
    </Modal>
  );
}
