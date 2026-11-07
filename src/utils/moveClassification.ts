import type { Color } from "chessops";
import type { ScoreValue } from "@/bindings";
import type { Annotation } from "./annotation";
import { getWinChance, normalizeScore } from "./score";

// Chess.com-style move ratings. They sit next to the classic NAG glyphs (!!, ?, ...):
// the glyphs are what ends up in the PGN, the rating is what the report shows.
export type MoveClassification =
    | "brilliant"
    | "great"
    | "best"
    | "excellent"
    | "good"
    | "book"
    | "inaccuracy"
    | "mistake"
    | "blunder";

type ClassificationInfo = {
    translationKey: string;
    color: string;
    symbol: string;
};

export const CLASSIFICATION_INFO: Record<MoveClassification, ClassificationInfo> = {
    brilliant: { translationKey: "Brilliant", color: "#1baca6", symbol: "!!" },
    great: { translationKey: "Great", color: "#5c8bb0", symbol: "!" },
    best: { translationKey: "Best", color: "#81b64c", symbol: "★" },
    excellent: { translationKey: "Excellent", color: "#96bc4b", symbol: "✓" },
    good: { translationKey: "Good", color: "#8fa877", symbol: "✓" },
    book: { translationKey: "Book", color: "#a88865", symbol: "≡" },
    inaccuracy: { translationKey: "Inaccuracy", color: "#e6b422", symbol: "?!" },
    mistake: { translationKey: "Mistake", color: "#f08a3c", symbol: "?" },
    blunder: { translationKey: "Blunder", color: "#e5372c", symbol: "??" },
};

export const CLASSIFICATION_ORDER: MoveClassification[] = [
    "brilliant",
    "great",
    "best",
    "excellent",
    "good",
    "book",
    "inaccuracy",
    "mistake",
    "blunder",
];

// Loss in expected score (win chance in percent, 0-100) from the mover's point of view.
// Same scale as the thresholds behind the ?!, ? and ?? glyphs.
export function getWinChanceLoss(prev: ScoreValue, next: ScoreValue, color: Color): number {
    const prevCP = normalizeScore(prev, color);
    const nextCP = normalizeScore(next, color);
    return Math.max(0, getWinChance(prevCP) - getWinChance(nextCP));
}

export function classifyMove({
    winChanceLoss,
    annotation,
    isBest,
    isBook,
}: {
    winChanceLoss: number;
    annotation?: Annotation;
    isBest?: boolean;
    isBook?: boolean;
}): MoveClassification {
    if (winChanceLoss > 20) return "blunder";
    if (winChanceLoss > 10) return "mistake";
    if (isBook) return "book";
    if (winChanceLoss > 5) return "inaccuracy";
    if (annotation === "!!") return "brilliant";
    if (annotation === "!") return "great";
    if (isBest) return "best";
    if (winChanceLoss <= 2) return "excellent";
    return "good";
}

export function countClassifications(
    nodes: { halfMoves: number; classification?: MoveClassification }[],
) {
    const empty = () =>
        Object.fromEntries(CLASSIFICATION_ORDER.map((c) => [c, 0])) as Record<
            MoveClassification,
            number
        >;
    const counts = { white: empty(), black: empty() };
    for (const node of nodes) {
        if (!node.classification) continue;
        const color = node.halfMoves % 2 === 1 ? "white" : "black";
        counts[color][node.classification]++;
    }
    return counts;
}

// Badge in the top right corner of the destination square, drawn by chessground as a
// custom SVG (the square spans 0..100 in both directions).
export function classificationSvg(classification: MoveClassification): string {
    const { color, symbol } = CLASSIFICATION_INFO[classification];
    const fontSize = symbol.length > 1 ? 17 : 21;
    return `<g transform="translate(70 -2)">
<circle cx="15" cy="15" r="15" fill="${color}" stroke="#ffffff" stroke-width="2.5"/>
<text x="15" y="15" text-anchor="middle" dominant-baseline="central" font-family="Arial, sans-serif" font-weight="700" font-size="${fontSize}" fill="#ffffff">${symbol}</text>
</g>`;
}
