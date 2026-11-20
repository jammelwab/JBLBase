import { describe, expect, it } from "vitest";
import { parseEngineJson } from "../engines";

describe("editing an engine as JSON", () => {
    it("accepts a valid local engine", () => {
        const res = parseEngineJson(
            JSON.stringify({
                type: "local",
                name: "Stockfish",
                version: "19",
                path: "/x/stockfish",
                loaded: true,
            }),
        );
        expect(res.ok).toBe(true);
    });

    it("says when the text is not JSON at all", () => {
        expect(parseEngineJson('{"type": "local",')).toEqual({ ok: false, reason: "syntax" });
    });

    it("names the fields that are missing or wrong", () => {
        const res = parseEngineJson(JSON.stringify({ type: "local", name: 5, version: "1" }));
        expect(res).toEqual({ ok: false, reason: "fields", fields: ["name", "path"] });
        expect(parseEngineJson(JSON.stringify({ name: "x" }))).toEqual({
            ok: false,
            reason: "fields",
            fields: ["type"],
        });
    });
});
