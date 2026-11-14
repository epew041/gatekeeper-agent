# Circuit notes — gatekeeper circuit (empirical findings)

Semua temuan di bawah diperoleh LANGSUNG dari artefak resmi
(`gatekeeper.wasm` + `gatekeeper_final.zkey` dari `/api/circuit-info`) dengan
snarkjs 0.7.6. Tidak ada yang disalin dari kode peserta lain. Skrip probe
yang dipakai bersifat sekali jalan dan tidak disimpan di repo ini; hasil
probe yang dapat diulang tercakup oleh `test/prover.test.js`.

## Identitas circuit

- Template: `GatekeeperEvaluation` (nama terlihat dari pesan assert wasm).
- Protokol: Groth16, kurva BN128, Circom 2.x (`getVersion() == 2`).
- `nPublic = 13`, ukuran witness 647 sinyal, total sinyal input 13.
- `vkHash` resmi (mainnet): `0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0`

## Nama 13 sinyal input

Halaman `/build` TIDAK mencantumkan nama sinyal input. Nama-nama ini
ditemukan dengan memindai kandidat terhadap tabel hash sinyal di dalam wasm
resmi (`getInputSignalSize` + hash FNV-1a 64-bit, sesuai implementasi
`circom_runtime`). Ketigabelas nama cocok dan jumlahnya sama dengan
`getInputSize() == 13`, jadi daftar ini lengkap:

| # | Nama sinyal | Ukuran | Publik? |
|---|---|---|---|
| 1 | `minimum` | 1 | ya |
| 2 | `recipient` | 1 | ya |
| 3 | `amount` | 1 | ya |
| 4 | `maxTransfer` | 1 | ya |
| 5 | `publicBalance` | 1 | ya |
| 6 | `expiryBlock` | 1 | ya |
| 7 | `currentBlock` | 1 | ya |
| 8 | `conditionRecipient` | 1 | ya |
| 9 | `decision` | 1 | ya |
| 10 | `salt` | 1 | TIDAK (privat) |
| 11 | `taskId` | 1 | ya |
| 12 | `registeredVkHash` | 1 | ya |
| 13 | `proofVkHash` | 1 | ya |

## Urutan public signals (output `fullProve`)

Diperoleh dengan menjalankan `fullProve` memakai nilai pembeda per sinyal:

```
[0]  hashOutput          <- output circuit, BUKAN input
[1]  registeredVkHash
[2]  proofVkHash
[3]  minimum
[4]  publicBalance
[5]  expiryBlock
[6]  currentBlock
[7]  recipient
[8]  conditionRecipient
[9]  amount
[10] maxTransfer
[11] decision
[12] taskId
```

`hashOutput` berubah jika `salt` ATAU `taskId` berubah, dan TIDAK berubah
jika `minimum` berubah. Artinya hash tersebut mengikat (salt, taskId) —
kemungkinan Poseidon(salt, taskId) atau sejenisnya. Agent tidak perlu
menghitung ulang hash ini: circuit yang menghitungnya. `salt` tidak pernah
dikirim ke mana pun (input privat).

## Semantik constraint (diuji dengan prove + verify)

- `decision` HARUS konsisten dengan hasil cek: `decision=1` mengharuskan
  SEMUA cek lolos; `decision=0` mengharuskan MINIMAL SATU cek gagal.
  Bit keputusan yang berbohong membuat witness gagal di assert
  (`GatekeeperEvaluation line: 102`) sehingga proof tidak bisa dibuat.
- Cek yang diberlakukan circuit:
  - `registeredVkHash == proofVkHash`
  - `publicBalance >= minimum` (kesetaraan LOLOS)
  - `recipient == conditionRecipient`
  - `amount <= maxTransfer` (kesetaraan LOLOS)
  - `currentBlock < expiryBlock` (STRICT: kesetaraan GAGAL / expired)
- Tidak ada cek reuse di dalam circuit (reuse ditangani oleh seen-set agent,
  sesuai aturan skor: task PROOF_REUSED tidak punya proof untuk dikirim).
- Nilai `salt`/`taskId` apa pun diterima circuit (diuji: 0, kecil, dan
  30-digit). Encoding `taskId` dari string task (mis. `gk_24_9d1`) TIDAK
  didokumentasikan resmi; agent memakai SHA-256 deterministik (lihat
  `src/encode.js`, ditandai TO-VERIFY).
- Encoding terverifikasi: alamat 160-bit dan hash VK 256-bit penuh, dioper
  sebagai BigInt desimal, menghasilkan proof yang lolos verifikasi lokal
  (witness calculator mereduksi nilai modulo prima field BN128).

## Waktu proving lokal

Sekali `fullProve` + verifikasi lokal: ~0,25–1,7 detik di VM ini (CPU
berbagi 1,5 core). Jauh di bawah deadline 60 detik; biaya waktu utama
saat live adalah polling Kurier, bukan proving.
