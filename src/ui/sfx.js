// Efek suara kecil dari WebAudio (tanpa file). Suara baru bisa keluar setelah pemain menyentuh layar.
let ctx = null;
let on = true;
export const setSound = (v) => { on = !!v; };

function tone(freq, dur, { type = 'triangle', gain = 0.07, at = 0, to = null } = {}) {
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

/** Lonceng (sine + overtone), sama dengan Mahjong Kung2. */
function bell(f, at, { dur = 0.9, gain = 0.12 } = {}) {
  const t = ctx.currentTime + at;
  for (const [mult, amp] of [[1, 1], [2.01, 0.35], [3.98, 0.12]]) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = f * mult;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain * amp, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
}
/** Gong kecil. */
function gong(at) {
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(220, t);
  o.frequency.exponentialRampToValueAtTime(196, t + 1.2);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + 1.5);
  bell(440, at, { dur: 0.9, gain: 0.07 });
}

const SOUNDS = {
  tap: () => tone(700, 0.04),
  swap: () => { tone(520, 0.05); tone(820, 0.07, { at: 0.05 }); },
  deal: () => { for (let i = 0; i < 6; i++) tone(240 + i * 25, 0.035, { type: 'square', gain: 0.025, at: i * 0.07 }); },
  flip: () => tone(380, 0.06, { type: 'square', gain: 0.03, to: 620 }),
  ready: () => { tone(660, 0.08); tone(990, 0.12, { at: 0.08 }); },
  tick: () => tone(1100, 0.03, { type: 'square', gain: 0.03 }),
  scoop: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.12, { at: i * 0.07, gain: 0.08 })); },
  win: () => { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.16, { at: i * 0.09 })); },
  lose: () => { [440, 370, 311, 262].forEach((f, i) => tone(f, 0.2, { at: i * 0.12, type: 'sine' })); },
  bad: () => tone(180, 0.12, { type: 'sawtooth', gain: 0.04 }),
  play: () => { tone(330, 0.05, { type: 'square', gain: 0.035 }); tone(500, 0.06, { at: 0.04, gain: 0.05 }); },
  pass: () => tone(260, 0.09, { type: 'sine', gain: 0.05, to: 200 }),
  call: () => { tone(587, 0.09); tone(880, 0.12, { at: 0.08 }); },
  turn: () => { bell(988, 0, { dur: 0.35, gain: 0.06 }); },
  // bom: dentuman rendah + derau; roket: siul naik; spring: lonceng panjang
  bomb: () => {
    tone(110, 0.5, { type: 'sawtooth', gain: 0.18, to: 40 });
    tone(70, 0.6, { type: 'square', gain: 0.1, to: 30, at: 0.02 });
    for (let i = 0; i < 8; i++) tone(200 + ((i * 137) % 400), 0.05, { type: 'square', gain: 0.03, at: 0.03 * i });
  },
  rocket: () => {
    tone(300, 0.7, { type: 'sawtooth', gain: 0.06, to: 2400 });
    tone(150, 0.4, { type: 'square', gain: 0.12, to: 50, at: 0.7 });
    [784, 988, 1175, 1568].forEach((f, i) => bell(f, 0.75 + i * 0.07, { dur: 0.8, gain: 0.09 }));
  },
  landlord: () => { gong(0); },
  // spring / anti-spring: seperti "Hu besar" di Mahjong — gong + lonceng naik panjang
  sweep: () => {
    gong(0);
    [587.33, 659.25, 739.99, 880, 987.77, 1174.66, 1479.98].forEach((f, i) => bell(f, 0.05 + i * 0.09, { dur: 1.1, gain: 0.13 }));
    gong(0.75);
  },
};

export function sfx(name) {
  if (!on) return;
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    SOUNDS[name]?.();
  } catch { /* tidak ada audio: lewati */ }
}
