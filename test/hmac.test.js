import assert from "node:assert/strict";
import test from "node:test";
import { hmacSha256Hex, signResponseBody, verifySignature } from "../src/hmac.js";

const SECRET = "test-only-hmac-secret-0123456789abcdef";
const BODY = Buffer.from('{"task_id":"gk_test_001"}', "utf8");

test("sign then verify round-trips", () => {
  const sig = signResponseBody(SECRET, BODY);
  assert.equal(sig, hmacSha256Hex(SECRET, BODY));
  assert.equal(verifySignature(SECRET, BODY, sig), true);
});

test("wrong signature is rejected", () => {
  const sig = signResponseBody(SECRET, BODY);
  const tampered = sig.slice(0, -1) + (sig.endsWith("0") ? "1" : "0");
  assert.equal(verifySignature(SECRET, BODY, tampered), false);
});

test("tampered body is rejected", () => {
  const sig = signResponseBody(SECRET, BODY);
  const other = Buffer.from('{"task_id":"gk_test_002"}', "utf8");
  assert.equal(verifySignature(SECRET, other, sig), false);
});

test("wrong secret is rejected", () => {
  const sig = signResponseBody(SECRET, BODY);
  assert.equal(verifySignature("another-secret", BODY, sig), false);
});

test("sha256= prefixed hex is accepted", () => {
  const sig = `sha256=${signResponseBody(SECRET, BODY)}`;
  assert.equal(verifySignature(SECRET, BODY, sig), true);
});

test("base64 form is accepted", () => {
  const hex = signResponseBody(SECRET, BODY);
  const b64 = Buffer.from(hex, "hex").toString("base64");
  assert.equal(verifySignature(SECRET, BODY, b64), true);
  assert.equal(verifySignature(SECRET, BODY, `sha256=${b64}`), true);
});

test("missing, empty, and garbage signatures are rejected", () => {
  assert.equal(verifySignature(SECRET, BODY, undefined), false);
  assert.equal(verifySignature(SECRET, BODY, ""), false);
  assert.equal(verifySignature(SECRET, BODY, "not-a-signature"), false);
  assert.equal(verifySignature("", BODY, signResponseBody(SECRET, BODY)), false);
});
