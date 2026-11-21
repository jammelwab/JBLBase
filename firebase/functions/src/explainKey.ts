import { createHash } from "node:crypto";
import type { ExplainRequest } from "./explain.js";

// Gespeicherte Antworten: Stellung (ohne Zugzähler) plus Zug plus Lernstufe
export function cacheKey(r: ExplainRequest): string {
    const position = r.fen.split(" ").slice(0, 4).join(" ");
    return createHash("sha256")
        .update(`${position}|${r.move}|${r.stage}|${r.lang}`)
        .digest("hex")
        .slice(0, 40);
}
