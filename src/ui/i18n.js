// Bahasa: teks UI ditulis dalam bahasa Indonesia lewat tx('...'); terjemahan English di src/ui/lang-en.js (kunci = teks Indonesia).
// tx('Meja {code}', { code }) mengisi {nama}. Elemen HTML statis memakai atribut data-t (teks aslinya Indonesia) → applyStatic().
import { EN } from './lang-en.js';

let lang = 'id';
export const getLang = () => lang;
export function setLang(l) {
  lang = l === 'en' ? 'en' : 'id';
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
}

export function tx(s, vars) {
  let out = lang === 'en' && Object.hasOwn(EN, s) ? EN[s] : s;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return out;
}

/** Terjemahkan elemen statis: <b data-t>Teks</b> (teks asli disimpan di data-t saat pertama kali). */
export function applyStatic(root = document) {
  for (const el of root.querySelectorAll('[data-t]')) {
    if (!el.dataset.t) el.dataset.t = el.textContent.trim();
    el.textContent = tx(el.dataset.t);
  }
  for (const el of root.querySelectorAll('[data-t-title]')) el.title = tx(el.dataset.tTitle);
}
