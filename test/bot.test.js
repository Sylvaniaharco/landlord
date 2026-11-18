import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCards as P, mulberry32 } from '../src/engine/cards.js';
import { newHand, applyAction } from '../src/engine/game.js';
import { botAction, bidStrength, hints, timeoutAction } from '../src/engine/bot.js';
import { playOut } from '../src/engine/sim.js';
import { makeRules } from '../src/engine/rules.config.js';

function fixed(hands, lord = 0) {
  const g = newHand(1, lord);
  applyAction(g, lord, { t: 'call' });
  applyAction(g, (lord + 1) % 3, { t: 'pass' });
  applyAction(g, (lord + 2) % 3, { t: 'pass' });
  g.hands = hands.map(P);
  return g;
}
const r = () => 0.5;

test('simulasi 600 tangan bot vs bot (semua level, beberapa varian aturan): tidak ada langkah ilegal, macet, atau skor tidak seimbang', () => {
  const levels = ['easy', 'normal', 'hard'];
  const variants = [undefined, makeRules({ bidding: { mode: 'points' } }), makeRules({ allowAirplaneWings: false, allowQuadPlusTwo: false, showKitty: true })];
  let n = 0;
  for (let i = 0; i < 600; i++) {
    const L = [0, 1, 2].map((k) => levels[(i + k * (1 + (i % 2))) % 3]);
    const { g } = playOut(20000 + i, L, variants[i % 3]);
    assert.equal(g.phase, 'done');
    assert.equal(g.result.points.reduce((a, b) => a + b, 0), 0);
    assert.equal(g.hands[g.result.winner].length, 0);
    const total = g.hands.flat().length + g.plays.filter((p) => p.cards).flatMap((p) => p.cards).length;
    assert.equal(total, 54, 'tidak ada kartu hilang/dobel');
    n++;
  }
  assert.equal(n, 600);
});

test('bot Sulit lebih kuat dari Sedang, Sedang lebih kuat dari Mudah (rata-rata poin)', () => {
  const pts = { easy: 0, normal: 0, hard: 0 };
  const levels = ['easy', 'normal', 'hard'];
  for (let i = 0; i < 900; i++) {
    const L = [0, 1, 2].map((k) => levels[(k + i) % 3]);
    playOut(40000 + i, L).g.result.points.forEach((p, s) => { pts[L[s]] += p; });
  }
  assert.ok(pts.hard > pts.normal && pts.normal > pts.easy, JSON.stringify(pts));
});

test('bot tidak mengintip: tangan lawan ditukar (jumlah sama) → keputusan sama', () => {
  for (let i = 0; i < 60; i++) {
    const g = newHand(300 + i, i % 3);
    const rnd = mulberry32(i);
    // jalankan beberapa langkah dulu
    for (let k = 0; k < 6 + (i % 9) && g.phase !== 'done'; k++) applyAction(g, g.turn, botAction(g, g.turn, 'hard', rnd));
    if (g.phase === 'done') continue;
    const me = g.turn;
    const a1 = botAction(g, me, 'hard', () => 0.3);
    // tukar kartu antar dua lawan (jumlah kartu tetap) + kartu dasar diacak
    const o = [0, 1, 2].filter((s) => s !== me);
    const pool = [...g.hands[o[0]], ...g.hands[o[1]]].sort((a, b) => b - a);
    const n0 = g.hands[o[0]].length;
    g.hands[o[0]] = pool.slice(0, n0);
    g.hands[o[1]] = pool.slice(n0);
    const a2 = botAction(g, me, 'hard', () => 0.3);
    assert.deepEqual(a2, a1);
  }
});

test('tawar: tangan kuat panggil, tangan lemah pass', () => {
  const strong = P('BJ RJ 2 2 2 A A K K K Q Q J 10 9 8 7');
  const weak = P('3 3 4 5 6 7 8 9 9 10 J Q 4 5 6 8 10');
  assert.ok(bidStrength(strong) > bidStrength(weak) + 8);
  const g = newHand(5, 0);
  g.hands[0] = strong;
  assert.equal(botAction(g, 0, 'hard', r).t, 'call');
  g.hands[0] = weak;
  assert.equal(botAction(g, 0, 'hard', r).t, 'pass');
  assert.equal(timeoutAction(g, 0).t, 'pass');
});

test('bom disimpan kalau tidak perlu, dipakai kalau tuan tanah hampir habis', () => {
  // petani (kursi 1) punya bom; tuan tanah (kursi 0) masih banyak kartu dan memimpin satu kartu kecil
  const g = fixed(['3 4 6 8 9 10 J Q K A 2 2 5 5 6 6 7', '7 7 7 7 4 5 9 10 J', 'Q Q K K A A 3 3 8'], 0);
  applyAction(g, 0, { t: 'play', cards: P('3') });
  const a = botAction(g, 1, 'hard', r);
  assert.ok(a.t === 'pass' || a.cards.length === 1, 'tidak membuang bom untuk satu kartu kecil');
  // tuan tanah tinggal 2 kartu
  const h = fixed(['2 2 K', '7 7 7 7 4 5', 'Q Q 3'], 0);
  applyAction(h, 0, { t: 'play', cards: P('K') });
  assert.deepEqual(botAction(h, 1, 'hard', r), { t: 'play', cards: P('7 7 7 7') });
});

test('kerja sama petani: tidak merebut dari teman, menyuapi teman yang tinggal 1 kartu', () => {
  // kursi 1 & 2 petani. Kursi 2 memimpin 9, kursi 0 (tuan tanah) pass → kursi 1 jangan merebut
  const g = fixed(['3 4 5 6 7 8 10 J Q K A 2 2 BJ', 'K A 4 6 8', '9 3'], 0);
  g.turn = 2;
  g.trick = { last: null, passes: 0 };
  applyAction(g, 2, { t: 'play', cards: P('9') });
  applyAction(g, 0, { t: 'pass' });
  assert.equal(botAction(g, 1, 'hard', r).t, 'pass');
  // kursi 1 memimpin, teman (kursi 2) tinggal 1 kartu → keluarkan satu kartu terkecil
  const h = fixed(['K K Q Q J J 10', '4 9 9 J J A', '8'], 0);
  h.turn = 1;
  h.trick = { last: null, passes: 0 };
  assert.deepEqual(botAction(h, 1, 'hard', r), { t: 'play', cards: P('4') });
});

test('saran: langkah pertama sah dan bisa mengalahkan', () => {
  const g = fixed(['3 3 4 4 5 5 9 10 J Q K', '6 6 7 7 8 8 2', 'A A'], 0);
  applyAction(g, 0, { t: 'play', cards: P('3 3 4 4 5 5') });
  const hs = hints(g, 1);
  assert.ok(hs.length >= 1);
  const tryG = structuredClone(g);
  assert.ok(applyAction(tryG, 1, { t: 'play', cards: hs[0] }).ok);
});
