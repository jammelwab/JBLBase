import { notifications } from "@mantine/notifications";
import { ask, message } from "@tauri-apps/plugin-dialog";
import { error, info } from "@tauri-apps/plugin-log";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import type { TFunction } from "i18next";
import { UPDATES_ENABLED } from "@/utils/fork";

let running = false;

/**
 * Checks GitHub releases of JBLBase for a newer version and, after asking,
 * downloads, installs and restarts. With `silent` (start-up check) nothing is
 * shown unless an update exists.
 */
export async function checkForAppUpdate(t: TFunction, { silent = false } = {}) {
    if (!UPDATES_ENABLED || running) return;
    running = true;
    const id = "app-update";
    try {
        const update = await check();
        if (!update) {
            if (!silent) await message(t("Updater.UpToDate"), { title: "JBLBase" });
            return;
        }
        info(`Update available: ${update.currentVersion} -> ${update.version}`);
        const yes = await ask(
            t("Updater.Available.Message", {
                current: update.currentVersion,
                version: update.version,
            }),
            {
                title: t("Updater.Available.Title"),
                okLabel: t("Updater.Install"),
                cancelLabel: t("Updater.Later"),
            },
        );
        if (!yes) return;

        let total = 0;
        let downloaded = 0;
        notifications.show({
            id,
            title: t("Updater.Downloading"),
            message: "0 %",
            loading: true,
            autoClose: false,
            withCloseButton: false,
        });
        await update.downloadAndInstall((event) => {
            if (event.event === "Started") total = event.data.contentLength ?? 0;
            if (event.event === "Progress") {
                downloaded += event.data.chunkLength;
                if (total > 0) {
                    notifications.update({
                        id,
                        message: `${Math.round((downloaded / total) * 100)} %`,
                    });
                }
            }
        });
        notifications.update({ id, title: t("Updater.Restarting"), message: "", loading: true });
        await relaunch();
    } catch (cause) {
        const msg = cause instanceof Error ? cause.message : String(cause);
        void error(`Update failed: ${msg}`).catch(console.error);
        notifications.hide(id);
        if (!silent) {
            notifications.show({ title: t("Updater.Failed"), message: msg, color: "red" });
        }
    } finally {
        running = false;
    }
}
