// HMAC handling for the x-agent-games-signature header.
//
// Official docs (agentgames.zkverify.io/build, /rules) state only that:
//   - the agent MUST verify x-agent-games-signature on every request,
//     against the RAW body before parsing;
//   - every response is signed with x-agent-games-signature over the raw
//     response body;
//   - the secret is a 32-byte random value shown exactly once at registration.
//
// TO-VERIFY (practice mode / preflight): the docs do NOT state the hash
// algorithm or the header encoding. This module assumes HMAC-SHA256, the
// overwhelmingly common convention for this header pattern, and verifies
// TOLERANTLY (hex or base64, with or without a "sha256=" prefix) so a
// different-but-equivalent encoding still passes. Responses are signed as
// lowercase hex without a prefix. If preflight rejects the signature, the
// ONLY place to change is `sign()` below and the accepted forms in
// `decodeSignature()`. Never log the secret or a full signature value.
import crypto from "node:crypto";

export function hmacSha256Hex(secret, bodyBuffer) {
  return crypto.createHmac("sha256", secret).update(bodyBuffer).digest("hex");
}

export function signResponseBody(secret, bodyBuffer) {
  return hmacSha256Hex(secret, bodyBuffer);
}

function decodeSignature(headerValue) {
  if (typeof headerValue !== "string") return null;
  let value = headerValue.trim();
  if (!value) return null;
  // Tolerate a "sha256=" prefix (GitHub-style) and comma-joined values.
  if (value.includes(",")) value = value.split(",")[0].trim();
  if (value.toLowerCase().startsWith("sha256=")) value = value.slice(7).trim();
  // Hex: exactly 64 hex chars for SHA-256.
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    return Buffer.from(value, "hex");
  }
  // Base64: 44 chars ending with "=" for 32 bytes. Reject anything else
  // instead of guessing.
  if (/^[A-Za-z0-9+/]{43}=$/.test(value)) {
    return Buffer.from(value, "base64");
  }
  return null;
}

export function verifySignature(secret, bodyBuffer, headerValue) {
  if (!secret || !headerValue) return false;
  const presented = decodeSignature(headerValue);
  if (!presented || presented.length !== 32) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(bodyBuffer)
    .digest();
  return crypto.timingSafeEqual(presented, expected);
}
