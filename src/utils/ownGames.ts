import type { LocalOptions } from "@/components/panels/database/DatabasePanel";
import type { OwnGamesFilter } from "@/state/atoms";

// Your own games only, by the color you had. "mine" takes the color whose move it is, so the
// moves listed are always yours and never those of an opponent who plays your opening.
export function ownGamesOptions(
    options: LocalOptions,
    player: string | undefined,
    filter: OwnGamesFilter,
    fen: string,
): LocalOptions {
    if (!player || filter === "all") return options;
    const white = filter === "white" || (filter === "mine" && fen.split(" ")[1] !== "b");
    return {
        ...options,
        player1: player,
        player2: undefined,
        sides: white ? "WhiteBlack" : "BlackWhite",
    };
}
