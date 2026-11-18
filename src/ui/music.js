// Musik latar generatif: ambient pentatonik (D mayor) gaya Tiongkok — pad lembut, petikan senar, seruling.
// SALINAN src/ui/music.js repo games-mahjong0hk (musik yang sama di semua game Kung2); kalau di sana berubah, salin lagi.
// Dibuat langsung lewat Web Audio (tanpa file audio, tanpa vokal). Aktif setelah sentuhan pertama (aturan autoplay browser).
// Setelan nyala/mati memakai kunci yang sama dengan Mahjong (satu domain = satu localStorage), jadi berlaku di semua game.
// Bedanya dengan versi Mahjong: bisa beberapa tombol (lobi: tulisan, meja: ikon).
const KEY = 'mjhk-music';
const SCALE = [293.66, 329.63, 369.99, 440, 493.88, 587.33, 659.25, 739.99, 880]; // D E F# A B (2 oktaf)
const CHORDS = [[146.83, 220], [196, 293.66], [110, 164.81], [164.81, 246.94]]; // D/A, G/D, A/E, E/B
const LEVEL = 0.5;

let ctx = null, bus = null, master = null;
let on = (() => { try { return localStorage.getItem(KEY) !== '0'; } catch { return true; } })();
let started = false, chordTimer = 0, noteTimer = 0, chordIdx = 0, btns = [], labelOf = null;

const rand = (a, b) => a + Math.random() * (b - a);

function impulse(sec) {
  const len = Math.floor(ctx.sampleRate * sec);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
  }
  return buf;
}

function build() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2600;
  master.connect(lp);
  lp.connect(ctx.destination);
  bus = ctx.createGain();
  bus.connect(master);
  const conv = ctx.createConvolver();
  conv.buffer = impulse(3.2);
  const wet = ctx.createGain();
  wet.gain.value = 0.6;
  bus.connect(conv);
  conv.connect(wet);
  wet.connect(master);
  return true;
}

function pad(freqs) {
  const t = ctx.currentTime;
  for (const f of freqs) {
    for (const det of [-5, 5]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      o.detune.value = det;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.05, t + 6);
      g.gain.setValueAtTime(0.05, t + 16);
      g.gain.linearRampToValueAtTime(0, t + 22);
      o.connect(g);
      g.connect(bus);
      o.start(t);
      o.stop(t + 22.1);
    }
  }
}

function pluck(freq, vel, delay = 0) {
  const t = ctx.currentTime + 0.03 + delay;
  const o = ctx.createOscillator();
  o.type = 'triangle';
  o.frequency.setValueAtTime(freq * 1.012, t);
  o.frequency.exponentialRampToValueAtTime(freq, t + 0.09);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vel, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
  o.connect(g);
  g.connect(bus);
  o.start(t);
  o.stop(t + 3.3);
  const o2 = ctx.createOscillator();
  o2.type = 'sine';
  o2.frequency.value = freq * 2;
  const g2 = ctx.createGain();
  g2.gain.setValueAtTime(0.0001, t);
  g2.gain.linearRampToValueAtTime(vel * 0.25, t + 0.01);
  g2.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
  o2.connect(g2);
  g2.connect(bus);
  o2.start(t);
  o2.stop(t + 1.3);
}

function flute(freq) {
  const t = ctx.currentTime + 0.05;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.value = freq;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 5;
  const depth = ctx.createGain();
  depth.gain.value = freq * 0.006;
  lfo.connect(depth);
  depth.connect(o.frequency);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.05, t + 0.7);
  g.gain.setValueAtTime(0.05, t + 2.6);
  g.gain.linearRampToValueAtTime(0, t + 4.5);
  o.connect(g);
  g.connect(bus);
  o.start(t);
  lfo.start(t);
  o.stop(t + 4.6);
  lfo.stop(t + 4.6);
}

function chordLoop() {
  if (!on) return;
  if (!document.hidden) pad(CHORDS[chordIdx++ % CHORDS.length]);
  chordTimer = setTimeout(chordLoop, 16000);
}

function noteLoop() {
  if (!on) return;
  if (!document.hidden) {
    const r = Math.random();
    if (r < 0.28) {
      // frasa pendek: 3–5 nada berjalan naik/turun
      let i = Math.floor(rand(0, SCALE.length));
      const dir = Math.random() < 0.5 ? 1 : -1;
      const n = 3 + Math.floor(rand(0, 3));
      for (let k = 0; k < n; k++) {
        i = Math.max(0, Math.min(SCALE.length - 1, i + dir * (Math.random() < 0.8 ? 1 : 2)));
        pluck(SCALE[i], i > 5 ? 0.05 : 0.08, k * 0.42);
      }
    } else if (r < 0.36) {
      flute(SCALE[Math.floor(rand(0, 5))]);
    } else {
      const i = Math.floor(rand(0, SCALE.length));
      pluck(SCALE[i], i > 5 ? 0.05 : 0.09);
    }
  }
  noteTimer = setTimeout(noteLoop, rand(1400, 4200));
}

function start() {
  if (!ctx && !build()) return;
  ctx.resume?.();
  master.gain.cancelScheduledValues(ctx.currentTime);
  master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
  master.gain.linearRampToValueAtTime(LEVEL, ctx.currentTime + 3);
  if (!started) {
    started = true;
    chordLoop();
    noteLoop();
  }
}

function stop() {
  clearTimeout(chordTimer);
  clearTimeout(noteTimer);
  started = false;
  if (!ctx) return;
  master.gain.cancelScheduledValues(ctx.currentTime);
  master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
  master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.8);
  setTimeout(() => { if (!on) ctx.suspend?.(); }, 1000);
}

function paint() {
  for (const btn of btns) {
    btn.textContent = btn.dataset.music === 'label' && labelOf ? labelOf(on) : on ? '🎵' : '🔇';
    btn.title = on ? 'Musik: nyala (ketuk untuk mati)' : 'Musik: mati (ketuk untuk nyala)';
    btn.setAttribute('aria-pressed', String(on));
  }
}

export function isMusicOn() { return on; }

export function setMusic(v) {
  on = !!v;
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch {}
  if (on) start(); else stop();
  paint();
}

/** Tulis ulang tulisan tombol (mis. setelah ganti bahasa). */
export const paintMusic = () => paint();

/**
 * Pasang tombol musik dan mulai musik pada sentuhan pertama kalau musik nyala.
 * buttons: tombol (ikon 🎵/🔇); tombol dengan data-music="label" diisi label(on) (mis. "Musik: nyala").
 */
export function initMusic(buttons = [], { label = null } = {}) {
  btns = buttons.filter(Boolean);
  labelOf = label;
  for (const btn of btns) btn.onclick = () => setMusic(!on);
  paint();
  const unlock = () => {
    if (on && !started) start();
    if (started) for (const ev of ['pointerdown', 'touchend', 'keydown']) window.removeEventListener(ev, unlock, true);
  };
  for (const ev of ['pointerdown', 'touchend', 'keydown']) window.addEventListener(ev, unlock, true);
  document.addEventListener('visibilitychange', () => {
    if (!ctx || !on) return;
    if (document.hidden) ctx.suspend?.();
    else ctx.resume?.();
  });
}
