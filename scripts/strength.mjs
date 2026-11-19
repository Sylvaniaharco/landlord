// Ukur kekuatan satu level bot melawan level lain: node scripts/strength.mjs [levelA] [levelB] [tangan] [seed]
// Tiap tangan dimainkan 3x (kursi A berotasi) supaya adil. Zero-sum: poin rata-rata A > 0 = A lebih kuat.
import { playOut } from '../src/engine/sim.js';
import { validLevel, LEVELS } from '../src/engine/bot.js';

const A = process.argv[2] || 'expert';
const B = process.argv[3] || 'hard';
const N = Number(process.argv[4]) || 150;
const seed = Number(process.argv[5]) || 20000;
for (const lv of [A, B]) if (!validLevel(lv)) throw new Error(`level tidak dikenal: ${lv} (pilih ${Object.keys(LEVELS).join(', ')})`);

const t0 = Date.now();
let sum = 0, games = 0, wins = 0, lord = 0;
for (let i = 0; i < N; i++) {
  for (let pos = 0; pos < 3; pos++) {
    const levels = [B, B, B];
    levels[pos] = A;
    const { g } = playOut(seed + i, levels);
    const p = g.result.points[pos];
    sum += p;
    games++;
    if (p > 0) wins++;
    if (g.landlord === pos) lord++;
  }
}
const ms = Date.now() - t0;
console.log(`${A} vs ${B}: ${(sum / games).toFixed(3)} poin/tangan untuk ${A}, menang ${(100 * wins / games).toFixed(1)}%`);
console.log(`${games} tangan (${(ms / games).toFixed(0)} ms/tangan), ${A} jadi tuan tanah ${(100 * lord / games).toFixed(0)}%`);
