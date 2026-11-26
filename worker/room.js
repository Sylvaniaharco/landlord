// Satu meja online = satu Durable Object. Logika mejanya murni di src/engine/room.js; di sini hanya penyimpanan (SQLite bawaan DO),
// WebSocket, dan alarm (giliran bot / pemain putus / waktu habis, jadwal Ranked, bersih-bersih meja kosong).
import { DurableObject } from 'cloudflare:workers';
import * as R from '../src/engine/room.js';

const IDLE_MS = 10 * 60 * 1000; // meja tanpa koneksi dihapus setelah segini
const SETTLE_RETRY_MS = 3000; // server akun tidak menjawab: coba lagi segini kemudian
export const SETTLE_TRIES = 8;

const seed = () => crypto.getRandomValues(new Uint32Array(1))[0];

export class DdzRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.room = null;
    this.settling = false; // settle() sedang menunggu server akun (lihat pump())
    ctx.blockConcurrencyWhile(async () => {
      this.room = (await ctx.storage.get('room')) || null;
    });
  }

  /** Kabari pencari meja Ranked (DdzLobby). Gagal di sini tidak boleh merusak meja. */
  async tellLobby(method) {
    const r = this.room;
    const stake = r?.kind === 'ranked' ? r.ranked?.stake || 0 : 0;
    if (!stake) return;
    try {
      await this.env.LOBBY.get(this.env.LOBBY.idFromName('main'))[method](stake, r.code);
    } catch (e) {
      console.error('lobby ' + method, r.code, String(e?.message || e));
    }
  }

  async save() {
    await this.ctx.storage.put('room', this.room);
  }

  /** Meja teman dibuat (dipanggil Worker). */
  async init(code, host, level) {
    if (this.room) return { ok: false };
    this.room = R.createRoom(code, host, Date.now(), level);
    await this.save();
    await this.ctx.storage.setAlarm(Date.now() + IDLE_MS);
    return { ok: true };
  }

  /** Status ringkas: sebelum gabung dan untuk masuk lagi setelah app ditutup. */
  async info(id) {
    const r = this.room;
    if (!r) return { status: 'none', free: 0, mine: false, ranked: false };
    return { status: r.status, free: r.seats.filter((s) => !s).length, mine: R.seatOf(r, id) >= 0 || R.isPending(r, id), ranked: r.kind === 'ranked' };
  }

  // ---------- Ranked: dipanggil DdzLobby setelah akun diverifikasi ----------
  async initRanked(code, stake) {
    if (this.room) return { ok: false };
    this.room = R.createRanked(code, Date.now(), stake);
    await this.save();
    await this.ctx.storage.setAlarm(Date.now() + 65000);
    return { ok: true };
  }

  async seated(userId) {
    const r = this.room;
    return r?.kind === 'ranked' && r.status !== 'closed' ? R.seatedUser(r, userId) : null;
  }

  async reserve(user) {
    const r = this.room;
    if (!r) return { ok: false, error: 'Meja tidak ditemukan' };
    const res = R.reserve(r, user, Date.now());
    if (res.ok) await this.pump();
    return { ...res, joinable: R.joinable(r) };
  }

  // ---------- koneksi ----------
  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('WebSocket saja', { status: 426 });
    const user = JSON.parse(request.headers.get('X-User') || 'null');
    if (!user || !this.room) return new Response('Meja tidak ditemukan', { status: 404 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id: user.id });
    const j = R.join(this.room, user);
    if (!j.ok) {
      server.send(JSON.stringify({ t: 'error', msg: j.error, fatal: true }));
      server.close(4000, 'ditolak');
      return new Response(null, { status: 101, webSocket: client });
    }
    R.markOnline(this.room, user.id, true, Date.now());
    await this.pump();
    return new Response(null, { status: 101, webSocket: client });
  }

  sockets() {
    return this.ctx.getWebSockets().map((ws) => ({ ws, ...(ws.deserializeAttachment() || {}) }));
  }

  isConnected(id, except = null) {
    return this.sockets().some((s) => s.id === id && s.ws !== except && s.ws.readyState === 1);
  }

  broadcast(closing = null) {
    const r = this.room;
    const online = (id) => this.isConnected(id, closing);
    const now = Date.now();
    for (const { ws, id } of this.sockets()) {
      if (ws === closing) continue;
      try {
        ws.send(JSON.stringify({ t: 'state', now, view: R.viewFor(r, R.seatOf(r, id), online, id) }));
      } catch { /* soket sudah mati: dibersihkan saat close */ }
    }
  }

  async webSocketMessage(ws, data) {
    const r = this.room;
    if (!r || typeof data !== 'string' || data.length > 2000) return;
    let m;
    try { m = JSON.parse(data); } catch { return; }
    const { id } = ws.deserializeAttachment() || {};
    const seat = R.seatOf(r, id);
    const now = Date.now();
    let res = null;
    if (m.t === 'ping') return ws.send('{"t":"pong"}');
    if (m.t === 'start') res = R.start(r, id, seed(), now, Math.random);
    else if (m.t === 'next') res = r.kind === 'ranked' ? null : R.next(r, id, seed(), now, Math.random);
    else if (m.t === 'takeover') res = R.takeover(r, seat);
    else if (m.t === 'say') { if (!R.say(r, seat, m.k, now).ok) return; } // ditolak (kunci tidak dikenal / terlalu cepat): diam saja
    else if (m.t === 'act') res = R.act(r, seat, m.a, now);
    else if (m.t === 'leave') {
      R.leave(r, id);
      try { ws.close(1000, 'keluar'); } catch { /* sudah tertutup */ }
    } else return;
    if (res && !res.ok && res.error) ws.send(JSON.stringify({ t: 'error', msg: res.error }));
    await this.pump(m.t === 'leave' ? ws : null);
  }

  async webSocketClose(ws) {
    const r = this.room;
    if (!r) return;
    const { id } = ws.deserializeAttachment() || {};
    if (id && !this.isConnected(id, ws)) {
      R.markOnline(r, id, false, Date.now());
      if (r.status === 'lobby' && r.kind !== 'ranked') R.leave(r, id); // ruang tunggu meja teman: kursi dilepas
    }
    await this.pump(ws);
  }

  async webSocketError(ws) {
    await this.webSocketClose(ws);
  }

  /** Simpan, kirim tampilan ke semua, pasang alarm berikutnya. */
  async pump(closing = null) {
    const r = this.room;
    // settle() menunggu RPC ke server akun; selama menunggu, pesan WebSocket lain bisa masuk dan memanggil pump() lagi.
    // Tanpa penjaga ini satu ronde bisa dikirim dua kali sekaligus (server akun aman diulang, tapi jatah SETTLE_TRIES habis percuma).
    if (r.kind === 'ranked' && r.status === 'result' && r.last && !r.last.settled && !this.settling) {
      this.settling = true;
      try {
        await this.settle();
      } finally {
        this.settling = false;
      }
    }
    R.fixHost(r, (id) => this.isConnected(id, closing));
    await this.save();
    this.broadcast(closing);
    const now = Date.now();
    const d = R.due(r, (id) => this.isConnected(id, closing));
    let at = now + IDLE_MS;
    if (d) at = Math.max(now + 50, d.at);
    else if (r.kind === 'ranked' && r.status === 'result' && !r.last?.settled) at = now + SETTLE_RETRY_MS;
    await this.ctx.storage.setAlarm(at);
  }

  /**
   * Ranked: simpan hasil tangan & rating di server akun (Worker Mahjong, DoudizhuGate). Aman diulang (dicatat per tangan).
   * Gagal → dicoba lagi lewat alarm; setelah SETTLE_TRIES kali tangan dianggap selesai tanpa perubahan rating supaya meja tidak macet.
   */
  async settle() {
    const r = this.room;
    r.last.tries = (r.last.tries || 0) + 1;
    try {
      const res = await this.env.MAHJONG.settle(R.settlePayload(r));
      if (res) return R.applySettle(r, res);
      console.error('settle ditolak server akun', r.code, r.last.round);
    } catch (e) {
      console.error('settle gagal', r.code, r.last.round, String(e?.message || e));
      if (r.last.tries < SETTLE_TRIES) return;
    }
    // ditolak atau gagal terus: tidak ada rating/koin yang berpindah di tangan ini
    if (r.last.coins) r.last.coins = [0, 0, 0];
    r.last.settled = true;
    r.last.failed = true;
  }

  async alarm() {
    const r = this.room;
    if (!r) return;
    const now = Date.now();
    const online = (id) => this.isConnected(id);
    if (r.status === 'playing') {
      R.step(r, now, online);
      return this.pump();
    }
    if (r.kind === 'ranked') {
      if (r.status === 'result' && r.last && !r.last.settled) return this.pump();
      const due = R.rankedDue(r, now);
      if (due === 'start') R.startRanked(r, seed(), now, Math.random);
      else if (due === 'next') {
        const out = R.nextRanked(r, seed(), now, Math.random);
        for (const { ws, id } of this.sockets()) {
          if (!out.removed[id]) continue;
          try {
            ws.send(JSON.stringify({ t: 'error', msg: out.removed[id], fatal: true }));
            ws.close(4000, 'dilepas');
          } catch { /* sudah tertutup */ }
        }
      }
      if (due === 'close' || r.status === 'closed') {
        for (const { ws } of this.sockets()) {
          try { ws.close(4000, 'tutup'); } catch { /* sudah tertutup */ }
        }
        await this.tellLobby('release');
        await this.ctx.storage.deleteAll();
        this.room = null;
        return;
      }
      // kursi longgar lagi (pemain keluar / dilepas): tawarkan meja ini lagi ke pencari meja, jangan bikin meja baru terus
      if (due === 'next' && R.joinable(r)) await this.tellLobby('reopen');
      if (due) return this.pump();
    }
    // ruang tunggu / layar hasil: hapus meja yang sudah tidak ada orangnya
    if (!this.sockets().length) {
      await this.tellLobby('release');
      await this.ctx.storage.deleteAll();
      this.room = null;
      return;
    }
    return this.pump();
  }
}
