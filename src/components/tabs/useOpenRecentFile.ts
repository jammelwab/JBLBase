import { notifications } from "@mantine/notifications";
import { useNavigate } from "@tanstack/react-router";
import { useSetAtom, useStore } from "jotai";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { commands } from "@/bindings";
import { activeTabAtom, type RecentFile, removeRecentFilesAtom, tabsAtom } from "@/state/atoms";
import { openFile, readInfoFile } from "@/utils/files";
import { unwrap } from "@/utils/unwrap";

// Öffnet eine zuletzt benutzte Datei in einem neuen Tab. Fehlt sie, fliegt sie
// aus der Liste.
export function useOpenRecentFile() {
    const { t } = useTranslation();
    const setTabs = useSetAtom(tabsAtom);
    const setActiveTab = useSetAtom(activeTabAtom);
    const store = useStore();
    const navigate = useNavigate();

    return useCallback(
        async (file: RecentFile, options?: { coach?: boolean }) => {
            try {
                const exists = await commands.fileExists(file.path);
                if (exists.status === "error" || !exists.data) {
                    store.set(removeRecentFilesAtom, file.path);
                    notifications.show({
                        color: "orange",
                        title: file.name.replace(/\.pgn$/i, ""),
                        message: t("Home.RecentFiles.Missing"),
                    });
                    return;
                }
                // Read the real .info, so a repertoire keeps its colour, owner and id.
                const info = await readInfoFile(file.path);
                const numGames = unwrap(await commands.countPgnGames(file.path));
                await openFile(
                    {
                        type: "file",
                        name: file.name.replace(/\.pgn$/i, ""),
                        path: file.path,
                        numGames,
                        metadata: info ?? { type: file.type, tags: [] },
                        lastModified: Date.now(),
                    },
                    setTabs,
                    setActiveTab,
                    { coach: options?.coach },
                );
                navigate({ to: "/" });
            } catch (e) {
                notifications.show({
                    color: "red",
                    title: t("Home.RecentFiles.OpenFailed"),
                    message: e instanceof Error ? e.message : String(e),
                });
            }
        },
        [setTabs, setActiveTab, store, navigate, t],
    );
}
