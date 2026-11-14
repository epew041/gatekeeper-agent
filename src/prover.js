// Local Groth16 proving with snarkjs and the OFFICIAL circuit artifacts.
// No network access happens here. Every generated proof is verified locally
// against the exported verification key before it is returned, so a bad
// proof can never leave this module silently.
import fs from "node:fs";
import * as snarkjs from "snarkjs";

export class ProverError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = "ProverError";
    this.cause = cause;
  }
}

function loadVKey(vkeyPath) {
  return JSON.parse(fs.readFileSync(vkeyPath, "utf8"));
}

// Generates a proof for `circuitInput` and verifies it locally.
// Returns { proof, publicSignals } where publicSignals is an array of
// decimal strings in the circuit's public-input order:
//   [hashOutput, registeredVkHash, proofVkHash, minimum, publicBalance,
//    expiryBlock, currentBlock, recipient, conditionRecipient, amount,
//    maxTransfer, decision, taskId]
// (order verified empirically; see circuits/CIRCUIT_NOTES.md).
// Throws ProverError if witness generation fails (e.g. decision bit
// inconsistent with the checks — which decide() guarantees never happens)
// or if local verification fails.
export async function generateProof(circuitInput, { wasmPath, zkeyPath, vkeyPath }) {
  let proof;
  let publicSignals;
  try {
    ({ proof, publicSignals } = await snarkjs.groth16.fullProve(
      circuitInput,
      wasmPath,
      zkeyPath
    ));
  } catch (cause) {
    throw new ProverError(
      `Proof generation failed (witness/prove): ${cause && cause.message ? cause.message : String(cause)}`,
      cause
    );
  }
  let valid;
  try {
    valid = await snarkjs.groth16.verify(loadVKey(vkeyPath), publicSignals, proof);
  } catch (cause) {
    throw new ProverError(
      `Local proof verification errored: ${cause && cause.message ? cause.message : String(cause)}`,
      cause
    );
  }
  if (!valid) {
    throw new ProverError("Local proof verification returned false");
  }
  return { proof, publicSignals: publicSignals.map(String) };
}
