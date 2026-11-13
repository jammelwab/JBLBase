import { Alert, Button, Group, SimpleGrid, Stack, Table, Text } from "@mantine/core";
import { IconRefresh, IconTrash } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { commands, type EvalCacheStats } from "@/bindings";
import { formatBytes } from "@/utils/format";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Stack gap={0}>
      <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
        {label}
      </Text>
      <Text fw={500}>{value}</Text>
    </Stack>
  );
}

export default function EvalCacheSettings() {
  const { t } = useTranslation();
  const [stats, setStats] = useState<EvalCacheStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const refresh = useCallback(async () => {
    const res = await commands.getEvalCacheStats();
    if (res.status === "ok") {
      setStats(res.data);
      setError(null);
    } else {
      setStats(null);
      setError(String(res.error));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const clear = async () => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    setConfirmClear(false);
    await commands.clearEvalCache();
    await refresh();
  };

  if (error) {
    return (
      <Alert color="red" title={t("Settings.EvalCache.Unavailable")}>
        {error}
      </Alert>
    );
  }

  return (
    <Stack>
      <SimpleGrid cols={3}>
        <Stat
          label={t("Settings.EvalCache.Positions")}
          value={(stats?.positions ?? 0).toLocaleString()}
        />
        <Stat
          label={t("Settings.EvalCache.Entries")}
          value={(stats?.entries ?? 0).toLocaleString()}
        />
        <Stat label={t("Settings.EvalCache.Size")} value={formatBytes(stats?.sizeBytes ?? 0)} />
      </SimpleGrid>

      {stats && stats.engines.length > 0 && (
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t("Settings.EvalCache.Engine")}</Table.Th>
              <Table.Th>{t("Settings.EvalCache.Entries")}</Table.Th>
              <Table.Th>{t("Settings.EvalCache.MaxDepth")}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {stats.engines.map((e) => (
              <Table.Tr key={e.engine}>
                <Table.Td>{e.engine}</Table.Td>
                <Table.Td>{e.entries.toLocaleString()}</Table.Td>
                <Table.Td>{e.maxDepth}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      {stats && (
        <Text size="sm">
          {t("Settings.EvalCache.Session", {
            lookups: stats.sessionLookups.toLocaleString(),
            hits: stats.sessionHits.toLocaleString(),
            saved: stats.sessionSaved.toLocaleString(),
          })}
        </Text>
      )}

      {stats && (
        <Text size="xs" c="dimmed" style={{ wordBreak: "break-all" }}>
          {t("Settings.EvalCache.Location")}: {stats.path}
        </Text>
      )}

      <Group>
        <Button variant="default" leftSection={<IconRefresh size="1rem" />} onClick={refresh}>
          {t("Settings.EvalCache.Refresh")}
        </Button>
        <Button
          color="red"
          variant={confirmClear ? "filled" : "light"}
          leftSection={<IconTrash size="1rem" />}
          onClick={clear}
          onBlur={() => setConfirmClear(false)}
        >
          {confirmClear ? t("Settings.EvalCache.ClearConfirm") : t("Settings.EvalCache.Clear")}
        </Button>
      </Group>
    </Stack>
  );
}
