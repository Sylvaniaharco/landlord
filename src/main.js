// Doudizhu Kung2 — titik masuk & alur layar: lobi → meja (tawar → main) → hasil.
// Satu renderer untuk semua jenis meja: Latihan (LocalTable, di HP) dan online (RoomSession, server) sama-sama mengirim
// viewFor(room, kursi) dari src/engine/room.js. Klien tidak pernah tahu tangan lawan / kartu dasar.
import { RANKS, rankOf, counts, sortHand } from './engine/cards.js';
import { readPlay, TYPE_NAMES } from './engine/combos.js';
import { hints, LEVELS, DEFAULT_LEVEL, validLevel } from './engine/bot.js';
import { RULES } from './engine/rules.config.js';
import { ROOM_CODE } from './engine/room.js';
import { clampAvatar, AVATAR_COUNT } from './engine/roster.js';
import { cardEl, backEl } from './ui/cardview.js';
import { sfx, setSound } from './ui/sfx.js';
import { canShowInstall, installApp, onInstallChange } from './ui/install.js';
import { fetchAccount, fetchTicket, fetchMyStats, fetchLeaderboard, loginUrl, logout, installErrorLog } from './ui/account.js';
import { tx, setLang, getLang, applyStatic } from './ui/i18n.js';
import { clientId, api, onlineConfig, RoomSession } from './net/online.js';
import { STAKES, minEntry, normalizeWallet, coinDelta, applyDelta, isBroke, START_COINS } from './engine/wallet.js';
import { LocalTable } from './net/local.js';

const $ = (s, root = document) => root.querySelector(s);
const app = $('#app');
const fmt = (n) => Math.round(n).toLocaleString(getLang() === 'en' ? 'en-US' : 'id-ID');
const signed = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n));
const cls = (n) => (n > 0 ? 'pos' : n < 0 ? 'neg' : '');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const WALLET_KEY = 'ddz-wallet', PENDING_KEY = 'ddz-pending', SET_KEY = 'ddz-set', ROOM_KEY = 'ddz-room', NAME_KEY = 'ddz-name', RULES_KEY = 'ddz-rules-seen';
const load = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* mode privat */ } };
const settings = { sound: true, level: DEFAULT_LEVEL, lang: 'id', sort: 'rank', ...(load(SET_KEY) || {}) };
if (!validLevel(settings.level)) settings.level = DEFAULT_LEVEL;
setSound(settings.sound);
setLang(settings.lang);
const saveSettings = () => save(SET_KEY, settings);

// ---------- koin meja lawan bot (di HP, aturan sama dengan Capsa/Mahjong: src/engine/wallet.js) ----------
// Koin akun (server, bersama Mahjong & Capsa) hanya bergerak di Ranked. Koin di sini tidak pernah dikirim ke server.
let wallet = normalizeWallet(load(WALLET_KEY), Date.now());
const saveWallet = () => save(WALLET_KEY, wallet);
saveWallet();
/** Tambah/kurangi koin meja bot. -> perubahan yang benar-benar terjadi (saldo tidak bisa di bawah 0). */
function payWallet(delta) {
  wallet = normalizeWallet(wallet, Date.now());
  const before = wallet.coins;
  wallet = { ...wallet, coins: applyDelta(wallet.coins, delta) };
  saveWallet();
  return wallet.coins - before;
}
/** Tangan bermeja koin yang ditinggal (app ditutup / keluar) dihitung kalah — supaya tidak bisa kabur saat kalah. */
function settleAbandoned() {
  const pd = load(PENDING_KEY);
  save(PENDING_KEY, null);
  if (!pd || !(pd.loss > 0)) return 0;
  return payWallet(-pd.loss);
}
const TABLES = [
  { stake: 0, name: 'Latihan', sub: 'Tanpa koin', color: '#5b6f7f', chip: '0' },
  ...STAKES.map((st, i) => ({ stake: st, name: `Meja ${st}`, color: ['#2c8f73', '#2d6fd8', '#b8324a'][i], chip: String(st) })),
];

// ---------- ukuran layar ----------
function fit() {
  const r = app.getBoundingClientRect();
  app.style.setProperty('--vw', r.width / 100 + 'px');
  app.style.setProperty('--vh', r.height / 100 + 'px');
  const was = app.classList.contains('portrait');
  app.classList.toggle('portrait', r.height > r.width);
  if (T?.view && was !== app.classList.contains('portrait')) renderHand(T.view);
  else if (T) layoutHand();
}
addEventListener('resize', fit);
new ResizeObserver(fit).observe(app);

// ---------- toast & modal ----------
let toastTimer = 0;
function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}
function modal(html) {
  const m = $('#modal');
  m.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  m.hidden = false;
  m.onclick = (e) => { if (e.target === m || e.target.closest('[data-a="close"]')) closeModal(); };
  return m;
}
const closeModal = () => { $('#modal').hidden = true; $('#modal').onclick = null; };
function ask(title, body, yes, no = tx('Batal')) {
  return new Promise((res) => {
    const m = modal(`<h2>${esc(title)}</h2><p>${esc(body)}</p><div class="rs-btns"><button class="btn" data-a="no" type="button">${esc(no)}</button><button class="btn primary" data-a="yes" type="button">${esc(yes)}</button></div>`);
    m.onclick = (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (!a && e.target !== m) return;
      closeModal();
      res(a === 'yes');
    };
  });
}
function askText(title, body, { value = '', code = false, max = 16, okLabel = tx('Lanjut') } = {}) {
  return new Promise((res) => {
    const m = modal(`<h2>${esc(title)}</h2><p>${esc(body)}</p>
      <input class="field${code ? ' code' : ''}" id="fldText" type="text" maxlength="${max}" autocomplete="off" autocapitalize="${code ? 'characters' : 'words'}" spellcheck="false" value="${esc(value)}">
      <div class="rs-btns"><button class="btn" data-a="no" type="button">${tx('Batal')}</button><button class="btn primary" data-a="yes" type="button">${esc(okLabel)}</button></div>`);
    const fld = $('#fldText', m);
    const done = (ok) => { m.onkeydown = null; closeModal(); res(ok ? fld.value : null); };
    fld.focus();
    fld.select();
    m.onkeydown = (e) => { if (e.key === 'Enter') done(true); };
    m.onclick = (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a || e.target === m) done(a === 'yes');
    };
  });
}

// ---------- avatar (ikut pilihan di Mahjong Kung2, satu domain = satu localStorage) ----------
const avatarSrc = (i) => `avatars/${(i % AVATAR_COUNT) + 1}.webp`;
function myAvatar() {
  try { return clampAvatar(JSON.parse(localStorage.getItem('hkmj-settings-v1') || '{}').avatar) ?? 0; } catch { return 0; }
}

// ---------- lobi ----------
const show = (id) => { for (const s of ['lobby', 'table']) $('#' + s).hidden = s !== id; };
let account = { state: 'off' };
let myStats = null; // rating Doudizhu sendiri (dari server akun)
let onlineOn = false, rankedOn = false;

const GOOGLE_ICON = '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';

function renderLobby() {
  applyStatic();
  const sb = $('#btnSound');
  sb.textContent = settings.sound ? tx('Suara: nyala') : tx('Suara: mati');
  sb.setAttribute('aria-pressed', String(settings.sound));
  $('#btnLang').textContent = getLang() === 'en' ? 'ID' : 'EN';
  $('#btnLang').title = getLang() === 'en' ? 'Bahasa Indonesia' : 'English';
  $('#btnInstall').hidden = !canShowInstall();
  $('#lbOnline').hidden = !onlineOn;
  $('#lbRanked').hidden = !(rankedOn && account.state !== 'off');
  $('#btnBoard').hidden = account.state === 'off';
  $('#lvlSeg').innerHTML = Object.keys(LEVELS).map((k) =>
    `<button class="seg-b${k === settings.level ? ' on' : ''}" data-lv="${k}" type="button" aria-pressed="${k === settings.level}">${tx(LEVELS[k])}</button>`).join('');
  const rs = $('#rankedSub');
  if (account.state !== 'in') rs.textContent = tx('Masuk dengan Google dulu');
  else if (myStats?.tier) rs.textContent = `${myStats.tier.icon} ${myStats.tier.name} · ${tx('rating')} ${fmt(myStats.rating)}${myStats.placement ? ' · ' + tx('placement {n} lagi', { n: myStats.placement }) : ''} · ${tx('koin = poin × meja')}`;
  else rs.textContent = tx('koin = poin × meja · bot mengisi kursi kosong');
  // meja lawan bot: koin HP
  wallet = normalizeWallet(wallet, Date.now());
  saveWallet();
  $('#lbCoins').textContent = fmt(wallet.coins);
  const note = $('#lbNote');
  note.hidden = !isBroke(wallet.coins);
  note.textContent = tx('Koin meja bot kurang dari {min}. Saldo diisi lagi jadi {start} besok jam 00.01 WIB. Sementara main di meja Latihan dulu.', { min: fmt(minEntry(STAKES[0])), start: fmt(START_COINS) });
  const tile = (t, attr, need, sub) => `<button class="tbl${need ? ' locked' : ''}" ${attr} type="button"${need ? ' aria-disabled="true"' : ''}>
      <span class="chip" style="--c:${t.color}"><i>${t.chip}</i></span><span><b>${tx(t.stake ? 'Meja {s}' : t.name, { s: t.stake })}</b><small>${need || sub}</small></span></button>`;
  $('#tables').innerHTML = TABLES.map((t) => {
    const need = t.stake > 0 && wallet.coins < minEntry(t.stake) ? tx('Butuh {n}', { n: fmt(minEntry(t.stake)) }) : '';
    return tile(t, `data-stake="${t.stake}"`, need, t.stake ? tx('min {n}', { n: fmt(minEntry(t.stake)) }) : tx(t.sub));
  }).join('');
  // Ranked: koin akun. Terkunci kalau belum login atau saldo akun kurang.
  $('#rankedTables').innerHTML = TABLES.filter((t) => t.stake > 0).map((t) => {
    const need = account.state !== 'in' ? tx('Masuk dulu') : account.coins != null && account.coins < minEntry(t.stake) ? tx('Butuh {n}', { n: fmt(minEntry(t.stake)) }) : '';
    return tile(t, `data-ranked="${t.stake}"`, need, tx('min {n}', { n: fmt(minEntry(t.stake)) }));
  }).join('');
  renderAccount();
}

function renderAccount() {
  const box = $('#lbAccount');
  box.hidden = account.state === 'off';
  if (account.state === 'out') {
    box.innerHTML = `<a class="btn google" href="${loginUrl}">${GOOGLE_ICON} ${tx('Masuk dengan Google')}</a><p>${tx('Satu akun dengan Mahjong Kung2 & Capsa Kung2.')}</p>`;
  } else if (account.state === 'in') {
    const img = account.picture ? `<img src="${esc(account.picture)}" alt="" referrerpolicy="no-referrer">` : `<img src="${avatarSrc(myAvatar())}" alt="">`;
    const coins = account.coins != null ? ` · <span><i class="coin"></i> ${fmt(account.coins)}</span>` : '';
    box.innerHTML = `<button class="btn ghost acct" id="btnAccount" type="button">${img}${esc(account.name)}${coins}${myStats?.tier ? ` · <span>${myStats.tier.icon} ${fmt(myStats.rating)}</span>` : ''}</button>
      <p>${tx('Akun & koin yang sama dengan Mahjong Kung2 & Capsa Kung2 (koin akun hanya untuk Ranked). Rating Doudizhu terpisah.')}</p>`;
  }
}

async function refreshAccount() {
  account = await fetchAccount();
  myStats = account.state === 'in' ? await fetchMyStats() : null;
  if (!T) renderLobby();
  return account;
}

function renderEmblem() {
  const row = document.createElement('div');
  row.className = 'erow';
  row.append(...[53, 52, 48, 49, 50, 51].map((c) => cardEl(c, 'mini')));
  $('#emblem').replaceChildren(row);
}

function showRules(then) {
  const R = RULES;
  const b = R.bidding;
  const m = modal(`<h2>${tx('Aturan Doudizhu')}</h2>
    <p>${tx('3 pemain, 54 kartu (dengan 2 joker). Tiap pemain 17 kartu, 3 kartu dasar tertutup. Satu Tuan Tanah lawan dua Petani. Yang pertama menghabiskan kartu menang untuk timnya.')}</p>
    <h3>${tx('Urutan kartu')}</h3><p>3 · 4 · 5 · 6 · 7 · 8 · 9 · 10 · J · Q · K · A · 2 · ${tx('Joker hitam')} · ${tx('Joker merah')}. ${tx('Lambang tidak dipakai.')}</p>
    <h3>${tx('Tawar Tuan Tanah')}</h3>
    <ul>${b.mode === 'points' ? `<li>${tx('Tawar 1, 2, atau 3. Tawaran tertinggi jadi Tuan Tanah, pengali = tawarannya.')}</li>`
      : `<li>${tx('Giliran pertama: Panggil atau Pass. Setelah ada yang Panggil, pemain berikutnya boleh Rebut atau Pass.')}</li>
      <li>${tx('Tiap Panggil dan Rebut = pengali ×2. Pemanggil pertama dapat kesempatan terakhir merebut balik.')}</li>
      <li>${tx('Perebut terakhir (atau satu-satunya pemanggil) jadi Tuan Tanah. Semua pass = kartu dibagi ulang.')}</li>`}
      <li>${R.showKitty ? tx('3 kartu dasar dibuka ke semua pemain setelah Tuan Tanah dipilih.') : tx('3 kartu dasar tidak pernah dibuka: hanya Tuan Tanah yang menerimanya (20 kartu).')}</li></ul>
    <h3>${tx('Kombinasi')}</h3>
    <ul><li>${tx('Satu, pasang, tris; tris + 1, tris + pasang.')}</li>
      <li>${tx('Straight: 5+ kartu berurutan (3 sampai A, tanpa 2 & joker). Pasang berurutan: 3+ pasang.')}</li>
      <li>${tx('Pesawat: 2+ tris berurutan, boleh + 1 kartu per tris atau + 1 pasang per tris (tidak dicampur).')}</li>
      <li>${tx('Empat + 2 kartu, empat + 2 pasang (bukan bom).')}</li>
      <li>${tx('Bom: 4 kartu sama, mengalahkan semua kecuali roket. Roket: dua joker, mengalahkan semuanya.')}</li>
      <li>${tx('Mengikuti: jenis & jumlah kartu sama, nilai lebih tinggi. Dua pass berturut-turut = yang terakhir main memimpin lagi.')}</li></ul>
    <h3>${tx('Skor')}</h3>
    <ul><li>${tx('Skor dasar 1 × pengali. Tiap bom/roket ×2 (3 bom = ×8). Spring ×2 hanya untuk petani yang sama sekali tidak keluar kartu. Anti-spring (Tuan Tanah cuma keluar sekali) ×2.')}</li>
      <li>${tx('Tuan Tanah menang: tiap petani bayar skor itu. Petani menang: Tuan Tanah bayar ke dua petani.')}</li>
      <li>${tx('Ranked: rating Doudizhu naik/turun mengikuti hasil dan besarnya pengali. Keluar di tengah tangan = kalah + penalti.')}</li></ul>
    <div class="rs-btns"><button class="btn primary" data-a="close" type="button">${tx('Mengerti')}</button></div>`);
  save(RULES_KEY, 1);
  if (then) m.addEventListener('click', (e) => { if (e.target.closest('[data-a="close"]')) then(); }, { once: true });
}

async function showBoard(tab = 'board') {
  const m = modal(`<h2>${tx('Peringkat Doudizhu')}</h2><div class="tabs">
    <button class="btn small${tab === 'board' ? ' primary' : ''}" data-tab="board" type="button">${tx('Papan')}</button>
    <button class="btn small${tab === 'me' ? ' primary' : ''}" data-tab="me" type="button">${tx('Riwayat saya')}</button></div>
    <div id="boardBody"><p>${tx('Memuat…')}</p></div>
    <div class="rs-btns"><button class="btn" data-a="close" type="button">${tx('Tutup')}</button></div>`);
  m.addEventListener('click', (e) => { const t = e.target.closest('[data-tab]')?.dataset.tab; if (t) showBoard(t); });
  const body = $('#boardBody', m);
  try {
    if (tab === 'board') {
      const list = await fetchLeaderboard();
      body.innerHTML = list.length ? `<div class="lb-list">${list.map((p, i) => `<div class="lb-item${p.mine ? ' mine' : ''}">
        <span class="no">${i + 1}</span>${p.picture ? `<img src="${esc(p.picture)}" alt="" referrerpolicy="no-referrer" loading="lazy">` : `<span class="ini">${esc(p.name.slice(0, 1))}</span>`}
        <span class="nm2"><b>${esc(p.name)}</b><small>${p.tier.icon} ${p.tier.name} · ${tx('{g} tangan · menang {w}%', { g: fmt(p.games), w: Math.round((100 * p.wins) / Math.max(1, p.games)) })}</small></span>
        <span class="rt">${fmt(p.rating)}</span></div>`).join('')}</div>` : `<p>${tx('Belum ada yang main Ranked. Jadilah yang pertama!')}</p>`;
    } else {
      if (account.state !== 'in') { body.innerHTML = `<p>${tx('Masuk dengan Google untuk melihat riwayat Ranked.')}</p>`; return; }
      const s = await fetchMyStats();
      myStats = s;
      if (!s || s.rating == null) { body.innerHTML = `<p>${tx('Belum ada data.')}</p>`; return; }
      const pct = (a, b) => (b ? Math.round((100 * a) / b) + '%' : '–');
      body.innerHTML = `<p><b>${s.tier.icon} ${s.tier.name} · ${fmt(s.rating)}</b>${s.placement ? ` · ${tx('placement {n} lagi', { n: s.placement })}` : ''}</p>
        <p>${tx('{g} tangan · menang {w} ({p}) · jadi Tuan Tanah {l} (menang {lp}) · kabur {a} · pengali terbesar ×{m}', {
          g: fmt(s.games), w: fmt(s.wins), p: pct(s.wins, s.games), l: fmt(s.landlordGames), lp: pct(s.landlordWins, s.landlordGames), a: fmt(s.abandons), m: fmt(s.bestMult || 0) })}</p>
        <div class="lb-list">${s.history.map((h) => {
          const others = h.players.filter((p) => !p.me).map((p) => esc(p.name) + (p.bot ? ' 🤖' : '')).join(', ');
          return `<div class="lb-item"><span class="no">${h.won ? '✓' : '✗'}</span><span class="ini">${h.role === 'landlord' ? '👑' : '🌾'}</span>
            <span class="nm2"><b>${h.role === 'landlord' ? tx('Tuan Tanah') : tx('Petani')} · ×${fmt(h.mult)}${h.spring ? ' · ' + tx(h.spring === 'spring' ? 'Spring' : 'Anti-spring') : ''}${h.abandoned ? ' · ' + tx('kabur') : ''}</b>
            <small>${new Date(h.endedAt).toLocaleString(getLang() === 'en' ? 'en-GB' : 'id-ID', { dateStyle: 'short', timeStyle: 'short' })} · ${others}</small></span>
            <span class="rt ${cls(h.ratingDelta)}">${signed(h.ratingDelta || 0)}</span></div>`;
        }).join('') || `<p>${tx('Belum ada tangan Ranked.')}</p>`}</div>`;
    }
  } catch {
    body.innerHTML = `<p>${tx('Gagal memuat. Cek koneksi lalu coba lagi.')}</p>`;
  }
}

$('#lvlSeg').addEventListener('click', (e) => {
  const lv = e.target.closest('[data-lv]')?.dataset.lv;
  if (!lv) return;
  sfx('tap');
  settings.level = lv;
  saveSettings();
  renderLobby();
});
$('#btnRules').addEventListener('click', () => { sfx('tap'); showRules(); });
$('#btnBoard').addEventListener('click', () => { sfx('tap'); showBoard(); });
const toggleSound = () => {
  settings.sound = !settings.sound;
  setSound(settings.sound);
  saveSettings();
  sfx('tap');
  renderLobby();
  renderSoundBtn();
};
$('#btnSound').addEventListener('click', toggleSound);
$('#btnSound2').addEventListener('click', toggleSound);
const renderSoundBtn = () => { $('#btnSound2').textContent = settings.sound ? '🔊' : '🔇'; };
$('#btnLang').addEventListener('click', () => {
  settings.lang = getLang() === 'en' ? 'id' : 'en';
  setLang(settings.lang);
  saveSettings();
  renderLobby();
  if (T?.view) render(T.view);
});
$('#btnInstall').addEventListener('click', async () => {
  const msg = await installApp();
  if (msg) modal(`<h2>${tx('Pasang aplikasi')}</h2><p>${esc(tx(msg))}</p><div class="rs-btns"><button class="btn primary" data-a="close" type="button">OK</button></div>`);
});
onInstallChange(() => { if (!T) renderLobby(); });
$('#lbAccount').addEventListener('click', async (e) => {
  if (!e.target.closest('#btnAccount')) return;
  const ok = await ask(account.name, tx('Keluar dari akun? Ini juga keluar dari Mahjong Kung2 & Capsa Kung2 di HP ini.'), tx('Keluar dari akun'));
  if (!ok) return;
  toast((await logout()) ? tx('Sudah keluar dari akun') : tx('Gagal keluar — cek koneksi lalu coba lagi'));
  refreshAccount();
});

// ---------- masuk meja ----------
let T = null; // meja yang sedang dibuka: { session, kind, code, view, seat, offset, logSeen, sel:Set, hint, handKey, timer }

function openTable(kind, code, session) {
  T = { kind, code, session, view: null, seat: 0, offset: 0, logSeen: -1, sel: new Set(), hint: null, handKey: '', timer: 0, lastTurn: -2, round: 0, newCards: null };
  T.timer = setInterval(tick, 250);
  closeModal();
  show('table');
  $('#result').hidden = true;
  $('#center').replaceChildren();
  $('#fx').replaceChildren();
  $('#hand').replaceChildren();
  renderSoundBtn();
}

function startPractice(stake = 0) {
  if (T) return;
  wallet = normalizeWallet(wallet, Date.now());
  if (stake && wallet.coins < minEntry(stake)) return toast(tx('Meja {s} butuh minimal {n} koin', { s: stake, n: fmt(minEntry(stake)) }), 3000);
  if (!load(RULES_KEY)) return showRules(() => startPractice(stake));
  sfx('tap');
  const user = { id: 'me' + clientId().slice(0, 14), name: tx('Kamu'), avatar: myAvatar() };
  openTable('practice', '', null);
  T.stake = stake;
  T.session = new LocalTable(user, settings.level, { onState, onError: onActError }, stake);
}

const handlers = () => ({
  onState,
  onError: onActError,
  onStatus: (st) => toast(st === 'reconnecting' ? tx('Koneksi putus — menyambung lagi…') : tx('Tersambung lagi'), st === 'reconnecting' ? 8000 : 1500),
  onEnd: (msg) => { toast(tx(msg), 3500); closeTable(); },
});
function onActError(msg) {
  sfx('bad');
  toast(tx(msg), 2600);
}

/** id = kunci kursi: id acak HP ini (meja teman) atau kunci dari server (Ranked). */
function connectOnline(code, name, id = clientId(), ranked = false) {
  if (T) return;
  save(ROOM_KEY, { code, id, ranked });
  openTable(ranked ? 'ranked' : 'friends', code, null);
  T.session = new RoomSession(code, { id, name, avatar: myAvatar() }, handlers());
}

async function ensureName() {
  await accountReady; // nama akun Google dipakai kalau sudah login
  const known = account.state === 'in' ? account.name : load(NAME_KEY);
  if (known) return known;
  const typed = await askText(tx('Nama kamu'), tx('Nama ini yang dilihat teman di meja.'), { value: `${tx('Tamu')} ${100 + Math.floor(Math.random() * 900)}` });
  const name = (typed || '').replace(/\s+/g, ' ').trim().slice(0, 16);
  if (!name) return null;
  save(NAME_KEY, name);
  return name;
}
async function createOnline() {
  if (!load(RULES_KEY)) return showRules(createOnline);
  const name = await ensureName();
  if (!name) return;
  try {
    const { code } = await api('/rooms', { method: 'POST', body: { id: clientId(), name, avatar: myAvatar(), level: settings.level } });
    connectOnline(code, name);
  } catch (e) {
    toast(tx(e.message || 'Gagal membuat meja'));
  }
}
async function joinOnline(raw) {
  const code = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!ROOM_CODE.test(code)) return toast(tx('Kode meja terdiri dari 5 huruf/angka'));
  let info;
  try { info = await api(`/rooms/${code}?id=${clientId()}`); } catch (e) { return toast(tx(e.message || 'Server tidak menjawab')); }
  if (info.status === 'none') return toast(tx('Meja tidak ditemukan'));
  if (info.ranked) return toast(tx('Itu meja Ranked'));
  if (!info.mine && info.status !== 'lobby') return toast(tx('Permainan di meja itu sudah mulai'));
  if (!info.mine && !info.free) return toast(tx('Meja penuh'));
  if (!load(RULES_KEY)) return showRules(() => joinOnline(code));
  const name = await ensureName();
  if (name) connectOnline(code, name);
}
async function joinRanked(stake) {
  if (account.state !== 'in') return toast(tx('Masuk dengan Google dulu untuk main Ranked'), 3000);
  if (account.coins != null && account.coins < minEntry(stake)) return toast(tx('Meja {s} butuh minimal {n} koin', { s: stake, n: fmt(minEntry(stake)) }), 3000);
  if (!load(RULES_KEY)) return showRules(() => joinRanked(stake));
  try {
    toast(tx('Mencari meja…'), 4000);
    const ticket = await fetchTicket();
    const { code, key } = await api('/ranked/join', { method: 'POST', body: { ticket, stake, avatar: myAvatar() } });
    connectOnline(code, account.name, key, true);
  } catch (e) {
    toast(tx(e.message || 'Gagal masuk meja Ranked'), 3500);
    refreshAccount();
  }
}
$('#tables').addEventListener('click', (e) => {
  const b = e.target.closest('[data-stake]');
  if (b) startPractice(Number(b.dataset.stake));
});
$('#rankedTables').addEventListener('click', (e) => {
  const b = e.target.closest('[data-ranked]');
  if (!b) return;
  sfx('tap');
  joinRanked(Number(b.dataset.ranked));
});
$('#btnCreate').addEventListener('click', () => { sfx('tap'); createOnline(); });
$('#btnJoin').addEventListener('click', async () => {
  sfx('tap');
  const code = await askText(tx('Gabung meja'), tx('Masukkan kode meja dari temanmu.'), { code: true, max: 5, okLabel: tx('Gabung') });
  if (code) joinOnline(code);
});

function closeTable() {
  if (!T) return;
  if (T.kind === 'practice') {
    const lost = settleAbandoned();
    if (lost) toast(tx('Tangan ditinggal dihitung kalah: {n} koin', { n: signed(lost) }), 3500);
  }
  clearInterval(T.timer);
  T.session?.close?.();
  T = null;
  save(ROOM_KEY, null);
  show('lobby');
  closeModal();
  renderLobby();
  refreshAccount();
}
$('#btnLeave').addEventListener('click', async () => {
  sfx('tap');
  if (!T) return;
  const v = T.view;
  const playing = v?.status === 'playing' && v.seat >= 0;
  if (playing) {
    const msg = T.kind === 'ranked' ? tx('Tangan ini masih jalan. Keluar sekarang dihitung kabur: kalah + penalti rating, kursimu dimainkan bot.')
      : T.kind === 'practice' ? (load(PENDING_KEY) ? tx('Tangan ini masih jalan. Keluar sekarang dihitung kalah: −{n} koin.', { n: fmt(load(PENDING_KEY).loss) }) : tx('Tangan latihan ini akan dibuang.'))
        : tx('Kursimu akan dimainkan bot sampai tangan selesai.');
    if (!(await ask(tx('Keluar dari meja?'), msg, tx('Keluar')))) return;
  }
  if (T.kind !== 'practice') T.session?.close(true);
  closeTable();
});

// ---------- tampilan meja ----------
const toSeat = (d) => (d + T.seat) % 3; // kursi tampilan (0 = saya, 1 = kanan = giliran berikutnya, 2 = kiri) → kursi server
const toDisp = (k) => (k - T.seat + 3) % 3;
const seatEl = (d) => $(`.seat[data-seat="${d}"]`);
const playedEl = (d) => $(`.played[data-played="${d}"]`);
const now = () => Date.now() + (T?.offset || 0);
const BID_WORDS = { call: 'Panggil', grab: 'Rebut', pass: 'Pass', bid1: '1 poin', bid2: '2 poin', bid3: '3 poin' };
const MULT_WORDS = { call: 'Panggil', grab: 'Rebut', bid: 'Tawaran', bomb: 'Bom', rocket: 'Roket', spring: 'Spring', anti: 'Anti-spring' };

function onState(v, serverNow) {
  if (!T) return;
  if (serverNow) T.offset = serverNow - Date.now();
  T.view = v;
  T.seat = Math.max(0, v.seat);
  if (T.kind === 'practice') practiceCoins(v);
  render(v);
}

/**
 * Meja bot bermeja koin: selama tangan jalan (Tuan Tanah sudah dipilih) simpan "kalah kalau ditinggal" di HP;
 * saat selesai bayar poin × taruhan sekali per tangan (sebelum layar hasil, supaya menutup app tidak membatalkan).
 */
function practiceCoins(v) {
  const g = v.game;
  if (!v.stake || !g) return;
  if (v.status === 'result' && v.last) {
    if (T.paid?.round === v.round) return;
    save(PENDING_KEY, null);
    T.paid = { round: v.round, delta: payWallet(coinDelta(v.last.points[v.seat], v.stake)) };
    return;
  }
  if (g.phase === 'play') {
    const mult = Math.max(1, g.mult || 1);
    save(PENDING_KEY, { loss: coinDelta((g.landlord === v.seat ? 2 : 1) * mult * (g.rules?.base || 1), v.stake), round: v.round });
  }
}

/** Pseudo-state game untuk bot.hints() dari tampilan sendiri (tangan lawan hanya jumlahnya — bot tidak membaca isinya). */
function pseudoGame(v) {
  const g = v.game;
  return {
    phase: g.phase, turn: g.turn, landlord: g.landlord, rules: RULES, plays: g.plays,
    hands: g.counts.map((n, k) => (k === v.seat ? g.hand : new Array(n).fill(0))),
    trick: { last: g.last }, bid: g.bid,
  };
}

function render(v) {
  const g = v.game;
  const info = T.kind === 'practice' ? `<b>${v.stake ? tx('Meja {s}', { s: v.stake }) : tx('Latihan')}</b> · ${tx('bot')} ${tx(LEVELS[v.level])}`
    : T.kind === 'ranked' ? `<b>Ranked${v.stake ? ` ${v.stake}` : ''}</b>${v.ranked?.rating != null ? ` · ${tx('rating')} ${fmt(v.ranked.rating)}` : ''}`
      : `${tx('Meja')} <b>${esc(v.code)}</b> · ${tx('bareng teman')}`;
  $('#tbInfo').innerHTML = `${info}${v.round ? `<br>${tx('Tangan {n}', { n: v.round })}` : ''}`;
  applyStatic($('#table'));
  renderSeats(v);
  renderKitty(v);
  renderMult(v);
  renderPlayed(v);
  renderLeftover(v);
  renderHand(v);
  renderActions(v);
  renderCenter(v);
  renderResult(v);
  playEffects(v);
  if (g && g.turn === v.seat && v.seat >= 0 && T.lastTurn !== `${v.round}:${g.plays.length}:${g.bid?.acts.length}` && v.status === 'playing') {
    T.lastTurn = `${v.round}:${g.plays.length}:${g.bid?.acts.length}`;
    sfx('turn');
    if (navigator.vibrate && document.hidden === false && g.phase === 'play') try { navigator.vibrate(30); } catch { /* tidak didukung */ }
  }
}

function renderSeats(v) {
  const g = v.game;
  for (let d = 0; d < 3; d++) {
    const k = toSeat(d), s = v.seats[k], el = seatEl(d);
    if (!el.dataset.built) {
      el.innerHTML = `<div class="ava"><span class="ring"></span><svg class="crown"><use href="#crown"/></svg><img alt="" draggable="false"></div>
        <div class="nm"><b></b><span class="role"></span><span class="tot"></span><span class="cn"></span><span class="flag"></span></div>${d ? '<div class="stack"></div>' : ''}<div class="say"></div>`;
      el.dataset.built = '1';
    }
    if (!s) {
      el.classList.add('off');
      $('.nm b', el).textContent = tx('Kosong');
      $('img', el).removeAttribute('src');
      continue;
    }
    const img = $('img', el);
    if (img.getAttribute('src') !== avatarSrc(s.avatar)) img.src = avatarSrc(s.avatar);
    const me = d === 0 && v.seat >= 0;
    $('.nm b', el).textContent = (k === v.host && v.status === 'lobby' && v.kind === 'friends' ? '★ ' : '') + (me ? tx('Kamu') : s.name) + (s.bot ? ' 🤖' : '');
    const lord = g && g.landlord >= 0;
    el.classList.toggle('lord', lord && g.landlord === k);
    $('.role', el).textContent = lord ? (g.landlord === k ? tx('Tuan Tanah') : tx('Petani')) : s.bot ? tx('Bot') : '';
    $('.role', el).hidden = !$('.role', el).textContent;
    const tot = v.totals[k] - (v.status === 'result' && v.last && !T.resultShown ? v.last.points[k] : 0);
    const totEl = $('.tot', el);
    totEl.textContent = v.status === 'lobby' ? '' : `${tx('Total')} ${signed(tot)}`;
    totEl.className = 'tot ' + cls(tot);
    // saldo koin sendiri: koin akun (Ranked) atau koin meja bot (HP)
    const myCoins = d === 0 && v.stake ? (v.kind === 'ranked' ? v.ranked?.coins : v.kind === 'practice' ? wallet.coins : null) : null;
    $('.cn', el).innerHTML = myCoins != null ? `<i class="coin"></i> ${fmt(myCoins)}` : '';
    $('.flag', el).textContent = s.left ? tx('Keluar · dimainkan bot') : !s.online ? tx('Putus · dimainkan bot') : s.auto ? tx('Main otomatis') : '';
    el.classList.toggle('off', !s.bot && (!s.online || s.left));
    el.classList.toggle('turn', !!g && v.status === 'playing' && g.turn === k);
    if (d) {
      const st = $('.stack', el);
      const n = g ? g.counts[k] : 0;
      {
        st.className = `stack${n && n <= 2 ? ' few' : ''}`;
        st.hidden = !g;
        if (!st.firstChild || st.classList.contains('reveal') || st.children.length !== 2) st.replaceChildren(backEl('mini'), document.createElement('b'));
        $('b', st).textContent = n;
      }
    }
    // gelembung: aksi tawar terakhir kursi ini (selama menawar)
    const say = $('.say', el);
    let text = '';
    if (g?.phase === 'bid' && v.status === 'playing') {
      const a = g.bid.acts.filter((x) => x.seat === k).at(-1);
      if (a) text = tx(BID_WORDS[a.t] || a.t);
    }
    say.textContent = text;
    say.classList.toggle('hot', !!text && text !== tx('Pass'));
  }
}

function renderKitty(v) {
  const g = v.game;
  const box = $('#kitty');
  if (!g) return box.replaceChildren();
  const key = `${v.round}:${g.redeals}:${g.kitty ? g.kitty.join() : 'x'}`;
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  const cards = g.kitty ? g.kitty.map((c) => cardEl(c, 'mini')) : [backEl('mini'), backEl('mini'), backEl('mini')];
  const note = document.createElement('small');
  note.textContent = g.landlord < 0 ? tx('3 kartu dasar') : g.kitty ? (g.landlord === v.seat && g.phase !== 'done' ? tx('kartu dasarmu') : '') : tx('untuk Tuan Tanah');
  box.replaceChildren(...cards, note);
}

function renderMult(v) {
  const g = v.game;
  const chip = $('#multChip');
  chip.hidden = !g;
  if (!g) return;
  const m = v.status === 'result' && v.last ? v.last.mult : g.mult;
  const text = `×${fmt(m)}`;
  if (chip.textContent !== text) {
    chip.textContent = text;
    chip.classList.remove('pop');
    void chip.offsetWidth;
    chip.classList.add('pop');
  }
  chip.title = (g.breakdown || []).map((b) => `${tx(MULT_WORDS[b.k])} ×${b.x}`).join(' · ');
}

/** Kartu yang keluar di ronde ini (sejak tanda ronde baru terakhir), per kursi: langkah terakhirnya. */
function renderPlayed(v) {
  const g = v.game;
  for (let d = 0; d < 3; d++) {
    const box = playedEl(d);
    if (!g || g.phase === 'bid') { box.replaceChildren(); box.dataset.key = ''; continue; }
    const k = toSeat(d);
    const start = g.plays.map((p) => !!p.trick).lastIndexOf(true) + 1;
    const mine = g.plays.slice(start).filter((p) => p.seat === k).at(-1);
    const key = mine ? `${v.round}:${g.plays.lastIndexOf(mine)}` : '';
    if (box.dataset.key === key) continue;
    box.dataset.key = key;
    if (!mine) { box.replaceChildren(); continue; }
    if (mine.pass) {
      const p = document.createElement('span');
      p.className = 'pass';
      p.textContent = tx('Pass');
      box.replaceChildren(p);
      continue;
    }
    const els = groupSort(mine.cards).map((c, i) => {
      const e = cardEl(c, 'mini');
      e.classList.add('in');
      e.style.setProperty('--i', i);
      return e;
    });
    const name = mine.combo && !['single', 'pair'].includes(mine.combo.type) ? tx(TYPE_NAMES[mine.combo.type]) : '';
    if (name) {
      const t = document.createElement('span');
      t.className = 'tag';
      t.textContent = name;
      if (d === 1) els.unshift(t); // kursi kanan: label di sisi dalam meja
      else els.push(t);
    }
    box.replaceChildren(...els);
  }
}

/** Tangan selesai: sisa kartu tiap lawan dibuka di bawah kursinya (kartu terakhir yang keluar tetap di meja). */
function renderLeftover(v) {
  const g = v.game;
  for (const d of [1, 2]) {
    const box = $(`.leftover[data-left="${d}"]`);
    const k = toSeat(d);
    const left = g?.reveal ? g.reveal[k] : [];
    const key = left.length ? `${v.round}:${left.join()}` : '';
    if (box.dataset.key === key) continue;
    box.dataset.key = key;
    if (!left.length) { box.replaceChildren(); continue; }
    const t = document.createElement('small');
    t.textContent = tx('Sisa {n} kartu', { n: left.length });
    box.replaceChildren(t, ...groupSort(left).map((c) => cardEl(c, 'mini')));
  }
}

/** Kartu mini untuk panel hasil. */
const miniRow = (cards) => `<span class="rs-cards">${groupSort(cards).map((c) => cardEl(c, 'mini').outerHTML).join('')}</span>`;

// ---------- tangan sendiri: ketuk / geser untuk memilih ----------
/** Urut per kelompok: rank yang paling banyak dulu (333 4, 4444 5 6), lalu dari besar ke kecil. */
function groupSort(cards) {
  const cnt = counts(cards);
  return [...cards].sort((a, b) => cnt[rankOf(b)] - cnt[rankOf(a)] || rankOf(b) - rankOf(a) || b - a);
}
function sortedHand(hand) {
  return settings.sort === 'group' ? groupSort(hand) : sortHand(hand);
}

function renderHand(v) {
  const g = v.game;
  const box = $('#hand');
  const hand = g && v.seat >= 0 ? g.hand || [] : [];
  const rows = app.classList.contains('portrait') && hand.length > 10;
  const key = `${v.round}:${g?.redeals}:${settings.sort}:${rows}:${hand.join()}`;
  // kartu dasar yang baru diterima Tuan Tanah diberi tanda sebentar
  if (g && g.landlord === v.seat && g.kitty && T.newCards === null && g.phase === 'play' && g.plays.length === 0) T.newCards = new Set(g.kitty);
  if (g?.landlord < 0) T.newCards = null;
  if (box.dataset.key !== key) {
    const fresh = !box.dataset.key || box.dataset.key.split(':')[0] !== String(v.round) || box.dataset.key.split(':')[1] !== String(g?.redeals);
    box.dataset.key = key;
    T.sel = new Set([...T.sel].filter((c) => hand.includes(c)));
    T.hint = null;
    const els = sortedHand(hand).map((c, i) => {
      const e = cardEl(c, 'big');
      if (fresh) { e.classList.add('dealt'); e.style.setProperty('--i', i); }
      if (T.newCards?.has(c) && g.plays.length === 0) e.classList.add('new');
      return e;
    });
    box.classList.toggle('rows', rows);
    if (rows) {
      // HP tegak: dua baris supaya kartu cukup besar untuk diketuk
      const half = Math.ceil(els.length / 2);
      box.replaceChildren(...[els.slice(0, half), els.slice(half)].map((list) => {
        const r = document.createElement('div');
        r.className = 'hrow2';
        r.append(...list);
        return r;
      }));
    } else box.replaceChildren(...els);
    if (fresh) sfx('deal');
  }
  for (const e of box.querySelectorAll('.card')) e.classList.toggle('sel', T.sel.has(Number(e.dataset.c)));
  box.classList.toggle('dim', !(g && g.phase === 'play' && g.turn === v.seat && v.status === 'playing'));
  layoutHand();
}

/** Tumpang-tindih kartu dihitung dari lebar layar supaya 20 kartu tetap muat. */
function layoutHand() {
  const box = $('#hand');
  const first = box.querySelector('.card');
  if (!first) return;
  const n = Math.max(...[...(box.classList.contains('rows') ? box.children : [box])].map((r) => r.querySelectorAll('.card').length));
  const cw = first.getBoundingClientRect().width || 60;
  const cs = getComputedStyle(box);
  const avail = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 6;
  const step = Math.min(cw * 0.62, n > 1 ? (avail - cw) / (n - 1) : cw);
  box.style.setProperty('--ov', `${Math.round(step - cw)}px`);
}

const handBox = $('#hand');
let drag = null;
function cardAt(x, y) {
  const el = document.elementFromPoint(x, y)?.closest('.hand .card');
  return el ? Number(el.dataset.c) : null;
}
handBox.addEventListener('pointerdown', (e) => {
  const c = cardAt(e.clientX, e.clientY);
  if (c === null || !T) return;
  drag = { on: !T.sel.has(c), seen: new Set([c]) };
  setSel(c, drag.on);
  handBox.setPointerCapture?.(e.pointerId);
});
handBox.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const c = cardAt(e.clientX, e.clientY);
  if (c === null || drag.seen.has(c)) return;
  drag.seen.add(c);
  setSel(c, drag.on);
});
const endDrag = () => { if (drag) { drag = null; renderActions(T.view); } };
handBox.addEventListener('pointerup', endDrag);
handBox.addEventListener('pointercancel', endDrag);
function setSel(c, on) {
  if (on) T.sel.add(c);
  else T.sel.delete(c);
  T.hint = null;
  sfx('tap');
  for (const el of handBox.querySelectorAll('.card')) el.classList.toggle('sel', T.sel.has(Number(el.dataset.c)));
}

// ---------- tombol aksi ----------
function renderActions(v) {
  if (!v) return;
  const bar = $('#actbar');
  const g = v.game;
  const me = v.seats[v.seat];
  if (!g || v.status !== 'playing' || v.seat < 0) return bar.replaceChildren();
  const myTurn = g.turn === v.seat;
  const html = [];
  if (me?.auto) html.push(`<span class="note">${tx('Main otomatis aktif')}</span><button class="btn primary" data-act="takeover" type="button">${tx('Main lagi sendiri')}</button>`);
  else if (myTurn && g.phase === 'bid') {
    for (const o of g.bid.options) html.push(`<button class="btn${o === 'pass' ? '' : ' primary'}" data-bid="${o}" type="button">${tx(BID_WORDS[o])}</button>`);
    html.push('<div class="timer" id="myTimer"><b></b></div>');
  } else if (myTurn && g.phase === 'play') {
    const sel = [...T.sel];
    const prev = g.mustLead ? null : g.last?.combo;
    const combo = sel.length ? readPlay(sel, prev, RULES) : null;
    const note = sel.length ? (combo ? tx(TYPE_NAMES[combo.type]) : prev ? tx('Tidak bisa mengalahkan') : tx('Kombinasi tidak sah')) : '';
    html.push(`<button class="btn" data-act="pass" type="button"${g.mustLead ? ' disabled' : ''}>${tx('Pass')}</button>`);
    html.push(`<button class="btn" data-act="hint" type="button">${tx('Saran')}</button>`);
    html.push(`<button class="btn primary" data-act="play" type="button"${combo ? '' : ' disabled'}>${tx('Keluarkan')}</button>`);
    html.push('<div class="timer" id="myTimer"><b></b></div>');
    if (note) html.push(`<span class="note${combo ? '' : ' bad'}">${esc(note)}</span>`);
  } else if (g.phase === 'play') {
    html.push(`<button class="btn small ghost" data-act="sort" type="button">${settings.sort === 'group' ? tx('Urut nilai') : tx('Urut kelompok')}</button>`);
    if (T.sel.size) html.push(`<button class="btn small ghost" data-act="clear" type="button">${tx('Batal pilih')}</button>`);
  }
  bar.innerHTML = html.join('');
  tick();
}
$('#actbar').addEventListener('click', (e) => {
  if (!T?.view) return;
  const v = T.view, g = v.game;
  const bid = e.target.closest('[data-bid]')?.dataset.bid;
  const a = e.target.closest('[data-act]')?.dataset.act;
  if (bid) {
    sfx(bid === 'pass' ? 'pass' : 'call');
    return send({ t: 'act', a: { t: bid } });
  }
  if (!a) return;
  if (a === 'takeover') return send({ t: 'takeover' });
  if (a === 'sort') {
    settings.sort = settings.sort === 'group' ? 'rank' : 'group';
    saveSettings();
    return render(v);
  }
  if (a === 'clear') { T.sel.clear(); return render(v); }
  if (a === 'pass') {
    T.sel.clear();
    sfx('pass');
    return send({ t: 'act', a: { t: 'pass' } });
  }
  if (a === 'hint') {
    if (!T.hint) T.hint = { list: hints(pseudoGame(v), v.seat), i: -1 };
    const L = T.hint.list;
    if (!L.length) {
      toast(tx('Tidak ada kartu yang bisa mengalahkan — Pass'));
      return;
    }
    T.hint.i = (T.hint.i + 1) % L.length;
    const keep = T.hint;
    T.sel = new Set(L[T.hint.i]);
    sfx('tap');
    renderHand(v);
    renderActions(v);
    T.hint = keep;
    return;
  }
  if (a === 'play') {
    const cards = [...T.sel];
    if (!cards.length) return;
    sfx('play');
    send({ t: 'act', a: { t: 'play', cards } });
    T.sel.clear();
  }
});
function send(m) {
  T?.session?.send(m);
}

// ---------- tengah meja: ruang tunggu, menonton, status ----------
function renderCenter(v) {
  const c = $('#center');
  const g = v.game;
  if (v.status === 'lobby' && v.kind === 'friends') {
    const n = v.seats.filter(Boolean).length;
    const host = v.host === v.seat;
    c.innerHTML = `<div class="waitroom"><small>${tx('Kode meja')}</small><div class="code">${esc(v.code)}</div>
      <p>${tx('{n} dari 3 pemain · kursi kosong diisi bot ({lv})', { n, lv: tx(LEVELS[v.level]) })}</p>
      <div class="rs-btns"><button class="btn" data-w="share" type="button">${tx('Bagikan link')}</button>
      ${host ? `<button class="btn primary" data-w="start" type="button">${tx('Mulai')}</button>` : `<span class="note">${tx('Menunggu pembuat meja memulai…')}</span>`}</div></div>`;
    return;
  }
  if (v.status === 'lobby' && v.kind === 'ranked') {
    const n = v.seats.filter(Boolean).length;
    c.innerHTML = `<div class="waitroom"><small>Ranked</small><div class="count" id="rkCount"></div>
      <p>${tx('Mencari lawan… {n} dari 3 pemain. Kursi kosong diisi bot (tanda 🤖).', { n })}</p></div>`;
    tick();
    return;
  }
  if (v.seat < 0 && v.ranked?.waiting) {
    c.innerHTML = `<div class="banner">${tx('Kamu masuk di tangan berikutnya')}<small>${tx('Tangan {n} sedang jalan', { n: v.round })}</small></div>`;
    return;
  }
  if (g?.phase === 'bid' && v.status === 'playing') {
    const k = g.turn;
    const who = k === v.seat ? tx('Giliranmu') : tx('{name} berpikir…', { name: v.seats[k]?.name || '' });
    c.innerHTML = `<div class="banner">${g.bid.caller < 0 ? tx('Panggil Tuan Tanah?') : tx('Rebut Tuan Tanah?')}<small>${esc(who)}</small></div>`;
    return;
  }
  c.replaceChildren();
}
$('#center').addEventListener('click', async (e) => {
  const w = e.target.closest('[data-w]')?.dataset.w;
  if (!w || !T) return;
  sfx('tap');
  if (w === 'start') send({ t: 'start' });
  if (w === 'share') {
    const url = `${location.origin}${location.pathname}#room=${T.code}`;
    const text = tx('Main Doudizhu bareng yuk! Kode meja {code}', { code: T.code });
    try {
      if (navigator.share) await navigator.share({ title: 'Doudizhu Kung2', text, url });
      else { await navigator.clipboard.writeText(`${text} ${url}`); toast(tx('Link disalin')); }
    } catch { /* dibatalkan */ }
  }
});

// ---------- hasil ----------
function renderResult(view) {
  let v = view;
  const box = $('#result');
  if (v.status !== 'result' || !v.last) {
    box.hidden = true;
    T.resultShown = false;
    T.resultKey = '';
    return;
  }
  const L = v.last;
  const key = `${v.round}:${L.settled}:${v.host}:${v.ranked?.nextAt}`;
  if (T.resultKey === key && !box.hidden) return updateResultCountdown();
  const first = !T.resultKey.startsWith(`${v.round}:`);
  T.resultKey = key;
  const show = () => {
    if (!T || T.view?.status !== 'result' || !T.view.last) return;
    v = T.view;
    const L = v.last;
    T.resultShown = true;
    renderSeats(T.view);
    const me = v.seat;
    const myWin = me >= 0 && L.points[me] > 0;
    const title = me < 0 ? (L.landlordWon ? tx('Tuan Tanah menang') : tx('Petani menang')) : myWin ? tx('Kamu menang!') : tx('Kamu kalah');
    const rows = [0, 1, 2].map((d) => {
      const k = toSeat(d), s = v.seats[k];
      const left = v.game?.reveal?.[k] || [];
      return `<tr><td>${d === 0 && me >= 0 ? tx('Kamu') : esc(s?.name || '')}${s?.bot ? ' 🤖' : ''}${L.abandoned?.[k] ? ` <small>(${tx('kabur')})</small>` : ''}${left.length ? miniRow(left) : ''}</td>
        <td>${k === L.landlord ? '👑 ' + tx('Tuan Tanah') : `${tx('Petani')}${L.mults?.[k] ? ` ×${fmt(L.mults[k])}` : ''}`}</td><td class="${cls(L.points[k])}">${signed(L.points[k])}</td><td class="tot">${signed(v.totals[k])}</td></tr>`;
    }).join('');
    const who = (k) => (k === v.seat ? tx('Kamu') : v.seats[k]?.name || '');
    const chips = (L.breakdown || []).map((b) => `<span>${tx(MULT_WORDS[b.k])} ×${b.x}${b.seats ? ` (${b.seats.map((k) => esc(who(k))).join(', ')})` : ''}</span>`).join('')
      + `<span class="tot">= ×${fmt(L.mult)}</span>`;
    // langkah penutup (yang menghabiskan kartu) supaya kelihatan walau meja tertutup panel
    const fin = (v.game?.plays || []).filter((p) => p.cards).at(-1);
    const lastPlay = fin ? `<div class="rs-last"><span>${tx('Keluar terakhir')}: <b>${esc(who(fin.seat))}</b>${fin.combo ? ` · ${tx(TYPE_NAMES[fin.combo.type])}` : ''}</span>${miniRow(fin.cards)}</div>` : '';
    let rating = '';
    if (v.kind === 'ranked' && me >= 0) {
      const parts = [];
      if (L.myRating != null) parts.push(`<span class="${cls(L.myRating)}">${tx('Rating')} ${signed(L.myRating)}${v.ranked?.rating != null ? ` → ${fmt(v.ranked.rating)}` : ''}</span>`);
      if (L.myCoins != null && L.settled) parts.push(`<span class="${cls(L.myCoins)}"><i class="coin"></i> ${signed(L.myCoins)}${v.ranked?.coins != null ? ` → ${fmt(v.ranked.coins)}` : ''}</span>`);
      rating = parts.length ? `<p class="rs-rating">${parts.join(' · ')}</p>` : L.settled ? '' : `<p class="rs-rating">${tx('Menyimpan rating…')}</p>`;
    } else if (v.kind === 'practice' && v.stake && T.paid?.round === v.round) {
      rating = `<p class="rs-rating ${cls(T.paid.delta)}"><i class="coin"></i> ${signed(T.paid.delta)} → ${fmt(wallet.coins)} <small>(${tx('koin meja bot')})</small></p>`;
    }
    let btns = `<button class="btn" data-r="peek" type="button">${tx('Lihat meja')}</button><button class="btn" data-r="leave" type="button">${tx('Keluar')}</button>`;
    if (v.kind === 'ranked') btns += `<span class="note" id="rsNext"></span>`;
    else if (v.host === v.seat) btns += `<button class="btn primary" data-r="next" type="button">${tx('Lanjut')}</button>`;
    else btns += `<span class="note">${tx('Menunggu pembuat meja…')}</span>`;
    box.innerHTML = `<div class="rs-panel"><div class="rs-head"><h2 class="${me < 0 ? '' : myWin ? 'win' : 'lose'}">${title}</h2>
      <span class="rs-sum">${me >= 0 ? signed(L.points[me]) : ''}</span></div>
      <div class="chips">${chips}</div>${lastPlay}${rating}
      <table class="rs-table"><tr><th>${tx('Pemain')}</th><th>${tx('Peran')}</th><th>${tx('Tangan ini')}</th><th>${tx('Total')}</th></tr>${rows}</table>
      <div class="rs-btns">${btns}</div></div>`;
    box.hidden = false;
    box.classList.remove('peek');
    updateResultCountdown();
    if (first && me >= 0) sfx(myWin ? 'win' : 'lose');
  };
  // jeda sebentar supaya kartu terakhir & efek spring terlihat dulu
  if (first) {
    box.hidden = true;
    clearTimeout(T.resultTimer);
    T.resultTimer = setTimeout(show, L.spring ? 2600 : 1400);
  } else show();
}
function updateResultCountdown() {
  const el = $('#rsNext');
  const r = T?.view?.ranked;
  if (!el || !r) return;
  const s = Math.max(0, Math.ceil((r.nextAt - now()) / 1000));
  el.textContent = T.view.last?.settled ? tx('Tangan berikutnya dalam {s} dtk', { s }) : tx('Menyimpan rating…');
}
$('#result').addEventListener('click', (e) => {
  const r = e.target.closest('[data-r]')?.dataset.r;
  if (!r) {
    if ($('#result').classList.contains('peek')) $('#result').classList.remove('peek');
    return;
  }
  sfx('tap');
  if (r === 'next') {
    if (T.kind === 'practice' && T.stake && wallet.coins < minEntry(T.stake)) {
      toast(tx('Koin meja bot kurang untuk meja {s}', { s: T.stake }), 3000);
      return closeTable();
    }
    send({ t: 'next' });
  }
  if (r === 'leave') { if (T.kind !== 'practice') T.session?.close(true); closeTable(); }
  if (r === 'peek') {
    $('#result').classList.add('peek');
    toast(tx('Ketuk meja untuk kembali ke hasil'), 2500);
  }
});
$('#table').addEventListener('click', (e) => {
  const res = $('#result');
  if (!res.hidden && res.classList.contains('peek') && !e.target.closest('.tb-top, .tb-right, #result')) res.classList.remove('peek');
});

// ---------- efek (bom, roket, pesawat, spring, tuan tanah) ----------
function fx(html, ms = 1400) {
  const box = $('#fx');
  const el = document.createElement('div');
  el.innerHTML = html;
  box.append(...el.childNodes);
  const nodes = [...box.childNodes].slice(-el.childNodes.length || -3);
  setTimeout(() => nodes.forEach((n) => n.remove()), ms);
  setTimeout(() => { if (box.childNodes.length > 8) box.replaceChildren(); }, ms + 50);
}
function shake() {
  const t = $('#table');
  t.classList.remove('shake');
  void t.offsetWidth;
  t.classList.add('shake');
}
function playEffects(v) {
  const g = v.game;
  if (!g) return;
  if (T.round !== v.round) {
    T.round = v.round;
    T.newCards = null;
    if (T.logSeen >= 0) T.logSeen = 0; // tangan baru: id kejadian mulai lagi dari 1
  }
  const maxId = g.log.at(-1)?.id || 0;
  const fresh = T.logSeen < 0; // baru masuk / buka lagi: jangan putar ulang efek lama
  const items = fresh ? [] : g.log.filter((e) => e.id > T.logSeen);
  T.logSeen = Math.max(maxId, 0);
  for (const e of items) {
    const name = e.seat >= 0 ? (e.seat === v.seat ? tx('Kamu') : v.seats[e.seat]?.name || '') : '';
    if (e.k === 'bomb') { sfx('bomb'); shake(); fx(`<div class="flash"></div><div class="boom">${tx('BOM!')}<small>×${RULES.bombMult}</small></div>`); }
    else if (e.k === 'rocket') { sfx('rocket'); shake(); fx(`<div class="flash"></div><div class="rocket">🚀</div><div class="boom">${tx('ROKET!')}<small>×${RULES.rocketMult}</small></div>`, 1700); }
    else if (e.k === 'spring' || e.k === 'anti') { sfx('sweep'); fx(`<div class="flash"></div><div class="boom">${e.k === 'spring' ? tx('SPRING!') : tx('ANTI-SPRING!')}<small>×${e.k === 'spring' ? RULES.springMult : RULES.antiSpringMult}</small></div>`, 2400); }
    else if (e.k === 'landlord') { sfx('landlord'); fx(`<div class="boom small">👑 ${esc(tx('{name} jadi Tuan Tanah', { name }))}</div>`, 1600); }
    else if (e.k === 'redeal') { toast(tx('Semua pass — kartu dibagi ulang'), 2200); }
    else if (e.k === 'play') {
      if (e.type === 'plane' || e.type === 'plane1' || e.type === 'plane2') fx(`<div class="plane">✈️</div><div class="boom small">${tx('Pesawat!')}</div>`, 1500);
      else if (e.type === 'straight' || e.type === 'pairs') fx(`<div class="boom small">${tx(TYPE_NAMES[e.type])}!</div>`, 1000);
      if (e.seat !== v.seat) sfx('play');
    } else if ((e.k === 'call' || e.k === 'grab' || e.k === 'bid') && e.seat !== v.seat) sfx('call');
    else if (e.k === 'pass' && e.seat !== v.seat) sfx('pass');
  }
}

// ---------- detak: timer giliran & hitung mundur ----------
function tick() {
  if (!T?.view) return;
  const v = T.view;
  const g = v.game;
  if (v.status === 'playing' && g) {
    const total = Math.max(1, v.deadline - v.turnAt);
    const left = Math.max(0, v.deadline - now());
    const p = Math.min(1, left / total);
    const d = toDisp(g.turn);
    for (let i = 0; i < 3; i++) {
      const el = seatEl(i);
      if (i === d) { el.style.setProperty('--p', p.toFixed(3)); el.classList.toggle('low', left < 5000); }
    }
    const t = $('#myTimer');
    if (t) {
      const s = Math.ceil(left / 1000);
      t.style.setProperty('--p', p.toFixed(3));
      t.classList.toggle('low', s <= 5);
      const b = $('b', t);
      if (b.textContent !== String(s)) {
        b.textContent = s;
        if (s <= 5 && s > 0 && g.turn === v.seat) sfx('tick');
      }
    }
  }
  const rk = $('#rkCount');
  if (rk && v.ranked) rk.textContent = Math.max(0, Math.ceil((v.ranked.startAt - now()) / 1000));
  if (v.status === 'result') updateResultCountdown();
}

// ---------- riwayat kartu & penghitung kartu ----------
$('#btnHistory').addEventListener('click', () => {
  sfx('tap');
  const v = T?.view;
  const g = v?.game;
  if (!g) return toast(tx('Belum ada kartu yang keluar'));
  const tricks = [[]];
  for (const p of g.plays) {
    if (p.trick) tricks.push([]);
    else tricks.at(-1).push(p);
  }
  const nameOf = (k) => (k === v.seat ? tx('Kamu') : v.seats[k]?.name || '') + (k === g.landlord ? ' 👑' : '');
  const rowsHtml = tricks.filter((t) => t.length).map((t, i) => `<div class="hist-trick"><small>${tx('Ronde {n}', { n: i + 1 })}</small>${t.map((p) => `<div class="hist-row"><b>${esc(nameOf(p.seat))}</b>${p.pass ? `<span class="pass">${tx('Pass')}</span>` : `<span class="cards" data-cards="${p.cards.join(',')}"></span>`}</div>`).join('')}</div>`).reverse().join('');
  // penghitung: kartu tiap nilai yang belum terlihat (bukan di tanganmu & belum keluar)
  const seen = counts([...(g.hand || []), ...g.plays.filter((p) => p.cards).flatMap((p) => p.cards)]);
  const tracker = RANKS.map((r, i) => {
    const left = (i >= 13 ? 1 : 4) - seen[i];
    return `<div class="${left ? '' : 'zero'}"><b>${r === 'BJ' ? '🃏' : r === 'RJ' ? '🃏' : r}</b>${left}</div>`;
  }).join('');
  const m = modal(`<h2>${tx('Riwayat kartu')}</h2><p>${tx('Kartu yang belum terlihat (di tangan lawan / kartu dasar):')}</p><div class="tracker">${tracker}</div>
    ${rowsHtml || `<p>${tx('Belum ada kartu yang keluar')}</p>`}<div class="rs-btns"><button class="btn primary" data-a="close" type="button">${tx('Tutup')}</button></div>`);
  for (const el of m.querySelectorAll('[data-cards]')) el.replaceChildren(...el.dataset.cards.split(',').map((c) => cardEl(Number(c), 'mini')));
});

// ---------- kembali ke meja online setelah app ditutup ----------
async function resumeOnline() {
  const fromLink = (location.hash.match(/^#room=([A-Za-z0-9]{5})$/) || [])[1];
  if (fromLink) history.replaceState(null, '', location.pathname + location.search);
  if (T) return;
  if (fromLink) return joinOnline(fromLink);
  const sv = load(ROOM_KEY);
  if (!sv || typeof sv.code !== 'string' || !ROOM_CODE.test(sv.code) || typeof sv.id !== 'string' || !/^[a-z0-9]{12,40}$/.test(sv.id)) return save(ROOM_KEY, null);
  try {
    const info = await api(`/rooms/${sv.code}?id=${sv.id}`);
    if (info.mine && !T) connectOnline(sv.code, account.state === 'in' ? account.name : load(NAME_KEY) || tx('Pemain'), sv.id, !!info.ranked);
    else save(ROOM_KEY, null);
  } catch { /* server tidak menjawab: coba lagi saat dibuka berikutnya */ }
}

// ---------- PWA: service worker + cek versi baru ----------
let bootVersion = null;
async function liveVersion() {
  try {
    const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
    return r.ok ? (await r.json()).v : null;
  } catch { return null; }
}
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
  liveVersion().then((v) => { bootVersion = v; });
}
async function checkUpdate() {
  if (!bootVersion || T) return;
  const v = await liveVersion();
  if (v && v !== bootVersion && !T) location.reload();
}

// ---------- mulai ----------
{
  const lost = settleAbandoned();
  if (lost) setTimeout(() => toast(tx('Tangan ditinggal dihitung kalah: {n} koin', { n: signed(lost) }), 4000), 600);
}
fit();
renderEmblem();
renderLobby();
show('lobby');
// link meja dibuka saat game sudah terbuka (hanya #room=… yang berubah): gabung tanpa muat ulang
addEventListener('hashchange', () => { if (onlineOn && /^#room=/.test(location.hash)) resumeOnline(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && !T) { renderLobby(); checkUpdate(); refreshAccount(); } });
installErrorLog(() => bootVersion);
const justLoggedIn = new URLSearchParams(location.search).get('login') === 'ok';
if (justLoggedIn) history.replaceState(null, '', location.pathname + location.hash);
const accountReady = refreshAccount().then((a) => {
  if (justLoggedIn) toast(a.state === 'in' ? tx('Masuk sebagai {name}', { name: a.name }) : tx('Login belum berhasil — coba lagi'), 3000);
  return a;
});
onlineConfig().then(async (cfg) => {
  onlineOn = cfg.online;
  rankedOn = cfg.ranked;
  if (!T) renderLobby();
  await accountReady;
  if (cfg.online) resumeOnline();
});
