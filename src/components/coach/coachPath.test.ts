import { describe, expect, it } from "vitest";
import { advancePath, PATH_THEMES, pathStep } from "./coachPath";

describe("weiterer Pfad", () => {
    it("läuft im Kreis und wechselt die Taktik-Themen", () => {
        const ids = Array.from({ length: 6 }, (_, i) => pathStep(i).id);
        expect(ids).toEqual(["puzzles", "play", "tactic", "addLine", "tactic", "play"]);
        expect(pathStep(6).id).toBe("puzzles");
        const themes = Array.from({ length: 60 }, (_, i) => pathStep(i))
            .filter((s) => s.id === "tactic")
            .map((s) => s.theme);
        expect(themes.slice(0, PATH_THEMES.length)).toEqual([...PATH_THEMES]);
        expect(themes[PATH_THEMES.length]).toBe(PATH_THEMES[0]);
        expect(pathStep(0).theme).toBeNull();
    });

    it("zählt nur passende Ereignisse und schließt den Schritt ab", () => {
        let state = { index: 0, progress: 0 };
        expect(advancePath(state, "game").state).toBe(state);
        for (let i = 0; i < 4; i++) {
            const r = advancePath(state, "puzzle");
            expect(r.done).toBe(false);
            state = r.state;
        }
        expect(state.progress).toBe(4);
        const r = advancePath(state, "puzzle");
        expect(r).toEqual({ state: { index: 1, progress: 0 }, done: true });
        expect(advancePath(r.state, "game")).toEqual({
            state: { index: 2, progress: 0 },
            done: true,
        });
        expect(advancePath({ index: 3, progress: 0 }, "line").done).toBe(true);
    });
});
