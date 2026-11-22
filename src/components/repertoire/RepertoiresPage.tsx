import {
  ActionIcon,
  Alert,
  Autocomplete,
  Badge,
  Box,
  Button,
  Card,
  Group,
  Menu,
  Modal,
  Paper,
  Tooltip,
  ScrollArea,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconArrowMerge,
  IconBinaryTree,
  IconBooks,
  IconChevronDown,
  IconChevronRight,
  IconFileImport,
  IconFolder,
  IconFolderDown,
  IconFolderPlus,
  IconFolderShare,
  IconFolders,
  IconPencil,
  IconTrash,
  IconHistory,
  IconTargetArrow,
  IconGitCompare,
  IconListSearch,
  IconPlus,
  IconCopy,
  IconShare,
  IconDots,
} from "@tabler/icons-react";
import { useLoaderData, useNavigate } from "@tanstack/react-router";
import { useAtom, useSetAtom } from "jotai";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { activeTabAtom, repertoireOpenAtom, tabsAtom } from "@/state/atoms";
import { openFile } from "@/utils/files";
import {
  allFolders,
  buildFolderTree,
  type FolderNode,
  folderItems,
  inFolder,
  findMainRepertoire,
  folderLabel,
  normalizeFolder,
  prettyFolderName,
} from "@/utils/repertoireFolders";
import { mergeTree, missingMoves } from "@/utils/repertoireTree";
import {
  combineRepertoires,
  copySharedRepertoire,
  createRepertoire,
  defaultRepertoires,
  DEFAULT_MAIN_OWNER,
  deleteFolder,
  deleteRepertoire,
  type Repertoire,
  type RepertoireColor,
  type RepertoireView,
  repertoireOwner,
  repertoireViewAtom,
  setRepertoireFolder,
  syncMainRepertoire,
  useMainOwner,
  useStoredFolders,
  useRepertoires,
} from "@/utils/repertoires";
import {
  FolderDragProvider,
  type FolderMergeRequest,
  FolderMergeModal,
  useFolderDrag,
} from "./FolderMerge";
import ImportCourseModal from "./ImportCourseModal";
import ImportHistoryModal from "./ImportHistoryModal";
import TacticSearchModal from "./TacticSearchModal";
import { type FolderEdit, FolderNameModal, ImportFolderModal } from "./RepertoireFolderModals";
import RepertoireCheckView from "./RepertoireCheckView";
import RepertoireCompareView from "./RepertoireCompareView";
import { ColorDot } from "./RepertoireLabel";
import RepertoireTrash, { showDeletedNotification } from "./RepertoireTrash";
import RepertoireTreeView from "./RepertoireTreeView";
import ShareRepertoireModal from "./ShareRepertoireModal";
import SharedWithMe, { declineShare } from "./SharedWithMe";
import { useFirstTimeTutorial } from "@/components/tutorial/tutorialState";
import { FIRST_TIME_TUTORIAL } from "@/components/tutorial/tutorials";
import classes from "./RepertoiresPage.module.css";

// Open or closed state of a part of the page, kept across restarts. Starts closed.
function useOpen(key: string): [boolean, () => void] {
  const [open, setOpen] = useAtom(repertoireOpenAtom);
  const isOpen = !!open[key];
  return [
    isOpen,
    () =>
      setOpen((prev) => {
        const next = { ...prev };
        if (isOpen) delete next[key];
        else next[key] = true;
        return next;
      }),
  ];
}

function useColorName() {
  const { t } = useTranslation();
  return (color: RepertoireColor) =>
    color === "white" ? t("Repertoire.White") : t("Repertoire.Black");
}

function RepertoireCard({
  repertoire,
  onShowTree,
  onCompare,
  onCheck,
  onMove,
  main,
}: {
  repertoire: Repertoire;
  onShowTree: () => void;
  onCompare: () => void;
  onCheck: () => void;
  onMove: () => void;
  // Set on the main repertoire of its player and color
  main?: MainInfo;
}) {
  const { t } = useTranslation();
  const colorName = useColorName();
  const setTabs = useSetAtom(tabsAtom);
  const setActiveTab = useSetAtom(activeTabAtom);
  const navigate = useNavigate();
  const { stats } = repertoire;
  const [showHistory, setShowHistory] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [searchingTactics, setSearchingTactics] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [copying, setCopying] = useState(false);
  const { documentDir } = useLoaderData({ from: "/repertoires" });
  const { shared } = repertoire;
  // Highlighted while a folder is dragged over it
  const folderDrag = useFolderDrag();
  const dropOver = folderDrag?.drag?.over === repertoire.file.path;

  async function copyShared() {
    setCopying(true);
    try {
      await copySharedRepertoire(
        repertoire,
        documentDir,
        t("Repertoire.Share.CopyName", { name: repertoire.name }),
      );
      notifications.show({
        color: "green",
        title: repertoire.name,
        message: t("Repertoire.Share.Copied"),
      });
    } catch (e) {
      notifications.show({
        color: "red",
        title: repertoire.name,
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setCopying(false);
    }
  }

  return (
    <Card
      withBorder
      padding="md"
      data-tour="rep-card"
      data-rep-drop={shared ? undefined : repertoire.file.path}
      style={
        dropOver
          ? {
              borderColor: "var(--mantine-color-blue-filled)",
              boxShadow: "0 0 0 2px var(--mantine-color-blue-filled)",
              backgroundColor: "var(--mantine-color-blue-light)",
            }
          : undefined
      }
    >
      {confirmDelete && (
        <DeleteRepertoireModal
          repertoire={repertoire}
          main={!!main}
          onClose={() => setConfirmDelete(false)}
        />
      )}
      {sharing && (
        <ShareRepertoireModal repertoire={repertoire} onClose={() => setSharing(false)} />
      )}
      {searchingTactics && (
        <TacticSearchModal repertoire={repertoire} onClose={() => setSearchingTactics(false)} />
      )}
      <ImportHistoryModal
        repertoire={showHistory ? repertoire : null}
        onClose={() => setShowHistory(false)}
      />
      <Stack gap="xs">
        <Group gap="xs" wrap="nowrap">
          <ColorDot color={repertoire.color} />
          <Text fw={600} truncate style={{ flex: 1 }}>
            {repertoire.name}
          </Text>
          <Menu position="bottom-end" shadow="md" withinPortal>
            <Menu.Target>
              <ActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                aria-label={t("Repertoire.More")}
                data-tour="rep-share"
              >
                <IconDots size="1rem" />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                leftSection={<IconTargetArrow size="1rem" />}
                onClick={() => setSearchingTactics(true)}
              >
                {t("Repertoire.Tactics.Button")}
              </Menu.Item>
              <Menu.Item
                leftSection={<IconHistory size="1rem" />}
                onClick={() => setShowHistory(true)}
              >
                {t("Repertoire.History.Button")}
              </Menu.Item>
              <Menu.Divider />
              {!shared && (
                <Menu.Item leftSection={<IconShare size="1rem" />} onClick={() => setSharing(true)}>
                  {t("Repertoire.Share.Button")}
                </Menu.Item>
              )}
              <Menu.Item leftSection={<IconFolderShare size="1rem" />} onClick={onMove}>
                {t("Repertoire.Folder.Move")}
              </Menu.Item>
              <Menu.Divider />
              <Menu.Item
                color="red"
                leftSection={<IconTrash size="1rem" />}
                onClick={() => setConfirmDelete(true)}
              >
                {t("Repertoire.Delete.Button")}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
        <Group gap="xs">
          <Text size="sm" c="dimmed">
            {colorName(repertoire.color)}
          </Text>
          {main && (
            <Tooltip label={t("Repertoire.Main.Hint")} multiline w={260}>
              <Badge size="sm" variant="light" color="green">
                {t("Repertoire.Main.Badge")}
              </Badge>
            </Tooltip>
          )}
          {shared && (
            <Tooltip
              label={
                shared.ended ? t("Repertoire.Share.EndedHint") : t("Repertoire.Share.FromHint")
              }
              multiline
              w={260}
            >
              <Badge size="sm" variant="light" color={shared.ended ? "gray" : "blue"}>
                {shared.ended
                  ? t("Repertoire.Share.Ended")
                  : t("Repertoire.Share.From", { name: shared.from })}
              </Badge>
            </Tooltip>
          )}
        </Group>
        <Text size="xs" c="dimmed">
          <Text span fw={600} c="var(--mantine-color-text)">
            {stats.moves}
          </Text>{" "}
          {t("Repertoire.Stats.Moves")} ·{" "}
          <Text span fw={600} c="var(--mantine-color-text)">
            {stats.leaves}
          </Text>{" "}
          {t("Repertoire.Stats.Lines")} · {t("Repertoire.Stats.Depth")}{" "}
          <Text span fw={600} c="var(--mantine-color-text)">
            {Math.ceil(stats.depth / 2)}
          </Text>
        </Text>
        <Group grow gap="xs">
          <Button
            variant="light"
            data-tour="rep-tree"
            leftSection={<IconBinaryTree size="1rem" />}
            onClick={onShowTree}
          >
            {t("Repertoire.Tree.Button")}
          </Button>
          <Button
            variant="default"
            data-tour="rep-open"
            onClick={async () => {
              try {
                await openFile(repertoire.file, setTabs, setActiveTab);
                navigate({ to: "/" });
              } catch (e) {
                notifications.show({
                  color: "red",
                  title: repertoire.name,
                  message: e instanceof Error ? e.message : String(e),
                });
              }
            }}
          >
            {t("Common.Open")}
          </Button>
        </Group>
        <Group grow gap="xs">
          <Button
            variant="subtle"
            color="gray"
            size="xs"
            leftSection={<IconListSearch size="1rem" />}
            data-tour="rep-check"
            onClick={onCheck}
          >
            {t("Repertoire.Check.Button")}
          </Button>
          <Button
            variant="subtle"
            color="gray"
            size="xs"
            leftSection={<IconGitCompare size="1rem" />}
            data-tour="rep-compare"
            onClick={onCompare}
            title={t("Repertoire.Compare.Button")}
          >
            {t("Repertoire.Compare.Short")}
          </Button>
        </Group>
        {shared && (
          <Button
            variant="light"
            size="xs"
            leftSection={<IconCopy size="1rem" />}
            loading={copying}
            onClick={copyShared}
          >
            {t("Repertoire.Share.Copy")}
          </Button>
        )}
        {main && main.missing > 0 && (
          <Button
            variant="light"
            color="green"
            size="xs"
            leftSection={<IconArrowMerge size="1rem" />}
            loading={syncing}
            onClick={async () => {
              setSyncing(true);
              await main.onSync();
              setSyncing(false);
            }}
          >
            {t("Repertoire.Main.Sync", { count: main.missing })}
          </Button>
        )}
      </Stack>
    </Card>
  );
}

// Asks before a repertoire is deleted. Names its folder and file, so of two repertoires
// with the same name the right one goes.
function DeleteRepertoireModal({
  repertoire,
  main,
  onClose,
}: {
  repertoire: Repertoire;
  main: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { documentDir } = useLoaderData({ from: "/repertoires" });
  const [deleting, setDeleting] = useState(false);
  const norm = (p: string) => p.replace(/\\/g, "/");
  const dir = norm(documentDir).replace(/\/+$/, "");
  const path = norm(repertoire.file.path);
  const file = path.toLowerCase().startsWith(`${dir.toLowerCase()}/`)
    ? path.slice(dir.length + 1)
    : path;

  async function remove() {
    setDeleting(true);
    try {
      // A received share is declined too, so the next sync does not bring it back
      if (repertoire.shared && !repertoire.shared.ended) await declineShare(repertoire.shared.id);
      const deleted = await deleteRepertoire(repertoire.file);
      showDeletedNotification(
        {
          done: t("Repertoire.Delete.Done"),
          undo: t("Repertoire.Trash.Undo"),
          restored: t("Repertoire.Trash.Restored"),
        },
        repertoire.name,
        deleted,
      );
      onClose();
    } catch (e) {
      notifications.show({
        color: "red",
        title: t("Repertoire.Delete.Failed"),
        message: e instanceof Error ? e.message : String(e),
      });
      setDeleting(false);
    }
  }

  return (
    <Modal opened onClose={onClose} title={t("Repertoire.Delete.Title")}>
      <Stack gap="sm">
        <Text>
          {t("Repertoire.Delete.Message", {
            name: repertoire.name,
            count: repertoire.stats.moves,
          })}
        </Text>
        <Text size="sm" c="dimmed">
          {repertoire.folder ? `${folderLabel(repertoire.folder)} › ` : ""}
          {repertoire.name} · {repertoire.owner} · {t("Repertoire.Delete.File", { file })}
        </Text>
        {main && (
          <Alert color="yellow" variant="light">
            {t("Repertoire.Delete.Main")}
          </Alert>
        )}
        {repertoire.shared && !repertoire.shared.ended && (
          <Alert color="blue" variant="light">
            {t("Repertoire.Share.DeleteHint", { name: repertoire.shared.from })}
          </Alert>
        )}
        <Text size="sm" c="dimmed">
          {t("Repertoire.Delete.Hint")}
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} data-autofocus>
            {t("Common.Cancel")}
          </Button>
          <Button color="red" loading={deleting} onClick={remove}>
            {t("Common.Delete")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

type NewRepertoirePreset = { owner?: string; color?: RepertoireColor; folder?: string };

function NewRepertoireModal({
  onClose,
  owners,
  folders,
  preset,
}: {
  onClose: () => void;
  owners: string[];
  folders: string[];
  preset: NewRepertoirePreset;
}) {
  const { t } = useTranslation();
  const { documentDir } = useLoaderData({ from: "/repertoires" });
  const [name, setName] = useState("");
  const mainOwner = useMainOwner();
  const [owner, setOwner] = useState(preset.owner ?? mainOwner);
  const [color, setColor] = useState<RepertoireColor>(preset.color ?? "white");
  const [folder, setFolder] = useState(preset.folder ?? "");
  const [error, setError] = useState("");

  async function submit() {
    if (!name.trim()) {
      setError(t("Common.RequireName"));
      return;
    }
    const result = await createRepertoire({
      name: name.trim(),
      // a name typed in lowercase joins the existing group instead of starting a second one
      owner:
        owners.find((o) => o.toLowerCase() === owner.trim().toLowerCase()) ??
        (owner.trim() || mainOwner),
      color,
      dir: documentDir,
      folder,
    });
    if (result.isErr) {
      setError(result.error.message);
      return;
    }
    setName("");
    setError("");
    onClose();
  }

  return (
    <Modal opened onClose={onClose} title={t("Home.Card.NewRepertoire.Title")}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Stack>
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
          <Autocomplete
            label={t("Repertoire.Owner")}
            data={owners}
            value={owner}
            onChange={setOwner}
          />
          <SegmentedControl
            fullWidth
            value={color}
            onChange={(v) => setColor(v as RepertoireColor)}
            data={[
              { label: t("Repertoire.White"), value: "white" },
              { label: t("Repertoire.Black"), value: "black" },
            ]}
          />
          <Autocomplete
            label={t("Repertoire.Folder.Label")}
            description={t("Repertoire.Folder.Hint")}
            placeholder={t("Repertoire.Folder.TopLevel")}
            data={folders}
            value={folder}
            onChange={setFolder}
          />
          <Button type="submit">{t("Common.Create")}</Button>
        </Stack>
      </form>
    </Modal>
  );
}

function MoveFolderModal({
  repertoire,
  folders,
  onClose,
}: {
  repertoire: Repertoire;
  folders: string[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [folder, setFolder] = useState(repertoire.folder);
  const [saving, setSaving] = useState(false);

  async function save(target: string) {
    setSaving(true);
    try {
      await setRepertoireFolder(repertoire.file, target);
      onClose();
    } catch (e) {
      notifications.show({
        color: "red",
        title: repertoire.name,
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      opened
      onClose={onClose}
      title={t("Repertoire.Folder.MoveTitle", { name: repertoire.name })}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save(folder);
        }}
      >
        <Stack>
          <Autocomplete
            label={t("Repertoire.Folder.Label")}
            description={t("Repertoire.Folder.Hint")}
            placeholder={t("Repertoire.Folder.TopLevel")}
            data={folders}
            value={folder}
            onChange={setFolder}
            data-autofocus
          />
          <Group justify="space-between">
            <Button variant="default" disabled={!repertoire.folder} onClick={() => save("")}>
              {t("Repertoire.Folder.ToTop")}
            </Button>
            <Button type="submit" loading={saving}>
              {t("Repertoire.Folder.MoveButton")}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

type MainInfo = { path: string; missing: number; onSync: () => Promise<void> };

type FolderActions = {
  main?: MainInfo;
  owner: string;
  color: RepertoireColor;
  onView: (view: RepertoireView) => void;
  onNew: (preset: NewRepertoirePreset) => void;
  onMove: (repertoire: Repertoire) => void;
  onEditFolder: (edit: FolderEdit) => void;
  onDeleteFolder: (path: string) => void;
  // All lines of a folder into one repertoire (also by dragging the folder onto it)
  onMergeFolder: (request: FolderMergeRequest) => void;
};

function FolderButtons({
  folder,
  count,
  actions,
  compact,
}: {
  folder: string;
  count: number;
  actions: FolderActions;
  // Icons only, for the folder rows
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const { owner, color, onView, onNew, onEditFolder } = actions;
  return (
    <Group gap={4} wrap="nowrap">
      {count > 1 && compact && (
        <>
          <Tooltip label={t("Repertoire.Folder.Tree")}>
            <ActionIcon
              size="sm"
              variant="subtle"
              aria-label={t("Repertoire.Folder.Tree")}
              onClick={() => onView({ mode: "tree", owner, color, folder })}
            >
              <IconBinaryTree size="0.9rem" />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={t("Repertoire.Folder.Compare")}>
            <ActionIcon
              size="sm"
              variant="subtle"
              aria-label={t("Repertoire.Folder.Compare")}
              onClick={() => onView({ mode: "compare", owner, color, folder })}
            >
              <IconGitCompare size="0.9rem" />
            </ActionIcon>
          </Tooltip>
        </>
      )}
      {count > 1 && !compact && (
        <>
          <Button
            size="compact-xs"
            variant="subtle"
            leftSection={<IconBinaryTree size="0.9rem" />}
            onClick={() => onView({ mode: "tree", owner, color, folder })}
          >
            {t("Repertoire.Folder.Tree")}
          </Button>
          <Button
            size="compact-xs"
            variant="subtle"
            leftSection={<IconGitCompare size="0.9rem" />}
            onClick={() => onView({ mode: "compare", owner, color, folder })}
          >
            {t("Repertoire.Folder.Compare")}
          </Button>
        </>
      )}
      <Tooltip label={t("Repertoire.Folder.NewFolder")}>
        <ActionIcon
          size="sm"
          variant="subtle"
          color="yellow"
          onClick={() => onEditFolder({ mode: "new", owner, color, parent: folder })}
        >
          <IconFolderPlus size="0.95rem" />
        </ActionIcon>
      </Tooltip>
      <Tooltip label={t("Repertoire.Folder.NewHere")}>
        <ActionIcon size="sm" variant="subtle" onClick={() => onNew({ owner, color, folder })}>
          <IconPlus size="0.9rem" />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}

function FolderContents({
  node,
  actions,
  withFolders = true,
}: {
  node: FolderNode<Repertoire>;
  actions: FolderActions;
  // false: only the repertoires directly in it, its folders are shown elsewhere
  withFolders?: boolean;
}) {
  return (
    <Stack gap="xs">
      {node.items.length > 0 && (
        <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
          {node.items.map((r) => (
            <RepertoireCard
              key={r.file.path}
              repertoire={r}
              onShowTree={() => actions.onView({ mode: "tree", path: r.file.path })}
              onCompare={() => actions.onView({ mode: "compare", path: r.file.path })}
              onCheck={() => actions.onView({ mode: "check", path: r.file.path })}
              onMove={() => actions.onMove(r)}
              main={actions.main?.path === r.file.path ? actions.main : undefined}
            />
          ))}
        </SimpleGrid>
      )}
      {withFolders &&
        node.children.map((child) => (
          <FolderSection key={child.path} node={child} actions={actions} />
        ))}
    </Stack>
  );
}

// All folders of a player and color behind one closed header, so the page shows the main
// repertoires first and the courses only on request
function FolderArea({ node, actions }: { node: FolderNode<Repertoire>; actions: FolderActions }) {
  const { t } = useTranslation();
  const [open, toggle] = useOpen(`${actions.owner}|${actions.color}|*folders`);
  const inside = node.children.reduce((sum, child) => sum + folderItems(child).length, 0);
  return (
    <Stack gap="xs">
      <Group
        gap={6}
        wrap="nowrap"
        className={classes.toggle}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle();
          }
        }}
      >
        {open ? <IconChevronDown size="1rem" /> : <IconChevronRight size="1rem" />}
        <IconFolders size="1.1rem" color="var(--mantine-color-yellow-6)" />
        <Text fw={600} size="sm">
          {t("Repertoire.Folder.Area", { count: node.children.length })}
        </Text>
        <Text size="sm" c="dimmed">
          {t("Repertoire.Folder.AreaInside", { count: inside })}
        </Text>
      </Group>
      {open && (
        <Stack gap="xs" pl="md">
          {node.children.map((child) => (
            <FolderSection key={child.path} node={child} actions={actions} />
          ))}
        </Stack>
      )}
    </Stack>
  );
}

function FolderSection({
  node,
  actions,
}: {
  node: FolderNode<Repertoire>;
  actions: FolderActions;
}) {
  const { t } = useTranslation();
  // Folders start closed and open or close with one click on their header
  const [open, toggle] = useOpen(`${actions.owner}|${actions.color}|${node.path}`);
  const count = folderItems(node).length;
  const pretty = prettyFolderName(node.name);
  const folderDrag = useFolderDrag();
  const source = { owner: actions.owner, color: actions.color, path: node.path };
  const dragged =
    folderDrag?.drag?.source.path === node.path &&
    folderDrag.drag.source.owner === actions.owner &&
    folderDrag.drag.source.color === actions.color;
  return (
    <Paper withBorder p="xs" radius="md" style={dragged ? { opacity: 0.5 } : undefined}>
      <Group justify="space-between" wrap="nowrap" className={classes.folderRow}>
        <Group
          gap={6}
          wrap="nowrap"
          className={classes.toggle}
          style={{ flex: 1, minWidth: 0 }}
          onClick={toggle}
          onPointerDown={(e) => folderDrag?.begin(e, source)}
        >
          {open ? (
            <IconChevronDown size="1rem" style={{ flexShrink: 0 }} />
          ) : (
            <IconChevronRight size="1rem" style={{ flexShrink: 0 }} />
          )}
          <IconFolder
            size="1.1rem"
            color="var(--mantine-color-yellow-6)"
            style={{ flexShrink: 0 }}
          />
          {/* Imported course folders show a readable name and their source as a badge;
              long names are cut, the full name shows on hover */}
          <Tooltip
            label={pretty.label === node.name ? node.name : `${pretty.label}\n(${node.name})`}
            openDelay={400}
            multiline
            maw={480}
            style={{ whiteSpace: "pre-line" }}
          >
            <Text fw={600} truncate="end" style={{ minWidth: 0 }}>
              {pretty.label}
            </Text>
          </Tooltip>
          {pretty.source && (
            <Badge size="xs" variant="outline" color="orange" style={{ flexShrink: 0 }}>
              {pretty.source}
            </Badge>
          )}
          <Badge size="sm" variant="light" color="gray" style={{ flexShrink: 0 }}>
            {count}
          </Badge>
        </Group>
        <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }} className={classes.folderActions}>
          <FolderButtons folder={node.path} count={count} actions={actions} compact />
          {count > 0 && (
            <Tooltip label={t("Repertoire.FolderMerge.Action")}>
              <ActionIcon
                size="sm"
                variant="subtle"
                aria-label={t("Repertoire.FolderMerge.Action")}
                onClick={() => actions.onMergeFolder({ source })}
              >
                <IconArrowMerge size="0.9rem" />
              </ActionIcon>
            </Tooltip>
          )}
          <Tooltip label={t("Repertoire.Folder.Rename")}>
            <ActionIcon
              size="sm"
              variant="subtle"
              color="gray"
              aria-label={t("Repertoire.Folder.Rename")}
              onClick={() =>
                actions.onEditFolder({
                  mode: "rename",
                  owner: actions.owner,
                  color: actions.color,
                  path: node.path,
                })
              }
            >
              <IconPencil size="0.9rem" />
            </ActionIcon>
          </Tooltip>
          {count === 0 && node.children.length === 0 && (
            <Tooltip label={t("Repertoire.Folder.Delete")}>
              <ActionIcon
                size="sm"
                variant="subtle"
                color="red"
                onClick={() => actions.onDeleteFolder(node.path)}
              >
                <IconTrash size="0.9rem" />
              </ActionIcon>
            </Tooltip>
          )}
        </Group>
      </Group>
      {open && (
        <Box mt="xs" pl="md">
          <FolderContents node={node} actions={actions} />
        </Box>
      )}
    </Paper>
  );
}

function ColorGroup({
  list,
  emptyFolders,
  actions,
}: {
  list: Repertoire[];
  emptyFolders: string[];
  actions: FolderActions;
}) {
  const colorName = useColorName();
  const { t } = useTranslation();
  const { documentDir } = useLoaderData({ from: "/repertoires" });
  const tree = useMemo(() => buildFolderTree(list, emptyFolders), [list, emptyFolders]);
  const { owner, color } = actions;
  const mainOwner = useMainOwner();
  // The main repertoire ("Ich Weiß") and how many moves of the others it is missing
  const main = useMemo(() => {
    const aliases = owner.toLowerCase() === mainOwner.toLowerCase() ? [DEFAULT_MAIN_OWNER] : [];
    const found = findMainRepertoire(list, owner, color, aliases);
    if (!found) return undefined;
    // Counted on a copy that takes them in one by one, so moves the others share count once
    const others = list.filter((r) => r !== found);
    if (others.every((r) => missingMoves(found.root, r.root) === 0)) {
      return { path: found.file.path, missing: 0 };
    }
    const copy = structuredClone(found.root);
    const missing = others.reduce((sum, r) => sum + (mergeTree(copy, r.root) ?? 0), 0);
    return { path: found.file.path, missing };
  }, [list, owner, color, mainOwner]);
  const groupActions: FolderActions = main
    ? {
        ...actions,
        main: {
          ...main,
          onSync: async () => {
            try {
              const result = await syncMainRepertoire(
                documentDir,
                owner,
                color,
                t("Repertoire.Main.SyncSource"),
              );
              if (result) {
                notifications.show({
                  color: "green",
                  title: result.main.name,
                  message: t("Repertoire.Main.Synced", { count: result.added }),
                });
              }
            } catch (e) {
              notifications.show({
                color: "red",
                title: t("Repertoire.Main.Badge"),
                message: e instanceof Error ? e.message : String(e),
              });
            }
          },
        },
      }
    : actions;
  return (
    <Stack gap="xs">
      <Group justify="space-between" wrap="nowrap">
        <Group gap={6}>
          <ColorDot color={actions.color} />
          <Text fw={600}>{colorName(actions.color)}</Text>
          <Badge size="sm" variant="light" color="gray">
            {list.length}
          </Badge>
        </Group>
        <FolderButtons folder="" count={list.length} actions={groupActions} />
      </Group>
      <FolderContents node={tree} actions={groupActions} withFolders={false} />
      {tree.children.length > 0 && <FolderArea node={tree} actions={groupActions} />}
    </Stack>
  );
}

export default function RepertoiresPage() {
  const { t } = useTranslation();
  const colorName = useColorName();
  const { documentDir } = useLoaderData({ from: "/repertoires" });
  const { data: repertoires, isLoading } = useRepertoires(documentDir);
  const mainOwner = useMainOwner();
  const [creating, setCreating] = useState<NewRepertoirePreset | null>(null);
  const [moving, setMoving] = useState<Repertoire | null>(null);
  const [importing, setImporting] = useState(false);
  const [importingFolder, setImportingFolder] = useState(false);
  const [editingFolder, setEditingFolder] = useState<FolderEdit | null>(null);
  const [mergingFolder, setMergingFolder] = useState<FolderMergeRequest | null>(null);
  const { data: storedFolders } = useStoredFolders(documentDir);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useAtom(repertoireViewAtom);
  useFirstTimeTutorial(FIRST_TIME_TUTORIAL, !isLoading && !view);
  // A player card asks for its player's repertoire, matched by name like the owner field
  const viewOwner = view?.owner ? repertoireOwner(view.owner, mainOwner) : mainOwner;
  // A single repertoire, or everything of a player and color (optionally one folder) as one
  const viewRepertoire = useMemo(() => {
    if (!view) return undefined;
    const list = repertoires ?? [];
    if (view.path) return list.find((r) => r.file.path === view.path);
    // Repertoires shared with this account belong to someone else: not part of the player's tree
    const parts = list.filter(
      (r) =>
        !r.shared &&
        r.owner.toLowerCase() === viewOwner.toLowerCase() &&
        r.color === view.color &&
        inFolder(r.folder, view.folder ?? ""),
    );
    const color = view.color === "black" ? t("Repertoire.Black") : t("Repertoire.White");
    const folder = normalizeFolder(view.folder);
    return (
      combineRepertoires(
        parts,
        folder ? `${color} · ${folderLabel(folder)}` : `${viewOwner} ${color}`,
      ) ?? undefined
    );
  }, [view, repertoires, viewOwner, t]);
  const folders = useMemo(
    () =>
      allFolders([
        ...(repertoires ?? []),
        ...(storedFolders ?? []).map((f) => ({ folder: f.path })),
      ]),
    [repertoires, storedFolders],
  );

  // Folders made in the app count for their player too, also before anything is in them
  const byOwner = useMemo(() => {
    const groups = new Map<string, Repertoire[]>();
    for (const r of repertoires ?? []) {
      groups.set(r.owner, [...(groups.get(r.owner) ?? []), r]);
    }
    for (const f of storedFolders ?? []) {
      const owner = repertoireOwner(f.owner, mainOwner);
      const known = [...groups.keys()].find((o) => o.toLowerCase() === owner.toLowerCase());
      if (!known) groups.set(owner, []);
    }
    return groups;
  }, [repertoires, storedFolders, mainOwner]);
  const emptyFoldersOf = (owner: string, color: RepertoireColor) =>
    (storedFolders ?? [])
      .filter(
        (f) =>
          repertoireOwner(f.owner, mainOwner).toLowerCase() === owner.toLowerCase() &&
          f.color === color,
      )
      .map((f) => f.path);

  const defaults = defaultRepertoires(mainOwner);
  const missing = defaults.filter(
    (d) => !(repertoires ?? []).some((r) => r.owner === d.owner && r.color === d.color),
  );
  const owners = [...new Set([...defaults.map((d) => d.owner), ...byOwner.keys()])];

  async function createDefaults() {
    setBusy(true);
    for (const d of missing) {
      const result = await createRepertoire({
        name: `${d.owner} ${colorName(d.color)}`,
        owner: d.owner,
        color: d.color,
        dir: documentDir,
        main: true,
      });
      if (result.isErr) {
        notifications.show({ color: "red", title: d.owner, message: result.error.message });
      }
    }
    setBusy(false);
  }

  if (view && viewRepertoire) {
    const viewKey = `${viewRepertoire.file.path} ${view.folder ?? ""} ${viewRepertoire.parts?.length ?? 0}`;
    return (
      <Box p="md" h="100%">
        {view.mode === "check" ? (
          <RepertoireCheckView
            key={viewKey}
            repertoire={viewRepertoire}
            onBack={() => setView(null)}
          />
        ) : view.mode === "compare" ? (
          <RepertoireCompareView
            key={viewKey}
            repertoire={viewRepertoire}
            onBack={() => setView(null)}
          />
        ) : (
          <RepertoireTreeView
            key={viewKey}
            repertoire={viewRepertoire}
            onBack={() => setView(null)}
          />
        )}
      </Box>
    );
  }

  return (
    <FolderDragProvider repertoires={repertoires ?? []} onDrop={setMergingFolder}>
      <ScrollArea h="100%">
        {mergingFolder && (
          <FolderMergeModal
            request={mergingFolder}
            repertoires={repertoires ?? []}
            documentDir={documentDir}
            onClose={() => setMergingFolder(null)}
          />
        )}
        {creating && (
          <NewRepertoireModal
            onClose={() => setCreating(null)}
            owners={owners}
            folders={folders}
            preset={creating}
          />
        )}
        {moving && (
          <MoveFolderModal repertoire={moving} folders={folders} onClose={() => setMoving(null)} />
        )}
        {editingFolder && (
          <FolderNameModal
            edit={editingFolder}
            documentDir={documentDir}
            repertoires={repertoires ?? []}
            onClose={() => setEditingFolder(null)}
          />
        )}
        {importingFolder && (
          <ImportFolderModal
            documentDir={documentDir}
            owners={owners}
            folders={folders}
            onClose={() => setImportingFolder(false)}
          />
        )}
        {importing && (
          <ImportCourseModal
            opened
            onClose={() => setImporting(false)}
            repertoires={repertoires ?? []}
          />
        )}
        <Stack p="md" gap="lg" maw={1100}>
          <Group justify="space-between">
            <Group gap="sm">
              <IconBooks size="1.75rem" />
              <Title order={2}>{t("Repertoire.Page.Title")}</Title>
            </Group>
            <Group>
              {!isLoading && missing.length > 0 && (
                <Button
                  variant="default"
                  data-tour="rep-defaults"
                  loading={busy}
                  onClick={createDefaults}
                >
                  {t("Repertoire.Page.CreateDefaults", {
                    names: missing.map((d) => `${d.owner} ${colorName(d.color)}`).join(", "),
                  })}
                </Button>
              )}
              <Menu position="bottom-end" shadow="md">
                <Menu.Target>
                  <Button
                    variant="default"
                    leftSection={<IconFileImport size="1rem" />}
                    rightSection={<IconChevronDown size="0.9rem" />}
                  >
                    {t("Repertoire.Page.Import")}
                  </Button>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item
                    leftSection={<IconFileImport size="1rem" />}
                    disabled={!repertoires?.length}
                    onClick={() => setImporting(true)}
                  >
                    {t("Repertoire.Course.Button")}
                  </Menu.Item>
                  <Menu.Item
                    leftSection={<IconFolderDown size="1rem" />}
                    onClick={() => setImportingFolder(true)}
                  >
                    {t("Repertoire.FolderImport.Button")}
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
              <Button
                data-tour="rep-new"
                leftSection={<IconPlus size="1rem" />}
                onClick={() => setCreating({})}
              >
                {t("Repertoire.Page.New")}
              </Button>
            </Group>
          </Group>
          <Text c="dimmed" size="sm">
            {t("Repertoire.Page.Help")}
          </Text>
          <SharedWithMe />
          {view && !viewRepertoire && !isLoading && (
            <Alert color="blue" withCloseButton onClose={() => setView(null)}>
              {t("Repertoire.Compare.NoRepertoire", {
                name: `${viewOwner} ${colorName(view.color ?? "white")}`,
              })}
            </Alert>
          )}
          {[...byOwner.entries()].map(([owner, list]) => (
            <Stack key={owner} gap="sm">
              <Title order={4}>{owner}</Title>
              {(["white", "black"] as const)
                .map((color) => ({
                  color,
                  items: list.filter((r) => r.color === color),
                  empty: emptyFoldersOf(owner, color),
                }))
                .filter((g) => g.items.length > 0 || g.empty.length > 0)
                .map((g) => (
                  <ColorGroup
                    key={g.color}
                    list={g.items}
                    emptyFolders={g.empty}
                    actions={{
                      owner,
                      color: g.color,
                      onView: setView,
                      onNew: setCreating,
                      onMove: setMoving,
                      onEditFolder: setEditingFolder,
                      onMergeFolder: setMergingFolder,
                      onDeleteFolder: (path) =>
                        deleteFolder(documentDir, owner, g.color, path).catch((e) =>
                          notifications.show({ color: "red", title: path, message: String(e) }),
                        ),
                    }}
                  />
                ))}
            </Stack>
          ))}
          <RepertoireTrash documentDir={documentDir} repertoires={repertoires ?? []} />
        </Stack>
      </ScrollArea>
    </FolderDragProvider>
  );
}
