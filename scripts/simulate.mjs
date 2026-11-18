// Simulasi bot vs bot: node scripts/simulate.mjs [jumlah] — cek tidak ada langkah ilegal/macet, sebaran hasil, kekuatan level bot.
import { playOut } from '../src/engine/sim.js';

const N = Number(process.argv[2]) || 1000;
const t0 = Date.now();
const stat = { lordWins: 0, spring: 0, anti: 0, bombs: 0, redeals: 0, mult: {}, maxMult: 0 };
const lv = { easy: 0, normal: 0, hard: 0 };
const lvGames = { easy: 0, normal: 0, hard: 0 };
const levels = ['easy', 'normal', 'hard'];
for (let i = 0; i < N; i++) {
  // tiap kursi diberi level berbeda, diputar supaya adil
  const L = [0, 1, 2].map((k) => levels[(k + i) % 3]);
  const { g } = playOut(1000 + i, L);
  const r = g.result;
  if (r.landlordWon) stat.lordWins++;
  if (r.spring === 'spring') stat.spring++;
  if (r.spring === 'anti') stat.anti++;
  stat.bombs += g.mult.bombs + g.mult.rockets;
  stat.redeals += g.redeals;
  stat.mult[r.mult] = (stat.mult[r.mult] || 0) + 1;
  stat.maxMult = Math.max(stat.maxMult, r.mult);
  if (r.points.reduce((a, b) => a + b, 0) !== 0) throw new Error('skor tidak zero-sum');
  r.points.forEach((p, s) => { lv[L[s]] += p; lvGames[L[s]]++; });
}
const ms = Date.now() - t0;
console.log(`${N} tangan, ${ms} ms (${(ms / N).toFixed(1)} ms/tangan)`);
console.log(`tuan tanah menang ${(100 * stat.lordWins / N).toFixed(1)}% · spring ${stat.spring} · anti-spring ${stat.anti} · bom/roket ${(stat.bombs / N).toFixed(2)}/tangan · bagi ulang ${stat.redeals}`);
console.log('sebaran pengali', stat.mult, 'maks', stat.maxMult);
for (const k of levels) console.log(`poin rata-rata ${k}: ${(lv[k] / lvGames[k]).toFixed(2)}/tangan`);
