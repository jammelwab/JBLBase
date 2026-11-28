import { createHash } from "node:crypto";
import type { EventRequest, ExplainRequest, ReportRequest } from "./explain.js";

// Gespeicherte Antworten: Stellung (ohne Zugzähler) plus Zug plus Lernstufe.
// deep ab 1.2.34 mit „v2“: die Antwort kennt jetzt die bessere Folge, alte
// gespeicherte Antworten passen nicht mehr dazu.
export function cacheKey(r: ExplainRequest): string {
    const position = r.fen.split(" ").slice(0, 4).join(" ");
    return createHash("sha256")
        .update(
            `${position}|${r.move}|${r.stage}|${r.lang}${r.mode === "why" ? "|short" : `|${r.mode}|${r.mark}`}${r.mode === "deep" ? "|short|v2" : ""}${r.mode === "say" && r.variant > 1 ? `|v${r.variant}` : ""}`,
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
        .update(`report|short|${JSON.stringify(r)}`)
        .digest("hex")
        .slice(0, 40);
}
