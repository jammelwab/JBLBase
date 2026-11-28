// Security rule tests. Run with `npm run test:rules` (starts the Firestore
// emulator, needs Java).
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, test } from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  Bytes,
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

const FEN = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq";

let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-jblbase",
    firestore: {
      rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"),
    },
  });
});

after(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  // The allowlist: alice and bob by e-mail, carla by Lichess name.
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "config/access"), {
      emails: ["alice@example.org", "bob@example.org"],
      lichess: ["carla"],
    });
  });
});

const user = (uid = "alice") =>
  env.authenticatedContext(uid, { email: `${uid}@Example.org`, email_verified: true }).firestore();
const admin = (uid = "boss") => env.authenticatedContext(uid, { admin: true }).firestore();
const anon = () => env.unauthenticatedContext().firestore();
// A normal user with single permissions (1.2.35), e.g. { deepEvals: true }.
const withPerms = (perms, uid = "alice") =>
  env
    .authenticatedContext(uid, { email: `${uid}@example.org`, email_verified: true, perms })
    .firestore();

function evalDoc({ depth = 20, mate, lines } = {}) {
  const first = { multipv: 1, depth, nodes: 1000, nps: 1000, uci: ["e7e5", "g1f3"] };
  if (mate !== undefined) first.mate = mate;
  else first.cp = -25;
  return {
    position: FEN,
    engine: "Stockfish 17",
    depth,
    multipv: 1,
    lines: lines ?? [first],
    updatedAt: serverTimestamp(),
  };
}

function repertoireDoc(over = {}) {
  return {
    path: "Weiß/e4",
    info: '{"type":"repertoire"}',
    pgn: "1. e4 e5 *",
    hash: "a".repeat(64),
    updatedAt: 1,
    deleted: false,
    syncedAt: serverTimestamp(),
    ...over,
  };
}

function cardDoc(over = {}) {
  return {
    deck: "rep1",
    position: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -",
    fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
    answer: "e5",
    card: "{}",
    ord: 0,
    updatedAt: 1,
    deleted: false,
    syncedAt: serverTimestamp(),
    ...over,
  };
}

function reviewDoc(over = {}) {
  return {
    deck: "rep1",
    fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
    log: "{}",
    reviewedAt: 1,
    syncedAt: serverTimestamp(),
    ...over,
  };
}

function consentDoc(over = {}) {
  return {
    terms: "2026-11-10",
    privacy: "2026-11-10",
    method: "register",
    ageConfirmed: true,
    appVersion: "1.0.14",
    acceptedAt: serverTimestamp(),
    ...over,
  };
}

describe("private cloud (allowlist)", () => {
  test("listed and confirmed e-mail accounts get in", async () => {
    await assertSucceeds(setDoc(doc(user("alice"), "users/alice"), { chesscom: "a" }));
  });

  test("accounts that are not listed are locked out", async () => {
    await assertFails(setDoc(doc(user("eve"), "users/eve"), { chesscom: "e" }));
    await assertFails(getDoc(doc(user("eve"), "users/eve")));
    await assertFails(getDoc(doc(user("eve"), "evals/e1")));
  });

  test("an unconfirmed e-mail address does not count", async () => {
    const db = env
      .authenticatedContext("alice", { email: "alice@example.org", email_verified: false })
      .firestore();
    await assertFails(setDoc(doc(db, "users/alice"), { chesscom: "a" }));
  });

  test("listed Lichess accounts get in, case does not matter", async () => {
    const db = env.authenticatedContext("lichess:carla", { lichess: "Carla" }).firestore();
    await assertSucceeds(setDoc(doc(db, "users/lichess:carla"), { lichess: "Carla" }));
    const other = env.authenticatedContext("lichess:dave", { lichess: "Dave" }).firestore();
    await assertFails(setDoc(doc(other, "users/lichess:dave"), { lichess: "Dave" }));
  });

  test("admins need no entry, and nobody reads or writes the list", async () => {
    await assertSucceeds(setDoc(doc(admin(), "users/boss"), { chesscom: "b" }));
    await assertFails(getDoc(doc(user("alice"), "config/access")));
    await assertFails(setDoc(doc(admin(), "config/access"), { emails: [] }));
  });
});

describe("consent records", () => {
  const id = "2026-11-10_2026-11-10";

  test("the owner records an agreement once and can read it", async () => {
    const db = user("alice");
    await assertSucceeds(setDoc(doc(db, `users/alice/consents/${id}`), consentDoc()));
    await assertSucceeds(getDoc(doc(db, `users/alice/consents/${id}`)));
    await assertFails(getDoc(doc(user("bob"), `users/alice/consents/${id}`)));
    await assertFails(setDoc(doc(user("bob"), `users/alice/consents/${id}`), consentDoc()));
  });

  test("an agreement cannot be changed afterwards", async () => {
    const db = user("alice");
    await assertSucceeds(setDoc(doc(db, `users/alice/consents/${id}`), consentDoc()));
    await assertFails(
      setDoc(doc(db, `users/alice/consents/${id}`), consentDoc({ method: "update" })),
    );
  });

  test("an agreement must be complete and match its id", async () => {
    const db = user("alice");
    const ref = doc(db, `users/alice/consents/${id}`);
    await assertFails(setDoc(ref, consentDoc({ ageConfirmed: false })));
    await assertFails(setDoc(ref, consentDoc({ acceptedAt: 5 })));
    await assertFails(setDoc(ref, consentDoc({ method: "other" })));
    await assertFails(setDoc(ref, consentDoc({ extra: 1 })));
    await assertFails(setDoc(doc(db, "users/alice/consents/old_old"), consentDoc()));
  });
});

describe("own area", () => {
  test("a user reads and writes only below users/{uid}", async () => {
    const db = user("alice");
    await assertSucceeds(setDoc(doc(db, "users/alice"), { chesscom: "someone" }));
    await assertSucceeds(getDoc(doc(db, "users/alice")));
    await assertSucceeds(setDoc(doc(db, "users/alice/repertoires/r1"), repertoireDoc()));
    await assertSucceeds(setDoc(doc(db, "users/alice/repertoires/r1/moves/m1"), { uci: "e2e4" }));
    await assertSucceeds(setDoc(doc(db, "users/alice/cards/c1"), cardDoc()));

    await assertFails(getDoc(doc(db, "users/bob")));
    await assertFails(setDoc(doc(db, "users/bob/repertoires/r1"), repertoireDoc()));
    await assertFails(getDoc(doc(db, "users/bob/evals/e1")));
  });

  test("signed-out access is denied everywhere", async () => {
    const db = anon();
    await assertFails(getDoc(doc(db, "users/alice")));
    await assertFails(getDoc(doc(db, "evals/e1")));
  });

  test("the profile cannot carry a role", async () => {
    const db = user("alice");
    await assertFails(setDoc(doc(db, "users/alice"), { admin: true }));
    await assertFails(setDoc(doc(db, "users/alice"), { role: "admin" }));
  });

  test("reviews are append-only", async () => {
    const db = user("alice");
    await assertSucceeds(setDoc(doc(db, "users/alice/reviews/r1"), reviewDoc()));
    // Uploading the same review again is fine, changing it is not.
    await assertSucceeds(setDoc(doc(db, "users/alice/reviews/r1"), reviewDoc()));
    await assertFails(setDoc(doc(db, "users/alice/reviews/r1"), reviewDoc({ log: "{}x" })));
    await assertFails(setDoc(doc(db, "users/alice/reviews/r2"), { rating: 3 }));
  });

  test("synced documents must have the expected shape", async () => {
    const db = user("alice");
    await assertFails(setDoc(doc(db, "users/alice/repertoires/r1"), { name: "White" }));
    await assertFails(
      setDoc(doc(db, "users/alice/repertoires/r1"), repertoireDoc({ pgn: "x".repeat(900001) })),
    );
    await assertFails(
      setDoc(doc(db, "users/alice/repertoires/r1"), repertoireDoc({ syncedAt: 5 })),
    );
    // Big files go compressed: bytes instead of text, never both, never neither.
    const gz = Bytes.fromUint8Array(new Uint8Array(1000));
    const { pgn: _pgn, ...noPgn } = repertoireDoc();
    await assertSucceeds(setDoc(doc(db, "users/alice/repertoires/r1"), { ...noPgn, pgnGz: gz }));
    await assertFails(setDoc(doc(db, "users/alice/repertoires/r1"), noPgn));
    await assertFails(setDoc(doc(db, "users/alice/repertoires/r1"), repertoireDoc({ pgnGz: gz })));
    await assertFails(setDoc(doc(db, "users/alice/repertoires/r1"), { ...noPgn, pgnGz: "x" }));
    await assertFails(
      setDoc(doc(db, "users/alice/repertoires/r1"), {
        ...noPgn,
        pgnGz: Bytes.fromUint8Array(new Uint8Array(900001)),
      }),
    );
    await assertFails(setDoc(doc(db, "users/alice/cards/c1"), { due: 1 }));
    await assertFails(setDoc(doc(db, "users/alice/cards/c1"), cardDoc({ extra: true })));
  });

  test("unknown collections are closed", async () => {
    const db = user("alice");
    await assertFails(setDoc(doc(db, "users/alice/other/x"), { a: 1 }));
    await assertFails(setDoc(doc(db, "anything/x"), { a: 1 }));
  });
});

describe("own evaluations", () => {
  test("users store up to depth 28", async () => {
    const db = user("alice");
    await assertSucceeds(setDoc(doc(db, "users/alice/evals/e1"), evalDoc({ depth: 28 })));
    await assertFails(setDoc(doc(db, "users/alice/evals/e2"), evalDoc({ depth: 29 })));
  });

  test("mates are always allowed", async () => {
    const db = user("alice");
    await assertSucceeds(setDoc(doc(db, "users/alice/evals/e1"), evalDoc({ depth: 245, mate: 3 })));
  });

  test("admins have no depth limit", async () => {
    const db = admin("boss");
    await assertSucceeds(setDoc(doc(db, "users/boss/evals/e1"), evalDoc({ depth: 45 })));
  });

  test("a line deeper than the document depth is rejected", async () => {
    const db = user("alice");
    const deep = { multipv: 1, depth: 40, cp: 10, uci: ["e7e5"] };
    await assertFails(
      setDoc(doc(db, "users/alice/evals/e1"), evalDoc({ depth: 20, lines: [deep] })),
    );
  });

  test("malformed evaluations are rejected", async () => {
    const db = user("alice");
    const bad = evalDoc();
    bad.extra = "x";
    await assertFails(setDoc(doc(db, "users/alice/evals/e1"), bad));
    await assertFails(setDoc(doc(db, "users/alice/evals/e2"), { ...evalDoc(), depth: "20" }));
    await assertFails(
      setDoc(doc(db, "users/alice/evals/e3"), { ...evalDoc(), updatedAt: new Date(0) }),
    );
    await assertFails(setDoc(doc(db, "users/alice/evals/e4"), { ...evalDoc(), lines: [] }));
  });
});

describe("shared position store", () => {
  test("every signed-in user reads", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "evals/e1"), { position: FEN });
    });
    await assertSucceeds(getDoc(doc(user("alice"), "evals/e1")));
  });

  test("only admins write", async () => {
    await assertFails(setDoc(doc(user("alice"), "evals/e1"), evalDoc({ depth: 20 })));
    await assertSucceeds(setDoc(doc(admin(), "evals/e1"), evalDoc({ depth: 50 })));
    await assertFails(deleteDoc(doc(user("alice"), "evals/e1")));
    await assertSucceeds(deleteDoc(doc(admin(), "evals/e1")));
  });

  test("admins must still write valid documents", async () => {
    await assertFails(setDoc(doc(admin(), "evals/e1"), { position: FEN }));
  });
});

describe("roles and permissions (1.2.35)", () => {
  test("deepEvals lifts the depth limit, other permissions do not", async () => {
    await assertSucceeds(
      setDoc(doc(withPerms({ deepEvals: true }), "users/alice/evals/e1"), evalDoc({ depth: 45 })),
    );
    await assertFails(
      setDoc(doc(withPerms({ coachTest: true }), "users/alice/evals/e2"), evalDoc({ depth: 45 })),
    );
    await assertFails(
      setDoc(doc(withPerms({ deepEvals: "yes" }), "users/alice/evals/e3"), evalDoc({ depth: 45 })),
    );
  });

  test("sharedEvals writes to the shared store within the depth limit", async () => {
    const db = withPerms({ sharedEvals: true });
    await assertSucceeds(setDoc(doc(db, "evals/e1"), evalDoc({ depth: 28 })));
    await assertFails(setDoc(doc(db, "evals/e2"), evalDoc({ depth: 40 })));
    await assertFails(deleteDoc(doc(db, "evals/e1")));
    const deep = withPerms({ sharedEvals: true, deepEvals: true });
    await assertSucceeds(setDoc(doc(deep, "evals/e2"), evalDoc({ depth: 40 })));
    await assertFails(setDoc(doc(deep, "evals/e3"), { position: FEN }));
  });

  test("permissions need a place on the allowlist", async () => {
    const db = withPerms({ sharedEvals: true }, "mallory");
    await assertFails(setDoc(doc(db, "evals/e1"), evalDoc({ depth: 20 })));
  });

  test("nobody writes roles, owners and admins read them", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "roles/alice"), { admin: false, perms: {} });
    });
    await assertSucceeds(getDoc(doc(user("alice"), "roles/alice")));
    await assertSucceeds(getDoc(doc(admin(), "roles/alice")));
    await assertFails(getDoc(doc(user("bob"), "roles/alice")));
    await assertFails(
      setDoc(doc(user("alice"), "roles/alice"), { admin: true, perms: { deepEvals: true } }),
    );
    await assertFails(setDoc(doc(admin(), "roles/bob"), { admin: true, perms: {} }));
    await assertFails(setDoc(doc(user("alice"), "users/alice"), { perms: { deepEvals: true } }));
  });
});

describe("usage and limits (#114)", () => {
  const counts = { repertoires: { reads: 3, writes: 1 } };

  test("users write their own usage per day", async () => {
    await assertSucceeds(
      setDoc(doc(user(), "users/alice/usage/2026-11-17"), {
        dev1: counts,
        updatedAt: serverTimestamp(),
      }),
    );
    await assertSucceeds(getDoc(doc(user(), "users/alice/usage/2026-11-17")));
    await assertFails(getDoc(doc(user("bob"), "users/alice/usage/2026-11-17")));
    await assertFails(
      setDoc(doc(user("bob"), "users/alice/usage/2026-11-17"), {
        dev1: counts,
        updatedAt: serverTimestamp(),
      }),
    );
  });

  test("usage documents are bounded", async () => {
    // Not a date as id.
    await assertFails(
      setDoc(doc(user(), "users/alice/usage/today"), {
        dev1: counts,
        updatedAt: serverTimestamp(),
      }),
    );
    // No server time.
    await assertFails(
      setDoc(doc(user(), "users/alice/usage/2026-11-17"), { dev1: counts, updatedAt: 1 }),
    );
    // Too many fields.
    const many = { updatedAt: serverTimestamp() };
    for (let i = 0; i < 20; i++) many[`dev${i}`] = counts;
    await assertFails(setDoc(doc(user(), "users/alice/usage/2026-11-17"), many));
  });

  test("members read the limits, nobody writes them", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "config/limits"), { evalReads: 10 });
    });
    await assertSucceeds(getDoc(doc(user(), "config/limits")));
    await assertFails(getDoc(doc(anon(), "config/limits")));
    await assertFails(getDoc(doc(user("mallory"), "config/limits")));
    await assertFails(setDoc(doc(user(), "config/limits"), { evalReads: 1e9 }));
    await assertFails(setDoc(doc(admin(), "config/limits"), { evalReads: 1e9 }));
    // The allowlist stays unreadable.
    await assertFails(getDoc(doc(user(), "config/access")));
  });

  test("admins read everyone's usage and the allowlist (#116)", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, "users/alice/usage/2026-11-20"), { dev1: counts });
      await setDoc(doc(db, "users/bob/usage/2026-11-20"), { dev1: counts });
      await setDoc(doc(db, "config/access"), { emails: ["alice@example.org"] });
    });
    const all = await assertSucceeds(getDocs(collectionGroup(admin(), "usage")));
    if (all.size !== 2) throw new Error(`expected 2 usage docs, got ${all.size}`);
    await assertSucceeds(getDoc(doc(admin(), "users/bob/usage/2026-11-20")));
    await assertSucceeds(getDoc(doc(admin(), "config/access")));
    await assertFails(getDocs(collectionGroup(user(), "usage")));
    await assertFails(getDocs(collectionGroup(anon(), "usage")));
    await assertFails(getDoc(doc(user(), "users/bob/usage/2026-11-20")));
    // Reading does not allow writing.
    await assertFails(setDoc(doc(admin(), "users/bob/usage/2026-11-20"), { dev1: counts }));
    await assertFails(setDoc(doc(admin(), "config/access"), { emails: [] }));
  });
});

function shareDoc(over = {}) {
  return {
    ownerUid: "alice",
    ownerName: "Alice",
    recipientKey: "email:bob@example.org",
    sourceId: "rep1",
    name: "Alice Weiß",
    color: "white",
    pgn: "1. e4 *",
    hash: "h1",
    status: "pending",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...over,
  };
}

const carla = () => env.authenticatedContext("lichess:carla", { lichess: "Carla" }).firestore();

describe("shared repertoires (#120)", () => {
  test("a member shares a repertoire with one address", async () => {
    await assertSucceeds(setDoc(doc(user(), "shares/s1"), shareDoc()));
    await assertSucceeds(
      setDoc(doc(user(), "shares/s2"), shareDoc({ recipientKey: "lichess:carla" })),
    );
    // Not in someone else's name, not already accepted, no extra fields.
    await assertFails(setDoc(doc(user(), "shares/s3"), shareDoc({ ownerUid: "bob" })));
    await assertFails(setDoc(doc(user(), "shares/s4"), shareDoc({ status: "accepted" })));
    await assertFails(setDoc(doc(user(), "shares/s5"), shareDoc({ games: [] })));
    await assertFails(setDoc(doc(user(), "shares/s6"), shareDoc({ recipientKey: "bob" })));
    // Text and bytes together are refused, as is no content at all.
    await assertFails(
      setDoc(
        doc(user(), "shares/s7"),
        shareDoc({ pgnGz: Bytes.fromUint8Array(new Uint8Array(4)) }),
      ),
    );
    const { pgn, ...empty } = shareDoc();
    await assertFails(setDoc(doc(user(), "shares/s8"), empty));
    // Accounts outside the allowlist cannot share.
    await assertFails(setDoc(doc(user("eve"), "shares/s9"), shareDoc({ ownerUid: "eve" })));
  });

  test("only the owner and the recipient can read it", async () => {
    await assertSucceeds(setDoc(doc(user(), "shares/s1"), shareDoc()));
    await assertSucceeds(getDoc(doc(user("alice"), "shares/s1")));
    await assertSucceeds(getDoc(doc(user("bob"), "shares/s1")));
    await assertFails(getDoc(doc(carla(), "shares/s1")));
    await assertFails(getDoc(doc(anon(), "shares/s1")));
    // An unconfirmed address is not the recipient.
    const unconfirmed = env
      .authenticatedContext("bob2", { email: "bob@example.org", email_verified: false })
      .firestore();
    await assertFails(getDoc(doc(unconfirmed, "shares/s1")));
    // Queries must name the own uid or address.
    const shares = (db) => collection(db, "shares");
    await assertSucceeds(getDocs(query(shares(user("alice")), where("ownerUid", "==", "alice"))));
    await assertSucceeds(
      getDocs(query(shares(user("bob")), where("recipientKey", "==", "email:bob@example.org"))),
    );
    await assertFails(getDocs(shares(user("bob"))));
    await assertFails(getDocs(query(shares(carla()), where("ownerUid", "==", "alice"))));
  });

  test("the owner sends new versions, the recipient only accepts", async () => {
    await assertSucceeds(setDoc(doc(user(), "shares/s1"), shareDoc()));
    const next = { pgn: "1. d4 *", hash: "h2", updatedAt: serverTimestamp() };
    await assertSucceeds(updateDoc(doc(user("alice"), "shares/s1"), next));
    await assertFails(updateDoc(doc(user("bob"), "shares/s1"), next));
    // The owner cannot accept for the recipient or move the share.
    await assertFails(updateDoc(doc(user("alice"), "shares/s1"), { status: "accepted" }));
    await assertFails(
      updateDoc(doc(user("alice"), "shares/s1"), { recipientKey: "email:eve@example.org" }),
    );
    // The recipient accepts once, for the own account.
    await assertFails(
      updateDoc(doc(user("bob"), "shares/s1"), { status: "accepted", recipientUid: "alice" }),
    );
    await assertSucceeds(
      updateDoc(doc(user("bob"), "shares/s1"), { status: "accepted", recipientUid: "bob" }),
    );
    await assertFails(
      updateDoc(doc(user("bob"), "shares/s1"), { status: "accepted", recipientUid: "bob" }),
    );
    // Others cannot accept.
    await assertSucceeds(setDoc(doc(user(), "shares/s2"), shareDoc()));
    await assertFails(
      updateDoc(doc(carla(), "shares/s2"), {
        status: "accepted",
        recipientUid: "lichess:carla",
      }),
    );
  });

  test("owner and recipient can end it, nobody else", async () => {
    await assertSucceeds(setDoc(doc(user(), "shares/s1"), shareDoc()));
    await assertSucceeds(setDoc(doc(user(), "shares/s2"), shareDoc()));
    await assertFails(deleteDoc(doc(carla(), "shares/s1")));
    await assertSucceeds(deleteDoc(doc(user("alice"), "shares/s1")));
    await assertSucceeds(deleteDoc(doc(user("bob"), "shares/s2")));
  });
});

describe("JBL Coach (1.2.4)", () => {
  const coachDoc = (over = {}) => ({
    xpByDevice: { d1: 120 },
    sets: { trophies: ["firstWin"], items: [], frames: [], titles: [] },
    streak: { last: "2026-11-21", days: 3, bridgedWeek: null },
    best: 1350,
    bundle: { lock: 0, outfit: ["scarf"] },
    bundleAt: 1,
    updatedAt: serverTimestamp(),
    ...over,
  });

  test("the coach state is the player's own", async () => {
    const db = user("alice");
    await assertSucceeds(setDoc(doc(db, "users/alice/coach/state"), coachDoc()));
    await assertSucceeds(getDoc(doc(db, "users/alice/coach/state")));
    await assertFails(getDoc(doc(user("bob"), "users/alice/coach/state")));
    await assertFails(setDoc(doc(user("bob"), "users/alice/coach/state"), coachDoc()));
  });

  test("the coach state has a fixed shape", async () => {
    const db = user("alice");
    await assertFails(setDoc(doc(db, "users/alice/coach/other"), coachDoc()));
    await assertFails(setDoc(doc(db, "users/alice/coach/state"), coachDoc({ role: "admin" })));
    await assertFails(setDoc(doc(db, "users/alice/coach/state"), coachDoc({ updatedAt: 5 })));
    await assertFails(setDoc(doc(db, "users/alice/coach/state"), coachDoc({ xpByDevice: 5 })));
  });

  test("the coach profile is read-only for the player", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "coachProfiles/alice"), {
        birthday: "11-21",
        eggs: ["aaron"],
      });
    });
    await assertSucceeds(getDoc(doc(user("alice"), "coachProfiles/alice")));
    await assertFails(getDoc(doc(user("bob"), "coachProfiles/alice")));
    await assertFails(
      setDoc(doc(user("alice"), "coachProfiles/alice"), { birthday: "01-01", eggs: [] }),
    );
  });
});

describe("JBL Coach: Boss und Duell (1.2.7)", () => {
  const rivals = async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "coachProfiles/alice"), { eggs: ["aaron"], rival: "bob" });
      await setDoc(doc(ctx.firestore(), "coachProfiles/bob"), { eggs: ["ben"], rival: "alice" });
    });
  };
  const duel = (over = {}) => ({
    players: ["alice", "bob"],
    white: "alice",
    black: "bob",
    names: { alice: "Aaron", bob: "Ben" },
    moves: [],
    result: "*",
    reason: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...over,
  });

  test("members read the boss book, only admins write it", async () => {
    const book = { moves: ["epd|e2e4|1000"], count: 1, updatedAt: serverTimestamp() };
    await assertSucceeds(setDoc(doc(admin(), "bossBook/main"), book));
    await assertSucceeds(getDoc(doc(user(), "bossBook/main")));
    await assertFails(getDoc(doc(user("mallory"), "bossBook/main")));
    await assertFails(setDoc(doc(user(), "bossBook/main"), book));
    await assertFails(setDoc(doc(admin(), "bossBook/other"), book));
    await assertFails(setDoc(doc(admin(), "bossBook/main"), { ...book, extra: 1 }));
  });

  test("only the rival reads the level", async () => {
    await rivals();
    const level = { level: 7, xp: 900, name: "Aaron", updatedAt: serverTimestamp() };
    await assertSucceeds(setDoc(doc(user("alice"), "coachRivals/alice"), level));
    await assertSucceeds(getDoc(doc(user("bob"), "coachRivals/alice")));
    await assertFails(getDoc(doc(user("carla"), "coachRivals/alice")));
    await assertFails(setDoc(doc(user("bob"), "coachRivals/alice"), level));
    await assertFails(setDoc(doc(user("alice"), "coachRivals/alice"), { ...level, level: "7" }));
  });

  test("duels only between rivals, one move at a time", async () => {
    await rivals();
    await assertSucceeds(setDoc(doc(user("alice"), "duels/d1"), duel()));
    await assertFails(
      setDoc(
        doc(user("carla"), "duels/d2"),
        duel({ players: ["carla", "alice"], white: "carla", black: "alice" }),
      ),
    );
    await assertFails(setDoc(doc(user("alice"), "duels/d3"), duel({ moves: ["e2e4"] })));
    await assertSucceeds(getDoc(doc(user("bob"), "duels/d1")));
    await assertFails(getDoc(doc(user("carla"), "duels/d1")));
    const bobs = await assertSucceeds(
      getDocs(query(collection(user("bob"), "duels"), where("players", "array-contains", "bob"))),
    );
    if (bobs.size !== 1) throw new Error(`expected 1 duel, got ${bobs.size}`);
    await assertSucceeds(
      updateDoc(doc(user("alice"), "duels/d1"), { moves: ["e2e4"], updatedAt: serverTimestamp() }),
    );
    await assertFails(
      updateDoc(doc(user("bob"), "duels/d1"), {
        moves: ["e2e4", "e7e5", "g1f3"],
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(doc(user("bob"), "duels/d1"), { white: "bob", updatedAt: serverTimestamp() }),
    );
    await assertSucceeds(
      updateDoc(doc(user("bob"), "duels/d1"), {
        result: "1-0",
        reason: "resign",
        updatedAt: serverTimestamp(),
      }),
    );
    // Fertig ist fertig
    await assertFails(
      updateDoc(doc(user("bob"), "duels/d1"), { result: "*", updatedAt: serverTimestamp() }),
    );
  });
});

describe("JBL Coach: Warum? (1.2.9)", () => {
  test("explanations and the daily count belong to the function alone", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "coachExplanations/k1"), { text: "Gut." });
      await setDoc(doc(ctx.firestore(), "coachExplainUsage/alice"), {
        day: "2026-11-21",
        count: 1,
      });
    });
    await assertFails(getDoc(doc(user(), "coachExplanations/k1")));
    await assertFails(setDoc(doc(user(), "coachExplanations/k2"), { text: "Frei erfunden." }));
    await assertFails(getDoc(doc(admin(), "coachExplanations/k1")));
    await assertFails(
      setDoc(doc(user(), "coachExplainUsage/alice"), { day: "2026-11-21", count: 0 }),
    );
  });
});
