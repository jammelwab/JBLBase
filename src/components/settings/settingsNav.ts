import {
    IconBook,
    IconBrush,
    IconChartBar,
    IconChess,
    IconDatabase,
    IconFolder,
    IconKeyboard,
    IconMouse,
    IconSchool,
    IconShield,
    IconUserCircle,
    IconVolume,
} from "@tabler/icons-react";

export type SettingsTabValue =
    | "profile"
    | "board"
    | "inputs"
    | "keybinds"
    | "repertoire"
    | "tutorials"
    | "appearance"
    | "sound"
    | "evalcache"
    | "directories"
    | "privacy"
    | "admin";

export interface SettingsNavTab {
    value: SettingsTabValue;
    label: string;
    icon: typeof IconChess;
    adminOnly?: boolean;
}

export interface SettingsNavGroup {
    label: string;
    tabs: SettingsNavTab[];
}

/**
 * The settings tabs, sorted into a few groups so the list on the left stays
 * short and easy to scan. Shared by the settings page and the corner menu.
 */
export const SETTINGS_NAV: SettingsNavGroup[] = [
    {
        label: "Settings.Group.Account",
        tabs: [{ value: "profile", label: "Settings.Cloud", icon: IconUserCircle }],
    },
    {
        label: "Settings.Group.Play",
        tabs: [
            { value: "board", label: "Settings.Board", icon: IconChess },
            { value: "inputs", label: "Settings.Inputs", icon: IconMouse },
            { value: "keybinds", label: "Settings.Keybinds", icon: IconKeyboard },
            { value: "repertoire", label: "Settings.Repertoire", icon: IconBook },
            { value: "tutorials", label: "Settings.Tutorials", icon: IconSchool },
        ],
    },
    {
        label: "Settings.Group.Look",
        tabs: [
            { value: "appearance", label: "Settings.Appearance", icon: IconBrush },
            { value: "sound", label: "Settings.Sound", icon: IconVolume },
        ],
    },
    {
        label: "Settings.Group.System",
        tabs: [
            { value: "evalcache", label: "Settings.EvalCache", icon: IconDatabase },
            { value: "directories", label: "Settings.Directories", icon: IconFolder },
            { value: "privacy", label: "Settings.Privacy", icon: IconShield },
            { value: "admin", label: "Settings.Admin", icon: IconChartBar, adminOnly: true },
        ],
    },
];

/** Older tabs that were folded into another one. */
export function normalizeSettingsTab(value: string): string {
    return value === "anarchy" ? "inputs" : value;
}
