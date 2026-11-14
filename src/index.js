// Entry point: validate config, wire dependencies, start the server.
// Fails fast with a clear message when the HMAC secret or circuit files
// are missing, so a misconfigured deployment is loud instead of silently
// rejecting every task.
import { assertConfig, loadConfig } from "./config.js";
import { SeenSet } from "./seenSet.js";
import { KurierClient } from "./kurier.js";
import { createAgent } from "./agent.js";
import { createServer } from "./server.js";

const config = loadConfig();
try {
  assertConfig(config);
} catch (cause) {
  console.error(`FATAL: ${cause.message}`);
  process.exit(1);
}

const seenSet = new SeenSet(config.seenSetPath);
const kurierClient = config.kurierEnabled
  ? new KurierClient({
      apiUrl: config.kurierApiUrl,
      apiKey: config.kurierApiKey,
      pollIntervalMs: config.kurierPollIntervalMs,
    })
  : null;
const agent = createAgent({ config, seenSet, kurierClient });
const server = createServer({ config, agent });

server.listen(config.port, () => {
  console.log(
    JSON.stringify({
      level: "info",
      event: "listening",
      port: config.port,
      kurier: config.kurierEnabled ? "enabled" : "disabled",
      vkHash: config.vkHash,
    })
  );
});
