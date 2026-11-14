// Config: reads environment variables, validates the ones the agent cannot
// run without, and exposes a single frozen config object. No secrets are
// ever logged or given default values here.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function loadDotEnv() {
  // Minimal .env parser (no dependency). Only fills variables that are not
  // already set in the real environment. Lines: KEY=value, quotes stripped.
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const rawLine of fs.readFileSync(envPath, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotEnv();

const PLACEHOLDER_HINTS = ["PASTE_", "CHANGE_ME", "REPLACE_ME", "YOUR_"];

function readSecret(name) {
  const value = (process.env[name] || "").trim();
  if (!value) return "";
  if (PLACEHOLDER_HINTS.some((h) => value.includes(h))) return "";
  return value;
}

export function loadConfig(env = process.env) {
  const hmacSecret = readSecret("AGENT_HMAC_SECRET");
  const kurierApiKey = readSecret("KURIER_API_KEY");
  const config = {
    port: Number(env.PORT || 3000),
    hmacSecret,
    kurierApiKey,
    kurierEnabled: Boolean(kurierApiKey),
    kurierApiUrl: (env.KURIER_API_URL || "https://api.kurier.xyz/api/v1").replace(
      /\/$/,
      ""
    ),
    vkHash:
      env.VK_HASH ||
      "0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0",
    taskTimeoutMs: Number(env.TASK_TIMEOUT_MS || 50000),
    kurierPollIntervalMs: 5000,
    kurierBudgetMs: 40000,
    seenSetPath: env.SEEN_SET_PATH || path.join(ROOT, "seen-set.json"),
    circuitsDir: env.CIRCUITS_DIR || path.join(ROOT, "circuits"),
    wasmPath:
      env.CIRCUIT_WASM_PATH || path.join(ROOT, "circuits", "gatekeeper.wasm"),
    zkeyPath:
      env.CIRCUIT_ZKEY_PATH ||
      path.join(ROOT, "circuits", "gatekeeper_final.zkey"),
    vkeyPath:
      env.CIRCUIT_VKEY_PATH ||
      path.join(ROOT, "circuits", "verification_key.json"),
  };
  return Object.freeze(config);
}

export function assertConfig(config) {
  if (!config.hmacSecret) {
    throw new Error(
      "AGENT_HMAC_SECRET is not set (or still a placeholder). " +
        "Copy the 32-byte secret shown ONCE when the agent is registered " +
        "in the Agent Games dashboard into the hosting environment and restart."
    );
  }
  if (!fs.existsSync(config.wasmPath)) {
    throw new Error(`Circuit WASM not found: ${config.wasmPath}`);
  }
  if (!fs.existsSync(config.zkeyPath)) {
    throw new Error(`Circuit zkey not found: ${config.zkeyPath}`);
  }
  if (!fs.existsSync(config.vkeyPath)) {
    throw new Error(`Verification key not found: ${config.vkeyPath}`);
  }
}
