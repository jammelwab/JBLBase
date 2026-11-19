import { createEmptyCard } from "ts-fsrs";
import { describe, expect, it } from "vitest";
import { getNextCardForReview, type Position } from "@/components/files/opening";

const due = (fen: string): Position => ({
    fen,
    answer: "e4",
    card: createEmptyCard(new Date(Date.now() - 60_000)),
});

describe("getNextCardForReview", () => {
    it("does not give the card that was just answered again", () => {
        const positions = [due("a"), due("b")];
        expect(getNextCardForReview(positions, 0)?.fen).toBe("b");
    });

    it("gives the first due card when nothing was answered yet", () => {
        const positions = [due("a"), due("b")];
        expect(getNextCardForReview(positions, undefined)?.fen).toBe("a");
    });

    it("ends when the answered card was the only one due", () => {
        expect(getNextCardForReview([due("a")], 0)).toBeNull();
    });
});
