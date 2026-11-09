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

describe("own area", () => {
  test("a user reads and writes only below users/{uid}", async () => {
    const db = user("alice");
    await assertSucceeds(setDoc(doc(db, "users/alice"), { chesscom: "someone" }));
    await assertSucceeds(getDoc(doc(db, "users/alice")));
    await assertSucceeds(setDoc(doc(db, "users/alice/repertoires/r1"), { name: "White" }));
    await assertSucceeds(setDoc(doc(db, "users/alice/repertoires/r1/moves/m1"), { uci: "e2e4" }));
    await assertSucceeds(setDoc(doc(db, "users/alice/cards/c1"), { due: 1 }));

    await assertFails(getDoc(doc(db, "users/bob")));
    await assertFails(setDoc(doc(db, "users/bob/repertoires/r1"), { name: "x" }));
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
    await assertSucceeds(setDoc(doc(db, "users/alice/reviews/r1"), { rating: 3 }));
    await assertFails(setDoc(doc(db, "users/alice/reviews/r1"), { rating: 4 }));
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
