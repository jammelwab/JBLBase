import {
  ActionIcon,
  Anchor,
  Badge,
  Card,
  Group,
  Progress,
  SimpleGrid,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import {
  IconArrowDownRight,
  IconArrowRight,
  IconArrowUpRight,
  IconCircleCheckFilled,
  IconDownload,
  type IconProps,
  IconRefresh,
  IconTrash,
} from "@tabler/icons-react";
import { basename } from "@tauri-apps/api/path";
import { resolve } from "@tauri-apps/api/path";
import { notifications } from "@mantine/notifications";
import { error, info } from "@tauri-apps/plugin-log";
import { useAtom } from "jotai";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { trackUsage } from "@/utils/usageStats";
import type { DatabaseInfo } from "@/bindings";
import { commands, events } from "@/bindings";
import { databaseConversionStateAtom, storedDatabasesDirAtom } from "@/state/atoms";
import { useActiveDatabaseViewStore } from "@/state/store/database";
import { refreshDatabaseCaches, registerAccountSync } from "@/utils/accountSync";
import { downloadChessCom } from "@/utils/chess.com/api";
import { getDatabases, query_games } from "@/utils/db";
import { capitalize } from "@/utils/format";
import { downloadLichess } from "@/utils/lichess/api";
import { refreshOwnGames } from "@/utils/repertoireExplorer";
import { unwrap } from "@/utils/unwrap";
import LichessLogo from "./LichessLogo";

interface AccountCardProps {
  type: "lichess" | "chesscom";
  database: DatabaseInfo | null;
  title: string;
  updatedAt: number;
  total: number;
  stats: {
    value: number;
    label: string;
    diff?: number;
  }[];
  logout: () => void;
  reload: () => void | Promise<void>;
  /** Id under which the player can start this download ("update all"). */
  syncKey: string;
  setDatabases: (databases: DatabaseInfo[]) => void;
  token?: string;
}

export function AccountCard({
  type,
  database,
  title,
  updatedAt,
  total,
  stats,
  logout,
  reload,
  setDatabases,
  token,
  syncKey,
}: AccountCardProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setActiveDatabase = useActiveDatabaseViewStore((store) => store.setDatabase);
  const setActiveDatabaseTab = useActiveDatabaseViewStore((store) => store.setActiveTab);
  const items = stats.map((stat) => {
    let color = "gray.5";
    let DiffIcon: React.FC<IconProps> = IconArrowRight;
    if (stat.diff) {
      const sign = Math.sign(stat.diff);
      if (sign === 1) {
        DiffIcon = IconArrowUpRight;
        color = "green";
      } else {
        DiffIcon = IconArrowDownRight;
        color = "red";
      }
    }
    return (
      <Group key={stat.label} justify="space-between" wrap="nowrap">
        <Text size="xs" c="dimmed" fw={700} tt="uppercase">
          {capitalize(stat.label)}
        </Text>
        <Group gap={4}>
          {stat.diff !== undefined && stat.diff !== 0 && (
            <Badge color={color} variant="light" size="xs" leftSection={<DiffIcon size="0.8rem" />}>
              {Math.abs(stat.diff)}
            </Badge>
          )}
          <Text fw={700} size="sm">
            {stat.value}
          </Text>
        </Group>
      </Group>
    );
  });
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [databaseDir] = useAtom(storedDatabasesDirAtom);
  const [, setConversionState] = useAtom(databaseConversionStateAtom);

  async function convert(filepath: string, timestamp: number | null) {
    info(`converting ${filepath} ${timestamp}`);
    const filename = title + (type === "lichess" ? " Lichess" : " Chess.com");
    // Keep adding to the existing database, even when its file name is
    // spelled differently ("Beispielkonto" vs. "beispielkonto").
    const dbPath =
      database?.file ??
      (await resolve(
        databaseDir,
        `${filepath
          .split(/(\\|\/)/g)
          .pop()
          ?.replace(".pgn", ".duckdb")}`,
      ));
    const sourceFileName = await basename(filepath);
    setConversionState((prev) => ({
      ...prev,
      inProgress: true,
      targetDatabasePath: dbPath,
      targetDatabaseTitle: filename,
      sourceFileName,
    }));
    unwrap(
      await commands.convertPgn(
        [filepath],
        dbPath,
        timestamp ? timestamp / 1000 : null,
        filename,
        null,
      ),
    );
    trackUsage("games_download", { source: type });
    events.progressEvent.emit({
      id: `${type}_${title}`,
      progress: 100,
      finished: true,
    });
  }

  useEffect(() => {
    const unlisten = events.progressEvent.listen(async (e) => {
      if (e.payload.id === `${type}_${title}`) {
        setProgress(e.payload.progress);
        if (e.payload.finished) {
          setLoading(false);
          setDatabases(await getDatabases());
        } else {
          setLoading(true);
        }
      }
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, [setDatabases]);

  const downloadedGames = database?.type === "success" ? database.game_count : 0;
  const effectiveTotal = Math.max(total, downloadedGames);
  const percentage =
    effectiveTotal === 0 ? "0.00" : ((downloadedGames / effectiveTotal) * 100).toFixed(2);

  async function getLastGameDate({ database }: { database: DatabaseInfo }) {
    const games = await query_games(database.file, {
      options: {
        page: 1,
        pageSize: 1,
        sort: "date",
        direction: "desc",
        skipCount: false,
      },
    });
    if (games.count! > 0 && games.data[0].date && games.data[0].time) {
      const [year, month, day] = games.data[0].date.split(".").map(Number);
      const [hour, minute, second] = games.data[0].time.split(":").map(Number);
      const d = Date.UTC(year, month - 1, day, hour, minute, second);
      return d;
    }
    return null;
  }

  async function downloadGames() {
    const lastGameDate = database ? await getLastGameDate({ database }) : null;
    if (type === "lichess") {
      await downloadLichess(title, lastGameDate, total - downloadedGames, setProgress, token);
    } else {
      await downloadChessCom(title, lastGameDate);
    }
    const p = await resolve(databaseDir, `${title}_${type}.pgn`);
    await convert(p, lastGameDate);
    const dbPath = database?.file ?? p.replace(".pgn", ".duckdb");
    await commands.deleteEmptyGames(dbPath);
  }

  async function syncGames() {
    if (syncing.current) return;
    syncing.current = true;
    setLoading(true);
    try {
      await downloadGames();
      // The game counts and ratings on the card come from the website.
      await reload();
    } catch (e) {
      error(`Downloading ${type} games of ${title} failed: ${e}`);
      notifications.show({
        color: "red",
        title: t("Home.Accounts.DownloadFailed"),
        message: e instanceof Error ? e.message : String(e),
      });
      throw e;
    } finally {
      syncing.current = false;
      setConversionState((prev) => ({
        ...prev,
        inProgress: false,
        totalGames: 0,
        elapsedSeconds: 0,
        targetDatabasePath: null,
        targetDatabaseTitle: null,
        sourceFileName: null,
      }));
      // A failed download must not leave the button spinning forever
      setLoading(false);
      setDatabases(await getDatabases());
      // Refresh the player overview, open databases and the repertoire pages,
      // which cache the downloaded games.
      refreshOwnGames();
      await refreshDatabaseCaches();
    }
  }

  const syncing = useRef(false);
  const latestSync = useRef(syncGames);
  latestSync.current = syncGames;
  useEffect(() => registerAccountSync(syncKey, () => latestSync.current()), [syncKey]);

  const openDatabase =
    database?.type === "success"
      ? () => {
          setActiveDatabase(database);
          setActiveDatabaseTab("games");
          void navigate({ to: "/databases/$databaseId", params: { databaseId: database.title } });
        }
      : undefined;

  return (
    <Card withBorder radius="md" padding="lg">
      <Card.Section withBorder inheritPadding py="xs">
        <Group justify="space-between">
          <Group>
            {type === "lichess" ? (
              <LichessLogo />
            ) : (
              <img width={30} height={30} src="/chesscom.png" alt="chess.com" />
            )}
            {openDatabase ? (
              <Tooltip label={t("Home.Accounts.OpenDatabase")}>
                <Anchor component="button" type="button" fw={600} size="sm" onClick={openDatabase}>
                  {title}
                </Anchor>
              </Tooltip>
            ) : (
              <Text fw={600} size="sm">
                {title}
              </Text>
            )}
            {type === "lichess" && token && (
              <Tooltip label={t("Home.Accounts.Authenticated")}>
                <Text c="green" lh={0} style={{ cursor: "default" }}>
                  <IconCircleCheckFilled size="1.1rem" />
                </Text>
              </Tooltip>
            )}
          </Group>
          <Group gap={4}>
            <Tooltip label={t("Home.Accounts.UpdateStats")}>
              <ActionIcon variant="subtle" color="gray" onClick={() => reload()}>
                <IconRefresh size="1rem" />
              </ActionIcon>
            </Tooltip>
            <Tooltip label={t("Home.Accounts.DownloadGames")}>
              <ActionIcon
                variant="subtle"
                color="gray"
                loading={loading}
                disabled={loading}
                onClick={() => void syncGames().catch(() => {})}
              >
                <IconDownload size="1rem" />
              </ActionIcon>
            </Tooltip>
            <Tooltip label={t("Home.Accounts.RemoveAccount")}>
              <ActionIcon variant="subtle" color="red" onClick={() => logout()}>
                <IconTrash size="1rem" />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
      </Card.Section>

      <Card.Section inheritPadding py="md">
        <SimpleGrid cols={1} spacing="xs">
          {items}
        </SimpleGrid>
      </Card.Section>

      <Card.Section inheritPadding pb="sm">
        <Stack gap={4}>
          <Group justify="space-between">
            <Text size="xs" c="dimmed">
              {t("Common.Games")}
            </Text>
            <Text size="xs" fw={500}>
              {downloadedGames} / {effectiveTotal}
            </Text>
          </Group>
          <Progress
            value={
              loading ? 100 : effectiveTotal > 0 ? (downloadedGames / effectiveTotal) * 100 : 0
            }
            size="sm"
            striped={loading}
            animated={loading}
          />
          <Group justify="space-between" mt={4}>
            <Text size="xs" c="dimmed">
              {t("Home.Accounts.LastUpdate", {
                date: new Date(updatedAt).toLocaleDateString(),
                interpolation: { escapeValue: false },
              })}
            </Text>
            {loading && !!progress && (
              <Text size="xs" c="dimmed">
                {progress.toFixed(0)}%
              </Text>
            )}
          </Group>
        </Stack>
      </Card.Section>
    </Card>
  );
}
