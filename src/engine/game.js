// Satu tangan Doudizhu: bagi kartu → tawar tuan tanah → main → skor. Murni & deterministik dari seed + urutan aksi.
// applyAction(g, seat, action) mengubah state; viewFor(g, seat) = yang boleh dilihat satu pemain (tangan lawan & kartu dasar tidak bocor).
import { RULES } from './rules.config.js';
import { deal, mulberry32, mixSeed, sortHand } from './cards.js';
import { readPlay, owns, isBombish } from './combos.js';

export const PHASES = ['bid', 'play', 'done'];
const next = (s) => (s + 1) % 3;

/** Tangan baru. starter = kursi yang mulai menawar. */
export function newHand(seed, starter = 0, rules = RULES) {
  const g = {
    rules, seed: seed >>> 0, starter, phase: 'bid', redeals: 0,
    hands: null, kitty: null, landlord: -1, turn: starter,
    bid: null,
    mult: { bid: 1, bombs: 0, rockets: 0, spring: '', springSeats: [] },
    trick: null, // { last: { seat, cards, combo } | null, passes }
    plays: [], // semua langkah tangan ini: { seat, cards } atau { seat, pass: true }; tanda { seat:-1, trick:true } = ronde baru
    playsBy: [0, 0, 0],
    result: null,
    seq: 0,
    log: [], // kejadian untuk animasi/efek: { k:'call'|'grab'|'pass'|'redeal'|'landlord'|'play'|'bomb'|'rocket'|'spring'|'anti'|'done', seat }
  };
  dealCards(g);
  return g;
}

function dealCards(g) {
  const d = deal(mulberry32(mixSeed(g.seed, g.redeals)));
  g.hands = d.hands;
  g.kitty = d.kitty;
  g.turn = g.starter;
  g.bid = { queue: [g.starter, next(g.starter), next(next(g.starter))], pos: 0, caller: -1, candidate: -1, grabs: 0, high: 0, final: false, acts: [] };
  g.mult.bid = 1;
}

/** Aksi yang boleh saat menawar: ['call','pass'] / ['grab','pass'] / ['bid1','bid2','bid3','pass'] (mode points). */
export function bidOptions(g) {
  if (g.phase !== 'bid') return [];
  const b = g.bid;
  if (g.rules.bidding.mode === 'points') return [1, 2, 3].filter((v) => v > b.high).map((v) => 'bid' + v).concat('pass');
  return b.caller < 0 ? ['call', 'pass'] : ['grab', 'pass'];
}

/** Bisa pass saat main? (tidak bisa kalau sedang memimpin ronde baru) */
export const mustLead = (g) => g.phase === 'play' && (!g.trick.last || g.trick.last.seat === g.turn);
export const prevCombo = (g) => (mustLead(g) ? null : g.trick.last.combo);

function pushLog(g, e) {
  e.id = ++g.seq;
  g.log.push(e);
  if (g.log.length > 40) g.log.shift();
}

function becomeLandlord(g, seat) {
  g.landlord = seat;
  g.hands[seat] = sortHand([...g.hands[seat], ...g.kitty]);
  g.phase = 'play';
  g.turn = seat;
  g.trick = { last: null, passes: 0 };
  pushLog(g, { k: 'landlord', seat });
}

function afterBid(g) {
  const b = g.bid;
  const points = g.rules.bidding.mode === 'points';
  if (points && b.high >= 3) return becomeLandlord(g, b.candidate);
  if (b.pos < 3) { g.turn = b.queue[b.pos]; return; }
  // putaran pertama selesai
  if (b.candidate < 0) {
    // semua pass terus-menerus bikin meja (dan alarm bot di server) menggantung: setelah maxRedeals, pemain pertama jadi Tuan Tanah
    if (!g.rules.redealOnAllPass || g.redeals >= (g.rules.maxRedeals ?? Infinity)) return becomeLandlord(g, g.starter);
    g.redeals++;
    pushLog(g, { k: 'redeal', seat: -1 });
    dealCards(g);
    return;
  }
  // pemanggil pertama dapat kesempatan terakhir merebut balik (kalau sudah direbut orang lain)
  if (!points && g.rules.bidding.finalGrab && b.grabs > 0 && b.candidate !== b.caller) {
    b.final = true;
    g.turn = b.caller;
    b.finalTurn = true;
    return;
  }
  becomeLandlord(g, b.candidate);
}

function applyBid(g, seat, t) {
  const b = g.bid;
  if (!bidOptions(g).includes(t)) return { ok: false, error: 'Aksi tidak sah' };
  const cfg = g.rules.bidding;
  if (b.finalTurn) {
    // giliran terakhir pemanggil pertama
    b.finalTurn = false;
    if (t === 'grab') { g.mult.bid *= cfg.grabMult; b.candidate = seat; b.grabs++; }
    b.acts.push({ seat, t });
    pushLog(g, { k: t, seat });
    becomeLandlord(g, b.candidate);
    return { ok: true };
  }
  if (t.startsWith('bid')) {
    b.high = Number(t.slice(3));
    b.candidate = seat;
    g.mult.bid = b.high;
  } else if (t === 'call') {
    b.caller = seat;
    b.candidate = seat;
    g.mult.bid *= cfg.callMult;
  } else if (t === 'grab') {
    b.candidate = seat;
    b.grabs++;
    g.mult.bid *= cfg.grabMult;
  }
  b.acts.push({ seat, t });
  pushLog(g, { k: t === 'pass' ? 'pass' : t.startsWith('bid') ? 'bid' : t, seat, v: b.high });
  b.pos++;
  afterBid(g);
  return { ok: true };
}

/**
 * Aksi pemain di kursi `seat`:
 *   menawar: { t: 'call' | 'grab' | 'pass' | 'bid1'..'bid3' }
 *   main:    { t: 'play', cards: [..] } | { t: 'pass' }
 * -> { ok } | { ok:false, error }
 */
export function applyAction(g, seat, a) {
  if (!a || typeof a.t !== 'string') return { ok: false, error: 'Aksi tidak dikenal' };
  if (g.phase === 'done') return { ok: false, error: 'Tangan sudah selesai' };
  if (seat !== g.turn) return { ok: false, error: 'Bukan giliranmu' };
  if (g.phase === 'bid') return applyBid(g, seat, a.t);

  const tr = g.trick;
  if (a.t === 'pass') {
    if (mustLead(g)) return { ok: false, error: 'Kamu harus mengeluarkan kartu' };
    g.plays.push({ seat, pass: true });
    pushLog(g, { k: 'pass', seat });
    tr.passes++;
    g.turn = next(seat);
    if (g.turn === tr.last.seat) {
      // dua pass berturut-turut: yang terakhir main memimpin ronde baru
      tr.last = null;
      tr.passes = 0;
      g.plays.push({ seat: -1, trick: true });
    }
    return { ok: true };
  }
  if (a.t !== 'play') return { ok: false, error: 'Aksi tidak dikenal' };
  const hand = g.hands[seat];
  if (!owns(hand, a.cards)) return { ok: false, error: 'Kartu tidak cocok' };
  const prev = prevCombo(g);
  const combo = readPlay(a.cards, prev, g.rules);
  if (!combo) return { ok: false, error: prev ? 'Kartu itu tidak bisa mengalahkan' : 'Kombinasi tidak sah' };
  const cards = sortHand(a.cards);
  const set = new Set(cards);
  g.hands[seat] = hand.filter((c) => !set.has(c));
  tr.last = { seat, cards, combo };
  tr.passes = 0;
  g.plays.push({ seat, cards, combo });
  g.playsBy[seat]++;
  if (combo.type === 'bomb') g.mult.bombs++;
  if (combo.type === 'rocket') g.mult.rockets++;
  pushLog(g, { k: isBombish(combo) ? combo.type : 'play', seat, type: combo.type });
  if (!g.hands[seat].length) finish(g, seat);
  else g.turn = next(seat);
  return { ok: true };
}

const cap = (g, m) => (g.rules.multiplierCap > 0 ? Math.min(m, g.rules.multiplierCap) : m);

/** Pengali meja (tawar × bom × roket), belum termasuk spring. */
function tableMult(g) {
  const r = g.rules;
  return g.mult.bid * r.bombMult ** g.mult.bombs * r.rocketMult ** g.mult.rockets;
}

/**
 * Pengali satu petani terhadap Tuan Tanah (dengan batas multiplierCap). Spring dihitung per orang (aturan Teddy, rules.springPerPlayer):
 * Tuan Tanah menang → petani yang sama sekali tidak mengeluarkan kartu ×springMult, petani lain tidak.
 * Anti-spring (petani menang, Tuan Tanah hanya keluar sekali) → berlaku ke kedua petani.
 */
export function seatMult(g, s) {
  let m = tableMult(g);
  if (g.mult.springSeats?.includes(s)) m *= g.rules.springMult;
  if (g.mult.spring === 'anti') m *= g.rules.antiSpringMult;
  return cap(g, m);
}

/** Pengali yang ditampilkan: selama main = pengali meja; setelah selesai = pengali terbesar antar petani. */
export function totalMult(g) {
  const L = g.landlord;
  if (g.phase !== 'done' || L < 0) return cap(g, tableMult(g));
  return Math.max(...[0, 1, 2].filter((s) => s !== L).map((s) => seatMult(g, s)));
}

/** Rincian pengali untuk ditampilkan: [{ k, x, seats? }] */
export function multBreakdown(g) {
  const out = [];
  const b = g.bid?.acts || [];
  for (const a of b) {
    if (a.t === 'call') out.push({ k: 'call', x: g.rules.bidding.callMult });
    if (a.t === 'grab') out.push({ k: 'grab', x: g.rules.bidding.grabMult });
    if (a.t.startsWith('bid') && a === b.filter((z) => z.t.startsWith('bid')).at(-1)) out.push({ k: 'bid', x: Number(a.t.slice(3)) });
  }
  for (let i = 0; i < g.mult.bombs; i++) out.push({ k: 'bomb', x: g.rules.bombMult });
  for (let i = 0; i < g.mult.rockets; i++) out.push({ k: 'rocket', x: g.rules.rocketMult });
  if (g.mult.springSeats?.length) out.push({ k: 'spring', x: g.rules.springMult, seats: g.mult.springSeats.slice() });
  if (g.mult.spring === 'anti') out.push({ k: 'anti', x: g.rules.antiSpringMult });
  return out;
}

/**
 * Skor: Tuan Tanah lawan tiap petani = base × pengali petani itu. mults = angka (sama untuk semua) atau [per kursi].
 * -> poin per kursi (jumlahnya 0).
 */
export function scoreHand(landlord, landlordWon, mults, base = 1) {
  const m = (s) => (Array.isArray(mults) ? mults[s] : mults);
  const pts = [0, 1, 2].map((s) => (s === landlord ? 0 : (landlordWon ? -1 : 1) * base * m(s)));
  pts[landlord] = -pts.reduce((a, b) => a + b, 0);
  return pts;
}

function finish(g, winner) {
  const L = g.landlord;
  const landlordWon = winner === L;
  const peasants = [0, 1, 2].filter((s) => s !== L);
  const zero = peasants.filter((s) => g.playsBy[s] === 0);
  g.mult.springSeats = [];
  if (landlordWon && zero.length && (g.rules.springPerPlayer || zero.length === 2)) {
    g.mult.springSeats = zero;
    g.mult.spring = 'spring';
  }
  if (!landlordWon && g.playsBy[L] === 1) g.mult.spring = 'anti';
  if (g.mult.spring) pushLog(g, { k: g.mult.spring, seat: landlordWon ? L : winner, seats: g.mult.springSeats.slice() });
  g.phase = 'done';
  g.turn = -1;
  const mults = [0, 1, 2].map((s) => (s === L ? null : seatMult(g, s)));
  g.result = {
    winner, landlordWon, mult: totalMult(g), mults, points: scoreHand(L, landlordWon, mults, g.rules.base),
    spring: g.mult.spring, springSeats: g.mult.springSeats.slice(), breakdown: multBreakdown(g),
  };
  pushLog(g, { k: 'done', seat: winner });
}

/** Kartu yang sudah keluar (publik). */
export const playedCards = (g) => g.plays.filter((p) => p.cards).flatMap((p) => p.cards);

/**
 * Yang boleh dilihat kursi `seat` (-1 = penonton). Tangan lawan hanya jumlahnya; kartu dasar hanya untuk tuan tanah
 * (atau semua orang kalau rules.showKitty). Setelah tangan selesai sisa kartu semua pemain dibuka.
 */
export function viewFor(g, seat) {
  const done = g.phase === 'done';
  const lord = g.landlord;
  return {
    phase: g.phase, starter: g.starter, landlord: lord, turn: g.turn, redeals: g.redeals,
    hand: seat >= 0 ? g.hands[seat] : null,
    counts: g.hands.map((h) => h.length),
    kitty: lord >= 0 && (done || g.rules.showKitty || seat === lord) ? g.kitty : null,
    bid: g.bid ? { acts: g.bid.acts, caller: g.bid.caller, candidate: g.bid.candidate, high: g.bid.high, options: seat === g.turn ? bidOptions(g) : [] } : null,
    mult: totalMult(g), breakdown: multBreakdown(g), bombs: g.mult.bombs + g.mult.rockets,
    last: g.trick?.last || null, mustLead: seat === g.turn && mustLead(g),
    plays: g.plays.slice(-120),
    result: done ? g.result : null,
    reveal: done ? g.hands : null,
    log: g.log.slice(-12), // tiap kejadian punya id naik terus: klien memutar efek untuk id yang belum pernah dilihat
    rules: { showKitty: g.rules.showKitty, bidMode: g.rules.bidding.mode, base: g.rules.base },
  };
}
