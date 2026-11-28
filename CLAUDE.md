# landlord — "Doudizhu Kung2" (斗地主)

Doudizhu 3 pemain di browser: Latihan lawan 2 bot, meja bareng teman (kode, tanpa rating), atau Ranked (akun bersama, rating Doudizhu).
Repo GitHub `Sylvaniaharco/landlord`, Worker Cloudflare `doudizhu`, live di https://sylvaniaharco.com/games/doudizhu/.
Saudara dari games-mahjong0hk (Mahjong Kung2) dan capsa (Capsa Kung2) — pola, tampilan, dan akun sama. README menjelaskan aturan & config.

## Cara kerja dengan Teddy (pemilik)

- Bahasa: Indonesia santai, to the point. Campur Inggris boleh.
- Langsung eksekusi pakai asumsi terbaik; sebut asumsinya singkat. Tanya hanya kalau benar-benar krusial.
- Hasil dulu, penjelasan singkat. Jangan over-engineering; kalau sesuatu gak perlu, bilang.
- Kalau nemu masalah (bug, risiko keamanan, data janggal), langsung kasih tahu walau gak ditanya.
- Semua kerja masuk GitHub (repo ini), bukan file lepas.

## Stack & deploy

- Frontend HTML/JS/CSS murni (ES modules), tanpa framework/bundler/dependensi npm. Backend: Worker `doudizhu` (`worker/index.js`, API di
  `/games/doudizhu/api/*`) + Durable Object `DdzRoom` (satu per meja, SQLite bawaan) dan `DdzLobby` (satu global: pencari meja Ranked). Tanpa D1.
- Akun ada di Worker Mahjong. Ranked memanggilnya lewat service binding `MAHJONG` → entrypoint `DoudizhuGate` (`redeem` tiket, `settle` hasil
  tangan + rating). Deploy Doudizhu gagal kalau Worker Mahjong belum punya `DoudizhuGate`: perubahan di dua repo → merge Mahjong dulu.
- `npm run build` menyalin `index.html`, `manifest.webmanifest`, `css`, `src`, `avatars`, `icons` ke `dist/games/doudizhu/` + mengisi `sw.js`
  dan `version.json`. File/folder statis baru → daftarkan di `scripts/build.mjs`.
- Deploy otomatis Cloudflare dari `main` (build `npm run build`, deploy `npx wrangler deploy`). **Merge/push ke `main` = langsung live.**
  CI `.github/workflows/test.yml` (npm test + build) harus hijau sebelum merge. Migrasi DO: tambah tag baru, jangan ubah yang lama.
- Izin tetap dari Teddy (sama dengan repo lain): setelah selesai, buat PR dan squash-merge ke `main` tanpa tanya, asal `npm test` lolos
  dan CI hijau; kabari Teddy nomor PR + isinya.

## Perintah

```bash
npm test            # node --test test/*.test.js (±40 tes, termasuk 600 tangan bot vs bot)
npm run sim         # 3000 tangan bot vs bot + statistik
npm run strength    # adu kekuatan dua level bot (mis. -- expert hard 150)
npm run dev         # static :8080 (Latihan saja)
npm run dev:online  # build + wrangler dev (meja teman). Ranked lokal: lihat README
```

## Aturan kode

- `src/engine/` murni (tanpa DOM), dipakai browser, Node, dan Worker. Jangan pakai `Math.random()` di engine; pakai `mulberry32`/`mixSeed`.
- `combos.js`: apa yang diterima `classify()`/`readPlay()` harus bisa ditemukan juga oleh `allMoves()`/`legalMoves()`. Kalau tidak,
  `canBeat()` salah → Pass otomatis di `src/main.js` membuang langkah sah, Saran buta, bot buta. (Sayap boleh dari satu rank, mis. 333444+55.)
- **Semua aturan di `src/engine/rules.config.js`** (bidding mode, show-kitty, pengali bom/roket/spring, sayap pesawat, empat+2, cap, batas bagi ulang, waktu).
  Engine & bot membaca config, jangan menaruh angka aturan di tempat lain. Ubah aturan → update README + tes (`test/combos.test.js`, `test/game.test.js`).
- `game.js`: satu tangan (state deterministik dari seed + urutan aksi, `applyAction`, `viewFor`). `viewFor` tidak boleh memuat tangan lawan,
  kartu dasar (kecuali untuk Tuan Tanah / `showKitty` / tangan selesai), atau seed.
- `room.js`: logika meja murni untuk tiga jenis meja (`friends`, `ranked`, `practice`). `worker/room.js` hanya penyimpanan + WebSocket + alarm
  (`R.due` / `R.step`); mode Latihan (`src/net/local.js`) memakai fungsi yang sama di HP. Server memvalidasi semua aksi (`R.act` → `applyAction`).
  `seat.id` (id HP / kunci kursi Ranked) dan `seat.userId` **tidak pernah** masuk `viewFor`. Meja teman: `start` hanya host, `next` (lanjut
  ke tangan berikutnya) boleh siapa saja yang masih duduk — kalau host-nya diam, meja nyangkut.
- Durable Object diuji di `test/worker.test.js`: `cloudflare:workers` diganti tiruan lewat loader hook (`test/helpers/cfstub.mjs`) dan
  `Date.now` dikunci supaya alarm bisa dimajukan. Perubahan di `worker/room.js` / `worker/lobby.js` → jalankan `npm test`.
- **Bonus harian** 100 koin di tangan Ranked pertama tiap hari dihitung **server akun** (`ddzSettle` di repo games-mahjong0hk,
  kolom `wallets.bonus_day` yang sama dengan Mahjong & Capsa Banting). Di sini cuma ditampilkan: `applySettle` → `room.last.bonus` →
  `viewFor(...).last.myBonus` → layar hasil. Jangan pernah menghitung koin/bonus di HP.
- Ranked: hasil tiap tangan → `settlePayload` → `env.MAHJONG.settle` (aman diulang; gagal → coba lagi lewat alarm). Bentuk payload harus cocok
  dengan `cleanDdzSettle` di repo games-mahjong0hk (`worker/doudizhu.js`). Rumus rating & koin ada di sana, bukan di sini.
  `settle()` dijaga `this.settling`: RPC-nya membuka input gate DO, jadi tanpa itu satu ronde bisa dikirim dua kali sekaligus.
  **Tidak ada batas pengali** (`multiplierCap: 0`, keputusan Teddy): satu tangan besar memang boleh menghabiskan saldo — min entry meja
  yang menjaga pemain koin tipis tetap di meja kecil.
- `DdzRoom` mengabari `DdzLobby` (`reopen` / `release`) waktu meja Ranked longgar lagi atau ditutup, supaya meja lama dipakai lagi
  dan pemain tidak kepecah ke meja baru yang isinya bot semua.
- **Dua saldo** (pola Capsa): koin akun (server, bersama Mahjong & Capsa) hanya bergerak di Ranked — meja `room.ranked.stake` 25/50/100/500 (`STAKES` di `src/engine/wallet.js` = `DDZ_STAKES` di repo Mahjong),
  `DdzLobby.assign(stake, user)` antre per meja, `reserve`/`nextRanked` cek saldo minimal (`src/engine/wallet.js`), angka pasti dari server akun
  (`applySettle`). Koin meja bot (`ddz-wallet` di localStorage, tidak bisa dipercaya) hanya untuk mode lawan bot: dibayar di `practiceCoins`
  (`src/main.js`), tangan yang ditinggal dihitung kalah lewat `ddz-pending`. Koin akun **tidak boleh** berubah dari permainan lawan bot.
- Bot (`bot.js`) hanya boleh membaca tangan sendiri + info publik (jumlah kartu, kartu keluar). Tes `bot tidak mengintip` menjaga ini.
  Bot di server: Ranked ikut taruhannya (`rankedLevel` di `src/engine/room.js`: meja 500 = **God**, meja 50 & 100 = **Jago**, meja 25 & meja lama = Sedang),
  meja teman = level pilihan pembuat meja, kursi yang keluar/putus = Sedang.
- `sureWin()` di `bot.js` (semua level kecuali Mudah, sebelum heuristik): kalau sisa kartu bisa keluar sekali jalan DAN langkah
  sekarang tidak bisa dikalahkan siapa pun (dicek dari gabungan kartu yang belum terlihat, bukan tangan lawan), langkah itu
  langsung dimainkan — giliran memimpin pasti balik. Tanpa ini bot menyimpan roket/bom (`costOf` menilai tangannya "bagus")
  sampai keduluan lawan. Diukur A/B seed sama: +0,2 poin/tangan, biaya waktu tidak terukur. Bom/roket didahulukan (pengali naik).
- Level **Jago** (`expert`) = heuristik Sulit menyaring 6 langkah terbaik, lalu Monte Carlo: 16 dunia diundi dari kartu yang belum
  terlihat (bukan dari tangan lawan — jangan sampai bocor), tiap dunia dimainkan sampai habis dengan bot Sulit, dipilih yang paling
  sering menang. Seed dunia dari `g.seed` + jumlah langkah (bukan dari `rnd` pemanggil) supaya keputusan tetap bisa diulang.
  Rata-rata 16 dunia itu kasar (1 dunia = 0,125), jadi pilihan heuristik diberi bonus `EXPERT.prior` dan pass diberi `EXPERT.mate`
  kalau teman yang terakhir main — tanpa itu petani menimpa langkah temannya sendiri (35% → 6%, dijaga tes
  `petani tidak menimpa langkah temannya sendiri`).
  ±20 ms/keputusan. Level **God** memakai kode pencarian yang sama dengan angka lebih berat (`SEARCH` di `bot.js`: 48 dunia /
  96 di akhir tangan, 9 langkah, `maxUnseen` 42, `prior` 0,1) + dunia yang cocok dengan petunjuk pass (`passClues`),
  ±80 ms/keputusan — aman karena server hanya mengerjakan satu keputusan per alarm. Diukur +0,13 poin/tangan di atas Jago
  (1.680 tangan, tipis) dan +1,57 di atas Sulit.
  Ubah bot → ukur lagi dengan `npm run strength` (mis. `node scripts/strength.mjs god expert 60`), jangan
  menaruh adu kekuatan di `npm test` (ratusan tangan, terlalu lama & berisik).
- **Emote** di meja online (`EMOTES` di `src/engine/room.js`, tulisannya `EMOTE_WORDS` di `src/main.js`): daftar tertutup, klien hanya
  mengirim kuncinya — **jangan** pernah menerima teks bebas dari HP (tidak ada yang perlu dimoderasi, dan emote ikut terjemahan).
  Satu per kursi tiap `SAY_COOLDOWN_MS`, ditolak diam-diam. `room.chat` hanya memuat `{id, seat, k, at}` (tanpa id pemain).
  Disembunyikan di mode Latihan. Di Ranked ini kanal informasi kecil antar pemain — kalau nanti anti-kolusi diperketat, tinjau lagi.
- Teks UI bahasa Indonesia lewat `tx('...')` (atau `data-t` di HTML); terjemahan English di `src/ui/lang-en.js`, dicek `test/i18n.test.js`.
  `EMOTE_WORDS` ikut dicek di situ, jadi emote baru wajib punya terjemahan.
- Akun: `src/ui/account.js` memanggil API Mahjong dari origin yang sama (`/me`, `/config`, `/auth/logout`, `/auth/ticket`, `/errors` mode
  `doudizhu`, `/doudizhu/leaderboard`, `/doudizhu/me`). Login `?next=doudizhu`. Aktif hanya kalau dibuka dari `/games/doudizhu/`.
- Bot = karakter Mahjong Kung2 (`src/engine/roster.js` + `avatars/` disalin dari repo capsa/mahjong). Avatar pemain ikut `hkmj-settings-v1`.

## UI yang perlu diingat

- **Musik latar** = salinan `src/ui/music.js` repo games-mahjong0hk (generatif Web Audio, tanpa file), setelan nyala/mati di localStorage `mjhk-music`
  (sama dengan Mahjong, jadi berlaku di semua game). `initMusic([tombol...], { label })`: tombol `data-music="label"` = tulisan di lobi, lainnya ikon 🎵/🔇.
  Kalau musik Mahjong berubah, salin lagi (bagian suara jangan diubah sendiri).

- Ukuran dari `--vw`/`--vh` (`fit()` di `src/main.js`), kelas `.portrait` kalau layar tegak; di portrait tangan jadi 2 baris (`.hand.rows`).
  Cek di HP landscape (915×412) dan portrait (412×915) sebelum merge.
- Kursi tampilan: 0 = saya (bawah), 1 = kanan (giliran berikutnya), 2 = kiri (`toSeat`). Efek (bom, roket, pesawat, spring, Tuan Tanah)
  dipicu dari `game.log` (id naik terus per tangan) di `playEffects`.
- `manifest.webmanifest`: jangan pakai `"orientation": "landscape"` / `display: fullscreen`, jangan ganti `id` (pengalaman di Mahjong/Capsa).
