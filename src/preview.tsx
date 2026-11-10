import "@mantine/core/styles.css";
import { Box, MantineProvider, Text } from "@mantine/core";
import i18n from "i18next";
import { getDefaultStore, Provider } from "jotai";
import { createRoot } from "react-dom/client";
import { initReactI18next } from "react-i18next";
import LoginScreen from "@/components/cloud/LoginScreen";
import { loginScreenOpenAtom } from "@/components/cloud/cloudUi";
import de_DE from "./translation/de-DE.json";

i18n.use(initReactI18next).init({ resources: { "de-DE": de_DE }, lng: "de-DE", fallbackLng: "de-DE" });
const store = getDefaultStore();
store.set(loginScreenOpenAtom, true);
createRoot(document.getElementById("root")!).render(
  <Provider store={store}>
    <MantineProvider defaultColorScheme="dark">
      <Box p="xl">{Array.from({ length: 30 }, (_, i) => <Text key={i} size="xl">Startseite Hintergrund {i}</Text>)}</Box>
      <LoginScreen />
    </MantineProvider>
  </Provider>,
);
