import { parseUci } from "chessops";
import { Chess, normalizeMove } from "chessops/chess";
import { parseFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import type { CoachStrengthId } from "./coachState";
import { coachXpAtom } from "./coachState";

// Lernpfad (1.2.8): vier Pfade mit je drei Lektionen. Eine Lektion hat ein
// Beispiel mit Pfeilen und drei Aufgaben. Die Texte stehen in den
// Übersetzungen unter Coach.Lesson.<id>.

export type LessonPath = "game" | "principles" | "tactics" | "advanced";
export const LESSON_PATHS: LessonPath[] = ["game", "principles", "tactics", "advanced"];

// Was eine richtige Lösung ausmacht. Bei "mate" zählt jedes Matt, sonst die
// angegebenen Züge; die Tests prüfen, dass sie das Motiv wirklich zeigen.
export type LessonCheck =
    | "mate"
    | "capture"
    | "bestCapture"
    | "castle"
    | "fork"
    | "pin"
    | "skewer"
    | "discovered";

export type LessonTask = { fen: string; solutions: string[] };

export type Lesson = {
    id: string;
    path: LessonPath;
    check: LessonCheck;
    example: { fen: string; arrows: [string, string][] };
    tasks: LessonTask[];
};

export const LESSON_XP = 150;

export const LESSONS: Lesson[] = [
    // ---------- 1. Das Spiel ----------
    {
        id: "mate",
        path: "game",
        check: "mate",
        example: {
            fen: "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 1",
            arrows: [
                ["f3", "f7"],
                ["c4", "f7"],
            ],
        },
        tasks: [
            {
                fen: "rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2",
                solutions: ["Qh4#"],
            },
            { fen: "7k/8/6K1/8/8/8/8/R7 w - - 0 1", solutions: ["Ra8#"] },
            { fen: "4k3/1R6/8/8/8/8/8/R5K1 w - - 0 1", solutions: ["Ra8#"] },
        ],
    },
    {
        id: "queenMate",
        path: "game",
        check: "mate",
        example: { fen: "7k/8/5K2/8/8/8/8/6Q1 w - - 0 1", arrows: [["g1", "g7"]] },
        tasks: [
            { fen: "k7/7Q/1K6/8/8/8/8/8 w - - 0 1", solutions: ["Qb7#"] },
            { fen: "4k3/8/4K3/8/8/8/8/Q7 w - - 0 1", solutions: ["Qa8#"] },
            { fen: "8/8/8/8/8/2K5/Q7/2k5 w - - 0 1", solutions: ["Qc2#"] },
        ],
    },
    {
        id: "rookMate",
        path: "game",
        check: "mate",
        example: { fen: "k7/8/K7/8/8/8/8/7R w - - 0 1", arrows: [["h1", "h8"]] },
        tasks: [
            { fen: "7R/8/8/8/8/1K6/8/k7 w - - 0 1", solutions: ["Rh1#"] },
            { fen: "8/8/8/8/8/5K2/R7/5k2 w - - 0 1", solutions: ["Ra1#"] },
            { fen: "2k5/8/2K5/8/8/8/8/7R w - - 0 1", solutions: ["Rh8#"] },
        ],
    },
    // ---------- 2. Motive und Prinzipien ----------
    {
        id: "hanging",
        path: "principles",
        check: "capture",
        example: { fen: "4k3/8/8/8/5b2/3N4/8/4K3 w - - 0 1", arrows: [["d3", "f4"]] },
        tasks: [
            { fen: "4k3/8/8/3n4/8/8/3R4/4K3 w - - 0 1", solutions: ["Rxd5"] },
            { fen: "4k3/8/2b5/8/8/8/8/2Q1K3 w - - 0 1", solutions: ["Qxc6+"] },
            { fen: "4k3/8/8/3q4/4P3/8/8/4K3 w - - 0 1", solutions: ["exd5"] },
        ],
    },
    {
        id: "values",
        path: "principles",
        check: "bestCapture",
        example: { fen: "4k3/8/8/8/1p3b2/3N4/8/4K3 w - - 0 1", arrows: [["d3", "f4"]] },
        tasks: [
            { fen: "4k3/8/8/8/2r1n3/3P4/8/4K3 w - - 0 1", solutions: ["dxc4"] },
            { fen: "4k3/7p/2q5/8/4B3/8/8/4K3 w - - 0 1", solutions: ["Bxc6+"] },
            { fen: "4k3/8/8/5r2/2n5/4N3/8/4K3 w - - 0 1", solutions: ["Nxf5"] },
        ],
    },
    {
        id: "castle",
        path: "principles",
        check: "castle",
        example: {
            fen: "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4",
            arrows: [
                ["e1", "g1"],
                ["h1", "f1"],
            ],
        },
        tasks: [
            {
                fen: "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4",
                solutions: ["O-O"],
            },
            {
                fen: "r3kbnr/ppp1pppp/2nq4/3p1b2/3P1B2/2NQ4/PPP1PPPP/R3KBNR w KQkq - 6 5",
                solutions: ["O-O-O"],
            },
            {
                fen: "rnbqk2r/ppp2ppp/3p1n2/2b1p3/2B1P3/3P1N2/PPP2PPP/RNBQK2R w KQkq - 0 5",
                solutions: ["O-O"],
            },
        ],
    },
    // ---------- 3. Taktik ----------
    {
        id: "fork",
        path: "tactics",
        check: "fork",
        example: {
            fen: "r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1",
            arrows: [
                ["b5", "c7"],
                ["c7", "e8"],
                ["c7", "a8"],
            ],
        },
        tasks: [
            { fen: "6k1/8/8/3q4/6N1/8/8/4K3 w - - 0 1", solutions: ["Nf6+"] },
            { fen: "4k3/1q6/8/8/4N3/8/8/4K3 w - - 0 1", solutions: ["Nd6+"] },
            { fen: "2r3k1/8/8/3N4/8/8/8/6K1 w - - 0 1", solutions: ["Ne7+"] },
        ],
    },
    {
        id: "pin",
        path: "tactics",
        check: "pin",
        example: {
            fen: "4k3/8/2n5/8/8/8/8/4KB2 w - - 0 1",
            arrows: [
                ["f1", "b5"],
                ["b5", "e8"],
            ],
        },
        tasks: [
            { fen: "4k3/8/2n5/8/8/8/8/4KB2 w - - 0 1", solutions: ["Bb5"] },
            { fen: "4k3/4n3/8/8/8/8/8/K6R w - - 0 1", solutions: ["Re1"] },
            { fen: "3k4/8/8/3n4/8/8/4K3/7R w - - 0 1", solutions: ["Rd1"] },
        ],
    },
    {
        id: "backRank",
        path: "tactics",
        check: "mate",
        example: { fen: "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1", arrows: [["a1", "a8"]] },
        tasks: [
            { fen: "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1", solutions: ["Ra8#"] },
            { fen: "3r2k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1", solutions: ["Rxd8#"] },
            { fen: "6k1/5ppp/8/8/8/8/1Q3PPP/6K1 w - - 0 1", solutions: ["Qb8#"] },
        ],
    },
    // ---------- 4. Fortgeschritten ----------
    {
        id: "skewer",
        path: "advanced",
        check: "skewer",
        example: {
            fen: "4r3/8/8/4k3/8/8/8/R5K1 w - - 0 1",
            arrows: [
                ["a1", "e1"],
                ["e1", "e8"],
            ],
        },
        tasks: [
            { fen: "4r3/8/8/4k3/8/8/8/R5K1 w - - 0 1", solutions: ["Re1+"] },
            { fen: "8/8/1q6/8/3k3B/8/8/K7 w - - 0 1", solutions: ["Bf2+"] },
            { fen: "8/1q6/8/8/4k3/8/8/K5Q1 w - - 0 1", solutions: ["Qg2+", "Qh1+"] },
        ],
    },
    {
        id: "discovered",
        path: "advanced",
        check: "discovered",
        example: {
            fen: "4k3/8/8/2q5/4N3/8/8/4R1K1 w - - 0 1",
            arrows: [
                ["e4", "c5"],
                ["e1", "e8"],
            ],
        },
        tasks: [
            { fen: "4k3/8/8/2q5/4N3/8/8/4R1K1 w - - 0 1", solutions: ["Nxc5+"] },
            { fen: "3k4/r7/8/8/3B4/8/8/3R2K1 w - - 0 1", solutions: ["Bxa7+"] },
            { fen: "7k/7p/8/8/3R4/8/1B6/6K1 w - - 0 1", solutions: ["Rd8#"] },
        ],
    },
    {
        id: "smothered",
        path: "advanced",
        check: "mate",
        example: { fen: "6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1", arrows: [["g5", "f7"]] },
        tasks: [
            { fen: "6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1", solutions: ["Nf7#"] },
            { fen: "6rk/6pp/7N/8/8/8/8/6K1 w - - 0 1", solutions: ["Nf7#"] },
            { fen: "kr6/pp6/8/1N6/8/8/8/6K1 w - - 0 1", solutions: ["Nc7#"] },
        ],
    },
];

export function findLesson(id: string): Lesson | undefined {
    return LESSONS.find((l) => l.id === id);
}

// ---------- Einstieg und Freischalten ----------

// Antwort aus der Einführung: wie stark bin ich?
export type CoachEntry = "rules" | "knows" | "regular" | "club";
export const COACH_ENTRIES: CoachEntry[] = ["rules", "knows", "regular", "club"];

const ENTRY_PATH: Record<CoachEntry, LessonPath> = {
    rules: "game",
    knows: "principles",
    regular: "tactics",
    club: "advanced",
};

export const ENTRY_STRENGTH: Record<CoachEntry, CoachStrengthId> = {
    rules: "veryEasy",
    knows: "easy",
    regular: "fairlyEasy",
    club: "medium",
};

// Die erste Lektion des Einstiegspfads und alles davor ist offen; jedes
// Level schaltet eine weitere frei.
export function unlockedLessons(level: number, entry: CoachEntry | null): number {
    const start = LESSONS.findIndex((l) => l.path === ENTRY_PATH[entry ?? "knows"]);
    return Math.max(1, Math.min(LESSONS.length, start + Math.max(1, level)));
}

// Die zuletzt freigeschaltete Lektion, wenn sie neu und noch offen ist
export function newLesson(unlocked: number, announced: number, done: readonly string[]) {
    if (unlocked <= announced) return null;
    const lesson = LESSONS[unlocked - 1];
    return lesson && !done.includes(lesson.id) ? lesson : null;
}

// ---------- Aufgaben prüfen ----------

export function taskPosition(fen: string): Chess {
    const setup = parseFen(fen);
    if (setup.isErr) throw new Error(`Bad lesson FEN: ${fen}`);
    return Chess.fromSetup(setup.value).unwrap();
}

const bare = (san: string) => san.replace(/[+#]/g, "");

// Rochade als Zug des Königs auf g1/c1 kommt als e1g1; chessops will e1h1.
export function lessonMove(pos: Chess, uci: string) {
    const move = parseUci(uci);
    if (!move || !("from" in move)) return null;
    const normal = normalizeMove(pos, move);
    return pos.isLegal(normal) ? normal : null;
}

export type TaskVerdict = "right" | "wrong" | "illegal";

export function judgeTask(lesson: Lesson, task: LessonTask, uci: string): TaskVerdict {
    const pos = taskPosition(task.fen);
    const move = lessonMove(pos, uci);
    if (!move) return "illegal";
    const san = makeSan(pos, move);
    if (lesson.check === "mate") {
        const after = pos.clone();
        after.play(move);
        return after.isCheckmate() ? "right" : "wrong";
    }
    return task.solutions.some((s) => bare(s) === bare(san)) ? "right" : "wrong";
}

// ---------- Fortschritt ----------

// Erledigte Lektionen (Vereinigung beim Abgleich)
export const coachLessonsDoneAtom = atomWithStorage<string[]>("jbl-coach-lessons", []);
// Bis wohin „Neue Lektion freigeschaltet“ schon gesagt wurde
export const coachLessonAnnouncedAtom = atomWithStorage<number>("jbl-coach-lesson-announced", 0);
// Welche Lektion auf der Coach-Seite geöffnet werden soll
export const coachOpenLessonAtom = atom<string | null>(null);

// Eine Lektion abschließen: einmalig XP
export const completeLessonAtom = atom(null, (get, set, id: string): number => {
    const done = get(coachLessonsDoneAtom);
    if (done.includes(id) || !findLesson(id)) return 0;
    set(coachLessonsDoneAtom, [...done, id]);
    set(coachXpAtom, get(coachXpAtom) + LESSON_XP);
    return LESSON_XP;
});
