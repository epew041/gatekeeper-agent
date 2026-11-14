// Task orchestration: HMAC-verified envelope in, signed decision out.
//
// Pipeline (order matters):
//   1. Parse JSON (caller already verified the HMAC on the raw body).
//   2. Idempotency: a task_id seen before returns the EXACT cached response.
//   3. Decide (pure checks; reuse check consults the seen-set).
//   4. If provable: generate + locally verify the Groth16 proof.
//   5. If Kurier is configured: submit the proof and poll for Finalized
//      within the remaining time budget. Slow/failed Kurier NEVER blocks
//      the answer: the decision + local proof are returned without a
//      Kurier txHash, and the shortfall is logged.
//   6. Record approvals in the seen-set, cache the response, return it.
//
// Fail-closed rules:
//   - Proof generation failure on a REJECT: answer REJECT without proof
//     fields (the decision is still scoreable; the bonus is lost).
//   - Proof generation failure on an APPROVE: answer REJECT without proof
//     fields. This path should never trigger (valid inputs prove fine —
//     verified empirically), but an unproven approval is worse than a
//     cautious rejection (-6 wrong-approve vs -3 wrong-reject).
//   - Any unexpected exception: answer REJECT with the reason code from
//     the decision when one exists, else VK_SUBSTITUTION, without proof.
//   - The caller enforces the overall deadline; this module tracks its own
//     remaining budget for the Kurier poll.
import { decide, MalformedTaskError, REASON_CODES } from "./decide.js";
import { generateProof, ProverError } from "./prover.js";
import { KurierError } from "./kurier.js";

function log(event, fields = {}) {
  console.log(JSON.stringify({ level: "info", event, ...fields }));
}

export function createAgent({ config, seenSet, kurierClient }) {
  const inFlight = new Map();

  async function handleTaskInternal(envelope, startedAt) {
    const decision = decide(envelope, {
      isProofRefSeen: (ref) => seenSet.isProofRefSeen(ref),
    });
    const { taskId } = decision;

    let proof = null;
    let publicSignals = null;
    let proofTx = null;
    let kurierStatus = kurierClient ? "not_attempted" : "disabled";

    if (decision.provable) {
      try {
        ({ proof, publicSignals } = await generateProof(decision.circuitInput, {
          wasmPath: config.wasmPath,
          zkeyPath: config.zkeyPath,
          vkeyPath: config.vkeyPath,
        }));
      } catch (cause) {
        if (!(cause instanceof ProverError)) throw cause;
        log("proof_failed", { taskId, decision: decision.decision, error: cause.message });
        // Fail closed: an unproven APPROVE becomes a REJECT without proof.
        // A REJECT keeps its reason code, also without proof.
        const fallback = {
          decision: "REJECT",
          reason_code:
            decision.decision === "APPROVE"
              ? REASON_CODES.VK_SUBSTITUTION
              : decision.reasonCode,
        };
        seenSet.cacheResponse(taskId, fallback);
        return fallback;
      }

      if (kurierClient) {
        const elapsed = Date.now() - startedAt;
        const budget = Math.max(
          0,
          Math.min(config.kurierBudgetMs, config.taskTimeoutMs - elapsed - 5000)
        );
        if (budget > 0) {
          try {
            const { jobId } = await kurierClient.submitProof({
              proof,
              publicSignals,
              vkHash: config.vkHash,
            });
            const final = await kurierClient.waitForFinalized(jobId, budget);
            if (final.status === "Finalized") {
              proofTx = final.txHash || null;
              kurierStatus = "finalized";
            } else {
              kurierStatus = `poll_timeout:${final.status}`;
            }
          } catch (cause) {
            kurierStatus =
              cause instanceof KurierError ? `error:${cause.message}` : "error:unknown";
            log("kurier_failed", { taskId, error: String(cause.message || cause) });
          }
        } else {
          kurierStatus = "budget_exhausted";
        }
      }
    }

    const response = { decision: decision.decision, reason_code: decision.reasonCode };
    if (proofTx) {
      response.proof_tx = proofTx;
    } else if (!decision.provable && decision.reasonCode === REASON_CODES.PROOF_REUSED) {
      // Reuse tasks have no own proof; echo the incoming reference, as in
      // the documented example response shape.
      response.proof_tx = decision.proofTx;
    }
    if (proof && publicSignals) {
      response.proof = proof;
      response.public_signals = publicSignals;
    }

    if (decision.approved) {
      seenSet.recordApproval(decision.proofTx);
    }
    seenSet.cacheResponse(taskId, response);
    log("task_done", {
      taskId,
      decision: decision.decision,
      reason_code: decision.reasonCode,
      kurier: kurierStatus,
      ms: Date.now() - startedAt,
    });
    return response;
  }

  // Public entry: `envelope` is the parsed JSON body. Returns the response
  // object. Concurrent duplicate deliveries of the same task_id share one
  // in-flight computation. Malformed envelopes throw MalformedTaskError;
  // the server maps those to a signed error response.
  async function handleTask(envelope) {
    const startedAt = Date.now();
    const taskId =
      envelope && typeof envelope === "object" ? envelope.task_id : undefined;
    if (typeof taskId === "string" && taskId) {
      const cached = seenSet.getCachedResponse(taskId);
      if (cached) {
        log("task_retry_cached", { taskId });
        return cached;
      }
      const existing = inFlight.get(taskId);
      if (existing) return existing;
      const job = handleTaskInternal(envelope, startedAt).finally(() => {
        inFlight.delete(taskId);
      });
      inFlight.set(taskId, job);
      return job;
    }
    return handleTaskInternal(envelope, startedAt);
  }

  return { handleTask };
}

export { MalformedTaskError };
