import { describe, expect, test } from "vitest";
import {
    accountLevel,
    can,
    filterUsers,
    parseAdminUsers,
    parsePerms,
    rolesNewerThanToken,
} from "../cloud/permissions";

describe("permissions (1.2.31)", () => {
    test("only known permissions set to true count", () => {
        expect(parsePerms({ deepEvals: true, coachTest: false, root: true })).toEqual({
            deepEvals: true,
        });
        expect(parsePerms(["deepEvals"])).toEqual({});
        expect(parsePerms(undefined)).toEqual({});
    });

    test("admins can everything, users only what they got", () => {
        expect(can({ role: "admin", perms: {} }, "sharedEvals")).toBe(true);
        expect(can({ role: "user", perms: { sharedEvals: true } }, "sharedEvals")).toBe(true);
        expect(can({ role: "user", perms: { sharedEvals: true } }, "deepEvals")).toBe(false);
        expect(can(null, "deepEvals")).toBe(false);
        expect(can(undefined, "deepEvals")).toBe(false);
    });

    test("three levels", () => {
        expect(accountLevel({ role: "admin", perms: {} })).toBe("admin");
        expect(accountLevel({ admin: true, perms: {} })).toBe("admin");
        expect(accountLevel({ role: "user", perms: { coachTest: true } })).toBe("extended");
        expect(accountLevel({ role: "user", perms: {} })).toBe("user");
    });

    test("parses the account list and searches it", () => {
        const users = parseAdminUsers({
            users: [
                { uid: "u1", email: "Aaron@example.org", name: "Aaron", perms: { noLimits: true } },
                { uid: "lichess:carla", method: "lichess", name: "Carla", admin: true },
                { email: "no uid" },
                null,
            ],
        });
        expect(users).toHaveLength(2);
        expect(users[0].perms).toEqual({ noLimits: true });
        expect(users[1].method).toBe("lichess");
        expect(filterUsers(users, "aaron").map((u) => u.uid)).toEqual(["u1"]);
        expect(filterUsers(users, "lichess:").map((u) => u.uid)).toEqual(["lichess:carla"]);
        expect(filterUsers(users, " ")).toHaveLength(2);
        expect(parseAdminUsers(null)).toEqual([]);
    });

    test("refresh the token only when the roles are newer", () => {
        expect(rolesNewerThanToken(2000, 1000)).toBe(true);
        expect(rolesNewerThanToken(1000, 2000)).toBe(false);
        expect(rolesNewerThanToken(null, 0)).toBe(false);
    });
});
