import { expect, test } from "vitest";
import { folderLabel, prettyFolderName } from "../repertoireFolders";

test("course folder names read like titles", () => {
    expect(prettyFolderName("chessable_Ending_the_Englund_Gambit")).toEqual({
        label: "Ending the Englund Gambit",
        source: "Chessable",
    });
    expect(
        prettyFolderName(
            "chessable_Get_Romantic__Play_The_King's_Gambit_From_18th_and_19th_Century",
        ),
    ).toEqual({
        label: "Get Romantic: Play The King's Gambit From 18th and 19th Century",
        source: "Chessable",
    });
    expect(prettyFolderName("chessable_Mayhem_In_The_Morra").label).toBe("Mayhem In The Morra");
});

test("names chosen in the app stay as they are", () => {
    expect(prettyFolderName("London System")).toEqual({ label: "London System", source: null });
    expect(prettyFolderName("1.d4")).toEqual({ label: "1.d4", source: null });
    expect(prettyFolderName("Chessable")).toEqual({ label: "Chessable", source: null });
    expect(prettyFolderName("___").label).toBe("___");
});

test("folder paths join the readable names", () => {
    expect(folderLabel("Weiß/chessable_Mayhem_In_The_Morra")).toBe("Weiß › Mayhem In The Morra");
    expect(folderLabel("")).toBe("");
});
