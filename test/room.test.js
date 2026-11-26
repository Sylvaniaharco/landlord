import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../src/engine/room.js';
import { minEntry } from '../src/engine/wallet.js';
import { mulberry32 } from '../src/engine/cards.js';
import { botAction } from '../src/engine/bot.js';

const A = { id: 'aaaaaaaaaaaa', name: 'Ani', avatar: 1 };
const B = { id: 'bbbbbbbbbbbb', name: 'Budi', avatar: 1 };
const rnd = () => mulberry32(9);

/** Jalankan meja sampai tangan selesai: manusia dimainkan bot "dari luar" lewat act(), sisanya step(). */
function runHand(room, t0, humanLevel = 'normal', online = () => true) {
  let now = t0;
  for (let i = 0; i < 2000 && room.status === 'playing'; i++) {
    const g = room.game;
    const s = room.seats[g.turn];
    if (!s.bot && !s.left && !s.auto && online(s.id)) {
      const r = R.act(room, g.turn, botAction(g, g.turn, humanLevel, mulberry32(i)), now);
      assert.ok(r.ok, r.error);
    } else {
      now = R.due(room, online).at;
      assert.ok(R.step(room, now, online), 'step harus jalan');
    }
  }
  assert.equal(room.status, 'result');
  return now;
}

test('meja teman: gabung, mulai diisi bot, tangan selesai, poin dijumlah', () => {
  const room = R.createRoom('ABCDE', A, 0);
  assert.ok(R.join(room, B).ok);
  assert.notEqual(room.seats[1].avatar, room.seats[0].avatar, 'avatar tidak kembar');
  assert.ok(!R.start(room, B.id, 5, 0, rnd()).ok, 'hanya host');
  assert.ok(R.start(room, A.id, 5, 0, rnd()).ok);
  assert.ok(room.seats[2].bot);
  assert.ok(!R.join(room, { id: 'cccccccccccc', name: 'C' }).ok, 'sudah mulai');
  runHand(room, 0);
  assert.equal(room.totals.reduce((a, b) => a + b), 0);
  assert.ok(R.next(room, A.id, 6, 1, rnd()).ok);
  assert.equal(room.round, 2);
  assert.equal(room.game.starter, (room.starter), 'giliran mulai bergilir');
});

test('aksi divalidasi server: bukan giliran / kartu orang lain ditolak', () => {
  const room = R.createRoom('ABCDE', A, 0);
  R.join(room, B);
  R.start(room, A.id, 11, 0, rnd());
  const g = room.game;
  const other = [0, 1].find((s) => s !== g.turn) ?? 2;
  assert.ok(!R.act(room, other, { t: 'call' }, 0).ok);
  if (g.turn < 2) {
    // kartu milik kursi lain
    R.act(room, g.turn, { t: 'call' }, 0);
  }
  assert.ok(!R.act(room, 2, { t: 'pass' }, 0).ok, 'kursi bot tidak bisa diatur pemain');
});

test('waktu habis 2x = main otomatis, pemain bisa mengambil alih', () => {
  const room = R.createRoom('ABCDE', A, 0);
  R.start(room, A.id, 3, 0, rnd());
  let now = 0;
  let timeouts = 0;
  while (room.status === 'playing' && timeouts < 2) {
    const d = R.due(room);
    now = d.at;
    if (d.kind === 'timeout') timeouts++;
    R.step(room, now);
  }
  if (room.status === 'playing') {
    assert.ok(room.seats[0].auto);
    assert.equal(R.due(room).kind === 'bot' || room.game.turn !== 0, true);
    R.takeover(room, 0);
    assert.ok(!room.seats[0].auto);
  }
});

test('pemain putus: gilirannya dimainkan bot setelah sebentar, tidak menunggu waktu penuh', () => {
  const room = R.createRoom('ABCDE', A, 0);
  R.join(room, B);
  R.start(room, A.id, 21, 1000, rnd());
  // jalankan sampai giliran manusia
  let now = 1000;
  while (room.seats[room.game.turn].bot) { now = R.due(room).at; R.step(room, now); }
  const off = () => false;
  const d = R.due(room, off);
  assert.equal(d.kind, 'offline');
  assert.ok(d.at - room.turnAt <= R.OFFLINE_TURN_MS);
  assert.ok(R.step(room, d.at, off));
});

test('ruangan latihan berjalan ratusan tangan tanpa macet (semua kursi otomatis)', () => {
  const room = R.createPractice(A, 'hard', 77, 0);
  room.seats[0].auto = true;
  let now = 0;
  for (let h = 0; h < 200; h++) {
    now = runHand(room, now);
    assert.equal(room.totals.reduce((a, b) => a + b), 0);
    assert.ok(R.next(room, A.id, 1000 + h, now).ok);
    room.seats[0].auto = true;
  }
});

test('viewFor: tidak memuat id, userId, kartu lawan, atau kartu dasar untuk petani', () => {
  const room = R.createRanked('RNKED', 0);
  R.reserve(room, { key: 'kkkkkkkkkkkk', userId: 'g:secret', name: 'Ani', avatar: 2, rating: 1100 }, 0);
  R.startRanked(room, 9, 20000, rnd());
  const v = R.viewFor(room, 0);
  const s = JSON.stringify(v);
  assert.ok(!s.includes('g:secret') && !s.includes('kkkkkkkkkkkk'));
  assert.equal(v.ranked.rating, 1100);
  assert.equal(v.game.hand.length, 17);
  assert.ok(!('hands' in v.game));
  for (const c of room.game.hands[1]) assert.ok(!v.game.hand.includes(c));
  assert.equal(v.game.kitty, null);
});

test('Ranked: mulai setelah waktu tunggu, kursi kosong bot, pemain kabur dapat tanda abandoned, tangan berikutnya kursinya dilepas', () => {
  const room = R.createRanked('RNKED', 0);
  const u1 = { key: 'key1key1key1', userId: 'g:1', name: 'Ani', avatar: 0, rating: 1000 };
  const u2 = { key: 'key2key2key2', userId: 'g:2', name: 'Budi', avatar: 0, rating: 1200 };
  assert.ok(R.reserve(room, u1, 0).ok);
  assert.equal(R.rankedDue(room, 1000), null);
  assert.ok(R.reserve(room, u2, 1000).ok);
  assert.equal(R.reserve(room, { ...u2, key: 'other0000000' }, 1000).key, u2.key, 'satu akun satu kursi');
  assert.equal(R.rankedDue(room, R.RANKED_WAIT_MS), 'start');
  R.startRanked(room, 4, R.RANKED_WAIT_MS, rnd());
  assert.equal(room.seats.filter((s) => s.bot).length, 1);
  assert.ok(R.joinable(room), 'kursi bot bisa diganti pemain baru');
  assert.ok(R.reserve(room, { key: 'key3key3key3', userId: 'g:3', name: 'C', avatar: 4, rating: 900 }, 20000).ok);
  assert.equal(room.pending.length, 1);
  R.leave(room, u2.key); // kabur di tengah tangan
  const now = runHand(room, 20000);
  assert.deepEqual(room.last.abandoned, room.seats.map((s) => s.userId === 'g:2'));
  const p = R.settlePayload(room);
  assert.match(p.gameId, /^RNKED:1:[a-z0-9]+$/);
  assert.equal(p.seats.length, 3);
  assert.equal(p.seats.find((s) => s.userId === 'g:2').abandoned, true);
  assert.equal(p.seats.filter((s) => s.bot).length, 1);
  assert.equal(R.rankedDue(room, now + 1e6), null, 'belum diselesaikan di server akun');
  R.applySettle(room, { 'g:1': { delta: 12, rating: 1012, tier: 'bronze' } });
  assert.equal(R.viewFor(room, room.seats.findIndex((s) => s.userId === 'g:1')).last.myRating, 12);
  assert.equal(R.rankedDue(room, now + R.RANKED_NEXT_MS), 'next');
  const out = R.nextRanked(room, 5, now + R.RANKED_NEXT_MS, rnd());
  assert.ok(!out.closed);
  assert.ok(!room.seats.some((s) => s.userId === 'g:2'), 'yang kabur dilepas');
  assert.ok(room.seats.some((s) => s.userId === 'g:3'), 'yang menunggu masuk');
  assert.equal(room.round, 2);
});

test('Ranked: putus lama = kabur, putus sebentar tidak', () => {
  const room = R.createRanked('RNKED', 0);
  R.reserve(room, { key: 'key1key1key1', userId: 'g:1', name: 'Ani', avatar: 0 }, 0);
  R.reserve(room, { key: 'key2key2key2', userId: 'g:2', name: 'Budi', avatar: 3 }, 0);
  R.markOnline(room, 'key1key1key1', true, 500);
  R.startRanked(room, 8, 1000, rnd());
  R.markOnline(room, 'key2key2key2', true, 600);
  R.markOnline(room, 'key2key2key2', false, 1000 - R.ABANDON_MS);
  const online = (id) => id !== 'key2key2key2';
  runHand(room, 1000, 'normal', online);
  const i2 = room.seats.findIndex((s) => s.userId === 'g:2');
  const i1 = room.seats.findIndex((s) => s.userId === 'g:1');
  assert.equal(room.last.abandoned[i2], true);
  assert.equal(room.last.abandoned[i1], false);
});

test('Ranked koin: saldo minimal meja, payload berisi taruhan & poin, koin pasti dari server akun, saldo kurang = dilepas', () => {
  const room = R.createRanked('KOIN5', 0, 50);
  const u1 = { key: 'key1key1key1', userId: 'g:1', name: 'Ani', avatar: 0, rating: 1000, coins: 6000 };
  assert.equal(R.reserve(room, { ...u1, coins: 1999 }, 0).ok, false, 'meja 50 butuh 2.000');
  assert.ok(R.reserve(room, u1, 0).ok);
  assert.ok(R.reserve(room, { key: 'key2key2key2', userId: 'g:2', name: 'Budi', avatar: 3, coins: 9000 }, 0).ok);
  R.startRanked(room, 12, R.RANKED_WAIT_MS, rnd());
  const now = runHand(room, R.RANKED_WAIT_MS);
  const L = room.last;
  assert.deepEqual(L.coins, L.points.map((p) => p * 50), 'sementara: poin × taruhan');
  const p = R.settlePayload(room);
  assert.equal(p.stake, 50);
  assert.deepEqual(p.points, L.points);
  const i1 = room.seats.findIndex((s) => s.userId === 'g:1');
  const i2 = room.seats.findIndex((s) => s.userId === 'g:2');
  // server akun: g:1 kalah besar sampai saldo di bawah minimal meja
  R.applySettle(room, { 'g:1': { delta: -5, rating: 995, tier: 'bronze', coinDelta: -4500, coins: 1500 }, 'g:2': { delta: 5, rating: 1005, tier: 'bronze', coinDelta: 80, coins: 9080 } });
  assert.equal(room.last.coins[i1], -4500);
  const v1 = R.viewFor(room, i1);
  assert.equal(v1.last.myCoins, -4500);
  assert.equal(v1.ranked.coins, 1500);
  assert.equal(v1.stake, 50);
  assert.ok(!JSON.stringify(v1).includes('9080'), 'saldo lawan tidak dikirim');
  const out = R.nextRanked(room, 13, now + R.RANKED_NEXT_MS, rnd());
  assert.match(out.removed.key1key1key1, /Koin tidak cukup/);
  assert.equal(seatOfUser(room, 'g:1'), -1);
  assert.ok(seatOfUser(room, 'g:2') >= 0);
  void i2;
});

test('Latihan bermeja koin menyimpan taruhannya (dihitung di HP)', () => {
  assert.equal(R.viewFor(R.createPractice(A, 'easy', 3, 0, 100), 0).stake, 100);
  assert.deepEqual([25, 50, 100, 500].map(minEntry), [500, 2000, 5000, 50000], 'saldo minimal meja 25/50/100/500');
  assert.deepEqual([0, 25, 50, 100, 500].map(R.rankedLevel), ['normal', 'normal', 'expert', 'expert', 'god'], 'level bot per meja Ranked');
  assert.equal(R.createRanked('BESAR', 0, 500).level, 'god', 'meja 500 = bot God');
  assert.equal(R.viewFor(R.createPractice(A, 'easy', 3, 0, 7), 0).stake, 0, 'taruhan tidak dikenal = tanpa koin');
  assert.equal(R.viewFor(R.createPractice(A, 'easy', 3, 0, 5), 0).stake, 0, 'taruhan lama 5 sudah tidak dibuka');
  assert.equal(R.createRanked('LAMA5', 0, 10).ranked.stake, 0, 'meja baru tidak bisa memakai taruhan lama');
});

const seatOfUser = (room, uid) => room.seats.findIndex((s) => s && s.userId === uid);

test('Ranked: kursi dipesan tapi tidak pernah tersambung = dihitung kabur; yang tersambung tidak', () => {
  const room = R.createRanked('RNKED', 0);
  R.reserve(room, { key: 'key1key1key1', userId: 'g:1', name: 'Ani', avatar: 0 }, 0);
  R.reserve(room, { key: 'key2key2key2', userId: 'g:2', name: 'Budi', avatar: 3 }, 0);
  R.markOnline(room, 'key1key1key1', true, 500); // hanya Ani yang membuka WebSocket
  const t0 = R.ABANDON_MS + 1000; // sudah lewat batas putus saat tangan selesai
  R.startRanked(room, 8, t0, rnd());
  const online = (id) => id === 'key1key1key1';
  runHand(room, t0, 'normal', online);
  const i1 = room.seats.findIndex((s) => s.userId === 'g:1');
  const i2 = room.seats.findIndex((s) => s.userId === 'g:2');
  assert.equal(room.last.abandoned[i2], true, 'tidak pernah tersambung → kabur');
  assert.equal(room.last.abandoned[i1], false);
});

test('meja teman: siapa pun yang duduk boleh lanjut ke tangan berikutnya (bukan cuma pembuat meja)', () => {
  const room = R.createRoom('ABCDE', A, 0);
  assert.ok(R.join(room, B).ok);
  assert.ok(R.start(room, A.id, 5, 0, rnd()).ok);
  runHand(room, 0);
  assert.ok(!R.next(room, 'zzzzzzzzzzzz', 6, 1, rnd()).ok, 'yang tidak duduk di meja ditolak');
  assert.equal(room.hostId, A.id);
  assert.ok(R.next(room, B.id, 6, 1, rnd()).ok, 'pemain biasa bisa melanjutkan');
  assert.equal(room.round, 2);
  // pemain yang sudah keluar tidak bisa
  runHand(room, 1);
  R.leave(room, B.id);
  assert.ok(!R.next(room, B.id, 7, 2, rnd()).ok);
  assert.ok(R.next(room, A.id, 7, 2, rnd()).ok);
});

test('Ranked: tangan berikutnya dijadwalkan server, pemain tidak bisa memaksanya', () => {
  const room = R.createRanked('RANK1', 0, 25);
  assert.ok(R.reserve(room, { key: 'k1k1k1k1k1k1', userId: 'u1', name: 'Ani', rating: 1000, coins: 5000 }, 0).ok);
  R.startRanked(room, 5, 0, rnd());
  runHand(room, 0);
  assert.equal(room.status, 'result');
  // kursinya sah, tapi meja Ranked tetap menolak: tanpa ini pemain bisa memaksa tangan baru di meja koin
  assert.equal(R.next(room, 'k1k1k1k1k1k1', 6, 1, rnd()).ok, false);
  assert.equal(room.round, 1);
});

test('Ranked: bonus harian dari server akun ikut ke layar hasil', () => {
  const room = R.createRanked('RANK1', 0, 25);
  assert.ok(R.reserve(room, { key: 'k1k1k1k1k1k1', userId: 'u1', name: 'Ani', rating: 1000, coins: 5000 }, 0).ok);
  R.startRanked(room, 5, 0, rnd());
  const seat = R.seatOf(room, 'k1k1k1k1k1k1');
  runHand(room, 0);
  assert.deepEqual(room.last.bonus, [0, 0, 0]);
  R.applySettle(room, { u1: { delta: 3, rating: 1003, tier: 'bronze', coinDelta: -50, coins: 5050, bonus: 100 } });
  assert.equal(room.last.bonus[seat], 100);
  assert.equal(R.viewFor(room, seat).last.myBonus, 100);
  assert.equal(room.seats[seat].coins, 5050, 'saldo dari server akun (sudah termasuk bonus)');
  // jawaban tanpa bonus (server akun versi lama) tetap jalan
  room.last.bonus = [0, 0, 0];
  R.applySettle(room, { u1: { delta: 3, rating: 1003, tier: 'bronze', coinDelta: -50, coins: 4950 } });
  assert.equal(R.viewFor(room, seat).last.myBonus, 0);
});

test('emote: hanya kunci dari daftar, dibatasi waktunya, dan tidak membocorkan id pemain', () => {
  const room = R.createRoom('ABCDE', A, 0);
  assert.ok(R.join(room, B).ok);
  assert.ok(R.start(room, A.id, 5, 0, rnd()).ok);
  const sa = R.seatOf(room, A.id), sb = R.seatOf(room, B.id);

  assert.ok(R.say(room, sa, R.EMOTES[0], 1000).ok);
  assert.ok(!R.say(room, sa, R.EMOTES[1], 1000 + R.SAY_COOLDOWN_MS - 1).ok, 'terlalu cepat');
  assert.ok(R.say(room, sa, R.EMOTES[1], 1000 + R.SAY_COOLDOWN_MS).ok);
  assert.ok(!R.say(room, sb, 'teks bebas dari HP', 9999).ok, 'teks bebas ditolak');
  assert.ok(!R.say(room, sb, '<img onerror=x>', 9999).ok);
  assert.ok(!R.say(room, 2, R.EMOTES[0], 9999).ok, 'kursi bot tidak bisa emote');
  assert.ok(R.say(room, sb, R.EMOTES[2], 9999).ok);

  const v = R.viewFor(room, sb);
  assert.deepEqual(v.chat.map((c) => c.k), [R.EMOTES[0], R.EMOTES[1], R.EMOTES[2]]);
  assert.ok(v.chat.every((c) => Object.keys(c).sort().join() === 'at,id,k,seat'), 'tidak ada field lain');
  assert.equal(JSON.stringify(v).includes(A.id), false);

  // hanya beberapa emote terakhir yang disimpan
  for (let i = 0; i < 20; i++) R.say(room, sa, R.EMOTES[i % R.EMOTES.length], 20000 + i * R.SAY_COOLDOWN_MS);
  assert.ok(room.chat.length <= 6, `chat dipangkas (${room.chat.length})`);
  assert.deepEqual(room.chat.map((c) => c.id), [...room.chat.map((c) => c.id)].sort((x, y) => x - y), 'id naik terus');

  // pemain yang sudah keluar tidak bisa emote
  R.leave(room, B.id);
  assert.ok(!R.say(room, sb, R.EMOTES[0], 999999).ok);
});
