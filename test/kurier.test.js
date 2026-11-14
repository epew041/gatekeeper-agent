import assert from "node:assert/strict";
import test from "node:test";
import { KurierClient, KurierError } from "../src/kurier.js";

// Mock fetch: records every call and replays scripted JSON responses. No
// network access happens in these tests.
function mockFetchFactory(script) {
  const calls = [];
  const queue = [...script];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const next = queue.shift();
    if (!next) throw new Error("mock fetch: no scripted response left");
    if (next instanceof Error) throw next;
    return {
      ok: next.status < 300,
      status: next.status,
      json: async () => next.body,
    };
  };
  return { fetchImpl, calls };
}

const VK_HASH =
  "0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0";

function clientWith(mock, overrides = {}) {
  return new KurierClient({
    apiUrl: "https://api.kurier.xyz/api/v1",
    apiKey: "TEST_KEY",
    fetchImpl: mock.fetchImpl,
    pollIntervalMs: 1,
    ...overrides,
  });
}

test("register-vk uses the documented URL and body, returns vkHash", async () => {
  const mock = mockFetchFactory([
    { status: 200, body: { vkHash: VK_HASH } },
  ]);
  const client = clientWith(mock);
  const vkey = { protocol: "groth16", curve: "bn128", nPublic: 13 };
  const { vkHash } = await client.registerVk(vkey);
  assert.equal(vkHash, VK_HASH);
  assert.equal(
    mock.calls[0].url,
    "https://api.kurier.xyz/api/v1/register-vk/TEST_KEY"
  );
  assert.equal(mock.calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(mock.calls[0].options.body), {
    proofType: "groth16",
    proofOptions: { library: "snarkjs", curve: "bn128" },
    vk: vkey,
  });
});

test("register-vk tolerates an already-registered uniq_vk_hash response", async () => {
  const mock = mockFetchFactory([
    { status: 200, body: { uniq_vk_hash: VK_HASH } },
  ]);
  const client = clientWith(mock);
  const { vkHash } = await client.registerVk({});
  assert.equal(vkHash, VK_HASH);
});

test("submit-proof uses the documented URL and body, returns jobId", async () => {
  const mock = mockFetchFactory([
    { status: 200, body: { jobId: "job-123", optimisticVerify: "success" } },
  ]);
  const client = clientWith(mock);
  const proof = { pi_a: ["1", "2", "1"] };
  const publicSignals = ["1", "2"];
  const { jobId } = await client.submitProof({ proof, publicSignals, vkHash: VK_HASH });
  assert.equal(jobId, "job-123");
  assert.equal(
    mock.calls[0].url,
    "https://api.kurier.xyz/api/v1/submit-proof/TEST_KEY"
  );
  assert.deepEqual(JSON.parse(mock.calls[0].options.body), {
    proofType: "groth16",
    vkRegistered: true,
    proofOptions: { library: "snarkjs", curve: "bn128" },
    proofData: { proof, publicSignals, vk: VK_HASH },
  });
});

test("submit-proof rejects a non-success optimisticVerify", async () => {
  const mock = mockFetchFactory([
    { status: 200, body: { jobId: "job-123", optimisticVerify: "failed" } },
  ]);
  const client = clientWith(mock);
  await assert.rejects(
    () => client.submitProof({ proof: {}, publicSignals: [], vkHash: VK_HASH }),
    KurierError
  );
});

test("job-status uses /job-status/{API_KEY}/{jobId} and polling reaches Finalized", async () => {
  const mock = mockFetchFactory([
    { status: 200, body: { jobId: "job-1", status: "Submitted" } },
    { status: 200, body: { jobId: "job-1", status: "IncludedInBlock" } },
    {
      status: 200,
      body: { jobId: "job-1", status: "Finalized", txHash: "0xabc", blockHash: "0xdef" },
    },
  ]);
  const client = clientWith(mock);
  const final = await client.waitForFinalized("job-1", 60000, {
    sleep: async () => {},
  });
  assert.equal(final.status, "Finalized");
  assert.equal(final.txHash, "0xabc");
  assert.equal(
    mock.calls[0].url,
    "https://api.kurier.xyz/api/v1/job-status/TEST_KEY/job-1"
  );
});

test("polling a Failed job throws", async () => {
  const mock = mockFetchFactory([
    { status: 200, body: { jobId: "job-1", status: "Failed" } },
  ]);
  const client = clientWith(mock);
  await assert.rejects(() => client.waitForFinalized("job-1", 60000), KurierError);
});

test("polling times out cleanly (timedOut, not an error)", async () => {
  const mock = mockFetchFactory([
    { status: 200, body: { jobId: "job-1", status: "Submitted" } },
    { status: 200, body: { jobId: "job-1", status: "Submitted" } },
  ]);
  const client = clientWith(mock);
  let nowValue = 0;
  const out = await client.waitForFinalized("job-1", 10, {
    now: () => nowValue,
    sleep: async () => {
      nowValue += 1000;
    },
  });
  assert.equal(out.timedOut, true);
  assert.equal(out.status, "Submitted");
});

test("HTTP errors surface as KurierError", async () => {
  const mock = mockFetchFactory([
    { status: 401, body: { error: "bad key" } },
  ]);
  const client = clientWith(mock);
  await assert.rejects(() => client.registerVk({}), KurierError);
});
