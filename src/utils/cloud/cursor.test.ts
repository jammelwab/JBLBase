import { describe, expect, it } from "vitest";
import { formatSyncCursor, parseSyncCursor } from "./cursor";

describe("sync cursor", () => {
    it("round-trips server time and document id", () => {
        const text = formatSyncCursor(1763236800, 123000, "abc|def");
        expect(text).toBe("1763236800.000123000|abc|def");
        expect(parseSyncCursor(text)).toEqual({
            seconds: 1763236800,
            nanos: 123000,
            id: "abc|def",
        });
    });

    it("reads nothing as the start", () => {
        expect(parseSyncCursor(null)).toBeNull();
        expect(parseSyncCursor("")).toBeNull();
        expect(parseSyncCursor("x")).toBeNull();
    });

    it("turns a millisecond position from 1.0.28 into a time two minutes earlier", () => {
        expect(parseSyncCursor("1763236800500")).toEqual({
            seconds: 1763236680,
            nanos: 500_000_000,
            id: "",
        });
        expect(parseSyncCursor("60000")).toBeNull();
    });

    it("keeps a time-only position", () => {
        const text = formatSyncCursor(10, 5, "");
        expect(parseSyncCursor(text)).toEqual({ seconds: 10, nanos: 5, id: "" });
    });
});
