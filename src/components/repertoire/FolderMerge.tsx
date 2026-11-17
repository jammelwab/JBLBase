import { Alert, Button, Group, Modal, Paper, Select, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconArrowMerge, IconFolder } from "@tabler/icons-react";
import {
  createContext,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  type FolderGroup,
  folderLabel,
  inFolder,
  isSameGroup,
  planFolderMerge,
} from "@/utils/repertoireFolders";
import { mergeFolderIntoRepertoire, type Repertoire } from "@/utils/repertoires";

// A folder dragged onto a repertoire card, e.g. "Ich Weiß", gives that repertoire every line
// of the folder (see mergeFolderIntoRepertoire). The drag follows the pointer by hand: the
// app window takes HTML drag and drop for files dropped from outside, so the browser's own
// drag events don't arrive. Cards mark themselves with data-rep-drop="<file path>".

export type FolderMergeRequest = { source: FolderGroup; target?: string };

type Drag = { source: FolderGroup; x: number; y: number; over: string | null };

type FolderDragApi = {
  drag: Drag | null;
  begin: (e: ReactPointerEvent, source: FolderGroup) => void;
};

const FolderDragContext = createContext<FolderDragApi | null>(null);

export function useFolderDrag() {
  return useContext(FolderDragContext);
}

const THRESHOLD_PX = 8;

// Where a folder's lines may go: own repertoires that are not in the folder itself
export function canTakeFolder(r: Repertoire, source: FolderGroup): boolean {
  if (r.shared || r.parts) return false;
  return !(isSameGroup(r, source.owner, source.color) && inFolder(r.folder, source.path));
}

export function FolderDragProvider({
  repertoires,
  onDrop,
  children,
}: {
  repertoires: Repertoire[];
  onDrop: (request: FolderMergeRequest) => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [drag, setDrag] = useState<Drag | null>(null);
  const latest = useRef({ repertoires, onDrop });
  useEffect(() => {
    latest.current = { repertoires, onDrop };
  }, [repertoires, onDrop]);
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);

  const api = useMemo<FolderDragApi>(
    () => ({
      drag,
      begin: (e, source) => {
        if (e.button !== 0 || cleanup.current) return;
        // Buttons in the folder row keep their own click
        if ((e.target as HTMLElement).closest("button, a, input")) return;
        const start = { x: e.clientX, y: e.clientY };
        let dragging = false;
        let over: string | null = null;

        const targetAt = (x: number, y: number) => {
          const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-rep-drop]");
          const path = el?.dataset.repDrop;
          const r = latest.current.repertoires.find((r) => r.file.path === path);
          return r && canTakeFolder(r, source) ? r.file.path : null;
        };
        const move = (ev: PointerEvent) => {
          if (!dragging) {
            if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < THRESHOLD_PX) return;
            dragging = true;
            document.body.style.userSelect = "none";
            document.body.style.cursor = "grabbing";
          }
          over = targetAt(ev.clientX, ev.clientY);
          setDrag({ source, x: ev.clientX, y: ev.clientY, over });
        };
        const end = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          window.removeEventListener("pointercancel", end);
          window.removeEventListener("keydown", key);
          document.body.style.userSelect = "";
          document.body.style.cursor = "";
          cleanup.current = null;
          setDrag(null);
        };
        const up = (ev: PointerEvent) => {
          const wasDragging = dragging;
          const target = wasDragging ? targetAt(ev.clientX, ev.clientY) : null;
          end();
          if (!wasDragging) return;
          // The click after a drag must not open or close the folder
          const stop = (c: MouseEvent) => {
            c.stopPropagation();
            c.preventDefault();
          };
          window.addEventListener("click", stop, { capture: true, once: true });
          setTimeout(() => window.removeEventListener("click", stop, { capture: true }), 100);
          if (target) latest.current.onDrop({ source, target });
        };
        const key = (ev: KeyboardEvent) => {
          if (ev.key === "Escape") end();
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        window.addEventListener("pointercancel", end);
        window.addEventListener("keydown", key);
        cleanup.current = end;
      },
    }),
    [drag],
  );

  const target = drag?.over ? repertoires.find((r) => r.file.path === drag.over) : undefined;
  return (
    <FolderDragContext.Provider value={api}>
      {children}
      {drag && (
        <Paper
          shadow="md"
          withBorder
          px="sm"
          py={6}
          radius="md"
          style={{
            position: "fixed",
            left: drag.x + 14,
            top: drag.y + 14,
            zIndex: 1000,
            pointerEvents: "none",
            maxWidth: 360,
          }}
        >
          <Group gap={6} wrap="nowrap">
            <IconFolder size="1rem" color="var(--mantine-color-yellow-6)" />
            <Text size="sm" fw={600} truncate="end">
              {folderLabel(drag.source.path)}
            </Text>
          </Group>
          <Text size="xs" c={target ? "blue" : "dimmed"}>
            {target
              ? t("Repertoire.FolderMerge.DropOn", { name: target.name })
              : t("Repertoire.FolderMerge.DragHint")}
          </Text>
        </Paper>
      )}
    </FolderDragContext.Provider>
  );
}

// Asks before the lines go in; also reachable without dragging, from the folder's button
export function FolderMergeModal({
  request,
  repertoires,
  documentDir,
  onClose,
}: {
  request: FolderMergeRequest;
  repertoires: Repertoire[];
  documentDir: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { source } = request;
  const colorName = (c: string) => (c === "white" ? t("Repertoire.White") : t("Repertoire.Black"));
  const targets = repertoires.filter((r) => canTakeFolder(r, source));
  const [targetPath, setTargetPath] = useState<string | null>(request.target ?? null);
  const [saving, setSaving] = useState(false);
  const target = targets.find((r) => r.file.path === targetPath);
  const plan = target ? planFolderMerge(repertoires, source, target) : null;
  const folder = folderLabel(source.path);

  // Grouped by player and color, like the page
  const data = (() => {
    const groups = new Map<string, { value: string; label: string }[]>();
    for (const r of targets) {
      const group = `${r.owner} · ${colorName(r.color)}`;
      const label = r.folder ? `${r.name} (${folderLabel(r.folder)})` : r.name;
      groups.set(group, [...(groups.get(group) ?? []), { value: r.file.path, label }]);
    }
    return [...groups.entries()].map(([group, items]) => ({ group, items }));
  })();

  async function merge() {
    if (!target) return;
    setSaving(true);
    try {
      const result = await mergeFolderIntoRepertoire(
        documentDir,
        repertoires,
        source,
        target,
        t("Repertoire.FolderMerge.Source", { folder }),
      );
      notifications.show({
        color: "green",
        title: target.name,
        message: [
          t("Repertoire.FolderMerge.Done", { count: result.added }),
          result.moved
            ? t("Repertoire.FolderMerge.MovedTo", {
                group: `${target.owner} ${colorName(target.color)}`,
              })
            : "",
          result.skipped > 0 ? t("Repertoire.FolderMerge.Skipped", { count: result.skipped }) : "",
        ]
          .filter(Boolean)
          .join(" "),
      });
      onClose();
    } catch (e) {
      notifications.show({
        color: "red",
        title: folder,
        message: e instanceof Error ? e.message : String(e),
      });
      setSaving(false);
    }
  }

  return (
    <Modal opened onClose={onClose} title={t("Repertoire.FolderMerge.Title", { folder })}>
      <Stack>
        <Select
          label={t("Repertoire.FolderMerge.Target")}
          placeholder={t("Repertoire.FolderMerge.TargetPlaceholder")}
          data={data}
          value={targetPath}
          onChange={setTargetPath}
          searchable
          data-autofocus
        />
        {target && plan && (
          <Text size="sm">
            {t("Repertoire.FolderMerge.Explain", {
              count: plan.parts.length,
              name: target.name,
            })}
          </Text>
        )}
        {target && plan?.move && (
          <Alert color="yellow">
            {t("Repertoire.FolderMerge.Move", {
              folder,
              from: `${source.owner} ${colorName(source.color)}`,
              to: `${target.owner} ${colorName(target.color)}`,
            })}
          </Alert>
        )}
        {target && plan && plan.parts.length === 0 && !plan.move && (
          <Alert color="gray">{t("Repertoire.FolderMerge.Empty")}</Alert>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("Common.Cancel")}
          </Button>
          <Button
            leftSection={<IconArrowMerge size="1rem" />}
            disabled={!target || !plan || (plan.parts.length === 0 && !plan.move)}
            loading={saving}
            onClick={merge}
          >
            {t("Repertoire.FolderMerge.Button")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
