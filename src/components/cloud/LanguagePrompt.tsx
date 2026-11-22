import { Button, Image, Modal, Stack, Text } from "@mantine/core";
import { getDefaultStore, useAtomValue } from "jotai";
import { useTranslation } from "react-i18next";
import { signedInBefore } from "@/utils/cloud/sync";
import {
  type Language,
  LANGUAGE_NAMES,
  languageOptions,
  languagePromptAtom,
  markLanguageChosen,
} from "@/utils/language";
import { loginScreenOpenAtom, loginSkipped } from "./cloudUi";

/**
 * At the first start, and the first time an account opens its own profile:
 * which language? The system language or English. Shown before the sign-in,
 * so that is already in the chosen language. Changeable in the settings.
 */
export default function LanguagePrompt() {
  const { t, i18n } = useTranslation();
  const system = useAtomValue(languagePromptAtom);
  if (!system) return null;

  const choose = async (lng: Language) => {
    await i18n.changeLanguage(lng);
    markLanguageChosen();
    const store = getDefaultStore();
    store.set(languagePromptAtom, null);
    if (!signedInBefore() && !loginSkipped()) store.set(loginScreenOpenAtom, true);
  };

  // The question also in English, for when the system language is not the one wanted
  const en = i18n.getFixedT("en-US");
  const showEnglish = t("Language.Prompt.Title") !== en("Language.Prompt.Title");

  return (
    <Modal
      opened
      onClose={() => {}}
      withCloseButton={false}
      closeOnClickOutside={false}
      closeOnEscape={false}
      centered
      size="sm"
      zIndex={400}
    >
      <Stack align="center" gap="lg" py="sm">
        <Image src="/logo.png" w={56} h={56} alt="" />
        <Stack align="center" gap={2}>
          <Text fw={700} size="lg" ta="center">
            {t("Language.Prompt.Title")}
          </Text>
          {showEnglish && (
            <Text c="dimmed" size="sm" ta="center">
              {en("Language.Prompt.Title")}
            </Text>
          )}
        </Stack>
        <Stack gap="sm" w="100%">
          {languageOptions(system).map((lng, i) => (
            <Button
              key={lng}
              size="md"
              fullWidth
              variant={i === 0 ? "filled" : "default"}
              onClick={() => void choose(lng)}
              data-autofocus={i === 0 || undefined}
            >
              {i === 0
                ? `${LANGUAGE_NAMES[lng]} (${t("Language.Prompt.System")})`
                : LANGUAGE_NAMES[lng]}
            </Button>
          ))}
        </Stack>
        <Text c="dimmed" size="xs" ta="center">
          {t("Language.Prompt.Hint")}
        </Text>
      </Stack>
    </Modal>
  );
}
