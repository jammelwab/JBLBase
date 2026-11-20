import { ActionIcon, Menu, Tooltip } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconBook,
  IconBrush,
  IconBug,
  IconChess,
  IconDatabase,
  IconDownload,
  IconFlag,
  IconFolder,
  IconKeyboard,
  IconMouse,
  IconSettings,
  IconShield,
  IconUserCircle,
  IconVolume,
} from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import { getVersion } from "@tauri-apps/api/app";
import { appLogDir, resolve } from "@tauri-apps/api/path";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { openUrl } from "@tauri-apps/plugin-opener";
import { arch, platform, version } from "@tauri-apps/plugin-os";
import { useAtomValue, useSetAtom } from "jotai";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { settingsTabAtom } from "@/components/cloud/cloudUi";
import SyncIndicator from "@/components/cloud/SyncIndicator";
import { type BugReportInfo, bugReportText, bugReportUrl } from "@/utils/bugReport";
import { availableUpdateAtom, checkForAppUpdate } from "@/utils/updater";
import classes from "./CornerMenu.module.css";

/** Look for a new release again every few hours while the app stays open. */
const RECHECK_MS = 6 * 60 * 60 * 1000;

const tabs = [
  { value: "profile", label: "Settings.Cloud", icon: IconUserCircle },
  { value: "board", label: "Settings.Board", icon: IconChess },
  { value: "inputs", label: "Settings.Inputs", icon: IconMouse },
  { value: "anarchy", label: "Settings.Anarchy", icon: IconFlag },
  { value: "appearance", label: "Settings.Appearance", icon: IconBrush },
  { value: "sound", label: "Settings.Sound", icon: IconVolume },
  { value: "keybinds", label: "Settings.Keybinds", icon: IconKeyboard },
  { value: "directories", label: "Settings.Directories", icon: IconFolder },
  { value: "repertoire", label: "Settings.Repertoire", icon: IconBook },
  { value: "evalcache", label: "Settings.EvalCache", icon: IconDatabase },
  { value: "privacy", label: "Settings.Privacy", icon: IconShield },
] as const;

/** Version, system and the end of the log for a bug report (never throws). */
async function collectBugReport(
  language: string,
): Promise<{ info: BugReportInfo; log: string | null }> {
  const safe = <T,>(f: () => T, fallback: T): T => {
    try {
      return f();
    } catch {
      return fallback;
    }
  };
  const info: BugReportInfo = {
    appVersion: await getVersion().catch(() => "unbekannt"),
    os: safe(() => platform(), "unbekannt"),
    osVersion: safe(() => version(), ""),
    arch: safe(() => arch(), ""),
    language,
  };
  const log = await appLogDir()
    .then((dir) => resolve(dir, "en-croissant.log"))
    .then((path) => readTextFile(path))
    .catch(() => null);
  return { info, log };
}

/**
 * Small rounded panel in the top right corner: the cloud sync state while
 * someone is signed in, a settings menu that jumps straight to a settings
 * tab, and a download arrow while a newer version of JBLBase is available.
 */
export default function CornerMenu() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const setSettingsTab = useSetAtom(settingsTabAtom);
  const update = useAtomValue(availableUpdateAtom);

  useEffect(() => {
    const timer = setInterval(() => void checkForAppUpdate(t, { silent: true }), RECHECK_MS);
    return () => clearInterval(timer);
  }, [t]);

  // Copies version, system and the cleaned end of the log, then opens a new
  // GitHub issue to paste it into
  const reportBug = async () => {
    const { info, log } = await collectBugReport(i18n.language.slice(0, 2));
    let copied = true;
    try {
      await navigator.clipboard.writeText(bugReportText(info, log));
    } catch {
      copied = false;
    }
    notifications.show({
      color: copied ? "teal" : "yellow",
      title: t("Menu.ReportBug"),
      message: copied ? t("Menu.ReportBug.Copied") : t("Menu.ReportBug.NotCopied"),
    });
    await openUrl(bugReportUrl(info)).catch(() => {});
  };

  const openTab = (value: string) => {
    setSettingsTab(value);
    void navigate({ to: "/settings" });
  };

  return (
    <div className={classes.panel}>
      <SyncIndicator />
      {update && (
        <Tooltip label={t("Updater.Available.Short", { version: update.version })}>
          <ActionIcon
            variant="light"
            color="teal"
            radius="xl"
            size="md"
            className={classes.update}
            aria-label={t("Updater.Available.Short", { version: update.version })}
            onClick={() => void checkForAppUpdate(t)}
          >
            <IconDownload size="1.05rem" stroke={2} />
          </ActionIcon>
        </Tooltip>
      )}
      <Menu position="bottom-end" offset={8} width={230} shadow="md" radius="md">
        <Menu.Target>
          <ActionIcon
            variant="subtle"
            color="gray"
            radius="xl"
            size="md"
            aria-label={t("SideBar.Settings")}
          >
            <IconSettings size="1.1rem" stroke={1.6} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Label>{t("SideBar.Settings")}</Menu.Label>
          {tabs.map(({ value, label, icon: Icon }) => (
            <Menu.Item
              key={value}
              leftSection={<Icon size="1rem" stroke={1.6} />}
              onClick={() => openTab(value)}
            >
              {t(label)}
            </Menu.Item>
          ))}
          <Menu.Divider />
          <Menu.Item
            leftSection={<IconDownload size="1rem" stroke={1.6} />}
            onClick={() => void checkForAppUpdate(t)}
          >
            {t("Menu.Help.CheckUpdate")}
          </Menu.Item>
          <Menu.Item
            leftSection={<IconBug size="1rem" stroke={1.6} />}
            onClick={() => void reportBug()}
          >
            {t("Menu.ReportBug")}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </div>
  );
}
