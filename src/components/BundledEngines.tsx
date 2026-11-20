import { useSetAtom, useStore } from "jotai";
import { useEffect } from "react";
import { commands } from "@/bindings";
import { enginesAtom } from "@/state/atoms";
import {
  bundledEngineEntry,
  bundledEnginesAtom,
  bundledSettings,
  engineKind,
  planBundledEngines,
} from "@/utils/bundledEngines";
import { getEnginesDir } from "@/utils/directories";
import { cpuCores } from "@/utils/enginePower";
import type { Engine } from "@/utils/engines";

/** Once per app start, even when React runs the effect twice. */
let started = false;

/**
 * Sets up the engines that ship with the installer (Stockfish, Patricia):
 * copies them into the engines folder and adds the ones the user does not
 * have yet. Renders nothing.
 */
export default function BundledEngines() {
  const store = useStore();
  const setEngines = useSetAtom(enginesAtom);

  useEffect(() => {
    if (started) return;
    started = true;
    (async () => {
      const res = await commands.installBundledEngines(await getEnginesDir());
      if (res.status !== "ok") {
        console.error("Bundled engines:", res.error);
        return;
      }
      if (res.data.length === 0) return;
      const memoryMb = await commands.memorySize().catch(() => 8192);
      setEngines(async (prev) => {
        const list: Engine[] = (await prev) ?? [];
        const plan = planBundledEngines(list, res.data, store.get(bundledEnginesAtom));
        const record = { ...plan.record };
        const added: Engine[] = [];
        for (const b of plan.add) {
          const config = await commands.getEngineConfig(b.path).catch(() => null);
          if (!config || config.status !== "ok") {
            console.error(`Bundled engine ${b.name} does not start`, config?.error);
            continue;
          }
          const kind = engineKind(b.name);
          const id = crypto.randomUUID();
          added.push(
            bundledEngineEntry(b, id, bundledSettings(config.data, kind, cpuCores(), memoryMb)),
          );
          record[kind] = { engineId: id, version: b.version };
        }
        store.set(bundledEnginesAtom, record);
        if (added.length === 0 && plan.update.length === 0) return list;
        const updated = list.map((e) => {
          const u = plan.update.find((u) => u.engineId === e.id);
          return u && e.type === "local"
            ? { ...e, path: u.bundled.path, version: u.bundled.version }
            : e;
        });
        return [...updated, ...added];
      });
    })().catch((e) => console.error("Bundled engines:", e));
  }, [store, setEngines]);

  return null;
}
