import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAgent } from "../src/agent.js";
import { SeenSet } from "../src/seenSet.js";
import { makeTask } from "./fixtures.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const VK_HASH =
  "0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0";

function testConfig() {
  return {
    port: 0,
    hmacSecret: "test-secret",
    kurierEnabled: false,
    kurierApiUrl: "https://api.kurier.xyz/api/v1",
    vkHash: VK_HASH,
    taskTimeoutMs: 50000,
    kurierPollIntervalMs: 5000,
    kurierBudgetMs: 40000,
    wasmPath: path.join(ROOT, "circuits", "gatekeeper.wasm"),
    zkeyPath: path.join(ROOT, "circuits", "gatekeeper_final.zkey"),
    vkeyPath: path.join(ROOT, "circuits", "verification_key.json"),
  };
}

test("REAL: approve returns decision + locally verified proof, no proof_tx without Kurier", async () => {
  const agent = createAgent({
    config: testConfig(),
    seenSet: new SeenSet(null),
    kurierClient: null,
  });
  const res = await agent.handleTask(makeTask());
  assert.equal(res.decision, "APPROVE");
  assert.equal(res.reason_code, "VALID_CONDITION");
  assert.ok(res.proof);
  assert.equal(res.public_signals.length, 13);
  assert.equal(res.proof_tx, undefined);
});

test("REAL: retry of the same task_id returns the identical cached response", async () => {
  const agent = createAgent({
    config: testConfig(),
    seenSet: new SeenSet(null),
    kurierClient: null,
  });
  const task = makeTask();
  const first = await agent.handleTask(task);
  const second = await agent.handleTask(makeTask());
  assert.deepEqual(second, first);
});

test("REAL: a second task reusing an approved proof ref is rejected as PROOF_REUSED without proof", async () => {
  const agent = createAgent({
    config: testConfig(),
    seenSet: new SeenSet(null),
    kurierClient: null,
  });
  const first = await agent.handleTask(makeTask());
  assert.equal(first.decision, "APPROVE");
  // Same proof_tx, different task_id, otherwise valid.
  const replay = makeTask({ task_id: "gk_test_002" });
  const second = await agent.handleTask(replay);
  assert.equal(second.decision, "REJECT");
  assert.equal(second.reason_code, "PROOF_REUSED");
  assert.equal(second.proof, undefined);
  assert.equal(second.public_signals, undefined);
  assert.ok(second.proof_tx);
});

test("REAL: Kurier runs in the background — answer returns at once with proof, no proof_tx (mocked Kurier)", async () => {
  let resolveFinished;
  const finished = new Promise((resolve) => {
    resolveFinished = resolve;
  });
  const calls = [];
  const fakeKurier = {
    async submitProof({ proof, publicSignals, vkHash }) {
      calls.push({ proof, publicSignals, vkHash });
      return { jobId: "job-1" };
    },
    async waitForFinalized(jobId) {
      assert.equal(jobId, "job-1");
      const out = { status: "Finalized", txHash: "0xkuriertx", jobId };
      resolveFinished(out);
      return out;
    },
  };
  const agent = createAgent({
    config: testConfig(),
    seenSet: new SeenSet(null),
    kurierClient: fakeKurier,
  });
  const res = await agent.handleTask(makeTask());
  assert.equal(res.decision, "APPROVE");
  assert.ok(res.proof);
  assert.equal(res.proof_tx, undefined);
  // The background chain still runs to completion after the answer.
  const final = await finished;
  assert.equal(final.txHash, "0xkuriertx");
  assert.equal(calls[0].vkHash, VK_HASH);
});

test("REAL: a Kurier that never resolves never delays the answer", async () => {
  const fakeKurier = {
    async submitProof() {
      return { jobId: "job-hang" };
    },
    async waitForFinalized() {
      return new Promise(() => {});
    },
  };
  const agent = createAgent({
    config: testConfig(),
    seenSet: new SeenSet(null),
    kurierClient: fakeKurier,
  });
  const res = await agent.handleTask(makeTask());
  assert.equal(res.decision, "APPROVE");
  assert.ok(res.proof);
  assert.equal(res.proof_tx, undefined);
});

test("REAL: Kurier failure never blocks the answer (decision + proof still returned)", async () => {
  const fakeKurier = {
    async submitProof() {
      throw new Error("kurier down");
    },
  };
  const agent = createAgent({
    config: testConfig(),
    seenSet: new SeenSet(null),
    kurierClient: fakeKurier,
  });
  const res = await agent.handleTask(makeTask());
  assert.equal(res.decision, "APPROVE");
  assert.ok(res.proof);
  assert.equal(res.proof_tx, undefined);
});
