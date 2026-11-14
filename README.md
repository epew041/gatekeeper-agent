# Agent Gatekeeper — Agent Games (zkVerify)

Agent orisinal untuk track **Proof Gatekeeper** di kompetisi Agent Games.
Ditulis dari dokumentasi resmi dan artefak circuit resmi saja — bukan
salinan kode peserta lain.

## Apa yang dilakukan agent ini

Setiap task yang masuk adalah satu keputusan APPROVE/REJECT atas sebuah
kondisi pembayaran berbasis proof. Agent ini:

1. Menerima POST JSON bertanda HMAC di endpoint terdaftar.
2. Memverifikasi tanda `x-agent-games-signature` pada **raw body sebelum
   parsing**; request tanpa tanda yang valid ditolak (401).
3. Menjalankan cek deterministik dari dokumen resmi (lihat urutan di
   bawah), fail-closed: field yang hilang/rusak membuat cek yang
   bersangkutan gagal, memakai HANYA reason code yang didokumentasikan.
4. Membuat proof Groth16 secara lokal dengan snarkjs dari circuit resmi,
   lalu memverifikasi proof itu secara lokal sebelum menjawab.
5. Jika Kurier dikonfigurasi: mengirim proof ke Kurier dan menunggu status
   `Finalized` dalam batas waktu; `txHash` final dipakai sebagai
   `proof_tx`. Kurier yang lambat/gagal TIDAK PERNAH memblokir jawaban:
   keputusan + proof lokal tetap dikirim.
6. Mencatat proof ref dari APPROVE ke seen-set (file `seen-set.json`) agar
   pemakaian ulang terdeteksi, dan mengembalikan respons yang IDENTIK
   untuk retry dengan `task_id` yang sama.

### Urutan cek (alasan pertama yang gagal menentukan `reason_code`)

| Prioritas | Cek | `reason_code` saat gagal |
|---|---|---|
| 1 | Proof ref sudah pernah di-APPROVE | `PROOF_REUSED` (tanpa proof) |
| 2 | `proof_vk == registered_vk` | `VK_SUBSTITUTION` |
| 3 | `public_balance >= minimum` | `THRESHOLD_MISMATCH` |
| 4 | `recipient == condition_recipient` | `RECIPIENT_MISMATCH` |
| 5 | `amount <= max_transfer` | `AMOUNT_OVERFLOW` |
| 6 | `current_block < expiry_block` (STRICT) | `EXPIRED_CONDITION` |

Semua cek lolos → `APPROVE` / `VALID_CONDITION`. Circuit resmi juga
memberlakukan konsistensi yang sama: bit `decision` yang berbohong tidak
bisa menghasilkan proof. Detail empiris circuit ada di
[`circuits/CIRCUIT_NOTES.md`](circuits/CIRCUIT_NOTES.md).

## Arsitektur

```
POST / (atau /agent)                GET /, /agent, /health
  │ raw body → verifikasi HMAC        │ → 200 { status: "ok" }
  ▼                                     ▼
server.js ──► agent.js ──► decide.js (cek murni, tanpa I/O)
                 │              │
                 │              └──► encode.js (field elements, salt/taskId)
                 ├──► prover.js (snarkjs fullProve + verify lokal)
                 ├──► kurier.js (submit-proof + poll job-status)
                 └──► seenSet.js (idempotensi + reuse, persistensi file)
```

Satu-satunya dependensi runtime: `snarkjs`. Server memakai modul bawaan
Node (`http`, `crypto`, `fs`, `fetch`).

## Menjalankan lokal (uji saja, BUKAN untuk kompetisi)

```bash
cd gatekeeper-agent
npm install
npm test            # 46 test; lihat TEST_REPORT.md
cp .env.example .env
# isi AGENT_HMAC_SECRET di .env dengan secret UJI (bukan secret asli!)
npm start           # jalan di http://localhost:3000
```

Server menolak start tanpa `AGENT_HMAC_SECRET` yang valid.

## Deploy ke HTTPS publik

Agent harus bisa dijangkau di **HTTPS publik, tanpa localhost, IP privat,
atau port custom**, dan harus **selalu menyala**: hosting yang "tidur"
setelah idle membuat task hangus (aturan resmi 1.4). Langkah umumnya,
terlepas dari penyedia hosting apa pun:

1. Push kode ini ke repo GitHub milik Sir (jangan pernah commit `.env`).
2. Buat layanan/hosting baru dari repo tersebut, dengan perintah start
   `npm install && npm start` (atau setara), Node 20+.
3. Atur environment variables di bawah ini di panel hosting (BUKAN di kode).
4. Pastikan URL publiknya merespons `GET /health` dengan 200.
5. Lanjutkan ke langkah HP di bawah (daftar endpoint, practice, preflight).

Contoh yang TIDAK terverifikasi: sebuah artikel peserta menyebut hosting
di Vercel. Artikel itu bukan sumber resmi dan kepemilikan akun hosting apa
pun milik Sir tidak diasumsikan di sini. Pilih penyedia apa pun yang
memenuhi syarat di atas; agent ini tidak terikat pada satu penyedia.

### Environment variables

| Variabel | Wajib? | Keterangan |
|---|---|---|
| `AGENT_HMAC_SECRET` | Ya | Secret 32-byte dari dashboard, tampil SEKALI saat registrasi agent. |
| `KURIER_API_KEY` | Dianjurkan | API key Kurier mainnet. Tanpa ini agent tetap menjawab dengan proof lokal, tetapi tanpa `proof_tx` on-chain. |
| `VK_HASH` | Tidak | Default: hash resmi dari `/api/circuit-info`. |
| `KURIER_API_URL` | Tidak | Default: `https://api.kurier.xyz/api/v1` (mainnet, dari docs resmi). |
| `PORT` | Tidak | Default `3000`; hosting biasanya mengatur sendiri. |
| `TASK_TIMEOUT_MS` | Tidak | Default `50000` (di bawah deadline 60 detik). |
| `SEEN_SET_PATH` | Tidak | Default `./seen-set.json`. **Perhatian**: di hosting tanpa disk persisten (mis. fungsi serverless), seen-set hilang tiap restart dan deteksi reuse melemah. Untuk deployment seperti itu, pindahkan seen-set ke penyimpanan persisten sebelum ronde skor. |

## Kurier API key (diurus Sir sendiri)

Menurut dokumentasi resmi zkVerify
(`docs.zkverify.io/overview/getting-started/kurier`): untuk memakai Kurier
dibutuhkan API key, yang dibuat dengan **mendaftar di situs Kurier**
(tautan "here for mainnet" di dokumen tersebut, mengarah ke kurier.xyz;
tautan testnet terpisah). Detail langkah pendaftaran di dalam situs Kurier
TIDAK diverifikasi di sini — ikuti alur di situsnya dan pakai key
**mainnet**. JANGAN pernah menempel key itu ke chat atau ke AI tool;
tempel langsung ke environment variables hosting.

Catatan: VK circuit ini SUDAH terdaftar di mainnet (hash-nya dipublikasi
di `/api/circuit-info`), jadi agent tidak perlu memanggil `register-vk`
saat jalan normal; ia memakai `VK_HASH` dan `vkRegistered: true`.

## Langkah yang HARUS Sir lakukan sendiri dari HP

Agent ini tidak bisa login ke dashboard (sesi login hanya ada di browser
HP Sir). Setelah deploy sehat:

1. Di dashboard Agent Games, buka **Manage agents** → daftarkan URL
   endpoint publik agent (URL yang sama dengan yang merespons health).
2. **Salin HMAC secret yang tampil SEKALI itu** dan tempel ke environment
   variable `AGENT_HMAC_SECRET` di hosting, lalu restart/deploy ulang
   layanan. Secret lama berhenti bekerja seketika jika di-rotate.
3. Pastikan GitHub dan wallet sudah terhubung di profil (syarat hadiah).
4. Loloskan **health check**, selesaikan **signed preflight**, dan kerjakan
   **minimal 1 practice task** sebelum ronde skor (practice tidak masuk
   skor, dibatasi 10/jam, formatnya identik dengan task skor).
5. Periksa log hosting setelah practice pertama: harus ada `task_done`
   dengan decision yang benar. Jika preflight gagal, kemungkinan besar
   penyebabnya ada di daftar TO-VERIFY di bawah — kabari dan sertakan
   pesan error persisnya.

## Kejujuran: apa yang sudah vs BELUM diuji

Sudah diuji secara lokal (bukti di `TEST_REPORT.md`):

- HMAC: penolakan tanda salah/rusak, penerimaan bentuk hex/base64.
- Semua 6 jenis trap + kondisi valid + kasus batas (kesetaraan).
- Retry `task_id` sama → respons identik; reuse proof ref → ditolak.
- Proof Groth16 ASLI dari circuit resmi + verifikasi lokal OK (approve
  dan reject); bit keputusan yang berbohong tidak bisa membuktikan.
- Kurier: bentuk request/response persis sesuai docs, diuji dengan mock
  (TIDAK ada panggilan live — tidak ada API key).
- Server HTTP sungguhan: health 200, 401 untuk tanda salah, jawaban
  bertanda yang valid.

BELUM diuji (butuh deploy + registrasi + API key, di luar jangkauan build
lokal ini):

- Health check, signed preflight, dan practice task LANGSUNG dari
  platform.
- Ronde skor langsung, termasuk beban dan perilaku retry platform.
- Pengiriman Kurier live sampai `Finalized` dan penerimaan `proof_tx`.
- Bentuk respons: field `proof`/`public_signals` mengikuti konvensi yang
  didokumentasikan untuk Steal the VFY + perintah `/build` ("include the
  proof in your response"); bentuk Gatekeeper yang ditampilkan resmi hanya
  `{decision, reason_code, proof_tx}`. Jika platform menolak field
  tambahan, sesuaikan di `src/agent.js` (satu tempat).
- Algoritma/encoding HMAC: diasumsikan HMAC-SHA256 (hex untuk respons).
  Verifikasi dibuat toleran (hex/base64, prefix opsional); penandatanganan
  respons adalah tebakan konvensi yang paling umum. Jika preflight gagal
  karena tanda, ubah HANYA `src/hmac.js`.
- Encoding `taskId` dari string (mis. `gk_24_9d1`) menjadi field element:
  dipakai SHA-256 deterministik. Proof tetap valid untuk nilai apa pun,
  tetapi kecocokan silang platform (jika ada) tidak terverifikasi. Ubah
  HANYA `src/encode.js` bila practice menunjukkan lain.
- Langkah 2 checklist ("call zkVerifyJS untuk konfirmasi on-chain"):
  TIDAK diimplementasikan sebagai lookup on-chain, karena tidak ada API
  publik terdokumentasi untuk mencari proof dari `proof_tx`. Yang
  diimplementasikan adalah perbandingan VK dari payload. Agent tidak
  mengklaim verifikasi on-chain yang tidak dilakukannya. zkVerifyJS
  sengaja tidak dipakai karena jalurnya membutuhkan seed phrase.
- Persistensi seen-set di hosting serverless (lihat catatan di atas).

## Keamanan

- Tidak ada secret, seed, atau key di repo ini. `.env` ada di
  `.gitignore`. Secret HMAC dan API key hanya hidup di environment hosting.
- Log tidak pernah mencetak secret, isi body mentah, atau nilai tanda.
- Semua respons gagal-aman (fail closed): keraguan = REJECT, dan jawaban
  selalu diusahakan sebelum deadline 60 detik.

## Sumber

- `https://agentgames.zkverify.io/rules`
- `https://agentgames.zkverify.io/build`
- `https://agentgames.zkverify.io/events/proof-gatekeeper`
- `https://agentgames.zkverify.io/api/circuit-info` (vkHash + URL artefak)
- `https://docs.zkverify.io/overview/getting-started/kurier` (API Kurier)
- `https://docs.zkverify.io/handbook/quickstart` (konfirmasi bentuk Kurier)
