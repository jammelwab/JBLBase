import {
  Alert,
  Button,
  Divider,
  Group,
  NumberInput,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
} from "@mantine/core";
import { IconCloud, IconRefresh, IconTrash } from "@tabler/icons-react";
import { useAtom, useAtomValue } from "jotai";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { commands, type EvalCacheStats } from "@/bindings";
import { evalCloudSyncAtom } from "@/state/atoms";
import { can } from "@/utils/cloud/permissions";
import { cloudAccountAtom, cloudSyncStatusAtom, syncNow } from "@/utils/cloud/sync";
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

/** Sharing the stored results through the cloud (see utils/cloud/evalSync.ts). */
function CloudEvalSync() {
  const { t } = useTranslation();
  const [settings, setSettings] = useAtom(evalCloudSyncAtom);
  const account = useAtomValue(cloudAccountAtom);
  const status = useAtomValue(cloudSyncStatusAtom);
  const evals = status.evals;
  // Admins und das Recht sharedEvals laden in den gemeinsamen Speicher hoch
  const admin = can(account, "sharedEvals");

  return (
    <Stack gap="xs">
      <Divider label={t("Settings.EvalCache.Cloud")} labelPosition="left" />
      {!account && (
        <Text size="sm" c="dimmed">
          {t("Settings.EvalCache.CloudSignedOut")}
        </Text>
      )}
      <Switch
        label={t("Settings.EvalCache.CloudEnabled")}
        description={t(
          admin ? "Settings.EvalCache.CloudEnabledAdmin" : "Settings.EvalCache.CloudEnabledUser",
        )}
        checked={settings.enabled}
        onChange={(e) => setSettings({ ...settings, enabled: e.currentTarget.checked })}
      />
      <Switch
        label={t("Settings.EvalCache.CloudShared")}
        description={t("Settings.EvalCache.CloudSharedDesc")}
        checked={settings.shared}
        disabled={!settings.enabled}
        onChange={(e) => setSettings({ ...settings, shared: e.currentTarget.checked })}
      />
      <NumberInput
        label={t("Settings.EvalCache.CloudMinDepth")}
        description={t("Settings.EvalCache.CloudMinDepthDesc")}
        min={10}
        max={60}
        w={260}
        disabled={!settings.enabled}
        value={settings.minDepth}
        onChange={(v) => {
          const n = typeof v === "number" ? v : Number.parseInt(v, 10);
          if (Number.isFinite(n)) {
            setSettings({ ...settings, minDepth: Math.min(60, Math.max(10, Math.round(n))) });
          }
        }}
      />
      {account && settings.enabled && evals && (
        <Text size="sm">
          {t("Settings.EvalCache.CloudStatus", {
            uploaded: evals.uploaded.toLocaleString(),
            downloaded: evals.downloaded.toLocaleString(),
            applied: evals.applied.toLocaleString(),
            pending: evals.pending.toLocaleString(),
          })}
        </Text>
      )}
      {account && settings.enabled && evals?.capped && (
        <Text size="sm" c="dimmed">
          {t("Settings.EvalCache.CloudCapped")}
        </Text>
      )}
      {account && settings.enabled && status.state === "error" && (
        <Text size="sm" c="red">
          {status.error}
        </Text>
      )}
      {account && (
        <Group>
          <Button
            variant="default"
            leftSection={<IconCloud size="1rem" />}
            loading={status.state === "syncing"}
            disabled={!settings.enabled}
            onClick={() => void syncNow()}
          >
            {t("Settings.EvalCache.CloudSyncNow")}
          </Button>
        </Group>
      )}
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

      <CloudEvalSync />
    </Stack>
  );
}
