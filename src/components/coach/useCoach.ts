import { atom, useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { getStats } from "@/components/files/opening";
import { useOpenRecentFile } from "@/components/tabs/useOpenRecentFile";
import { deckAtomFamily, type RecentFile, recentFilesAtom, tabsAtom } from "@/state/atoms";
import type { Tab } from "@/utils/tabs";
import { type CoachTaskId, coachDayAtom, coachTasks, nextCoachTask, today } from "./coachState";

// Fällige und neue Stellungen in den zuletzt geöffneten Repertoires.
const repertoireDueAtom = atom((get) => {
    let total = 0;
    let best: { file: RecentFile; due: number } | null = null;
    for (const file of get(recentFilesAtom)) {
        if (file.type !== "repertoire") continue;
        const stats = getStats(get(deckAtomFamily({ file: file.path, game: 0 })).positions);
        const due = stats.due + stats.unseen;
        total += due;
        if (due > 0 && (!best || due > best.due)) best = { file, due };
    }
    return { total, best };
});

export function useCoach(tabId: string) {
    const { t } = useTranslation();
    const setTabs = useSetAtom(tabsAtom);
    const [day, setDay] = useAtom(coachDayAtom);
    const { total: dueCount, best } = useAtomValue(repertoireDueAtom);
    const openRecentFile = useOpenRecentFile();

    const turnTabInto = useCallback(
        (type: Tab["type"], name: string, coach = false) =>
            setTabs((prev: Tab[]) => {
                const tab = prev.find((x) => x.value === tabId);
                if (!tab) return prev;
                tab.name = name;
                tab.type = type;
                tab.coach = coach || undefined;
                return [...prev];
            }),
        [setTabs, tabId],
    );

    const mark = useCallback(
        (key: "played" | "puzzles") =>
            setDay((prev) => {
                const fresh =
                    prev.day === today() ? prev : { day: today(), played: false, puzzles: false };
                return { ...fresh, [key]: true };
            }),
        [setDay],
    );

    const actions = useMemo(
        () => ({
            openCoach: () => turnTabInto("coach", t("Coach.Card.Title")),
            play: () => {
                mark("played");
                turnTabInto("play", t("Coach.Game.TabName"), true);
            },
            puzzles: () => {
                mark("puzzles");
                turnTabInto("puzzles", t("Home.PuzzleTraining"));
            },
            repertoire: () => {
                if (best) openRecentFile(best.file);
            },
        }),
        [turnTabInto, mark, t, best, openRecentFile],
    );

    const next: CoachTaskId = nextCoachTask(dueCount, day);
    const tasks = coachTasks(dueCount, day);

    return { next, tasks, dueCount, actions };
}
