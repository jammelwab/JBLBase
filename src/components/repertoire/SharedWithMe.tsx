import { Badge, Button, Group, Paper, Stack, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconShare } from "@tabler/icons-react";
import { useAtomValue } from "jotai";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import useSWR from "swr";
import { cloudFirestore } from "@/utils/cloud/auth";
import { cloudShares, ownRecipientKeys, type ShareWithPgn } from "@/utils/cloud/shares";
import { cloudAccountAtom, syncNow } from "@/utils/cloud/sync";
import { ColorDot } from "./RepertoireLabel";

const shares = async () => cloudShares(await cloudFirestore());

/** Withdraws a share as its recipient (declining it, or deleting its file). */
export async function declineShare(id: string) {
  await (await shares()).remove(id);
}

// Repertoires other accounts want to share with this one (#120). Nothing is received
// before the recipient accepts here.
export default function SharedWithMe() {
  const { t } = useTranslation();
  const account = useAtomValue(cloudAccountAtom);
  const keys = account ? ownRecipientKeys(account) : [];
  const [busy, setBusy] = useState<string | null>(null);
  const { data, mutate } = useSWR(
    account && keys.length > 0 ? ["shares-incoming", account.uid, ...keys] : null,
    async () => (await (await shares()).listIncoming(keys)).filter((s) => s.status === "pending"),
    { revalidateOnFocus: false },
  );
  if (!account || !data || data.length === 0) return null;

  async function answer(share: ShareWithPgn, accept: boolean) {
    if (!account) return;
    setBusy(share.id);
    try {
      const cloud = await shares();
      if (accept) await cloud.accept(share.id, account.uid);
      else await cloud.remove(share.id);
      await mutate();
      notifications.show({
        color: accept ? "green" : undefined,
        title: share.name,
        message: accept
          ? t("Repertoire.Share.AcceptedNote", { name: share.ownerName })
          : t("Repertoire.Share.Declined"),
      });
      if (accept) await syncNow();
    } catch (e) {
      notifications.show({
        color: "red",
        title: share.name,
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Paper withBorder p="md" data-tour="rep-shared-with-me">
      <Stack gap="xs">
        <Group gap="xs">
          <IconShare size="1.1rem" />
          <Title order={5}>{t("Repertoire.Share.Incoming")}</Title>
          <Badge size="sm" variant="light">
            {data.length}
          </Badge>
        </Group>
        <Text size="sm" c="dimmed">
          {t("Repertoire.Share.IncomingHint")}
        </Text>
        {data.map((s) => (
          <Group key={s.id} justify="space-between" wrap="nowrap">
            <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
              <ColorDot color={s.color} />
              <Text size="sm" fw={600} truncate="end">
                {s.name}
              </Text>
              <Text size="sm" c="dimmed" truncate="end">
                {t("Repertoire.Share.FromLine", { name: s.ownerName })}
              </Text>
            </Group>
            <Group gap="xs" wrap="nowrap">
              <Button
                size="compact-sm"
                loading={busy === s.id}
                disabled={!!busy && busy !== s.id}
                onClick={() => answer(s, true)}
              >
                {t("Repertoire.Share.Accept")}
              </Button>
              <Button
                size="compact-sm"
                variant="subtle"
                color="gray"
                disabled={!!busy}
                onClick={() => answer(s, false)}
              >
                {t("Repertoire.Share.Decline")}
              </Button>
            </Group>
          </Group>
        ))}
      </Stack>
    </Paper>
  );
}
