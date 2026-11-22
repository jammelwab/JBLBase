import { ActionIcon, Menu, Tooltip } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconBug,
  IconDownload,
  IconHelp,
  IconPlayerPlay,
  IconSchool,
  IconSettings,
} from "@tabler/icons-react";
import { useLocation, useNavigate } from "@tanstack/react-router";
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
import { useIsAdmin, useStartTutorial } from "@/components/tutorial/tutorialState";
import { tutorialsForPage } from "@/components/tutorial/tutorials";
import { coachIntroOpenAtom } from "@/components/coach/coachIntroState";
import classes from "./CornerMenu.module.css";
import { SETTINGS_NAV } from "@/components/settings/settingsNav";

/** Look for a new release again every few hours while the app stays open. */
const RECHECK_MS = 6 * 60 * 60 * 1000;

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
 * The question mark in the corner: the short tutorials for the page that is
 * open, and the list of all tutorials.
 */
function HelpMenu() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const isAdmin = useIsAdmin();
  const start = useStartTutorial();
  const navigate = useNavigate();
  const setSettingsTab = useSetAtom(settingsTabAtom);
  const openIntro = useSetAtom(coachIntroOpenAtom);
  const here = tutorialsForPage(pathname, isAdmin);

  return (
    <Menu position="bottom-end" offset={8} width={260} shadow="md" radius="md">
      <Menu.Target>
        <Tooltip label={t("Tutorial.Help")}>
          <ActionIcon
            variant="subtle"
            color="gray"
            radius="xl"
            size="md"
            aria-label={t("Tutorial.Help")}
            data-tour="corner-help"
          >
            <IconHelp size="1.1rem" stroke={1.6} />
          </ActionIcon>
        </Tooltip>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>{t("Tutorial.ThisPage")}</Menu.Label>
        {here.length === 0 && <Menu.Item disabled>{t("Tutorial.NoneHere")}</Menu.Item>}
        {here.map((tutorial) => (
          <Menu.Item
            key={tutorial.id}
            leftSection={<IconPlayerPlay size="1rem" stroke={1.6} />}
            onClick={() => start(tutorial.id)}
          >
            {t(`Tutorial.${tutorial.id}.Title`)}
          </Menu.Item>
        ))}
        <Menu.Divider />
        <Menu.Item
          leftSection={<IconPlayerPlay size="1rem" stroke={1.6} />}
          onClick={() => openIntro(true)}
        >
          {t("Coach.Intro.Menu")}
        </Menu.Item>
        <Menu.Item
          leftSection={<IconSchool size="1rem" stroke={1.6} />}
          onClick={() => {
            setSettingsTab("tutorials");
            void navigate({ to: "/settings" });
          }}
        >
          {t("Tutorial.All")}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

/**
 * Small rounded panel in the top right corner: the cloud sync state while
 * someone is signed in, the tutorials for the open page, a settings menu that
 * jumps straight to a settings tab, and a download arrow while a newer version
 * of JBLBase is available.
 */
export default function CornerMenu() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const setSettingsTab = useSetAtom(settingsTabAtom);
  const update = useAtomValue(availableUpdateAtom);
  const isAdmin = useIsAdmin();

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
    <div className={classes.panel} data-tour="corner-menu">
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
      <HelpMenu />
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
          {SETTINGS_NAV.map((group, i) => {
            const tabs = group.tabs.filter((tab) => !tab.adminOnly || isAdmin);
            if (tabs.length === 0) return null;
            return (
              <div key={group.label}>
                {i > 0 && <Menu.Divider />}
                <Menu.Label>{t(group.label)}</Menu.Label>
                {tabs.map(({ value, label, icon: Icon }) => (
                  <Menu.Item
                    key={value}
                    leftSection={<Icon size="1rem" stroke={1.6} />}
                    onClick={() => openTab(value)}
                  >
                    {t(label)}
                  </Menu.Item>
                ))}
              </div>
            );
          })}
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
