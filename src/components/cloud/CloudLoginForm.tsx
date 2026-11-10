import {
  Alert,
  Anchor,
  Button,
  Divider,
  Group,
  PasswordInput,
  SegmentedControl,
  Stack,
  TextInput,
} from "@mantine/core";
import { IconAt, IconLock } from "@tabler/icons-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import LichessLogo from "@/components/home/LichessLogo";
import {
  cloudErrorKey,
  registerWithEmail,
  resetPassword,
  signInWithEmail,
} from "@/utils/cloud/auth";
import { startCloudSync } from "@/utils/cloud/sync";
import { startLichessLogin } from "./cloudUi";

type Message = { color: "red" | "green" | "blue"; text: string };

/** Sign in or register with e-mail, or sign in with Lichess. */
export default function CloudLoginForm() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  async function run(
    action: () => Promise<void>,
    success?: string,
    color: Message["color"] = "green",
  ) {
    setBusy(true);
    setMessage(null);
    // Watch the account from now on, so the app notices the sign-in.
    startCloudSync(true);
    try {
      await action();
      if (success) setMessage({ color, text: t(success) });
    } catch (e) {
      setMessage({ color: "red", text: t(cloudErrorKey(e)) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack gap="md">
      <SegmentedControl
        fullWidth
        value={mode}
        onChange={(v) => {
          setMode(v as "login" | "register");
          setMessage(null);
        }}
        data={[
          { value: "login", label: t("Settings.Cloud.SignIn") },
          { value: "register", label: t("Settings.Cloud.Register") },
        ]}
      />
      {message && (
        <Alert color={message.color} withCloseButton onClose={() => setMessage(null)}>
          {message.text}
        </Alert>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(
            () =>
              mode === "login"
                ? signInWithEmail(email, password)
                : registerWithEmail(email, password),
            mode === "register" ? "Settings.Cloud.Registered" : undefined,
          );
        }}
      >
        <Stack gap="sm">
          <TextInput
            label={t("Settings.Cloud.Email")}
            type="email"
            autoComplete="email"
            leftSection={<IconAt size="1rem" />}
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
            required
            data-autofocus
          />
          <PasswordInput
            label={t("Settings.Cloud.Password")}
            description={mode === "register" ? t("Settings.Cloud.Password.Desc") : undefined}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            leftSection={<IconLock size="1rem" />}
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
            minLength={mode === "register" ? 8 : undefined}
            required
          />
          {mode === "login" && (
            <Group justify="flex-end">
              <Anchor
                component="button"
                type="button"
                size="xs"
                disabled={busy}
                onClick={() => void run(() => resetPassword(email), "Settings.Cloud.ResetSent")}
              >
                {t("Settings.Cloud.ForgotPassword")}
              </Anchor>
            </Group>
          )}
          <Button type="submit" fullWidth loading={busy}>
            {mode === "login" ? t("Settings.Cloud.SignIn") : t("Settings.Cloud.CreateAccount")}
          </Button>
        </Stack>
      </form>
      <Divider label={t("Settings.Cloud.Or")} labelPosition="center" />
      <Button
        fullWidth
        variant="default"
        leftSection={<LichessLogo />}
        disabled={busy}
        onClick={() => void run(startLichessLogin, "Settings.Cloud.LichessBrowser", "blue")}
      >
        {t("Settings.Cloud.SignInLichess")}
      </Button>
    </Stack>
  );
}
