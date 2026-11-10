import { notifications } from "@mantine/notifications";
import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { getDefaultStore } from "jotai";
import { cloudErrorKey, saveProfile, signInWithLichessToken } from "@/utils/cloud/auth";
import { cloudAccountAtom, signedInBefore, startCloudSync } from "@/utils/cloud/sync";
import { linkLichess, loginScreenOpenAtom, loginSkipped } from "./cloudUi";
import LoginScreen from "./LoginScreen";

/**
 * App-wide part of the JBLBase account: starts the sync, shows the sign-in
 * at the first start and handles the Lichess token from the browser login
 * (sign in when signed out, link the account when signed in).
 */
export default function CloudRoot() {
  const { t } = useTranslation();

  useEffect(() => startCloudSync(), []);

  useEffect(() => {
    if (!signedInBefore() && !loginSkipped()) {
      getDefaultStore().set(loginScreenOpenAtom, true);
    }
  }, []);

  useEffect(() => {
    const unlisten = listen<string>("cloud_lichess_token", async (event) => {
      const account = getDefaultStore().get(cloudAccountAtom);
      try {
        if (account) {
          const username = await linkLichess(account.uid, event.payload);
          notifications.show({
            color: "green",
            message: t("Settings.Cloud.LichessLinked", { username }),
          });
        } else {
          startCloudSync(true);
          const { uid, username } = await signInWithLichessToken(event.payload);
          await saveProfile(uid, { lichess: username });
        }
      } catch (e) {
        notifications.show({ color: "red", message: t(cloudErrorKey(e)) });
      }
    });
    return () => {
      void unlisten.then((f) => f());
    };
  }, [t]);

  return <LoginScreen />;
}
