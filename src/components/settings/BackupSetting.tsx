import { Button, Checkbox, Group, Modal, ScrollArea, Select, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconArchive, IconFolderOpen, IconRestore } from "@tabler/icons-react";
import { openPath } from "@tauri-apps/plugin-opener";
import { useAtomValue } from "jotai";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import useSWR from "swr";
import { commands } from "@/bindings";
import { backupNow, backupVersionAtom } from "@/utils/backup";
import { getDocumentDir } from "@/utils/directories";
import { bumpRepertoires } from "@/utils/repertoires";
import { unwrap } from "@/utils/unwrap";

function formatSize(bytes: number, language: string) {
  const mb = bytes / (1024 * 1024);
  return mb >= 1
    ? `${mb.toLocaleString(language, { maximumFractionDigits: 1 })} MB`
    : `${Math.max(1, Math.round(bytes / 1024)).toLocaleString(language)} KB`;
}

/** Automatic backup (#119): last backup, back up now, open folder, restore. */
export default function BackupSetting() {
  const { t, i18n } = useTranslation();
  const version = useAtomValue(backupVersionAtom);
  const { data: backups, mutate } = useSWR(["backups", version], async () =>
    unwrap(await commands.backupList()),
  );
  const [saving, setSaving] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const last = backups?.[0];

  const save = async () => {
    setSaving(true);
    try {
      await backupNow(false);
      await mutate();
      notifications.show({ color: "teal", message: t("Settings.Backup.Saved") });
    } catch (e) {
      notifications.show({ color: "red", title: t("Settings.Backup.Failed"), message: String(e) });
    }
    setSaving(false);
  };

  return (
    <Stack gap="xs" maw={420}>
      <Text size="sm">
        {last
          ? t("Settings.Backup.Last", {
              time: new Date(last.createdAt).toLocaleString(i18n.language, {
                dateStyle: "medium",
                timeStyle: "short",
              }),
              size: formatSize(last.size, i18n.language),
              count: last.repertoires,
            })
          : t("Settings.Backup.None")}
      </Text>
      <Group gap="xs">
        <Button
          size="compact-sm"
          variant="light"
          leftSection={<IconArchive size="0.9rem" />}
          loading={saving}
          onClick={() => void save()}
        >
          {t("Settings.Backup.Now")}
        </Button>
        <Button
          size="compact-sm"
          variant="default"
          leftSection={<IconFolderOpen size="0.9rem" />}
          onClick={async () => {
            try {
              await openPath(unwrap(await commands.backupFolder()));
            } catch (e) {
              notifications.show({ color: "red", message: String(e) });
            }
          }}
        >
          {t("Settings.Backup.OpenFolder")}
        </Button>
        <Button
          size="compact-sm"
          variant="default"
          leftSection={<IconRestore size="0.9rem" />}
          disabled={!backups?.length}
          onClick={() => setRestoring(true)}
        >
          {t("Settings.Backup.Restore")}
        </Button>
      </Group>
      {restoring && backups && (
        <RestoreModal backups={backups} onClose={() => setRestoring(false)} onDone={mutate} />
      )}
    </Stack>
  );
}

function RestoreModal({
  backups,
  onClose,
  onDone,
}: {
  backups: { file: string; createdAt: number; repertoires: number }[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [file, setFile] = useState(backups[0].file);
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const { data: list } = useSWR(["backup-repertoires", file], async () =>
    unwrap(await commands.backupRepertoires(file)),
  );

  const restore = async () => {
    setBusy(true);
    try {
      // The current state first, so a restore can be undone too.
      await backupNow(false);
      const restored = unwrap(await commands.backupRestore(file, chosen, await getDocumentDir()));
      bumpRepertoires();
      onDone();
      notifications.show({
        color: "teal",
        message: t("Settings.Backup.Restored", { count: restored.length }),
      });
      onClose();
    } catch (e) {
      notifications.show({ color: "red", title: t("Settings.Backup.Failed"), message: String(e) });
      setBusy(false);
    }
  };

  const all = list?.map((r) => r.path) ?? [];
  return (
    <Modal opened onClose={onClose} title={t("Settings.Backup.Restore")} size="lg">
      <Stack gap="sm">
        <Select
          label={t("Settings.Backup.Choose")}
          allowDeselect={false}
          value={file}
          onChange={(v) => {
            if (v) {
              setFile(v);
              setChosen([]);
            }
          }}
          data={backups.map((b) => ({
            value: b.file,
            label: `${new Date(b.createdAt).toLocaleString(i18n.language, {
              dateStyle: "medium",
              timeStyle: "short",
            })} · ${t("Settings.Backup.Count", { count: b.repertoires })}`,
          }))}
        />
        <Group justify="space-between">
          <Text size="sm" c="dimmed">
            {t("Settings.Backup.Pick")}
          </Text>
          <Button
            size="compact-xs"
            variant="subtle"
            onClick={() => setChosen(chosen.length === all.length ? [] : all)}
          >
            {chosen.length === all.length && all.length > 0
              ? t("Settings.Backup.None.Pick")
              : t("Settings.Backup.All")}
          </Button>
        </Group>
        <ScrollArea.Autosize mah={300}>
          <Checkbox.Group value={chosen} onChange={setChosen}>
            <Stack gap={6}>
              {(list ?? []).map((r) => (
                <Checkbox key={r.path} value={r.path} label={r.path.replace(/\//g, " › ")} />
              ))}
            </Stack>
          </Checkbox.Group>
        </ScrollArea.Autosize>
        <Text size="xs" c="dimmed">
          {t("Settings.Backup.RestoreHint")}
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("Common.Cancel")}
          </Button>
          <Button
            leftSection={<IconRestore size="1rem" />}
            disabled={chosen.length === 0}
            loading={busy}
            onClick={() => void restore()}
          >
            {t("Settings.Backup.RestoreCount", { count: chosen.length })}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
