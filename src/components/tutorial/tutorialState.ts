import { useNavigate } from "@tanstack/react-router";
import { atom, useAtomValue, useSetAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { useCallback, useEffect } from "react";
import { findTutorial } from "./tutorials";

// Tutorials the user finished or skipped; they don't start by themselves again
export const tutorialsSeenAtom = atomWithStorage<string[]>("tutorials-seen", [], undefined, {
    getOnInit: true,
});

// The running tutorial and its step
export const activeTutorialAtom = atom<{ id: string; step: number } | null>(null);

export function useStartTutorial() {
    const navigate = useNavigate();
    const setActive = useSetAtom(activeTutorialAtom);
    return useCallback(
        (id: string) => {
            const tutorial = findTutorial(id);
            if (!tutorial) return;
            navigate({ to: tutorial.route });
            setActive({ id, step: 0 });
        },
        [navigate, setActive],
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
