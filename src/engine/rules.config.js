// SEMUA aturan Doudizhu (versi Teddy) ada di sini. Ubah angka/flag di file ini saja — engine, bot, dan server membacanya.
// Setelah mengubah aturan: jalankan `npm test` (tes membaca config ini) dan update README bagian "Aturan".
//
// Catatan: repo ini tanpa bundler/TypeScript (sama dengan Capsa & Mahjong), jadi config-nya file .js biasa.

export const RULES = Object.freeze({
  // ---------- tawar tuan tanah ----------
  bidding: Object.freeze({
    // 'grab'   = Panggil (叫地主) / Pass, lalu Rebut (抢地主) / Pass. Tiap panggil & rebut = pengali x2. (aturan Teddy, default)
    // 'points' = tawar 1 / 2 / 3 poin gaya lama (pengali = tawaran tertinggi). Hanya untuk eksperimen.
    mode: 'grab',
    callMult: 2, // pengali saat ada yang Panggil
    grabMult: 2, // pengali tiap Rebut
    finalGrab: true, // pemanggil pertama dapat kesempatan terakhir merebut balik kalau ada yang merebut darinya
  }),
  base: 1, // skor dasar per tangan
  showKitty: false, // 3 kartu dasar TIDAK pernah dibuka ke semua orang (hanya tuan tanah yang menerimanya); true = dibuka setelah tuan tanah dipilih
  redealOnAllPass: true, // semua pass = kartu dibagi ulang (giliran mulai tetap)

  // ---------- kombinasi ----------
  allowTripleAlone: true, // tris tanpa tambahan (333)
  allowTriplePlusOne: true, // 333+4
  allowTriplePlusPair: true, // 333+44
  allowAirplaneWings: true, // pesawat + 1 kartu per tris, atau + 1 pasang per tris (tidak dicampur)
  allowQuadPlusTwo: true, // 4444+5+6 dan 4444+55+66 (BUKAN bom)
  minStraight: 5, // straight minimal 5 kartu (3..A, tanpa 2 & joker)
  minPairStraight: 3, // pasangan berurutan minimal 3 pasang (3..A)
  minAirplane: 2, // pesawat minimal 2 tris berurutan (3..A)

  // ---------- pengali ----------
  bombMult: 2, // tiap bom yang keluar
  rocketMult: 2, // roket (dua joker)
  springMult: 2, // spring: tuan tanah menang & petani tidak mengeluarkan kartu sama sekali
  springPerPlayer: true, // true (aturan Teddy) = x2 hanya untuk petani yang tidak keluar kartu sama sekali; false = harus kedua petani, x2 ke keduanya
  antiSpringMult: 2, // anti-spring: petani menang & tuan tanah hanya sempat keluar sekali (kartu pertamanya)
  multiplierCap: 0, // batas pengali total, 0 = tanpa batas

  // ---------- waktu (online & latihan) ----------
  bidSeconds: 12,
  turnSeconds: 20,
});

/** Gabungkan perubahan aturan (mis. untuk tes) tanpa mengubah default. */
export function makeRules(over = {}) {
  return Object.freeze({ ...RULES, ...over, bidding: Object.freeze({ ...RULES.bidding, ...(over.bidding || {}) }) });
}
