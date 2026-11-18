// Main satu tangan bot vs bot sampai selesai (dipakai tes & scripts/simulate.mjs). Murni.
import { newHand, applyAction } from './game.js';
import { botAction } from './bot.js';
import { mulberry32, mixSeed } from './cards.js';
import { RULES } from './rules.config.js';

/** levels = [lv0, lv1, lv2]. -> { g, steps } ; melempar Error kalau bot membuat langkah tidak sah atau macet. */
export function playOut(seed, levels = ['normal', 'normal', 'normal'], rules = RULES, starter = seed % 3) {
  const g = newHand(seed, starter, rules);
  const rnd = mulberry32(mixSeed(seed, 77));
  let steps = 0;
  while (g.phase !== 'done') {
    if (++steps > 600) throw new Error(`macet (seed ${seed})`);
    const seat = g.turn;
    const a = botAction(g, seat, levels[seat], rnd);
    const res = applyAction(g, seat, a);
    if (!res.ok) throw new Error(`langkah tidak sah (seed ${seed}, kursi ${seat}): ${res.error} ${JSON.stringify(a)}`);
    if (g.redeals > 50) throw new Error(`bagi ulang terus (seed ${seed})`);
  }
  return { g, steps };
}
