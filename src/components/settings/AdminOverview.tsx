import {
  Alert,
  Anchor,
  Button,
  Group,
  Progress,
  SimpleGrid,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import { IconExternalLink, IconRefresh } from "@tabler/icons-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type AdminData,
  type AdminSummary,
  FREE_READS_PER_DAY,
  FREE_WRITES_PER_DAY,
  fetchAdminData,
  OVERVIEW_DAYS,
  quotaPercent,
  summarizeUsage,
} from "@/utils/cloud/adminOverview";
import { cloudFirestore } from "@/utils/cloud/auth";
import BossBookAdmin from "@/components/coach/BossBookAdmin";
import { parseLimits, usageDay, usageMeter } from "@/utils/cloud/usage";

const CONSOLE = "https://console.firebase.google.com/project/jblbase";
const LINKS = {
  analytics: `${CONSOLE}/analytics`,
  firestore: `${CONSOLE}/firestore/databases/-default-/usage`,
  budget: "https://console.cloud.google.com/billing/budgets",
};

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Stack gap={2}>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="xl" fw={600}>
        {value}
      </Text>
      {hint && (
        <Text size="xs" c="dimmed">
          {hint}
        </Text>
      )}
    </Stack>
  );
}

function Quota({ label, used, free }: { label: string; used: number; free: number }) {
  const { i18n } = useTranslation();
  const percent = quotaPercent(used, free);
  return (
    <Stack gap={4}>
      <Group justify="space-between">
        <Text size="sm">{label}</Text>
        <Text size="sm" c="dimmed">
          {used.toLocaleString(i18n.language)} / {free.toLocaleString(i18n.language)} ({percent} %)
        </Text>
      </Group>
      <Progress
        value={Math.min(100, percent)}
        color={percent >= 90 ? "red" : percent >= 50 ? "yellow" : "teal"}
      />
    </Stack>
  );
}

// Admin overview (#116): accounts, devices, cloud usage against the free
// quota, accounts at a limit and the size of the shared position store.
// Only shown to admins; the rules let nobody else read these numbers.
export default function AdminOverview() {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<AdminData | null>(null);
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = (v: number) => v.toLocaleString(i18n.language);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const since = new Date(Date.now() - OVERVIEW_DAYS * 24 * 60 * 60 * 1000);
      const next = await fetchAdminData(await cloudFirestore(), since);
      usageMeter.read("meta", next.usage.length + 3);
      setData(next);
      setSummary(summarizeUsage(next.usage, parseLimits(next.limits), usageDay()));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          {t("Settings.Admin.Period", { days: OVERVIEW_DAYS })}
        </Text>
        <Button
          size="xs"
          variant="light"
          leftSection={<IconRefresh size="0.9rem" />}
          loading={loading}
          onClick={() => void load()}
        >
          {t("Settings.Admin.Reload")}
        </Button>
      </Group>

      <BossBookAdmin />

      {error && (
        <Alert color="red" title={t("Settings.Admin.Error")}>
          {t("Settings.Admin.ErrorHint")}
          <Text size="xs" c="dimmed" mt={4}>
            {error}
          </Text>
        </Alert>
      )}

      {summary && data && (
        <>
          <SimpleGrid cols={{ base: 2, md: 4 }}>
            <Stat
              label={t("Settings.Admin.ActiveAccounts")}
              value={n(summary.activeAccounts)}
              hint={t("Settings.Admin.Devices", { count: summary.activeDevices })}
            />
            <Stat
              label={t("Settings.Admin.Allowlist")}
              value={data.allowlist ? n(data.allowlist.emails + data.allowlist.lichess) : "–"}
              hint={
                data.allowlist
                  ? t("Settings.Admin.AllowlistHint", {
                      emails: data.allowlist.emails,
                      lichess: data.allowlist.lichess,
                    })
                  : t("Settings.Admin.AllowlistMissing")
              }
            />
            <Stat
              label={t("Settings.Admin.SharedEvals")}
              value={data.sharedEvals === null ? "–" : n(data.sharedEvals)}
            />
            <Stat
              label={t("Settings.Admin.AtLimit")}
              value={n(summary.syncPausedToday + summary.evalsPausedToday)}
              hint={t("Settings.Admin.AtLimitHint", {
                sync: summary.syncPausedToday,
                evals: summary.evalsPausedToday,
              })}
            />
          </SimpleGrid>

          <Stack gap="sm">
            <Text fw={500}>{t("Settings.Admin.Today")}</Text>
            <Quota
              label={t("Settings.Admin.Reads")}
              used={summary.today.reads}
              free={FREE_READS_PER_DAY}
            />
            <Quota
              label={t("Settings.Admin.Writes")}
              used={summary.today.writes}
              free={FREE_WRITES_PER_DAY}
            />
            <Text size="xs" c="dimmed">
              {t("Settings.Admin.TodayHint")}
            </Text>
          </Stack>

          {summary.days.length > 0 && (
            <Table striped withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t("Settings.Admin.Day")}</Table.Th>
                  <Table.Th ta="right">{t("Settings.Admin.Accounts")}</Table.Th>
                  <Table.Th ta="right">{t("Settings.Admin.Reads")}</Table.Th>
                  <Table.Th ta="right">{t("Settings.Admin.Writes")}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {summary.days.map((d) => (
                  <Table.Tr key={d.day}>
                    <Table.Td>{d.day}</Table.Td>
                    <Table.Td ta="right">{n(d.accounts)}</Table.Td>
                    <Table.Td ta="right">{n(d.reads)}</Table.Td>
                    <Table.Td ta="right">{n(d.writes)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </>
      )}

      <Stack gap={4}>
        <Text fw={500}>{t("Settings.Admin.Links")}</Text>
        {[
          { label: t("Settings.Admin.Link.Analytics"), url: LINKS.analytics },
          { label: t("Settings.Admin.Link.Firestore"), url: LINKS.firestore },
          { label: t("Settings.Admin.Link.Budget"), url: LINKS.budget },
        ].map((l) => (
          <Anchor key={l.url} size="sm" onClick={() => void openUrl(l.url)}>
            <Group gap={4}>
              {l.label}
              <IconExternalLink size="0.8rem" />
            </Group>
          </Anchor>
        ))}
        <Text size="xs" c="dimmed">
          {t("Settings.Admin.LinksHint")}
        </Text>
      </Stack>
    </Stack>
  );
}
