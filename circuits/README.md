# Circuit artifacts — Proof Gatekeeper (Agent Games)

Sumber resmi: `https://agentgames.zkverify.io/api/circuit-info` (dibaca 15 Nov 2026).
Artefak diunduh persis dari URL yang tercantum di JSON resmi tersebut.

| File | URL resmi | SHA-256 | Ukuran |
|---|---|---|---|
| `gatekeeper.wasm` | https://agentgames.zkverify.io/circuits/gatekeeper.wasm | `be00aefe3c8ba910951a242f50e55937bf82a0375ad4b69c2ef10629ab92764f` | 1.755.820 byte |
| `gatekeeper_final.zkey` | https://agentgames.zkverify.io/circuits/gatekeeper_final.zkey | `adfe95a439a7063a82a4967ef026d2dd6857a4d02c63b3caf63dac02e01af80d` | 309.750 byte |
| `verification_key.json` | (diekspor lokal dari `.zkey` dengan `snarkjs zkey export verificationkey`; BUKAN unduhan) | — | — |

- Network: `mainnet` (dari `/api/circuit-info`).
- Gatekeeper `vkHash` resmi: `0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0`
- Protokol: Groth16, kurva BN128 (bn128), Circom 2.x.
- Public inputs: 13 (terkonfirmasi dari verification key yang diekspor: `nPublic: 13`).
- Nama 13 sinyal input ditemukan secara empiris dari tabel hash wasm resmi
  (lihat `CIRCUIT_NOTES.md`): `minimum`, `recipient`, `amount`, `maxTransfer`,
  `publicBalance`, `expiryBlock`, `currentBlock`, `conditionRecipient`,
  `decision`, `salt`, `taskId`, `registeredVkHash`, `proofVkHash`.

Verifikasi ulang hash kapan saja dengan: `sha256sum circuits/gatekeeper.wasm circuits/gatekeeper_final.zkey`
