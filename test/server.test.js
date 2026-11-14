import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAgent } from "../src/agent.js";
import { SeenSet } from "../src/seenSet.js";
import { createServer } from "../src/server.js";
import { signResponseBody, verifySignature } from "../src/hmac.js";
import { makeTask } from "./fixtures.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SECRET = "test-only-server-secret-0123456789abcdef";

async function startTestServer() {
  const config = {
    port: 0,
    hmacSecret: SECRET,
    kurierEnabled: false,
    kurierApiUrl: "https://api.kurier.xyz/api/v1",
    vkHash: "0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0",
    taskTimeoutMs: 50000,
    kurierPollIntervalMs: 5000,
    kurierBudgetMs: 40000,
    wasmPath: path.join(ROOT, "circuits", "gatekeeper.wasm"),
    zkeyPath: path.join(ROOT, "circuits", "gatekeeper_final.zkey"),
    vkeyPath: path.join(ROOT, "circuits", "verification_key.json"),
  };
  const agent = createAgent({ config, seenSet: new SeenSet(null), kurierClient: null });
  const server = createServer({ config, agent });
  await new Promise((resolve) => server.listen(0, resolve));
  return { server, port: server.address().port };
}

function request(port, { method, path, headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ port, method, path, headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () =>
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks),
        })
      );
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

test("REAL HTTP: health check answers 200 with a signed body", async () => {
  const { server, port } = await startTestServer();
  try {
    const res = await request(port, { method: "GET", path: "/health" });
    assert.equal(res.status, 200);
    assert.equal(JSON.parse(res.body.toString()).status, "ok");
    assert.equal(
      verifySignature(SECRET, res.body, res.headers["x-agent-games-signature"]),
      true
    );
  } finally {
    server.close();
  }
});

test("REAL HTTP: unsigned and wrongly signed task POSTs are rejected 401", async () => {
  const { server, port } = await startTestServer();
  try {
    const body = Buffer.from(JSON.stringify(makeTask()), "utf8");
    const unsigned = await request(port, {
      method: "POST",
      path: "/",
      headers: { "content-type": "application/json" },
      body,
    });
    assert.equal(unsigned.status, 401);
    const wrongSig = await request(port, {
      method: "POST",
      path: "/",
      headers: {
        "content-type": "application/json",
        "x-agent-games-signature": "0".repeat(64),
      },
      body,
    });
    assert.equal(wrongSig.status, 401);
    // Tampered body with the original signature is also rejected.
    const sig = signResponseBody(SECRET, body);
    const tampered = await request(port, {
      method: "POST",
      path: "/",
      headers: {
        "content-type": "application/json",
        "x-agent-games-signature": sig,
      },
      body: Buffer.from(JSON.stringify(makeTask({ task_id: "gk_other" })), "utf8"),
    });
    assert.equal(tampered.status, 401);
  } finally {
    server.close();
  }
});

test("REAL HTTP: valid signed task returns APPROVE with proof and a valid response signature", async () => {
  const { server, port } = await startTestServer();
  try {
    const body = Buffer.from(JSON.stringify(makeTask()), "utf8");
    const res = await request(port, {
      method: "POST",
      path: "/",
      headers: {
        "content-type": "application/json",
        "x-agent-games-signature": signResponseBody(SECRET, body),
      },
      body,
    });
    assert.equal(res.status, 200);
    const payload = JSON.parse(res.body.toString());
    assert.equal(payload.decision, "APPROVE");
    assert.equal(payload.reason_code, "VALID_CONDITION");
    assert.ok(payload.proof);
    assert.equal(payload.public_signals.length, 13);
    assert.equal(
      verifySignature(SECRET, res.body, res.headers["x-agent-games-signature"]),
      true
    );
    // Retry with the same task_id returns the byte-identical response.
    const retry = await request(port, {
      method: "POST",
      path: "/",
      headers: {
        "content-type": "application/json",
        "x-agent-games-signature": signResponseBody(SECRET, body),
      },
      body,
    });
    assert.equal(retry.status, 200);
    assert.equal(retry.body.toString(), res.body.toString());
  } finally {
    server.close();
  }
});

test("REAL HTTP: signed preflight-style POST without task fields answers OK", async () => {
  const { server, port } = await startTestServer();
  try {
    const body = Buffer.from(JSON.stringify({ ping: true }), "utf8");
    const res = await request(port, {
      method: "POST",
      path: "/",
      headers: {
        "content-type": "application/json",
        "x-agent-games-signature": signResponseBody(SECRET, body),
      },
      body,
    });
    assert.equal(res.status, 200);
    assert.equal(JSON.parse(res.body.toString()).status, "ok");
  } finally {
    server.close();
  }
});
