import { createHash } from "node:crypto";
import type { EventRequest, ExplainRequest, ReportRequest } from "./explain.js";

// Gespeicherte Antworten: Stellung (ohne Zugzähler) plus Zug plus Lernstufe
export function cacheKey(r: ExplainRequest): string {
    const position = r.fen.split(" ").slice(0, 4).join(" ");
    return createHash("sha256")
        .update(
            `${position}|${r.move}|${r.stage}|${r.lang}${r.mode === "why" ? "" : `|${r.mode}|${r.mark}`}`,
        )
        .digest("hex")
        .slice(0, 40);
}

export function eventKey(r: EventRequest): string {
    return createHash("sha256")
        .update(`event|${r.event}|${r.stage}|${r.lang}|${r.variant}`)
        .digest("hex")
        .slice(0, 40);
}

export function reportKey(r: ReportRequest): string {
    return createHash("sha256")
        .update(`report|${JSON.stringify(r)}`)
        .digest("hex")
        .slice(0, 40);
}
