// Rollen und Einzelrechte (1.2.35).
//
// Drei Stufen: Nutzer, Nutzer mit einzelnen Rechten und Admin. Beides steht
// als Custom Claim im Firebase-Konto (`admin: true`, `perms: { <recht>: true }`)
// und wird nur von der Function adminSetPermissions gesetzt, die nur Admins
// aufrufen dürfen. Die Sicherheitsregeln lesen die Claims aus dem Token.
//
// Die Liste muss zu PERMISSIONS in src/utils/cloud/permissions.ts und zu
// hasPerm() in firestore.rules passen.

export const PERMISSIONS = [
    "deepEvals",
    "sharedEvals",
    "noLimits",
    "coachTest",
    "motifTrainer",
] as const;
export type Permission = (typeof PERMISSIONS)[number];
export type Perms = Partial<Record<Permission, true>>;

export function isPermission(value: unknown): value is Permission {
    return typeof value === "string" && (PERMISSIONS as readonly string[]).includes(value);
}

/** Die gesetzten Rechte aus den Claims; Unbekanntes fällt weg. */
export function permsOf(claims: unknown): Perms {
    const perms: Perms = {};
    if (!claims || typeof claims !== "object") return perms;
    const raw = (claims as { perms?: unknown }).perms;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return perms;
    for (const [key, value] of Object.entries(raw)) {
        if (isPermission(key) && value === true) perms[key] = true;
    }
    return perms;
}

export type RoleChange = { uid: string; admin: boolean; perms: Perms };

/** Prüft die Anfrage an adminSetPermissions; null, wenn sie nicht passt. */
export function parseRoleChange(data: unknown): RoleChange | null {
    if (!data || typeof data !== "object") return null;
    const d = data as { uid?: unknown; admin?: unknown; perms?: unknown };
    if (typeof d.uid !== "string" || d.uid.length === 0 || d.uid.length > 128) return null;
    if (typeof d.admin !== "boolean") return null;
    if (!d.perms || typeof d.perms !== "object" || Array.isArray(d.perms)) return null;
    const perms: Perms = {};
    for (const [key, value] of Object.entries(d.perms)) {
        if (!isPermission(key) || typeof value !== "boolean") return null;
        if (value) perms[key] = true;
    }
    return { uid: d.uid, admin: d.admin, perms };
}

/**
 * Die neuen Custom Claims: andere Claims bleiben, `admin` und `perms`
 * fallen weg, wenn sie nicht gesetzt sind (kleines Token).
 */
export function nextClaims(
    current: Record<string, unknown> | undefined,
    change: Pick<RoleChange, "admin" | "perms">,
): Record<string, unknown> {
    const { admin: _admin, perms: _perms, ...rest } = current ?? {};
    const claims: Record<string, unknown> = { ...rest };
    if (change.admin) claims.admin = true;
    if (Object.keys(change.perms).length > 0) claims.perms = { ...change.perms };
    return claims;
}

/** Freigabeliste config/access: steht das Konto drauf? */
export function onAllowlist(
    access: unknown,
    user: { email?: string | null; emailVerified?: boolean; lichess?: string | null },
): boolean {
    if (!access || typeof access !== "object") return false;
    const a = access as { emails?: unknown; lichess?: unknown };
    const has = (list: unknown, v: string) =>
        Array.isArray(list) &&
        list.some((x) => typeof x === "string" && x.trim().toLowerCase() === v);
    if (user.email && user.emailVerified && has(a.emails, user.email.toLowerCase())) return true;
    return !!user.lichess && has(a.lichess, user.lichess.toLowerCase());
}

export type AdminUser = {
    uid: string;
    email: string | null;
    emailVerified: boolean;
    name: string | null;
    method: "email" | "lichess";
    createdAt: string | null;
    lastSignIn: string | null;
    disabled: boolean;
    allowed: boolean;
    admin: boolean;
    perms: Perms;
};

/** Ein Eintrag der Nutzerliste aus einem Firebase-Konto (Admin SDK). */
export function toAdminUser(
    user: {
        uid: string;
        email?: string;
        emailVerified: boolean;
        displayName?: string;
        disabled: boolean;
        customClaims?: Record<string, unknown>;
        metadata: {
            creationTime?: string;
            lastSignInTime?: string;
            lastRefreshTime?: string | null;
        };
    },
    access: unknown,
): AdminUser {
    const lichess = user.uid.startsWith("lichess:") ? user.uid.slice("lichess:".length) : null;
    const claims = user.customClaims ?? {};
    return {
        uid: user.uid,
        email: user.email ?? null,
        emailVerified: user.emailVerified,
        name: user.displayName ?? null,
        method: lichess ? "lichess" : "email",
        createdAt: user.metadata.creationTime ?? null,
        lastSignIn: user.metadata.lastRefreshTime ?? user.metadata.lastSignInTime ?? null,
        disabled: user.disabled,
        allowed: onAllowlist(access, {
            email: user.email,
            emailVerified: user.emailVerified,
            lichess,
        }),
        admin: claims.admin === true,
        perms: permsOf(claims),
    };
}
