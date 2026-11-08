import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  Group,
  Modal,
  ScrollArea,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconBinaryTree, IconBooks, IconGitCompare, IconPlus } from "@tabler/icons-react";
import { useLoaderData, useNavigate } from "@tanstack/react-router";
import { useAtom, useSetAtom } from "jotai";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { activeTabAtom, tabsAtom } from "@/state/atoms";
import { openFile } from "@/utils/files";
import {
  createRepertoire,
  DEFAULT_REPERTOIRES,
  MAIN_OWNER,
  type Repertoire,
  type RepertoireColor,
  repertoireViewAtom,
  useRepertoires,
} from "@/utils/repertoires";
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
}: {
  repertoire: Repertoire;
  onShowTree: () => void;
  onCompare: () => void;
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
          <Text fw={600} truncate>
            {repertoire.name}
          </Text>
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
        {repertoire.owner === MAIN_OWNER && (
          <Button
            variant="subtle"
            size="xs"
            leftSection={<IconGitCompare size="1rem" />}
            onClick={onCompare}
          >
            {t("Repertoire.Compare.Button")}
          </Button>
        )}
      </Stack>
    </Card>
  );
}

function NewRepertoireModal({
  opened,
  onClose,
  owners,
}: {
  opened: boolean;
  onClose: () => void;
  owners: string[];
}) {
  const { t } = useTranslation();
  const { documentDir } = useLoaderData({ from: "/repertoires" });
  const [name, setName] = useState("");
  const [owner, setOwner] = useState(MAIN_OWNER);
  const [color, setColor] = useState<RepertoireColor>("white");
  const [error, setError] = useState("");

  async function submit() {
    if (!name.trim()) {
      setError(t("Common.RequireName"));
      return;
    }
    const result = await createRepertoire({
      name: name.trim(),
      owner: owner.trim() || MAIN_OWNER,
      color,
      dir: documentDir,
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
    <Modal opened={opened} onClose={onClose} title={t("Home.Card.NewRepertoire.Title")}>
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
          <Button type="submit">{t("Common.Create")}</Button>
        </Stack>
      </form>
    </Modal>
  );
}

export default function RepertoiresPage() {
  const { t } = useTranslation();
  const colorName = useColorName();
  const { documentDir } = useLoaderData({ from: "/repertoires" });
  const { data: repertoires, isLoading } = useRepertoires(documentDir);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useAtom(repertoireViewAtom);
  const viewRepertoire = view
    ? (repertoires ?? []).find((r) =>
        view.path ? r.file.path === view.path : r.owner === MAIN_OWNER && r.color === view.color,
      )
    : undefined;

  const byOwner = useMemo(() => {
    const groups = new Map<string, Repertoire[]>();
    for (const r of repertoires ?? []) {
      groups.set(r.owner, [...(groups.get(r.owner) ?? []), r]);
    }
    return groups;
  }, [repertoires]);

  const missing = DEFAULT_REPERTOIRES.filter(
    (d) => !(repertoires ?? []).some((r) => r.owner === d.owner && r.color === d.color),
  );
  const owners = [...new Set([...DEFAULT_REPERTOIRES.map((d) => d.owner), ...byOwner.keys()])];

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
    return (
      <Box p="md" h="100%">
        {view.mode === "compare" ? (
          <RepertoireCompareView
            key={viewRepertoire.file.path}
            repertoire={viewRepertoire}
            onBack={() => setView(null)}
          />
        ) : (
          <RepertoireTreeView
            key={viewRepertoire.file.path}
            repertoire={viewRepertoire}
            onBack={() => setView(null)}
          />
        )}
      </Box>
    );
  }

  return (
    <ScrollArea h="100%">
      <NewRepertoireModal opened={creating} onClose={() => setCreating(false)} owners={owners} />
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
            <Button leftSection={<IconPlus size="1rem" />} onClick={() => setCreating(true)}>
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
              name: `${MAIN_OWNER} ${colorName(view.color ?? "white")}`,
            })}
          </Alert>
        )}
        {[...byOwner.entries()].map(([owner, list]) => (
          <Stack key={owner} gap="xs">
            <Title order={4}>{owner}</Title>
            <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
              {list.map((r) => (
                <RepertoireCard
                  key={r.file.path}
                  repertoire={r}
                  onShowTree={() => setView({ mode: "tree", path: r.file.path })}
                  onCompare={() => setView({ mode: "compare", path: r.file.path })}
                />
              ))}
            </SimpleGrid>
          </Stack>
        ))}
      </Stack>
    </ScrollArea>
  );
}
