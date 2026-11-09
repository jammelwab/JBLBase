import { useNavigate } from "@tanstack/react-router";
import { useSetAtom } from "jotai";
import { useCallback } from "react";
import { activeTabAtom, tabsAtom } from "@/state/atoms";
import { lineText } from "@/utils/gamesTree";
import { createTab } from "@/utils/tabs";
import { defaultTree } from "@/utils/treeReducer";

// Opens a line in a new analysis tab, positioned at its last move.
export function useOpenLine(
    rootFen: string,
    rootHalfMoves: number,
    orientation: "white" | "black",
) {
    const navigate = useNavigate();
    const setTabs = useSetAtom(tabsAtom);
    const setActiveTab = useSetAtom(activeTabAtom);
    return useCallback(
        async (line: string[]) => {
            const tree = defaultTree(rootFen);
            await createTab({
                tab: { name: lineText(line, rootHalfMoves), type: "analysis" },
                setTabs,
                setActiveTab,
                pgn: `${lineText(line, rootHalfMoves, "...")} *`,
                headers: { ...tree.headers, orientation },
                position: line.map(() => 0),
            });
            navigate({ to: "/" });
        },
        [rootFen, rootHalfMoves, orientation, setTabs, setActiveTab, navigate],
    );
}
