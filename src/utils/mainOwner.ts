import { getDefaultStore } from "jotai";
import { mainOwnerAtom } from "@/state/atoms";

// The user's own name for their repertoires, set in the settings and stored locally only.
// Until a name is set their repertoires belong to "Ich".
export const DEFAULT_MAIN_OWNER = "Ich";

export function mainOwnerName(stored: string | null | undefined): string {
    return stored?.trim() || DEFAULT_MAIN_OWNER;
}

export function getMainOwner(): string {
    return mainOwnerName(getDefaultStore().get(mainOwnerAtom));
}
