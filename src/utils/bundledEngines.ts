// Engines that ship with the installer (Stockfish and Patricia). On start the
// app copies them into the engines folder (install_bundled_engines) and adds
// each one once, with settings that suit the computer. Whoever already has an
// engine of the same kind keeps theirs; an engine removed by hand stays away.

import { atomWithStorage } from "jotai/utils";
import type { BundledEngine, EngineConfig } from "@/bindings";
import type { Engine, EngineSettings, LocalEngine } from "./engines";

/** Per kind of engine ("stockfish"): the engine added for it, null when the user kept their own. */
export type BundledRecord = Record<string, { engineId: string | null; version: string }>;

export const bundledEnginesAtom = atomWithStorage<BundledRecord>("bundled-engines", {});

export function engineKind(name: string): string {
    return name.trim().toLowerCase();
}

function sameKind(engine: Engine, kind: string): boolean {
    return (
        engine.type === "local" &&
        (engine.name.toLowerCase().includes(kind) || engine.path.toLowerCase().includes(kind))
    );
}

/** Largest power of two not above n (at least 16). */
function pow2Floor(n: number): number {
    return Math.max(16, 2 ** Math.floor(Math.log2(Math.max(1, n))));
}

/**
 * Threads and hash for a bundled engine. Stockfish: up to 10 threads, one
 * core stays free, hash up to 4 GB and a quarter of the memory. Patricia
 * (the attacking engine, used for side jobs): 2 threads, up to 1 GB.
 */
export function recommendedPower(kind: string, cores: number, memoryMb: number) {
    if (kind === "patricia") {
        return {
            threads: Math.min(2, Math.max(1, cores)),
            hash: Math.min(1024, pow2Floor(memoryMb / 8)),
        };
    }
    return {
        threads: Math.min(10, Math.max(1, cores - 1)),
        hash: Math.min(4096, pow2Floor(memoryMb / 4)),
    };
}

/** The engine's own defaults for MultiPV, Threads and Hash, with threads and hash set as recommended. */
export function bundledSettings(
    config: EngineConfig | null,
    kind: string,
    cores: number,
    memoryMb: number,
): EngineSettings {
    const { threads, hash } = recommendedPower(kind, cores, memoryMb);
    const options = config?.options ?? [];
    const spin = (name: string) => {
        const o = options.find((o) => o.value.name.toLowerCase() === name.toLowerCase());
        return o?.type === "spin" ? o.value : null;
    };
    const clamp = (name: string, v: number) => {
        const o = spin(name);
        const max = o?.max != null ? Number(o.max) : Number.POSITIVE_INFINITY;
        const min = o?.min != null ? Number(o.min) : 1;
        return Math.max(min, Math.min(max, v));
    };
    const multiPv = spin("MultiPV");
    return [
        { name: "MultiPV", value: multiPv?.default != null ? Number(multiPv.default) : 1 },
        { name: "Threads", value: clamp("Threads", threads) },
        { name: "Hash", value: clamp("Hash", hash) },
    ];
}

export type BundledPlan = {
    /** Not there yet: add these. */
    add: BundledEngine[];
    /** Added by an earlier version: point them to the new program. */
    update: { engineId: string; bundled: BundledEngine }[];
    record: BundledRecord;
};

/** What to do with the bundled engines, given the user's engines and what happened before. */
export function planBundledEngines(
    engines: Engine[],
    bundled: BundledEngine[],
    record: BundledRecord,
): BundledPlan {
    const plan: BundledPlan = { add: [], update: [], record: { ...record } };
    for (const b of bundled) {
        const kind = engineKind(b.name);
        const seen = record[kind];
        if (seen) {
            const own = seen.engineId ? engines.find((e) => e.id === seen.engineId) : undefined;
            if (own && own.type === "local" && (own.path !== b.path || own.version !== b.version)) {
                plan.update.push({ engineId: own.id, bundled: b });
                plan.record[kind] = { engineId: own.id, version: b.version };
            }
            continue;
        }
        if (engines.some((e) => sameKind(e, kind))) {
            plan.record[kind] = { engineId: null, version: b.version };
            continue;
        }
        plan.add.push(b);
    }
    return plan;
}

export function bundledEngineEntry(
    b: BundledEngine,
    id: string,
    settings: EngineSettings,
): LocalEngine {
    return {
        type: "local",
        id,
        name: b.name,
        version: b.version,
        path: b.path,
        image: engineKind(b.name) === "patricia" ? "/engines/patricia.png" : undefined,
        loaded: true,
        settings,
    };
}
