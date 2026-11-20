// "Fehler melden" in the corner menu: the facts a bug report needs (version,
// system, the end of the log), copied for the person to paste, and a GitHub
// issue opened with version and system already filled in.
//
// The log is cleaned first: home folders and e-mail addresses are replaced,
// so a pasted report does not carry the account name of the computer.

/** Where new issues are opened. */
export const ISSUES_URL = "https://github.com/jammelwab/JBLBase/issues/new";
/** How many lines from the end of the log go into the report. */
export const LOG_LINES = 200;

export type BugReportInfo = {
    appVersion: string;
    os: string;
    osVersion: string;
    arch: string;
    language: string;
};

const HOME_PATTERNS: RegExp[] = [
    // macOS and Linux
    /\/(Users|home)\/[^/\s"'`]+/g,
    // Windows, with either slash and doubled backslashes as JSON writes them
    /[A-Za-z]:(\\\\|\\|\/)(Users|Benutzer)(\\\\|\\|\/)[^\\/\s"'`]+/gi,
];
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Removes home folders and e-mail addresses from log text. */
export function cleanLog(text: string): string {
    let out = text;
    for (const pattern of HOME_PATTERNS) out = out.replace(pattern, "~");
    return out.replace(EMAIL_PATTERN, "<e-mail>");
}

/** The last `count` non-empty lines of a log. */
export function logTail(text: string, count = LOG_LINES): string[] {
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
    return lines.slice(-count);
}

function systemLine(info: BugReportInfo): string {
    return `${info.os} ${info.osVersion} (${info.arch}), Sprache ${info.language}`;
}

/** The text copied to the clipboard. */
export function bugReportText(info: BugReportInfo, log: string | null): string {
    const parts = [
        "## JBLBase-Fehlerbericht",
        "",
        `- Version: ${info.appVersion}`,
        `- System: ${systemLine(info)}`,
        "",
        "## Was ist passiert?",
        "",
        "(Bitte kurz beschreiben: was du getan hast, was passieren sollte, was passiert ist.)",
        "",
        `## Protokoll (letzte ${LOG_LINES} Zeilen)`,
        "",
    ];
    if (log === null) {
        parts.push("(Protokoll nicht lesbar)");
    } else {
        parts.push("```", ...logTail(cleanLog(log)), "```");
    }
    return parts.join("\n");
}

/** A new GitHub issue with version and system filled in; the log is pasted by hand. */
export function bugReportUrl(info: BugReportInfo): string {
    const body = [
        `- Version: ${info.appVersion}`,
        `- System: ${systemLine(info)}`,
        "",
        "## Was ist passiert?",
        "",
        "",
        "## Protokoll",
        "",
        "(JBLBase hat den Bericht mit Protokoll in die Zwischenablage kopiert. Hier einfügen.)",
    ].join("\n");
    const params = new URLSearchParams({ labels: "bug", body });
    return `${ISSUES_URL}?${params.toString()}`;
}
