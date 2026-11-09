import assert from "node:assert/strict";
import { test } from "node:test";
import { lichessUid, parseLichessAccount, parseToken } from "./lichess.js";

test("accepts a lichess token", () => {
    assert.equal(parseToken({ token: " lio_abcdefghijklmnop " }), "lio_abcdefghijklmnop");
});

test("rejects malformed tokens", () => {
    assert.equal(parseToken(null), null);
    assert.equal(parseToken({}), null);
    assert.equal(parseToken({ token: 42 }), null);
    assert.equal(parseToken({ token: "short" }), null);
    assert.equal(parseToken({ token: "lio_abc def ghijklmnop" }), null);
    assert.equal(parseToken({ token: "x".repeat(201) }), null);
});

test("parses a lichess account", () => {
    const account = parseLichessAccount({ id: "magnus_99", username: "Magnus_99", perfs: {} });
    assert.deepEqual(account, { id: "magnus_99", username: "Magnus_99" });
    assert.equal(lichessUid(account!), "lichess:magnus_99");
});

test("rejects broken accounts", () => {
    assert.equal(parseLichessAccount(null), null);
    assert.equal(parseLichessAccount({ id: "a" }), null);
    assert.equal(parseLichessAccount({ id: "Upper", username: "Upper" }), null);
    assert.equal(parseLichessAccount({ id: "someone", username: "other" }), null);
    assert.equal(parseLichessAccount({ id: "a/b", username: "a/b" }), null);
});
