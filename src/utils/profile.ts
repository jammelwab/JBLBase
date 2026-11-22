import { atom, getDefaultStore } from "jotai";
import { commands } from "@/bindings";

// Ein Profil pro Konto (1.2.13). Alles, was einem Spieler gehört
// (Einstellungen, Coach, zuletzt geöffnete Dateien, Dateien-Ordner, Training),
// liegt im Profil des angemeldeten Kontos. "legacy" ist der Stand von vor
// 1.2.13; er gehört dem Konto, das ihn einmal übernimmt.

export type ProfileKey = "legacy" | "guest" | `u-${string}`;

export const ACTIVE_KEY = "jbl-profile-active";
// Konto, dem der alte Stand gehört
export const OWNER_KEY = "jbl-profile-legacy-owner";
// "1": vor 1.2.13 war schon ein Konto angemeldet, also erst fragen
export const ASK_KEY = "jbl-profile-legacy-ask";
// Konten, die gesagt haben, der alte Stand ist nicht ihrer
export const DECLINED_KEY = "jbl-profile-legacy-declined";

// Gehören dem Gerät, nicht dem Konto: bleiben beim Wechsel stehen
const DEVICE_KEYS = new Set([
    "cloud-device-id",
    "cloud-signed-in",
    "cloud-login-skipped",
    "cloud-consent-pending",
    "usage-stats",
    "usage-stats-asked",
    "usage-stats-client",
    "usage-stats-eval-day",
    "engines-dir",
    "puzzles-dir",
    "bundled-engines",
    "windowsState",
    "compactWindowsState",
    "native-bar",
]);
const DEVICE_PREFIXES = ["jbl-profile-", "firebase:"];

export function isDeviceKey(key: string): boolean {
    return DEVICE_KEYS.has(key) || DEVICE_PREFIXES.some((p) => key.startsWith(p));
}

export type ProfileState = {
    owner: string | null;
    ask: boolean;
    declined: string[];
};

export type ProfileDecision =
    // Dieses Profil gehört zum Konto; claim: der alte Stand wird jetzt seiner
    | { kind: "use"; key: ProfileKey; claim: boolean }
    // Erst fragen, ob der alte Stand diesem Konto gehört
    | { kind: "ask" };

export function profileKeyFor(uid: string): ProfileKey {
    return `u-${uid.replace(/[^A-Za-z0-9]/g, "")}`;
}

// Welches Profil gehört zu diesem Konto (null: niemand angemeldet)?
export function decideProfile(uid: string | null, s: ProfileState): ProfileDecision {
    if (uid === null) return { kind: "use", key: s.owner ? "guest" : "legacy", claim: false };
    if (s.owner === uid) return { kind: "use", key: "legacy", claim: false };
    if (s.owner || s.declined.includes(uid))
        return { kind: "use", key: profileKeyFor(uid), claim: false };
    // Ohne früheres Konto auf dem Gerät: der bisherige Stand wird der des Kontos
    if (!s.ask) return { kind: "use", key: "legacy", claim: true };
    return { kind: "ask" };
}

function read(key: string): string | null {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function write(key: string, value: string | null) {
    try {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
    } catch {}
}

export function readProfileState(): ProfileState {
    let declined: string[] = [];
    try {
        const parsed = JSON.parse(read(DECLINED_KEY) ?? "[]");
        if (Array.isArray(parsed)) declined = parsed.filter((x) => typeof x === "string");
    } catch {}
    return { owner: read(OWNER_KEY), ask: read(ASK_KEY) === "1", declined };
}

export function activeProfile(): ProfileKey {
    const v = read(ACTIVE_KEY);
    return v === "guest" || (v && v.startsWith("u-")) ? (v as ProfileKey) : "legacy";
}

// Beim ersten Start mit 1.2.13: merken, ob schon ein Konto angemeldet war
export function initProfiles(signedInBefore: boolean) {
    if (read(ACTIVE_KEY) !== null) return;
    write(ACTIVE_KEY, "legacy");
    write(ASK_KEY, signedInBefore ? "1" : "0");
}

// Einstellungen des Profils (ohne die des Geräts) als JSON
export function snapshotStorage(storage: Storage = localStorage): string {
    const out: Record<string, string> = {};
    for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key === null || isDeviceKey(key)) continue;
        const value = storage.getItem(key);
        if (value !== null) out[key] = value;
    }
    return JSON.stringify(out);
}

// Ersetzt die Einstellungen des Profils durch die gespeicherten
export function restoreStorage(snapshot: string | null, storage: Storage = localStorage) {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key !== null && !isDeviceKey(key)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
    if (!snapshot) return;
    try {
        const data = JSON.parse(snapshot) as Record<string, unknown>;
        for (const [key, value] of Object.entries(data))
            if (typeof value === "string" && !isDeviceKey(key)) storage.setItem(key, value);
    } catch {}
}

// Konto, bei dem die App gerade fragt, ob der alte Stand seiner ist
export const profileClaimAtom = atom<{ uid: string; email: string | null } | null>(null);

let switching = false;

export function profileSwitching(): boolean {
    return switching;
}

// Wechselt ins Profil und lädt die App neu
export async function switchProfile(key: ProfileKey): Promise<void> {
    if (switching || key === activeProfile()) return;
    switching = true;
    try {
        const res = await commands.switchProfile(key, snapshotStorage());
        if (res.status !== "ok") throw new Error(res.error);
        restoreStorage(res.data);
        write(ACTIVE_KEY, key);
        try {
            sessionStorage.clear();
        } catch {}
        window.location.reload();
    } catch (e) {
        switching = false;
        console.error("Profile switch failed", e);
    }
}

// Passt das Profil an das Konto an. true: das Profil passt und die Cloud darf
// abgleichen; false: es wird gewechselt oder erst gefragt.
export function applyProfile(account: { uid: string; email: string | null } | null): boolean {
    const store = getDefaultStore();
    const decision = decideProfile(account?.uid ?? null, readProfileState());
    if (decision.kind === "ask") {
        // Noch im alten Stand: erst fragen, bevor irgendetwas abgeglichen wird
        if (activeProfile() !== "legacy") {
            void switchProfile("legacy");
            return false;
        }
        store.set(profileClaimAtom, { uid: account!.uid, email: account!.email });
        return false;
    }
    store.set(profileClaimAtom, null);
    if (decision.claim && account) write(OWNER_KEY, account.uid);
    if (decision.key !== activeProfile()) {
        void switchProfile(decision.key);
        return false;
    }
    return true;
}

// Darf die Cloud für dieses Konto im aktiven Profil abgleichen?
export function profileReadyFor(uid: string): boolean {
    if (switching) return false;
    const decision = decideProfile(uid, readProfileState());
    return decision.kind === "use" && decision.key === activeProfile();
}

// Antwort auf die Frage: gehört der alte Stand diesem Konto?
export function answerClaim(uid: string, mine: boolean) {
    const store = getDefaultStore();
    store.set(profileClaimAtom, null);
    if (mine) {
        write(OWNER_KEY, uid);
        // Neu laden: dann gleicht die Cloud wie gewohnt ab (mit Zustimmung)
        window.location.reload();
        return;
    }
    const s = readProfileState();
    write(DECLINED_KEY, JSON.stringify([...new Set([...s.declined, uid])]));
    void switchProfile(profileKeyFor(uid));
}
