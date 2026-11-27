import { parseUci } from "chessops";
import { Chess, normalizeMove } from "chessops/chess";
import { parseFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import type { CoachStrengthId } from "./coachState";
import { coachXpAtom } from "./coachState";

// Lernpfad (1.2.8, ab 1.2.25 zehn Reihen): vier Pfade mit je drei Lektionen. Eine Lektion hat ein
// Beispiel mit Pfeilen und drei Aufgaben. Die Texte stehen in den
// Übersetzungen unter Coach.Lesson.<id>.

export type LessonPath =
    | "game"
    | "principles"
    | "tactics"
    | "advanced"
    // Ab 1.2.15: weitere Reihen nach den ersten zwölf Lektionen
    | "mates"
    | "combos"
    | "deep"
    | "endgame"
    // Ab 1.2.25: Stellungsspiel nach der Taktik
    | "position"
    | "structure";
export const LESSON_PATHS: LessonPath[] = [
    "game",
    "principles",
    "tactics",
    "advanced",
    "mates",
    "combos",
    "deep",
    "endgame",
    "position",
    "structure",
];

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
    | "discovered"
    // Ab 1.2.15
    | "doubleCheck"
    | "underpromotion"
    | "check"
    | "decoy"
    | "overload"
    | "removeDefender"
    | "opposition"
    | "breakthrough"
    | "square"
    // Ab 1.2.25: Stellungsspiel
    | "outpost"
    | "openFile"
    | "seventhRank"
    | "blockade"
    | "passedPawn"
    | "umbrella";

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
        // Stellungen aus echten Eröffnungen; die Rochade ist laut Stockfish
        // (Tiefe 22) klar der beste Zug (1.2.27)
        example: {
            fen: "r1b1kbnr/ppqp1ppp/2n1p3/8/2B1P3/2N2N2/PP3PPP/R1BQK2R w KQkq - 2 7",
            arrows: [
                ["e1", "g1"],
                ["h1", "f1"],
            ],
        },
        tasks: [
            {
                fen: "rnbqk2r/ppp1ppbp/5np1/4N3/2BP4/2N5/PPP3PP/R1BQK2R b KQkq - 3 7",
                solutions: ["O-O"],
            },
            {
                fen: "r1bqk2r/pnppbppp/2p5/4P3/3N4/8/PPP1QPPP/RNB2RK1 b kq - 2 9",
                solutions: ["O-O"],
            },
            {
                fen: "rnbqk2r/ppp1bppp/4p3/3pP3/3P2Q1/2N5/PPP2PPP/R3KBNR b KQkq - 2 7",
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
            { fen: "2r3k1/8/8/3N4/8/8/5P2/6K1 w - - 0 1", solutions: ["Ne7+"] },
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
            { fen: "4k3/8/2n5/8/3P4/8/8/4KB2 w - - 0 1", solutions: ["Bb5"] },
            { fen: "4kb2/8/8/3p4/8/2N5/8/4K3 b - - 0 1", solutions: ["Bb4"] },
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
    // ---------- 5. Mattbilder (ab 1.2.15) ----------
    {
        id: "arabianMate",
        path: "mates",
        check: "mate",
        example: {
            fen: "7k/R7/5N2/8/8/8/8/6K1 w - - 0 1",
            arrows: [
                ["a7", "h7"],
                ["f6", "h7"],
            ],
        },
        tasks: [
            { fen: "7k/1R6/5N2/8/8/8/8/6K1 w - - 0 1", solutions: ["Rh7#"] },
            { fen: "k7/8/2N5/8/8/8/8/1R4K1 w - - 0 1", solutions: ["Rb8#"] },
            { fen: "6rk/1R6/5N2/8/8/8/8/K7 w - - 0 1", solutions: ["Rh7#"] },
        ],
    },
    {
        id: "anastasiaMate",
        path: "mates",
        check: "mate",
        example: {
            fen: "7k/4N1p1/8/8/8/4R3/8/6K1 w - - 0 1",
            arrows: [
                ["e3", "h3"],
                ["e7", "g8"],
                ["e7", "g6"],
            ],
        },
        tasks: [
            { fen: "7k/4N1p1/8/8/8/4R3/8/6K1 w - - 0 1", solutions: ["Rh3#"] },
            { fen: "7k/4N1p1/8/8/8/8/1Q6/6K1 w - - 0 1", solutions: ["Qh2#"] },
            { fen: "k7/1p1N4/8/8/8/8/8/1R4K1 w - - 0 1", solutions: ["Ra1#"] },
        ],
    },
    {
        id: "bodenMate",
        path: "mates",
        check: "mate",
        example: {
            fen: "2kr4/3p4/8/8/5B2/8/8/5BK1 w - - 0 1",
            arrows: [
                ["f1", "a6"],
                ["f4", "b8"],
            ],
        },
        tasks: [
            { fen: "2kr4/3p4/8/8/5B2/8/8/5BK1 w - - 0 1", solutions: ["Ba6#"] },
            { fen: "2kr3r/3pq3/8/8/8/3B4/7B/6K1 w - - 0 1", solutions: ["Ba6#"] },
            { fen: "4rk2/4p3/8/8/2B5/8/8/1KB5 w - - 0 1", solutions: ["Bh6#"] },
        ],
    },
    // ---------- 6. Kombinationen ----------
    {
        id: "decoy",
        path: "combos",
        check: "decoy",
        example: {
            fen: "5r1k/6pp/7N/8/2Q5/8/8/6K1 w - - 0 1",
            arrows: [
                ["c4", "g8"],
                ["f8", "g8"],
                ["h6", "f7"],
            ],
        },
        tasks: [
            { fen: "5r1k/6pp/7N/8/2Q5/8/8/6K1 w - - 0 1", solutions: ["Qg8+"] },
            { fen: "6k1/6pp/8/2N1q3/8/8/6PP/5RK1 w - - 0 1", solutions: ["Rf8+"] },
            { fen: "k1r5/pp6/N7/8/8/8/7Q/6K1 w - - 0 1", solutions: ["Qb8+"] },
        ],
    },
    {
        id: "overload",
        path: "combos",
        check: "overload",
        example: {
            fen: "4r1k1/3q1ppp/8/8/8/8/4QPPP/4R1K1 w - - 0 1",
            arrows: [
                ["e2", "e8"],
                ["d7", "e8"],
                ["e1", "e8"],
            ],
        },
        tasks: [
            { fen: "4r1k1/3q1ppp/8/8/8/8/4QPPP/4R1K1 w - - 0 1", solutions: ["Qxe8+"] },
            { fen: "3r2k1/5ppp/1q6/8/8/8/3Q1PPP/3R2K1 w - - 0 1", solutions: ["Qxd8+"] },
            { fen: "1r4k1/3n1ppp/8/8/8/8/1Q3PPP/1R4K1 w - - 0 1", solutions: ["Qxb8+"] },
        ],
    },
    {
        id: "removeDefender",
        path: "combos",
        check: "removeDefender",
        example: {
            fen: "5rk1/5ppp/5n2/6B1/8/3B3Q/5PPP/6K1 w - - 0 1",
            arrows: [
                ["g5", "f6"],
                ["h3", "h7"],
                ["d3", "h7"],
            ],
        },
        tasks: [
            { fen: "5rk1/5ppp/5n2/6B1/8/3B3Q/5PPP/6K1 w - - 0 1", solutions: ["Bxf6"] },
            { fen: "5rk1/5ppp/5n2/8/8/2BB3Q/5PPP/6K1 w - - 0 1", solutions: ["Bxf6"] },
            { fen: "5rk1/5ppp/5n2/3N4/8/3B3Q/5PPP/6K1 w - - 0 1", solutions: ["Nxf6+"] },
        ],
    },
    // ---------- 7. Tiefe Taktik ----------
    {
        id: "doubleCheck",
        path: "deep",
        check: "doubleCheck",
        example: {
            fen: "4k3/8/5q2/8/4N3/8/8/4R1K1 w - - 0 1",
            arrows: [
                ["e4", "f6"],
                ["f6", "e8"],
                ["e1", "e8"],
            ],
        },
        tasks: [
            { fen: "4k3/8/5q2/8/4N3/8/8/4R1K1 w - - 0 1", solutions: ["Nxf6+"] },
            { fen: "4k3/8/8/7q/8/8/4B3/4R1K1 w - - 0 1", solutions: ["Bxh5+"] },
            { fen: "7k/7p/8/8/3R4/8/1B6/6K1 w - - 0 1", solutions: ["Rd8#"] },
        ],
    },
    {
        id: "underpromotion",
        path: "deep",
        check: "underpromotion",
        example: {
            fen: "8/1q1P1k2/8/8/8/8/P7/6K1 w - - 0 1",
            arrows: [
                ["d7", "d8"],
                ["d8", "f7"],
                ["d8", "b7"],
            ],
        },
        tasks: [
            { fen: "8/1q1P1k2/8/8/8/8/P7/6K1 w - - 0 1", solutions: ["d8=N+"] },
            { fen: "8/4P1k1/3q4/8/8/8/P7/6K1 w - - 0 1", solutions: ["e8=N+"] },
            { fen: "8/2P1q3/1k6/8/8/8/7P/6K1 w - - 0 1", solutions: ["c8=N+"] },
        ],
    },
    {
        id: "desperado",
        path: "deep",
        check: "check",
        example: {
            fen: "8/7k/8/8/8/7p/5q1P/6RK w - - 0 1",
            arrows: [
                ["g1", "g7"],
                ["h7", "g7"],
            ],
        },
        tasks: [
            { fen: "8/7k/8/8/8/7p/5q1P/6RK w - - 0 1", solutions: ["Rg7+"] },
            { fen: "k7/8/8/8/8/7p/5q1P/1R5K w - - 0 1", solutions: ["Rb8+", "Ra1+"] },
            { fen: "7k/8/8/8/8/p7/P1q5/KR6 w - - 0 1", solutions: ["Rh1+", "Rb8+"] },
        ],
    },
    // ---------- 8. Endspiel-Muster ----------
    {
        id: "opposition",
        path: "endgame",
        check: "opposition",
        example: {
            fen: "8/8/8/4k3/8/3K4/4P3/8 w - - 0 1",
            arrows: [
                ["d3", "e3"],
                ["e3", "e5"],
            ],
        },
        tasks: [
            { fen: "8/8/8/4k3/8/3K4/4P3/8 w - - 0 1", solutions: ["Ke3"] },
            { fen: "8/8/8/3k4/8/8/3PK3/8 w - - 0 1", solutions: ["Kd3"] },
            { fen: "8/8/8/5k2/8/4K3/5P2/8 w - - 0 1", solutions: ["Kf3"] },
        ],
    },
    {
        id: "breakthrough",
        path: "endgame",
        check: "breakthrough",
        example: {
            fen: "8/ppp5/8/PPP5/8/8/8/k6K w - - 0 1",
            arrows: [
                ["b5", "b6"],
                ["a5", "b6"],
                ["c5", "b6"],
            ],
        },
        tasks: [
            { fen: "8/ppp5/8/PPP5/8/8/8/k6K w - - 0 1", solutions: ["b6"] },
            { fen: "8/5ppp/8/5PPP/8/8/8/K6k w - - 0 1", solutions: ["g6"] },
            { fen: "8/1ppp4/8/1PPP4/8/8/8/k6K w - - 0 1", solutions: ["c6"] },
        ],
    },
    {
        id: "square",
        path: "endgame",
        check: "square",
        example: {
            fen: "7k/8/8/p7/8/8/7P/5K2 w - - 0 1",
            arrows: [
                ["a5", "a1"],
                ["f1", "e2"],
            ],
        },
        tasks: [
            { fen: "7k/8/8/p7/8/8/7P/5K2 w - - 0 1", solutions: ["Ke2", "Ke1"] },
            { fen: "k7/8/8/7p/8/8/P7/2K5 w - - 0 1", solutions: ["Kd2", "Kd1"] },
            { fen: "7k/8/p7/8/8/8/7P/6K1 w - - 0 1", solutions: ["Kf2", "Kf1"] },
        ],
    },
    // ---------- 9. Stellungsspiel (1.2.25) ----------
    // Alle Aufgaben mit Stockfish (Tiefe 22) geprüft: die Lösung ist der beste
    // Zug oder höchstens 0,1 dahinter.
    {
        id: "outpost",
        path: "position",
        check: "outpost",
        example: {
            fen: "2b3k1/pp3ppp/3p4/3Np3/4P3/8/PP3PPP/6K1 w - - 0 1",
            arrows: [
                ["e4", "d5"],
                ["d5", "f6"],
            ],
        },
        tasks: [
            { fen: "2b3k1/pp3ppp/4p3/4P3/2N5/8/PP3PPP/6K1 w - - 0 1", solutions: ["Nd6"] },
            {
                fen: "r5k1/1p3ppp/p1n5/2p1p3/4P3/2NP4/PP3PPP/R5K1 w - - 0 1",
                solutions: ["Nd5"],
            },
            { fen: "2b3k1/pp3pp1/4p2p/4P3/2N5/7P/PP3PP1/6K1 w - - 0 1", solutions: ["Nd6"] },
        ],
    },
    {
        id: "openFile",
        path: "position",
        check: "openFile",
        example: {
            fen: "6k1/pp3ppp/4p3/8/8/4P3/PP3PPP/2R3K1 w - - 0 1",
            arrows: [["c1", "c8"]],
        },
        tasks: [
            { fen: "r5k1/pp3ppp/2p1p3/8/8/2P1P3/PP3PPP/R5K1 w - - 0 1", solutions: ["Rd1"] },
            {
                fen: "r5k1/1p3pp1/p1p1p2p/8/8/P1P1P2P/1P3PP1/5RK1 w - - 0 1",
                solutions: ["Rd1"],
            },
            {
                fen: "2r3k1/pp3pp1/4p2p/8/8/4P2P/PP3PP1/R5K1 w - - 0 1",
                solutions: ["Rd1", "Rc1"],
            },
        ],
    },
    {
        id: "seventhRank",
        path: "position",
        check: "seventhRank",
        example: {
            fen: "1r4k1/p4pp1/7p/8/8/P6P/5PP1/2R3K1 w - - 0 1",
            arrows: [
                ["c1", "c7"],
                ["c7", "a7"],
                ["c7", "f7"],
            ],
        },
        tasks: [
            { fen: "3r2k1/p4ppp/1p6/8/8/6P1/P4P1P/2R3K1 w - - 0 1", solutions: ["Rc7"] },
            { fen: "4r1k1/pp3pp1/7p/8/8/7P/P4PP1/2R3K1 w - - 0 1", solutions: ["Rc7"] },
            { fen: "2r3k1/1p3ppp/p7/8/8/P6P/1P3PP1/3R2K1 w - - 0 1", solutions: ["Rd7"] },
        ],
    },
    // ---------- 10. Bauern und Könige (1.2.25) ----------
    {
        id: "blockade",
        path: "structure",
        check: "blockade",
        example: {
            fen: "6k1/5ppp/8/3p4/8/1N6/5PPP/6K1 w - - 0 1",
            arrows: [["b3", "d4"]],
        },
        tasks: [
            { fen: "6k1/5ppp/8/2b5/3p4/8/1N3PPP/6K1 w - - 0 1", solutions: ["Nd3"] },
            { fen: "6k1/5ppp/8/8/3p4/8/1N3PPP/6K1 w - - 0 1", solutions: ["Nd3"] },
            { fen: "6k1/5pp1/7p/8/2b1p3/8/5PPP/3N2K1 w - - 0 1", solutions: ["Ne3"] },
        ],
    },
    {
        id: "passedPawn",
        path: "structure",
        check: "passedPawn",
        example: {
            fen: "8/8/3P4/2K3p1/8/8/8/4k3 w - - 0 1",
            arrows: [["d6", "d8"]],
        },
        tasks: [
            { fen: "8/5K2/8/3p2P1/4k3/8/8/8 w - - 0 1", solutions: ["g6"] },
            { fen: "8/8/8/2P5/k7/6p1/4K3/8 w - - 0 1", solutions: ["c6"] },
            { fen: "8/6K1/5P2/8/p7/8/k7/8 w - - 0 1", solutions: ["f7"] },
        ],
    },
    {
        id: "umbrella",
        path: "structure",
        check: "umbrella",
        example: {
            fen: "3Q4/2P5/1p6/K7/8/8/8/qk6 w - - 0 1",
            arrows: [
                ["a5", "b5"],
                ["b6", "b5"],
            ],
        },
        tasks: [
            { fen: "8/2P5/8/3q2Kp/4k3/8/8/5Q2 w - - 0 1", solutions: ["Kh4"] },
            { fen: "8/2P3k1/3p4/4p3/3K4/7Q/8/6q1 w - - 0 1", solutions: ["Ke4"] },
            { fen: "8/1P3Q2/8/4k3/8/q3Kp2/8/8 w - - 0 1", solutions: ["Kf2"] },
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

// Die ersten zwölf Lektionen (vier Pfade); alles danach kommt Reihe für Reihe
export const BASE_LESSONS = 12;
// Ab diesem Level öffnen sich die weiteren Lektionen, eine pro Level
export const EXTRA_FROM_LEVEL = 10;

// Sichtbare Lektionen: die ersten zwölf, dann jede weitere Reihe erst, wenn
// die Reihe davor geschafft ist (1.2.15)
export function visibleLessons(done: readonly string[] = []): number {
    let count = BASE_LESSONS;
    for (let i = BASE_LESSONS; i < LESSONS.length; i += 3) {
        const before = LESSONS.slice(i - 3, i);
        if (!before.every((l) => done.includes(l.id))) break;
        count = Math.min(LESSONS.length, i + 3);
    }
    return count;
}

// Die erste Lektion des Einstiegspfads und alles davor ist offen; jedes
// Level schaltet eine weitere frei. Die weiteren Lektionen öffnen sich ab
// Level 10 eine nach der anderen: wenn die vorige geschafft ist und das
// Level reicht.
export function unlockedLessons(
    level: number,
    entry: CoachEntry | null,
    done: readonly string[] = [],
): number {
    const start = LESSONS.findIndex((l) => l.path === ENTRY_PATH[entry ?? "knows"]);
    const base = Math.max(1, Math.min(BASE_LESSONS, start + Math.max(1, level)));
    if (base < BASE_LESSONS) return base;
    const visible = visibleLessons(done);
    let count = BASE_LESSONS;
    while (
        count < visible &&
        level >= extraLessonLevel(count) &&
        done.includes(LESSONS[count - 1].id)
    )
        count++;
    return count;
}

// Ab welchem Level die weitere Lektion (Index ab 12) aufgeht
export function extraLessonLevel(index: number): number {
    return EXTRA_FROM_LEVEL + index - BASE_LESSONS;
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
