import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyticsConfig } from "./cloud/firebaseConfig";
import {
    bigBucket,
    bucket,
    buildPayload,
    cleanParams,
    DAY_MS,
    engineFamily,
    errorKind,
    HOUR_MS,
    flushUsageStats,
    forgetUsageStats,
    initUsageStats,
    pageName,
    resetUsageStatsForTest,
    setUsageAccount,
    shareBucket,
    trackUsage,
    trackUsageThrottled,
    USAGE_CLIENT_KEY,
    USAGE_STATS_KEY,
    type UsagePayload,
    usageStatsConfigured,
    usageStatsEnabled,
} from "./usageStats";

const context = { appVersion: "1.2.3", os: "windows", language: "de" };

function memoryStorage(): Storage {
    const data = new Map<string, string>();
    return {
        getItem: (k) => data.get(k) ?? null,
        setItem: (k, v) => void data.set(k, v),
        removeItem: (k) => void data.delete(k),
        clear: () => data.clear(),
        key: () => null,
        get length() {
            return data.size;
        },
    };
}

describe("usage statistics helpers", () => {
    it("needs a measurement id and a secret", () => {
        expect(usageStatsConfigured({ measurementId: "", apiSecret: "" })).toBe(false);
        expect(usageStatsConfigured({ measurementId: "G-ABC123", apiSecret: "" })).toBe(false);
        expect(usageStatsConfigured({ measurementId: "UA-1", apiSecret: "x" })).toBe(false);
        expect(usageStatsConfigured({ measurementId: "G-ABC123", apiSecret: "x" })).toBe(true);
    });

    it("rounds counts to rough sizes", () => {
        expect(bucket(0)).toBe("0");
        expect(bucket(Number.NaN)).toBe("0");
        expect(bucket(7)).toBe("1-9");
        expect(bucket(10)).toBe("10-49");
        expect(bucket(199)).toBe("50-199");
        expect(bucket(200)).toBe("200-999");
        expect(bucket(48213)).toBe("1000+");
    });

    it("names a page by the first part of the path only", () => {
        expect(pageName("/")).toBe("board");
        expect(pageName("/insight")).toBe("insight");
        expect(pageName("/databases/Jannick%20Lichess")).toBe("databases");
        expect(pageName("/Some Name")).toBe("other");
    });

    it("keeps only short plain parameters", () => {
        expect(
            cleanParams({
                depth: 18,
                ok: true,
                source: "lichess",
                long: "x".repeat(200),
                "Bad Key": "x",
                empty: "",
                nothing: undefined,
                broken: Number.POSITIVE_INFINITY,
            }),
        ).toEqual({ depth: 18, ok: "yes", source: "lichess", long: "x".repeat(40) });
    });

    it("builds a payload without advertising use", () => {
        const payload = buildPayload("id-1", context, [{ name: "app_open", params: {} }]);
        expect(payload.client_id).toBe("id-1");
        expect(payload.non_personalized_ads).toBe(true);
        expect(payload.consent).toEqual({ ad_user_data: "DENIED", ad_personalization: "DENIED" });
        expect(payload.user_properties.app_version.value).toBe("1.2.3");
        expect(payload).not.toHaveProperty("user_id");
        expect(payload.user_properties.account.value).toBe("none");
    });

    it("rounds large counts and shares (#115)", () => {
        expect(bigBucket(12)).toBe("10-49");
        expect(bigBucket(4_500)).toBe("1000-9999");
        expect(bigBucket(48_213)).toBe("10000-99999");
        expect(bigBucket(250_000)).toBe("100000-999999");
        expect(bigBucket(3_000_000)).toBe("1000000+");
        expect(shareBucket(0, 0)).toBe("0-24");
        expect(shareBucket(10, 100)).toBe("0-24");
        expect(shareBucket(25, 100)).toBe("25-49");
        expect(shareBucket(60, 100)).toBe("50-74");
        expect(shareBucket(100, 100)).toBe("75-100");
    });

    it("names engines and errors with fixed words only", () => {
        expect(engineFamily("Stockfish 19")).toBe("stockfish");
        expect(engineFamily("/opt/engines/patricia-windows-x64.exe")).toBe("patricia");
        expect(engineFamily("Mein Testmotor")).toBe("other");
        expect(engineFamily(undefined)).toBe("other");
        expect(errorKind({ code: "permission-denied" })).toBe("permission");
        expect(errorKind({ code: "resource-exhausted" })).toBe("quota");
        expect(errorKind(new Error("Failed to fetch"))).toBe("network");
        expect(errorKind(new Error("Repertoire 'Ich Weiß' kaputt"))).toBe("other");
    });
});

describe("sending usage statistics", () => {
    let sent: { url: string; payload: UsagePayload }[];

    beforeEach(() => {
        vi.stubGlobal("localStorage", memoryStorage());
        analyticsConfig.measurementId = "G-TEST123";
        analyticsConfig.apiSecret = "secret";
        sent = [];
        resetUsageStatsForTest(async (url, body) => {
            sent.push({ url, payload: JSON.parse(body) });
        });
        initUsageStats(context);
    });

    afterEach(() => {
        resetUsageStatsForTest();
        analyticsConfig.measurementId = "";
        analyticsConfig.apiSecret = "";
        vi.unstubAllGlobals();
    });

    it("sends nothing while the switch is off", async () => {
        expect(usageStatsEnabled()).toBe(false);
        trackUsage("app_open");
        await flushUsageStats();
        expect(sent).toEqual([]);
        expect(localStorage.getItem(USAGE_CLIENT_KEY)).toBeNull();
    });

    it("sends nothing while the stream is not set up", async () => {
        localStorage.setItem(USAGE_STATS_KEY, "true");
        analyticsConfig.apiSecret = "";
        trackUsage("app_open");
        await flushUsageStats();
        expect(sent).toEqual([]);
    });

    it("sends the waiting events in one request to the EU endpoint", async () => {
        localStorage.setItem(USAGE_STATS_KEY, "true");
        trackUsage("app_open", undefined, 1000);
        trackUsage("insight_run", { depth: 18, games: bucket(120) }, 61_000);
        trackUsage("Not A Name");
        await flushUsageStats();

        expect(sent).toHaveLength(1);
        expect(sent[0].url).toBe(
            "https://region1.google-analytics.com/mp/collect?measurement_id=G-TEST123&api_secret=secret",
        );
        const { payload } = sent[0];
        expect(payload.client_id).toBe(localStorage.getItem(USAGE_CLIENT_KEY));
        expect(payload.events.map((e) => e.name)).toEqual(["app_open", "insight_run"]);
        expect(payload.events[1].params).toMatchObject({
            depth: 18,
            games: "50-199",
            engagement_time_msec: 60_000,
        });
        expect(payload.events[0].params.session_id).toBe(payload.events[1].params.session_id);

        await flushUsageStats();
        expect(sent).toHaveLength(1);
    });

    it("splits more than 25 events over several requests", async () => {
        localStorage.setItem(USAGE_STATS_KEY, "true");
        for (let i = 0; i < 30; i++) trackUsage("tab_open", { tab_type: "analysis" });
        await flushUsageStats();
        expect(sent.map((s) => s.payload.events.length)).toEqual([25, 5]);
    });

    it("drops waiting events and the id when switched off", async () => {
        localStorage.setItem(USAGE_STATS_KEY, "true");
        trackUsage("app_open");
        await flushUsageStats();
        const first = localStorage.getItem(USAGE_CLIENT_KEY);
        expect(first).not.toBeNull();

        trackUsage("page_view", { page_title: "insight" });
        localStorage.setItem(USAGE_STATS_KEY, "false");
        forgetUsageStats();
        await flushUsageStats();
        expect(sent).toHaveLength(1);
        expect(localStorage.getItem(USAGE_CLIENT_KEY)).toBeNull();

        localStorage.setItem(USAGE_STATS_KEY, "true");
        trackUsage("app_open");
        await flushUsageStats();
        expect(sent[1].payload.client_id).not.toBe(first);
    });

    it("counts frequent events at most once per key and interval", async () => {
        localStorage.setItem(USAGE_STATS_KEY, "true");
        const t0 = 1_000_000;
        trackUsageThrottled("sync_run", { area: "training" }, "training", HOUR_MS, t0);
        trackUsageThrottled("sync_run", { area: "training" }, "training", HOUR_MS, t0 + 60_000);
        trackUsageThrottled("sync_run", { area: "evals" }, "evals", HOUR_MS, t0 + 60_000);
        trackUsageThrottled("sync_run", { area: "training" }, "training", HOUR_MS, t0 + HOUR_MS);
        trackUsageThrottled("sync_paused", { limit: "total" }, "total", DAY_MS, t0);
        await flushUsageStats();
        expect(
            sent[0].payload.events.map((e) => `${e.name}:${e.params.area ?? e.params.limit}`),
        ).toEqual([
            "sync_run:training",
            "sync_run:evals",
            "sync_run:training",
            "sync_paused:total",
        ]);
    });

    it("does not throttle while switched off, so the first event after switching on counts", async () => {
        trackUsageThrottled("engine_start", { engine: "stockfish" }, "sf", HOUR_MS, 1000);
        localStorage.setItem(USAGE_STATS_KEY, "true");
        trackUsageThrottled("engine_start", { engine: "stockfish" }, "sf", HOUR_MS, 2000);
        await flushUsageStats();
        expect(sent[0].payload.events.map((e) => e.name)).toEqual(["engine_start"]);
    });

    it("sends the kind of account, never which one", async () => {
        localStorage.setItem(USAGE_STATS_KEY, "true");
        setUsageAccount("admin");
        trackUsage("app_open");
        await flushUsageStats();
        expect(sent[0].payload.user_properties.account.value).toBe("admin");
        expect(JSON.stringify(sent[0].payload)).not.toMatch(/uid|@/);
    });

    it("survives a failing request", async () => {
        localStorage.setItem(USAGE_STATS_KEY, "true");
        resetUsageStatsForTest(async () => {
            throw new Error("offline");
        });
        initUsageStats(context);
        trackUsage("app_open");
        await expect(flushUsageStats()).resolves.toBeUndefined();
    });
});
