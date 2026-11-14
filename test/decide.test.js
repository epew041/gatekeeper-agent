import assert from "node:assert/strict";
import test from "node:test";
import { decide, MalformedTaskError, REASON_CODES } from "../src/decide.js";
import {
  OTHER_RECIPIENT,
  OTHER_VK_HASH,
  RECIPIENT,
  makeTask,
} from "./fixtures.js";

test("valid condition approves and is provable", () => {
  const d = decide(makeTask());
  assert.equal(d.decision, "APPROVE");
  assert.equal(d.reasonCode, REASON_CODES.VALID);
  assert.equal(d.approved, true);
  assert.equal(d.provable, true);
  assert.equal(d.circuitInput.decision, "1");
});

test("wrong VK rejects with VK_SUBSTITUTION and stays provable (decision 0)", () => {
  const d = decide(makeTask({ input: { proof_vk: OTHER_VK_HASH } }));
  assert.equal(d.decision, "REJECT");
  assert.equal(d.reasonCode, REASON_CODES.VK_SUBSTITUTION);
  assert.equal(d.provable, true);
  assert.equal(d.circuitInput.decision, "0");
});

test("below-threshold balance rejects with THRESHOLD_MISMATCH", () => {
  const d = decide(makeTask({ input: { public_balance: "999" } }));
  assert.equal(d.decision, "REJECT");
  assert.equal(d.reasonCode, REASON_CODES.THRESHOLD_MISMATCH);
});

test("wrong recipient rejects with RECIPIENT_MISMATCH", () => {
  const d = decide(makeTask({ input: { recipient: OTHER_RECIPIENT } }));
  assert.equal(d.decision, "REJECT");
  assert.equal(d.reasonCode, REASON_CODES.RECIPIENT_MISMATCH);
});

test("replayed proof ref rejects with PROOF_REUSED and is NOT provable", () => {
  const d = decide(makeTask(), { isProofRefSeen: () => true });
  assert.equal(d.decision, "REJECT");
  assert.equal(d.reasonCode, REASON_CODES.PROOF_REUSED);
  assert.equal(d.provable, false);
  assert.equal(d.circuitInput, null);
});

test("expired condition rejects with EXPIRED_CONDITION", () => {
  const d = decide(makeTask({ input: { current_block: 19842202 } }));
  assert.equal(d.decision, "REJECT");
  assert.equal(d.reasonCode, REASON_CODES.EXPIRED_CONDITION);
});

test("current block EQUAL to expiry is expired (strict)", () => {
  const d = decide(makeTask({ input: { current_block: 19842201 } }));
  assert.equal(d.decision, "REJECT");
  assert.equal(d.reasonCode, REASON_CODES.EXPIRED_CONDITION);
});

test("amount overflow rejects with AMOUNT_OVERFLOW", () => {
  const d = decide(makeTask({ input: { amount: "1001" } }));
  assert.equal(d.decision, "REJECT");
  assert.equal(d.reasonCode, REASON_CODES.AMOUNT_OVERFLOW);
});

test("boundary equalities approve: balance == minimum, amount == cap", () => {
  const d = decide(
    makeTask({ input: { public_balance: "1000", amount: "1000" } })
  );
  assert.equal(d.decision, "APPROVE");
});

test("checksummed vs lowercase recipient spellings compare equal", () => {
  const d = decide(
    makeTask({ input: { recipient: RECIPIENT.toUpperCase().replace("0X", "0x") } })
  );
  assert.equal(d.decision, "APPROVE");
});

test("reuse takes precedence over a VK mismatch", () => {
  const d = decide(makeTask({ input: { proof_vk: OTHER_VK_HASH } }), {
    isProofRefSeen: () => true,
  });
  assert.equal(d.reasonCode, REASON_CODES.PROOF_REUSED);
});

test("malformed fields fail closed with mapped codes", () => {
  assert.equal(
    decide(makeTask({ input: { proof_vk: "not-hex!!!" } })).reasonCode,
    REASON_CODES.VK_SUBSTITUTION
  );
  assert.equal(
    decide(makeTask({ input: { public_balance: "lots" } })).reasonCode,
    REASON_CODES.THRESHOLD_MISMATCH
  );
  assert.equal(
    decide(makeTask({ input: { recipient: 123.5 } })).reasonCode,
    REASON_CODES.RECIPIENT_MISMATCH
  );
  assert.equal(
    decide(makeTask({ input: { amount: null } })).reasonCode,
    REASON_CODES.AMOUNT_OVERFLOW
  );
  assert.equal(
    decide(makeTask({ input: { expiry_block: "soon" } })).reasonCode,
    REASON_CODES.EXPIRED_CONDITION
  );
});

test("missing proof_tx fails closed as a proof-identity failure", () => {
  const task = makeTask();
  delete task.input.proof_tx;
  const d = decide(task);
  assert.equal(d.decision, "REJECT");
  assert.equal(d.reasonCode, REASON_CODES.VK_SUBSTITUTION);
});

test("missing task_id / input throws MalformedTaskError", () => {
  assert.throws(() => decide({}), MalformedTaskError);
  assert.throws(() => decide({ task_id: "x" }), MalformedTaskError);
  assert.throws(() => decide(null), MalformedTaskError);
});
