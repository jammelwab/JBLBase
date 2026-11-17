import { useAtomValue } from "jotai";
import { useEffect, useMemo, useState } from "react";
import { sessionsAtom } from "@/state/atoms";
import { accountDatabaseFilename, sameName } from "@/utils/accountDatabase";
import { query_players } from "@/utils/db";
import { sessionUsername } from "@/utils/session";

/**
 * The player whose games a database holds, when it is the database of one of your own
 * Chess.com or Lichess accounts, spelled as the games spell it ("beispielkonto" can be
 * "BeispielKonto" there). Undefined for any other database, or while the name is looked up.
 */
export function useAccountPlayer(
    file: string | null | undefined,
    filename: string | null | undefined,
): string | undefined {
    const sessions = useAtomValue(sessionsAtom);
    const accountName = useMemo(() => {
        if (!filename) return undefined;
        for (const session of sessions) {
            const names = [
                session.lichess && ([sessionUsername(session), "lichess"] as const),
                session.chessCom && ([session.chessCom.username, "chesscom"] as const),
            ];
            for (const entry of names) {
                if (entry && sameName(filename, accountDatabaseFilename(entry[0], entry[1])))
                    return entry[0];
            }
        }
        return undefined;
    }, [sessions, filename]);

    const [resolved, setResolved] = useState<{ key: string; name: string }>();
    const key = file && accountName ? `${file}|${accountName}` : "";
    useEffect(() => {
        if (!file || !accountName) return;
        let active = true;
        query_players(file, {
            name: accountName,
            options: { skipCount: true, pageSize: 50, sort: "name", direction: "asc" },
        })
            .then((res) => res.data.find((p) => sameName(p.name, accountName))?.name ?? accountName)
            .catch(() => accountName)
            .then((name) => {
                if (active) setResolved({ key: `${file}|${accountName}`, name });
            });
        return () => {
            active = false;
        };
    }, [file, accountName]);

    return key && resolved?.key === key ? resolved.name : undefined;
}
