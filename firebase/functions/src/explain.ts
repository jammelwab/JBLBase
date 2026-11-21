// „Warum?“ beim JBL Coach (1.2.9): Claude formuliert fertige Fakten aus
// Stockfish in 2 bis 4 Sätzen im Ton des Coaches. Die KI bewertet nichts
// selbst. Hier stehen die reinen Teile (Prüfen, Schlüssel, Anleitung,
// Tageslimit), damit sie ohne Firebase testbar sind.

export const EXPLAIN_MODEL = "claude-haiku-5-5";
export const EXPLAIN_DAILY_LIMIT = 20;
export const EXPLAIN_MAX_TOKENS = 400;

export const MARKS = ["!!", "!", "!?", "?!", "?", "??"] as const;
export const STAGES = ["rules", "knows", "regular", "club"] as const;

export type ExplainRequest = {
    fen: string;
    move: string;
    best: string | null;
    line: string[];
    before: string;
    after: string;
    mark: (typeof MARKS)[number];
    motifs: string[];
    stage: (typeof STAGES)[number];
    lang: "de" | "en";
};

const FEN = /^[1-8pnbrqkPNBRQK/]{15,71} [wb] (-|[KQkq]{1,4}) (-|[a-h][36])( \d{1,3} \d{1,4})?$/;
const SAN = /^(O-O(-O)?|[NBRQK]?[a-h]?[1-8]?x?[a-h][1-8](=[NBRQ])?)[+#]?$/;
const EVAL = /^([+-]?\d{1,2}(\.\d{1,2})?|[+-]?M\d{1,2})$/;
const MOTIF = /^[\p{L}\d .,+#-]{1,40}$/u;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

// Liest die Anfrage der App streng; alles Unerwartete ergibt null.
export function parseExplainRequest(data: unknown): ExplainRequest | null {
    if (!data || typeof data !== "object") return null;
    const d = data as Record<string, unknown>;
    const fen = str(d.fen);
    const move = str(d.move);
    const best = d.best == null || d.best === "" ? null : str(d.best);
    const before = str(d.before);
    const after = str(d.after);
    if (!FEN.test(fen) || !SAN.test(move) || (best !== null && !SAN.test(best))) return null;
    if (!EVAL.test(before) || !EVAL.test(after)) return null;
    if (!Array.isArray(d.line) || d.line.length > 8) return null;
    const line = d.line.map(str);
    if (!line.every((s) => SAN.test(s))) return null;
    const motifs = Array.isArray(d.motifs) ? d.motifs.map(str).slice(0, 4) : [];
    if (!motifs.every((m) => MOTIF.test(m))) return null;
    const mark = MARKS.find((m) => m === d.mark);
    const stage = STAGES.find((s) => s === d.stage);
    const lang = d.lang === "en" ? "en" : d.lang === "de" ? "de" : null;
    if (!mark || !stage || !lang) return null;
    return { fen, move, best, line, before, after, mark, motifs, stage, lang };
}

const STAGE_TEXT: Record<ExplainRequest["stage"], string> = {
    rules: "a beginner who is still learning the rules: explain simply, name pieces and squares, no jargon",
    knows: "a player who knows the rules: explain the idea in plain words, at most one chess term",
    regular: "a regular club-level player: be concise, chess terms are fine",
    club: "a strong club player: very short, only the key point",
};

export const EXPLAIN_SYSTEM = `You are JBL, a friendly chess coach shaped like a small speaker. You see chess as music: a good move "sounds good", a blunder is a "wrong note". Use at most one music image, and always follow it with the concrete chess reason.

You explain one move of the player. You get facts from the engine Stockfish. Do not evaluate the position yourself and do not invent moves, threats or variations that are not in the facts. If the facts are thin, say less.

Write 2 to 4 short sentences, no lists, no headings, no move numbers beyond what is needed. Talk to the player directly ("you"). End with the point that matters most.`;

// Die Fakten als Nachricht an Claude
export function explainPrompt(r: ExplainRequest): string {
    const lines = [
        `Language of the answer: ${r.lang === "de" ? "German (informal du)" : "English"}.`,
        `The player is ${STAGE_TEXT[r.stage]}.`,
        `Position before the move (FEN): ${r.fen}`,
        `Player's move: ${r.move}, rated "${r.mark}".`,
        r.best && r.best !== r.move
            ? `Engine's best move: ${r.best}.`
            : "The engine also likes this move.",
        r.line.length > 0 ? `Engine line after the player's move: ${r.line.join(" ")}.` : "",
        `Evaluation from the player's side: before ${r.before}, after ${r.after} (pawns; M means mate in so many moves).`,
        r.motifs.length > 0 ? `Detected motifs: ${r.motifs.join("; ")}.` : "",
        `Explain why the move deserves "${r.mark}".`,
    ];
    return lines.filter(Boolean).join("\n");
}

// Tageslimit pro Spieler: neuer Tag fängt bei 0 an
export function nextUsage(
    prev: unknown,
    day: string,
    limit = EXPLAIN_DAILY_LIMIT,
): { allowed: boolean; usage: { day: string; count: number } } {
    const p = prev as { day?: unknown; count?: unknown } | undefined;
    const count = p && p.day === day && typeof p.count === "number" ? p.count : 0;
    if (count >= limit) return { allowed: false, usage: { day, count } };
    return { allowed: true, usage: { day, count: count + 1 } };
}

// Gleiche Regel wie member() in firestore.rules
export function isMember(
    token: { admin?: unknown; email?: unknown; email_verified?: unknown; lichess?: unknown },
    access: unknown,
): boolean {
    if (token.admin === true) return true;
    if (!access || typeof access !== "object") return false;
    const a = access as { emails?: unknown; lichess?: unknown };
    const has = (list: unknown, v: string) =>
        Array.isArray(list) && list.some((x) => typeof x === "string" && x.toLowerCase() === v);
    if (token.email_verified === true && typeof token.email === "string")
        if (has(a.emails, token.email.toLowerCase())) return true;
    return typeof token.lichess === "string" && has(a.lichess, token.lichess.toLowerCase());
}

// Die Antwort kurz halten: höchstens 600 Zeichen
export function trimAnswer(text: string): string {
    const clean = text.replace(/\s+/g, " ").trim();
    return clean.length > 600 ? `${clean.slice(0, 597).trimEnd()}…` : clean;
}
