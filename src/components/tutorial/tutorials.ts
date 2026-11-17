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

export type Tutorial = {
    id: string;
    // The page the tutorial starts on
    route: "/repertoires" | "/accounts" | "/";
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
    },
];

export function findTutorial(id: string): Tutorial | undefined {
    return TUTORIALS.find((t) => t.id === id);
}

// The tutorial that starts by itself the first time a page is opened
export const FIRST_TIME_TUTORIAL = "Repertoire";
