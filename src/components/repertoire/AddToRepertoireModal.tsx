import { Alert, Button, Checkbox, Group, Modal, Select, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useLoaderData, useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { useContext, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import { currentTabAtom } from "@/state/atoms";
import { nodesOnPath } from "@/utils/repertoireTree";
import { findMainRepertoire } from "@/utils/repertoireFolders";
import {
  addLineToRepertoire,
  DEFAULT_MAIN_OWNER,
  useMainOwner,
  useRepertoires,
} from "@/utils/repertoires";
import { getTabFile } from "@/utils/tabs";
import { getNodeAtPath } from "@/utils/treeReducer";

function lineText(nodes: { san: string | null; halfMoves: number }[]) {
  return nodes
    .map((n, i) => {
      const isWhite = n.halfMoves % 2 === 1;
      const number = Math.ceil(n.halfMoves / 2);
      if (isWhite) return `${number}. ${n.san}`;
      return i === 0 ? `${number}... ${n.san}` : n.san;
    })
    .join(" ");
}

export default function AddToRepertoireModal({
  opened,
  onClose,
  withVariations: initialWithVariations = false,
}: {
  opened: boolean;
  onClose: () => void;
  withVariations?: boolean;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { documentDir } = useLoaderData({ from: "/" });
  const store = useContext(TreeStateContext)!;
  const root = useStore(store, (s) => s.root);
  const position = useStore(store, (s) => s.position);
  const orientation = useStore(store, (s) => s.headers.orientation ?? "white");
  const currentTab = useAtomValue(currentTabAtom);
  const ownPath = getTabFile(currentTab)?.path;

  const { data: repertoires } = useRepertoires(documentDir);
  const mainOwner = useMainOwner();
  const targets = useMemo(
    () => (repertoires ?? []).filter((r) => r.file.path !== ownPath),
    [repertoires, ownPath],
  );

  const line = useMemo(() => nodesOnPath(root, position), [root, position]);
  // Anything besides the line itself: moves after it or side variations along it
  const hasVariations = useMemo(() => {
    let node = root;
    for (const index of position) {
      if (node.children.length > 1) return true;
      node = node.children[index] ?? node;
    }
    return getNodeAtPath(root, position).children.length > 0;
  }, [root, position]);

  const [selected, setSelected] = useState<string | null>(null);
  const [withVariations, setWithVariations] = useState(initialWithVariations);
  useEffect(() => {
    if (opened) setWithVariations(initialWithVariations);
  }, [opened, initialWithVariations]);
  const [saving, setSaving] = useState(false);

  // Suggest the repertoire for the side the board is turned to
  useEffect(() => {
    if (!opened || targets.length === 0) return;
    if (selected && targets.some((r) => r.file.path === selected)) return;
    const color = orientation === "black" ? "black" : "white";
    const preferred =
      findMainRepertoire(targets, mainOwner, color, [DEFAULT_MAIN_OWNER]) ??
      targets.find((r) => r.color === orientation) ??
      targets[0];
    setSelected(preferred.file.path);
  }, [opened, targets, orientation, selected, mainOwner]);

  // One searchable list, grouped by player and color; folders shown as a path
  const options = useMemo(() => {
    const groups = new Map<string, { value: string; label: string }[]>();
    for (const r of targets) {
      const color = r.color === "white" ? t("Repertoire.White") : t("Repertoire.Black");
      const group = r.owner === mainOwner ? color : `${r.owner} · ${color}`;
      const label = [r.folder.replaceAll("/", " › "), r.name].filter(Boolean).join(" › ");
      groups.set(group, [...(groups.get(group) ?? []), { value: r.file.path, label }]);
    }
    return [...groups].map(([group, items]) => ({ group, items }));
  }, [targets, mainOwner, t]);

  async function add() {
    const target = targets.find((r) => r.file.path === selected);
    if (!target) return;
    setSaving(true);
    try {
      const result = await addLineToRepertoire(target.file, root, position, {
        withVariations,
        label: lineText(line),
      });
      if (!result.ok) {
        notifications.show({
          color: "red",
          title: t("Repertoire.Add.Failed"),
          message: t("Repertoire.Add.DifferentStart"),
        });
        return;
      }
      notifications.show({
        color: result.added > 0 ? "green" : "gray",
        title: target.name,
        message:
          result.added > 0
            ? t("Repertoire.Add.Added", { count: result.added })
            : t("Repertoire.Add.AlreadyThere"),
      });
      onClose();
    } catch (e) {
      notifications.show({
        color: "red",
        title: t("Repertoire.Add.Failed"),
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={t(
        initialWithVariations ? "Repertoire.Add.TitleWithVariations" : "Repertoire.Add.Title",
      )}
    >
      <Stack>
        {line.length === 0 && !hasVariations ? (
          <Text c="dimmed">{t("Repertoire.Add.NoMoves")}</Text>
        ) : (
          <Text size="sm">
            {line.length > 0 ? lineText(line) : t("Repertoire.Add.StartPosition")}
          </Text>
        )}

        {targets.length === 0 ? (
          <Alert color="blue">
            <Stack gap="xs">
              <Text size="sm">{t("Repertoire.Add.NoRepertoires")}</Text>
              <Group>
                <Button
                  size="xs"
                  onClick={() => {
                    onClose();
                    navigate({ to: "/repertoires" });
                  }}
                >
                  {t("Repertoire.Page.Open")}
                </Button>
              </Group>
            </Stack>
          </Alert>
        ) : (
          <Select
            label={t("Repertoire.Add.Target")}
            data={options}
            value={selected}
            onChange={setSelected}
            searchable
            allowDeselect={false}
            maxDropdownHeight={320}
            comboboxProps={{ withinPortal: true }}
          />
        )}

        {hasVariations && (
          <Checkbox
            checked={withVariations}
            onChange={(e) => setWithVariations(e.currentTarget.checked)}
            label={t("Repertoire.Add.WithVariations")}
          />
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("Common.Cancel")}
          </Button>
          <Button
            onClick={add}
            loading={saving}
            disabled={!selected || (line.length === 0 && !withVariations)}
          >
            {t("Repertoire.Add.Button")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
