// Admin overview (#116): what the cloud is doing across all accounts, from
// the usage counts the app already writes per account, device and day
// (users/{uid}/usage/{day}, see usage.ts). Only an admin may read them.

import type { CloudFirestore } from "./firestoreDocs";
import {
    addCounts,
    decide,
    emptyCounts,
    parseCounts,
    totalOf,
    type UsageCount,
    type UsageCounts,
    type UsageLimits,
} from "./usage";

/** Free Firestore operations per day for the whole project (Spark/Blaze free tier). */
export const FREE_READS_PER_DAY = 50_000;
export const FREE_WRITES_PER_DAY = 20_000;
/** How many days the overview looks back. */
export const OVERVIEW_DAYS = 7;

/** One usage document: an account's counts per device on one day. */
export type UsageDoc = { uid: string; day: string; devices: Record<string, unknown> };

export type DayUsage = UsageCount & { day: string; accounts: number; devices: number };

export type AdminSummary = {
    /** Newest day first, only days with usage. */
    days: DayUsage[];
    /** Accounts with any usage in the period. */
    activeAccounts: number;
    /** Devices with any usage in the period. */
    activeDevices: number;
    /** Today's usage of all accounts together. */
    today: UsageCount;
    /** Accounts that reached a limit today: the position store or the whole sync paused. */
    evalsPausedToday: number;
    syncPausedToday: number;
};

/** The counts of all devices in one usage document. */
function docCounts(devices: Record<string, unknown>): UsageCounts {
    let sum = emptyCounts();
    for (const [key, value] of Object.entries(devices)) {
        if (key === "updatedAt") continue;
        sum = addCounts(sum, parseCounts(value));
    }
    return sum;
}

function deviceKeys(devices: Record<string, unknown>): string[] {
    return Object.keys(devices).filter((k) => k !== "updatedAt");
}

/**
 * Sums the usage documents per day. `today` is the local date (YYYY-MM-DD),
 * as the app names the documents. Admin accounts never pause; the overview
 * cannot tell them apart, so the pause counts may include one admin too
 * many only when an admin used more than a limit.
 */
export function summarizeUsage(docs: UsageDoc[], limits: UsageLimits, today: string): AdminSummary {
    const byDay = new Map<
        string,
        { counts: UsageCount; accounts: Set<string>; devices: Set<string> }
    >();
    const accounts = new Set<string>();
    const devices = new Set<string>();
    let evalsPausedToday = 0;
    let syncPausedToday = 0;
    for (const doc of docs) {
        const counts = docCounts(doc.devices);
        const total = totalOf(counts);
        if (total.reads + total.writes === 0) continue;
        accounts.add(doc.uid);
        const entry = byDay.get(doc.day) ?? {
            counts: { reads: 0, writes: 0 },
            accounts: new Set<string>(),
            devices: new Set<string>(),
        };
        entry.counts = {
            reads: entry.counts.reads + total.reads,
            writes: entry.counts.writes + total.writes,
        };
        entry.accounts.add(doc.uid);
        for (const d of deviceKeys(doc.devices)) {
            entry.devices.add(`${doc.uid}/${d}`);
            devices.add(`${doc.uid}/${d}`);
        }
        byDay.set(doc.day, entry);
        if (doc.day === today) {
            const allowed = decide(counts, limits, false);
            if (!allowed.sync) syncPausedToday++;
            else if (!allowed.evals) evalsPausedToday++;
        }
    }
    const days = [...byDay.entries()]
        .map(([day, e]) => ({
            day,
            ...e.counts,
            accounts: e.accounts.size,
            devices: e.devices.size,
        }))
        .sort((a, b) => b.day.localeCompare(a.day));
    const todayEntry = byDay.get(today);
    return {
        days,
        activeAccounts: accounts.size,
        activeDevices: devices.size,
        today: todayEntry ? todayEntry.counts : { reads: 0, writes: 0 },
        evalsPausedToday,
        syncPausedToday,
    };
}

/** Share of the free daily quota, 0–100 (more is possible: then it costs). */
export function quotaPercent(used: number, free: number): number {
    if (free <= 0) return 0;
    return Math.round((used / free) * 100);
}

/** Length of the allowlist in config/access; null when there is none. */
export function allowlistSize(data: unknown): { emails: number; lichess: number } | null {
    if (!data || typeof data !== "object") return null;
    const d = data as Record<string, unknown>;
    const count = (v: unknown) =>
        Array.isArray(v) ? v.filter((x) => typeof x === "string").length : 0;
    return { emails: count(d.emails), lichess: count(d.lichess) };
}

export type AdminData = {
    usage: UsageDoc[];
    allowlist: { emails: number; lichess: number } | null;
    sharedEvals: number | null;
    limits: unknown;
};

/**
 * Everything the overview needs, in few reads: the usage documents of the
 * last days (one read each), the allowlist and limits (one each) and the
 * size of the shared position store (a count: one read per 1000 entries).
 */
export async function fetchAdminData(
    { db, firestore: fs }: CloudFirestore,
    since: Date,
): Promise<AdminData> {
    const usageSnap = await fs.getDocs(
        fs.query(
            fs.collectionGroup(db, "usage"),
            fs.where("updatedAt", ">=", fs.Timestamp.fromDate(since)),
        ),
    );
    const usage: UsageDoc[] = [];
    for (const d of usageSnap.docs) {
        // users/{uid}/usage/{day}
        const uid = d.ref.parent.parent?.id;
        if (!uid) continue;
        usage.push({ uid, day: d.id, devices: d.data() });
    }
    const [access, limits, shared] = await Promise.all([
        fs.getDoc(fs.doc(db, "config", "access")).catch(() => null),
        fs.getDoc(fs.doc(db, "config", "limits")).catch(() => null),
        fs.getCount(fs.collection(db, "evals")).catch(() => null),
    ]);
    return {
        usage,
        allowlist: access?.exists() ? allowlistSize(access.data()) : null,
        sharedEvals: shared ? shared.data().count : null,
        limits: limits?.exists() ? limits.data() : null,
    };
}
