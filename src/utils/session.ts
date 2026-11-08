import type { ChessComStats } from "@/utils/chess.com/api";
import type { LichessAccount } from "@/utils/lichess/api";

export type LichessSession = {
    accessToken?: string;
    username: string;
    account: LichessAccount;
};

export type ChessComSession = {
    username: string;
    stats: ChessComStats;
};

export type Session = {
    lichess?: LichessSession;
    chessCom?: ChessComSession;
    player?: string;
    updatedAt: number;
};

/** Username of the account behind a session. */
export function sessionUsername(session: Session): string {
    return (
        session.lichess?.account?.username ??
        session.lichess?.username ??
        session.chessCom?.username ??
        ""
    );
}

/** Stable id of a session, used to move it between players. */
export function sessionKey(session: Session): string {
    return session.lichess
        ? `lichess:${session.lichess.account?.id ?? session.lichess.username}`
        : `chesscom:${session.chessCom?.username ?? ""}`;
}

/**
 * Name of the player an account belongs to. Accounts without an explicit
 * player form their own player, named after the account.
 */
export function sessionPlayerName(session: Session): string {
    return session.player || sessionUsername(session);
}

export function playerNames(sessions: Session[]): string[] {
    return Array.from(new Set(sessions.map(sessionPlayerName)));
}

export function sessionsOfPlayer(sessions: Session[], player: string): Session[] {
    return sessions.filter((s) => sessionPlayerName(s) === player);
}

/**
 * Moves the account `key` to `player`. Accounts already shown under `player`
 * get the name stored too, so the player keeps its name when its first
 * account is removed.
 */
export function moveSessionToPlayer(sessions: Session[], key: string, player: string): Session[] {
    return sessions.map((s) =>
        sessionKey(s) === key || sessionPlayerName(s) === player ? { ...s, player } : s,
    );
}

/** Makes the account `key` a player of its own again. */
export function detachSession(sessions: Session[], key: string): Session[] {
    return sessions.map((s) => (sessionKey(s) === key ? { ...s, player: undefined } : s));
}
