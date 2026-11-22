import { Button, Group, Modal, Stack, Text } from "@mantine/core";
import { useAtomValue } from "jotai";
import { useTranslation } from "react-i18next";
import { answerClaim, profileClaimAtom } from "@/utils/profile";

/**
 * Einmalig nach dem Update auf 1.2.13: Gehören die Daten auf diesem Gerät
 * (Repertoires, Einstellungen, Coach, Training) zum angemeldeten Konto?
 * Bis zur Antwort gleicht die Cloud nichts ab.
 */
export default function ProfileClaim() {
  const { t } = useTranslation();
  const claim = useAtomValue(profileClaimAtom);
  return (
    <Modal
      opened={claim !== null}
      onClose={() => {}}
      withCloseButton={false}
      closeOnClickOutside={false}
      closeOnEscape={false}
      centered
      title={t("Profile.Claim.Title")}
      styles={{ title: { fontWeight: 700 } }}
    >
      {claim && (
        <Stack gap="md">
          <Text size="sm">{t("Profile.Claim.Text", { account: claim.email ?? claim.uid })}</Text>
          <Text size="sm" c="dimmed">
            {t("Profile.Claim.Hint", { account: claim.email ?? claim.uid })}
          </Text>
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={() => answerClaim(claim.uid, false)}>
              {t("Profile.Claim.No")}
            </Button>
            <Button onClick={() => answerClaim(claim.uid, true)}>{t("Profile.Claim.Yes")}</Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
