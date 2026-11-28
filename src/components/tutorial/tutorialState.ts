import { useNavigate } from "@tanstack/react-router";
import { atom, useAtomValue, useSetAtom, useStore } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { settingsTabAtom } from "@/components/cloud/cloudUi";
import { activeTabAtom, tabsAtom } from "@/state/atoms";
import { can, type Permission } from "@/utils/cloud/permissions";
import { cloudAccountAtom } from "@/utils/cloud/sync";
import { createTab } from "@/utils/tabs";
import { findTutorial } from "./tutorials";

// Tutorials the user finished or skipped; they don't start by themselves again
export const tutorialsSeenAtom = atomWithStorage<string[]>("tutorials-seen", [], undefined, {
    getOnInit: true,
});

// The running tutorial and its step
export const activeTutorialAtom = atom<{ id: string; step: number } | null>(null);

export function useIsAdmin(): boolean {
    return useAtomValue(cloudAccountAtom)?.role === "admin";
}

/** Hat das angemeldete Konto dieses Recht? Admins haben alle (1.2.34). */
export function useCan(perm: Permission): boolean {
    return can(useAtomValue(cloudAccountAtom), perm);
}

export function useStartTutorial() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const setActive = useSetAtom(activeTutorialAtom);
    const setSettingsTab = useSetAtom(settingsTabAtom);
    const store = useStore();
    return useCallback(
        (id: string) => {
            const tutorial = findTutorial(id);
            if (!tutorial) return;
            if (tutorial.settingsTab) setSettingsTab(tutorial.settingsTab);
            if (tutorial.newTab) {
                // An empty tab shows the start cards; reuse one if it is already in front
                const tabs = store.get(tabsAtom);
                const current = tabs.find((tab) => tab.value === store.get(activeTabAtom));
                if (current?.type !== "new") {
                    void createTab({
                        tab: { name: t("Tab.NewTab"), type: "new" },
                        setTabs: (v) => store.set(tabsAtom, v),
                        setActiveTab: (v) => store.set(activeTabAtom, v),
                    });
                }
            }
            navigate({ to: tutorial.route });
            setActive({ id, step: 0 });
        },
        [navigate, setActive, setSettingsTab, store, t],
    );
}

// A window of the app (login, a form) is open over the page; the tutorial waits meanwhile
export function modalOpen(): boolean {
    return document.querySelector('[aria-modal="true"]') !== null;
}

// Starts a tutorial the first time its page opens, once `ready` (e.g. the page has loaded).
export function useFirstTimeTutorial(id: string, ready: boolean) {
    const seen = useAtomValue(tutorialsSeenAtom);
    const active = useAtomValue(activeTutorialAtom);
    const setActive = useSetAtom(activeTutorialAtom);
    const due = ready && !active && !seen.includes(id);
    useEffect(() => {
        if (!due) return;
        // A moment later, so the page's elements are in place, and not over the login screen
        // or another window
        const timer = setInterval(() => {
            if (modalOpen()) return;
            clearInterval(timer);
            setActive((prev) => prev ?? { id, step: 0 });
        }, 700);
        return () => clearInterval(timer);
    }, [due, id, setActive]);
}
