import { expect, test } from "vitest";
import {
    addEntry,
    historyPath,
    type ImportEntry,
    MAX_HISTORY,
    parseHistory,
    undoPlan,
} from "../repertoireHistory";

const entry = (id: string, before = `pgn-${id}`): ImportEntry => ({
    id,
    date: 1,
    kind: "course",
    source: id,
    added: 1,
    before,
});

test("the history file sits next to the repertoire", () => {
    expect(historyPath("/docs/Weiß.pgn")).toBe("/docs/Weiß.history.json");
});

test("new imports come first and old ones are dropped", () => {
    let list: ImportEntry[] = [];
    for (let i = 0; i < MAX_HISTORY + 5; i++) list = addEntry(list, entry(String(i)));
    expect(list).toHaveLength(MAX_HISTORY);
    expect(list[0].id).toBe(String(MAX_HISTORY + 4));
    expect(list.at(-1)!.id).toBe("5");
});

test("undoing an import restores its snapshot and undoes the later imports too", () => {
    // newest first: c was imported last
    const list = [entry("c"), entry("b"), entry("a")];
    expect(undoPlan(list, "c")).toEqual({
        restore: "pgn-c",
        undone: [entry("c")],
        remaining: [entry("b"), entry("a")],
    });
    const plan = undoPlan(list, "b")!;
    expect(plan.restore).toBe("pgn-b");
    expect(plan.undone.map((e) => e.id)).toEqual(["c", "b"]);
    expect(plan.remaining.map((e) => e.id)).toEqual(["a"]);
    expect(undoPlan(list, "x")).toBeNull();
});

test("a broken history file reads as empty, broken entries are skipped", () => {
    expect(parseHistory("not json")).toEqual([]);
    expect(parseHistory('{"a":1}')).toEqual([]);
    expect(parseHistory(JSON.stringify([entry("a"), { id: "x" }]))).toEqual([entry("a")]);
});
