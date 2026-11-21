import { describe, expect, it } from "vitest";

// Windows und macOS unterscheiden Groß- und Kleinschreibung in Dateinamen
// nicht. Liegen coachIntro.ts und CoachIntro.tsx nebeneinander, findet der
// Release-Build für "./CoachIntro" die falsche Datei und bricht ab.
const files = Object.keys(import.meta.glob(["./**/*.{ts,tsx}"]));

describe("Dateinamen", () => {
    it("unterscheiden sich nicht nur in der Groß- und Kleinschreibung", () => {
        const seen = new Map<string, string>();
        const clashes: string[] = [];
        for (const f of files) {
            const key = f.replace(/\.(test\.)?tsx?$/, "").toLowerCase();
            if (f.includes(".test.")) continue;
            const other = seen.get(key);
            if (other && other !== f) clashes.push(`${other} / ${f}`);
            seen.set(key, f);
        }
        expect(clashes).toEqual([]);
    });
});
