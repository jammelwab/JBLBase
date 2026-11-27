import { describe, expect, it } from "vitest";
import { squaresToSan } from "@/utils/gamesTree";
import { isPromotion, PROMOTION_LETTER } from "./CoachBoard";
import { judgeTask, LESSONS } from "./coachLessonsData";

describe("Umwandlung auf dem Coach-Brett", () => {
    it("erkennt, wann ein Bauer umwandelt", () => {
        expect(isPromotion("8/4P3/8/8/8/8/8/k6K w - - 0 1", "e7", "e8")).toBe(true);
        expect(isPromotion("k6K/8/8/8/8/8/3p4/8 b - - 0 1", "d2", "d1")).toBe(true);
        expect(isPromotion("8/8/4P3/8/8/8/8/k6K w - - 0 1", "e6", "e7")).toBe(false);
        expect(isPromotion("4R3/8/8/8/8/8/8/k6K w - - 0 1", "e8", "e1")).toBe(false);
    });
    it("die Unterverwandlung gilt, wenn man die richtige Figur wählt", () => {
        const lesson = LESSONS.find((l) => l.id === "underpromotion")!;
        for (const task of lesson.tasks) {
            const sol = task.solutions[0];
            const role = { N: "knight", R: "rook", B: "bishop", Q: "queen" }[
                sol.replace(/[+#]/g, "").slice(-1)
            ] as keyof typeof PROMOTION_LETTER;
            // Die Felder aus der Lösung lesen und mit der gewählten Figur spielen
            const m = sol.match(/([a-h])x?([a-h])?([18])=/)!;
            const fromFile = m[1];
            const toFile = m[2] ?? m[1];
            const toRank = m[3];
            const fromRank = toRank === "8" ? "7" : "2";
            const uci = `${fromFile}${fromRank}${toFile}${toRank}`;
            expect(judgeTask(lesson, task, uci + PROMOTION_LETTER[role])).toBe("right");
            expect(judgeTask(lesson, task, `${uci}q`)).toBe("wrong");
        }
    });
    it("squaresToSan nimmt die gewählte Figur", () => {
        expect(squaresToSan("8/4P3/8/8/8/8/8/k6K w - - 0 1", "e7", "e8", "knight")).toBe("e8=N");
        expect(squaresToSan("8/4P3/8/8/8/8/8/k6K w - - 0 1", "e7", "e8")).toBe("e8=Q");
    });
});
