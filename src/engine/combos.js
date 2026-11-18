// Kombinasi kartu Doudizhu: kenali jenis, bandingkan, dan buat daftar langkah yang sah. Murni (tanpa DOM).
// Kombinasi = { type, main, len, n }:
//   type  jenis (lihat TYPES), main = rank penentu (tris/quad/rank terendah rantai), len = panjang rantai (1 kalau bukan rantai),
//   n     jumlah kartu. Mengikuti = jenis, jumlah kartu & panjang sama, main lebih tinggi. Bom & roket pengecualian.
import { RULES } from './rules.config.js';
import { counts, rankOf, MAX_CHAIN, R2, BJ, RJ } from './cards.js';

export const TYPES = ['single', 'pair', 'triple', 'triple1', 'triple2', 'straight', 'pairs', 'plane', 'plane1', 'plane2', 'quad2', 'quad4', 'bomb', 'rocket'];
export const TYPE_NAMES = {
  single: 'Satu', pair: 'Pasang', triple: 'Tris', triple1: 'Tris + 1', triple2: 'Tris + pasang', straight: 'Straight',
  pairs: 'Pasang berurutan', plane: 'Pesawat', plane1: 'Pesawat + sayap', plane2: 'Pesawat + sayap pasang',
  quad2: 'Empat + 2', quad4: 'Empat + 2 pasang', bomb: 'Bom', rocket: 'Roket',
};

const isRun = (cnt, from, len, need) => {
  if (from + len - 1 > MAX_CHAIN) return false;
  for (let r = from; r < from + len; r++) if (cnt[r] < need) return false;
  return true;
};

/**
 * Semua cara membaca sekumpulan kartu sebagai kombinasi sah (bisa lebih dari satu, mis. 333444555666 = pesawat 4 ATAU
 * pesawat 3 + sayap). Urutan: yang paling "wajar" dulu (dipakai saat memimpin). [] = tidak sah.
 */
export function classify(cards, rules = RULES) {
  const n = cards.length;
  if (!n) return [];
  const cnt = counts(cards);
  const out = [];
  const add = (type, main, len = 1) => out.push({ type, main, len, n });
  const ranks = [];
  for (let r = 0; r < 15; r++) if (cnt[r]) ranks.push(r);

  if (n === 2 && cnt[BJ] && cnt[RJ]) return [{ type: 'rocket', main: RJ, len: 1, n }];
  if (n === 4 && ranks.length === 1) return [{ type: 'bomb', main: ranks[0], len: 1, n }];
  if (n === 1) return [{ type: 'single', main: ranks[0], len: 1, n }];
  if (n === 2) return ranks.length === 1 ? [{ type: 'pair', main: ranks[0], len: 1, n }] : [];
  if (n === 3) return ranks.length === 1 && rules.allowTripleAlone ? [{ type: 'triple', main: ranks[0], len: 1, n }] : [];

  // tris + 1 / tris + pasang
  if (n === 4 && rules.allowTriplePlusOne && ranks.length === 2) {
    const t = ranks.find((r) => cnt[r] === 3);
    if (t !== undefined) add('triple1', t);
  }
  if (n === 5 && rules.allowTriplePlusPair && ranks.length === 2) {
    const t = ranks.find((r) => cnt[r] === 3);
    const p = ranks.find((r) => cnt[r] === 2);
    if (t !== undefined && p !== undefined) add('triple2', t);
  }
  // straight & pasang berurutan (3..A)
  if (n >= rules.minStraight && ranks.length === n && isRun(cnt, ranks[0], n, 1)) add('straight', ranks[0], n);
  if (n % 2 === 0 && n / 2 >= rules.minPairStraight && ranks.length === n / 2 && ranks.every((r) => cnt[r] === 2) && isRun(cnt, ranks[0], n / 2, 2)) {
    add('pairs', ranks[0], n / 2);
  }
  // pesawat: k tris berurutan (+ k kartu / + k pasang). Sayap tidak boleh berisi rank pesawat itu sendiri.
  const minK = rules.minAirplane;
  for (let k = Math.floor(n / 3); k >= minK; k--) {
    for (let s = 0; s + k - 1 <= MAX_CHAIN; s++) {
      if (!isRun(cnt, s, k, 3)) continue;
      const rest = cnt.slice();
      let clean = true;
      for (let r = s; r < s + k; r++) {
        rest[r] -= 3;
        if (rest[r]) clean = false; // kartu ke-4 dari rank pesawat = sayap kembar dengan pesawat → tidak boleh
      }
      const restN = n - 3 * k;
      if (restN === 0) add('plane', s, k);
      else if (!clean || !rules.allowAirplaneWings) continue;
      else if (restN === k) add('plane1', s, k);
      else if (restN === 2 * k && rest.every((c, r) => c % 2 === 0 && (c === 0 || r < BJ))) add('plane2', s, k);
    }
  }
  // empat + 2 kartu / empat + 2 pasang (bukan bom)
  if (rules.allowQuadPlusTwo && (n === 6 || n === 8)) {
    for (const q of ranks) {
      if (cnt[q] !== 4) continue;
      const rest = cnt.slice();
      rest[q] = 0;
      if (n === 6) add('quad2', q);
      else if (rest.every((c, r) => c % 2 === 0 && (c === 0 || r < BJ))) add('quad4', q);
    }
  }
  // yang paling wajar dulu: rantai terpanjang / bentuk polos
  return out.sort((a, b) => b.len - a.len || TYPES.indexOf(a.type) - TYPES.indexOf(b.type) || b.main - a.main);
}

/** Apakah kombinasi `c` mengalahkan `prev`? */
export function beats(c, prev) {
  if (!prev) return true;
  if (c.type === 'rocket') return true;
  if (prev.type === 'rocket') return false;
  if (c.type === 'bomb') return prev.type !== 'bomb' || c.main > prev.main;
  if (prev.type === 'bomb') return false;
  return c.type === prev.type && c.n === prev.n && c.len === prev.len && c.main > prev.main;
}

/** Baca kartu sebagai langkah: memimpin (prev null) = bacaan pertama; mengikuti = bacaan yang bisa mengalahkan prev. -> kombinasi | null */
export function readPlay(cards, prev, rules = RULES) {
  const all = classify(cards, rules);
  if (!prev) return all[0] || null;
  return all.find((c) => beats(c, prev)) || null;
}

export const isBombish = (c) => c.type === 'bomb' || c.type === 'rocket';

// ---------- daftar langkah ----------

/** Ambil `k` kartu ber-rank r dari tangan (kartu yang belum dipakai). */
function take(byRank, used, r, k) {
  const out = [];
  for (const c of byRank[r]) {
    if (out.length === k) break;
    if (!used.has(c)) out.push(c);
  }
  return out.length === k ? out : null;
}

function combos(arr, k, start = 0, acc = [], out = [], limit = 400) {
  if (out.length >= limit) return out;
  if (acc.length === k) { out.push(acc.slice()); return out; }
  for (let i = start; i <= arr.length - (k - acc.length); i++) {
    acc.push(arr[i]);
    combos(arr, k, i + 1, acc, out, limit);
    acc.pop();
  }
  return out;
}

/**
 * Semua langkah memimpin yang sah dari tangan: [{ cards, combo }]. Kartu sayap/tambahan dipilih per rank
 * (rank berbeda untuk tiap sayap). opts.fewKickers = hanya pilihan sayap termurah (untuk bot, supaya cepat).
 */
export function allMoves(hand, rules = RULES, opts = {}) {
  const cnt = counts(hand);
  const byRank = Array.from({ length: 15 }, () => []);
  for (const c of [...hand].sort((a, b) => a - b)) byRank[rankOf(c)].push(c);
  const moves = [];
  const push = (cards, type, main, len = 1) => moves.push({ cards, combo: { type, main, len, n: cards.length } });
  const few = !!opts.fewKickers;

  // pilihan sayap: rank selain `exclude`, butuh `need` kartu per rank. few = rank termurah saja (kartu lepas dulu, rank kecil dulu)
  const kickerSets = (exclude, need, k) => {
    let cands = [];
    for (let r = 0; r < 15; r++) if (!exclude.has(r) && cnt[r] >= need && (need === 1 || r < BJ)) cands.push(r);
    if (few) {
      const cost = (r) => (cnt[r] === need ? 0 : cnt[r] >= 3 ? 30 : 10) + r + (r >= R2 ? 40 : 0);
      cands.sort((a, b) => cost(a) - cost(b));
      const sets = [];
      if (cands.length >= k) sets.push(cands.slice(0, k));
      if (cands.length > k) sets.push([...cands.slice(0, k - 1), cands[k]]);
      return sets;
    }
    return combos(cands, k);
  };

  for (let r = 0; r < 15; r++) {
    if (cnt[r] >= 1) push([byRank[r][0]], 'single', r);
    if (cnt[r] >= 2) push(byRank[r].slice(0, 2), 'pair', r);
    if (cnt[r] >= 3) {
      const t = byRank[r].slice(0, 3);
      if (rules.allowTripleAlone) push(t, 'triple', r);
      if (rules.allowTriplePlusOne) for (const [k] of kickerSets(new Set([r]), 1, 1)) push([...t, byRank[k][0]], 'triple1', r);
      if (rules.allowTriplePlusPair) for (const [k] of kickerSets(new Set([r]), 2, 1)) push([...t, ...byRank[k].slice(0, 2)], 'triple2', r);
    }
    if (cnt[r] === 4) {
      push(byRank[r].slice(), 'bomb', r);
      if (rules.allowQuadPlusTwo) {
        const ex = new Set([r]);
        for (const ks of kickerSets(ex, 1, 2)) push([...byRank[r], byRank[ks[0]][0], byRank[ks[1]][0]], 'quad2', r);
        for (const ks of kickerSets(ex, 2, 2)) push([...byRank[r], ...byRank[ks[0]].slice(0, 2), ...byRank[ks[1]].slice(0, 2)], 'quad4', r);
      }
    }
  }
  if (cnt[BJ] && cnt[RJ]) push([52, 53], 'rocket', RJ);

  // rantai
  for (let s = 0; s <= MAX_CHAIN; s++) {
    for (let len = rules.minStraight; s + len - 1 <= MAX_CHAIN && isRun(cnt, s, len, 1); len++) {
      push(Array.from({ length: len }, (_, i) => byRank[s + i][0]), 'straight', s, len);
    }
    for (let len = rules.minPairStraight; s + len - 1 <= MAX_CHAIN && isRun(cnt, s, len, 2); len++) {
      push(Array.from({ length: len }, (_, i) => byRank[s + i].slice(0, 2)).flat(), 'pairs', s, len);
    }
    for (let len = rules.minAirplane; s + len - 1 <= MAX_CHAIN && isRun(cnt, s, len, 3); len++) {
      const body = Array.from({ length: len }, (_, i) => byRank[s + i].slice(0, 3)).flat();
      push(body, 'plane', s, len);
      if (!rules.allowAirplaneWings) continue;
      const ex = new Set(Array.from({ length: len }, (_, i) => s + i));
      if (body.length + len <= hand.length) {
        for (const ks of kickerSets(ex, 1, len)) push([...body, ...ks.map((k) => byRank[k][0])], 'plane1', s, len);
      }
      if (body.length + 2 * len <= hand.length) {
        for (const ks of kickerSets(ex, 2, len)) push([...body, ...ks.flatMap((k) => byRank[k].slice(0, 2))], 'plane2', s, len);
      }
    }
  }
  return moves;
}

/** Langkah sah untuk mengikuti `prev` (atau semua langkah memimpin kalau prev null). */
export function legalMoves(hand, prev, rules = RULES, opts = {}) {
  const all = allMoves(hand, rules, opts);
  return prev ? all.filter((m) => beats(m.combo, prev)) : all;
}

/** Ada langkah apa pun yang bisa mengalahkan prev? (cepat: sayap termurah saja sudah cukup untuk menjawab ya/tidak) */
export const canBeat = (hand, prev, rules = RULES) => legalMoves(hand, prev, rules, { fewKickers: true }).length > 0;

/** Kartu `cards` semuanya ada di `hand` dan tidak dobel? */
export function owns(hand, cards) {
  if (!Array.isArray(cards) || !cards.length || cards.length > hand.length) return false;
  const set = new Set(hand);
  const seen = new Set();
  for (const c of cards) {
    if (!Number.isInteger(c) || !set.has(c) || seen.has(c)) return false;
    seen.add(c);
  }
  return true;
}
