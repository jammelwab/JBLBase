import type { DrawShape } from "@lichess-org/chessground/draw";
import { makeSquare } from "chessops";
import { parseSan } from "chessops/san";
import { useAtomValue } from "jotai";
import { useMemo } from "react";
import {
    useExplorerTops,
    useRepertoireMoves,
} from "@/components/panels/database/RepertoireMovesTable";
import { explorerArrowsAtom } from "@/state/atoms";
import { positionFromFen } from "@/utils/chessops";

// Wider for the first move, thinner for the second and third. Green is wider than blue, so a
// move with both shows the blue arrow inside the green one.
const WIDTHS = { green: [15, 11, 8], blue: [8, 5.5, 4] };

function arrows(fen: string, moves: string[], brush: "green" | "blue"): DrawShape[] {
    const [pos] = positionFromFen(fen);
    if (!pos) return [];
    const shapes: DrawShape[] = [];
    for (const [i, san] of moves.slice(0, 3).entries()) {
        const move = parseSan(pos, san);
        if (!move || !("from" in move)) continue;
        shapes.push({
            orig: makeSquare(move.from),
            dest: makeSquare(move.to),
            brush,
            modifiers: { lineWidth: WIDTHS[brush][i] },
        });
    }
    return shapes;
}

// Arrows for the top 3 Lichess moves (blue) and the top 3 repertoire moves by lines (green),
// each switched on and off with the buttons next to the board
export function useExplorerArrows(fen: string): DrawShape[] {
    const show = useAtomValue(explorerArrowsAtom);
    const { lichess } = useExplorerTops(fen, show.lichess);
    const { rows } = useRepertoireMoves(fen, show.repertoire);
    return useMemo(() => {
        const shapes: DrawShape[] = [];
        // Green first and wider, so a move in both shows the blue arrow inside the green one
        if (show.repertoire) {
            shapes.push(
                ...arrows(
                    fen,
                    rows.map((r) => r.move),
                    "green",
                ).map((s) => ({
                    ...s,
                    modifiers: { lineWidth: (s.modifiers?.lineWidth ?? 7) + 4 },
                })),
            );
        }
        if (show.lichess && lichess) {
            const sorted = [...lichess]
                .sort((a, b) => b.games - a.games)
                .filter((m) => m.games > 0);
            shapes.push(
                ...arrows(
                    fen,
                    sorted.map((m) => m.san),
                    "blue",
                ),
            );
        }
        return shapes;
    }, [show, rows, lichess, fen]);
}
