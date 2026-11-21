import { atomWithStorage } from "jotai/utils";
import type { BookMove } from "@/bindings";
import { getDocumentDir } from "@/utils/directories";
import { getMainOwner, listRepertoires, type Repertoire } from "@/utils/repertoires";
import { aprilFoolsBook, isAprilFools } from "./coachEggs";
import { today } from "./coachState";
import { type DiaryGame, epdIndex, repertoireBook, steeringBook, varietyBook } from "./coachDiary";

// Eröffnungs-Sparring: JBL spielt die Gegnerzüge aus deinem Repertoire.
export const coachSparringAtom = atomWithStorage<boolean>("jbl-coach-sparring", false);

// Wie oft JBL in eine Linie steuert, in der du früher danebengegriffen hast
export const STEER_CHANCE = 0.5;

export type CoachPlan = {
    book: BookMove[];
    // Was JBL zu Beginn ansagt
    announce: ("sparring" | "variety" | "noRepertoire" | "aprilFools")[];
    sparring: boolean;
    repertoire: Repertoire | null;
    // Stellung -> Repertoire-Züge (EPD-Schlüssel wie im Tagebuch)
    index: Map<string, string[]> | null;
};

// Das Hauptrepertoire des Spielers für diese Farbe, sonst das größte eigene.
export function pickRepertoire(
    all: readonly Repertoire[],
    color: "white" | "black",
    owner: string,
): Repertoire | null {
    const own = all.filter((r) => r.color === color && r.owner === owner && !r.parts);
    return (
        own.find((r) => r.main) ??
        [...own].sort((a, b) => b.stats.leaves - a.stats.leaves)[0] ??
        null
    );
}

export async function loadOwnRepertoires(): Promise<Repertoire[]> {
    try {
        return await listRepertoires(await getDocumentDir());
    } catch {
        return [];
    }
}

export function planCoachGame(
    humanColor: "white" | "black",
    diary: readonly DiaryGame[],
    repertoire: Repertoire | null,
    sparring: boolean,
    rand: () => number = Math.random,
    day: string = today(),
): CoachPlan {
    const index = repertoire ? epdIndex(repertoire.root) : null;
    if (sparring && repertoire) {
        return {
            book: repertoireBook(repertoire.root, humanColor),
            announce: ["sparring"],
            sparring: true,
            repertoire,
            index,
        };
    }
    const book: BookMove[] = [];
    const announce: CoachPlan["announce"] = [];
    const variety = varietyBook(diary, humanColor, rand);
    if (sparring) announce.push("noRepertoire");
    if (variety.announce) {
        book.push(...variety.book);
        announce.push("variety");
    }
    // Heimlich: manchmal steuert JBL in Linien, die dir früher Probleme gemacht haben
    if (rand() < STEER_CHANCE) book.push(...steeringBook(diary, humanColor));
    // Am 1. April: 1.e4 e5 2.Ke2, und JBL tut, als wäre nichts
    if (humanColor === "black" && isAprilFools(day)) {
        book.unshift(...aprilFoolsBook());
        announce.push("aprilFools");
    }
    return { book, announce, sparring: false, repertoire, index };
}

export async function prepareCoachGame(
    humanColor: "white" | "black",
    diary: readonly DiaryGame[],
    sparring: boolean,
): Promise<CoachPlan> {
    const repertoire = pickRepertoire(await loadOwnRepertoires(), humanColor, getMainOwner());
    return planCoachGame(humanColor, diary, repertoire, sparring);
}
