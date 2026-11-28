/* Lens PC - phone + PC gallery. Talks to app.py on 127.0.0.1:7796. */
"use strict";
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const inSuite = window.top !== window.self;
const CALM = matchMedia("(prefers-reduced-motion: reduce)").matches;
if (inSuite) document.body.classList.add("in-suite");

const S = {
  view: "photos", src: "all", kind: "", q: "", album: null, albumName: "", person: null, personName: "", like: null,
  items: [], search: false, sel: new Set(), last: null, boot: null, tile: +(localStorage.getItem("lens.tile") || 150), gen: 0,
};
document.documentElement.style.setProperty("--tile", S.tile + "px");

const ICON = {
  phone: '<svg viewBox="0 0 24 24"><rect x="7" y="2" width="10" height="20" rx="2.5"/><path d="M11 18h2"/></svg>',
  pc: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M12 3v12m0 0-5-5m5 5 5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>',
};

// ------------------------------------------------------------------ helpers
async function api(path, body) {
  const r = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Lens said ${r.status}`);
  return d;
}
function bumpText(el, text) {
  if (!el || el.textContent === text) return;
  const had = el.textContent;
  el.textContent = text;
  if (!had || CALM) return;
  el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump");
}
function toast(msg, bad) {
  const t = document.createElement("div");
  t.className = "qt-toast" + (bad ? " bad" : "");
  t.textContent = msg;
  $("#toasts").append(t);
  setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 350); }, 3600);
}
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function when(ms) {
  if (!ms) return "No date";
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" }) + ", " +
    d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
function ago(s) {
  if (!s) return "never";
  const m = Math.round((Date.now() / 1000 - s) / 60);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} days ago`;
}
function size(n) {
  if (!n) return "";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < 3) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
}
function dur(ms) {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// ------------------------------------------------------------------ loading
async function load() {
  const gen = ++S.gen;
  const p = new URLSearchParams({ src: S.src });
  if (S.kind) p.set("kind", S.kind);
  if (S.view === "saved") p.set("kind", "saved");
  if (S.album) p.set("album", S.album);
  if (S.person) p.set("person", S.person);
  if (S.q) p.set("q", S.q);
  if (S.like) p.set("like", S.like);
  $("#searchbox").classList.toggle("busy", !!S.q);
  try {
    const d = await api("/api/items?" + p);
    if (gen !== S.gen) return;
    S.items = d.items;
    S.search = d.search;
    renderGrid();
  } catch (e) {
    toast(e.message, true);
  } finally {
    if (gen === S.gen) $("#searchbox").classList.remove("busy");
  }
}

function show(which) {
  for (const id of ["grid", "people", "albums", "empty"]) $("#" + id).hidden = id !== which;
  if (which !== "grid") $("#rail").hidden = true;
}

function setCrumb() {
  const c = $("#crumb");
  let title = "", sub = "";
  if (S.person) { title = S.personName || "Someone"; sub = "from Lens on the phone"; }
  else if (S.album) { title = S.albumName; sub = S.album.startsWith("pc:") ? S.album.slice(3) : "album on the phone"; }
  else if (S.like) { title = "More like this"; sub = "photos that look alike"; }
  c.hidden = !title;
  $("#crumbTitle").textContent = title;
  $("#crumbSub").textContent = sub;
}

// ------------------------------------------------------------------ grid
let io = null, enterBudget = 0;
function renderGrid() {
  enterBudget = CALM ? 0 : 60;
  $("#rail").hidden = true;
  setCrumb();
  const g = $("#grid");
  g.textContent = "";
  if (io) io.disconnect();
  if (!S.items.length) return renderEmpty();
  show("grid");
  io = new IntersectionObserver(onBlocks, { root: $("#scroller"), rootMargin: "2000px 0px" });
  if (S.search) {
    const head = document.createElement("div");
    head.className = "results-head";
    const kw = S.items.filter(x => x.why && x.why !== "meaning").length;
    head.innerHTML = `<h3>${S.items.length.toLocaleString()} ${S.like ? "look-alikes" : "matches"}</h3><span class="qt-muted">` +
      (S.like ? "" : kw ? `${kw} by name, tag, text or person, the rest by what's in them` : "found by what's in them") + "</span>";
    g.append(head);
    addBlocks(g, S.items, 0);
    return;
  }
  // group by month
  let cur = null, start = 0;
  const flush = end => {
    if (cur === null) return;
    const sec = document.createElement("div");
    sec.className = "month";
    const d = new Date(S.items[start].t || 0);
    const n = end - start;
    sec.innerHTML = `<h4>${S.items[start].t ? MONTHS[d.getMonth()] + " " + d.getFullYear() : "No date"} <small>${n.toLocaleString()}</small>` +
      `<button data-selmonth="${start}:${end}">select</button></h4>`;
    g.append(sec);
    addBlocks(sec, S.items.slice(start, end), start);
  };
  S.items.forEach((x, i) => {
    const d = new Date(x.t || 0);
    const key = x.t ? d.getFullYear() * 12 + d.getMonth() : -1;
    if (key !== cur) { flush(i); cur = key; start = i; }
  });
  flush(S.items.length);
  buildRail();
}

// ------------------------------------------------------------------ month rail
function buildRail() {
  const rail = $("#rail");
  const months = $$("#grid .month");
  rail.textContent = "";
  rail.hidden = S.search || months.length < 3;
  if (rail.hidden) return;
  let year = null;
  months.forEach((m, i) => {
    const it = S.items[+m.querySelector("[data-selmonth]").dataset.selmonth.split(":")[0]];
    const y = it.t ? new Date(it.t).getFullYear() : "?";
    const b = document.createElement("button");
    b.dataset.m = i;
    b.title = m.querySelector("h4").firstChild.textContent.trim();
    if (y !== year) { b.className = "yr"; b.textContent = y; year = y; }
    rail.append(b);
  });
  syncRail();
}
function syncRail() {
  const rail = $("#rail");
  if (rail.hidden) return;
  const top = $("#scroller").getBoundingClientRect().top + 40;
  let cur = 0;
  $$("#grid .month").forEach((m, i) => { if (m.getBoundingClientRect().top <= top) cur = i; });
  rail.querySelectorAll("button").forEach(b => b.classList.toggle("on", +b.dataset.m === cur));
}
$("#rail").addEventListener("click", e => {
  const b = e.target.closest("button");
  if (!b) return;
  const m = $$("#grid .month")[+b.dataset.m];
  if (m) $("#scroller").scrollTo({ top: m.offsetTop - 4, behavior: "smooth" });
});
let railRaf = 0;
$("#scroller").addEventListener("scroll", () => { cancelAnimationFrame(railRaf); railRaf = requestAnimationFrame(syncRail); }, { passive: true });

const CHUNK = 180;
function addBlocks(parent, list, offset) {
  for (let i = 0; i < list.length; i += CHUNK) {
    const b = document.createElement("div");
    b.className = "tiles";
    b.dataset.from = offset + i;
    b.dataset.to = offset + Math.min(list.length, i + CHUNK);
    b.style.minHeight = estimate(Math.min(CHUNK, list.length - i)) + "px";
    parent.append(b);
    io.observe(b);
  }
}
function estimate(n) {
  const w = $("#scroller").clientWidth - 36 || 1000;
  const cols = Math.max(1, Math.floor((w + 6) / (S.tile + 6)));
  const cell = (w - (cols - 1) * 6) / cols;
  return Math.ceil(n / cols) * (cell + 6);
}
function onBlocks(entries) {
  for (const e of entries) {
    const b = e.target;
    if (e.isIntersecting && !b.dataset.filled) {
      const from = +b.dataset.from, to = +b.dataset.to;
      const frag = document.createDocumentFragment();
      for (let i = from; i < to; i++) {
        const t = tile(S.items[i], i);
        if (enterBudget > 0) {
          t.classList.add("in");
          t.style.setProperty("--d", (60 - enterBudget) * 14 + "ms");
          t.style.setProperty("--r", ((i * 37) % 7 - 3) + "deg");
          t.addEventListener("animationend", () => t.classList.remove("in"), { once: true });
          enterBudget--;
        }
        frag.append(t);
      }
      b.append(frag);
      b.dataset.filled = "1";
      b.style.minHeight = "";
    } else if (!e.isIntersecting && b.dataset.filled && b.childElementCount > 0) {
      b.style.minHeight = b.offsetHeight + "px";
      b.textContent = "";
      delete b.dataset.filled;
    }
  }
}
function tile(x, i) {
  const t = document.createElement("div");
  t.className = "tile" + (S.sel.has(x.k) ? " sel" : "");
  t.dataset.i = i;
  t.dataset.k = x.k;
  const img = new Image();
  img.loading = "lazy";
  img.decoding = "async";
  img.alt = "";
  img.onload = () => img.classList.add("ok");
  img.src = "/api/thumb/" + x.k;
  t.append(img);
  let tl = `<span class="pill src-${x.src}" title="${x.src === "pc" ? "On this PC" : "On the phone"}">${ICON[x.src]}</span>`;
  if (x.saved) tl += `<span class="pill saved" title="Original pulled to this PC">${ICON.check}</span>`;
  if (x.want) tl += `<span class="pill want" title="Waiting for the phone">${ICON.down}</span>`;
  if (x.why && x.why !== "meaning") tl += `<span class="pill why" title="Matched by ${x.why}">${x.why}</span>`;
  t.insertAdjacentHTML("beforeend", `<span class="b tl">${tl}</span><span class="pick" title="Select"></span>` +
    (x.v ? `<span class="b br"><span class="pill">${ICON.play}</span></span>` : ""));
  return t;
}

$("#grid").addEventListener("click", e => {
  const m = e.target.closest("[data-selmonth]");
  if (m) {
    const [a, b] = m.dataset.selmonth.split(":").map(Number);
    const all = S.items.slice(a, b).every(x => S.sel.has(x.k));
    S.items.slice(a, b).forEach(x => all ? S.sel.delete(x.k) : S.sel.add(x.k));
    syncSel();
    return;
  }
  const t = e.target.closest(".tile");
  if (!t) return;
  const i = +t.dataset.i;
  if (e.target.closest(".pick") || e.ctrlKey || e.metaKey || e.shiftKey || S.sel.size) {
    if (e.shiftKey && S.last !== null) {
      const [a, b] = [Math.min(S.last, i), Math.max(S.last, i)];
      for (let j = a; j <= b; j++) S.sel.add(S.items[j].k);
    } else {
      S.sel.has(t.dataset.k) ? S.sel.delete(t.dataset.k) : S.sel.add(t.dataset.k);
    }
    S.last = i;
    syncSel();
    return;
  }
  openViewer(i);
});

function syncSel() {
  for (const t of $$(".tile")) t.classList.toggle("sel", S.sel.has(t.dataset.k));
  const n = S.sel.size;
  const bar = $("#selbar");
  if (n) { bar.classList.remove("out"); bar.hidden = false; }
  else if (!bar.hidden && !CALM) { bar.classList.add("out"); setTimeout(() => { if (!S.sel.size) { bar.hidden = true; bar.classList.remove("out"); } }, 210); }
  else bar.hidden = true;
  $("#main").classList.toggle("selecting", n > 0);
  $("#grid").classList.toggle("selecting", n > 0);
  bumpText($("#selN"), `${n.toLocaleString()} selected`);
  const keys = [...S.sel];
  $("#sPull").hidden = !keys.some(k => k[0] === "p");
  $("#sSend").hidden = !keys.some(k => k[0] === "c");
}
$("#sClear").onclick = () => { S.sel.clear(); syncSel(); };
$("#sAll").onclick = () => { S.items.forEach(x => S.sel.add(x.k)); syncSel(); };
$("#sPull").onclick = () => pull([...S.sel]);
$("#sSend").onclick = () => send([...S.sel]);

async function pull(keys) {
  keys = keys.filter(k => k[0] === "p");
  try {
    const d = await api("/api/pull", { keys });
    if (!d.asked) return toast("Those are already on this PC.");
    toast(`Asked the phone for ${d.asked} original${d.asked > 1 ? "s" : ""}. They land in Pictures › From phone.`);
    keys.forEach(k => { const x = S.items.find(i => i.k === k); if (x && !x.saved) x.want = 1; });
    refreshTiles(keys);
    S.sel.clear(); syncSel();
    poke();
  } catch (e) { toast(e.message, true); }
}
async function send(keys) {
  keys = keys.filter(k => k[0] === "c");
  try {
    const d = await api("/api/send", { keys });
    toast(`${d.sent || keys.length} on the way to the phone (Pictures › From PC).`);
    S.sel.clear(); syncSel();
    poke();
  } catch (e) { toast(e.message, true); }
}
function refreshTiles(keys) {
  for (const k of keys) {
    const t = document.querySelector(`.tile[data-k="${k}"]`);
    if (t) t.replaceWith(tile(S.items[+t.dataset.i], +t.dataset.i));
  }
}

// ------------------------------------------------------------------ people & albums
async function renderPeople() {
  setCrumb();
  const d = await api("/api/people");
  const box = $("#people");
  box.textContent = "";
  if (!d.people.length) return renderEmpty("people");
  show("people");
  box.className = "people";
  for (const [n, p] of d.people.entries()) {
    const b = document.createElement("button");
    b.className = "person";
    b.style.setProperty("--d", Math.min(n, 30) * 22 + "ms");
    b.innerHTML = `<span class="face" style="background-image:url('/api/face/${p.id}')"></span><b>${esc(p.name || "Add a name in Lens")}</b><small>${p.count.toLocaleString()} photos</small>`;
    b.onclick = () => { S.person = p.id; S.personName = p.name; go("photos", true); };
    box.append(b);
  }
}
async function renderAlbums() {
  setCrumb();
  const d = await api("/api/albums");
  const box = $("#albums");
  box.textContent = "";
  const list = d.albums.filter(a => S.src === "all" || a.src === S.src);
  if (!list.length) return renderEmpty();
  show("albums");
  box.className = "albums";
  for (const [n, a] of list.entries()) {
    const b = document.createElement("button");
    b.className = "album";
    b.style.setProperty("--d", Math.min(n, 24) * 25 + "ms");
    b.innerHTML = `<span class="cov" style="background-image:url('/api/thumb/${a.cover}')"><span class="pill ${a.src}">${a.src === "pc" ? "PC" : "Phone"}</span></span>` +
      `<b>${esc(a.name)}</b><small>${a.count.toLocaleString()} item${a.count === 1 ? "" : "s"}</small>`;
    b.onclick = () => { S.album = a.id; S.albumName = a.name; go("photos", true); };
    box.append(b);
  }
}

function renderEmpty(what) {
  show("empty");
  const b = S.boot || { counts: {}, phone: {} };
  const box = $("#empty");
  const lens = `<div class="big"><svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="11" stroke-width="3.5"/><circle cx="16" cy="16" r="5" fill="currentColor" stroke="none"/></svg></div>`;
  if (S.q || S.like) {
    box.innerHTML = `${lens}<h2>Nothing like that</h2><p class="qt-muted">Try other words. Word search needs the phone's Lens index for phone photos, and finds PC photos once they've been looked through.</p>`;
  } else if (what === "people") {
    box.innerHTML = `${lens}<h2>No people yet</h2><p class="qt-muted">People come from Lens on the phone. They show up here after the Beam app sends the Lens index (Downloads › Lens-backup.db). In Lens, Settings › Back up now makes a fresh one.</p>`;
  } else if (S.view === "saved") {
    box.innerHTML = `${lens}<h2>Nothing pulled yet</h2><p class="qt-muted">Select phone photos and press <b>Pull to PC</b>. The full originals land in <code>${esc(b.phone.originals_dir || "Pictures\\From phone")}</code>.</p>`;
  } else if (S.src === "phone" || (!b.counts.phone && !b.counts.pc)) {
    box.innerHTML = `${lens}<h2>Bring your phone in</h2><p class="qt-muted">Lens on the phone stays offline. The Beam app carries your library over Wi-Fi or Tailscale.</p>
      <div class="steps"><div class="qt-card">Update the Beam app on the phone (1.3.0 or newer).</div>
      <div class="qt-card">In Beam on the phone, open the <b>Lens link</b> card and press <b>Start</b>. Allow photos and videos.</div>
      <div class="qt-card">Press <b>Link Lens index</b> and pick <code>Download › Lens-backup.db</code>, so people, tags and word search come too.</div></div>
      <button class="qt-btn primary" onclick="api('/api/beam',{}).then(()=>toast('Beam is running.')).catch(e=>toast(e.message,true))">Make sure Beam is on</button>`;
  } else {
    box.innerHTML = `${lens}<h2>No photos here</h2><p class="qt-muted">Add a PC folder, or change the filters.</p>`;
  }
}

// ------------------------------------------------------------------ viewer
const V = { i: -1, timer: null, dir: 0, z: 1, x: 0, y: 0 };
function tileRect(k) {
  const t = document.querySelector(`.tile[data-k="${k}"]`);
  if (!t) return null;
  const r = t.getBoundingClientRect();
  const s = $("#scroller").getBoundingClientRect();
  return r.bottom < s.top || r.top > s.bottom ? null : r;
}
function fly(el, from, reverse) {
  if (CALM || !el || !from || !el.animate) return null;
  const to = el.getBoundingClientRect();
  if (!to.width || !to.height) return null;
  const dx = from.left + from.width / 2 - (to.left + to.width / 2), dy = from.top + from.height / 2 - (to.top + to.height / 2);
  const sc = Math.max(from.width / to.width, from.height / to.height);
  const at = `translate(${dx}px, ${dy}px) scale(${sc})`;
  const frames = [{ transform: at, borderRadius: "40px", opacity: .6 }, { transform: "none", borderRadius: "10px", opacity: 1 }];
  return el.animate(reverse ? frames.reverse() : frames,
    { duration: reverse ? 240 : 420, easing: reverse ? "cubic-bezier(.4,0,.6,1)" : "cubic-bezier(.34,1.45,.5,1)", fill: "both" });
}
async function openViewer(i) {
  V.i = i;
  const from = tileRect(S.items[i].k);
  $("#viewer").classList.remove("out");
  $("#viewer").hidden = false;
  const p = paintViewer();
  const el = $("#vMedia").firstElementChild;
  if (el && from) {
    if (el.tagName === "IMG" && !el.complete) await Promise.race([new Promise(r => el.addEventListener("load", r, { once: true })), new Promise(r => setTimeout(r, 160))]);
    if (fly(el, from)) el.style.animation = "none";
  }
  await p;
}
function closeViewer() {
  const x = S.items[V.i];
  const el = $("#vMedia").firstElementChild;
  clearInterval(V.timer);
  V.i = -1;
  const done = () => { $("#viewer").hidden = true; $("#viewer").classList.remove("out"); $("#vMedia").textContent = ""; };
  if (CALM) return done();
  if (el && x) zoomReset(el.tagName === "IMG" ? el : null);
  const a = x && V.z === 1 ? fly(el, tileRect(x.k), true) : null;
  $("#viewer").classList.add("out");
  if (a) a.onfinish = done; else setTimeout(done, 190);
}
async function paintViewer() {
  clearInterval(V.timer);
  const x = S.items[V.i];
  if (!x) return closeViewer();
  $("#vPrev").hidden = V.i <= 0;
  $("#vNext").hidden = V.i >= S.items.length - 1;
  const media = $("#vMedia");
  media.textContent = "";
  $("#vWait").hidden = true;
  const onPc = x.src === "pc" || x.saved;
  if (x.v && onPc) {
    const v = document.createElement("video");
    v.src = "/api/full/" + x.k;
    v.controls = true;
    v.autoplay = true;
    v.poster = "/api/thumb/" + x.k;
    media.append(v);
  } else {
    const img = new Image();
    img.src = "/api/thumb/" + x.k;
    img.className = "soft";
    img.draggable = false;
    media.append(img);
    zoomReset(img);
    if (onPc) {
      const full = new Image();
      full.onload = () => { if (S.items[V.i] === x) { img.src = full.src; img.classList.remove("soft"); } };
      full.src = "/api/full/" + x.k;
    }
  }
  $("#vSrc").textContent = x.src === "pc" ? "On this PC" : x.saved ? "Phone · original on PC" : "On the phone";
  const m0 = media.firstElementChild;
  if (m0 && V.dir) m0.classList.add(V.dir > 0 ? "from-r" : "from-l");
  V.dir = 0;
  preload(V.i + 1); preload(V.i - 1);
  let info = {};
  try { info = await api("/api/info/" + x.k); } catch (e) { /* keep going */ }
  if (S.items[V.i] !== x) return;
  $("#vName").textContent = info.n || "";
  $("#vWhen").textContent = when(x.t);
  const acts = [];
  if (x.src === "phone" && !x.saved) acts.push(`<button class="qt-btn primary" data-act="pull">${ICON.down}Pull original</button>`);
  if (x.src === "pc") acts.push(`<button class="qt-btn primary" data-act="send">${ICON.phone}Send to phone</button>`);
  if (onPc) acts.push(`<button class="qt-btn" data-act="reveal">Show in folder</button><button class="qt-btn" data-act="open">Open</button>`);
  if (info.similar) acts.push(`<button class="qt-btn" data-act="like">More like this</button>`);
  $("#vActs").innerHTML = acts.join("");
  const meta = [];
  meta.push(`<div><dt>Album</dt><dd>${esc(x.src === "pc" ? info.folder : info.a)}</dd></div>`);
  const dims = x.w && x.h ? `${x.w} × ${x.h}` : "";
  meta.push(`<div><dt>${x.v ? "Video" : "Photo"}</dt><dd>${[dims, size(info.size), x.v && info.d ? dur(info.d) : ""].filter(Boolean).join(" · ")}</dd></div>`);
  if (info.people && info.people.length) meta.push(`<div><dt>People</dt><dd class="chips">${info.people.map(p => `<button data-person="${p.id}" data-name="${esc(p.name || "")}">${esc(p.name || "Unnamed")}</button>`).join("")}</dd></div>`);
  if (info.tags && info.tags.length) meta.push(`<div><dt>Lens tags</dt><dd class="chips">${info.tags.map(t => `<button data-q="${esc(t)}">${esc(t)}</button>`).join("")}</dd></div>`);
  if (info.text) meta.push(`<div><dt>Text in photo</dt><dd class="ocr">${esc(info.text)}</dd></div>`);
  if (info.path) meta.push(`<div><dt>On this PC</dt><dd>${esc(info.path)}</dd></div>`);
  else if (info.rel) meta.push(`<div><dt>On the phone</dt><dd>${esc(info.rel + (info.n || ""))}</dd></div>`);
  $("#vMeta").innerHTML = meta.join("");
  if (x.want && !x.saved) waitFor(x);
}
function waitFor(x) {
  const w = $("#vWait");
  w.hidden = false;
  w.innerHTML = `<i class="qt-dot warn"></i><span>Waiting for the phone to send the original. Open Beam on the phone if it takes long.</span>`;
  clearInterval(V.timer);
  V.timer = setInterval(async () => {
    if (S.items[V.i] !== x) return clearInterval(V.timer);
    try {
      const i = await api("/api/info/" + x.k);
      if (i.saved) { x.saved = 1; x.want = 0; clearInterval(V.timer); toast("Original is here."); refreshTiles([x.k]); paintViewer(); }
    } catch (e) { /* retry */ }
  }, 2000);
}
$("#vActs").addEventListener("click", async e => {
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const x = S.items[V.i];
  const act = b.dataset.act;
  try {
    if (act === "pull") { await pull([x.k]); x.want = 1; waitFor(x); }
    else if (act === "send") await send([x.k]);
    else if (act === "reveal") await api("/api/reveal", { keys: [x.k] });
    else if (act === "open") await api("/api/open", { keys: [x.k] });
    else if (act === "like") { closeViewer(); S.like = x.k; S.q = ""; $("#q").value = ""; go("photos", true); }
  } catch (err) { toast(err.message, true); }
});
$("#vMeta").addEventListener("click", e => {
  const p = e.target.closest("[data-person]");
  const q = e.target.closest("[data-q]");
  if (p) { closeViewer(); S.person = +p.dataset.person; S.personName = p.dataset.name; S.q = ""; $("#q").value = ""; go("photos", true); }
  if (q) { closeViewer(); $("#q").value = q.dataset.q; setQ(q.dataset.q); }
});
$("#vClose").onclick = closeViewer;
$("#vPrev").onclick = () => { if (V.i > 0) { V.i--; V.dir = -1; paintViewer(); } };
$("#vNext").onclick = () => { if (V.i < S.items.length - 1) { V.i++; V.dir = 1; paintViewer(); } };

// next and previous originals load in the background, so arrowing through feels instant
const PRE = new Map();
function preload(i) {
  const x = S.items[i];
  if (!x || x.v || !(x.src === "pc" || x.saved) || PRE.has(x.k)) return;
  const im = new Image();
  im.src = "/api/full/" + x.k;
  PRE.set(x.k, im);
  if (PRE.size > 12) PRE.delete(PRE.keys().next().value);
}

// zoom: wheel or double-click, drag to look around
function zoomApply(img) {
  img.style.transform = V.z === 1 ? "" : `translate(${V.x}px, ${V.y}px) scale(${V.z})`;
  img.classList.toggle("zoomed", V.z > 1);
  $("#vZoom").hidden = V.z === 1;
  $("#vZoom").textContent = Math.round(V.z * 100) + "%";
}
function zoomReset(img) { V.z = 1; V.x = 0; V.y = 0; if (img) zoomApply(img); }
function zoomTo(img, z, cx, cy) {
  const r = img.getBoundingClientRect();
  const ox = cx - (r.left + r.width / 2), oy = cy - (r.top + r.height / 2);
  const nz = Math.max(1, Math.min(6, z));
  const k = nz / V.z;
  V.x = nz === 1 ? 0 : V.x - ox * (k - 1);
  V.y = nz === 1 ? 0 : V.y - oy * (k - 1);
  V.z = nz;
  zoomApply(img);
}
$("#vMedia").addEventListener("wheel", e => {
  const img = $("#vMedia img");
  if (!img) return;
  e.preventDefault();
  zoomTo(img, V.z * (e.deltaY < 0 ? 1.2 : 1 / 1.2), e.clientX, e.clientY);
}, { passive: false });
$("#vMedia").addEventListener("dblclick", e => {
  const img = e.target.closest("img");
  if (img) zoomTo(img, V.z > 1 ? 1 : 2.5, e.clientX, e.clientY);
});
let drag = null;
$("#vMedia").addEventListener("pointerdown", e => {
  const img = e.target.closest("img");
  if (!img || V.z === 1) return;
  drag = { img, sx: e.clientX - V.x, sy: e.clientY - V.y, moved: false };
  img.setPointerCapture(e.pointerId);
});
$("#vMedia").addEventListener("pointermove", e => {
  if (!drag) return;
  V.x = e.clientX - drag.sx; V.y = e.clientY - drag.sy; drag.moved = true;
  drag.img.classList.add("dragging");
  zoomApply(drag.img);
});
$("#vMedia").addEventListener("pointerup", () => { if (drag) drag.img.classList.remove("dragging"); drag = null; });
$("#vStage").addEventListener("click", e => { if (V.z === 1 && (e.target === $("#vStage") || e.target === $("#vMedia"))) closeViewer(); });

// ------------------------------------------------------------------ navigation
function go(view, keepFilters) {
  S.view = view;
  if (!keepFilters) { S.album = null; S.person = null; S.like = null; }
  for (const b of $$("#views button")) b.classList.toggle("on", b.dataset.view === view && !S.album && !S.person);
  if (matchMedia("(max-width: 900px)").matches) {   // narrow strip: glide the picked view into sight
    const on = $("#views button.on");
    if (on) on.scrollIntoView({ inline: "center", block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }
  $("#scroller").scrollTop = 0;
  S.sel.clear(); syncSel();
  if (view === "people" && !S.q) return renderPeople().catch(e => toast(e.message, true));
  if (view === "albums" && !S.q) return renderAlbums().catch(e => toast(e.message, true));
  load();
}
$$("[data-view]").forEach(b => b.addEventListener("click", () => { S.q = ""; $("#q").value = ""; $("#qClear").hidden = true; go(b.dataset.view); }));
$("#crumbBack").onclick = () => {
  const from = S.person ? "people" : S.album ? "albums" : "photos";
  S.person = null; S.album = null; S.like = null;
  go(from);
};
$$(".srcs button").forEach(b => b.addEventListener("click", () => {
  S.src = b.dataset.src;
  $$(".srcs button").forEach(x => { x.classList.toggle("on", x === b); x.setAttribute("aria-checked", x === b); });
  go(S.view, true);
}));
$$(".kinds button").forEach(b => b.addEventListener("click", () => {
  S.kind = b.dataset.kind;
  $$(".kinds button").forEach(x => x.classList.toggle("on", x === b));
  if (S.view !== "photos" && S.view !== "saved") S.view = "photos";
  go(S.view, true);
}));

function slideSeg(group) {
  if (CALM) return;
  let th = group.querySelector(".seg-thumb");
  if (!th) { th = document.createElement("i"); th.className = "seg-thumb"; group.prepend(th); }
  const on = group.querySelector("button.on");
  if (!on || !on.offsetWidth) return;
  th.style.width = on.offsetWidth + "px";
  th.style.transform = `translateX(${on.offsetLeft}px)`;
  if (!group.classList.contains("slid")) group.classList.add("slid");
}
$$(".srcs, .kinds").forEach(g => {
  g.querySelectorAll("button").forEach(btn => new MutationObserver(() => slideSeg(g)).observe(btn, { attributes: true, attributeFilter: ["class"] }));
  requestAnimationFrame(() => slideSeg(g));
});
addEventListener("resize", () => $$(".srcs, .kinds").forEach(slideSeg));

let qTimer = null;
function setQ(v) {
  S.q = v.trim();
  remember(S.q);
  $("#qClear").hidden = !v;
  S.like = null;
  if (S.view === "people" || S.view === "albums") S.view = "photos";
  for (const b of $$("#views button")) b.classList.toggle("on", b.dataset.view === S.view && !S.q);
  $("#scroller").scrollTop = 0;
  load();
}
$("#q").addEventListener("input", e => { clearTimeout(qTimer); qTimer = setTimeout(() => setQ(e.target.value), 350); });
$("#q").addEventListener("keydown", e => {
  if (e.key === "Enter") { clearTimeout(qTimer); setQ(e.target.value); }
  if (e.key === "Escape") { e.target.value = ""; setQ(""); e.target.blur(); }
});
$("#qClear").onclick = () => { $("#q").value = ""; setQ(""); };

// ------------------------------------------------------------------ search suggestions
function recent() { try { return JSON.parse(localStorage.getItem("lens.recent") || "[]"); } catch (e) { return []; } }
function saveRecent(r) { try { localStorage.setItem("lens.recent", JSON.stringify(r)); } catch (e) { /* private mode */ } }
function remember(q) {
  if (!q || q.length < 2) return;
  saveRecent([q, ...recent().filter(x => x.toLowerCase() !== q.toLowerCase())].slice(0, 8));
}
let SUG = null;
async function openSuggest() {
  const box = $("#suggest");
  if ($("#q").value) { box.hidden = true; return; }
  if (!SUG) { try { SUG = await api("/api/suggest"); setTimeout(() => { SUG = null; }, 60000); } catch (e) { SUG = { people: [], tags: [] }; } }
  if ($("#q").value || document.activeElement !== $("#q")) return;
  const r = recent();
  const sec = (title, html) => html ? `<h6>${title}</h6><div class="chips">${html}</div>` : "";
  box.innerHTML =
    sec(`Recent <button class="clr" data-clear>clear</button>`, r.map(q => `<button data-sq="${esc(q)}">${esc(q)}</button>`).join("")) +
    sec("People", SUG.people.map(p => `<button data-sp="${p.id}" data-name="${esc(p.name)}"><i style="background-image:url('/api/face/${p.id}')"></i>${esc(p.name)}</button>`).join("")) +
    sec("Lens sees", SUG.tags.map(t => `<button data-sq="${esc(t)}">${esc(t)}</button>`).join("")) +
    `<p class="qt-muted">Or describe it: <i>red car at night</i>, <i>receipt</i>, <i>birthday cake</i></p>`;
  box.hidden = false;
}
$("#q").addEventListener("focus", openSuggest);
$("#q").addEventListener("input", () => { if ($("#q").value) $("#suggest").hidden = true; else openSuggest(); });
$("#q").addEventListener("blur", () => setTimeout(() => { $("#suggest").hidden = true; }, 160));
$("#suggest").addEventListener("mousedown", e => e.preventDefault());
$("#suggest").addEventListener("click", e => {
  const q = e.target.closest("[data-sq]"), p = e.target.closest("[data-sp]"), c = e.target.closest("[data-clear]");
  if (c) { saveRecent([]); openSuggest(); return; }
  $("#suggest").hidden = true;
  if (q) { $("#q").value = q.dataset.sq; setQ(q.dataset.sq); $("#q").blur(); }
  if (p) { $("#q").blur(); S.q = ""; S.person = +p.dataset.sp; S.personName = p.dataset.name; go("photos", true); }
});

function resize(d) {
  S.tile = Math.max(90, Math.min(320, S.tile + d));
  localStorage.setItem("lens.tile", S.tile);
  document.documentElement.style.setProperty("--tile", S.tile + "px");
}
$("#bSize").onclick = () => { resize(S.tile >= 240 ? -150 : 60); renderGrid(); };

addEventListener("keydown", e => {
  if (!$("#viewer").hidden) {
    if (e.key === "Escape") { if (V.z > 1) zoomReset($("#vMedia img")); else closeViewer(); }
    if (e.key === "0") zoomReset($("#vMedia img"));
    if (e.key === "ArrowLeft") $("#vPrev").click();
    if (e.key === "ArrowRight") $("#vNext").click();
    return;
  }
  if (!$("#drawer").hidden && e.key === "Escape") return closeDrawer();
  if ((e.ctrlKey && e.key.toLowerCase() === "f") || (e.key === "/" && document.activeElement.tagName !== "INPUT")) { e.preventDefault(); $("#q").focus(); $("#q").select(); }
  if (e.ctrlKey && (e.key === "=" || e.key === "+")) { e.preventDefault(); resize(30); renderGrid(); }
  if (e.ctrlKey && e.key === "-") { e.preventDefault(); resize(-30); renderGrid(); }
  if (e.key === "Escape" && S.sel.size) { S.sel.clear(); syncSel(); }
  if (e.ctrlKey && e.key.toLowerCase() === "a" && document.activeElement.tagName !== "INPUT") { e.preventDefault(); $("#sAll").click(); }
});

// ------------------------------------------------------------------ settings drawer
$("#bSettings").onclick = openDrawer;
$("#dClose").onclick = closeDrawer;
$("#drawer").addEventListener("click", e => { if (e.target === $("#drawer")) closeDrawer(); });
function openDrawer() { $("#drawer").hidden = false; paintDrawer(); }
function closeDrawer() {
  const d = $("#drawer");
  if (CALM) { d.hidden = true; return; }
  d.classList.add("out");
  setTimeout(() => { d.hidden = true; d.classList.remove("out"); }, 170);
}
function paintDrawer() {
  const b = S.boot;
  if (!b) return;
  $("#folders").innerHTML = b.pc.folders.map(f => `<div class="folder"><span>${esc(f)}</span><button data-rm="${esc(f)}" title="Stop looking here">×</button></div>`).join("") ||
    `<p class="qt-muted">No folders yet.</p>`;
  const ph = b.phone;
  $("#dPhone").innerHTML = ph.beam
    ? `<div><i class="qt-dot ${ph.last_sync ? "on" : "warn"}"></i> ${ph.device ? esc(ph.device) + " · " : ""}last sync ${ago(ph.last_sync)} · Lens index ${ph.index ? "from " + ago(ph.index_at) : "not sent yet"}</div>
       <div class="qt-muted">Originals you pull land in <code>${esc(ph.originals_dir)}</code>. Photos you send go to <b>Pictures › From PC</b> on the phone.</div>
       <ol class="qt-muted"><li>In the Beam app on the phone, open the <b>Lens link</b> card and press <b>Start</b>.</li>
       <li>Press <b>Link Lens index</b> once and pick <code>Download › Lens-backup.db</code>. Lens refreshes it weekly, or Settings › Back up now.</li>
       <li>Beam on the phone checks in about every 15 minutes, and right away while it's open.</li></ol>`
    : `<div><i class="qt-dot bad"></i> Beam isn't running on this PC.</div><button class="qt-btn primary" id="dBeam">Start Beam</button>`;
  const sb = $("#dBeam");
  if (sb) sb.onclick = () => api("/api/beam", {}).then(() => { toast("Beam is running."); poke(); }).catch(e => toast(e.message, true));
}
$("#folders").addEventListener("click", async e => {
  const b = e.target.closest("[data-rm]");
  if (!b) return;
  try { const d = await api("/api/folders", { remove: b.dataset.rm }); S.boot.pc.folders = d.folders; paintDrawer(); toast("Removed. Its photos leave Lens after the next look."); poke(); }
  catch (err) { toast(err.message, true); }
});
$("#dAdd").onclick = async () => {
  try {
    const d = await api("/api/folders", { pick: true });
    if (d.cancel) return;
    S.boot.pc.folders = d.folders; paintDrawer(); toast("Added. Lens is looking through it now."); poke();
  } catch (e) { toast(e.message, true); }
};
$("#dRescan").onclick = () => api("/api/rescan", {}).then(() => { toast("Looking again."); poke(); });

// ------------------------------------------------------------------ status
let lastSig = null, pokeTimer = null;
async function poll() {
  try {
    const b = await api("/api/boot");
    S.boot = b;
    const c = b.counts, ph = b.phone, prog = b.pc.progress;
    bumpText($("#nAll"), (c.phone + c.pc).toLocaleString());
    bumpText($("#nPeople"), c.people ? c.people.toLocaleString() : "");
    const dot = (el, cls, title, text) => {
      const d = el.querySelector(".qt-dot"), sp = el.querySelector("span");
      const changed = sp.textContent !== text && sp.textContent !== "…" && !sp.textContent.endsWith("…");
      d.className = "qt-dot " + cls + (changed && !CALM ? " flash" : "");
      el.querySelector("b").textContent = title; sp.textContent = text;
    };
    if (!ph.beam) dot($("#stPhone"), "bad", "Phone", "Beam is off on this PC");
    else if (ph.old) dot($("#stPhone"), "bad", "Phone", "Restart Beam on this PC to turn on the Lens link");
    else if (!ph.last_sync) dot($("#stPhone"), "warn", "Phone", c.phone ? `${c.phone.toLocaleString()} items, syncing…` : "Waiting for the Beam app");
    else dot($("#stPhone"), "on", ph.device || "Phone", `${c.phone.toLocaleString()} item${c.phone === 1 ? "" : "s"} · synced ${ago(ph.last_sync)}` + (ph.wants ? ` · ${ph.wants} waiting` : ""));
    const running = prog.running && prog.todo;
    dot($("#stPc"), running ? "warn" : b.pc.folders.length ? "on" : "", "PC folders",
      running ? `Looking through ${prog.done.toLocaleString()} of ${prog.todo.toLocaleString()}` : `${c.pc.toLocaleString()} item${c.pc === 1 ? "" : "s"} in ${b.pc.folders.length} folder${b.pc.folders.length === 1 ? "" : "s"}`);
    $("#pcBar").hidden = !running;
    if (running) $("#pcBar i").style.width = (100 * prog.done / prog.todo).toFixed(1) + "%";
    dot($("#stClip"), b.clip === "ready" ? "on" : b.clip === "loading" ? "warn" : "bad", "Word search",
      b.clip === "ready" ? (c.meanings ? `On · ${c.meanings.toLocaleString()} phone meanings` : "On · PC only until the Lens index arrives") : b.clip === "loading" ? "Loading the model…" : "Off: model missing");
    const sig = `${c.phone}|${c.pc}|${c.people}|${c.meanings}|${ph.wants}`;
    if (lastSig !== null && sig !== lastSig && $("#viewer").hidden && !S.sel.size) {
      if (S.view === "people" && !S.q) renderPeople(); else if (S.view === "albums" && !S.q) renderAlbums(); else { const top = $("#scroller").scrollTop; await load(); $("#scroller").scrollTop = top; }
    }
    if (lastSig === null && !c.phone && !c.pc && S.view === "photos") renderEmpty();
    lastSig = sig;
    if (!$("#drawer").hidden) paintDrawer();
  } catch (e) { /* server restarting */ }
}
function poke() { clearTimeout(pokeTimer); pokeTimer = setTimeout(poll, 600); }
setInterval(poll, 4000);
poll().then(() => load());
