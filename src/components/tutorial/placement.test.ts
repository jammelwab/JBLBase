import { describe, expect, it } from "vitest";
import { placeCard, visibleBox } from "./placement";

const viewport = { width: 1200, height: 800 };
const card = { width: 340, height: 200 };

describe("placeCard", () => {
    it("centers without a target", () => {
        expect(placeCard(null, card, viewport)).toEqual({ left: 430, top: 300 });
    });

    it("goes below a button near the top", () => {
        const pos = placeCard({ left: 500, top: 50, width: 100, height: 30 }, card, viewport);
        expect(pos).toEqual({ left: 380, top: 92 });
    });

    it("goes above a button near the bottom", () => {
        const pos = placeCard({ left: 500, top: 700, width: 100, height: 30 }, card, viewport);
        expect(pos.top).toBe(700 - 12 - 200);
    });

    it("stays inside the window at the right edge", () => {
        const pos = placeCard({ left: 1150, top: 50, width: 40, height: 30 }, card, viewport);
        expect(pos.left + card.width).toBeLessThanOrEqual(viewport.width - 8);
    });

    it("sits over a large element", () => {
        const pos = placeCard({ left: 0, top: 0, width: 1200, height: 800 }, card, viewport);
        expect(pos.left).toBeGreaterThanOrEqual(8);
        expect(pos.top + card.height).toBeLessThanOrEqual(viewport.height - 8);
    });
});

describe("visibleBox", () => {
    it("adds a border and cuts at the window", () => {
        expect(visibleBox({ left: 2, top: 10, width: 100, height: 20 }, viewport)).toEqual({
            left: 0,
            top: 4,
            width: 108,
            height: 32,
        });
    });
});
