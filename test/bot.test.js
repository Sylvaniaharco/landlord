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

test('bot Jago & God (Monte Carlo): langkahnya sah dan tidak mengintip tangan lawan', () => {
  // sah & tidak macet
  for (let i = 0; i < 6; i++) {
    const L = ['hard', 'hard', 'hard'];
    L[i % 3] = i % 2 ? 'god' : 'expert';
    const { g } = playOut(60000 + i, L);
    assert.equal(g.phase, 'done');
    assert.equal(g.result.points.reduce((a, b) => a + b, 0), 0);
    assert.equal(g.hands.flat().length + g.plays.filter((p) => p.cards).flatMap((p) => p.cards).length, 54);
  }
  // tidak mengintip: dunia yang diundi hanya dari kartu yang belum terlihat, jadi menukar kartu antar lawan tidak mengubah apa pun
  for (let i = 0; i < 8; i++) {
    const g = newHand(700 + i, i % 3);
    const rnd = mulberry32(i);
    for (let k = 0; k < 14 + (i % 5) && g.phase !== 'done'; k++) applyAction(g, g.turn, botAction(g, g.turn, 'hard', rnd));
    if (g.phase === 'done') continue;
    const me = g.turn;
    const lv = i % 2 ? 'god' : 'expert';
    const a1 = botAction(g, me, lv, () => 0.3);
    const o = [0, 1, 2].filter((s) => s !== me);
    const pool = [...g.hands[o[0]], ...g.hands[o[1]]].sort((x, y) => y - x);
    g.hands[o[0]] = pool.slice(0, g.hands[o[0]].length);
    g.hands[o[1]] = pool.slice(g.hands[o[0]].length);
    assert.deepEqual(botAction(g, me, lv, () => 0.3), a1);
  }
  // kekuatannya diukur terpisah (butuh ratusan tangan, terlalu lama untuk CI): node scripts/strength.mjs
});

test('petani tidak menimpa langkah temannya sendiri (semua level)', () => {
  // tuan tanah = kursi 0. Urutan: 0 memimpin 3 → 1 pass → 2 (teman kursi 1) keluar J → 0 pass → giliran kursi 1.
  const g = fixed(['K K Q Q 9 9 7 5 4 3', 'A A 10 10 8 6 5 4 3 3', '2 2 J J 9 8 7 6 5 4']);
  const pick = (seat, rank) => g.hands[seat].find((c) => c >> 2 === rank);
  applyAction(g, 0, { t: 'play', cards: [pick(0, 0)] });
  applyAction(g, 1, { t: 'pass' });
  applyAction(g, 2, { t: 'play', cards: [pick(2, 8)] });
  applyAction(g, 0, { t: 'pass' });
  assert.equal(g.turn, 1);
  assert.equal(g.trick.last.seat, 2);
  for (const lv of ['normal', 'hard', 'expert', 'god']) assert.equal(botAction(g, 1, lv, r).t, 'pass', `level ${lv} menimpa temannya`);
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

test('God: langkahnya sah dan keputusannya bisa diulang persis', () => {
  for (let i = 0; i < 10; i++) {
    const g = newHand(900 + i, i % 3);
    const rnd = mulberry32(i);
    for (let k = 0; k < 16 + (i % 5) && g.phase !== 'done'; k++) applyAction(g, g.turn, botAction(g, g.turn, 'hard', rnd));
    if (g.phase === 'done') continue;
    const me = g.turn;
    const a = botAction(g, me, 'god', () => 0.3);
    assert.deepEqual(botAction(g, me, 'god', () => 0.3), a, 'keputusan God bisa diulang');
    assert.ok(applyAction(structuredClone(g), me, a).ok, 'langkah God sah');
  }
});

test('tawar: Sulit ke atas pakai ambang yang sama (Jago & God tidak menawar seagresif Mudah)', () => {
  // tangan sedang: cukup untuk Mudah (ambang 6) tapi di bawah ambang Sulit/Jago/God (7)
  const g = newHand(11, 0);
  g.hands[0] = P('2 2 K Q J 10 9 8 7 6 5 4 3 4 5 6 7');
  const s = bidStrength(g.hands[0]);
  assert.ok(s >= 6 && s < 7, `kekuatan tangan uji = ${s}`);
  for (const lv of ['hard', 'expert', 'god']) assert.equal(botAction(g, 0, lv, r).t, 'pass', `level ${lv}`);
  assert.equal(botAction(g, 0, 'easy', r).t, 'call');
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

test('pasti menang: roket/bom/kartu teratas dikeluarkan, tidak disimpan sampai keduluan lawan', () => {
  // state akhir tangan yang konsisten: kartu yang tidak dipegang siapa pun dianggap sudah keluar
  const late = (hands, lord = 0) => {
    const g = fixed(hands, lord);
    const held = new Set(g.hands.flat());
    const gone = [];
    for (let c = 0; c < 54; c++) if (!held.has(c)) gone.push(c);
    g.plays = [{ seat: lord, cards: gone }, { seat: -1, trick: true }];
    return g;
  };
  const LV = ['normal', 'hard', 'expert', 'god'];
  const opp = ['9h 8h 7h 6h 5h Kh Qh Jh', '9s 8s 7s 6s 5s Ks Qs Js'];

  // mengikuti: petani (kursi 0) tinggal roket + 1 kartu, tuan tanah masih 8 kartu → roket, lalu kartu terakhir
  for (const lv of LV) {
    const g = late(['BJ RJ 3', '9h 9s 8h 7h 6h Kh Qh Jh', '8s 7s 6s 5s 5h Ks Qs Js'], 1);
    assert.ok(applyAction(g, 1, { t: 'play', cards: g.hands[1].filter((c) => c >> 2 === 6) }).ok);
    assert.ok(applyAction(g, 2, { t: 'pass' }).ok);
    assert.deepEqual(botAction(g, 0, lv, r), { t: 'play', cards: [52, 53] }, lv + ': roket untuk menutup tangan');
  }
  // memimpin: roket + 1 kartu → roket dulu (kalau kartu kecilnya dulu, lawan yang tinggal sedikit bisa habis lebih cepat)
  for (const lv of LV) {
    const g = late(['BJ RJ 3', ...opp], 0);
    assert.deepEqual(botAction(g, 0, lv, r), { t: 'play', cards: [52, 53] }, lv + ': memimpin dengan roket');
  }
  // bom + 1 kartu, tidak ada bom/roket di luar → bom dulu
  const b = late(['5 5 5 5 3', '9h 8h 7h 6h 4h Kh Qh Jh', '9s 8s 7s 6s 4s Ks Qs Js'], 0);
  assert.deepEqual(botAction(b, 0, 'hard', r), { t: 'play', cards: P('5 5 5 5') });
  // bom + 1 kartu TAPI roket masih di luar → bukan pasti menang, bom disimpan
  const b2 = late(['5 5 5 5 3', 'BJ RJ 8h 7h 6h Kh Qh Jh', '9s 8s 7s 6s 4s Ks Qs Js'], 0);
  assert.equal(botAction(b2, 0, 'hard', r).cards.length, 1, 'bom tidak dibuang kalau masih bisa dikalahkan roket');
  // bom + 1 kartu TAPI ada bom lebih tinggi di luar → sama, disimpan
  const b3 = late(['5 5 5 5 3', '9h 9s 9d 9c 7h Kh Qh Jh', '8s 7s 6s 4s 4h Ks Qs Js'], 0);
  assert.equal(botAction(b3, 0, 'hard', r).cards.length, 1, 'bom tidak dibuang kalau ada bom lebih tinggi');
  // kartu teratas (RJ, BJ sudah keluar) + pasang → RJ dulu supaya giliran memimpin balik
  const t = late(['RJ 4 4', ...opp], 0);
  assert.deepEqual(botAction(t, 0, 'hard', r), { t: 'play', cards: [53] });
});

test('saran: langkah pertama sah dan bisa mengalahkan', () => {
  const g = fixed(['3 3 4 4 5 5 9 10 J Q K', '6 6 7 7 8 8 2', 'A A'], 0);
  applyAction(g, 0, { t: 'play', cards: P('3 3 4 4 5 5') });
  const hs = hints(g, 1);
  assert.ok(hs.length >= 1);
  const tryG = structuredClone(g);
  assert.ok(applyAction(tryG, 1, { t: 'play', cards: hs[0] }).ok);
});
