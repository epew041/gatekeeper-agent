# TEST REPORT — gatekeeper-agent

Tanggal: 15 November 2026 (WIB). Semua hasil di bawah adalah output NYATA
dari eksekusi lokal. Tidak ada hasil yang dikarang.

## Ringkasan

- Perintah: `npm test` → `node --test --test-force-exit test/*.test.js`
- Hasil: **46 test, 46 lolos, 0 gagal** (durasi 9,07 detik).
- Node v24.22.1, snarkjs 0.7.6.
- Satu kegagalan ditemukan dan diperbaiki selama pengembangan (bukan
  disembunyikan): parser field menolak prefix hex `0X` kapital — diperbaiki
  di `src/encode.js`; dan satu test mock Kurier kekurangan respons skrip —
  diperbaiki di test-nya. Setelah perbaikan, seluruh suite hijau.

## Daftar test (46)

### HMAC (`test/hmac.test.js`, 7)

- sign then verify round-trips
- wrong signature is rejected
- tampered body is rejected
- wrong secret is rejected
- sha256= prefixed hex is accepted
- base64 form is accepted
- missing, empty, and garbage signatures are rejected

### Keputusan (`test/decide.test.js`, 14)

- valid condition approves and is provable
- wrong VK rejects with VK_SUBSTITUTION and stays provable (decision 0)
- below-threshold balance rejects with THRESHOLD_MISMATCH
- wrong recipient rejects with RECIPIENT_MISMATCH
- replayed proof ref rejects with PROOF_REUSED and is NOT provable
- expired condition rejects with EXPIRED_CONDITION
- current block EQUAL to expiry is expired (strict)
- amount overflow rejects with AMOUNT_OVERFLOW
- boundary equalities approve: balance == minimum, amount == cap
- checksummed vs lowercase recipient spellings compare equal
- reuse takes precedence over a VK mismatch
- malformed fields fail closed with mapped codes
- missing proof_tx fails closed as a proof-identity failure
- missing task_id / input throws MalformedTaskError

### Encoding (`test/encode.test.js`, 5)

- parseFieldValue accepts numbers, decimals, and hex
- parseFieldValue rejects garbage
- toField reduces modulo the field prime
- normalizeHex is case/prefix/zero-insensitive
- taskId and salt encodings are deterministic and distinct

### Prover — proof NYATA dari circuit resmi (`test/prover.test.js`, 3)

- valid approve scenario generates a proof that verifies locally
  (13 public signals, decision index 11 == "1", `groth16.verify` == true)
- reject scenario (wrong VK) generates a verifying decision-0 proof
  (decision index 11 == "0", `groth16.verify` == true)
- decision bit inconsistent with checks cannot prove (circuit assert →
  ProverError)

### Kurier — mock fetch, TANPA jaringan (`test/kurier.test.js`, 8)

- register-vk uses the documented URL and body, returns vkHash
- register-vk tolerates an already-registered uniq_vk_hash response
- submit-proof uses the documented URL and body, returns jobId
- submit-proof rejects a non-success optimisticVerify
- job-status uses /job-status/{API_KEY}/{jobId} and polling reaches Finalized
- polling a Failed job throws
- polling times out cleanly (timedOut, not an error)
- HTTP errors surface as KurierError

### Orkestrasi agent (`test/agent.test.js`, 5)

- approve returns decision + locally verified proof, no proof_tx without Kurier
- retry of the same task_id returns the identical cached response
- a second task reusing an approved proof ref is rejected as PROOF_REUSED
  without proof
- Kurier success path attaches the finalized txHash as proof_tx (mocked Kurier)
- Kurier failure never blocks the answer (decision + proof still returned)

### Server HTTP sungguhan (`test/server.test.js`, 4)

- health check answers 200 with a signed body
- unsigned and wrongly signed task POSTs are rejected 401
- valid signed task returns APPROVE with proof and a valid response signature;
  retry returns the byte-identical response
- signed preflight-style POST without task fields answers OK

## Smoke test server sungguhan (entry point `src/index.js`)

Dijalankan terpisah dari suite, dengan secret uji via environment:

```
NO_SECRET_EXIT: 1 | stderr: FATAL: AGENT_HMAC_SECRET is not set (or still a placeholder). ...
HEALTH: 200 {"status":"ok","service":"gatekeeper-agent","kurier":"disabled"}
TASK: 200 APPROVE VALID_CONDITION | proof? true | pubSignals: 13 | ms: 1382
BAD_SIG: 401 {"error":"bad_signature"}
```

## Probe circuit (bukan test suite; temuan empiris)

Dilakukan terhadap artefak resmi dengan snarkjs, sebelum kode ditulis
(detail di `circuits/CIRCUIT_NOTES.md`):

- 13 nama sinyal input ditemukan lengkap lewat tabel hash wasm; jumlahnya
  cocok dengan `getInputSize() == 13` dan `nPublic == 13`.
- Urutan public signals dipetakan dengan nilai pembeda.
- Semantik terbukti: decision=1 butuh semua cek lolos; decision=0 butuh
  minimal satu cek gagal; expiry STRICT (`current == expiry` gagal);
  batas kesetaraan balance/amount lolos; alamat 160-bit + hash VK 256-bit
  penuh menghasilkan proof yang terverifikasi.
- Waktu proving lokal: ~0,25–1,7 detik per proof.

## Yang TIDAK diuji (jujur)

- TIDAK ada panggilan Kurier/mainnet live (tidak ada API key; dilarang
  oleh tugas). Semua uji Kurier memakai mock fetch.
- TIDAK ada health check / preflight / practice / ronde skor langsung
  dari platform (butuh deploy + registrasi dari HP + secret asli).
- TIDAK ada pengujian beban (load) atau konkurensi tinggi.
- Encoding `taskId`, format tanda HMAC, dan field `proof`/`public_signals`
  pada respons adalah pilihan yang ditandai TO-VERIFY di README.md dan
  harus dikonfirmasi lewat practice mode setelah deploy.
