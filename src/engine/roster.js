// Nama & avatar bot — SAMA dengan Mahjong Kung2 (games-mahjong0hk/src/engine/roster.js). Kalau di sana berubah, salin ke sini.
export const BOT_NAMES = ['Dominic', 'Sebastian', 'Joy', 'Elaina', 'Ellery', 'Elon', 'Elton', 'Jason', 'James', 'Jordan', 'KungKung', 'PoPo'];

/**
 * Avatar tetap untuk tiap nama bot (index = avatars/N.webp dikurangi 1). Bot anak-anak + kakek-nenek:
 * cowok  : 0 bertopi (hoodie biru) · 6 bertopi hijau · 7 bertopi coklat · 8 bertopi ungu · 2 berkacamata
 * cewek  : 1 kuncir · 3 rambut ikal · 9 kuncir pink
 * kakek  : 10 KungKung (kacamata, jenggot) · nenek: 11 PoPo (kacamata bulat, syal bunga)
 * (4 bapak berjenggot & 5 ibu rambut panjang hanya untuk pemain, tidak dipakai bot.)
 */
export const BOT_AVATAR = {
  Sebastian: 0, Elton: 0,
  Dominic: 6, Elon: 6,
  Jason: 7,
  James: 8,
  Jordan: 2,
  Elaina: 1,
  Ellery: 3,
  Joy: 9,
  KungKung: 10,
  PoPo: 11,
};
export const AVATAR_COUNT = 12;

export const clampAvatar = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n < AVATAR_COUNT ? n : null;
};

function shuffle(a, rnd) {
  const out = [...a];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Pilih n bot {name, avatar}: avatar ikut BOT_AVATAR, tidak kembar satu sama lain maupun dengan avatar pemain. rnd wajib diisi. */
export function pickBots(n, usedAvatars, rnd) {
  const av = new Set(usedAvatars.filter((a) => a != null));
  const out = [];
  for (const name of shuffle(BOT_NAMES, rnd)) {
    if (out.length >= n) break;
    const a = BOT_AVATAR[name];
    if (av.has(a)) continue;
    av.add(a);
    out.push({ name, avatar: a });
  }
  return out;
}
