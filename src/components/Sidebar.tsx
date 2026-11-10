"use no memo";
import { AppShellSection, Avatar, Stack, Tooltip, UnstyledButton } from "@mantine/core";
import {
  type Icon,
  IconBooks,
  IconChess,
  IconCpu,
  IconDatabase,
  IconFiles,
  IconSettings,
  IconUser,
  IconUserCircle,
} from "@tabler/icons-react";
import { Link, useMatchRoute, useNavigate } from "@tanstack/react-router";
import cx from "clsx";
import { useAtomValue, useSetAtom } from "jotai";
import { loginScreenOpenAtom, settingsTabAtom } from "@/components/cloud/cloudUi";
import { cloudAccountAtom } from "@/utils/cloud/sync";
import { useTranslation } from "react-i18next";
import classes from "./Sidebar.module.css";

interface NavbarLinkProps {
  icon: Icon;
  label: string;
  url: string;
  active?: boolean;
}

function NavbarLink({ url, icon: Icon, label }: NavbarLinkProps) {
  const match = useMatchRoute();
  return (
    <Tooltip label={label} position="right">
      <Link
        to={url}
        className={cx(classes.link, {
          [classes.active]: match({ to: url, fuzzy: true }) !== false,
        })}
      >
        <Icon size="1.5rem" stroke={1.5} />
      </Link>
    </Tooltip>
  );
}

const linksdata = [
  { icon: IconChess, label: "Board", url: "/" },
  { icon: IconUser, label: "User", url: "/accounts" },
  { icon: IconBooks, label: "Repertoires", url: "/repertoires" },
  { icon: IconFiles, label: "Files", url: "/files" },
  {
    icon: IconDatabase,
    label: "Databases",
    url: "/databases",
  },
  { icon: IconCpu, label: "Engines", url: "/engines" },
];

/** The JBLBase account: sign in, or open the profile when signed in. */
function AccountButton() {
  const { t } = useTranslation();
  const account = useAtomValue(cloudAccountAtom);
  const openLogin = useSetAtom(loginScreenOpenAtom);
  const setSettingsTab = useSetAtom(settingsTabAtom);
  const navigate = useNavigate();
  const name = account
    ? ((account.method === "lichess" ? account.displayName : account.email) ?? "")
    : "";

  return (
    <Tooltip label={account ? name : t("Settings.Cloud.SignIn")} position="right">
      <UnstyledButton
        className={classes.link}
        aria-label={account ? t("Settings.Cloud") : t("Settings.Cloud.SignIn")}
        onClick={() => {
          if (account) {
            setSettingsTab("profile");
            void navigate({ to: "/settings" });
          } else {
            openLogin(true);
          }
        }}
      >
        {account ? (
          <Avatar size={28} radius="xl" color="blue" variant="filled">
            {name.replace(/@.*/, "").slice(0, 1).toUpperCase() || "?"}
          </Avatar>
        ) : (
          <IconUserCircle size="1.5rem" stroke={1.5} />
        )}
      </UnstyledButton>
    </Tooltip>
  );
}

export function SideBar() {
  const { t } = useTranslation();

  const links = linksdata.map((link) => (
    <NavbarLink {...link} label={t(`SideBar.${link.label}`)} key={link.label} />
  ));

  return (
    <>
      <AppShellSection grow>
        <Stack justify="center" gap={0}>
          {links}
        </Stack>
      </AppShellSection>
      <AppShellSection>
        <Stack justify="center" gap={0}>
          <AccountButton />
          <NavbarLink icon={IconSettings} label={t("SideBar.Settings")} url="/settings" />
        </Stack>
      </AppShellSection>
    </>
  );
}
