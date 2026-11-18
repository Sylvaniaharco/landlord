// Kartu = angka 0..53. 0..51: rank = c >> 2 (0 = "3" … 11 = "A", 12 = "2"), suit = c & 3 (0 ♦, 1 ♣, 2 ♥, 3 ♠).
// 52 = joker hitam (rank 13), 53 = joker merah (rank 14). Lambang tidak dipakai di aturan.
// Murni (tanpa DOM) — dipakai browser, Node (tes/simulasi), dan Worker.
export const RANKS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2', 'BJ', 'RJ'];
export const R2 = 12, BJ = 13, RJ = 14, MAX_CHAIN = 11; // rank tertinggi yang boleh ada di straight/pesawat = A (11)
export const SUIT_CHARS = ['♦', '♣', '♥', '♠'];
const SUIT_KEYS = 'dchs';

export const rankOf = (c) => (c < 52 ? c >> 2 : c - 39);
export const suitOf = (c) => (c < 52 ? c & 3 : -1);
export const isJoker = (c) => c >= 52;
export const isRed = (c) => (c < 52 ? (c & 3) === 0 || (c & 3) === 2 : c === 53);
export const card = (rank, suit = 0) => (rank >= 13 ? 39 + rank : rank * 4 + suit);
export const cardName = (c) => (c === 52 ? 'BJ' : c === 53 ? 'RJ' : RANKS[c >> 2] + SUIT_CHARS[c & 3]);

/** Urut dari besar ke kecil (tampilan tangan: joker & 2 di kiri). */
export const byRankDesc = (a, b) => rankOf(b) - rankOf(a) || b - a;
export const sortHand = (cards) => [...cards].sort(byRankDesc);

/** Hitung jumlah kartu per rank (array 15). */
export function counts(cards) {
  const c = new Array(15).fill(0);
  for (const x of cards) c[rankOf(x)]++;
  return c;
}

/**
 * Untuk tes: '3 3 4 BJ RJ 10 2' → kartu (lambang diisi otomatis berbeda-beda), atau dengan lambang '3h 3s'.
 */
export function parseCards(str) {
  const used = new Set();
  return str.trim().split(/\s+/).filter(Boolean).map((t) => {
    const T = t.toUpperCase();
    if (T === 'BJ') return 52;
    if (T === 'RJ') return 53;
    const last = t.slice(-1).toLowerCase();
    const hasSuit = SUIT_KEYS.includes(last) && t.length > 1;
    const rank = RANKS.indexOf(hasSuit ? T.slice(0, -1) : T);
    if (rank < 0 || rank > 12) throw new Error('Kartu tidak dikenal: ' + t);
    let c;
    if (hasSuit) c = card(rank, SUIT_KEYS.indexOf(last));
    else {
      let s = 0;
      while (used.has(card(rank, s)) && s < 4) s++;
      if (s > 3) throw new Error('Kartu lebih dari 4: ' + t);
      c = card(rank, s);
    }
    if (used.has(c)) throw new Error('Kartu dobel: ' + t);
    used.add(c);
    return c;
  });
}

/** RNG berseed (mulberry32). Jangan pakai Math.random() di engine. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Campur seed + angka lain jadi seed baru (untuk bagi ulang / keputusan bot yang bisa diulang). */
export const mixSeed = (seed, n) => (Math.imul((seed >>> 0) ^ 0x9e3779b9, 2654435761) + Math.imul(n + 1, 40503)) >>> 0;

export function shuffledDeck(rng) {
  const d = Array.from({ length: 54 }, (_, i) => i);
  for (let i = 53; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

/** Bagi 17 kartu ke 3 pemain + 3 kartu dasar. */
export function deal(rng) {
  const d = shuffledDeck(rng);
  return { hands: [0, 1, 2].map((p) => sortHand(d.slice(p * 17, p * 17 + 17))), kitty: d.slice(51) };
}
