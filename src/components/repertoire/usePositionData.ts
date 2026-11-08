import { useEffect, useRef, useState } from "react";

// Loads data for many positions at once (one request per position, each only once) and
// collects the results, so a whole tree can be laid out from them.
export function usePositionData<T>(
    fens: string[],
    load: (fen: string) => Promise<T>,
    enabled: boolean,
): Map<string, T> {
    const [data, setData] = useState(() => new Map<string, T>());
    const requested = useRef(new Set<string>());
    const key = fens.join("\n");
    useEffect(() => {
        if (!enabled) return;
        for (const fen of key.split("\n")) {
            if (!fen || requested.current.has(fen)) continue;
            requested.current.add(fen);
            load(fen)
                .then((value) => setData((prev) => new Map(prev).set(fen, value)))
                .catch(() => requested.current.delete(fen));
        }
    }, [key, enabled, load]);
    return data;
}
