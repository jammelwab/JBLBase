import {
  Alert,
  Anchor,
  Button,
  Checkbox,
  Group,
  List,
  Modal,
  ScrollArea,
  Stack,
  Tabs,
  Text,
} from "@mantine/core";
import { IconFileText, IconShieldLock } from "@tabler/icons-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { MIN_AGE, type LegalDocument } from "@/legal/legal";
import type { ConsentMethod } from "@/utils/cloud/consent";
import { LegalText } from "./LegalText";

const SOURCE_URL = "https://github.com/jammelwab/JBLBase";

/**
 * Asks for agreement to the terms of use and the privacy policy: before an
 * account is created ("register", "lichess") or when the texts changed
 * ("update"). Nothing happens until all boxes are ticked.
 */
type Props = {
  opened: boolean;
  method: ConsentMethod;
  busy?: boolean;
  error?: string | null;
  onAccept: () => void;
  onCancel: () => void;
};

export default function ConsentModal(props: Props) {
  const { t } = useTranslation();
  const { opened, method, onCancel } = props;
  return (
    <Modal
      opened={opened}
      onClose={onCancel}
      closeOnClickOutside={false}
      withCloseButton={method !== "update"}
      closeOnEscape={method !== "update"}
      size="lg"
      zIndex={400}
      title={
        <Text fw={600}>
          {method === "update" ? t("Login.Consent.TitleUpdate") : t("Login.Consent.Title")}
        </Text>
      }
    >
      {/* The content unmounts when closed, so the boxes start empty each time. */}
      <ConsentBody {...props} />
    </Modal>
  );
}

function ConsentBody({ method, busy = false, error, onAccept, onCancel }: Props) {
  const { t } = useTranslation();
  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [age, setAge] = useState(false);
  const [tab, setTab] = useState<"summary" | LegalDocument>("summary");

  const all = terms && privacy && age;
  const docLink = (doc: LegalDocument) => (chunks: string) => (
    <Anchor component="button" type="button" inherit onClick={() => setTab(doc)}>
      {chunks}
    </Anchor>
  );

  return (
    <Stack gap="md">
      <Text size="sm">
        {method === "update"
          ? t("Login.Consent.IntroUpdate")
          : method === "lichess"
            ? t("Login.Consent.IntroLichess")
            : t("Login.Consent.Intro")}
      </Text>

      <Tabs value={tab} onChange={(v) => v && setTab(v as typeof tab)}>
        <Tabs.List grow>
          <Tabs.Tab value="summary">{t("Login.Consent.Summary")}</Tabs.Tab>
          <Tabs.Tab value="terms" leftSection={<IconFileText size="0.9rem" />}>
            {t("Login.Consent.Terms")}
          </Tabs.Tab>
          <Tabs.Tab value="privacy" leftSection={<IconShieldLock size="0.9rem" />}>
            {t("Login.Consent.Privacy")}
          </Tabs.Tab>
        </Tabs.List>
        <ScrollArea h={300} type="auto" offsetScrollbars mt="sm">
          {tab === "summary" ? (
            <List size="sm" spacing={6}>
              <List.Item>
                {t("Login.Consent.Point.OpenSource")}{" "}
                <Anchor href={SOURCE_URL} target="_blank" rel="noreferrer" inherit>
                  {t("Login.Consent.SourceCode")}
                </Anchor>
              </List.Item>
              <List.Item>{t("Login.Consent.Point.Free")}</List.Item>
              <List.Item>{t("Login.Consent.Point.Data")}</List.Item>
              <List.Item>{t("Login.Consent.Point.NoTracking")}</List.Item>
              <List.Item>{t("Login.Consent.Point.ThirdParties")}</List.Item>
              <List.Item>{t("Login.Consent.Point.Backup")}</List.Item>
              <List.Item>{t("Login.Consent.Point.Delete")}</List.Item>
            </List>
          ) : (
            <LegalText doc={tab} />
          )}
        </ScrollArea>
      </Tabs>

      <Stack gap="xs">
        <Checkbox
          checked={terms}
          onChange={(e) => setTerms(e.currentTarget.checked)}
          label={
            <>
              {t("Login.Consent.AcceptTerms.Before")}
              {docLink("terms")(t("Login.Consent.Terms"))}
              {t("Login.Consent.AcceptTerms.After")}
            </>
          }
        />
        <Checkbox
          checked={privacy}
          onChange={(e) => setPrivacy(e.currentTarget.checked)}
          label={
            <>
              {t("Login.Consent.AcceptPrivacy.Before")}
              {docLink("privacy")(t("Login.Consent.Privacy"))}
              {t("Login.Consent.AcceptPrivacy.After")}
            </>
          }
        />
        <Checkbox
          checked={age}
          onChange={(e) => setAge(e.currentTarget.checked)}
          label={t("Login.Consent.Age", { age: MIN_AGE })}
        />
      </Stack>

      {error && <Alert color="red">{error}</Alert>}

      <Group justify="flex-end">
        <Button variant="default" onClick={onCancel} disabled={busy}>
          {method === "update" ? t("Settings.Cloud.SignOut") : t("Common.Cancel")}
        </Button>
        <Button disabled={!all} loading={busy} onClick={onAccept}>
          {method === "register"
            ? t("Login.Consent.AcceptRegister")
            : method === "lichess"
              ? t("Login.Consent.AcceptLichess")
              : t("Login.Consent.Accept")}
        </Button>
      </Group>
    </Stack>
  );
}
