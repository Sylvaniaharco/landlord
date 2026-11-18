// Koin (asal: src/engine/wallet.js repo capsa) — ikut sistem Mahjong Kung2 (worker/coins.js + src/engine/ranked.js di repo games-mahjong0hk):
// saldo awal 1000; saldo minimal masuk 100 / 5.000 / 10.000 (tingkat meja sama dengan Mahjong & Capsa).
// Bedanya: taruhan Doudizhu 25 / 50 / 100 koin per poin (permintaan Teddy, 5 terlalu kecil). Harus sama dengan DDZ_STAKES di
// repo games-mahjong0hk (worker/doudizhu.js), kalau tidak server akun menolak hasil tangan Ranked.
// saldo tidak bisa di bawah 0; kalau saldo kurang dari minimal meja termurah, direset ke 1000 jam 00:01 WIB berikutnya.
export const STAKES = [25, 50, 100];
// 5/10/20 = taruhan lama: meja Ranked yang masih jalan saat ganti versi tetap punya saldo minimal (tidak semua pemain terlempar)
export const STAKE_MIN = { 25: 100, 50: 5000, 100: 10000, 5: 100, 10: 5000, 20: 10000 };
export const minEntry = (stake) => STAKE_MIN[stake] ?? Infinity;
export const START_COINS = 1000;
const WIB_MS = 7 * 3600e3;

/** Nomor "hari" WIB; hari baru mulai jam 00:01 WIB. */
export const wibDay = (ts) => Math.floor((ts + WIB_MS - 60e3) / 86400e3);
export const nextResetAt = (ts) => (wibDay(ts) + 1) * 86400e3 - WIB_MS + 60e3;

export function normalizeWallet(w, now) {
  const today = wibDay(now);
  if (!w || !Number.isFinite(w.coins) || !Number.isFinite(w.day)) return { coins: START_COINS, day: today };
  if (w.coins < minEntry(STAKES[0]) && today > w.day) return { coins: START_COINS, day: today };
  return { coins: Math.max(0, Math.floor(w.coins)), day: w.day };
}

export const coinDelta = (netPoints, stake) => Math.round(netPoints * stake);
export const applyDelta = (coins, delta) => Math.max(0, coins + delta);
export const allowedStakes = (coins) => STAKES.filter((s) => coins >= minEntry(s));
export const isBroke = (coins) => coins < minEntry(STAKES[0]);
