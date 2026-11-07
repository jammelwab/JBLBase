import { fetch } from "@tauri-apps/plugin-http";
import { arch, type Platform } from "@tauri-apps/plugin-os";
import useSWR from "swr";
import { z } from "zod";
import { type BestMoves, commands, type EngineOptions, type GoMode } from "@/bindings";
import { unwrap } from "./unwrap";

export const requiredEngineSettings = ["MultiPV", "Threads", "Hash"];

const goModeSchema: z.ZodSchema<GoMode> = z.union([
    z.object({
        t: z.literal("Depth"),
        c: z.number(),
    }),
    z.object({
        t: z.literal("Time"),
        c: z.number(),
    }),
    z.object({
        t: z.literal("Nodes"),
        c: z.number(),
    }),
    z.object({
        t: z.literal("Infinite"),
    }),
]);

const engineSettingsSchema = z.array(
    z.object({
        name: z.string(),
        value: z.string().or(z.number()).or(z.boolean()).nullable(),
    }),
);

export type EngineSettings = z.infer<typeof engineSettingsSchema>;

const localEngineSchema = z.object({
    type: z.literal("local"),
    id: z.string().default(() => crypto.randomUUID()),
    name: z.string(),
    version: z.string(),
    path: z.string(),
    image: z.string().nullish(),
    elo: z.number().nullish(),
    downloadSize: z.number().nullish(),
    downloadLink: z.string().nullish(),
    loaded: z.boolean().nullish(),
    go: goModeSchema.nullish(),
    enabled: z.boolean().nullish(),
    settings: engineSettingsSchema.nullish(),
});

export type LocalEngine = z.output<typeof localEngineSchema>;

const remoteEngineSchema = z.object({
    type: z.enum(["chessdb", "lichess"]),
    id: z.string().default(() => crypto.randomUUID()),
    name: z.string(),
    url: z.string(),
    image: z.string().nullish(),
    loaded: z.boolean().nullish(),
    enabled: z.boolean().nullish(),
    go: goModeSchema.nullish(),
    settings: engineSettingsSchema.nullish(),
});

export type RemoteEngine = z.output<typeof remoteEngineSchema>;

export const engineSchema = z.union([localEngineSchema, remoteEngineSchema]);
export type Engine = z.output<typeof engineSchema>;

export function stopEngine(engine: LocalEngine, tab: string): Promise<void> {
    return commands.stopEngine(engine.id, tab).then((r) => {
        unwrap(r);
    });
}

export function killEngine(engine: LocalEngine, tab: string): Promise<void> {
    return commands.killEngine(engine.id, tab).then((r) => {
        unwrap(r);
    });
}

export function getBestMoves(
    engine: LocalEngine,
    tab: string,
    goMode: GoMode,
    options: EngineOptions,
): Promise<[number, BestMoves[]] | null> {
    return commands
        .getBestMoves(engine.id, engine.path, tab, goMode, options)
        .then((r) => unwrap(r));
}

const JBLBASE_ENGINES_URL = "https://github.com/jammelwab/JBLBase/releases/download";

/** Engines JBLBase offers in addition to the En Croissant download list. */
function extraEngines(os: Platform, cpu: string): LocalEngine[] {
    const patricia = {
        type: "local" as const,
        id: "patricia-5.1",
        name: "Patricia",
        version: "5.1",
        image: "/engines/patricia.png",
    };
    if (os === "macos" && cpu === "aarch64") {
        const file = "patricia-macos-arm64";
        return [
            {
                ...patricia,
                path: file,
                downloadLink: `${JBLBASE_ENGINES_URL}/patricia-5.1/${file}`,
            },
        ];
    }
    if (os === "windows" && cpu === "x86_64") {
        const file = "patricia-windows-x64.exe";
        return [
            {
                ...patricia,
                path: file,
                downloadLink: `${JBLBASE_ENGINES_URL}/patricia-5.1/${file}`,
            },
        ];
    }
    return [];
}

export function useDefaultEngines(os: Platform | undefined, opened: boolean) {
    const { data, error, isLoading } = useSWR(opened ? os : null, async (os: Platform) => {
        const extra = extraEngines(os, arch());
        try {
            const bmi2: boolean = await commands.isBmi2Compatible();
            const data = await fetch(`https://www.encroissant.org/engines?os=${os}&bmi2=${bmi2}`, {
                method: "GET",
            });
            if (!data.ok) {
                throw new Error("Failed to fetch engines");
            }
            const list = (await data.json()).filter(
                (e: { os: Platform; bmi2: boolean }) => e.os === os && e.bmi2 === bmi2,
            );
            return [...list, ...extra] as LocalEngine[];
        } catch (e) {
            // Still offer our own engines when the En Croissant list is down.
            if (extra.length > 0) return extra;
            throw e;
        }
    });
    return {
        defaultEngines: data as LocalEngine[],
        error,
        isLoading,
    };
}
