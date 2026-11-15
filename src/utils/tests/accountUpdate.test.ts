import { describe, expect, test } from "vitest";
import { chessComArchivesToFetch } from "../chess.com/api";
import { CORRESPONDENCE_LOOKBACK_MS, lichessGameUrls } from "../lichess/api";

// "Partien aktualisieren": what is fetched again (#92, #101).

const archive = (y: number, m: number) =>
    `https://api.chess.com/pub/player/x/games/${y}/${String(m).padStart(2, "0")}`;
const archives = [archive(2026, 8), archive(2026, 9), archive(2026, 10), archive(2026, 11)];

describe("chessComArchivesToFetch", () => {
    test("first download fetches every month", () => {
        expect(chessComArchivesToFetch(archives, null, [])).toEqual(archives);
    });

    test("an update starts with the month of the newest game", () => {
        const newest = Date.UTC(2026, 9, 31, 23, 30); // 31 Oct, 23:30 UTC
        expect(chessComArchivesToFetch(archives, newest, [])).toEqual([
            archive(2026, 10),
            archive(2026, 11),
        ]);
    });

    test("months that failed last time are fetched again", () => {
        const newest = Date.UTC(2026, 10, 2);
        expect(chessComArchivesToFetch(archives, newest, [archive(2026, 8)])).toEqual([
            archive(2026, 8),
            archive(2026, 11),
        ]);
    });
});

describe("lichessGameUrls", () => {
    test("first download fetches every game in one go", () => {
        const urls = lichessGameUrls("x", null);
        expect(urls).toHaveLength(1);
        expect(urls[0]).toContain("correspondence");
        expect(urls[0]).not.toContain("since=");
    });

    test("an update fetches correspondence games from further back", () => {
        const newest = 1_800_000_000_000;
        const [live, corr] = lichessGameUrls("x", newest);
        expect(live).toContain(`since=${newest}`);
        expect(live).not.toContain("correspondence");
        expect(corr).toContain("perfType=correspondence");
        expect(corr).toContain(`since=${newest - CORRESPONDENCE_LOOKBACK_MS}`);
    });
});
