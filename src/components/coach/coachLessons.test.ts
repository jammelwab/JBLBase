import { attacks } from "chessops/attacks";
import { opposite } from "chessops/util";
import { parseSan } from "chessops/san";
import { makeUci, type NormalMove } from "chessops";
import { createStore } from "jotai";
import { describe, expect, it } from "vitest";
import {
    coachLessonsDoneAtom,
    completeLessonAtom,
    judgeTask,
    type Lesson,
    type LessonTask,
    LESSON_PATHS,
    LESSON_XP,
    LESSONS,
    newLesson,
    taskPosition,
    unlockedLessons,
} from "./coachLessons";
import { sanToSquares } from "@/utils/gamesTree";
import { introDue, introReminder } from "./coachIntro";
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
    }
}

describe("Lektionen", () => {
    it("vier Pfade mit je drei Lektionen und drei Aufgaben", () => {
        expect(LESSONS).toHaveLength(12);
        for (const path of LESSON_PATHS)
            expect(LESSONS.filter((l) => l.path === path)).toHaveLength(3);
        expect(new Set(LESSONS.map((l) => l.id)).size).toBe(12);
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
        expect(judgeTask(castle, castle.tasks[0], "e1g1")).toBe("right");
        expect(judgeTask(castle, castle.tasks[0], "e1h1")).toBe("right");
        expect(judgeTask(castle, castle.tasks[0], "d2d3")).toBe("wrong");
        expect(judgeTask(castle, castle.tasks[0], "e1e3")).toBe("illegal");
        const mate = LESSONS[0];
        expect(judgeTask(mate, mate.tasks[1], "a1a8")).toBe("right");
        expect(judgeTask(mate, mate.tasks[1], "a1a7")).toBe("wrong");
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
