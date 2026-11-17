// Cloud usage per day and account (#114).
//
// Every cloud access of the sync is counted here: documents read and
// written, per area. The counts of this device are kept per day in the sync
// metadata, and at the end of each run also in users/{uid}/usage/{day}
// (one field per device), so all devices of an account count together.
//
// The limits keep one account (or one device with a bug like #99) from
// using up the project's daily quota, which is shared by everyone; when the
// monthly budget is reached, the cost brake (functions: budgetGuard) stops
// the cloud for all. They are set so high that normal use never meets them,
// and they are met silently: first only the position store pauses until
// tomorrow, repertoires and training go on. Only far above that, which
// takes a bug, the whole sync pauses and says so. Admins have no limits.

export const USAGE_AREAS = ["repertoires", "training", "evals", "live", "meta"] as const;
export type UsageArea = (typeof USAGE_AREAS)[number];
export type UsageCount = { reads: number; writes: number };
export type UsageCounts = Record<UsageArea, UsageCount>;

export type UsageLimits = {
    /** Position store, per account and day. */
    evalReads: number;
    evalWrites: number;
    /** Everything together, per account and day; above it the sync pauses. */
    totalReads: number;
    totalWrites: number;
};

/** Defaults; config/limits in Firestore can change them without a new version. */
export const DEFAULT_LIMITS: UsageLimits = {
    evalReads: 4000,
    evalWrites: 1500,
    totalReads: 20000,
    totalWrites: 8000,
};

export function emptyCounts(): UsageCounts {
    return Object.fromEntries(USAGE_AREAS.map((a) => [a, { reads: 0, writes: 0 }])) as UsageCounts;
}

function nonNegative(v: unknown): number {
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

/** Counts from stored JSON (metadata or a device field); broken input counts as nothing. */
export function parseCounts(data: unknown): UsageCounts {
    const counts = emptyCounts();
    if (!data || typeof data !== "object") return counts;
    for (const area of USAGE_AREAS) {
        const c = (data as Record<string, unknown>)[area];
        if (c && typeof c === "object") {
            const { reads, writes } = c as Record<string, unknown>;
            counts[area] = { reads: nonNegative(reads), writes: nonNegative(writes) };
        }
    }
    return counts;
}

export function addCounts(a: UsageCounts, b: UsageCounts): UsageCounts {
    const sum = emptyCounts();
    for (const area of USAGE_AREAS) {
        sum[area] = {
            reads: a[area].reads + b[area].reads,
            writes: a[area].writes + b[area].writes,
        };
    }
    return sum;
}

export function totalOf(c: UsageCounts): UsageCount {
    return USAGE_AREAS.reduce(
        (t, a) => ({ reads: t.reads + c[a].reads, writes: t.writes + c[a].writes }),
        { reads: 0, writes: 0 },
    );
}

/** Limits from config/limits, with the defaults for anything missing or wrong. */
export function parseLimits(data: unknown): UsageLimits {
    const limits = { ...DEFAULT_LIMITS };
    if (!data || typeof data !== "object") return limits;
    for (const key of Object.keys(limits) as (keyof UsageLimits)[]) {
        const v = (data as Record<string, unknown>)[key];
        if (typeof v === "number" && Number.isFinite(v) && v >= 0) limits[key] = Math.floor(v);
    }
    return limits;
}

export type UsageDecision = {
    /** The position store may sync in this run. */
    evals: boolean;
    /** Anything may sync in this run. */
    sync: boolean;
};

/** What may sync, from the account's usage today (all devices) and the limits. */
export function decide(account: UsageCounts, limits: UsageLimits, admin: boolean): UsageDecision {
    if (admin) return { evals: true, sync: true };
    const total = totalOf(account);
    const sync = total.reads < limits.totalReads && total.writes < limits.totalWrites;
    const evals =
        sync && account.evals.reads < limits.evalReads && account.evals.writes < limits.evalWrites;
    return { evals, sync };
}

/** Local date as YYYY-MM-DD. */
export function usageDay(d = new Date()): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * This device's counts for one day. `read`/`write` are called by the sync
 * backends; a new day starts from zero.
 */
export class UsageMeter {
    day: string;
    counts: UsageCounts = emptyCounts();

    constructor(day = usageDay()) {
        this.day = day;
    }

    /** Switches to `day` (from zero) when it is a new one. */
    roll(day: string): void {
        if (day === this.day) return;
        this.day = day;
        this.counts = emptyCounts();
        this.loaded = null;
    }

    private loaded: string | null = null;
    private account: string | null = null;

    /** Whether the stored counts of `uid` for `day` still need to be added. */
    needsLoad(uid: string, day: string): boolean {
        return this.loaded !== `${uid} ${day}`;
    }

    /**
     * Adds the counts stored by an earlier app start for `uid` and `day`
     * (once). What was counted in this app start before is kept; a switch
     * of account starts from zero.
     */
    load(uid: string, day: string, stored: UsageCounts): void {
        if (!this.needsLoad(uid, day)) return;
        if (this.account !== null && this.account !== uid) this.counts = emptyCounts();
        this.account = uid;
        this.roll(day);
        this.counts = addCounts(this.counts, stored);
        this.loaded = `${uid} ${day}`;
    }

    /**
     * A query that returned `docs` documents. Firestore bills at least one
     * read per query, also for an empty result.
     */
    read(area: UsageArea, docs: number): void {
        this.counts[area].reads += Math.max(1, docs);
    }

    write(area: UsageArea, docs: number): void {
        this.counts[area].writes += docs;
    }
}

/** The meter of this app (one account at a time; see sync.ts). */
export const usageMeter = new UsageMeter();
