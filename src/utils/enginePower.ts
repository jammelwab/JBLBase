import { atomWithStorage } from "jotai/utils";
import type { EngineOption } from "@/bindings";

// How much of the computer the long analyses (tactic search, Insight, checking reported
// puzzles) may use. The level sets the engine's threads and hash; the rest of the engine's
// settings stay as they are.
export const POWER_LEVELS = ["low", "medium", "high", "max"] as const;
export type PowerLevel = (typeof POWER_LEVELS)[number];

export const enginePowerAtom = atomWithStorage<PowerLevel>("engine-power", "medium");

export function cpuCores(): number {
    const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency : 0;
    return cores && cores > 0 ? cores : 4;
}

export function powerSettings(level: PowerLevel, cores = cpuCores()) {
    switch (level) {
        case "low":
            return { threads: Math.max(1, Math.floor(cores / 4)), hash: 64 };
        case "medium":
            return { threads: Math.max(1, Math.floor(cores / 2)), hash: 256 };
        case "high":
            // One core stays free, so the app and the computer remain usable.
            return { threads: Math.max(1, cores - 1), hash: 512 };
        case "max":
            return { threads: cores, hash: 1024 };
    }
}

// The engine's own settings with threads and hash set by the power level.
export function withPower(
    options: EngineOption[],
    level: PowerLevel,
    cores = cpuCores(),
): EngineOption[] {
    const { threads, hash } = powerSettings(level, cores);
    return [
        ...options.filter((o) => !/^(threads|hash)$/i.test(o.name)),
        { name: "Threads", value: threads.toString() },
        { name: "Hash", value: hash.toString() },
    ];
}

// Engine settings as the backend wants them, with the power level applied.
export function engineOptions(
    settings: { name: string; value?: string | number | boolean | null }[] | undefined,
    level: PowerLevel,
): EngineOption[] {
    return withPower(
        (settings ?? []).map((s) => ({ name: s.name, value: s.value?.toString() ?? "" })),
        level,
    );
}
