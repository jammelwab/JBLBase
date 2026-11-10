import { ActionIcon, Menu, Tooltip } from "@mantine/core";
import {
  IconBook,
  IconBrush,
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
import { useAtomValue, useSetAtom } from "jotai";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { settingsTabAtom } from "@/components/cloud/cloudUi";
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

/**
 * Small rounded panel in the top right corner: a settings menu that jumps
 * straight to a settings tab, and a download arrow while a newer version of
 * JBLBase is available.
 */
export default function CornerMenu() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setSettingsTab = useSetAtom(settingsTabAtom);
  const update = useAtomValue(availableUpdateAtom);

  useEffect(() => {
    const timer = setInterval(() => void checkForAppUpdate(t, { silent: true }), RECHECK_MS);
    return () => clearInterval(timer);
  }, [t]);

  const openTab = (value: string) => {
    setSettingsTab(value);
    void navigate({ to: "/settings" });
  };

  return (
    <div className={classes.panel}>
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
        </Menu.Dropdown>
      </Menu>
    </div>
  );
}
