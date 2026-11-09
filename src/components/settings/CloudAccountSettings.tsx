import {
  Alert,
  Anchor,
  Badge,
  Button,
  Divider,
  Group,
  Loader,
  PasswordInput,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { IconCloud, IconLogout, IconRefresh } from "@tabler/icons-react";
import { listen } from "@tauri-apps/api/event";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { commands } from "@/bindings";
import LichessLogo from "@/components/home/LichessLogo";
import { getChessComAccount } from "@/utils/chess.com/api";
import {
  type CloudAccount,
  type CloudProfile,
  cloudErrorKey,
  loadProfile,
  normalizeChessComUsername,
  registerWithEmail,
  resendVerification,
  resetPassword,
  saveProfile,
  signInWithEmail,
  signInWithLichessToken,
  signOutCloud,
  watchCloudAccount,
} from "@/utils/cloud/auth";
import { cloudSyncStatusAtom, startCloudSync, syncNow } from "@/utils/cloud/sync";

type Message = { color: "red" | "green" | "blue"; text: string };

export default function CloudAccountSettings() {
  const { t } = useTranslation();
  const [account, setAccount] = useState<CloudAccount | null | undefined>(undefined);
  const [message, setMessage] = useState<Message | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async (action: () => Promise<void>, success?: string) => {
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

  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    watchCloudAccount((a) => {
      setAccount(a);
      if (a) startCloudSync(true);
    })
      .then((unsubscribe) => {
        if (cancelled) unsubscribe();
        else stop = unsubscribe;
      })
      .catch(() => setAccount(null));
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  useEffect(() => {
    const unlisten = listen<string>("cloud_lichess_token", (event) => {
      run(async () => {
        const { uid, username } = await signInWithLichessToken(event.payload);
        await saveProfile(uid, { lichess: username });
      });
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, [run]);

  if (account === undefined) return <Loader size="sm" />;

  return (
    <Stack>
      {message && (
        <Alert color={message.color} withCloseButton onClose={() => setMessage(null)}>
          {message.text}
        </Alert>
      )}
      {account ? (
        <SignedIn account={account} busy={busy} run={run} />
      ) : (
        <SignedOut busy={busy} run={run} />
      )}
    </Stack>
  );
}

type RunProps = {
  busy: boolean;
  run: (action: () => Promise<void>, success?: string) => Promise<void>;
};

function SignedOut({ busy, run }: RunProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  return (
    <Stack maw={400}>
      <Text size="sm">{t("Settings.Cloud.Intro")}</Text>
      <SegmentedControl
        value={mode}
        onChange={(v) => setMode(v as "login" | "register")}
        data={[
          { value: "login", label: t("Settings.Cloud.SignIn") },
          { value: "register", label: t("Settings.Cloud.Register") },
        ]}
      />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(
            () =>
              mode === "login"
                ? signInWithEmail(email, password)
                : registerWithEmail(email, password),
            mode === "register" ? "Settings.Cloud.Registered" : undefined,
          );
        }}
      >
        <Stack gap="xs">
          <TextInput
            label={t("Settings.Cloud.Email")}
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
            required
          />
          <PasswordInput
            label={t("Settings.Cloud.Password")}
            description={mode === "register" ? t("Settings.Cloud.Password.Desc") : undefined}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
            minLength={mode === "register" ? 8 : undefined}
            required
          />
          <Group justify="space-between">
            {mode === "login" ? (
              <Anchor
                component="button"
                type="button"
                size="sm"
                disabled={busy}
                onClick={() => run(() => resetPassword(email), "Settings.Cloud.ResetSent")}
              >
                {t("Settings.Cloud.ForgotPassword")}
              </Anchor>
            ) : (
              <span />
            )}
            <Button type="submit" loading={busy} leftSection={<IconCloud size="1rem" />}>
              {mode === "login" ? t("Settings.Cloud.SignIn") : t("Settings.Cloud.Register")}
            </Button>
          </Group>
        </Stack>
      </form>
      <Divider label={t("Settings.Cloud.Or")} />
      <Button
        variant="default"
        leftSection={<LichessLogo />}
        disabled={busy}
        onClick={() =>
          run(async () => {
            const res = await commands.authenticateCloud();
            if (res.status === "error") throw new Error(res.error);
          }, "Settings.Cloud.LichessBrowser")
        }
      >
        {t("Settings.Cloud.SignInLichess")}
      </Button>
    </Stack>
  );
}

function SignedIn({ account, busy, run }: RunProps & { account: CloudAccount }) {
  const { t } = useTranslation();
  const [profile, setProfile] = useState<CloudProfile | null>(null);
  const [chessCom, setChessCom] = useState("");

  useEffect(() => {
    let cancelled = false;
    loadProfile(account.uid)
      .then((p) => {
        if (cancelled) return;
        setProfile(p);
        setChessCom(p.chesscom ?? "");
      })
      .catch(() => !cancelled && setProfile({}));
    return () => {
      cancelled = true;
    };
  }, [account.uid]);

  const name = account.method === "lichess" ? account.displayName : account.email;

  async function saveChessCom() {
    const trimmed = chessCom.trim();
    if (trimmed) {
      const username = normalizeChessComUsername(trimmed);
      if (!username) throw Object.assign(new Error(), { code: "chesscom/invalid" });
      // Shows its own notification when the account does not exist.
      if (!(await getChessComAccount(username))) return;
    }
    await saveProfile(account.uid, { chesscom: trimmed });
    setProfile((p) => ({ ...p, chesscom: trimmed || undefined }));
  }

  return (
    <Stack maw={480}>
      <Group gap="xs">
        {account.method === "lichess" && <LichessLogo />}
        <Text fw={500}>{name}</Text>
        <Badge variant="light" color={account.role === "admin" ? "orange" : "blue"}>
          {account.role === "admin" ? t("Settings.Cloud.RoleAdmin") : t("Settings.Cloud.RoleUser")}
        </Badge>
      </Group>
      <Text size="xs" c="dimmed">
        {account.role === "admin"
          ? t("Settings.Cloud.RoleAdmin.Desc")
          : t("Settings.Cloud.RoleUser.Desc")}
      </Text>
      {account.method === "email" && !account.emailVerified && (
        <Alert color="yellow">
          <Group justify="space-between">
            <Text size="sm">{t("Settings.Cloud.NotVerified")}</Text>
            <Button
              size="compact-sm"
              variant="light"
              disabled={busy}
              onClick={() => run(resendVerification, "Settings.Cloud.VerificationSent")}
            >
              {t("Settings.Cloud.ResendVerification")}
            </Button>
          </Group>
        </Alert>
      )}

      <Divider label={t("Settings.Cloud.Linked")} labelPosition="left" />
      {profile === null ? (
        <Loader size="sm" />
      ) : (
        <Stack gap="xs">
          <Text size="sm">Lichess: {profile.lichess ?? t("Settings.Cloud.LichessOnlyLogin")}</Text>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(saveChessCom, "Settings.Cloud.Saved");
            }}
          >
            <Group align="flex-end">
              <TextInput
                label="Chess.com"
                description={t("Settings.Cloud.ChessCom.Desc")}
                value={chessCom}
                onChange={(e) => setChessCom(e.currentTarget.value)}
                flex={1}
              />
              <Button
                type="submit"
                variant="light"
                loading={busy}
                disabled={chessCom.trim() === (profile.chesscom ?? "")}
              >
                {t("Common.Save")}
              </Button>
            </Group>
          </form>
        </Stack>
      )}

      <SyncStatus />

      <Group justify="flex-end">
        <Button
          variant="subtle"
          color="red"
          leftSection={<IconLogout size="1rem" />}
          disabled={busy}
          onClick={() => run(signOutCloud)}
        >
          {t("Settings.Cloud.SignOut")}
        </Button>
      </Group>
    </Stack>
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
