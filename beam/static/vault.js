/* Clipvault: every copy from the PC and the phone, saved on the PC and searchable from both.
   Lives in the Clipboard tab. In the Beam phone app it also keeps the two clipboards in sync
   while Beam is open: PC copies land on the phone, phone copies land in the vault (and, if you
   want, on the PC clipboard). */
(() => {
'use strict';
const B = window.Beam;
const $ = s => document.querySelector(s);
const {api, toast, esc, ago, el} = B;
const buzz = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch {} };
const NATIVE = window.BeamNative || null;   // Beam phone app bridge (clipboard read/write)
const APP = !!(NATIVE && NATIVE.readClip);
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
const store = {
  get(k, d) { try { const v = localStorage.getItem('beam.vault.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('beam.vault.' + k, JSON.stringify(v)); } catch {} },
};

const card = $('#vaultCard');
let q = '', filter = 'all', items = [], total = 0, all = 0, stats = {}, loading = false, done = false, on = true, timer = 0, lastSeen = '', sel = -1;
const sync = {toPhone: store.get('toPhone', true), toPc: store.get('toPc', false)};

const IC = {
  copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
  toPc: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4M9 10l3-3 3 3M12 7v6"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M9 4h6l-1 6 4 3v2H6v-2l4-3zM12 15v6"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  open: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  call: '<svg viewBox="0 0 24 24"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z"/></svg>',
  mail: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
  sync: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3"/><path d="M18 3v4h-4M6 21v-4h4"/></svg>',
};
const TYPE = {   // badge label per smart type
  link: 'LINK', email: 'EMAIL', phone: 'PHONE', code: 'CODE', color: 'COLOR', number: 'NUM', otp: 'CODE#', image: 'IMG',
};
const CHIPS = [['all', 'All'], ['pc', 'PC'], ['phone', 'Phone'], ['link', 'Links'], ['code', 'Code'], ['image', 'Images'], ['pinned', 'Pinned']];
const chipCount = k => k === 'all' ? stats.all : k === 'pc' || k === 'phone' || k === 'pinned' ? stats[k] : stats['t_' + k];

function ibtn(svg, title, fn, cls = '') {
  const b = el('button', 'icon-btn ' + cls, svg); b.title = title; b.setAttribute('aria-label', title);
  b.onclick = e => { e.stopPropagation(); fn(b); }; return b;
}
function pop(node, cls) { node.classList.remove(cls); void node.offsetWidth; node.classList.add(cls); }
function mark(text) {   // highlight the search words
  const s = esc(text.length > 1200 ? text.slice(0, 1200) + '…' : text);
  const words = q.replace(/(^|\s)(from|is|type|in):\w+/gi, ' ').trim();
  if (!words) return s;
  const needle = esc(words).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return s.replace(new RegExp(needle, 'gi'), m => `<mark>${m}</mark>`);
}
function dayLabel(ts) {
  const d = new Date(ts * 1000), t = new Date(); t.setHours(0, 0, 0, 0);
  const diff = Math.round((t - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
  return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : d.toLocaleDateString(undefined, {weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() === t.getFullYear() ? undefined : 'numeric'});
}

/* ---------------------------------------------------------------- copy --- */
function burst(b) {   // little ink sparks out of the copy button
  if (calm || !b) return;
  const r = b.getBoundingClientRect();
  for (let i = 0; i < 7; i++) {
    const s = el('i', 'vspark'); const a = (i / 7) * Math.PI * 2 + Math.random() * .5, d = 18 + Math.random() * 14;
    s.style.cssText = `left:${r.left + r.width / 2}px;top:${r.top + r.height / 2}px;--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d}px;animation-delay:${i * 12}ms`;
    document.body.append(s); setTimeout(() => s.remove(), 650);
  }
}
async function copyHere(c, b, n) {
  if (c.img) { window.open(`/api/vault/${c.id}/img`, '_blank'); return; }
  if (b) { pop(b, 'copied'); burst(b); }
  if (n) pop(n, 'vcopied');
  buzz(10);
  try {
    let r;
    if (B.isPC) { r = await api(`/api/vault/${c.id}/apply`, {method: 'POST'}); toast('Copied', 'ok'); }
    else {
      if (NATIVE && NATIVE.copy) { NATIVE.copy(c.text); lastSeen = c.text; toast('Copied to this phone', 'ok'); } else B.copy(c.text, 'Copied');
      r = await api(`/api/vault/${c.id}/bump`, {method: 'POST'});
    }
    if (r && r.clip) moveToTop(Object.assign(c, r.clip));
  } catch (e) { toast(e.message, 'bad'); }
}
function moveToTop(c) {   // FLIP: the row glides up to the top of the list
  if (filter !== 'all' || q) return;
  const list = $('#vaultList'), node = list.querySelector(`.vit[data-id="${c.id}"]`);
  items = [c].concat(items.filter(x => x.id !== c.id));
  if (!node || list.querySelector('.vit') === node) { if (node) node.querySelector('.when').textContent = ago(c.last); return; }
  const rows = [...list.querySelectorAll('.vit')], before = new Map(rows.map(r => [r, r.getBoundingClientRect().top]));
  paint(false, true);
  if (calm) return;
  list.querySelectorAll('.vit').forEach(r => {
    const old = before.get(rowsById(rows, r.dataset.id)); if (old == null) return;
    const dy = old - r.getBoundingClientRect().top; if (!dy) return;
    r.animate([{transform: `translateY(${dy}px)`}, {transform: 'none'}], {duration: 420, easing: 'cubic-bezier(.2,.9,.2,1)'});
  });
  const top = list.querySelector('.vit'); top && top.classList.add('vlift');
  setTimeout(() => top && top.classList.remove('vlift'), 600);
}
const rowsById = (rows, id) => rows.find(r => r.dataset.id === id);

/* ---------------------------------------------------------------- rows --- */
function row(c, i) {
  const n = el('div', 'it clip vit' + (c.pinned ? ' pinned' : '') + ' t-' + (c.type || 'text'));
  n.dataset.id = c.id; n.tabIndex = -1;
  const meta = el('div', 'meta');
  if (c.img) {
    const im = Object.assign(new Image(), {src: `/api/vault/${c.id}/img`, className: 'cimg', loading: 'lazy', alt: 'Copied image'});
    im.onload = () => im.classList.add('in'); meta.append(im);
  } else {
    const t = el('div', 'txt', (c.type === 'color' ? `<i class="vsw" style="background:${esc(c.text.trim())}"></i>` : '') + mark(c.text));
    t.onclick = () => { n.classList.toggle('open'); buzz(4); };
    if (c.text.length > 160 || c.text.includes('\n')) n.classList.add('long');
    meta.append(t);
  }
  const pc = c.src === 'PC', ty = c.type && TYPE[c.type];
  meta.append(el('div', 'sub', `<span class="tag ${pc ? 'pc' : 'ph'}">${pc ? 'PC' : esc(c.src || 'Phone')}</span>${ty ? `<span class="tag ty">${ty}</span>` : ''}${c.n > 1 ? `<span class="tag">×${c.n}</span>` : ''}<span class="when">${ago(c.last)}</span>`));
  const acts = el('div', 'acts');
  const cb = ibtn(IC.copy, c.img ? 'Open' : 'Copy', b => copyHere(c, b, n), 'cpbtn');
  if (c.type === 'link') acts.append(ibtn(IC.open, 'Open link', () => window.open(/^https?:/i.test(c.text.trim()) ? c.text.trim() : 'https://' + c.text.trim(), '_blank', 'noopener')));
  if (c.type === 'phone' && !B.isPC) acts.append(ibtn(IC.call, 'Call', () => { location.href = 'tel:' + c.text.replace(/[^\d+]/g, ''); }));
  if (c.type === 'email') acts.append(ibtn(IC.mail, 'Write an email', () => { location.href = 'mailto:' + c.text.trim(); }));
  acts.append(cb);
  if (!B.isPC && c.text != null) acts.append(ibtn(IC.toPc, 'Put on the PC clipboard', async b => {
    pop(b, 'copied'); try { await api(`/api/vault/${c.id}/apply`, {method: 'POST'}); toast('On the PC clipboard', 'ok'); buzz(10); } catch (e) { toast(e.message, 'bad'); }
  }));
  acts.append(ibtn(IC.pin, c.pinned ? 'Unpin' : 'Pin (never cleared)', b => togglePin(c, n, b), 'pinbtn'));
  acts.append(ibtn(IC.x, 'Forget this', () => forget(c, n), 'xbtn'));
  n.append(meta, acts);
  n.onclick = e => { if (B.isPC && !e.target.closest('.txt,.acts')) select(+n.dataset.i); };
  n.style.setProperty('--i', Math.min(i, 12));
  swipe(n, c);
  return n;
}
/* touch: swipe left to forget, right to pin */
function swipe(n, c) {
  let x0 = 0, y0 = 0, dx = 0, on = false, id = null;
  // a sideways swipe on a row pins/forgets it; keep Beam's swipe-between-tabs out of it
  n.addEventListener('touchstart', e => e.stopPropagation(), {passive: true});
  n.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch' || e.target.closest('.acts')) return;
    x0 = e.clientX; y0 = e.clientY; dx = 0; on = false; id = e.pointerId;
  });
  n.addEventListener('pointermove', e => {
    if (e.pointerId !== id) return;
    const mx = e.clientX - x0, my = e.clientY - y0;
    if (!on) { if (Math.abs(my) > 12) { id = null; return; } if (Math.abs(mx) < 14) return; on = true; n.classList.add('vswiping'); try { n.setPointerCapture(id); } catch {} }
    dx = mx; n.style.transform = `translateX(${dx}px) rotate(${dx / 60}deg)`;
    n.dataset.sw = dx < -70 ? 'x' : dx > 70 ? 'pin' : '';
  });
  const end = e => {
    if (e.pointerId !== id) return; id = null;
    if (!on) return;
    n.classList.remove('vswiping'); n.style.transform = '';
    const act = n.dataset.sw; n.dataset.sw = '';
    if (act === 'x') forget(c, n); else if (act === 'pin') togglePin(c, n, n.querySelector('.pinbtn'));
  };
  n.addEventListener('pointerup', end); n.addEventListener('pointercancel', end);
}
async function togglePin(c, n, b) {
  c.pinned = !c.pinned; n.classList.toggle('pinned', c.pinned); pop(n, c.pinned ? 'vpinned' : 'vunpin');
  b.title = c.pinned ? 'Unpin' : 'Pin (never cleared)'; buzz(c.pinned ? [6, 40, 10] : 6);
  stats.pinned = (stats.pinned || 0) + (c.pinned ? 1 : -1); paintChips();
  try { await api(`/api/vault/${c.id}/pin`, {json: {on: c.pinned}}); } catch (e) { toast(e.message, 'bad'); }
}

/* forget with a few seconds to undo */
let undo = null;
function forget(c, n) {
  flushUndo();
  const h = n.offsetHeight; n.style.height = h + 'px'; n.classList.add('vgone'); buzz(12);
  const idx = items.findIndex(x => x.id === c.id); items = items.filter(x => x.id !== c.id);
  all = Math.max(0, all - 1); total = Math.max(0, total - 1); paintCount();
  const bar = $('#vaultUndo'); bar.querySelector('span').textContent = c.img ? 'Image forgotten' : `Forgot “${(c.text || '').trim().slice(0, 40)}${(c.text || '').length > 40 ? '…' : ''}”`;
  bar.hidden = false; pop(bar, 'show');
  const t = setTimeout(flushUndo, 5000);
  undo = {c, n, idx, t};
}
function flushUndo() {
  if (!undo) return; const {c, n, t} = undo; undo = null; clearTimeout(t);
  $('#vaultUndo').hidden = true; n.remove(); tidyDays();
  api('/api/vault/' + c.id, {method: 'DELETE'}).catch(e => toast(e.message, 'bad'));
  if (!items.length) paint();
}
function undoForget() {
  if (!undo) return; const {c, n, idx, t} = undo; undo = null; clearTimeout(t);
  $('#vaultUndo').hidden = true; items.splice(Math.max(0, idx), 0, c); all++; total++; paintCount();
  n.classList.remove('vgone'); n.style.height = ''; pop(n, 'vback'); buzz(8);
}
function tidyDays() {   // drop day headers left with no rows under them
  $('#vaultList').querySelectorAll('.vday').forEach(d => { const nx = d.nextElementSibling; if (!nx || nx.classList.contains('vday')) d.remove(); });
}

/* ---------------------------------------------------------------- paint --- */
function paintCount() {
  const node = $('#vaultCount'), n = q || filter !== 'all' ? total : all;
  const word = q || filter !== 'all' ? ` match${n === 1 ? '' : 'es'}` : ' saved';
  const from = +node.dataset.v || 0; node.dataset.v = n;
  if (calm || from === n || document.hidden) { node.textContent = n.toLocaleString() + word; return; }
  const t0 = performance.now(); cancelAnimationFrame(node._raf);
  const step = now => { const k = Math.min(1, (now - t0) / 420), e = 1 - Math.pow(1 - k, 3);
    node.textContent = Math.round(from + (n - from) * e).toLocaleString() + word; if (k < 1) node._raf = requestAnimationFrame(step); };
  node._raf = requestAnimationFrame(step);
}
function paintChips() {
  const wrap = $('#vaultChips');
  if (!wrap.querySelector('.vind')) {
    wrap.innerHTML = '<i class="vind"></i>' + CHIPS.map(([k, l]) => `<button data-vf="${k}">${l}<b></b></button>`).join('');
    wrap.querySelectorAll('[data-vf]').forEach(b => b.onclick = () => setFilter(b.dataset.vf));
  }
  wrap.querySelectorAll('[data-vf]').forEach(b => {
    const k = b.dataset.vf, n = chipCount(k);
    b.classList.toggle('on', k === filter);
    const badge = b.querySelector('b'), txt = n ? String(n > 999 ? Math.floor(n / 1000) + 'k' : n) : '';
    if (badge.textContent !== txt) { badge.textContent = txt; if (txt) pop(badge, 'bump'); }
    b.hidden = k !== 'all' && k !== filter && !n && ['link', 'code', 'image', 'pinned'].includes(k);
  });
  moveInd();
}
function moveInd() {   // the accent pill slides under the chosen chip
  const wrap = $('#vaultChips'), b = wrap.querySelector('.on'), ind = wrap.querySelector('.vind');
  if (!b || !ind || !b.offsetWidth) return;
  ind.style.width = b.offsetWidth + 'px'; ind.style.transform = `translateX(${b.offsetLeft}px)`;
}
function setFilter(k) {
  if (k === filter) return; filter = k; buzz(6); paintChips();
  const b = $('#vaultChips .on'); b && b.scrollIntoView({block: 'nearest', inline: 'center', behavior: calm ? 'auto' : 'smooth'});
  load();
}
function paint(append, quiet) {
  const list = $('#vaultList');
  if (!append) { list.innerHTML = ''; sel = -1; }
  let last = append ? list.dataset.day : '';
  const start = append ? list.querySelectorAll('.vit').length : 0;
  items.slice(start).forEach((c, k) => {
    const d = dayLabel(c.last);
    if (d !== last) { list.append(el('div', 'vday', esc(d))); last = d; }
    const r = row(c, quiet ? 0 : k); r.dataset.i = start + k; if (!quiet) r.classList.add('enter', 'vin'); list.append(r);
  });
  list.dataset.day = last;
  paintCount(); paintChips();
  const empty = $('#vaultEmpty');
  if (empty.hidden !== items.length > 0) { empty.hidden = items.length > 0; if (!empty.hidden) pop(empty, 'vpop'); }
  empty.querySelector('p').textContent = !on ? 'Clipvault is paused.' : q ? `Nothing matches “${q}”.` : filter !== 'all' ? 'Nothing here yet.' : 'Nothing saved yet. Copy something.';
  $('#vaultMore').hidden = done || !items.length;
  card.classList.toggle('vpaused', !on);
}
async function load(append) {
  if (loading) return; loading = true; card.classList.add('vloading');
  const p = new URLSearchParams({q, limit: 60, stats: 1});
  if (filter === 'pc' || filter === 'phone') p.set('src', filter);
  if (filter === 'image') p.set('kind', 'image');
  if (filter === 'link' || filter === 'code') p.set('type', filter);
  if (filter === 'pinned') p.set('pinned', '1');
  if (append && items.length) p.set('before', items[items.length - 1].last);
  try {
    const r = await api('/api/vault?' + p);
    on = r.on; total = r.total; all = r.all; stats = r.stats || stats;
    items = append ? items.concat(r.items) : r.items;
    done = r.items.length < 60;
    paint(append);
    $('#vaultOn').checked = on;
  } catch (e) { toast(e.message, 'bad'); }
  loading = false; card.classList.remove('vloading');
}

/* live: new copies drop in at the top without reloading the list */
async function fresh() {
  if (loading) return;
  if (q || filter !== 'all' || !items.length) { if (!q && filter === 'all') load(); else newPill(); return; }
  try {
    const r = await api('/api/vault?' + new URLSearchParams({since: items[0].last, limit: 30, stats: 1}));
    stats = r.stats || stats; all = r.all; total = r.total;
    if (!r.items.length) { paintChips(); return; }
    const ids = new Set(r.items.map(x => x.id));
    const list = $('#vaultList');
    r.items.forEach(c => { const old = list.querySelector(`.vit[data-id="${c.id}"]`); if (old) old.remove(); });
    items = r.items.concat(items.filter(x => !ids.has(x.id)));
    tidyDays();
    const today = dayLabel(r.items[0].last), head = list.firstElementChild;
    if (!head || !head.classList.contains('vday') || head.textContent !== today) list.prepend(el('div', 'vday', esc(today)));
    const anchor = list.firstElementChild.nextSibling;
    r.items.slice().reverse().forEach(c => { const n = row(c, 0); n.classList.add('vdrop'); list.insertBefore(n, anchor); });
    list.querySelectorAll('.vit').forEach((n, i) => n.dataset.i = i);
    $('#vaultEmpty').hidden = true; paintCount(); paintChips();
  } catch {}
}
let pending = 0;
function newPill() {
  pending++; const p = $('#vaultNew'); p.textContent = `${pending} new cop${pending === 1 ? 'y' : 'ies'} · show`; p.hidden = false; pop(p, 'show');
}

/* ---------------------------------------------------------------- sync with the phone --- */
// The live state lists Beam's recent clips. A new PC copy: refresh the vault and, in the Beam app,
// put it on this phone's clipboard (Android lets the app in front write it).
let lastClip; // undefined until the first state arrives
B.hooks.push(S => {
  const top = (S.clips || [])[0], id = top ? top.id : null;
  $('.clip-hist').hidden = S.vault !== false;
  if (id === lastClip) return;
  const first = lastClip === undefined; lastClip = id;
  if (first) return;
  if (S.vault !== false) clearTimeout(fresh._t), fresh._t = setTimeout(fresh, 250);
  if (APP && sync.toPhone && top && top.from === 'PC' && top.text && top.text !== lastSeen && document.visibilityState === 'visible') {
    NATIVE.copy(top.text); lastSeen = top.text; pulse('in');
    toast('PC copy is on this phone', 'ok'); buzz(8);
  }
});

async function savePhoneClip(text, auto) {
  if (!text || !text.trim() || text === lastSeen) { if (!auto) toast('Nothing new on the phone clipboard'); return; }
  lastSeen = text; try { localStorage.setItem('beam.lastPhoneClip', text.slice(0, 5000)); } catch {}
  try {
    const toPc = !auto || sync.toPc;
    const r = await api('/api/clip', {json: {text, auto: !toPc}});
    pulse('out'); buzz(8);
    toast(r.applied ? 'Phone copy is on the PC clipboard' : auto ? 'Phone copy saved to Clipvault' : 'Saved to Clipvault', 'ok');
  } catch (e) { if (!auto) toast(e.message, 'bad'); }
}
window.beamCapture = text => savePhoneClip(text, true);
try { lastSeen = localStorage.getItem('beam.lastPhoneClip') || ''; } catch {}

function pulse(dir) {
  const s = $('#vaultSync'); if (!s) return;
  s.dataset.dir = dir; pop(s, 'beat');
}
function buildSync() {
  const phone = $('#vaultPhone');
  if (!APP) { phone.hidden = true; return; }
  phone.hidden = false;
  phone.onclick = () => { pop(phone, 'vpress'); try { savePhoneClip(NATIVE.readClip(), false); } catch { toast('Could not read the phone clipboard', 'bad'); } };
  const box = el('div', 'vsync', `
    <button type="button" class="vsync-h" id="vaultSync" aria-expanded="false"><span class="vsync-ic">${IC.sync}</span><b>Clipboard sync</b><span class="vsync-st"></span><i class="vchev"></i></button>
    <div class="vsync-b"><div>
    <label class="vtog"><input type="checkbox" data-k="toPhone"><span class="sw"></span><span>PC copies land on this phone<small>While Beam is open</small></span></label>
    <label class="vtog"><input type="checkbox" data-k="toPc"><span class="sw"></span><span>Phone copies go on the PC clipboard<small>Saved to Clipvault either way</small></span></label>
    <p class="vsync-tip">No need to open Beam: add the <b>Clip to PC</b> Quick Settings tile, or long-press the Beam icon.</p></div></div>`);
  phone.before(box);
  const head = box.querySelector('.vsync-h');
  const setOpen = o => { box.classList.toggle('open', o); head.setAttribute('aria-expanded', o); store.set('syncOpen', o); };
  setOpen(store.get('syncOpen', true));
  head.onclick = () => { setOpen(!box.classList.contains('open')); buzz(5); };
  const st = () => { box.querySelector('.vsync-st').textContent = sync.toPhone && sync.toPc ? 'two-way' : sync.toPhone ? 'PC → phone' : sync.toPc ? 'phone → PC' : 'off'; box.classList.toggle('off', !sync.toPhone && !sync.toPc); };
  box.querySelectorAll('[data-k]').forEach(i => {
    i.checked = sync[i.dataset.k];
    i.onchange = () => { sync[i.dataset.k] = i.checked; store.set(i.dataset.k, i.checked); st(); pulse(i.dataset.k === 'toPhone' ? 'in' : 'out'); buzz(6); };
  });
  st();
}

/* ---------------------------------------------------------------- keyboard (PC) --- */
function visible() { return !card.closest('.panel').hidden; }
function select(i) {
  const rows = [...$('#vaultList').querySelectorAll('.vit:not(.vgone)')];
  if (!rows.length) return;
  sel = Math.max(0, Math.min(rows.length - 1, i));
  rows.forEach((r, k) => r.classList.toggle('sel', k === sel));
  rows[sel].scrollIntoView({block: 'nearest', behavior: calm ? 'auto' : 'smooth'});
}
function selected() {
  const n = [...$('#vaultList').querySelectorAll('.vit:not(.vgone)')][sel];
  return n ? [n, items.find(x => String(x.id) === n.dataset.id)] : [];
}
document.addEventListener('keydown', e => {
  if (!visible() || e.altKey) return;
  const inSearch = e.target === $('#vaultQ'), typing = /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) && !inSearch;
  if (typing) return;
  if ((e.key === '/' && !inSearch) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f')) { e.preventDefault(); $('#vaultQ').focus(); $('#vaultQ').select(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && undo && !inSearch) { e.preventDefault(); undoForget(); return; }
  if (e.ctrlKey || e.metaKey) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); if (inSearch) $('#vaultQ').blur(); select(sel + 1); return; }
  if (e.key === 'ArrowUp') { e.preventDefault(); if (sel <= 0) { $('#vaultQ').focus(); sel = -1; $('#vaultList').querySelectorAll('.sel').forEach(r => r.classList.remove('sel')); } else select(sel - 1); return; }
  if (e.key === 'Escape') { if (q) { $('#vaultQ').value = ''; q = ''; load(); } $('#vaultQ').blur(); return; }
  if (inSearch && e.key === 'Enter') { e.preventDefault(); if (items.length) { select(0); const [n, c] = selected(); c && copyHere(c, n.querySelector('.cpbtn'), n); } return; }
  if (inSearch || sel < 0) return;
  const [n, c] = selected(); if (!c) return;
  if (e.key === 'Enter' || e.key === 'c') { e.preventDefault(); copyHere(c, n.querySelector('.cpbtn'), n); }
  else if (e.key === 'p') togglePin(c, n, n.querySelector('.pinbtn'));
  else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); forget(c, n); setTimeout(() => select(sel), 30); }
  else if (e.key === ' ') { e.preventDefault(); n.classList.toggle('open'); }
});

/* ---------------------------------------------------------------- wire up --- */
function extras() {   // bits that live only in this file: hints, undo bar, "new" pill, export
  const search = card.querySelector('.vsearch');
  if (innerWidth < 520) $('#vaultQ').placeholder = 'Search your copies';
  search.append(el('kbd', 'vkbd pc-only', '/'));
  const tips = el('div', 'vtips', ['from:phone', 'from:pc', 'type:link', 'type:code', 'is:pinned'].map(t => `<button type="button">${t}</button>`).join(''));
  search.after(tips);
  tips.querySelectorAll('button').forEach(b => b.onmousedown = e => {
    e.preventDefault(); const i = $('#vaultQ'); i.value = (i.value.trim() + ' ' + b.textContent + ' ').trimStart(); i.dispatchEvent(new Event('input')); i.focus(); buzz(5);
  });
  const nw = el('button', 'vnew', ''); nw.id = 'vaultNew'; nw.hidden = true; nw.type = 'button';
  nw.onclick = () => { pending = 0; nw.hidden = true; q = ''; $('#vaultQ').value = ''; filter = 'all'; load(); };
  $('#vaultList').before(nw);
  const ub = el('div', 'vundo', '<span></span><button type="button">Undo</button>'); ub.id = 'vaultUndo'; ub.hidden = true;
  ub.querySelector('button').onclick = undoForget;
  card.append(ub);
  const foot = card.querySelector('.vfoot');
  const ex = el('div', 'vexport', '<button class="btn ghost sm" type="button">Export</button><div class="vmenu" hidden><a href="/api/vault/export?fmt=txt" download>Text file (.txt)</a><a href="/api/vault/export?fmt=json" download>Data (.json)</a></div>');
  const menu = ex.querySelector('.vmenu');
  ex.querySelector('button').onclick = e => { e.stopPropagation(); menu.hidden = !menu.hidden; if (!menu.hidden) pop(menu, 'vpop'); };
  document.addEventListener('click', () => { menu.hidden = true; });
  foot.querySelector('.grow').before(ex);
}

$('#vaultQ').addEventListener('input', e => {
  q = e.target.value.trim(); clearTimeout(timer);
  card.classList.toggle('vsearching', !!q);
  timer = setTimeout(() => { pending = 0; $('#vaultNew').hidden = true; load(); }, 160);
});
$('#vaultMore').onclick = () => load(true);
$('#vaultOn').onchange = async e => {
  await api('/api/vault/settings', {json: {on: e.target.checked}}); buzz(8);
  toast(e.target.checked ? 'Clipvault on: every copy is saved' : 'Clipvault paused'); load();
};
$('#vaultClear').onclick = async () => {
  if (!confirm('Forget everything in Clipvault except pinned items? This cannot be undone.')) return;
  flushUndo();
  const rows = [...$('#vaultList').querySelectorAll('.vit:not(.pinned)')];
  rows.forEach((r, i) => { r.style.animationDelay = Math.min(i, 14) * 25 + 'ms'; r.classList.add('vsweep'); });
  await api('/api/vault?all=1', {method: 'DELETE'}); buzz([10, 30, 10]);
  setTimeout(() => { toast('Clipvault cleared'); load(); }, calm ? 0 : 420 + Math.min(rows.length, 14) * 25);
};
addEventListener('resize', moveInd);
document.addEventListener('click', e => { if (e.target.closest('[data-tab="clip"],[data-panel-btn="clip"]')) setTimeout(moveInd, 60); });
new MutationObserver(() => visible() && setTimeout(moveInd, 30)).observe(card.closest('.panel'), {attributes: true, attributeFilter: ['hidden']});

extras();
buildSync();
paintChips();
load();
window.BeamVault = {reload: load, sync, fresh};   // for tests and the console
})();
