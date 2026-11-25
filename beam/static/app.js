/* Beam client: live state, resumable chunked uploads, folder browser. */
(() => {
'use strict';
const $ = s => document.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const enc = p => p.split('/').map(encodeURIComponent).join('/');

/* ------------------------------------------------------------ format --- */
function fmtBytes(n) {
  if (!n) return '0 B';
  const u = ['B','KB','MB','GB','TB']; let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return (i ? n.toFixed(n >= 100 ? 0 : n >= 10 ? 1 : 2) : n) + ' ' + u[i];
}
const fmtSpeed = b => fmtBytes(b) + '/s';
function fmtEta(sec) {
  if (!isFinite(sec) || sec <= 0) return '';
  if (sec < 60) return Math.ceil(sec) + 's left';
  if (sec < 3600) return Math.floor(sec / 60) + 'm ' + Math.round(sec % 60) + 's left';
  return Math.floor(sec / 3600) + 'h ' + Math.round((sec % 3600) / 60) + 'm left';
}
function ago(ts) {
  const s = Date.now() / 1000 - ts;
  if (s < 45) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  return new Date(ts * 1000).toLocaleDateString();
}

/* ------------------------------------------------------------ icons --- */
const IC = {
  file: '<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>',
  dir: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  img: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/></svg>',
  vid: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="14" height="14" rx="2"/><path d="m17 10 4-2v8l-4-2"/></svg>',
  aud: '<svg viewBox="0 0 24 24"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>',
  zip: '<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M11 5h1M11 8h1M11 11h1M11 14h1v3h-1z"/></svg>',
  apk: '<svg viewBox="0 0 24 24"><rect x="6" y="3" width="12" height="18" rx="2"/><path d="M11 18h2"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14"/></svg>',
  open: '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M9 5v14M15 5v14"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7 5l12 7-12 7z"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v4m-2-2h4"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  check: '<svg class="check" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="M12 20V9m0 0-4 4m4-4 4 4M5 4h14"/></svg>',
};
const EXT = {img:/\.(jpe?g|png|gif|webp|heic|heif|bmp|avif|svg)$/i, vid:/\.(mp4|mkv|mov|avi|webm|m4v|3gp)$/i,
  aud:/\.(mp3|wav|flac|m4a|aac|ogg|opus)$/i, zip:/\.(zip|rar|7z|tar|gz|iso)$/i, apk:/\.(apk|apks|xapk)$/i};
function kindIcon(name, isDir) {
  if (isDir) return IC.dir;
  for (const k in EXT) if (EXT[k].test(name)) return IC[k];
  return IC.file;
}
const previewable = n => /\.(jpe?g|png|gif|webp|bmp|avif)$/i.test(n);

/* ------------------------------------------------------------ toasts --- */
function toast(msg, kind = '', action) {
  const t = el('div', 'toast ' + kind, esc(msg));
  const bye = () => { if (t._gone) return; t._gone = true; t.classList.add('out'); setTimeout(() => t.remove(), 320); };
  if (action) {   // e.g. {label: 'Undo', fn}
    const b = el('button', 'toast-act', esc(action.label));
    b.onclick = () => { bye(); action.fn(); };
    t.append(b); t.classList.add('has-act');
  }
  $('#toasts').append(t);
  setTimeout(bye, action ? 4500 : 3200);
  return t;
}

/* button ripple */
document.addEventListener('pointerdown', e => {
  const b = e.target.closest('.btn'); if (!b) return;
  const r = b.getBoundingClientRect(), d = Math.max(r.width, r.height) * 2.2;
  const s = el('span', 'ripple');
  s.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
  b.append(s); setTimeout(() => s.remove(), 650);
});

/* animated number tween */
function tween(node, to, fmt) {
  const from = +node.dataset.v || 0; node.dataset.v = to;
  if (from === to) { node.textContent = fmt(to); return; }
  const t0 = performance.now(), dur = 450;
  cancelAnimationFrame(node._raf);
  const step = now => {
    const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    node.textContent = fmt(from + (to - from) * e);
    if (k < 1) node._raf = requestAnimationFrame(step);
  };
  node._raf = requestAnimationFrame(step);
}

/* ------------------------------------------------------------ api --- */
async function api(path, opts = {}) {
  const r = await fetch(path, Object.assign({credentials: 'same-origin'}, opts,
    opts.json ? {method: opts.method || 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(opts.json)} : {}));
  let data = {}; try { data = await r.json(); } catch {}
  if (!r.ok) { const err = new Error(data.error || r.statusText); err.status = r.status; err.data = data; throw err; }
  return data;
}

/* ------------------------------------------------------------ state loop --- */
let S = {rev: 0, items: [], notes: [], active: [], partials: []};
let isPC = false, firstState = true;

async function loop() {
  let fails = 0;
  for (;;) {
    try {
      const st = await api('/api/state?rev=' + S.rev);
      fails = 0; $('#offline').hidden = true;
      S = st; render(); if (firstState) { firstState = false; onFirst(); }
    } catch (e) {
      if (e.status === 401) { location.reload(); return; }
      fails++; if (fails > 1) $('#offline').hidden = false;
      $('#linkChip').classList.remove('on'); $('#linkText').textContent = 'Reconnecting…';
      await new Promise(r => setTimeout(r, Math.min(5000, 600 * fails)));
    }
  }
}

function onFirst() {
  isPC = S.local; Beam.isPC = isPC;
  document.body.classList.toggle('is-pc', isPC);
  $('#ver').textContent = 'Beam ' + S.version;
  if (isPC) {
    $('#connect').hidden = false;
    $('#openInbox').hidden = false;
    $('#clearItems').hidden = false;
    $('#sendTitle').textContent = 'Send to phone';
    $('#sendHint').textContent = 'Shares by path, nothing gets copied.';
    $('#dropText').textContent = 'Share files from this PC';
    $('#dropSub').textContent = 'Tap to pick. Dropping files here copies them into the Beam folder.';
    $('#btnFiles').lastChild.textContent = 'Share files';
    $('#btnFolder').lastChild.textContent = 'Share folder';
    $('#tip').textContent = 'Phones see everything listed below and download at full Wi-Fi speed. Their download manager can pause and resume.';
    $('#emptySub').textContent = 'Share something from this PC, or send from the phone.';
    drawQR();
  } else {
    document.querySelector('.grid').classList.add('phone');
    $('#dropSub').textContent = 'Photos, videos, APKs, anything. Any size.';
  }
}

function drawQR() {
  const urls = S.urls || [];
  const url = urls[0] || location.href;
  $('#url').textContent = url.replace(/\?k=.*/, '');
  $('#url').title = url;
  $('#copyUrl').onclick = () => copy(url, 'Link copied');
  try {
    const qr = qrcode(0, 'M'); qr.addData(url); qr.make();
    const n = qr.getModuleCount();
    let rects = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) {
      const d = ((r + c) * 9) % 600 + Math.hypot(r - n / 2, c - n / 2) * 18;
      rects += `<rect x="${c}" y="${r}" width="1.02" height="1.02" style="animation:qrin .5s ${d.toFixed(0)}ms both"/>`;
    }
    $('#qr').innerHTML = `<style>@keyframes qrin{from{opacity:0;transform:scale(.2)}}</style><svg viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" fill="#000">${rects}</svg>`;
  } catch (e) { $('#qr').textContent = 'QR failed: ' + e.message; }
  if (urls.length > 1) {
    $('#moreIps').hidden = false;
    $('#ipList').innerHTML = urls.slice(1).map(u => `<code>${esc(u)}</code>`).join('');
  }
}

function copy(text, msg) {
  const done = () => toast(msg || 'Copied', 'ok');
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
  fallbackCopy(text, done);
}
function fallbackCopy(text, done) {
  const t = el('textarea'); t.value = text; t.style.cssText = 'position:fixed;opacity:0';
  document.body.append(t); t.select(); try { document.execCommand('copy'); done(); } catch { toast('Copy failed', 'bad'); } t.remove();
}

/* ------------------------------------------------------------ render --- */
const itemNodes = new Map();
function render() {
  const chip = $('#linkChip'); chip.classList.add('on');
  $('#linkText').textContent = isPC || S.local ? `This PC · ${S.pc}` : S.pc;
  chip.title = isPC || S.local ? 'This PC' : `Connected to ${S.pc}`;

  // items
  const list = $('#items');
  const seen = new Set();
  S.items.forEach((it, idx) => {
    seen.add(it.id);
    let node = itemNodes.get(it.id);
    const sig = [it.name, it.size, it.count, it.added].join('|');
    if (!node) {
      node = buildItem(it); node.classList.add('enter'); node.style.animationDelay = firstState ? '0ms' : Math.min(idx, 8) * 40 + 'ms';
      itemNodes.set(it.id, node);
      if (!firstState && !firstRender) setTimeout(() => node.classList.add('flash'), 500);
    } else if (node.dataset.sig !== sig) {
      const fresh = buildItem(it); node.replaceWith(fresh); itemNodes.set(it.id, fresh); node = fresh;
      node.classList.add('flash');
    }
    node.dataset.sig = sig;
    if (list.children[idx] !== node) list.insertBefore(node, list.children[idx] || null);
  });
  for (const [id, node] of itemNodes) if (!seen.has(id)) {
    itemNodes.delete(id); node.classList.add('leave'); setTimeout(() => node.remove(), 360);
  }
  $('#itemsEmpty').hidden = S.items.length > 0;
  const total = S.items.reduce((a, i) => a + (i.size || 0), 0);
  $('#itemsHint').textContent = S.items.length ? `${S.items.length} item${S.items.length > 1 ? 's' : ''} · ${fmtBytes(total)}` : '';

  renderNotes();
  renderTransfers();
  for (const h of Beam.hooks) try { h(S, firstRender); } catch (e) { console.error(e); }
  firstRender = false;
}
let firstRender = true;

function buildItem(it) {
  const n = el('div', 'it');
  n.dataset.id = it.id;
  const isDir = it.kind === 'dir';
  const thumb = el('div', 'thumb' + (isDir ? ' dir' : ''), kindIcon(it.name, isDir));
  if (!isDir && previewable(it.name) && it.size < 25e6) {
    const img = new Image(); img.loading = 'lazy'; img.alt = '';
    img.onload = () => { thumb.innerHTML = ''; thumb.append(img); requestAnimationFrame(() => img.classList.add('ok')); };
    img.src = `/f/${it.id}?inline=1`;
  }
  const fromPC = it.from === 'PC';
  const sub = `<span class="tag ${fromPC ? 'pc' : 'ph'}">${fromPC ? 'from PC' : 'from ' + esc(it.from)}</span>` +
    `${fmtBytes(it.size)}${isDir ? ' · ' + it.count + ' files' : ''} · ${ago(it.added)}`;
  const meta = el('div', 'meta', `<div class="name" title="${esc(it.name)}">${esc(it.name)}</div><div class="sub">${sub}</div>`);
  const acts = el('div', 'acts');
  if (isDir) {
    acts.append(iconBtn(IC.open, 'Open folder', () => openFolder(it, '')));
    acts.append(iconLink(IC.down, 'Download as ZIP', `/z/${it.id}`));
  } else {
    if (previewable(it.name) || EXT.vid.test(it.name) || /\.pdf$/i.test(it.name))
      acts.append(iconLink(IC.eye, 'Open', `/f/${it.id}?inline=1`, true));
    acts.append(iconLink(IC.down, 'Download', `/f/${it.id}`));
  }
  if (isPC) acts.append(iconBtn(IC.pin, 'Show in Explorer', () => api('/api/pc/open/' + it.id, {method: 'POST'})));
  acts.append(iconBtn(IC.x, 'Remove from list (keeps the file)', () => removeItem(it)));
  n.append(thumb, meta, acts);
  if (isDir) { meta.style.cursor = 'pointer'; meta.onclick = () => openFolder(it, ''); }
  else {  // tap the name: open what can be viewed, download the rest
    meta.style.cursor = 'pointer';
    meta.onclick = () => { const a = acts.querySelector('a.icon-btn'); if (a) a.click(); };
  }
  return n;
}
function iconBtn(svg, title, fn) {
  const b = el('button', 'icon-btn', svg); b.title = title; b.setAttribute('aria-label', title);
  b.onclick = e => { e.stopPropagation(); fn(e); }; return b;
}
function iconLink(svg, title, href, newTab) {
  const a = el('a', 'icon-btn', svg); a.title = title; a.href = href; a.setAttribute('aria-label', title);
  if (newTab) a.target = '_blank'; else a.setAttribute('download', '');
  a.onclick = e => { e.stopPropagation(); if (!newTab) { pulse(a); toast('Download started'); } };
  return a;
}
function pulse(node) { node.animate([{transform: 'scale(1)'}, {transform: 'scale(1.35)'}, {transform: 'scale(1)'}], {duration: 420, easing: 'cubic-bezier(.34,1.56,.64,1)'}); }

/* remove from the list with a few seconds to undo (the file itself always stays) */
const removing = new Set();
function removeItem(it) {
  const node = itemNodes.get(it.id);
  if (!node || removing.has(it.id)) return;
  removing.add(it.id);
  node.classList.add('leave');
  const hideT = setTimeout(() => { node.hidden = true; }, 340);
  let undone = false;
  const go = setTimeout(async () => {
    if (undone) return;
    try { await api('/api/item/' + it.id, {method: 'DELETE'}); }
    catch (e) { toast(e.message, 'bad'); node.hidden = false; node.classList.remove('leave'); }
    removing.delete(it.id);
  }, 4600);
  toast(`Removed ${it.name.length > 28 ? it.name.slice(0, 26) + '…' : it.name}`, '', {label: 'Undo', fn: () => {
    undone = true; clearTimeout(go); clearTimeout(hideT); removing.delete(it.id);
    node.hidden = false; node.classList.remove('leave'); node.classList.remove('enter'); void node.offsetWidth; node.classList.add('enter');
  }});
}

/* notes */
const noteNodes = new Map();
function renderNotes() {
  $('#notesCard').hidden = !S.notes.length;
  const list = $('#notes'); const seen = new Set();
  S.notes.forEach((nt, idx) => {
    seen.add(nt.id);
    let node = noteNodes.get(nt.id);
    if (!node) {
      node = el('div', 'it note enter');
      const linked = esc(nt.text).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
      node.append(el('div', 'meta', `<div class="txt">${linked}</div><div class="sub">${esc(nt.from)} · ${ago(nt.ts)}</div>`));
      const acts = el('div', 'acts');
      acts.append(iconBtn(IC.copy, 'Copy', () => copy(nt.text)));
      acts.append(iconBtn(IC.x, 'Delete', () => { node.classList.add('leave'); api('/api/note/' + nt.id, {method: 'DELETE'}); }));
      node.append(acts); noteNodes.set(nt.id, node);
    }
    if (list.children[idx] !== node) list.insertBefore(node, list.children[idx] || null);
  });
  for (const [id, node] of noteNodes) if (!seen.has(id)) { noteNodes.delete(id); node.classList.add('leave'); setTimeout(() => node.remove(), 360); }
}

/* ------------------------------------------------------------ uploads --- */
const CONC = 3;
const queue = [];           // my uploads
let batchSeq = Date.now().toString(36);

function addFiles(list) {   // list: [{file, rel}]
  if (!list.length) return;
  const batch = batchSeq + '-' + Math.random().toString(36).slice(2, 7);
  let bytes = 0;
  for (const {file, rel} of list) {
    queue.push({file, rel: rel || file.name, size: file.size, sent: 0, live: 0, status: 'queued', batch,
      key: Math.random().toString(36).slice(2), speed: 0, samples: []});
    bytes += file.size;
  }
  toast(`Sending ${list.length} file${list.length > 1 ? 's' : ''} · ${fmtBytes(bytes)}`, 'ok');
  const d = $('#drop'); d.classList.remove('burst'); void d.offsetWidth; d.classList.add('burst');
  pump(); renderTransfers();
}

function pump() {
  const running = queue.filter(u => u.status === 'sending' || u.status === 'retry').length;
  let free = CONC - running;
  for (const u of queue) { if (free <= 0) break; if (u.status === 'queued') { free--; run(u); } }
}

function xhrPut(url, blob, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('PUT', url); x.timeout = 120000;
    x.upload.onprogress = e => onProgress(e.loaded);
    x.onload = () => { let d = {}; try { d = JSON.parse(x.responseText); } catch {}
      if (x.status >= 200 && x.status < 300) resolve(d); else { const er = new Error(d.error || 'HTTP ' + x.status); er.status = x.status; er.data = d; reject(er); } };
    x.onerror = () => reject(Object.assign(new Error('network'), {status: 0}));
    x.ontimeout = () => reject(Object.assign(new Error('timeout'), {status: 0}));
    x.onabort = () => reject(Object.assign(new Error('aborted'), {status: -1}));
    x.setRequestHeader('Content-Type', 'application/octet-stream');
    x.send(blob);
    onProgress.xhr = x;
  });
}

async function run(u) {
  u.status = 'sending'; u.err = ''; u.t0 = u.t0 || performance.now();
  let chunk = 8 << 20, backoff = 1000;
  for (;;) {
    if (u.status === 'paused' || u.status === 'cancelled') return pump();
    try {
      if (!u.uid) {
        const r = await api('/api/up', {json: {rel: u.rel, size: u.size, mtime: u.file.lastModified, batch: u.batch}});
        if (r.done) { u.sent = u.size; break; }
        u.uid = r.uid; u.sent = r.offset;
        if (r.offset > 0) toast(`Resuming ${u.file.name} from ${fmtBytes(r.offset)}`, 'ok');
      }
      if (u.sent >= u.size) break;
      const end = Math.min(u.size, u.sent + chunk);
      const t = performance.now();
      const prog = loaded => { u.live = loaded; sample(u); };
      u.prog = prog;
      const r = await xhrPut(`/api/up/${u.uid}?offset=${u.sent}`, u.file.slice(u.sent, end), prog);
      u.live = 0; u.sent = r.offset; backoff = 1000;
      if (u.status === 'retry') u.status = 'sending';
      const dt = performance.now() - t;   // aim for ~2 s per chunk
      if (dt < 1200 && chunk < (64 << 20)) chunk *= 2; else if (dt > 5000 && chunk > (2 << 20)) chunk /= 2;
      if (r.done) break;
    } catch (e) {
      u.live = 0;
      if (u.status === 'paused' || u.status === 'cancelled') return pump();
      if (e.status === 409 && e.data && e.data.offset != null) { u.sent = e.data.offset; continue; }
      if (e.status === 404) { u.uid = null; continue; }
      if (e.status === 401) { u.status = 'error'; u.err = 'Key expired. Scan the QR again.'; return; }
      if (e.status >= 400 && e.status < 500) { u.status = 'error'; u.err = e.message; renderTransfers(); return pump(); }
      // network trouble: keep retrying with backoff, then sync the offset
      u.status = 'retry'; u.err = 'Reconnecting…'; renderTransfers();
      await waitOnline(backoff); backoff = Math.min(backoff * 2, 8000);
      try { if (u.uid) { const r = await api('/api/up/' + u.uid); u.sent = r.offset; } } catch {}
    }
  }
  u.status = 'done'; u.sent = u.size; u.doneAt = Date.now();
  u.took = (performance.now() - u.t0) / 1000;
  renderTransfers(); pump();
  if (queue.every(q => q.status === 'done' || q.status === 'cancelled' || q.status === 'error')) {
    const done = queue.filter(q => q.status === 'done' && !q.announced);
    if (done.length) { done.forEach(q => q.announced = true); toast(`${done.length} file${done.length > 1 ? 's' : ''} delivered`, 'ok'); }
  }
}
function waitOnline(ms) {
  return new Promise(res => {
    const t = setTimeout(done, ms);
    function done() { clearTimeout(t); window.removeEventListener('online', done); res(); }
    window.addEventListener('online', done);
  });
}
function sample(u) {
  const now = performance.now(), b = u.sent + u.live;
  u.samples.push([now, b]);
  while (u.samples.length > 2 && now - u.samples[0][0] > 3000) u.samples.shift();
  const [t0, b0] = u.samples[0];
  if (now - t0 > 300) u.speed = (b - b0) / ((now - t0) / 1000);
}
function pauseUpload(u) {
  if (u.status === 'paused') { u.status = 'queued'; pump(); }
  else { u.status = 'paused'; u.speed = 0; u.prog && u.prog.xhr && u.prog.xhr.abort(); }
  renderTransfers();
}
function cancelUpload(u) {
  const was = u.status; u.status = 'cancelled';
  u.prog && u.prog.xhr && u.prog.xhr.abort();
  if (u.uid && was !== 'done') api('/api/up/' + u.uid, {method: 'DELETE'}).catch(() => {});
  queue.splice(queue.indexOf(u), 1);
  renderTransfers(); pump();
}

/* transfer list (mine + incoming on PC + paused partials) */
const trNodes = new Map();
function renderTransfers() {
  const rows = [];
  const now = Date.now();
  for (const u of queue) {
    if (u.status === 'done' && now - u.doneAt > 6000) continue;
    rows.push({key: 'm' + u.key, name: u.rel, size: u.size, got: u.sent + u.live, speed: u.status === 'sending' ? u.speed : 0,
      status: u.status, mine: u, err: u.err});
  }
  const mineUids = new Set(queue.map(u => u.uid).filter(Boolean));
  for (const a of S.active || []) if (!mineUids.has(a.uid))
    rows.push({key: 'a' + a.uid, name: a.rel, size: a.size, got: a.got, speed: a.speed, status: 'incoming', from: a.from});
  for (const p of S.partials || []) if (!mineUids.has(p.uid))
    rows.push({key: 'p' + p.uid, name: p.rel, size: p.size, got: p.got, status: 'partial', from: p.from, uid: p.uid});

  $('#transfersCard').hidden = !rows.length;
  const list = $('#transfers'); const seen = new Set();
  rows.forEach((r, idx) => {
    seen.add(r.key);
    let n = trNodes.get(r.key);
    if (!n) { n = buildTr(r); trNodes.set(r.key, n); }
    updateTr(n, r);
    if (list.children[idx] !== n) list.insertBefore(n, list.children[idx] || null);
  });
  for (const [k, n] of trNodes) if (!seen.has(k)) { trNodes.delete(k); n.classList.add('leave'); setTimeout(() => n.remove(), 360); }

  const speed = rows.reduce((a, r) => a + (r.speed || 0), 0);
  const left = rows.filter(r => ['sending', 'queued', 'retry', 'incoming'].includes(r.status)).reduce((a, r) => a + r.size - r.got, 0);
  $('#totalSpeed').innerHTML = speed > 0 ? `<b class="num">${fmtSpeed(speed)}</b> · ${fmtBytes(left)} to go` : '';
}
function buildTr(r) {
  const n = el('div', 'it tr enter');
  n.innerHTML = `<div class="thumb">${kindIcon(r.name)}</div>
    <div class="meta"><div class="name" title="${esc(r.name)}">${esc(r.name)}</div><div class="bar"><i></i></div><div class="sub"></div></div>
    <div class="acts"></div>`;
  const acts = n.querySelector('.acts');
  if (r.mine) {
    n._pause = iconBtn(IC.pause, 'Pause', () => pauseUpload(r.mine));
    acts.append(n._pause, iconBtn(IC.x, 'Cancel', () => cancelUpload(r.mine)));
  } else if (r.status === 'partial') {
    if (!isPC) acts.append(iconBtn(IC.play, 'Pick this file again to resume', () => $('#pickFiles').click()));
    acts.append(iconBtn(IC.trash, 'Discard the partial file', () => api('/api/up/' + r.uid, {method: 'DELETE'})));
  }
  return n;
}
function updateTr(n, r) {
  const pct = r.size ? Math.min(100, r.got / r.size * 100) : 100;
  n.querySelector('.bar i').style.width = pct.toFixed(2) + '%';
  n.className = 'it tr ' + ({sending: '', incoming: '', queued: 'queued', retry: 'retry', paused: 'paused', partial: 'paused', done: 'done', error: 'err', cancelled: 'paused'}[r.status] || '');
  let sub;
  const p = `<b class="num">${pct.toFixed(pct < 10 ? 1 : 0)}%</b> · ${fmtBytes(r.got)} of ${fmtBytes(r.size)}`;
  switch (r.status) {
    case 'sending': case 'incoming':
      sub = `${p}${r.speed ? ' · ' + fmtSpeed(r.speed) + ' · ' + fmtEta((r.size - r.got) / r.speed) : ''}${r.from ? ' · from ' + esc(r.from) : ''}`; break;
    case 'queued': sub = `Waiting · ${fmtBytes(r.size)}`; break;
    case "retry": sub = `${esc(r.err)} ${fmtBytes(r.got)} saved`; break;
    case 'paused': sub = `Paused · ${p}`; break;
    case 'partial': sub = `${p} · stopped${r.from ? ' (' + esc(r.from) + ')' : ''}${isPC ? '' : ' · pick it again to resume'}`; break;
    case 'done': sub = `Delivered · ${fmtBytes(r.size)}${r.mine && r.mine.took > 1 ? ' in ' + Math.round(r.mine.took) + 's · avg ' + fmtSpeed(r.size / r.mine.took) : ''}`; break;
    case 'error': sub = `Failed: ${esc(r.err)}`; break;
    default: sub = p;
  }
  const s = n.querySelector('.sub'); if (s.innerHTML !== sub) s.innerHTML = sub;
  if (r.status === 'done' && !n._done) {
    n._done = true; n.querySelector('.thumb').innerHTML = IC.check;
    if (n._pause) n._pause.remove();
  }
  if (n._pause && r.mine) {
    const want = r.status === 'paused' ? IC.play : IC.pause;
    if (n._pause._ic !== want) { n._pause.innerHTML = want; n._pause._ic = want; n._pause.title = r.status === 'paused' ? 'Resume' : 'Pause'; }
  }
}
setInterval(() => { if (queue.some(u => u.status === 'sending' || u.status === 'done')) renderTransfers(); }, 250);

/* ------------------------------------------------------------ pickers / drop --- */
const pickFiles = $('#pickFiles'), pickFolder = $('#pickFolder');
pickFiles.onchange = () => { addFiles([...pickFiles.files].map(f => ({file: f, rel: f.name}))); pickFiles.value = ''; };
pickFolder.onchange = () => {
  // Beam phone app: the native folder picker hands back each file's path inside the folder
  let rels = [];
  try { if (window.BeamFolder) rels = JSON.parse(BeamFolder.rels()) || []; } catch {}
  const files = [...pickFolder.files];
  const ok = rels.length === files.length && files.every((f, i) => rels[i].split('/').pop() === f.name);
  addFiles(files.map((f, i) => ({file: f, rel: f.webkitRelativePath || (ok ? rels[i] : f.name)})));
  pickFolder.value = '';
};

async function pcPick(kind) {
  const btn = kind === 'folder' ? $('#btnFolder') : $('#btnFiles');
  btn.disabled = true;
  toast('A picker window opened on the PC');
  try {
    const r = await api('/api/pc/pick-' + kind, {method: 'POST'});
    if (r.items.length) toast(`Shared ${r.items.length} item${r.items.length > 1 ? 's' : ''}`, 'ok');
  } catch (e) { toast(e.message, 'bad'); }
  btn.disabled = false;
}
$('#btnFiles').onclick = () => isPC ? pcPick('files') : pickFiles.click();
$('#btnFolder').onclick = () => { if (isPC) return pcPick('folder'); try { window.BeamFolder && BeamFolder.want(); } catch {} pickFolder.click(); };
const drop = $('#drop');
drop.addEventListener('click', e => { if (isPC) { e.preventDefault(); pcPick('files'); } });

let dragDepth = 0;
window.addEventListener('dragenter', e => { if (hasFiles(e)) { dragDepth++; drop.classList.add('over'); } });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; drop.classList.remove('over'); } });
window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('drop', async e => {
  if (!hasFiles(e)) return;
  e.preventDefault(); dragDepth = 0; drop.classList.remove('over');
  const items = [...(e.dataTransfer.items || [])];
  const entries = items.map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  if (!entries.length) return addFiles([...e.dataTransfer.files].map(f => ({file: f, rel: f.name})));
  const out = [];
  await Promise.all(entries.map(en => walk(en, '', out)));
  addFiles(out);
});
const hasFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
function walk(entry, prefix, out) {
  return new Promise(res => {
    if (entry.isFile) entry.file(f => { out.push({file: f, rel: prefix + f.name}); res(); }, () => res());
    else if (entry.isDirectory) {
      const reader = entry.createReader(), all = [];
      const read = () => reader.readEntries(async batch => {
        if (!batch.length) { await Promise.all(all.map(c => walk(c, prefix + entry.name + '/', out))); res(); }
        else { all.push(...batch); read(); }
      }, () => res());
      read();
    } else res();
  });
}

/* paste a file or text from the clipboard */
document.addEventListener('paste', e => {
  if (e.target.closest('textarea,input')) return;
  const files = [...(e.clipboardData.files || [])];
  if (files.length) { addFiles(files.map(f => ({file: f, rel: f.name || 'pasted.png'}))); return; }
  const text = e.clipboardData.getData('text');
  if (text && text.trim()) sendText(text);
});

/* ------------------------------------------------------------ sheets --- */
function openSheet(sheet, back) {
  sheet.hidden = back.hidden = false; sheet.classList.remove('closing'); back.classList.remove('closing');
}
function closeSheet(sheet, back) {
  sheet.classList.add('closing'); back.classList.add('closing');
  setTimeout(() => { sheet.hidden = back.hidden = true; }, 280);
}
const sheet = $('#sheet'), back = $('#sheetBack');
$('#sheetClose').onclick = back.onclick = () => closeSheet(sheet, back);
const tSheet = $('#textSheet'), tBack = $('#textBack');
$('#btnText').onclick = () => { openSheet(tSheet, tBack); setTimeout(() => $('#textIn').focus(), 60); };
$('#textClose').onclick = tBack.onclick = () => closeSheet(tSheet, tBack);
$('#textSend').onclick = async () => {
  const v = $('#textIn').value; if (!v.trim()) return;
  if (await sendText(v)) { $('#textIn').value = ''; closeSheet(tSheet, tBack); }
};
$('#textIn').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('#textSend').click(); });
async function sendText(text) {
  try { await api('/api/note', {json: {text}}); toast('Text sent', 'ok'); return true; }
  catch (e) { toast(e.message, 'bad'); return false; }
}
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!sheet.hidden) closeSheet(sheet, back);
  if (!tSheet.hidden) closeSheet(tSheet, tBack);
});
$('#openInbox').onclick = () => api('/api/pc/inbox', {method: 'POST'});
/* PC: clear the whole list (files stay where they are), with undo */
$('#clearItems').onclick = () => {
  const its = S.items.slice(); if (!its.length) return;
  const nodes = its.map(it => itemNodes.get(it.id)).filter(Boolean);
  nodes.forEach((n, i) => { n.style.animationDelay = Math.min(i, 10) * 30 + 'ms'; n.classList.add('leave'); });
  const hideT = setTimeout(() => nodes.forEach(n => n.hidden = true), 700);
  let undone = false;
  const go = setTimeout(() => { if (!undone) its.forEach(it => api('/api/item/' + it.id, {method: 'DELETE'}).catch(() => {})); }, 4600);
  toast(`Cleared ${its.length} item${its.length > 1 ? 's' : ''}. Files are untouched.`, '', {label: 'Undo', fn: () => {
    undone = true; clearTimeout(go); clearTimeout(hideT);
    nodes.forEach(n => { n.hidden = false; n.style.animationDelay = '0ms'; n.classList.remove('leave', 'enter'); void n.offsetWidth; n.classList.add('enter'); });
  }});
};

/* folder browser */
async function openFolder(it, sub) {
  openSheet(sheet, back);
  const listEl = $('#sheetList');
  listEl.innerHTML = '<div class="empty"><span class="spinner"></span></div>';
  const crumbs = $('#crumbs'); crumbs.innerHTML = '';
  const parts = sub ? sub.split('/') : [];
  const mk = (label, path) => { const b = el('button', '', esc(label)); b.onclick = () => openFolder(it, path); return b; };
  crumbs.append(mk(it.name, ''));
  parts.forEach((p, i) => { crumbs.append(el('span', 'sep', '/')); crumbs.append(mk(p, parts.slice(0, i + 1).join('/'))); });
  const base = it.id + (sub ? '/' + enc(sub) : '');
  $('#zipBtn').href = '/z/' + base;
  $('#zipBtn').onclick = () => toast('ZIP download started');
  try {
    const r = await api('/api/ls/' + base);
    listEl.innerHTML = '';
    if (!r.entries.length) listEl.innerHTML = '<div class="empty muted">Empty folder</div>';
    r.entries.forEach((en, i) => {
      const path = (sub ? sub + '/' : '') + en.name;
      const n = el('div', 'it enter' + (en.dir ? ' clickable' : ''));
      n.style.animationDelay = Math.min(i, 14) * 22 + 'ms';
      n.append(el('div', 'thumb' + (en.dir ? ' dir' : ''), kindIcon(en.name, en.dir)),
        el('div', 'meta', `<div class="name">${esc(en.name)}</div><div class="sub">${en.dir ? 'Folder' : fmtBytes(en.size)}</div>`));
      const acts = el('div', 'acts');
      if (en.dir) { acts.append(iconLink(IC.down, 'Download as ZIP', `/z/${it.id}/${enc(path)}`), iconBtn(IC.open, 'Open', () => openFolder(it, path))); n.onclick = () => openFolder(it, path); }
      else {
        if (previewable(en.name) || EXT.vid.test(en.name)) acts.append(iconLink(IC.eye, 'Open', `/f/${it.id}/${enc(path)}?inline=1`, true));
        acts.append(iconLink(IC.down, 'Download', `/f/${it.id}/${enc(path)}`));
      }
      n.append(acts); listEl.append(n);
    });
  } catch (e) { listEl.innerHTML = `<div class="empty muted">${esc(e.message)}</div>`; }
}

window.addEventListener('beforeunload', e => {
  if (queue.some(u => ['sending', 'queued', 'retry'].includes(u.status))) { e.preventDefault(); e.returnValue = ''; }
});

const Beam = window.Beam = {hooks: [], api, toast, copy, esc, ago, fmtBytes, el, isPC: false, state: () => S};
loop();
})();
