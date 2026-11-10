import {
  Badge,
  Box,
  Button,
  Card,
  Group,
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { useAtom, useSetAtom, useStore } from "jotai";
import { useCallback, useEffect, useState } from "react";
import {
  activeTabAtom,
  deckAtomFamily,
  type RecentFile,
  recentFilesAtom,
  recentPathKey,
  removeRecentFilesAtom,
  tabsAtom,
} from "@/state/atoms";
import type { Tab } from "@/utils/tabs";
import { openFile, readInfoFile } from "@/utils/files";
import { isInTempDir } from "@/utils/tabs";
import { unwrap } from "@/utils/unwrap";
import { notifications } from "@mantine/notifications";
import CreateRepertoireModal from "./CreateRepertoireModal";
import ImportModal from "./ImportModal";
import classes from "./NewTabHome.module.css";
import {
  IconChess,
  IconClock,
  IconFileImport,
  IconPuzzle,
  IconTarget,
  IconTargetArrow,
} from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { useTranslation } from "react-i18next";
import { commands } from "@/bindings";
import { getStats } from "@/components/files/opening";
import Chessboard from "../icons/Chessboard";
import { FileIcon } from "@/components/files/FileIcon";

dayjs.extend(relativeTime);

function RecentFileDuePositions({ file }: { file: string }) {
  const { t } = useTranslation();
  const [deck] = useAtom(
    deckAtomFamily({
      file,
      game: 0,
    }),
  );

  const stats = getStats(deck.positions);

  if (stats.due + stats.unseen === 0) return null;

  return (
    <Badge size="sm" variant="light" color="orange" leftSection={<IconTarget size="0.75rem" />}>
      {stats.due + stats.unseen} {t("Board.Practice.Due")}
    </Badge>
  );
}

function RecentFileRow({ file, onOpen }: { file: RecentFile; onOpen: (file: RecentFile) => void }) {
  const displayName = file.name.replace(/\.pgn$/i, "");

  return (
    <UnstyledButton
      onClick={() => onOpen(file)}
      px="sm"
      py={6}
      style={{
        borderRadius: "var(--mantine-radius-sm)",
      }}
      className={classes.recentFileRow}
    >
      <Group justify="space-between" wrap="nowrap">
        <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
          <Box style={{ flexShrink: 0, color: "var(--mantine-color-dimmed)" }}>
            <FileIcon type={file.type} size={20} />
          </Box>
          <Text size="sm" truncate fw={500}>
            {displayName}
          </Text>
          {file.type === "repertoire" && <RecentFileDuePositions file={file.path} />}
        </Group>
        <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
          <Tooltip label={dayjs(file.lastOpened).format("YYYY-MM-DD HH:mm")}>
            <Group gap={4} wrap="nowrap">
              <IconClock size={14} style={{ color: "var(--mantine-color-dimmed)" }} />
              <Text size="xs" c="dimmed">
                {dayjs(file.lastOpened).fromNow()}
              </Text>
            </Group>
          </Tooltip>
        </Group>
      </Group>
    </UnstyledButton>
  );
}

export default function NewTabHome({ id }: { id: string }) {
  const { t } = useTranslation();

  const [openModal, setOpenModal] = useState(false);
  const [openRepertoireModal, setOpenRepertoireModal] = useState(false);
  const [, setTabs] = useAtom(tabsAtom);
  const setActiveTab = useSetAtom(activeTabAtom);

  const [recentFiles, setRecentFiles] = useAtom(recentFilesAtom);
  const store = useStore();
  const navigate = useNavigate();

  // Clean the list once when the home tab opens: drop files that are gone,
  // imported temp files and rows that point at the same file twice.
  useEffect(() => {
    const checkFiles = async () => {
      const results = await Promise.all(
        store.get(recentFilesAtom).map(async (file) => {
          const exists = await commands.fileExists(file.path);
          const keep = exists.status === "ok" && exists.data && !(await isInTempDir(file.path));
          return keep ? null : recentPathKey(file.path);
        }),
      );
      const drop = new Set(results.filter((k): k is string => k !== null));
      // Work on the current list: a file opened meanwhile must not be lost.
      setRecentFiles((current) => {
        const seen = new Set<string>();
        const next = current.filter((f) => {
          const key = recentPathKey(f.path);
          if (drop.has(key) || seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        return next.length === current.length ? current : next;
      });
    };
    checkFiles();
  }, [store, setRecentFiles]);

  const openRecentFile = useCallback(
    async (file: RecentFile) => {
      try {
        const exists = await commands.fileExists(file.path);
        if (exists.status === "error" || !exists.data) {
          store.set(removeRecentFilesAtom, file.path);
          notifications.show({
            color: "orange",
            title: file.name.replace(/\.pgn$/i, ""),
            message: t("Home.RecentFiles.Missing"),
          });
          return;
        }
        // Read the real .info, so a repertoire keeps its colour, owner and id.
        const info = await readInfoFile(file.path);
        const numGames = unwrap(await commands.countPgnGames(file.path));
        await openFile(
          {
            type: "file",
            name: file.name.replace(/\.pgn$/i, ""),
            path: file.path,
            numGames,
            metadata: info ?? { type: file.type, tags: [] },
            lastModified: Date.now(),
          },
          setTabs,
          setActiveTab,
        );
        navigate({ to: "/" });
      } catch (e) {
        notifications.show({
          color: "red",
          title: t("Home.RecentFiles.OpenFailed"),
          message: e instanceof Error ? e.message : String(e),
        });
      }
    },
    [setTabs, setActiveTab, store, navigate, t],
  );

  const cards = [
    {
      icon: <IconChess size={60} />,
      title: t("Home.Card.PlayChess.Title"),
      description: t("Home.Card.PlayChess.Desc"),
      label: t("Home.Card.PlayChess.Button"),
      onClick: () => {
        setTabs((prev: Tab[]) => {
          const tab = prev.find((t) => t.value === id);
          if (!tab) return prev;
          tab.name = t("Home.NewGame");
          tab.type = "play";
          return [...prev];
        });
      },
    },
    {
      icon: <Chessboard size={60} />,
      title: t("Home.Card.AnalysisBoard.Title"),
      description: t("Home.Card.AnalysisBoard.Desc"),
      label: t("Home.Card.AnalysisBoard.Button"),
      onClick: () => {
        setTabs((prev: Tab[]) => {
          const tab = prev.find((t) => t.value === id);
          if (!tab) return prev;
          tab.name = t("Home.Card.AnalysisBoard.Title");
          tab.type = "analysis";
          return [...prev];
        });
      },
    },
    {
      icon: <IconTargetArrow size={60} />,
      title: t("Home.Card.NewRepertoire.Title"),
      description: t("Home.Card.NewRepertoire.Desc"),
      label: t("Home.Card.NewRepertoire.Button"),
      onClick: () => {
        setOpenRepertoireModal(true);
      },
    },
    {
      icon: <IconFileImport size={60} />,
      title: t("Home.Card.ImportGame.Title"),
      description: t("Home.Card.ImportGame.Desc"),
      label: t("Home.Card.ImportGame.Button"),
      onClick: () => {
        setOpenModal(true);
      },
    },
    {
      icon: <IconPuzzle size={60} />,
      title: t("Home.Card.Puzzle.Title"),
      description: t("Home.Card.Puzzle.Desc"),
      label: t("Home.Card.Puzzle.Button"),
      onClick: () => {
        setTabs((prev) => {
          const tab = prev.find((t) => t.value === id);
          if (!tab) return prev;
          tab.name = t("Home.PuzzleTraining");
          tab.type = "puzzles";
          return [...prev];
        });
      },
    },
  ];

  return (
    <>
      <ImportModal
        openModal={openModal}
        setOpenModal={setOpenModal}
        setTabs={setTabs}
        setActiveTab={setActiveTab}
      />
      <CreateRepertoireModal opened={openRepertoireModal} setOpened={setOpenRepertoireModal} />
      <Stack gap="lg" pt="sm">
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 5 }}>
          {cards.map((card) => (
            <Card shadow="sm" p="lg" radius="md" withBorder key={card.title}>
              <Stack align="center" h="100%" justify="space-between">
                {card.icon}

                <Box style={{ textAlign: "center" }}>
                  <Text fw={500}>{card.title}</Text>
                  <Text size="sm" c="dimmed">
                    {card.description}
                  </Text>
                </Box>

                <Button variant="light" fullWidth mt="md" radius="md" onClick={card.onClick}>
                  {card.label}
                </Button>
              </Stack>
            </Card>
          ))}
        </SimpleGrid>

        <Card shadow="sm" p="md" radius="md" withBorder>
          <Text fw={600} size="lg" mb="xs">
            {t("Home.RecentFiles.Title")}
          </Text>
          {recentFiles.length === 0 ? (
            <Stack align="center" justify="center" h={200} gap="xs">
              <IconClock size={48} style={{ opacity: 0.3 }} />
              <Text c="dimmed">{t("Home.RecentFiles.NoRecentFiles")}</Text>
            </Stack>
          ) : (
            <ScrollArea.Autosize mah={300}>
              <Stack gap={2}>
                {recentFiles.map((file) => (
                  <RecentFileRow key={file.path} file={file} onOpen={openRecentFile} />
                ))}
              </Stack>
            </ScrollArea.Autosize>
          )}
        </Card>
      </Stack>
    </>
  );
}
