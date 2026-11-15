// Kurier REST client (zkVerify verification relay).
//
// API shapes below are copied from the OFFICIAL zkVerify docs
// (https://docs.zkverify.io/overview/getting-started/kurier, "Without
// Aggregation" / Circom tabs) — nothing here is invented:
//   POST {API_URL}/register-vk/{API_KEY}
//     { proofType: "groth16",
//       proofOptions: { library: "snarkjs", curve: "bn128" }, vk: <vkey JSON> }
//   POST {API_URL}/submit-proof/{API_KEY}
//     { proofType: "groth16", vkRegistered: true,
//       proofOptions: { library: "snarkjs", curve: "bn128" },
//       proofData: { proof, publicSignals, vk: <vkHash> } }
//     -> { jobId, optimisticVerify: "success" }
//   GET  {API_URL}/job-status/{API_KEY}/{jobId}
//     -> { jobId, status, statusId, proofType, chainId, createdAt,
//          updatedAt, txHash, blockHash, transactionDetails }
// Statuses: Queued, Valid, Submitted, IncludedInBlock, Finalized, Failed.
//
// The gatekeeper VK is ALREADY registered (its hash is published by
// /api/circuit-info), so registerVk() is provided for completeness but the
// agent does not call it in the normal path.
//
// `fetchImpl` is injectable so tests can run against a mock without any
// network access. No live Kurier call is ever made in tests.
export class KurierError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = "KurierError";
    this.cause = cause;
  }
}

const TERMINAL_OK = "Finalized";
const TERMINAL_FAIL = "Failed";

function extractVkHash(data) {
  if (!data || typeof data !== "object") return null;
  return (
    data.vkHash ||
    data.uniq_vk_hash ||
    (data.meta && (data.meta.vkHash || data.meta.uniq_vk_hash)) ||
    data.hash ||
    null
  );
}

export class KurierClient {
  constructor({
    apiUrl,
    apiKey,
    fetchImpl = fetch,
    pollIntervalMs = 5000,
    requestTimeoutMs = 30000,
  }) {
    if (!apiUrl || !apiKey) {
      throw new KurierError("Kurier client requires apiUrl and apiKey");
    }
    this.apiUrl = apiUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
    this.pollIntervalMs = pollIntervalMs;
    // Per-request ceiling: a hung Kurier call must fail instead of hanging
    // forever. 0 disables the timeout (tests may pass a small value).
    this.requestTimeoutMs = requestTimeoutMs;
  }

  async #request(method, path, body) {
    // `path` already contains the API key in the position the docs specify:
    //   /register-vk/{API_KEY}, /submit-proof/{API_KEY},
    //   /job-status/{API_KEY}/{jobId}
    const url = `${this.apiUrl}${path}`;
    let response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal:
          this.requestTimeoutMs > 0
            ? AbortSignal.timeout(this.requestTimeoutMs)
            : undefined,
      });
    } catch (cause) {
      throw new KurierError(`Kurier request failed: ${cause.message}`, cause);
    }
    let data;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    if (!response.ok) {
      throw new KurierError(
        `Kurier ${method} ${path} returned HTTP ${response.status}: ${JSON.stringify(data)}`
      );
    }
    return data;
  }

  async registerVk(vkeyJson) {
    const data = await this.#request(
      "POST",
      `/register-vk/${encodeURIComponent(this.apiKey)}`,
      {
      proofType: "groth16",
      proofOptions: { library: "snarkjs", curve: "bn128" },
      vk: vkeyJson,
    });
    const vkHash = extractVkHash(data);
    if (!vkHash) {
      throw new KurierError(
        `register-vk response contained no vk hash: ${JSON.stringify(data)}`
      );
    }
    return { vkHash, raw: data };
  }

  async submitProof({ proof, publicSignals, vkHash }) {
    const data = await this.#request(
      "POST",
      `/submit-proof/${encodeURIComponent(this.apiKey)}`,
      {
      proofType: "groth16",
      vkRegistered: true,
      proofOptions: { library: "snarkjs", curve: "bn128" },
      proofData: { proof, publicSignals, vk: vkHash },
    });
    if (!data || !data.jobId) {
      throw new KurierError(
        `submit-proof response contained no jobId: ${JSON.stringify(data)}`
      );
    }
    if (data.optimisticVerify !== "success") {
      throw new KurierError(
        `Kurier optimistic verification did not succeed: ${JSON.stringify(data)}`
      );
    }
    return { jobId: data.jobId, raw: data };
  }

  async jobStatus(jobId) {
    const data = await this.#request(
      "GET",
      `/job-status/${encodeURIComponent(this.apiKey)}/${encodeURIComponent(jobId)}`
    );
    return data;
  }

  // Polls until Finalized, Failed, or the deadline (ms since start) passes.
  // Returns { status, txHash, blockHash, jobId } on Finalized, or
  // { status, jobId, timedOut: true } when the budget runs out (NOT an
  // error: the caller still answers with the local proof). Throws
  // KurierError on Failed or on transport errors.
  async waitForFinalized(jobId, budgetMs, { now = Date.now, sleep = defaultSleep } = {}) {
    const deadline = now() + budgetMs;
    let lastStatus = null;
    for (;;) {
      const data = await this.jobStatus(jobId);
      lastStatus = data && data.status;
      if (lastStatus === TERMINAL_OK) {
        return {
          status: lastStatus,
          txHash: data.txHash || null,
          blockHash: data.blockHash || null,
          jobId,
        };
      }
      if (lastStatus === TERMINAL_FAIL) {
        throw new KurierError(
          `Kurier job ${jobId} failed: ${JSON.stringify(data)}`
        );
      }
      if (now() + this.pollIntervalMs > deadline) {
        return { status: lastStatus, jobId, timedOut: true };
      }
      await sleep(this.pollIntervalMs);
    }
  }
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
