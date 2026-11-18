// Salin file game ke dist/games/doudizhu supaya disajikan di sylvaniaharco.com/games/doudizhu/
// (pola yang sama dengan capsa & games-mahjong0hk). File/folder statis baru harus didaftarkan di sini.
import { cpSync, rmSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist', 'games', 'doudizhu');

rmSync(join(root, 'dist'), { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const item of ['index.html', 'manifest.webmanifest', 'css', 'src', 'avatars', 'icons']) {
  cpSync(join(root, item), join(out, item), { recursive: true });
}

// PWA: sw.js diisi daftar file untuk precache + versi (hash isi file, jadi berubah tiap ada perubahan)
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(p);
  }
})(out);
const hash = createHash('sha1');
const precache = ['./'];
for (const f of files) {
  hash.update(f.slice(out.length)).update(readFileSync(f));
  precache.push('./' + f.slice(out.length + 1).split('\\').join('/'));
}
const version = hash.digest('hex').slice(0, 10);
writeFileSync(
  join(out, 'sw.js'),
  readFileSync(join(root, 'sw.js'), 'utf8').replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(precache)),
);
// version.json: dicek game yang sedang terbuka di lobi; kalau beda, halaman dimuat ulang
writeFileSync(join(out, 'version.json'), JSON.stringify({ v: version }));
console.log('Build selesai →', out, `(versi ${version}, ${precache.length} file)`);
