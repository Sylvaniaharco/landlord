// Akun bersama (sama dengan Mahjong Kung2 & Capsa Kung2). Doudizhu tidak punya sistem login sendiri: halaman ini memanggil API Mahjong
// (/games/mahjonghk/api/*) yang satu origin, jadi cookie login Mahjong ikut terkirim → login di satu game = login di semua game.
// Di luar alamat produksi (server lokal statis, pratinjau) fitur akun dimatikan (state 'off').
const API = '/games/mahjonghk/api';

export const accountEnabled = () => typeof location !== 'undefined' && location.pathname.startsWith('/games/doudizhu/');
/** Setelah login Google, server Mahjong mengembalikan pemain ke /games/doudizhu/?login=ok (kunci `doudizhu` di worker/next.js Mahjong). */
export const loginUrl = `${API}/auth/google?next=doudizhu`;

/**
 * Ringkas jawaban /me + /config. Murni (dites).
 * -> { state: 'off' } | { state: 'out' } | { state: 'in', name, picture }
 * Tamu Mahjong dihitung belum masuk: Ranked hanya untuk login Google.
 */
export function accountFrom(me, cfg) {
  if (!me || typeof me !== 'object' || !('user' in me)) return { state: 'off' };
  const u = me.user;
  if (u && !u.guest && typeof u.name === 'string') {
    const pic = typeof u.picture === 'string' && /^https:\/\//.test(u.picture) ? u.picture : '';
    return { state: 'in', name: u.name.slice(0, 24) || 'Pemain', picture: pic };
  }
  return cfg && cfg.google ? { state: 'out' } : { state: 'off' };
}

async function getJson(path) {
  const r = await fetch(API + path, { credentials: 'same-origin', cache: 'no-store' });
  if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) throw new Error('bukan JSON');
  return r.json();
}

export async function fetchAccount() {
  if (!accountEnabled()) return { state: 'off' };
  try {
    const [me, cfg] = await Promise.all([getJson('/me'), getJson('/config').catch(() => null)]);
    return accountFrom(me, cfg);
  } catch {
    return { state: 'off' }; // offline / server tidak menjawab: game tetap jalan tanpa akun
  }
}

/** Rating, statistik & riwayat Ranked Doudizhu milik sendiri (null kalau gagal). */
export async function fetchMyStats() {
  try { return await getJson('/doudizhu/me'); } catch { return null; }
}
/** Leaderboard Doudizhu: [{ name, picture, rating, games, wins, tier, mine }] */
export async function fetchLeaderboard() {
  return (await getJson('/doudizhu/leaderboard')).players || [];
}

/** Tiket sekali pakai untuk Ranked: server Doudizhu menukarnya di server akun (id akun tidak pernah berasal dari HP). */
export async function fetchTicket() {
  const r = await fetch(`${API}/auth/ticket`, { method: 'POST', credentials: 'same-origin', cache: 'no-store' });
  const d = (r.headers.get('content-type') || '').includes('json') ? await r.json() : {};
  if (!r.ok || !d.ticket) throw new Error(d.error || 'Server akun tidak menjawab');
  return d.ticket;
}

/** Keluar dari akun (berlaku juga di Mahjong & Capsa: sesinya sama). */
export async function logout() {
  try {
    const r = await fetch(`${API}/auth/logout`, { method: 'POST', credentials: 'same-origin' });
    return r.ok;
  } catch {
    return false;
  }
}

/** Kirim error JS ke dashboard admin Mahjong (mode doudizhu). Maks 10 per sesi, tanpa data pribadi. */
export function installErrorLog(version) {
  if (!accountEnabled()) return;
  const sent = new Set();
  let count = 0;
  const report = (msg, src, stack) => {
    try {
      msg = String(msg || '').slice(0, 300);
      if (!msg || count >= 10) return;
      const key = `${msg}|${src}`;
      if (sent.has(key)) return;
      sent.add(key);
      count++;
      const body = JSON.stringify({ msg, src: String(src || '').slice(0, 200), stack: String(stack || '').slice(0, 800), ver: version() || '', mode: 'doudizhu' });
      fetch(`${API}/errors`, { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true, credentials: 'same-origin' }).catch(() => {});
    } catch { /* pelaporan tidak boleh mengganggu game */ }
  };
  window.addEventListener('error', (e) => {
    if (!e.error && !e.message) return;
    report(e.message || e.error?.message, e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : '', e.error?.stack);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    if (r?.name === 'AbortError') return;
    report(r?.message || (typeof r === 'string' ? r : ''), '', r?.stack);
  });
}
