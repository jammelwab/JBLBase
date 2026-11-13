import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import i18n from "i18next";
import { createRoot } from "react-dom/client";
import { initReactI18next } from "react-i18next";
import App from "./App";

import en_US from "./translation/en-US.json";
import { setAutoFreeze } from "immer";
import LanguageDetector from "i18next-browser-languagedetector";

const lazyTranslations = import.meta.glob(["./translation/*.json", "!./translation/en-US.json"]);

const i18nReady = i18n
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
    supportedLngs: [
      "en-US",
      "en-GB",
      "pt-PT",
      "zh-CN",
      "ru-RU",
      "uk-UA",
      "be-BY",
      "nb-NO",
      "pl-PL",
      "es-ES",
      "it-IT",
      "fr-FR",
      "tr-TR",
      "ko-KR",
      "zh-TW",
      "de-DE",
    ],
    detection: {
      order: ["localStorage"],
      caches: ["localStorage"],
    },
    fallbackLng: "en-US",
    returnEmptyString: false,
  });

dayjs.extend(customParseFormat);

setAutoFreeze(false);

// Render once the saved language is loaded, so the app does not flash English.
void i18nReady.finally(() => {
  const container = document.getElementById("app");
  const root = createRoot(container!);
  root.render(<App />);
});
