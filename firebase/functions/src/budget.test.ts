import assert from "node:assert/strict";
import { test } from "node:test";
import { budgetExceeded, parseNotification } from "./budget.js";

const encode = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");

test("parses a budget notification", () => {
    const n = parseNotification(encode({ costAmount: 1.5, budgetAmount: 5, currencyCode: "EUR" }));
    assert.equal(n?.costAmount, 1.5);
    assert.equal(n?.budgetAmount, 5);
});

test("ignores broken payloads", () => {
    assert.equal(parseNotification(undefined), null);
    assert.equal(parseNotification(Buffer.from("no json").toString("base64")), null);
    assert.equal(budgetExceeded(null), false);
});

test("below budget keeps billing", () => {
    assert.equal(budgetExceeded({ costAmount: 4.99, budgetAmount: 5 }), false);
    assert.equal(
        budgetExceeded({ costAmount: 4.5, budgetAmount: 5, alertThresholdExceeded: 0.9 }),
        false,
    );
});

test("budget reached stops billing", () => {
    assert.equal(budgetExceeded({ costAmount: 5, budgetAmount: 5 }), true);
    assert.equal(budgetExceeded({ costAmount: 7.2, budgetAmount: 5 }), true);
});

test("missing or invalid amounts never stop billing", () => {
    assert.equal(budgetExceeded({ costAmount: 10 }), false);
    assert.equal(budgetExceeded({ budgetAmount: 5 }), false);
    assert.equal(budgetExceeded({ costAmount: 10, budgetAmount: 0 }), false);
});
