// Tes Durable Object meja & pencari meja (worker/room.js, worker/lobby.js) — bagian yang tidak tertutup test/room.test.js:
// penyimpanan, WebSocket, alarm, penyelesaian koin/rating di server akun, dan pembukuan meja Ranked di DdzLobby.
//
// Dijalankan di Node biasa: `cloudflare:workers` diganti tiruan lewat loader hook (test/helpers/cfstub.mjs),
// `Date.now` dikendalikan supaya alarm bisa dimajukan tanpa menunggu betulan.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { botAction } from '../src/engine/bot.js';


register('./helpers/cfstub.mjs', import.meta.url);

// ---------- tiruan lingkungan Workers ----------
let NOW = 1700000000000;
const realNow = Date.now;
Date.now = () => NOW;
const advance = (ms) => { NOW += ms; };

class FakeWS {
  constructor() { this.readyState = 1; this.sent = []; this.closed = null; this.att = null; }
  send(s) { if (this.readyState !== 1) throw new Error('soket tertutup'); this.sent.push(JSON.parse(s)); }
  close(code, reason) { this.readyState = 3; this.closed = { code, reason }; }
  serializeAttachment(v) { this.att = structuredClone(v); }
  deserializeAttachment() { return this.att; }
  msgs(t) { return this.sent.filter((m) => m.t === t); }
  last(t) { return this.msgs(t).at(-1); }
}

class FakeStorage {
  constructor() { this.data = new Map(); this.alarmAt = null; }
  async get(k) { return this.data.has(k) ? structuredClone(this.data.get(k)) : undefined; }
  async put(k, v) { this.data.set(k, structuredClone(v)); } // structuredClone = cek state-nya memang bisa disimpan
  async deleteAll() { this.data.clear(); this.alarmAt = null; }
  async setAlarm(at) { this.alarmAt = at; }
}

class FakeCtx {
  constructor() { this.storage = new FakeStorage(); this.sockets = []; }
  blockConcurrencyWhile(f) { this.pending = f(); return this.pending; }
  acceptWebSocket(ws) { this.sockets.push(ws); }
  getWebSockets() { return this.sockets.filter((w) => w.readyState === 1); }
}

globalThis.WebSocketPair = function () { return { 0: new FakeWS(), 1: new FakeWS() }; };
globalThis.Response = class { constructor(body, init = {}) { this.body = body; this.status = init.status ?? 200; this.webSocket = init.webSocket ?? null; } };

const { DdzRoom, SETTLE_TRIES } = await import('../worker/room.js');
const { DdzLobby } = await import('../worker/lobby.js');

/** Satu meja + lingkungannya. settle = fungsi yang meniru server akun (null = tidak ada binding MAHJONG). */
async function makeRoom({ settle = null, lobby = null } = {}) {
  const ctx = new FakeCtx();
  const env = {
    MAHJONG: settle ? { settle } : undefined,
    LOBBY: lobby ? { idFromName: () => 'main', get: () => lobby } : { idFromName: () => 'main', get: () => ({ reopen: async () => {}, release: async () => {} }) },
  };
  const room = new DdzRoom(ctx, env);
  await ctx.pending; // DurableObject asli menahan permintaan sampai blockConcurrencyWhile selesai
  return room;
}

/** Sambungkan satu pemain lewat jalur asli (DdzRoom.fetch). -> soketnya */
async function connect(ro, user) {
  const req = { headers: new Headers({ Upgrade: 'websocket', 'X-User': JSON.stringify(user) }) };
  const res = await ro.fetch(req);
  return res.webSocket === null ? null : ro.ctx.sockets.at(-1);
}

const say = (ro, ws, m) => ro.webSocketMessage(ws, JSON.stringify(m));

/** Majukan waktu ke alarm berikutnya dan jalankan, sampai `stop()` atau kehabisan langkah. */
async function runAlarms(ro, stop, { max = 400, onTurn = null } = {}) {
  for (let i = 0; i < max; i++) {
    if (stop()) return true;
    if (onTurn) await onTurn();
    if (stop()) return true;
    const at = ro.ctx.storage.alarmAt;
    if (at == null) return false;
    if (at > NOW) NOW = at;
    ro.ctx.storage.alarmAt = null;
    await ro.alarm();
    if (!ro.room) return stop();
  }
  return stop();
}

test('meja teman: dibuat, info, pemain gabung lewat WebSocket, host memulai, state terkirim', async () => {
  const ro = await makeRoom();
  assert.deepEqual(await ro.init('ABCDE', { id: 'aaaaaaaaaaaa', name: 'Ani', avatar: 1 }, 'normal'), { ok: true });
  assert.deepEqual(await ro.init('ABCDE', { id: 'bbbbbbbbbbbb', name: 'Budi' }, 'normal'), { ok: false }, 'kode yang sama tidak bisa dipakai dua kali');
  assert.deepEqual(await ro.info('aaaaaaaaaaaa'), { status: 'lobby', free: 2, mine: true, ranked: false });
  assert.deepEqual((await ro.info('zzzzzzzzzzzz')).mine, false);

  const a = await connect(ro, { id: 'aaaaaaaaaaaa', name: 'Ani', avatar: 1 });
  const b = await connect(ro, { id: 'bbbbbbbbbbbb', name: 'Budi', avatar: 2 });
  assert.ok(a.last('state'), 'pemain langsung dapat state');
  assert.equal(a.last('state').view.seats.filter(Boolean).length, 2);

  await say(ro, b, { t: 'start' });
  assert.equal(b.last('error').msg, 'Hanya pembuat meja yang bisa memulai');
  await say(ro, a, { t: 'start' });
  const v = a.last('state').view;
  assert.equal(v.status, 'playing');
  assert.equal(v.seats.filter((s) => s.bot).length, 1, 'kursi kosong diisi bot');
  assert.equal(v.game.hand.length, 17);
  assert.equal(b.last('state').view.game.hand.length, 17);
  assert.notDeepEqual(a.last('state').view.game.hand, b.last('state').view.game.hand);
  assert.ok(ro.ctx.storage.data.has('room'), 'meja tersimpan');
  assert.ok(ro.ctx.storage.alarmAt > NOW, 'alarm berikutnya dipasang');
});

test('meja teman: ping dibalas pong, aksi ngawur ditolak, keluar melepas kursi di ruang tunggu', async () => {
  const ro = await makeRoom();
  await ro.init('ABCDE', { id: 'aaaaaaaaaaaa', name: 'Ani' }, 'normal');
  const a = await connect(ro, { id: 'aaaaaaaaaaaa', name: 'Ani' });
  const b = await connect(ro, { id: 'bbbbbbbbbbbb', name: 'Budi' });
  a.sent.length = 0;
  await ro.webSocketMessage(a, 'bukan json');
  await ro.webSocketMessage(a, 'x'.repeat(2001));
  assert.equal(a.sent.length, 0, 'pesan rusak diabaikan diam-diam');
  await ro.webSocketMessage(a, JSON.stringify({ t: 'ping' }));
  assert.equal(a.sent.at(-1).t, 'pong');

  assert.equal(ro.room.seats.filter(Boolean).length, 2);
  b.readyState = 3;
  await ro.webSocketClose(b);
  assert.equal(ro.room.seats.filter(Boolean).length, 1, 'putus di ruang tunggu = kursi dilepas');
});

test('emote sampai ke semua pemain; teks bebas & kiriman beruntun diabaikan', async () => {
  const ro = await makeRoom();
  await ro.init('ABCDE', { id: 'aaaaaaaaaaaa', name: 'Ani' }, 'normal');
  const a = await connect(ro, { id: 'aaaaaaaaaaaa', name: 'Ani' });
  const b = await connect(ro, { id: 'bbbbbbbbbbbb', name: 'Budi' });

  await say(ro, a, { t: 'say', k: 'halo' });
  assert.deepEqual(b.last('state').view.chat.map((c) => c.k), ['halo'], 'pemain lain menerimanya');
  assert.equal(b.last('state').view.chat[0].seat, 0);

  const before = b.msgs('state').length;
  await say(ro, a, { t: 'say', k: 'gg' });
  assert.equal(b.msgs('state').length, before, 'terlalu cepat: tidak ada yang dikirim ulang');
  await say(ro, a, { t: 'say', k: '<script>alert(1)</script>' });
  assert.equal(b.msgs('state').length, before, 'teks bebas diabaikan');
  assert.equal(a.msgs('error').length, 0, 'emote yang ditolak tidak bikin pesan error');

  advance(3000);
  await say(ro, b, { t: 'say', k: 'gg' });
  assert.deepEqual(a.last('state').view.chat.map((c) => [c.seat, c.k]), [[0, 'halo'], [1, 'gg']]);
  assert.equal(JSON.stringify(a.last('state').view).includes('bbbbbbbbbbbb'), false, 'id pemain tidak ikut');
});

test('Ranked: reserve → mulai sendiri → tangan selesai → koin & rating dari server akun masuk ke pemain', async () => {
  const calls = [];
  const settle = async (p) => {
    calls.push(p);
    return { u1: { delta: 11, rating: 1011, tier: 'silver', coinDelta: -1500, coins: 48500 } };
  };
  const ro = await makeRoom({ settle });
  await ro.initRanked('RANK1', 500);
  assert.equal((await ro.info('x')).ranked, true);

  const r = await ro.reserve({ key: 'k1k1k1k1k1k1', userId: 'u1', name: 'Ani', avatar: 3, rating: 1000, coins: 50000 });
  assert.deepEqual({ ok: r.ok, key: r.key, joinable: r.joinable }, { ok: true, key: 'k1k1k1k1k1k1', joinable: true });
  assert.deepEqual(await ro.seated('u1'), { key: 'k1k1k1k1k1k1', left: false });
  assert.equal(await ro.seated('u9'), null);

  const ws = await connect(ro, { id: 'k1k1k1k1k1k1', name: 'Ani', avatar: 3 });
  const seat = () => ro.room.seats.findIndex((s) => s && s.id === 'k1k1k1k1k1k1');

  // jalankan sampai tangan pertama selesai; giliran sendiri dimainkan seperti pemain (bukan dibiarkan habis waktu)
  const done = await runAlarms(ro, () => ro.room?.status === 'result' && ro.room.last?.settled, {
    onTurn: async () => {
      const g = ro.room?.game;
      if (ro.room?.status !== 'playing' || g.turn !== seat()) return;
      await say(ro, ws, { t: 'act', a: botAction(g, seat(), 'normal', Math.random) });
    },
  });
  assert.ok(done, 'tangan selesai & tercatat di server akun');
  assert.equal(calls.length, 1, 'server akun dipanggil sekali per tangan');

  const p = calls[0];
  assert.match(p.gameId, /^RANK1:1:[a-z0-9]+$/);
  assert.equal(p.stake, 500);
  assert.equal(p.points.reduce((a, b) => a + b, 0), 0);
  assert.equal(p.seats.filter((s) => s.bot).length, 2);
  assert.equal(p.seats.find((s) => !s.bot).userId, 'u1');
  assert.ok(p.seats.every((s) => s.bot || !s.abandoned), 'pemain yang tersambung tidak dihitung kabur');

  const v = ws.last('state').view;
  assert.equal(v.last.settled, true);
  assert.equal(v.last.myRating, 11);
  assert.equal(v.last.myCoins, -1500);
  assert.equal(v.ranked.rating, 1011);
  assert.equal(v.ranked.coins, 48500);
  assert.equal(JSON.stringify(v).includes('u1'), false, 'userId tidak pernah keluar ke klien');
});

test('Ranked: settle tidak dikirim dua kali walau pump dipanggil barengan', async () => {
  let calls = 0, open = 0, max = 0, done = 0;
  let release;
  const gate = new Promise((res) => { release = res; });
  const ro = await makeRoom({
    settle: async () => {
      calls++;
      open++;
      max = Math.max(max, open);
      try {
        if (calls === 1) throw new Error('coba lagi'); // panggilan pertama gagal → tangan belum selesai dicatat
        await gate; // panggilan kedua menggantung: tiru server akun yang lambat
        done++;
        return {};
      } finally {
        open--;
      }
    },
  });
  await ro.initRanked('RANK2', 25);
  await ro.reserve({ key: 'k1k1k1k1k1k1', userId: 'u1', name: 'Ani', rating: 1000, coins: 5000 });
  const ws = await connect(ro, { id: 'k1k1k1k1k1k1', name: 'Ani' });
  // paksa meja ke layar hasil
  await runAlarms(ro, () => ro.room?.status === 'result', {
    onTurn: async () => {
      const g = ro.room?.game;
      if (ro.room?.status === 'playing' && g.turn === ro.room.seats.findIndex((s) => s?.id === 'k1k1k1k1k1k1')) {
        await say(ro, ws, { t: 'act', a: botAction(g, g.turn, 'normal', Math.random) });
      }
    },
  });
  assert.equal(ro.room.status, 'result');
  // settle pertama masih menunggu server akun; pesan lain yang masuk memicu pump() lagi
  const first = ro.pump();
  await say(ro, ws, { t: 'ping' });
  await ro.pump();
  assert.equal(max, 1, 'hanya satu settle yang jalan sekaligus');
  release();
  await first;
  assert.equal(done, 1);
});

test('Ranked: server akun gagal terus → setelah beberapa percobaan tangan ditutup tanpa koin berpindah', async () => {
  let tries = 0;
  const ro = await makeRoom({ settle: async () => { tries++; throw new Error('mati'); } });
  await ro.initRanked('RANK3', 25);
  await ro.reserve({ key: 'k1k1k1k1k1k1', userId: 'u1', name: 'Ani', rating: 1000, coins: 5000 });
  const ws = await connect(ro, { id: 'k1k1k1k1k1k1', name: 'Ani' });
  const mine = () => ro.room.seats.findIndex((s) => s?.id === 'k1k1k1k1k1k1');
  await runAlarms(ro, () => ro.room?.status === 'result', {
    onTurn: async () => {
      const g = ro.room?.game;
      if (ro.room?.status === 'playing' && g.turn === mine()) await say(ro, ws, { t: 'act', a: botAction(g, g.turn, 'normal', Math.random) });
    },
  });
  for (let i = 0; i < SETTLE_TRIES + 2 && !ro.room.last.settled; i++) {
    advance(5000);
    await ro.pump();
  }
  assert.equal(ro.room.last.settled, true);
  assert.equal(ro.room.last.failed, true);
  assert.ok(tries >= SETTLE_TRIES, `dicoba ulang (${tries}x)`);
  assert.deepEqual(ro.room.last.coins, [0, 0, 0], 'tidak ada koin yang berpindah');
  assert.equal(ws.last('state').view.last.myCoins, 0);
});

test('Ranked: pemain yang dilepas dapat alasannya lalu soketnya ditutup', async () => {
  const ro = await makeRoom({ settle: async () => ({ u1: { delta: 0, rating: 1000, tier: 'bronze', coinDelta: 0, coins: 100 } }) });
  await ro.initRanked('RANK4', 25);
  await ro.reserve({ key: 'k1k1k1k1k1k1', userId: 'u1', name: 'Ani', rating: 1000, coins: 5000 });
  const ws = await connect(ro, { id: 'k1k1k1k1k1k1', name: 'Ani' });
  const mine = () => ro.room.seats.findIndex((s) => s?.id === 'k1k1k1k1k1k1');
  await runAlarms(ro, () => ro.room?.status === 'result' && ro.room.last?.settled, {
    onTurn: async () => {
      const g = ro.room?.game;
      if (ro.room?.status === 'playing' && g.turn === mine()) await say(ro, ws, { t: 'act', a: botAction(g, g.turn, 'normal', Math.random) });
    },
  });
  // saldo (dari server akun) jatuh di bawah minimal meja 25 → tangan berikutnya kursinya dilepas
  assert.equal(ro.room.seats[mine()].coins, 100);
  advance(20000);
  await ro.alarm();
  assert.equal(ws.last('error').msg, 'Koin tidak cukup untuk lanjut di meja ini');
  assert.equal(ws.last('error').fatal, true);
  assert.equal(ws.readyState, 3, 'soketnya ditutup');
});

test('Ranked: meja tanpa pemain ditutup dan dicabut dari pencari meja', async () => {
  const released = [];
  const lobby = { reopen: async (s, c) => { released.push(['reopen', s, c]); }, release: async (s, c) => { released.push(['release', s, c]); } };
  const ro = await makeRoom({ settle: async () => ({}), lobby });
  await ro.initRanked('RANK5', 50);
  advance(70000);
  await ro.alarm();
  assert.equal(ro.room, null, 'meja kosong ditutup');
  assert.deepEqual(released, [['release', 50, 'RANK5']]);
});

test('DdzLobby: menaruh pemain di meja yang sama, bikin meja baru kalau penuh, reopen & release', async () => {
  const rooms = new Map();
  const ctx = new FakeCtx();
  const lobby = new DdzLobby(ctx, {});
  await ctx.pending;
  lobby.ctx = ctx;
  // tiruan DdzRoom: cukup yang dipakai DdzLobby
  const stub = (code) => {
    if (!rooms.has(code)) rooms.set(code, { code, stake: 0, seats: [], closed: false });
    const r = rooms.get(code);
    return {
      initRanked: async (c, stake) => (r.stake ? { ok: false } : ((r.stake = stake), { ok: true })),
      seated: async (userId) => (r.closed ? null : r.seats.includes(userId) ? { key: 'k', left: false } : null),
      reserve: async (u) => {
        if (r.closed) return { ok: false, error: 'Meja tidak ditemukan', joinable: false };
        if (!r.seats.includes(u.userId)) {
          if (r.seats.length >= 3) return { ok: false, error: 'Meja penuh', joinable: false };
          r.seats.push(u.userId);
        }
        return { ok: true, key: u.key, joinable: r.seats.length < 3 };
      },
    };
  };
  lobby.env = { ROOMS: { idFromName: (c) => c, get: (c) => stub(c) } };
  lobby.room = (code) => stub(code);

  const join = (userId) => lobby.assign(25, { userId, name: userId, avatar: 0, rating: 1000, coins: 5000 });
  const a = await join('u1');
  const b = await join('u2');
  const c = await join('u3');
  assert.ok(a.ok && b.ok && c.ok);
  assert.equal(b.code, a.code, 'pemain kedua masuk meja yang sama');
  assert.equal(c.code, a.code);
  assert.notEqual(a.key, b.key, 'kunci kursi berbeda tiap pemain');

  const d = await join('u4');
  assert.notEqual(d.code, a.code, 'meja penuh → meja baru');
  const again = await join('u1');
  assert.equal(again.code, a.code, 'satu akun kembali ke mejanya sendiri');
  assert.equal(again.resumed, true);

  // meja pertama longgar lagi → ditawarkan lagi, bukan bikin meja ketiga
  rooms.get(d.code).seats = ['u4', 'x', 'y'];
  await lobby.release(25, d.code);
  rooms.get(a.code).seats = ['u1'];
  await lobby.reopen(25, a.code);
  const e = await join('u5');
  assert.equal(e.code, a.code, 'meja yang dibuka lagi dipakai');

  // meja yang sudah tutup tidak nyangkut
  rooms.get(a.code).closed = true;
  await lobby.release(25, a.code);
  const f = await join('u6');
  assert.notEqual(f.code, a.code);
  assert.ok(f.ok);
});

test.after(() => { Date.now = realNow; });
