// Field encodings: converts task-payload values into the field elements the
// gatekeeper circuit expects. All conversions are deterministic and pure.
//
// Verified empirically against the OFFICIAL circuit artifacts (see
// circuits/CIRCUIT_NOTES.md):
//   - The circuit takes 13 inputs; 12 are public, `salt` is private and only
//     appears through a hash output that binds (salt, taskId).
//   - Decision consistency is enforced IN the circuit: decision=1 requires
//     every check to pass; decision=0 requires at least one check to fail.
//   - Expiry is STRICT: currentBlock must be < expiryBlock (equality fails).
//   - Balance/amount bounds are INCLUSIVE: balance >= minimum, amount <= max.
//   - A full 256-bit vk hash and a 160-bit address, passed as BigInt, produce
//     verifying proofs (the witness calculator reduces values mod p).
import crypto from "node:crypto";

// BN128 scalar field prime.
export const FIELD_PRIME = BigInt(
  "21888242871839275222246405745257275088548364400416034343698204186575808495617"
);

export function toField(value) {
  const n = BigInt(value);
  const reduced = ((n % FIELD_PRIME) + FIELD_PRIME) % FIELD_PRIME;
  return reduced.toString(10);
}

// Parses a payload value into a BigInt. Accepts: JSON numbers, decimal
// strings, and 0x-prefixed hex strings. Throws on anything else so the
// caller can fail closed.
export function parseFieldValue(value, fieldName) {
  if (typeof value === "number") {
    if (!Number.isInteger(value) || !Number.isSafeInteger(value)) {
      throw new Error(`Field ${fieldName} is not a safe integer: ${value}`);
    }
    return BigInt(value);
  }
  if (typeof value === "bigint") return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^0[xX][0-9a-fA-F]+$/.test(trimmed)) return BigInt(trimmed);
    if (/^-?[0-9]+$/.test(trimmed)) return BigInt(trimmed);
    throw new Error(`Field ${fieldName} is not a number or hex string`);
  }
  throw new Error(`Field ${fieldName} has unsupported type ${typeof value}`);
}

// Normalizes a hex string (address / hash) for EXACT comparison: lowercase,
// 0x-prefix stripped, no padding assumptions. Two spellings of the same
// value (checksummed vs lowercase address) compare equal.
export function normalizeHex(value) {
  if (typeof value !== "string") {
    throw new Error(`Expected a hex string, got ${typeof value}`);
  }
  const trimmed = value.trim().toLowerCase();
  const hex = trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed;
  if (!/^[0-9a-f]+$/.test(hex)) {
    throw new Error("Value is not a hex string");
  }
  return hex.replace(/^0+(?=[0-9a-f])/, "") || "0";
}

// TO-VERIFY: task IDs in real payloads are strings like "gk_24_9d1". No
// official doc states how the platform encodes a task ID into the circuit's
// `taskId` field element. This deterministic SHA-256 encoding is the
// agent's choice; the proof verifies cryptographically for ANY taskId value
// (verified empirically), and the build page only requires public inputs to
// prove threshold/recipient/action. If practice mode shows the platform
// cross-checks taskId, change ONLY this function.
export function taskIdToField(taskId) {
  const digest = crypto
    .createHash("sha256")
    .update(`agent-games-gatekeeper/task/v1:${taskId}`, "utf8")
    .digest("hex");
  return toField(BigInt(`0x${digest}`));
}

// Deterministic per-task salt. The circuit binds (salt, taskId) into its
// hash output, so a fixed salt per task keeps retries reproducible while a
// different task always gets a different salt. The salt is a private input
// and is never sent anywhere.
export function saltForTask(taskId) {
  const digest = crypto
    .createHash("sha256")
    .update(`agent-games-gatekeeper/salt/v1:${taskId}`, "utf8")
    .digest("hex");
  return toField(BigInt(`0x${digest}`));
}
