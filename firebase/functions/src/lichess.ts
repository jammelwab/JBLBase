/** Lichess account as returned by https://lichess.org/api/account. */
export interface LichessAccount {
    id: string;
    username: string;
}

/** Lichess ids are lowercase usernames: letters, digits, "_" and "-". */
const LICHESS_ID = /^[a-z0-9_-]{2,30}$/;

/** A Lichess OAuth access token as sent by the app; null when malformed. */
export function parseToken(data: unknown): string | null {
    if (!data || typeof data !== "object") return null;
    const token = (data as { token?: unknown }).token;
    if (typeof token !== "string") return null;
    const trimmed = token.trim();
    if (trimmed.length < 10 || trimmed.length > 200 || /\s/.test(trimmed)) return null;
    return trimmed;
}

/** Checks the account answer; null when it is not a valid account. */
export function parseLichessAccount(body: unknown): LichessAccount | null {
    if (!body || typeof body !== "object") return null;
    const { id, username } = body as { id?: unknown; username?: unknown };
    if (typeof id !== "string" || typeof username !== "string") return null;
    if (!LICHESS_ID.test(id) || username.toLowerCase() !== id) return null;
    return { id, username };
}

/** Firebase uid of an account that signs in with Lichess. */
export function lichessUid(account: LichessAccount): string {
    return `lichess:${account.id}`;
}
