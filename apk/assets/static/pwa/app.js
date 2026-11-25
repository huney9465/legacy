/* Legacy Music app (v22.3). Installed app = plays in the phone. Website = plays in the Discord voice channel.
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
const CV = '22.3';
/* APK mode: the Android app bundles these files and talks to the server over HTTPS with a token (window.LM_BASE is set by its index.html).
   On the website / installed PWA LM_BASE is empty and everything works exactly as before (cookie login, same origin). */
const NAT = (typeof window.LM_BASE === 'string' && window.LM_BASE) ? window.LM_BASE.replace(/\/$/, '') : '';
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
const ic = (n, c = '') => `<svg class="i ${c}" viewBox="0 0 24 24">${P[n]}</svg>`;
const L = {};
const arr = x => Array.isArray(x) ? x : (x && (x.items || x.songs || x.playlists)) || [];
const fmt = ms => { ms = Math.max(0, Math.floor((ms || 0) / 1000)); return Math.floor(ms / 60) + ':' + String(ms % 60).padStart(2, '0') };
const nt = x => ({ title: x.title || '', author: x.author || '', uri: x.uri || '', identifier: x.identifier || x.youtube_id || '', thumbnail: x.thumbnail || '', duration: x.duration || 0, id: x.id, yr: songYear(x) });
const ytId = t => { if (/^[\w-]{11}$/.test(t.identifier) && /youtu/.test(t.uri)) return t.identifier; const m = /(?:youtube\.com\/(?:watch\?[^#]*v=|shorts\/)|youtu\.be\/)([\w-]{11})/.exec(t.uri || ''); return m ? m[1] : '' };
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const mode = () => S.cfg.phone_playback === false ? 'discord' : 'phone';
const TICKS = { owner: 'owner-white.svg', admin: 'admin.svg', premium: 'premium-tick.svg', official: 'pl-official.png' };
const tick = r => TICKS[r] ? `<img class="tick" src="/static/badges/${TICKS[r]}" alt="${r}">` : '';
const bgi = u => `background-image:url('${esc(encodeURI(String(u)).replace(/'/g, '%27').replace(/[()]/g, c => c === '(' ? '%28' : '%29'))}')`;
const art = t => t.thumbnail || (ytId(t) ? `https://i.ytimg.com/vi/${ytId(t)}/mqdefault.jpg` : '/static/pwa/icon-192.png');
/* v25 Data saver (default ON): lowest audio quality asked from the server, small covers only (a maxres cover is 100-300 KB, 3 of them per song = as much as the sound) */
const dsOn = () => store.get('lm-ds') !== '0';
const artHi = t => dsOn() ? art(t) : ytId(t) ? `https://i.ytimg.com/vi/${ytId(t)}/maxresdefault.jpg` : art(t);
const fixUrl = u => { if (!u || u === 'null' || u === 'undefined') return null; u = noMt(String(u).trim()); if (!u) return null; if (/^(data:|blob:)/i.test(u)) return u; if (/^https?:/i.test(u)) return withMt(u); if (u.startsWith('//')) return withMt(location.protocol + u); return withMt((NAT || location.origin) + (u.startsWith('/') ? '' : '/') + u) };
const buzz = n => { if (S.haptic && navigator.vibrate) navigator.vibrate(n || 12) };
let tm; const toast = m => { const e = $('#toast'); e.textContent = m; e.classList.add('on'); clearTimeout(tm); tm = setTimeout(() => e.classList.remove('on'), 3200) };
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
async function dlSong(t, quiet) {
  const id = ytId(t); if (!id) { if (!quiet) toast("This song can't be downloaded"); return false }
  if (S.dl[id]) { if (!quiet) toast('Already downloaded'); return true }
  if (!isPrem()) { premiumSheet('Downloading songs to listen offline is a Premium feature.'); return false }
  if (!navigator.onLine) { toast("You're offline"); return false }
  const b = $('#np-dl'); b && b.classList.add('busy'); if (!quiet) toast('Downloading…');
  try {
    const r = await ff(`/api/app/stream?v=${id}&dl=1&av=${CV}`);
    if (r.status === 426) { showUpdate({ update_required: true }); return false }
    if (r.status === 403) { premiumSheet('Downloading songs to listen offline is a Premium feature.'); return false }
    if (!r.ok) throw new Error("Couldn't download this song");
    const blob = await r.blob();
    await idbTx('songs', 'readwrite', s => s.put({ id, blob }));
    await idbTx('meta', 'readwrite', s => s.put({ id, title: t.title, author: t.author, thumbnail: art(t), duration: t.duration, size: blob.size, ts: Date.now(), uri: t.uri || `https://www.youtube.com/watch?v=${id}` }));
    S.dl[id] = 1; ev('download', { ref: t.uri || id, title: t.title, author: t.author }); if (!quiet) toast('Downloaded · plays offline'); buzz(); try { navigator.storage && navigator.storage.persist && navigator.storage.persist() } catch (e) {}
    return true;
  } catch (e) { if (!quiet) toast(e.message || 'Download failed'); return false }
  finally { b && b.classList.remove('busy'); ui() }
}
async function dlRemove(id) { ev('dl_rm', { ref: id }); await idbTx('songs', 'readwrite', s => s.delete(id)); await idbTx('meta', 'readwrite', s => s.delete(id)); delete S.dl[id] }

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
  plArtLoad();
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
  const rp = jget('lm-rp', []);
  const filtered = rp.filter(x => (x.type === 'song' ? (x.uri || x.title) : x.code) !== key);
  filtered.unshift({ type, ...item, ts: Date.now() });
  store.set('lm-rp', JSON.stringify(filtered.slice(0, 30)));
}
function rpGet() { return jget('lm-rp', []) }
// FIX: also fix playlist-open rpPush to pass userInitiated=true (user opened the playlist deliberately)

// Returns top played songs for Listen Again section
function listenAgainGet() {
  const pc = jget('lm-pc', {});
  return Object.values(pc).sort((a, b) => b.count - a.count).slice(0, 12);
}
const rpCards = list => {
  if (!list.length) return '';
  return `<h2>${ic('clock')} Recently played</h2><div class="cards">${list.slice(0, 12).map(x => {
    if (x.type === 'playlist') return `<button class="card" data-a="open-pl" data-code="${esc(x.code)}"><span class="cv" style="${bgi(fixUrl(x.thumbnail) || '/static/pwa/icon-512.png')}"></span><span class="t">${esc(x.title)}</span><span class="s">Playlist</span></button>`;
    return `<button class="card" data-a="rp-song" data-k="${esc(x.uri || x.title)}"><span class="cv" style="${bgi(x.thumbnail || '/static/pwa/icon-192.png')}"><b><svg viewBox="0 0 24 24">${PLAY}</svg></b></span><span class="t">${esc(x.title)}</span><span class="s">${esc(x.author || '')}</span></button>`;
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

function mediaMeta(t) {
  if (!('mediaSession' in navigator)) return;
  const hi = artHi(t), lo = art(t), sz = ['96x96', '128x128', '192x192', '256x256', '384x384', '512x512'];
  navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.author, album: 'Legacy Music',
    artwork: [...sz.map(s => ({ src: lo, sizes: s })), { src: hi, sizes: '1280x720' }] });
}
let lastPS = 0;
function mpos(force) {
  if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
  const n = Date.now(); if (!force && n - lastPS < 1000) return; lastPS = n;
  if (!isFinite(au.duration) || au.duration <= 0) return;
  try { navigator.mediaS
