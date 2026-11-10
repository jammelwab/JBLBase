import { atom, getDefaultStore } from "jotai";
import { commands } from "@/bindings";
import { sessionsAtom } from "@/state/atoms";
import { getChessComAccount } from "@/utils/chess.com/api";
import { saveProfile } from "@/utils/cloud/auth";
import { getLichessAccount } from "@/utils/lichess/api";
import { getMainOwner } from "@/utils/mainOwner";
import { addSession } from "@/utils/session";

/** The full-screen sign-in is shown. */
export const loginScreenOpenAtom = atom(false);

/** Tab of the settings page; "profile" opens the account. */
export const settingsTabAtom = atom("board");

const SKIPPED_KEY = "cloud-login-skipped";

/** The sign-in screen was closed with "Continue without account". */
export function loginSkipped(): boolean {
    try {
        return localStorage.getItem(SKIPPED_KEY) === "1";
    } catch {
        return false;
    }
}

export function setLoginSkipped() {
    try {
        localStorage.setItem(SKIPPED_KEY, "1");
    } catch {}
}

/**
 * Opens the Lichess login in the browser. The token comes back as the event
 * "cloud_lichess_token" (see CloudRoot).
 */
export async function startLichessLogin() {
    const res = await commands.authenticateCloud();
    if (res.status === "error") throw new Error(res.error);
}

/**
 * Links a Lichess account to the signed-in profile with a fresh Lichess
 * token, and adds it to the app's accounts (games, statistics).
 */
export async function linkLichess(uid: string, token: string): Promise<string> {
    const account = await getLichessAccount({ token });
    if (!account) throw Object.assign(new Error(), { code: "functions/unauthenticated" });
    await saveProfile(uid, { lichess: account.username });
    getDefaultStore().set(sessionsAtom, (sessions) =>
        addSession(sessions, {
            lichess: { accessToken: token, username: account.username, account },
            player: getMainOwner(),
            updatedAt: Date.now(),
        }),
    );
    return account.username;
}

/**
 * Links a Chess.com username (checked against Chess.com) and adds the
 * account to the app's accounts. Returns false when it does not exist.
 */
export async function linkChessCom(uid: string, username: string): Promise<boolean> {
    const stats = await getChessComAccount(username);
    if (!stats) return false;
    await saveProfile(uid, { chesscom: username });
    getDefaultStore().set(sessionsAtom, (sessions) =>
        addSession(sessions, {
            chessCom: { username, stats },
            player: getMainOwner(),
            updatedAt: Date.now(),
        }),
    );
    return true;
}
