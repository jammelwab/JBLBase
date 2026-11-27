import { attacks, pawnAttacks } from "chessops/attacks";
import { opposite, squareFile, squareRank } from "chessops/util";
import { parseSan } from "chessops/san";
import { makeUci, type NormalMove } from "chessops";
import { createStore } from "jotai";
import { describe, expect, it } from "vitest";
import {
    coachLessonsDoneAtom,
    completeLessonAtom,
    exampleLine,
    playLine,
    taskLine,
    judgeTask,
    type Lesson,
    type LessonTask,
    LESSON_PATHS,
    LESSON_XP,
    LESSONS,
    newLesson,
    taskPosition,
    unlockedLessons,
    extraLessonLevel,
    visibleLessons,
} from "./coachLessonsData";
import { sanToSquares } from "@/utils/gamesTree";
import { introDue, introReminder } from "./coachIntroState";
import { coachXpAtom } from "./coachState";

const VALUE: Record<string, number> = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 0 };

// Zeigt der Zug wirklich das Motiv der Lektion?
function motif(lesson: Lesson, task: LessonTask, san: string): boolean {
    const pos = taskPosition(task.fen);
    const them = opposite(pos.turn);
    const move = parseSan(pos, san) as NormalMove | undefined;
    if (!move) return false;
    const uci = makeUci(move);
    // Rochade schreibt chessops als König schlägt Turm; das prüft der eigene Test
    if (lesson.check !== "castle" && judgeTask(lesson, task, uci) !== "right") return false;
    const captured = pos.board.get(move.to);
    const piece = pos.board.get(move.from)!;
    const after = pos.clone();
    after.play(move);
    // Das Ziel ist sicher: der Gegner kann die Figur nicht schlagen
    const safe = after.kingAttackers(move.to, them, after.board.occupied).isEmpty();
    const big = after.board.queen.union(after.board.rook);
    switch (lesson.check) {
        case "mate":
            return after.isCheckmate();
        case "capture":
            return captured?.color === them && safe;
        case "bestCapture": {
            let best = 0;
            for (const [, dests] of pos.allDests())
                for (const to of dests) {
                    const c = pos.board.get(to);
                    if (c?.color === them) best = Math.max(best, VALUE[c.role]);
                }
            return safe && !!captured && VALUE[captured.role] === best;
        }
        case "castle":
            return san.startsWith("O-O") && piece.role === "king";
        case "fork": {
            const hit = attacks(piece, move.to, after.board.occupied)
                .intersect(after.board[them])
                .intersect(after.board.king.union(big));
            return safe && hit.size() >= 2;
        }
        case "pin":
            return after.ctx().blockers.intersect(after.board[them]).nonEmpty();
        case "skewer": {
            const king = after.board.kingOf(them)!;
            const behind = attacks(piece, move.to, after.board.occupied.without(king))
                .intersect(after.board[them])
                .intersect(big);
            return after.isCheck() && behind.nonEmpty();
        }
        case "discovered":
            return after.ctx().checkers.without(move.to).nonEmpty();
        case "doubleCheck":
            return after.ctx().checkers.size() >= 2;
        case "underpromotion":
            return !!move.promotion && move.promotion !== "queen";
        case "check":
            return after.isCheck();
        // Mit Stockfish geprüft (bester Zug, deutlich vor dem zweitbesten);
        // hier zählt, dass die Lösung ein legaler Zug ist
        case "decoy":
        case "overload":
        case "removeDefender":
        case "opposition":
        case "breakthrough":
        case "square":
            return true;
        // Stellungsspiel (1.2.25): die Idee im Brett nachprüfen
        case "outpost": {
            // Springer im gegnerischen Lager, vom eigenen Bauern gedeckt, und
            // kein gegnerischer Bauer kann ihn je vertreiben
            const rank = squareRank(move.to);
            const file = squareFile(move.to);
            const forward = pos.turn === "white" ? 1 : -1;
            const deep = pos.turn === "white" ? rank >= 4 : rank <= 3;
            const guarded = pawnAttacks(them, move.to)
                .intersect(after.board.pawn)
                .intersect(after.board[pos.turn])
                .nonEmpty();
            const chaser = [...after.board.pawn.intersect(after.board[them])].some(
                (s) => Math.abs(squareFile(s) - file) === 1 && (squareRank(s) - rank) * forward > 0,
            );
            return piece.role === "knight" && deep && guarded && !chaser;
        }
        case "openFile": {
            const file = squareFile(move.to);
            const pawnOnFile = [...after.board.pawn].some((s) => squareFile(s) === file);
            return piece.role === "rook" && squareFile(move.from) !== file && !pawnOnFile;
        }
        case "seventhRank":
            return piece.role === "rook" && squareRank(move.to) === (pos.turn === "white" ? 6 : 1);
        case "blockade": {
            // Springer direkt vor einem gegnerischen Bauern
            const ahead = move.to + (pos.turn === "white" ? 8 : -8);
            const p = after.board.get(ahead);
            return piece.role === "knight" && p?.role === "pawn" && p.color === them;
        }
        case "passedPawn": {
            // Ein Freibauer läuft: vor ihm und daneben keine gegnerischen Bauern
            const file = squareFile(move.from);
            const rank = squareRank(move.from);
            const forward = pos.turn === "white" ? 1 : -1;
            const stopper = [...pos.board.pawn.intersect(pos.board[them])].some(
                (s) => Math.abs(squareFile(s) - file) <= 1 && (squareRank(s) - rank) * forward > 0,
            );
            return piece.role === "pawn" && !stopper;
        }
        // 1.2.33: nach jeder Antwort gibt es ein Matt in eins
        case "mateIn2": {
            if (after.isCheckmate()) return false;
            for (const [from, dests] of after.allDests())
                for (const to of dests) {
                    const reply = after.clone();
                    reply.play({ from, to });
                    let mates = false;
                    for (const [f2, d2] of reply.allDests())
                        for (const t2 of d2) {
                            const last = reply.clone();
                            last.play({ from: f2, to: t2 });
                            if (last.isCheckmate()) mates = true;
                        }
                    if (!mates) return false;
                }
            return true;
        }
        case "queenFork":
        case "rookFork":
        case "pawnFork": {
            const role = { queenFork: "queen", rookFork: "rook", pawnFork: "pawn" }[lesson.check];
            const targets = after.board[them].diff(after.board.pawn);
            const hit = attacks(piece, move.to, after.board.occupied).intersect(targets);
            return piece.role === role && !captured && hit.size() >= 2 && (role === "pawn" || safe);
        }
        case "umbrella": {
            // Der König stellt sich direkt vor einen gegnerischen Bauern
            const ahead = move.to + (pos.turn === "white" ? 8 : -8);
            const p = after.board.get(ahead);
            return piece.role === "king" && p?.role === "pawn" && p.color === them;
        }
    }
}

describe("Lektionen", () => {
    it("zwölf Pfade mit je drei Lektionen und drei Aufgaben", () => {
        expect(LESSONS).toHaveLength(36);
        for (const path of LESSON_PATHS)
            expect(LESSONS.filter((l) => l.path === path)).toHaveLength(3);
        // Die Pfade liegen in Reihenfolge hintereinander
        expect(LESSONS.map((l) => LESSON_PATHS.indexOf(l.path))).toEqual(
            [...LESSONS.map((l) => LESSON_PATHS.indexOf(l.path))].sort((a, b) => a - b),
        );
        expect(new Set(LESSONS.map((l) => l.id)).size).toBe(36);
        for (const l of LESSONS) {
            expect(l.tasks).toHaveLength(3);
            taskPosition(l.example.fen);
            for (const [a, b] of l.example.arrows) {
                expect(a).toMatch(/^[a-h][1-8]$/);
                expect(b).toMatch(/^[a-h][1-8]$/);
            }
        }
    });

    for (const lesson of LESSONS)
        for (const [i, task] of lesson.tasks.entries())
            it(`${lesson.id} ${i + 1}: Lösung zeigt das Motiv (${lesson.check})`, () => {
                expect(sanToSquares(task.fen, task.solutions[0])).not.toBeNull();
                for (const san of task.solutions) expect(motif(lesson, task, san)).toBe(true);
            });

    it("bewertet Züge; Rochade auch als Königszug", () => {
        const castle = LESSONS.find((l) => l.id === "castle")!;
        expect(judgeTask(castle, castle.tasks[0], "e8g8")).toBe("right");
        expect(judgeTask(castle, castle.tasks[0], "e8h8")).toBe("right");
        expect(judgeTask(castle, castle.tasks[0], "a7a6")).toBe("wrong");
        expect(judgeTask(castle, castle.tasks[0], "e8e6")).toBe("illegal");
        const mate = LESSONS[0];
        expect(judgeTask(mate, mate.tasks[1], "a1a8")).toBe("right");
        expect(judgeTask(mate, mate.tasks[1], "a1a7")).toBe("wrong");
    });
});

describe("Folgezüge", () => {
    it("alle Folgen sind gültige Züge, Aufgaben-Folgen beginnen nach der Lösung", () => {
        for (const lesson of LESSONS) {
            const ex = exampleLine(lesson);
            expect(playLine(lesson.example.fen, ex)).toHaveLength(ex.length);
            for (const [i, task] of lesson.tasks.entries()) {
                const line = taskLine(lesson, i, task.solutions[0]);
                expect(playLine(task.fen, line)).toHaveLength(line.length);
            }
        }
        // Nur bei der Hauptlösung, sonst passt die Folge nicht
        const fork = LESSONS.find((l) => l.id === "fork")!;
        expect(taskLine(fork, 0, fork.tasks[0].solutions[0]).length).toBeGreaterThan(1);
        expect(taskLine(fork, 0, "Kd2")).toEqual([]);
    });
    it("spielt Züge mit Stellung und letztem Zug", () => {
        const steps = playLine("4k3/8/8/8/8/8/8/R3K3 w - - 0 1", ["Ra8+", "Kd7", "Xx9"]);
        expect(steps.map((s) => s.san)).toEqual(["Ra8+", "Kd7"]);
        expect(steps[0].lastMove).toEqual(["a1", "a8"]);
    });
});

describe("Lernpfad", () => {
    it("Einstieg und Freischalten je Level", () => {
        expect(unlockedLessons(1, "rules")).toBe(1);
        expect(unlockedLessons(3, "rules")).toBe(3);
        expect(unlockedLessons(1, "knows")).toBe(4);
        expect(unlockedLessons(1, "regular")).toBe(7);
        expect(unlockedLessons(1, "club")).toBe(10);
        expect(unlockedLessons(50, "club")).toBe(12);
        expect(unlockedLessons(1, null)).toBe(4);
    });
    it("weitere Reihen erscheinen erst nach der Reihe davor, mit Schloss", () => {
        const ids = (from: number, to: number) => LESSONS.slice(from, to).map((l) => l.id);
        expect(visibleLessons([])).toBe(12);
        expect(visibleLessons(ids(0, 11))).toBe(12);
        expect(visibleLessons(ids(0, 12))).toBe(15);
        expect(visibleLessons(ids(0, 15))).toBe(18);
        expect(visibleLessons(ids(0, 24))).toBe(27);
        expect(visibleLessons(ids(0, 27))).toBe(30);
        expect(visibleLessons(ids(0, 30))).toBe(33);
        expect(visibleLessons(ids(0, 36))).toBe(36);
        // Stellungsspiel kommt erst nach allen Taktik- und Endspiel-Reihen
        expect(LESSONS.slice(24, 30).map((l) => l.path)).toEqual([
            "position",
            "position",
            "position",
            "structure",
            "structure",
            "structure",
        ]);
        // Sichtbar, aber erst ab Level 10 und nach der vorigen Lektion offen
        expect(unlockedLessons(9, "club", ids(0, 12))).toBe(12);
        expect(unlockedLessons(10, "club", ids(0, 12))).toBe(13);
        expect(unlockedLessons(30, "club", ids(0, 12))).toBe(13);
        expect(unlockedLessons(30, "club", ids(0, 13))).toBe(14);
        expect(unlockedLessons(11, "club", ids(0, 14))).toBe(14);
        // Die nächste Reihe ist noch nicht sichtbar, also auch nicht offen
        expect(unlockedLessons(30, "club", ids(0, 15))).toBe(16);
        expect(extraLessonLevel(12)).toBe(10);
    });
    it("meldet eine neue Lektion nur einmal", () => {
        expect(newLesson(4, 3, [])?.id).toBe(LESSONS[3].id);
        expect(newLesson(4, 4, [])).toBeNull();
        expect(newLesson(4, 3, [LESSONS[3].id])).toBeNull();
    });
    it("XP nur beim ersten Abschluss", () => {
        const store = createStore();
        expect(store.set(completeLessonAtom, "fork")).toBe(LESSON_XP);
        expect(store.set(completeLessonAtom, "fork")).toBe(0);
        expect(store.set(completeLessonAtom, "nope")).toBe(0);
        expect(store.get(coachXpAtom)).toBe(LESSON_XP);
        expect(store.get(coachLessonsDoneAtom)).toEqual(["fork"]);
    });
});

describe("Einführung", () => {
    const base = { done: false, entry: null, later: false, reminded: false };
    it("kommt erst nach dem ersten Abgleich und nur einmal", () => {
        expect(introDue(base, true, false)).toBe(false);
        expect(introDue(base, false, true)).toBe(false);
        expect(introDue(base, true, true)).toBe(true);
        expect(introDue({ ...base, done: true }, true, true)).toBe(false);
        expect(introDue({ ...base, later: true }, true, true)).toBe(false);
    });
    it("nach „Später“ erinnert die Karte einmal", () => {
        expect(introReminder(base)).toBe(false);
        expect(introReminder({ ...base, later: true })).toBe(true);
        expect(introReminder({ ...base, later: true, reminded: true })).toBe(false);
        expect(introReminder({ ...base, later: true, done: true })).toBe(false);
    });
});
