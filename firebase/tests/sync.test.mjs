// The repertoire sync against the Firestore emulator, with the real Firestore
// queries of the app (src/utils/cloud/firestoreDocs.ts) and the security
// rules. Run with `npm run test:sync` (bundles the app code, starts the
// emulator, needs Java). Checks #99 (a run without changes reads nothing)
// and #100 (big repertoires go up compressed).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, test } from "node:test";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import * as firestore from "firebase/firestore";
import { MAX_PGN_LENGTH, cloudRepertoires, syncRepertoires } from "./.build/sync.mjs";

let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-jblbase-sync",
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
  await env.withSecurityRulesDisabled(async (ctx) => {
    await firestore.setDoc(firestore.doc(ctx.firestore(), "config/access"), {
      emails: ["alice@example.org"],
      lichess: [],
    });
  });
});

/** One device: files in memory, the cloud through the emulator. */
function device(name) {
  const db = env
    .authenticatedContext("alice", { email: "alice@example.org", email_verified: true })
    .firestore();
  const cloud = cloudRepertoires({ db, firestore }, "alice");
  const files = new Map();
  const meta = new Map();
  let ids = 0;
  let clock = Date.now();
  const d = {
    files,
    meta,
    /** Documents the queries returned (what Firestore bills). */
    reads: 0,
    dir: "/docs",
    file(path, pgn) {
      files.set(path, { info: { type: "repertoire", tags: [] }, pgn, modifiedAt: ++clock });
    },
    async listLocal() {
      return [...files].map(([path, f]) => ({
        file: `/docs/${path}.pgn`,
        path,
        info: f.info,
        pgn: f.pgn,
        modifiedAt: f.modifiedAt,
      }));
    },
    async writeLocal(path, info, pgn) {
      files.set(path, { info, pgn, modifiedAt: ++clock });
      return `/docs/${path}.pgn`;
    },
    async moveLocal(file, path) {
      const from = file.slice(6, -4);
      files.set(path, files.get(from));
      files.delete(from);
      return `/docs/${path}.pgn`;
    },
    async trashLocal(file) {
      files.delete(file.slice(6, -4));
    },
    async setLocalInfo(file, info) {
      files.get(file.slice(6, -4)).info = info;
    },
    async renameDecks() {},
    newId: () => `${name}-${++ids}`,
    now: () => ++clock,
    async fetchChanged(after) {
      const page = await cloud.fetchChanged(after);
      d.reads += page.items.length;
      return page;
    },
    fetchOne: (id) => cloud.fetchOne(id),
    put: (id, state) => cloud.put(id, state),
    async metaGet(key) {
      return meta.get(key) ?? null;
    },
    async metaSet(key, value) {
      if (value === null) meta.delete(key);
      else meta.set(key, value);
    },
  };
  return d;
}

/** A repertoire like "Ich Black": one game with many commented variations. */
function bigRepertoire(targetLength) {
  const moves = ["e4 c5", "Nf3 d6", "d4 cxd4", "Nxd4 Nf6", "Nc3 a6", "Be3 e5", "Nb3 Be6", "f3 Be7"];
  let text = '[Event "Ich Black"]\n[Site "?"]\n[Result "*"]\n\n';
  let i = 0;
  while (text.length < targetLength) {
    const n = (i % moves.length) + 1;
    text += `${n}. ${moves[i % moves.length]} { Variante ${i}: Idee mit ${moves[(i * 7) % moves.length]}, Plan am Damenflügel, [%cal Ge2e4,Rd7d5] } ( ${n}. ${moves[(i + 3) % moves.length]} $1 { Nebenweg ${i * 13} } ) `;
    i++;
  }
  return `${text}*\n`;
}

test("a run without changes in the cloud reads nothing (#99)", async () => {
  const a = device("a");
  const b = device("b");
  for (let i = 0; i < 40; i++) a.file(`Ordner/R${i}`, `1. e4 e5 2. Nf3 { ${i} } *`);
  await syncRepertoires(a, "alice");
  await syncRepertoires(b, "alice");
  assert.equal(b.files.size, 40);

  // 1.0.28 read the last two minutes again on every run: 40 documents each time.
  a.reads = 0;
  await syncRepertoires(a, "alice"); // its own uploads come back once
  assert.equal(a.reads, 40);
  for (const d of [a, b, a, b, a]) {
    d.reads = 0;
    await syncRepertoires(d, "alice");
    assert.equal(d.reads, 0, "nothing new, nothing read");
  }

  // A change is read once on the other device, then not again.
  a.files.get("Ordner/R7").pgn = "1. d4 *";
  a.files.get("Ordner/R7").modifiedAt += 10;
  await syncRepertoires(a, "alice");
  b.reads = 0;
  await syncRepertoires(b, "alice");
  assert.equal(b.reads, 1);
  assert.equal(b.files.get("Ordner/R7").pgn, "1. d4 *");
  b.reads = 0;
  await syncRepertoires(b, "alice");
  assert.equal(b.reads, 0);
});

test("more documents than one query page are all read once (#99)", async () => {
  const a = device("a");
  const b = device("b");
  for (let i = 0; i < 650; i++) a.file(`R${i}`, `1. e4 { ${i} } *`);
  await syncRepertoires(a, "alice");
  await syncRepertoires(b, "alice");
  assert.equal(b.files.size, 650);
  assert.equal(b.reads, 650);
  b.reads = 0;
  await syncRepertoires(b, "alice");
  assert.equal(b.reads, 0);
});

test("a position stored by 1.0.28 is read once more, then nothing (#99)", async () => {
  const a = device("a");
  a.file("W", "1. e4 *");
  await syncRepertoires(a, "alice");
  a.meta.set("repCursor:alice", String(Date.now()));
  a.reads = 0;
  await syncRepertoires(a, "alice");
  assert.equal(a.reads, 1);
  assert.match(a.meta.get("repCursor:alice"), /^\d+\.\d{9}\|/);
  a.reads = 0;
  await syncRepertoires(a, "alice");
  assert.equal(a.reads, 0);
});

test("a 1.26 MB repertoire goes up compressed and arrives intact (#100)", async () => {
  const a = device("a");
  const b = device("b");
  const big = bigRepertoire(1_262_686);
  assert.ok(big.length > MAX_PGN_LENGTH);
  a.file("Ich Black", big);
  a.file("Ich Weiß", bigRepertoire(632_000));
  const result = await syncRepertoires(a, "alice");
  assert.deepEqual(result.tooBig, []);
  assert.equal(result.uploaded, 2);

  await env.withSecurityRulesDisabled(async (ctx) => {
    const docs = await firestore.getDocs(
      firestore.collection(ctx.firestore(), "users/alice/repertoires"),
    );
    const byPath = Object.fromEntries(docs.docs.map((d) => [d.data().path, d.data()]));
    const black = byPath["Ich Black"];
    assert.equal(black.pgn, undefined);
    assert.ok(black.pgnGz instanceof firestore.Bytes);
    console.log(
      `  Ich Black: ${big.length} Zeichen -> ${black.pgnGz.toUint8Array().length} Bytes komprimiert`,
    );
    assert.equal(typeof byPath["Ich Weiß"].pgn, "string");
  });

  await syncRepertoires(b, "alice");
  assert.equal(b.files.get("Ich Black").pgn, big);

  // Changed on the second device: comes back to the first one.
  b.files.get("Ich Black").pgn = `${big}\n`;
  b.files.get("Ich Black").modifiedAt += 10;
  await syncRepertoires(b, "alice");
  await syncRepertoires(a, "alice");
  assert.equal(a.files.get("Ich Black").pgn, `${big}\n`);
});
