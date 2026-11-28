// Motiv-Trainer (Reversing Mate), 1.2.32: liest Mattbilder aus PGN.
//
// Erwartetes Format (wie ein Kurs-Export, eine Datei je Kapitel):
//   [Event "1. Introduction"]                 Partie ohne FEN: Kapiteltext
//   [Event "4. Example 1 - Variation A"]      Matt in 1 (die Vorlage)
//   [FEN "..."]  { Text } 1.Nxe7# { Text }
//   [Event "5. Example 1 - Variation B"]      gleiches Mattbild, Züge davor
//   [FEN "..."]  1.Qxh7+ Kxh7 2.Rh3+ (2...Kg8 3.Nxe7#) 2...Kg6 3.Nxe7#
// "Example/Ejemplo/Beispiel" und "Variation/Variante" in jeder Sprache;
// die Buchstaben A, B, C … sind die Schritte zurück. Nebenvarianten an einem
// Zug des Gegners werden zu Weiterführungen ("Forwarding"): dieselbe Stellung,
// aber der Gegner wehrt sich anders. Kommentare bleiben erhalten.
// Partien ohne dieses Schema werden je eine eigene Aufgabe.

import { makeFen } from "chessops/fen";
import {
    type ChildNode,
    type Node,
    type PgnNodeData,
    parsePgn,
    startingPosition,
} from "chessops/pgn";
import { parseSan } from "chessops/san";
import { makeSan } from "chessops/san";

export type MotifLevel = "elementary" | "easy" | "intermediate" | "challenging";
export const MOTIF_LEVELS: MotifLevel[] = ["elementary", "easy", "intermediate", "challenging"];

export type MotifMove = {
    san: string;
    /** Kommentar nach dem Zug */
    comment?: string;
};

/** Eine lösbare Zugfolge ab einer Stellung. */
export type MotifLine = {
    id: string;
    /** "A", "B", … oder "F1", "F2" für Weiterführungen */
    step: string;
    fen: string;
    /** Text vor dem ersten Zug */
    intro?: string;
    moves: MotifMove[];
    /** Züge der Seite am Zug, bis zum Matt */
    mateIn: number;
    /** Weiterführung: ab welchem Halbzug der Gegner abweicht */
    forwardFrom?: number;
};

/** Ein Mattbild: Matt in 1 und dieselbe Stellung von weiter vorn. */
export type MotifPattern = {
    id: string;
    title: string;
    /** A, B, … in dieser Reihenfolge */
    steps: MotifLine[];
    forwarding: MotifLine[];
};

export type MotifChapter = {
    id: string;
    title: string;
    level: MotifLevel;
    intro?: string;
    patterns: MotifPattern[];
};

export type MotifCollection = {
    id: string;
    name: string;
    importedAt: string;
    chapters: MotifChapter[];
};

const EXAMPLE_RE =
    /^(?:\d+\.\s*)?(.*?)\b(?:example|ejemplo|beispiel|exemple|esempio|exemplo|pattern|muster)\s*(\d+)\s*[-–:]\s*(?:variation|variante|variación|variacion|variazione|var\.?)\s*([a-z])\b/i;

/** "4. Example 1 - Variation A" → { key: "1", step: "A" } */
export function parseExampleTitle(event: string): { key: string; step: string } | null {
    const m = EXAMPLE_RE.exec(event.trim());
    if (!m) return null;
    return { key: m[2], step: m[3].toUpperCase() };
}

const LEVEL_WORDS: [MotifLevel, RegExp][] = [
    ["elementary", /element|elemental|grundl|basic|einfach(st)?e?\b|mate[- ]in[- ][12]\b/i],
    ["challenging", /challeng|desaf|schwer|difficult|hard|anspruch|exigente|dif[ií]cil/i],
    ["intermediate", /intermed|mittel|medium|medio/i],
    ["easy", /easy|f[aá]cil|leicht/i],
];

export function levelFromTitle(title: string): MotifLevel | null {
    for (const [level, re] of LEVEL_WORDS) if (re.test(title)) return level;
    return null;
}

export function levelFromMateLength(mateIn: number): MotifLevel {
    if (mateIn <= 2) return "elementary";
    if (mateIn === 3) return "easy";
    if (mateIn <= 5) return "intermediate";
    return "challenging";
}

/** Zeichenbefehle wie [%cal Ge2e4] und überflüssige Leerzeichen raus */
export function cleanComment(parts: string[] | undefined): string | undefined {
    if (!parts?.length) return undefined;
    const text = parts
        .join("\n\n")
        .replace(/\[%[^\]]*\]/g, "")
        .replace(/[ \t]+/g, " ")
        .replace(/ *\n */g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    return text || undefined;
}

/** Kapitelname aus dem Dateinamen: "01_1._Introduction.pgn" → "Introduction" */
export function chapterNameFromFile(file: string): string {
    const base = file.split(/[\\/]/).pop() ?? file;
    return (
        base
            .replace(/\.pgn$/i, "")
            .replace(/^\d+[_\s-]+/, "")
            .replace(/^\d+\.\s*/, "")
            .replace(/_/g, " ")
            .trim() || base
    );
}

function slug(text: string): string {
    return (
        text
            .toLowerCase()
            .normalize("NFKD")
            .replace(/[^\w]+/g, "-")
            .replace(/^-|-$/g, "")
            .slice(0, 40) || "x"
    );
}

type Raw = { moves: MotifMove[]; forks: { ply: number; node: ChildNode<PgnNodeData> }[] };

// Hauptlinie lesen; Abzweigungen merken, um daraus Weiterführungen zu bauen
function readLine(start: Node<PgnNodeData>): Raw {
    const moves: MotifMove[] = [];
    const forks: Raw["forks"] = [];
    let node: Node<PgnNodeData> = start;
    let ply = 0;
    while (node.children.length > 0) {
        const [main, ...alts] = node.children;
        for (const alt of alts) forks.push({ ply, node: alt });
        moves.push({ san: main.data.san, comment: cleanComment(main.data.comments) });
        node = main;
        ply++;
    }
    return { moves, forks };
}

function mainlineFrom(node: ChildNode<PgnNodeData>): MotifMove[] {
    const out: MotifMove[] = [{ san: node.data.san, comment: cleanComment(node.data.comments) }];
    let cur: Node<PgnNodeData> = node;
    while (cur.children.length > 0) {
        cur = cur.children[0];
        const c = cur as ChildNode<PgnNodeData>;
        out.push({ san: c.data.san, comment: cleanComment(c.data.comments) });
    }
    return out;
}

/** Spielt die Züge durch; gibt die SAN in sauberer Form zurück oder null, wenn ein Zug nicht geht. */
function checkLine(fen: string, moves: MotifMove[]): { moves: MotifMove[]; mate: boolean } | null {
    const headers = new Map([["FEN", fen]]);
    const start = startingPosition(headers);
    if (start.isErr) return null;
    const pos = start.value;
    const out: MotifMove[] = [];
    for (const m of moves) {
        const move = parseSan(pos, m.san);
        if (!move) return null;
        out.push({ ...m, san: makeSan(pos, move) });
        pos.play(move);
    }
    return { moves: out, mate: pos.isCheckmate() };
}

const mateCount = (moves: MotifMove[]) => Math.ceil(moves.length / 2);

type Entry = {
    title: string;
    key: string | null;
    step: string;
    fen: string;
    intro?: string;
    raw: Raw;
};

export type ParseReport = {
    collection: MotifCollection;
    /** Partien, die nicht ins Schema passten (z. B. Zug unmöglich) */
    skipped: string[];
};

/**
 * Liest einen oder mehrere PGN-Texte (je Datei ein Kapitel) zu einer Sammlung.
 * `files`: Dateiname (für den Kapitelnamen) und Inhalt.
 */
export function parseMotifCollection(
    name: string,
    files: { name: string; text: string }[],
): ParseReport {
    const skipped: string[] = [];
    const chapters: MotifChapter[] = [];
    const collectionId = `${slug(name)}-${Date.now().toString(36)}`;

    files.forEach((file, fileIndex) => {
        const games = parsePgn(file.text.replace(/^﻿/, ""));
        let title = chapterNameFromFile(file.name);
        let intro: string | undefined;
        const entries: Entry[] = [];

        for (const game of games) {
            const event = game.headers.get("Event") ?? "";
            const fen = game.headers.get("FEN");
            const gameIntro = cleanComment([
                ...(game.comments ?? []),
                ...(game.moves.children[0]?.data.startingComments ?? []),
            ]);
            if (!fen) {
                // Ohne FEN: Kapiteltext (eine mitgelieferte ganze Partie wird nicht trainiert)
                if (event) title = event.replace(/^\d+\.\s*/, "").trim() || title;
                intro = [intro, gameIntro].filter(Boolean).join("\n\n") || undefined;
                continue;
            }
            const start = startingPosition(game.headers);
            if (start.isErr) {
                skipped.push(event || `#${entries.length + 1}`);
                continue;
            }
            const parsed = parseExampleTitle(event);
            entries.push({
                title: event.replace(/^\d+\.\s*/, "").trim(),
                key: parsed?.key ?? null,
                step: parsed?.step ?? "A",
                fen: makeFen(start.value.toSetup()),
                intro: gameIntro,
                raw: readLine(game.moves),
            });
        }

        // Nach Beispielnummer zusammenfassen, Reihenfolge der Datei behalten
        const groups = new Map<string, Entry[]>();
        entries.forEach((e, i) => {
            const k = e.key ?? `solo-${i}`;
            if (!groups.has(k)) groups.set(k, []);
            groups.get(k)!.push(e);
        });

        const chapterId = `${collectionId}-c${fileIndex}`;
        const patterns: MotifPattern[] = [];
        for (const [key, group] of groups) {
            group.sort((a, b) => a.step.localeCompare(b.step));
            const patternId = `${chapterId}-${slug(key)}`;
            const steps: MotifLine[] = [];
            const forwarding: MotifLine[] = [];
            for (const e of group) {
                const checked = checkLine(e.fen, e.raw.moves);
                if (!checked || checked.moves.length === 0) {
                    skipped.push(e.title);
                    continue;
                }
                const lineId = `${patternId}-${e.step}`;
                steps.push({
                    id: lineId,
                    step: e.step,
                    fen: e.fen,
                    intro: e.intro,
                    moves: checked.moves,
                    mateIn: mateCount(checked.moves),
                });
                // Weiterführungen: nur Abweichungen des Gegners, die wieder in ein Matt laufen
                for (const fork of e.raw.forks) {
                    if (fork.ply % 2 === 0) continue;
                    const moves = [...e.raw.moves.slice(0, fork.ply), ...mainlineFrom(fork.node)];
                    const line = checkLine(e.fen, moves);
                    if (!line?.mate) continue;
                    forwarding.push({
                        id: `${lineId}-f${forwarding.length + 1}`,
                        step: `${e.step}${forwarding.length + 1}`,
                        fen: e.fen,
                        intro: e.intro,
                        moves: line.moves,
                        mateIn: mateCount(line.moves),
                        forwardFrom: fork.ply,
                    });
                }
            }
            if (steps.length === 0) continue;
            const first = group[0];
            patterns.push({
                id: patternId,
                title: first.key
                    ? first.title.replace(
                          /\s*[-–:]\s*(?:variation|variante|variación|variacion|variazione|var\.?)\s*[a-z]\b.*$/i,
                          "",
                      )
                    : first.title,
                steps,
                forwarding,
            });
        }
        if (patterns.length === 0 && !intro) return;

        const longest = Math.max(0, ...patterns.flatMap((p) => p.steps.map((s) => s.mateIn)));
        chapters.push({
            id: chapterId,
            title,
            level:
                levelFromTitle(title) ?? levelFromTitle(file.name) ?? levelFromMateLength(longest),
            intro,
            patterns,
        });
    });

    return {
        collection: { id: collectionId, name, importedAt: new Date().toISOString(), chapters },
        skipped,
    };
}

// ---------- Aufgaben ----------

/** Seite am Zug in der Stellung */
export function sideToMove(fen: string): "white" | "black" {
    return fen.split(" ")[1] === "b" ? "black" : "white";
}

const bare = (san: string) => san.replace(/[+#!?]/g, "");

/**
 * Prüft einen Zug des Lösers. Richtig ist der Zug der Hauptlinie; beim letzten
 * Zug zählt auch jedes andere Matt.
 */
export function judgeMotifMove(
    line: MotifLine,
    ply: number,
    fenBefore: string,
    san: string,
): "right" | "wrong" {
    const expected = line.moves[ply];
    if (!expected) return "wrong";
    if (bare(expected.san) === bare(san)) return "right";
    if (ply === line.moves.length - 1) {
        const start = startingPosition(new Map([["FEN", fenBefore]]));
        if (start.isErr) return "wrong";
        const pos = start.value;
        const move = parseSan(pos, san);
        if (!move) return "wrong";
        pos.play(move);
        if (pos.isCheckmate()) return "right";
    }
    return "wrong";
}

/** Stellung nach den ersten `ply` Zügen der Linie */
export function fenAfter(line: MotifLine, ply: number): string {
    const start = startingPosition(new Map([["FEN", line.fen]]));
    if (start.isErr) return line.fen;
    const pos = start.value;
    for (const m of line.moves.slice(0, ply)) {
        const move = parseSan(pos, m.san);
        if (!move) break;
        pos.play(move);
    }
    return makeFen(pos.toSetup());
}

/** Alle Linien einer Sammlung, z. B. für die Testmodi */
export function allLines(collection: MotifCollection) {
    return collection.chapters.flatMap((chapter) =>
        chapter.patterns.flatMap((pattern) =>
            [...pattern.steps, ...pattern.forwarding].map((line) => ({ chapter, pattern, line })),
        ),
    );
}
