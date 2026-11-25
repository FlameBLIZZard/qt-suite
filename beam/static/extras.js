/* Beam extras: tabs, clipboard sync, PC remote (trackpad, keyboard, media, brightness, power). */
(() => {
'use strict';
const B = window.Beam;
const $ = s => document.querySelector(s);
const {api, toast, esc, ago, el} = B;
const buzz = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch {} };

/* ------------------------------------------------------------ tabs --- */
const TABS = ['files', 'clip', 'remote'];
let tab = 'files';
function setTab(name, instant) {
  const prev = TABS.indexOf(tab), next = TABS.indexOf(name);
  tab = name;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.dataset.tab === name));
  document.querySelectorAll('.panel').forEach(p => {
    const on = p.dataset.panel === name;
    p.hidden = !on; p.classList.toggle('on', on);
    p.classList.remove('slide-l', 'slide-r');
    if (on && !instant && prev !== next) { void p.offsetWidth; p.classList.add(next > prev ? 'slide-l' : 'slide-r'); }
  });
  movePill();
  try { localStorage.setItem('beam.tab', name); } catch {}
  if (name === 'clip') { $('#clipBadge').hidden = true; seenClip = latestPcClipId; }
  if (name === 'remote') remoteOpen();
  if (history.replaceState) history.replaceState(null, '', '#' + name);
}
function movePill() {
  const on = document.querySelector('.tab.on'), pill = $('#tabPill');
  if (!on) return;
  pill.style.width = on.offsetWidth + 'px';
  pill.style.transform = `translateX(${on.offsetLeft}px)`;
}
document.querySelectorAll('.tab').forEach(t => t.onclick = () => setTab(t.dataset.tab));
window.addEventListener('resize', movePill);
let startTab = (location.hash || '').slice(1);
try { startTab = TABS.includes(startTab) ? startTab : (localStorage.getItem('beam.tab') || 'files'); } catch {}
if (!TABS.includes(startTab)) startTab = 'files';
requestAnimationFrame(() => setTab(startTab, true));
// links like .../#clip switch tabs without a reload; re-measure the pill once the web fonts arrive
window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (TABS.includes(h) && h !== tab) setTab(h); });
if (document.fonts && document.fonts.ready) document.fonts.ready.then(movePill);

/* swipe between tabs (not on the trackpad) */
let sx = null, sy = 0;
document.addEventListener('touchstart', e => {
  if (e.touches.length !== 1 || e.target.closest('.pad,input,textarea,.sheet,.keys,.power,.bright,.sens')) { sx = null; return; }
  sx = e.touches[0].clientX; sy = e.touches[0].clientY;
}, {passive: true});
document.addEventListener('touchend', e => {
  if (sx == null) return;
  const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; sx = null;
  if (Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy) * 2) {
    const i = TABS.indexOf(tab) + (dx < 0 ? 1 : -1);
    if (i >= 0 && i < TABS.length) setTab(TABS[i]);
  }
}, {passive: true});

/* ------------------------------------------------------------ clipboard --- */
let latestPcClipId = null, seenClip = null, firstClips = true;
const clipNodes = new Map();

function copyClip(c, btn) {
  if (c.text != null) {
    B.copy(c.text, 'Copied');
  } else if (c.img) {
    window.open('/clip/' + c.id + '.bmp', '_blank');
  }
  if (btn) { btn.classList.remove('copied'); void btn.offsetWidth; btn.classList.add('copied'); }
  buzz(10);
}
async function applyClip(c) {
  try { await api(`/api/clip/${c.id}/apply`, {method: 'POST'}); toast('On the PC clipboard', 'ok'); buzz(10); }
  catch (e) { toast(e.message, 'bad'); }
}

function renderClips(S) {
  const clips = S.clips || [];
  // settings
  const st = S.settings || {};
  $('#clipSync').checked = !!st.clip_sync;
  $('#remoteAllow').checked = !!st.remote;
  $('#clipSendHint').textContent = B.isPC ? 'Saved to the history so the phone can copy it'
    : st.clip_sync ? 'Then just Ctrl+V on the PC' : 'Clipboard sync is off on the PC';

  // latest from PC (hero)
  const pcClip = clips.find(c => c.from === 'PC');
  $('#clipLatestCard').hidden = !pcClip || B.isPC;
  if (pcClip && pcClip.id !== latestPcClipId) {
    const isNew = latestPcClipId !== null && !firstClips;
    latestPcClipId = pcClip.id;
    const hero = $('#clipLatest');
    hero.innerHTML = '';
    if (pcClip.img) hero.append(Object.assign(new Image(), {src: '/clip/' + pcClip.id + '.bmp', alt: 'Copied image'}));
    else hero.append(el('div', 'txt', esc(pcClip.text)));
    const row = el('div', 'row');
    const cb = el('button', 'btn primary', pcClip.img ? 'Open image' : 'Copy to phone');
    cb.onclick = () => copyClip(pcClip, cb);
    row.append(cb);
    if (pcClip.img) {
      const dl = el('a', 'btn', 'Save'); dl.href = '/clip/' + pcClip.id + '.bmp'; dl.download = 'clipboard.bmp'; row.append(dl);
    }
    hero.append(row);
    if (isNew) {
      hero.classList.remove('new'); void hero.offsetWidth; hero.classList.add('new');
      if (!B.isPC) {
        buzz([8, 40, 8]);
        if (tab !== 'clip') { $('#clipBadge').hidden = false; toast('PC copied something. Open Clipboard to grab it.'); }
      }
    }
  }
  if (pcClip) $('#clipLatestWhen').textContent = ago(pcClip.ts);
  if (tab === 'clip') seenClip = latestPcClipId;

  // history
  const list = $('#clips'), seen = new Set();
  clips.forEach((c, idx) => {
    seen.add(c.id);
    let n = clipNodes.get(c.id);
    if (!n) {
      n = el('div', 'it clip enter');
      const meta = el('div', 'meta');
      if (c.img) {
        meta.append(el('div', 'name', 'Image'));
        meta.append(Object.assign(new Image(), {src: '/clip/' + c.id + '.bmp', className: 'cimg', loading: 'lazy'}));
      } else {
        const t = el('div', 'txt', esc(c.text));
        t.onclick = () => n.classList.toggle('open');
        meta.append(t);
      }
      const fromPC = c.from === 'PC';
      const sub = el('div', 'sub', `<span class="tag ${fromPC ? 'pc' : 'ph'}">${fromPC ? 'PC' : esc(c.from)}</span>${c.img ? B.fmtBytes(c.img) + ' · ' : ''}<span class="when">${ago(c.ts)}</span>`);
      meta.append(sub);
      const acts = el('div', 'acts');
      const cbtn = btn(c.img ? IC.open : IC.copy, c.img ? 'Open' : 'Copy here', () => copyClip(c, cbtn));
      acts.append(cbtn);
      if (c.text != null) acts.append(btn(IC.toPc, 'Put on the PC clipboard', () => applyClip(c)));
      acts.append(btn(IC.x, 'Remove', () => { n.classList.add('leave'); api('/api/clip/' + c.id, {method: 'DELETE'}); }));
      n.append(meta, acts);
      clipNodes.set(c.id, n);
    } else {
      const w = n.querySelector('.when'); if (w) w.textContent = ago(c.ts);
    }
    if (list.children[idx] !== n) list.insertBefore(n, list.children[idx] || null);
  });
  for (const [id, n] of clipNodes) if (!seen.has(id)) { clipNodes.delete(id); n.classList.add('leave'); setTimeout(() => n.remove(), 360); }
  $('#clipsEmpty').hidden = clips.length > 0;
  firstClips = false;
}
const IC = {
  copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
  toPc: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4M9 10l3-3 3 3M12 7v6"/></svg>',
  open: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
};
function btn(svg, title, fn) {
  const b = el('button', 'icon-btn', svg); b.title = title; b.setAttribute('aria-label', title);
  b.onclick = e => { e.stopPropagation(); fn(); }; return b;
}

$('#clipSend').onclick = async () => {
  const v = $('#clipIn').value;
  if (!v.trim()) { toast('Paste something first'); $('#clipIn').focus(); return; }
  try {
    const r = await api('/api/clip', {json: {text: v}});
    $('#clipIn').value = '';
    toast(r.applied ? 'On the PC clipboard. Ctrl+V away.' : 'Saved to the history', 'ok'); buzz(12);
  } catch (e) { toast(e.message, 'bad'); }
};
$('#clipIn').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('#clipSend').click(); });
if (navigator.clipboard && navigator.clipboard.readText && window.isSecureContext) {
  $('#clipPaste').hidden = false;
  $('#clipPaste').onclick = async () => { try { $('#clipIn').value = await navigator.clipboard.readText(); } catch { toast('Clipboard blocked by the browser', 'bad'); } };
}
$('#clipClear').onclick = () => api('/api/clip', {method: 'DELETE'});
$('#clipSync').onchange = e => api('/api/pc/settings', {json: {clip_sync: e.target.checked}}).then(() => toast(e.target.checked ? 'Clipboard sync on' : 'Clipboard sync off'));
$('#remoteAllow').onchange = e => api('/api/pc/settings', {json: {remote: e.target.checked}}).then(() => toast(e.target.checked ? 'Phones can control this PC' : 'Remote control off'));

/* ------------------------------------------------------------ remote: connection --- */
let ws = null, wsOk = false, wsTries = 0, wsTimer = null, reqId = 0;
const pending = new Map();
function wsConnect() {
  if (B.isPC || (ws && ws.readyState <= 1)) return;
  const st = B.state().settings || {};
  if (st.remote === false) { wsStatus(false, 'Turned off on the PC'); return; }
  try { ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws/remote'); }
  catch { return wsRetry(); }
  ws.onopen = () => { wsOk = true; wsTries = 0; wsStatus(true, 'Connected'); };
  ws.onmessage = e => { try { const d = JSON.parse(e.data); const cb = pending.get(d.id); if (cb) { pending.delete(d.id); cb(d); } } catch {} };
  ws.onclose = () => { const was = wsOk; wsOk = false; wsStatus(false, was || wsTries ? 'Reconnecting…' : 'Connecting…'); wsRetry(); };
  ws.onerror = () => {};
}
function wsRetry() { clearTimeout(wsTimer); wsTimer = setTimeout(wsConnect, Math.min(6000, 400 * ++wsTries)); }
function wsStatus(on, text) { $('#wsDot').classList.toggle('on', on); $('#wsText').textContent = text; }
setInterval(() => { if (wsOk) send({a: 'p'}); }, 20000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && tab === 'remote') wsCheck(); });
/* After the phone sleeps the socket can look open but be dead: ping it, and reconnect at once if no answer. */
function wsCheck() {
  if (B.isPC) return;
  if (!wsOk || !ws || ws.readyState !== 1) { wsTries = 0; clearTimeout(wsTimer); return wsConnect(); }
  const id = ++reqId, t = setTimeout(() => {
    if (!pending.delete(id)) return;
    wsStatus(false, 'Reconnecting…'); wsOk = false;
    try { ws.onclose = null; ws.close(); } catch {}
    ws = null; wsTries = 0; wsConnect();
  }, 1800);
  pending.set(id, () => clearTimeout(t));
  try { ws.send(JSON.stringify({a: 'p', id})); } catch { clearTimeout(t); pending.delete(id); ws = null; wsConnect(); }
}

function send(d) {
  if (wsOk && ws.readyState === 1) { ws.send(JSON.stringify(d)); return true; }
  // no live connection: plain HTTP. Moves/scrolls are merged so only one is in flight.
  if (d.a === 'm' || d.a === 's') {
    const k = d.a; slow[k] = slow[k] ? {a: k, x: slow[k].x + (d.x || 0), y: slow[k].y + (d.y || 0)} : {a: k, x: d.x || 0, y: d.y || 0};
    pumpSlow(); return false;
  }
  api('/api/remote', {json: d}).catch(e => toast(e.message, 'bad'));
  return false;
}
const slow = {}; let slowBusy = false;
async function pumpSlow() {
  if (slowBusy) return;
  const k = slow.m ? 'm' : slow.s ? 's' : null; if (!k) return;
  const d = slow[k]; delete slow[k]; slowBusy = true;
  try { await api('/api/remote', {json: d}); } catch {}
  slowBusy = false; pumpSlow();
}
function ask(d) {
  return new Promise(res => {
    if (wsOk) { d.id = ++reqId; pending.set(d.id, res); ws.send(JSON.stringify(d)); setTimeout(() => { if (pending.delete(d.id)) res({}); }, 9000); }
    else api('/api/remote', {json: d}).then(res, e => res({error: e.message}));
  });
}

function remoteOpen() {
  if (B.isPC) return;
  wsCheck();
  if (!brightLoaded) {
    brightLoaded = true;
    ask({a: 'bright'}).then(r => {
      if (r.v == null) { $('#brightVal').textContent = 'n/a'; $('#bright').title = 'This screen does not report brightness'; }
      else { $('#bright').value = r.v; $('#brightVal').textContent = r.v + '%'; }
    });
  }
}

/* ------------------------------------------------------------ trackpad --- */
const pad = $('#pad');
let sens = 1.6;
try { sens = parseFloat(localStorage.getItem('beam.sens')) || 1.6; } catch {}
$('#sens').value = sens; $('#sensVal').textContent = sens.toFixed(1) + 'x';
$('#sens').oninput = e => { sens = +e.target.value; $('#sensVal').textContent = sens.toFixed(1) + 'x'; try { localStorage.setItem('beam.sens', sens); } catch {} };
$('#sensBtn').onclick = () => { $('#sensRow').hidden = !$('#sensRow').hidden; };

const pts = new Map();     // pointerId -> {x, y, sx, sy, t0, dot}
let accX = 0, accY = 0, accS = 0, accH = 0, raf = 0;
let maxPts = 0, moved = 0, gestureT0 = 0, lastTapEnd = 0, dragging = false, scrolling = false;
function flush() {
  raf = 0;
  const mx = Math.trunc(accX), my = Math.trunc(accY);
  if (mx || my) { send({a: 'm', x: mx, y: my}); accX -= mx; accY -= my; }
  const s = Math.trunc(accS), h = Math.trunc(accH);
  if (s || h) { send({a: 's', y: s, x: h}); accS -= s; accH -= h; }
}
const queue = () => { if (!raf) raf = requestAnimationFrame(flush); };

function fx(x, y, cls) {
  const r = pad.getBoundingClientRect();
  const f = el('div', 'tapfx ' + (cls || '')); f.style.left = (x - r.left) + 'px'; f.style.top = (y - r.top) + 'px';
  pad.append(f); setTimeout(() => f.remove(), 520);
}

pad.addEventListener('pointerdown', e => {
  e.preventDefault(); pad.setPointerCapture(e.pointerId);
  pad.classList.add('active', 'used');
  if (!pts.size) { maxPts = 0; moved = 0; gestureT0 = performance.now();
    // double-tap-and-hold = drag
    if (performance.now() - lastTapEnd < 260) { dragging = true; pad.classList.add('dragging'); send({a: 'b', b: 'left', s: 'down'}); buzz(15); }
  }
  const r = pad.getBoundingClientRect();
  const dot = el('div', 'touch'); dot.style.left = (e.clientX - r.left) + 'px'; dot.style.top = (e.clientY - r.top) + 'px'; pad.append(dot);
  pts.set(e.pointerId, {x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), dot});
  maxPts = Math.max(maxPts, pts.size);
});
pad.addEventListener('pointermove', e => {
  const p = pts.get(e.pointerId); if (!p) return;
  const r = pad.getBoundingClientRect();
  p.dot.style.left = (e.clientX - r.left) + 'px'; p.dot.style.top = (e.clientY - r.top) + 'px';
  const dx = e.clientX - p.x, dy = e.clientY - p.y, now = performance.now(), dt = Math.max(1, now - p.t);
  p.x = e.clientX; p.y = e.clientY; p.t = now;
  moved += Math.hypot(dx, dy);
  if (pts.size === 1) {
    const v = Math.hypot(dx, dy) / dt;              // px per ms
    const gain = sens * (1 + Math.min(2.5, v * 1.4)); // pointer acceleration
    accX += dx * gain; accY += dy * gain;
  } else if (pts.size === 2 && e.pointerId === [...pts.keys()][0]) {
    if (!scrolling) { scrolling = true; pad.classList.add('scrolling'); }
    accS += -dy * 4; accH += dx * 4;
  }
  queue();
});
function up(e) {
  const p = pts.get(e.pointerId); if (!p) return;
  p.dot.classList.add('gone'); setTimeout(() => p.dot.remove(), 260);
  pts.delete(e.pointerId);
  if (pts.size) return;
  pad.classList.remove('active', 'scrolling');
  const dur = performance.now() - gestureT0, tap = dur < 250 && moved < 14;
  if (dragging) { dragging = false; pad.classList.remove('dragging'); send({a: 'b', b: 'left', s: 'up'}); lastTapEnd = 0; }
  else if (tap && !scrolling) {
    const which = maxPts >= 3 ? 'middle' : maxPts === 2 ? 'right' : 'left';
    send({a: 'b', b: which, s: 'click'}); fx(e.clientX, e.clientY, which === 'left' ? '' : 'r'); buzz(8);
    lastTapEnd = which === 'left' ? performance.now() : 0;
  } else lastTapEnd = 0;
  scrolling = false;
}
pad.addEventListener('pointerup', up);
pad.addEventListener('pointercancel', up);
pad.addEventListener('contextmenu', e => e.preventDefault());
pad.addEventListener('wheel', e => { e.preventDefault(); accS += -e.deltaY; accH += e.deltaX; queue(); }, {passive: false});

/* physical mouse buttons below the pad: press = down, release = up (so they can drag too) */
document.querySelectorAll('.mbtn').forEach(b => {
  b.addEventListener('pointerdown', e => { e.preventDefault(); b.setPointerCapture(e.pointerId); b.classList.add('down'); send({a: 'b', b: b.dataset.btn, s: 'down'}); buzz(8); });
  const rel = () => { if (!b.classList.contains('down')) return; b.classList.remove('down'); send({a: 'b', b: b.dataset.btn, s: 'up'}); };
  b.addEventListener('pointerup', rel); b.addEventListener('pointercancel', rel);
  b.addEventListener('contextmenu', e => e.preventDefault());
});

/* ------------------------------------------------------------ keyboard --- */
const kb = $('#kbIn');
let kbPrev = '';
kb.addEventListener('input', () => {
  const v = kb.value;
  let i = 0; while (i < v.length && i < kbPrev.length && v[i] === kbPrev[i]) i++;
  const del = kbPrev.length - i, add = v.slice(i);
  for (let k = 0; k < del; k++) send({a: 'k', k: 'backspace'});
  if (add) send({a: 't', t: add});
  kbPrev = v;
  if (v.length > 300) { kb.value = kbPrev = ''; }
});
kb.addEventListener('keydown', e => {
  const map = {Enter: 'enter', Backspace: 'backspace', Tab: 'tab', Escape: 'esc', ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down'};
  if (e.key === 'Enter') { e.preventDefault(); send({a: 'k', k: 'enter'}); kb.value = kbPrev = ''; return; }
  // backspace on an empty box still deletes on the PC
  if (e.key === 'Backspace' && !kb.value) { e.preventDefault(); send({a: 'k', k: 'backspace'}); return; }
  if (map[e.key] && e.key !== 'Backspace' && !kb.value) { e.preventDefault(); send({a: 'k', k: map[e.key]}); }
});
function hit(b) { b.classList.remove('hit'); void b.offsetWidth; b.classList.add('hit'); setTimeout(() => b.classList.remove('hit'), 180); }
document.querySelectorAll('.keys button').forEach(b => b.onclick = () => {
  send({a: 'k', k: b.dataset.k, mods: b.dataset.mods ? b.dataset.mods.split(',') : []}); hit(b); buzz(8);
});

/* ------------------------------------------------------------ media + volume --- */
document.querySelectorAll('.round[data-k]').forEach(b => {
  let rep = null, delay = null;
  const fire = () => { send({a: 'k', k: b.dataset.k}); hit(b); buzz(8); };
  b.addEventListener('pointerdown', e => {
    e.preventDefault(); fire();
    if ('repeat' in b.dataset) delay = setTimeout(() => { rep = setInterval(fire, 110); }, 380);
  });
  const stop = () => { clearTimeout(delay); clearInterval(rep); rep = delay = null; };
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(t => b.addEventListener(t, stop));
  b.addEventListener('contextmenu', e => e.preventDefault());
});

/* brightness: live while dragging, throttled */
let brightLoaded = false, brightT = 0, brightPending = null;
$('#bright').addEventListener('input', e => {
  const v = +e.target.value; $('#brightVal').textContent = v + '%';
  brightPending = v;
  if (!brightT) brightT = setTimeout(async function go() {
    const val = brightPending; brightPending = null;
    const r = await ask({a: 'bright', v: val});
    if (r.ok === false) toast('This monitor does not allow brightness control (turn on DDC/CI in its menu)', 'bad');
    brightT = brightPending != null ? setTimeout(go, 120) : 0;
  }, 120);
});

/* ------------------------------------------------------------ power --- */
let cancelTimer = null;
document.querySelectorAll('.pw').forEach(b => {
  const hold = 'hold' in b.dataset;
  let t = null;
  const fire = async () => {
    b.classList.remove('holding'); b.classList.add('fired'); setTimeout(() => b.classList.remove('fired'), 500);
    buzz([20, 60, 20]);
    const r = await ask({a: 'power', w: b.dataset.w});
    if (r.error || r.ok === false) { toast(r.error || 'The PC refused', 'bad'); return; }
    const w = b.dataset.w;
    if (w === 'shutdown' || w === 'restart') showCancel(w);
    else toast({lock: 'PC locked', sleep: 'PC going to sleep', monitor_off: 'Screen off'}[w], 'ok');
  };
  b.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (!hold) return;
    b.setPointerCapture(e.pointerId);
    b.classList.add('holding'); buzz(6);
    t = setTimeout(() => { t = null; fire(); }, 1000);
  });
  const cancel = () => { if (t) { clearTimeout(t); t = null; b.classList.remove('holding'); toast('Hold to confirm'); } };
  b.addEventListener('pointerup', () => { if (!hold) fire(); else cancel(); });
  b.addEventListener('pointercancel', cancel);
  b.addEventListener('contextmenu', e => e.preventDefault());
});
function showCancel(w) {
  let left = 30;
  const box = $('#pwCancel'); box.hidden = false;
  const tick = () => { $('#pwCancelText').innerHTML = `${w === 'shutdown' ? 'Shutting down' : 'Restarting'} in <span class="num">${left}</span>s`; };
  tick(); clearInterval(cancelTimer);
  cancelTimer = setInterval(() => { left--; if (left <= 0) { clearInterval(cancelTimer); box.hidden = true; } else tick(); }, 1000);
}
$('#pwCancelBtn').onclick = async () => {
  const r = await ask({a: 'power', w: 'cancel'});
  clearInterval(cancelTimer); $('#pwCancel').hidden = true;
  toast(r.ok === false ? 'Too late to cancel' : 'Cancelled', r.ok === false ? 'bad' : 'ok');
};

/* ------------------------------------------------------------ state hook --- */
let setupDone = false;
B.hooks.push((S) => {
  B.isPC = !!S.local;
  if (!setupDone) {
    setupDone = true;
    if (B.isPC) {
      $('#clipSyncRow').hidden = false;
      $('#remoteInfo').hidden = false;
      document.querySelectorAll('.pad-card,.kb-card,.media-card,.power-card').forEach(c => c.remove());
      $('#clipSendTitle').textContent = 'Send to the phone';
      $('#clipIn').placeholder = 'Type or paste text for the phone…';
      $('#clipSend').lastChild.textContent = 'Send';
    } else if (tab === 'remote') remoteOpen();
  }
  renderClips(S);
  if (B.isPC) {
    const r = S.remotes || [];
    $('#remotePeers').textContent = r.length ? 'Connected now: ' + r.join(', ') : 'No phone is using the remote right now.';
  } else if ((S.settings || {}).remote === false && ws) { ws.close(); }
  movePill();
});
})();
