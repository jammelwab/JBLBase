import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  Paper,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconLock, IconSend } from "@tabler/icons-react";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { useAtomValue, useSetAtom } from "jotai";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import useSWR from "swr";
import { loginScreenOpenAtom } from "@/components/cloud/cloudUi";
import { cloudFirestore } from "@/utils/cloud/auth";
import {
  cloudShares,
  ownRecipientKeys,
  parseRecipient,
  recipientLabel,
} from "@/utils/cloud/shares";
import { cloudAccountAtom, shareOwnerName, syncNow } from "@/utils/cloud/sync";
import type { Repertoire } from "@/utils/repertoires";
import { trackUsage } from "@/utils/usageStats";

const shares = async () => cloudShares(await cloudFirestore());

// Shares one repertoire with other accounts (#120): who has it, invite someone, withdraw.
export default function ShareRepertoireModal({
  repertoire,
  onClose,
}: {
  repertoire: Repertoire;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const account = useAtomValue(cloudAccountAtom);
  const openLogin = useSetAtom(loginScreenOpenAtom);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { cloudId } = repertoire;
  const {
    data: list,
    isLoading,
    mutate,
  } = useSWR(account && cloudId ? ["shares-own", account.uid, cloudId] : null, async () =>
    (await (await shares()).listOwn(account!.uid)).filter((s) => s.sourceId === cloudId),
  );

  async function invite() {
    if (!account || !cloudId) return;
    const key = parseRecipient(input);
    if (!key) {
      setError(t("Repertoire.Share.Invalid"));
      return;
    }
    if (ownRecipientKeys(account).includes(key)) {
      setError(t("Repertoire.Share.Self"));
      return;
    }
    if (list?.some((s) => s.recipientKey === key)) {
      setError(t("Repertoire.Share.Already"));
      return;
    }
    setBusy(true);
    try {
      await (
        await shares()
      ).create(account.uid, key, cloudId, {
        ownerName: shareOwnerName(account),
        name: repertoire.name,
        color: repertoire.color,
        pgn: await readTextFile(repertoire.file.path),
      });
      setInput("");
      trackUsage("repertoire_share");
      await mutate();
      notifications.show({
        color: "green",
        title: repertoire.name,
        message: t("Repertoire.Share.Sent", { who: recipientLabel(key) }),
      });
    } catch (e) {
      setError(
        e instanceof Error && e.message === "too-big"
          ? t("Repertoire.Share.TooBig")
          : e instanceof Error
            ? e.message
            : String(e),
      );
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(id: string, who: string) {
    try {
      await (await shares()).remove(id);
      await mutate();
      notifications.show({
        title: repertoire.name,
        message: t("Repertoire.Share.Withdrawn", { who }),
      });
    } catch (e) {
      notifications.show({
        color: "red",
        title: repertoire.name,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return (
    <Modal opened onClose={onClose} title={t("Repertoire.Share.Title", { name: repertoire.name })}>
      <Stack gap="sm">
        <Alert color="gray" variant="light" icon={<IconLock size="1rem" />}>
          <Text size="sm">{t("Repertoire.Share.Privacy")}</Text>
        </Alert>
        {!account ? (
          <Stack gap="xs">
            <Text size="sm">{t("Repertoire.Share.SignIn")}</Text>
            <Button variant="light" onClick={() => openLogin(true)}>
              {t("Repertoire.Share.SignInButton")}
            </Button>
          </Stack>
        ) : !cloudId ? (
          <Stack gap="xs">
            <Text size="sm">{t("Repertoire.Share.NotSynced")}</Text>
            <Button variant="light" onClick={() => void syncNow()}>
              {t("Repertoire.Share.SyncNow")}
            </Button>
          </Stack>
        ) : (
          <>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void invite();
              }}
            >
              <Group align="flex-end" wrap="nowrap">
                <TextInput
                  style={{ flex: 1 }}
                  label={t("Repertoire.Share.Recipient")}
                  description={t("Repertoire.Share.RecipientHint")}
                  placeholder="aaron@example.org"
                  value={input}
                  onChange={(e) => {
                    setInput(e.currentTarget.value);
                    setError("");
                  }}
                  error={error}
                  data-autofocus
                />
                <Button
                  type="submit"
                  loading={busy}
                  leftSection={<IconSend size="1rem" />}
                  disabled={!input.trim()}
                >
                  {t("Repertoire.Share.Invite")}
                </Button>
              </Group>
            </form>
            <Text fw={600} size="sm">
              {t("Repertoire.Share.SharedWith")}
            </Text>
            {isLoading ? (
              <Loader size="xs" />
            ) : (list ?? []).length === 0 ? (
              <Text size="sm" c="dimmed">
                {t("Repertoire.Share.Nobody")}
              </Text>
            ) : (
              (list ?? []).map((s) => (
                <Paper key={s.id} withBorder p="xs">
                  <Group justify="space-between" wrap="nowrap">
                    <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
                      <Text size="sm" truncate="end">
                        {recipientLabel(s.recipientKey)}
                      </Text>
                      <Badge
                        size="sm"
                        variant="light"
                        color={s.status === "accepted" ? "green" : "yellow"}
                      >
                        {s.status === "accepted"
                          ? t("Repertoire.Share.Accepted")
                          : t("Repertoire.Share.Pending")}
                      </Badge>
                    </Group>
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      color="red"
                      onClick={() => withdraw(s.id, recipientLabel(s.recipientKey))}
                    >
                      {t("Repertoire.Share.Withdraw")}
                    </Button>
                  </Group>
                </Paper>
              ))
            )}
            <Text size="xs" c="dimmed">
              {t("Repertoire.Share.UpdatesHint")}
            </Text>
          </>
        )}
      </Stack>
    </Modal>
  );
}
