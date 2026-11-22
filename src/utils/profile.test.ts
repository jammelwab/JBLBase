import { describe, expect, it } from "vitest";
import {
    decideProfile,
    isDeviceKey,
    profileKeyFor,
    restoreStorage,
    snapshotStorage,
} from "./profile";

class MemoryStorage implements Storage {
    private data = new Map<string, string>();
    get length() {
        return this.data.size;
    }
    clear() {
        this.data.clear();
    }
    getItem(key: string) {
        return this.data.get(key) ?? null;
    }
    key(index: number) {
        return [...this.data.keys()][index] ?? null;
    }
    removeItem(key: string) {
        this.data.delete(key);
    }
    setItem(key: string, value: string) {
        this.data.set(key, value);
    }
}

const none = { owner: null, ask: false, declined: [] as string[] };

describe("profile", () => {
    it("gives a device without earlier account its data to the first account", () => {
        expect(decideProfile("A", none)).toEqual({ kind: "use", key: "legacy", claim: true });
        expect(decideProfile(null, none)).toEqual({ kind: "use", key: "legacy", claim: false });
    });

    it("asks when an account was signed in before the update", () => {
        expect(decideProfile("B", { ...none, ask: true })).toEqual({ kind: "ask" });
        expect(decideProfile("B", { ...none, ask: true, declined: ["B"] })).toEqual({
            kind: "use",
            key: "u-B",
            claim: false,
        });
    });

    it("keeps the old data with its owner and separates every other account", () => {
        const s = { ...none, owner: "A", ask: true };
        expect(decideProfile("A", s)).toEqual({ kind: "use", key: "legacy", claim: false });
        expect(decideProfile("B", s)).toEqual({ kind: "use", key: "u-B", claim: false });
        expect(decideProfile(null, s)).toEqual({ kind: "use", key: "guest", claim: false });
    });

    it("builds safe profile keys", () => {
        expect(profileKeyFor("abC12/../x")).toBe("u-abC12x");
    });

    it("swaps account data but keeps device keys", () => {
        const st = new MemoryStorage();
        st.setItem("jbl-coach-xp", "4200");
        st.setItem("recent-files", "[1]");
        st.setItem("cloud-device-id", "dev");
        st.setItem("jbl-profile-active", "legacy");
        st.setItem("firebase:authUser", "x");
        const snap = snapshotStorage(st);
        expect(JSON.parse(snap)).toEqual({ "jbl-coach-xp": "4200", "recent-files": "[1]" });

        restoreStorage(null, st);
        expect(st.getItem("jbl-coach-xp")).toBeNull();
        expect(st.getItem("recent-files")).toBeNull();
        expect(st.getItem("cloud-device-id")).toBe("dev");
        expect(st.getItem("firebase:authUser")).toBe("x");

        restoreStorage(snap, st);
        expect(st.getItem("jbl-coach-xp")).toBe("4200");
        expect(isDeviceKey("jbl-profile-legacy-owner")).toBe(true);
        expect(isDeviceKey("document-dir")).toBe(false);
    });
});
