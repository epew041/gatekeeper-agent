// Pure decision logic for Proof Gatekeeper tasks.
//
// Implements the documented 7-step checklist (agentgames.zkverify.io
// /events/proof-gatekeeper) over the task payload fields:
//
//   1. Parse: task ID, minimum threshold, registered VK, proof reference,
//      recipient, expiry block (plus amount, cap, balance, current block).
//   2. VK check: the proof's VK must equal the registered condition VK.
//      NOTE (honesty gap): the checklist says "call zkVerifyJS to confirm
//      the proof is on-chain". No public doc describes a lookup of an
//      incoming proof by its proof_tx hash, so the implementable check is
//      the VK comparison from the payload itself. The agent does NOT claim
//      an on-chain lookup it cannot perform. See README.md.
//   3. Threshold: public balance >= minimum (equality approves).
//   4. Recipient: proof recipient == condition recipient.
//   5. Reuse: proof reference must not be in the seen-set (checked by the
//      caller through `isProofRefSeen`; only APPROVED refs are recorded).
//   6. Expiry: current block must be STRICTLY below expiry (equality is
//      expired — verified empirically against the official circuit).
//   7. Amount cap (trap encyclopedia): amount <= max_transfer (equal ok).
//
// Fail closed: any missing, mistyped, or unparseable field fails the check
// that owns it, using only DOCUMENTED reason codes. Precedence when several
// checks fail: reuse > VK > threshold > recipient > amount > expiry. The
// precedence only affects reason_code; the circuit's decision bit only
// depends on whether ANY check failed.
import {
  parseFieldValue,
  saltForTask,
  taskIdToField,
  toField,
} from "./encode.js";

export const REASON_CODES = Object.freeze({
  VALID: "VALID_CONDITION",
  VK_SUBSTITUTION: "VK_SUBSTITUTION",
  THRESHOLD_MISMATCH: "THRESHOLD_MISMATCH",
  PROOF_REUSED: "PROOF_REUSED",
  EXPIRED_CONDITION: "EXPIRED_CONDITION",
  RECIPIENT_MISMATCH: "RECIPIENT_MISMATCH",
  AMOUNT_OVERFLOW: "AMOUNT_OVERFLOW",
});

export class MalformedTaskError extends Error {
  constructor(message) {
    super(message);
    this.name = "MalformedTaskError";
  }
}

function tryParse(input, field, reasonCode, errors) {
  try {
    return parseFieldValue(input[field], field);
  } catch {
    errors.push(reasonCode);
    return null;
  }
}

// `task` is the parsed JSON envelope. `isProofRefSeen` is a predicate over
// the raw proof_tx string. Returns a decision object; never throws for
// field-level problems (those become rejects). Throws MalformedTaskError
// only when the envelope has no usable task_id/input at all.
export function decide(task, { isProofRefSeen = () => false } = {}) {
  if (!task || typeof task !== "object" || Array.isArray(task)) {
    throw new MalformedTaskError("Task envelope is not a JSON object");
  }
  const taskId = task.task_id;
  if (typeof taskId !== "string" || !taskId) {
    throw new MalformedTaskError("Missing task_id");
  }
  const input = task.input;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new MalformedTaskError(`Task ${taskId} has no input object`);
  }

  const errors = [];
  const registeredVk = tryParse(input, "registered_vk", REASON_CODES.VK_SUBSTITUTION, errors);
  const proofVk = tryParse(input, "proof_vk", REASON_CODES.VK_SUBSTITUTION, errors);
  const minimum = tryParse(input, "minimum", REASON_CODES.THRESHOLD_MISMATCH, errors);
  const publicBalance = tryParse(input, "public_balance", REASON_CODES.THRESHOLD_MISMATCH, errors);
  const recipient = tryParse(input, "recipient", REASON_CODES.RECIPIENT_MISMATCH, errors);
  const conditionRecipient = tryParse(input, "condition_recipient", REASON_CODES.RECIPIENT_MISMATCH, errors);
  const amount = tryParse(input, "amount", REASON_CODES.AMOUNT_OVERFLOW, errors);
  const maxTransfer = tryParse(input, "max_transfer", REASON_CODES.AMOUNT_OVERFLOW, errors);
  const expiryBlock = tryParse(input, "expiry_block", REASON_CODES.EXPIRED_CONDITION, errors);
  const currentBlock = tryParse(input, "current_block", REASON_CODES.EXPIRED_CONDITION, errors);

  const proofTx = typeof input.proof_tx === "string" ? input.proof_tx : "";
  const proofTxMissing = !proofTx;

  const checks = {
    proofRefPresent: !proofTxMissing,
    reused: false,
    vkMatch: registeredVk !== null && proofVk !== null && registeredVk === proofVk,
    thresholdOk:
      minimum !== null && publicBalance !== null && publicBalance >= minimum,
    recipientMatch:
      recipient !== null && conditionRecipient !== null && recipient === conditionRecipient,
    amountOk: amount !== null && maxTransfer !== null && amount <= maxTransfer,
    notExpired:
      expiryBlock !== null && currentBlock !== null && currentBlock < expiryBlock,
  };

  // Reuse check runs only when a proof reference exists. A missing proof
  // reference is itself a proof-identity failure (mapped to VK_SUBSTITUTION).
  if (!proofTxMissing) {
    checks.reused = Boolean(isProofRefSeen(proofTx));
  }

  let reasonCode = REASON_CODES.VALID;
  if (proofTxMissing || errors.includes(REASON_CODES.VK_SUBSTITUTION) || !checks.vkMatch) {
    // A missing proof ref is reported as a VK/proof-identity failure; it is
    // checked first together with VK because both concern proof identity.
    // Reuse takes precedence over VK only when a ref exists and was seen.
    reasonCode = checks.reused ? REASON_CODES.PROOF_REUSED : REASON_CODES.VK_SUBSTITUTION;
  } else if (checks.reused) {
    reasonCode = REASON_CODES.PROOF_REUSED;
  } else if (errors.includes(REASON_CODES.THRESHOLD_MISMATCH) || !checks.thresholdOk) {
    reasonCode = REASON_CODES.THRESHOLD_MISMATCH;
  } else if (errors.includes(REASON_CODES.RECIPIENT_MISMATCH) || !checks.recipientMatch) {
    reasonCode = REASON_CODES.RECIPIENT_MISMATCH;
  } else if (errors.includes(REASON_CODES.AMOUNT_OVERFLOW) || !checks.amountOk) {
    reasonCode = REASON_CODES.AMOUNT_OVERFLOW;
  } else if (errors.includes(REASON_CODES.EXPIRED_CONDITION) || !checks.notExpired) {
    reasonCode = REASON_CODES.EXPIRED_CONDITION;
  }

  const approved = reasonCode === REASON_CODES.VALID;
  const decision = approved ? "APPROVE" : "REJECT";

  // A circuit proof can only be built when every circuit input parsed. A
  // reuse reject has no proof to submit by the score model's own rule.
  const provable =
    !checks.reused &&
    registeredVk !== null &&
    proofVk !== null &&
    minimum !== null &&
    publicBalance !== null &&
    recipient !== null &&
    conditionRecipient !== null &&
    amount !== null &&
    maxTransfer !== null &&
    expiryBlock !== null &&
    currentBlock !== null;

  let circuitInput = null;
  if (provable) {
    circuitInput = {
      minimum: toField(minimum),
      recipient: toField(recipient),
      amount: toField(amount),
      maxTransfer: toField(maxTransfer),
      publicBalance: toField(publicBalance),
      expiryBlock: toField(expiryBlock),
      currentBlock: toField(currentBlock),
      conditionRecipient: toField(conditionRecipient),
      decision: approved ? "1" : "0",
      salt: saltForTask(taskId),
      taskId: taskIdToField(taskId),
      registeredVkHash: toField(registeredVk),
      proofVkHash: toField(proofVk),
    };
  }

  return {
    taskId,
    decision,
    reasonCode,
    approved,
    provable,
    proofTx,
    checks,
    circuitInput,
  };
}
