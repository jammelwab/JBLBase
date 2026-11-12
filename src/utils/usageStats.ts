// Anonymous usage statistics (Firebase / Google Analytics 4).
//
// Off unless the person switches it on (Settings → Privacy). Nothing is sent
// before that, and nothing at all while `analyticsConfig` is empty.
//
// Events go straight to the GA4 Measurement Protocol instead of through the
// Firebase Analytics SDK: that SDK loads a script from Google into the app
// window and sets cookies, neither of which a desktop app should do. This
// way the app decides alone what is sent: an event name and a few fixed
// words or rounded numbers, never a name, a position, a file or the account.

import { analyticsConfig } from "./cloud/firebaseConfig";

/** Storage key of the switch (see `usageStatsAtom`). */
export const USAGE_STATS_KEY = "usage-stats";
/** Random id of this installation; exists only while the switch is on. */
export const USAGE_CLIENT_KEY = "usage-stats-client";

/** EU collection endpoint of the Measurement Protocol. */
export const USAGE_ENDPOINT = "https://region1.google-analytics.com/mp/collect";

const MAX_EVENTS_PER_REQUEST = 25;
const MAX_QUEUE = 100;
const FLUSH_DELAY_MS = 3000;
const MAX_ENGAGEMENT_MS = 5 * 60 * 1000;

export type UsageValue = string | number | boolean | null | undefined;
export type UsageParams = Record<string, UsageValue>;

export type UsageEvent = {
    name: string;
    params: Record<string, string | number>;
};

export type UsageContext = {
    appVersion: string;
    os: string;
    language: string;
};

export type UsagePayload = {
    client_id: string;
    non_personalized_ads: true;
    consent: { ad_user_data: "DENIED"; ad_personalization: "DENIED" };
    user_properties: Record<string, { value: string }>;
    events: UsageEvent[];
};

export type UsageTransport = (url: string, body: string) => Promise<void>;

export function usageStatsConfigured(
    config: {
        measurementId: string;
        apiSecret: string;
    } = analyticsConfig,
): boolean {
    return /^G-[A-Z0-9]+$/.test(config.measurementId) && config.apiSecret.length > 0;
}

function readStorage(key: string): string | null {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

export function usageStatsEnabled(): boolean {
    return usageStatsConfigured() && readStorage(USAGE_STATS_KEY) === "true";
}

/** A count as a rough size, so that no exact number leaves the device. */
export function bucket(count: number): string {
    if (!Number.isFinite(count) || count <= 0) return "0";
    if (count < 10) return "1-9";
    if (count < 50) return "10-49";
    if (count < 200) return "50-199";
    if (count < 1000) return "200-999";
    return "1000+";
}

/**
 * The page of a route as one fixed word. Only the first part of the path
 * counts: what follows can be the name of a database.
 */
export function pageName(pathname: string): string {
    const first = pathname.split("/").find((part) => part.length > 0);
    if (!first) return "board";
    return /^[a-z]{1,20}$/.test(first) ? first : "other";
}

const NAME_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

/** Keeps only short, plain values under plain names. */
export function cleanParams(params: UsageParams = {}): Record<string, string | number> {
    const clean: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(params)) {
        if (!NAME_PATTERN.test(key)) continue;
        if (typeof value === "number") {
            if (Number.isFinite(value)) clean[key] = value;
        } else if (typeof value === "boolean") {
            clean[key] = value ? "yes" : "no";
        } else if (typeof value === "string" && value.length > 0) {
            clean[key] = value.slice(0, 40);
        }
    }
    return clean;
}

export function buildPayload(
    clientId: string,
    context: UsageContext,
    events: UsageEvent[],
): UsagePayload {
    return {
        client_id: clientId,
        non_personalized_ads: true,
        consent: { ad_user_data: "DENIED", ad_personalization: "DENIED" },
        user_properties: {
            app_version: { value: context.appVersion },
            os: { value: context.os },
            app_language: { value: context.language },
        },
        events,
    };
}

function clientId(): string | null {
    try {
        let id = localStorage.getItem(USAGE_CLIENT_KEY);
        if (!id) {
            id = crypto.randomUUID();
            localStorage.setItem(USAGE_CLIENT_KEY, id);
        }
        return id;
    } catch {
        return null;
    }
}

const defaultTransport: UsageTransport = async (url, body) => {
    const { fetch } = await import("@tauri-apps/plugin-http");
    await fetch(url, { method: "POST", body, headers: { "Content-Type": "application/json" } });
};

let transport: UsageTransport = defaultTransport;
let context: UsageContext | null = null;
let queue: UsageEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let sessionId = Math.floor(Date.now() / 1000);
let lastEventAt = 0;

/** Version, system and language sent along; events wait until this is set. */
export function initUsageStats(ctx: UsageContext) {
    context = ctx;
    if (queue.length > 0) schedule();
}

function schedule() {
    if (timer !== null) return;
    timer = setTimeout(() => {
        timer = null;
        void flushUsageStats();
    }, FLUSH_DELAY_MS);
}

/**
 * Counts one use of a feature. Does nothing while the switch is off. Never
 * throws and never waits for the network.
 */
export function trackUsage(name: string, params?: UsageParams, now = Date.now()) {
    if (!NAME_PATTERN.test(name) || !usageStatsEnabled()) return;
    const engagement = lastEventAt ? Math.min(now - lastEventAt, MAX_ENGAGEMENT_MS) : 1;
    lastEventAt = now;
    queue.push({
        name,
        params: {
            ...cleanParams(params),
            session_id: sessionId,
            engagement_time_msec: Math.max(1, engagement),
        },
    });
    if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
    schedule();
}

/** Sends what is waiting. A failed request is dropped, not repeated. */
export async function flushUsageStats(): Promise<void> {
    if (!context || queue.length === 0) return;
    if (!usageStatsEnabled()) {
        queue = [];
        return;
    }
    const id = clientId();
    if (!id) {
        queue = [];
        return;
    }
    const url = `${USAGE_ENDPOINT}?measurement_id=${encodeURIComponent(
        analyticsConfig.measurementId,
    )}&api_secret=${encodeURIComponent(analyticsConfig.apiSecret)}`;
    while (queue.length > 0) {
        const events = queue.splice(0, MAX_EVENTS_PER_REQUEST);
        try {
            await transport(url, JSON.stringify(buildPayload(id, context, events)));
        } catch {
            // Statistics must never get in the way of the app.
        }
    }
}

/** Switching off: drops what is waiting and the id of this installation. */
export function forgetUsageStats() {
    queue = [];
    lastEventAt = 0;
    if (timer !== null) {
        clearTimeout(timer);
        timer = null;
    }
    try {
        localStorage.removeItem(USAGE_CLIENT_KEY);
    } catch {}
}

/** For tests. */
export function resetUsageStatsForTest(next?: UsageTransport) {
    forgetUsageStats();
    transport = next ?? defaultTransport;
    context = null;
    sessionId = Math.floor(Date.now() / 1000);
}
