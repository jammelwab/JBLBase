import { useEffect, useRef, useState } from "react";

// Loads data for many positions at once (one request per position, each only once) and
// collects the results, so a whole tree can be laid out from them. A new `load` (e.g. another
// player's games) starts over; answers of the old one are dropped.
export function usePositionData<T>(
    fens: string[],
    load: (fen: string) => Promise<T>,
    enabled: boolean,
): Map<string, T> {
    const [state, setState] = useState(() => ({ load, data: new Map<string, T>() }));
    const requested = useRef({ load, fens: new Set<string>() });
    const key = fens.join("\n");
    useEffect(() => {
        if (!enabled) return;
        if (requested.current.load !== load) requested.current = { load, fens: new Set() };
        const current = requested.current;
        for (const fen of key.split("\n")) {
            if (!fen || current.fens.has(fen)) continue;
            current.fens.add(fen);
            load(fen)
                .then((value) =>
                    setState((prev) => {
                        if (requested.current !== current) return prev;
                        const data = prev.load === load ? new Map(prev.data) : new Map<string, T>();
                        return { load, data: data.set(fen, value) };
                    }),
                )
                .catch(() => current.fens.delete(fen));
        }
    }, [key, enabled, load]);
    return state.load === load ? state.data : EMPTY;
}

const EMPTY = new Map<never, never>();
