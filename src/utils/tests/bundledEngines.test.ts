import { describe, expect, it } from "vitest";
import type { BundledEngine, EngineConfig } from "@/bindings";
import { bundledSettings, planBundledEngines, recommendedPower } from "../bundledEngines";
import type { Engine } from "../engines";

const sf: BundledEngine = {
    id: "stockfish-19",
    name: "Stockfish",
    version: "19",
    path: "/e/bundled/stockfish-19/stockfish",
};
const pat: BundledEngine = {
    id: "patricia-5.1",
    name: "Patricia",
    version: "5.1",
    path: "/e/bundled/patricia-5.1/patricia",
};
const local = (id: string, name: string, path: string, version = "1"): Engine => ({
    type: "local",
    id,
    name,
    version,
    path,
});

describe("planBundledEngines", () => {
    it("adds both on a fresh install", () => {
        const plan = planBundledEngines([], [sf, pat], {});
        expect(plan.add).toEqual([sf, pat]);
        expect(plan.update).toEqual([]);
    });

    it("keeps the user's own engine of the same kind", () => {
        const own = local("a", "Stockfish 17", "/x/stockfish-windows-x86-64-avx2.exe");
        const viaPath = local("b", "My attacker", "/x/patricia-macos-arm64");
        const plan = planBundledEngines([own, viaPath], [sf, pat], {});
        expect(plan.add).toEqual([]);
        expect(plan.record).toEqual({
            stockfish: { engineId: null, version: "19" },
            patricia: { engineId: null, version: "5.1" },
        });
    });

    it("does not bring back an engine the user removed", () => {
        const plan = planBundledEngines([], [sf], {
            stockfish: { engineId: "gone", version: "19" },
        });
        expect(plan.add).toEqual([]);
        expect(plan.update).toEqual([]);
    });

    it("points an engine from an older bundle to the new program", () => {
        const old = local("s", "Stockfish", "/e/bundled/stockfish-18/stockfish", "18");
        const plan = planBundledEngines([old], [sf], {
            stockfish: { engineId: "s", version: "18" },
        });
        expect(plan.update).toEqual([{ engineId: "s", bundled: sf }]);
        expect(plan.record.stockfish).toEqual({ engineId: "s", version: "19" });
    });

    it("does nothing when everything is current", () => {
        const cur = local("s", "Stockfish", sf.path, "19");
        const plan = planBundledEngines([cur], [sf], {
            stockfish: { engineId: "s", version: "19" },
        });
        expect(plan.add).toEqual([]);
        expect(plan.update).toEqual([]);
    });
});

describe("recommendedPower", () => {
    it("Stockfish: up to 10 threads with one core free, up to 4 GB", () => {
        expect(recommendedPower("stockfish", 16, 32768)).toEqual({ threads: 10, hash: 4096 });
        expect(recommendedPower("stockfish", 8, 8192)).toEqual({ threads: 7, hash: 2048 });
        expect(recommendedPower("stockfish", 1, 1000)).toEqual({ threads: 1, hash: 128 });
    });

    it("Patricia: 2 threads, up to 1 GB", () => {
        expect(recommendedPower("patricia", 16, 32768)).toEqual({ threads: 2, hash: 1024 });
        expect(recommendedPower("patricia", 1, 4096)).toEqual({ threads: 1, hash: 512 });
    });
});

describe("bundledSettings", () => {
    it("uses the engine's MultiPV default and respects its limits", () => {
        const config: EngineConfig = {
            name: "Stockfish 19",
            options: [
                {
                    type: "spin",
                    value: {
                        name: "MultiPV",
                        default: BigInt(1),
                        min: BigInt(1),
                        max: BigInt(256),
                    },
                },
                {
                    type: "spin",
                    value: { name: "Threads", default: BigInt(1), min: BigInt(1), max: BigInt(4) },
                },
                {
                    type: "spin",
                    value: {
                        name: "Hash",
                        default: BigInt(16),
                        min: BigInt(1),
                        max: BigInt(33554432),
                    },
                },
            ],
        };
        expect(bundledSettings(config, "stockfish", 16, 32768)).toEqual([
            { name: "MultiPV", value: 1 },
            { name: "Threads", value: 4 },
            { name: "Hash", value: 4096 },
        ]);
    });

    it("works without a configuration", () => {
        expect(bundledSettings(null, "patricia", 4, 8192)).toEqual([
            { name: "MultiPV", value: 1 },
            { name: "Threads", value: 2 },
            { name: "Hash", value: 1024 },
        ]);
    });
});
