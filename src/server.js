// HTTP server: health endpoint + HMAC-signed task endpoint.
//
// Routing (the platform registers ONE endpoint address, so health and
// tasks share it):
//   GET  /, /agent, /health  -> 200 signed {"ok":true,"protocolVersion":"v1"}
//   POST /, /agent           -> task handling (HMAC required); a signed POST
//                              without task fields is a preflight probe and
//                              gets the same signed protocol-v1 JSON
//   anything else            -> 404
//
// The protocol-v1 response shape is VERIFIED from the platform itself: the
// dashboard preflight error (15 Nov 2026) states the endpoint must return
// signed protocol-v1 JSON {"ok":true,"protocolVersion":"v1"} with a valid
// x-agent-games-signature header computed from the HMAC secret.
//
// Every response carries x-agent-games-signature over its raw body.
// Requests are verified against the RAW body BEFORE any JSON parsing, as
// the official docs require. Bodies over 1 MiB are rejected outright.
import http from "node:http";
import { signResponseBody, verifySignature } from "./hmac.js";
import { MalformedTaskError } from "./agent.js";

const MAX_BODY_BYTES = 1024 * 1024;
const STALE_TASK_MS = 10 * 60 * 1000;
const FUTURE_SKEW_MS = 5 * 60 * 1000;

function log(event, fields = {}) {
  console.log(JSON.stringify({ level: "info", event, ...fields }));
}

function parseTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    // Heuristic: >1e12 is milliseconds, >1e9 is seconds.
    if (value > 1e12) return value;
    if (value > 1e9) return value * 1000;
    return null;
  }
  if (typeof value === "string" && value) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

// Defensive freshness check. Only rejects when the timestamp parses
// unambiguously AND is wildly out of range; unparseable timestamps are
// logged and ignored rather than risking a false rejection from an
// undocumented format or clock skew. Returns an error string or null.
export function checkFreshness(envelope, nowMs = Date.now()) {
  const issuedAt = parseTimestamp(envelope.issued_at);
  if (issuedAt === null) return null;
  if (nowMs - issuedAt > STALE_TASK_MS) return "stale_task";
  if (issuedAt - nowMs > FUTURE_SKEW_MS) return "future_task";
  return null;
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body_too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export function createServer({ config, agent }) {
  function sendSigned(res, status, payload) {
    const body = Buffer.from(JSON.stringify(payload), "utf8");
    const headers = {
      "content-type": "application/json",
      "content-length": body.length,
      "x-agent-games-signature": signResponseBody(config.hmacSecret, body),
    };
    res.writeHead(status, headers);
    res.end(body);
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://localhost");
      const path = url.pathname.replace(/\/$/, "") || "/";
      const isTaskPath = path === "/" || path === "/agent";
      const isHealthPath = isTaskPath || path === "/health";

      if (req.method === "GET" && isHealthPath) {
        sendSigned(res, 200, { ok: true, protocolVersion: "v1" });
        return;
      }
      if (req.method === "HEAD" && isHealthPath) {
        res.writeHead(200);
        res.end();
        return;
      }
      if (req.method !== "POST" || !isTaskPath) {
        sendSigned(res, 404, { error: "not_found" });
        return;
      }

      // --- Task path: HMAC on the RAW body, before parsing. ---
      let rawBody;
      try {
        rawBody = await readRawBody(req);
      } catch {
        sendSigned(res, 413, { error: "body_too_large" });
        return;
      }
      const signature = req.headers["x-agent-games-signature"];
      if (!verifySignature(config.hmacSecret, rawBody, signature)) {
        log("hmac_rejected", { signature_present: Boolean(signature) });
        sendSigned(res, 401, { error: "bad_signature" });
        return;
      }

      let envelope;
      try {
        envelope = JSON.parse(rawBody.toString("utf8"));
      } catch {
        log("bad_json");
        sendSigned(res, 400, { error: "invalid_json" });
        return;
      }

      // Preflight probe: a signed POST without task fields is answered with
      // the signed protocol-v1 JSON the platform requires (verified from
      // the dashboard preflight error, 15 Nov 2026), NOT with an error.
      if (
        !envelope ||
        typeof envelope !== "object" ||
        Array.isArray(envelope) ||
        typeof envelope.task_id !== "string" ||
        !envelope.task_id
      ) {
        sendSigned(res, 200, { ok: true, protocolVersion: "v1" });
        return;
      }

      const freshnessError = checkFreshness(envelope);
      if (freshnessError) {
        log("stale_or_future_task", { task_id: envelope.task_id, reason: freshnessError });
        sendSigned(res, 401, { error: freshnessError });
        return;
      }

      // Deadline guard: answer fail-closed rather than never answering.
      const startedAt = Date.now();
      const timeoutMs = config.taskTimeoutMs;
      let timedOut = false;
      const timeoutPromise = new Promise((resolve) => {
        setTimeout(() => {
          timedOut = true;
          resolve(null);
        }, timeoutMs);
      });
      const result = await Promise.race([
        agent.handleTask(envelope).catch((cause) => ({ __error: cause })),
        timeoutPromise,
      ]);
      if (timedOut || result === null) {
        log("task_timeout", { task_id: envelope.task_id, ms: Date.now() - startedAt });
        sendSigned(res, 200, { decision: "REJECT", reason_code: "VK_SUBSTITUTION" });
        return;
      }
      if (result && result.__error) {
        const cause = result.__error;
        if (cause instanceof MalformedTaskError) {
          log("malformed_task", { task_id: envelope.task_id, error: cause.message });
          sendSigned(res, 400, { error: "malformed_task" });
          return;
        }
        // Unexpected failure: fail closed with a REJECT decision.
        log("task_error", {
          task_id: envelope.task_id,
          error: String(cause && cause.message ? cause.message : cause),
        });
        sendSigned(res, 200, { decision: "REJECT", reason_code: "VK_SUBSTITUTION" });
        return;
      }
      sendSigned(res, 200, result);
    } catch (cause) {
      // Last-resort guard: never leave a request hanging.
      try {
        sendSigned(res, 200, { decision: "REJECT", reason_code: "VK_SUBSTITUTION" });
      } catch {
        try {
          res.end();
        } catch {
          /* ignore */
        }
      }
      log("server_error", { error: String(cause && cause.message ? cause.message : cause) });
    }
  });

  return server;
}
