// Tombol "Pasang aplikasi" (PWA). Memakai beforeinstallprompt supaya terpasang sebagai aplikasi sungguhan (WebAPK).
// Pola yang sama dengan Mahjong Kung2 (src/ui/install.js di games-mahjong0hk).
let deferred = null;
const listeners = new Set();
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e;
  listeners.forEach((f) => f());
});
window.addEventListener('appinstalled', () => {
  deferred = null;
  listeners.forEach((f) => f());
});

export const onInstallChange = (f) => listeners.add(f);

/** Tombol hanya tampil kalau game belum dibuka sebagai aplikasi terpasang. */
export const canShowInstall = () => !standalone();

/** Jalankan pemasangan. Kembalikan teks petunjuk kalau browser tidak mendukung prompt langsung, atau '' kalau prompt muncul. */
export async function installApp() {
  if (deferred) {
    const d = deferred;
    deferred = null;
    d.prompt();
    try { await d.userChoice; } catch { /* dibatalkan */ }
    return '';
  }
  return ios
    ? 'Di iPhone: ketuk tombol Bagikan lalu pilih "Tambah ke Layar Utama".'
    : 'Kalau ikon Doudizhu Kung2 sudah ada di layar utama, berarti sudah terpasang: buka lewat ikon itu. Kalau belum, ketuk menu ⋮ Chrome lalu pilih "Install app" atau "Tambahkan ke layar utama".';
}
