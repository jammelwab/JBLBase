import { expect, test } from "vitest";
import {
    addStoredFolder,
    buildFolderTree,
    parseStoredFolders,
    planFolderImport,
    removeStoredFolder,
    renamedFolder,
    renameStoredFolders,
    type StoredFolder,
    uniqueName,
} from "../repertoireFolders";

const me = (path: string, color: "white" | "black" = "white"): StoredFolder => ({
    owner: "Ich",
    color,
    path,
});

test("empty folders show up in the folder tree", () => {
    const tree = buildFolderTree([{ name: "London", folder: "1.d4" }], ["1.d4/Colle", "1.e4"]);
    expect(tree.children.map((c) => c.name)).toEqual(["1.d4", "1.e4"]);
    expect(tree.children[0].children.map((c) => c.name)).toEqual(["Colle"]);
    expect(tree.children[0].items.map((i) => i.name)).toEqual(["London"]);
});

test("stored folders are added once, per player and color", () => {
    let list = addStoredFolder([], me("1.d4"));
    list = addStoredFolder(list, me("1.D4 "));
    list = addStoredFolder(list, me("1.d4", "black"));
    list = addStoredFolder(list, me(""));
    expect(list).toEqual([me("1.d4"), me("1.d4", "black")]);
});

test("removing a folder removes its subfolders, nothing else", () => {
    const list = [me("1.d4"), me("1.d4/London"), me("1.d4x"), me("1.d4", "black")];
    expect(removeStoredFolder(list, "ich", "white", "1.d4")).toEqual([
        me("1.d4x"),
        me("1.d4", "black"),
    ]);
});

test("renaming a folder moves everything inside", () => {
    expect(renamedFolder("1.d4/London/Main", "1.d4/London", "1.d4/Londoner")).toBe(
        "1.d4/Londoner/Main",
    );
    expect(renamedFolder("1.d4/london", "1.d4/London", "Damenbauer")).toBe("Damenbauer");
    expect(renamedFolder("1.d4x", "1.d4", "Damenbauer")).toBe("1.d4x");
    expect(renamedFolder("1.e4", "", "x")).toBe("1.e4");
    expect(
        renameStoredFolders(
            [me("1.d4/London"), me("1.d4/London", "black")],
            "Ich",
            "white",
            "1.d4",
            "Q",
        ),
    ).toEqual([me("Q/London"), me("1.d4/London", "black")]);
});

test("a broken folders file reads as empty", () => {
    expect(parseStoredFolders("nope")).toEqual([]);
    expect(parseStoredFolders(JSON.stringify([me("a"), { owner: "x" }, me(" ")]))).toEqual([
        me("a"),
    ]);
});

test("uniqueName counts up when a name is taken", () => {
    const taken = new Set(["london", "london (2)"]);
    expect(uniqueName("London", taken)).toBe("London (3)");
    expect(uniqueName("Colle", taken)).toBe("Colle");
    expect(uniqueName("colle", taken)).toBe("colle (2)");
});

test("a folder of PGNs keeps its structure and file names", () => {
    const files = [
        { path: "/c/Kurs/1.d4/London.pgn", relative: "1.d4/London.pgn" },
        { path: "/c/Kurs/1.d4/Colle/Main.PGN", relative: "1.d4\\Colle\\Main.PGN" },
        { path: "/c/Kurs/Intro.pgn", relative: "Intro.pgn" },
        { path: "/c/Kurs/notes.txt", relative: "notes.txt" },
    ];
    const plan = planFolderImport(files, ["1.d4", "1.d4/Colle", "Leer"], "Weiß", "Kurs");
    expect(plan.items).toEqual([
        { source: "/c/Kurs/Intro.pgn", name: "Intro", folder: "Weiß/Kurs" },
        { source: "/c/Kurs/1.d4/London.pgn", name: "London", folder: "Weiß/Kurs/1.d4" },
        { source: "/c/Kurs/1.d4/Colle/Main.PGN", name: "Main", folder: "Weiß/Kurs/1.d4/Colle" },
    ]);
    expect(plan.folders).toEqual([
        "Weiß/Kurs",
        "Weiß/Kurs/1.d4",
        "Weiß/Kurs/1.d4/Colle",
        "Weiß/Kurs/Leer",
    ]);
    const flat = planFolderImport(files, [], "", null);
    expect(flat.items.map((i) => i.folder)).toEqual(["", "1.d4", "1.d4/Colle"]);
    expect(flat.folders).toEqual([]);
});
