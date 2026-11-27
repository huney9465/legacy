/* v25.7: fewer requests = less lag: 2 requests per next song (head + rest), cache pieces >= 32 KB, one write round per second in the background.
   v25.6: CHUNKS RUN AHEAD, THE SONG FOLLOWS. Chunk size / lead are auto-detected all the time from the real network speed, RAM (deviceMemory, JS heap) and
   saveData (adp()). Next song: nothing while the song plays; ~4 s before the end only a small HEAD piece (30-100 KB), the rest in small Range pieces
   one at a time (bigger only when little time is left). Chunk writes pause while the next song comes in (never together). Now Playing: the line behind
   the dot, the dot and the mini bar take a light tint of the cover colour (--np-prog).
   v25.5: no lag while you scroll (song pieces are saved only when the finger is still), the cover changes only when the next song really plays,
   next song starts faster, real ALBUMS (search / artist page / album page), artist name tap on Now Playing, big download arrow with a ring, Following in Library,
   new-release notifications of followed artists, playlist songs no longer listed in Downloads, tick on downloaded playlists.
   v25.4: next song downloads when ~4 s of this one are left (PRE_AT); the played song is saved to the phone in tiny 8 KB pieces, slowly (CC_CH, CC_BG_GAP).
   Legacy Music app (v23.7 = v23.6 + chunk cache). Installed app = plays in the phone. Website = plays in the Discord voice channel.
   v20: previous button, autoplay, lock-screen / notification-shade controls (Media Session), offline downloads (Premium),
        saved playlists, themes (Auto / Dark / White / AMOLED), update checker, sleep timer, repeat / shuffle, smarter search.
   v21: recently played row (songs + playlists), collaborative playlists (Premium, invite-link based),
        premium-expiry playlist auto-private, YT-search note, Blend / mood picker, song radio, artist page.
   v21.1: playlist back button + Back chip, sheets close with the hardware back button, playlist inner cover from /api/playlist/info,
        collaborator names under playlists, follow artists (lm-artists) -> Home "Your artists" + You tab "Followed artists".
   v22.0: everything is saved on the server (events + sync): same likes/recent/follows on every phone, visible in Admin -> App.
        APK only: Album of the week, Trending albums, Top songs of the app, Daily Mix, My stats, playback speed, in-app update, animated login.
   v22.1: owner uploads the APK in Admin -> App Upload (checks + approval). Old apps get an announcement by themselves, Update button in You,
        optional auto-update (download + Android installer), the download is checked against the approved file's SHA-256.
   v22.2: announcements / polls / questions in the app (bell in the top bar, same data as the website bell).
   v23.0: YouTube-Music style Now Playing (swipe covers, Up next / Lyrics / Related), real Android media session on the lock screen (cover, seek bar,
        shuffle / like), lyrics for every song, official-first search, no repeat versions in autoplay, slower in/out animations, playlist ticks + owner logo,
        full-page playlist editor with gallery upload, delete playlist, Admin: users / logins / grants / playlists / ticks / announcements, announcements as phone notifications.
   NOTE: bump CV below together with APP_VERSION in pwa.py on every release. */
(() => {
'use strict';
const CV = '23.8';
/* APK mode: the Android app bundles these files and talks to the server over HTTPS with a token (window.LM_BASE is set by its index.html).
   On the website / installed PWA LM_BASE is empty and everything works exactly as before (cookie login, same origin). */
const NAT = (typeof window.LM_BASE === 'string' && window.LM_BASE) ? window.LM_BASE.replace(/\/$/, '') : '';
/* v23.1: "Install Legacy Music" belongs to the WEBSITE ONLY. Inside the APK the app is already installed, so the banner
   must never be drawn. We check every signal the wrapper can give us (native bridge, base URL, its user-agent, wv shell). */
const IS_APK = !!NAT || !!(window.LMNative) || /LegacyMusicApp|LegacyMusic\/|Legacy Music App/i.test(navigator.userAgent) ||
  (/;\s*wv\)/i.test(navigator.userAgent) && /legacymusic/i.test(location.hostname + navigator.userAgent));
/* v23.0: the install button. Chrome fires this once; we keep it and replay it on tap. */
let INSTALL_EVT = null;
try { window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); INSTALL_EVT = e }) } catch (e) {}
const isInstalled = () => { try { return matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || navigator.standalone === true } catch (e) { return false } };
const installHero = (cls) => (IS_APK || isInstalled()) ? '' : `<button class="inst-hero${cls ? ' ' + cls : ''}" data-a="install-app">
  <span class="ih-ic"><svg viewBox="0 0 24 24"><path d="M12 3v12M7 11l5 5 5-5M4 20h16"/></svg></span>
  <span class="ih-tx"><b>Install Legacy Music</b><small>Faster, works offline, opens like a real app</small></span>
  <span class="ih-go">Install</span></button>`;
const bridge = NAT ? (window.LMNative || null) : null;
let TOK = '', MT = '';
const U = p => (NAT && String(p).startsWith('/')) ? NAT + p : p;
const $ = (s, r = document) => r.querySelector(s), au = $('#au'), view = $('#view');
const esc = s => String(s ?? '').replace(/[&<>\"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;' }[c]));
const store = { get(k) { try { return localStorage.getItem(k) } catch (e) { return null } }, set(k, v) { try { localStorage.setItem(k, v) } catch (e) {} } };
const jget = (k, d) => { try { return JSON.parse(store.get(k)) ?? d } catch (e) { return d } };
if (NAT) { TOK = store.get('lm-tok') || ''; MT = store.get('lm-mt') || '' }
const withMt = u => (NAT && MT && /\/static\/uploads\/|\/api\/app\/(stream|warm)|\/download\/app\.apk/.test(u)) ? u + (u.includes('?') ? '&' : '?') + 'mt=' + encodeURIComponent(MT) : u;
const noMt = u => String(u).replace(/([?&])mt=[^&]*&?/, '$1').replace(/[?&]$/, '');
const ff = (u, o = {}) => fetch(U(u), { credentials: NAT ? 'omit' : 'same-origin', ...o, headers: { ...(o.headers || {}), ...(TOK ? { Authorization: 'Bearer ' + TOK } : {}) } });
const PLAY = '<path d="M7 4l13 8-13 8z"/>', PAUSE = '<path d="M6 4h4v16H6zM14 4h4v16h-4z"/>';
const S = { me: null, cfg: {}, queue: [], qi: -1, cur: null, playing: false, pos: 0, dur: 0, pl: null, gid: null, liked: {}, dl: {}, saved: new Set(),
  auto: true, rep: 'off', shuf: false, orig: null, ctx: '', chips: new Set(), offline: !navigator.onLine, haptic: store.get('lm-haptic') !== '0' };
let RT = 0;
let HEAVYK = '';   // v23.4: song for which cover / colour / lyrics / artist were already prepared for the screen

/* ───────── theme (Auto / Dark / White / AMOLED) ───────── */
function applyTheme() {
  const t = store.get('lm-theme') || 'auto';
  const r = t === 'auto' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : t;
  document.documentElement.dataset.theme = r;
  const tc = $('#tc'); if (tc) tc.content = { light: '#ffffff', amoled: '#000000', dark: '#07080b' }[r];
}
applyTheme(); matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', applyTheme);

const P = {
  crown: '<path d="M3 8l4 4 5-7 5 7 4-4-2 11H5z"/>', phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  head: '<path d="M4 15v-3a8 8 0 0116 0v3"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/>',
  heart: '<path d="M12 20s-8-5-8-11a4.5 4.5 0 018-2.7A4.5 4.5 0 0120 9c0 6-8 11-8 11z"/>', lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
  play: '<path d="M7 4l13 8-13 8z"/>', shuffle: '<path d="M3 7h4c4 0 6 10 10 10h4M3 17h4c1.5 0 2.7-1 3.7-2.5M14 8.5C15 7.5 16 7 17 7h4M18 4l3 3-3 3M18 14l3 3-3 3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', music: '<path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  dl: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>', bookmark: '<path d="M6 4h12v17l-6-4-6 4z"/>', refresh: '<path d="M20 11a8 8 0 10-2.3 6M20 4v7h-7"/>', moon: '<path d="M20 14A8 8 0 1110 4a6.5 6.5 0 0010 10z"/>',
  users: '<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>',
  link: '<path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  radio: '<circle cx="12" cy="12" r="2"/><path d="M4.93 4.93l1.41 1.41M17.66 6.34l1.41-1.41M12 2v2M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 19.07l-1.41-1.41"/><path d="M12 20a8 8 0 100-16"/>',
  person: '<path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 012-2h9"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  edit: '<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>' };
P.pause = '<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/>'; P.stop = '<path d="M6 6l12 12M18 6L6 18"/>';
const ic = (n, c = '') => `<svg class="i ${c}" viewBox="0 0 24 24">${P[n]}</svg>`;
const L = {};
const arr = x => Array.isArray(x) ? x : (x && (x.items || x.songs || x.playlists)) || [];
const fmt = ms => { ms = Math.max(0, Math.floor((ms || 0) / 1000)); return Math.floor(ms / 60) + ':' + String(ms % 60).padStart(2, '0') };
/* v23.2: compact view counts like YouTube/Instagram - 999, 1.2K, 12K, 1.2M, 1M, 1.2B.
   Never "1200 views" again: 1.2K views, 12K views, 1M views. */
const fmtViews = n => {
  n = Math.max(0, Math.round(+n || 0));
  if (n < 1000) return String(n);
  const u = [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
  for (const [v, s] of u) {
    if (n >= v) { const x = n / v; const r = x >= 100 ? Math.round(x) : Math.round(x * 10) / 10; return (r % 1 === 0 ? String(r) : r.toFixed(1)) + s }
  }
  return String(n);
};
/* release year of a song (0 = unknown): a year field from the server, else a (19xx)/(20xx) written in the title */
const songYear = x => { const y = parseInt(x.year || x.release_year || (String(x.release_date || '').slice(0, 4)), 10); if (y > 1900 && y < 2100) return y; const m = /[(\[]((?:19|20)\d\d)[)\]]/.exec(x.title || ''); return m ? +m[1] : 0 };
const nt = x => ({ title: x.title || '', author: x.author || '', uri: x.uri || '', identifier: x.identifier || x.youtube_id || '', thumbnail: x.thumbnail || '', duration: x.duration || 0, id: x.id, yr: songYear(x) });
const ytId = t => { if (/^[\w-]{11}$/.test(t.identifier) && /youtu/.test(t.uri)) return t.identifier; const m = /(?:youtube\.com\/(?:watch\?[^#]*v=|shorts\/)|youtu\.be\/)([\w-]{11})/.exec(t.uri || ''); return m ? m[1] : '' };
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const mode = () => S.cfg.phone_playback === false ? 'discord' : 'phone';
const TICKS = { owner: 'owner-white.svg', admin: 'admin.svg', premium: 'premium-tick.svg', official: 'pl-official.png' };
const tick = r => TICKS[r] ? `<img class="tick" src="/static/badges/${TICKS[r]}" alt="${r}">` : '';
/* v23.0 FIX: a missing cover used to become url('undefined') -> the app requested /undefined (404, broken tile).
   Now an empty value simply means "no background image". */
const bgi = u => { const s = (u == null || u === 'null' || u === 'undefined' || u === '') ? '' : String(u); return s ? `background-image:url('${esc(encodeURI(s).replace(/'/g, '%27').replace(/[()]/g, c => c === '(' ? '%28' : '%29'))}')` : '' };
const art = t => t.thumbnail || (ytId(t) ? `https://i.ytimg.com/vi/${ytId(t)}/mqdefault.jpg` : '/static/pwa/icon-192.png');
/* v25 Data saver (default ON): lowest audio quality asked from the server, small covers only (a maxres cover is 100-300 KB, 3 of them per song = as much as the sound) */
const dsOn = () => store.get('lm-ds') !== '0';
const artHi = t => dsOn() ? art(t) : ytId(t) ? `https://i.ytimg.com/vi/${ytId(t)}/maxresdefault.jpg` : art(t);
const fixUrl = u => { if (!u || u === 'null' || u === 'undefined') return null; u = noMt(String(u).trim()); if (!u) return null; if (/^(data:|blob:)/i.test(u)) return u; if (/^https?:/i.test(u)) return withMt(u); if (u.startsWith('//')) return withMt(location.protocol + u); return withMt((NAT || location.origin) + (u.startsWith('/') ? '' : '/') + u) };
const buzz = n => { if (S.haptic && navigator.vibrate) navigator.vibrate(n || 12) };
let tm; const toast = m => { const e = $('#toast'); e.textContent = m; e.classList.add('on'); clearTimeout(tm); tm = setTimeout(() => e.classList.remove('on'), 3200) };
/* v23.4: network status strip at the bottom (like YouTube / Chrome): "You are now offline" stays while there is no internet,
   "You are now online" (green) shows for a moment when it comes back, then the strip slides away. Text only, no icons. */
const NETBAR = { el: null, t: 0, off: false };
function netBar(online) {
  try {
    if (online && !NETBAR.off) return;   // never say "online" unless we showed "offline" before
    if (!NETBAR.el) { const d = document.createElement('div'); d.id = 'netbar'; d.setAttribute('role', 'status'); document.body.appendChild(d); NETBAR.el = d }
    const d = NETBAR.el, root = document.documentElement; clearTimeout(NETBAR.t);
    d.textContent = online ? 'You are now online' : 'You are now offline';
    d.classList.toggle('ok', !!online); d.classList.add('on'); root.classList.add('netbar-on');
    NETBAR.off = !online;
    if (online) NETBAR.t = setTimeout(() => { d.classList.remove('on'); root.classList.remove('netbar-on') }, 2800);
  } catch (e) {}
}
if (!navigator.onLine) netBar(false);   // app opened without internet
document.addEventListener('visibilitychange', () => { if (document.hidden) return; if (!navigator.onLine) netBar(false); else if (NETBAR.off) netBar(true) });   // internet changed while the app was in the background
const isNet = e => e instanceof TypeError || !navigator.onLine;

async function api(p, o = {}) {
  let r;
  try { r = await fetch(U(p), { method: o.method || 'GET', credentials: NAT ? 'omit' : 'same-origin', headers: { ...(o.body ? { 'Content-Type': 'application/json' } : {}), ...(TOK ? { Authorization: 'Bearer ' + TOK } : { 'X-LM-Platform': 'pwa' }) }, body: o.body ? JSON.stringify(o.body) : undefined }) }
  catch (e) { throw Object.assign(new Error("You're offline"), { offline: true }) }
  if (r.status === 401) { if (NAT) showLogin('Your login expired. Please log in again.'); else location.href = '/auth/login?next=/app'; throw new Error('Log in first') }
  let j = null; try { j = await r.json() } catch (e) {}
  if (r.status === 426) { showUpdate({ update_required: true, notes: j && j.detail }); throw Object.assign(new Error('Update required'), { status: 426 }) }
  if (!r.ok) throw Object.assign(new Error((j && j.detail) || 'Something went wrong (' + r.status + ')'), { status: r.status });
  return j;
}

/* ───────── offline downloads (Premium): songs live in the phone's IndexedDB ───────── */
const idb = () => new Promise((res, rej) => { const r = indexedDB.open('lm-offline', 1); r.onupgradeneeded = () => { r.result.createObjectStore('songs', { keyPath: 'id' }); r.result.createObjectStore('meta', { keyPath: 'id' }) }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) });
const idbTx = async (store_, mode_, fn) => { const d = await idb(); return new Promise((res, rej) => { const tx = d.transaction(store_, mode_), rq = fn(tx.objectStore(store_)); tx.oncomplete = () => res(rq && rq.result); tx.onerror = () => rej(tx.error) }) };
const dlMeta = () => idbTx('meta', 'readonly', s => s.getAll()).catch(() => []);

/* v24.2: per-song download ring (fills while downloading) -> tick when done; downloaded playlists list */
const DLP = {};   // song id -> percent while it downloads (-1 = size unknown, spins)
const DL_TICK = '<svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>';
/* v25.5: songs the person downloaded ONE BY ONE (lm-dlsolo). Songs that came only with a downloaded playlist stay inside that playlist and are not listed in Downloads. */
const soloGet = () => { try { return new Set(JSON.parse(store.get('lm-dlsolo') || '[]')) } catch (e) { return new Set() } };
const soloAdd = id => { const s = soloGet(); if (s.has(id)) return; s.add(id); try { store.set('lm-dlsolo', JSON.stringify([...s])) } catch (e) {} };
const soloDel = id => { const s = soloGet(); if (!s.delete(id)) return; try { store.set('lm-dlsolo', JSON.stringify([...s])) } catch (e) {} };
const inDlPl = id => { try { return dlPlGet().some(p => (p.ids || []).includes(id)) } catch (e) { return false } };
const plDl = code => { try { const k = dlPlKey(code); return dlPlGet().some(p => p.code === k) } catch (e) { return false } };
const dlMark = id => !id ? '' : S.dl[id] ? `<span class="dl-ok">${DL_TICK}</span>` : (id in DLP ? `<span class="dl-ring${DLP[id] < 0 ? ' ind' : ''}" style="--p:${Math.max(0, DLP[id])}"></span>` : '');
const dlSlot = id => { delete DLPAINT[id]; try { document.querySelectorAll('.dl-slot').forEach(s => { if (s.dataset.dlid === id) s.innerHTML = dlMark(id) }) } catch (e) {} };
const DLPAINT = {};   // v24.6 lag fix: last % painted per song
const dlProg = (id, p) => { DLP[id] = p; if (document.hidden) return; { const pi = Math.round(p); if (DLPAINT[id] === pi) return; DLPAINT[id] = pi } try { document.querySelectorAll('.dl-slot').forEach(s => { if (s.dataset.dlid !== id) return; const r = s.firstElementChild; if (r && r.classList.contains('dl-ring')) { r.classList.toggle('ind', p < 0); r.style.setProperty('--p', Math.max(0, p)) } else s.innerHTML = dlMark(id) }) } catch (e) {} };
/* v24.5: pause / resume / cancel for one song and for a whole playlist download */
const DLJ = {}, DLPL = {};   // DLJ: song id -> { ctl, paused, cancelled, pl } | DLPL: playlist key -> { paused, cancelled, total, done, name }
const dlSleep = ms => new Promise(r => setTimeout(r, ms));
const dlPaused = id => { const j = DLJ[id]; return !!j && (j.paused || !!(j.pl && DLPL[j.pl] && DLPL[j.pl].paused)) };
const dlCancelled = id => !!(DLJ[id] && DLJ[id].cancelled);
function dlSongCancel(id) { const j = DLJ[id]; if (!j) return; j.cancelled = true; try { j.ctl && j.ctl.abort() } catch (e) {} }
function dlPlUi(k) {
  try {
    const p = DLPL[k], b = document.querySelector('[data-a="pl-dl"]'); if (!p || !b) return;
    if (!location.hash.toUpperCase().includes(String(k).toUpperCase())) return;
    b.innerHTML = `${ic('dl')} ${p.paused ? 'Paused' : 'Downloading'} ${p.done}/${p.total}`;
  } catch (e) {}
}
function dlPlCancel(k) { const p = DLPL[k]; if (!p) return; p.cancelled = true; p.paused = false; Object.keys(DLJ).forEach(id => { if (DLJ[id].pl === k) dlSongCancel(id) }) }
function dlSongSheet(id, title) {
  const j = DLJ[id]; if (!j) return; const pa = dlPaused(id), pc = DLP[id] >= 0 ? ` · ${DLP[id]}%` : '';
  sheet(`<h3>${esc(title || 'Song')}</h3><span class="sub">${pa ? 'Download paused' : 'Downloading'}${pc}</span><div class="menu">
    <button data-a="dl-pause" data-id="${id}">${pa ? ic('play') + ' Resume download' : ic('pause') + ' Pause download'}</button>
    <button data-a="dl-cancel" data-id="${id}">${ic('stop')} Cancel download</button></div>`);
}
function dlPlSheet(k, name) {
  const p = DLPL[k]; if (!p) return;
  sheet(`<h3>${esc(name || p.name || 'Playlist')}</h3><span class="sub">${p.paused ? 'Download paused' : 'Downloading'} · ${p.done}/${p.total} songs</span><div class="menu">
    <button data-a="dlpl-pause" data-k="${esc(k)}">${p.paused ? ic('play') + ' Resume download' : ic('pause') + ' Pause download'}</button>
    <button data-a="dlpl-cancel" data-k="${esc(k)}">${ic('stop')} Cancel download</button></div>`);
}
async function dlRead(r, id, kick) {
  let tot = 0; try { tot = +r.headers.get('content-length') || 0 } catch (e) {}
  if (!r.body || !r.body.getReader) return r.blob();
  const rd = r.body.getReader(), parts = []; let got = 0, ty = ''; try { ty = r.headers.get('content-type') || '' } catch (e) {}
  for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); got += value.length; if (kick) kick(); while (dlPaused(id) && !dlCancelled(id)) { await dlSleep(300); if (kick) kick() } dlProg(id, tot ? Math.min(99, Math.round(got * 100 / tot)) : -1) }
  return new Blob(parts, ty ? { type: ty } : {});
}
const dlPlGet = () => { const a = jget('lm-dlpl', []); return Array.isArray(a) ? a : [] };
const dlPlKey = c => c === 'liked' ? 'liked' : String(c || '').toUpperCase();
const dlPlHas = c => { const k = dlPlKey(c); return dlPlGet().find(x => x.code === k) };
const dlPlDone = list => { const ids = (list || []).map(ytId).filter(Boolean); return !!ids.length && ids.every(i => S.dl[i]) };
function dlPlSave(code, name, cover, tracks) {
  const k = dlPlKey(code), ids = (tracks || []).map(ytId).filter(Boolean);
  const a = dlPlGet().filter(x => x.code !== k); a.unshift({ code: k, name: name || k, cover: cover || '', ids, ts: Date.now() });
  store.set('lm-dlpl', JSON.stringify(a.slice(0, 200)));
}
async function dlPlaylist(code, name, cover, tracks) {
  if (!isPrem()) return premiumSheet('Downloading songs to listen offline is a Premium feature.');
  const all = (tracks || []).filter(x => ytId(x)); if (!all.length) return toast('No downloadable songs here');
  const todo = all.filter(x => !S.dl[ytId(x)]);
  if (!todo.length) { dlPlSave(code, name, cover, all); toast('Everything here is already downloaded'); return true }
  const k = dlPlKey(code); if (DLPL[k]) return dlPlSheet(k, name);
  /* v24.4: 3 songs download at the same time and one failed song no longer stops the playlist. v24.5: pause / resume / cancel */
  const P_ = DLPL[k] = { paused: false, cancelled: false, total: todo.length, done: 0, name: name || '' };
  let idx = 0, bad = 0, skipped = 0, stop = false; toast(`Downloading 0/${P_.total}…`); dlPlUi(k);
  const DL_CONC = 4, DL_BG_CONC = 2, warmed = new Set();
  const warmFrom = i => { for (let k = i; k < Math.min(todo.length, i + DL_CONC * 2); k++) { const id = ytId(todo[k]); if (!id || warmed.has(id)) continue; warmed.add(id); ff(`/api/app/warm?v=${id}&av=${CV}`).catch(() => {}) } };   // the server starts preparing the next songs while the current ones download
  const worker = async (wid) => {
    for (;;) {
      await idleForPlay();
      while (P_.paused && !P_.cancelled) await dlSleep(300);
      while (document.hidden && wid >= DL_BG_CONC && !P_.cancelled && !stop) await dlSleep(1500);   // v24.6 lag fix: in the background only DL_BG_CONC songs download at once (a game needs the CPU, RAM and storage)
      if (stop || P_.cancelled || idx >= P_.total) return;
      warmFrom(idx); const t = todo[idx++], ok = await dlSong(t, true, k);
      if (ok) { P_.done++; if (!P_.paused) toast(`Downloading ${P_.done}/${P_.total}…`); dlPlUi(k) }
      else if (ok === null) skipped++;
      else if (++bad >= 4 && !P_.done) stop = true;
    }
  };
  try { await Promise.all(Array.from({ length: DL_CONC }, (_, w) => worker(w))) } finally { delete DLPL[k] }
  if (P_.cancelled) { toast('Download cancelled'); return false }
  if (all.every(x => S.dl[ytId(x)])) { dlPlSave(code, name, cover, all); toast('Playlist downloaded'); buzz(); return true }
  toast(skipped && !bad ? 'Some songs were skipped' : 'Download stopped. Try again to finish the playlist'); return false;
}
async function dlPlOffline(rec) {
  const m = await dlMeta(), by = {}; m.forEach(x => { by[x.id] = x });
  return { name: rec.name, code: rec.code, cover_image_url: rec.cover || '', is_owner: false, tracks: rec.ids.map(i => by[i]).filter(Boolean).map(x => ({ title: x.title, author: x.author, thumbnail: x.thumbnail, uri: x.uri, identifier: x.id, duration: x.duration })) };
}
async function dlSong(t, quiet, pl) {
  const id = ytId(t); if (!id) { if (!quiet) toast("This song can't be downloaded"); return false }
  if (S.dl[id]) { if (!pl && !quiet) soloAdd(id); if (!quiet) toast('Already downloaded'); return true }
  if (!isPrem()) { premiumSheet('Downloading songs to listen offline is a Premium feature.'); return false }
  if (!navigator.onLine) { toast("You're offline"); return false }
  if (DLJ[id]) return null;   // already downloading
  const J = DLJ[id] = { ctl: null, paused: false, cancelled: false, pl: pl || '' };
  const b = (S.cur && ytId(S.cur) === id) ? $('#np-dl') : null; b && b.classList.add('busy'); if (!quiet) toast('Downloading…'); dlProg(id, 0);
  try {
    let blob = null;
    for (let at = 0; at < 2 && !blob; at++) {
      await idleForPlay();   // v24.4: a song that is starting to play always goes first
      while (dlPaused(id) && !J.cancelled) await dlSleep(300);
      if (J.cancelled) return null;
      const ctl = J.ctl = new AbortController(); let wd = 0;
      const fire = () => { if (J.cancelled || !dlPaused(id)) ctl.abort(); else wd = setTimeout(fire, 3000) };
      wd = setTimeout(fire, 45000);
      try {
        const r = await ff(`/api/app/stream?v=${id}&dl=1&av=${CV}`, { signal: ctl.signal });
        if (r.status === 426) { showUpdate({ update_required: true }); return false }
        if (r.status === 403) { premiumSheet('Downloading songs to listen offline is a Premium feature.'); return false }
        if (!r.ok) throw new Error("Couldn't download this song");
        blob = await dlRead(r, id, () => { clearTimeout(wd); wd = setTimeout(fire, 25000) });   // no data for 25 s -> stop and try again
      } catch (e) { blob = null; if (J.cancelled) return null; if (at === 1) throw e; dlProg(id, 0); await new Promise(r => setTimeout(r, 1500)) }
      finally { clearTimeout(wd) }
    }
    if (J.cancelled) return null;
    await idbTx('songs', 'readwrite', s => s.put({ id, blob }));
    await idbTx('meta', 'readwrite', s => s.put({ id, title: t.title, author: t.author, thumbnail: art(t), duration: t.duration, size: blob.size, ts: Date.now(), uri: t.uri || `https://www.youtube.com/watch?v=${id}` }));
    if (!pl && !quiet) soloAdd(id); delete DLP[id]; S.dl[id] = 1; dlSlot(id); ev('download', { ref: t.uri || id, title: t.title, author: t.author }); if (!quiet) toast('Downloaded · plays offline'); buzz(); try { navigator.storage && navigator.storage.persist && navigator.storage.persist() } catch (e) {}
    return true;
  } catch (e) { if (J.cancelled) return null; if (!quiet) toast(e.message || 'Download failed'); return false }
  finally { delete DLJ[id]; b && b.classList.remove('busy'); if (id in DLP) { delete DLP[id]; dlSlot(id) } ui() }
}
async function dlRemove(id) { soloDel(id); ev('dl_rm', { ref: id }); await idbTx('songs', 'readwrite', s => s.delete(id)); await idbTx('meta', 'readwrite', s => s.delete(id)); delete S.dl[id] }

/* ───────── everything the app does is saved on the server ───────── */
// Events go into a small queue (kept when offline) and are sent in batches to /api/app/events. The server builds Recently played,
// Listen again, Daily Mix, followed artists, charts and the Admin -> App feed from them.
let evBusy = false, evTimer = 0;
function ev(kind, o = {}) {
  const q = jget('lm-evq', []); q.push({ kind, ts: Date.now(), ...o });
  store.set('lm-evq', JSON.stringify(q.slice(-300)));
  clearTimeout(evTimer); evTimer = setTimeout(evFlush, kind === 'play' ? 1500 : 700);
}
async function evFlush() {
  if (evBusy || !S.me || !navigator.onLine || (NAT && !TOK)) return;
  evBusy = true;
  try {
    for (let n = 0; n < 6; n++) {
      const q = jget('lm-evq', []); if (!q.length) break;
      const sent = q.slice(0, 50);
      await api('/api/app/events', { method: 'POST', body: { events: sent } });
      store.set('lm-evq', JSON.stringify(jget('lm-evq', []).slice(sent.length)));
    }
  } catch (e) {} finally { evBusy = false }
}
addEventListener('online', evFlush);
document.addEventListener('visibilitychange', () => { if (document.hidden) evFlush() });
async function syncDown() {
  if (S.offline || !navigator.onLine) return;
  try {
    await evFlush();
    const d = await api('/api/app/sync'); S.sync = d;
    let fol = arr(d.follows);
    if (!store.get('lm-sync1')) {          // first sync on this phone: keep artists that were only followed here (and send them to the server)
      artistsGet().forEach(a => { if (!fol.some(f => akey(f.name) === akey(a.name))) { fol.push(a); ev('follow', { ref: a.name, thumb: a.thumbnail || '' }) } });
      store.set('lm-sync1', '1');
    }
    store.set('lm-artists', JSON.stringify(fol));
    store.set('lm-rp', JSON.stringify(arr(d.recent)));
    store.set('lm-pc', JSON.stringify(d.plays || {}));
  } catch (e) {}
  plArtLoad(); ptkLoad().then(ptkApply);
}

/* ───────── recently played (songs + playlists) ───────── */
// Stored locally: [{type:'song'|'playlist', title, author?, code?, thumbnail, ts}]
// FIX: rpPush now accepts a 3rd param `userInitiated` (bool).
//      Songs played by autoplay / queue-advance are NOT pushed to Recently Played.
//      Only songs the user explicitly taps (or playlists they open) are stored.
function rpPush(type, item, userInitiated) {
  // Always fire the server event (for stats / sync) regardless of user-initiated flag
  const key = type === 'song' ? (item.uri || item.title) : item.code;
  if (type === 'song') ev('play', { ref: key, title: item.title, author: item.author, uri: item.uri, thumb: noMt(item.thumbnail || '') });
  else ev('pl_view', { code: item.code, title: item.title, thumb: noMt(item.thumbnail || '') });
  // Track play count for Listen Again (always, for personalisation)
  if (type === 'song') {
    const pc = jget('lm-pc', {});
    const k = item.uri || item.title;
    pc[k] = { ...(pc[k] || {}), ...item, count: ((pc[k] || {}).count || 0) + 1, ts: Date.now() };
    const sorted = Object.entries(pc).sort((a, b) => b[1].count - a[1].count).slice(0, 50);
    store.set('lm-pc', JSON.stringify(Object.fromEntries(sorted)));
  }
  // FIX: Only add to the visible Recently Played list when user chose it themselves
  if (!userInitiated) return;
  /* v23.0: Recently played is SONGS ONLY. Playlists and the Liked-songs collection never go in here. */
  if (type !== 'song') return;
  const rp = jget('lm-rp', []);
  const filtered = rp.filter(x => x.type === 'song' && (x.uri || x.title) !== key);
  filtered.unshift({ type: 'song', ...item, ts: Date.now() });
  store.set('lm-rp', JSON.stringify(filtered.slice(0, 30)));
}
/* v23.0: read side is filtered too, so old playlists / liked entries saved by earlier versions disappear. */
function rpGet() {
  const list = jget('lm-rp', []);
  return (Array.isArray(list) ? list : []).filter(x => x && x.type === 'song' && !/^liked$/i.test(String(x.code || '')) && !/^liked songs$/i.test(String(x.title || '')));
}
// FIX: also fix playlist-open rpPush to pass userInitiated=true (user opened the playlist deliberately)

// Returns top played songs for Listen Again section
function listenAgainGet() {
  const pc = jget('lm-pc', {});
  return Object.values(pc).sort((a, b) => b.count - a.count).slice(0, 12);
}
const rpCards = list => {
  const songs = (list || []).filter(x => x && x.type === 'song');
  if (!songs.length) return '';
  return `<h2>${ic('clock')} Recently played <small data-a="rp-clear">Clear</small></h2><div class="cards">${songs.slice(0, 12).map(x => {
    return `<button class="card" data-a="rp-song" data-k="${esc(x.uri || x.title)}"><span class="cv" style="${bgi(x.thumbnail || '/static/pwa/icon-192.png')}"></span><span class="t">${esc(x.title)}</span><span class="s">${esc(x.author || '')}</span></button>`;
  }).join('')}</div>`;
};

/* ───────── followed artists (local, lm-artists = [{name, thumbnail, ts}]) ───────── */
const akey = n => String(n || '').trim().toLowerCase();
const artistsGet = () => { const a = jget('lm-artists', []); return Array.isArray(a) ? a : [] };
const isFollowing = n => artistsGet().some(a => akey(a.name) === akey(n));
function artistToggle(name, thumb) {
  name = String(name || '').trim(); if (!name) return false;
  let a = artistsGet();
  if (isFollowing(name)) { a = a.filter(x => akey(x.name) !== akey(name)); store.set('lm-artists', JSON.stringify(a)); return false }
  a.unshift({ name, thumbnail: thumb || '', ts: Date.now() }); store.set('lm-artists', JSON.stringify(a.slice(0, 200))); return true;
}
const artistCards = list => `<div class="cards">${list.map(a => `<button class="card" data-a="open-artist" data-name="${esc(a.name)}"><span class="cv" style="${bgi(fixUrl(a.thumbnail) || '/static/pwa/icon-192.png')};border-radius:50%"></span><span class="t">${esc(a.name)}</span><span class="s">Artist</span></button>`).join('')}</div>`;

/* ───────── playback ───────── */
const q = t => t.uri || `${t.title} ${t.author}`.trim(), fb = t => `${t.title} ${t.author}`.trim();
const streamUrl = t => withMt(U((ytId(t) ? `/api/app/stream?v=${ytId(t)}` : `/api/app/stream?q=${encodeURIComponent(fb(t).slice(0, 150))}`) + '&av=' + CV + '&hq=' + (isPrem() && !dsOn() ? 1 : 0) + (dsOn() ? '&ds=1' : '')));
let PT = 0, blobUrl = '', warmed = '';
/* v24: the 3 songs after the current one are prepared on the server one by one (the server finds + keeps their stream), so the next song starts at once.
   The window slides: every time a new song starts, the song that is now 3rd ahead gets prepared. */
const WARM = { done: new Set(), busy: false, t: 0 };
let lastWarmChk = 0;
async function warmAhead() {
  if (WARM.busy || !navigator.onLine || mode() !== 'phone') return;
  WARM.busy = true;
  try {
    for (let k = 1; k <= 3; k++) {
      const n = S.queue[S.qi + k], id = n && ytId(n);
      if (!id || S.dl[id] || WARM.done.has(id)) continue;
      WARM.done.add(id); if (WARM.done.size > 300) WARM.done.delete(WARM.done.values().next().value);
      try { await Promise.race([ff(`/api/app/warm?v=${id}&av=${CV}`), new Promise(r => setTimeout(r, 6000))]) } catch (e) { WARM.done.delete(id) }
    }
  } finally { WARM.busy = false }
}
const warmSoon = () => { clearTimeout(WARM.t); WARM.t = setTimeout(warmAhead, 1200) };
/* v23.9: the moment a finger touches a song, the server is asked to prepare its stream - by the time the finger lifts the song is already found,
   so it starts at once and plays by itself (no need to press play below). */
document.addEventListener('pointerdown', e => {
  try {
    if (mode() !== 'phone' || !navigator.onLine) return;
    const el = e.target.closest && e.target.closest('[data-a="play"]'); if (!el) return;
    const it = (L[el.dataset.l] || [])[+el.dataset.i]; const id = it && ytId(nt(it));
    if (!id || S.dl[id] || WARM.done.has(id)) return;
    WARM.done.add(id); ff(`/api/app/warm?v=${id}&av=${CV}`).catch(() => WARM.done.delete(id));
  } catch (err) {}
}, true);
/* v23.4: next-song preload. Only when the CURRENT song is fully loaded, the NEXT song (just one) is downloaded once into memory.
   When it starts it plays from memory = instant start, no second download. A skip / queue change cancels it. */
const PRE = { key: '', url: '', busy: '', ctl: null, sched: 0 };
let ALB_NEXT = false, ALB_Q = null;   // v25.5: an album was started -> ONLY its songs play (no autoplay songs from outside)
const albOnly = () => !!ALB_Q && S.queue === ALB_Q;
let HOLD_T = 0, PRE_EARLY = 0;   // v25.5: HOLD_T = a next / previous was pressed: the screen keeps the old song until the new one really plays
const holdUi = () => !!HOLD_T && Date.now() - HOLD_T < 2500;
function holdStart() { HOLD_T = Date.now(); setTimeout(() => { if (HOLD_T && Date.now() - HOLD_T >= 2500) { HOLD_T = 0; try { ui() } catch (e) {} } }, 2600) }
const PRE_AT = 4;   // v25.4: the NEXT song starts downloading when this many seconds of the current song are left
function preSchedule() {   // v25.4: called from timeupdate; fires preloadNext() at ~PRE_AT s left even if the background wakes us only every few seconds
  if (PRE.sched || PRE.busy || !(au.duration > 0) || !isFinite(au.duration)) return;
  const rem = au.duration - au.currentTime; if (rem > PRE_AT + 7 || rem <= 0) return;
  const my = PT; PRE.sched = setTimeout(() => { PRE.sched = 0; if (my === PT) preloadNext() }, Math.max(0, (rem - PRE_AT) * 1000));
}
const preKey = t => t && (ytId(t) || t.uri || '');
function preDrop() { try { PRE.ctl && PRE.ctl.abort() } catch (e) {} PRE.ctl = null; PRE.busy = ''; if (PRE.url) { try { URL.revokeObjectURL(PRE.url) } catch (e) {} } PRE.url = ''; PRE.key = '' }
function fullyLoaded() {
  try { if (au.src && au.src.startsWith('blob:')) return true; if (!(au.duration > 0) || !au.buffered.length) return false; return au.buffered.end(au.buffered.length - 1) >= au.duration - 1.5 } catch (e) { return false }
}
/* v24.8 background trickle: while the app is in the background (screen off / other app in front) the NEXT song is NOT downloaded in one big
   piece. It is fetched in small Range pieces (40 KB) with a short pause between them, so the player/CPU/disk are never busy for long.
   The pieces are joined into one memory copy; when the next song starts it begins at once. Server without Range support -> returns null (old way). */
const TR_CH = 10240, TR_MIN_GAP = 600, TR_MAX_GAP = 3000;   // v25.1: tiny 10 KB pieces (was 40 KB) - a 1 GB / 2 GB RAM, 1-core phone never feels it
async function trickleFetch(url, signal, stale) {
  const parts = []; let pos = 0, total = 0, type = 'audio/mp4';
  while (true) {
    if (signal.aborted || stale()) return null;
    const t0 = Date.now();
    const r = await fetch(url, { headers: { Range: 'bytes=' + pos + '-' + (pos + TR_CH - 1) }, credentials: NAT ? 'omit' : 'same-origin', signal });
    if (r.status !== 206) { try { r.body && r.body.cancel() } catch (e) {} return null }
    const m = /\/(\d+)\s*$/.exec(r.headers.get('Content-Range') || ''); if (!m) return null; total = +m[1];
    if (r.headers.get('Content-Type')) type = r.headers.get('Content-Type');
    const b = await r.blob(); if (!b.size) return null; parts.push(b); pos += b.size;
    if (pos >= total) break;
    if (total > CC_ONE) return null;
    /* v25.1: slow, even pace (foreground AND background): the pieces are spread over ~80 % of the time the current song has left,
       so the next song is ready before this one ends, and the phone only ever does a tiny bit of work at a time. */
    const left = (au.duration > 0 && isFinite(au.duration)) ? Math.max(5, au.duration - au.currentTime) : 150;
    const need = Math.max(1, Math.ceil((total - pos) / TR_CH));
    const gap = Math.max(TR_MIN_GAP, Math.min(TR_MAX_GAP, Math.floor(left * 800 / need) - (Date.now() - t0)));
    await new Promise(res => setTimeout(res, gap));
  }
  return new Blob(parts, { type });
}
/* v25.6 AUTO-DETECT. Looked up again before every piece, so the chunk size follows the phone and the network while the app runs:
     speed  = measured speed of the last downloads (netNote), else navigator.connection.downlink, else 400 KB/s
     memory = navigator.deviceMemory (RAM) and the JS heap (performance.memory); a busy / small phone gets smaller pieces and fewer writes
   ch   = piece size 10-100 KB (about 60 ms of data); head = bigger first piece (30-100 KB); lead = seconds the pieces run ahead of the song (1.5 / 2 / 4) */
let NETBPS = 0;
const netNote = (bytes, ms) => { if (bytes < 8000 || ms < 15) return; const v = bytes / ms * 1000; NETBPS = NETBPS ? NETBPS * .6 + v * .4 : v };
function adp() {
  const c = navigator.connection || {}, mem = +navigator.deviceMemory || 4;
  const bw = NETBPS || (c.downlink > 0 ? c.downlink * 125000 : 0) || 400000;
  const slow = bw < 190000 || !!c.saveData || /^(slow-2g|2g)$/.test(c.effectiveType || '');
  let ch = bw * .06, low = mem <= 1;
  ch *= mem <= 1 ? .5 : mem <= 2 ? .75 : mem >= 6 ? 1.5 : 1;
  try { const pm = performance.memory; if (pm && pm.jsHeapSizeLimit && pm.usedJSHeapSize / pm.jsHeapSizeLimit > .72) { ch *= .5; low = true } } catch (e) {}
  ch = Math.round(Math.max(32768, Math.min(102400, ch)) / 1024) * 1024;   // v25.7: pieces never smaller than 32 KB = fewer writes (less lag)
  return { ch, head: Math.min(102400, Math.max(65536, ch * 2)), lead: slow ? 4 : bw > 1250000 ? 1.5 : 2, slow, low, bw, max: (mem <= 2 ? 100 : mem <= 4 ? 150 : 250) * 1048576 };
}
const leftSec = n => S.cur === n ? 0 : ((au.duration > 0 && isFinite(au.duration)) ? Math.max(0, au.duration - au.currentTime) : 9999);
const sleepMs = ms => new Promise(r => setTimeout(r, ms));
/* The next song in small Range pieces, ONE request at a time (never parallel):
     1st piece = the head (also tells the size and 'wakes' the server / connection),
     then pieces of ch bytes; when little time is left before the current song ends the pieces grow (max 256 KB) so it is ready on time.
   While there is plenty of time (and the app is in front) it simply waits - nothing runs next to the song.
   A server without Range support answers 200 with the whole file: that is used as it is (the old way). */
async function rangeLoad(url, sig, live, n, early) {
  const o = { credentials: NAT ? 'omit' : 'same-origin', signal: sig };
  const parts = []; let pos = 0, total = 0, type = '', polls = 0;
  const cut = r => { try { r.body && r.body.cancel() } catch (e) {} };
  while (true) {
    if (!live()) return null;
    const A = adp(), first = pos === 0;
    if (!first) {   // v25.7: only 2 requests per song: the head, then ALL the rest in one open-ended request (started when the time is right)
      const eta = (total - pos) / Math.max(60000, NETBPS || A.bw), rem = leftSec(n);
      if (rem >= eta * 1.6 + 1.2 && !early && !document.hidden && ++polls < 40) { await sleepMs(250); continue }
    }
    const r = await fetch(url, { ...o, headers: { Range: 'bytes=' + pos + '-' + (first ? pos + A.head - 1 : '') } });
    const t0 = performance.now();
    if (r.status === 200 && first) { const b = await r.blob(); netNote(b.size, performance.now() - t0); return b }
    if (r.status !== 206) { cut(r); return null }
    const m = /bytes\s+(\d+)-\d+\/(\d+)\s*$/.exec(r.headers.get('Content-Range') || '');
    if (!m || +m[1] !== pos) { cut(r); return null }
    total = +m[2]; if (total > CC_ONE) { cut(r); return null }
    if (!type) type = r.headers.get('Content-Type') || 'audio/mp4';
    const b = await r.blob(); if (!b.size) return null;
    netNote(b.size, performance.now() - t0); parts.push(b); pos += b.size;
    if (pos >= total) break;
  }
  return new Blob(parts, { type });
}
async function preloadNext() {
  if (PRE.busy || mode() !== 'phone' || !S.cur || !navigator.onLine || document.hidden && au.paused) return;
  const c = navigator.connection; if (c && c.saveData) return;
  const n = S.queue[S.qi + 1]; if (!n) return;
  const key = preKey(n); if (!key || PRE.key === key || (ytId(n) && S.dl[ytId(n)])) return;
  /* v25.2: NOTHING during the song. v25.6: ~4 s before the end only the head + small pieces (see rangeLoad), not one big download. */
  { const rem = (au.duration > 0 && isFinite(au.duration)) ? au.duration - au.currentTime : 9999; if (PRE_EARLY !== PT && (rem > PRE_AT + 2 || !(au.currentTime >= 4))) return }
  const my = PT, early = PRE_EARLY === PT, ctl = new AbortController(); PRE.busy = key; PRE.ctl = ctl;
  /* still wanted: it is still the next song, OR it has just become the current one (the boundary came while its pieces were still coming - they are kept, not restarted) */
  const live = () => !ctl.signal.aborted && ((my === PT && S.queue[S.qi + 1] === n) || S.cur === n);
  try {
    const nu = streamUrl(n); let b = await ccGet(nu), net = false;   // v23.7: the saved chunks first
    if (!live()) throw 0;
    if (!b) { b = await rangeLoad(nu, ctl.signal, live, n, early); net = true }
    if (!live() || !b || b.size < 50000 || !/^(audio|video)\/|octet/.test(b.type || 'audio/')) throw 0;
    if (net) ccPut(nu, b);
    if (PRE.url) { try { URL.revokeObjectURL(PRE.url) } catch (e) {} }
    PRE.url = URL.createObjectURL(b); PRE.key = key;
  } catch (e) {} finally { if (PRE.ctl === ctl) { PRE.busy = ''; PRE.ctl = null } }
}

/* ── v23.1: Android 16 media controls ────────────────────────────────────────────────────────────────
   Android 16 shows our song in three places: the status-bar "1 device" output chip, the Quick Settings
   media card and the full media player card (cover + title + artist + progress + shuffle/like row).
   All three are driven by ONE MediaSession, so we keep it alive and always complete:
     • metadata (title / artist / album / artwork) re-published whenever the song changes,
     • playbackState kept in sync,
     • setPositionState() every second so the seek bar moves,
     • and a watchdog that re-publishes after the card was swiped away / the WebView was frozen.
   The OS only keeps the card while a session exists — this is why the old build sometimes "lost" it. */
function mediaMeta(t) {
  if (!('mediaSession' in navigator) || !t) return;
  const hi = fixUrl(artHi(t)), lo = fixUrl(art(t));
  const sizes = ['96x96', '256x256', '512x512'];
  const artwork = sizes.map(s => ({ src: lo, sizes: s, type: 'image/jpeg' }));
  if (hi && hi !== lo) artwork.push({ src: hi, sizes: '1280x720', type: 'image/jpeg' });
  try {
    navigator.mediaSession.metadata = new MediaMetadata({ title: t.title || 'Legacy Music', artist: t.author || 'Legacy Music', album: 'Legacy Music', artwork });
  } catch (e) { try { navigator.mediaSession.metadata = new MediaMetadata({ title: t.title || '', artist: t.author || '', album: 'Legacy Music' }) } catch (e2) {} }
}
/* one call that makes the whole OS card correct again (used on song change, on return to the app, and by the watchdog) */
function msSync(force) {
  if (!('mediaSession' in navigator)) return;
  const t = S.cur; if (!t) return;
  try {
    if (force || !navigator.mediaSession.metadata || navigator.mediaSession.metadata.title !== (t.title || '')) mediaMeta(t);
    const st = S.playing ? 'playing' : 'paused';
    if (navigator.mediaSession.playbackState !== st) navigator.mediaSession.playbackState = st;
  } catch (e) {}
  mpos(true);
}
let lastPS = 0;
function mpos(force) {
  if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
  const n = Date.now(); if (!force && n - lastPS < 1000) return; lastPS = n;
  if (!isFinite(au.duration) || au.duration <= 0) return;
  try { navigator.mediaSession.setPositionState({ duration: au.duration, position: Math.min(au.currentTime, au.duration), playbackRate: au.playbackRate || 1 }) } catch (e) {}
}
// FIX: startPhone now accepts `byUser` flag. When autoplay/skip-next triggers it, byUser=false so the song won't appear in Recently Played UI.
const HB = [];
/* v24.3: Spotify-like loading. The WHOLE song is fetched first (normally 1-2 s) and plays from the phone's memory, so the network, a game
   or the screen being off cannot make it stutter (a normal <audio> stream stops loading in the background = the stuttering).
   Very slow network (> LOAD_WAIT) -> it starts streaming at once and is swapped to the memory copy as soon as that is complete. */
const LOAD_WAIT = 3000, CURP = { my: 0, p: null, ctl: null };
/* v23.7: CHUNK CACHE (online only). Every song that is played is also kept on the phone in small pieces (10-100 KB chunks, size auto-detected since v25.6, Cache Storage).
   The next time the same song is played it is built from those pieces = it starts at once and needs (almost) no network - it can not stop or stutter.
   It is NOT a download: it is not shown in Downloads, it is not available offline (offline still plays only real downloads), and the oldest songs
   are removed by themselves when the cache is over CC_MAX. Writing is slow and in the background, and waits until the song is really playing. */
const CC_NAME = 'lm-chunks-v1', CC_IDX = 'lm-cc-idx', CC_ONE = 40 * 1024 * 1024;   // v25.6: piece size, lead and the cache size limit now come from adp() (auto-detected)
const ccKey = url => { try { const u = new URL(url, location.href), g = k => u.searchParams.get(k) || ''; return (g('v') ? 'v:' + g('v') : 'q:' + g('q')) + '|hq' + g('hq') + '|ds' + g('ds') } catch (e) { return '' } };
const ccIdx = () => { try { const o = JSON.parse(store.get(CC_IDX) || '{}'); return o && typeof o === 'object' ? o : {} } catch (e) { return {} } };
const ccSave = o => { try { store.set(CC_IDX, JSON.stringify(o)) } catch (e) {} };
const ccUrl = (key, i) => '/__lmc/' + encodeURIComponent(key) + '/' + i;
const ccBusy = new Set();
/* v25.5: the phone is busiest while the finger moves. Song pieces are written only when nothing was touched / scrolled for 0.7 s. */
let LASTMOVE = 0; ['touchmove', 'scroll', 'wheel'].forEach(n_ => addEventListener(n_, () => { LASTMOVE = Date.now() }, { passive: true, capture: true }));
const idleMove = async () => { for (let i = 0; i < 400 && Date.now() - LASTMOVE < 700 && !document.hidden; i++) await new Promise(r => setTimeout(r, 200)) };
async function ccDelete(cache, key, n) { for (let i = 0; i < n; i++) { try { await cache.delete(ccUrl(key, i)) } catch (e) {} } }
async function ccGet(url) {
  try {
    if (!window.caches) return null; const key = ccKey(url); if (!key) return null;
    const idx = ccIdx(), e = idx[key]; if (!e || !e.n) return null;
    const cache = await caches.open(CC_NAME), parts = [];
    for (let i0 = 0; i0 < e.n; i0 += 64) {   // v25.4: small chunks are read 64 at a time (fast start)
      const rs = await Promise.all(Array.from({ length: Math.min(64, e.n - i0) }, (_, j) => cache.match(ccUrl(key, i0 + j))));
      for (const r of rs) { if (!r) { delete idx[key]; ccSave(idx); ccDelete(cache, key, e.n); return null } parts.push(await r.blob()) }
    }
    const b = new Blob(parts, { type: e.type || 'audio/mp4' });
    if (b.size !== e.size) { delete idx[key]; ccSave(idx); ccDelete(cache, key, e.n); return null }
    e.t = Date.now(); idx[key] = e; ccSave(idx); return b;
  } catch (e) { return null }
}
async function ccPut(url, b) {
  try {
    if (!window.caches || !b || b.size < 50000 || b.size > CC_ONE) return;
    const c = navigator.connection; if (c && c.saveData) return;
    const key = ccKey(url); if (!key || ccBusy.has(key) || ccIdx()[key]) return; ccBusy.add(key);
    try {
      await idleForPlay(); await new Promise(r => setTimeout(r, 1500)); await idleMove();   // never fight the song that is starting
      const A0 = adp(), CH = A0.ch, cache = await caches.open(CC_NAME), n = Math.ceil(b.size / CH);
      let done = 0;
      try {
        /* v25.6: the pieces run just AHEAD of the song (lead 1.5-4 s, auto), like a video buffer - never the whole song at once and never together with the next song
           coming in. The first seconds of a song get a bigger first piece (head, 30+ KB), then only the minimum while it plays. Piece size and the number of
           writes per round follow the phone (RAM / JS heap) and the network. A piece is written only when the song that owns it is the one playing.
           The song was skipped / never played for ~40 s -> the half-saved song is removed (below). */
        const sleep = ms => new Promise(r => setTimeout(r, ms)), sk = () => S.cur && ccKey(streamUrl(S.cur)) === key && au.duration > 0 && isFinite(au.duration);
        let i = 0, away = 0, wait = 0, pre = 0;
        while (i < n) {
          await idleMove();
          if (!sk()) { if (++away > 80) throw 0; await sleep(500); continue }
          away = 0;
          if (PRE.busy && ++pre < 160) { await sleep(250); continue }   // the next song is coming in: no writing together with it
          const A = adp(), hid = document.hidden, bps = b.size / au.duration;
          const allowB = Math.min(b.size, (au.currentTime + A.lead + (hid ? 10 : 0)) * bps + (au.currentTime < 3 ? A.head : 0)), allow = Math.ceil(allowB / CH);
          if (i >= allow) { if (++wait > 1500) throw 0; await sleep(400); continue }
          wait = 0;
          const end = hid ? allow : Math.min(allow, i + (A.low ? 1 : 3));   // v25.7: in the background ONE write round per second
          for (; i < end; i++) { await cache.put(ccUrl(key, i), new Response(b.slice(i * CH, (i + 1) * CH))); done = i + 1 }
          await sleep(hid ? 1000 : A.low ? 140 : 60);
        }
      } catch (e) { await ccDelete(cache, key, done); return }   // write failed (storage full) -> remove the half-saved song
      const idx = ccIdx(); idx[key] = { n, size: b.size, type: b.type || 'audio/mp4', ch: CH, t: Date.now() };
      let tot = 0; for (const k in idx) tot += idx[k].size || 0;
      while (tot > A0.max) { const old = Object.keys(idx).filter(k => k !== key).sort((x, y) => (idx[x].t || 0) - (idx[y].t || 0))[0]; if (!old) break; tot -= idx[old].size || 0; await ccDelete(cache, old, idx[old].n); delete idx[old] }
      ccSave(idx);
    } finally { ccBusy.delete(key) }
  } catch (e) {}
}
window.lmClearChunkCache = async () => { try { await caches.delete(CC_NAME); ccSave({}); return true } catch (e) { return false } };
function fullFetch(url) {
  const ctl = new AbortController();
  const net = () => fetch(url, { credentials: NAT ? 'omit' : 'same-origin', signal: ctl.signal }).then(r => r.ok ? r.blob() : null)
    .then(b => (b && b.size >= 50000 && /^(audio|video)\/|octet/.test(b.type || 'audio/')) ? b : null).catch(() => null);
  const p = ccGet(url).then(hit => hit || net().then(b => { if (b) ccPut(url, b); return b }));   // v23.7: the saved chunks first, the network only if they are missing
  return { p, ctl };
}
function swapIn(b) {
  if (!b || !au.src || au.src.startsWith('blob:') || !S.cur) return;
  if (au.duration > 0 && au.duration - au.currentTime < 3) return;
  const pos = au.currentTime, old = blobUrl, u = URL.createObjectURL(b); blobUrl = u;
  const go = () => { au.removeEventListener('loadedmetadata', go); try { if (pos > 0.5) au.currentTime = pos } catch (e) {} if (!userPaused) au.play().catch(() => {}) };
  au.addEventListener('loadedmetadata', go); au.src = u; stallN = 0; clearTimeout(stallT);
  if (old && old !== u) setTimeout(() => { try { URL.revokeObjectURL(old) } catch (e) {} }, 4000);
}
   // v24.3: songs played before (so Previous works even when the queue was replaced)

/* v24.3: remember the song that was playing. After the app is closed and opened again it is shown (paused, at the same second) - it never starts by itself */
const SAVE_K = 'lm-last'; let lastSave = 0;
function saveLast(force) {
  if (!S.cur || mode() !== 'phone') return; const n = Date.now(); if (!force && n - lastSave < (document.hidden ? 20000 : 3000)) return; lastSave = n;
  try { const pos = au.readyState > 0 ? Math.floor(au.currentTime || 0) : (S.rp || 0); store.set(SAVE_K, JSON.stringify({ cur: S.cur, q: S.queue.slice(Math.max(0, S.qi), S.qi + 40), pos, hb: HB.slice(-30) })) } catch (e) {}
}
addEventListener('pagehide', () => saveLast(true));
document.addEventListener('visibilitychange', () => { if (document.hidden) saveLast(true) });
async function restoreLast() {
  if (S.cur || mode() !== 'phone') return;
  let d; try { d = JSON.parse(store.get(SAVE_K)) } catch (e) { return } if (!d || !d.cur) return;
  const q = (Array.isArray(d.q) ? d.q : []).map(nt).filter(x => x && x.title); const t = q[0] || nt(d.cur); if (!t || !t.title) return;
  S.queue = q.length ? q : [t]; S.qi = 0; S.cur = t; S.orig = null; userPaused = true; S.rp = +d.pos || 0;
  (Array.isArray(d.hb) ? d.hb : []).forEach(x => { try { HB.push(nt(x)) } catch (e) {} });
  const id = ytId(t); let src = '';
  if (id && S.dl[id]) { try { const r = await idbTx('songs', 'readonly', s => s.get(id)); if (r && r.blob) src = blobUrl = URL.createObjectURL(r.blob) } catch (e) {} }
  if (!src && navigator.onLine) src = streamUrl(t);
  if (src) { const go = () => { au.removeEventListener('loadedmetadata', go); try { if (S.rp > 1) au.currentTime = S.rp } catch (e) {} au.pause(); ui() }; au.addEventListener('loadedmetadata', go); au.src = src }
  mediaMeta(t); ui();
}
/* v24.4: playback has priority over downloads. While a song is starting (until it really plays, max 9 s) downloads wait,
   so they can no longer fight the song for the connection / the server. */
const PLAYGATE = { until: 0 };
const playGateOpen = ms => { PLAYGATE.until = Date.now() + ms };
const playGateClose = () => { PLAYGATE.until = 0 };
const idleForPlay = async () => { for (let i = 0; i < 40 && Date.now() < PLAYGATE.until; i++) await new Promise(r => setTimeout(r, 250)) };
/* v23.8: TAP = CHANGE. From the moment a song is chosen until its audio source is set (max 8 s), the OLD song's events (its stream breaking,
   its end, a stall timer from before the tap) are ignored. Before, such an event in that window started the old / the next song again
   (the queue wrapped round to the first song) and the song you tapped never came - "I click and the song does not change". */
/* v23.10: CHANGING SONG = the old song dims at once (320 ms, like the soft ending of a song) while the new one is already loading; the new
   song starts the moment the old one is quiet (no waiting for the dim first and the loading after it) and fades in. */
let FADE_END = 0;
let STARTING = 0, STARTING_T = 0;
const starting = () => STARTING && STARTING === PT && Date.now() - STARTING_T < 8000;
async function startPhone(byUser, back) {
  const t = S.queue[S.qi]; if (!t) return; userPaused = false;
  const my = ++PT; PRE_EARLY = HOLD_T ? my : 0; STARTING = my; STARTING_T = Date.now(); clearTimeout(stallT); clearTimeout(swT); clearTimeout(errT); clearTimeout(startWD); clearTimeout(resumeT);
  FADE_END = 0; if (!au.paused && !au.ended && au.getAttribute('src') && fadeM > .05) { FADE_END = Date.now() + 320; fadeTo(0, 320) }
  if (byUser) HB.length = 0;   // v24.3: a song you start yourself has nothing before it
  else if (!back && S.cur && S.cur !== t && (S.cur.uri || fb(S.cur)) !== (t.uri || fb(t))) { HB.push(S.cur); if (HB.length > 60) HB.shift() }
  S.cur = t; t._f = 0; t._bx = 0; warmed = '';
  const id = ytId(t); let src = '';
  if (id && S.dl[id]) { try { const r = await idbTx('songs', 'readonly', s => s.get(id)); if (r && r.blob) { if (blobUrl) URL.revokeObjectURL(blobUrl); src = blobUrl = URL.createObjectURL(r.blob) } } catch (e) {} }
  if (!src && id && S.dl[id]) { delete S.dl[id]; if (isPrem() && navigator.onLine) setTimeout(() => dlSong(t, true), 5000) }   // v24.3: the downloaded file is missing -> play it online and download it again by itself
  if (!src && PRE.busy && PRE.busy === preKey(t) && !PRE.url) { for (let i = 0; i < (byUser ? 24 : 40) && PRE.busy === preKey(t) && !PRE.url; i++) await new Promise(r => setTimeout(r, 125)); if (my !== PT) return }   // v25.4: its download is already running (started ~4 s before) - wait for it, no second download
  if (!src && PRE.url && PRE.key === preKey(t)) { if (blobUrl) { try { URL.revokeObjectURL(blobUrl) } catch (e) {} } src = blobUrl = PRE.url; PRE.url = ''; PRE.key = '' }
  else if (PRE.key !== preKey(t)) preDrop();
  if (my !== PT) return;
  if (!src && !navigator.onLine) { STARTING = 0; toast("You're offline. Only downloaded songs play."); ui(); return }
  let url = src || streamUrl(t);
  if (!src) playGateOpen(9000);
  try { CURP.ctl && CURP.ctl.abort() } catch (e) {} CURP.p = null; CURP.ctl = null;
  if (!src && mode() === 'phone' && !(navigator.connection && navigator.connection.saveData)) {
    if (!FADE_END || Date.now() >= FADE_END) { clearInterval(fadeIv); fadeIv = null; fadeSet(0, true) } mediaMeta(t); ui();      // the old song dims (v23.10: not cut), the new one is shown while it loads
    const full = fullFetch(url); CURP.my = my; CURP.p = full.p; CURP.ctl = full.ctl;
    const b = await Promise.race([full.p, new Promise(r => setTimeout(() => r(null), (byUser || HOLD_T) ? 700 : LOAD_WAIT))]);   // v23.9: a tapped song starts within ~0.7 s (instant when it is in the chunk cache); the memory copy is swapped in later
    if (my !== PT) return;
    if (b) { if (blobUrl) { try { URL.revokeObjectURL(blobUrl) } catch (e) {} } src = blobUrl = URL.createObjectURL(b); url = src }
    else full.p.then(bb => { if (bb && my === PT) swapIn(bb) });
  }
  if (NAT && EQ_OK === null) eqPrime(src ? streamUrl(t) : url);   // v24: never waits - the very first launch plays at once, the sound chain starts with the next song
  if (FADE_END && Date.now() < FADE_END) { await new Promise(r => setTimeout(r, FADE_END - Date.now())); if (my !== PT) return }   // v23.10: the old song is quiet before the new one starts
  FADE_END = 0; clearInterval(fadeIv); fadeIv = null; fadeSet(0, true); srcCors = au.crossOrigin === 'anonymous';
  { const mb = $('#mini-bar'); if (mb) { mb.style.transition = 'none'; mb.style.width = '0'; requestAnimationFrame(() => requestAnimationFrame(() => { mb.style.transition = '' })) } }
  STARTING = 0; stallN = 0; PFAIL.n = 0; clearTimeout(stallT); clearTimeout(errT); clearTimeout(startWD); au.src = url; eqApply(); playNow(); fadeTo(1, 550);
  startWD = setTimeout(() => { if (my === PT && !userPaused && !au.src.startsWith('blob:') && au.readyState < 3 && !au.error) recover('start') }, 10000);   // v24.5: nothing came in for 10 s -> load it again
  warmSoon();
  mediaMeta(t);
  // push to recently played — only when user explicitly chose this song
  rpPush('song', { title: t.title, author: t.author, uri: t.uri, thumbnail: art(t) }, !!byUser);
  const h = jget('lm-hist', []); h.unshift({ a: t.author, t: t.title }); store.set('lm-hist', JSON.stringify(h.slice(0, 30)));
  ui();
  saveLast(true); setTimeout(() => { if (my === PT) preloadNext() }, 800);   // the next song starts loading right away
  if (S.queue.length - S.qi <= 4) moreLikeThis();   // v24: always keep at least 4 songs ready in 'Up next'
}
let loadingMore = false, failRun = 0, lastMoreMs = 0;
// FIX: minimum gap between moreLikeThis calls (10 s) to prevent spam when the app fires it rapidly
const MORE_COOLDOWN_MS = 10000;
/* v23.6: a song that was told to play must never just sit there stopped.
   play() can be refused for a moment (audio focus busy, WebView not ready, another stream still closing).
   We try again by ourselves a few times; only if it still does not start, we say "Tap play" and wait for ONE tap. */
const WANT = { t: 0, n: 0 };
function playNow() {
  WANT.t = Date.now(); WANT.n = 0;
  const p = au.play();
  if (p && p.catch) p.catch(e => {
    if (e && e.name === 'AbortError') return;            // a newer song took over, nothing to do
    if (e && e.name !== 'NotAllowedError') return;       // a failed load is handled by the 'error' handler (retry, then next)
    [350, 900, 1800, 3200].forEach(ms => setTimeout(() => { if (!userPaused && au.paused && S.cur && !au.error) au.play().catch(() => {}) }, ms));
    setTimeout(() => {
      if (userPaused || !au.paused || !S.cur) return;
      toast('Tap play to start');
      const go = () => { if (!userPaused && au.paused) au.play().catch(() => {}) };
      document.addEventListener('touchstart', go, { once: true, capture: true }); document.addEventListener('click', go, { once: true, capture: true });
    }, 4000);
  });
}
/* v23.6 watchdog: for the first 30 s of every song, if it is not userPaused but the player is stopped, start it again (every 2 s, max 8 tries) */
setInterval(() => {
  if (document.hidden) return;   // v24.7: no wake-ups in the background
  if (!WANT.t || userPaused || !S.cur || mode() !== 'phone' || !au.paused || au.ended || !au.getAttribute('src')) return;
  const age = Date.now() - WANT.t; if (age < 2500 || age > 30000 || WANT.n >= 8 || au.error) return;
  WANT.n++; au.play().catch(() => {});
}, 2000);
au.addEventListener('playing', () => { WANT.n = 0; if (HOLD_T) { HOLD_T = 0; try { ui() } catch (e) {} } });
const streamUrlQ = t => withMt(U(`/api/app/stream?q=${encodeURIComponent(fb(t).slice(0, 150))}&av=${CV}&hq=${isPrem() ? 1 : 0}`));
// Keywords that signal lofi/cover/fan-made content
const FAKE_KWORDS = ['lofi', 'lo-fi', 'lo fi', 'slowed', 'slow +', 'slow and', 'reverb', 'nightcore', 'sped up', 'speed up', '8d audio', '8d', 'bass boosted', 'bassboosted', 'ai cover', '(ai)', '\u00a0(ai)', ' ai ', 'remake', 'recreat', 'cover by', ' cover)', '(cover', 'cover version', 'tribute', 'karaoke', 'instrumental', 'fan made', 'fan-made', 'mashup', 'mash-up', 'remix', 'status video', 'whatsapp status', 'shorts', 'reaction', 'reprise'];
function isFakeSong(t, ctx, loose) {
  const ctxLower = (ctx || '').toLowerCase();
  // If the user searched for lofi etc., allow those through
  if (FAKE_KWORDS.some(k => ctxLower.includes(k))) return false;
  // v24 (search only): "arijit singh cover", "kesariya slowed", "dj remix" -> the word the person typed is never held against the result
  if (loose && ctxLower && FAKE_KWORDS.some(k => { const w = k.replace(/[()+\u00a0]/g, ' ').trim().split(/\s+/)[0]; return w.length > 2 && new RegExp('\\b' + w + '\\b').test(ctxLower) })) return false;
  const title = (t.title || '').toLowerCase();
  return FAKE_KWORDS.some(k => title.includes(k));
}
// v23: one key per SONG (not per upload): "See You Again", "See You Again (Official Video)", "See You Again - Lyrics", a cover of it ... all share it
const NOISE = /\b(official|video|audio|lyrics?|lyrical|full|song|hd|4k|music|visuali[sz]er|remaster(ed)?|version|from|the movie|movie|original|soundtrack|ost|with|prod\.?|by)\b/g;
const songBase = t => String(t || '').toLowerCase().replace(/\(.*?\)|\[.*?\]|\{.*?\}/g, ' ').replace(/\b(ft|feat|featuring)\b.*$/g, ' ').replace(/[|·•].*$/, ' ').replace(NOISE, ' ')
  .replace(/[^a-z0-9\u0900-\u097f\u0a00-\u0a7f\u0600-\u06ff\s]/g, ' ').replace(/\s+/g, ' ').trim();
function isDupTitle(t, seen) {
  const tl = songBase(t.title); if (!tl) return false;
  for (const s of seen) { const sl = songBase(s); if (!sl) continue; if (tl === sl) return true; if (tl.length > 5 && sl.length > 5 && (sl.startsWith(tl + ' ') || tl.startsWith(sl + ' '))) return true }
  return false;
}
const PEN_WORDS = ['live', 'reaction', 'shorts?', 'status', 'full song', 'jukebox', 'unplugged', 'acoustic', 'piano', 'guitar', 'cover', 'tutorial', 'dj', 'dance', 'performance'];
function penRe(q) {
  const ql = String(q || '').toLowerCase(), keep = PEN_WORDS.filter(w => !new RegExp('\\b' + w + '\\b').test(ql));
  return keep.length ? new RegExp('\\b(' + keep.join('|') + ')\\b') : null;
}
// how "official" an upload looks: the artist's own / Topic / VEVO channel and an official title score high, copies score negative
function officialScore(t, q, arts) {
  const ti = String(t.title || '').toLowerCase(), au_ = String(t.author || '').toLowerCase(); let sc = 0;
  if (/(vevo|\s-\s*topic|official)\s*$/.test(au_)) sc += 50;
  if (/\bofficial\b/.test(ti)) sc += 28;
  if (isFakeSong(t, q, true)) sc -= 90;
  const pr = penRe(q); if (pr && pr.test(ti)) sc -= 35;   // v24: words the person typed (dj, guitar, cover, dance...) are NOT penalised
  const top = arts && arts[0] && String(arts[0].name || '').toLowerCase();
  if (top && (au_.includes(top) || top.includes(au_.replace(/\s*-\s*topic$/, '')) && au_.length > 2)) sc += 22;
  const first = ti.split(' - ')[0].trim(); if (first && au_ && (au_.includes(first) || first.includes(au_.replace(/\s*-\s*topic$/, '')))) sc += 6;
  return sc;
}
function rankSearch(list, q, arts) {
  const sc = list.map((x, i) => { const b = officialScore(x, q, arts); return { x, i, b, s: b - i * .4 } }), seenBase = new Set(), main = [], other = [];
  sc.sort((a, b) => b.s - a.s);
  for (const e of sc) {
    const k = songBase(e.x.title), dupe = k && seenBase.has(k + '|' + String(e.x.author || '').toLowerCase().replace(/\s*-\s*topic$/, ''));
    // v24: cut on the real score (the position in the list no longer pushes result #50+ down)
    if (e.b < -20 || dupe) other.push(e.x); else { main.push(e.x); if (k) seenBase.add(k + '|' + String(e.x.author || '').toLowerCase().replace(/\s*-\s*topic$/, '')) }
  }
  return { main, other };
}
const hideGet = () => jget('lm-hide', []), hideSong = t => { if (!t) return; const h = hideGet(); h.unshift(t.uri || fb(t)); store.set('lm-hide', JSON.stringify(h.slice(0, 300))); toast('Okay, we won\'t play this again') };
const oneEach = list => { const seen = new Set(), out = []; list.map((x, i) => ({ x, i, s: officialScore(x, '') - i * .4 })).sort((a, b) => b.s - a.s).forEach(e => { const k = songBase(e.x.title); if (k && seen.has(k)) return; seen.add(k); out.push(e) }); return out.sort((a, b) => a.i - b.i).map(e => e.x) };
async function moreLikeThis() {
  if (albOnly()) return false;   // v25.5: album mode - nothing from outside the album
  // FIX: cooldown to prevent autoplay from spamming the queue with unrelated/repeated songs
  const now = Date.now();
  if (loadingMore || !navigator.onLine || now - lastMoreMs < MORE_COOLDOWN_MS) return false;
  loadingMore = true; lastMoreMs = now;
  try {
    const t = S.cur || S.queue[S.qi] || {}; if (!t.title && !t.author) return false;
    const seen = new Set(S.queue.map(x => x.uri || fb(x)));
    const seenTitles = new Set(S.queue.map(x => x.title || '').concat(jget('lm-hist', []).map(h => h.t || '')).concat([t.title || '']));
    const ids = S.queue.map(x => ytId(x)).filter(Boolean).slice(-40).join(',');
    const keep = x => {
      if (seen.has(x.uri || fb(x))) return false;
      if (isFakeSong(x, t.title)) return false;
      if (hideGet().includes(x.uri || fb(x))) return false;
      if (isDupTitle(x, seenTitles)) return false;
      return true;
    };
    let fresh = [];
    try {   // same language + mood + vibe, like YouTube radio / the Discord bot's autoplay
      const d = await api('/api/app/related?' + new URLSearchParams({ v: ytId(t), title: t.title || '', author: t.author || '', ex: ids, limit: '14', av: CV }));
      fresh = oneEach(arr(d.songs).map(nt).filter(keep)).slice(0, 14);
    } catch (e) {}
    if (!fresh.length) {   // older server: search for the SONG itself (never for the trending / search page it was opened from)
      for (const qq of [`${t.title} ${t.author}`, `${t.author} songs`]) {
        if (!qq.trim()) continue;
        const d = await api('/api/music/search?query=' + encodeURIComponent(qq.trim()));
        fresh = oneEach(arr(d.songs).map(nt).filter(keep)).slice(0, 12);
        if (fresh.length) break;
      }
    }
    if (fresh.length) { S.queue.push(...fresh); if (S.orig) S.orig.push(...fresh); if (!$('#np-queue').hidden) queueList(); return true }
  } catch (e) {} finally { loadingMore = false }
  return false;
}
async function discordPlay(list, i) {
  try {
    const it = list.slice(i, i + 15);
    const r = it.length > 1
      ? await api('/api/me/play-many', { method: 'POST', body: { queries: it.map(q), fallbacks: it.map(fb), guild_id: S.gid } })
      : await api('/api/me/play', { method: 'POST', body: { query: q(it[0]), fallback: fb(it[0]), guild_id: S.gid } });
    S.gid = r.guild_id; toast('Added in ' + (r.guild_name || 'Discord') + ' voice channel'); poll();
  } catch (e) { toast(e.message) }
}
function playFrom(list, i, asQueue, whole) {
  list = list.map(nt); if (!list[i]) return;
  // FIX: byUser=true because the user tapped a song/playlist directly
  if (mode() === 'phone') { S.queue = asQueue ? list : [list[i]]; S.qi = asQueue ? i : 0; ALB_Q = (ALB_NEXT && asQueue) ? S.queue : null; ALB_NEXT = false; S.orig = null; S.shuf = false; startPhone(true); buzz() }
  else { ALB_NEXT = false; discordPlay(whole ? list : [list[i]], whole ? i : 0) }
}
async function ctl(a, body) { if (!S.gid) return toast('Join a voice channel in Discord first'); try { await api(`/api/guilds/${S.gid}/${a}`, { method: 'POST', body: body || undefined }); poll() } catch (e) { toast(e.message) } }
let userPaused = false, resumeT = null, skipFade = false;
const act = {
  toggle() { if (mode() === 'phone') { if (!S.cur) return; if (au.paused) { userPaused = false; if (!au.getAttribute('src') || au.error) startPhone(false); else au.play() } else { userPaused = true; au.pause() } } else ctl(S.playing ? 'pause' : 'resume') },
  async next(auto) {
    if (mode() !== 'phone') return ctl('skip');
    if (auto !== true) holdStart();
    if (auto === true && S.rep === 'one') { au.currentTime = 0; au.play(); return }
    // FIX: skip/next inside a queue is NOT a user song-selection — don't add to RP
    if (S.qi + 1 < S.queue.length) { S.qi++; startPhone(false) }
    else if (S.rep === 'all' && S.queue.length) { S.qi = 0; startPhone(false) }
    else if (S.auto && navigator.onLine && await moreLikeThis()) { S.qi++; startPhone(false) }
    else if (albOnly() && S.rep !== 'all') { userPaused = true; au.pause(); toast('Album finished') }
    else if (S.queue.length > 1) { S.qi = 0; startPhone(false) }
    else { userPaused = true; au.pause(); toast('End of queue') }
  },
  prev() {
    if (mode() !== 'phone') return ctl('previous');
    holdStart();
    const cu = S.cur ? (S.cur.uri || fb(S.cur)) : ''; let p = null;
    while (HB.length && !p) { const c = HB.pop(); if ((c.uri || fb(c)) !== cu) p = c }
    if (!p) { au.currentTime = 0; return }   // nothing was played before this song
    const pv = S.queue[S.qi - 1];
    if (pv && (pv.uri || fb(pv)) === (p.uri || fb(p))) S.qi--; else S.queue.splice(S.qi, 0, p);
    startPhone(false, true);
  },
};
au.addEventListener('play', () => { S.playing = true; if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing'; mpos(true); msSync(false); duckAuto(); ui() });
au.addEventListener('pause', () => {
  S.playing = false; if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'; mpos(true);
  /* v23.1: if Android took the audio focus away (a game / another player started) while we were in the background,
     remember it so the song continues as soon as we are back - instead of silently staying paused. */
  ui();
  /* v24.7: a phone call / a video / another app took the audio focus -> the song STAYS paused (no forced restart any more).
     The person starts it again himself with the play button. */
  if (!userPaused && S.cur && !au.ended && !au.error && mode() === 'phone' && !(au.duration && au.duration - au.currentTime < .4) && au.currentTime > .5 && !starting()) {
    clearTimeout(resumeT); userPaused = true; ui();
  }
});
au.addEventListener('loadedmetadata', () => { mpos(true); nativeSync(true) });
au.addEventListener('seeked', () => { mpos(true); nativeSync(true) });
au.addEventListener('ended', () => { if (starting()) return; act.next(true) });   // v23.8: the OLD song ending while a tapped song loads must not start another song
au.addEventListener('timeupdate', () => {
  if (!document.hidden) { ui(true); mpos() }   // v23.4: in the background the 5 s watchdog below keeps the OS card in sync
  saveLast();
  preSchedule();   // v25.4: next song = one download when ~4 s are left
  if (navigator.onLine && Date.now() - lastWarmChk > (document.hidden ? 15000 : 4000)) {   // v24.6 lag fix: background = checked every 15 s, and the next song is fetched only in the last 60 s of this one
    lastWarmChk = Date.now();
    if (document.hidden) { if (au.duration > 0 && au.duration - au.currentTime <= 30) warmAhead(); return }   // v25.4: background = only a tiny 'get ready' ping in the last 30 s
    if (S.queue.length - S.qi <= 4) moreLikeThis(); warmAhead()
  }
});

/* v23.1: Android 16 "Now Playing" pill + QS media card + full media card.
   1 s tick keeps the seek bar moving AND re-publishes the session if Android dropped it (card swiped away,
   WebView frozen in the background, "1 device" chip gone). This is what makes the card come back by itself. */
let tickN = 0;
(function tick() {   // v24.6 lag fix: 1 s in front, a real 5 s timer in the background (was a 1 s wake-up that skipped 4 of 5)
  try {
    if (S.cur && mode() === 'phone') { msSync(false); if (S.playing) { mpos(true); nativeSync() } }
  } catch (e) {}
  setTimeout(tick, document.hidden ? 5000 : 1000);
})();
/* coming back to the app (or unlocking the phone): rebuild the whole OS card for the song that is playing right now */
/* v23.3: waking the phone fired visibilitychange + pageshow + focus together = 3x "rebuild the media card + re-download the artwork"
   right while the song is playing (that was the lag on screen on/off). Now it is done once, a moment later. */
const msWake = () => { clearTimeout(msWake.t); msWake.t = setTimeout(() => { if (S.cur) msSync(true) }, 500) };
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  msWake();
});
window.addEventListener('pageshow', msWake);
window.addEventListener('focus', msWake);
const altQ = t => [fb(t)].filter(x => x.trim());   // v24.3: only the SAME song (its own id, then its exact title + artist) - never another upload or spelling
au.addEventListener('error', async () => {
  if (!au.src || starting()) return;   // v23.8: the OLD source breaking while a tapped song loads is not about the new song
  const ct = S.cur;
  if (au.src.startsWith('blob:')) {   // v24.3: a broken downloaded / preloaded file -> forget it, play the song online (and download it again)
    if (!ct || ct._bx || mode() !== 'phone') return; ct._bx = 1; const bid = ytId(ct);
    if (bid && S.dl[bid]) { try { await dlRemove(bid) } catch (e) {} if (isPrem() && navigator.onLine) setTimeout(() => dlSong(ct, true), 6000) }
    if (!navigator.onLine) return;
    stallN = 0; clearTimeout(stallT); au.src = streamUrl(ct); playNow(); return;
  }
  if (au.crossOrigin === 'anonymous' && !AX && !corsRetried) { corsRetried = true; EQ_OK = false; srcCors = false; store.set('lm-eq-cors', '0'); store.set('lm-eq-ts', String(Date.now())); au.removeAttribute('crossorigin'); const s0 = au.src; au.src = s0; au.load(); au.play().catch(() => {}); return }
  let st = 0; try { const pc = new AbortController(), r = await fetch(au.src, { headers: { Range: 'bytes=0-0' }, credentials: NAT ? 'omit' : 'same-origin', signal: pc.signal }); st = r.status; try { pc.abort() } catch (e) {} if (st === 426) return showUpdate({ update_required: true }) } catch (e) {}   // v23.6: the probe is closed at once - an open probe used up one of the server's stream slots
  /* v24.3: the file was not found -> find the same song again by itself: by name, then with other spellings, before giving up */
  if (ct) { const tries = ytId(ct) ? altQ(ct) : altQ(ct).slice(1); if ((ct._f || 0) < tries.length) { const qq = tries[ct._f++]; stallN = 0; clearTimeout(stallT); au.src = withMt(U(`/api/app/stream?q=${encodeURIComponent(qq.slice(0, 150))}&av=${CV}&hq=${isPrem() ? 1 : 0}`)); playNow(); return } }
  /* v24.5: a song that fails to LOAD (busy server, weak network, a download running) is tried again on the SAME song with growing waits
     (1.5 / 3 / 5 / 8 / 12 s). It never jumps to the next song because of that. Only a song that really does not exist any more (404 / 410)
     is skipped, and never more than 3 in a row. If all tries fail we stay on the song and wait for the person to tap play. */
  const gone = st === 404 || st === 410;
  if (st === 429 && ct && ct === S.cur) { preDrop(); try { CURP.ctl && CURP.ctl.abort() } catch (e) {} PFAIL.n = Math.min(PFAIL.n, 1) }   // v23.6: server says 'too many open' -> free our own extra streams first, then retry the same song
  if (!gone && ct && ct === S.cur) {
    if (!navigator.onLine) { userPaused = true; ui(); return }
    const wait = [1500, 3000, 5000, 8000, 12000][PFAIL.n++];
    if (wait) {
      clearTimeout(errT); const s0 = au.src, c0 = S.cur;
      errT = setTimeout(() => { if (S.cur !== c0 || userPaused || !navigator.onLine) return; stallN = 0; try { au.src = s0; au.load() } catch (e) {} playNow() }, wait);
      return;
    }
    PFAIL.n = 0; userPaused = true; ui(); toast("Couldn't load this song. Tap play to try again"); return;
  }
  if (++failRun >= 3) { failRun = 0; userPaused = true; ui(); return }
  setTimeout(() => act.next(), 400);
});

/* ───────── smooth playback: stall recovery ───────── */
let stallT = 0, stallN = 0, errT = 0, startWD = 0; const PFAIL = { n: 0 };
function recover(why) {
  if (starting() || !au.src || au.src.startsWith('blob:') || !navigator.onLine || stallN >= 3) return false;
  stallN++; const pos = au.currentTime || 0, src = au.src;
  try { au.src = src; au.load(); const go = () => { au.removeEventListener('loadedmetadata', go); if (pos > 1) au.currentTime = pos; au.play().catch(() => {}) }; au.addEventListener('loadedmetadata', go) } catch (e) { return false }
  return true;
}
au.preload = 'auto';
/* v24.3: if the song stutters (game / voice chat / weak network) the WHOLE song is loaded into the phone's memory and playback continues from there,
   so the network and the busy CPU can no longer interrupt it. Also done when the app goes to the background before the song is fully loaded. */
const SW = { busy: false }; let swT = 0;
async function smoothSwap() {
  if (SW.busy || !S.cur || mode() !== 'phone' || !navigator.onLine) return;
  const src = au.src; if (!src || src.startsWith('blob:')) return;
  const my = PT; SW.busy = true;
  try {
    let pr = CURP.my === my && CURP.p; if (!pr) { const f = fullFetch(src); CURP.my = my; CURP.p = pr = f.p; CURP.ctl = f.ctl }
    const b = await pr; if (b && my === PT && au.src === src) swapIn(b);
  } finally { SW.busy = false }
}
au.addEventListener('waiting', () => { clearTimeout(stallT); clearTimeout(swT); swT = setTimeout(() => { if (!au.paused && au.readyState < 3) smoothSwap() }, 1800); stallT = setTimeout(() => { if (!au.paused && au.readyState < 3) recover('stall') }, 6500) });
['playing', 'canplay', 'pause', 'emptied'].forEach(e => au.addEventListener(e, () => { clearTimeout(stallT); clearTimeout(swT) }));
const bufAhead = () => { try { return au.buffered.length ? au.buffered.end(au.buffered.length - 1) - au.currentTime : 0 } catch (e) { return 0 } };
document.addEventListener('visibilitychange', () => { if (document.hidden) setTimeout(() => { if (document.hidden && S.playing && !fullyLoaded() && bufAhead() < 6) smoothSwap() }, 1500) });   // v25.3: swapping the source ALWAYS makes a gap (and a background WebView can delay the restart), so it is done only when the buffer is almost empty (was < 20 s = swap right when you leave the app)
au.addEventListener('playing', () => { playGateClose(); failRun = 0; PFAIL.n = 0; clearTimeout(errT); clearTimeout(startWD); if (au.currentTime > 5) stallN = 0 });

/* v23.4: NO automatic resume. If a call, reel, video or another app takes the audio, the song stays paused until the user taps play. */

/* ───────── sound: gentle bass (everyone) + extra clarity (Premium) ───────── */
let AX = null, EQ_OK = null;
function eqCached() {
  if (EQ_OK !== null) return true;
  const c = store.get('lm-eq-cors'), fresh = Date.now() - (+store.get('lm-eq-ts') || 0) < 864e5;
  if (fresh && c === '0') { EQ_OK = false; return true }
  if (fresh && c === '1') { EQ_OK = true; au.crossOrigin = 'anonymous'; return true }
  return false;
}
function eqPrime(url) { if (!NAT || eqCached()) return; eqProbe(url).catch(() => {}) }
async function eqProbe(url) {
  if (EQ_OK !== null || !NAT) return;
  const c = store.get('lm-eq-cors'), fresh = Date.now() - (+store.get('lm-eq-ts') || 0) < 864e5;
  if (fresh && c === '0') { EQ_OK = false; return }
  if (fresh && c === '1') { EQ_OK = true; au.crossOrigin = 'anonymous'; return }
  let slow = false;
  try {
    const pc = new AbortController();
    const r = await Promise.race([fetch(url, { headers: { Range: 'bytes=0-1' }, signal: pc.signal }), new Promise((_, j) => setTimeout(() => { slow = true; try { pc.abort() } catch (e) {} j() }, 3500))]);
    EQ_OK = !!(r && (r.ok || r.status === 206)); try { r.body && r.body.cancel() } catch (e) {} try { pc.abort() } catch (e) {}
  } catch (e) { EQ_OK = false }
  if (!slow) { store.set('lm-eq-cors', EQ_OK ? '1' : '0'); store.set('lm-eq-ts', String(Date.now())) }   // a timeout is only for this session
  if (EQ_OK) au.crossOrigin = 'anonymous';
}
let fadeM = 1, srcCors = false, corsRetried = false;
const FADE_S = 2;   // v23.2: the last 2 seconds of every song fade out smoothly, then the next song starts
{ const na = document.getElementById('np-auto'); if (na) na.hidden = true }   // v24: autoplay is always on
const VOL_PLAIN = .5;   // used when the sound chain is not possible (no CORS / old WebView): at least a softer level
try { au.volume = VOL_PLAIN } catch (e) {}
/* v24 sound: "Spotify-like" = flat, smooth, loudness-controlled (their Normal level is quieter than raw files) - warm body, soft highs,
   a limiter so nothing is sharp. Bass boost OFF = natural bass. Bass boost ON = clear punchy kick (62 Hz thump + 105 Hz body). */
function eqApply() {
  if (!EQ_OK || !srcCors || (!AX && store.get('lm-bass') !== '1')) { try { au.volume = VOL_PLAIN * fadeM } catch (e) {} return }   // v23.2: plain <audio> by default = light on CPU/RAM, no audio-graph that can stall in the background   // the chain only for a song that was loaded with CORS on (else it would be silent)
  const on = store.get('lm-bass') === '1', pr = isPrem();
  try {
    if (!AX) {
      const C = window.AudioContext || window.webkitAudioContext; if (!C) { au.volume = VOL_PLAIN * fadeM; return }
      const ctx = new C({ latencyHint: 'playback' }), src = ctx.createMediaElementSource(au);
      const f = (type, hz, q) => { const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = hz; if (q) n.Q.value = q; return n };
      const hp = f('highpass', 28, .7), warm = f('lowshelf', 170), bass = f('lowshelf', 105), thump = f('peaking', 62, 1.1),
        mud = f('peaking', 280, 1), pres = f('peaking', 3400, .9), hi = f('highshelf', 8500);
      const lim = ctx.createDynamicsCompressor(); lim.threshold.value = -10; lim.knee.value = 18; lim.ratio.value = 4; lim.attack.value = .005; lim.release.value = .2;
      const out = ctx.createGain();
      [src, hp, warm, bass, thump, mud, pres, hi, lim, out, ctx.destination].reduce((a, b) => { a.connect(b); return b });
      AX = { ctx, warm, bass, thump, mud, pres, hi, out };
      ctx.onstatechange = () => { if (ctx.state === 'suspended' && !au.paused) ctx.resume().catch(() => {}) };
    }
    au.volume = 1;
    const t = AX.ctx.currentTime, set = (p, v) => p.setTargetAtTime(v, t, .06);
    set(AX.warm.gain, 2.2);                                   // deeper, warmer body
    set(AX.bass.gain, on ? (pr ? 5.5 : 5) : .6);              // bass boost: body
    set(AX.thump.gain, on ? (pr ? 6.5 : 6) : .4);             // bass boost: the "dhamak"
    set(AX.mud.gain, pr ? -1.2 : -.4);                        // cleaner low-mids
    set(AX.pres.gain, pr ? -2.6 : -3.2);                      // softer 3-4 kHz (less sharp / tikhi)
    set(AX.hi.gain, pr ? -2.6 : -3.6);                        // softer top end
    AX.base = on ? .42 : .52;
    set(AX.out.gain, AX.base * fadeM * duckM);                // overall lower level (bass boost adds energy, so a bit lower again)
    if (AX.ctx.state === 'suspended') AX.ctx.resume().catch(() => {});
  } catch (e) { try { au.volume = VOL_PLAIN * fadeM } catch (e2) {} }
}
/* ── v23.1 Auto volume (game mode) ──────────────────────────────────────────────────────────────────
   When a game (or any other app) comes to the front, our app goes to the background. Instead of stopping
   the music we simply "duck" it: the volume drops to 35 % so the game's sound stays on top and the song
   keeps playing quietly underneath. Come back and it rises to 100 % again. Toggle in You → Auto volume. */
let duckOn = store.get('lm-duck2') === '1';   // v23.2: OFF by default (new users). The user can turn it on in You -> Auto volume
let duckM = 1, focusPaused = false;
const DUCK_LEVEL = .35;
function applyGain(hard) {
  const m = fadeM * duckM;
  try {
    if (AX) { const g = AX.out.gain, v = (AX.base || .5) * m; if (hard) { g.cancelScheduledValues(0); g.value = v } else g.setTargetAtTime(v, AX.ctx.currentTime, .06) }
    else au.volume = VOL_PLAIN * m;
  } catch (e) {}
}
function fadeSet(m, hard) {
  if (m === fadeM && !hard) return; fadeM = m; applyGain(hard);
}
let fadeIv = null;
/* v23.2: smooth volume ramp (works for the plain <audio> path too, which has no gain node) */
function fadeTo(target, ms, done) {
  clearInterval(fadeIv); const from = fadeM, steps = Math.max(1, Math.round(ms / 40)); let n = 0;
  fadeIv = setInterval(() => {
    n++; const k = n / steps; fadeSet(from + (target - from) * (k * k * (3 - 2 * k)), true);
    if (n >= steps) { clearInterval(fadeIv); fadeIv = null; if (done) done() }
  }, 40);
}
function duckSet(m) { if (Math.abs(m - duckM) < .01) return; duckM = m; applyGain(false) }
function duckAuto() { duckSet((duckOn && document.hidden && S.playing) ? DUCK_LEVEL : 1) }
document.addEventListener('visibilitychange', () => {
  if (!duckOn) { duckSet(1); return }
  if (document.hidden) setTimeout(() => { if (document.hidden && S.playing) duckSet(DUCK_LEVEL) }, 350);   // small delay: a quick glance at a notification should not dip the sound
  else duckSet(1);
});
const fadeCheck = () => {   // fade-out like the end of a radio track
  if (document.hidden) { if (fadeM !== 1 && !fadeIv) fadeSet(1); return }   // v24.3: nothing to animate in the background: volume goes down smoothly during the last 4 s
  if (fadeIv || mode() !== 'phone' || !S.cur || au.paused || !(au.duration > 15)) return;
  const left = au.duration - au.currentTime;
  if (left <= FADE_S && left > .05 && S.rep !== 'one') fadeSet(Math.pow(left / FADE_S, 1.4));
  else if (fadeM !== 1) fadeSet(1);
};
(function fadeWatch() {   // v24.6 lag fix: 150 ms in front, 2 s in the background (was 6-7 wake-ups every second, always)
  try { fadeCheck() } catch (e) {}
  setTimeout(fadeWatch, document.hidden ? 2000 : 150);   // v23.2: small steps in front so the 2 s fade-out is smooth, not stair-like
})();   // v23.2: smaller steps so the 2 s fade-out is smooth, not stair-like
au.addEventListener('play', () => { if (AX && AX.ctx.state === 'suspended') AX.ctx.resume().catch(() => {}) });
document.addEventListener('visibilitychange', () => { if (AX && AX.ctx.state === 'suspended' && !au.paused) AX.ctx.resume().catch(() => {}) });
if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  [['play', () => { userPaused = false; au.play() }], ['pause', () => { userPaused = true; au.pause() }], ['stop', () => { userPaused = true; au.pause() }], ['nexttrack', () => act.next()], ['previoustrack', act.prev],
   ['seekbackward', d => { au.currentTime = Math.max(0, au.currentTime - (d.seekOffset || 10)) }], ['seekforward', d => { au.currentTime = Math.min(au.duration || 1e9, au.currentTime + (d.seekOffset || 10)) }],
   ['seekto', d => { au.currentTime = d.seekTime }]].forEach(([k, f]) => { try { ms.setActionHandler(k, f) } catch (e) {} });
}

let pt = null;
async function poll() {
  if (mode() !== 'discord') return;
  try {
    if (!S.gid) { const sv = arr((await api('/api/me/servers')).servers), s = sv.find(x => x.in_voice) || sv.find(x => x.playing); if (s) S.gid = s.id }
    if (!S.gid) return;
    const p = await api(`/api/guilds/${S.gid}/player`); S.pl = p;
    if (p.connected && p.current) { S.cur = nt(p.current); S.playing = !p.paused; S.pos = p.position; S.dur = p.current.duration }
    else if (mode() === 'discord') { S.cur = null; S.playing = false }
    ui();
  } catch (e) {}
}
setInterval(() => { if (document.visibilityState === 'visible' && mode() === 'discord') poll() }, 3000);

/* ───────── sleep timer ───────── */
let sleepT = null, sleepEnd = false;
function setSleep(min) {
  clearTimeout(sleepT); sleepEnd = false;
  if (min === 'end') { sleepEnd = true; toast('Will stop after this song') }
  else if (min) { sleepT = setTimeout(() => { userPaused = true; au.pause(); sleepT = null; ui(); toast('Sleep timer: music stopped') }, min * 60000); toast(`Music stops in ${min} min`) }
  else toast('Sleep timer off');
  closeSheet(); ui();
}

/* ───────── now-playing UI ───────── */
/* v23.4: a clean heart. Outline when not liked, solid fill when liked (no more "double" thumbs-up). */
const HEART = 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z',
  LK_OFF = `<path class="fl" d="${HEART}"/>`,
  LK_ON = `<path class="fl on" d="${HEART}"/>`;
let _pp = null, _mode = '', _tint = '';
function setLikeIcon(spin) {
  const b = $('#np-like'), i = $('#np-add-icon'); if (!b || !i) return; const on = !!(S.cur && S.liked[S.cur.uri]);
  b.classList.toggle('on', on); i.innerHTML = on ? LK_ON : LK_OFF;
  if (spin) { b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop') }
  nativeSync();
}
function tintFor(t) {          // cheap one-off: average colour of the cover -> background of Now Playing + mini player
  /* v23.0: the same colour also drives --accent / --accent2, so the install button (and other accents)
     take the colour of whatever song is playing and change with every song. */
  const fallback = () => { const h = [...String(t && (t.title || '') + (t.author || ''))].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
    document.documentElement.style.setProperty('--accent', `hsl(${h} 72% 56%)`);
    document.documentElement.style.setProperty('--accent2', `hsl(${(h + 42) % 360} 78% 52%)`); document.documentElement.style.setProperty('--np-prog', `hsl(${h} 40% 84%)`) };
  /* v23.0: turn the cover's average colour into a vivid hue (a plain average of a brown/grey photo looks muddy) */
  const vivid = (r, g, b) => {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0; if (d) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360 }
    const s = Math.max(0.62, Math.min(0.95, d ? d / (1 - Math.abs(mx + mn - 1)) : 0.7));
    return h;
  };
  const prog = v => document.documentElement.style.setProperty('--np-prog', v);   // v25.6: light tint of the cover colour for the progress line / dot
  const im = new Image(); im.crossOrigin = 'anonymous'; im.decoding = 'async';
  im.onload = () => { try { const c = document.createElement('canvas'); c.width = c.height = 1; const x = c.getContext('2d'); x.drawImage(im, 0, 0, 1, 1); const d = x.getImageData(0, 0, 1, 1).data;
    const m = Math.max(d[0], d[1], d[2], 1), k = Math.min(1, 150 / m); const col = `rgb(${d[0] * k | 0},${d[1] * k | 0},${d[2] * k | 0})`;
    document.documentElement.style.setProperty('--np-tint', col);
    const h = vivid(d[0], d[1], d[2]);
    { const mx = Math.max(d[0], d[1], d[2]), mn = Math.min(d[0], d[1], d[2]), sat = mx ? (mx - mn) / mx : 0; prog(`hsl(${h.toFixed(0)} ${Math.round(22 + 48 * Math.min(1, sat * 1.6))}% 82%)`) }
    document.documentElement.style.setProperty('--accent', `hsl(${h.toFixed(0)} 74% 54%)`);
    document.documentElement.style.setProperty('--accent2', `hsl(${((h + 38) % 360).toFixed(0)} 82% 48%)`) } catch (e) { fallback() } };
  im.onerror = () => { document.documentElement.style.setProperty('--np-tint', '#3a3550'); fallback(); prog('#fff') };
  im.src = art(t);
}
{ const st = document.createElement('style'); st.id = 'lm-prog-css';   // v25.6: progress line (played part) + dot in Now Playing, and the mini bar, in a light tint of the cover colour
  st.textContent = '#np-seek::-webkit-slider-runnable-track{background:linear-gradient(to right,var(--np-prog,#fff) 0,var(--np-prog,#fff) var(--p,0%),rgba(255,255,255,.3) var(--p,0%),rgba(255,255,255,.3) 100%)!important}'
    + '#np-seek::-webkit-slider-thumb{background:var(--np-prog,#fff)!important;box-shadow:0 0 8px var(--np-prog,#fff)}'
    + '#mini .bar i{background:var(--np-prog,#fff)!important}'
    + '#mini .bar #mini-bar::after{background:var(--np-prog,#fff)!important;box-shadow:0 0 8px var(--np-prog,#fff)!important}';
  document.head.appendChild(st) }
function ui(light) {
  const phone = mode() === 'phone', t = S.cur;
  const pl = !!S.playing; if (document.body.classList.contains('playing') !== pl) document.body.classList.toggle('playing', pl);
  nativeSync();
  $('#mini').hidden = !t; if (!t) { $('#np').hidden = true; PAN.open = false; $('#np-pan').classList.remove('on'); lyvHide(); return }
  /* v23.4: keep the mini player (cover / title / like) correct even while the phone is locked or another app is in front.
     Before, we bailed out here, so on many phones the top player looked "empty" or did not refresh until a full wake. */
  const mkey = t.title + '|' + t.author;
  if ($('#mini-t').dataset.k !== mkey && !holdUi()) {
    $('#mini-t').dataset.k = mkey;
    $('#mini-t').textContent = t.title; $('#mini-s').textContent = t.author;
    $('#mini-art').src = art(t); if (!document.hidden) $('#np-art').src = artHi(t);   // v23.4: big cover is for the Now Playing screen only
    $('#np-t').textContent = t.title; $('#np-s').textContent = t.author;
    setLikeIcon(false); if (!document.hidden) { tintFor(t); lyricsLoad(t); artistCard(t); HEAVYK = mkey } miniLike(); panHead(); PAN.rel = ''; if (PAN.open && PAN.tab === 'rel') relLoad();
    if (!light && !document.hidden) document.querySelectorAll('.row.on').forEach(r => r.classList.remove('on'));
  }
  /* v23.4: a song changed while the app was in the background (game / screen off): the big cover, cover colour, lyrics and artist card
     (image decoding + network) were skipped to keep the phone free. They are prepared here, the moment the app is visible again. */
  if (!document.hidden && HEAVYK !== mkey && !holdUi()) { HEAVYK = mkey; $('#np-art').src = artHi(t); tintFor(t); lyricsLoad(t); artistCard(t) }
  if (_pp !== pl) { _pp = pl; const pp = pl ? PAUSE : PLAY; $('#mini-pp').innerHTML = pp; $('#np-pp').innerHTML = pp; $('#pan-pp').innerHTML = pp }
  if (document.hidden) { nativeSync(); return }      // v23: no heavy screen work while the phone is locked (one full refresh runs the moment it wakes up) -> no lag
  const pos = phone ? au.currentTime * 1000 : S.pos, dur = phone ? ((isFinite(au.duration) && au.duration > 0) ? au.duration * 1000 : t.duration) : S.dur;
  $('#mini-bar').style.width = dur ? Math.min(100, pos / dur * 100) + '%' : '0';
  if (!$('#np').hidden) {
    const id = ytId(t);
    carSet();
    $('#np-cur').textContent = fmt(pos); $('#np-dur').textContent = fmt(dur);
    if (!seeking) { const f_ = dur ? Math.min(1, pos / dur) : 0; $('#np-seek').value = f_ * 1000; $('#np-seek').style.setProperty('--p', (f_ * 100).toFixed(2) + '%') }
    $('#np-shuf').classList.toggle('on', S.shuf); $('#np-rep').classList.toggle('on', S.rep !== 'off'); $('#np-rep').classList.toggle('one', S.rep === 'one');
    $('#np-sleep').classList.toggle('on', !!sleepT || sleepEnd); $('#np-dl').classList.toggle('on', !!(id && S.dl[id])); npDlPaint(id);
    lyricsTick(pos);
    if (!light && PAN.open && PAN.tab === 'up') queueList();
  }
}
function miniLike() { const b = $('#mini-like'); if (!b || !S.cur) return; const on = !!S.liked[S.cur.uri]; b.innerHTML = `<svg viewBox="0 0 24 24">${on ? LK_ON : LK_OFF}</svg>`; b.classList.toggle('on', on) }
const npArt = $('#np-art'); npArt.addEventListener('error', () => { if (S.cur && npArt.src !== art(S.cur)) npArt.src = art(S.cur) });
{ const s_ = $('#np-s'); if (s_) { s_.classList.add('lm-art'); s_.addEventListener('click', e => { const t = S.cur; if (!t || !t.author) return; e.stopPropagation(); const nm = t.author.split(/\s*(?:,|&|\sx\s|\sft\.?\s|\sfeat\.?\s)\s*/i)[0].trim(); if (!nm) return; closeNP(); setTimeout(() => { location.hash = '#artist/' + encodeURIComponent(nm) }, 150) }) } }   // v25.5: tap the artist name = artist page (Follow button there)
let seeking = false; const sk = $('#np-seek');
sk.addEventListener('input', () => { seeking = true; sk.style.setProperty('--p', (sk.value / 10).toFixed(2) + '%') });
sk.addEventListener('change', () => {
  seeking = false; const f = sk.value / 1000;
  if (mode() === 'phone') { if (isFinite(au.duration)) au.currentTime = au.duration * f } else if (S.dur) ctl('seek', { position_ms: Math.floor(S.dur * f) });
});
function queueList() {
  const box = $('#pan-up'); if (!box || QD.on) return;
  const phone = mode() === 'phone';
  const items = phone ? S.queue.map((t, i) => ({ ...t, i, on: i === S.qi })) : ((S.pl && S.pl.queue) || []).map((t, i) => ({ title: t.title, author: t.author, thumbnail: t.thumbnail, i, on: false }));
  const cur = items.find(x => x.on), rest = items.filter(x => !x.on && (!phone || x.i > S.qi)), played = phone ? items.filter(x => x.i < S.qi) : [];
  box.innerHTML = `<div class="pf"><small>Playing from</small><b>${esc(S.ctxName || S.ctx || (phone ? 'Legacy Mix' : 'Discord queue'))}</b></div>`
    + (played.length ? `<button class="pl-hist" data-a="q-hist">${PAN.hist ? 'Hide' : 'Show'} earlier songs (${played.length})</button>` : '')
    + (PAN.hist ? played.map(qRow).join('') : '') + (cur ? qRow(cur) : '')
    + (rest.length ? rest.map(qRow).join('') : '<div class="empty">Queue is empty</div>');
}
const qRow = t => `<div class="qr${t.on ? ' on' : ''}" data-a="jump" data-i="${t.i}"><span class="th" style="${bgi(art(t))}">${t.on ? eqHtml : ''}</span><span class="tx"><span class="t">${esc(t.title)}</span><span class="s">${esc(t.author)}${t.duration ? ' • ' + fmt(t.duration) : ''}</span></span>${mode() === 'phone' && !t.on ? `<span class="ib" role="button" data-a="q-rm" data-i="${t.i}" aria-label="Remove"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></span>` : ''}</div>`;
/* v24: hold a song in "Up next" (about half a second) and drag it up or down; let go to drop it there */
const QD = { on: false };
(function () {
  let row = null, from = -1, y0 = 0, timer = 0, rows = [], swallow = false;
  const stop = () => { clearTimeout(timer); timer = 0 };
  function finish(drop) {
    stop(); if (!row) return; const was = QD.on;
    let to = -1;
    if (was && drop) { const r = row.getBoundingClientRect(), cy = r.top + r.height / 2, over = rows.find(x => { if (x === row) return false; const b = x.getBoundingClientRect(); return cy >= b.top && cy <= b.bottom }); if (over) to = +over.dataset.i }
    row.classList.remove('qdrag'); row.style.transform = ''; rows.forEach(x => x.classList.remove('qd-over'));
    QD.on = false; row = null; rows = [];
    if (was) { swallow = true; setTimeout(() => { swallow = false }, 450) }
    if (to >= 0 && to !== from && from >= 0 && from < S.queue.length && to < S.queue.length) {
      const curT = S.queue[S.qi], [m] = S.queue.splice(from, 1); S.queue.splice(to, 0, m); S.qi = Math.max(0, S.queue.indexOf(curT));
      buzz(10); warmSoon(); queueList();
    } else if (was) queueList();
  }
  document.addEventListener('pointerdown', e => {
    const r = e.target.closest && e.target.closest('#pan-up .qr'); if (!r || mode() !== 'phone' || r.classList.contains('on') || e.target.closest('[data-a="q-rm"]')) return;
    row = r; from = +r.dataset.i; y0 = e.clientY; stop();
    timer = setTimeout(() => { if (!row) return; QD.on = true; rows = Array.from($('#pan-up').querySelectorAll('.qr')); row.classList.add('qdrag'); buzz(14); try { row.setPointerCapture(e.pointerId) } catch (x) {} }, 420);
  });
  document.addEventListener('pointermove', e => {
    if (!row) return;
    if (!QD.on) { if (Math.abs(e.clientY - y0) > 9) { stop(); row = null } return }   // finger moved before the hold finished = normal scrolling
    row.style.transform = `translateY(${e.clientY - y0}px)`;
    const r = row.getBoundingClientRect(), cy = r.top + r.height / 2;
    rows.forEach(x => { if (x !== row) x.classList.toggle('qd-over', (() => { const b = x.getBoundingClientRect(); return cy >= b.top && cy <= b.bottom })()) });
  });
  document.addEventListener('pointerup', () => finish(true));
  document.addEventListener('pointercancel', () => finish(false));
  document.addEventListener('touchmove', e => { if (QD.on && e.cancelable) e.preventDefault() }, { passive: false });
  document.addEventListener('click', e => { if (swallow) { e.stopPropagation(); e.preventDefault(); swallow = false } }, true);
})();
function openNP() { if (!S.cur) return; const n = $('#np'); n.classList.remove('closing'); n.hidden = false; try { history.pushState({ np: 1 }, '') } catch (e) {} carKey = ''; ui() }
function npHide() {
  const n = $('#np'); if (n.hidden || n.classList.contains('closing')) return;
  if (PAN.open) panHide();
  n.classList.add('closing'); setTimeout(() => { n.hidden = true; n.classList.remove('closing') }, 420);
}
function closeNP() { const st = history.state || {}; if (st.pan) history.go(-2); else if (st.np) history.back(); else npHide() }
addEventListener('popstate', () => { const st = history.state || {}; if (PAN.open && !st.pan) panHide(); if (!$('#np').hidden && !st.np) npHide() });
let ty = 0, tx0 = 0; $('#np').addEventListener('touchstart', e => { ty = e.touches[0].clientY; tx0 = e.touches[0].clientX }, { passive: true });
/* v24.1: the player only closes when you pull DOWN from the top bar / chevron - not from anywhere on the screen */
$('#np').addEventListener('touchend', e => { const top = e.target.closest('.np-top'); if (!top || e.target.closest('[data-a="np-menu"]')) return; if (e.changedTouches[0].clientY - ty > 60 && Math.abs(e.changedTouches[0].clientX - tx0) < 70 && !PAN.open) closeNP() }, { passive: true });

/* ───────── pieces ───────── */
const eqHtml = '<span class="eqb"><i></i><i></i><i></i></span>';
const rowHtml = (t, attrs, on, extra = '') => { const id = ytId(t); return `<button class="row${on ? ' on' : ''}" ${attrs}><span class="th" style="${bgi(art(t))}"></span><span class="tx"><span class="t">${on ? eqHtml : ''}${esc(t.title)}${id ? `<span class="dl-slot" data-dlid="${id}">${dlMark(id)}</span>` : ''}</span><span class="s">${esc(t.author)}</span></span>${extra}</button>` };
/* v23.2: every song gets a visible "+" — tap it and you get: Add to Liked, then your playlists,
   then "New playlist". Works from any list (search, home, playlist, queue, player). */
const songRow = (name, i, t, extra = '') => rowHtml(t, `data-a="play" data-l="${name}" data-i="${i}"`, S.cur && S.cur.uri && S.cur.uri === t.uri, `<span class="d">${t.duration ? fmt(t.duration) : ''}</span>${extra}`);
const moreBtn = (name, i) => `<span class="ib more" role="button" data-a="more" data-l="${name}" data-i="${i}" aria-label="More"><svg viewBox="0 0 24 24" style="fill:currentColor;stroke:none"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg></span>`;
const songCards = (name, list) => `<div class="cards">${list.map((t, i) => `<button class="card" data-a="play" data-l="${name}" data-i="${i}"><span class="cv" style="${bgi(art(t))}"></span><span class="t">${esc(t.title)}</span><span class="s">${esc(t.author)}</span></button>`).join('')}</div>`;
const plCards = (list, tag) => `<div class="cards">${list.map(p => `<button class="card" data-a="open-pl" data-code="${esc(p.code)}"><span class="cv" data-plcode="${plc(p.code)}" style="${bgi(fixUrl(p.cover_image_url) || '/static/pwa/icon-512.png')}">${tag && p._src ? `<i class="src ${p._src === 'App' ? 'app' : ''}">${p._src}</i>` : ''}${p.collab ? '<i class="src collab">Collab</i>' : ''}${ptkImg(p)}<b><svg viewBox="0 0 24 24">${PLAY}</svg></b></span><span class="t">${esc(p.name)}</span><span class="s">${p.owner_name ? esc(p.owner_name) + ' · ' : ''}${p.track_count || 0} songs</span></button>`).join('')}</div>`;
const skel = n => '<div class="sk"></div>'.repeat(n);
/* Sheets own a history entry, so the phone's back button closes the sheet instead of leaving the page.
   closeSheet() pops that entry (async) - run anything that navigates afterwards through afterSheet(). */
let skipPop = 0, afterPop = [];

/* ── v24.1: own dialogs / photo picker / cropper (the Android WebView ignores confirm() = Delete did nothing) ── */
function askYes(msg, yes) {
  return new Promise(res => {
    const w = document.createElement('div'); w.className = 'ask-wrap';
    w.innerHTML = `<div class="ask-box"><p>${esc(msg)}</p><div class="actions"><button class="btn bad" data-y>${esc(yes || 'Yes')}</button><button class="btn ghost" data-n>Cancel</button></div></div>`;
    const done = v => { w.remove(); res(v) };
    w.querySelector('[data-y]').onclick = () => done(true); w.querySelector('[data-n]').onclick = () => done(false);
    w.addEventListener('click', e => { if (e.target === w) done(false) });
    document.body.appendChild(w);
  });
}
function noPickerSheet() {
  sheet(`<h3>Photo picker not available</h3><p class="sub">This app version cannot open your gallery yet. Open Legacy Music in your phone browser (same account) to upload photos.</p>
    <div class="actions"><button class="btn" data-a="open-web">Open in browser</button><button class="btn ghost" data-a="close-sheet">Close</button></div>`);
}
function pickFile(inp) {   // opens the gallery; inside the APK, if nothing opened (old APK without a file chooser) tell the user what to do
  let opened = false; const mark = () => { opened = true };
  window.addEventListener('blur', mark, { once: true }); document.addEventListener('visibilitychange', mark, { once: true });
  inp.click();
  const hasPicker = !!(bridge && typeof bridge.announce === 'function');   // new APK (v23.2+) has the native gallery picker
  if (NAT && !hasPicker) setTimeout(() => { window.removeEventListener('blur', mark); document.removeEventListener('visibilitychange', mark); if (!opened && !document.hidden) noPickerSheet() }, 2200);
}
const dataBlob = d => { const b = atob(d.split(',')[1]), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return new Blob([u], { type: 'image/jpeg' }) };
/* photo adjuster: drag to move, pinch / slider / mouse wheel to zoom, rotate. Returns a JPEG data-uri (or null if cancelled) */
function cropImage(file, aw, ah, ow, oh, round) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onerror = () => { URL.revokeObjectURL(url); toast('That file is not a picture'); resolve(null) };
    img.onload = () => {
      const SW = Math.min(window.innerWidth - 44, 340), SH = Math.round(SW * ah / aw);
      const w = document.createElement('div'); w.className = 'cr-wrap';
      w.innerHTML = `<div class="cr-box"><h3>Adjust photo</h3><p class="sub">Drag to move · pinch or use the slider to zoom</p>
        <div class="cr-stage${round ? ' round' : ''}" style="width:${SW}px;height:${SH}px"><canvas width="${SW * 2}" height="${SH * 2}" style="width:${SW}px;height:${SH}px"></canvas></div>
        <div class="cr-zoom"><span>−</span><input type="range" min="1" max="4" step="0.01" value="1" aria-label="Zoom"><span>+</span></div>
        <div class="cr-row"><button class="btn sm ghost" data-rot type="button">↻ Rotate</button><button class="btn sm ghost" data-rst type="button">Reset</button></div>
        <div class="actions"><button class="btn" data-ok type="button">Done</button><button class="btn ghost" data-no type="button">Cancel</button></div></div>`;
      document.body.appendChild(w);
      const cv = w.querySelector('canvas'), ctx = cv.getContext('2d'), st = w.querySelector('.cr-stage'), rg = w.querySelector('input[type=range]');
      let rot = 0, z = 1, cx = 0, cy = 0;
      const dims = () => { const sw = rot % 2 ? img.naturalHeight : img.naturalWidth, sh = rot % 2 ? img.naturalWidth : img.naturalHeight, base = Math.max(SW / sw, SH / sh); return { base, dw: sw * base * z, dh: sh * base * z } };
      const clamp = () => { const d = dims(), mx = Math.max(0, (d.dw - SW) / 2), my = Math.max(0, (d.dh - SH) / 2); cx = Math.max(-mx, Math.min(mx, cx)); cy = Math.max(-my, Math.min(my, cy)) };
      const draw = (c, W, H) => { const k = W / SW, d = dims(); c.fillStyle = '#000'; c.fillRect(0, 0, W, H); c.save(); c.translate(W / 2 + cx * k, H / 2 + cy * k); c.rotate(rot * Math.PI / 2); c.scale(d.base * z * k, d.base * z * k); c.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2); c.restore() };
      const paint = () => { clamp(); draw(ctx, cv.width, cv.height); rg.value = z };
      const ptr = new Map(); let last = 0;
      st.addEventListener('pointerdown', e => { st.setPointerCapture(e.pointerId); ptr.set(e.pointerId, [e.clientX, e.clientY]); last = 0 });
      st.addEventListener('pointermove', e => {
        if (!ptr.has(e.pointerId)) return; const o = ptr.get(e.pointerId); ptr.set(e.pointerId, [e.clientX, e.clientY]);
        if (ptr.size === 1) { cx += e.clientX - o[0]; cy += e.clientY - o[1] }
        else if (ptr.size === 2) { const [a, b] = [...ptr.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (last) z = Math.max(1, Math.min(4, z * d / last)); last = d }
        paint();
      });
      const up = e => { ptr.delete(e.pointerId); last = 0 }; st.addEventListener('pointerup', up); st.addEventListener('pointercancel', up);
      st.addEventListener('wheel', e => { e.preventDefault(); z = Math.max(1, Math.min(4, z * (e.deltaY < 0 ? 1.06 : 0.94))); paint() }, { passive: false });
      rg.addEventListener('input', () => { z = +rg.value; paint() });
      w.querySelector('[data-rot]').onclick = () => { rot = (rot + 1) % 4; cx = cy = 0; paint() };
      w.querySelector('[data-rst]').onclick = () => { rot = 0; z = 1; cx = cy = 0; paint() };
      const end = v => { URL.revokeObjectURL(url); w.remove(); resolve(v) };
      w.querySelector('[data-no]').onclick = () => end(null);
      w.querySelector('[data-ok]').onclick = () => { const o = document.createElement('canvas'); o.width = ow; o.height = oh; draw(o.getContext('2d'), ow, oh); end(o.toDataURL('image/jpeg', .86)) };
      paint();
    };
    img.src = url;
  });
}
function sheet(html) {
  $('#sheet-box').innerHTML = html; $('#sheet').hidden = false;
  if (!(history.state && history.state.sh)) { try { history.pushState({ sh: 1 }, '') } catch (e) {} }
}
function closeSheet() {
  if ($('#sheet').hidden) return;
  try { const g = $('#sheet').cloneNode(true); g.id = 'sheet-ghost'; g.hidden = false; g.classList.add('closing'); g.querySelectorAll('[id]').forEach(n => n.removeAttribute('id')); document.body.appendChild(g); setTimeout(() => g.remove(), 420) } catch (e) {}
  $('#sheet').hidden = true;
  if (history.state && history.state.sh) { skipPop++; history.back() }
}
const afterSheet = fn => { if (skipPop > 0) afterPop.push(fn); else fn() };
addEventListener('popstate', () => {
  const fns = afterPop.splice(0);
  if (skipPop > 0) { skipPop--; if (!$('#sheet').hidden) { try { history.pushState({ sh: 1 }, '') } catch (e) {} } }   // a new sheet opened right after closing: give it its own entry
  else if (!$('#sheet').hidden && !(history.state && history.state.sh)) $('#sheet').hidden = true;                       // hardware back pressed
  fns.forEach(f => f());
});
const roleName = r => ({ owner: 'Owner', admin: 'Admin', premium: 'Premium' }[r] || 'Free');
const isPrem = () => ['owner', 'admin', 'premium'].includes(S.cfg.role);
const sw = on => `<span class="sw${on ? ' on' : ''}"></span>`;

function premiumSheet(why) {
  sheet(`<h3>${ic('crown', 'gold')} Premium feature</h3><p class="sub">${esc(why)}</p><ul class="perks"><li>Create & edit your own playlists</li><li>Collaborative playlists with friends</li><li>Download songs and listen offline</li><li>Lock playlists, add covers & banners</li><li>Unlimited liked songs</li><li>Premium tick next to your name</li></ul>
  <div class="actions"><a class="btn" href="/premium">Get Premium</a><button class="btn ghost" data-a="close-sheet">Not now</button></div>`);
}

/* ───────── premium expiry → playlists go private ───────── */
// When premium expires, the server already enforces it, but we surface a soft notice.
function checkPremiumExpiry() {
  if (!isPrem() || S.offline) return;
  api('/api/premium/status').then(s => {
    const e = s.player_premium;
    if (!e || !e.active) {
      // premium lapsed: remind user playlists are now private
      toast('⚠️ Your Premium expired. Your public playlists are now private.');
    } else if (e.expires_at) {
      const ms = (e.expires_at * (e.expires_at < 1e12 ? 1000 : 1)) - Date.now();
      if (ms > 0 && ms < 3 * 24 * 60 * 60 * 1000) toast(`⚠️ Premium expires in ${Math.ceil(ms / 86400000)} day(s). Playlists will go private.`);
    }
  }).catch(() => {});
}

/* ───────── update system ───────── */
let updShown = '', autoTried = '';
const updBanner = v => `<div><b>Update available${v.version ? ' · v' + esc(v.version) : ''}</b><small>${v.notes ? esc(v.notes) : 'A new version is ready.'}</small></div><button class="btn" data-a="do-update">Update</button>`;
function showUpdate(v, must) {
  must = must || v.update_required; const u = $('#upd'), key = must ? 'must' : (v.version || 'new');
  if (updShown === 'must' || updShown === key) return; updShown = key;
  S.upd = v;
  const notes = v.notes ? esc(v.notes) : 'A new version is ready.';
  // announcement: the owner approved a new APK, so this (older) version has been replaced. Shown once full-screen, then it stays as the top banner.
  const ann = !must && v.announce && store.get('lm-ann') !== v.announce.id;
  u.className = must ? 'must' : ann ? 'must ann' : '';
  u.innerHTML = must
    ? `<img src="/static/pwa/icon-192.png" width="84" height="84" style="border-radius:22px" alt=""><h1>Update required</h1><p class="sub" style="max-width:300px">This version of the app is no longer supported. Update to keep listening.<br>${notes}</p><button class="btn" data-a="do-update">${ic('refresh')} Update now</button><a class="upd-apk" href="${esc(v.update_url || (NAT ? '/download/app.apk' : '/install?update=1'))}"><svg viewBox="0 0 24 24" style="width:18px;height:18px;stroke:#fff;fill:none;stroke-width:2;stroke-linecap:round"><path d="M12 3v12M7 11l5 5 5-5M4 20h16"/></svg>${NAT ? 'Download the new APK' : 'Update / reinstall the app'}</a>`
    : ann
      ? `<img src="/static/pwa/icon-192.png" width="84" height="84" style="border-radius:22px" alt=""><h1>${esc(v.announce.title || 'New version available')}</h1><p class="sub" style="max-width:310px">This app (v${esc(CV)}) was replaced by <b>v${esc(v.version)}</b>.<br>${notes}</p><button class="btn" data-a="do-update">${ic('refresh')} Update now</button><a class="sub" data-a="upd-later" style="margin-top:14px;cursor:pointer">Later</a>`
      : updBanner(v);
  if (ann) store.set('lm-ann', v.announce.id);
  u.hidden = false; buzz([30, 40, 30]);
}
async function applyUpdate() {
  if (NAT) {
    const v = S.upd || {}, u = withMt(NAT + '/download/app.apk' + (v.sha256 ? '?v=' + v.sha256.slice(0, 12) : ''));
    if (bridge && bridge.update) { toast('Downloading the update…'); bridge.update(u, v.sha256 || '') }
    else if (bridge && bridge.open) bridge.open(NAT + '/download/app.apk'); else toast('Download the new APK from the website');
    return;
  }
  toast('Updating…');
  try { const reg = await navigator.serviceWorker.getRegistration(); if (reg) { await reg.update(); if (reg.waiting) reg.waiting.postMessage('SKIP_WAITING') } } catch (e) {}
  try { (await caches.keys()).forEach(k => caches.delete(k)) } catch (e) {}
  setTimeout(() => location.reload(), 500);
}
let lastChk = 0;
async function checkUpdate(manual) {
  if (!navigator.onLine) return; lastChk = Date.now();
  try {
    const v = await api('/api/app/version?av=' + CV);
    S.upd = v.update_available || v.update_required ? v : null;
    if (v.update_required) showUpdate(v, true); else if (v.update_available) showUpdate(v); else if (manual) toast('You have the latest version (v' + CV + ')');
    // auto-update (APK): download + open the Android installer by itself, but never while a song is playing; the user only taps "Install"
    if (NAT && bridge && bridge.update && v.update_available && store.get('lm-autoupd') !== '0' && autoTried !== v.version && !S.playing) { autoTried = v.version; applyUpdate() }
    if (location.hash === '#you' && S.upd) route();
  } catch (e) { if (manual && !e.status) toast("Couldn't check right now") }
}
setInterval(() => { if (document.visibilityState === 'visible' && Date.now() - lastChk > 20 * 60000) checkUpdate() }, 60000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Date.now() - lastChk > 10 * 60000) checkUpdate() });

/* ───────── announcements / polls / questions (same as the website bell) ───────── */
let NT = [];
const ntSeenGet = () => { try { return JSON.parse(store.get('lm-seen-nt') || '[]') } catch (e) { return [] } };
const ntUnreadList = () => { const seen = ntSeenGet(); return NT.filter(m => (m.type === 'poll' || m.type === 'mcq') ? (m.my_response == null) : !seen.includes(m.id)) };
const ntUnread = () => ntUnreadList().length > 0;
/* v23.2: the bell shows HOW MANY are waiting (1, 2, 3 … 9+), not just a red dot. */
const ntDot = () => {
  const d = $('#bell .ndot'); if (!d) return;
  const n = ntUnreadList().length;
  d.hidden = !n;
  d.textContent = n > 9 ? '9+' : String(n);
  d.classList.toggle('num', n > 0);
  try { if (bridge && bridge.badge) bridge.badge(n) } catch (e) {}
};
/* v24.2: custom-made emoji art instead of system emoji, and every card is signed "Legacy Music · <admin>" */
const NT_EM = { release: 'announce', announcement: 'announce', poll: 'poll', question: 'question', mcq: 'question' };
const NT_LBL = { release: 'New release', announcement: 'Announcement', poll: 'Poll', question: 'Question', mcq: 'Question' };
const ntLeft = m => {
  if (m.expires_at) {
    const t = Date.parse(m.expires_at);
    if (!isNaN(t)) { const h = Math.round((t - Date.now()) / 3600000); return h <= 0 ? 'Closed' : h < 24 ? 'Closes in ' + h + 'h' : 'Closes in ' + Math.round(h / 24) + 'd' }
  }
  return '';
};
function ntCard(m) {
  const k = NT_EM[m.type] || 'announce', label = NT_LBL[m.type] || 'Announcement';
  const em = m.emoji ? '/static/emojis/' + m.emoji : '/static/emojis/' + k + '.svg';
  let body = `<p>${esc(m.text)}</p>`;
  if (m.type !== 'announcement' && m.options) {
    if (m.my_response != null && !m._edit) {
      const c = m.response_counts || {}, t = Object.values(c).reduce((a, b) => a + b, 0);
      body += m.options.map((o, i) => { const n = c[i] || 0, pc = t ? Math.round(n / t * 100) : 0;
        return `<div class="nt-opt"><div><span>${i === m.my_response ? '✓ ' : ''}${esc(o)}${i === m.my_response ? ' <em>(your answer)</em>' : ''}</span><span>${pc}%</span></div><div class="nt-bar"><i style="width:${pc}%"></i></div></div>` }).join('')
        + `<a class="lnk" data-a="nt-change" data-id="${m.id}">Change answer</a>`;
    } else body += m.options.map((o, i) => `<label class="nt-radio"><input type="radio" name="nt-${m.id}" value="${i}"> ${esc(o)}</label>`).join('') + `<button class="btn" data-a="nt-send" data-id="${m.id}">Submit</button>`;
  }
  const left = ntLeft(m);
  const raw = (m.created_by_name || '').trim();
  const who = (!raw || /^legacy\s*music$/i.test(raw)) ? 'Official' : raw;
  return `<div class="nt"${m._alb ? ` data-a="open-album" data-id="${esc(m._alb)}" style="cursor:pointer"` : ''}><div class="nt-top"><img class="em" src="${em}" alt=""><b>${label}${m.title ? ' — ' + esc(m.title) : ''}</b></div>`
    + `<div class="nt-by"><img class="lg" src="/static/emojis/legacy.svg" alt=""><span class="nm">Legacy Music</span><i>·</i><span class="who">${esc(who)}</span></div>`
    + body + (left ? `<div class="nt-exp">${esc(left)}</div>` : '') + `</div>`;
}
/* v24.1: notifications open as a small popup right under the bell (not a bottom sheet) */
let NTpopN = 0;
const ntPopHtml = () => `<div class="nt-h"><b>Notifications</b><span class="cnt">${NT.length ? NT.length + (NT.length === 1 ? ' message' : ' messages') : ''}</span></div>`
  + (NT.length ? NT.map(ntCard).join('') : '<div class="empty">You\'re all caught up.</div>');
function closeNotifs() { const p = $('#ntpop'); if (p) p.hidden = true }
function openNotifs() {
  const p = $('#ntpop'); if (!p) return;
  p.innerHTML = ntPopHtml(); p.hidden = false; NTpopN = NT.length;
  try { store.set('lm-seen-nt', JSON.stringify([...new Set([...ntSeenGet(), ...NT.map(m => m.id)])])) } catch (e) {}
  ntDot();
}
document.addEventListener('click', e => { const p = $('#ntpop'); if (!p || p.hidden) return; if (e.target.closest('#ntpop') || e.target.closest('#bell')) return; p.hidden = true }, true);
async function loadNotifs(auto) {
  if (S.offline || !navigator.onLine) return;
  try {
    const d = await api('/api/notifications'); NT = arr(d.messages && d.messages.map(m => m) || []).concat(relLocal());
    if (!$('#ntpop').hidden && NT.length !== NTpopN) { $('#ntpop').innerHTML = ntPopHtml(); NTpopN = NT.length }
    NTold = Object.fromEntries(NT.map(m => [m.id, m])); setTimeout(checkReleases, 5000);
    ntDot();
    /* v23.2: EVERY new announcement / poll / question goes to the phone's notification bar (not just 3).
       In the APK the native bridge posts a real Android notification; on the website we use the Web
       Notification API when the user allowed it. Each message is posted once (tracked in lm-an-seen). */
    try {
      const seen = JSON.parse(store.get('lm-an-seen') || '[]') || [];
      const fresh = NT.filter(m => !seen.includes(String(m.id))).slice(0, 12);
      fresh.forEach(m => {
        const title = String(m.title || 'Legacy Music');
        const body = String(m.text || m.body || m.message || '');
        try { if (bridge && bridge.announce) bridge.announce(title, body) } catch (e) {}
        try {
          if (!bridge && 'Notification' in window && Notification.permission === 'granted') {
            const n = new Notification(title, { body, icon: '/static/pwa/icon-192.png', badge: '/static/pwa/icon-192.png', tag: 'lm-nt-' + m.id });
            n.onclick = () => { try { window.focus(); openNotifs() } catch (e) {} };
          }
        } catch (e) {}
      });
      if (seen.length && fresh.length && !document.hidden) fresh.slice(0, 3).forEach((m, i) => annBanner(m, i === 0 ? 0 : 0));   // v25.1: a popup for each new one (max 3, one after another); not on the very first run (old messages)
      store.set('lm-an-seen', JSON.stringify([...new Set([...seen, ...NT.map(m => String(m.id))])].slice(-120)));
    } catch (e) {}
    // v24.1: a new message never jumps in front of the user - it just lights the badge on the bell
  } catch (e) {}
}
let NTold = {};
/* v25.1: a new announcement / poll / question pops up from the BOTTOM of the screen (like a WhatsApp message): icon + title + text, a vibration,
   tap = open it, swipe down = dismiss. It is fully self-styled here, so it never depends on any other stylesheet. */
let annQ = [], annShowing = false;
function annBanner(m, more) {
  annQ.push([m, more || 0]); if (!annShowing) annNext();
}
function annNext() {
  const it = annQ.shift(); if (!it) { annShowing = false; return } annShowing = true;
  const [m, more] = it;
  try {
    if (!document.getElementById('annpop-css')) {
      const st = document.createElement('style'); st.id = 'annpop-css';
      st.textContent = '#annpop{position:fixed;left:50%;right:auto;top:auto;bottom:calc(var(--tabs,54px) + var(--mini,64px) + env(safe-area-inset-bottom,0px) + 12px);width:min(92vw,440px);box-sizing:border-box;display:flex;gap:12px;align-items:center;padding:13px 15px;border-radius:16px;background:#1d1d27;color:#fff;border:1px solid var(--accent,#7c5cff);box-shadow:0 12px 36px rgba(0,0,0,.6),0 0 0 3px rgba(124,92,255,.22);z-index:99999;transform:translate(-50%,170%);opacity:0;transition:transform .45s cubic-bezier(.2,.9,.3,1.08),opacity .3s ease;touch-action:none;cursor:pointer;-webkit-tap-highlight-color:transparent}'
        + '#annpop.on{transform:translate(-50%,0);opacity:1}#annpop>img{width:42px;height:42px;border-radius:11px;flex:none;object-fit:cover}#annpop>div{min-width:0;flex:1}'
        + '#annpop small{display:block;font-size:10.5px;letter-spacing:.6px;text-transform:uppercase;color:var(--accent,#7c5cff);font-weight:700;margin-bottom:2px}'
        + '#annpop b{display:block;font-size:14px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
        + '#annpop span{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:12.5px;opacity:.82;line-height:1.35;margin-top:1px}'
        + '#annpop .tm{margin-left:auto;font-size:11px;opacity:.6;align-self:flex-start;font-style:normal;flex:none}';
      document.head.appendChild(st);
    }
    const old = document.getElementById('annpop'); if (old) old.remove();
    const lbl = NT_LBL[m.type] || 'Announcement';
    const d = document.createElement('div'); d.id = 'annpop';
    d.innerHTML = `<img src="/static/pwa/icon-192.png" alt=""><div><small>New ${esc(lbl)}${more ? ' · +' + more + ' more' : ''}</small><b>${esc(m.title || 'Legacy Music')}</b><span>${esc(String(m.text || m.body || m.message || '').slice(0, 140))}</span></div><i class="tm">now</i>`;
    let done = false, t = 0, y0 = null, dy = 0;
    const close = (open) => { if (done) return; done = true; clearTimeout(t); d.classList.remove('on'); d.style.transform = ''; setTimeout(() => { d.remove(); if (open) { try { openNotifs() } catch (e) {} } annNext() }, 380) };
    d.addEventListener('pointerdown', e => { y0 = e.clientY; dy = 0; try { d.setPointerCapture(e.pointerId) } catch (er) {} clearTimeout(t) });
    d.addEventListener('pointermove', e => { if (y0 == null) return; dy = Math.max(0, e.clientY - y0); d.style.transition = 'none'; d.style.transform = 'translate(-50%,' + dy + 'px)'; d.style.opacity = String(Math.max(.2, 1 - dy / 140)) });
    d.addEventListener('pointerup', () => { if (y0 == null) return; const moved = dy; y0 = null; d.style.transition = ''; d.style.opacity = ''; if (moved > 40) close(false); else { d.style.transform = ''; if (moved < 8) close(true); else t = setTimeout(() => close(false), 6000) } });
    d.addEventListener('pointercancel', () => { y0 = null; d.style.transition = ''; d.style.transform = ''; d.style.opacity = ''; t = setTimeout(() => close(false), 6000) });
    document.body.appendChild(d); requestAnimationFrame(() => requestAnimationFrame(() => d.classList.add('on')));
    try { navigator.vibrate && navigator.vibrate([60, 40, 60]) } catch (e) {}
    t = setTimeout(() => close(false), 9000);
  } catch (e) { annShowing = false; annNext() }
}
let lastNotifAt = 0;
setInterval(() => { if (document.hidden) return; lastNotifAt = Date.now(); loadNotifs() }, 20000);   // v24.6: not in the background
document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - lastNotifAt > 3000) { lastNotifAt = Date.now(); loadNotifs() } });

/* v23.2: the website needs permission before it can put a notification in the phone's bar.
   Ask once, on the very first tap (browsers refuse a silent request on page load). */
let ntPermAsked = false;
function ntAskPerm() {
  if (ntPermAsked || bridge || !('Notification' in window)) return;
  ntPermAsked = true;
  try {
    if (Notification.permission === 'default') Notification.requestPermission().then(p => { if (p === 'granted') loadNotifs() }).catch(() => {});
  } catch (e) {}
}
document.addEventListener('pointerdown', ntAskPerm, { once: true, passive: true });
document.addEventListener('keydown', ntAskPerm, { once: true });

/* ───────── screens ───────── */
const greet = () => { const h = new Date().getHours(); return h < 5 ? 'Late night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening' };
const modePill = () => `<div class="pill"><i></i>${S.offline ? ic('dl') + " You're offline" : mode() === 'phone' ? ic('phone') + ' Songs play on this phone' : ic('head') + ' Songs play in your Discord voice channel'}</div>`;

async function resolveSaved(codes, pool) {
  const have = new Map(pool.map(x => [String(x.code).toUpperCase(), x])), out = [];
  const miss = codes.filter(c => !have.has(c)).slice(0, 20);
  const got = await Promise.allSettled(miss.map(c => api('/api/playlists/code/' + encodeURIComponent(c))));
  got.forEach((g, i) => { if (g.status === 'fulfilled') { const p = g.value; have.set(miss[i], { code: miss[i], name: p.name, track_count: p.track_count, cover_image_url: p.cover_image_url || (p.tracks && p.tracks[0] && art(nt(p.tracks[0]))) }) } });
  codes.forEach(c => { if (have.has(c)) out.push(have.get(c)) });
  return out;
}

const aotw = (p, fb) => `<button class="aotw" data-a="open-pl" data-code="${esc(p.code)}"><span class="aw-cv" data-plcode="${plc(p.code)}" style="${bgi(fixUrl(p.cover_image_url) || '/static/pwa/icon-512.png')}">${ptkImg(p)}</span><span class="aw-tx"><em>${fb ? 'Top album' : 'Album of the week'}</em><b>${esc(p.name)}</b><small>${esc(p.owner_name || '')}${p.track_count ? ' · ' + p.track_count + ' songs' : ''}</small></span></button>`;
async function home() {
  const my = RT;
  view.innerHTML = `<h1>${greet()}, ${esc(S.me.username)}</h1><div id="h1">${skel(3)}</div>`;
  if (S.offline) return downloads(true);
  const [rec, trend, pls, mine, saved, appc, chart] = await Promise.allSettled([api('/api/me/recent?limit=12'), api('/api/explore/songs?limit=20'), api('/api/explore/playlists?limit=60'),
    api('/api/playlists'), api('/api/app/saved'), api('/api/app/app-playlists'), NAT ? api('/api/app/charts') : Promise.resolve(null)]);
  if (my !== RT) return;
  const v = x => x.status === 'fulfilled' ? x.value : null;
  const r = arr(v(rec)), t = arr(v(trend)), pub = arr(v(pls)), my_ = arr(v(mine)), codes = ((v(saved) || {}).codes || []), appSet = new Set(((v(appc) || {}).codes || []));
  S.saved = new Set(codes); L.recent = r; L.trend = t;
  const mineIds = new Set(my_.map(x => x.id)), savedSet = S.saved;
  const comm = pub.filter(x => !mineIds.has(x.id) && !savedSet.has(String(x.code).toUpperCase())).map(x => ({ ...x, _src: appSet.has(String(x.code).toUpperCase()) ? 'App' : 'Discord' }));
  comm.sort((a, b) => (b._src === 'App') - (a._src === 'App'));
  const sv = codes.length ? await resolveSaved(codes, pub) : [];
  if (my !== RT) return;

  // Recently played row
  const rp = rpGet();

  const la = listenAgainGet(); // most played songs on this device
  let h = '';
  const ch = NAT ? v(chart) : null;
  if (ch && ch.album_of_week) h += aotw(ch.album_of_week, ch.weekly_fallback);
  const mix = NAT && S.sync ? arr(S.sync.mix) : [];
  if (mix.length >= 5) h += `<button class="mixcard" data-a="play-mix"><span class="mx-ic">${ic('shuffle')}</span><span><b>Daily Mix</b><small>${mix.length} songs you love · tap to play</small></span><span class="mx-pl"><svg viewBox="0 0 24 24">${PLAY}</svg></span></button>`;
  if (rp.length) h += rpCards(rp);
  const fa = artistsGet(); if (fa.length) h += `<h2>Your artists <small data-go="you">See all</small></h2>${artistCards(fa.slice(0, 20))}`;
  if (my_.length) h += `<h2>Your playlists <small data-go="library">See all</small></h2>${plCards(my_.slice(0, 12))}`;
  /* v23.1: Top playlists — the most played / most viewed public playlists, right under "Your playlists"
     and before "Listen again". Sorted by plays, then views, then track count; duplicates removed. */
  const topSrc = [...pub, ...(ch && arr(ch.weekly_trending) ? arr(ch.weekly_trending) : [])];
  const seenTop = new Set(); const topPl = topSrc.filter(p => { const k = String(p.code || p.id || p.name); if (!p || seenTop.has(k)) return false; seenTop.add(k); return true })
    .sort((a, b) => (b.plays || b.play_count || b.views || 0) - (a.plays || a.play_count || a.views || 0) || (b.track_count || 0) - (a.track_count || 0))
    .slice(0, 12);
  if (topPl.length) h += `<h2>Top playlists <small>Most played</small></h2>${plCards(topPl)}`;
  L.listen = (la.length ? la : r).map(nt);
  if (L.listen.length) h += `<h2>Listen again</h2>${songCards('listen', L.listen)}`;
  if (sv.length) h += `<h2>Saved playlists</h2>${plCards(sv)}`;
  if (comm.length) h += `<h2>Playlists for you <small>App + Discord mix</small></h2>${plCards(comm.slice(0, 24), true)}`;
  if (ch && arr(ch.weekly_trending).length) h += `<h2>Trending albums <small>${ch.weekly_fallback ? 'Most viewed' : 'This week'}</small></h2>${plCards(arr(ch.weekly_trending))}`;
  if (ch && arr(ch.albums).length) h += `<h2>Popular albums</h2>${plCards(arr(ch.albums))}`;
  // Trending now = app-only top songs (most played by APK users). Fall back to explore only if no app charts.
  if (ch && arr(ch.top_songs).length) {
    L.topapp = arr(ch.top_songs).map(nt);
    h += `<h2>Trending now <small>Most played on the app</small></h2>` + L.topapp.slice(0, 15).map((x, i) => songRow('topapp', i, x, moreBtn('topapp', i))).join('');
  } else if (t.length) {
    // No APK charts yet — show explore songs as a fallback but label clearly
    h += `<h2>Trending now</h2>` + t.slice(0, 10).map((x, i) => songRow('trend', i, nt(x), moreBtn('trend', i))).join('');
  }
  if (!h) h = `<div class="empty">${ic('music', 'big')}<br>Nothing here yet.<br>Search a song to get started</div>`;
  h = installHero() + h;                       // v23.0: big install button, coloured by the current song
  if ($('#h1')) $('#h1').outerHTML = h;
}

const CHIPS = [['Recently Played', '__rp__'], ['Punjabi', 'punjabi'], ['Hindi', 'hindi'], ['English', 'english'], ['Old', 'old classic'], ['90s', '90s'], ['Lofi', 'lofi'], ['Sad', 'sad'], ['Romantic', 'romantic'], ['Party', 'party'], ['Devotional', 'bhakti devotional']];
let st, SQ = 0;

// FIX: Search page "Recently Played" should only show songs the user searched for / tapped from search results.
//      We track these in lm-rp-search (separate from the full play history lm-rp).
function rpSearchPush(item) {
  const rps = jget('lm-rp-search', []);
  const key = item.uri || item.title;
  const filtered = rps.filter(x => (x.uri || x.title) !== key);
  filtered.unshift({ ...item, ts: Date.now() });
  store.set('lm-rp-search', JSON.stringify(filtered.slice(0, 12)));
}
function rpSearchGet() { return jget('lm-rp-search', []) }

function search(prefill) {
  // FIX: show only songs that were found via search, not all auto-played songs
  const rp = rpSearchGet().slice(0, 12);
  const rpHtml = rp.length
    ? rp.map((x) => `<button class="row rp-row" data-a="rp-song" data-k="${esc(x.uri || x.title)}"><span class="th" style="${bgi(x.thumbnail || '/static/pwa/icon-192.png')}"></span><span class="tx"><span class="t">${esc(x.title)}</span><span class="s">${esc(x.author || '')}</span></span></button>`).join('')
    : '<div class="empty" style="padding:16px 0">No recently searched songs yet.</div>';
  view.innerHTML = `<h1>Search</h1><label class="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg><input id="q" type="search" placeholder="Songs, artists, YouTube links…" autocomplete="off" enterkeyhint="search"></label>
  <div class="chips" id="chips">${CHIPS.map(([n]) => `<button class="chip${S.chips.has(n) ? ' on' : ''}" data-a="chip" data-n="${n}">${n}</button>`).join('')}</div>
  <div id="res"><div id="rp-list"><h2 style="margin-top:14px">${ic('clock')} Recently searched</h2>${rpHtml}</div></div>`;
  const inp = $('#q'); if (prefill) inp.value = prefill; else inp.focus();
  inp.addEventListener('input', () => { clearTimeout(st); st = setTimeout(run, 380) });
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { clearTimeout(st); run() } });
  if (prefill || (S.chips.size && !S.chips.has('Recently Played'))) run();
}
async function run() {
  const inp = $('#q'); if (!inp) return;
  const txt = inp.value.trim(), sq = ++SQ;   // v24: every search gets a number, so a slow OLD answer can never overwrite a newer one
  // FIX: "Recently Played" chip — show search history not full play history
  if (S.chips.has('Recently Played') && !txt) {
    const rp = rpSearchGet().slice(0, 12);
    const R = $('#res');
    if (R) R.innerHTML = `<div id="rp-list"><h2 style="margin-top:14px">${ic('clock')} Recently searched</h2>` +
      (rp.length ? rp.map((x) => `<button class="row rp-row" data-a="rp-song" data-k="${esc(x.uri || x.title)}"><span class="th" style="${bgi(x.thumbnail || '/static/pwa/icon-192.png')}"></span><span class="tx"><span class="t">${esc(x.title)}</span><span class="s">${esc(x.author || '')}</span></span></button>`).join('') : '<div class="empty">No recently searched songs yet.</div>') + '</div>';
    return;
  }
  const extra = CHIPS.filter(([n]) => S.chips.has(n) && n !== 'Recently Played').map(c => c[1]).join(' ');
  const v = (txt + ' ' + extra).trim() + (!txt && extra ? ' songs' : '');
  if (v.length < 2) {
    // FIX: Show search history when no query, not full play history
    const rp = rpSearchGet().slice(0, 12);
    const R = $('#res');
    if (R) R.innerHTML = `<div id="rp-list"><h2 style="margin-top:14px">${ic('clock')} Recently searched</h2>` +
      (rp.length ? rp.map((x) => `<button class="row rp-row" data-a="rp-song" data-k="${esc(x.uri || x.title)}"><span class="th" style="${bgi(x.thumbnail || '/static/pwa/icon-192.png')}"></span><span class="tx"><span class="t">${esc(x.title)}</span><span class="s">${esc(x.author || '')}</span></span></button>`).join('') : '<div class="empty">No recently searched songs yet.</div>') + '</div>';
    return;
  }
  const my = RT, R = $('#res'); R.innerHTML = skel(6);
  try {
    const d = await api('/api/music/search?query=' + encodeURIComponent(v)); if (my !== RT || sq !== SQ) return;
    clearTimeout(S.evS); if (v.length > 1) S.evS = setTimeout(() => ev('search', { title: v }), 2500);
    L.search = arr(d.songs).map(nt); S.ctx = v; const arts = arr(d.artists).filter(a => a && a.name).slice(0, 8);
    if (txt) { const rq = jget('lm-rq', []).filter(x => x !== txt); rq.unshift(txt); store.set('lm-rq', JSON.stringify(rq.slice(0, 8))) }
    const ranked = rankSearch(L.search, v, arts);          // v23: the singer's official song first, covers / remixes / fan uploads underneath
    L.search = ranked.main.concat(ranked.other);
    const mainH = ranked.main.map((x, i) => songRow('search', i, x, moreBtn('search', i))).join(''),
      othH = ranked.other.map((x, i) => songRow('search', ranked.main.length + i, x, moreBtn('search', ranked.main.length + i))).join('');
    R.innerHTML = (arts.length ? `<div id="art-box"><h2>Artists</h2>${artistCards(arts)}</div>` : '') + '<div id="alb-box"></div>' + (arts.length ? '<h2 id="songs-h">Songs</h2>' : '') + (mainH || (othH ? '' : '<div class="empty">No songs found</div>'))
      + (othH ? `<h2>${ranked.main.length ? 'Other versions' : 'Songs'} <small>covers, remixes &amp; fan uploads</small></h2>${othH}` : ''); albUi(v, arts, my, sq);
  } catch (e) { if (my === RT && sq === SQ) R.innerHTML = `<div class="empty">${esc(e.message)}</div>` }
}

async function library() {
  const my = RT;
  view.innerHTML = `<h1>Library</h1><div class="actions"><button class="btn sm" data-a="new-pl">${ic('plus')} Playlist ${isPrem() ? '' : ic('crown', 'gold')}</button><button class="btn sm ghost" data-a="new-collab-pl">${ic('users')} Collab ${isPrem() ? '' : ic('crown', 'gold')}</button></div><div id="lib">${skel(4)}</div>`;
  const [pls, liked, saved, dm] = await Promise.allSettled([api('/api/playlists'), api('/api/liked-songs'), api('/api/app/saved'), dlMeta()]);
  if (my !== RT) return;
  const p = pls.status === 'fulfilled' ? arr(pls.value) : [], l = liked.status === 'fulfilled' ? arr(liked.value) : [], d = dm.status === 'fulfilled' ? dm.value : [];
  const codes = saved.status === 'fulfilled' ? saved.value.codes || [] : []; S.saved = new Set(codes);
  l.forEach(x => { S.liked[x.uri] = x.id });
  const sv = codes.length ? await resolveSaved(codes, []) : []; if (my !== RT) return;
  const rowP = (x, sub, kind) => `<button class="row" data-a="open-pl" data-code="${esc(x.code)}"><span class="th" data-plcode="${plc(x.code)}" style="${bgi(fixUrl(x.cover_image_url) || '/static/pwa/icon-512.png')}">${ptkImg(x)}</span><span class="tx"><span class="t">${esc(x.name)}${x.collab ? ' ' + ic('users') : ''}${x.locked ? ' ' + ic('lock') : ''}${plDl(x.code) ? '<span class="dl-ok">' + DL_TICK + '</span>' : ''}</span><span class="s">${sub}</span></span><span class="ib more" role="button" data-a="pl-more" data-code="${esc(x.code)}" data-pid="${esc(x.id == null ? '' : x.id)}" data-kind="${kind}" data-name="${esc(x.name)}" data-n="${esc(String(x.track_count || 0))} songs" aria-label="More"><svg viewBox="0 0 24 24" style="fill:currentColor;stroke:none"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg></span></button>`;
  let h = `<button class="row" data-a="open-liked"><span class="th" style="background:linear-gradient(135deg,#7c5cff,#3b9dff);display:grid;place-items:center">${ic('heart', 'fill big')}</span><span class="tx"><span class="t">Liked songs</span><span class="s">${l.length} songs</span></span></button>`;
  h += `<button class="row" data-a="open-dl"><span class="th" style="background:linear-gradient(135deg,#10b981,#3b9dff);display:grid;place-items:center">${ic('dl', 'big')}</span><span class="tx"><span class="t">Downloads ${isPrem() ? '' : ic('crown', 'gold')}</span><span class="s">${d.length} songs · play without internet</span></span></button>`;
  h += p.map(x => rowP(x, `${x.track_count} songs · ${x.is_public && isPrem() ? 'Public' : 'Private'}${x.locked ? ' · 🔒' : ''}${x.collab ? ' · Collaborative' : ''}`, 'own')).join('');
  if (!p.length) h += `<div class="empty">${isPrem() ? 'No playlists yet. Create your first one!' : 'Creating playlists is a Premium feature'}</div>`;
  if (sv.length) h += `<h2>Saved playlists</h2>` + sv.map(x => rowP(x, `${x.track_count || 0} songs`, 'saved')).join('');
  h += followingHtml();
  const dp = dlPlGet();
  h += dlAlbHtml();
  if (dp.length) h += `<h2>Downloaded playlists</h2>` + dp.map(x => `<button class="row" data-a="open-pl" data-code="${esc(x.code)}"><span class="th" ${x.code === 'liked' ? '' : `data-plcode="${plc(x.code)}"`} style="${bgi(x.cover || '/static/pwa/icon-512.png')}"></span><span class="tx"><span class="t">${esc(x.name)}<span class="dl-ok">${DL_TICK}</span></span><span class="s">${(x.ids || []).length} songs · downloaded</span></span><span class="ib more" role="button" data-a="dlpl-rm" data-code="${esc(x.code)}" aria-label="Remove"><svg viewBox="0 0 24 24" style="fill:currentColor;stroke:none"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg></span></button>`).join('');
  if ($('#lib')) { $('#lib').innerHTML = h; faFill() }
}

async function downloads(inHome) {
  const my = RT, solo = soloGet(), d = (await dlMeta()).filter(x => solo.has(x.id) || !inDlPl(x.id)).sort((a, b) => b.ts - a.ts);
  if (my !== RT) return; L.dl = d.map(x => ({ ...x, identifier: x.id }));
  const mb = d.reduce((s, x) => s + (x.size || 0), 0) / 1048576;
  const locked = !isPrem();
  const h = `${inHome ? '' : '<h1>Downloads</h1>'}<div class="sub">${d.length} songs · ${mb.toFixed(0)} MB on this phone${locked ? ' · Premium needed to play' : ''}</div>
  <div class="actions"><button class="btn" data-a="dl-play" ${locked || !d.length ? 'disabled style="opacity:.5"' : ''}>${ic('play', 'fill')} Play all</button><button class="btn ghost" data-a="dl-clear">Delete all</button></div>` +
    (d.length ? L.dl.map((x, i) => songRow('dl', i, x, moreBtn('dl', i))).join('') : `<div class="empty">${ic('dl', 'big')}<br>No downloads yet.<br>${isPrem() ? 'Tap ⋮ on any song, then Download.' : 'Downloading is a Premium feature.'}</div>`);
  if (inHome) { if ($('#h1')) $('#h1').outerHTML = h } else view.innerHTML = h;
}

/* ───────── playlist cover photo + background (v23.8): stored on the server, shown everywhere the playlist shows ───────── */
const PA = { map: {}, blob: new Map(), kind: '', code: '' };
const plc = c => esc(String(c || '').toUpperCase());
async function plArtLoad() { try { const d = await api('/api/app/pl-art'); PA.map = (d && d.art) || {}; plArtApply() } catch (e) {} }
function plArtUrl(code, kind) {
  const m = PA.map[code]; if (!m || !m[kind]) return Promise.resolve(null);
  const k = code + '|' + kind + '|' + m[kind]; if (PA.blob.has(k)) return PA.blob.get(k);
  const p = ff(`/api/app/pl-art/${encodeURIComponent(code)}/${kind}?v=${m[kind]}`).then(r => r.ok ? r.blob() : null).then(b => b ? URL.createObjectURL(b) : null).catch(() => null);
  PA.blob.set(k, p); p.then(u => { if (!u) PA.blob.delete(k) }); return p;
}
function plArtApply() {
  document.querySelectorAll('[data-plcode]').forEach(async el => {
    const code = el.dataset.plcode, kind = el.dataset.plkind || 'cover', m = PA.map[code]; if (!m || !m[kind]) return;
    const tag = code + kind + m[kind]; if (el.dataset.pa === tag) return; el.dataset.pa = tag;
    const u = await plArtUrl(code, kind); if (u && el.dataset.pa === tag) el.style.backgroundImage = `url('${u}')`; else if (!u && el.dataset.pa === tag) delete el.dataset.pa;
  });
}
{ let t; new MutationObserver(() => { clearTimeout(t); t = setTimeout(() => { plArtApply(); ptkApply() }, 60) }).observe(view, { childList: true, subtree: true }) }
const imgResize = (file, w, h, q) => new Promise((res, rej) => {
  const u = URL.createObjectURL(file), im = new Image();
  im.onload = () => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'), s = Math.max(w / im.width, h / im.height), dw = im.width * s, dh = im.height * s; x.drawImage(im, (w - dw) / 2, (h - dh) / 2, dw, dh); URL.revokeObjectURL(u); res(c.toDataURL('image/jpeg', q)) };
  im.onerror = () => { URL.revokeObjectURL(u); rej(new Error('Could not read this photo')) }; im.src = u;
});
async function plArtSave(code, kind, body) {
  toast('Saving photo…');
  try { const r = await api(`/api/app/pl-art/${encodeURIComponent(code)}/${kind}`, { method: 'POST', body }); PA.map[code] = { ...(PA.map[code] || {}), [kind]: r.ts }; closeSheet(); toast(kind === 'bg' ? 'Background updated' : 'Cover photo updated'); buzz(); playlist(code) }
  catch (er) { toast(er.message) }
}
const plArtFile = (() => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.hidden = true; document.body.appendChild(i); return i })();
plArtFile.addEventListener('change', async () => {
  const f = plArtFile.files && plArtFile.files[0]; plArtFile.value = ''; if (!f) return;
  try { const bgk = PA.kind === 'bg', data = await cropImage(f, bgk ? 2 : 1, 1, bgk ? 1080 : 640, bgk ? 540 : 640); if (data) await plArtSave(PA.code, PA.kind, { data }) } catch (er) { toast(er.message) }
});
// Playlist cover / background: upload from the phone gallery only (no link box).
function plArtSheet(code, kind) {
  const bg = kind === 'bg';
  sheet(`<h3>${ic('edit')} ${bg ? 'Playlist background' : 'Playlist cover photo'}</h3>
    <p class="sub">Upload a photo from your gallery (JPG, PNG or WEBP). Allow gallery access if your phone asks.</p>
    <div class="actions"><button class="btn" data-a="pl-art-pick" data-kind="${kind}" data-code="${esc(code)}">Upload photo</button>
      <button class="btn ghost" data-a="close-sheet">Cancel</button></div>`);
}

async function playlist(code) {
  const my = RT; view.innerHTML = skel(5);
  try {
    let p;
    if (code === 'liked') p = { name: 'Liked songs', tracks: arr(await api('/api/liked-songs')), is_owner: true };
    else {
      // /api/playlist/info has cover_image_url, banner_image_url and owner_name; /api/playlists/code/{code} does not (that is why the inside cover differed from the outside one)
      try { p = await api('/api/playlist/info?code=' + encodeURIComponent(code)) }
      catch (e) { if (e.offline && dlPlHas(code)) p = await dlPlOffline(dlPlHas(code)); else { if (e.offline || [403, 404, 426, 429].includes(e.status)) throw e; p = await api('/api/playlists/code/' + encodeURIComponent(code)) } }
    }
    if (my !== RT) return;
    if (!PTK.loaded) { PTK.loaded = 1; await ptkLoad() }
    L.pl = arr(p.tracks).map(nt); L.plMeta = p;
    // cover/banner can come back as a relative path (/static/uploads/...): fixUrl() attaches the origin
    const cover = fixUrl(p.cover_image_url) || (L.pl[0] && art(L.pl[0])) || '/static/pwa/icon-512.png';
    const ban   = fixUrl(p.banner_image_url) || cover;
    const up = String(code).toUpperCase(), saved = S.saved.has(up);
    // push playlist to recently played — user explicitly opened this playlist
    rpPush('playlist', { title: p.name, code: up, thumbnail: cover }, true);
    const collabBadge = p.collab ? `<span class="chip on" style="pointer-events:none">${ic('users')} Collaborative</span>` : '';
    const privNotice = !isPrem() && p.is_owner && p.collab ? `<div class="notice">⚠️ Your Premium expired. This playlist is private until you renew.</div>` : '';
    const shareCollabBtn = p.collab && p.is_owner ? `<button class="btn ghost" data-a="collab-link" data-code="${esc(up)}">${ic('copy')} Copy</button>` : '';
    const names = [], addName = x => { if (x == null || x === '') return; const n = (typeof x === 'object') ? (x.display_name || x.username || x.name || (x.id ? 'User ' + x.id : '')) : String(x); if (n && !names.some(o => o.toLowerCase() === n.toLowerCase())) names.push(n) };
    addName(p.owner_name); (Array.isArray(p.collaborators) ? p.collaborators : []).forEach(addName);
    const collabLine = (p.collab || names.length > 1) && names.length ? `<div class="sub" style="margin:14px 0 6px">👥 Collab with: ${names.map(esc).join(', ')}</div>` : '';
    view.innerHTML = `<button class="btn sm ghost" data-a="pl-back" style="margin:2px 0 8px">‹ Back</button><div class="hero big"><div class="ban" data-plcode="${esc(up)}" data-plkind="bg" style="${bgi(ban)}"></div><div class="in"><span class="cv" data-plcode="${esc(up)}" style="${bgi(cover)}">${plCvTick(p)}</span><div><h1>${esc(p.name)}</h1>${plOwnerLine(p)}<div class="sub">${L.pl.length} songs${p.collab ? ' · Collab' : ''}${p.views != null && !p.owner_name ? ' · ' + fmtViews(p.views) + ' views' : ''}</div></div></div></div>
      ${privNotice}
      <div class="actions"><button class="btn" data-a="pl-play">${ic('play', 'fill')} Play</button><button class="btn ghost" data-a="pl-shuffle">${ic('shuffle')} Shuffle</button>
      ${code !== 'liked' && !p.is_owner ? `<button class="btn ghost saveb${saved ? ' on' : ''}" data-a="pl-save" data-code="${esc(up)}">${ic('bookmark')} <span>${saved ? 'Saved' : 'Save'}</span></button>` : ''}
      ${(p.is_owner || p.collab) && code !== 'liked' && isPrem() ? `<button class="btn ghost" data-a="pl-edit" data-pid="${p.id}" data-code="${esc(up)}">${ic('edit')} Edit</button>` : ''}
      <button class="btn ghost" data-a="pl-copy" data-code="${esc(up)}">${ic('copy')} Share</button>
      ${shareCollabBtn}
      <button class="btn ghost${dlPlDone(L.pl) ? ' dl-done' : ''}" data-a="pl-dl">${dlPlDone(L.pl) ? '<span class="dl-ok">' + DL_TICK + '</span> Downloaded' : (DLPL[dlPlKey(up)] ? ic('dl') + ' ' + (DLPL[dlPlKey(up)].paused ? 'Paused' : 'Downloading') + ' ' + DLPL[dlPlKey(up)].done + '/' + DLPL[dlPlKey(up)].total : ic('dl') + ' Download ' + (isPrem() ? '' : ic('crown', 'gold')))}</button></div>
      ${collabBadge}` +
      (L.pl.length ? L.pl.map((x, i) => songRow('pl', i, x, moreBtn('pl', i))).join('') : '<div class="empty">This playlist is empty</div>') + collabLine;
  } catch (e) { if (my === RT) view.innerHTML = `<div class="empty">${esc(e.message)}</div>` }
}


/* ───────── v25.5: REAL ALBUMS (Apple iTunes catalogue = real albums + real covers), artist albums, Following, new releases ───────── */
const ITU = 'https://itunes.apple.com';
const ituJ = async (path, ms) => { try { const c = new AbortController(), t = setTimeout(() => c.abort(), ms || 7000); const r = await fetch(ITU + path, { signal: c.signal }); clearTimeout(t); return r.ok ? await r.json() : null } catch (e) { return null } };
const ituArt = (u, n) => String(u || '').replace(/\/\d+x\d+(bb)?\.(jpg|png)/, `/${n || 600}x${n || 600}bb.$2`);
const albCache = new Map();
const albNorm = s => String(s || '').toLowerCase().replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/\s-\s(single|ep)$/i, '').replace(/[^a-z0-9\u0900-\u097f\u0a00-\u0a7f\s]/g, ' ').replace(/\s+/g, ' ').trim();
const albMk = x => ({ id: x.collectionId, name: x.collectionName, artist: x.collectionArtistName || x.artistName, cover: ituArt(x.artworkUrl100, 600), thumb: ituArt(x.artworkUrl100, 300), date: x.releaseDate || '', n: x.trackCount || 0 });
async function albSearch(term, limit) {
  const k = 's|' + term + '|' + (limit || 12); if (albCache.has(k)) return albCache.get(k);
  const d = await ituJ(`/search?term=${encodeURIComponent(term)}&media=music&entity=album&limit=${limit || 12}&country=IN`); if (!d) return [];
  const seen = new Set(), r = arr(d.results).filter(x => x.collectionId && x.collectionName).map(albMk).filter(a => { const n = albNorm(a.name) + '|' + albNorm(a.artist); if (seen.has(n)) return false; seen.add(n); return true });
  albCache.set(k, r); return r;
}
async function ituSong(term) {
  const k = 't|' + term; if (albCache.has(k)) return albCache.get(k);
  const d = await ituJ(`/search?term=${encodeURIComponent(term)}&media=music&entity=song&limit=6&country=IN`); if (!d) return [];
  const r = arr(d.results).filter(x => x.trackName && x.collectionId).map(x => ({ title: x.trackName, artist: x.artistName, album: albMk(x) }));
  albCache.set(k, r); return r;
}
async function albTracks(id) {
  const k = 'a|' + id; if (albCache.has(k)) return albCache.get(k);
  const d = await ituJ(`/lookup?id=${encodeURIComponent(id)}&entity=song&country=IN`); if (!d) return null;
  const rs = arr(d.results), c = rs.find(x => x.wrapperType === 'collection'); if (!c) return null;
  const album = albMk(c);
  const tracks = rs.filter(x => x.wrapperType === 'track' && x.trackName).sort((p, q_) => (p.discNumber || 1) - (q_.discNumber || 1) || (p.trackNumber || 0) - (q_.trackNumber || 0))
    .map(x => ({ title: x.trackName, author: x.artistName, uri: '', identifier: '', thumbnail: album.cover, duration: x.trackTimeMillis || 0 }));
  const r = { album, tracks }; albCache.set(k, r); return r;
}
const albYear = a => { const y = String(a.date || '').slice(0, 4); return /^\d{4}$/.test(y) ? y : '' };
const albCards = list => `<div class="cards">${list.map(a => `<button class="card" data-a="open-album" data-id="${esc(a.id)}"><span class="cv" style="${bgi(a.thumb || a.cover)}"></span><span class="t">${esc(a.name)}</span><span class="s">${esc(a.artist)}${albYear(a) ? ' · ' + albYear(a) : ''}</span></button>`).join('')}</div>`;
const sameArtist = (a, n) => { const x = albNorm(a), y = albNorm(n); return !!x && !!y && (x === y || (y.length > 3 && x.includes(y)) || (x.length > 3 && y.includes(x))) };
async function latestAlbum(name, singles) {
  const l = (await albSearch(name, 25)).filter(a => sameArtist(a.artist, name) && (singles || !/\s-\s(single|ep)$/i.test(a.name)));
  l.sort((p, q_) => String(q_.date).localeCompare(String(p.date))); return l[0] || null;
}
/* search: Artist first, then Album, then the song(s), then recommended */
async function albUi(v, arts, my, sq) {
  const q = albNorm(v); if (q.length < 2) return;
  const [alb, sg] = await Promise.all([albSearch(v, 20), ituSong(v)]);
  const live = () => my === RT && sq === SQ && $('#alb-box');
  if (!live()) return;
  const artBlock = a => `<h2>Artist</h2>${artistCards([a])}`;
  const artFor = nm => { const m = arts.find(a => akey(a.name) === akey(nm)); return m || { name: nm, thumbnail: '' } };
  const setHead = txt => { const h = $('#songs-h'); if (h) h.textContent = txt; else $('#alb-box').insertAdjacentHTML('afterend', `<h2>${txt}</h2>`) };
  const dropOthers = () => { const ab = $('#art-box'); if (ab) ab.remove() };
  // 1) an ARTIST was typed -> his albums under the artist
  const byArtist = alb.filter(a => albNorm(a.artist) === q || (q.length > 3 && albNorm(a.artist).includes(q)));
  if (byArtist.length >= 2 || (byArtist.length && byArtist[0] && albNorm(byArtist[0].artist) === q)) {
    $('#alb-box').innerHTML = `<h2>Albums</h2>${albCards(byArtist.slice(0, 12))}`; return;
  }
  // 2) an ALBUM name was typed -> artist, the album, all its songs, then recommended
  const hit = alb.find(a => { const n = albNorm(a.name); return n && (n === q || (q.length > 4 && n.includes(q)) || (n.length > 4 && q.includes(n))) });
  if (hit) {
    const d = await albTracks(hit.id); if (!live()) return; L.albtr = d ? d.tracks : [];
    dropOthers();
    $('#alb-box').innerHTML = artBlock(artFor(hit.artist)) + `<h2>Album</h2>${albCards([hit])}` + (L.albtr.length ? `<h2>Album songs</h2>` + L.albtr.map((x, i) => songRow('albtr', i, x, moreBtn('albtr', i))).join('') : '');
    setHead('Recommended'); return;
  }
  // 3) a SONG of an album was typed -> artist, its album, then the song and the recommended ones
  const sm = sg.find(s => { const n = albNorm(s.title); return n && (n === q || (n.length > 4 && q.includes(n)) || (q.length > 4 && n.includes(q))) });
  if (sm) {
    dropOthers();
    $('#alb-box').innerHTML = artBlock(artFor(sm.artist)) + `<h2>Album</h2>${albCards([sm.album])}`;
    setHead('Song & recommended');
  }
}
async function albumPage(id) {
  const my = RT; view.innerHTML = skel(5);
  const rec = dlAlbGet().find(x => String(x.id) === String(id)), d = await albTracks(id); if (my !== RT) return;
  let al = d && d.album, tr = d ? d.tracks : [];
  if (rec) { tr = rec.tracks.slice(); al = al || { id: rec.id, name: rec.name, artist: rec.artist, cover: rec.cover, date: '' } }   // a downloaded album opens even without internet and plays from the phone
  if (!al || !tr.length) { view.innerHTML = '<div class="empty">Album not found</div>'; return }
  L.album = tr; S.ctx = al.artist;
  view.innerHTML = `<button class="btn sm ghost" data-a="pl-back" style="margin:2px 0 8px">‹ Back</button>
    <div class="hero"><span class="cv" style="${bgi(al.cover)}"></span><div><h1>${esc(al.name)}</h1><div class="sub"><a class="lnk" data-a="open-artist" data-name="${esc(al.artist)}">${esc(al.artist)}</a> · Album${albYear(al) ? ' · ' + albYear(al) : ''} · ${tr.length} songs</div></div></div>
    <div class="actions"><button class="btn" data-a="album-play">${ic('play', 'fill')} Play</button><button class="btn ghost" data-a="album-shuffle">${ic('shuffle')} Shuffle</button><button class="btn ghost" id="alb-dl" data-a="album-dl" data-id="${esc(al.id)}"></button></div>` +
    tr.map((x, i) => songRow('album', i, x, moreBtn('album', i))).join('');
  albBtnPaint(al.id);
}
async function artAlbums(name) {
  if (!$('#art-albums')) return;
  const my = RT, l = (await albSearch(name, 25)).filter(a => sameArtist(a.artist, name));
  l.sort((p, q_) => String(q_.date).localeCompare(String(p.date)));
  const full = l.filter(a => !/\s-\s(single|ep)$/i.test(a.name)), show = (full.length ? full : l).slice(0, 14);
  if (my !== RT || !show.length || !$('#art-albums')) return;
  $('#art-albums').innerHTML = `<h2>Albums</h2>${albCards(show)}`;
}
/* v25.5: DOWNLOAD A WHOLE ALBUM. Every song is matched to its YouTube song once (remembered in lm-ar), downloaded like a single song (so all of them are in Downloads)
   and the album is listed in Library -> "Downloaded albums". */
const dlAlbGet = () => { const a = jget('lm-dlalb', []); return Array.isArray(a) ? a : [] };
const dlAlbSet = a => { try { store.set('lm-dlalb', JSON.stringify(a.slice(0, 100))) } catch (e) {} };
const DLALB = {};
const albDlState = id => DLALB[id] ? 'busy' : dlAlbGet().some(x => String(x.id) === String(id)) ? 'ok' : 'dl';
function albBtnPaint(id) {
  const b = $('#alb-dl'); if (!b || b.dataset.id !== String(id)) return; const s = albDlState(id);
  b.innerHTML = s === 'busy' ? '<span class="dl-ring ind"></span> Downloading…' : s === 'ok' ? `<span class="dl-ok">${DL_TICK}</span> Downloaded` : `${ic('dl')} Download`;
}
async function albResolve(t) {
  const map = jget('lm-ar', {}) || {}, key = akey(t.title + ' ' + t.author);
  if (map[key] && map[key].uri) return nt(map[key]);
  const v = (t.title + ' ' + t.author).trim(), d = await api('/api/music/search?query=' + encodeURIComponent(v));
  const l = arr(d.songs).map(nt).filter(x => ytId(x)); if (!l.length) return null;
  const r = rankSearch(l, v, []), s = r.main[0] || r.other[0] || l[0];
  const o = { title: t.title, author: t.author, uri: s.uri, identifier: s.identifier, thumbnail: t.thumbnail || s.thumbnail, duration: t.duration || s.duration };
  map[key] = o; const ks = Object.keys(map); if (ks.length > 400) delete map[ks[0]]; try { store.set('lm-ar', JSON.stringify(map)) } catch (e) {}
  return nt(o);
}
async function dlAlbum(id) {
  if (!isPrem()) return premiumSheet('Downloading songs to listen offline is a Premium feature.');
  if (DLALB[id]) return toast('Album is already downloading');
  if (!navigator.onLine) return toast("You're offline");
  const d = await albTracks(id); if (!d || !d.tracks.length) return toast("Can't load this album");
  DLALB[id] = 1; albBtnPaint(id);
  try {
    const total = d.tracks.length, done = []; let n = 0, idx = 0, bad = 0; toast(`Downloading album 0/${total}…`);
    const worker = async () => { for (;;) {
      const k = idx++; if (k >= total) return; let s = null;
      try { s = await albResolve(d.tracks[k]) } catch (e) {}
      if (!s) { bad++; continue }
      const ok = await dlSong(s, true), sid = ytId(s);
      if (ok || (sid && S.dl[sid])) { soloAdd(sid); done[k] = s; n++; toast(`Downloading album ${n}/${total}…`) } else bad++;
    } };
    await Promise.all([worker(), worker()]);
    const tr = done.filter(Boolean);
    if (tr.length === total) {
      const a = dlAlbGet().filter(x => String(x.id) !== String(id));
      a.unshift({ id, name: d.album.name, artist: d.album.artist, cover: d.album.cover, tracks: tr.map(x => ({ title: x.title, author: x.author, uri: x.uri, identifier: x.identifier, thumbnail: x.thumbnail, duration: x.duration })), ts: Date.now() });
      dlAlbSet(a); toast('Album downloaded'); buzz();
    } else toast(bad ? `${tr.length}/${total} songs downloaded. Tap Download again to finish the album` : 'Download stopped');
  } finally { delete DLALB[id]; albBtnPaint(id); if (location.hash.startsWith('#downloads') || location.hash.startsWith('#library')) route() }
}
const dlAlbHtml = () => { const a = dlAlbGet(); if (!a.length) return '';
  return `<h2>Downloaded albums</h2>` + a.map(x => `<button class="row" data-a="open-album" data-id="${esc(x.id)}"><span class="th" style="${bgi(x.cover)}"></span><span class="tx"><span class="t">${esc(x.name)}<span class="dl-ok">${DL_TICK}</span></span><span class="s">${esc(x.artist)} · Album · ${x.tracks.length} songs · downloaded</span></span><span class="ib more" role="button" data-a="dlalb-rm" data-id="${esc(x.id)}" aria-label="Remove"><svg viewBox="0 0 24 24" style="fill:currentColor;stroke:none"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg></span></button>`).join('') };
/* Library -> Following (artists you follow, with the real album cover) */
const faGet = () => jget('lm-fa-alb', {});
const faCover = a => (faGet()[akey(a.name)] || {}).cover || fixUrl(a.thumbnail) || '/static/pwa/icon-192.png';
const followingHtml = () => { const fa = artistsGet(); if (!fa.length) return '';
  return `<h2>Following</h2>` + fa.map(a => { const k = esc(akey(a.name)), e = faGet()[akey(a.name)];
    return `<button class="row" data-a="open-artist" data-name="${esc(a.name)}"><span class="th" data-fa="${k}" style="${bgi(faCover(a))}"></span><span class="tx"><span class="t">${esc(a.name)}</span><span class="s">Album · <span class="fa-alb" data-fa="${k}">${e ? esc(e.name) : 'Artist'}</span></span></span></button>` }).join('') };
async function faFill() {
  const fa = artistsGet().slice(0, 30), cache = faGet();
  for (const a of fa) {
    const k = akey(a.name); let e = cache[k];
    if (!e || Date.now() - (e.ts || 0) > 6 * 3600e3) { const l = await latestAlbum(a.name, false); if (l) { e = cache[k] = { cover: l.cover, name: l.name, id: l.id, ts: Date.now() }; try { store.set('lm-fa-alb', JSON.stringify(cache)) } catch (x) {} } }
    if (!e) continue;
    document.querySelectorAll('[data-fa]').forEach(n => { if (n.dataset.fa !== k) return; if (n.classList.contains('th')) n.style.backgroundImage = `url('${e.cover}')`; else if (n.classList.contains('fa-alb')) n.textContent = e.name });
  }
}
/* new songs / albums of followed artists -> the bell + the phone notification (checked when the app is opened, at most every 3 hours) */
const relLocal = () => { const a = jget('lm-rel-nt', []); return Array.isArray(a) ? a : [] };
async function checkReleases() {
  try {
    if (S.offline || !navigator.onLine) return;
    const fa = artistsGet(); if (!fa.length) return;
    if (Date.now() - (+store.get('lm-rel-ts') || 0) < 3 * 3600e3) return; store.set('lm-rel-ts', String(Date.now()));
    const sn = jget('lm-rel-seen', {}) || {}; let out = relLocal(), fresh = 0;
    for (const a of fa.slice(0, 25)) {
      const l = await latestAlbum(a.name, true); if (!l) continue; const k = akey(a.name);
      if (sn[k] === undefined) { sn[k] = l.id; continue }   // first time for this artist: remember what is out now, no notification
      if (String(sn[k]) !== String(l.id) && Date.now() - Date.parse(l.date || 0) < 60 * 86400e3) {
        const single = /\s-\s(single|ep)$/i.test(l.name), nm = l.name.replace(/\s-\s(single|ep)$/i, '');
        out.unshift({ id: 'rel-' + l.id, type: 'release', title: a.name, text: `New ${single ? 'song' : 'album'} released today: ${nm}`, created_by_name: 'Artist', _alb: l.id }); fresh++;
      }
      sn[k] = l.id;
    }
    store.set('lm-rel-seen', JSON.stringify(sn)); store.set('lm-rel-nt', JSON.stringify(out.slice(0, 30)));
    if (fresh) { store.set('lm-rel-ts', '0'); loadNotifs() }
  } catch (e) {}
}
/* Now Playing: big download arrow (ring while it downloads, tick when it is saved) */
function npDlPaint(id) {
  const b = $('#np-dl'); if (!b) return; const on = !!(id && S.dl[id]), k = on ? 'ok' : 'dl'; if (b.dataset.k === k) return; b.dataset.k = k;
  b.innerHTML = on ? '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M7.5 12.5l3 3 6-6.5"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg>';
}
/* v25.5: "Created by" + the owner's small logo at the bottom of EVERY page (not on the login screen, it has its own) */
(() => {
  const mk = () => { const d = document.createElement('div'); d.className = 'lm-credit'; d.innerHTML = `<img src="${LG_CREATOR.avatar}" onerror="this.onerror=null;this.src='${LG_CREATOR.fallback}'" alt=""><span>Created by <b>${esc(LG_CREATOR.name)}</b></span>`; return d };
  let busy = false;
  const fix = () => { if (busy || document.body.classList.contains('lg') || !view.firstElementChild) return; const last = view.lastElementChild; if (last && last.classList.contains('lm-credit')) return; busy = true; try { view.querySelectorAll(':scope > .lm-credit').forEach(x => x.remove()); view.appendChild(mk()) } catch (e) {} busy = false };
  let raf = 0; new MutationObserver(() => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; fix() }) }).observe(view, { childList: true });
  setTimeout(fix, 600);
})();
(() => { try { const s = document.createElement('style'); s.textContent = `
.lm-credit{display:flex;align-items:center;justify-content:center;gap:6px;margin:22px 0 8px;font-size:11px;color:var(--mu,#8a8a8a);opacity:.6}
.lm-credit img{width:14px;height:14px;border-radius:50%;object-fit:cover}
.lm-credit b{font-weight:600}
body.lg .lm-credit{display:none}
.np-ex .dlc{position:relative;border:0!important;background:none!important;width:46px!important;height:46px!important;margin:0 6px 0 0!important;display:grid;place-items:center;color:#fff!important}
.np-ex .dlc svg{width:29px!important;height:29px!important;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.np-ex .dlc.on{color:var(--ok,#22c55e)!important}
.np-ex .dlc.busy{opacity:1!important;animation:none!important}
.np-ex .dlc.busy::after{content:'';position:absolute;inset:2px;border-radius:50%;border:3px solid rgba(255,255,255,.18);border-top-color:var(--ok,#22c55e);animation:lmspin .8s linear infinite}
@keyframes lmspin{to{transform:rotate(360deg)}}
.np-meta small.lm-art{cursor:pointer;text-decoration:underline;text-decoration-color:rgba(255,255,255,.3);text-underline-offset:3px}
.hero .lnk{color:inherit;text-decoration:underline;cursor:pointer}`; document.head.appendChild(s) } catch (e) {} })();

async function artistPage(name) {
  const my = RT; view.innerHTML = skel(5);
  try {
    const d = await api('/api/music/search?query=' + encodeURIComponent(name)); if (my !== RT) return;
    L.artist = arr(d.songs).map(nt); S.ctx = name;
    const meta = arr(d.artists).find(a => akey(a.name) === akey(name)) || arr(d.artists)[0] || {};
    const shown = meta.name && akey(meta.name) === akey(name) ? meta.name : name;
    const thumb = fixUrl(meta.thumbnail) || (L.artist[0] && art(L.artist[0])) || '/static/pwa/icon-192.png', fol = isFollowing(shown);
    view.innerHTML = `<button class="btn sm ghost" data-a="pl-back" style="margin:2px 0 8px">‹ Back</button>
      <div class="hero"><span class="cv" style="${bgi(thumb)};border-radius:50%"></span><div><h1>${esc(shown)}</h1><div class="sub">Artist · ${L.artist.length} songs</div></div></div>
      <div class="actions"><button class="btn${fol ? ' ghost' : ''}" data-a="artist-follow" data-name="${esc(shown)}" data-thumb="${esc(thumb)}">${ic(fol ? 'person' : 'plus')} <span>${fol ? 'Following' : 'Follow'}</span></button>
      <button class="btn ghost" data-a="artist-play">${ic('play', 'fill')} Play</button><button class="btn ghost" data-a="artist-shuffle">${ic('shuffle')} Shuffle</button></div><div id="art-albums"></div>` +
      (L.artist.length ? L.artist.map((x, i) => songRow('artist', i, x, moreBtn('artist', i))).join('') : '<div class="empty">No songs found for this artist</div>'); artAlbums(shown);
  } catch (e) { if (my === RT) view.innerHTML = `<div class="empty">${esc(e.message)}</div>` }
}

const statsBox = st => `<h2>Your stats</h2><div class="statgrid"><div><b>${st.plays_week || 0}</b><span>Plays this week</span></div><div><b>${st.plays_total || 0}</b><span>Plays in total</span></div><div><b>${st.likes || 0}</b><span>Liked songs</span></div><div><b>${st.downloads || 0}</b><span>Downloads</span></div></div>${st.top_artist ? `<p class="sub" style="margin-top:8px">Your top artist: <b>${esc(st.top_artist)}</b></p>` : ''}`;
async function you() {
  const m = S.me, role = S.cfg.role, th = store.get('lm-theme') || 'auto', fa = artistsGet(), canEdit = !S.offline;
  let est = ''; try { const e = await navigator.storage.estimate(); est = ' · ' + Math.round((e.usage || 0) / 1048576) + ' MB used' } catch (e) {}
  view.innerHTML = installHero('sm') + `<div class="box" style="display:flex;gap:14px;align-items:center"><span class="av" style="width:64px;height:64px;${bgi(m.avatar)}"${canEdit ? ' data-a="edit-profile"' : ''}>${tick(role)}</span><div style="flex:1;min-width:0"><h3 class="nm">${tick(role)}${esc(m.username)}</h3><span class="sub">${S.prof && S.prof.username ? '@' + esc(S.prof.username) + ' · ' : ''}${roleName(role)} · ${prov()} login</span></div>${canEdit ? '<button class="btn sm ghost" data-a="edit-profile">Edit</button>' : ''}</div>
  <div class="box prem"><h3>${ic('crown', 'gold')} Premium</h3>${isPrem() ? '<span class="sub">You have Premium. Thank you!</span><div id="prem-exp" class="sub"></div>' : '<span class="sub">Create playlists, collaborative playlists, download songs and get the Premium tick.</span>'}
  <ul class="perks"><li>Create & edit playlists</li><li>Collaborative playlists with friends</li><li>Download songs, listen offline</li><li>Lock playlists, covers & banners</li><li>Unlimited liked songs</li><li>Premium tick next to your name</li><li>Public playlists stay public</li></ul>${isPrem() ? '' : '<div class="actions"><a class="btn" href="/premium">Get Premium</a></div>'}</div>
  <div class="box"><h3>Look & feel</h3><div class="seg" id="themes">${[['auto', 'Auto'], ['dark', 'Dark'], ['light', 'White'], ['amoled', 'AMOLED']].map(([k, n]) => `<button data-a="theme" data-k="${k}" class="${th === k ? 'on' : ''}">${n}</button>`).join('')}</div>
    <div class="setrow" data-a="set-bass"><div>Bass boost<div class="sub">Deep, punchy bass. Off = natural bass of the song. Premium also gets cleaner sound</div></div>${sw(store.get('lm-bass') === '1')}</div>
    <div class="setrow" data-a="set-duck"><div>Auto volume (game mode)<div class="sub">Music drops to 35% when you switch to a game or another app, and comes back when you return. Never stops.</div></div>${sw(store.get('lm-duck2') === '1')}</div>
    <div class="setrow" data-a="set-haptic"><div>Vibration feedback</div>${sw(S.haptic)}</div>
    <div class="setrow" data-a="set-ds"><div>Data saver<div class="sub">Lower sound quality and small covers = much less mobile data. Off = best quality.</div></div>${sw(dsOn())}</div>
    ${NAT ? `<div class="setrow" data-a="set-autoupd"><div>Auto-update<div class="sub">Download new versions by itself (you tap Install). Never while music plays.</div></div>${sw(store.get('lm-autoupd') !== '0')}</div>` : ''}</div>
  ${NAT && S.sync && S.sync.stats ? statsBox(S.sync.stats) : ''}
  <h2>Followed artists</h2>${fa.length ? fa.map(a => `<button class="row" data-a="open-artist" data-name="${esc(a.name)}"><span class="th" style="${bgi(fixUrl(a.thumbnail) || '/static/pwa/icon-192.png')};border-radius:50%"></span><span class="tx"><span class="t">${esc(a.name)}</span><span class="s">Artist · tap to open</span></span></button>`).join('') : '<p class="sub">Search an artist and tap Follow. They will show up here.</p>'}
  ${S.upd && S.upd.update_available ? `<div class="box prem" style="display:flex;align-items:center;gap:12px"><div style="flex:1"><h3 style="margin:0">Update available · v${esc(S.upd.version)}</h3><span class="sub">${S.upd.notes ? esc(S.upd.notes) : 'A new version is ready.'}</span></div><button class="btn" data-a="do-update">Update</button></div>` : ''}
  <div class="menu"><button data-a="chk-upd"><svg viewBox="0 0 24 24">${P.refresh}</svg>Check for updates</button>
  <button data-a="open-dl"><svg viewBox="0 0 24 24">${P.dl}</svg>Downloads${est}</button>
  ${S.cfg.is_staff ? '<a href="#admin" data-go="admin"><svg viewBox="0 0 24 24"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/></svg>Admin panel</a>' : ''}
  <a href="/auth/logout"><svg viewBox="0 0 24 24"><path d="M9 4H5v16h4M16 8l4 4-4 4M20 12H9"/></svg>Log out</a></div>
  <p class="sub" style="text-align:center;margin-top:18px">Legacy Music app v${CV}</p>`;
  if (isPrem() && !S.offline) api('/api/premium/status').then(s => { const e = s.player_premium; if ($('#prem-exp') && e && e.active) $('#prem-exp').textContent = e.expires_at ? 'Active until ' + new Date(e.expires_at * (e.expires_at < 1e12 ? 1000 : 1)).toLocaleDateString() : 'Active' }).catch(() => {});
}


/* ───────── in-app Admin (staff only) ───────── */
const ADM = { tab: 'overview', anType: 'announcement', anDur: '24', anOpts: ['', ''] };
const kindIc = { play: 'play', like: 'heart', download: 'dl', follow: 'person', share: 'copy', pl_create: 'music' };
/* ═════════ v23 module: YouTube-Music style player, playlist page + ticks, Admin ═════════ */
const PAN = { open: false, tab: 'up', hist: false, rel: '', lv: -2 };
const carEl = $('#np-car'), imgP = $('#np-art-p'), imgN = $('#np-art-n'); let carKey = '';
[imgP, imgN].forEach(im => im.addEventListener('error', () => { if (im.dataset.fb && im.src !== im.dataset.fb) im.src = im.dataset.fb }));
function carSet() {
  if (mode() !== 'phone') { carEl.classList.add('solo'); return }
  const pv = S.queue[S.qi - 1], nx = S.queue[S.qi + 1], k = (pv ? pv.uri || pv.title : '') + '|' + (nx ? nx.uri || nx.title : '');
  if (k === carKey) return; carKey = k;
  const set = (im, t) => { if (t) { im.dataset.fb = art(t); im.style.visibility = ''; im.src = artHi(t) } else { im.style.visibility = 'hidden'; im.removeAttribute('src') } };
  set(imgP, pv); set(imgN, nx);
  /* v23.6: if there is no next/previous song, hide the side covers completely instead of leaving two empty grey boxes */
  carEl.classList.toggle('solo', !pv && !nx);
}
{ const st = document.createElement('style'); st.textContent = '#np-car.fly .np-sl{transition:transform .45s cubic-bezier(.22,.7,.2,1)}'; document.head.appendChild(st) }   // v23.10: slow, smooth cover slide
function goPrev(fromLock) { act.prev() }
(() => {   // swipe the cover left / right = next / previous song
  let x0 = 0, y0 = 0, dx = 0, lock = 0, t0 = 0, w = 300, on = false;
  const set = v => carEl.style.setProperty('--dx', v + 'px');
  carEl.addEventListener('touchstart', e => { if (e.touches.length !== 1) return; const t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; dx = 0; lock = 0; t0 = Date.now(); on = true; const sl = carEl.querySelector('.np-sl'); w = (sl ? sl.offsetWidth : carEl.clientWidth * .62) + 16; carEl.classList.remove('fly'); carEl.classList.add('drag') }, { passive: true });
  carEl.addEventListener('touchmove', e => { if (!on) return; const t = e.touches[0], mx = t.clientX - x0, my = t.clientY - y0;
    if (!lock && (Math.abs(mx) > 9 || Math.abs(my) > 9)) lock = Math.abs(mx) > Math.abs(my) ? 1 : 2;
    if (lock !== 1) return; dx = mx; const edge = (dx < 0 && !S.queue[S.qi + 1] && !S.auto) || (dx > 0 && S.qi < 1); set(edge ? dx * .3 : dx) }, { passive: true });
  const end = () => { if (!on) return; on = false; carEl.classList.remove('drag');
    if (lock !== 1) { set(0); return }
    const v = Math.abs(dx) / Math.max(1, Date.now() - t0), go = Math.abs(dx) > w * .28 || (v > .5 && Math.abs(dx) > 36), next = dx < 0;
    if (!go || (next && !S.queue[S.qi + 1] && !S.auto) || (!next && S.qi < 1)) { carEl.classList.add('fly'); set(0); return }
    carEl.classList.add('fly'); set(0);   // v25.5: the cover does NOT leave first - the next song starts at once and the new cover comes only when that song really plays
    holdStart(); if (next) act.next(); else goPrev(); };
  carEl.addEventListener('touchend', end, { passive: true }); carEl.addEventListener('touchcancel', end, { passive: true });
})();

/* panel: UP NEXT / LYRICS / RELATED */
function panHead() { const t = S.cur; if (!t) return; $('#pan-th').style.backgroundImage = `url('${art(t)}')`; $('#pan-t').textContent = t.title || ''; $('#pan-s').textContent = t.author || '' }
function panOpen(k) { if (!S.cur) return; PAN.open = true; const p = $('#np-pan'); p.classList.add('on'); p.setAttribute('aria-hidden', 'false'); try { if (!(history.state && history.state.pan)) history.pushState({ np: 1, pan: 1 }, '') } catch (e) {} panHead(); panTab(k || PAN.tab) }
function panHide() { PAN.open = false; const p = $('#np-pan'); p.classList.remove('on'); p.setAttribute('aria-hidden', 'true') }
function panClose() { if (history.state && history.state.pan) history.back(); else panHide() }
function panTab(k) {
  PAN.tab = k; ['up', 'lyr', 'rel'].forEach((n, i) => { $('#pan-' + n).hidden = n !== k; const b = $('#pan-tabs').children[i]; if (b) b.classList.toggle('on', n === k) });
  $('#pan-ul').style.transform = `translateX(${['up', 'lyr', 'rel'].indexOf(k) * 100}%)`;
  if (k === 'up') queueList(); else if (k === 'lyr') lypRender(); else relLoad();
}
function lypRender() {
  const box = $('#pan-lyr'); if (!box) return; PAN.lv = -2;
  if (LY.state === 'loading') box.innerHTML = '<div class="lyv-msg">Loading lyrics…</div>';
  else if (!LY.lines.length && !LY.plain) box.innerHTML = '<div class="lyv-msg">Lyrics are not available for this song yet</div>';
  else if (LY.lines.length) box.innerHTML = '<div class="lyp-in">' + LY.lines.map(l => `<p data-a="lyv-line" data-t="${l.t}">${esc(l.x)}</p>`).join('') + '</div>';
  else box.innerHTML = '<div class="lyp-in">' + LY.plain.split('\n').map(x => x.trim() ? `<p class="pl">${esc(x)}</p>` : '<br>').join('') + '</div>';
  box.scrollTop = 0; if (PAN.open && PAN.tab === 'lyr') lypTick((au.currentTime || 0) * 1000, true);
}
function lypTick(posMs, force) {
  if (!PAN.open || PAN.tab !== 'lyr' || !LY.lines.length) return;
  const i = lyIdx(posMs); if (i === PAN.lv && !force) return; PAN.lv = i;
  const ps = $('#pan-lyr .lyp-in'); if (!ps) return; let cur = null;
  for (let k = 0; k < ps.children.length; k++) { const c = ps.children[k]; c.classList.toggle('cur', k === i); c.classList.toggle('past', k < i); if (k === i) cur = c }
  if (cur) { const b = $('#pan-lyr'); b.scrollTo({ top: cur.offsetTop - b.clientHeight / 2 + cur.offsetHeight / 2, behavior: force ? 'auto' : 'smooth' }) }
}
async function relLoad() {
  const box = $('#pan-rel'), t = S.cur; if (!box || !t) return; const key = t.title + '|' + t.author;
  if (PAN.rel === key) return; PAN.rel = key; box.innerHTML = skel(5);
  const first = String(t.author || '').split(/[,&]/)[0].replace(/\s*-\s*topic$/i, '').trim();
  const [rs, pl, vs] = await Promise.allSettled([
    api('/api/app/related?' + new URLSearchParams({ v: ytId(t) || '', title: t.title || '', author: t.author || '', ex: '', limit: '14', av: CV })),
    api('/api/explore/playlists?limit=12'),
    api('/api/music/search?query=' + encodeURIComponent(cleanT(t.title) + ' ' + first))]);
  if (PAN.rel !== key || !PAN.open) return;
  const base = songBase(t.title);
  L.rel = oneEach(arr(rs.status === 'fulfilled' ? rs.value.songs : []).map(nt).filter(x => !isFakeSong(x, '') && songBase(x.title) !== base)).slice(0, 8);
  L.relv = (vs.status === 'fulfilled' ? arr(vs.value.songs).map(nt) : []).filter(x => x.uri !== t.uri && (songBase(x.title) === base || isFakeSong(x, ''))).slice(0, 8);
  const pls = pl.status === 'fulfilled' ? arr(pl.value) : [];
  box.innerHTML = (L.rel.length ? `<h2>You might also like</h2>${L.rel.map((x, i) => songRow('rel', i, x, moreBtn('rel', i))).join('')}` : '')
    + (pls.length ? `<h2>Recommended playlists</h2>${plCards(pls)}` : '')
    + (L.relv.length ? `<h2>Other performances</h2>${L.relv.map((x, i) => songRow('relv', i, x, moreBtn('relv', i))).join('')}` : '')
    || '<div class="empty">Nothing related yet</div>';
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) { try { for (const k in DLP) { delete DLPAINT[k]; dlProg(k, DLP[k]) } } catch (e) {} } });   // v24.6: repaint the download rings that were not drawn in the background
document.addEventListener('visibilitychange', () => { document.documentElement.classList.toggle('bgd', document.hidden); if (!document.hidden) requestAnimationFrame(() => { try { ui() } catch (e) {} }) });

/* ── lyrics for EVERY song: our server -> lrclib (exact, then search with several spellings) -> lyrics.ovh ── */
async function lyricsFallback(t) {
  const strip = s => cleanT(String(s || '').replace(/\s*-\s*topic$/i, '').replace(/vevo$/i, '')).replace(/\b(official|lyrics?|lyrical|audio|video|full song|hd|4k)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  const rawT = String(t.title || ''), au0 = strip(String(t.author || '').split(/[,&]|\bfeat\b|\bft\b/i)[0]), parts = rawT.split(/\s[-–—]\s/);
  // "Artist - Song" titles (the channel name is often not the singer): try that split first
  let title = strip(rawT), art_ = au0;
  if (parts.length >= 2) { const a2 = strip(parts[0].split(/[,&]|\bfeat\b|\bft\b/i)[0]), s2 = strip(parts.slice(1).join(' - ')); if (a2 && s2) { title = s2; art_ = a2 } }
  const dur = Math.round((t.duration || 0) / 1000), eu = encodeURIComponent;
  const tm = (u, ms) => Promise.race([fetch(u).then(r => r.ok ? r.json() : null), new Promise((_, rj) => setTimeout(() => rj(new Error('t')), ms || 5500))]).catch(() => null);
  const pick = a => { if (!Array.isArray(a) || !a.length) return null; const ok = a.filter(x => !dur || !x.duration || Math.abs(x.duration - dur) <= 8); const pool = ok.length ? ok : a; return pool.find(x => x.syncedLyrics) || pool.find(x => x.plainLyrics) || null };
  const mk = d => { let lines = parseLrc(d.syncedLyrics || ''); const plain = d.plainLyrics || lines.map(l => l.x).join('\n'), pn = plain.split('\n').filter(x => x.trim()).length; if (lines.length && pn > 8 && lines.length < pn * .6) lines = []; return { lines, plain } };   // v24.3: a timed list that misses a big part of the song -> show the full text instead
  // v24: every lrclib question is asked AT THE SAME TIME (before: one after another, up to 7 s each)
  const getP = tm(`https://lrclib.net/api/get?track_name=${eu(title)}&artist_name=${eu(art_)}${dur ? '&duration=' + dur : ''}`, 5000);
  const sPs = [title + ' ' + art_, title, au0 + ' ' + title, strip(rawT), rawT.replace(/\(.*?\)|\[.*?\]/g, ' ')].filter((q, k, r) => q.trim() && r.indexOf(q) === k).map(q => tm('https://lrclib.net/api/search?q=' + eu(q.trim()), 5500).then(pick));
  const g = await getP;
  if (g && g.syncedLyrics) return mk(g);                                   // timed lyrics first
  for (const p of sPs) { const r = await p; if (r && r.syncedLyrics) return mk(r) }
  if (g && g.plainLyrics) return mk(g);
  for (const p of sPs) { const r = await p; if (r) return mk(r) }
  const r2 = pick(await tm(`https://lrclib.net/api/search?track_name=${eu(title)}`, 5000)); if (r2) return mk(r2);
  /* v25.5: messy YouTube titles ("SHADY AF (official Video) Jass Goraya | Prem Dhillon | The Takeover") -> the clean song name (before the "|" and without brackets)
     and the official name from the catalogue; each one is asked with and without the singer, the answer must really be that song (name check + time check) */
  try {
    const t1 = strip(rawT.split('|')[0].replace(/\(.*?\)|\[.*?\]/g, ' ')), names = new Set(); if (t1) names.add(t1); if (title) names.add(title);
    try { const sg = await ituSong(((t1 || title) + ' ' + au0).trim()); sg.slice(0, 3).forEach(s => { if (s.title && sameArtist(s.artist, au0 || art_)) names.add(strip(s.title)) }) } catch (e) {}
    const ex = []; [...names].filter(Boolean).slice(0, 4).forEach(nm => {
      ex.push(tm(`https://lrclib.net/api/search?track_name=${eu(nm)}&artist_name=${eu(au0 || art_)}`, 8000).then(a => [nm, a]));
      ex.push(tm(`https://lrclib.net/api/search?q=${eu((nm + ' ' + (au0 || art_)).trim())}`, 8000).then(a => [nm, a]));
      ex.push(tm(`https://lrclib.net/api/search?track_name=${eu(nm)}`, 8000).then(a => [nm, a]));
    });
    const rs = await Promise.all(ex), loose = (nm, a) => { if (!Array.isArray(a)) return []; const n = albNorm(nm); return a.filter(x => { if (dur && x.duration && Math.abs(x.duration - dur) > 25) return false; const tn = albNorm(x.trackName || x.name || ''); return n && tn && (tn === n || (n.length > 3 && (tn.includes(n) || n.includes(tn)))) }) };
    const all = []; rs.forEach(([nm, a]) => all.push(...loose(nm, a)));
    const best = all.find(x => x.syncedLyrics) || all.find(x => x.plainLyrics); if (best) return mk(best);
    for (const nm of [...names].slice(0, 2)) { const o2 = await tm(`https://api.lyrics.ovh/v1/${eu(au0 || art_)}/${eu(nm)}`, 6000); if (o2 && o2.lyrics) return { lines: [], plain: String(o2.lyrics).replace(/\r/g, '').trim() } }
  } catch (e) {}
  const o = await tm(`https://api.lyrics.ovh/v1/${eu(art_)}/${eu(title)}`, 6000);
  if (o && o.lyrics) return { lines: [], plain: String(o.lyrics).replace(/\r/g, '').trim() };
  return null;
}

/* ── playlist ticks, owner logo, views ── */
const PTK = { map: {} };
async function ptkLoad() { try { const d = await api('/api/app/pl-ticks'); PTK.map = (d && d.ticks) || {} } catch (e) {} }
const plTickKind = p => { const c = String(p.code || '').toUpperCase(); const m = (c in PTK.map) ? PTK.map[c] : (p.badge || p.tick || ''); return m || (p.owner_role === 'owner' ? 'owner' : ['premium', 'admin'].includes(p.owner_role) ? 'premium' : '') };
/* v23.0: the creator's tick sits ON the creator's logo (top-right, like a verified badge) and the name follows.
   Before this the tick was printed outside, next to the name — that is what looked wrong.
   Whatever tick the account has (owner / admin / premium / official) is the one that shows. */
const plCvTick = p => { const k = plTickKind(p); return (k && TICKS[k]) ? `<img class="ptk" data-tk="${esc(k)}" src="/static/badges/${TICKS[k]}" alt="${esc(k)}">` : '' };
/* v23.2: the same tick on EVERY playlist cover (home cards, Album of the week, lists, library, search ...) and a tap on ANY tick opens a small info popup. */
const ptkImg = p => plCvTick(p);
function ptkApply() {          // covers that were drawn without a tick: add it from the server's tick list
  document.querySelectorAll('[data-plcode]').forEach(el => {
    if (el.dataset.plkind === 'bg' || el.querySelector(':scope > img.ptk')) return;
    const k = PTK.map[String(el.dataset.plcode || '').toUpperCase()];
    if (k && TICKS[k]) el.insertAdjacentHTML('beforeend', `<img class="ptk" data-tk="${esc(k)}" src="/static/badges/${TICKS[k]}" alt="${esc(k)}">`);
  });
}
const TKINFO = {
  owner:    { t: 'Owner',    u: 'This is the owner of Legacy Music.',                     p: 'This playlist belongs to the owner of Legacy Music.' },
  admin:    { t: 'Admin',    u: 'This account is a Legacy Music admin.',                  p: 'This playlist belongs to a Legacy Music admin.' },
  premium:  { t: 'Premium',  u: 'This user has Legacy Music Premium.',                    p: 'This playlist was made by a Premium member.' },
  official: { t: 'Official', u: 'This is an official Legacy Music account.',              p: 'This is an official Legacy Music playlist.' }
};
document.addEventListener('click', e => {
  const old = document.getElementById('tkpop');
  const t = e.target.closest && e.target.closest('img.tick, img.ptk');
  if (!t) { if (old) old.remove(); return }
  e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
  if (old) old.remove();
  const k = t.dataset.tk || t.getAttribute('alt') || '', info = TKINFO[k]; if (!info) return;
  const pop = document.createElement('div'); pop.id = 'tkpop';
  pop.innerHTML = `<img src="${esc(t.getAttribute('src'))}" alt=""><div><b>${esc(info.t)}</b><span>${esc(t.classList.contains('ptk') ? info.p : info.u)}</span></div>`;
  document.body.appendChild(pop);
  const r = t.getBoundingClientRect(), w = pop.offsetWidth;
  pop.style.left = Math.max(10, Math.min(innerWidth - w - 10, r.left + r.width / 2 - w / 2)) + 'px';
  pop.style.top = Math.min(innerHeight - pop.offsetHeight - 10, r.bottom + 8) + 'px';
  setTimeout(() => { const p = document.getElementById('tkpop'); if (p === pop) p.remove() }, 4500);
}, true);
const plOwnerLine = p => {
  const k = plTickKind(p), av = fixUrl(p.owner_avatar);
  const logo = av ? `<span class="av sm" style="${bgi(av)}">${(k && TICKS[k]) ? `<img class="tick" data-tk="${esc(k)}" src="/static/badges/${TICKS[k]}" alt="${esc(k)}">` : ''}</span>` : '';
  if (!p.owner_name && !av) return '';
  const nameTick = (!av && k && TICKS[k]) ? `<img class="tick" data-tk="${esc(k)}" src="/static/badges/${TICKS[k]}" alt="${esc(k)}">` : '';
  const mine = S.me && p.owner_id != null && String(p.owner_id) === String(S.me.id);
  const un = String(p.owner_username || p.owner_handle || (mine ? S.me.handle : '') || '').replace(/^@/, '');
  const nm = p.owner_display_name || p.owner_name || '';
  return `<div class="plown">${logo}${nameTick}<div class="pwho"><span class="pn">${esc(nm)}</span>${un ? `<span class="un">@${esc(un)}</span>` : ''}</div>${p.views != null ? `<span class="sub">· ${fmtViews(p.views)} views</span>` : ''}</div>`;
};

/* ── playlist create / edit as its own full page ── */
const PF = { cover: null, bg: null, rmCover: false, rmBg: false };
const pfFile = (() => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.hidden = true; document.body.appendChild(i); return i })();
let pfKind = '';

// FIX: Request gallery permission on Android before opening the picker.
//      On web / iOS this is a no-op; on Android it ensures the picker doesn't silently fail.
// The phone's own photo picker (LMChrome.onShowFileChooser) needs no storage permission, so there is nothing to wait for.
async function requestGalleryPermission() { return true }

pfFile.addEventListener('change', async () => {
  const f = pfFile.files && pfFile.files[0]; pfFile.value = ''; if (!f) return;
  try {
    const bgk = pfKind === 'bg', data = await cropImage(f, bgk ? 2 : 1, 1, bgk ? 1080 : 640, bgk ? 540 : 640); if (!data) return;
    PF[pfKind] = data; PF[bgk ? 'rmBg' : 'rmCover'] = false;
    const el = $('#pf-' + pfKind); if (el) { el.style.backgroundImage = `url('${data}')`; el.classList.add('has') }
  } catch (er) { toast(er.message) }
});

// FIX: Lightweight pinch-zoom + drag for the cover/background preview so user can reposition
// (zoom-in / zoom-out before saving). PF stores the adjusted data-uri after they confirm.
function pfEnablePinchZoom(el, kind) {
  if (el._pz) return; el._pz = 1;   // attach once only (picking a photo twice used to stack listeners)
  let scale = 1, ox = 0, oy = 0, lastDist = 0, dragging = false, lx = 0, ly = 0;
  const apply = () => { el.style.backgroundSize = `${Math.round(scale * 100)}%`; el.style.backgroundPosition = `calc(50% + ${ox}px) calc(50% + ${oy}px)` };
  el.addEventListener('touchstart', e => {
    if (e.touches.length === 2) { lastDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); dragging = false }
    else if (e.touches.length === 1) { dragging = true; lx = e.touches[0].clientX; ly = e.touches[0].clientY }
  }, { passive: true });
  el.addEventListener('touchmove', e => {
    if (e.touches.length === 2) {
      const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      if (lastDist) scale = Math.max(1, Math.min(3, scale * (d / lastDist)));
      lastDist = d; apply();
    } else if (e.touches.length === 1 && dragging) {
      ox += e.touches[0].clientX - lx; oy += e.touches[0].clientY - ly;
      lx = e.touches[0].clientX; ly = e.touches[0].clientY; apply();
    }
  }, { passive: true });
  el.addEventListener('touchend', () => { lastDist = 0; dragging = false }, { passive: true });
}
async function plForm(kind, code) {
  const my = RT; PF.cover = PF.bg = null; PF.rmCover = PF.rmBg = false;
  const edit = kind === 'edit', collab = kind === 'collab';
  if (!edit && !isPrem()) { view.innerHTML = '<div class="empty">Creating playlists is a Premium feature.</div>'; premiumSheet(collab ? 'Collaborative playlists are a Premium feature.' : 'Creating your own playlists is a Premium feature.'); return }
  let meta = {}; if (edit) { view.innerHTML = skel(4); meta = (L.plMeta && String(L.plMeta.code || code).toUpperCase() === String(code).toUpperCase() ? L.plMeta : null) || await api('/api/playlist/info?code=' + encodeURIComponent(code)).catch(() => ({})); if (my !== RT) return; code = String(code).toUpperCase() }
  const m = PA.map[code] || {}, cv = edit ? (fixUrl(meta.cover_image_url) || '') : '', bn = edit ? (fixUrl(meta.banner_image_url) || '') : '';
  view.innerHTML = `<button class="btn sm ghost" data-a="pf-back" style="margin:2px 0 8px">‹ Back</button>
    <h1>${edit ? 'Edit playlist' : collab ? 'New collaborative playlist' : 'New playlist'}</h1>
    ${collab ? '<p class="sub">Friends with the invite link can add songs. Collaborative playlists are public while you have Premium.</p>' : ''}
    <div class="pf-namebox"><span class="pf-nico">${ic('music')}</span><div class="pf-nin"><label for="pf-name">Playlist name</label><input id="pf-name" maxlength="60" placeholder="Give your playlist a name" autocomplete="off" value="${esc(meta.name || '')}"></div><span class="pf-cnt" id="pf-cnt">0/60</span></div>
    <label class="pf-l">Cover photo</label>
    <div class="pf-pick"><span id="pf-cover" class="pf-prev sq${cv || m.cover ? ' has' : ''}" data-plcode="${esc(code || '')}" style="${cv ? bgi(cv) : ''}"></span><div><button class="btn sm ghost" data-a="pf-pick" data-kind="cover">${ic('edit')} Upload photo</button>${edit && (m.cover || cv) ? `<button class="btn sm ghost" data-a="pf-rm" data-kind="cover">Remove</button>` : ''}</div></div>
    <label class="pf-l">Background</label>
    <div class="pf-pick"><span id="pf-bg" class="pf-prev wide${bn || m.bg ? ' has' : ''}" data-plcode="${esc(code || '')}" data-plkind="bg" style="${bn ? bgi(bn) : ''}"></span><div><button class="btn sm ghost" data-a="pf-pick" data-kind="bg">${ic('edit')} Upload photo</button>${edit && (m.bg || bn) ? `<button class="btn sm ghost" data-a="pf-rm" data-kind="bg">Remove</button>` : ''}</div></div>
    <div class="actions" style="margin-top:18px"><button class="btn" data-a="pf-save" data-mode="${kind}" data-pid="${esc(meta.id || '')}" data-code="${esc(code || '')}">${edit ? 'Save changes' : 'Create playlist'}</button><button class="btn ghost" data-a="pf-back">Cancel</button></div>
    ${edit && meta.is_owner ? `<div class="box danger"><h3>Delete playlist</h3><span class="sub">This removes the playlist for good.</span>${meta.views != null ? `<div class="sub">👁 ${fmtViews(meta.views)} views</div>` : ''}<div class="actions"><button class="btn bad" data-a="pf-del" data-pid="${esc(meta.id || '')}" data-code="${esc(code)}">Delete playlist</button></div></div>` : ''}`;
  { const ni = $('#pf-name'), cn = $('#pf-cnt'); if (ni && cn) { const u = () => { cn.textContent = ni.value.length + '/60' }; ni.addEventListener('input', u); u() } }
  if (!edit) setTimeout(() => { const n = $('#pf-name'); n && n.focus() }, 60);
}
async function pfSave(el) {
  const mode_ = el.dataset.mode, name = ($('#pf-name').value || '').trim(); if (!name) return toast('Please enter a playlist name');
  let code = el.dataset.code; el.disabled = true;
  try {
    if (mode_ === 'edit') { if (el.dataset.pid) await api(`/api/playlists/${el.dataset.pid}`, { method: 'PATCH', body: { name } }); ev('pl_edit', { title: name, code }) }
    else { const r = await api('/api/playlists', { method: 'POST', body: mode_ === 'collab' ? { name, is_public: true } : { name } }); code = r.code;
      el.dataset.mode = 'edit'; el.dataset.code = code; if (r.id != null) el.dataset.pid = r.id; api('/api/app/app-playlists/' + encodeURIComponent(code), { method: 'POST' }).catch(() => {}); ev('pl_create', { title: name, code, extra: mode_ === 'collab' ? 'collab' : '' }) }
    for (const k of ['cover', 'bg']) {
      if (PF[k]) { const r = await api(`/api/app/pl-art/${encodeURIComponent(code)}/${k}`, { method: 'POST', body: { data: PF[k] } }); PA.map[code] = { ...(PA.map[code] || {}), [k]: r.ts } }
      else if (PF[k === 'bg' ? 'rmBg' : 'rmCover']) { await api(`/api/app/pl-art/${encodeURIComponent(code)}/${k}`, { method: 'DELETE' }).catch(() => {}); if (PA.map[code]) delete PA.map[code][k] }
    }
    toast(mode_ === 'edit' ? 'Playlist updated' : 'Playlist created'); buzz();
    if (mode_ === 'collab') { location.hash = '#code/' + code } else location.hash = '#code/' + code;
  } catch (er) { el.disabled = false; if (er.status === 403) premiumSheet('Creating playlists is a Premium feature.'); else toast(er.message) }
}

/* ── Admin (staff only). Needs the /api/app/admin/* endpoints on the server (see appsync.py) ── */
const isOwner = () => S.cfg.role === 'owner';
let admLiveT = null;
function admCount(el, to) { const from = +el.dataset.v || 0; el.dataset.v = to; const t0 = performance.now(); (function f(n) { const k = Math.min(1, (n - t0) / 900); el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(f) })(t0) }
async function admLive() {
  clearTimeout(admLiveT); if (!/^#admin/.test(location.hash)) return;
  try { const d = await api('/api/app/admin/logins?limit=1'); const el = $('#adm-live-n'); if (el) admCount(el, d.total != null ? d.total : arr(d.users).length) } catch (e) {}
  admLiveT = setTimeout(admLive, 20000);
}
const admErr = e => `<div class="notice">${e.status === 404 || e.status === 405 ? 'Admin API not found on the server. Copy the new <b>appsync.py</b> into the dashboard folder and restart the bot.' : esc(e.message || 'Failed')}</div>`;
const anOptRows = (opts) => (opts && opts.length ? opts : ['', '']).map((v, i) => `<div class="an-opt"><span class="n">${i + 1}</span><input class="an-oi" maxlength="60" placeholder="Option ${i + 1}" value="${esc(v || '')}">${i > 1 ? '<button class="an-x" data-a="an-opt-del" data-i="' + i + '" aria-label="Remove">✕</button>' : ''}</div>`).join('');
const anOptsRead = () => [...document.querySelectorAll('#an-opt-list .an-oi')].map(i => i.value.trim()).filter(Boolean);
const anOptsPaint = () => { const l = $('#an-opt-list'); if (!l) return; ADM.anOpts = anOptsRead(); l.innerHTML = anOptRows(ADM.anOpts.length ? ADM.anOpts : ['', '']); };
const admU = u => `<div class="row adm-u" data-uid="${esc(u.id)}"><span class="th av" style="border-radius:50%;${bgi(fixUrl(u.avatar) || '/static/pwa/icon-192.png')}">${tick(u.role)}</span><span class="tx"><span class="t">${esc(u.name || u.username || u.id)} <small class="sub">${roleName(u.role)}${u.via ? ' · ' + (u.via === 'google' ? 'Google' : 'Discord') : ''}</small></span><span class="s">${u.username ? '@' + esc(u.username) + ' · ' : ''}ID ${esc(u.id)}${u.bio ? ' · ' + esc(u.bio) : ''}${u.joined ? ' · joined ' + esc(u.joined) : ''}${u.last_seen ? ' · seen ' + esc(u.last_seen) : ''}${u.premium_until ? ' · premium till ' + esc(u.premium_until) : ''}</span></span><button class="btn sm ghost" data-a="adm-user" data-uid="${esc(u.id)}" data-name="${esc(u.name || u.username || '')}" data-role="${esc(u.role || '')}">Manage</button></div>`;
async function adminPage(tab) {
  if (!S.cfg.is_staff) { location.hash = '#you'; return }
  ADM.tab = tab || ADM.tab; const my = RT, tabs = [['overview', 'Overview'], ['logins', 'Logins'], ['users', 'Users'], ['playlists', 'Playlists'], ['announce', 'Announce'], ['activity', 'Activity'], ['updates', 'Updates']];
  view.innerHTML = `<button class="btn sm ghost" data-a="adm-back" style="margin:2px 0 8px">‹ Back</button><div class="adm-head"><h1>Admin</h1><div class="adm-live"><i></i><b id="adm-live-n" data-v="0">0</b><span>logged in</span></div></div><div class="seg adm-seg" id="adm-tabs">${tabs.map(([k, n]) => `<button data-a="adm-tab" data-k="${k}" class="${ADM.tab === k ? 'on' : ''}">${n}</button>`).join('')}</div><div id="adm-body">${skel(4)}</div>`;
  admLive(); let h = '';
  try {
    if (ADM.tab === 'overview') {
      const d = await api('/api/app/admin/summary'), s = d.stats || {}; if (my !== RT) return;
      h = `<div class="statgrid" style="margin-top:12px">${[['installs', 'Joined the app'], ['apk_downloads', 'APK downloads'], ['new_today', 'New today'], ['new_week', 'New this week'], ['active_today', 'Active today'], ['plays_today', 'Plays today'], ['premium', 'Premium'], ['downloads', 'Song downloads']].map(([k, n]) => `<div><b>${s[k] || 0}</b><span>${n}</span></div>`).join('')}</div>
      <h2>Top songs</h2>${arr(d.top_songs).map((x, i) => `<div class="row"><span class="d" style="width:18px">${i + 1}</span><span class="tx"><span class="t">${esc(x.title)}</span><span class="s">${esc(x.author)}</span></span><span class="d">${x.plays} plays</span></div>`).join('') || '<p class="sub">No data yet</p>'}
      <h2>Most active users</h2>${arr(d.top_users).map((x, i) => `<div class="row"><span class="d" style="width:18px">${i + 1}</span><span class="tx"><span class="t">${esc(x.name)}</span></span><span class="d">${x.plays} plays</span></div>`).join('') || '<p class="sub">No data yet</p>'}`;
    } else if (ADM.tab === 'logins') {
      const d = await api('/api/app/admin/logins?limit=200'); if (my !== RT) return; const us = arr(d.users);
      h = `<div class="box"><h3>Users who logged in</h3><span class="sub">${d.total != null ? d.total : us.length} people · newest first</span></div>` + (us.map(u => `<div class="row"><span class="th av" style="border-radius:50%;${bgi(fixUrl(u.avatar) || '/static/pwa/icon-192.png')}">${tick(u.role)}</span><span class="tx"><span class="t">${esc(u.name || u.username || u.id)}</span><span class="s">ID ${esc(u.id)} · ${esc(u.platform || 'app')} · ${esc(u.last_login || '')}${u.logins ? ' · ' + u.logins + ' logins' : ''}</span></span></div>`).join('') || '<p class="sub">Nobody yet</p>');
    } else if (ADM.tab === 'users') {
      h = `<div class="search"><input id="adm-q" placeholder="Search name or Discord ID" autocomplete="off"></div><div id="adm-ul">${skel(4)}</div>`; $('#adm-body').innerHTML = h;
      const load = async () => { const q = ($('#adm-q') || {}).value || ''; try { const d = await api('/api/app/admin/users?limit=80&q=' + encodeURIComponent(q)); if ($('#adm-ul')) $('#adm-ul').innerHTML = arr(d.users || d).map(admU).join('') || '<p class="sub">No users</p>' } catch (e) { if ($('#adm-ul')) $('#adm-ul').innerHTML = admErr(e) } };
      let tm; $('#adm-q').addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(load, 300) }); await load(); return;
    } else if (ADM.tab === 'playlists') {
      h = `<div class="search"><input id="adm-q" placeholder="Search playlist name or code" autocomplete="off"></div><div id="adm-pl">${skel(4)}</div>`; $('#adm-body').innerHTML = h;
      const load = async () => { const q = ($('#adm-q') || {}).value || ''; try { const d = await api('/api/app/admin/playlists?limit=100&q=' + encodeURIComponent(q)); L.admpl = arr(d.playlists || d); if ($('#adm-pl')) $('#adm-pl').innerHTML = L.admpl.map(admP).join('') || '<p class="sub">No playlists</p>' } catch (e) { if ($('#adm-pl')) $('#adm-pl').innerHTML = admErr(e) } };
      let tm; $('#adm-q').addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(load, 300) }); await load(); return;
    } else if (ADM.tab === 'announce') {
      ADM.anType = ADM.anType || 'announcement'; ADM.anDur = ADM.anDur || '24';
      const durs = [['1', '1 hour'], ['6', '6 hours'], ['24', '24 hours'], ['72', '3 days'], ['168', '7 days'], ['0', 'No expiry']];
      h = `<div class="box an-box"><h3><img class="em-lg" src="/static/emojis/announce.svg" alt=""> New post</h3>
        <span class="sub">Shows in the bell on every phone — as an announcement, a poll or a question.</span>
        <div class="an-seg" id="an-type">${[['announcement', 'announce', 'Announcement'], ['poll', 'poll', 'Poll'], ['question', 'question', 'Question']].map(([k, e, n]) => `<button data-a="an-type" data-k="${k}" class="${ADM.anType === k ? 'on' : ''}"><img class="em" src="/static/emojis/${e}.svg" alt=""><span>${n}</span></button>`).join('')}</div>
        <span class="lbl">Card emoji</span>
        <div class="an-em-row" id="an-em-row">${(() => { const base = ['announce.svg', 'poll.svg', 'question.svg', 'legacy.svg']; const cur = ADM.anEmoji || 'announce.svg'; const all = base.includes(cur) ? base : [cur].concat(base); return all.map(f => `<button data-a="an-em" data-k="${f}" class="${cur === f ? 'on' : ''}"><img src="/static/emojis/${f}" alt=""></button>`).join('') })()}<button class="an-em-up" data-a="an-em-up" title="Upload your own emoji">+</button></div>
        <input id="an-t" maxlength="80" placeholder="Title">
        <textarea id="an-x" maxlength="800" rows="4" placeholder="Message"></textarea>
        <div id="an-opts" ${ADM.anType === 'announcement' ? 'hidden' : ''}><span class="lbl">Options — people pick one</span><div id="an-opt-list">${anOptRows(ADM.anOpts)}</div><button class="btn sm ghost" data-a="an-opt-add">+ Add option</button></div>
        <span class="lbl">How long should it stay up?</span>
        <div class="an-dur" id="an-dur">${durs.map(([v, n]) => `<button data-a="an-dur" data-v="${v}" class="${ADM.anDur === v ? 'on' : ''}">${n}</button>`).join('')}</div>
        <div class="actions"><button class="btn" data-a="adm-announce">Send to everyone</button></div>
        <div class="an-hint">Signed as <b>Legacy Music</b> · your name shows on the card.</div></div>`;
    } else if (ADM.tab === 'activity') {
      const d = await api('/api/app/admin/activity?limit=60'); if (my !== RT) return;
      h = arr(d.events || d).map(e => `<div class="row"><span class="ib" style="flex:none">${ic(kindIc[e.kind] || 'clock')}</span><span class="tx"><span class="t">${esc(e.user)} <small class="sub">${esc(e.kind)}</small></span><span class="s">${esc(e.title || '')}${e.author ? ' · ' + esc(e.author) : ''}</span></span><span class="d">${esc(e.ts || '')}</span></div>`).join('') || '<p class="sub">No activity yet</p>';
    } else {
      admApk.value = '';   // the label below says "No file chosen", so the hidden input must be empty too
      h = `<div class="box"><h3>Push an APK update</h3><span class="sub">This app is v${CV}${S.upd && S.upd.version ? ' · server has v' + esc(S.upd.version) : ''}</span>
        <input id="adm-ver" placeholder="New version, e.g. 24.1" inputmode="decimal"><input id="adm-notes" placeholder="What's new (shown to users)">
        <div class="pf-pick" style="margin-top:8px"><button class="btn sm ghost" data-a="adm-apk-pick">${ic('dl')} Choose APK file</button><span class="sub" id="adm-apk-n">No file chosen</span></div>
        <div class="actions"><button class="btn" data-a="adm-push">Publish update</button></div></div>`;
    }
  } catch (e) { if (e.status === 401) throw e; h = admErr(e) }
  if (my !== RT) return; $('#adm-body').innerHTML = h;
}
const admP = p => `<div class="row adm-u"><span class="th" data-plcode="${esc(p.code)}" style="${bgi(fixUrl(p.cover) || fixUrl(p.cover_image_url) || '/static/pwa/icon-192.png')}">${ptkImg(p)}</span><span class="tx"><span class="t">${esc(p.name)}</span><span class="s"><span class="oav" style="${bgi(fixUrl(p.owner_avatar) || '/static/pwa/icon-192.png')}"></span>${esc(p.owner_name || '')}${p.owner_role && TICKS[p.owner_role] ? ` <img class="otk" data-tk="${esc(p.owner_role)}" src="/static/badges/${TICKS[p.owner_role]}" alt="${esc(p.owner_role)}">` : ''} · ${esc(p.code)} · ${p.tracks != null ? p.tracks + ' songs · ' : ''}👁 ${fmtViews(p.views || 0)}${p.source ? ' · ' + esc(p.source) : ''}</span></span>${isOwner() ? `<button class="btn sm ghost" data-a="adm-pl" data-code="${esc(p.code)}">Manage</button>` : ''}</div>`;
/* v23: upload your own emoji art for announcements (saved in static/emojis/) */
const anEmojiFile = (() => {
  const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/svg+xml,image/png,image/jpeg,image/webp,image/gif'; i.hidden = true; document.body.appendChild(i);
  i.addEventListener('change', async () => {
    const f = i.files[0]; if (!f) return;
    if (f.size > 1048576) return toast('Keep the emoji under 1 MB');
    const fd = new FormData(); fd.append('file', f, f.name);
    try {
      const r = await fetch(U('/api/app/admin/emoji'), { method: 'POST', credentials: NAT ? 'omit' : 'same-origin', headers: TOK ? { Authorization: 'Bearer ' + TOK } : { 'X-LM-Platform': 'pwa' }, body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || 'Upload failed');
      ADM.anEmoji = j.key;
      const row = $('#an-em-row');
      if (row) {
        let b = row.querySelector(`button[data-k="${j.key}"]`);
        if (!b) { b = document.createElement('button'); b.dataset.a = 'an-em'; b.dataset.k = j.key; b.innerHTML = `<img src="${j.url}" alt="">`; row.insertBefore(b, row.lastElementChild) }
        row.querySelectorAll('button[data-a="an-em"]').forEach(x => x.classList.toggle('on', x.dataset.k === j.key));
      }
      toast('Emoji added'); buzz();
    } catch (er) { toast(er.message || 'Upload failed') }
  });
  return i;
})();
const admApk = (() => { const i = document.createElement('input'); i.type = 'file'; i.accept = '.apk,application/vnd.android.package-archive'; i.hidden = true; document.body.appendChild(i); i.addEventListener('change', () => { const n = $('#adm-apk-n'); if (n) n.textContent = i.files[0] ? i.files[0].name + ' (' + (i.files[0].size / 1048576).toFixed(1) + ' MB)' : 'No file chosen' }); return i })();
async function admPush() {
  const v = ($('#adm-ver').value || '').trim(), n = ($('#adm-notes').value || '').trim(), f = admApk.files[0]; if (!v) return toast('Enter a version');
  const pb = document.querySelector('[data-a="adm-push"]'); if (pb) { if (pb.disabled) return; pb.disabled = true }
  try {
    if (f) { toast('Uploading APK…'); const fd = new FormData(); fd.append('version', v); fd.append('notes', n); fd.append('file', f, f.name);
      const r = await fetch(U('/api/app/admin/apk'), { method: 'POST', credentials: NAT ? 'omit' : 'same-origin', headers: TOK ? { Authorization: 'Bearer ' + TOK } : { 'X-LM-Platform': 'pwa' }, body: fd }); if (!r.ok) { let j = null; try { j = await r.json() } catch (e) {} throw new Error((j && j.detail) || 'Upload failed (' + r.status + ')') } }
    else await api('/api/app/admin/update', { method: 'POST', body: { version: v, notes: n } });
    admApk.value = ''; const nl = $('#adm-apk-n'); if (nl) nl.textContent = 'No file chosen';   // so the old APK is never re-sent by mistake
    toast('Update published'); buzz();
  } catch (er) { toast(er.message || 'Failed') }
  finally { if (pb) pb.disabled = false }
}
function admUserSheet(el) {
  const uid = el.dataset.uid, nm = el.dataset.name, role = el.dataset.role, isP = ['premium', 'admin', 'owner'].includes(role);
  sheet(`<h3>${esc(nm || uid)}</h3><p class="sub">ID ${esc(uid)} · ${roleName(role)}</p>
    <div class="menu"><button data-a="adm-grant" data-uid="${esc(uid)}" data-kind="premium" data-act="give" data-days="30">Give Premium · 30 days</button>
    <button data-a="adm-grant" data-uid="${esc(uid)}" data-kind="premium" data-act="give" data-days="90">Give Premium · 90 days</button>
    <button data-a="adm-grant" data-uid="${esc(uid)}" data-kind="premium" data-act="give" data-days="365">Give Premium · 1 year</button>
    <button data-a="adm-grant" data-uid="${esc(uid)}" data-kind="premium" data-act="give" data-days="0">Give Premium · forever</button>
    ${role === 'premium' ? `<button data-a="adm-grant" data-uid="${esc(uid)}" data-kind="premium" data-act="remove">Remove Premium</button>` : ''}
    ${isOwner() && role !== 'owner' ? (role === 'admin' ? `<button data-a="adm-grant" data-uid="${esc(uid)}" data-kind="admin" data-act="remove">Remove Admin</button>` : `<button data-a="adm-grant" data-uid="${esc(uid)}" data-kind="admin" data-act="give">Make Admin</button>`) : ''}</div>
    <div class="actions"><button class="btn ghost" data-a="close-sheet">Close</button></div>`);
}
function admPlSheet(code) {
  const p = (L.admpl || []).find(x => x.code === code) || { code }, k = plTickKind(p);
  sheet(`<h3>${esc(p.name || code)}</h3><p class="sub">${esc(code)} · ${esc(p.owner_name || '')} · 👁 ${fmtViews(p.views || 0)} views</p>
    <div class="menu"><button data-a="adm-tick" data-code="${esc(code)}" data-tick="official">${tick('official')} Give yellow Official tick${k === 'official' ? ' ✓' : ''}</button>
    <button data-a="adm-tick" data-code="${esc(code)}" data-tick="owner">${tick('owner')} Give white Owner tick${k === 'owner' ? ' ✓' : ''}</button>
    <button data-a="adm-tick" data-code="${esc(code)}" data-tick="premium">${tick('premium')} Give Premium tick${k === 'premium' ? ' ✓' : ''}</button>
    <button data-a="adm-tick" data-code="${esc(code)}" data-tick="">Remove tick</button>
    <button data-a="adm-pl-del" data-code="${esc(code)}" style="color:var(--bad)">Delete playlist</button></div>
    <div class="actions"><button class="btn ghost" data-a="close-sheet">Close</button></div>`);
}

/* ───────── router + events ───────── */
const NAVS = []; let routed = false;
function navDirection() { const h = location.hash || '#home', n = NAVS.length; if (n >= 2 && NAVS[n - 2] === h) { NAVS.pop(); return -1 } if (NAVS[n - 1] !== h) NAVS.push(h); if (NAVS.length > 40) NAVS.shift(); return 1 }
function route() {
  if (NAT && !TOK) { if (!document.body.classList.contains('lg')) showLogin('You are logged out.'); return }   // v23.1: logged out = stay on the login screen (back button must not bring the app back)
  RT++; clearTimeout(st);
  const dir = navDirection(), my = RT;
  view.classList.remove('pg-f', 'pg-b', 'pg-xf', 'pg-xb');
  if (routed && view.firstElementChild && !document.hidden) {      // old page eases out, new page eases in (slower, direction aware: back slides the other way)
    view.classList.add(dir < 0 ? 'pg-xb' : 'pg-xf');
    setTimeout(() => { if (my !== RT) return; view.classList.remove('pg-xf', 'pg-xb'); void view.offsetWidth; view.classList.add(dir < 0 ? 'pg-b' : 'pg-f'); routeNow() }, 190);
  } else { routed = true; routeNow() }
}
function routeNow() {
  const h = (location.hash || '#home').slice(1), [a, b] = h.split('/');
  const tab = ['home', 'search', 'library', 'you'].includes(a) ? a : a === 'admin' ? 'you' : (a === 'code' || a === 'downloads' || a === 'plnew' || a === 'plcollab' || a === 'pledit' ? 'library' : (a === 'artist' || a === 'album') ? 'search' : 'home');
  document.querySelectorAll('.tabs a').forEach(x => x.classList.toggle('on', x.dataset.tab === tab));
  scrollTo(0, 0);
  ({ home, search, library, you, downloads, admin: () => adminPage(b), plnew: () => plForm('new'), plcollab: () => plForm('collab'), pledit: () => plForm('edit', b) }[a] || (a === 'code' ? () => playlist(b) : a === 'album' ? () => albumPage(b) : a === 'artist' ? () => artistPage((() => { try { return decodeURIComponent(b || '') } catch (e) { return b || '' } })()) : home))();
}
addEventListener('hashchange', route);
addEventListener('offline', () => { S.offline = true; netBar(false); if (!location.hash || location.hash === '#home') route() });
addEventListener('online', () => { S.offline = false; netBar(true); checkUpdate() });
const likeToggle = async t => {
  try {
    if (S.liked[t.uri]) { await api('/api/liked-songs/' + S.liked[t.uri], { method: 'DELETE' }); delete S.liked[t.uri]; ev('unlike', { ref: t.uri, title: t.title, author: t.author }); toast('Removed from Liked songs') }
    else { const r = await api('/api/liked-songs', { method: 'POST', body: { title: t.title, author: t.author, uri: t.uri || q(t), identifier: t.identifier } }); S.liked[t.uri] = r.id; ev('like', { ref: t.uri, title: t.title, author: t.author }); toast('Added to Liked songs'); buzz() }
    setLikeIcon(true); miniLike();
  } catch (e) { toast(e.message) }
};
const shareSong = async t => {
  ev('share', { ref: t.uri, title: t.title, author: t.author });
  const url = t.uri && /^https?:/.test(t.uri) ? t.uri : (ytId(t) ? 'https://www.youtube.com/watch?v=' + ytId(t) : (NAT || location.origin)), data = { title: t.title, text: `${t.title} · ${t.author}`, url };
  try { if (navigator.share) await navigator.share(data); else { await navigator.clipboard.writeText(url); toast('Link copied') } } catch (e) {}
};
function shuffleToggle() {
  if (mode() !== 'phone' || !S.queue.length) return;
  if (!S.shuf) { S.orig = S.queue.slice(); const head = S.queue.slice(0, S.qi + 1), tail = S.queue.slice(S.qi + 1).sort(() => Math.random() - .5); S.queue = head.concat(tail); S.shuf = true; toast('Shuffle on') }
  else { if (S.orig) { const u = S.cur && S.cur.uri; S.queue = S.orig; S.qi = Math.max(0, S.queue.findIndex(x => x.uri === u)); S.orig = null } S.shuf = false; toast('Shuffle off') }
  ui();
}


/* ───────── lyrics (v22.6): written in the song's own language, full-screen view, no copying ───────── */
const LY = { key: '', lines: [], plain: '', idx: -1, vi: -2, adj: 0, state: 'none' }, lyCache = new Map(), LYV = { on: false, pp: null };
const cleanT = s => String(s || '').replace(/\(.*?\)|\[.*?\]|official.*|lyric.*|video.*|\|.*|ft\..*|feat\..*/gi, '').replace(/\s+/g, ' ').trim();
const parseLrc = s => { const out = []; String(s || '').split('\n').forEach(l => { const ts = []; let m, re = /\[(\d+):(\d+(?:[.:]\d+)?)\]/g, last = 0; while ((m = re.exec(l)) && m.index === last) { ts.push((+m[1]) * 60 + parseFloat(m[2].replace(':', '.'))); last = re.lastIndex } const x = l.slice(last).trim(); if (ts.length && x) ts.forEach(t => out.push({ t, x })) }); return out.sort((a, b) => a.t - b.t) };   // v24.3: repeated lines "[00:10][00:50] text" are no longer lost
async function lyricsFetch(t) {
  // 1) our server: finds the lyrics and writes them in the song's language (Punjabi -> Gurmukhi, Hindi -> Devanagari ...)
  try {
    const q = `/api/app/lyrics?title=${encodeURIComponent(t.title)}&author=${encodeURIComponent(t.author)}&dur=${Math.round((t.duration || 0) / 1000)}&av=${CV}`;
    const j = await Promise.race([api(q), new Promise((_, rj) => setTimeout(() => rj(new Error('slow')), 30000))]);
    if (j && ((j.lines && j.lines.length) || j.plain)) return { lines: j.lines || [], plain: j.plain || '' };
  } catch (e) { if (e && e.offline) return null }
  // 2) lrclib (several spellings) and lyrics.ovh
  try { return await lyricsFallback(t) } catch (e) {}
  return null;
}
function lyApply(d) {
  LY.lines = (d && d.lines) || []; LY.plain = (d && d.plain) || LY.lines.map(l => l.x).join('\n'); LY.state = (LY.lines.length || LY.plain) ? 'ok' : 'none';
  LY.idx = -1; LY.vi = -2; LY.adj = +store.get('lm-lyadj:' + LY.key) || 0;
  if (LY.state === 'ok') { $('#np-lcard').hidden = false; lyricsTick(S.cur ? au.currentTime * 1000 : 0, true) }
  lyvRender(); lypRender();
}
const lySig = d => ((d && d.lines) || []).slice(0, 4).map(x => x.x).join('|') + ((d && d.lines) || []).length;
async function lyricsLoad(t) {
  const key = t.title + '|' + t.author; if (LY.key === key) return; LY.key = key; LY.lines = []; LY.plain = ''; LY.idx = -1; LY.state = 'loading'; LY.adj = 0;
  $('#np-lyr').textContent = ''; $('#np-lcard').hidden = true; lyvHead(t); lyvRender();
  if (!navigator.onLine) { LY.state = 'none'; lyvRender(); return }
  let d = lyCache.get(key);
  if (d === undefined) {
    // v24: our server (right script for the language) and lrclib are asked at the same time; whoever answers first shows at once,
    // and if the server answers later with different text it quietly replaces it
    const full = lyricsFetch(t).catch(() => null), fast = lyricsFallback(t).catch(() => null);
    d = await new Promise(res => { let n = 0; const done = r => { if (r) res(r); else if (++n === 2) res(null) }; fast.then(done); full.then(done) });
    lyCache.set(key, d); if (lyCache.size > 40) lyCache.delete(lyCache.keys().next().value);
    if (d) full.then(r => { if (r && r !== d && ((r.lines && r.lines.length && lySig(r) !== lySig(d)) || (!(d.lines && d.lines.length) && (r.plain || '').length > (d.plain || '').length * 1.3)) && lyCache.get(key) === d) { lyCache.set(key, r); if (LY.key === key) lyApply(r) } });
  }
  if (LY.key !== key) return;
  lyApply(d);
}
// FIX: Lyrics sync — subtract a small lookahead offset (0.35 s) so the
//      highlighted line matches what the ear hears, not what arrived early.
const LY_OFFSET_S = 0.35;
const lyIdx = posMs => { const s = posMs / 1000 - LY_OFFSET_S - (LY.adj || 0); let i = LY.lines.length - 1; while (i >= 0 && LY.lines[i].t > s) i--; return i };
/* v24: word by word. A synced line only has ONE time (when it starts), so the words inside it are spread over the time the line is really sung
   (by word length, never longer than ~0.1 s per letter). Before the first line starts, nothing is lit (intro / music only). */
function lyWordsFor(i) {
  const l0 = LY.lines[i]; if (!l0) return null;
  if (l0._w) return l0._w;
  const ws = l0.x.split(/\s+/).filter(Boolean); if (!ws.length) return null;
  const gap = (LY.lines[i + 1] ? LY.lines[i + 1].t : l0.t + 5) - l0.t, total = ws.reduce((a, w) => a + Math.max(1.5, w.length), 0);
  const sing = gap <= 6 ? Math.max(gap - .15, .4) : Math.min(gap - .15, Math.max(3.5, l0.x.length * .16)); let acc = 0;   // normal gap = the line is sung the whole gap; a long gap = instrumental break after the line
  return l0._w = { sing, words: ws.map(w => { const a = acc; acc += Math.max(1.5, w.length) / total; return { w, s: a, e: acc } }) };
}
function wordTick() {
  const now = au.currentTime - LY_OFFSET_S - (LY.adj || 0);
  document.querySelectorAll('#lyv-lines p.cur, #pan-lyr p.cur, #np-lines p.cur').forEach(el => {
    if (el._li === undefined) el._li = LY.lines.findIndex(l => String(l.t) === el.dataset.t);
    const i = el._li, W = i >= 0 && lyWordsFor(i); if (!W) return;
    if (!el._sp) { el.innerHTML = W.words.map(o => `<span class="w">${esc(o.w)}</span>`).join(' '); el._sp = Array.from(el.children) }
    const frac = (now - LY.lines[i].t) / W.sing;
    W.words.forEach((o, k) => { const f = Math.round(Math.max(0, Math.min(1, (frac - o.s) / (o.e - o.s))) * 20) / 20, sp = el._sp[k]; if (sp && sp._q !== f) { sp._q = f; sp.style.setProperty('--f', f) } });
  });
}
let WL = false;
const wordWant = () => S.playing && mode() === 'phone' && !document.hidden && LY.lines.length && (LYV.on || !$('#np').hidden);
function wordLoop() { if (!wordWant()) { WL = false; return } try { wordTick() } catch (e) {} requestAnimationFrame(wordLoop) }
function wordKick() { if (!WL && wordWant()) { WL = true; requestAnimationFrame(wordLoop) } }
function lyricsTick(posMs, force) {
  wordKick();
  lyvTick(posMs, force); lypTick(posMs, force);
  if (!LY.lines.length) { if (force && LY.plain) { $('#np-lines').innerHTML = LY.plain.split('\n').filter(Boolean).slice(0, 6).map(x => `<p>${esc(x)}</p>`).join('') } return }
  const i = lyIdx(posMs);
  if (i === LY.idx && !force) return; LY.idx = i;
  $('#np-lyr').textContent = i >= 0 ? LY.lines[i].x : '';
  const from = Math.max(0, Math.min(i - 3, LY.lines.length - 5)), sl = LY.lines.slice(from, from + 5);
  $('#np-lines').innerHTML = sl.map((l, k) => `<p${from + k === i ? ' class="cur"' : ''} data-t="${l.t}">${esc(l.x)}</p>`).join('');
}
/* full-screen lyrics: tap the lyrics on Now Playing. Stays open when the next song starts (the new lyrics + background load by themselves). */
function lyvBuild() {
  let d = $('#lyv'); if (d) return d;
  d = document.createElement('section'); d.id = 'lyv'; d.hidden = true;
  d.innerHTML = `<div id="lyv-bg"></div>
    <div class="lyv-top"><button class="ib" data-a="close-lyv" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></button><div class="lyv-tt"><b id="lyv-t"></b><small id="lyv-s"></small></div><span class="lyv-sp"><button class="ib lyv-adj" data-a="ly-adj" data-d="-0.4" aria-label="Lyrics earlier">&minus;</button><button class="ib lyv-adj" data-a="ly-adj" data-d="0.4" aria-label="Lyrics later">+</button></span></div>
    <div id="lyv-box"><div id="lyv-lines"></div></div>
    <div class="lyv-ctl"><i class="lyv-bar"><i id="lyv-prog"></i></i><div>
      <button class="ib" data-a="prev" aria-label="Previous"><svg viewBox="0 0 24 24"><path d="M18 5l-9 7 9 7zM5 5h2v14H5z"/></svg></button>
      <button class="pp" data-a="toggle" aria-label="Play or pause"><svg viewBox="0 0 24 24" id="lyv-pp"></svg></button>
      <button class="ib" data-a="next" aria-label="Next"><svg viewBox="0 0 24 24"><path d="M6 5l9 7-9 7zM17 5h2v14h-2z"/></svg></button></div></div>`;
  document.body.appendChild(d); return d;
}
function lyvHead(t) {
  if (!$('#lyv') || !t) return;
  $('#lyv-t').textContent = t.title; $('#lyv-s').textContent = t.author; $('#lyv-bg').setAttribute('style', bgi(art(t)));
}
function lyvRender() {
  if (!$('#lyv')) return; const box = $('#lyv-lines'); LY.vi = -2; LYV.pp = null;
  if (LY.state === 'loading') box.innerHTML = '<div class="lyv-msg">Loading lyrics…</div>';
  else if (!LY.lines.length && !LY.plain) box.innerHTML = '<div class="lyv-msg">Lyrics are not available for this song</div>';
  else if (LY.lines.length) box.innerHTML = LY.lines.map(l => `<p data-a="lyv-line" data-t="${l.t}">${esc(l.x)}</p>`).join('');
  else box.innerHTML = LY.plain.split('\n').map(x => x.trim() ? `<p class="pl">${esc(x)}</p>` : '<br>').join('');
  $('#pan-lyr, #lyv-box').scrollTop = 0;
  if (LYV.on) lyvTick(S.cur ? (mode() === 'phone' ? au.currentTime * 1000 : S.pos) : 0, true);
}
function lyvTick(posMs, force) {
  if (!LYV.on) return;
  const phone = mode() === 'phone', pl = !!S.playing;
  if (LYV.pp !== pl) { LYV.pp = pl; $('#lyv-pp').innerHTML = pl ? PAUSE : PLAY }
  const dur = phone ? ((isFinite(au.duration) && au.duration > 0) ? au.duration * 1000 : (S.cur && S.cur.duration) || 0) : S.dur;
  $('#lyv-prog').style.width = dur ? Math.min(100, posMs / dur * 100) + '%' : '0';
  if (!LY.lines.length) return;
  const i = lyIdx(posMs); if (i === LY.vi && !force) return; LY.vi = i;
  const ps = $('#lyv-lines').children; let cur = null;
  for (let k = 0; k < ps.length; k++) { const c = ps[k].classList; c.toggle('cur', k === i); c.toggle('past', k < i); if (k === i) cur = ps[k] }
  if (cur) { const b = $('#lyv-box'); b.scrollTo({ top: cur.offsetTop - b.clientHeight / 2 + cur.offsetHeight / 2, behavior: force ? 'auto' : 'smooth' }) }
}
function openLyv() {
  if (!S.cur) return; lyvBuild(); $('#lyv').hidden = false; LYV.on = true;
  if (!(history.state && history.state.lyv)) { try { history.pushState({ lyv: 1 }, '') } catch (e) {} }
  lyvHead(S.cur); lyvRender();
}
function lyvHide() { const d = $('#lyv'); if (d) d.hidden = true; LYV.on = false }
function closeLyv() { if (history.state && history.state.lyv) history.back(); else lyvHide() }
addEventListener('popstate', () => { if (LYV.on && !(history.state && history.state.lyv)) lyvHide() });
$('#np-lcard').dataset.a = 'lyrics-full'; $('#np-lyr').dataset.a = 'lyrics-full';
/* nobody can select / copy / drag the lyrics */
['copy', 'cut', 'contextmenu', 'selectstart', 'dragstart'].forEach(n => document.addEventListener(n, e => {
  const el = e.target && (e.target.nodeType === 3 ? e.target.parentElement : e.target);
  if (el && el.closest && el.closest('#lyv,#np-lcard,#np-lyr,.lyfull,#pan-lyr')) { e.preventDefault(); if (e.clipboardData) { try { e.clipboardData.setData('text/plain', '') } catch (x) {} } }
}, true));
function artistCard(t) {
  const c = $('#np-acard'); if (!c || !t.author) { if (c) c.hidden = true; return }
  const nm = t.author.split(/[,&]/)[0].trim(), fol = isFollowing(nm), th = art(t);
  c.hidden = false;
  c.innerHTML = `<b class="ct">About the artist</b><button class="aa" data-a="open-artist" data-name="${esc(nm)}" style="${bgi(th)}"></button>
    <div class="ar"><div><b>${esc(nm)}</b><small>Artist</small></div><button class="pillbtn" data-a="artist-follow" data-name="${esc(nm)}" data-thumb="${esc(th)}"><span>${fol ? 'Following' : 'Follow'}</span></button></div>`;
}
/* ───────── copy (replaces "link"/"share" wording: everything just says Copy) ───────── */
async function copyText(txt, msg) {
  try { await navigator.clipboard.writeText(txt) } catch (e) {
    try { const ta = document.createElement('textarea'); ta.value = txt; ta.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove() } catch (e2) { return toast('Could not copy') }
  }
  toast(msg || 'Copied'); buzz();
}
const songLink = t => t.uri && /^https?:/.test(t.uri) ? t.uri : (ytId(t) ? 'https://www.youtube.com/watch?v=' + ytId(t) : (NAT || location.origin));
// v24: this link opens the APP when it is installed (and offers the APK when it is not); the page /open/pl/<code> lives in the server dashboard
async function plTracks(code) {
  let p; try { p = await api('/api/playlist/info?code=' + encodeURIComponent(code)) } catch (e) { p = await api('/api/playlists/code/' + encodeURIComponent(code)) }
  return arr(p.tracks).map(nt);
}
async function sharePl(code, name) {
  const url = plLink(code), data = { title: name || 'Legacy Music playlist', text: `${name ? name + ' · ' : ''}Listen on Legacy Music`, url };
  try { if (navigator.share) await navigator.share(data); else await copyText(url, 'Link copied') } catch (e) { if (!e || e.name !== 'AbortError') copyText(url, 'Link copied') }
}
const plLink = code => `${NAT || location.origin}/open/pl/${encodeURIComponent(code)}`;

/* ───────── collab playlist: generate invite link ───────── */
async function showCollabLink(code) {
  const link = plLink(code);
  sheet(`<h3>${ic('users')} Collaborative Playlist</h3>
    <p class="sub">Anyone with this link can add songs to your playlist. Share it with friends!</p>
    <div class="collab-link-box"><span id="collab-link-txt">${esc(link)}</span></div>
    <div class="actions">
      <button class="btn" data-a="copy-collab-link" data-link="${esc(link)}">${ic('copy')} Copy</button>
      <button class="btn ghost" data-a="close-sheet">Done</button>
    </div>
    <p class="sub" style="margin-top:12px">⚠️ When your Premium expires, this playlist becomes private and the link will stop working.</p>`);
}

document.addEventListener('click', async e => {
  const g = e.target.closest('[data-go]'); if (g) { location.hash = '#' + g.dataset.go; return }
  const el = e.target.closest('[data-a]'); if (!el) return;
  const a = el.dataset.a, list = L[el.dataset.l] || [], i = +el.dataset.i;
  if (a === 'pl-more') {
    e.stopPropagation(); const c = el.dataset.code, own = el.dataset.kind === 'own', nm = el.dataset.name || 'Playlist';
    sheet(`<h3>${esc(nm)}</h3><span class="sub">${esc(el.dataset.n || '')}</span><div class="menu">
      <button data-a="plm-play" data-code="${esc(c)}">${ic('play')} Play</button>
      <button data-a="plm-share" data-code="${esc(c)}" data-name="${esc(nm)}">${ic('copy')} Share</button>
      <button data-a="plm-like" data-code="${esc(c)}">${ic('heart')} Like all songs</button>
      ${DLPL[dlPlKey(c)] ? `<button data-a="dlpl-pause" data-k="${esc(dlPlKey(c))}">${DLPL[dlPlKey(c)].paused ? ic('play') + ' Resume download' : ic('pause') + ' Pause download'} · ${DLPL[dlPlKey(c)].done}/${DLPL[dlPlKey(c)].total}</button><button data-a="dlpl-cancel" data-k="${esc(dlPlKey(c))}">${ic('stop')} Cancel download</button>` : `<button data-a="plm-dl" data-code="${esc(c)}">${ic('dl')} Download ${isPrem() ? '' : ic('crown', 'gold')}</button>`}
      ${own && el.dataset.pid ? `<button data-a="plm-del" data-pid="${esc(el.dataset.pid)}" data-code="${esc(c)}">${ic('lock')} Delete playlist</button>` : ''}
      ${!own ? `<button data-a="plm-unsave" data-code="${esc(c)}">${ic('bookmark')} Remove from library</button>` : ''}</div>`);
    return;
  }
  if (a === 'more') {
    e.stopPropagation(); const t = nt(list[i]), id = ytId(t), dlon = id && S.dl[id], own = el.dataset.l === 'pl' && L.plMeta && L.plMeta.is_owner && L.plMeta.id && t.id;
    sheet(`<h3>${esc(t.title)}</h3><span class="sub">${esc(t.author)}</span><div class="menu">
      <button data-a="q-next" data-l="${el.dataset.l}" data-i="${i}">${ic('play')} Play next</button>
      <button data-a="q-add" data-l="${el.dataset.l}" data-i="${i}">${ic('plus')} Add to queue</button>
      <button data-a="like-it" data-l="${el.dataset.l}" data-i="${i}">${ic('heart', S.liked[t.uri] ? 'fill' : '')} ${S.liked[t.uri] ? 'Remove from Liked' : 'Like'}</button>
      <button data-a="add-plus" data-l="${el.dataset.l}" data-i="${i}">${ic('music')} Add to playlist ${isPrem() ? '' : ic('crown', 'gold')}</button>
      <button data-a="more-by" data-q="${esc(t.author)}">${ic('radio')} Song radio (more like this)</button>
      ${t.author ? `<button data-a="open-artist" data-name="${esc(t.author)}">${ic('person')} Artist: ${esc(t.author)}</button>` : ''}
      ${id ? (dlon ? `<button data-a="dl-rm" data-id="${id}">${ic('dl')} Remove download</button>` : DLJ[id] ? `<button data-a="dl-pause" data-id="${id}">${dlPaused(id) ? ic('play') + ' Resume download' : ic('pause') + ' Pause download'}${DLP[id] >= 0 ? ' · ' + DLP[id] + '%' : ''}</button><button data-a="dl-cancel" data-id="${id}">${ic('stop')} Cancel download</button>` : `<button data-a="dl-it" data-l="${el.dataset.l}" data-i="${i}">${ic('dl')} Download ${isPrem() ? '' : ic('crown', 'gold')}</button>`) : ''}
      <button data-a="share-it" data-l="${el.dataset.l}" data-i="${i}">${ic('copy')} Copy</button>
      ${own ? `<button data-a="rm-track" data-id="${t.id}">${ic('lock')} Remove from this playlist</button>` : ''}</div>`); return
  }
  if (a === 'rp-song') {
    // FIX: play a recently-searched song (from the search-history list)
    const k = el.dataset.k;
    // Try search history first, then fall back to full RP for compatibility
    const item = rpSearchGet().find(x => (x.uri || x.title) === k) || rpGet().find(x => x.type === 'song' && (x.uri || x.title) === k);
    if (!item) return;
    const t = { title: item.title, author: item.author || '', uri: item.uri || '', identifier: '', thumbnail: item.thumbnail || '', duration: 0 };
    // FIX: re-push to search history (refreshes timestamp)
    rpSearchPush(t);
    if (mode() !== 'phone') { discordPlay([t], 0); return }
    S.queue = [t]; S.qi = 0; S.orig = null; S.shuf = false; startPhone(true); buzz();
  }
  else if (a === 'play') {
    if (el.dataset.l === 'dl' && !isPrem()) return premiumSheet('Playing your downloads needs an active Premium.');
    const l = el.dataset.l, coll = ['pl', 'dl', 'artist', 'album', 'albtr'].includes(l);
    // FIX: If tapped from search results, record in search history
    if ((l === 'search') && list[i]) rpSearchPush(nt(list[i]));
    if (l === 'album' || l === 'albtr') ALB_NEXT = true;
    playFrom(list, i, coll || !S.auto, l === 'pl');
    if (l !== 'search' && l !== 'artist') S.ctx = ''
  }
  else if (a === 'q-add') { closeSheet(); const t = nt(list[i]); if (mode() === 'phone') { S.queue.push(t); if (S.orig) S.orig.push(t); if (S.qi < 0) { S.qi = 0; startPhone() } toast('Added to queue') } else discordPlay([t], 0) }
  else if (a === 'q-next') { closeSheet(); const t = nt(list[i]); if (mode() === 'phone') { S.queue.splice(S.qi + 1, 0, t); if (S.qi < 0) { S.qi = 0; startPhone() } toast('Plays next') } else discordPlay([t], 0) }
  else if (a === 'like-it') { closeSheet(); likeToggle(nt(list[i])) }
  else if (a === 'like') { if (S.cur) likeToggle(S.cur) }
  else if (a === 'share-it') { closeSheet(); const tt = nt(list[i]); ev('share', { ref: tt.uri, title: tt.title, author: tt.author }); copyText(songLink(tt), 'Copied') }
  else if (a === 'share') { if (S.cur) shareSong(S.cur) }
  else if (a === 'more-by') { const qq = el.dataset.q; closeSheet(); afterSheet(() => { S.chips.clear(); location.hash = '#search'; setTimeout(() => search(qq), 30) }) }
  else if (a === 'open-artist') { const nm = el.dataset.name; closeSheet(); afterSheet(() => { location.hash = '#artist/' + encodeURIComponent(nm) }) }
  else if (a === 'artist-follow') { const on = artistToggle(el.dataset.name, el.dataset.thumb); ev(on ? 'follow' : 'unfollow', { ref: el.dataset.name, thumb: noMt(el.dataset.thumb || '') }); el.classList.toggle('ghost', on); el.querySelector('span').textContent = on ? 'Following' : 'Follow'; toast(on ? 'Following ' + el.dataset.name : 'Unfollowed ' + el.dataset.name); buzz() }
  else if (a === 'artist-play') { playFrom(L.artist || [], 0, true, true); S.ctx = (L.artist && L.artist[0] && L.artist[0].author) || S.ctx }
  else if (a === 'open-album') { closeNotifs(); closeSheet(); afterSheet(() => { location.hash = '#album/' + el.dataset.id }) }
  else if (a === 'album-play') { ALB_NEXT = true; playFrom(L.album || [], 0, true, true) }
  else if (a === 'album-shuffle') { ALB_NEXT = true; playFrom((L.album || []).slice().sort(() => Math.random() - .5), 0, true, true) }
  else if (a === 'artist-shuffle') { playFrom((L.artist || []).slice().sort(() => Math.random() - .5), 0, true, true) }
  else if (a === 'pl-back') { if (history.length > 1) history.back(); else location.hash = '#home' }
  else if (a === 'dl-it') { closeSheet(); dlSong(nt(list[i])) }
  else if (a === 'dl-pause') { const j = DLJ[el.dataset.id]; closeSheet(); if (j) { j.paused = !j.paused; toast(j.paused ? 'Download paused' : 'Download resumed') } }
  else if (a === 'dl-cancel') { closeSheet(); if (DLJ[el.dataset.id]) { dlSongCancel(el.dataset.id); toast('Download cancelled') } }
  else if (a === 'dlpl-pause') { const p = DLPL[el.dataset.k]; closeSheet(); if (p) { p.paused = !p.paused; dlPlUi(el.dataset.k); toast(p.paused ? 'Download paused' : 'Download resumed') } }
  else if (a === 'dlpl-cancel') { closeSheet(); if (DLPL[el.dataset.k]) dlPlCancel(el.dataset.k) }
  else if (a === 'dl') { if (S.cur) { const id = ytId(S.cur); if (id && DLJ[id]) return dlSongSheet(id, S.cur.title); if (id && S.dl[id]) { await dlRemove(id); toast('Download removed'); ui() } else dlSong(S.cur) } }
  else if (a === 'dl-rm') { closeSheet(); await dlRemove(el.dataset.id); toast('Download removed'); if (location.hash.startsWith('#downloads')) route(); else ui() }
  else if (a === 'dl-play') { if (L.dl && L.dl.length) playFrom(L.dl, 0, true, false) }
  else if (a === 'dl-clear') { if (await askYes('Delete all downloaded songs from this phone?', 'Delete')) { for (const x of (await dlMeta())) await dlRemove(x.id); toast('Downloads deleted'); route() } }
  else if (a === 'open-dl') location.hash = '#downloads';
  else if (a === 'album-dl') { const id_ = el.dataset.id; if (albDlState(id_) === 'ok') toast('Album is already downloaded'); else dlAlbum(id_) }
  else if (a === 'dlalb-rm') { e.stopPropagation(); const c = el.dataset.id; if (await askYes('Remove this album from Downloaded albums? The songs stay in Downloads.', 'Remove')) { dlAlbSet(dlAlbGet().filter(x => String(x.id) !== String(c))); toast('Removed'); route() } }
  else if (a === 'dlpl-rm') { e.stopPropagation(); const c = el.dataset.code; if (await askYes('Remove this playlist from Downloaded playlists? The songs stay in Downloads.', 'Remove')) { store.set('lm-dlpl', JSON.stringify(dlPlGet().filter(x => x.code !== c))); toast('Removed'); route() } }
  else if (a === 'pl-dl') {
    const m = L.plMeta || {}, hc = (location.hash.match(/^#code\/([^?\/]+)/) || [])[1] || m.code || '';
    if (!hc) return toast("Can't download this playlist");
    if (DLPL[dlPlKey(hc)]) return dlPlSheet(dlPlKey(hc), (L.plMeta || {}).name);
    await dlPlaylist(hc, m.name, fixUrl(m.cover_image_url) || '', L.pl || []); if (location.hash.startsWith('#code/')) route();
  }
  else if (a === 'pl-save') {
    const c = el.dataset.code, on = S.saved.has(c);
    try { await api('/api/app/saved/' + encodeURIComponent(c), { method: on ? 'DELETE' : 'POST' }); on ? S.saved.delete(c) : S.saved.add(c); el.classList.toggle('on', !on); el.querySelector('span').textContent = on ? 'Save' : 'Saved'; toast(on ? 'Removed from your library' : 'Saved to your library'); buzz() } catch (er) { toast(er.message) }
  }
  else if (a === 'add-plus') {
    e.stopPropagation();
    const t = nt(list[i]); if (!t) return;
    L.tmp = t;
    const liked = !!S.liked[t.uri];
    let pls = [];
    try { pls = arr(await api('/api/playlists')) } catch (er) {}
    const canAdd = isPrem();
    sheet(`<h3>${esc(t.title)}</h3><span class="sub">${esc(t.author)}</span>
      <div class="menu"><button data-a="plus-like">${ic('heart', liked ? 'fill' : '')} ${liked ? 'Remove from Liked' : 'Add to Liked'}</button></div>
      <h3 style="margin:16px 0 6px;font-size:14px">Add to a playlist ${canAdd ? '' : ic('crown', 'gold')}</h3>
      <div class="menu">
        ${pls.map(p => `<button data-a="plus-pl" data-pid="${esc(p.id)}" data-code="${esc(p.code || '')}">${ic('music')} ${esc(p.name)}<span class="sub" style="margin-left:auto">${p.track_count || 0}</span></button>`).join('') || '<div class="empty" style="padding:14px 0">No playlists yet</div>'}
        <button data-a="plus-new">${ic('plus')} New playlist</button>
      </div>`);
    return;
  }
  else if (a === 'plus-like') {
    closeSheet();
    const t = L.tmp; if (!t) return;
    await likeToggle(t);
    toast(S.liked[t.uri] ? 'Added to Liked' : 'Removed from Liked');
    return;
  }
  else if (a === 'plus-pl') {
    if (!isPrem()) return premiumSheet('Adding songs to your playlists is a Premium feature.');
    const t = L.tmp; if (!t) return;
    closeSheet();
    try {
      await api(`/api/playlists/${el.dataset.pid}/tracks`, { method: 'POST', body: { query: t.uri || fb(t) } });
      ev('pl_add', { ref: t.uri, title: t.title, author: t.author, extra: 'playlist ' + el.dataset.pid });
      toast('Added to playlist');
    } catch (er) { toast(er.message) }
    return;
  }
  else if (a === 'plus-new') {
    if (!isPrem()) return premiumSheet('Creating playlists is a Premium feature.');
    const t = L.tmp; closeSheet();
    location.hash = '#plnew';
    setTimeout(() => { try { const n = $('#pl-new-name'); if (n) { n.value = t ? (t.title + ' mix').slice(0, 40) : ''; n.focus() } } catch (e) {} }, 300);
    return;
  }
  else if (a === 'add-to-pl') {
    if (!isPrem()) return premiumSheet('Adding songs to your playlists is a Premium feature.');
    try {
      const pl = arr(await api('/api/playlists')); L.tmp = list[i];
      sheet(`<h3>Add to playlist</h3><div class="menu">${pl.map(p => `<button data-a="do-add" data-pid="${p.id}">${ic('music')} ${esc(p.name)}</button>`).join('') || '<div class="empty">Create a playlist in Library first</div>'}</div>`);
    } catch (er) { toast(er.message) }
  }
  else if (a === 'do-add') { closeSheet(); const t = nt(L.tmp); ev('pl_add', { ref: t.uri, title: t.title, author: t.author, extra: 'playlist ' + el.dataset.pid }); try { await api(`/api/playlists/${el.dataset.pid}/tracks`, { method: 'POST', body: { query: t.uri || fb(t) } }); toast('Added to playlist') } catch (er) { toast(er.message) } }
  else if (a === 'rm-track') { closeSheet(); try { await api(`/api/playlists/${L.plMeta.id}/tracks/${el.dataset.id}`, { method: 'DELETE' }); toast('Removed'); route() } catch (er) { toast(er.message) } }
  else if (a === 'ly-adj') {
    LY.adj = Math.max(-5, Math.min(5, Math.round(((LY.adj || 0) + parseFloat(el.dataset.d)) * 10) / 10)); store.set('lm-lyadj:' + LY.key, String(LY.adj));
    toast(LY.adj === 0 ? 'Lyrics: normal timing' : `Lyrics ${LY.adj > 0 ? 'later' : 'earlier'} by ${Math.abs(LY.adj).toFixed(1)}s`); LY.idx = -1; LY.vi = -2; PAN.lv = -2;
    document.querySelectorAll('#lyv-lines p, #pan-lyr p').forEach(p => { p._sp = null; p._li = undefined }); lyricsTick(au.currentTime * 1000, true)
  }
  else if (a === 'open-pl') { location.hash = '#code/' + el.dataset.code }
  else if (a === 'open-liked') location.hash = '#code/liked';
  else if (a === 'pl-play') { playFrom(L.pl || [], 0, true, true); S.ctx = '' }
  else if (a === 'pl-shuffle') { const s = (L.pl || []).slice().sort(() => Math.random() - .5); playFrom(s, 0, true, true); S.ctx = '' }
  else if (a === 'pl-edit') { location.hash = '#pledit/' + el.dataset.code }
  else if (a === 'pl-art-open') plArtSheet(el.dataset.code, el.dataset.kind);
  else if (a === 'pl-art-pick') { PA.kind = el.dataset.kind; PA.code = el.dataset.code; requestGalleryPermission().then(() => pickFile(plArtFile)) }
  else if (a === 'pl-art-rm') {
    try { await api(`/api/app/pl-art/${encodeURIComponent(el.dataset.code)}/${el.dataset.kind}`, { method: 'DELETE' }); if (PA.map[el.dataset.code]) delete PA.map[el.dataset.code][el.dataset.kind]; closeSheet(); toast('Removed'); playlist(el.dataset.code) }
    catch (er) { toast(er.message) }
  }
  else if (a === 'do-pl-edit') {
    const pid = el.dataset.pid, code = el.dataset.code;
    const name = ($('#pl-edit-name') || {}).value?.trim();
    if (!name) return toast('Please enter a playlist name');
    closeSheet();
    try {
      await api(`/api/playlists/${pid}`, { method: 'PATCH', body: { name } });
      ev('pl_edit', { title: name, code }); toast('Playlist updated');
      playlist(code); // reload playlist view
    } catch (er) { toast(er.message) }
  }
  else if (a === 'chip') { const n = el.dataset.n; S.chips.has(n) ? S.chips.delete(n) : S.chips.add(n); el.classList.toggle('on'); clearTimeout(st); st = setTimeout(run, 150); buzz(8) }
  else if (a === 'rq') { $('#q').value = el.dataset.q; run() }
  else if (a === 'clear-rq') { store.set('lm-rq', '[]'); search() }
  else if (a === 'new-pl') { if (!isPrem()) return premiumSheet('Creating your own playlists is a Premium feature.'); location.hash = '#plnew' }
  else if (a === 'new-collab-pl') { if (!isPrem()) return premiumSheet('Collaborative playlists are a Premium feature.'); location.hash = '#plcollab' }
  else if (a === 'pf-pick') { pfKind = el.dataset.kind; requestGalleryPermission().then(() => pickFile(pfFile)) }  // FIX: requests gallery permission on Android first
  else if (a === 'pf-back') { history.back() }
  else if (a === 'pf-rm') { const k = el.dataset.kind; PF[k] = null; PF[k === 'bg' ? 'rmBg' : 'rmCover'] = true; const e2 = $('#pf-' + k); if (e2) { e2.style.backgroundImage = ''; e2.classList.remove('has') } }
  else if (a === 'pf-save') pfSave(el);
  else if (a === 'pf-del') { if (!(await askYes('Delete this playlist for good?', 'Delete'))) return; try { await api('/api/playlists/' + el.dataset.pid, { method: 'DELETE' }); ev('pl_delete', { code: el.dataset.code }); toast('Playlist deleted'); location.hash = '#library' } catch (er) { toast(er.message) } }
  else if (a === 'collab-link') { copyText(plLink(el.dataset.code), 'Copied') }
  else if (a === 'pl-copy') { sharePl(el.dataset.code, (L.plMeta && L.plMeta.name) || '') }
  else if (a === 'plm-share') { closeSheet(); sharePl(el.dataset.code, el.dataset.name) }
  else if (a === 'plm-play') { closeSheet(); try { const l = await plTracks(el.dataset.code); if (!l.length) return toast('This playlist is empty'); playFrom(l, 0, true, true); S.ctx = '' } catch (er) { toast(er.message) } }
  else if (a === 'plm-like') {
    closeSheet(); try {
      const l = (await plTracks(el.dataset.code)).filter(t => t.uri && !S.liked[t.uri]); if (!l.length) return toast('All songs are already liked');
      let n = 0; for (const t of l) { toast(`Liking ${++n}/${l.length}…`); const r = await api('/api/liked-songs', { method: 'POST', body: { title: t.title, author: t.author, uri: t.uri || q(t), identifier: t.identifier } }); S.liked[t.uri] = r.id }
      toast('Liked ' + l.length + ' songs'); buzz()
    } catch (er) { toast(er.message) }
  }
  else if (a === 'plm-dl') {
    closeSheet(); if (!isPrem()) return premiumSheet('Downloading songs to listen offline is a Premium feature.');
    try {
      const c = el.dataset.code; let nm = el.dataset.name || '', cv = '';
      try { const i = await api('/api/playlist/info?code=' + encodeURIComponent(c)); nm = i.name || nm; cv = fixUrl(i.cover_image_url) || '' } catch (e) {}
      await dlPlaylist(c, nm, cv, await plTracks(c)); if (location.hash === '#library') route();
    } catch (er) { toast(er.message) }
  }
  else if (a === 'plm-del') { closeSheet(); if (!(await askYes('Delete this playlist for good?', 'Delete'))) return; try { await api('/api/playlists/' + el.dataset.pid, { method: 'DELETE' }); ev('pl_delete', { code: el.dataset.code }); toast('Playlist deleted'); route() } catch (er) { toast(er.message) } }
  else if (a === 'plm-unsave') { closeSheet(); const c = String(el.dataset.code).toUpperCase(); try { await api('/api/app/saved/' + encodeURIComponent(c), { method: 'DELETE' }); S.saved.delete(c); toast('Removed from your library'); route() } catch (er) { toast(er.message) } }
  else if (a === 'np-x') { hideSong(S.cur); act.next() }
  else if (a === 'np-menu' && S.cur) { const i0 = L.np = [S.cur]; sheet(`<h3>${esc(S.cur.title)}</h3><span class="sub">${esc(S.cur.author)}</span><div class="menu"><button data-a="like">${ic('plus')} ${S.liked[S.cur.uri] ? 'Remove from Liked' : 'Add to Liked'}</button><button data-a="add-to-pl" data-l="np" data-i="0">${ic('music')} Add to playlist ${isPrem() ? '' : ic('crown', 'gold')}</button><button data-a="more-by" data-q="${esc(S.cur.author)}">${ic('radio')} Song radio</button><button data-a="open-artist" data-name="${esc(S.cur.author)}">${ic('person')} Artist</button><button data-a="copy-cur">${ic('copy')} Copy</button></div>`) }
  else if (a === 'copy-cur') { closeSheet(); if (S.cur) copyText(songLink(S.cur), 'Copied') }
  else if (a === 'lyrics-full') openLyv();
  else if (a === 'close-lyv') closeLyv();
  else if (a === 'lyv-line') { const sec = parseFloat(el.dataset.t); if (isFinite(sec)) { if (mode() === 'phone') { if (isFinite(au.duration)) au.currentTime = sec } else ctl('seek', { position_ms: Math.floor(sec * 1000) }) } }
  else if (a === 'copy-collab-link') {
    try { await navigator.clipboard.writeText(el.dataset.link); toast('Invite link copied!'); buzz() }
    catch (e) { const t = $('#collab-link-txt'); if (t) { const sel = window.getSelection(), range = document.createRange(); range.selectNodeContents(t); sel.removeAllRanges(); sel.addRange(range) } toast('Select and copy the link above') }
  }
  else if (a === 'toggle') act.toggle(); else if (a === 'next') act.next(); else if (a === 'prev') act.prev();
  else if (a === 'shuffle') shuffleToggle();
  else if (a === 'repeat') { S.rep = { off: 'all', all: 'one', one: 'off' }[S.rep]; toast({ all: 'Repeat all', one: 'Repeat this song', off: 'Repeat off' }[S.rep]); ui() }
  else if (a === 'sleep') sheet(`<h3>${ic('moon')} Sleep timer</h3><div class="menu">${[15, 30, 45, 60].map(m => `<button data-a="sleep-set" data-m="${m}">${m} minutes</button>`).join('')}<button data-a="sleep-set" data-m="end">End of this song</button><button data-a="sleep-set" data-m="0">Turn off</button></div>`);
  else if (a === 'sleep-set') setSleep(el.dataset.m === 'end' ? 'end' : +el.dataset.m);
  else if (a === 'theme') { store.set('lm-theme', el.dataset.k); applyTheme(); document.querySelectorAll('#themes button').forEach(b => b.classList.toggle('on', b === el)) }
  else if (a === 'set-ds') { store.set('lm-ds', dsOn() ? '0' : '1'); el.querySelector('.sw').classList.toggle('on', dsOn()); toast(dsOn() ? 'Data saver ON' : 'Data saver OFF - best quality'); carKey = ''; carSet() }
  else if (a === 'set-haptic') { S.haptic = !S.haptic; store.set('lm-haptic', S.haptic ? '1' : '0'); el.querySelector('.sw').classList.toggle('on', S.haptic); buzz() }
  else if (a === 'chk-upd') checkUpdate(true);
  else if (a === 'edit-profile') editProfile();
  else if (a === 'open-web') { const u = (NAT || location.origin) + '/app'; if (bridge && bridge.open) bridge.open(u); else window.open(u, '_blank') }
  else if (a === 'ep-pick') pfPick(() => { const x = $('#ep-av'); if (x) x.setAttribute('style', pfAv()); if (location.hash === '#you') you() });
  else if (a === 'ep-reset') { try { applyProfile(await api('/api/app/profile/avatar', { method: 'DELETE' })); refreshTopAv(); const x = $('#ep-av'); if (x) x.setAttribute('style', pfAv()); toast('Photo removed'); if (location.hash === '#you') you() } catch (er) { toast(er.message) } }
  else if (a === 'ep-save') epSave();
  else if (a === 'notifs') { const p = $('#ntpop'); if (p && !p.hidden) { p.hidden = true; return } await loadNotifs(); openNotifs() }
  else if (a === 'nt-change') { const m = NT.find(x => String(x.id) === el.dataset.id); if (m) { m._edit = true; openNotifs() } }
  else if (a === 'nt-send') {
    const sel = document.querySelector(`input[name="nt-${el.dataset.id}"]:checked`);
    if (!sel) { toast('Pick an option first'); return }
    try { await api(`/api/notifications/${el.dataset.id}/respond`, { method: 'POST', body: { option_index: parseInt(sel.value, 10) } }); toast('Answer saved'); await loadNotifs(); openNotifs() } catch (er) { toast(er.message) }
  }
  else if (a === 'do-update') applyUpdate();
  else if (a === 'upd-later') { const u = $('#upd'); u.className = ''; u.innerHTML = updBanner(S.upd || {}) }
  else if (a === 'set-bass') { const on = store.get('lm-bass') !== '1'; store.set('lm-bass', on ? '1' : '0'); el.querySelector('.sw').classList.toggle('on', on); eqApply() }
  else if (a === 'set-duck') { duckOn = !duckOn; store.set('lm-duck2', duckOn ? '1' : '0'); el.querySelector('.sw').classList.toggle('on', duckOn); duckAuto(); toast(duckOn ? 'Auto volume ON - music dips when you play a game' : 'Auto volume OFF') }
  else if (a === 'set-autoupd') { const on = store.get('lm-autoupd') === '0'; store.set('lm-autoupd', on ? '1' : '0'); el.querySelector('.sw').classList.toggle('on', on); if (on) checkUpdate() }
  else if (a === 'adm-back') { location.hash = '#you' }
  else if (a === 'adm-tab') { adminPage(el.dataset.k) }
  else if (a === 'adm-apk-pick') admApk.click();
  else if (a === 'adm-push') admPush();
  else if (a === 'adm-user') admUserSheet(el);
  else if (a === 'adm-pl') admPlSheet(el.dataset.code);
  else if (a === 'adm-grant') { try { await api('/api/app/admin/grant', { method: 'POST', body: { user_id: el.dataset.uid, kind: el.dataset.kind, action: el.dataset.act, days: +el.dataset.days || 0 } }); closeSheet(); toast('Done'); buzz(); adminPage('users') } catch (er) { toast(er.message || 'Failed') } }
  else if (a === 'adm-tick') { try { await api('/api/app/admin/pl-tick', { method: 'POST', body: { code: el.dataset.code, tick: el.dataset.tick } }); PTK.map[el.dataset.code] = el.dataset.tick; closeSheet(); toast('Tick updated'); adminPage('playlists') } catch (er) { toast(er.message || 'Failed') } }
  else if (a === 'adm-pl-del') { if (!(await askYes('Delete this playlist?', 'Delete'))) return; try { await api('/api/app/admin/playlist/' + encodeURIComponent(el.dataset.code), { method: 'DELETE' }); closeSheet(); toast('Deleted'); adminPage('playlists') } catch (er) { toast(er.message || 'Failed') } }
  else if (a === 'an-type') { ADM.anOpts = anOptsRead(); ADM.anType = el.dataset.k; document.querySelectorAll('#an-type button').forEach(b => b.classList.toggle('on', b.dataset.k === ADM.anType)); const o = $('#an-opts'); if (o) o.hidden = ADM.anType === 'announcement' }
  else if (a === 'an-dur') { ADM.anDur = el.dataset.v; document.querySelectorAll('#an-dur button').forEach(b => b.classList.toggle('on', b.dataset.v === ADM.anDur)) }
  else if (a === 'an-em') { ADM.anEmoji = el.dataset.k; document.querySelectorAll('#an-em-row button[data-a="an-em"]').forEach(b => b.classList.toggle('on', b.dataset.k === ADM.anEmoji)) }
  else if (a === 'an-em-up') { anEmojiFile.value = ''; anEmojiFile.click() }
  else if (a === 'an-opt-add') { ADM.anOpts = anOptsRead(); if (ADM.anOpts.length >= 6) return toast('Up to 6 options'); ADM.anOpts.push(''); anOptsPaint(); const ins = document.querySelectorAll('#an-opt-list .an-oi'); if (ins.length) ins[ins.length - 1].focus() }
  else if (a === 'an-opt-del') { ADM.anOpts = anOptsRead(); ADM.anOpts.splice(+el.dataset.i, 1); anOptsPaint() }
  else if (a === 'adm-announce') {
    const t = ($('#an-t').value || '').trim(), x = ($('#an-x').value || '').trim(), type = ADM.anType || 'announcement';
    const opts = type === 'announcement' ? [] : anOptsRead();
    if (!t || !x) return toast('Write a title and a message');
    if (type !== 'announcement' && opts.length < 2) return toast('Add at least 2 options');
    const body = { title: t, text: x, type }; if (opts.length) body.options = opts;
    if (ADM.anEmoji) body.emoji = ADM.anEmoji;
    const hrs = +ADM.anDur; if (hrs > 0) { body.expires_in_hours = hrs; body.expires_at = new Date(Date.now() + hrs * 3600000).toISOString() }
    const sb = document.querySelector('[data-a="adm-announce"]'); if (sb) { if (sb.disabled) return; sb.disabled = true }
    try {
      await api('/api/app/admin/announce', { method: 'POST', body });
      $('#an-t').value = ''; $('#an-x').value = ''; ADM.anOpts = ['', '']; anOptsPaint();
      toast(type === 'announcement' ? 'Announcement sent' : type === 'poll' ? 'Poll sent' : 'Question sent'); buzz();
      loadNotifs();
    } catch (er) { toast(er.message || 'Failed') } finally { if (sb) sb.disabled = false }
  }
  else if (a === 'np-tab') panOpen(el.dataset.k);
  else if (a === 'np-pan-close') panClose();
  else if (a === 'np-save') { if (!S.cur) return; L.np = [S.cur]; el.dataset.l = 'np'; el.dataset.i = 0; document.querySelector('[data-a="np-menu"]') && 0; if (!isPrem()) return premiumSheet('Adding to playlists is a Premium feature.'); try { const d = await api('/api/playlists'); const pls = arr(d); sheet(`<h3>Add to playlist</h3><div class="menu">${pls.map(p => `<button data-a="do-add-np" data-pid="${esc(p.id)}">${esc(p.name)}</button>`).join('') || '<p class="sub">No playlists yet</p>'}</div>`) } catch (er) { toast(er.message) } }
  else if (a === 'do-add-np') { closeSheet(); try { await api(`/api/playlists/${el.dataset.pid}/tracks`, { method: 'POST', body: { query: S.cur.uri || fb(S.cur) } }); toast('Added to playlist') } catch (er) { toast(er.message) } }
  else if (a === 'np-mix') { if (await moreLikeThis()) { toast('Mix queued'); ui() } else toast('Could not build a mix') }
  else if (a === 'q-hist') { PAN.hist = !PAN.hist; queueList() }
  else if (a === 'q-rm') { const k = +el.dataset.i; if (k > S.qi) { S.queue.splice(k, 1); queueList() } }
  else if (a === 'open-np') openNP();
  else if (a === 'close-np') closeNP();
  else if (a === 'queue') { const qe = $('#np-queue'); qe.hidden = !qe.hidden; if (!qe.hidden) queueList() }
  else if (a === 'jump') { if (mode() === 'phone') { S.qi = i; startPhone(false) } else ctl(`queue/${i}/play`) }
  else if (a === 'close-sheet') closeSheet();
  else if (a === 'play-mix') { const m = arr(S.sync && S.sync.mix).map(nt).sort(() => Math.random() - .5); if (m.length) { ev('mix', { extra: m.length + ' songs' }); playFrom(m, 0, true, false) } }
  else if (a === 'speed') { const r = SPEEDS[(SPEEDS.indexOf(spd()) + 1) % SPEEDS.length]; store.set('lm-speed', String(r)); applySpeed(); toast('Speed ' + r + 'x') }
  else if (a === 'rp-clear') { store.set('lm-rp', '[]'); toast('Recently played cleared'); routeNow() }
  else if (a === 'install-app') {
    if (INSTALL_EVT) { try { INSTALL_EVT.prompt(); INSTALL_EVT = null } catch (e) { location.href = '/install' } }
    else location.href = '/install';
  }
  else if (a === 'native-login-google') { if (bridge && bridge.login) { bridge.login(NAT + '/auth/google/app'); const b = $('#lg-gg'); if (b) { b.disabled = true; b.querySelector('span').textContent = 'Waiting for Google…'; setTimeout(() => { b.disabled = false; b.querySelector('span').textContent = 'Login with Google' }, 25000) } } else toast('Open this inside the Legacy Music app') }
  else if (a === 'native-login') { if (bridge && bridge.login) { bridge.login(NAT + '/auth/app'); const b = $('#lg-go'); if (b) { b.disabled = true; b.querySelector('span').textContent = 'Waiting for Discord…'; setTimeout(() => { b.disabled = false; b.querySelector('span').textContent = 'Login with Discord' }, 25000) } } else toast('Open this inside the Legacy Music app') }
});
au.addEventListener('timeupdate', () => { if (sleepEnd && au.duration && au.duration - au.currentTime < .6) { sleepEnd = false; userPaused = true; au.pause(); ui(); toast('Sleep timer: music stopped') } });

/* ───────── APK extras: playback speed, styles ───────── */
const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
const spd = () => { const v = parseFloat(store.get('lm-speed') || '1'); return SPEEDS.includes(v) ? v : 1 };
function applySpeed() { au.defaultPlaybackRate = spd(); au.playbackRate = spd(); const b = $('#np-speed'); if (b) { b.textContent = spd() + 'x'; b.classList.toggle('on', spd() !== 1) } }
au.addEventListener('loadedmetadata', () => { if (NAT) applySpeed() });
au.addEventListener('play', () => { if (NAT && au.playbackRate !== spd()) applySpeed() });
function injectCss() {
  const st = document.createElement('style');
  st.textContent = `
.aotw{display:flex;gap:14px;align-items:center;width:100%;margin:6px 0 14px;padding:12px;border:0;border-radius:18px;text-align:left;color:inherit;background:linear-gradient(135deg,rgba(88,101,242,.35),rgba(59,157,255,.18));box-shadow:0 8px 28px rgba(0,0,0,.25)}
.aw-cv{flex:0 0 78px;height:78px;border-radius:11px;background-size:cover;background-position:center;box-shadow:0 6px 18px rgba(0,0,0,.4)}
.aw-tx{display:flex;flex-direction:column;gap:3px;min-width:0}.aw-tx em{font-style:normal;font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:#ffd166;font-weight:800}
.aw-tx b{font-size:17px;line-height:1.2}.aw-tx small{opacity:.7}
.mixcard{display:flex;gap:12px;align-items:center;width:100%;margin:0 0 14px;padding:12px 14px;border:0;border-radius:16px;color:inherit;text-align:left;background:linear-gradient(120deg,rgba(255,107,157,.28),rgba(255,177,66,.2))}
.mixcard b{display:block;font-size:16px}.mixcard small{opacity:.75}.mx-ic svg,.mx-pl svg{width:24px;height:24px;stroke:currentColor;fill:none;stroke-width:2}.mx-pl{margin-left:auto}.mx-pl svg{fill:currentColor;stroke:none}
.statgrid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.statgrid div{padding:12px;border-radius:14px;background:rgba(127,127,127,.12)}.statgrid b{display:block;font-size:22px}.statgrid span{font-size:12px;opacity:.7}
#np-speed{font-size:12px;font-weight:800;order:0}#np-speed.on{color:#3b9dff}
body.lg .top,body.lg .tabs,body.lg #mini{display:none!important}
.lg-wrap{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;padding:22px;overflow:hidden;background:#06070b;color:#eef1f8;text-align:center}
.lg-bg{position:absolute;inset:-32% -38%;display:flex;gap:14px;justify-content:center;align-items:flex-start;transform:rotate(-11deg)}
.lg-col{flex:0 0 min(38vw,180px);overflow:visible}
.lg-col:nth-child(2){margin-top:-70px}.lg-col:nth-child(3){margin-top:-24px}
.lg-col>div{display:flex;flex-direction:column;gap:14px;animation:lgup 64s linear infinite;will-change:transform}
.lg-col.dn>div{animation-name:lgdn;animation-duration:78s}
.lg-col:nth-child(3)>div{animation-duration:58s}
@keyframes lgup{from{transform:translate3d(0,0,0)}to{transform:translate3d(0,-50%,0)}}
@keyframes lgdn{from{transform:translate3d(0,-50%,0)}to{transform:translate3d(0,0,0)}}
.lg-c{position:relative;flex:none;aspect-ratio:1/1.12;border-radius:20px;overflow:hidden;background-color:#171a26;background-size:cover;background-position:center;border:1px solid rgba(255,255,255,.1);box-shadow:0 14px 34px rgba(0,0,0,.6)}
.lg-c:nth-child(3n+2){aspect-ratio:1/1.3}.lg-c:nth-child(3n){aspect-ratio:1/1}
.lg-c::after{content:'';position:absolute;inset:0;background:linear-gradient(transparent 42%,rgba(0,0,0,.85))}
.lg-c svg{position:absolute;left:50%;top:38%;width:46px;height:46px;margin:-23px 0 0 -23px;fill:rgba(255,255,255,.3)}
.lg-c div{position:absolute;left:11px;right:9px;bottom:10px;z-index:1;text-align:left;text-shadow:0 1px 6px rgba(0,0,0,.85)}
.lg-c b{display:block;font-size:14px;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lg-c small{display:block;margin-top:2px;font-size:11.5px;opacity:.8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lg-shade{position:absolute;inset:0;pointer-events:none;background:rgba(6,7,11,.38);background-image:radial-gradient(ellipse 120% 70% at 50% 50%,transparent 40%,rgba(6,7,11,.55)),linear-gradient(rgba(6,7,11,.9),transparent 22%,transparent 74%,rgba(6,7,11,.95))}
.lg-card{position:relative;width:100%;max-width:330px;padding:26px 22px 18px;border-radius:30px;background:rgba(8,9,15,.62);border:1px solid rgba(255,255,255,.12);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);box-shadow:0 24px 70px rgba(0,0,0,.65),inset 0 1px 0 rgba(255,255,255,.08);animation:lgin .9s cubic-bezier(.2,.8,.2,1) both}
@keyframes lgin{from{opacity:0;transform:translateY(26px) scale(.96)}to{opacity:1;transform:none}}
.lg-disc{position:relative;width:112px;height:112px;margin:0 auto;border-radius:50%;background:repeating-radial-gradient(circle,#0a0b11 0 2px,#1b1d2b 2px 4px);box-shadow:0 0 0 3px #5865f2,0 0 44px rgba(88,101,242,.6);display:grid;place-items:center;animation:lgspin 7s linear infinite}
/* v23.1: the logo sits straight in the middle of the spinning disc (counter-rotates so it never turns upside down) */
.lg-disc img{width:62px;height:62px;border-radius:50%;border:0;background:#0b0c10;box-shadow:0 6px 18px rgba(0,0,0,.6),0 0 0 2px rgba(255,255,255,.22);animation:lgspin 7s linear infinite reverse;object-fit:cover}
.lg-disc::after{content:'';position:absolute;inset:0;border-radius:50%;background:conic-gradient(from 20deg,transparent 0 20%,rgba(255,255,255,.16) 28%,transparent 36% 70%,rgba(255,255,255,.1) 78%,transparent 86%)}
@keyframes lgspin{to{transform:rotate(360deg)}}
.lg-card h1{margin:20px 0 6px;font-size:30px;letter-spacing:.2px;background:linear-gradient(90deg,#fff,#aebbff);-webkit-background-clip:text;background-clip:text;color:transparent}
.lg-card p{margin:0;font-size:14px;opacity:.78;line-height:1.5;text-wrap:balance}
.lg-eq{display:flex;gap:3px;height:40px;align-items:center;justify-content:center;margin:16px 0 18px;-webkit-mask-image:linear-gradient(90deg,transparent,#000 16%,#000 84%,transparent);mask-image:linear-gradient(90deg,transparent,#000 16%,#000 84%,transparent)}
.lg-eq i{width:3px;height:100%;border-radius:3px;background:linear-gradient(180deg,#d6ddff,#8a97ff 42%,#5865f2 58%,#37b4ff);box-shadow:0 0 9px rgba(112,132,255,.65);transform:scaleY(.14);transform-origin:center;animation:lgq var(--d,.8s) ease-in-out infinite alternate;animation-delay:var(--dl,0s);will-change:transform}
@keyframes lgq{from{transform:scaleY(.14)}to{transform:scaleY(var(--m,1))}}
.lg-btn{position:relative;overflow:hidden;display:flex;gap:10px;align-items:center;justify-content:center;width:100%;padding:15px;border:0;border-radius:999px;background:linear-gradient(135deg,#6a77ff,#4752e6);color:#fff;font:700 16px system-ui,sans-serif;box-shadow:0 10px 28px rgba(88,101,242,.5)}
.lg-btn::after{content:'';position:absolute;top:0;bottom:0;width:40%;left:-60%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.35),transparent);animation:lgs 2.8s infinite}
@keyframes lgs{0%{left:-60%}60%,100%{left:130%}}
.lg-btn svg{width:22px;height:22px;fill:#fff}.lg-btn.gg{margin-top:10px;background:#fff;color:#1f1f1f;box-shadow:0 8px 22px rgba(0,0,0,.28)}.lg-btn.gg svg{fill:none}.lg-btn.gg::after{display:none}.lg-btn[disabled]{opacity:.75}
.lg-by{display:inline-flex;align-items:center;justify-content:center;gap:9px;margin-top:18px;padding:6px 14px 6px 10px;border-radius:999px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.1);font-size:12.5px;color:rgba(238,241,248,.72)}
.lg-by b{color:#fff;font-weight:700}
.lg-av{position:relative;display:inline-block;width:32px;height:32px}
.lg-av>img:first-child{width:32px;height:32px;border-radius:50%;border:2px solid #5865f2;object-fit:cover;display:block}
.lg-av .lg-tk{position:absolute;right:-1px;top:-1px;width:16px;height:16px;filter:drop-shadow(0 1px 3px rgba(0,0,0,.55))}
.lg-ver{margin-top:10px;font-size:11px;letter-spacing:.3px;color:rgba(238,241,248,.42)}
@media (max-height:700px){.lg-disc{width:78px;height:78px}.lg-disc img{width:34px;height:34px}.lg-card{padding:18px 18px 14px}.lg-card h1{font-size:25px;margin-top:14px}.lg-eq{height:24px;margin:10px 0 12px}.lg-by{margin-top:12px}}
@media (prefers-reduced-motion:reduce){.lg-col>div,.lg-disc,.lg-eq i,.lg-btn::after,.lg-card{animation:none}.lg-eq i{transform:scaleY(calc(var(--m,1)*.6))}}`;
  document.head.appendChild(st);
}
injectCss();

/* ───────── APK: login, tokens, notification bridge ───────── */
const LG_FALLBACK = [['Softly', 'Karan Aujla'], ['GOAT', 'Diljit Dosanjh'], ['295', 'Sidhu Moose Wala'], ['Brown Munde', 'AP Dhillon'], ['No Love', 'Shubh'], ['Suit Suit', 'Guru Randhawa'],
  ['Qismat', 'Ammy Virk'], ['Bijlee Bijlee', 'Harrdy Sandhu'], ['Lehanga', 'Jass Manak'], ['Filhall', 'B Praak'], ['Phulkari', 'Gippy Grewal'], ['Nikle Currant', 'Jassie Gill'],
  ['Mamla Gadbad Hai', 'Gurdas Maan'], ['Saajan Raazi', 'Satinder Sartaaj'], ['Judaa', 'Amrinder Gill'], ['Jaani Tera Naa', 'Sunanda Sharma'], ['Naag', 'Jazzy B']].map(([title, author]) => ({ title, author, thumbnail: '' }));
const LG_CREATOR = { name: 'lord_diablo_009', avatar: '/static/badges/creator.png', fallback: '/static/pwa/icon-192.png', tick: '/static/badges/owner-white.svg' };   // change the logo / name of "Created by" here (drop your own file at static/badges/creator.png)
const LG_DISCORD = 'M20.317 4.37a19.79 19.79 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.74 19.74 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.1 13.1 0 01-1.872-.892.077.077 0 01-.008-.128c.126-.094.252-.192.372-.292a.074.074 0 01.078-.01c3.927 1.793 8.18 1.793 12.061 0a.074.074 0 01.079.009c.12.1.246.198.373.293a.077.077 0 01-.006.127 12.3 12.3 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.84 19.84 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.06.06 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z';
const lgHue = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h };
const LG_NOTE = '<svg viewBox="0 0 24 24"><path d="M12 3v10.55A4 4 0 1014 17V7h4V3z"/></svg>';
const lgCard = x => {
  const h = lgHue(x.author), g = `radial-gradient(circle at 75% 22%,hsl(${h} 75% 55%/.55),transparent 58%),linear-gradient(150deg,hsl(${h} 52% 30%),hsl(${(h + 55) % 360} 58% 12%))`;
  const img = x.thumbnail ? `url('${esc(encodeURI(String(x.thumbnail)).replace(/'/g, '%27').replace(/[()]/g, c => c === '(' ? '%28' : '%29'))}'),` : '';
  return `<div class="lg-c" style="background-image:${img}${g}">${x.thumbnail ? '' : LG_NOTE}<div><b>${esc(x.author)}</b><small>${esc(x.title)}</small></div></div>`;
};
function lgPrep(list) {       // one card per singer (never the same name twice); Sidhu Moose Wala is always in the mix
  const seen = new Set(), out = [];
  for (const x of list) { const k = String(x.author).toLowerCase().replace(/\s+/g, ' ').trim(); if (k && !seen.has(k)) { seen.add(k); out.push(x) } }
  const i = out.findIndex(x => /sidhu\s*moose/i.test(x.author));
  const sidhu = i >= 0 ? out.splice(i, 1)[0] : { title: '295', author: 'Sidhu Moose Wala', thumbnail: '' };
  out.splice(Math.min(3, out.length), 0, sidhu);
  return out;
}
function lgCols(list) {      // 3 tilted columns; the middle one runs the other way, every column repeats forever
  const cols = [[], [], []];
  lgPrep(list).forEach((x, i) => cols[i % 3].push(x));
  return cols.map((c, k) => { const h = c.map(lgCard).join(''); return `<div class="lg-col ${k === 1 ? 'dn' : 'up'}"><div>${h}${h}</div></div>` }).join('');
}
async function lgCovers() {   // mixed Punjabi songs for the login background (public endpoint, cached on the phone)
  try {
    const r = await fetch(U('/api/app/login-covers'), { credentials: 'omit' });
    if (r.ok) { const j = await r.json(), l = (j.items || []).filter(x => x.title && x.author); if (lgPrep(l).length >= 15) { store.set('lm-lgc', JSON.stringify(l.slice(0, 36))); return l } }
  } catch (e) {}
  return null;
}
function lgCreatorFix() {   // "Created by" logo = the owner's own logo (logged-in avatar), else static/badges/creator.png
  try {
    const im = document.querySelector('.lg-by .lg-av img'); if (!im) return;
    im.src = '/static/badges/creator.png';   // always the owner's own logo
  } catch (e) {}
}
function showLogin(msg) {
  store.set('lm-tok', ''); TOK = '';
  try { au.pause() } catch (e) {}
  $('#mini').hidden = true; $('#np').hidden = true; document.body.classList.add('lg');
    const bars = Array.from({ length: 27 }, (_, k) => { const x = (k - 13) / 13, m = (0.32 + 0.68 * Math.exp(-x * x * 2.2)) * (0.72 + 0.28 * Math.abs(Math.sin(k * 2.7))); return `<i style=\"--m:${m.toFixed(2)};--d:${(0.55 + (k * 7 % 9) * 0.07).toFixed(2)}s;--dl:-${((k * 5 % 11) * 0.09).toFixed(2)}s\"></i>` }).join('');
  const cached = jget('lm-lgc', []);
  view.innerHTML = `<div class=\"lg-wrap\"><div class=\"lg-bg\">${lgCols(lgPrep(cached).length >= 15 ? cached : LG_FALLBACK)}</div><span class=\"lg-shade\"></span>
    <div class=\"lg-card\"><div class=\"lg-disc\"><img src=\"/static/pwa/icon-192.png\" alt=\"\"></div>
      <h1>Legacy Music</h1><p>${esc(msg || 'Log in with Discord or Google to start listening.')}</p>
      <div class=\"lg-eq\">${bars}</div>
      <button class=\"lg-btn\" id=\"lg-go\" data-a=\"native-login\"><svg viewBox=\"0 0 24 24\"><path d=\"${LG_DISCORD}\"/></svg><span>Login with Discord</span></button>
      <button class=\"lg-btn gg\" id=\"lg-gg\" data-a=\"native-login-google\"><svg viewBox=\"0 0 48 48\"><path fill=\"#EA4335\" d=\"M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z\"/><path fill=\"#4285F4\" d=\"M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z\"/><path fill=\"#FBBC05\" d=\"M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z\"/><path fill=\"#34A853\" d=\"M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z\"/></svg><span>Login with Google</span></button>
      <div class=\"lg-by\"><span>Created by</span><span class=\"lg-av\"><img src=\"${LG_CREATOR.avatar}\" onerror=\"this.onerror=null;this.src='${LG_CREATOR.fallback}'\" alt=\"\"><img class=\"lg-tk\" src=\"${LG_CREATOR.tick}\" alt=\"official\"></span><b>${esc(LG_CREATOR.name)}</b></div>
      <div class=\"lg-ver\">v${CV} · notifications + playlist add</div></div></div>`;
  lgCovers().then(l => { const el = $('.lg-bg'); if (l && el && JSON.stringify(l.slice(0, 36)) !== JSON.stringify(cached)) el.innerHTML = lgCols(l) });
  lgCreatorFix();
}
function doLogout() {     // v23.1: a real logout - token, profile, cached account and the music notification are all cleared
  try { store.set('lm-mt', ''); store.set('lm-prof', ''); store.set('lm-me', ''); store.set('lm-cfg', ''); store.set('lm-tok', ''); TOK = ''; MT = '' } catch (e) {}
  try { au.pause() } catch (e) {}
  try { if (bridge && bridge.nowPlaying) bridge.nowPlaying('', '', false, '') } catch (e) {}
  try { history.replaceState(null, '', location.pathname + location.search + '#login') } catch (e) {}
  showLogin('You are logged out.');
}
window.lmOnToken = t => { if (t) { store.set('lm-tok', String(t)); location.reload() } };            // called by the Android app after the Discord login
async function refreshTokens() {
  if (!NAT || !TOK || !navigator.onLine) return;
  try {
    const r = await api('/api/app/token', { method: 'POST' });
    if (r && r.token) { const oldMt = MT; TOK = r.token; MT = r.media_token || ''; store.set('lm-tok', TOK); store.set('lm-mt', MT); store.set('lm-tokts', String(Date.now())); swapMt(oldMt, MT) }
  } catch (e) {}
}
function swapMt(o, n) {     // v23.1: pictures already on screen keep working after the 6 h media token was renewed
  if (!o || !n || o === n) return;
  try {
    const a = encodeURIComponent(o), b = encodeURIComponent(n);
    document.querySelectorAll('[style*="mt="]').forEach(el => { el.setAttribute('style', el.getAttribute('style').split(a).join(b)) });
    document.querySelectorAll('img[src*="mt="]').forEach(i => { i.src = i.src.split(a).join(b) });
  } catch (e) {}
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && NAT && TOK && Date.now() - (+store.get('lm-tokts') || 0) > 30 * 60000) refreshTokens() });
let lastNat = '';
function nativeSync(force) {
  if (!bridge || !bridge.nowPlaying) return;
  const t = S.cur, liked = !!(t && S.liked[t.uri]);
  const k = t ? [t.title, t.author, S.playing ? 1 : 0, liked ? 1 : 0, S.shuf ? 1 : 0, (typeof spd === 'function' ? spd() : 1), Math.floor((au.currentTime || 0) / 15)].join('|') : '';
  if (k === lastNat && !force) return; lastNat = k;
  const x = t ? JSON.stringify({ thumb: noMt(art(t)), thumb2: noMt(artHi(t)), pos: Math.round((au.currentTime || 0) * 1000), dur: (isFinite(au.duration) && au.duration > 0) ? Math.round(au.duration * 1000) : (t.duration || 0), liked, shuf: !!S.shuf, speed: (typeof spd === 'function' ? spd() : 1) }) : '';
  try { bridge.nowPlaying(t ? t.title : '', t ? t.author : '', !!S.playing, x) } catch (e) {}
}
window.lmCmd = c => {          // lock screen + notification buttons (the Android MediaSession sends these)
  c = String(c || '');
  if (c === 'toggle') act.toggle();
  else if (c === 'play') { userPaused = false; if (!au.getAttribute('src') || au.error) startPhone(false); else au.play().catch(() => {}) }
  else if (c === 'pause') { userPaused = true; au.pause() }
  else if (c === 'next') act.next(); else if (c === 'prev') goPrev(true);
  else if (c === 'like') { if (S.cur) likeToggle(S.cur) }
  else if (c === 'shuffle') shuffleToggle();
  else if (c.startsWith('seek:')) { const ms = +c.slice(5); if (isFinite(ms) && isFinite(au.duration)) { au.currentTime = Math.max(0, Math.min(au.duration, ms / 1000)); nativeSync(true) } }
};
if (NAT) {
  document.addEventListener('click', e => {          // links to the website: open outside the app (logout is handled here)
    const a = e.target.closest('a[href^="/"]'); if (!a) return;
    e.preventDefault(); e.stopPropagation();
    const h = a.getAttribute('href');
    if (h.startsWith('/auth/logout')) { doLogout(); return }
    if (bridge && bridge.open) bridge.open(NAT + h); else window.open(NAT + h, '_blank');
  }, true);
}

/* ───────── profile: username (unique), main name, avatar ───────── */
const PF_CAM = '<svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';
const prov = () => (S.prof && S.prof.provider === 'google') ? 'Google' : 'Discord';
function refreshTopAv() { const t = $('#top-av'); if (!t) return; t.setAttribute('style', bgi(S.me.avatar)); t.innerHTML = tick(S.cfg.role) }
function applyProfile(p) {      // the "main name" (display_name) replaces the old name everywhere the app shows S.me.username
  if (!p || !S.me) return; S.prof = p; store.set('lm-prof', JSON.stringify(p));
  if (p.display_name) S.me.username = p.display_name;
  const av = fixUrl(p.avatar); if (av) S.me.avatar = av;
  S.me.handle = p.username || '';
}
async function pfResize(file) {   // centre-crop to a 256x256 JPEG on the phone (small upload, works for any photo)
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('That file is not a picture')); i.src = url });
    const s = Math.min(img.naturalWidth, img.naturalHeight), c = document.createElement('canvas'); c.width = c.height = 256;
    c.getContext('2d').drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, 256, 256);
    return await new Promise(r => c.toBlob(r, 'image/jpeg', .86));
  } finally { URL.revokeObjectURL(url) }
}
async function pfUploadBlob(blob) {
  const fd = new FormData(); fd.append('file', blob, 'avatar.jpg');
  const r = await ff('/api/app/profile/avatar', { method: 'POST', body: fd, headers: TOK ? {} : { 'X-LM-Platform': 'pwa' } });
  let j = null; try { j = await r.json() } catch (e) {}
  if (!r.ok) throw new Error((j && j.detail) || 'Upload failed (' + r.status + ')');
  return j;
}
async function pfUpload(file) {
  const blob = await pfResize(file); if (!blob) throw new Error('Could not read the picture');
  const fd = new FormData(); fd.append('file', blob, 'avatar.jpg');
  const r = await ff('/api/app/profile/avatar', { method: 'POST', body: fd, headers: TOK ? {} : { 'X-LM-Platform': 'pwa' } });
  let j = null; try { j = await r.json() } catch (e) {}
  if (!r.ok) throw new Error((j && j.detail) || 'Upload failed (' + r.status + ')');
  return j;
}
function pfPick(done) {
  const f = document.createElement('input'); f.type = 'file'; f.accept = 'image/*';
  f.onchange = async () => { const file = f.files && f.files[0]; if (!file) return; try { const d = await cropImage(file, 1, 1, 256, 256, true); if (!d) return; toast('Uploading…'); const p = await pfUploadBlob(dataBlob(d)); applyProfile(p); refreshTopAv(); toast('Photo updated'); done && done(p) } catch (e) { toast(e.message) } };
  pickFile(f);
}
function unameWatch(inp, st, cb, same) {   // live "is this username free?" check
  let t = 0, seq = 0;
  inp.addEventListener('input', () => {
    const v = inp.value = inp.value.toLowerCase().replace(/[^a-z0-9_.]/g, ''); clearTimeout(t); cb(false);
    if (same && v === same) { st.textContent = 'This is your current username'; st.className = 'us-st ok'; cb(true); return }
    if (v.length < 3) { st.textContent = v ? 'At least 3 characters' : ''; st.className = 'us-st'; return }
    st.textContent = 'Checking…'; st.className = 'us-st'; const my = ++seq;
    t = setTimeout(async () => {
      try { const r = await api('/api/app/username/check?u=' + encodeURIComponent(v)); if (my !== seq) return; st.textContent = (r.ok ? '✓ ' : '✕ ') + r.reason; st.className = 'us-st ' + (r.ok ? 'ok' : 'bad'); cb(!!r.ok) }
      catch (e) { if (my === seq) { st.textContent = e.message; st.className = 'us-st bad' } }
    }, 350);
  });
}
const pfAv = () => bgi(fixUrl(S.prof && S.prof.avatar) || '/static/pwa/icon-192.png');
function usernameSetup() {      // first Google login: must choose a username before the app opens
  return new Promise(resolve => {
    const p = S.prof || {}, w = document.createElement('div'); let ok = false; w.className = 'us-wrap'; w.id = 'us';
    w.innerHTML = `<div class="us-box"><h1>Create your profile</h1><p class="sub">Choose a username. It has to be different from every Discord username.</p>
      <button class="us-av" id="us-av" type="button" style="${pfAv()}"><i>${PF_CAM}</i></button>
      <label class="pf-l">Name <small>shown in the app</small></label><input class="pf-in" id="us-name" maxlength="32" autocomplete="off" value="${esc(p.display_name || '')}">
      <label class="pf-l">Username <small>a-z, 0-9, _ and .</small></label><input class="pf-in" id="us-u" maxlength="20" placeholder="e.g. punjabi_beats" autocapitalize="none" autocomplete="off" spellcheck="false">
      <div class="us-st" id="us-st"></div><button class="btn" id="us-go" disabled>Continue</button></div>`;
    document.body.appendChild(w);
    const go = $('#us-go'), nm = $('#us-name'), u = $('#us-u');
    const sync = () => { go.disabled = !(ok && nm.value.trim()) };
    unameWatch(u, $('#us-st'), v => { ok = v; sync() }); nm.addEventListener('input', sync);
    $('#us-av').onclick = () => pfPick(() => { $('#us-av').setAttribute('style', pfAv()) });
    go.onclick = async () => {
      go.disabled = true; go.textContent = 'Saving…';
      try { const r = await api('/api/app/profile', { method: 'POST', body: { username: u.value, display_name: nm.value.trim() } }); applyProfile(r); w.remove(); resolve() }
      catch (e) { toast(e.message); go.textContent = 'Continue'; sync() }
    };
  });
}
async function editProfile() {
  if (!S.prof) { try { S.prof = await api('/api/app/profile') } catch (e) { return toast(e && e.status === 404 ? 'Update the server (profile_api.py) to edit your profile' : 'Could not open your profile: ' + ((e && e.message) || 'try again')) } }
  const p = S.prof, dc = p.provider === 'discord';
  sheet(`<h3>Edit profile</h3>
    ${dc ? `<div class="pf-top"><span class="us-av" style="${pfAv()}"></span><div class="pf-btns"><span class="sub">Discord login: you can change the name shown in the app. Your username stays the same.</span></div></div>`
      : `<div class="pf-top"><button class="us-av" data-a="ep-pick" type="button" id="ep-av" style="${pfAv()}"><i>${PF_CAM}</i></button>
      <div class="pf-btns"><button class="btn sm ghost" data-a="ep-pick">Change photo</button><button class="btn sm ghost" data-a="ep-reset">Remove photo</button></div></div>`}
    <label class="pf-l">Name <small>main name, shown in the app</small></label><input class="pf-in" id="ep-name" maxlength="32" autocomplete="off" value="${esc(p.display_name || '')}">
    ${dc ? `<label class="pf-l">Username <small>from Discord - cannot be changed</small></label><input class="pf-in" id="ep-ud" value="@${esc(p.username || '')}" disabled>`
      : `<label class="pf-l">Username <small>unique, a-z 0-9 _ .</small></label><input class="pf-in" id="ep-u" maxlength="20" autocapitalize="none" autocomplete="off" spellcheck="false" value="${esc(p.username || '')}">
    <div class="us-st" id="ep-st"></div>`}
    <div class="actions"><button class="btn" data-a="ep-save">Save</button></div>`);
  const u = $('#ep-u'); if (u) { u.dataset.ok = '1'; unameWatch(u, $('#ep-st'), v => { u.dataset.ok = v ? '1' : '' }, p.username || '') }
}
async function epSave() {
  const p = S.prof || {}, nm = $('#ep-name'), u = $('#ep-u'); if (!nm) return;
  const body = {}, name = nm.value.trim();
  if (!name) return toast('Enter a name');
  if (u) { const un = u.value.trim().toLowerCase(); if (un !== (p.username || '')) { if (!u.dataset.ok) return toast('Pick a username that is available'); body.username = un } }
  if (name !== p.display_name) body.display_name = name;
  if (!Object.keys(body).length) { closeSheet(); return }
  try { const r = await api('/api/app/profile', { method: 'POST', body }); applyProfile(r); refreshTopAv(); closeSheet(); toast('Profile saved'); if (location.hash === '#you') you() }
  catch (e) { toast(e.message) }
}

/* ───────── v23.1: pull down to refresh (like Spotify) ───────── */
(function () {
  const ind = document.createElement('div'); ind.id = 'ptr'; ind.innerHTML = '<i></i>'; document.body.appendChild(ind);
  let y0 = 0, x0 = 0, dy = 0, on = false, busy = false, locked = false;
  const TH = 64;
  const blocked = t => !!(t && t.closest && t.closest('input,textarea,select,#np,#np-pan,#lyv,#sheet,.cr-wrap,.ask-wrap,.us-wrap,#ntpop,.cards,.chips,.adm-seg'));
  const set = (px, spin) => { ind.style.opacity = px > 6 || spin ? 1 : 0; ind.style.transform = `translateY(${Math.round(px) - 56}px) rotate(${Math.round(px * 4)}deg)`; ind.classList.toggle('spin', !!spin) };
  document.addEventListener('touchstart', e => {
    on = false; locked = false; dy = 0;
    if (busy || e.touches.length !== 1 || (window.scrollY || 0) > 0 || document.body.classList.contains('lg') || blocked(e.target)) return;
    if (!$('#np').hidden || !$('#sheet').hidden) return;
    y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; on = true;
  }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (!on || locked) return;
    const t = e.touches[0], mx = t.clientX - x0; dy = t.clientY - y0;
    if (Math.abs(mx) > Math.abs(dy) + 6 || dy < 0 || (window.scrollY || 0) > 0) { if (dy < 0 || (window.scrollY || 0) > 0) { on = false; set(0) } return }
    set(Math.min(dy * 0.5, 84));
  }, { passive: true });
  const end = async () => {
    if (!on) return; on = false;
    if (dy * 0.5 >= TH * 0.8 && !busy) {
      busy = true; set(54, true); buzz && buzz(10);
      try { if (!S.offline) { await Promise.race([Promise.all([ptkLoad(), syncDown().catch(() => {})]), new Promise(r => setTimeout(r, 3500))]) } } catch (e) {}
      try { route() } catch (e) {}
      setTimeout(() => { busy = false; set(0) }, 450);
    } else set(0);
  };
  document.addEventListener('touchend', end, { passive: true });
  document.addEventListener('touchcancel', () => { on = false; set(0) }, { passive: true });
})();

/* v23.2: never leave a blank screen - if the app cannot start, show the reason (and a Retry button) instead */
addEventListener('unhandledrejection', e => { try { if (!view.innerHTML.trim()) view.innerHTML = `<div class="empty">Could not load: ${esc((e.reason && e.reason.message) || e.reason || 'unknown error')}<br><br><button class="btn sm" onclick="location.reload()">Retry</button></div>` } catch (_) {} });
addEventListener('error', e => { try { if (!view.innerHTML.trim()) view.innerHTML = `<div class="empty">Error: ${esc(e.message || 'unknown')}<br><br><button class="btn sm" onclick="location.reload()">Retry</button></div>` } catch (_) {} });
setTimeout(() => { try { if (!view.innerHTML.trim()) view.innerHTML = '<div class="empty">Still loading… if this stays blank, tap Retry.<br><br><button class="btn sm" onclick="location.reload()">Retry</button></div>' } catch (_) {} }, 9000);

/* ───────── start ───────── */
(async () => {
  if (NAT && !TOK) return showLogin();
  if (NAT) { await refreshTokens(); if (!TOK) return; setInterval(refreshTokens, 4 * 3600 * 1000) }
  try {
    const [me, cfg] = await Promise.all([api('/api/me'), api('/api/app/config')]);
    S.me = me; S.cfg = cfg; S.offline = false; store.set('lm-me', JSON.stringify(me)); store.set('lm-cfg', JSON.stringify(cfg));
    try { S.prof = await api('/api/app/profile') } catch (e) { S.prof = null }   // older server without profile_api.py: app works as before
  } catch (e) {
    const me = jget('lm-me', null), cfg = jget('lm-cfg', null);
    if (e.status === 426) return;
    if (me && cfg && (e.offline || !navigator.onLine)) { S.me = me; S.cfg = cfg; S.offline = true; toast("You're offline. Showing your downloads.") }
    else { view.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return }
  }
  if (!S.prof) S.prof = jget('lm-prof', null);
  applyProfile(S.prof);
  if (S.prof && S.prof.needs_username && !S.offline) await usernameSetup();   // Google login: choose your own username first
  refreshTopAv();
  dlMeta().then(l => l.forEach(x => { S.dl[x.id] = 1 }));
  if (!S.offline) { api('/api/liked-songs').then(l => arr(l).forEach(x => { S.liked[x.uri] = x.id })).catch(() => {}); checkUpdate(); checkPremiumExpiry(); loadNotifs(true) }
  try {
    if (history.state && (history.state.sh || history.state.np)) history.replaceState(null, '');   // stale overlay entry after a reload
    // opened straight on a playlist/artist link (invite link): put Home underneath so back goes Home instead of closing the app
    if (/^#(code|artist)\//.test(location.hash) && !sessionStorage.getItem('lm-nav')) {
      const h0 = location.hash, base = location.pathname + location.search;
      history.replaceState(null, '', base + '#home'); history.pushState(null, '', base + h0);
    }
    sessionStorage.setItem('lm-nav', '1');
  } catch (e) {}
  ev('open', { extra: (NAT ? 'apk v' : 'web app v') + CV });
  if (NAT) { const ex = $('.np-ex'); if (ex) ex.insertAdjacentHTML('afterbegin', '<button class="ib" data-a="speed" id="np-speed" aria-label="Playback speed">1x</button>'); applySpeed() }
  await Promise.race([syncDown(), new Promise(r => setTimeout(r, 2500))]);
  route(); poll(); restoreLast();
  if (!NAT && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(reg => {
      const watch = w => w && w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) showUpdate({ notes: 'New app files are ready.' }) });
      if (reg.waiting && navigator.serviceWorker.controller) showUpdate({ notes: 'New app files are ready.' });
      reg.addEventListener('updatefound', () => watch(reg.installing));
      setInterval(() => { if (!document.hidden) reg.update().catch(() => {}) }, 30 * 60000);
    }).catch(() => {});
    let rl = false; navigator.serviceWorker.addEventListener('controllerchange', () => { if (!rl && updShown) { rl = true; location.reload() } });
  }
})();
})();
