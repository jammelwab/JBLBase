import { INITIAL_FEN, makeFen } from "chessops/fen";
import { parseSan } from "chessops/san";
import { expect, test } from "vitest";
import { positionFromFen } from "../chessops";
import { collectIssues, lineText, type MoveStat } from "../gamesTree";
import { indexRepertoire, positionKey } from "../repertoireTree";
import { createNode, defaultTree, type TreeNode } from "../treeReducer";

function tree(...lines: string[][]): TreeNode {
    const root = defaultTree().root;
    for (const line of lines) {
        let cur = root;
        const [pos] = positionFromFen(INITIAL_FEN);
        for (const san of line) {
            const move = parseSan(pos!, san)!;
            pos!.play(move);
            let child = cur.children.find((c) => c.san === san);
            if (!child) {
                child = createNode({
                    fen: makeFen(pos!.toSetup()),
                    move,
                    san,
                    halfMoves: cur.halfMoves + 1,
                });
                cur.children.push(child);
            }
            cur = child;
        }
    }
    return root;
}

function fenAfter(moves: string[]) {
    const [pos] = positionFromFen(INITIAL_FEN);
    for (const san of moves) pos!.play(parseSan(pos!, san)!);
    return makeFen(pos!.toSetup());
}

const stat = (san: string, games: number): MoveStat => ({
    san,
    games,
    white: games,
    draw: 0,
    black: 0,
});

test("a transposition in your games is reported once, not once per move order", async () => {
    // 1. d4 Nf6 2. c4 e6 and 1. c4 e6 2. d4 Nf6 reach the same position
    const rep = tree(["d4", "Nf6", "c4", "e6", "Nc3"], ["c4", "e6", "d4", "Nf6", "Nc3"]);
    const index = indexRepertoire(rep);
    // The database answers by position, so both move orders see the same games
    const byPosition: Record<string, MoveStat[]> = {
        [positionKey(rep.fen)]: [stat("d4", 4), stat("c4", 3)],
        [positionKey(fenAfter(["d4"]))]: [stat("Nf6", 4)],
        [positionKey(fenAfter(["c4"]))]: [stat("e6", 3)],
        [positionKey(fenAfter(["d4", "Nf6"]))]: [stat("c4", 4)],
        [positionKey(fenAfter(["c4", "e6"]))]: [stat("d4", 3)],
        [positionKey(fenAfter(["d4", "Nf6", "c4"]))]: [stat("e6", 4)],
        [positionKey(fenAfter(["c4", "e6", "d4"]))]: [stat("Nf6", 3)],
        [positionKey(fenAfter(["d4", "Nf6", "c4", "e6"]))]: [stat("Nc3", 5), stat("g3", 2)],
        [positionKey(fenAfter(["d4", "Nf6", "c4", "e6", "Nc3"]))]: [stat("Bb4", 5)],
    };
    const issues = await collectIssues(
        rep.fen,
        0,
        "white",
        index,
        async (fen) => byPosition[positionKey(fen)] ?? [],
    );
    expect(issues.map((i) => `${i.kind} ${lineText(i.line)}`)).toEqual([
        "end 1. d4 Nf6 2. c4 e6 3. Nc3 Bb4",
        "deviation 1. d4 Nf6 2. c4 e6 3. g3",
    ]);
});
