import { afterEach, describe, expect, it, vi } from "vitest";
import { readTabState, removeTabState, writeTabState } from "./tabStorage";

describe("tabStorage", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        sessionStorage.clear();
    });

    it("stores small states in sessionStorage", () => {
        writeTabState("a", "small");
        expect(sessionStorage.getItem("a")).toBe("small");
        expect(readTabState("a")).toBe("small");
    });

    it("keeps a state that does not fit in memory", () => {
        writeTabState("big", "old");
        vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
            throw new DOMException("full", "QuotaExceededError");
        });
        expect(() => writeTabState("big", "huge")).not.toThrow();
        expect(sessionStorage.getItem("big")).toBeNull();
        expect(readTabState("big")).toBe("huge");
        removeTabState("big");
        expect(readTabState("big")).toBeNull();
    });

    it("moves back to sessionStorage once it fits again", () => {
        const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
            throw new DOMException("full", "QuotaExceededError");
        });
        writeTabState("t", "first");
        spy.mockRestore();
        writeTabState("t", "second");
        expect(sessionStorage.getItem("t")).toBe("second");
        expect(readTabState("t")).toBe("second");
    });

    it("rethrows other errors", () => {
        vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
            throw new Error("boom");
        });
        expect(() => writeTabState("x", "y")).toThrow("boom");
    });
});
