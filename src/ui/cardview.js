// Elemen kartu (DOM). size: 'big' (tangan sendiri) atau 'mini' (kartu yang keluar di meja / kartu dasar).
import { RANKS, rankOf, suitOf, isRed } from '../engine/cards.js';

const suitSvg = (s) => `<svg class="su" viewBox="0 0 24 24" aria-hidden="true"><use href="#su${s}"/></svg>`;
const SUIT_WORDS = ['wajik', 'keriting', 'hati', 'sekop'];

export function cardEl(c, size = 'big') {
  const el = document.createElement('div');
  el.dataset.c = c;
  if (c >= 52) {
    // joker: tulisan JOKER tegak + bintang; merah = joker besar, hitam = joker kecil
    const red = c === 53;
    el.className = `card ${size} joker ${red ? 'red' : 'blk'}`;
    el.setAttribute('aria-label', red ? 'joker merah' : 'joker hitam');
    el.innerHTML = `<span class="jk">${'JOKER'.split('').map((ch) => `<i>${ch}</i>`).join('')}</span><span class="star">★</span>`;
    return el;
  }
  const r = rankOf(c), s = suitOf(c);
  el.className = `card ${size} ${isRed(c) ? 'red' : 'blk'}`;
  el.setAttribute('aria-label', `${RANKS[r]} ${SUIT_WORDS[s]}`);
  const ix = `<span class="ix${r === 7 ? ' ten' : ''}"><b>${RANKS[r]}</b>${suitSvg(s)}</span>`;
  const art = r >= 8 && r <= 10 ? `<span class="court"><b>${RANKS[r]}</b>${suitSvg(s)}</span>` : `<span class="pip">${suitSvg(s)}</span>`;
  el.innerHTML = ix + art;
  return el;
}

export function backEl(size = 'mini') {
  const el = document.createElement('div');
  el.className = `card ${size} back`;
  return el;
}
