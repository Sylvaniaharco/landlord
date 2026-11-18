import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCards as P } from '../src/engine/cards.js';
import { newHand, applyAction, viewFor, totalMult, scoreHand, bidOptions, mustLead } from '../src/engine/game.js';
import { makeRules, RULES } from '../src/engine/rules.config.js';

const act = (g, seat, a) => {
  const r = applyAction(g, seat, a);
  assert.ok(r.ok, `${seat} ${JSON.stringify(a)}: ${r.error}`);
};
const play = (g, seat, s) => act(g, seat, { t: 'play', cards: P(s) });
const pass = (g, seat) => act(g, seat, { t: 'pass' });

/** Tangan buatan: tuan tanah langsung kursi `lord` (hand sudah 20 kartu), bid x2 (satu panggilan). */
function fixed(hands, lord = 0, rules = RULES) {
  const g = newHand(1, lord, rules);
  act(g, lord, { t: 'call' });
  for (let i = 1; i < 3; i++) act(g, (lord + i) % 3, { t: 'pass' });
  assert.equal(g.landlord, lord);
  g.hands = hands.map(P);
  return g;
}

test('bagi kartu: 17 + 17 + 17 + 3, tidak ada yang dobel', () => {
  const g = newHand(42, 0);
  assert.deepEqual(g.hands.map((h) => h.length), [17, 17, 17]);
  assert.equal(g.kitty.length, 3);
  assert.equal(new Set([...g.hands.flat(), ...g.kitty]).size, 54);
});

test('tawar: panggil x2, rebut x2, pemanggil dapat kesempatan terakhir', () => {
  const g = newHand(7, 1);
  assert.deepEqual(bidOptions(g), ['call', 'pass']);
  act(g, 1, { t: 'call' });
  assert.equal(g.mult.bid, 2);
  assert.deepEqual(bidOptions(g), ['grab', 'pass']);
  act(g, 2, { t: 'grab' });
  assert.equal(g.mult.bid, 4);
  act(g, 0, { t: 'grab' });
  assert.equal(g.mult.bid, 8);
  assert.equal(g.turn, 1, 'pemanggil pertama mendapat giliran terakhir');
  act(g, 1, { t: 'grab' });
  assert.equal(g.mult.bid, 16);
  assert.equal(g.landlord, 1);
  assert.equal(g.hands[1].length, 20);
  assert.equal(g.phase, 'play');
  assert.equal(g.turn, 1, 'tuan tanah memimpin');
});

test('tawar: perebut terakhir jadi tuan tanah kalau pemanggil pass; yang pass sebelum panggilan tidak bisa merebut', () => {
  const g = newHand(8, 0);
  act(g, 0, { t: 'pass' });
  act(g, 1, { t: 'call' });
  act(g, 2, { t: 'grab' });
  assert.equal(g.turn, 1, 'kursi 0 sudah pass, tidak bisa merebut');
  act(g, 1, { t: 'pass' });
  assert.equal(g.landlord, 2);
  assert.equal(g.mult.bid, 4);
});

test('tawar: satu-satunya pemanggil langsung jadi tuan tanah; semua pass = bagi ulang', () => {
  const g = newHand(9, 2);
  act(g, 2, { t: 'pass' });
  act(g, 0, { t: 'pass' });
  act(g, 1, { t: 'call' });
  assert.equal(g.landlord, 1);
  assert.equal(g.mult.bid, 2);

  const h = newHand(10, 0);
  const before = h.hands.map((x) => x.join()).join('|');
  act(h, 0, { t: 'pass' });
  act(h, 1, { t: 'pass' });
  act(h, 2, { t: 'pass' });
  assert.equal(h.phase, 'bid');
  assert.equal(h.redeals, 1);
  assert.equal(h.turn, 0);
  assert.notEqual(h.hands.map((x) => x.join()).join('|'), before);
  assert.ok(!applyAction(h, 1, { t: 'call' }).ok, 'bukan giliran');
  assert.ok(!applyAction(h, 0, { t: 'grab' }).ok, 'belum ada panggilan');
});

test('tawar gaya 1/2/3 (flag bidding.mode = points)', () => {
  const g = newHand(11, 0, makeRules({ bidding: { mode: 'points' } }));
  assert.deepEqual(bidOptions(g), ['bid1', 'bid2', 'bid3', 'pass']);
  act(g, 0, { t: 'bid1' });
  assert.deepEqual(bidOptions(g), ['bid2', 'bid3', 'pass']);
  act(g, 1, { t: 'bid3' });
  assert.equal(g.landlord, 1);
  assert.equal(totalMult(g), 3);
});

test('main: harus mengikuti jenis yang sama, dua pass = ronde baru untuk yang terakhir main', () => {
  const g = fixed(['3 4 5 6 7 9 9 K K K A A 2 2 BJ 8 8 8 10 J', '3 3 4 4 5 5 6 6 7 7 8 9 10 J Q', '8 9 10 J Q K A Q Q 10'], 0);
  assert.ok(mustLead(g));
  assert.ok(!applyAction(g, 0, { t: 'pass' }).ok, 'pemimpin tidak boleh pass');
  play(g, 0, '3 4 5 6 7');
  assert.ok(!applyAction(g, 1, { t: 'play', cards: P('3 3') }).ok, 'jenis beda');
  assert.ok(!applyAction(g, 1, { t: 'play', cards: P('2') }).ok, 'bukan kartunya');
  play(g, 1, '4 5 6 7 8');
  play(g, 2, '8 9 10 J Q');
  pass(g, 0);
  pass(g, 1);
  assert.equal(g.turn, 2);
  assert.ok(mustLead(g), 'ronde baru');
  play(g, 2, 'Qc');
});

test('pengali: 3 bom = x8 dikali pengali tawar; roket juga x2', () => {
  const g = fixed(['3 3 3 3 4 4 4 4 5 5 5 5 6', '7 7 7 7 8 8', 'BJ RJ 9'], 0);
  play(g, 0, '3 3 3 3');
  play(g, 1, '7 7 7 7');
  pass(g, 2);
  pass(g, 0);
  play(g, 1, '8');
  play(g, 2, '9');
  play(g, 0, '4 4 4 4');
  assert.equal(g.mult.bombs, 3);
  assert.equal(totalMult(g), 2 * 8, 'panggil x2 * 3 bom x8');
  pass(g, 1);
  play(g, 2, 'BJ RJ');
  assert.equal(g.phase, 'done', 'petani habis');
  assert.equal(g.result.landlordWon, false);
  assert.equal(g.result.mult, 2 * 8 * 2);
  assert.deepEqual(g.result.points, [-64, 32, 32]);
  assert.equal(g.result.points.reduce((a, b) => a + b), 0);
  assert.ok(g.result.breakdown.filter((b) => b.k === 'bomb').length === 3);
});

test('spring: tuan tanah habis tanpa petani sempat main = x2; anti-spring juga x2', () => {
  const g = fixed(['3 4 5 6 7 8', '9 9', '10 10'], 0);
  play(g, 0, '3 4 5 6 7 8');
  assert.equal(g.result.spring, 'spring');
  assert.equal(g.result.mult, 4);
  assert.deepEqual(g.result.points, [8, -4, -4]);

  const h = fixed(['3 4 5 6 7 9 J', 'A', '10 10'], 0);
  play(h, 0, '3 4 5 6 7');
  pass(h, 1);
  pass(h, 2);
  play(h, 0, '9');
  play(h, 1, 'A');
  // tuan tanah keluar 2 kali → bukan anti-spring
  assert.equal(h.result.spring, '');

  const k = fixed(['3 4 5 6 7 9', 'A', '10 10'], 0);
  play(k, 0, '9');
  play(k, 1, 'A');
  assert.equal(k.result.spring, 'anti');
  assert.equal(k.result.mult, 4);
  assert.deepEqual(k.result.points, [-8, 4, 4]);
});

test('spring per orang (aturan Teddy): hanya petani yang sama sekali tidak keluar kartu yang x2', () => {
  const run = (rules) => {
    const g = fixed(['2 3 4 5 6 7 8', 'K Q', '10 10'], 0, rules);
    play(g, 0, '3');
    play(g, 1, 'K');
    pass(g, 2);
    play(g, 0, '2');
    pass(g, 1);
    pass(g, 2);
    play(g, 0, '4 5 6 7 8');
    return g.result;
  };
  const r = run(RULES);
  assert.equal(r.spring, 'spring');
  assert.deepEqual(r.springSeats, [2]);
  assert.deepEqual(r.mults, [null, 2, 4], 'kursi 1 sempat keluar kartu: tetap x2 dari panggilan saja');
  assert.deepEqual(r.points, [6, -2, -4]);
  assert.equal(r.mult, 4);
  assert.deepEqual(r.breakdown.find((b) => b.k === 'spring').seats, [2]);
  const classic = run(makeRules({ springPerPlayer: false }));
  assert.equal(classic.spring, '');
  assert.deepEqual(classic.points, [4, -2, -2]);
});

test('batas pengali (multiplierCap)', () => {
  const g = fixed(['3 3 3 3 4 4 4 4 5', '6', '7'], 0, makeRules({ multiplierCap: 4 }));
  play(g, 0, '3 3 3 3');
  pass(g, 1);
  pass(g, 2);
  play(g, 0, '4 4 4 4');
  assert.equal(totalMult(g), 4);
  assert.deepEqual(scoreHand(0, true, 4), [8, -4, -4]);
});

test('viewFor: tangan lawan & kartu dasar tidak bocor', () => {
  const g = newHand(99, 0);
  const v = viewFor(g, 1);
  assert.equal(v.kitty, null);
  assert.deepEqual(v.hand, g.hands[1]);
  assert.deepEqual(v.counts, [17, 17, 17]);
  const s = JSON.stringify(v);
  for (const c of g.kitty) assert.ok(!v.hand.includes(c));
  assert.ok(!('hands' in v) && !s.includes('"seed"'));
  act(g, 0, { t: 'call' });
  act(g, 1, { t: 'pass' });
  act(g, 2, { t: 'pass' });
  assert.equal(viewFor(g, 1).kitty, null, 'petani tidak melihat kartu dasar');
  assert.deepEqual(viewFor(g, 0).kitty, g.kitty, 'tuan tanah tahu kartu mana yang dia terima');
  assert.equal(viewFor(g, 1).reveal, null);
  const open = newHand(99, 0, makeRules({ showKitty: true }));
  act(open, 0, { t: 'call' });
  act(open, 1, { t: 'pass' });
  act(open, 2, { t: 'pass' });
  assert.deepEqual(viewFor(open, 2).kitty, open.kitty, 'showKitty = dibuka ke semua');
});
