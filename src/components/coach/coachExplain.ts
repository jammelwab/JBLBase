import type { ScoreValue } from "@/bindings";
import type { CoachEntry } from "./coachLessons";

// „Warum?“ (1.2.9): die Fakten zu einem bewerteten Zug, wie sie an die
// Cloud-Funktion gehen. Die KI bewertet nichts selbst, sie formuliert nur.

export type ExplainFacts = {
    fen: string;
    move: string;
    best: string | null;
    line: string[];
    before: string;
    after: string;
    mark: string;
    motifs: string[];
    stage: CoachEntry;
    lang: "de" | "en";
};

// Bewertung aus Sicht des Spielers: "+1.3", "-0.4", "+M3", "-M2"
export function evalText(score: ScoreValue, color: "white" | "black"): string {
    const v = color === "black" ? -score.value : score.value;
    if (score.type === "mate") return `${v < 0 ? "-" : "+"}M${Math.min(99, Math.abs(v))}`;
    const pawns = Math.max(-99, Math.min(99, v / 100));
    return `${pawns >= 0 ? "+" : ""}${pawns.toFixed(1)}`;
}

// Was die App schon erkannt hat, als kurze Stichworte
export function explainMotifs(o: { allowsMateInOne: boolean; sacrifice: boolean }): string[] {
    const out: string[] = [];
    if (o.allowsMateInOne) out.push("allows mate in 1");
    if (o.sacrifice) out.push("sacrifice");
    return out;
}

export type ExplainError = "limit" | "offline" | "failed";

export function explainError(e: unknown): ExplainError {
    const code = e && typeof e === "object" && "code" in e ? String(e.code) : "";
    if (code === "functions/resource-exhausted") return "limit";
    if (code === "functions/unavailable" || code === "functions/deadline-exceeded")
        return "offline";
    return "failed";
}
