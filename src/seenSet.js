// Persistent seen-set + idempotency cache.
//
// Two maps, both persisted to one JSON file (when SEEN_SET_PATH is set):
//   1. seenProofRefs: proof references (proof_tx) of tasks this agent
//      APPROVED. A later task reusing one is rejected as PROOF_REUSED.
//      Only approvals are recorded: the trap definition is "already
//      accepted in a previous task", so a ref from a rejected task must not
//      poison a later legitimate task.
//   2. responses: task_id -> the exact JSON response already returned.
//      The platform may retry after a network failure; a retry MUST return
//      the identical response (and must NOT be re-decided, or the retry of
//      an approval would look like a reuse).
//
// Persistence is best-effort and synchronous (small file, local disk). If
// the file cannot be written, the agent keeps running in memory and logs
// the failure; the in-memory maps still protect the current process.
import fs from "node:fs";
import { normalizeHex } from "./encode.js";

export function proofRefKey(proofTx) {
  if (typeof proofTx !== "string" || !proofTx) return "";
  try {
    return `hex:${normalizeHex(proofTx)}`;
  } catch {
    return `raw:${proofTx}`;
  }
}

export class SeenSet {
  constructor(filePath) {
    this.filePath = filePath || null;
    this.seenProofRefs = new Set();
    this.responses = new Map();
    if (this.filePath) this.#load();
  }

  #load() {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const data = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      if (Array.isArray(data.seenProofRefs)) {
        for (const ref of data.seenProofRefs) this.seenProofRefs.add(String(ref));
      }
      if (data.responses && typeof data.responses === "object") {
        for (const [k, v] of Object.entries(data.responses)) {
          this.responses.set(k, v);
        }
      }
    } catch (cause) {
      console.error(
        JSON.stringify({
          level: "error",
          event: "seen_set_load_failed",
          error: String(cause && cause.message ? cause.message : cause),
        })
      );
    }
  }

  #save() {
    if (!this.filePath) return;
    try {
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(
        tmp,
        JSON.stringify({
          seenProofRefs: [...this.seenProofRefs],
          responses: Object.fromEntries(this.responses),
        })
      );
      fs.renameSync(tmp, this.filePath);
    } catch (cause) {
      console.error(
        JSON.stringify({
          level: "error",
          event: "seen_set_save_failed",
          error: String(cause && cause.message ? cause.message : cause),
        })
      );
    }
  }

  isProofRefSeen(proofTx) {
    const key = proofRefKey(proofTx);
    return key !== "" && this.seenProofRefs.has(key);
  }

  recordApproval(proofTx) {
    const key = proofRefKey(proofTx);
    if (!key) return;
    if (!this.seenProofRefs.has(key)) {
      this.seenProofRefs.add(key);
      this.#save();
    }
  }

  getCachedResponse(taskId) {
    return this.responses.get(taskId) || null;
  }

  cacheResponse(taskId, response) {
    this.responses.set(taskId, response);
    this.#save();
  }
}
