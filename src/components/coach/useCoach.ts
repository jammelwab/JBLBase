import { atom, useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { getStats } from "@/components/files/opening";
import { useOpenRecentFile } from "@/components/tabs/useOpenRecentFile";
import {
    deckAtomFamily,
    puzzleThemeAtom,
    type RecentFile,
    recentFilesAtom,
    tabsAtom,
} from "@/state/atoms";
import type { Tab } from "@/utils/tabs";
import { coachBossAtom } from "./coachBoss";
import { MATE_DRILL_THEME } from "./coachEggs";
import {
    clampLock,
    coachLockAtom,
    coachMateDrillAtom,
    coachMistakeAtom,
    coachStreakAtom,
    currentStreak,
} from "./coachProgress";
import { coachIntroAtom, introReminder } from "./coachIntroState";
import { coachLineWizardAtom } from "./coachLines";
import { coachPathAtom } from "./coachPath";
import { coachPuzzleElo, coachPuzzleStartAtom } from "./coachPuzzleStart";
import {
    coachLessonAnnouncedAtom,
    coachLessonsDoneAtom,
    newLesson,
    unlockedLessons,
} from "./coachLessonsData";
import {
    type CoachTaskId,
    coachDayAtom,
    coachStrengthAtom,
    coachTasks,
    coachXpAtom,
    levelProgress,
    nextCoachStep,
    nextCoachTask,
    repsToday,
    today,
    coachNewGameAtom,
} from "./coachState";
import {
    coachBestEstimateAtom,
    coachQuestAtom,
    coachResultsAtom,
    currentQuest,
} from "./coachRewards";

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
    const day = useAtomValue(coachDayAtom);
    const [storedLock, setLock] = useAtom(coachLockAtom);
    const hasMistake = useAtomValue(coachMistakeAtom) !== null;
    const streak = currentStreak(useAtomValue(coachStreakAtom), today());
    const { total: dueCount, best } = useAtomValue(repertoireDueAtom);
    const openRecentFile = useOpenRecentFile();
    const mateDrill = useAtomValue(coachMateDrillAtom);
    const lock = clampLock(storedLock, mateDrill);
    useEffect(() => {
        if (lock !== storedLock) setLock(lock);
    }, [lock, storedLock, setLock]);
    const setPuzzleTheme = useSetAtom(puzzleThemeAtom);
    const setPuzzleStart = useSetAtom(coachPuzzleStartAtom);
    const results = useAtomValue(coachResultsAtom);
    const bestEstimate = useAtomValue(coachBestEstimateAtom);
    const strength = useAtomValue(coachStrengthAtom);
    const setLineWizard = useSetAtom(coachLineWizardAtom);
    const setNewGame = useSetAtom(coachNewGameAtom);

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

    const actions = useMemo(
        () => ({
            openCoach: () => turnTabInto("coach", t("Coach.Card.Title")),
            play: () => {
                if (lock > 0) return;
                setNewGame(tabId);
                turnTabInto("play", t("Coach.Game.TabName"), true);
            },
            // Der eigene Fehler wird auf der Coach-Seite gelöst, danach Puzzles
            puzzles: () => {
                if (lock > 0 && hasMistake) return turnTabInto("coach", t("Coach.Card.Title"));
                // Aarons Strafaufgaben: nur Matt in 1, sonst gemischt
                if (lock > 0 && mateDrill) setPuzzleTheme(MATE_DRILL_THEME);
                else if (lock === 0) setPuzzleTheme(null);
                // Sofort ein Puzzle in der geschätzten Stärke
                setPuzzleStart(coachPuzzleElo(results, bestEstimate, strength));
                turnTabInto("puzzles", t("Home.PuzzleTraining"), true);
            },
            repertoire: () => {
                if (best) openRecentFile(best.file, { coach: true });
            },
            // Weiterer Pfad: Taktik-Puzzles zu einem Thema
            tactic: (theme: string) => {
                setPuzzleTheme(theme);
                setPuzzleStart(coachPuzzleElo(results, bestEstimate, strength));
                turnTabInto("puzzles", t("Home.PuzzleTraining"), true);
            },
            // Neue Linie: der Assistent auf der Coach-Seite (Züge erst nach Bestätigung)
            addLine: () => {
                turnTabInto("coach", t("Coach.Card.Title"));
                setLineWizard(tabId);
            },
        }),
        [
            turnTabInto,
            lock,
            hasMistake,
            mateDrill,
            setPuzzleTheme,
            setPuzzleStart,
            results,
            bestEstimate,
            strength,
            t,
            best,
            openRecentFile,
            setLineWizard,
            setNewGame,
            tabId,
        ],
    );

    // Zeitpunkt beim Öffnen der Karte; reicht für die Tagesaufgaben.
    const [now] = useState(() => new Date());
    // Fordert der Boss heraus, ist die nächste Partie Pflicht
    const boss = useAtomValue(coachBossAtom).pending && lock === 0;
    const next: CoachTaskId = boss ? "play" : nextCoachTask(dueCount, day, now, lock);
    const tasks = coachTasks(dueCount, day, now, lock);

    // Neue Lektion: kommt in der Statuszeile direkt nach der Sperre
    const intro = useAtomValue(coachIntroAtom);
    const { level } = levelProgress(useAtomValue(coachXpAtom));
    const lessonsDone = useAtomValue(coachLessonsDoneAtom);
    const unlocked = unlockedLessons(level, intro.entry, lessonsDone);
    const lesson = newLesson(unlocked, useAtomValue(coachLessonAnnouncedAtom), lessonsDone);
    const remindIntro = introReminder(intro);

    // Der eine nächste Schritt für Startkarte und Coach-Seite
    const quest = currentQuest(useAtomValue(coachQuestAtom), today(now));
    const step = nextCoachStep({
        next,
        lock,
        hasMistake,
        hasLesson: lesson !== null,
        boss,
        questDone: quest.done,
    });
    const reps = repsToday(day, now);
    const path = useAtomValue(coachPathAtom);

    return {
        next,
        step,
        quest,
        reps,
        tasks,
        dueCount,
        actions,
        lock,
        streak,
        boss,
        lesson,
        unlocked,
        remindIntro,
        path,
    };
}
