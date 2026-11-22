// „Warum?“ beim JBL Coach (1.2.9): Claude formuliert fertige Fakten aus
// Stockfish in 2 bis 4 Sätzen im Ton des Coaches. Die KI bewertet nichts
// selbst. Hier stehen die reinen Teile (Prüfen, Schlüssel, Anleitung,
// Tageslimit), damit sie ohne Firebase testbar sind.

export const EXPLAIN_MODEL = "claude-haiku-5-5";
export const EXPLAIN_DAILY_LIMIT = 20;
export const EXPLAIN_MAX_TOKENS = 400;
// Ausführliche Erklärung nach einem Fehler (1.2.12): mehr Platz
export const EXPLAIN_DEEP_MAX_TOKENS = 900;

export const MARKS = ["!!", "!", "!?", "?!", "?", "??"] as const;
// Kommentar zu jedem Zug (1.2.12): dazu Theorie und solide Züge
export const SAY_MARKS = [...MARKS, "book", "solid"] as const;
export const SAY_MAX_TOKENS = 120;
// Kurze Sprüche sind billig: eigenes, höheres Tageslimit
export const SAY_DAILY_LIMIT = 400;
export const EVENTS = ["start", "win", "loss", "draw"] as const;
export const REPORT_MAX_TOKENS = 500;
export const STAGES = ["rules", "knows", "regular", "club"] as const;

export type ExplainRequest = {
    fen: string;
    move: string;
    best: string | null;
    line: string[];
    before: string;
    after: string;
    mark: (typeof SAY_MARKS)[number];
    motifs: string[];
    stage: (typeof STAGES)[number];
    lang: "de" | "en";
    // why: 2 bis 4 Sätze; deep: ausführlich nach einem Fehler;
    // say: ein Satz zu jedem Zug, direkt in der Partie
    mode: "why" | "deep" | "say";
    // Name der Eröffnung, wenn der Zug Theorie ist (nur say)
    opening: string | null;
};

// Ein Satz zu einem Moment der Partie (Start, Sieg, Niederlage, Remis).
// variant (1 bis 5) sorgt für Abwechslung und hält den Speicher klein.
export type EventRequest = {
    event: (typeof EVENTS)[number];
    stage: (typeof STAGES)[number];
    lang: "de" | "en";
    variant: number;
};

const FEN = /^[1-8pnbrqkPNBRQK/]{15,71} [wb] (-|[KQkq]{1,4}) (-|[a-h][36])( \d{1,3} \d{1,4})?$/;
const SAN = /^(O-O(-O)?|[NBRQK]?[a-h]?[1-8]?x?[a-h][1-8](=[NBRQ])?)[+#]?$/;
const EVAL = /^([+-]?\d{1,2}(\.\d{1,2})?|[+-]?M\d{1,2})$/;
const MOTIF = /^[\p{L}\d .,+#-]{1,40}$/u;
const OPENING = /^[\p{L}\d .,:'()/-]{1,80}$/u;

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
    const mode = d.mode === "say" ? "say" : d.mode === "deep" || d.deep === true ? "deep" : "why";
    const marks: readonly string[] = mode === "say" ? SAY_MARKS : MARKS;
    const mark = SAY_MARKS.find((m) => m === d.mark && marks.includes(m));
    const stage = STAGES.find((s) => s === d.stage);
    const lang = d.lang === "en" ? "en" : d.lang === "de" ? "de" : null;
    if (!mark || !stage || !lang) return null;
    const rawOpening = mode === "say" ? str(d.opening) : "";
    if (rawOpening && !OPENING.test(rawOpening)) return null;
    const opening = rawOpening || null;
    return { fen, move, best, line, before, after, mark, motifs, stage, lang, mode, opening };
}

// Partiebericht (1.2.12): Zahlen und Schlüsselmomente der Partie, Claude
// schreibt daraus eine kurze Zusammenfassung mit einem Tipp.
export type ReportRequest = {
    result: "win" | "loss" | "draw";
    opening: string | null;
    counts: Record<"book" | "solid" | "good" | "dubious" | "mistake" | "blunder", number>;
    moments: {
        move: string;
        mark: (typeof MARKS)[number];
        best: string | null;
        motif: string | null;
    }[];
    stage: (typeof STAGES)[number];
    lang: "de" | "en";
};

const COUNT_KEYS = ["book", "solid", "good", "dubious", "mistake", "blunder"] as const;

export function parseReportRequest(data: unknown): ReportRequest | null {
    if (!data || typeof data !== "object") return null;
    const d = data as Record<string, unknown>;
    if (d.mode !== "report") return null;
    const result =
        d.result === "win" || d.result === "loss" || d.result === "draw" ? d.result : null;
    const stage = STAGES.find((s) => s === d.stage);
    const lang = d.lang === "en" ? "en" : d.lang === "de" ? "de" : null;
    if (!result || !stage || !lang) return null;
    const rawOpening = str(d.opening);
    if (rawOpening && !OPENING.test(rawOpening)) return null;
    const c = (d.counts ?? {}) as Record<string, unknown>;
    const counts = {} as ReportRequest["counts"];
    for (const k of COUNT_KEYS) {
        const v = c[k];
        if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 300) return null;
        counts[k] = v;
    }
    if (!Array.isArray(d.moments) || d.moments.length > 3) return null;
    const moments: ReportRequest["moments"] = [];
    for (const m of d.moments) {
        if (!m || typeof m !== "object") return null;
        const o = m as Record<string, unknown>;
        const move = str(o.move);
        const mark = MARKS.find((x) => x === o.mark);
        const best = o.best == null || o.best === "" ? null : str(o.best);
        const motif = o.motif == null || o.motif === "" ? null : str(o.motif);
        if (!SAN.test(move) || !mark || (best !== null && !SAN.test(best))) return null;
        if (motif !== null && !MOTIF.test(motif)) return null;
        moments.push({ move, mark, best, motif });
    }
    return { result, opening: rawOpening || null, counts, moments, stage, lang };
}

export function reportPrompt(r: ReportRequest): string {
    const c = r.counts;
    return [
        `Language of the answer: ${r.lang === "de" ? "German (informal du)" : "English"}.`,
        `The player is ${STAGE_TEXT[r.stage]}.`,
        `Result for the player: ${r.result}.`,
        r.opening ? `Opening: ${r.opening}.` : "",
        `The player's moves: ${c.book} theory, ${c.solid} solid, ${c.good} good (! or !!), ${c.dubious} inaccuracies (?!), ${c.mistake} mistakes (?), ${c.blunder} blunders (??).`,
        ...r.moments.map(
            (m) =>
                `Key moment: ${m.move} rated ${m.mark}${m.best ? `, better was ${m.best}` : ""}${m.motif ? `, motif ${m.motif}` : ""}.`,
        ),
        "Write a short game report in 3 to 5 sentences: how the game went, the best moment, the most important mistake and what to learn from it, and one concrete tip for the next game. No lists, no headings.",
    ]
        .filter(Boolean)
        .join("\n");
}

export function parseEventRequest(data: unknown): EventRequest | null {
    if (!data || typeof data !== "object") return null;
    const d = data as Record<string, unknown>;
    const event = EVENTS.find((e) => e === d.event);
    const stage = STAGES.find((s) => s === d.stage);
    const lang = d.lang === "en" ? "en" : d.lang === "de" ? "de" : null;
    const variant = typeof d.variant === "number" ? Math.trunc(d.variant) : 0;
    if (!event || !stage || !lang || variant < 1 || variant > 5) return null;
    return { event, stage, lang, variant };
}

const EVENT_TEXT: Record<EventRequest["event"], string> = {
    start: "the game against the player is about to start; greet them and wish a good game",
    win: "the player just beat you; congratulate them honestly",
    loss: "you just beat the player; be kind and encouraging, no gloating",
    draw: "the game just ended in a draw",
};

export function eventPrompt(r: EventRequest): string {
    return [
        `Language of the answer: ${r.lang === "de" ? "German (informal du)" : "English"}.`,
        `The player is ${STAGE_TEXT[r.stage]}.`,
        `Moment: ${EVENT_TEXT[r.event]}.`,
        `This is variant ${r.variant} of 5, so phrase it differently from the obvious first idea.`,
        "Write exactly one short sentence, at most 15 words. No chess analysis.",
    ].join("\n");
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

// Für den Partiebericht nach dem Spiel
export const REPORT_SYSTEM = `You are JBL, a friendly chess coach shaped like a small speaker. After a game you write the player a short, honest, encouraging report. You get counts and key moments from the engine Stockfish; never invent moves, threats or evaluations beyond them. Use at most one music image. Talk to the player directly.`;

// Für die kurzen Sprüche während der Partie (say, event)
export const SAY_SYSTEM = `You are JBL, a friendly chess coach shaped like a small speaker, talking to the player during a game. You see chess as music, but use a music image only now and then. You get facts from the engine Stockfish; never invent moves or evaluations beyond them.

Answer with exactly one short sentence in the requested language, talking to the player directly. No lists, no quotes, no emojis.`;

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
        r.opening ? `The move is known opening theory: ${r.opening}.` : "",
        r.mode === "say"
            ? `Write exactly one short sentence (at most 18 words) reacting to this move right after it was played. ${r.mark === "book" ? "Say it is theory and name the opening if given." : r.mark === "solid" ? "It is a sound, ordinary move; keep it light." : `Match the rating "${r.mark}"; if a better move is given and the rating is ?!, ? or ??, name it.`}`
            : r.mode === "deep"
              ? `Explain this mistake in depth, in 5 to 8 short sentences: first what the opponent can do now, walking through the engine line move by move up to its first 4 half-moves (2 full moves) when the point only shows after a few moves, then, if a motif was detected, what that tactical motif is in general and how it works here, and finally what the better move does differently. You may use one short paragraph break.`
              : `Explain why the move deserves "${r.mark}". If the problem only shows after a few moves, follow the engine line for up to its first 4 half-moves (2 full moves) and name those moves.`,
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

// Die Antwort kurz halten: höchstens 600 Zeichen, ausführlich 1400.
// Absätze bleiben erhalten, sonstige Leerzeichen werden zusammengefasst.
export function trimAnswer(text: string, max = 600): string {
    const clean = text
        .split(/\n\s*\n/)
        .map((p) => p.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .join("\n\n");
    return clean.length > max ? `${clean.slice(0, max - 3).trimEnd()}…` : clean;
}
