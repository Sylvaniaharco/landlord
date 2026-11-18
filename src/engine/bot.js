// Bot Doudizhu: 3 level (Mudah / Sedang / Sulit). Murni; hanya membaca yang boleh diketahui kursinya sendiri:
// tangan sendiri, jumlah kartu lawan, kartu yang sudah keluar, siapa tuan tanah. Tidak pernah mengintip tangan lawan / kartu dasar.
// Keputusan bisa diulang: semua acak dari `rnd` (RNG berseed) yang diberikan pemanggil.
import { counts, rankOf, R2, BJ, RJ, MAX_CHAIN } from './cards.js';
import { allMoves, legalMoves, isBombish } from './combos.js';
import { bidOptions, mustLead, prevCombo, playedCards } from './game.js';

export const LEVELS = { easy: 'Mudah', normal: 'Sedang', hard: 'Sulit' };
export const DEFAULT_LEVEL = 'normal';
export const validLevel = (v) => Object.hasOwn(LEVELS, v);

// ---------- nilai tangan ----------
// cost(cnt) ≈ berapa kali lagi harus "memimpin" untuk menghabiskan kartu (lebih kecil = lebih bagus), dikurangi nilai kartu kontrol.
// Dicari dengan memecah rantai (straight / pasang berurutan / pesawat) secara rekursif, sisanya dihitung per rank.
const memo = new Map();

function baseCost(cnt, credit) {
  let t = 0, p = 0, s = 0, lowS = 0, lowP = 0, ctrl = 0;
  for (let r = 0; r < 13; r++) {
    const c = cnt[r];
    if (c === 4) { ctrl += 1.3; continue; } // bom: tidak makan giliran, malah memberi kendali
    if (c === 3) t++;
    else if (c === 2) { p++; if (r < 10) lowP++; }
    else if (c === 1) { s++; if (r < 10) lowS++; }
    if (r === R2) ctrl += c * 0.55;
    else if (r === 11) ctrl += c * 0.2;
  }
  if (cnt[BJ] && cnt[RJ]) ctrl += 1.8;
  else {
    if (cnt[RJ]) { s++; ctrl += 1; }
    if (cnt[BJ]) { s++; ctrl += 0.7; }
  }
  const absorb = Math.min(t + credit, lowS + lowP);
  return t + p + s - absorb - ctrl;
}

function chainOptions(cnt) {
  const out = [];
  for (const [need, min] of [[1, 5], [2, 3], [3, 2]]) {
    let r = 0;
    while (r <= MAX_CHAIN) {
      if (cnt[r] < need) { r++; continue; }
      let e = r;
      while (e + 1 <= MAX_CHAIN && cnt[e + 1] >= need) e++;
      const runLen = e - r + 1;
      if (runLen >= min) {
        // rantai menempel di awal atau di akhir segmen, semua panjang yang mungkin
        for (let len = min; len <= runLen; len++) {
          out.push({ need, s: r, len });
          if (r + runLen - len !== r) out.push({ need, s: r + runLen - len, len });
        }
      }
      r = e + 1;
    }
  }
  return out;
}

function costOf(cnt, credit = 0) {
  const key = cnt.join('') + '|' + credit;
  const hit = memo.get(key);
  if (hit !== undefined) return hit;
  let best = baseCost(cnt, credit);
  for (const o of chainOptions(cnt)) {
    const rest = cnt.slice();
    for (let r = o.s; r < o.s + o.len; r++) rest[r] -= o.need;
    const v = 1 + costOf(rest, credit + (o.need === 3 ? o.len : 0)) - (o.need === 1 ? 0.05 * o.len : 0);
    if (v < best) best = v;
  }
  if (memo.size > 200000) memo.clear();
  memo.set(key, best);
  return best;
}

export const handCost = (hand) => costOf(counts(hand));

function minus(cnt, cards) {
  const r = cnt.slice();
  for (const c of cards) r[rankOf(c)]--;
  return r;
}

/** Kekuatan tangan 17 kartu untuk menawar (kira-kira 0..20). */
export function bidStrength(hand) {
  const cnt = counts(hand);
  let s = 0;
  if (cnt[RJ]) s += 4;
  if (cnt[BJ]) s += 3;
  if (cnt[RJ] && cnt[BJ]) s += 1;
  s += cnt[R2] * 2 + cnt[11];
  for (let r = 0; r < 13; r++) if (cnt[r] === 4) s += 4;
  s -= 0.6 * (costOf(cnt) - 5);
  return s;
}

// ---------- informasi publik ----------
function info(g, seat) {
  const L = g.landlord;
  const lord = seat === L;
  const mate = lord ? -1 : [0, 1, 2].find((s) => s !== seat && s !== L);
  const opps = lord ? [0, 1, 2].filter((s) => s !== seat) : [L];
  const n = g.hands.map((h) => h.length);
  // kartu yang belum terlihat (di tangan orang lain): bukan milik sendiri & belum keluar
  const seen = counts([...g.hands[seat], ...playedCards(g)]);
  const outstanding = [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 1, 1].map((x, r) => x - seen[r]);
  return { lord, mate, opps, n, minOpp: Math.min(...opps.map((s) => n[s])), outstanding };
}

/** Langkah ini tidak bisa dikalahkan lawan (tanpa bom)? Hanya untuk satu / pasang / tris, dari kartu yang belum terlihat. */
function topOf(m, outstanding) {
  const c = m.combo;
  const need = { single: 1, pair: 2, triple: 3, triple1: 3, triple2: 3 }[c.type];
  if (!need) return isBombish(c);
  for (let r = c.main + 1; r < 15; r++) if (outstanding[r] >= need) return false;
  return true;
}

const isControl = (m) => m.cards.some((c) => rankOf(c) >= R2);

function chooseMove(g, seat, level, rnd) {
  const hand = g.hands[seat];
  const lead = mustLead(g);
  const prev = prevCombo(g);
  const I = info(g, seat);
  const cnt = counts(hand);
  const moves = lead ? allMoves(hand, g.rules, { fewKickers: true }) : legalMoves(hand, prev, g.rules, { fewKickers: true });
  if (!lead && !moves.length) return null;
  const finisher = moves.find((m) => m.cards.length === hand.length);
  if (finisher) return finisher;
  const byLast = g.trick.last?.seat;
  const fromMate = !lead && byLast === I.mate;

  // ---------- Mudah: sederhana & sedikit acak ----------
  if (level === 'easy') {
    if (lead) {
      const sorted = moves.filter((m) => !isBombish(m.combo)).sort((a, b) => a.combo.main - b.combo.main || b.cards.length - a.cards.length);
      const pool = sorted.slice(0, 4);
      return pool[Math.floor(rnd() * pool.length)] || moves[0];
    }
    const plain = moves.filter((m) => !isBombish(m.combo)).sort((a, b) => a.combo.main - b.combo.main);
    if (plain.length && rnd() < (fromMate ? 0.35 : 0.8)) return plain[0];
    if (!plain.length && rnd() < 0.35) return moves[0];
    return null;
  }

  // ---------- Sedang & Sulit: nilai sisa tangan ----------
  const hard = level === 'hard';
  const threat = I.minOpp; // kartu tersisa lawan paling sedikit
  const lastBy = byLast;
  const lastOppCount = lastBy !== undefined && lastBy >= 0 ? I.n[lastBy] : 99;
  const score = (m) => {
    const rest = minus(cnt, m.cards);
    let v = costOf(rest);
    const c = m.combo;
    v += c.main * (lead ? 0.045 : 0.02);
    if (isBombish(c)) {
      // simpan bom/roket kecuali lawan hampir habis, atau sisa tangan tinggal sedikit langkah
      const critical = threat <= (hard ? 3 : 2) || costOf(rest) <= 1.2;
      v += critical ? -0.3 : hard ? 3 : 2.2;
    } else if (isControl(m) && (c.type === 'single' || c.type === 'pair')) {
      v += threat <= 2 ? 0 : lead ? 0.9 : 0.35;
    }
    if (lead) {
      v -= 0.03 * m.cards.length;
      // lawan tinggal 1 / 2 kartu: jangan memimpin satu / pasang yang bisa dia lewati
      if (threat === 1 && c.type === 'single' && !(hard && topOf(m, I.outstanding))) v += 2.5 + (12 - c.main) * 0.05;
      if (threat === 2 && c.type === 'pair' && !(hard && topOf(m, I.outstanding))) v += 2;
      // petani: suapi teman yang hampir habis dengan kartu kecil
      if (I.mate >= 0 && I.n[I.mate] <= 2) {
        if (I.n[I.mate] === 1 && c.type === 'single') v -= 3 + (12 - c.main) * 0.1;
        if (I.n[I.mate] === 2 && c.type === 'pair') v -= 3 + (12 - c.main) * 0.1;
      }
      if (hard && topOf(m, I.outstanding) && costOf(rest) <= 1.5) v -= 1.5; // kartu pasti menang & sisa tangan bisa habis
    }
    return v;
  };

  let best = null, bestV = Infinity;
  for (const m of moves) {
    const v = score(m);
    if (v < bestV) { bestV = v; best = m; }
  }
  if (lead) return best;

  // ikut atau pass?
  let passV = costOf(cnt);
  if (fromMate) {
    // jangan merebut dari teman; kecuali teman masih banyak kartu dan tuan tanah hampir habis (di Sulit tetap pass: teman pegang giliran)
    passV -= hard ? 2.5 : 1.8;
  } else {
    passV += 0.6; // ikut = menjaga tempo
    if (lastOppCount <= 2 || threat <= 2) passV += 3; // lawan hampir habis: wajib dihadang
    else if (threat <= 4) passV += 1;
    // petani setelah tuan tanah, dan teman sudah hampir habis & main setelah saya: biarkan teman yang menjawab kalau saya lemah
    if (hard && !I.lord && I.mate === (seat + 1) % 3 && I.n[I.mate] <= 2 && bestV > passV - 0.2) passV -= 0.8;
  }
  if (!hard && rnd() < 0.04) return null; // Sedang sesekali "lupa"
  return bestV <= passV ? best : null;
}

/**
 * Aksi bot untuk kursi `seat` (giliran sendiri). level: 'easy' | 'normal' | 'hard'. rnd: RNG berseed.
 * -> aksi untuk applyAction ({t:'call'} / {t:'play', cards} / {t:'pass'} ...)
 */
export function botAction(g, seat, level = DEFAULT_LEVEL, rnd = Math.random) {
  if (!validLevel(level)) level = DEFAULT_LEVEL;
  if (g.phase === 'bid') {
    const opts = bidOptions(g);
    const s = bidStrength(g.hands[seat]);
    const j = level === 'easy' ? (rnd() - 0.5) * 6 : level === 'normal' ? (rnd() - 0.5) * 2 : (rnd() - 0.5) * 0.8;
    if (g.rules.bidding.mode === 'points') {
      const want = s + j >= 11 ? 3 : s + j >= 8.5 ? 2 : s + j >= 6.5 ? 1 : 0;
      return opts.includes('bid' + want) ? { t: 'bid' + want } : { t: 'pass' };
    }
    const callAt = level === 'hard' ? 7 : level === 'normal' ? 6.5 : 6;
    const grabAt = level === 'hard' ? 9.5 : level === 'normal' ? 10 : 9;
    if (opts.includes('call')) return s + j >= callAt ? { t: 'call' } : { t: 'pass' };
    return s + j >= grabAt + (g.bid.grabs || 0) ? { t: 'grab' } : { t: 'pass' };
  }
  if (g.phase !== 'play') return null;
  const m = chooseMove(g, seat, level, rnd);
  if (m) return { t: 'play', cards: m.cards };
  if (mustLead(g)) return { t: 'play', cards: [lowestCard(g.hands[seat])] }; // pengaman: memimpin tidak boleh pass
  return { t: 'pass' };
}

const lowestCard = (hand) => hand.reduce((a, c) => (rankOf(c) < rankOf(a) ? c : a), hand[0]);

/** Waktu habis: menawar = pass; mengikuti = pass; memimpin = keluarkan pilihan bot Sedang (biar tidak bodoh). */
export function timeoutAction(g, seat, rnd = Math.random) {
  if (g.phase === 'bid') return { t: 'pass' };
  if (!mustLead(g)) return { t: 'pass' };
  return botAction(g, seat, 'normal', rnd);
}

/**
 * Saran untuk pemain (tombol "Saran"): daftar langkah dari yang paling disarankan. Indeks berputar tiap ditekan.
 * Yang pertama = pilihan bot Sulit (kalau bot memilih pass, langkah terkecil yang sah), lalu sisanya urut dari terkecil, bom paling akhir.
 */
export function hints(g, seat) {
  if (g.phase !== 'play' || g.turn !== seat) return [];
  const hand = g.hands[seat];
  const prev = prevCombo(g);
  const moves = legalMoves(hand, prev, g.rules, { fewKickers: true });
  const key = (m) => (isBombish(m.combo) ? 100 : 0) + m.combo.main + (prev ? 0 : -m.cards.length * 0.01);
  moves.sort((a, b) => key(a) - key(b));
  const pick = chooseMove(g, seat, 'hard', () => 0.5);
  const out = [];
  const seen = new Set();
  for (const m of pick ? [pick, ...moves] : moves) {
    const k = [...m.cards].sort((a, b) => a - b).join();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(m.cards);
  }
  return out;
}
