import assert from "node:assert/strict";
import test from "node:test";
import {
  FIELD_PRIME,
  normalizeHex,
  parseFieldValue,
  saltForTask,
  taskIdToField,
  toField,
} from "../src/encode.js";

test("parseFieldValue accepts numbers, decimals, and hex", () => {
  assert.equal(parseFieldValue(42, "f"), 42n);
  assert.equal(parseFieldValue("1460", "f"), 1460n);
  assert.equal(parseFieldValue("0xff", "f"), 255n);
  assert.equal(parseFieldValue("0XFF", "f"), 255n);
  assert.equal(
    parseFieldValue("0xDe42000000000000000000000000000000009f01", "f"),
    BigInt("0xDe42000000000000000000000000000000009f01")
  );
});

test("parseFieldValue rejects garbage", () => {
  assert.throws(() => parseFieldValue("abc", "f"));
  assert.throws(() => parseFieldValue("1.5", "f"));
  assert.throws(() => parseFieldValue(1.5, "f"));
  assert.throws(() => parseFieldValue(null, "f"));
  assert.throws(() => parseFieldValue({}, "f"));
  assert.throws(() => parseFieldValue("0xzz", "f"));
});

test("toField reduces modulo the field prime", () => {
  assert.equal(toField(FIELD_PRIME), "0");
  assert.equal(toField(FIELD_PRIME + 1n), "1");
  assert.equal(toField(-1n), (FIELD_PRIME - 1n).toString());
  assert.equal(toField(1460n), "1460");
});

test("normalizeHex is case/prefix/zero-insensitive", () => {
  assert.equal(
    normalizeHex("0xDe42000000000000000000000000000000009f01"),
    normalizeHex("de42000000000000000000000000000000009f01")
  );
  assert.equal(normalizeHex("0x00ff"), "ff");
  assert.throws(() => normalizeHex("not hex"));
});

test("taskId and salt encodings are deterministic and distinct", () => {
  assert.equal(taskIdToField("gk_24_9d1"), taskIdToField("gk_24_9d1"));
  assert.notEqual(taskIdToField("gk_24_9d1"), taskIdToField("gk_24_9d2"));
  assert.equal(saltForTask("gk_24_9d1"), saltForTask("gk_24_9d1"));
  assert.notEqual(saltForTask("gk_24_9d1"), taskIdToField("gk_24_9d1"));
  assert.ok(BigInt(taskIdToField("gk_24_9d1")) < FIELD_PRIME);
  assert.ok(BigInt(saltForTask("gk_24_9d1")) < FIELD_PRIME);
});
