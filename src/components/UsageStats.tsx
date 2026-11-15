import { Button, Dialog, Group, Stack, Text } from "@mantine/core";
import { useRouterState } from "@tanstack/react-router";
import { getVersion } from "@tauri-apps/api/app";
import { platform } from "@tauri-apps/plugin-os";
import { useAtom, useAtomValue } from "jotai";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { loginScreenOpenAtom } from "@/components/cloud/cloudUi";
import { usageStatsAskedAtom, usageStatsAtom } from "@/state/atoms";
import {
  forgetUsageStats,
  initUsageStats,
  pageName,
  trackUsage,
  usageStatsConfigured,
} from "@/utils/usageStats";

/**
 * App-wide part of the anonymous usage statistics: counts app starts and
 * page changes while the switch is on, and asks once whether to switch it
 * on. Renders nothing while the statistics are not set up.
 */
export default function UsageStats() {
  const { t, i18n } = useTranslation();
  const [enabled, setEnabled] = useAtom(usageStatsAtom);
  const [asked, setAsked] = useAtom(usageStatsAskedAtom);
  const loginOpen = useAtomValue(loginScreenOpenAtom);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const configured = usageStatsConfigured();

  useEffect(() => {
    if (!configured) return;
    void getVersion()
      .catch(() => "unknown")
      .then((appVersion) =>
        initUsageStats({ appVersion, os: platform(), language: i18n.language.slice(0, 2) }),
      );
  }, [configured, i18n.language]);

  useEffect(() => {
    if (enabled) {
      setAsked(true);
      trackUsage("app_open");
    } else {
      forgetUsageStats();
    }
  }, [enabled, setAsked]);

  useEffect(() => {
    if (!enabled) return;
    const page = pageName(pathname);
    trackUsage("page_view", { page_title: page, page_location: `app://jblbase/${page}` });
  }, [enabled, pathname]);

  if (!configured) return null;

  return (
    <Dialog
      opened={!asked && !enabled && !loginOpen}
      position={{ top: 56, right: 16 }}
      size="lg"
      radius="md"
      withBorder
    >
      <Stack gap="xs">
        <Text fw={600} size="sm">
          {t("UsageStats.Prompt.Title")}
        </Text>
        <Text size="xs" c="dimmed">
          {t("UsageStats.Prompt.Text")}
        </Text>
        <Group justify="flex-end" gap="xs">
          <Button size="compact-sm" variant="default" onClick={() => setAsked(true)}>
            {t("UsageStats.Prompt.No")}
          </Button>
          <Button size="compact-sm" onClick={() => setEnabled(true)}>
            {t("UsageStats.Prompt.Yes")}
          </Button>
        </Group>
      </Stack>
    </Dialog>
  );
}
