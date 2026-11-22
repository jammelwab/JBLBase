import { describe, expect, it } from "vitest";
import type { DiaryGame } from "./coachDiary";
import {
    COMMON_MOVES,
    knownPrefix,
    lineSuggestions,
    lineText,
    lineTree,
    playLine,
    suggestionStart,
} from "./coachLines";

function rep(lines: string[][]) {
    const root = lineTree([])!.root;
    for (const line of lines) {
        const tree = lineTree(line)!;
        let node = root;
        let src = tree.root;
        for (const san of line) {
            src = src.children[0];
            let next = node.children.find((c) => c.san === san);
            if (!next) {
                next = { ...src, children: [] };
                node.children.push(next);
            }
            node = next;
        }
    }
    return root;
}

const game = (color: "white" | "black", moves: string[]): DiaryGame => ({
    day: "2026-11-22",
    color,
    result: "loss",
    moves: moves.map((s) => ({ e: "", u: "", s })),
});

describe("Neue Linie mit JBL", () => {
    it("die festen Züge sind alle legal", () => {
        for (const [key, replies] of Object.entries(COMMON_MOVES)) {
            const moves = key === "" ? [] : key.split(" ");
            for (const r of replies) expect(playLine([...moves, r]), `${key} ${r}`).not.toBeNull();
        }
    });

    it("baut die Linie als Baum und zählt bekannte Züge", () => {
        const tree = lineTree(["e4", "c5", "Nf3"])!;
        expect(tree.path).toEqual([0, 0, 0]);
        expect(tree.root.children[0].children[0].children[0].san).toBe("Nf3");
        expect(tree.root.children[0].children[0].children[0].halfMoves).toBe(3);
        expect(lineTree(["e4", "e4"])).toBeNull();
        const root = rep([["e4", "c5", "Nf3"]]);
        expect(knownPrefix(root, ["e4", "c5", "Nc3"])).toBe(2);
    });

    it("leeres Repertoire: erster Zug bzw. Antwort auf e4 und d4", () => {
        const empty = lineTree([])!.root;
        expect(lineSuggestions(empty, "white", [])).toEqual([{ kind: "start", moves: [] }]);
        expect(lineSuggestions(empty, "black", []).map(suggestionStart)).toEqual([["e4"], ["d4"]]);
    });

    it("Lücken aus den eigenen Partien kommen zuerst", () => {
        const root = rep([["e4", "c5", "Nf3", "d6", "d4"]]);
        const diary = [
            game("white", ["e4", "e5", "Nf3"]),
            game("white", ["e4", "e5", "Nf3"]),
            game("white", ["e4", "e6"]),
            game("black", ["e4", "e5"]),
        ];
        const list = lineSuggestions(root, "white", diary);
        expect(list[0]).toEqual({ kind: "gap", moves: ["e4"], move: "e5", count: 2 });
        expect(list[1]).toEqual({ kind: "gap", moves: ["e4"], move: "e6", count: 1 });
        // Danach ein häufiger Zug ohne Antwort an einer späteren Stelle
        expect(list.some((s) => s.kind === "common" && s.moves.join(" ") === "e4 c5 Nf3")).toBe(
            true,
        );
    });

    it("eigene Abweichungen sind keine Lücke", () => {
        const root = rep([["e4", "c5", "Nf3"]]);
        const list = lineSuggestions(root, "white", [game("white", ["d4", "d5"])]);
        expect(list.some((s) => s.kind === "gap")).toBe(false);
    });

    it("kurze Linien werden vorgeschlagen", () => {
        const root = rep([["d4", "Nf6", "c4", "e6", "Nc3", "Bb4", "Qc2", "O-O", "a3"]]);
        const black = lineSuggestions(rep([["e4", "c5"]]), "black", []);
        expect(black[0]).toEqual({ kind: "common", moves: [], move: "d4" });
        expect(lineSuggestions(root, "white", []).length).toBeGreaterThan(0);
    });

    it("schreibt Zugnummern", () => {
        expect(lineText(["e4", "c5", "Nf3"])).toBe("1. e4 c5 2. Nf3");
        expect(lineText(["c5", "Nf3"], 1)).toBe("1... c5 2. Nf3");
    });
});
