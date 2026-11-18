// Klien meja online: panggilan API + koneksi WebSocket ke satu meja (dengan sambung ulang otomatis).
// Meja bareng teman tanpa rating, jadi pemain dikenali dari id acak yang dibuat & disimpan di HP ini.
const CID_KEY = 'ddz-cid';

/** Id acak HP ini (kunci kursi di meja). Tetap sama selama simpanan browser tidak dihapus. */
export function clientId() {
  let id = '';
  try { id = localStorage.getItem(CID_KEY) || ''; } catch { /* tanpa simpanan: id baru tiap buka */ }
  if (!/^[a-z0-9]{12,40}$/.test(id)) {
    const b = crypto.getRandomValues(new Uint8Array(15));
    id = [...b].map((x) => (x % 36).toString(36)).join('');
    try { localStorage.setItem(CID_KEY, id); } catch { /* lihat di atas */ }
  }
  return id;
}

export async function api(path, opts = {}) {
  const res = await fetch(`api${path}`, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'content-type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    cache: 'no-store',
  });
  if (!(res.headers.get('content-type') || '').includes('json')) throw new Error('Server online tidak tersedia');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

/** Meja online hanya ada kalau game disajikan oleh Worker (bukan server statis lokal / pratinjau). */
/** -> { online, ranked }: meja online ada? Ranked (koin akun) tersedia? */
export async function onlineConfig() {
  try {
    const c = await api('/config');
    return { online: c.online === true, ranked: c.ranked === true };
  } catch {
    return { online: false, ranked: false };
  }
}

const MAX_RETRY = 8;

/**
 * Koneksi ke satu meja. handlers:
 *   onState(view, serverNow)  tampilan terbaru dari server
 *   onError(msg)              pesan penolakan aksi (mis. susunan salah)
 *   onStatus('reconnecting' | 'online')
 *   onEnd(msg)                koneksi berakhir dan tidak dicoba lagi (ditolak masuk / gagal terus)
 */
export class RoomSession {
  constructor(code, user, handlers) {
    this.code = code;
    this.user = user;
    this.h = handlers;
    this.closed = false;
    this.retries = 0;
    this.ping = 0;
    this.connect();
  }

  connect() {
    const u = new URL(`api/rooms/${this.code}/ws`, location.href);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    u.search = new URLSearchParams({ id: this.user.id, name: this.user.name, av: String(this.user.avatar) }).toString();
    const ws = (this.ws = new WebSocket(u));
    let fatal = '';
    ws.onopen = () => {
      if (this.retries) this.h.onStatus?.('online');
      this.retries = 0;
      clearInterval(this.ping);
      this.ping = setInterval(() => this.send({ t: 'ping' }), 25000);
    };
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'state') this.h.onState?.(m.view, m.now);
      else if (m.t === 'error') {
        if (m.fatal) fatal = m.msg;
        else this.h.onError?.(m.msg);
      }
    };
    ws.onclose = () => {
      clearInterval(this.ping);
      if (this.closed || this.ws !== ws) return;
      if (fatal) { this.closed = true; this.h.onEnd?.(fatal); return; }
      if (this.retries >= MAX_RETRY) { this.closed = true; this.h.onEnd?.('Koneksi ke meja terputus'); return; }
      this.h.onStatus?.('reconnecting');
      setTimeout(() => { if (!this.closed) this.connect(); }, Math.min(8000, 600 * 2 ** this.retries++));
    };
  }

  send(msg) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  /** Tutup tanpa sambung ulang. leave = kabari server bahwa kita keluar dari meja. */
  close(leave = false) {
    this.closed = true;
    clearInterval(this.ping);
    if (leave) this.send({ t: 'leave' });
    try { this.ws?.close(); } catch { /* sudah tertutup */ }
  }
}
