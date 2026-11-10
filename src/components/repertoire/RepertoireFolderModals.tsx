import {
  Alert,
  Autocomplete,
  Button,
  Checkbox,
  Code,
  Group,
  Modal,
  Progress,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconFolderOpen } from "@tabler/icons-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { joinFolder, normalizeFolder, planFolderImport } from "@/utils/repertoireFolders";
import {
  createFolder,
  type FolderImportProgress,
  importPgnFolder,
  type Repertoire,
  type RepertoireColor,
  renameFolder,
  scanPgnFolder,
  useMainOwner,
} from "@/utils/repertoires";

export type FolderEdit =
  | { mode: "new"; owner: string; color: RepertoireColor; parent: string }
  | { mode: "rename"; owner: string; color: RepertoireColor; path: string };

// A new (sub)folder, or a new name for a folder. Renaming keeps everything inside.
export function FolderNameModal({
  edit,
  documentDir,
  repertoires,
  onClose,
}: {
  edit: FolderEdit;
  documentDir: string;
  repertoires: Repertoire[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const current = edit.mode === "rename" ? (edit.path.split("/").pop() ?? "") : "";
  const parent = edit.mode === "rename" ? edit.path.split("/").slice(0, -1).join("/") : edit.parent;
  const [name, setName] = useState(current);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    const clean = normalizeFolder(name.replaceAll("/", " "));
    if (!clean) {
      setError(t("Common.RequireName"));
      return;
    }
    setSaving(true);
    try {
      const path = joinFolder(parent, clean);
      if (edit.mode === "new") {
        await createFolder(documentDir, { owner: edit.owner, color: edit.color, path });
      } else if (path !== edit.path) {
        await renameFolder(documentDir, repertoires, edit.owner, edit.color, edit.path, path);
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      opened
      onClose={onClose}
      title={
        edit.mode === "new"
          ? t("Repertoire.Folder.NewFolderTitle")
          : t("Repertoire.Folder.RenameTitle", { name: current })
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Stack>
          {parent && (
            <Text size="sm" c="dimmed">
              {t("Repertoire.Folder.Inside", { folder: parent.replaceAll("/", " › ") })}
            </Text>
          )}
          <TextInput
            label={t("Common.Name")}
            value={name}
            onChange={(e) => {
              setName(e.currentTarget.value);
              setError("");
            }}
            error={error}
            data-autofocus
          />
          <Button type="submit" loading={saving}>
            {edit.mode === "new" ? t("Common.Create") : t("Repertoire.Folder.RenameButton")}
          </Button>
        </Stack>
      </form>
    </Modal>
  );
}

type Scan = Awaited<ReturnType<typeof scanPgnFolder>> & { dir: string; name: string };

// Imports a folder of PGN files from disk: one repertoire per file, subfolders become folders.
export function ImportFolderModal({
  documentDir,
  owners,
  folders,
  onClose,
}: {
  documentDir: string;
  owners: string[];
  folders: string[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const mainOwner = useMainOwner();
  const [scan, setScan] = useState<Scan | null>(null);
  const [owner, setOwner] = useState(mainOwner);
  const [color, setColor] = useState<RepertoireColor>("white");
  const [target, setTarget] = useState("");
  const [keepRootName, setKeepRootName] = useState(true);
  const [progress, setProgress] = useState<FolderImportProgress | null>(null);
  const [error, setError] = useState("");

  async function pick() {
    const picked = await open({ directory: true, multiple: false });
    if (typeof picked !== "string") return;
    try {
      const result = await scanPgnFolder(picked);
      setScan({ ...result, dir: picked, name: picked.split(/[\\/]/).filter(Boolean).pop() ?? "" });
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const plan = scan
    ? planFolderImport(scan.files, scan.dirs, target, keepRootName ? scan.name : null)
    : null;

  async function run() {
    if (!scan || !plan) return;
    const ownerName =
      owners.find((o) => o.toLowerCase() === owner.trim().toLowerCase()) ??
      (owner.trim() || mainOwner);
    setProgress({ done: 0, total: plan.items.length, current: "" });
    try {
      const result = await importPgnFolder({
        documentDir,
        dir: scan.dir,
        owner: ownerName,
        color,
        target,
        keepRootName,
        onProgress: setProgress,
      });
      notifications.show({
        color: result.failed.length > 0 ? "orange" : "green",
        title: t("Repertoire.FolderImport.Done", { repertoires: result.created }),
        message:
          result.failed.length > 0
            ? t("Repertoire.FolderImport.Failed", {
                names: result.failed.map((f) => f.name).join(", "),
              })
            : [
                t("Repertoire.Add.Added", { count: result.moves }),
                result.mainAdded > 0
                  ? t("Repertoire.Main.Synced", { count: result.mainAdded })
                  : "",
              ]
                .filter(Boolean)
                .join(" · "),
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setProgress(null);
    }
  }

  const busy = progress !== null;

  return (
    <Modal
      opened
      onClose={busy ? () => {} : onClose}
      title={t("Repertoire.FolderImport.Title")}
      size="lg"
    >
      <Stack>
        <Text size="sm" c="dimmed">
          {t("Repertoire.FolderImport.Help")}
        </Text>
        <Group>
          <Button
            variant="default"
            leftSection={<IconFolderOpen size="1rem" />}
            onClick={pick}
            disabled={busy}
          >
            {t("Repertoire.FolderImport.Pick")}
          </Button>
          {scan && (
            <Text size="sm" fw={500} style={{ wordBreak: "break-all" }}>
              {scan.dir}
            </Text>
          )}
        </Group>
        {error && <Alert color="red">{error}</Alert>}
        {scan && plan && (
          <>
            <Text size="sm">
              {t("Repertoire.FolderImport.Found", {
                files: plan.items.length,
                folders: plan.folders.length,
              })}
            </Text>
            {plan.items.length > 0 && (
              <Code block mah={160} style={{ overflow: "auto" }}>
                {plan.items
                  .slice(0, 40)
                  .map((i) => [i.folder.replaceAll("/", " › "), i.name].filter(Boolean).join(" › "))
                  .join("\n")}
                {plan.items.length > 40 ? `\n… +${plan.items.length - 40}` : ""}
              </Code>
            )}
            <Autocomplete
              label={t("Repertoire.Owner")}
              data={owners}
              value={owner}
              onChange={setOwner}
              disabled={busy}
            />
            <SegmentedControl
              fullWidth
              value={color}
              onChange={(v) => setColor(v as RepertoireColor)}
              disabled={busy}
              data={[
                { label: t("Repertoire.White"), value: "white" },
                { label: t("Repertoire.Black"), value: "black" },
              ]}
            />
            <Autocomplete
              label={t("Repertoire.FolderImport.Target")}
              placeholder={t("Repertoire.Folder.TopLevel")}
              data={folders}
              value={target}
              onChange={setTarget}
              disabled={busy}
            />
            <Checkbox
              label={t("Repertoire.FolderImport.KeepName", { name: scan.name })}
              checked={keepRootName}
              onChange={(e) => setKeepRootName(e.currentTarget.checked)}
              disabled={busy}
            />
          </>
        )}
        {progress && (
          <Stack gap={4}>
            <Progress
              value={progress.total > 0 ? (progress.done / progress.total) * 100 : 0}
              animated
            />
            <Text size="xs" c="dimmed">
              {progress.done} / {progress.total} {progress.current && `· ${progress.current}`}
            </Text>
          </Stack>
        )}
        <Button onClick={run} disabled={!plan || plan.items.length === 0} loading={busy}>
          {t("Repertoire.FolderImport.Run", { repertoires: plan?.items.length ?? 0 })}
        </Button>
      </Stack>
    </Modal>
  );
}
