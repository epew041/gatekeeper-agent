// Shared fixtures: task envelopes in the documented sample-payload shape.
// All addresses/hashes below are FABRICATED test values (except the
// published gatekeeper vkHash, reused as a fixture value). No real secrets.
export const VK_HASH =
  "0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0";
export const OTHER_VK_HASH =
  "0xa4c100000000000000000000000000000000000000000000000000000000b8ff";
export const RECIPIENT = "0xDe42000000000000000000000000000000009f01";
export const OTHER_RECIPIENT = "0xBEEF00000000000000000000000000000000000001";
export const PROOF_TX =
  "0xa4c1000000000000000000000000000000000000000000000000000000008ff1";

export function makeTask(overrides = {}) {
  const { input: inputOverrides = {}, ...rest } = overrides;
  const now = new Date();
  return {
    type: "agent-games.proof-gatekeeper.v1",
    task_id: "gk_test_001",
    mode: "competition",
    issued_at: now.toISOString(),
    deadline_at: new Date(now.getTime() + 60000).toISOString(),
    input: {
      registered_vk: VK_HASH,
      proof_vk: VK_HASH,
      minimum: "1000",
      public_balance: "1460",
      expiry_block: 19842201,
      current_block: 19832000,
      recipient: RECIPIENT,
      condition_recipient: RECIPIENT,
      amount: "500",
      max_transfer: "1000",
      proof_tx: PROOF_TX,
      ...inputOverrides,
    },
    ...rest,
  };
}
