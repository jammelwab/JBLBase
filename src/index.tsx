import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import i18n from "i18next";
import { createRoot } from "react-dom/client";
import { initReactI18next } from "react-i18next";
import App from "./App";

import en_US from "./translation/en-US.json";
import { setAutoFreeze } from "immer";
import LanguageDetector from "i18next-browser-languagedetector";
import { locale } from "@tauri-apps/plugin-os";
import { getDefaultStore } from "jotai";
import {
  LANGUAGES,
  languagePromptAtom,
  needsLanguageChoice,
  systemLanguage,
} from "./utils/language";

const lazyTranslations = import.meta.glob(["./translation/*.json", "!./translation/en-US.json"]);

// Profile without a language yet (first start, or a new account): start in the
// system language and ask once (see LanguagePrompt).
const askLanguage = needsLanguageChoice();
const startLanguage = askLanguage
  ? locale()
      .catch(() => null)
      .then((os) => systemLanguage([os, ...(navigator.languages ?? []), navigator.language]))
  : Promise.resolve(undefined);

const i18nReady = startLanguage.then((lng) => {
  if (lng) getDefaultStore().set(languagePromptAtom, lng);
  return initI18n(lng);
});

function initI18n(lng: string | undefined) {
  return i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .use({
      // Only English (the fallback) is bundled; the chosen language is loaded on
      // demand, so the start does not parse all 16 translations (~900 KB).
      type: "backend",
      read(language: string, namespace: string, callback: (err: unknown, data?: unknown) => void) {
        const load = lazyTranslations[`./translation/${language}.json`];
        if (!load) return callback(null, {});
        load().then(
          (module) =>
            callback(null, (module as { default: Record<string, unknown> }).default[namespace]),
          (err) => callback(err),
        );
      },
    })
    .init({
      resources: { "en-US": en_US },
      partialBundledLanguages: true,
      lng,
      supportedLngs: [...LANGUAGES],
      detection: {
        order: ["localStorage"],
        caches: ["localStorage"],
      },
      fallbackLng: "en-US",
      returnEmptyString: false,
    });
}

dayjs.extend(customParseFormat);

setAutoFreeze(false);

// Render once the saved language is loaded, so the app does not flash English.
void i18nReady.finally(() => {
  const container = document.getElementById("app");
  const root = createRoot(container!);
  root.render(<App />);
});
