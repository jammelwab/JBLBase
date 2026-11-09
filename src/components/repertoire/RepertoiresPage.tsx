import {
  ActionIcon,
  Alert,
  Autocomplete,
  Badge,
  Box,
  Button,
  Card,
  Group,
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
  IconBinaryTree,
  IconBooks,
  IconChevronDown,
  IconChevronRight,
  IconFileImport,
  IconFolder,
  IconFolderShare,
  IconGitCompare,
  IconPlus,
} from "@tabler/icons-react";
import { useLoaderData, useNavigate } from "@tanstack/react-router";
import { useAtom, useSetAtom } from "jotai";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { activeTabAtom, tabsAtom } from "@/state/atoms";
import { openFile } from "@/utils/files";
import {
  allFolders,
  buildFolderTree,
  type FolderNode,
  folderItems,
  inFolder,
  normalizeFolder,
} from "@/utils/repertoireFolders";
import {
  combineRepertoires,
  createRepertoire,
  defaultRepertoires,
  type Repertoire,
  type RepertoireColor,
  type RepertoireView,
  repertoireOwner,
  repertoireViewAtom,
  setRepertoireFolder,
  useMainOwner,
  useRepertoires,
} from "@/utils/repertoires";
import ImportCourseModal from "./ImportCourseModal";
import RepertoireCompareView from "./RepertoireCompareView";
import { ColorDot } from "./RepertoireLabel";
import RepertoireTreeView from "./RepertoireTreeView";

function useColorName() {
  const { t } = useTranslation();
  return (color: RepertoireColor) =>
    color === "white" ? t("Repertoire.White") : t("Repertoire.Black");
}

function RepertoireCard({
  repertoire,
  onShowTree,
  onCompare,
  onMove,
}: {
  repertoire: Repertoire;
  onShowTree: () => void;
  onCompare: () => void;
  onMove: () => void;
}) {
  const { t } = useTranslation();
  const colorName = useColorName();
  const setTabs = useSetAtom(tabsAtom);
  const setActiveTab = useSetAtom(activeTabAtom);
  const navigate = useNavigate();
  const { stats } = repertoire;

  return (
    <Card withBorder padding="md">
      <Stack gap="xs">
        <Group gap="xs" wrap="nowrap">
          <ColorDot color={repertoire.color} />
          <Text fw={600} truncate style={{ flex: 1 }}>
            {repertoire.name}
          </Text>
          <Tooltip label={t("Repertoire.Folder.Move")}>
            <ActionIcon variant="subtle" color="gray" size="sm" onClick={onMove}>
              <IconFolderShare size="1rem" />
            </ActionIcon>
          </Tooltip>
        </Group>
        <Text size="sm" c="dimmed">
          {colorName(repertoire.color)}
        </Text>
        <Group gap="lg">
          <Stack gap={0}>
            <Text fw={600}>{stats.moves}</Text>
            <Text size="xs" c="dimmed">
              {t("Repertoire.Stats.Moves")}
            </Text>
          </Stack>
          <Stack gap={0}>
            <Text fw={600}>{stats.leaves}</Text>
            <Text size="xs" c="dimmed">
              {t("Repertoire.Stats.Lines")}
            </Text>
          </Stack>
          <Stack gap={0}>
            <Text fw={600}>{Math.ceil(stats.depth / 2)}</Text>
            <Text size="xs" c="dimmed">
              {t("Repertoire.Stats.Depth")}
            </Text>
          </Stack>
        </Group>
        <Group grow gap="xs">
          <Button variant="light" leftSection={<IconBinaryTree size="1rem" />} onClick={onShowTree}>
            {t("Repertoire.Tree.Button")}
          </Button>
          <Button
            variant="default"
            onClick={async () => {
              await openFile(repertoire.file, setTabs, setActiveTab);
              navigate({ to: "/" });
            }}
          >
            {t("Common.Open")}
          </Button>
        </Group>
        <Button
          variant="subtle"
          size="xs"
          leftSection={<IconGitCompare size="1rem" />}
          onClick={onCompare}
        >
          {t("Repertoire.Compare.Button")}
        </Button>
      </Stack>
    </Card>
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

type FolderActions = {
  owner: string;
  color: RepertoireColor;
  onView: (view: RepertoireView) => void;
  onNew: (preset: NewRepertoirePreset) => void;
  onMove: (repertoire: Repertoire) => void;
};

function FolderButtons({
  folder,
  count,
  actions,
}: {
  folder: string;
  count: number;
  actions: FolderActions;
}) {
  const { t } = useTranslation();
  const { owner, color, onView, onNew } = actions;
  return (
    <Group gap={4} wrap="nowrap">
      {count > 1 && (
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
}: {
  node: FolderNode<Repertoire>;
  actions: FolderActions;
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
              onMove={() => actions.onMove(r)}
            />
          ))}
        </SimpleGrid>
      )}
      {node.children.map((child) => (
        <FolderSection key={child.path} node={child} actions={actions} />
      ))}
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
  const [open, setOpen] = useState(true);
  const count = folderItems(node).length;
  return (
    <Paper withBorder p="xs" radius="md">
      <Group justify="space-between" wrap="nowrap">
        <Group
          gap={6}
          wrap="nowrap"
          style={{ cursor: "pointer" }}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <IconChevronDown size="1rem" /> : <IconChevronRight size="1rem" />}
          <IconFolder size="1.1rem" color="var(--mantine-color-yellow-6)" />
          <Text fw={600}>{node.name}</Text>
          <Badge size="sm" variant="light" color="gray">
            {count}
          </Badge>
        </Group>
        <FolderButtons folder={node.path} count={count} actions={actions} />
      </Group>
      {open && (
        <Box mt="xs" pl="md">
          <FolderContents node={node} actions={actions} />
        </Box>
      )}
    </Paper>
  );
}

function ColorGroup({ list, actions }: { list: Repertoire[]; actions: FolderActions }) {
  const colorName = useColorName();
  const tree = useMemo(() => buildFolderTree(list), [list]);
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
        <FolderButtons folder="" count={list.length} actions={actions} />
      </Group>
      <FolderContents node={tree} actions={actions} />
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
  const [busy, setBusy] = useState(false);
  const [view, setView] = useAtom(repertoireViewAtom);
  // A player card asks for its player's repertoire, matched by name like the owner field
  const viewOwner = view?.owner ? repertoireOwner(view.owner, mainOwner) : mainOwner;
  // A single repertoire, or everything of a player and color (optionally one folder) as one
  const viewRepertoire = useMemo(() => {
    if (!view) return undefined;
    const list = repertoires ?? [];
    if (view.path) return list.find((r) => r.file.path === view.path);
    const parts = list.filter(
      (r) =>
        r.owner.toLowerCase() === viewOwner.toLowerCase() &&
        r.color === view.color &&
        inFolder(r.folder, view.folder ?? ""),
    );
    const color = view.color === "black" ? t("Repertoire.Black") : t("Repertoire.White");
    const folder = normalizeFolder(view.folder);
    return (
      combineRepertoires(
        parts,
        folder ? `${color} · ${folder.replaceAll("/", " › ")}` : `${viewOwner} ${color}`,
      ) ?? undefined
    );
  }, [view, repertoires, viewOwner, t]);
  const folders = useMemo(() => allFolders(repertoires ?? []), [repertoires]);

  const byOwner = useMemo(() => {
    const groups = new Map<string, Repertoire[]>();
    for (const r of repertoires ?? []) {
      groups.set(r.owner, [...(groups.get(r.owner) ?? []), r]);
    }
    return groups;
  }, [repertoires]);

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
        {view.mode === "compare" ? (
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
    <ScrollArea h="100%">
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
              <Button variant="default" loading={busy} onClick={createDefaults}>
                {t("Repertoire.Page.CreateDefaults", {
                  names: missing.map((d) => `${d.owner} ${colorName(d.color)}`).join(", "),
                })}
              </Button>
            )}
            <Button
              variant="light"
              leftSection={<IconFileImport size="1rem" />}
              disabled={!repertoires?.length}
              onClick={() => setImporting(true)}
            >
              {t("Repertoire.Course.Button")}
            </Button>
            <Button leftSection={<IconPlus size="1rem" />} onClick={() => setCreating({})}>
              {t("Repertoire.Page.New")}
            </Button>
          </Group>
        </Group>
        <Text c="dimmed" size="sm">
          {t("Repertoire.Page.Help")}
        </Text>
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
              .map((color) => ({ color, items: list.filter((r) => r.color === color) }))
              .filter((g) => g.items.length > 0)
              .map((g) => (
                <ColorGroup
                  key={g.color}
                  list={g.items}
                  actions={{
                    owner,
                    color: g.color,
                    onView: setView,
                    onNew: setCreating,
                    onMove: setMoving,
                  }}
                />
              ))}
          </Stack>
        ))}
      </Stack>
    </ScrollArea>
  );
}
