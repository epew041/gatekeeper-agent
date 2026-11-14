import assert from "node:assert/strict";
import test from "node:test";
import * as snarkjs from "snarkjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decide } from "../src/decide.js";
import { generateProof, ProverError } from "../src/prover.js";
import { OTHER_VK_HASH, makeTask } from "./fixtures.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PATHS = {
  wasmPath: path.join(ROOT, "circuits", "gatekeeper.wasm"),
  zkeyPath: path.join(ROOT, "circuits", "gatekeeper_final.zkey"),
  vkeyPath: path.join(ROOT, "circuits", "verification_key.json"),
};

test("REAL: valid approve scenario generates a proof that verifies locally", async () => {
  const d = decide(makeTask());
  assert.equal(d.decision, "APPROVE");
  const { proof, publicSignals } = await generateProof(d.circuitInput, PATHS);
  assert.equal(publicSignals.length, 13);
  // Public-signal order (verified empirically): decision is index 11.
  assert.equal(publicSignals[11], "1");
  const vk = JSON.parse(fs.readFileSync(PATHS.vkeyPath, "utf8"));
  assert.equal(await snarkjs.groth16.verify(vk, publicSignals, proof), true);
});

test("REAL: reject scenario (wrong VK) generates a verifying decision-0 proof", async () => {
  const d = decide(makeTask({ input: { proof_vk: OTHER_VK_HASH } }));
  assert.equal(d.decision, "REJECT");
  const { proof, publicSignals } = await generateProof(d.circuitInput, PATHS);
  assert.equal(publicSignals[11], "0");
  const vk = JSON.parse(fs.readFileSync(PATHS.vkeyPath, "utf8"));
  assert.equal(await snarkjs.groth16.verify(vk, publicSignals, proof), true);
});

test("REAL: decision bit inconsistent with checks cannot prove (circuit assert)", async () => {
  const d = decide(makeTask());
  const lyingInput = { ...d.circuitInput, decision: "0" };
  await assert.rejects(() => generateProof(lyingInput, PATHS), ProverError);
});
