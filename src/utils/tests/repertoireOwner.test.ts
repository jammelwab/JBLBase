import { expect, test } from "vitest";
import { MAIN_OWNER, repertoireOwner } from "../repertoires";

test("the main user is recognised in any letter case", () => {
    expect(repertoireOwner("jannick")).toBe(MAIN_OWNER);
    expect(repertoireOwner(" Jannick ")).toBe(MAIN_OWNER);
    expect(repertoireOwner(undefined)).toBe(MAIN_OWNER);
    expect(repertoireOwner("")).toBe(MAIN_OWNER);
    expect(repertoireOwner(" Aaron ")).toBe("Aaron");
});
