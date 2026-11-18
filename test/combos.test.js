import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCards as P, counts } from '../src/engine/cards.js';
import { classify, beats, readPlay, legalMoves, allMoves, owns } from '../src/engine/combos.js';
import { makeRules } from '../src/engine/rules.config.js';

const type = (s) => classify(P(s))[0]?.type ?? null;
const types = (s) => classify(P(s)).map((c) => c.type);
const C = (s) => classify(P(s))[0];

test('kombinasi dasar', () => {
  assert.equal(type('3'), 'single');
  assert.equal(type('RJ'), 'single');
  assert.equal(type('7 7'), 'pair');
  assert.equal(type('BJ RJ'), 'rocket');
  assert.equal(type('3 4'), null);
  assert.equal(type('K K K'), 'triple');
  assert.equal(type('K K K 3'), 'triple1');
  assert.equal(type('K K K 3 3'), 'triple2');
  assert.equal(type('K K K BJ RJ'), null, 'dua joker bukan pasangan');
  assert.equal(type('9 9 9 9'), 'bomb');
  assert.equal(type('2 2 2 2'), 'bomb');
});

test('straight & pasang berurutan: 3..A saja, tanpa 2 dan joker', () => {
  assert.equal(type('3 4 5 6 7'), 'straight');
  assert.equal(type('10 J Q K A'), 'straight');
  assert.equal(C('3 4 5 6 7 8 9 10 J Q K A').len, 12);
  assert.equal(type('J Q K A 2'), null);
  assert.equal(type('3 4 5 6'), null);
  assert.equal(type('3 4 5 6 8'), null);
  assert.equal(type('3 3 4 4 5 5'), 'pairs');
  assert.equal(type('3 3 4 4'), null);
  assert.equal(type('K K A A 2 2'), null);
  assert.equal(type('Q Q K K A A'), 'pairs');
});

test('pesawat: polos, + satu kartu per tris, + pasang per tris, tanpa campur & tanpa sayap kembar', () => {
  assert.equal(type('3 3 3 4 4 4'), 'plane');
  assert.equal(type('3 3 3 4 4 4 9 J'), 'plane1');
  assert.equal(type('3 3 3 4 4 4 9 9'), 'plane1', 'dua kartu lepas boleh sama rank');
  assert.equal(type('3 3 3 4 4 4 9 9 J J'), 'plane2');
  assert.equal(type('3 3 3 4 4 4 9 J J'), null, 'campur satu + pasang tidak boleh');
  assert.equal(type('3 3 3 4 4 4 4 9'), null, 'sayap tidak boleh rank pesawat');
  assert.equal(type('K K K A A A 2 2 2'), null, '2 tidak boleh di pesawat');
  assert.equal(type('3 3 3 5 5 5'), null, 'tidak berurutan');
  assert.equal(type('3 3 3 4 4 4 5 5 5 BJ RJ 6'), 'plane1', 'joker boleh jadi sayap lepas');
  assert.equal(type('3 3 3 4 4 4 BJ BJ'.replace('BJ BJ', 'BJ RJ')), 'plane1');
  // ambigu: 333444555666 = pesawat 4 atau pesawat 3 + sayap
  assert.deepEqual(types('3 3 3 4 4 4 5 5 5 6 6 6').slice(0, 1), ['plane']);
  assert.ok(types('3 3 3 4 4 4 5 5 5 6 6 6').includes('plane1'));
});

test('empat + 2 dan empat + 2 pasang bukan bom', () => {
  assert.equal(type('5 5 5 5 3 9'), 'quad2');
  assert.equal(type('5 5 5 5 3 3'), 'quad2');
  assert.equal(type('5 5 5 5 3 3 9 9'), 'quad4');
  assert.equal(type('5 5 5 5 3 3 9'), null);
  assert.ok(types('5 5 5 5 6 6 6 6').includes('quad4'));
  const off = makeRules({ allowQuadPlusTwo: false, allowAirplaneWings: false });
  assert.equal(classify(P('5 5 5 5 3 9'), off).length, 0);
  assert.equal(classify(P('3 3 3 4 4 4 9 J'), off).length, 0);
  assert.equal(classify(P('3 3 3 4 4 4'), off)[0].type, 'plane');
});

test('perbandingan: jenis & jumlah sama, rank lebih tinggi; bom & roket pengecualian', () => {
  assert.ok(beats(C('4'), C('3')));
  assert.ok(!beats(C('3'), C('3')));
  assert.ok(beats(C('2'), C('A')));
  assert.ok(beats(C('BJ'), C('2')));
  assert.ok(beats(C('RJ'), C('BJ')));
  assert.ok(!beats(C('4 4'), C('3')));
  assert.ok(!beats(C('4 5 6 7 8 9'), C('3 4 5 6 7')), 'panjang beda');
  assert.ok(beats(C('4 5 6 7 8'), C('3 4 5 6 7')));
  assert.ok(beats(C('3 3 3 3'), C('2 2')));
  assert.ok(beats(C('3 3 3 3'), C('10 J Q K A')));
  assert.ok(beats(C('4 4 4 4'), C('3 3 3 3')));
  assert.ok(!beats(C('3 3 3 3'), C('4 4 4 4')));
  assert.ok(beats(C('BJ RJ'), C('2 2 2 2')));
  assert.ok(!beats(C('2 2 2 2'), C('BJ RJ')));
  assert.ok(!beats(C('A A A A 3 4'), C('3 3 3 3')), 'empat+2 bukan bom');
  assert.ok(beats(C('6 6 6 3'), C('5 5 5 K')));
  assert.ok(!beats(C('6 6 6 3 3'), C('5 5 5 K')));
});

test('readPlay memilih bacaan yang bisa mengikuti', () => {
  // 444555666777 bisa mengalahkan pesawat 3 + sayap (333444555 + 9 J Q) sebagai 555666777 + 444
  const prev = readPlay(P('3 3 3 4 4 4 5 5 5 9 J Q'), null);
  assert.equal(prev.type, 'plane1');
  const prev1 = classify(P('3 3 3 4 4 4 5 5 5 9 J Q')).find((c) => c.type === 'plane1');
  const r = readPlay(P('4 4 4 5 5 5 6 6 6 7 7 7'), prev1);
  assert.equal(r.type, 'plane1');
  assert.equal(r.main, 2);
});

test('legalMoves: semua langkah sah, dan semuanya terbaca sama oleh classify', () => {
  const hand = P('3 3 3 4 4 4 5 6 7 8 9 9 9 9 K K A 2 BJ RJ');
  const moves = allMoves(hand);
  assert.ok(moves.length > 50);
  for (const m of moves) {
    assert.ok(owns(hand, m.cards), 'kartu milik sendiri');
    const all = classify(m.cards);
    assert.ok(all.some((c) => c.type === m.combo.type && c.main === m.combo.main && c.len === m.combo.len), `${m.combo.type} ${m.cards}`);
  }
  const t = new Set(moves.map((m) => m.combo.type));
  for (const k of ['single', 'pair', 'triple', 'triple1', 'triple2', 'straight', 'plane', 'plane1', 'bomb', 'rocket', 'quad2', 'quad4']) assert.ok(t.has(k), k);
  const follow = legalMoves(hand, C('A A'));
  assert.deepEqual([...new Set(follow.map((m) => m.combo.type))].sort(), ['bomb', 'rocket']);
  assert.ok(legalMoves(P('3 4'), C('BJ RJ')).length === 0);
  assert.ok(!owns(hand, [hand[0], hand[0]]));
  assert.ok(!owns(hand, [99]));
  assert.equal(counts(hand)[6], 4);
});
