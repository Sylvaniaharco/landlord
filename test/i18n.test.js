import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { EN } from '../src/ui/lang-en.js';
import { tx, setLang } from '../src/ui/i18n.js';
import { LEVELS } from '../src/engine/bot.js';
import { TYPE_NAMES } from '../src/engine/combos.js';

const files = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : f.endsWith('.js') ? [join(dir, f)] : []));
const src = [...files('src'), ...files('worker')].filter((f) => !f.endsWith('i18n.js') && !f.endsWith('lang-en.js'));

test('semua teks tx(\'...\') dan data-t punya terjemahan English', () => {
  const missing = [];
  for (const f of src) {
    for (const m of readFileSync(f, 'utf8').matchAll(/tx\(\s*'((?:[^'\\]|\\.)*)'/g)) if (!Object.hasOwn(EN, m[1])) missing.push(`${f}: ${m[1]}`);
  }
  const html = readFileSync('index.html', 'utf8');
  for (const m of html.matchAll(/data-t(?:-title="([^"]+)")?[^>]*>([^<]*)</g)) {
    const k = m[1] || m[2].trim();
    if (k && !Object.hasOwn(EN, k)) missing.push(`index.html: ${k}`);
  }
  assert.deepEqual(missing, []);
});

test('kata dari daftar (level bot, jenis kombinasi, tawar, pengali) dan pesan error server punya terjemahan', () => {
  const main = readFileSync('src/main.js', 'utf8');
  const words = [...Object.values(LEVELS), ...Object.values(TYPE_NAMES)];
  for (const name of ['BID_WORDS', 'MULT_WORDS', 'EMOTE_WORDS']) {
    const obj = main.match(new RegExp(`const ${name} = \\{([^}]*)\\}`))[1];
    words.push(...[...obj.matchAll(/'([^']+)'/g)].map((m) => m[1]).filter((w) => !/^[a-z0-9]+$/.test(w)));
  }
  for (const f of src) for (const m of readFileSync(f, 'utf8').matchAll(/error: '([^']+)'/g)) words.push(m[1]);
  const room = readFileSync('src/engine/room.js', 'utf8');
  for (const m of room.matchAll(/: '([A-Z][^']{12,})'/g)) words.push(m[1]);
  const missing = [...new Set(words)].filter((w) => !Object.hasOwn(EN, w));
  assert.deepEqual(missing, []);
});

test('tx: isi {nama} dan default Indonesia', () => {
  setLang('id');
  assert.equal(tx('Tangan {n}', { n: 3 }), 'Tangan 3');
  setLang('en');
  assert.equal(tx('Tangan {n}', { n: 3 }), 'Hand 3');
  assert.equal(tx('teks tanpa terjemahan'), 'teks tanpa terjemahan');
  setLang('id');
});
