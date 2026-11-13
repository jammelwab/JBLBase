import { expect, test } from "vitest";
import {
    estimateSeconds,
    formatDuration,
    recordSpeed,
    remainingSeconds,
    speedKey,
} from "../analysisTime";
import { engineOptions, powerSettings, withPower } from "../enginePower";

test("power levels share out the cores", () => {
    expect(powerSettings("low", 8)).toEqual({ threads: 2, hash: 64 });
    expect(powerSettings("medium", 8)).toEqual({ threads: 4, hash: 256 });
    expect(powerSettings("high", 8)).toEqual({ threads: 7, hash: 512 });
    expect(powerSettings("max", 8)).toEqual({ threads: 8, hash: 1024 });
    expect(powerSettings("low", 2).threads).toBe(1);
});

test("the power level replaces threads and hash, nothing else", () => {
    const options = withPower(
        [
            { name: "threads", value: "1" },
            { name: "Hash", value: "16" },
            { name: "MultiPV", value: "1" },
        ],
        "medium",
        8,
    );
    expect(options).toEqual([
        { name: "MultiPV", value: "1" },
        { name: "Threads", value: "4" },
        { name: "Hash", value: "256" },
    ]);
    expect(engineOptions([{ name: "UCI_Elo", value: 1500 }], "low").map((o) => o.name)).toEqual([
        "UCI_Elo",
        "Threads",
        "Hash",
    ]);
});

test("estimates come from measured runs, else from a rough guess", () => {
    const guess = estimateSeconds({}, "insight", 18, "medium", 10, 8);
    expect(guess.measured).toBe(false);
    expect(guess.seconds).toBeCloseTo(450);
    // Deeper costs more, more threads less.
    expect(estimateSeconds({}, "insight", 24, "medium", 10, 8).seconds).toBeGreaterThan(450);
    expect(estimateSeconds({}, "insight", 18, "max", 10, 8).seconds).toBeLessThan(450);

    let speeds = recordSpeed({}, "insight", 18, "medium", 300, 10);
    expect(speeds[speedKey("insight", 18, "medium")]).toBe(30);
    expect(estimateSeconds(speeds, "insight", 18, "medium", 4)).toEqual({
        seconds: 120,
        measured: true,
    });
    // A newer run counts more.
    speeds = recordSpeed(speeds, "insight", 18, "medium", 100, 10);
    expect(speeds[speedKey("insight", 18, "medium")]).toBeCloseTo(18);
    // A run that did nothing changes nothing.
    expect(recordSpeed(speeds, "insight", 18, "medium", 50, 0)).toBe(speeds);
});

test("time left follows the share done", () => {
    expect(remainingSeconds(2, 50)).toBeNull();
    expect(remainingSeconds(60, 0.5)).toBeNull();
    expect(remainingSeconds(60, 25)).toBe(180);
});

test("durations read naturally", () => {
    const t = (key: string, o?: Record<string, unknown>) => `${key} ${JSON.stringify(o ?? {})}`;
    expect(formatDuration(30, t)).toBe("Eta.UnderMinute {}");
    expect(formatDuration(600, t)).toBe('Eta.Minutes {"count":10}');
    expect(formatDuration(3 * 3600 + 5 * 60, t)).toBe('Eta.HoursMinutes {"hours":3,"minutes":5}');
});
