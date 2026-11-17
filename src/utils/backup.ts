// Automatische lokale Sicherung (#119), see src-tauri/src/backup.rs.
//
// A short while after the start, and then every few hours while the app
// stays open, the app asks for today's backup; the backend skips it when
// today's backup exists already.

import { atom, getDefaultStore } from "jotai";
import { commands } from "@/bindings";
import { getDocumentDir } from "./directories";
import { unwrap } from "./unwrap";

const FIRST_DELAY_MS = 20 * 1000;
const RECHECK_MS = 3 * 60 * 60 * 1000;

/** Bumped after each new backup, so the settings list reloads. */
export const backupVersionAtom = atom(0);

export async function backupNow(daily: boolean) {
    const info = unwrap(await commands.backupCreate(await getDocumentDir(), daily));
    if (info) getDefaultStore().set(backupVersionAtom, (v) => v + 1);
    return info;
}

/** Starts the daily backup; returns the function that stops it. */
export function startDailyBackup(): () => void {
    const run = () => void backupNow(true).catch((e) => console.warn("Daily backup failed", e));
    const first = setTimeout(run, FIRST_DELAY_MS);
    const again = setInterval(run, RECHECK_MS);
    return () => {
        clearTimeout(first);
        clearInterval(again);
    };
}
