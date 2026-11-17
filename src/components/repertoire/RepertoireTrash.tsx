import {
  ActionIcon,
  Button,
  Collapse,
  Group,
  Modal,
  Paper,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconArrowBackUp, IconChevronRight, IconTrash } from "@tabler/icons-react";
import { useAtomValue } from "jotai";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import useSWR from "swr";
import {
  type DeletedRepertoire,
  type Repertoire,
  bumpRepertoires,
  repertoireVersionAtom,
  restoreRepertoire,
} from "@/utils/repertoires";
import {
  listTrash,
  purgeFromTrash,
  purgeOldTrash,
  type TrashEntry,
  trashRetentionDaysAtom,
} from "@/utils/trash";

/** Old entries are removed once per app start, when the trash is first shown. */
let purged = false;

/** "Repertoire gelöscht" with an undo button, shown right after deleting (#113). */
export function showDeletedNotification(
  labels: { done: string; undo: string; restored: string },
  name: string,
  deleted: DeletedRepertoire,
) {
  const id = `deleted-${deleted.suffix}-${name}`;
  notifications.show({
    id,
    color: "gray",
    title: labels.done,
    autoClose: 10_000,
    message: (
      <Group justify="space-between" wrap="nowrap" gap="xs">
        <Text size="sm" truncate>
          {name}
        </Text>
        <Button
          size="compact-xs"
          variant="light"
          leftSection={<IconArrowBackUp size="0.9rem" />}
          onClick={async () => {
            notifications.hide(id);
            try {
              await restoreRepertoire(deleted);
              notifications.show({ color: "teal", title: labels.restored, message: name });
            } catch (e) {
              notifications.show({ color: "red", title: name, message: String(e) });
            }
          }}
        >
          {labels.undo}
        </Button>
      </Group>
    ),
  });
}

function folderOf(entry: TrashEntry): string {
  const folder = entry.info?.folder;
  return typeof folder === "string" ? folder.replace(/\//g, " › ") : "";
}

/**
 * Deleted repertoires at the bottom of the repertoire page: restore them or
 * remove them for good. Hidden while empty.
 */
export default function RepertoireTrash({
  documentDir,
  repertoires,
}: {
  documentDir: string;
  repertoires: Repertoire[];
}) {
  const { t, i18n } = useTranslation();
  const version = useAtomValue(repertoireVersionAtom);
  const days = useAtomValue(trashRetentionDaysAtom);
  const [open, setOpen] = useState(false);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  // "gelöscht vor 2 Tagen" only needs the time the page was opened.
  const [now] = useState(() => Date.now());
  const { data, mutate } = useSWR(["repertoire-trash", documentDir, version], () =>
    listTrash(documentDir),
  );

  useEffect(() => {
    if (purged) return;
    purged = true;
    void purgeOldTrash(documentDir, days)
      .then((n) => {
        if (n > 0) void mutate();
      })
      .catch(() => {});
  }, [documentDir, days, mutate]);

  // A copy whose repertoire came back (restored on another device and synced)
  // is no longer interesting; it goes with the normal clean-up.
  const live = new Set(repertoires.map((r) => r.file.metadata.id).filter(Boolean));
  const entries = (data ?? []).filter((e) => {
    const id = e.info?.id;
    return !(typeof id === "string" && live.has(id));
  });
  if (entries.length === 0) return null;

  const rtf = new Intl.RelativeTimeFormat(i18n.language, { numeric: "auto" });
  const ago = (time: number) => {
    const days = Math.round((time - now) / (24 * 60 * 60 * 1000));
    if (days !== 0) return rtf.format(days, "day");
    return rtf.format(Math.round((time - now) / (60 * 60 * 1000)), "hour");
  };

  const restore = async (e: TrashEntry) => {
    setBusy(e.file);
    try {
      await restoreRepertoire(e);
      notifications.show({ color: "teal", title: t("Repertoire.Trash.Restored"), message: e.name });
    } catch (err) {
      notifications.show({ color: "red", title: e.name, message: String(err) });
    }
    setBusy(null);
  };

  const purge = async (list: TrashEntry[]) => {
    setBusy("all");
    try {
      for (const e of list) await purgeFromTrash(e);
    } catch (err) {
      notifications.show({
        color: "red",
        title: t("Repertoire.Trash.Title"),
        message: String(err),
      });
    }
    setBusy(null);
    bumpRepertoires();
  };

  return (
    <Paper withBorder p="sm" radius="md">
      <Group justify="space-between" wrap="nowrap">
        <Button
          variant="subtle"
          color="gray"
          size="compact-sm"
          leftSection={
            <IconChevronRight
              size="0.9rem"
              style={{
                transform: open ? "rotate(90deg)" : undefined,
                transition: "transform 150ms",
              }}
            />
          }
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          {t("Repertoire.Trash.Title")} ({entries.length})
        </Button>
        {open && (
          <Button
            variant="subtle"
            color="red"
            size="compact-xs"
            disabled={busy !== null}
            onClick={() => setConfirmEmpty(true)}
          >
            {t("Repertoire.Trash.Empty")}
          </Button>
        )}
      </Group>
      <Collapse expanded={open}>
        <Stack gap={4} mt="xs">
          <Text size="xs" c="dimmed">
            {days > 0 ? t("Repertoire.Trash.Hint", { days }) : t("Repertoire.Trash.HintForever")}
          </Text>
          {entries.map((e) => (
            <Group key={e.file} justify="space-between" wrap="nowrap" gap="xs">
              <Stack gap={0} style={{ minWidth: 0 }}>
                <Text size="sm" fw={500} truncate>
                  {e.name}
                </Text>
                <Text size="xs" c="dimmed" truncate>
                  {[folderOf(e), t("Repertoire.Trash.DeletedAgo", { ago: ago(e.deletedAt) })]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              </Stack>
              <Group gap={4} wrap="nowrap">
                <Button
                  size="compact-xs"
                  variant="light"
                  leftSection={<IconArrowBackUp size="0.9rem" />}
                  loading={busy === e.file}
                  disabled={busy !== null && busy !== e.file}
                  onClick={() => void restore(e)}
                >
                  {t("Repertoire.Trash.Restore")}
                </Button>
                <Tooltip label={t("Repertoire.Trash.DeleteForever")}>
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color="red"
                    aria-label={t("Repertoire.Trash.DeleteForever")}
                    disabled={busy !== null}
                    onClick={() => void purge([e])}
                  >
                    <IconTrash size="0.9rem" />
                  </ActionIcon>
                </Tooltip>
              </Group>
            </Group>
          ))}
        </Stack>
      </Collapse>
      <Modal
        opened={confirmEmpty}
        onClose={() => setConfirmEmpty(false)}
        title={t("Repertoire.Trash.EmptyConfirm")}
      >
        <Stack>
          <Text size="sm">{t("Repertoire.Trash.EmptyConfirmText", { count: entries.length })}</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirmEmpty(false)} data-autofocus>
              {t("Common.Cancel")}
            </Button>
            <Button
              color="red"
              onClick={() => {
                setConfirmEmpty(false);
                void purge(entries);
              }}
            >
              {t("Repertoire.Trash.Empty")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Paper>
  );
}
