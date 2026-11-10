import { notifications } from "@mantine/notifications";
import { ask, message } from "@tauri-apps/plugin-dialog";
import { error, info } from "@tauri-apps/plugin-log";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import type { TFunction } from "i18next";
import { atom, getDefaultStore } from "jotai";
import { UPDATES_ENABLED } from "@/utils/fork";

/** A newer JBLBase release, shown as the download arrow in the corner menu. */
export const availableUpdateAtom = atom<{ version: string; current: string } | null>(null);

let running = false;

/**
 * Checks GitHub releases of JBLBase for a newer version and, after asking,
 * downloads, installs and restarts. With `silent` (start-up and periodic
 * checks) nothing is asked or shown: a found update only lights up the
 * download arrow.
 */
export async function checkForAppUpdate(t: TFunction, { silent = false } = {}) {
    if (!UPDATES_ENABLED || running) return;
    running = true;
    const id = "app-update";
    try {
        const update = await check();
        getDefaultStore().set(
            availableUpdateAtom,
            update ? { version: update.version, current: update.currentVersion } : null,
        );
        if (!update) {
            if (!silent) await message(t("Updater.UpToDate"), { title: "JBLBase" });
            return;
        }
        info(`Update available: ${update.currentVersion} -> ${update.version}`);
        if (silent) return;
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
