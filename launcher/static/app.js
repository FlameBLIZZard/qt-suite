/* Launchpad front end. Vanilla JS, no build step. */
(() => {
'use strict';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = { get(k, d) { try { const v = localStorage.getItem('lp.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
                set(k, v) { try { localStorage.setItem('lp.' + k, JSON.stringify(v)); } catch {} } };
const calm = () => document.documentElement.classList.contains('calm') || matchMedia('(prefers-reduced-motion: reduce)').matches;

const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5z"/></svg>',
  heart: '<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-9.2-8.6C1.2 8.2 3.1 4.5 6.6 4.5c2 0 3.4 1.1 5.4 3.2 2-2.1 3.4-3.2 5.4-3.2 3.5 0 5.4 3.7 3.8 6.9C19 15.6 12 20 12 20z"/></svg>',
  arrow: '<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
};
const PALETTES = {
  'riot:valorant': ['#ff4655', '#bd3944', 'linear-gradient(135deg,#ff4655 0%,#7a1f2b 45%,#0f1923 100%)'],
  'hoyo:genshinimpact': ['#e9c46a', '#5b7fd6', 'linear-gradient(135deg,#f3d58a 0%,#8a6fd1 45%,#203a7a 100%)'],
  'hoyo:starrail': ['#c9a7ff', '#4cc9f0', 'linear-gradient(135deg,#c9a7ff,#2b2d6e 60%,#0b1030)'],
  'mc:tlauncher': ['#7cc243', '#8b5a2b', 'linear-gradient(135deg,#8fd14f 0%,#4f8a2a 40%,#6b4423 75%,#3a2614 100%)'],
};
const SORTS = [['recent', 'Recent'], ['played', 'Most played'], ['name', 'A to Z']];

let LIB = null;
let view = store.get('view', 'library');
let filter = store.get('filter', 'all');
let sort = store.get('sort', 'recent');
let query = '';
let selected = store.get('selected', null);
let showHidden = false;
const colors = store.get('colors', {});
const cards = new Map();

// ------------------------------------------------------------ helpers ---
async function api(path, body) {
  const r = await fetch(path, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Launchpad': '1' },
    body: body instanceof Blob ? body : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || r.statusText);
  return j;
}
function fmtTime(min, long) {
  min = Math.round(min || 0);
  if (min < 1) return long ? 'Not played yet' : '0 min';
  if (min < 60) return `${min} min`;
  const hrs = min / 60;
  return `${hrs < 10 ? hrs.toFixed(1).replace(/\.0$/, '') : Math.round(hrs).toLocaleString()} h`;
}
function fmtAgo(ts) {
  if (!ts) return 'Never';
  const s = Date.now() / 1000 - ts;
  if (s < 90) return 'Just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86400);
  if (d === 1) return 'Yesterday';
  if (d < 30) return `${d} days ago`;
  return new Date(ts * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d > 300 ? 'numeric' : undefined });
}
function hashHue(s) { let x = 0; for (const c of s) x = (x * 31 + c.charCodeAt(0)) >>> 0; return x % 360; }
function paletteOf(g) {
  if (PALETTES[g.id]) return PALETTES[g.id];
  if (colors[g.id]) return colors[g.id];
  const hue = hashHue(g.name);
  return [`hsl(${hue} 80% 62%)`, `hsl(${(hue + 50) % 360} 75% 55%)`, `linear-gradient(135deg,hsl(${hue} 70% 45%),hsl(${(hue + 40) % 360} 60% 22%) 60%,hsl(${(hue + 80) % 360} 50% 10%))`];
}
function gameColor(g) { return paletteOf(g)[0]; }

// Pick two vivid hues from the cover art so the whole UI can wear its colours.
function extractColors(g, img) {
  if (colors[g.id] || PALETTES[g.id]) return;
  try {
    const c = document.createElement('canvas'); c.width = 24; c.height = 36;
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, 24, 36);
    const d = x.getImageData(0, 0, 24, 36).data;
    const buckets = Array.from({ length: 24 }, () => ({ w: 0, s: 0, l: 0 }));
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i] / 255, gg = d[i + 1] / 255, b = d[i + 2] / 255;
      const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), l = (mx + mn) / 2, dd = mx - mn;
      if (dd < .08) continue;
      const s = dd / (1 - Math.abs(2 * l - 1) || 1);
      let hh = mx === r ? ((gg - b) / dd) % 6 : mx === gg ? (b - r) / dd + 2 : (r - gg) / dd + 4;
      hh = (hh * 60 + 360) % 360;
      const w = s * (1 - Math.abs(l - .5) * 1.6);
      const k = buckets[Math.floor(hh / 15)]; k.w += w; k.s += s * w; k.l += l * w;
    }
    const ranked = buckets.map((k, i) => ({ ...k, hue: i * 15 + 7 })).filter(k => k.w > 0).sort((a, b) => b.w - a.w);
    if (!ranked.length) return;
    const a = ranked[0];
    const b2 = ranked.find(k => Math.min(Math.abs(k.hue - a.hue), 360 - Math.abs(k.hue - a.hue)) > 40) || { hue: (a.hue + 40) % 360 };
    colors[g.id] = [`hsl(${a.hue} 85% 62%)`, `hsl(${b2.hue} 80% 58%)`, null];
    store.set('colors', colors);
    const card = cards.get(g.id); if (card) card.style.setProperty('--cc', colors[g.id][0]);
    if (g.id === selected) applyAccent(g);
  } catch { /* tainted canvas etc. */ }
}
function applyAccent(g) {
  const p = g ? paletteOf(g) : ['#7c5cff', '#22d3ee'];
  document.documentElement.style.setProperty('--a1', p[0]);
  document.documentElement.style.setProperty('--a2', p[1]);
}
function ripple(e) {
  const t = e.currentTarget, r = t.getBoundingClientRect(), s = Math.max(r.width, r.height) * 2.2;
  const el = h('span', 'ripple'); el.style.cssText = `width:${s}px;height:${s}px;left:${e.clientX - r.left - s / 2}px;top:${e.clientY - r.top - s / 2}px`;
  t.appendChild(el); setTimeout(() => el.remove(), 650);
}
// toast(msg, bad) or toast(msg, { action: 'Undo', onAction: fn })
function toast(msg, opt) {
  const o = typeof opt === 'object' && opt ? opt : { bad: !!opt };
  const t = h('div', 'toast' + (o.bad ? ' bad' : ''), `<span>${esc(msg)}</span>`); $('#toasts').appendChild(t);
  let gone = false;
  const close = () => { if (gone) return; gone = true; t.classList.add('out'); setTimeout(() => t.remove(), 400); };
  if (o.action) {
    t.classList.add('has-action');
    const b = h('button', 'toast-act', esc(o.action));
    b.onclick = () => { close(); o.onAction?.(); };
    t.appendChild(b);
  }
  setTimeout(close, o.bad ? 5200 : o.action ? 6000 : 2800);
}
// In-app replacement for prompt()/confirm(): ask({title, text, input, ok, danger}) -> value | true | null
function ask({ title, text = '', input = null, ok = 'OK', danger = false }) {
  return new Promise(res => {
    const wrap = h('div', 'dlg-wrap');
    wrap.innerHTML = `<div class="dlg" role="dialog" aria-modal="true"><h3>${esc(title)}</h3>${text ? `<p class="muted">${esc(text).replace(/\n/g, '<br>')}</p>` : ''}
      ${input != null ? `<input class="dlg-in" value="${esc(input)}" spellcheck="false">` : ''}
      <div class="dlg-row"><button class="btn ghost" data-r="0">Cancel</button><button class="btn${danger ? ' danger' : ''}" data-r="1">${esc(ok)}</button></div></div>`;
    document.body.appendChild(wrap);
    const inp = $('.dlg-in', wrap);
    const done = v => { wrap.classList.add('out'); setTimeout(() => wrap.remove(), 220); document.removeEventListener('keydown', key, true); res(v); };
    const yes = () => done(inp ? (inp.value.trim() || null) : true);
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); done(null); } else if (e.key === 'Enter') { e.preventDefault(); yes(); } };
    document.addEventListener('keydown', key, true);
    wrap.onclick = e => { if (e.target === wrap) done(null); };
    $$('[data-r]', wrap).forEach(b => b.onclick = () => b.dataset.r === '1' ? yes() : done(null));
    $$('.btn', wrap).forEach(b => b.addEventListener('pointerdown', ripple));
    requestAnimationFrame(() => { (inp || $('[data-r="1"]', wrap)).focus(); inp?.select(); });
  });
}
function countUp(el, to, fmt = v => Math.round(v).toLocaleString(), dur = 1100) {
  if (calm()) { el.innerHTML = fmt(to); return; }
  const t0 = performance.now();
  const step = t => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 4); el.innerHTML = fmt(to * e);
    if (k < 1) requestAnimationFrame(step);
    else el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.16,.88)', offset: .35 }, { transform: 'scale(.96,1.05)', offset: .7 }, { transform: 'scale(1)' }], { duration: 420, easing: 'ease-out' }); };
  requestAnimationFrame(step);
}
const games = () => (LIB?.games || []).filter(g => g.kind === 'game');
const byId = id => (LIB?.games || []).find(g => g.id === id);

// ------------------------------------------------------------- views ---
// Ink wipe: a launchpad-coloured panel with an ink edge sweeps across the content when switching views.
function inkWipe() {
  if (calm()) return;
  const m = $('.main').getBoundingClientRect(), w = h('div', 'ink-wipe');
  Object.assign(w.style, { left: m.left + 'px', top: m.top + 'px', width: m.width + 'px', height: m.height + 'px' });
  document.body.appendChild(w);
  w.animate([{ clipPath: 'polygon(0 0, 0 0, -12% 100%, -12% 100%)' }, { clipPath: 'polygon(0 0, 112% 0, 100% 100%, -12% 100%)', offset: .5 },
             { clipPath: 'polygon(112% 0, 112% 0, 100% 100%, 100% 100%)' }], { duration: 560, easing: 'cubic-bezier(.7,0,.3,1)' }).onfinish = () => w.remove();
}
function setView(v, instant) {
  const wipe = v !== view && !instant && !calm();
  if (wipe) inkWipe();
  view = v; store.set('view', v);
  $$('.rail-btn[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  movePill(instant);
  clearTimeout(setView.t);
  const swap = () => {  // swap content while the wipe covers it
    if (view !== v) return;
    $$('.view').forEach(s => s.classList.toggle('active', s.dataset.view === v));
    if (v === 'stats') renderStats();
    if (v === 'tools') renderTools();
    if (v === 'library') moveInk(true);
    $('.main').scrollTo({ top: 0, behavior: 'auto' });
  };
  if (wipe) setView.t = setTimeout(swap, 250); else swap();
}
function movePill(instant) {
  const b = $(`.rail-btn[data-view="${view}"]`), pill = $('.rail-pill');
  if (!b) return;
  const from = parseFloat(pill.style.top) || 0;
  if (instant) pill.style.transition = 'none';
  pill.style.top = b.offsetTop + 'px'; pill.style.height = b.offsetHeight + 'px';
  if (instant) requestAnimationFrame(() => pill.style.transition = '');
  // squash and stretch along the travel direction
  else if (!calm() && from && Math.abs(from - b.offsetTop) > 4) pill.animate([{ transform: 'scale(1,1)' }, { transform: 'scale(.82,1.28)', offset: .35 }, { transform: 'scale(1.12,.86)', offset: .7 }, { transform: 'scale(1,1)' }], { duration: 520, easing: 'ease-out' });
  if (!instant && !calm()) b.querySelector('svg')?.animate([{ transform: 'scale(1) rotate(0)' }, { transform: 'scale(1.3) rotate(-12deg)', offset: .4 }, { transform: 'scale(1) rotate(0)' }], { duration: 420, easing: 'cubic-bezier(.34,1.56,.64,1)' });
}

// ------------------------------------------------------------ library ---
function visibleGames() {
  let list = games().filter(g => showHidden || !g.hidden);
  if (filter === 'fav') list = list.filter(g => g.fav);
  else if (filter !== 'all') list = list.filter(g => g.source === filter);
  if (query) {
    const scored = list.map(g => [g, matchScore(g, query)]).filter(x => x[1] > 0);
    return scored.sort((a, b) => b[1] - a[1] || a[0].name.localeCompare(b[0].name)).map(x => x[0]);
  }
  const cmp = { recent: (a, b) => (b.running - a.running) || (b.last - a.last) || a.name.localeCompare(b.name),
                played: (a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name),
                name: (a, b) => a.name.localeCompare(b.name) }[sort];
  return list.sort(cmp);
}
// Smart search: exact start > word start > initials ("bf" = Battlefield, "ac" = Assetto Corsa) > substring > in-order letters.
function matchScore(g, q) {
  q = q.toLowerCase().trim(); if (!q) return 1;
  const n = g.name.toLowerCase(), words = n.split(/[^a-z0-9]+/).filter(Boolean);
  if (n === q) return 100;
  if (n.startsWith(q)) return 90;
  if (words.some(w => w.startsWith(q))) return 75;
  if (words.map(w => w[0]).join('').startsWith(q.replace(/\s+/g, ''))) return 65;
  if (n.includes(q)) return 55;
  if (g.source.toLowerCase().includes(q)) return 40;
  let i = 0; for (const ch of n) if (ch === q[i]) i++;
  return i === q.length && q.length >= 2 ? 20 : 0;
}
function updateSearchHint() {
  const hint = $('#search-hint'), top = query ? visibleGames()[0] : null;
  hint.hidden = !top; $('.search kbd').hidden = !!top;
  if (top) hint.innerHTML = `<b>Enter</b> ${esc(top.name)}`;
}
function renderChips() {
  const all = games().filter(g => showHidden || !g.hidden);
  const sources = [...new Set(all.map(g => g.source))];
  const defs = [['all', 'All', all.length], ['fav', 'Favourites', all.filter(g => g.fav).length],
                ...sources.map(s => [s, s, all.filter(g => g.source === s).length])];
  if (!defs.some(d => d[0] === filter)) filter = 'all';
  const box = $('#chips'); $$('.chip', box).forEach(c => c.remove());
  for (const [k, label, n] of defs) {
    const b = h('button', 'chip' + (k === filter ? ' active' : ''), `${esc(label)}<span class="n">${n}</span>`);
    b.dataset.k = k;
    b.onclick = () => { if (filter === k) return; filter = k; store.set('filter', k); $$('.chip').forEach(c => c.classList.toggle('active', c === b)); moveInk(); renderGrid(true); };
    box.appendChild(b);
  }
  requestAnimationFrame(() => moveInk(true));
}
function moveInk(instant) {
  const a = $('.chip.active'), ink = $('.chip-ink'); if (!a) return;
  const from = parseFloat(ink.style.left);
  if (instant) ink.style.transition = 'none';
  ink.style.left = a.offsetLeft + 'px'; ink.style.width = a.offsetWidth + 'px';
  if (instant) requestAnimationFrame(() => ink.style.transition = '');
  else if (!calm() && !isNaN(from) && from !== a.offsetLeft) ink.animate([{ transform: 'scale(1,1)' }, { transform: 'scale(1.18,.78)', offset: .4 }, { transform: 'scale(.94,1.08)', offset: .75 }, { transform: 'scale(1,1)' }], { duration: 480, easing: 'ease-out' });
}

function coverHTML(g) {
  if (g.art.portrait) return `<img class="cover" src="${g.art.portrait}" alt="" draggable="false" crossorigin="anonymous">`;
  const p = paletteOf(g);
  return `<div class="gen-cover" style="background-image:${p[2]}"><span class="gen-ring"></span>${g.art.icon ? `<img class="gen-icon" src="${g.art.icon}" alt="">` : ''}<div class="gen-title">${esc(g.name)}</div></div>`;
}
function cardSub(g) {
  return `<span>${g.running ? 'Playing now' : fmtTime(g.minutes, true)}</span><span>${esc(g.source)}</span>`;
}
function buildCard(g) {
  const c = h('button', 'card enter' + (g.art.portrait ? '' : ' gen'));
  c.dataset.id = g.id;
  c.addEventListener('animationend', e => { if (e.animationName === 'card-in') c.classList.remove('enter'); });
  c.innerHTML = `<div class="card-inner">${coverHTML(g)}<div class="glare"></div>
    <div class="card-meta"><div class="card-name">${esc(g.name)}</div><div class="card-sub">${cardSub(g)}</div></div>
    <span class="card-play" title="Play">${ICON.play}</span></div>`;
  c.style.setProperty('--cc', gameColor(g));
  const img = $('img.cover', c);
  if (img) img.addEventListener('load', () => extractColors(g, img), { once: true });
  c.addEventListener('click', e => {
    if (e.target.closest('.card-play')) { e.stopPropagation(); return launch(byId(g.id), c); }
    select(g.id);
  });
  c.addEventListener('dblclick', () => launch(byId(g.id), c));
  c.addEventListener('contextmenu', e => { e.preventDefault(); select(g.id); openMenu(byId(g.id), e.clientX, e.clientY); });
  c.addEventListener('focus', () => { if (kbNav) select(g.id); });
  // 3D tilt + glare that follows the pointer
  c.addEventListener('pointermove', e => {
    if (calm()) return;
    const r = c.getBoundingClientRect(), px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
    c.classList.add('tilting');
    c.style.setProperty('--ry', `${(px - .5) * 16}deg`); c.style.setProperty('--rx', `${(.5 - py) * 14}deg`);
    c.style.setProperty('--gx', `${px * 100}%`); c.style.setProperty('--gy', `${py * 100}%`);
  });
  c.addEventListener('pointerleave', () => { c.classList.remove('tilting'); c.style.setProperty('--rx', '0deg'); c.style.setProperty('--ry', '0deg'); });
  // drop an image to set cover art
  c.addEventListener('dragover', e => { if ([...e.dataTransfer.items].some(i => i.type.startsWith('image/'))) { e.preventDefault(); c.classList.add('drop'); } });
  c.addEventListener('dragleave', () => c.classList.remove('drop'));
  c.addEventListener('drop', e => { e.preventDefault(); c.classList.remove('drop'); const f = [...e.dataTransfer.files].find(f => f.type.startsWith('image/')); if (f) uploadArt(g.id, 'portrait', f); });
  return c;
}
function updateCard(c, g) {
  $('.card-sub', c).innerHTML = cardSub(g);
  $('.card-name', c).textContent = g.name;
  const fav = $('.fav-mark', c);
  if (g.fav && !fav) $('.card-inner', c).appendChild(h('span', 'fav-mark', ICON.heart));
  if (!g.fav && fav) fav.remove();
  const run = $('.run-mark', c);
  if (g.running && !run) $('.card-inner', c).appendChild(h('span', 'run-mark', '<span class="live-dot"></span>Live'));
  if (!g.running && run) run.remove();
  c.classList.toggle('selected', g.id === selected);
  c.style.opacity = g.hidden ? .45 : '';
}
function renderGrid(animate) {
  const grid = $('#grid'), list = visibleGames();
  const before = new Map();
  if (animate && !calm()) cards.forEach((c, id) => { if (c.isConnected) before.set(id, c.getBoundingClientRect()); });
  const keep = new Set(list.map(g => g.id));
  cards.forEach((c, id) => { if (!keep.has(id)) { c.remove(); } });
  list.forEach((g, i) => {
    let c = cards.get(g.id);
    if (!c || c.dataset.art !== JSON.stringify(g.art)) {
      const old = c; c = buildCard(g); c.dataset.art = JSON.stringify(g.art); cards.set(g.id, c);
      if (old) old.replaceWith(c);
    }
    updateCard(c, g);
    if (grid.children[i] !== c) grid.insertBefore(c, grid.children[i] || null);
    if (c.classList.contains('enter')) c.style.setProperty('--i', animate ? 0 : i);
  });
  // FLIP: glide cards from their old spot to the new one
  if (before.size) list.forEach(g => {
    const c = cards.get(g.id), a = before.get(g.id); if (!a) return;
    const b = c.getBoundingClientRect(), dx = a.left - b.left, dy = a.top - b.top;
    if (dx || dy) c.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], { duration: 520, easing: 'cubic-bezier(.34,1.3,.64,1)' });
  });
  $('#empty').hidden = list.length > 0;
}

// --------------------------------------------------------------- hero ---
let heroLayer = 0, heroId = null;
function select(id, instant) {
  const g = byId(id); if (!g) return;
  selected = id; store.set('selected', id);
  cards.forEach((c, cid) => c.classList.toggle('selected', cid === id));
  renderHero(g, instant);
  applyAccent(g);
}
function renderHero(g, instant) {
  const hero = $('#hero');
  if (heroId !== g.id) {
    heroId = g.id;
    const layers = $$('.hero-layer', hero);
    const next = layers[heroLayer ^= 1], prev = layers[heroLayer ^ 1];
    next.className = 'hero-layer'; next.innerHTML = ''; next.style.backgroundImage = '';
    const src = g.art.hero || g.art.header || g.art.portrait;
    if (src) next.style.backgroundImage = `url("${src}")`;
    else { next.classList.add('gen'); next.style.backgroundImage = paletteOf(g)[2]; next.innerHTML = `<div class="gen-word">${esc(g.name)}</div>`; }
    void next.offsetWidth;
    next.classList.add('on'); prev.classList.remove('on');
    // re-run the text entrance
    hero.classList.add('swap'); void hero.offsetWidth; hero.classList.remove('swap');
    const word = () => { let k = 0;  // letters pop in one by one; words stay unbroken
      return `<h1 aria-label="${esc(g.name)}">${g.name.split(' ').map(w => `<span class="w">${[...w].map(ch => `<span class="ch" style="--k:${k++}">${esc(ch)}</span>`).join('')}</span>`).join(' ')}</h1>`; };
    $('#hero-title').innerHTML = g.art.logo ? `<img src="${g.art.logo}" alt="${esc(g.name)}">` : word();
    const logo = $('#hero-title img'); if (logo) logo.onerror = () => $('#hero-title').innerHTML = word();
    if (!instant && !calm()) { hero.classList.remove('flash'); void hero.offsetWidth; hero.classList.add('flash'); }
  }
  $('#hero-source').innerHTML = (g.running ? '<span class="live-dot"></span>Playing now · ' : '') + esc(g.source);
  const meta = [];
  meta.push(`<span><b>${fmtTime(g.minutes, true)}</b>${g.minutes >= 1 ? ' played' : ''}</span>`);
  meta.push(`<span>Last played <b>${fmtAgo(g.last)}</b></span>`);
  if (g.size) meta.push(`<span>${(g.size / 1e9).toFixed(1)} GB</span>`);
  $('#hero-meta').innerHTML = meta.join('');
  const play = $('#hero-play');
  play.classList.toggle('running', g.running);
  $('.play-label', play).textContent = g.running ? `Playing · ${fmtTime((Date.now() / 1000 - (g.running_since || Date.now() / 1000)) / 60)}` : 'Play';
  $('#hero-fav').classList.toggle('on', g.fav);
  const st = [];
  if (g.store_2wk) st.push([fmtTime(g.store_2wk), 'last 2 weeks']);
  if (g.sessions) st.push([g.sessions, g.sessions === 1 ? 'session tracked' : 'sessions tracked']);
  if (g.longest) st.push([fmtTime(g.longest), 'longest session']);
  $('#hero-stats').innerHTML = st.slice(0, 3).map(([v, l]) => `<div class="hstat"><b>${v}</b><span>${l}</span></div>`).join('');
}

// magnetic play button
function magnet(btn, strength = 10) {
  btn.addEventListener('pointermove', e => {
    if (calm()) return;
    const r = btn.getBoundingClientRect();
    btn.style.transform = `translate(${((e.clientX - r.left) / r.width - .5) * strength}px,${((e.clientY - r.top) / r.height - .5) * strength * .6}px)`;
  });
  btn.addEventListener('pointerleave', () => btn.style.transform = '');
}

// ------------------------------------------------------------- launch ---
let launchTimer = null;
async function launch(g, fromEl) {
  if (!g) return;
  if (g.running && g.kind === 'game') { toast(`${g.name} is already running`); return; }
  showLaunch(g, fromEl);
  try { await api('/api/launch', { id: g.id }); g.last = Date.now() / 1000; }
  catch (e) { hideLaunch(); toast(`Couldn't start ${g.name}: ${e.message}`, true); }
}
function showLaunch(g, fromEl) {
  const ov = $('#launch'); clearTimeout(launchTimer);
  const src = g.art.hero || g.art.portrait || g.art.header;
  const r = (fromEl || $('#hero')).getBoundingClientRect();
  ov.innerHTML = `<div class="lbg"></div><div class="lshade"></div><div class="rays"></div><div class="halftone"></div><div class="wave"></div><div class="wave w2"></div>
    <div class="lcenter"><div class="go-stamp">${g.kind === 'tool' ? 'OPEN!' : 'GO!'}</div><div class="lring"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" stroke="rgba(255,255,255,.12)"/><circle cx="50" cy="50" r="46" stroke="url(#lgr)" stroke-dasharray="70 220"/><defs><linearGradient id="lgr"><stop offset="0" stop-color="${paletteOf(g)[0]}"/><stop offset="1" stop-color="${paletteOf(g)[1]}"/></linearGradient></defs></svg><div class="pl">${ICON.play}</div></div>
    <h2>${esc(g.name)}</h2><p>${g.kind === 'tool' ? 'Opening' : 'Launching via ' + esc(g.source)}…</p></div>`;
  const bg = $('.lbg', ov);
  bg.style.backgroundImage = src ? `url("${src}")` : paletteOf(g)[2];
  Object.assign(bg.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  ov.hidden = false;
  if (!calm()) bg.animate([{ left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', borderRadius: '18px', filter: 'blur(0)' },
                          { left: '0px', top: '0px', width: innerWidth + 'px', height: innerHeight + 'px', borderRadius: '0px', filter: 'blur(8px)' }],
                          { duration: 700, easing: 'cubic-bezier(.7,0,.2,1)', fill: 'forwards' });
  else Object.assign(bg.style, { left: 0, top: 0, width: '100%', height: '100%', filter: 'blur(8px)' });
  requestAnimationFrame(() => ov.classList.add('on'));
  ov.onclick = hideLaunch;
  launchTimer = setTimeout(hideLaunch, 3400);
}
function hideLaunch() {
  const ov = $('#launch'); if (ov.hidden) return; clearTimeout(launchTimer);
  ov.animate([{ opacity: 1 }, { opacity: 0 }], { duration: calm() ? 1 : 450, easing: 'ease' }).onfinish = () => { ov.hidden = true; ov.classList.remove('on'); ov.innerHTML = ''; };
}

// ------------------------------------------------------- menu & art ---
function openMenu(g, x, y) {
  const m = $('#menu');
  const items = [
    [g.running ? 'Already running' : (g.kind === 'tool' ? 'Open' : 'Play'), () => launch(g)],
    [g.fav ? 'Remove from favourites' : 'Add to favourites', () => toggleFav(g)],
    ['Rename…', () => rename(g)],
    null,
    ['Set cover art…', () => pickArt(g.id, 'portrait')],
    ['Set background art…', () => pickArt(g.id, 'hero')],
    ['Reset art', () => edit(g, { reset_art: true }, 'Art reset')],
    null,
    ['Open install folder', () => api('/api/open-folder', { id: g.id })],
    [g.hidden ? 'Unhide' : 'Hide from library', () => g.hidden ? edit(g, { hidden: false }, 'Unhidden')
      : edit(g, { hidden: true }).then(() => toast(`${g.name} hidden`, { action: 'Undo', onAction: () => edit(g, { hidden: false }, 'Back in your library') }))],
  ];
  if (g.source === 'Added') items.push(['Remove from Launchpad', async () => { await api('/api/remove', { id: g.id }); await load(); toast('Removed (the game itself is untouched)'); }, 'bad']);
  m.innerHTML = '';
  for (const it of items) {
    if (!it) { m.appendChild(h('hr')); continue; }
    const b = h('button', it[2] || '', esc(it[0]));
    b.onclick = () => { closeMenu(); it[1](); };
    m.appendChild(b);
  }
  m.hidden = false;
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(x, innerWidth - r.width - 10) + 'px';
  m.style.top = Math.min(y, innerHeight - r.height - 10) + 'px';
}
function closeMenu() { $('#menu').hidden = true; }
async function edit(g, patch, msg) {
  try { await api('/api/game', { id: g.id, ...patch }); Object.assign(g, patch); if (patch.reset_art) { delete colors[g.id]; store.set('colors', colors); await load(); } else refresh(); if (msg) toast(msg); }
  catch (e) { toast(e.message, true); }
}
function toggleFav(g) {
  const was = g.fav;
  edit(g, { fav: !was });
  if (!was) { burst($('#hero-fav')); const c = cards.get(g.id); if (c) { c.classList.remove('stamp'); void c.offsetWidth; c.classList.add('stamp'); } }
  else toast(`Removed ${g.name} from favourites`, { action: 'Undo', onAction: () => { if (!g.fav) toggleFav(g); } });
}

// Surprise me: flicker across the shelf like a roulette, land on a game you haven't touched lately.
let rolling = false;
async function surprise() {
  if (rolling) return;
  const list = visibleGames().filter(g => !g.running && !g.missing);
  if (!list.length) return toast('No games to pick from');
  if (view !== 'library') setView('library');
  const weights = list.map(g => 1 + Math.min(30, (Date.now() / 1000 - (g.last || 0)) / 86400));  // longer untouched = likelier
  let r = Math.random() * weights.reduce((a, b) => a + b, 0), pick = list[0];
  for (let i = 0; i < list.length; i++) { r -= weights[i]; if (r <= 0) { pick = list[i]; break; } }
  rolling = true; $('#dice-btn').classList.add('rolling');
  if (!calm() && list.length > 1) {
    const steps = 9 + Math.floor(Math.random() * 4);
    for (let s = 0; s < steps; s++) {
      const g = s === steps - 1 ? pick : list[(Math.random() * list.length) | 0];
      cards.forEach(c => c.classList.toggle('roll', c.dataset.id === g.id));
      await new Promise(res => setTimeout(res, 55 + s * s * 3));
    }
    cards.forEach(c => c.classList.remove('roll'));
  }
  rolling = false; $('#dice-btn').classList.remove('rolling');
  select(pick.id);
  const c = cards.get(pick.id);
  if (c) { c.scrollIntoView({ block: 'nearest', behavior: calm() ? 'auto' : 'smooth' }); c.classList.remove('stamp'); void c.offsetWidth; c.classList.add('stamp'); }
  toast(`Tonight: ${pick.name}`, { action: 'Play', onAction: () => launch(byId(pick.id), cards.get(pick.id)) });
}
function burst(el) {
  if (calm() || !el) return;
  for (let i = 0; i < 10; i++) {
    const p = h('span', 'burst'); el.appendChild(p);
    const a = (i / 10) * Math.PI * 2, d = 26 + Math.random() * 14;
    p.animate([{ transform: 'translate(-50%,-50%) scale(1)', opacity: 1 }, { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d}px)) scale(0)`, opacity: 0 }],
              { duration: 600 + Math.random() * 200, easing: 'cubic-bezier(.2,.8,.2,1)' }).onfinish = () => p.remove();
  }
}
async function rename(g) {
  const n = await ask({ title: 'Rename', text: 'Name to show in Launchpad. The game itself is not changed.', input: g.name, ok: 'Rename' });
  if (n && n !== g.name) edit(g, { name: n }, 'Renamed');
}
let artTarget = null;
function pickArt(id, kind) { artTarget = [id, kind]; $('#art-file').value = ''; $('#art-file').click(); }
async function uploadArt(id, kind, file) {
  try {
    const r = await fetch(`/api/art/${encodeURIComponent(id)}/${kind}`, { method: 'POST', headers: { 'X-Launchpad': '1' }, body: file });
    const j = await r.json(); if (j.error) throw new Error(j.error);
    delete colors[id]; store.set('colors', colors);
    await load(true); toast('Art updated');
  } catch (e) { toast(e.message, true); }
}

// -------------------------------------------------------------- stats ---
function renderStats() {
  if (!LIB) return;
  const S = LIB.stats, all = games();
  const total = all.reduce((a, g) => a + g.minutes, 0);
  const wk = S.week, pw = S.prev_week;
  const delta = pw > 0 ? Math.round((wk - pw) / pw * 100) : null;
  const k = [
    ['Total playtime', total / 60, v => `${Math.round(v).toLocaleString()}<small>h</small>`, `${all.filter(g => g.minutes > 0).length} games played`],
    ['This week', wk, v => fmtTime(v).replace(/ (h|min)$/, '<small>$1</small>'), delta == null ? 'tracked by Launchpad' : `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)}% vs last week`, delta == null ? '' : delta >= 0 ? 'up' : 'down'],
    ['Day streak', S.streak, v => `${Math.round(v)}<small>${Math.round(v) === 1 ? 'day' : 'days'}</small>`, S.streak ? 'keep it going' : 'play today to start one'],
    ['Sessions', S.sessions, v => Math.round(v).toLocaleString(), S.first ? `since ${new Date(S.first * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : 'logged from today'],
    ['Longest session', S.longest, v => fmtTime(v).replace(/ (h|min)$/, '<small>$1</small>'), ''],
  ];
  $('#kpis').innerHTML = k.map(([l, , , d, cls], i) => `<div class="kpi" style="--i:${i}"><div class="lbl">${l}</div><div class="val">0</div><div class="delta ${cls || ''}">${d}</div></div>`).join('');
  $$('#kpis .val').forEach((el, i) => countUp(el, k[i][1], k[i][2]));
  renderTop(all); renderHeat(S.heat); renderDonut(all);
  requestAnimationFrame(() => renderRange());  // after the panels have their final height
}
let range = store.get('range', 30), rangeStats = null;
async function renderRange() {
  $$('#range button').forEach(b => b.classList.toggle('on', +b.dataset.d === range));
  $('#chart-title').textContent = `Last ${range} days`;
  if (range === 30) { rangeStats = LIB.stats; return renderChart(LIB.stats); }
  try { rangeStats = await api('/api/stats?days=' + range); renderChart(rangeStats); }
  catch { rangeStats = LIB.stats; range = 30; renderChart(LIB.stats); }
}
function renderChart(S) {
  const box = $('#chart'); box.classList.remove('on');
  const days = S.daily, max = Math.max(60, ...days.map(d => d.total));
  const every = days.length <= 7 ? 1 : days.length <= 31 ? 5 : 15;
  const niceMax = Math.ceil(max / 180) * 180;  // whole hours on every grid line
  const W = Math.max(300, box.clientWidth), H = Math.max(230, box.clientHeight), pad = 30, bw = (W - pad) / days.length;
  let svg = `<svg viewBox="0 0 ${W} ${H}">`;
  for (let i = 0; i <= 3; i++) { const y = (H - 20) * (1 - i / 3); svg += `<line class="grid-l" x1="${pad}" x2="${W}" y1="${y}" y2="${y}"/><text x="0" y="${y + 4}">${niceMax / 180 * i}h</text>`; }
  days.forEach((d, i) => {
    let y = H - 20; const x = pad + i * bw + bw * .18, w = bw * .64;
    svg += `<g class="col" data-i="${i}"><rect x="${pad + i * bw}" y="0" width="${bw}" height="${H}" fill="transparent"/>`;
    Object.entries(d.games).sort((a, b) => b[1] - a[1]).forEach(([gid, m]) => {
      const bh = (H - 20) * m / niceMax; y -= bh;
      const g = byId(gid);
      svg += `<rect class="bar" x="${x}" y="${y}" width="${w}" height="${Math.max(bh, 0)}" rx="3" fill="${g ? gameColor(g) : '#888'}" style="transition-delay:${i * 18}ms"/>`;
    });
    if ((days.length - 1 - i) % every === 0) svg += `<text x="${x + w / 2}" y="${H - 4}" text-anchor="middle">${new Date(d.day + 'T00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</text>`;
    svg += '</g>';
  });
  svg += '</svg><div class="tip"></div>';
  const any = days.some(d => d.total > 0);
  box.innerHTML = svg + (any ? '' : '<div class="chart-empty">Your daily history fills in as you play. Launchpad logs every session from now on, including Valorant, Genshin and Minecraft.</div>');
  $('#chart-note').textContent = any ? `${fmtTime(days.reduce((a, d) => a + d.total, 0))} total` : '';
  const tip = $('.tip', box);
  $$('.col', box).forEach(col => {
    col.onmouseenter = () => {
      const d = days[col.dataset.i]; if (!d.total) { tip.classList.remove('on'); return; }
      const r = col.getBoundingClientRect(), br = box.getBoundingClientRect();
      tip.innerHTML = `<b>${new Date(d.day + 'T00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</b> · ${fmtTime(d.total)}<br>` +
        Object.entries(d.games).sort((a, b) => b[1] - a[1]).map(([id, m]) => `<span class="muted">${esc(byId(id)?.name || id)}: ${fmtTime(m)}</span>`).join('<br>');
      tip.style.left = (r.left - br.left + r.width / 2) + 'px'; tip.style.top = '20px'; tip.classList.add('on');
    };
    col.onmouseleave = () => tip.classList.remove('on');
  });
  const seen = new Set(days.flatMap(d => Object.keys(d.games)));
  $('#legend').innerHTML = [...seen].map(id => byId(id)).filter(Boolean).map(g => `<span><i style="background:${gameColor(g)}"></i>${esc(g.name)}</span>`).join('');
  requestAnimationFrame(() => requestAnimationFrame(() => box.classList.add('on')));
}
function renderTop(all) {
  const list = [...all].filter(g => g.minutes > 0).sort((a, b) => b.minutes - a.minutes).slice(0, 7);
  const max = list[0]?.minutes || 1;
  $('#toplist').innerHTML = list.length ? list.map((g, i) => `<div class="trow" style="--i:${i}" data-id="${esc(g.id)}">
    ${g.art.portrait ? `<img class="thumb" src="${g.art.portrait}" alt="">` : `<div class="thumb" style="background:${paletteOf(g)[2]}"></div>`}
    <div style="min-width:0"><div class="tname">${esc(g.name)}</div><div class="track"><div class="fill" data-w="${g.minutes / max * 100}" style="background:linear-gradient(90deg,${paletteOf(g)[0]},${paletteOf(g)[1]})"></div></div></div>
    <div class="hrs">${fmtTime(g.minutes)}</div></div>`).join('') : '<p class="muted">Nothing played yet.</p>';
  $$('#toplist .trow').forEach(r => r.onclick = () => { setView('library'); select(r.dataset.id); });
  requestAnimationFrame(() => requestAnimationFrame(() => $$('#toplist .fill').forEach(f => f.style.width = f.dataset.w + '%')));
}
function renderHeat(heat) {
  const box = $('#heat'); box.classList.remove('on');
  const max = Math.max(1, ...heat.flat());
  const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  let html = '<span></span>' + Array.from({ length: 24 }, (_, i) => `<span class="hh">${i % 6 === 0 ? i : ''}</span>`).join('');
  heat.forEach((row, d) => {
    html += `<span class="hl">${names[d]}</span>`;
    row.forEach((m, hr) => {
      const a = m / max;
      html += `<span class="cell" title="${names[d]} ${hr}:00 · ${fmtTime(m)}" style="${m > 0 ? `background:color-mix(in srgb, var(--a1) ${Math.round(18 + a * 82)}%, transparent);` : ''}transition-delay:${(d + hr) * 14}ms"></span>`;
    });
  });
  box.innerHTML = html;
  requestAnimationFrame(() => requestAnimationFrame(() => box.classList.add('on')));
}
function renderDonut(all) {
  const list = [...all].filter(g => g.minutes > 0).sort((a, b) => b.minutes - a.minutes);
  const total = list.reduce((a, g) => a + g.minutes, 0) || 1;
  const top = list.slice(0, 5), rest = list.slice(5).reduce((a, g) => a + g.minutes, 0);
  const segs = top.map(g => [g.name, g.minutes, gameColor(g)]); if (rest) segs.push(['Others', rest, '#555a6e']);
  const C = 2 * Math.PI * 60; let off = 0;
  let svg = '<svg viewBox="0 0 160 160"><circle cx="80" cy="80" r="60" stroke="rgba(255,255,255,.05)"/>';
  segs.forEach(([, m, col]) => { const len = m / total * C; svg += `<circle cx="80" cy="80" r="60" stroke="${col}" stroke-dasharray="0 ${C}" data-d="${Math.max(len - 2, 0)} ${C}" stroke-dashoffset="${-off}"/>`; off += len; });
  svg += '</svg>';
  $('#donut').innerHTML = svg + `<div class="dl">${segs.map(([n, m, col]) => `<div><i style="background:${col}"></i>${esc(n)}<span>${Math.round(m / total * 100)}%</span></div>`).join('')}</div>`;
  requestAnimationFrame(() => requestAnimationFrame(() => $$('#donut circle[data-d]').forEach(c => c.setAttribute('stroke-dasharray', c.dataset.d))));
}

// -------------------------------------------------------------- tools ---
function renderTools() {
  if (!LIB) return;
  const list = LIB.games.filter(g => g.kind === 'tool' && LIB.settings.show_tools || g.kind === 'app');
  $('#tools').innerHTML = list.map((g, i) => {
    const p = paletteOf(g);
    const ico = g.art.icon || g.art.header;
    return `<button class="tool" style="--i:${i}" data-id="${esc(g.id)}"><span class="ti" style="background:${p[2]}">${ico ? `<img src="${ico}" alt="">` : esc(g.name[0])}</span>
      <span><b>${esc(g.name)}</b><small>${esc(g.blurb || g.source + (g.minutes ? ' · ' + fmtTime(g.minutes) : ''))}</small></span><span class="go">${ICON.arrow}</span></button>`;
  }).join('') || '<p class="muted">QT tools are switched off in Settings.</p>';
  $$('#tools .tool').forEach(b => { b.onclick = () => launch(byId(b.dataset.id), b); b.onpointerdown = ripple; });
}

// --------------------------------------------------------- top & data ---
function renderTop2() {
  const hr = new Date().getHours();
  $('#greet-text').textContent = `${hr < 5 ? 'Late night' : hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening'}`;
  const n = games().filter(g => !g.hidden).length;
  $('#greet-sub').textContent = `${n} games ready · ${fmtTime(LIB.stats.week)} played this week`;
  const run = games().filter(g => g.running);
  const np = $('#now-playing');
  if (run.length) { np.hidden = false; np.innerHTML = `<span class="dot"></span>${esc(run.map(g => g.name).join(', '))} · ${fmtTime((Date.now() / 1000 - Math.min(...run.map(g => g.running_since))) / 60)}`; }
  else np.hidden = true;
}
function refresh() {
  renderTop2(); renderChips(); renderGrid(false);
  const g = byId(selected) || games().find(g => g.running) || visibleGames()[0];
  if (g) select(g.id, true);
  if (view === 'tools') renderTools();
}
async function load(force) {
  try {
    LIB = await api('/api/library');
    if (force) { cards.forEach(c => c.remove()); cards.clear(); heroId = null; }
    document.documentElement.classList.toggle('calm', !!LIB.settings.reduce_motion);
    refresh();
    if (view === 'stats' && force) renderStats();
    $('#about').textContent = `Launchpad ${LIB.version} · scanned ${new Date(LIB.scanned * 1000).toLocaleTimeString()} · data in QT\\launcher\\data`;
  } catch (e) { toast('Lost connection to Launchpad. Is it still running?', true); }
}
async function poll() {
  try {
    const prev = LIB;
    LIB = await api('/api/library');
    const runNow = new Set(games().filter(g => g.running).map(g => g.id));
    games().forEach(g => { if (runNow.has(g.id) && !prev?.games.find(p => p.id === g.id)?.running) { hideLaunch(); toast(`${g.name} is running · tracking playtime`); } });
    renderTop2(); renderGrid(false);
    const g = byId(selected); if (g) renderHero(g);
  } catch {}
}

// ------------------------------------------------------------ settings ---
function openDrawer() {
  const s = LIB.settings;
  $('#set-track').checked = s.track; $('#set-tools').checked = s.show_tools; $('#set-motion').checked = s.reduce_motion;
  $('#set-startup').checked = LIB.startup; $('#set-nudge').value = String(s.break_nudge || 0); $('#folder-path').value = s.games_folder || '';
  $('#unhide-btn').textContent = showHidden ? 'Hide hidden games' : 'Show hidden games';
  $('#scrim').hidden = false; $('#drawer').classList.add('open'); $('#drawer').setAttribute('aria-hidden', 'false');
}
function closeDrawer() { $('#drawer').classList.remove('open'); $('#drawer').setAttribute('aria-hidden', 'true'); $('#scrim').hidden = true; }
async function saveSetting(patch) {
  try { const j = await api('/api/settings', patch); LIB.settings = j.settings; LIB.startup = j.startup; document.documentElement.classList.toggle('calm', !!j.settings.reduce_motion); if (view === 'tools') renderTools(); }
  catch (e) { toast(e.message, true); }
}

// ------------------------------------------------- keyboard & gamepad ---
let kbNav = false;
function moveFocus(dx, dy) {
  kbNav = true;
  const list = $$('#grid .card'); if (!list.length) return;
  let i = list.findIndex(c => c === document.activeElement);
  if (i < 0) i = Math.max(0, list.findIndex(c => c.dataset.id === selected));
  else {
    const top = list[0].offsetTop, cols = list.filter(c => c.offsetTop === top).length || 1;
    i = Math.min(list.length - 1, Math.max(0, i + dx + dy * cols));
  }
  list[i].focus({ preventScroll: true });
  list[i].scrollIntoView({ block: 'nearest', behavior: calm() ? 'auto' : 'smooth' });
}
document.addEventListener('keydown', e => {
  const typing = e.target.matches('input, textarea');
  if ($('.dlg-wrap')) return;
  if (!typing && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'r' && view === 'library') { e.preventDefault(); return surprise(); }
  if (e.key === 'Escape') { if (!$('#launch').hidden) return hideLaunch(); if (!$('#menu').hidden) return closeMenu(); if ($('#drawer').classList.contains('open')) return closeDrawer(); if (typing) { e.target.blur(); return; } }
  if (typing) return;
  if (e.key === '/' || (e.ctrlKey && e.key.toLowerCase() === 'k')) { e.preventDefault(); setView('library'); $('#search').focus(); return; }
  if (['1', '2', '3'].includes(e.key)) return setView(['library', 'stats', 'tools'][+e.key - 1]);
  if (view !== 'library') return;
  const dirs = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (dirs[e.key]) { e.preventDefault(); moveFocus(...dirs[e.key]); }
  else if (e.key === 'Enter') { const g = byId(selected); if (g) { e.preventDefault(); launch(g, cards.get(g.id)); } }
  else if (e.key.toLowerCase() === 'f') { const g = byId(selected); if (g) toggleFav(g); }
});
document.addEventListener('pointerdown', () => kbNav = false);

const pad = { last: {}, t: 0 };
function gamepadLoop(t) {
  const gp = [...(navigator.getGamepads?.() || [])].find(Boolean);
  if (gp) {
    const b = i => gp.buttons[i]?.pressed;
    const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
    const dir = b(14) || ax < -.6 ? [-1, 0] : b(15) || ax > .6 ? [1, 0] : b(12) || ay < -.6 ? [0, -1] : b(13) || ay > .6 ? [0, 1] : null;
    if (dir && t - pad.t > 170) { pad.t = t; if (view === 'library') moveFocus(...dir); }
    const edge = i => { const p = b(i), was = pad.last[i]; pad.last[i] = p; return p && !was; };
    if (edge(0)) { const g = byId(selected); if (g && view === 'library') launch(g, cards.get(g.id)); }
    if (edge(1)) { hideLaunch(); closeMenu(); closeDrawer(); }
    if (edge(3)) { const g = byId(selected); if (g) toggleFav(g); }
    if (edge(2) && view === 'library') surprise();
    const views = ['library', 'stats', 'tools'];
    if (edge(4)) setView(views[(views.indexOf(view) + 2) % 3]);
    if (edge(5)) setView(views[(views.indexOf(view) + 1) % 3]);
  }
  requestAnimationFrame(gamepadLoop);
}
addEventListener('gamepadconnected', e => toast(`Controller connected · A to play, LB/RB to switch tabs`));

// --------------------------------------------------------------- wire ---
function wire() {
  $$('.rail-btn[data-view]').forEach(b => b.onclick = () => setView(b.dataset.view));
  $('#btn-settings').onclick = openDrawer;
  $('#drawer-close').onclick = closeDrawer; $('#scrim').onclick = closeDrawer;
  $('#hero-play').onclick = () => { const g = byId(selected); if (g) launch(g, $('#hero')); };
  $('#hero-play').addEventListener('pointerdown', ripple);
  magnet($('#hero-play'));
  $('#hero-fav').onclick = () => { const g = byId(selected); if (g) toggleFav(g); };
  $('#hero-folder').onclick = () => { const g = byId(selected); if (g) api('/api/open-folder', { id: g.id }); };
  $('#hero-more').onclick = e => { const g = byId(selected); const r = e.currentTarget.getBoundingClientRect(); if (g) openMenu(g, r.left, r.bottom + 8); e.stopPropagation(); };
  $('#hero').addEventListener('dragover', e => { if ([...e.dataTransfer.items].some(i => i.type.startsWith('image/'))) e.preventDefault(); });
  $('#hero').addEventListener('drop', e => { e.preventDefault(); const f = [...e.dataTransfer.files].find(f => f.type.startsWith('image/')); if (f && selected) uploadArt(selected, 'hero', f); });
  $('#search').addEventListener('input', e => { query = e.target.value.trim(); renderGrid(true); updateSearchHint(); const top = query && visibleGames()[0]; if (top) select(top.id); });
  $('#search').addEventListener('keydown', e => {
    if (e.key === 'Enter') { const top = visibleGames()[0]; if (top) { e.preventDefault(); launch(top, cards.get(top.id)); } }
    else if (e.key === 'ArrowDown') { e.preventDefault(); e.target.blur(); moveFocus(0, 0); }
    else if (e.key === 'Escape' && e.target.value) { e.stopPropagation(); clearSearch(); }
  });
  const clearSearch = () => { $('#search').value = ''; query = ''; renderGrid(true); updateSearchHint(); };
  $('#clear-search').onclick = clearSearch;
  const sb = $('#sort-btn');
  const setSortLabel = () => $('#sort-label').textContent = SORTS.find(s => s[0] === sort)[1];
  sb.onclick = () => { if (!calm()) $('svg', sb).animate([{ transform: 'rotate(0)' }, { transform: 'rotate(180deg) scale(1.2)' }], { duration: 380, easing: 'cubic-bezier(.34,1.56,.64,1)' });
    const i = SORTS.findIndex(s => s[0] === sort); sort = SORTS[(i + 1) % SORTS.length][0]; store.set('sort', sort); setSortLabel(); renderGrid(true); };
  setSortLabel();
  $('#dice-btn').onclick = surprise;
  $('#art-file').onchange = e => { const f = e.target.files[0]; if (f && artTarget) uploadArt(artTarget[0], artTarget[1], f); };
  document.addEventListener('click', e => { if (!e.target.closest('#menu')) closeMenu(); });
  $('.main').addEventListener('scroll', e => e.currentTarget.classList.toggle('scrolled', e.currentTarget.scrollTop > 10), { passive: true });
  let rz; addEventListener('resize', () => { movePill(true); moveInk(true); clearTimeout(rz); rz = setTimeout(() => { if (view === 'stats' && LIB) renderChart(rangeStats || LIB.stats); }, 200); });
  $$('#range button').forEach(b => b.onclick = () => { range = +b.dataset.d; store.set('range', range); renderRange(); });
  $('#set-nudge').onchange = e => saveSetting({ break_nudge: +e.target.value }).then(() => toast(+e.target.value ? `Break reminder after ${e.target.selectedOptions[0].textContent.toLowerCase()} of play` : 'Break reminders off'));

  $('#set-track').onchange = e => saveSetting({ track: e.target.checked });
  $('#set-tools').onchange = e => saveSetting({ show_tools: e.target.checked });
  $('#set-motion').onchange = e => saveSetting({ reduce_motion: e.target.checked });
  $('#set-startup').onchange = e => saveSetting({ startup: e.target.checked }).then(() => toast(e.target.checked ? 'Launchpad will start quietly with Windows' : 'Removed from startup'));
  $('#add-btn').onclick = async () => {
    const p = $('#add-path').value.trim(); if (!p) return;
    try { const j = await api('/api/add', { path: p }); $('#add-path').value = ''; await load(); select(j.id); toast('Game added'); closeDrawer(); }
    catch (e) { toast(e.message, true); }
  };
  $('#add-path').addEventListener('keydown', e => { if (e.key === 'Enter') $('#add-btn').click(); });
  $('#folder-btn').onclick = async () => {
    const folder = $('#folder-path').value.trim();
    if (!await ask({ title: 'Create game shortcuts?', text: `One shortcut per game goes into\n${folder}\nNo game files are moved or changed.`, ok: 'Create' })) return;
    try { const j = await api('/api/games-folder', { folder }); toast(`${j.count} shortcuts in ${j.folder}`); }
    catch (e) { toast(e.message, true); }
  };
  $('#rescan-btn').onclick = async e => { const b = e.currentTarget; b.disabled = true; b.textContent = 'Scanning…'; try { await api('/api/rescan', {}); await load(true); toast('Library rescanned'); } finally { b.disabled = false; b.textContent = 'Rescan PC'; } };
  $('#unhide-btn').onclick = e => { showHidden = !showHidden; e.currentTarget.textContent = showHidden ? 'Hide hidden games' : 'Show hidden games'; renderChips(); renderGrid(true); };
  $('#quit-btn').onclick = async () => { if (!await ask({ title: 'Quit Launchpad?', text: 'Playtime tracking stops until you open it again.', ok: 'Quit', danger: true })) return; await api('/api/quit', {}).catch(() => {}); document.body.innerHTML = '<div style="margin:auto;text-align:center;color:#9298ad;font:16px Inter,sans-serif">Launchpad has quit. You can close this window.</div>'; };
  $$('.btn, .icon-btn').forEach(b => b.addEventListener('pointerdown', ripple));
  const tick = () => { $('#clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };
  tick(); setInterval(tick, 10000);
}

// skeleton while the first scan loads
$('#grid').innerHTML = Array.from({ length: 6 }, () => '<div class="skel" style="aspect-ratio:2/3;border-radius:18px"></div>').join('');
wire();
setView(view, true);
load().then(() => { $$('#grid .skel').forEach(s => s.remove()); requestAnimationFrame(gamepadLoop); });
setInterval(poll, 8000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
})();
