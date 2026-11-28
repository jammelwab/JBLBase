import assert from "node:assert/strict";
import { test } from "node:test";
import { nextClaims, onAllowlist, parseRoleChange, permsOf, toAdminUser } from "./roles.js";

test("reads only known permissions set to true", () => {
    assert.deepEqual(permsOf({ perms: { deepEvals: true, coachTest: false, root: true } }), {
        deepEvals: true,
    });
    assert.deepEqual(permsOf({ perms: ["deepEvals"] }), {});
    assert.deepEqual(permsOf(undefined), {});
});

test("accepts a valid role change", () => {
    assert.deepEqual(
        parseRoleChange({ uid: "u1", admin: false, perms: { deepEvals: true, noLimits: false } }),
        { uid: "u1", admin: false, perms: { deepEvals: true } },
    );
});

test("rejects unknown permissions and broken requests", () => {
    assert.equal(parseRoleChange(null), null);
    assert.equal(parseRoleChange({ uid: "u1", admin: false, perms: { root: true } }), null);
    assert.equal(parseRoleChange({ uid: "u1", admin: "yes", perms: {} }), null);
    assert.equal(parseRoleChange({ uid: "", admin: false, perms: {} }), null);
    assert.equal(parseRoleChange({ uid: "u1", admin: false, perms: { deepEvals: 1 } }), null);
    assert.equal(parseRoleChange({ uid: "u1", admin: false, perms: [] }), null);
});

test("keeps other claims and drops empty roles", () => {
    assert.deepEqual(
        nextClaims({ admin: true, perms: { coachTest: true }, x: 1 }, { admin: false, perms: {} }),
        {
            x: 1,
        },
    );
    assert.deepEqual(nextClaims(undefined, { admin: true, perms: { deepEvals: true } }), {
        admin: true,
        perms: { deepEvals: true },
    });
});

test("allowlist by confirmed e-mail or Lichess name", () => {
    const access = { emails: ["a@b.de"], lichess: ["Carla"] };
    assert.equal(onAllowlist(access, { email: "A@b.de", emailVerified: true }), true);
    assert.equal(onAllowlist(access, { email: "a@b.de", emailVerified: false }), false);
    assert.equal(onAllowlist(access, { lichess: "carla" }), true);
    assert.equal(onAllowlist(null, { lichess: "carla" }), false);
});

test("builds a user entry", () => {
    const u = toAdminUser(
        {
            uid: "lichess:carla",
            emailVerified: false,
            displayName: "Carla",
            disabled: false,
            customClaims: { perms: { sharedEvals: true } },
            metadata: { creationTime: "c", lastSignInTime: "s", lastRefreshTime: null },
        },
        { lichess: ["carla"] },
    );
    assert.equal(u.method, "lichess");
    assert.equal(u.allowed, true);
    assert.equal(u.admin, false);
    assert.deepEqual(u.perms, { sharedEvals: true });
    assert.equal(u.lastSignIn, "s");
});
