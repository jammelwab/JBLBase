import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  Divider,
  Group,
  Image,
  Loader,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { IconLink, IconLogout, IconRefresh, IconUnlink } from "@tabler/icons-react";
import { useAtomValue, useSetAtom } from "jotai";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import LichessLogo from "@/components/home/LichessLogo";
import {
  type CloudAccount,
  type CloudProfile,
  cloudErrorKey,
  loadProfile,
  normalizeChessComUsername,
  resendVerification,
  saveProfile,
  signOutCloud,
} from "@/utils/cloud/auth";
import { cloudAccountAtom, cloudSyncStatusAtom, startCloudSync, syncNow } from "@/utils/cloud/sync";
import { linkChessCom, loginScreenOpenAtom, startLichessLogin } from "./cloudUi";

type Message = { color: "red" | "green" | "blue" | "yellow"; text: string };
type Run = (action: () => Promise<void>, success?: string) => Promise<void>;

/** Settings → Profile: the JBLBase account, linked chess accounts and sync. */
export default function ProfileSettings() {
  const { t } = useTranslation();
  const account = useAtomValue(cloudAccountAtom);
  const [message, setMessage] = useState<Message | null>(null);
  const [busy, setBusy] = useState(false);

  // Opening the profile loads the account even before the first sign-in.
  useEffect(() => {
    startCloudSync(true);
  }, []);

  const run: Run = useCallback(
    async (action, success) => {
      setBusy(true);
      setMessage(null);
      try {
        await action();
        if (success) setMessage({ color: "green", text: t(success) });
      } catch (e) {
        setMessage({ color: "red", text: t(cloudErrorKey(e)) });
      } finally {
        setBusy(false);
      }
    },
    [t],
  );

  if (account === undefined) return <Loader size="sm" />;

  return (
    <Stack maw={560}>
      {message && (
        <Alert color={message.color} withCloseButton onClose={() => setMessage(null)}>
          {message.text}
        </Alert>
      )}
      {account ? <SignedIn account={account} busy={busy} run={run} /> : <SignedOut />}
    </Stack>
  );
}

function SignedOut() {
  const { t } = useTranslation();
  const openLogin = useSetAtom(loginScreenOpenAtom);
  return (
    <Card withBorder padding="lg">
      <Stack gap="sm">
        <Text fw={500}>{t("Settings.Cloud.SignedOut")}</Text>
        <Text size="sm" c="dimmed">
          {t("Settings.Cloud.SignedOut.Desc")}
        </Text>
        <Group>
          <Button onClick={() => openLogin(true)}>{t("Settings.Cloud.SignInOrRegister")}</Button>
        </Group>
      </Stack>
    </Card>
  );
}

function initials(name: string): string {
  const parts = name
    .replace(/@.*/, "")
    .split(/[\s._-]+/)
    .filter(Boolean);
  return (parts[0]?.[0] ?? "?").toUpperCase() + (parts[1]?.[0] ?? "").toUpperCase();
}

function SignedIn({ account, busy, run }: { account: CloudAccount; busy: boolean; run: Run }) {
  const { t } = useTranslation();
  const [profile, setProfile] = useState<CloudProfile | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadProfile(account.uid)
      .then((p) => !cancelled && setProfile(p))
      .catch(() => !cancelled && setProfile({}));
    return () => {
      cancelled = true;
    };
  }, [account.uid]);

  // A Lichess link (done in the browser) changes the profile elsewhere; reload on focus.
  useEffect(() => {
    const reload = () =>
      loadProfile(account.uid)
        .then(setProfile)
        .catch(() => {});
    window.addEventListener("focus", reload);
    return () => window.removeEventListener("focus", reload);
  }, [account.uid]);

  const name = (account.method === "lichess" ? account.displayName : account.email) ?? "";

  return (
    <Stack gap="lg">
      <Card withBorder padding="lg">
        <Group justify="space-between" wrap="nowrap">
          <Group wrap="nowrap">
            <Avatar size="lg" radius="xl" color="blue">
              {account.method === "lichess" ? <LichessLogo /> : initials(name)}
            </Avatar>
            <Stack gap={2}>
              <Group gap="xs">
                <Text fw={600}>{name}</Text>
                <Badge variant="light" color={account.role === "admin" ? "orange" : "blue"}>
                  {account.role === "admin"
                    ? t("Settings.Cloud.RoleAdmin")
                    : t("Settings.Cloud.RoleUser")}
                </Badge>
              </Group>
              <Text size="xs" c="dimmed">
                {account.method === "lichess"
                  ? t("Settings.Cloud.ViaLichess")
                  : t("Settings.Cloud.ViaEmail")}
              </Text>
            </Stack>
          </Group>
          <Button
            variant="subtle"
            color="red"
            leftSection={<IconLogout size="1rem" />}
            disabled={busy}
            onClick={() => void run(signOutCloud)}
          >
            {t("Settings.Cloud.SignOut")}
          </Button>
        </Group>
        <Text size="xs" c="dimmed" mt="sm">
          {account.role === "admin"
            ? t("Settings.Cloud.RoleAdmin.Desc")
            : t("Settings.Cloud.RoleUser.Desc")}
        </Text>
        {account.method === "email" && !account.emailVerified && (
          <Alert color="yellow" mt="sm">
            <Group justify="space-between">
              <Text size="sm">{t("Settings.Cloud.NotVerified")}</Text>
              <Button
                size="compact-sm"
                variant="light"
                disabled={busy}
                onClick={() => void run(resendVerification, "Settings.Cloud.VerificationSent")}
              >
                {t("Settings.Cloud.ResendVerification")}
              </Button>
            </Group>
          </Alert>
        )}
      </Card>

      <Stack gap="xs">
        <Divider label={t("Settings.Cloud.Linked")} labelPosition="left" />
        {profile === null ? (
          <Loader size="sm" />
        ) : (
          <>
            <LichessCard
              account={account}
              username={profile.lichess}
              busy={busy}
              run={run}
              onUnlinked={() => setProfile((p) => ({ ...p, lichess: undefined }))}
            />
            <ChessComCard
              account={account}
              username={profile.chesscom}
              busy={busy}
              run={run}
              onChange={(chesscom) => setProfile((p) => ({ ...p, chesscom }))}
            />
          </>
        )}
      </Stack>

      <SyncStatus />
    </Stack>
  );
}

function AccountRow({
  logo,
  title,
  status,
  children,
}: {
  logo: ReactNode;
  title: string;
  status: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card withBorder padding="md">
      <Group justify="space-between" wrap="nowrap" align="center">
        <Group wrap="nowrap" gap="sm">
          <Avatar radius="md" color="gray" variant="light">
            {logo}
          </Avatar>
          <Stack gap={0}>
            <Text fw={500}>{title}</Text>
            {status}
          </Stack>
        </Group>
        {children}
      </Group>
    </Card>
  );
}

function LinkedBadge({ username }: { username?: string }) {
  const { t } = useTranslation();
  return username ? (
    <Text size="sm" c="teal">
      {t("Settings.Cloud.LinkedAs", { username })}
    </Text>
  ) : (
    <Text size="sm" c="dimmed">
      {t("Settings.Cloud.NotLinked")}
    </Text>
  );
}

function LichessCard({
  account,
  username,
  busy,
  run,
  onUnlinked,
}: {
  account: CloudAccount;
  username?: string;
  busy: boolean;
  run: Run;
  onUnlinked: () => void;
}) {
  const { t } = useTranslation();
  // Signed in with Lichess: that account is the login and stays linked.
  const fixed = account.method === "lichess";
  return (
    <AccountRow logo={<LichessLogo />} title="Lichess" status={<LinkedBadge username={username} />}>
      {fixed ? (
        <Badge variant="outline" color="gray">
          {t("Settings.Cloud.LoginAccount")}
        </Badge>
      ) : username ? (
        <Button
          size="compact-sm"
          variant="subtle"
          color="gray"
          leftSection={<IconUnlink size="0.9rem" />}
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await saveProfile(account.uid, { lichess: "" });
              onUnlinked();
            })
          }
        >
          {t("Settings.Cloud.Unlink")}
        </Button>
      ) : (
        <Button
          size="compact-sm"
          variant="light"
          leftSection={<IconLink size="0.9rem" />}
          disabled={busy}
          onClick={() => void run(startLichessLogin, "Settings.Cloud.LichessLinkBrowser")}
        >
          {t("Settings.Cloud.Link")}
        </Button>
      )}
    </AccountRow>
  );
}

function ChessComCard({
  account,
  username,
  busy,
  run,
  onChange,
}: {
  account: CloudAccount;
  username?: string;
  busy: boolean;
  run: Run;
  onChange: (username: string | undefined) => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(username ?? "");

  const link = () =>
    run(async () => {
      const name = normalizeChessComUsername(value);
      if (!name) throw Object.assign(new Error(), { code: "chesscom/invalid" });
      // Shows its own notification when the account does not exist.
      if (!(await linkChessCom(account.uid, name))) return;
      onChange(name);
      setEditing(false);
    }, "Settings.Cloud.Saved");

  return (
    <AccountRow
      logo={<Image src="/chesscom.png" w={22} h={22} alt="" />}
      title="Chess.com"
      status={
        editing ? (
          <Text size="xs" c="dimmed">
            {t("Settings.Cloud.ChessCom.Desc")}
          </Text>
        ) : (
          <LinkedBadge username={username} />
        )
      }
    >
      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void link();
          }}
        >
          <Group gap="xs" wrap="nowrap">
            <TextInput
              size="xs"
              placeholder={t("Settings.Cloud.Username")}
              value={value}
              onChange={(e) => setValue(e.currentTarget.value)}
              data-autofocus
              w={150}
            />
            <Button size="compact-sm" type="submit" loading={busy}>
              {t("Common.Save")}
            </Button>
            <Button
              size="compact-sm"
              variant="subtle"
              color="gray"
              onClick={() => setEditing(false)}
            >
              {t("Common.Cancel")}
            </Button>
          </Group>
        </form>
      ) : username ? (
        <Button
          size="compact-sm"
          variant="subtle"
          color="gray"
          leftSection={<IconUnlink size="0.9rem" />}
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await saveProfile(account.uid, { chesscom: "" });
              onChange(undefined);
              setValue("");
            })
          }
        >
          {t("Settings.Cloud.Unlink")}
        </Button>
      ) : (
        <Button
          size="compact-sm"
          variant="light"
          leftSection={<IconLink size="0.9rem" />}
          disabled={busy}
          onClick={() => setEditing(true)}
        >
          {t("Settings.Cloud.Link")}
        </Button>
      )}
    </AccountRow>
  );
}

function SyncStatus() {
  const { t, i18n } = useTranslation();
  const status = useAtomValue(cloudSyncStatusAtom);
  const syncing = status.state === "syncing";
  const rep = status.repertoires;

  return (
    <Stack gap="xs">
      <Divider label={t("Settings.Cloud.Sync")} labelPosition="left" />
      <Text size="sm" c="dimmed">
        {t("Settings.Cloud.Sync.Desc")}
      </Text>
      <Group justify="space-between">
        <Text size="sm">
          {syncing
            ? t("Settings.Cloud.Sync.Running")
            : status.lastSync
              ? t("Settings.Cloud.Sync.Last", {
                  time: new Date(status.lastSync).toLocaleTimeString(i18n.language),
                })
              : t("Settings.Cloud.Sync.Never")}
        </Text>
        <Button
          size="compact-sm"
          variant="light"
          leftSection={<IconRefresh size="0.9rem" />}
          loading={syncing}
          onClick={() => void syncNow()}
        >
          {t("Settings.Cloud.Sync.Now")}
        </Button>
      </Group>
      {status.lastSync && !syncing && (
        <Text size="xs" c="dimmed">
          {t("Settings.Cloud.Sync.Result", {
            up: (rep?.uploaded ?? 0) + (status.trainingUploaded ?? 0),
            down: (rep?.downloaded ?? 0) + (status.trainingDownloaded ?? 0),
          })}
        </Text>
      )}
      {status.state === "error" && (
        <Alert color="red" title={t("Settings.Cloud.Sync.Failed")}>
          {status.error}
        </Alert>
      )}
      {rep && rep.conflicts > 0 && (
        <Alert color="yellow">{t("Settings.Cloud.Sync.Conflicts", { count: rep.conflicts })}</Alert>
      )}
      {rep && rep.tooBig.length > 0 && (
        <Alert color="yellow">
          {t("Settings.Cloud.Sync.TooBig", { files: rep.tooBig.join(", ") })}
        </Alert>
      )}
      {rep?.deletionsHeld && <Alert color="yellow">{t("Settings.Cloud.Sync.DeletionsHeld")}</Alert>}
    </Stack>
  );
}
