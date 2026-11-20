# Doudizhu Kung2 (斗地主 · Lawan Tuan Tanah)

Doudizhu 3 pemain di browser, satu keluarga dengan **Mahjong Kung2** dan **Capsa Kung2** (akun & tampilan sama).
Live di **https://sylvaniaharco.com/games/doudizhu/** (Worker `doudizhu`, repo ini).

- **Lawan 2 bot** (Mudah / Sedang / Sulit / Jago / God) — tanpa login, jalan di HP (juga offline). Meja **Latihan** (tanpa koin) atau meja koin
  **25 / 50 / 100 / 500** pakai koin meja bot di HP (saldo awal 1.000, minimal 500 / 2.000 / 5.000 / 50.000, reset ke 1.000
  jam 00.01 WIB kalau di bawah 500). Tangan bermeja koin yang ditinggal (keluar / app ditutup) dihitung kalah.
- **Main bareng teman** — buat meja, bagikan kode 5 huruf / link `…/games/doudizhu/#room=KODE`. Kursi kosong diisi bot. Tanpa rating.
- **Ranked** — butuh login Google (akun bersama). Pilih meja **25 / 50 / 100 / 500 koin per poin** (koin akun yang sama dengan Mahjong & Capsa,
  saldo minimal 500 / 2.000 / 5.000 / 50.000). Pencari meja otomatis per meja; kalau 15 dtk belum ada lawan, kursi kosong diisi bot (🤖).
  Tiap tangan: koin = poin × meja (saldo tidak bisa di bawah 0, yang kabur tidak dapat untung) + rating Doudizhu (Elo, tier Bronze → Master),
  papan peringkat & riwayat tangan. Saldo kurang dari minimal meja = dilepas dari meja.
  Bot pengisi kursi: meja **500 pakai bot God**, meja **50 & 100 bot Jago**, meja 25 bot Sedang (`rankedLevel` di `src/engine/room.js`).

## Stack

Sama persis dengan Capsa: HTML/JS/CSS murni (ES modules), tanpa framework, tanpa bundler, tanpa dependensi npm.
Server: Cloudflare Worker `doudizhu` + Durable Object (SQLite bawaan DO, **tanpa D1**):

| Bagian | File |
| --- | --- |
| Aturan (semua flag & angka) | `src/engine/rules.config.js` |
| Kartu, kombinasi, tawar, skor | `src/engine/cards.js`, `combos.js`, `game.js` |
| Bot 4 level + Saran | `src/engine/bot.js` |
| Logika meja (teman, Ranked, latihan) | `src/engine/room.js` (murni, dites) |
| Worker / DO meja / pencari meja Ranked | `worker/index.js`, `worker/room.js` (`DdzRoom`), `worker/lobby.js` (`DdzLobby`) |
| Klien | `src/main.js`, `src/net/online.js` (WebSocket + sambung ulang), `src/net/local.js` (latihan), `src/ui/*` |

**Akun:** tidak ada sistem login baru. Doudizhu memakai akun Mahjong Kung2 persis seperti Capsa:
halaman memanggil `/games/mahjonghk/api/me` (satu origin → cookie login `mjsid` ikut), login lewat
`/games/mahjonghk/api/auth/google?next=doudizhu` (redirect URI Google yang sudah ada, tidak ada OAuth client baru).
Ranked: HP minta tiket sekali pakai (`POST /games/mahjonghk/api/auth/ticket`), Worker Doudizhu menukarnya lewat **service binding**
`MAHJONG` → entrypoint `DoudizhuGate` di Worker `games-mahjong0hk`. Hasil tiap tangan Ranked disimpan di server akun yang sama
(tabel `doudizhu_ratings`, `doudizhu_matches`, `doudizhu_match_players`, kunci = id akun bersama — tabel user tidak diduplikasi).

## Aturan (versi Teddy)

54 kartu, 3 pemain, 17 kartu + 3 kartu dasar tertutup. Urutan: 3 4 5 6 7 8 9 10 J Q K A 2 joker-hitam joker-merah, lambang tidak dipakai.

- **Tawar:** Panggil (叫地主) / Pass, lalu Rebut (抢地主) / Pass. Tiap Panggil & Rebut = pengali ×2 (tanpa tawaran 1/2/3). Skor dasar 1.
  Mulai dari pemain acak di tangan pertama, lalu bergiliran. Yang pass sebelum ada panggilan tidak bisa merebut. Pemanggil pertama dapat
  kesempatan terakhir merebut balik kalau ada yang merebut. Perebut terakhir (atau satu-satunya pemanggil) jadi Tuan Tanah. Semua pass = bagi ulang.
- **Kartu dasar tidak pernah dibuka**: Tuan Tanah langsung menerimanya (20 kartu); kartu jadi publik hanya saat dikeluarkan.
- **Kombinasi:** satu, pasang, tris (boleh polos), tris+1, tris+pasang, straight 5+ (3..A), pasang berurutan 3+ (3..A), pesawat 2+ tris
  berurutan (3..A) polos / +1 kartu per tris / +1 pasang per tris (tidak dicampur, sayap tidak boleh rank pesawat), empat+2 kartu,
  empat+2 pasang, bom (empat sama), roket (dua joker).
- **Mengikuti:** jenis & jumlah kartu sama, nilai lebih tinggi; bom mengalahkan semua kecuali roket (bom lebih tinggi menang); roket
  mengalahkan semua. Dua pass berturut-turut → yang terakhir main memimpin lagi. Tuan Tanah memimpin pertama.
- **Skor:** pengali = tawar × 2^(bom) × 2^(roket) (3 bom = ×8). Tuan Tanah lawan tiap petani: dasar × pengali petani itu
  (Tuan Tanah menerima/membayar jumlah keduanya).
  **Spring per orang:** Tuan Tanah menang → petani yang sama sekali tidak mengeluarkan kartu bayar ×2, petani yang sempat keluar kartu
  tidak kena (mis. panggil ×2: yang tidak keluar kartu bayar 4, yang keluar bayar 2, Tuan Tanah +6). Anti-spring: petani menang & Tuan Tanah
  hanya keluar sekali → ×2 ke kedua petani.

Keputusan yang diambil saat membuat (ubah di config kalau maunya lain):

- Sayap pesawat +1 kartu boleh dua kartu ber-rank sama (333444+55) dan boleh joker; sayap pasang tidak boleh joker (dua joker bukan pasang).
- Kartu yang bisa dibaca dua cara (mis. 333444555666) dipilih otomatis: saat memimpin = bacaan paling wajar (pesawat 4), saat mengikuti =
  bacaan yang bisa mengalahkan.
- Selesai tangan, sisa kartu semua pemain (termasuk kartu dasar) dibuka — tangan sudah selesai, tidak ada lagi yang dirahasiakan.

### `src/engine/rules.config.js`

| Flag | Default | Arti |
| --- | --- | --- |
| `bidding.mode` | `'grab'` | `'grab'` = Panggil/Rebut (aturan Teddy); `'points'` = tawar 1/2/3 gaya lama |
| `bidding.callMult` / `grabMult` | 2 / 2 | pengali Panggil / tiap Rebut |
| `bidding.finalGrab` | `true` | pemanggil pertama dapat kesempatan merebut balik |
| `base` | 1 | skor dasar |
| `showKitty` | `false` | `true` = 3 kartu dasar dibuka ke semua setelah Tuan Tanah dipilih |
| `redealOnAllPass` | `true` | semua pass = bagi ulang (`false` = pemain pertama jadi Tuan Tanah) |
| `allowTripleAlone` / `allowTriplePlusOne` / `allowTriplePlusPair` | `true` | tris polos / +1 / +pasang |
| `allowAirplaneWings` | `true` | pesawat boleh bersayap |
| `allowQuadPlusTwo` | `true` | empat + 2 / empat + 2 pasang |
| `minStraight` / `minPairStraight` / `minAirplane` | 5 / 3 / 2 | panjang minimal rantai |
| `bombMult` / `rocketMult` / `springMult` / `antiSpringMult` | 2 | pengali |
| `springPerPlayer` | `true` | spring ×2 hanya untuk petani yang tidak keluar kartu (`false` = harus kedua petani, ×2 ke keduanya) |
| `multiplierCap` | 0 | batas pengali total (0 = tanpa batas) |
| `bidSeconds` / `turnSeconds` | 12 / 20 | waktu giliran (online & latihan) |

## Ranked

- Rating per game (mulai 1000), Elo tim: Tuan Tanah lawan rata-rata dua petani. Perubahan Tuan Tanah ×2, ikut besarnya pengali
  (×2 → 1,5×, ×4 → 2×, ×8 → 2,5× … maks 4×), 10 tangan pertama ×1,5 (placement). Bot dianggap setara rata-rata pemain di meja;
  makin sedikit pemain asli, makin kecil perubahannya (1 orang ×0,5). Rumusnya di repo games-mahjong0hk `worker/doudizhu.js`.
- **Kabur** (keluar di tengah tangan, atau putus ≥45 dtk sampai tangan selesai): kursi dimainkan bot, dihitung kalah + penalti 15.
- Waktu habis: tawar = pass, mengikuti = pass, memimpin = kartu pilihan bot. 2× berturut-turut → main otomatis sampai menekan
  "Main lagi sendiri"; main otomatis 2 tangan penuh → dikeluarkan dari meja. Pemain putus: gilirannya dimainkan bot setelah 4 dtk.
- Satu akun satu meja Ranked; buka lagi app → kembali ke meja yang sama.

## Bot

`src/engine/bot.js`, berjalan di server (meja online & Ranked) dan di HP (latihan, tombol Saran). Bot hanya membaca yang boleh diketahui
kursinya (tangan sendiri, jumlah kartu lawan, kartu yang sudah keluar) — dites dengan menukar tangan lawan.

- **Sulit:** tawar dari kekuatan tangan (joker, 2, bom, jumlah langkah untuk habis), memecah tangan jadi kombinasi paling efisien
  (pencarian rantai), menyimpan bom sampai lawan hampir habis atau bisa menutup tangan, menghitung kartu yang belum keluar,
  bekerja sama sebagai petani (tidak merebut dari teman, menyuapi teman yang tinggal 1–2 kartu, menghadang Tuan Tanah).
- **Sedang:** cara yang sama tanpa hitung kartu & kerja sama yang lebih longgar. **Mudah:** kartu terkecil, sedikit acak.
- **Jago:** heuristik Sulit untuk menyaring 6 langkah terbaik, lalu Monte Carlo — 16 kemungkinan pembagian kartu lawan diundi dari
  kartu yang belum terlihat (tetap tidak mengintip), tiap langkah dimainkan sampai tangan habis dengan bot Sulit, yang paling sering
  menang dipakai. Pilihan heuristik dapat bonus (`prior`) dan pass dapat bonus tambahan kalau teman yang terakhir main (`mate`),
  supaya pencarian tidak menyimpang hanya karena hasilnya seri — tanpa itu petani menimpa langkah temannya 35% (sekarang 6%).
  ±20 ms per keputusan (paling lama ±95 ms). Dipakai di meja Ranked 50 & 100 dan bisa dipilih di meja lawan bot/teman.
- **God:** Jago dengan pencarian lebih berat — 48 dunia (bukan 16) dan 96 dunia di akhir tangan, 9 langkah teratas (bukan 6),
  mulai mencari lebih awal (`maxUnseen` 42), `prior` lebih kecil (0,1), **dan dunia yang diundi harus cocok dengan petunjuk
  dari pass**: kalau lawan tadi pass pada kombinasi dari lawannya, dunia yang memberi dia langkah non-bom yang menang dibuang
  (dicoba sampai 8 undian). ±80 ms per keputusan (±4x Jago; server hanya mengerjakan satu keputusan per alarm, jadi aman).
  Diukur: **+1,57 poin/tangan di atas Sulit**, dan **+0,13 poin/tangan di atas Jago** (1.680 tangan; bedanya tipis — sebagian
  besar kekuatan Monte Carlo sudah didapat Jago). Dipakai di meja Ranked 500 dan bisa dipilih di meja lawan bot/teman.
  Setelannya di `SEARCH` (`src/engine/bot.js`) — Jago & God memakai kode pencarian yang sama, beda angkanya saja.
- Simulasi 3000 tangan (`npm run sim`, ±0,8 ms/tangan): Tuan Tanah menang ±60%, ±0,4 bom/tangan; poin rata-rata Mudah −2,7 / Sedang
  +0,4 / Sulit +2,3 per tangan. Adu level: `npm run strength -- jago hard 150` → Jago **+0,6 … +1,1 poin/tangan** di atas Sulit
  (Sulit sendiri +0,44 di atas Sedang).

## Main di lokal

```bash
npm test            # node --test test/*.test.js (engine, bot + 600 tangan simulasi, meja/Ranked, i18n, akun)
npm run sim         # 3000 tangan bot vs bot: cek langkah ilegal/macet + statistik
npm run strength    # adu kekuatan level bot, mis. node scripts/strength.mjs expert hard 150
npm run dev         # python3 -m http.server 8080 → http://localhost:8080 (hanya Latihan)
npm run dev:online  # build + wrangler dev (meja teman jalan; buka /games/doudizhu/)
```

Ranked lokal butuh Worker Mahjong ikut jalan: di repo games-mahjong0hk `npx wrangler dev` (dengan `.dev.vars` berisi `DEV_LOGIN=1`),
di sini `npx wrangler dev --port 8788 --inspector-port 9331`, lalu proxy satu origin (`/games/mahjonghk` → 8787, `/games/doudizhu` → 8788)
dan login tes lewat `/games/mahjonghk/api/auth/dev?name=Ani&next=doudizhu`.

## Deploy & variabel

- Cloudflare Workers & Pages → Import repository ini; build `npm run build`, deploy `npx wrangler deploy`, production branch `main`.
  **Merge/push ke `main` = langsung live.** Route `sylvaniaharco.com/games/doudizhu*` ada di `wrangler.jsonc`.
- **Tidak ada variabel/secret** untuk Worker ini. Service binding `MAHJONG` (→ `games-mahjong0hk`, entrypoint `DoudizhuGate`) dan
  Durable Object ada di `wrangler.jsonc`. Worker Mahjong harus sudah ter-deploy dengan `DoudizhuGate` sebelum Worker ini.
- Error JavaScript dari HP masuk dashboard admin Mahjong (bagian error, mode `doudizhu`).
