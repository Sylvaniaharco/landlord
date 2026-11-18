// Mode Latihan (lawan 2 bot) berjalan di HP memakai logika meja yang SAMA dengan server (src/engine/room.js),
// dengan antarmuka yang sama dengan RoomSession (send / close + handler onState), jadi layar meja tidak perlu tahu bedanya.
import * as R from '../engine/room.js';

const seed = () => crypto.getRandomValues(new Uint32Array(1))[0];

export class LocalTable {
  constructor(user, level, handlers) {
    this.user = user;
    this.h = handlers;
    this.closed = false;
    this.timer = 0;
    this.room = R.createPractice(user, level, seed(), Date.now());
    this.pump();
  }

  get seat() { return R.seatOf(this.room, this.user.id); }

  send(m) {
    if (this.closed) return;
    const r = this.room, now = Date.now();
    let res = null;
    if (m.t === 'act') res = R.act(r, this.seat, m.a, now);
    else if (m.t === 'next') res = R.next(r, this.user.id, seed(), now, Math.random);
    else if (m.t === 'takeover') res = R.takeover(r, this.seat);
    else return;
    if (res && !res.ok && res.error) this.h.onError?.(res.error);
    this.pump();
  }

  pump() {
    if (this.closed) return;
    clearTimeout(this.timer);
    const r = this.room;
    this.h.onState?.(R.viewFor(r, this.seat), Date.now());
    const d = R.due(r);
    if (!d) return;
    this.timer = setTimeout(() => {
      if (this.closed) return;
      R.step(r, Date.now());
      this.pump();
    }, Math.max(30, d.at - Date.now()));
  }

  close() {
    this.closed = true;
    clearTimeout(this.timer);
  }
}
