import { describe, expect, it } from "vitest";
import {
    type BugReportInfo,
    bugReportText,
    bugReportUrl,
    cleanLog,
    ISSUES_URL,
    logTail,
} from "../bugReport";

const info: BugReportInfo = {
    appVersion: "1.1.10",
    os: "macos",
    osVersion: "27.1",
    arch: "aarch64",
    language: "de",
};

describe("bug report", () => {
    it("removes home folders and e-mail addresses from the log", () => {
        const log = [
            "[INFO] opened /Users/beispiel/Documents/JBLBase/Ich Weiß.pgn",
            "[INFO] opened /home/beispiel/.local/share/x",
            "[WARN] C:\\Users\\Beispiel\\AppData\\Roaming\\de.jammelwab.jblbase\\eval.db",
            '[WARN] {"path":"C:\\\\Users\\\\Beispiel\\\\Documents"}',
            "[INFO] signed in as max.muster@example.org",
        ].join("\n");
        const clean = cleanLog(log);
        expect(clean).not.toMatch(/beispiel/i);
        expect(clean).not.toMatch(/max\.muster/);
        expect(clean).toContain("~/Documents/JBLBase/Ich Weiß.pgn");
        expect(clean).toContain("<e-mail>");
    });

    it("keeps only the last lines of the log", () => {
        const log = Array.from({ length: 500 }, (_, i) => `line ${i}`).join("\n");
        const tail = logTail(log, 200);
        expect(tail).toHaveLength(200);
        expect(tail[0]).toBe("line 300");
        expect(tail[199]).toBe("line 499");
        expect(logTail("a\n\n  \nb\r\n")).toEqual(["a", "b"]);
    });

    it("puts version, system and the cleaned log into the copied text", () => {
        const text = bugReportText(info, "x\n/Users/beispiel/y");
        expect(text).toContain("Version: 1.1.10");
        expect(text).toContain("macos 27.1 (aarch64)");
        expect(text).toContain("~/y");
        expect(text).not.toContain("beispiel");
        expect(bugReportText(info, null)).toContain("Protokoll nicht lesbar");
    });

    it("opens an issue with version and system but without the log", () => {
        const url = bugReportUrl(info);
        expect(url.startsWith(`${ISSUES_URL}?`)).toBe(true);
        const params = new URL(url).searchParams;
        expect(params.get("labels")).toBe("bug");
        expect(params.get("body")).toContain("Version: 1.1.10");
        expect(params.get("body")).not.toContain("```");
    });
});
