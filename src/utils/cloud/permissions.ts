// Rollen und Einzelrechte (1.2.31).
//
// Nutzer, Nutzer mit einzelnen Rechten und Admins. Admins haben jedes Recht.
// Die Rechte stehen als Custom Claim `perms` im Firebase-Konto; gesetzt
// werden sie im Admin-Fenster über die Function adminSetPermissions, die
// Sicherheitsregeln prüfen sie (hasPerm in firebase/firestore.rules).
//
// Die Liste muss zu PERMISSIONS in firebase/functions/src/roles.ts passen.

import type { CloudAccount } from "./auth";

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

/** Die gesetzten Rechte aus dem Claim `perms`; Unbekanntes fällt weg. */
export function parsePerms(raw: unknown): Perms {
    const perms: Perms = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return perms;
    for (const [key, value] of Object.entries(raw)) {
        if (isPermission(key) && value === true) perms[key] = true;
    }
    return perms;
}

/** Darf das Konto das? Admins dürfen alles, ohne Konto nichts. */
export function can(
    account: Pick<CloudAccount, "role" | "perms"> | null | undefined,
    perm: Permission,
): boolean {
    if (!account) return false;
    return account.role === "admin" || account.perms[perm] === true;
}

/** Stufe zum Anzeigen: Admin, Nutzer mit Rechten oder Nutzer. */
export type AccountLevel = "admin" | "extended" | "user";

export function accountLevel(account: {
    role?: string;
    admin?: boolean;
    perms: Perms;
}): AccountLevel {
    if (account.role === "admin" || account.admin === true) return "admin";
    return PERMISSIONS.some((p) => account.perms[p]) ? "extended" : "user";
}

/** Ein Konto in der Liste des Admin-Fensters (Function adminListUsers). */
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

export function parseAdminUsers(data: unknown): AdminUser[] {
    const list = (data as { users?: unknown } | null)?.users;
    if (!Array.isArray(list)) return [];
    const str = (v: unknown) => (typeof v === "string" ? v : null);
    return list
        .filter((u): u is Record<string, unknown> => !!u && typeof u === "object")
        .filter((u) => typeof u.uid === "string")
        .map((u) => ({
            uid: u.uid as string,
            email: str(u.email),
            emailVerified: u.emailVerified === true,
            name: str(u.name),
            method: u.method === "lichess" ? "lichess" : "email",
            createdAt: str(u.createdAt),
            lastSignIn: str(u.lastSignIn),
            disabled: u.disabled === true,
            allowed: u.allowed === true,
            admin: u.admin === true,
            perms: parsePerms(u.perms),
        }));
}

/** Suche im Admin-Fenster: Name, E-Mail oder uid enthält den Text. */
export function filterUsers(users: AdminUser[], query: string): AdminUser[] {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => [u.name, u.email, u.uid].some((v) => v?.toLowerCase().includes(q)));
}

/**
 * Muss die App ihr Token erneuern? roles/{uid} wurde nach dem Ausstellen
 * des Tokens geändert, die Claims darin sind also veraltet.
 */
export function rolesNewerThanToken(rolesUpdatedAt: number | null, tokenIssuedAt: number): boolean {
    return rolesUpdatedAt !== null && rolesUpdatedAt > tokenIssuedAt;
}
