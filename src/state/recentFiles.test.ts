import { createStore } from "jotai";
import { describe, expect, test } from "vitest";
import {
    addRecentFileAtom,
    moveRecentFilesAtom,
    recentFilesAtom,
    removeRecentFilesAtom,
} from "./atoms";

function setup() {
    const store = createStore();
    store.set(recentFilesAtom, []);
    return store;
}

describe("recent files", () => {
    test("the same file spelled differently is listed once", () => {
        const store = setup();
        store.set(addRecentFileAtom, {
            name: "Weiß",
            path: "C:\\Docs\\Weiß.pgn",
            type: "repertoire",
        });
        store.set(addRecentFileAtom, {
            name: "Weiß",
            path: "c:/Docs/Weiß.pgn",
            type: "repertoire",
        });
        expect(store.get(recentFilesAtom)).toHaveLength(1);
    });

    test("a renamed file keeps its row with the new path and name", () => {
        const store = setup();
        store.set(addRecentFileAtom, { name: "Alt", path: "/docs/Alt.pgn", type: "game" });
        store.set(moveRecentFilesAtom, { from: "/docs/Alt.pgn", to: "/docs/Neu.pgn" });
        expect(store.get(recentFilesAtom)[0]).toMatchObject({ name: "Neu", path: "/docs/Neu.pgn" });
    });

    test("moving a folder moves the files inside it, but not look-alike folders", () => {
        const store = setup();
        store.set(addRecentFileAtom, { name: "a", path: "/docs/rep/a.pgn", type: "game" });
        store.set(addRecentFileAtom, { name: "b", path: "/docs/rep2/b.pgn", type: "game" });
        store.set(moveRecentFilesAtom, { from: "/docs/rep", to: "/docs/archiv/rep" });
        const paths = store.get(recentFilesAtom).map((f) => f.path);
        expect(paths).toEqual(["/docs/rep2/b.pgn", "/docs/archiv/rep/a.pgn"]);
    });

    test("deleting a folder removes its files from the list", () => {
        const store = setup();
        store.set(addRecentFileAtom, { name: "a", path: "/docs/rep/a.pgn", type: "game" });
        store.set(addRecentFileAtom, { name: "b", path: "/docs/b.pgn", type: "game" });
        store.set(removeRecentFilesAtom, "/docs/rep");
        expect(store.get(recentFilesAtom).map((f) => f.path)).toEqual(["/docs/b.pgn"]);
    });
});
