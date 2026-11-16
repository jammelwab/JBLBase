import { ActionIcon, Loader, Tooltip } from "@mantine/core";
import {
  IconCloudCheck,
  IconCloudExclamation,
  IconCloudOff,
  IconCloudX,
} from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { settingsTabAtom } from "@/components/cloud/cloudUi";
import { cloudSyncStatusAtom } from "@/utils/cloud/sync";
import { formatAgo, type SyncTone, syncSummary } from "@/utils/cloud/syncSummary";

/** Re-renders every few seconds, so "vor 10 Sek." stays true. */
function useNow(intervalMs = 10_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** The sync state as one line of text, and its tone (#111). */
export function useSyncSummary() {
  const { t, i18n } = useTranslation();
  const status = useAtomValue(cloudSyncStatusAtom);
  const now = useNow();
  const summary = syncSummary(status);
  let ago = "";
  if (summary.lastSync) {
    const a = formatAgo(summary.lastSync, i18n.language, now);
    ago = "relative" in a ? a.relative : t("Settings.Cloud.Sync.At", { time: a.time });
  }
  // Keys are chosen at runtime (Settings.Cloud.* is kept by i18n:extract).
  const text = t(summary.key as "Settings.Cloud.Sync.Ago", { ago });
  const detail =
    summary.lastSync && summary.tone !== "ok" ? t("Settings.Cloud.Sync.Ago", { ago }) : undefined;
  return { tone: summary.tone, text, detail, status };
}

const colors: Record<SyncTone, string> = {
  ok: "teal",
  busy: "gray",
  offline: "gray",
  error: "red",
  warning: "yellow",
  off: "gray",
};

function ToneIcon({ tone }: { tone: SyncTone }) {
  switch (tone) {
    case "busy":
      return <Loader size="0.9rem" color="gray" />;
    case "offline":
      return <IconCloudOff size="1.1rem" stroke={1.6} />;
    case "error":
      return <IconCloudX size="1.1rem" stroke={1.6} />;
    case "warning":
      return <IconCloudExclamation size="1.1rem" stroke={1.6} />;
    default:
      return <IconCloudCheck size="1.1rem" stroke={1.6} />;
  }
}

/**
 * Small cloud in the corner menu while someone is signed in: shows at a
 * glance whether everything is in the cloud. Opens the account settings.
 */
export default function SyncIndicator() {
  const { tone, text, detail } = useSyncSummary();
  const navigate = useNavigate();
  const setSettingsTab = useSetAtom(settingsTabAtom);
  if (tone === "off") return null;
  const label = detail ? `${text} · ${detail}` : text;
  return (
    <Tooltip label={label} multiline maw={260}>
      <ActionIcon
        variant="subtle"
        color={colors[tone]}
        radius="xl"
        size="md"
        aria-label={label}
        onClick={() => {
          setSettingsTab("profile");
          void navigate({ to: "/settings" });
        }}
      >
        <ToneIcon tone={tone} />
      </ActionIcon>
    </Tooltip>
  );
}
