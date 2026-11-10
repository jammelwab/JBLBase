// Security rule tests. Run with `npm run test:rules` (starts the Firestore
// emulator, needs Java).
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, test } from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";

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
});

const user = (uid = "alice") => env.authenticatedContext(uid).firestore();
const admin = (uid = "boss") => env.authenticatedContext(uid, { admin: true }).firestore();
const anon = () => env.unauthenticatedContext().firestore();

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
