import { Button, Dialog, Group, Stack, Text } from "@mantine/core";
import { useRouterState } from "@tanstack/react-router";
import { getVersion } from "@tauri-apps/api/app";
import { platform } from "@tauri-apps/plugin-os";
import { useAtom, useAtomValue } from "jotai";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { commands } from "@/bindings";
import { loginScreenOpenAtom } from "@/components/cloud/cloudUi";
import { usageStatsAskedAtom, usageStatsAtom } from "@/state/atoms";
import { cloudAccountAtom } from "@/utils/cloud/sync";
import {
  bigBucket,
  forgetUsageStats,
  HOUR_MS,
  initUsageStats,
  pageName,
  setUsageAccount,
  shareBucket,
  trackUsage,
  usageStatsConfigured,
  usageStatsEnabled,
} from "@/utils/usageStats";

/** Day (YYYY-MM-DD) the position store was last summed up for the statistics. */
const EVAL_DAY_KEY = "usage-stats-eval-day";
/** First look a while after the start, when some analysis has happened. */
const EVAL_FIRST_CHECK_MS = 15 * 60 * 1000;
/** Fewer lookups than this in a session say nothing about the hit rate. */
const EVAL_MIN_LOOKUPS = 20;

/**
 * Once a day: how often the position store already had a result in this
 * session and roughly how big it is (#115). Only rough sizes, no positions.
 */
async function countEvalCacheDay() {
  if (!usageStatsEnabled()) return;
  const day = new Date().toISOString().slice(0, 10);
  try {
    if (localStorage.getItem(EVAL_DAY_KEY) === day) return;
  } catch {
    return;
  }
  const res = await commands.getEvalCacheStats().catch(() => null);
  if (!res || res.status !== "ok" || res.data.sessionLookups < EVAL_MIN_LOOKUPS) return;
  const s = res.data;
  trackUsage("eval_cache_day", {
    hit_rate: shareBucket(s.sessionHits, s.sessionLookups),
    positions: bigBucket(s.positions),
  });
  try {
    localStorage.setItem(EVAL_DAY_KEY, day);
  } catch {}
}

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
  const account = useAtomValue(cloudAccountAtom);

  // Only the kind of account goes along, never which one
  useEffect(() => {
    setUsageAccount(!account ? "none" : account.role === "admin" ? "admin" : "user");
  }, [account]);

  useEffect(() => {
    if (!enabled) return;
    const first = setTimeout(() => void countEvalCacheDay(), EVAL_FIRST_CHECK_MS);
    const hourly = setInterval(() => void countEvalCacheDay(), HOUR_MS);
    return () => {
      clearTimeout(first);
      clearInterval(hourly);
    };
  }, [enabled]);

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
