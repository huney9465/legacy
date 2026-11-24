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
  auto: store.get('lm-auto') !== '0', rep: 'off', shuf: false, orig: null, ctx: '', chips: new Set(), offline: !navigator.onLine, haptic: store.get('lm-haptic') !== '0' };
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
const nt = x => ({ title: x.title || '', author: x.author || '', uri: x.uri || '', identifier: x.identifier || x.youtube_id || '', thumbnail: x.thumbnail || '', duration: x.duration || 0, id: x.id });
const ytId = t => { if (/^[\w-]{11}$/.test(t.identifier) && /youtu/.test(t.uri)) return t.identifier; const m = /(?:youtube\.com\/(?:watch\?[^#]*v=|shorts\/)|youtu\.be\/)([\w-]{11})/.exec(t.uri || ''); return m ? m[1] : '' };
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const mode = () => S.cfg.phone_playback === false ? 'discord' : 'phone';
const TICKS = { owner: 'owner-white', admin: 'admin', premium: 'premium-tick' };
const tick = r => TICKS[r] ? `<img class="tick" src="/static/badges/${TICKS[r]}.svg" alt="${r}">` : '';
const bgi = u => `background-image:url('${esc(encodeURI(String(u)).replace(/'/g, '%27').replace(/[()]/g, c => c === '(' ? '%28' : '%29'))}')`;
const art = t => t.thumbnail || (ytId(t) ? `https://i.ytimg.com/vi/${ytId(t)}/mqdefault.jpg` : '/static/pwa/icon-192.png');
const artHi = t => ytId(t) ? `https://i.ytimg.com/vi/${ytId(t)}/maxresdefault.jpg` : art(t);
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
function rpPush(type, item) {
  const rp = jget('lm-rp', []);
  const key = type === 'song' ? (item.uri || item.title) : item.code;
  const filtered = rp.filter(x => (x.type === 'song' ? (x.uri || x.title) : x.code) !== key);
  filtered.unshift({ type, ...item, ts: Date.now() });
  store.set('lm-rp', JSON.stringify(filtered.slice(0, 30)));
  if (type === 'song') ev('play', { ref: key, title: item.title, author: item.author, uri: item.uri, thumb: noMt(item.thumbnail || '') });
  else ev('pl_view', { code: item.code, title: item.title, thumb: noMt(item.thumbnail || '') });
  // Track play count for Listen Again
  if (type === 'song') {
    const pc = jget('lm-pc', {});
    const k = item.uri || item.title;
    pc[k] = { ...(pc[k] || {}), ...item, count: ((pc[k] || {}).count || 0) + 1, ts: Date.now() };
    // Keep top 50 most played
    const sorted = Object.entries(pc).sort((a, b) => b[1].count - a[1].count).slice(0, 50);
    store.set('lm-pc', JSON.stringify(Object.fromEntries(sorted)));
  }
}
function rpGet() { return jget('lm-rp', []) }
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
const streamUrl = t => withMt(U((ytId(t) ? `/api/app/stream?v=${ytId(t)}` : `/api/app/stream?q=${encodeURIComponent(fb(t).slice(0, 150))}`) + '&av=' + CV + '&hq=' + (isPrem() ? 1 : 0)));
let PT = 0, blobUrl = '', warmed = '';

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
  try { navigator.mediaSession.setPositionState({ duration: au.duration, position: Math.min(au.currentTime, au.duration), playbackRate: au.playbackRate || 1 }) } catch (e) {}
}
async function startPhone() {
  const t = S.queue[S.qi]; if (!t) return; userPaused = false;
  const my = ++PT; S.cur = t; warmed = '';
  const id = ytId(t); let src = '';
  if (id && S.dl[id]) { try { const r = await idbTx('songs', 'readonly', s => s.get(id)); if (r && r.blob) { if (blobUrl) URL.revokeObjectURL(blobUrl); src = blobUrl = URL.createObjectURL(r.blob) } } catch (e) {} }
  if (my !== PT) return;
  if (!src && !navigator.onLine) { toast("You're offline. Only downloaded songs play."); ui(); return }
  const url = src || streamUrl(t);
  // v22.5: nothing is awaited between the tap and play() any more (the old sound-probe delayed play and made Android refuse it)
  stallN = 0; clearTimeout(stallT); au.src = url; playNow();
  mediaMeta(t);
  // push to recently played
  rpPush('song', { title: t.title, author: t.author, uri: t.uri, thumbnail: art(t) });
  const h = jget('lm-hist', []); h.unshift({ a: t.author, t: t.title }); store.set('lm-hist', JSON.stringify(h.slice(0, 30)));
  ui();
  if (S.auto && S.queue.length - S.qi <= 3) moreLikeThis();
}
let loadingMore = false, failRun = 0;
function playNow() {
  const p = au.play();
  if (p && p.catch) p.catch(e => {
    if (e && e.name === 'AbortError') return;            // a newer song took over, nothing to do
    toast('Tap play to start');
    const go = () => { if (!userPaused && au.paused) au.play().catch(() => {}) };
    document.addEventListener('touchstart', go, { once: true, capture: true }); document.addEventListener('click', go, { once: true, capture: true });
  });
}
const streamUrlQ = t => withMt(U(`/api/app/stream?q=${encodeURIComponent(fb(t).slice(0, 150))}&av=${CV}&hq=${isPrem() ? 1 : 0}`));
// Keywords that signal lofi/cover/fan-made content
const FAKE_KWORDS = ['lofi', 'lo-fi', 'lo fi', 'slowed', 'slow +', 'slow and', 'reverb', 'nightcore', 'sped up', 'speed up', '8d audio', '8d', 'bass boosted', 'bassboosted', 'ai cover', '(ai)', '\u00a0(ai)', ' ai ', 'remake', 'recreat', 'cover by', ' cover)', '(cover', 'cover version', 'tribute', 'karaoke', 'instrumental', 'fan made', 'fan-made', 'mashup', 'mash-up', 'remix', 'status video', 'whatsapp status', 'shorts', 'reaction', 'reprise'];
function isFakeSong(t, ctx) {
  const ctxLower = (ctx || '').toLowerCase();
  // If the user searched for lofi etc., allow those through
  if (FAKE_KWORDS.some(k => ctxLower.includes(k))) return false;
  const title = (t.title || '').toLowerCase();
  return FAKE_KWORDS.some(k => title.includes(k));
}
// Detect if a song is a near-duplicate title of one already in queue
function isDupTitle(t, seen) {
  const tl = (t.title || '').toLowerCase().replace(/[^a-z0-9\u0900-\u097f\u0a00-\u0a7f\s]/g, '').trim();
  for (const s of seen) {
    const sl = s.toLowerCase().replace(/[^a-z0-9\u0900-\u097f\u0a00-\u0a7f\s]/g, '').trim();
    if (tl === sl) return true;
    // Check if one starts with the other (catches "Song Name" vs "Song Name (Full Video)")
    if (tl.length > 6 && sl.startsWith(tl)) return true;
    if (sl.length > 6 && tl.startsWith(sl)) return true;
  }
  return false;
}
const hideGet = () => jget('lm-hide', []), hideSong = t => { if (!t) return; const h = hideGet(); h.unshift(t.uri || fb(t)); store.set('lm-hide', JSON.stringify(h.slice(0, 300))); toast('Okay, we won\'t play this again') };
async function moreLikeThis() {
  if (loadingMore || !navigator.onLine) return false; loadingMore = true;
  try {
    const t = S.cur || S.queue[S.qi] || {}; if (!t.title && !t.author) return false;
    const seen = new Set(S.queue.map(x => x.uri || fb(x)));
    const seenTitles = new Set(S.queue.map(x => (x.title || '').toLowerCase()));
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
      fresh = arr(d.songs).map(nt).filter(keep).slice(0, 14);
    } catch (e) {}
    if (!fresh.length) {   // older server: search for the SONG itself (never for the trending / search page it was opened from)
      for (const qq of [`${t.title} ${t.author}`, `${t.author} songs`]) {
        if (!qq.trim()) continue;
        const d = await api('/api/music/search?query=' + encodeURIComponent(qq.trim()));
        fresh = arr(d.songs).map(nt).filter(keep).slice(0, 12);
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
  if (mode() === 'phone') { S.queue = asQueue ? list : [list[i]]; S.qi = asQueue ? i : 0; S.orig = null; S.shuf = false; startPhone(); buzz() }
  else discordPlay(whole ? list : [list[i]], whole ? i : 0);
}
async function ctl(a, body) { if (!S.gid) return toast('Join a voice channel in Discord first'); try { await api(`/api/guilds/${S.gid}/${a}`, { method: 'POST', body: body || undefined }); poll() } catch (e) { toast(e.message) } }
let userPaused = false;
const act = {
  toggle() { if (mode() === 'phone') { if (!S.cur) return; if (au.paused) { userPaused = false; au.play() } else { userPaused = true; au.pause() } } else ctl(S.playing ? 'pause' : 'resume') },
  async next(auto) {
    if (mode() !== 'phone') return ctl('skip');
    if (auto === true && S.rep === 'one') { au.currentTime = 0; au.play(); return }
    if (S.qi + 1 < S.queue.length) { S.qi++; startPhone() }
    else if (S.rep === 'all' && S.queue.length) { S.qi = 0; startPhone() }
    else if (S.auto && navigator.onLine && await moreLikeThis()) { S.qi++; startPhone() }
    else if (S.queue.length > 1) { S.qi = 0; startPhone() }
    else { userPaused = true; au.pause(); toast('End of queue') }
  },
  prev() { if (mode() === 'phone') { if (au.currentTime > 4 || S.qi < 1) au.currentTime = 0; else { S.qi--; startPhone() } } else ctl('previous') },
};
au.addEventListener('play', () => { S.playing = true; if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing'; mpos(true); ui() });
au.addEventListener('pause', () => { S.playing = false; if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'; mpos(true); ui() });
au.addEventListener('loadedmetadata', () => mpos(true));
au.addEventListener('seeked', () => mpos(true));
au.addEventListener('ended', () => act.next(true));
au.addEventListener('timeupdate', () => {
  ui(true); mpos();
  if (au.duration > 0 && au.currentTime / au.duration > .25 && navigator.onLine) {
    const n = S.queue[S.qi + 1], id = n && ytId(n);
    if (id && warmed !== id && !S.dl[id]) { warmed = id; ff(`/api/app/warm?v=${id}&av=${CV}`).catch(() => {}) }
  }
});
au.addEventListener('error', async () => {
  if (!au.src || au.src.startsWith('blob:')) return;
  try { const r = await fetch(au.src, { headers: { Range: 'bytes=0-0' }, credentials: NAT ? 'omit' : 'same-origin' }); if (r.status === 426) return showUpdate({ update_required: true }) } catch (e) {}
  const ct = S.cur;
  if (ct && !ct._q && ytId(ct)) { ct._q = 1; stallN = 0; clearTimeout(stallT); au.src = streamUrlQ(ct); playNow(); return }   // id failed -> find the same song by name
  if (recover('error')) return;
  if (++failRun >= 4) { failRun = 0; userPaused = true; toast("Songs can't load right now. Check your internet and try again."); ui(); return }
  toast("Couldn't play this song, skipping"); setTimeout(() => act.next(), 900);
});

/* ───────── smooth playback: stall recovery ───────── */
let stallT = 0, stallN = 0;
function recover(why) {
  if (!au.src || au.src.startsWith('blob:') || !navigator.onLine || stallN >= 3) return false;
  stallN++; const pos = au.currentTime || 0, src = au.src;
  try { au.src = src; au.load(); const go = () => { au.removeEventListener('loadedmetadata', go); if (pos > 1) au.currentTime = pos; au.play().catch(() => {}) }; au.addEventListener('loadedmetadata', go) } catch (e) { return false }
  return true;
}
au.preload = 'auto';
au.addEventListener('waiting', () => { clearTimeout(stallT); stallT = setTimeout(() => { if (!au.paused && au.readyState < 3) recover('stall') }, 6500) });
['playing', 'canplay', 'pause', 'emptied'].forEach(e => au.addEventListener(e, () => clearTimeout(stallT)));
au.addEventListener('playing', () => { failRun = 0; if (au.currentTime > 5) stallN = 0 });

/* ───────── keep playing: if Android/WebView pauses the song by itself, resume it ───────── */
let kaT = 0;
au.addEventListener('pause', () => { clearTimeout(kaT); if (userPaused || au.ended || sleepEnd || !S.cur || mode() !== 'phone') return;
  kaT = setTimeout(() => { if (au.paused && !userPaused && !au.ended) au.play().catch(() => {}) }, 350) });
document.addEventListener('visibilitychange', () => { if (!userPaused && S.cur && au.paused && !au.ended && mode() === 'phone' && S.playing) au.play().catch(() => {}) });
setInterval(() => { if (!userPaused && S.playing && au.paused && !au.ended && S.cur && mode() === 'phone') au.play().catch(() => {}) }, 4000);

/* ───────── sound: gentle bass (everyone) + extra clarity (Premium) ───────── */
let AX = null, EQ_OK = null;
async function eqProbe(url) {
  if (EQ_OK !== null || !NAT) return;
  if (store.get('lm-eq-cors') === '0' && Date.now() - (+store.get('lm-eq-ts') || 0) < 864e5) { EQ_OK = false; return }
  try {
    const r = await Promise.race([fetch(url, { headers: { Range: 'bytes=0-1' } }), new Promise((_, j) => setTimeout(j, 1800))]);
    EQ_OK = !!(r && (r.ok || r.status === 206)); try { r.body && r.body.cancel() } catch (e) {}
  } catch (e) { EQ_OK = false }
  store.set('lm-eq-cors', EQ_OK ? '1' : '0'); store.set('lm-eq-ts', String(Date.now()));
  if (EQ_OK) au.crossOrigin = 'anonymous';
}
function eqApply() {
  const on = store.get('lm-bass') !== '0'; if (!EQ_OK || !on && !AX) return;
  try {
    if (!AX) {
      const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
      const ctx = new C({ latencyHint: 'playback' }), src = ctx.createMediaElementSource(au);
      const low = ctx.createBiquadFilter(); low.type = 'lowshelf'; low.frequency.value = 110;
      const hi = ctx.createBiquadFilter(); hi.type = 'highshelf'; hi.frequency.value = 9000;
      const lim = ctx.createDynamicsCompressor(); lim.threshold.value = -7; lim.knee.value = 14; lim.ratio.value = 3; lim.attack.value = .01; lim.release.value = .25;
      src.connect(low); low.connect(hi); hi.connect(lim); lim.connect(ctx.destination);
      AX = { ctx, low, hi };
    }
    AX.low.gain.value = on ? (isPrem() ? 5 : 3) : 0; AX.hi.gain.value = on && isPrem() ? 1.5 : 0;
    if (AX.ctx.state === 'suspended') AX.ctx.resume();
  } catch (e) {}
}
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
const LK_ON = '<circle cx="12" cy="12" r="10" fill="#1ed760" stroke="none"/><path d="M7.5 12.3l3 3 6-6.6" stroke="#000" stroke-width="2.4" fill="none"/>', LK_OFF = '<path d="M12 5v14M5 12h14"/>';
let _pp = null, _mode = '', _tint = '';
function setLikeIcon(spin) {
  const b = $('#np-like'), i = $('#np-add-icon'); if (!b || !i) return; const on = !!(S.cur && S.liked[S.cur.uri]);
  b.classList.toggle('on', on); i.innerHTML = on ? LK_ON : LK_OFF;
  if (spin) { b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop') }
}
function tintFor(t) {          // cheap one-off: average colour of the cover -> background of Now Playing + mini player
  const im = new Image(); im.crossOrigin = 'anonymous'; im.decoding = 'async';
  im.onload = () => { try { const c = document.createElement('canvas'); c.width = c.height = 1; const x = c.getContext('2d'); x.drawImage(im, 0, 0, 1, 1); const d = x.getImageData(0, 0, 1, 1).data;
    const m = Math.max(d[0], d[1], d[2], 1), k = Math.min(1, 150 / m); const col = `rgb(${d[0] * k | 0},${d[1] * k | 0},${d[2] * k | 0})`;
    document.documentElement.style.setProperty('--np-tint', col) } catch (e) {} };
  im.onerror = () => document.documentElement.style.setProperty('--np-tint', '#3a3550');
  im.src = art(t);
}
function ui(light) {
  const phone = mode() === 'phone', t = S.cur;
  const pl = !!S.playing; if (document.body.classList.contains('playing') !== pl) document.body.classList.toggle('playing', pl);
  nativeSync();
  $('#mini').hidden = !t; if (!t) { $('#np').hidden = true; lyvHide(); return }
  const pos = phone ? au.currentTime * 1000 : S.pos, dur = phone ? ((isFinite(au.duration) && au.duration > 0) ? au.duration * 1000 : t.duration) : S.dur;
  $('#mini-bar').style.width = dur ? Math.min(100, pos / dur * 100) + '%' : '0';
  if (_pp !== pl) { _pp = pl; const pp = pl ? PAUSE : PLAY; $('#mini-pp').innerHTML = pp; $('#np-pp').innerHTML = pp }
  const key = t.title + t.author;
  if ($('#mini-t').dataset.k !== key) {
    $('#mini-t').dataset.k = key;
    $('#mini-t').textContent = t.title; $('#mini-s').textContent = t.author;
    $('#mini-art').src = art(t); $('#np-art').src = artHi(t);
    $('#np-t').textContent = t.title; $('#np-s').textContent = t.author;
    setLikeIcon(false); tintFor(t); lyricsLoad(t); artistCard(t); miniLike();
    if (!light) document.querySelectorAll('.row.on').forEach(r => r.classList.remove('on'));
  }
  if (!$('#np').hidden) {
    const id = ytId(t), md = phone ? 'Playing on this phone' : 'Playing in Discord';
    if (_mode !== md) { _mode = md; $('#np-mode').textContent = S.ctxName || 'Recommended for you' }
    $('#np-cur').textContent = fmt(pos); $('#np-dur').textContent = fmt(dur);
    if (!seeking) $('#np-seek').value = dur ? pos / dur * 1000 : 0;
    $('#np-shuf').classList.toggle('on', S.shuf); $('#np-rep').classList.toggle('on', S.rep !== 'off'); $('#np-rep').classList.toggle('one', S.rep === 'one');
    $('#np-auto').classList.toggle('on', S.auto); $('#np-sleep').classList.toggle('on', !!sleepT || sleepEnd); $('#np-dl').classList.toggle('on', !!(id && S.dl[id]));
    lyricsTick(pos);
    if (!light && !$('#np-queue').hidden) queueList();
  }
}
function miniLike() { const b = $('#mini-like'); if (!b || !S.cur) return; const on = !!S.liked[S.cur.uri]; b.innerHTML = `<svg viewBox="0 0 24 24">${on ? LK_ON : LK_OFF}</svg>`; b.classList.toggle('on', on) }
const npArt = $('#np-art'); npArt.addEventListener('error', () => { if (S.cur && npArt.src !== art(S.cur)) npArt.src = art(S.cur) });
let seeking = false; const sk = $('#np-seek');
sk.addEventListener('input', () => { seeking = true });
sk.addEventListener('change', () => {
  seeking = false; const f = sk.value / 1000;
  if (mode() === 'phone') { if (isFinite(au.duration)) au.currentTime = au.duration * f } else if (S.dur) ctl('seek', { position_ms: Math.floor(S.dur * f) });
});
function queueList() {
  const phone = mode() === 'phone';
  const items = phone ? S.queue.map((t, i) => ({ ...t, i, on: i === S.qi })) : ((S.pl && S.pl.queue) || []).map((t, i) => ({ title: t.title, author: t.author, thumbnail: t.thumbnail, i, on: false }));
  $('#np-queue').innerHTML = `<h2>Up next <small>${phone ? (S.auto ? 'autoplay is on' : 'this phone') : 'Discord queue'}</small></h2>` + (items.length ? items.map(t => rowHtml(t, `data-a="jump" data-i="${t.i}"`, t.on)).join('') : '<div class="empty">Queue is empty</div>');
}
function openNP() { if (!S.cur) return; $('#np').hidden = false; try { history.pushState({ np: 1 }, '') } catch (e) {} ui() }
function closeNP() { if (history.state && history.state.np) history.back(); else $('#np').hidden = true }
addEventListener('popstate', () => { if (!$('#np').hidden && !(history.state && history.state.np)) $('#np').hidden = true });
let ty = 0; $('#np').addEventListener('touchstart', e => { ty = e.touches[0].clientY }, { passive: true });
$('#np').addEventListener('touchend', e => { if (e.changedTouches[0].clientY - ty > 110 && $('#np').scrollTop < 5 && !e.target.closest('input')) closeNP() }, { passive: true });

/* ───────── pieces ───────── */
const eqHtml = '<span class="eqb"><i></i><i></i><i></i></span>';
const rowHtml = (t, attrs, on, extra = '') => { const id = ytId(t); return `<button class="row${on ? ' on' : ''}" ${attrs}><span class="th" style="${bgi(art(t))}"></span><span class="tx"><span class="t">${on ? eqHtml : ''}${esc(t.title)}${id && S.dl[id] ? '<span class="dl-ok"><svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg></span>' : ''}</span><span class="s">${esc(t.author)}</span></span>${extra}</button>` };
const songRow = (name, i, t, extra = '') => rowHtml(t, `data-a="play" data-l="${name}" data-i="${i}"`, S.cur && S.cur.uri && S.cur.uri === t.uri, `<span class="d">${t.duration ? fmt(t.duration) : ''}</span>${extra}`);
const moreBtn = (name, i) => `<span class="ib more" role="button" data-a="more" data-l="${name}" data-i="${i}" aria-label="More"><svg viewBox="0 0 24 24" style="fill:currentColor;stroke:none"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg></span>`;
const songCards = (name, list) => `<div class="cards">${list.map((t, i) => `<button class="card" data-a="play" data-l="${name}" data-i="${i}"><span class="cv" style="${bgi(art(t))}"><b><svg viewBox="0 0 24 24">${PLAY}</svg></b></span><span class="t">${esc(t.title)}</span><span class="s">${esc(t.author)}</span></button>`).join('')}</div>`;
const plCards = (list, tag) => `<div class="cards">${list.map(p => `<button class="card" data-a="open-pl" data-code="${esc(p.code)}"><span class="cv" data-plcode="${plc(p.code)}" style="${bgi(fixUrl(p.cover_image_url) || '/static/pwa/icon-512.png')}">${tag && p._src ? `<i class="src ${p._src === 'App' ? 'app' : ''}">${p._src}</i>` : ''}${p.collab ? '<i class="src collab">Collab</i>' : ''}</span><span class="t">${esc(p.name)}</span><span class="s">${p.owner_name ? esc(p.owner_name) + ' · ' : ''}${p.track_count || 0} songs</span></button>`).join('')}</div>`;
const skel = n => '<div class="sk"></div>'.repeat(n);
/* Sheets own a history entry, so the phone's back button closes the sheet instead of leaving the page.
   closeSheet() pops that entry (async) - run anything that navigates afterwards through afterSheet(). */
let skipPop = 0, afterPop = [];
function sheet(html) {
  $('#sheet-box').innerHTML = html; $('#sheet').hidden = false;
  if (!(history.state && history.state.sh)) { try { history.pushState({ sh: 1 }, '') } catch (e) {} }
}
function closeSheet() {
  if ($('#sheet').hidden) return;
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
    ? `<img src="/static/pwa/icon-192.png" width="84" height="84" style="border-radius:22px" alt=""><h1>Update required</h1><p class="sub" style="max-width:300px">This version of the app is no longer supported. Update to keep listening.<br>${notes}</p><button class="btn" data-a="do-update">${ic('refresh')} Update now</button><a class="sub" style="margin-top:14px" href="${esc(v.update_url || (NAT ? '/download/app.apk' : '/install?update=1'))}">${NAT ? 'Download the new APK' : 'Open the website to update / reinstall'}</a>`
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
const ntUnread = () => { const seen = ntSeenGet(); return NT.some(m => (m.type === 'poll' || m.type === 'mcq') ? (m.my_response == null) : !seen.includes(m.id)) };
const ntDot = () => { const d = $('#bell .ndot'); if (d) d.hidden = !ntUnread() };
function ntCard(m) {
  const kind = m.type === 'announcement' ? '📢 Announcement' : m.type === 'poll' ? '📊 Poll' : '❓ Question';
  let body = `<p>${esc(m.text)}</p>`;
  if (m.type !== 'announcement' && m.options) {
    if (m.my_response != null && !m._edit) {
      const c = m.response_counts || {}, t = Object.values(c).reduce((a, b) => a + b, 0);
      body += m.options.map((o, i) => { const n = c[i] || 0, pc = t ? Math.round(n / t * 100) : 0;
        return `<div class="nt-opt"><div><span>${i === m.my_response ? '✓ ' : ''}${esc(o)}${i === m.my_response ? ' <em>(your answer)</em>' : ''}</span><span>${pc}%</span></div><div class="nt-bar"><i style="width:${pc}%"></i></div></div>` }).join('')
        + `<a class="lnk" data-a="nt-change" data-id="${m.id}">Change answer</a>`;
    } else body += m.options.map((o, i) => `<label class="nt-radio"><input type="radio" name="nt-${m.id}" value="${i}"> ${esc(o)}</label>`).join('') + `<button class="btn" data-a="nt-send" data-id="${m.id}">Submit</button>`;
  }
  return `<div class="nt"><b>${kind}${m.title ? ' — ' + esc(m.title) : ''}</b>${m.created_by_name ? `<div class="by">${esc(m.created_by_name)}${m.created_by_is_owner ? ' · Owner' : ''}</div>` : ''}${body}</div>`;
}
function openNotifs() {
  sheet(`<h3>Announcements</h3>${NT.length ? NT.map(ntCard).join('') : '<p class="sub">You\'re all caught up.</p>'}<div class="actions"><button class="btn ghost" data-a="close-sheet">Close</button></div>`);
  try { store.set('lm-seen-nt', JSON.stringify([...new Set([...ntSeenGet(), ...NT.map(m => m.id)])])) } catch (e) {}
  ntDot();
}
async function loadNotifs(auto) {
  if (S.offline || !navigator.onLine) return;
  try {
    const d = await api('/api/notifications'); NT = arr(d.messages && d.messages.map(m => m) || []);
    if (!$('#sheet').hidden && $('#sheet-box h3') && $('#sheet-box h3').textContent === 'Announcements') { NT.forEach(m => { const o = (NTold || {})[m.id]; if (o && o._edit && m.my_response == null) m._edit = true }) }
    NTold = Object.fromEntries(NT.map(m => [m.id, m]));
    ntDot();
    if (auto && ntUnread() && !sessionStorage.getItem('lm-nt-auto') && $('#upd').hidden) { sessionStorage.setItem('lm-nt-auto', '1'); openNotifs() }
  } catch (e) {}
}
let NTold = {};
setInterval(() => { if (document.visibilityState === 'visible') loadNotifs() }, 5 * 60000);

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

const aotw = (p, fb) => `<button class="aotw" data-a="open-pl" data-code="${esc(p.code)}"><span class="aw-cv" data-plcode="${plc(p.code)}" style="${bgi(fixUrl(p.cover_image_url) || '/static/pwa/icon-512.png')}"></span><span class="aw-tx"><em>${fb ? 'Top album' : 'Album of the week'}</em><b>${esc(p.name)}</b><small>${esc(p.owner_name || '')}${p.track_count ? ' · ' + p.track_count + ' songs' : ''}${p.views ? ' · ' + p.views + (fb ? ' views' : ' viewers this week') : ''}</small></span></button>`;
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
  if (sv.length) h += `<h2>Saved playlists</h2>${plCards(sv)}`;
  L.listen = (la.length ? la : r).map(nt);
  if (L.listen.length) h += `<h2>Listen again</h2>${songCards('listen', L.listen)}`;
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
  if ($('#h1')) $('#h1').outerHTML = h;
}

const CHIPS = [['Recently Played', '__rp__'], ['Punjabi', 'punjabi'], ['Hindi', 'hindi'], ['English', 'english'], ['Old', 'old classic'], ['90s', '90s'], ['Lofi', 'lofi'], ['Sad', 'sad'], ['Romantic', 'romantic'], ['Party', 'party'], ['Devotional', 'bhakti devotional']];
let st;
function search(prefill) {
  // Build recently played songs list (max 12)
  const rp = rpGet().filter(x => x.type === 'song').slice(0, 12);
  const rpHtml = rp.length ? rp.map((x, i) => `<button class="row rp-row" data-a="rp-song" data-k="${esc(x.uri || x.title)}"><span class="th" style="${bgi(x.thumbnail || '/static/pwa/icon-192.png')}"></span><span class="tx"><span class="t">${esc(x.title)}</span><span class="s">${esc(x.author || '')}</span></span></button>`).join('') : '<div class="empty" style="padding:16px 0">No recently played songs yet.</div>';
  view.innerHTML = `<h1>Search</h1><label class="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg><input id="q" type="search" placeholder="Songs, artists, YouTube links…" autocomplete="off" enterkeyhint="search"></label>
  <div class="chips" id="chips">${CHIPS.map(([n]) => `<button class="chip${S.chips.has(n) ? ' on' : ''}" data-a="chip" data-n="${n}">${n}</button>`).join('')}</div>
  <div id="res"><div id="rp-list"><h2 style="margin-top:14px">${ic('clock')} Recently played</h2>${rpHtml}</div></div>`;
  const inp = $('#q'); if (prefill) inp.value = prefill; else inp.focus();
  inp.addEventListener('input', () => { clearTimeout(st); st = setTimeout(run, 380) });
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { clearTimeout(st); run() } });
  if (prefill || (S.chips.size && !S.chips.has('Recently Played'))) run();
}
async function run() {
  const inp = $('#q'); if (!inp) return;
  const txt = inp.value.trim();
  // Handle "Recently Played" chip specially
  if (S.chips.has('Recently Played') && !txt) {
    const rp = rpGet().filter(x => x.type === 'song').slice(0, 12);
    const R = $('#res');
    if (R) R.innerHTML = `<div id="rp-list"><h2 style="margin-top:14px">${ic('clock')} Recently played</h2>` +
      (rp.length ? rp.map((x, i) => `<button class="row rp-row" data-a="rp-song" data-k="${esc(x.uri || x.title)}"><span class="th" style="${bgi(x.thumbnail || '/static/pwa/icon-192.png')}"></span><span class="tx"><span class="t">${esc(x.title)}</span><span class="s">${esc(x.author || '')}</span></span></button>`).join('') : '<div class="empty">No recently played songs yet.</div>') + '</div>';
    return;
  }
  const extra = CHIPS.filter(([n]) => S.chips.has(n) && n !== 'Recently Played').map(c => c[1]).join(' ');
  const v = (txt + ' ' + extra).trim() + (!txt && extra ? ' songs' : '');
  if (v.length < 2) {
    // Show RP list again when no query
    const rp = rpGet().filter(x => x.type === 'song').slice(0, 12);
    const R = $('#res');
    if (R) R.innerHTML = `<div id="rp-list"><h2 style="margin-top:14px">${ic('clock')} Recently played</h2>` +
      (rp.length ? rp.map((x, i) => `<button class="row rp-row" data-a="rp-song" data-k="${esc(x.uri || x.title)}"><span class="th" style="${bgi(x.thumbnail || '/static/pwa/icon-192.png')}"></span><span class="tx"><span class="t">${esc(x.title)}</span><span class="s">${esc(x.author || '')}</span></span></button>`).join('') : '<div class="empty">No recently played songs yet.</div>') + '</div>';
    return;
  }
  const my = RT, R = $('#res'); R.innerHTML = skel(6);
  try {
    const d = await api('/api/music/search?query=' + encodeURIComponent(v)); if (my !== RT) return;
    clearTimeout(S.evS); if (v.length > 1) S.evS = setTimeout(() => ev('search', { title: v }), 2500);
    L.search = arr(d.songs).map(nt); S.ctx = v; const arts = arr(d.artists).filter(a => a && a.name).slice(0, 8);
    if (txt) { const rq = jget('lm-rq', []).filter(x => x !== txt); rq.unshift(txt); store.set('lm-rq', JSON.stringify(rq.slice(0, 8))) }
    // Filter fake/lofi songs from search results unless user searched for them
    const ctxLow = v.toLowerCase();
    const filteredSearch = L.search.filter(x => !isFakeSong(x, ctxLow));
    // Show filtered results (fall back to unfiltered if all were filtered)
    const displaySearch = filteredSearch;   // v22.8: only original songs. Lofi / slowed / remix show up only when you type them
    L.search = displaySearch;   // v22.8: clicks use the SAME list that is shown, so the tapped song is the one that plays
    R.innerHTML = (arts.length ? `<h2>Artists</h2>${artistCards(arts)}<h2>Songs</h2>` : '') + (displaySearch.length ? displaySearch.map((x, i) => songRow('search', i, x, moreBtn('search', i))).join('') : '<div class="empty">No songs found</div>');
  } catch (e) { if (my === RT) R.innerHTML = `<div class="empty">${esc(e.message)}</div>` }
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
  const rowP = (x, sub) => `<button class="row" data-a="open-pl" data-code="${esc(x.code)}"><span class="th" data-plcode="${plc(x.code)}" style="${bgi(fixUrl(x.cover_image_url) || '/static/pwa/icon-512.png')}"></span><span class="tx"><span class="t">${esc(x.name)}${x.collab ? ' ' + ic('users') : ''}${x.locked ? ' ' + ic('lock') : ''}</span><span class="s">${sub}</span></span></button>`;
  let h = `<button class="row" data-a="open-liked"><span class="th" style="background:linear-gradient(135deg,#7c5cff,#3b9dff);display:grid;place-items:center">${ic('heart', 'fill big')}</span><span class="tx"><span class="t">Liked songs</span><span class="s">${l.length} songs</span></span></button>`;
  h += `<button class="row" data-a="open-dl"><span class="th" style="background:linear-gradient(135deg,#10b981,#3b9dff);display:grid;place-items:center">${ic('dl', 'big')}</span><span class="tx"><span class="t">Downloads ${isPrem() ? '' : ic('crown', 'gold')}</span><span class="s">${d.length} songs · play without internet</span></span></button>`;
  h += p.map(x => rowP(x, `${x.track_count} songs · ${x.is_public && isPrem() ? 'Public' : 'Private'}${x.locked ? ' · 🔒' : ''}${x.collab ? ' · Collaborative' : ''}`)).join('');
  if (!p.length) h += `<div class="empty">${isPrem() ? 'No playlists yet. Create your first one!' : 'Creating playlists is a Premium feature'}</div>`;
  if (sv.length) h += `<h2>Saved playlists</h2>` + sv.map(x => rowP(x, `${x.track_count || 0} songs`)).join('');
  if ($('#lib')) $('#lib').innerHTML = h;
}

async function downloads(inHome) {
  const my = RT, d = (await dlMeta()).sort((a, b) => b.ts - a.ts);
  if (my !== RT) return; L.dl = d.map(x => ({ ...x, identifier: x.id }));
  const mb = d.reduce((s, x) => s + (x.size || 0), 0) / 1048576;
  const locked = !isPrem();
  const h = `${inHome ? '' : '<h1>Downloads</h1>'}<div class="sub">${d.length} songs · ${mb.toFixed(0)} MB on this phone${locked ? ' · Premium needed to play' : ''}</div>
  <div class="actions"><button class="btn" data-a="dl-play" ${locked || !d.length ? 'disabled style="opacity:.5"' : ''}>${ic('play', 'fill')} Play all</button><button class="btn ghost" data-a="dl-clear">Delete all</button></div>` +
    (d.length ? L.dl.map((x, i) => songRow('dl', i, x, moreBtn('dl', i))).join('') : `<div class="empty">${ic('dl', 'big')}<br>No downloads yet.<br>${isPrem() ? 'Tap ⋮ on any song, then Download.' : 'Downloading is a Premium feature.'}</div>`);
  if (inHome) { if ($('#h1')) $('#h1').outerHTML = h } else view.innerHTML = h;
}

/* ───────── playlist cover photo + background (v22.6): stored on the server, shown everywhere the playlist shows ───────── */
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
{ let t; new MutationObserver(() => { clearTimeout(t); t = setTimeout(plArtApply, 60) }).observe(view, { childList: true, subtree: true }) }
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
  try { const data = await imgResize(f, PA.kind === 'bg' ? 1080 : 640, PA.kind === 'bg' ? 540 : 640, .82); await plArtSave(PA.code, PA.kind, { data }) } catch (er) { toast(er.message) }
});
// v22.8: the website picks from the gallery only. The APK needs a WebView file chooser (onShowFileChooser) + photo permission in its Kotlin code;
// until that is built in, set GALLERY_NATIVE = false and the APK keeps the old "paste a link" box so the button is never dead.
const GALLERY_NATIVE = false;
function plArtSheet(code, kind) {
  const bg = kind === 'bg', link = NAT && !GALLERY_NATIVE;
  sheet(`<h3>${ic('edit')} ${bg ? 'Playlist background' : 'Playlist cover photo'}</h3>
    <p class="sub">${link ? 'Paste the link of a photo (JPG, PNG or WEBP).' : 'Pick a photo from your gallery (JPG, PNG or WEBP). Allow gallery access if your phone asks.'}</p>
    ${link ? '<input id="pl-art-url" type="url" placeholder="https://…/photo.jpg" autocomplete="off" inputmode="url">' : ''}
    <div class="actions">${link ? `<button class="btn" data-a="pl-art-do-url" data-kind="${kind}" data-code="${esc(code)}">Use this photo</button>` : `<button class="btn" data-a="pl-art-pick" data-kind="${kind}" data-code="${esc(code)}">Choose from gallery</button>`}
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
      catch (e) { if (e.offline || [403, 404, 426, 429].includes(e.status)) throw e; p = await api('/api/playlists/code/' + encodeURIComponent(code)) }
    }
    if (my !== RT) return;
    L.pl = arr(p.tracks).map(nt); L.plMeta = p;
    // cover/banner can come back as a relative path (/static/uploads/...): fixUrl() attaches the origin
    const cover = fixUrl(p.cover_image_url) || (L.pl[0] && art(L.pl[0])) || '/static/pwa/icon-512.png';
    const ban   = fixUrl(p.banner_image_url) || cover;
    const up = String(code).toUpperCase(), saved = S.saved.has(up);
    // push playlist to recently played
    rpPush('playlist', { title: p.name, code: up, thumbnail: cover });
    const collabBadge = p.collab ? `<span class="chip on" style="pointer-events:none">${ic('users')} Collaborative</span>` : '';
    const privNotice = !isPrem() && p.is_owner && p.collab ? `<div class="notice">⚠️ Your Premium expired. This playlist is private until you renew.</div>` : '';
    const shareCollabBtn = p.collab && p.is_owner ? `<button class="btn ghost" data-a="collab-link" data-code="${esc(up)}">${ic('copy')} Copy</button>` : '';
    const names = [], addName = x => { if (x == null || x === '') return; const n = (typeof x === 'object') ? (x.display_name || x.username || x.name || (x.id ? 'User ' + x.id : '')) : String(x); if (n && !names.some(o => o.toLowerCase() === n.toLowerCase())) names.push(n) };
    addName(p.owner_name); (Array.isArray(p.collaborators) ? p.collaborators : []).forEach(addName);
    const collabLine = (p.collab || names.length > 1) && names.length ? `<div class="sub" style="margin:14px 0 6px">👥 Collab with: ${names.map(esc).join(', ')}</div>` : '';
    view.innerHTML = `<button class="btn sm ghost" data-a="pl-back" style="margin:2px 0 8px">‹ Back</button><div class="hero big"><div class="ban" data-plcode="${esc(up)}" data-plkind="bg" style="${bgi(ban)}"></div><div class="in"><span class="cv" data-plcode="${esc(up)}" style="${bgi(cover)}"></span><div><h1>${esc(p.name)}</h1><div class="sub">${p.owner_name ? esc(p.owner_name) + ' · ' : ''}${L.pl.length} songs${p.collab ? ' · Collab' : ''}</div></div></div></div>
      ${privNotice}
      <div class="actions"><button class="btn" data-a="pl-play">${ic('play', 'fill')} Play</button><button class="btn ghost" data-a="pl-shuffle">${ic('shuffle')} Shuffle</button>
      ${code !== 'liked' && !p.is_owner ? `<button class="btn ghost saveb${saved ? ' on' : ''}" data-a="pl-save" data-code="${esc(up)}">${ic('bookmark')} <span>${saved ? 'Saved' : 'Save'}</span></button>` : ''}
      ${(p.is_owner || p.collab) && code !== 'liked' && isPrem() ? `<button class="btn ghost" data-a="pl-edit" data-pid="${p.id}" data-code="${esc(up)}">${ic('edit')} Edit</button>` : ''}
      <button class="btn ghost" data-a="pl-copy" data-code="${esc(up)}">${ic('copy')} Copy</button>
      ${shareCollabBtn}
      <button class="btn ghost" data-a="pl-dl">${ic('dl')} Download ${isPrem() ? '' : ic('crown', 'gold')}</button></div>
      ${collabBadge}` +
      (L.pl.length ? L.pl.map((x, i) => songRow('pl', i, x, moreBtn('pl', i))).join('') : '<div class="empty">This playlist is empty</div>') + collabLine;
  } catch (e) { if (my === RT) view.innerHTML = `<div class="empty">${esc(e.message)}</div>` }
}

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
      <button class="btn ghost" data-a="artist-play">${ic('play', 'fill')} Play</button><button class="btn ghost" data-a="artist-shuffle">${ic('shuffle')} Shuffle</button></div>` +
      (L.artist.length ? L.artist.map((x, i) => songRow('artist', i, x, moreBtn('artist', i))).join('') : '<div class="empty">No songs found for this artist</div>');
  } catch (e) { if (my === RT) view.innerHTML = `<div class="empty">${esc(e.message)}</div>` }
}

const statsBox = st => `<h2>Your stats</h2><div class="statgrid"><div><b>${st.plays_week || 0}</b><span>Plays this week</span></div><div><b>${st.plays_total || 0}</b><span>Plays in total</span></div><div><b>${st.likes || 0}</b><span>Liked songs</span></div><div><b>${st.downloads || 0}</b><span>Downloads</span></div></div>${st.top_artist ? `<p class="sub" style="margin-top:8px">Your top artist: <b>${esc(st.top_artist)}</b></p>` : ''}`;
async function you() {
  const m = S.me, role = S.cfg.role, th = store.get('lm-theme') || 'auto', fa = artistsGet();
  let est = ''; try { const e = await navigator.storage.estimate(); est = ' · ' + Math.round((e.usage || 0) / 1048576) + ' MB used' } catch (e) {}
  view.innerHTML = `<div class="box" style="display:flex;gap:14px;align-items:center"><span class="av" style="width:64px;height:64px;${bgi(m.avatar)}">${tick(role)}</span><div><h3 class="nm">${tick(role)}${esc(m.username)}</h3><span class="sub">${roleName(role)} · Discord login</span></div></div>
  <div class="box prem"><h3>${ic('crown', 'gold')} Premium</h3>${isPrem() ? '<span class="sub">You have Premium. Thank you!</span><div id="prem-exp" class="sub"></div>' : '<span class="sub">Create playlists, collaborative playlists, download songs and get the Premium tick.</span>'}
  <ul class="perks"><li>Create & edit playlists</li><li>Collaborative playlists with friends</li><li>Download songs, listen offline</li><li>Lock playlists, covers & banners</li><li>Unlimited liked songs</li><li>Premium tick next to your name</li><li>Public playlists stay public</li></ul>${isPrem() ? '' : '<div class="actions"><a class="btn" href="/premium">Get Premium</a></div>'}</div>
  <div class="box"><h3>Look & feel</h3><div class="seg" id="themes">${[['auto', 'Auto'], ['dark', 'Dark'], ['light', 'White'], ['amoled', 'AMOLED']].map(([k, n]) => `<button data-a="theme" data-k="${k}" class="${th === k ? 'on' : ''}">${n}</button>`).join('')}</div>
    <div class="setrow" data-a="set-auto"><div>Autoplay<div class="sub">Keep playing similar songs when the queue ends</div></div>${sw(S.auto)}</div>
    <div class="setrow" data-a="set-bass"><div>Bass boost<div class="sub">Slightly deeper bass. Premium also gets extra clarity</div></div>${sw(store.get('lm-bass') !== '0')}</div>
    <div class="setrow" data-a="set-haptic"><div>Vibration feedback</div>${sw(S.haptic)}</div>
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
const ADM = { tab: 'overview', demo: false };
const ADEMO = {
  summary: { stats: { installs: 128, new_today: 6, new_week: 23, apk_downloads: 214, users: 128, active_today: 41, plays_today: 932, premium: 17, downloads: 214 }, top_songs: [{ title: 'Figure It Out', author: 'A-Wall', plays: 58 }, { title: 'Kaali Hoodie', author: 'Sidhu Moose Wala', plays: 44 }, { title: 'Loverboy', author: 'A-Wall', plays: 39 }], top_users: [{ name: 'sartahk34', plays: 211 }, { name: 'Riya', plays: 143 }, { name: 'Aman', plays: 97 }] },
  users: [{ name: 'sartahk34', role: 'owner', joined: '12 Nov', last_seen: 'now', plays: 211, likes: 40, downloads: 12 }, { name: 'Riya', role: 'premium', joined: '15 Nov', last_seen: '5 min ago', plays: 143, likes: 22, downloads: 9 }, { name: 'Aman', role: 'free', joined: '21 Nov', last_seen: '2 h ago', plays: 97, likes: 11, downloads: 0 }],
  events: [{ ts: 'now', user: 'Riya', kind: 'play', title: 'Figure It Out', author: 'A-Wall' }, { ts: '2m', user: 'Aman', kind: 'like', title: 'Loverboy', author: 'A-Wall' }, { ts: '6m', user: 'sartahk34', kind: 'download', title: 'Kaali Hoodie', author: 'Sidhu Moose Wala' }, { ts: '9m', user: 'Riya', kind: 'follow', title: 'Diljit Dosanjh', author: '' }]
};
async function admGet(p, key) { try { ADM.demo = false; return await api(p) } catch (e) { if (e.status === 401) throw e; ADM.demo = true; return ADEMO[key] } }
const kindIc = { play: 'play', like: 'heart', download: 'dl', follow: 'person', share: 'copy', pl_create: 'music' };
async function adminPage(tab) {
  if (!S.cfg.is_staff) { location.hash = '#you'; return }
  ADM.tab = tab || ADM.tab; const my = RT;
  view.innerHTML = `<button class="btn sm ghost" data-a="adm-back" style="margin:2px 0 8px">‹ Back</button><h1>Admin</h1><div class="seg" id="adm-tabs">${[['overview', 'Overview'], ['users', 'Users'], ['activity', 'Activity'], ['updates', 'Updates']].map(([k, n]) => `<button data-a="adm-tab" data-k="${k}" class="${ADM.tab === k ? 'on' : ''}">${n}</button>`).join('')}</div><div id="adm-body">${skel(4)}</div>`;
  let h = '';
  if (ADM.tab === 'overview') {
    const d = await admGet('/api/app/admin/summary', 'summary'), s = d.stats || {}; if (my !== RT) return;
    h = `<div class="statgrid" style="margin-top:12px">${[['installs', 'Joined the app'], ['apk_downloads', 'APK downloads'], ['new_today', 'New today'], ['new_week', 'New this week'], ['active_today', 'Active today'], ['plays_today', 'Plays today'], ['premium', 'Premium'], ['downloads', 'Song downloads']].map(([k, n]) => `<div><b>${s[k] || 0}</b><span>${n}</span></div>`).join('')}</div>
    <h2>Top songs (APK)</h2>${arr(d.top_songs).map((x, i) => `<div class="row"><span class="d" style="width:18px">${i + 1}</span><span class="tx"><span class="t">${esc(x.title)}</span><span class="s">${esc(x.author)}</span></span><span class="d">${x.plays} plays</span></div>`).join('') || '<p class="sub">No data yet</p>'}
    <h2>Most active users</h2>${arr(d.top_users).map((x, i) => `<div class="row"><span class="d" style="width:18px">${i + 1}</span><span class="tx"><span class="t">${esc(x.name)}</span></span><span class="d">${x.plays} plays</span></div>`).join('') || '<p class="sub">No data yet</p>'}`;
  } else if (ADM.tab === 'users') {
    const d = await admGet('/api/app/admin/users?limit=60', 'users'); if (my !== RT) return;
    h = arr(d.users || d).map(u => `<div class="row"><span class="th" style="border-radius:50%;${bgi(fixUrl(u.avatar) || '/static/pwa/icon-192.png')}"></span><span class="tx"><span class="t">${esc(u.name || u.username)} <small class="sub">${roleName(u.role)}</small></span><span class="s">${u.joined ? 'Joined ' + esc(u.joined) + ' · ' : ''}${u.plays || 0} plays · ${u.likes || 0} likes · ${u.downloads || 0} downloads · ${esc(u.last_seen || '')}</span></span></div>`).join('') || '<p class="sub">No users</p>';
  } else if (ADM.tab === 'activity') {
    const d = await admGet('/api/app/admin/activity?limit=60', 'events'); if (my !== RT) return;
    h = arr(d.events || d).map(e => `<div class="row"><span class="ib" style="flex:none">${ic(kindIc[e.kind] || 'clock')}</span><span class="tx"><span class="t">${esc(e.user)} <small class="sub">${esc(e.kind)}</small></span><span class="s">${esc(e.title || '')}${e.author ? ' · ' + esc(e.author) : ''}</span></span><span class="d">${esc(e.ts || '')}</span></div>`).join('') || '<p class="sub">No activity yet</p>';
  } else {
    h = `<div class="box"><h3>Push an APK update</h3><span class="sub">Current app version: v${CV}${S.upd && S.upd.version ? ' · server has v' + esc(S.upd.version) : ''}</span>
      <input id="adm-ver" placeholder="New version, e.g. 24.1" inputmode="decimal"><input id="adm-notes" placeholder="What's new (shown to users)">
      <div class="actions"><button class="btn" data-a="adm-push">Publish update</button></div></div>`;
  }
  if (my !== RT) return;
  $('#adm-body').innerHTML = (ADM.demo ? '<div class="notice">Preview with sample data. This server has no /api/app/admin/* endpoints yet.</div>' : '') + h;
}

/* ───────── router + events ───────── */
function route() {
  RT++; clearTimeout(st);
  const h = (location.hash || '#home').slice(1), [a, b] = h.split('/');
  const tab = ['home', 'search', 'library', 'you'].includes(a) ? a : a === 'admin' ? 'you' : (a === 'code' || a === 'downloads' ? 'library' : a === 'artist' ? 'search' : 'home');
  document.querySelectorAll('.tabs a').forEach(x => x.classList.toggle('on', x.dataset.tab === tab));
  scrollTo(0, 0);
  ({ home, search, library, you, downloads, admin: () => adminPage(b) }[a] || (a === 'code' ? () => playlist(b) : a === 'artist' ? () => artistPage((() => { try { return decodeURIComponent(b || '') } catch (e) { return b || '' } })()) : home))();
}
addEventListener('hashchange', route);
addEventListener('offline', () => { S.offline = true; toast("You're offline. Downloaded songs still play."); if (!location.hash || location.hash === '#home') route() });
addEventListener('online', () => { S.offline = false; toast("You're back online"); checkUpdate() });
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
const LY = { key: '', lines: [], plain: '', idx: -1, vi: -2, state: 'none' }, lyCache = new Map(), LYV = { on: false, pp: null };
const cleanT = s => String(s || '').replace(/\(.*?\)|\[.*?\]|official.*|lyric.*|video.*|\|.*|ft\..*|feat\..*/gi, '').replace(/\s+/g, ' ').trim();
const parseLrc = s => String(s || '').split('\n').map(l => { const m = l.match(/^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/); return m && m[3] ? { t: (+m[1]) * 60 + parseFloat(m[2]), x: m[3] } : null }).filter(Boolean);
async function lyricsFetch(t) {
  // 1) our server: finds the lyrics and writes them in the song's language (Punjabi -> Gurmukhi, Hindi -> Devanagari ...)
  try {
    const q = `/api/app/lyrics?title=${encodeURIComponent(t.title)}&author=${encodeURIComponent(t.author)}&dur=${Math.round((t.duration || 0) / 1000)}&av=${CV}`;
    const j = await Promise.race([api(q), new Promise((_, rj) => setTimeout(() => rj(new Error('slow')), 30000))]);
    if (j && ((j.lines && j.lines.length) || j.plain)) return { lines: j.lines || [], plain: j.plain || '' };
    if (j) return null;
  } catch (e) { if (e && e.offline) return null }
  // 2) older server: lrclib directly (original text, no conversion)
  try {
    const u = 'https://lrclib.net/api/search?track_name=' + encodeURIComponent(cleanT(t.title)) + '&artist_name=' + encodeURIComponent(cleanT(t.author).split(/[,&]/)[0]);
    const r = await Promise.race([fetch(u), new Promise((_, rj) => setTimeout(rj, 6000))]); const a = await r.json();
    const d = Array.isArray(a) ? (a.find(x => x.syncedLyrics) || a.find(x => x.plainLyrics) || null) : null;
    if (d) { const lines = parseLrc(d.syncedLyrics); return { lines, plain: d.plainLyrics || lines.map(l => l.x).join('\n') } }
  } catch (e) {}
  return null;
}
async function lyricsLoad(t) {
  const key = t.title + '|' + t.author; if (LY.key === key) return; LY.key = key; LY.lines = []; LY.plain = ''; LY.idx = -1; LY.state = 'loading';
  $('#np-lyr').textContent = ''; $('#np-lcard').hidden = true; lyvHead(t); lyvRender();
  if (!navigator.onLine) { LY.state = 'none'; lyvRender(); return }
  let d = lyCache.get(key);
  if (d === undefined) { d = await lyricsFetch(t); lyCache.set(key, d); if (lyCache.size > 40) lyCache.delete(lyCache.keys().next().value) }
  if (LY.key !== key) return;
  if (!d) { LY.state = 'none'; lyvRender(); return }
  LY.lines = d.lines || []; LY.plain = d.plain || LY.lines.map(l => l.x).join('\n'); LY.state = (LY.lines.length || LY.plain) ? 'ok' : 'none';
  if (LY.state === 'ok') { $('#np-lcard').hidden = false; lyricsTick(S.cur ? au.currentTime * 1000 : 0, true) }
  lyvRender();
}
const lyIdx = posMs => { const s = posMs / 1000; let i = LY.lines.length - 1; while (i >= 0 && LY.lines[i].t > s) i--; return i };
function lyricsTick(posMs, force) {
  lyvTick(posMs, force);
  if (!LY.lines.length) { if (force && LY.plain) { $('#np-lines').innerHTML = LY.plain.split('\n').filter(Boolean).slice(0, 6).map(x => `<p>${esc(x)}</p>`).join('') } return }
  const i = lyIdx(posMs);
  if (i === LY.idx && !force) return; LY.idx = i;
  $('#np-lyr').textContent = i >= 0 ? LY.lines[i].x : '';
  const from = Math.max(0, Math.min(i - 3, LY.lines.length - 5)), sl = LY.lines.slice(from, from + 5);
  $('#np-lines').innerHTML = sl.map((l, k) => `<p${from + k === i ? ' class="cur"' : ''}>${esc(l.x)}</p>`).join('');
}
/* full-screen lyrics: tap the lyrics on Now Playing. Stays open when the next song starts (the new lyrics + background load by themselves). */
function lyvBuild() {
  let d = $('#lyv'); if (d) return d;
  d = document.createElement('section'); d.id = 'lyv'; d.hidden = true;
  d.innerHTML = `<div id="lyv-bg"></div>
    <div class="lyv-top"><button class="ib" data-a="close-lyv" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></button><div class="lyv-tt"><b id="lyv-t"></b><small id="lyv-s"></small></div><span class="lyv-sp"></span></div>
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
  $('#lyv-box').scrollTop = 0;
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
  if (el && el.closest && el.closest('#lyv,#np-lcard,#np-lyr,.lyfull')) { e.preventDefault(); if (e.clipboardData) { try { e.clipboardData.setData('text/plain', '') } catch (x) {} } }
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
const plLink = code => `${NAT || location.origin}/app#code/${code}`;

/* ───────── collab playlist: generate invite link ───────── */
async function showCollabLink(code) {
  const link = `${NAT || location.origin}/app#code/${code}`;
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
  if (a === 'more') {
    e.stopPropagation(); const t = nt(list[i]), id = ytId(t), dlon = id && S.dl[id], own = el.dataset.l === 'pl' && L.plMeta && L.plMeta.is_owner && L.plMeta.id && t.id;
    sheet(`<h3>${esc(t.title)}</h3><span class="sub">${esc(t.author)}</span><div class="menu">
      <button data-a="q-next" data-l="${el.dataset.l}" data-i="${i}">${ic('play')} Play next</button>
      <button data-a="q-add" data-l="${el.dataset.l}" data-i="${i}">${ic('plus')} Add to queue</button>
      <button data-a="like-it" data-l="${el.dataset.l}" data-i="${i}">${ic('heart', S.liked[t.uri] ? 'fill' : '')} ${S.liked[t.uri] ? 'Remove from Liked' : 'Like'}</button>
      <button data-a="add-to-pl" data-l="${el.dataset.l}" data-i="${i}">${ic('music')} Add to playlist ${isPrem() ? '' : ic('crown', 'gold')}</button>
      <button data-a="more-by" data-q="${esc(t.author)}">${ic('radio')} Song radio (more like this)</button>
      ${t.author ? `<button data-a="open-artist" data-name="${esc(t.author)}">${ic('person')} Artist: ${esc(t.author)}</button>` : ''}
      ${id ? (dlon ? `<button data-a="dl-rm" data-id="${id}">${ic('dl')} Remove download</button>` : `<button data-a="dl-it" data-l="${el.dataset.l}" data-i="${i}">${ic('dl')} Download ${isPrem() ? '' : ic('crown', 'gold')}</button>`) : ''}
      <button data-a="share-it" data-l="${el.dataset.l}" data-i="${i}">${ic('copy')} Copy</button>
      ${own ? `<button data-a="rm-track" data-id="${t.id}">${ic('lock')} Remove from this playlist</button>` : ''}</div>`); return
  }
  if (a === 'rp-song') {
    // play a recently-played song
    const k = el.dataset.k, item = rpGet().find(x => x.type === 'song' && (x.uri || x.title) === k); if (!item) return;
    const t = { title: item.title, author: item.author || '', uri: item.uri || '', identifier: '', thumbnail: item.thumbnail || '', duration: 0 };
    if (mode() !== 'phone') { discordPlay([t], 0); return }
    S.queue = [t]; S.qi = 0; S.orig = null; S.shuf = false; startPhone(); buzz();
  }
  else if (a === 'play') { if (el.dataset.l === 'dl' && !isPrem()) return premiumSheet('Playing your downloads needs an active Premium.'); const l = el.dataset.l, coll = ['pl', 'dl', 'artist'].includes(l); playFrom(list, i, coll || !S.auto, l === 'pl'); if (l !== 'search' && l !== 'artist') S.ctx = '' }
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
  else if (a === 'artist-shuffle') { playFrom((L.artist || []).slice().sort(() => Math.random() - .5), 0, true, true) }
  else if (a === 'pl-back') { if (history.length > 1) history.back(); else location.hash = '#home' }
  else if (a === 'dl-it') { closeSheet(); dlSong(nt(list[i])) }
  else if (a === 'dl') { if (S.cur) { const id = ytId(S.cur); if (id && S.dl[id]) { await dlRemove(id); toast('Download removed'); ui() } else dlSong(S.cur) } }
  else if (a === 'dl-rm') { closeSheet(); await dlRemove(el.dataset.id); toast('Download removed'); if (location.hash.startsWith('#downloads')) route(); else ui() }
  else if (a === 'dl-play') { if (L.dl && L.dl.length) playFrom(L.dl, 0, true, false) }
  else if (a === 'dl-clear') { if (confirm('Delete all downloaded songs from this phone?')) { for (const x of (await dlMeta())) await dlRemove(x.id); toast('Downloads deleted'); route() } }
  else if (a === 'open-dl') location.hash = '#downloads';
  else if (a === 'pl-dl') {
    if (!isPrem()) return premiumSheet('Downloading songs to listen offline is a Premium feature.');
    const l = (L.pl || []).filter(x => ytId(x) && !S.dl[ytId(x)]); if (!l.length) return toast('Everything here is already downloaded');
    let n = 0; for (const t of l) { toast(`Downloading ${++n}/${l.length}…`); if (!(await dlSong(t, true))) break } toast('Playlist downloaded'); route();
  }
  else if (a === 'pl-save') {
    const c = el.dataset.code, on = S.saved.has(c);
    try { await api('/api/app/saved/' + encodeURIComponent(c), { method: on ? 'DELETE' : 'POST' }); on ? S.saved.delete(c) : S.saved.add(c); el.classList.toggle('on', !on); el.querySelector('span').textContent = on ? 'Save' : 'Saved'; toast(on ? 'Removed from your library' : 'Saved to your library'); buzz() } catch (er) { toast(er.message) }
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
  else if (a === 'open-pl') { location.hash = '#code/' + el.dataset.code }
  else if (a === 'open-liked') location.hash = '#code/liked';
  else if (a === 'pl-play') { playFrom(L.pl || [], 0, true, true); S.ctx = '' }
  else if (a === 'pl-shuffle') { const s = (L.pl || []).slice().sort(() => Math.random() - .5); playFrom(s, 0, true, true); S.ctx = '' }
  else if (a === 'pl-edit') {
    const pid = el.dataset.pid, code = el.dataset.code, meta = L.plMeta || {};
    sheet(`<h3>${ic('edit')} Edit playlist</h3>
      <input id="pl-edit-name" maxlength="60" placeholder="Playlist name" value="${esc(meta.name || '')}" autocomplete="off">
      ${meta.is_owner ? `<div class="plart"><div class="plart-row"><span>Cover photo</span><button class="btn sm ghost" data-a="pl-art-open" data-kind="cover" data-code="${esc(code)}">${ic('edit')} ${(PA.map[code] || {}).cover ? 'Change' : 'Add'}</button>${(PA.map[code] || {}).cover ? `<button class="btn sm ghost" data-a="pl-art-rm" data-kind="cover" data-code="${esc(code)}">Remove</button>` : ''}</div>
        <div class="plart-row"><span>Background</span><button class="btn sm ghost" data-a="pl-art-open" data-kind="bg" data-code="${esc(code)}">${ic('edit')} ${(PA.map[code] || {}).bg ? 'Change' : 'Add'}</button>${(PA.map[code] || {}).bg ? `<button class="btn sm ghost" data-a="pl-art-rm" data-kind="bg" data-code="${esc(code)}">Remove</button>` : ''}</div></div>` : ''}
      <div class="actions">
        <button class="btn" data-a="do-pl-edit" data-pid="${esc(pid)}" data-code="${esc(code)}">Save</button>
        <button class="btn ghost" data-a="close-sheet">Cancel</button>
      </div>`);
    $('#pl-edit-name').focus();
  }
  else if (a === 'pl-art-open') plArtSheet(el.dataset.code, el.dataset.kind);
  else if (a === 'pl-art-pick') { PA.kind = el.dataset.kind; PA.code = el.dataset.code; plArtFile.click() }
  else if (a === 'pl-art-do-url') { const u = (($('#pl-art-url') || {}).value || '').trim(); if (!/^https?:\/\//i.test(u)) return toast('Paste a link that starts with https://'); plArtSave(el.dataset.code, el.dataset.kind, { url: u }) }
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
  else if (a === 'new-pl') {
    if (!isPrem()) return premiumSheet('Creating your own playlists is a Premium feature.');
    sheet(`<h3>New playlist</h3><input id="pl-name" maxlength="60" placeholder="Playlist name" autocomplete="off"><div class="actions"><button class="btn" data-a="mk-pl">Create</button><button class="btn ghost" data-a="close-sheet">Cancel</button></div>`); $('#pl-name').focus();
  }
  else if (a === 'new-collab-pl') {
    if (!isPrem()) return premiumSheet('Collaborative playlists are a Premium feature. Create a playlist and invite friends to add songs together.');
    sheet(`<h3>${ic('users')} New collaborative playlist</h3>
      <p class="sub">Friends with the invite link can add songs to this playlist.</p>
      <input id="pl-name" maxlength="60" placeholder="Playlist name" autocomplete="off">
      <div class="actions"><button class="btn" data-a="mk-collab-pl">Create</button><button class="btn ghost" data-a="close-sheet">Cancel</button></div>
      <p class="sub" style="margin-top:8px">⚠️ Collaborative playlists are public while you have Premium. When Premium expires, they go private.</p>`);
    $('#pl-name').focus();
  }
  else if (a === 'mk-pl') {
    const name = ($('#pl-name').value || '').trim(); if (!name) return;
    try { const r = await api('/api/playlists', { method: 'POST', body: { name } }); api('/api/app/app-playlists/' + encodeURIComponent(r.code), { method: 'POST' }).catch(() => {}); ev('pl_create', { title: name, code: r.code }); closeSheet(); toast('Playlist created'); afterSheet(() => { location.hash = '#code/' + r.code }) }
    catch (er) { if (er.status === 403) premiumSheet('Creating playlists is a Premium feature.'); else toast(er.message) }
  }
  else if (a === 'mk-collab-pl') {
    const name = ($('#pl-name').value || '').trim(); if (!name) return;
    try {
      // create playlist then mark as collaborative (is_public + collab flag via description or dedicated API if available)
      const r = await api('/api/playlists', { method: 'POST', body: { name, is_public: true } }); ev('pl_create', { title: name, code: r.code, extra: 'collab' });
      api('/api/app/app-playlists/' + encodeURIComponent(r.code), { method: 'POST' }).catch(() => {});
      closeSheet(); toast('Collaborative playlist created!');
      // show invite link immediately
      await showCollabLink(r.code);
    }
    catch (er) { if (er.status === 403) premiumSheet('Creating playlists is a Premium feature.'); else toast(er.message) }
  }
  else if (a === 'collab-link') { copyText(plLink(el.dataset.code), 'Copied') }
  else if (a === 'pl-copy') { copyText(plLink(el.dataset.code), 'Copied') }
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
  else if (a === 'autoplay') { S.auto = !S.auto; store.set('lm-auto', S.auto ? '1' : '0'); toast(S.auto ? 'Autoplay on' : 'Autoplay off'); ui(); if (S.auto && S.queue.length - S.qi <= 2) moreLikeThis() }
  else if (a === 'sleep') sheet(`<h3>${ic('moon')} Sleep timer</h3><div class="menu">${[15, 30, 45, 60].map(m => `<button data-a="sleep-set" data-m="${m}">${m} minutes</button>`).join('')}<button data-a="sleep-set" data-m="end">End of this song</button><button data-a="sleep-set" data-m="0">Turn off</button></div>`);
  else if (a === 'sleep-set') setSleep(el.dataset.m === 'end' ? 'end' : +el.dataset.m);
  else if (a === 'theme') { store.set('lm-theme', el.dataset.k); applyTheme(); document.querySelectorAll('#themes button').forEach(b => b.classList.toggle('on', b === el)) }
  else if (a === 'set-auto') { S.auto = !S.auto; store.set('lm-auto', S.auto ? '1' : '0'); el.querySelector('.sw').classList.toggle('on', S.auto) }
  else if (a === 'set-haptic') { S.haptic = !S.haptic; store.set('lm-haptic', S.haptic ? '1' : '0'); el.querySelector('.sw').classList.toggle('on', S.haptic); buzz() }
  else if (a === 'chk-upd') checkUpdate(true);
  else if (a === 'notifs') { await loadNotifs(); openNotifs() }
  else if (a === 'nt-change') { const m = NT.find(x => String(x.id) === el.dataset.id); if (m) { m._edit = true; openNotifs() } }
  else if (a === 'nt-send') {
    const sel = document.querySelector(`input[name="nt-${el.dataset.id}"]:checked`);
    if (!sel) { toast('Pick an option first'); return }
    try { await api(`/api/notifications/${el.dataset.id}/respond`, { method: 'POST', body: { option_index: parseInt(sel.value, 10) } }); toast('Answer saved'); await loadNotifs(); openNotifs() } catch (er) { toast(er.message) }
  }
  else if (a === 'do-update') applyUpdate();
  else if (a === 'upd-later') { const u = $('#upd'); u.className = ''; u.innerHTML = updBanner(S.upd || {}) }
  else if (a === 'set-bass') { const on = store.get('lm-bass') === '0'; store.set('lm-bass', on ? '1' : '0'); el.querySelector('.sw').classList.toggle('on', on); eqApply() }
  else if (a === 'set-autoupd') { const on = store.get('lm-autoupd') === '0'; store.set('lm-autoupd', on ? '1' : '0'); el.querySelector('.sw').classList.toggle('on', on); if (on) checkUpdate() }
  else if (a === 'adm-back') { location.hash = '#you' }
  else if (a === 'adm-tab') { adminPage(el.dataset.k) }
  else if (a === 'adm-push') { const v = ($('#adm-ver').value || '').trim(), n = ($('#adm-notes').value || '').trim(); if (!v) return toast('Enter a version'); try { await api('/api/app/admin/update', { method: 'POST', body: { version: v, notes: n } }); toast('Update published') } catch (er) { toast(er.message || 'Failed') } }
  else if (a === 'open-np') openNP();
  else if (a === 'close-np') closeNP();
  else if (a === 'queue') { const qe = $('#np-queue'); qe.hidden = !qe.hidden; if (!qe.hidden) queueList() }
  else if (a === 'jump') { if (mode() === 'phone') { S.qi = i; startPhone() } else ctl(`queue/${i}/play`) }
  else if (a === 'close-sheet') closeSheet();
  else if (a === 'play-mix') { const m = arr(S.sync && S.sync.mix).map(nt).sort(() => Math.random() - .5); if (m.length) { ev('mix', { extra: m.length + ' songs' }); playFrom(m, 0, true, false) } }
  else if (a === 'speed') { const r = SPEEDS[(SPEEDS.indexOf(spd()) + 1) % SPEEDS.length]; store.set('lm-speed', String(r)); applySpeed(); toast('Speed ' + r + 'x') }
  else if (a === 'native-login') { if (bridge && bridge.login) { bridge.login(NAT + '/auth/app'); const b = $('#lg-go'); if (b) { b.disabled = true; b.querySelector('span').textContent = 'Waiting for Discord…'; setTimeout(() => { b.disabled = false; b.querySelector('span').textContent = 'Login with Discord' }, 25000) } } else toast('Open this inside the Legacy Music app') }
});
au.addEventListener('timeupdate', () => { if (sleepEnd && au.duration && au.duration - au.currentTime < .6) { sleepEnd = false; au.pause(); ui(); toast('Sleep timer: music stopped') } });

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
.lg-disc{position:relative;width:104px;height:104px;margin:0 auto;border-radius:50%;background:repeating-radial-gradient(circle,#0a0b11 0 2px,#1b1d2b 2px 4px);box-shadow:0 0 0 3px #5865f2,0 0 40px rgba(88,101,242,.6);display:grid;place-items:center;animation:lgspin 7s linear infinite}
.lg-disc img{width:46px;height:46px;border-radius:50%;border:2px solid rgba(255,255,255,.3)}
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
.lg-btn svg{width:22px;height:22px;fill:#fff}.lg-btn[disabled]{opacity:.75}
.lg-by{display:inline-flex;align-items:center;justify-content:center;gap:9px;margin-top:18px;padding:6px 14px 6px 10px;border-radius:999px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.1);font-size:12.5px;color:rgba(238,241,248,.72)}
.lg-by b{color:#fff;font-weight:700}
.lg-av{position:relative;display:inline-block;width:32px;height:32px}
.lg-av>img:first-child{width:32px;height:32px;border-radius:50%;border:2px solid #5865f2;object-fit:cover;display:block}
.lg-av .lg-tk{position:absolute;right:-1px;top:-1px;width:16px;height:16px;filter:drop-shadow(0 1px 3px rgba(0,0,0,.55))}
@media (max-height:700px){.lg-disc{width:78px;height:78px}.lg-disc img{width:34px;height:34px}.lg-card{padding:18px 18px 14px}.lg-card h1{font-size:25px;margin-top:14px}.lg-eq{height:24px;margin:10px 0 12px}.lg-by{margin-top:12px}}
@media (prefers-reduced-motion:reduce){.lg-col>div,.lg-disc,.lg-eq i,.lg-btn::after,.lg-card{animation:none}.lg-eq i{transform:scaleY(calc(var(--m,1)*.6))}}`;
  document.head.appendChild(st);
}
injectCss();

/* ───────── APK: login, tokens, notification bridge ───────── */
const LG_FALLBACK = [['Softly', 'Karan Aujla'], ['GOAT', 'Diljit Dosanjh'], ['295', 'Sidhu Moose Wala'], ['Brown Munde', 'AP Dhillon'], ['No Love', 'Shubh'], ['Suit Suit', 'Guru Randhawa'],
  ['Qismat', 'Ammy Virk'], ['Bijlee Bijlee', 'Harrdy Sandhu'], ['Lehanga', 'Jass Manak'], ['Filhall', 'B Praak'], ['Phulkari', 'Gippy Grewal'], ['Nikle Currant', 'Jassie Gill'],
  ['Mamla Gadbad Hai', 'Gurdas Maan'], ['Saajan Raazi', 'Satinder Sartaaj'], ['Judaa', 'Amrinder Gill'], ['Jaani Tera Naa', 'Sunanda Sharma'], ['Naag', 'Jazzy B']].map(([title, author]) => ({ title, author, thumbnail: '' }));
const LG_CREATOR = { name: 'lord_diablo_009', avatar: '/static/pwa/icon-192.png', tick: '/static/badges/owner-white.svg' };   // change the logo / name of "Created by" here
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
function showLogin(msg) {
  store.set('lm-tok', ''); TOK = '';
  try { au.pause() } catch (e) {}
  $('#mini').hidden = true; $('#np').hidden = true; document.body.classList.add('lg');
    const bars = Array.from({ length: 27 }, (_, k) => { const x = (k - 13) / 13, m = (0.32 + 0.68 * Math.exp(-x * x * 2.2)) * (0.72 + 0.28 * Math.abs(Math.sin(k * 2.7))); return `<i style=\"--m:${m.toFixed(2)};--d:${(0.55 + (k * 7 % 9) * 0.07).toFixed(2)}s;--dl:-${((k * 5 % 11) * 0.09).toFixed(2)}s\"></i>` }).join('');
  const cached = jget('lm-lgc', []);
  view.innerHTML = `<div class=\"lg-wrap\"><div class=\"lg-bg\">${lgCols(lgPrep(cached).length >= 15 ? cached : LG_FALLBACK)}</div><span class=\"lg-shade\"></span>
    <div class=\"lg-card\"><div class=\"lg-disc\"><img src=\"/static/pwa/icon-192.png\" alt=\"\"></div>
      <h1>Legacy Music</h1><p>${esc(msg || 'Log in with your Discord account to start listening.')}</p>
      <div class=\"lg-eq\">${bars}</div>
      <button class=\"lg-btn\" id=\"lg-go\" data-a=\"native-login\"><svg viewBox=\"0 0 24 24\"><path d=\"${LG_DISCORD}\"/></svg><span>Login with Discord</span></button>
      <div class=\"lg-by\"><span>Created by</span><span class=\"lg-av\"><img src=\"${LG_CREATOR.avatar}\" alt=\"\"><img class=\"lg-tk\" src=\"${LG_CREATOR.tick}\" alt=\"official\"></span><b>${esc(LG_CREATOR.name)}</b></div></div></div>`;
  lgCovers().then(l => { const el = $('.lg-bg'); if (l && el && JSON.stringify(l.slice(0, 36)) !== JSON.stringify(cached)) el.innerHTML = lgCols(l) });
}
window.lmOnToken = t => { if (t) { store.set('lm-tok', String(t)); location.reload() } };            // called by the Android app after the Discord login
window.lmCmd = c => { if (c === 'toggle') act.toggle(); else if (c === 'next') act.next(); else if (c === 'prev') act.prev() };   // notification buttons
async function refreshTokens() {
  if (!NAT || !TOK || !navigator.onLine) return;
  try {
    const r = await api('/api/app/token', { method: 'POST' });
    if (r && r.token) { TOK = r.token; MT = r.media_token || ''; store.set('lm-tok', TOK); store.set('lm-mt', MT) }
  } catch (e) {}
}
let lastNat = '';
function nativeSync() {
  if (!bridge || !bridge.nowPlaying) return;
  const t = S.cur, k = t ? t.title + '|' + t.author + '|' + (S.playing ? 1 : 0) : '';
  if (k === lastNat) return; lastNat = k;
  try { bridge.nowPlaying(t ? t.title : '', t ? t.author : '', !!S.playing, t ? noMt(art(t)) : '') } catch (e) {}
}
if (NAT) {
  document.addEventListener('click', e => {          // links to the website: open outside the app (logout is handled here)
    const a = e.target.closest('a[href^="/"]'); if (!a) return;
    e.preventDefault(); e.stopPropagation();
    const h = a.getAttribute('href');
    if (h.startsWith('/auth/logout')) { store.set('lm-mt', ''); showLogin('You are logged out.'); return }
    if (bridge && bridge.open) bridge.open(NAT + h); else window.open(NAT + h, '_blank');
  }, true);
}

/* ───────── start ───────── */
(async () => {
  if (NAT && !TOK) return showLogin();
  if (NAT) { await refreshTokens(); if (!TOK) return; setInterval(refreshTokens, 4 * 3600 * 1000) }
  try {
    const [me, cfg] = await Promise.all([api('/api/me'), api('/api/app/config')]);
    S.me = me; S.cfg = cfg; S.offline = false; store.set('lm-me', JSON.stringify(me)); store.set('lm-cfg', JSON.stringify(cfg));
  } catch (e) {
    const me = jget('lm-me', null), cfg = jget('lm-cfg', null);
    if (e.status === 426) return;
    if (me && cfg && (e.offline || !navigator.onLine)) { S.me = me; S.cfg = cfg; S.offline = true; toast("You're offline. Showing your downloads.") }
    else { view.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return }
  }
  $('#top-av').setAttribute('style', bgi(S.me.avatar)); $('#top-av').insertAdjacentHTML('beforeend', tick(S.cfg.role));
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
  route(); poll();
  if (!NAT && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(reg => {
      const watch = w => w && w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) showUpdate({ notes: 'New app files are ready.' }) });
      if (reg.waiting && navigator.serviceWorker.controller) showUpdate({ notes: 'New app files are ready.' });
      reg.addEventListener('updatefound', () => watch(reg.installing));
      setInterval(() => reg.update().catch(() => {}), 30 * 60000);
    }).catch(() => {});
    let rl = false; navigator.serviceWorker.addEventListener('controllerchange', () => { if (!rl && updShown) { rl = true; location.reload() } });
  }
})();
})();
