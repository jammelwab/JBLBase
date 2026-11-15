import { sameName } from "./accountDatabase";
import { playerNames, type Session } from "./session";

/**
 * A database with games of a player that is no Lichess or Chess.com account, e.g. imported
 * tournament games. `name` is how the player is spelled in that database ("Schwab, Jannick"),
 * `player` the player on the accounts page ("Jannick Schwab") it belongs to.
 */
export type PlayerDatabase = { player: string; file: string; name: string };

function samePath(a: string, b: string) {
    return a.replace(/\\/g, "/").toLowerCase() === b.replace(/\\/g, "/").toLowerCase();
}

function sameLink(a: PlayerDatabase, b: PlayerDatabase) {
    return samePath(a.file, b.file) && sameName(a.name, b.name);
}

/** Every player: those of the accounts first, then players with only databases. */
export function allPlayerNames(sessions: Session[], links: PlayerDatabase[]): string[] {
    const names = playerNames(sessions);
    for (const link of links) {
        if (!names.some((n) => sameName(n, link.player))) names.push(link.player);
    }
    return names;
}

export function linksOfPlayer(links: PlayerDatabase[], player: string): PlayerDatabase[] {
    return links.filter((l) => sameName(l.player, player));
}

/** The player a database player belongs to, if any. */
export function linkOf(
    links: PlayerDatabase[],
    file: string,
    name: string,
): PlayerDatabase | undefined {
    return links.find((l) => sameLink(l, { player: "", file, name }));
}

/**
 * Adds a database player to `player`. A name only differing in case joins the existing
 * player, and a database player belongs to one player only.
 */
export function addLink(
    links: PlayerDatabase[],
    link: PlayerDatabase,
    players: string[] = [],
): PlayerDatabase[] {
    const wanted = link.player.trim();
    const player =
        [...players, ...links.map((l) => l.player)].find((p) => sameName(p, wanted)) ?? wanted;
    const name = link.name.trim();
    if (!player || !name || !link.file) return links;
    const next = { player, file: link.file, name };
    return [...links.filter((l) => !sameLink(l, next)), next];
}

export function removeLink(links: PlayerDatabase[], link: PlayerDatabase): PlayerDatabase[] {
    return links.filter((l) => !sameLink(l, link));
}

/** Follows a renamed player. An empty name keeps the old one: a database needs a player. */
export function renameLinks(links: PlayerDatabase[], from: string, to: string): PlayerDatabase[] {
    const name = to.trim();
    if (!name) return links;
    return links.map((l) => (sameName(l.player, from) ? { ...l, player: name } : l));
}

export function removePlayerLinks(links: PlayerDatabase[], player: string): PlayerDatabase[] {
    return links.filter((l) => !sameName(l.player, player));
}

/** "C:\\...\\Turniere.duckdb" -> "Turniere" */
export function databaseName(file: string): string {
    const base = file.split(/[\\/]/).pop() ?? file;
    return base.replace(/\.(duckdb|db3|db)$/i, "");
}
