// The app's tutorials, as data. A tutorial is a list of steps; each step points at an element
// marked with `data-tour="…"` and explains it. Texts come from the translation files under
// `Tutorial.<tutorial>.<step>.Title` and `.Body`, so a new tutorial needs only an entry here,
// its texts and the `data-tour` marks on the elements it shows.

export type TutorialStep = {
    id: string;
    // The element to highlight (its data-tour value). With several, the first one that is on
    // screen. Without, or when none is found, the text stands in the middle of the window.
    target?: string | string[];
    // The step asks for a click on the element. "Next" then clicks it, and the tutorial moves
    // on by itself once the next step's element shows up.
    action?: boolean;
};

export type TutorialRoute =
    | "/"
    | "/accounts"
    | "/repertoires"
    | "/files"
    | "/databases"
    | "/engines"
    | "/insight"
    | "/settings";

export type Tutorial = {
    id: string;
    // The page the tutorial starts on
    route: TutorialRoute;
    // On the settings page: the tab to show first
    settingsTab?: string;
    // On the board page: start on an empty new tab (its start cards), not on an open game
    newTab?: boolean;
    // Further pages whose help button offers this tutorial (the start page always does)
    pages?: TutorialRoute[];
    // Only for admins
    adminOnly?: boolean;
    steps: TutorialStep[];
    // Offered on the last step as the tutorial to continue with
    next?: string;
};

export const TUTORIALS: Tutorial[] = [
    {
        id: "Repertoire",
        route: "/repertoires",
        steps: [
            { id: "Welcome" },
            { id: "Create", target: ["rep-defaults", "rep-new"] },
            { id: "Card", target: "rep-card" },
            { id: "Open", target: "rep-open" },
            { id: "Check", target: "rep-check" },
            { id: "Tree", target: "rep-tree", action: true },
            { id: "TreeDiagram", target: "rep-tree-diagram" },
            { id: "TreePreview", target: ["rep-tree-preview", "rep-tree-diagram"] },
            { id: "TreeBack", target: "rep-view-back", action: true },
            { id: "Compare", target: "rep-compare", action: true },
            { id: "ComparePlayer", target: "rep-compare-player" },
            { id: "CompareLists", target: ["rep-compare-lists", "rep-compare-nogames"] },
            { id: "CompareTree", target: "rep-compare-tree" },
            { id: "CompareBack", target: "rep-view-back", action: true },
            { id: "Next" },
        ],
        next: "Board",
    },
    {
        id: "Board",
        route: "/repertoires",
        pages: ["/"],
        steps: [
            { id: "Open", target: "rep-open", action: true },
            { id: "Repertoire", target: "board-tab-repertoire" },
            { id: "Add", target: "board-add-repertoire" },
            { id: "Practice", target: "board-tab-practice" },
            { id: "Analysis", target: "board-tab-analysis" },
            { id: "Database", target: "board-tab-database" },
            { id: "Done" },
        ],
        next: "Games",
    },
    {
        id: "Games",
        route: "/accounts",
        steps: [
            { id: "Welcome" },
            { id: "Add", target: ["acc-add", "acc-add-empty"] },
            { id: "Download", target: "acc-download" },
            { id: "Openings", target: "acc-openings" },
            { id: "Done" },
        ],
        next: "Home",
    },
    {
        id: "Home",
        route: "/",
        newTab: true,
        steps: [
            { id: "Cards", target: "home-cards" },
            { id: "Import", target: "home-import" },
            { id: "Recent", target: "home-recent" },
            { id: "Tabs", target: "board-new-tab" },
        ],
        next: "Puzzles",
    },
    {
        id: "Puzzles",
        route: "/",
        newTab: true,
        steps: [
            { id: "Open", target: "home-puzzle", action: true },
            { id: "Database", target: "puz-db" },
            { id: "Own", target: "puz-game-tactics" },
            { id: "Mode", target: "puz-mode" },
            { id: "Blind", target: "puz-blind" },
            { id: "Stats", target: "puz-stats" },
        ],
        next: "Databases",
    },
    {
        id: "Databases",
        route: "/databases",
        steps: [
            { id: "Add", target: "db-add" },
            { id: "List", target: "db-list" },
            { id: "Details", target: ["db-details", "db-list"] },
            { id: "Board", target: "db-list" },
        ],
        next: "Files",
    },
    {
        id: "Files",
        route: "/files",
        steps: [
            { id: "New", target: "files-new" },
            { id: "Filter", target: "files-filter" },
            { id: "Tree", target: "files-tree" },
        ],
        next: "Engines",
    },
    {
        id: "Engines",
        route: "/engines",
        steps: [
            { id: "List", target: "eng-list" },
            { id: "Add", target: "eng-add" },
            { id: "Settings", target: ["eng-settings", "eng-list"] },
            { id: "Cache" },
        ],
        next: "Insight",
    },
    {
        id: "Insight",
        route: "/insight",
        steps: [
            { id: "Player", target: "ins-player" },
            { id: "Run", target: "ins-run" },
            { id: "Stats", target: ["ins-stats", "ins-run"] },
            { id: "Calibration", target: "ins-calibration" },
        ],
        next: "Share",
    },
    {
        id: "Share",
        route: "/repertoires",
        steps: [
            { id: "Button", target: ["rep-share", "rep-card"] },
            { id: "Updates" },
            { id: "Received", target: "rep-shared-with-me" },
        ],
        next: "Account",
    },
    {
        id: "Account",
        route: "/settings",
        settingsTab: "profile",
        steps: [
            { id: "Profile", target: "set-profile" },
            { id: "Sync", target: ["set-sync", "set-profile"] },
            { id: "Corner", target: "corner-menu" },
        ],
        next: "Settings",
    },
    {
        id: "Settings",
        route: "/settings",
        settingsTab: "board",
        steps: [
            { id: "Tabs", target: "set-tabs" },
            { id: "EvalCache", target: "set-tab-evalcache", action: true },
            { id: "EvalCachePanel", target: "set-evalcache" },
            { id: "Menu", target: "corner-menu" },
            { id: "Help", target: "corner-help" },
        ],
        next: "Admin",
    },
    {
        id: "Admin",
        route: "/settings",
        settingsTab: "admin",
        adminOnly: true,
        steps: [{ id: "Overview", target: "set-admin" }, { id: "Links" }],
    },
];

export function findTutorial(id: string): Tutorial | undefined {
    return TUTORIALS.find((t) => t.id === id);
}

// The tutorials a user can start: admin-only ones only for admins
export function availableTutorials(isAdmin: boolean): Tutorial[] {
    return TUTORIALS.filter((t) => isAdmin || !t.adminOnly);
}

// The tutorials that explain the page at `pathname` (e.g. "/databases/Lichess" → databases)
export function tutorialsForPage(pathname: string, isAdmin: boolean): Tutorial[] {
    const page = pathname === "/" ? "/" : `/${pathname.split("/")[1] ?? ""}`;
    return availableTutorials(isAdmin).filter(
        (t) => t.route === page || (t.pages ?? []).includes(page as TutorialRoute),
    );
}

// The tutorial that starts by itself the first time a page is opened
export const FIRST_TIME_TUTORIAL = "Repertoire";
