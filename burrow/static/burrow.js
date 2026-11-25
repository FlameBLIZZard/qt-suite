"use strict";
/* Burrow - QT Suite file explorer (front end). Talks to app.py on the same origin. */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const HOME = "home:";

/* ---------------------------------------------------------------- kinds --- */
const KIND = {
  image: { c: "var(--k-image)", label: "Images", ext: "jpg jpeg png gif webp bmp ico tif tiff avif heic jfif svg psd raw cr2 nef" },
  video: { c: "var(--k-video)", label: "Videos", ext: "mp4 mkv webm mov avi m4v wmv flv 3gp" },
  audio: { c: "var(--k-audio)", label: "Audio", ext: "mp3 wav flac m4a aac ogg opus wma" },
  doc: { c: "var(--k-doc)", label: "Docs", ext: "pdf doc docx xls xlsx ppt pptx txt md odt csv rtf epub" },
  code: { c: "var(--k-code)", label: "Code", ext: "py js ts tsx jsx html css json java kt c cpp h cs go rs bat ps1 sh xml yml yaml toml ini gradle lua gd pxl inkm" },
  archive: { c: "var(--k-archive)", label: "Archives", ext: "zip rar 7z tar gz bz2 xz iso apk" },
  app: { c: "var(--k-app)", label: "Apps", ext: "exe msi lnk url appx msix" },
};
const EXT2KIND = {};
for (const [k, v] of Object.entries(KIND)) v.ext.split(" ").forEach(e => (EXT2KIND[e] = k));
const extOf = n => { const i = n.lastIndexOf("."); return i > 0 ? n.slice(i + 1).toLowerCase() : ""; };
const kindOf = e => e.d ? "folder" : (EXT2KIND[extOf(e.n)] || "other");
const TEXTY = new Set("txt md log csv tsv json py js ts tsx jsx html htm css xml yml yaml toml ini cfg conf bat cmd ps1 sh java kt kts c cpp h hpp cs go rs lua gd gradle properties env gitignore pxl inkm srt vtt sql php rb swift dart vue svelte".split(" "));
const THUMBABLE = new Set("jpg jpeg png gif webp bmp ico tif tiff avif jfif heic".split(" "));
const PLAYABLE_V = new Set("mp4 webm mov m4v mkv".split(" "));
const PLAYABLE_A = new Set("mp3 wav flac m4a aac ogg opus".split(" "));
const TYPE_NAME = { folder: "Folder", image: "Image", video: "Video", audio: "Audio", doc: "Document", code: "Code", archive: "Archive", app: "App", other: "File" };

/* ---------------------------------------------------------------- icons --- */
const I = {
  home: '<path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z"/>',
  desktop: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  downloads: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  documents: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>',
  pictures: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 8"/>',
  videos: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  volt: '<path d="M13 2 5 14h6l-1 8 8-12h-6z"/>',
  beam: '<path d="M4 12h12M12 6l6 6-6 6"/><path d="M20 5v14"/>',
  qt: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  drive: '<rect x="3" y="13" width="18" height="7" rx="2"/><path d="M5 13 7 5h10l2 8M7 16.5h.01"/>',
  usb: '<path d="M8 3h8v6H8zM6 9h12v9a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3z"/>',
  pin: '<path d="M9 4h6l-1 6 4 3v2H6v-2l4-3zM12 15v6"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  open: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  tab: '<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 9h18M8 5v4"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  cut: '<circle cx="6" cy="18" r="3"/><circle cx="18" cy="18" r="3"/><path d="M8 16 19 4M16 16 5 4"/>',
  paste: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 11h6M9 15h4"/>',
  rename: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13 7 4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  zip: '<path d="M7 3h10v18H7z"/><path d="M12 3v2M12 7v2M12 11v2M10 15h4v3h-4z"/>',
  link: '<path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1"/>',
  explorer: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="m14 12 3 2-3 2"/>',
  term: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M13 15h4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
  phone: '<rect x="7" y="2" width="10" height="20" rx="2.5"/><path d="M11 18h2"/>',
  lens: '<circle cx="12" cy="12" r="4"/><path d="M3 9V5a2 2 0 0 1 2-2h4M15 3h4a2 2 0 0 1 2 2v4M21 15v4a2 2 0 0 1-2 2h-4M9 21H5a2 2 0 0 1-2-2v-4"/>',
  pixlab: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h3v3h-3zM17 17h3v3h-3z"/>',
  inkmotion: '<path d="M3 17c3-6 6 2 9-4s6-6 9-2"/><circle cx="19" cy="7" r="2"/>',
  code: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13 5l-2 14"/>',
  with: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/><path d="M15 4h5v5M9 20H4v-5"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  list: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  file: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>',
  props: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  side: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  hidden: '<path d="M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c6 0 10 6 10 6a17 17 0 0 1-3.2 3.8M6.6 6.6A17 17 0 0 0 2 12s4 7 10 7a9.8 9.8 0 0 0 5.4-1.6"/>',
  sel: '<path d="M4 7h16M4 12h10M4 17h7M16 15l2 2 4-4"/>',
};
const svg = (k, cls = "") => `<svg viewBox="0 0 24 24" class="${cls}">${I[k] || I.file}</svg>`;
const PLACE_COLOR = { home: "var(--qt-burrow)", desktop: "var(--k-doc)", downloads: "var(--qt-ok)", documents: "var(--k-doc)", pictures: "var(--k-image)",
  videos: "var(--k-video)", music: "var(--k-audio)", volt: "var(--qt-volt)", beam: "var(--qt-beam)", qt: "var(--qt-inkmotion)" };
const FOLDER_SVG = '<svg class="fo" viewBox="0 0 26 22"><path d="M2 4a2 2 0 0 1 2-2h6l2.5 2.5H22a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z"/><path class="lid" d="M2 8h22v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z"/></svg>';
function fileIcon(e) {
  const k = kindOf(e);
  if (k === "folder") return `<span class="ic">${FOLDER_SVG}${e.l ? '<i class="ln"></i>' : ""}</span>`;
  const x = extOf(e.n).slice(0, 4) || "file";
  return `<span class="ic"><span class="badge" style="--c:${(KIND[k] || {}).c || "var(--k-other)"}"><b>${esc(x)}</b></span>${e.l ? '<i class="ln"></i>' : ""}</span>`;
}

/* ---------------------------------------------------------------- utils --- */
const SEP = "\\";
const join = (d, n) => d.endsWith("\\") || d.endsWith("/") ? d + n : d + SEP + n;
const baseName = p => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p;
const dirName = p => { const t = p.replace(/[\\/]+$/, ""); const i = Math.max(t.lastIndexOf("\\"), t.lastIndexOf("/")); if (i < 0) return ""; const d = t.slice(0, i); return /^[A-Za-z]:$/.test(d) ? d + "\\" : d; };
const isRoot = p => /^[A-Za-z]:\\?$/.test(p);
function human(n) { if (n == null) return ""; const u = ["B", "KB", "MB", "GB", "TB"]; let i = 0; while (n >= 1024 && i < 4) { n /= 1024; i++; } return (i ? n.toFixed(n < 10 ? 1 : 0) : n) + " " + u[i]; }
function when(t) {
  if (!t) return "";
  const d = new Date(t * 1000), now = new Date(), s = (now - d) / 1000;
  if (s < 60) return "Just now";
  if (s < 3600) return Math.floor(s / 60) + " min ago";
  if (d.toDateString() === now.toDateString()) return "Today " + d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Yesterday " + d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (s < 6 * 86400) return d.toLocaleDateString([], { weekday: "long" });
  return d.toLocaleDateString([], { day: "numeric", month: "short", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}
const fullDate = t => t ? new Date(t * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "";
const nice = n => n.toLocaleString();
const enc = encodeURIComponent;

async function api(path, body, opts = {}) {
  const r = await fetch(path, body === undefined ? opts : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), ...opts });
  let j = {};
  try { j = await r.json(); } catch {}
  if (!r.ok) { const e = new Error(j.error || r.statusText); e.data = j; e.status = r.status; throw e; }
  return j;
}
function toast(msg, opt = {}) {
  const t = document.createElement("div");
  t.className = "qt-toast" + (opt.bad ? " bad" : "");
  t.innerHTML = esc(msg) + (opt.action ? ` <button class="qt-btn" style="margin-left:8px;padding:3px 9px;font-size:12px">${esc(opt.action)}</button>` : "");
  if (opt.action) t.querySelector("button").onclick = () => { opt.onAction(); t.remove(); };
  $("#toasts").append(t);
  setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 320); }, opt.ms || (opt.action ? 5000 : 2600));
}
const fail = e => toast(e.message || String(e), { bad: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------------------------------------------------------------- state --- */
const S = {
  boot: null, prefs: null, tabs: [], ti: 0, cut: new Set(), menuFor: null, typeahead: "", taTimer: 0,
  status: { beam: false, volt: false }, jobsSeen: new Set(), undo: null, filterCounts: {},
};
const tab = () => S.tabs[S.ti];
let uid = 1;
function newTab(path = HOME) {
  return { id: uid++, path, hist: [path], hi: 0, entries: [], view: [], sel: new Set(), cur: -1, anchor: -1, scroll: 0,
           search: null, filter: "all", loading: false, err: null, enter: "fwd", focusName: null };
}

/* ---------------------------------------------------------------- boot ---- */
async function boot() {
  if (window.top !== window) document.body.classList.add("in-suite");
  S.boot = await api("/api/boot");
  S.prefs = S.boot.prefs;
  const saved = (S.prefs.tabs || []).filter(Boolean);
  S.tabs = saved.length ? saved.map(p => newTab(p)) : [newTab(HOME)];
  S.ti = Math.min(S.prefs.active || 0, S.tabs.length - 1);
  applyPrefs();
  renderSide();
  renderChips();
  await go(tab().path, { push: false });
  renderTabs();
  pollStatus();
  setInterval(pollStatus, 6000);
  setInterval(refreshDrives, 30000);
}

function applyPrefs() {
  $("#app").classList.toggle("noside", S.prefs.sidebar === false);
  $("#body").classList.toggle("nopv", !S.prefs.preview);
  $("#bPreview").classList.toggle("on", !!S.prefs.preview);
  $("#viewIco").innerHTML = S.prefs.view === "grid" ? I.grid : I.list;
  const lbl = { name: "Name", mtime: "Modified", size: "Size", type: "Type" }[S.prefs.sort] || "Name";
  $("#sortLbl").textContent = lbl;
  $("#bSort").classList.toggle("asc", !S.prefs.desc);
  $$("#colhead button").forEach(b => { b.classList.toggle("on", b.dataset.sort === S.prefs.sort); b.classList.toggle("asc", !S.prefs.desc); });
}
let prefsTimer = 0;
function savePrefs() {
  clearTimeout(prefsTimer);
  prefsTimer = setTimeout(() => {
    S.prefs.tabs = S.tabs.map(t => t.path);
    S.prefs.active = S.ti;
    api("/api/prefs", { tabs: S.prefs.tabs, active: S.ti, view: S.prefs.view, sort: S.prefs.sort, desc: S.prefs.desc, hidden: S.prefs.hidden,
      preview: S.prefs.preview, sidebar: S.prefs.sidebar, pins: S.prefs.pins }).catch(() => {});
  }, 500);
}

/* ---------------------------------------------------------------- sidebar - */
function lnk(path, name, icon, color, extra = "") {
  const on = tab() && tab().path && path && tab().path.toLowerCase() === path.toLowerCase();
  return `<button class="lnk${on ? " on" : ""}" data-go="${esc(path)}" data-drop="${esc(path)}" title="${esc(path)}">
    <span class="gi" style="--c:${color}">${svg(icon)}</span><span class="nm">${esc(name)}</span>${extra}</button>`;
}
function renderSide() {
  const b = S.boot;
  $("#places").innerHTML = lnk(HOME, "Home base", "home", "var(--qt-burrow)").replace('data-drop="home:"', "") +
    b.places.filter(p => p.name !== "Home").map(p => lnk(p.path, p.name, p.icon, PLACE_COLOR[p.icon] || "var(--qt-chip)")).join("");
  const pins = S.prefs.pins || [];
  $("#pins").innerHTML = pins.length ? pins.map(p => lnk(p, baseName(p), "pin", "var(--qt-burrow)", `<span class="x" data-unpin="${esc(p)}" title="Unpin">×</span>`)).join("")
    : '<div class="pins-empty">Right-click a folder → Pin, or drag one here.</div>';
  $("#toolLinks").innerHTML = b.tools.map(t => lnk(t.path, t.name, t.icon, PLACE_COLOR[t.icon])).join("");
  renderDrives();
}
function renderDrives() {
  $("#drives").innerHTML = S.boot.drives.map(d => {
    const used = d.total ? 1 - d.free / d.total : 0;
    return `<button class="lnk drive${tab() && tab().path.toLowerCase().startsWith(d.path.toLowerCase()) ? "" : ""}" data-go="${esc(d.path)}" data-drop="${esc(d.path)}" title="${esc(d.label)} (${esc(d.path)})">
      <span class="gi" style="--c:${d.kind === "usb" ? "var(--k-archive)" : "var(--k-doc)"}">${svg(d.kind === "usb" ? "usb" : "drive")}</span>
      <span class="nm">${esc(d.label)} <span class="free">${esc(d.path.slice(0, 2))}</span></span><span class="free">${human(d.free)} free</span>
      <span class="bar"><i data-w="${(used * 100).toFixed(1)}" class="${used > .9 ? "full" : ""}"></i></span></button>`;
  }).join("");
  requestAnimationFrame(() => $$("#drives .bar i").forEach(i => (i.style.width = i.dataset.w + "%")));
}
async function refreshDrives() { try { S.boot.drives = await api("/api/drives"); renderDrives(); } catch {} }
function markSide() {
  const p = (tab().path || "").toLowerCase();
  $$(".side .lnk").forEach(l => l.classList.toggle("on", (l.dataset.go || "").toLowerCase() === p));
}

/* ---------------------------------------------------------------- tabs ---- */
function tabTitle(t) {
  if (t.search) return "“" + t.search.q + "”";
  if (t.path === HOME) return "Home base";
  return baseName(t.path) || t.path;
}
function renderTabs() {
  const el = $("#tabs");
  const ids = S.tabs.map(t => t.id).join(",");
  if (el.dataset.ids !== ids) {
    el.dataset.ids = ids;
    el.innerHTML = S.tabs.map((t, i) => `<div class="tab" role="tab" draggable="true" data-ti="${i}" data-drop-tab="${i}" title="${esc(t.path === HOME ? "Home base" : t.path)}">
      ${t.loading ? '<span class="spin"></span>' : ""}<span class="t"></span><button class="tx" data-close="${i}" title="Close (Ctrl+W)">×</button></div>`).join("");
  }
  $$(".tab", el).forEach((n, i) => {
    const t = S.tabs[i];
    n.classList.toggle("on", i === S.ti);
    n.querySelector(".t").textContent = tabTitle(t);
    n.title = t.path === HOME ? "Home base" : t.path;
    const sp = n.querySelector(".spin");
    if (t.loading && !sp) n.insertAdjacentHTML("afterbegin", '<span class="spin"></span>');
    if (!t.loading && sp) sp.remove();
  });
  $(".tab.on", el)?.scrollIntoView({ block: "nearest", inline: "nearest" });
}
function openTab(path = HOME, focus = true) {
  const t = newTab(path);
  S.tabs.splice(S.ti + 1, 0, t);
  if (focus) { S.ti = S.tabs.indexOf(t); go(path, { push: false }); }
  else { loadInto(t, path); }
  renderTabs(); savePrefs();
}
function closeTab(i) {
  if (S.tabs.length === 1) { S.tabs[0] = newTab(HOME); S.ti = 0; go(HOME, { push: false }); renderTabs(); savePrefs(); return; }
  const n = $$("#tabs .tab")[i];
  const finish = () => {
    const wasActive = S.ti === i;
    tab().scroll = $("#scroller").scrollTop;
    S.tabs.splice(i, 1);
    if (S.ti > i) S.ti--;
    else if (wasActive) S.ti = Math.min(i, S.tabs.length - 1);
    renderTabs(); if (wasActive) showTab(); savePrefs();
  };
  if (n) { n.classList.add("out"); setTimeout(finish, 200); } else finish();
}
function switchTab(i) {
  if (i < 0 || i >= S.tabs.length || i === S.ti) return;
  tab().scroll = $("#scroller").scrollTop;
  S.ti = i; renderTabs(); showTab(); savePrefs();
}
function showTab() {
  const t = tab();
  t.enter = "same";
  if (!t.loaded && t.path !== HOME) return go(t.path, { push: false, dir: "same" });
  computeView(t);
  renderAll();
  $("#scroller").scrollTop = t.scroll || 0;
  renderRows();
}

/* ---------------------------------------------------------------- loading - */
async function loadInto(t, path) {
  t.loading = true; t.err = null;
  if (t === tab()) renderTabs();
  try {
    if (path === HOME) {
      t.entries = []; t.path = HOME;
    } else {
      const r = await api("/api/ls?path=" + enc(path));
      t.path = r.path; t.entries = r.entries; t.parent = r.parent; t.ms = r.ms;
    }
  } catch (e) {
    t.loading = false;
    if (e.data && e.data.file) { // a file path was typed: open its folder and select it
      t.focusName = baseName(e.data.file);
      return loadInto(t, e.data.parent);
    }
    t.err = e.message;
    throw e;
  }
  t.loading = false; t.loaded = true;
  return t;
}
async function go(path, { push = true, focusName = null, dir = "fwd", keepSearch = false } = {}) {
  const t = tab();
  if (!keepSearch) stopSearch(t);
  const prev = t.path;
  t.scroll = 0;
  t.enter = dir;
  try {
    await loadInto(t, path);
  } catch (e) {
    renderTabs();
    toast(e.message, { bad: true });
    if (prev && prev !== path && t.entries.length === 0 && prev !== HOME) { try { await loadInto(t, prev); } catch {} }
    return;
  }
  if (push && t.hist[t.hi] !== t.path) { t.hist = t.hist.slice(0, t.hi + 1); t.hist.push(t.path); t.hi++; }
  t.sel.clear(); t.cur = -1; t.anchor = -1;
  if (!focusName && prev && prev !== HOME && dirName(prev).toLowerCase() === (t.path || "").toLowerCase()) focusName = baseName(prev);
  if (t.focusName) { focusName = t.focusName; t.focusName = null; }
  computeView(t);
  if (focusName) { const i = t.view.findIndex(e => e.n.toLowerCase() === focusName.toLowerCase()); if (i >= 0) { t.cur = t.anchor = i; t.sel.add(keyOf(t.view[i])); } }
  renderAll();
  $("#scroller").scrollTop = 0;
  if (t.cur >= 0) ensureVisible(t.cur);
  renderRows();
  savePrefs();
}
async function refresh(quiet) {
  const t = tab();
  if (t.search) return runSearch(t.search.q);
  if (t.path === HOME) { renderHome(); return; }
  const keep = new Set(t.sel), cur = t.view[t.cur] ? t.view[t.cur].n : null, st = $("#scroller").scrollTop;
  try { await loadInto(t, t.path); } catch (e) { return fail(e); }
  computeView(t);
  t.sel = new Set([...keep].filter(k => t.view.some(e => keyOf(e) === k)));
  t.cur = cur ? t.view.findIndex(e => e.n === cur) : -1;
  t.enter = null;
  renderAll();
  $("#scroller").scrollTop = st;
  renderRows();
  if (!quiet) { const b = $("#bRefresh"); b.classList.remove("spin"); void b.offsetWidth; b.classList.add("spin"); }
}
const keyOf = e => e.p ? join(e.p, e.n) : join(tab().path, e.n);
const pathOf = (e, t = tab()) => e.p ? join(e.p, e.n) : join(t.path, e.n);

/* ---------------------------------------------------------------- view ---- */
function computeView(t) {
  const src = t.search ? t.search.results : t.entries;
  const hidden = S.prefs.hidden;
  let v = src.filter(e => hidden || !e.h);
  const counts = { all: v.length };
  for (const e of v) { const k = kindOf(e); counts[k] = (counts[k] || 0) + 1; }
  S.filterCounts = counts;
  if (t.filter !== "all") v = v.filter(e => kindOf(e) === t.filter);
  const by = S.prefs.sort, dir = S.prefs.desc ? -1 : 1;
  const cmp = {
    name: (a, b) => coll.compare(a.n, b.n),
    mtime: (a, b) => a.m - b.m,
    size: (a, b) => a.s - b.s,
    type: (a, b) => coll.compare(extOf(a.n), extOf(b.n)) || coll.compare(a.n, b.n),
  }[by] || ((a, b) => coll.compare(a.n, b.n));
  if (t.search && t.search.rank && by === "name") {
    v.sort((a, b) => (b.d - a.d) || (rank(b, t.search.q) - rank(a, t.search.q)) || coll.compare(a.n, b.n));
  } else {
    v.sort((a, b) => (b.d - a.d) || dir * cmp(a, b) || coll.compare(a.n, b.n));
  }
  t.view = v;
}
function rank(e, q) {
  const n = e.n.toLowerCase(), w = q.toLowerCase().split(/\s+/).filter(x => x && !x.includes(":"))[0] || "";
  let s = 0;
  if (n === w || n.replace(/\.[^.]+$/, "") === w) s += 100;
  else if (n.startsWith(w)) s += 60;
  else if (new RegExp("(^|[\\s._-])" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(n)) s += 40;
  s -= (e.p || "").split(/[\\/]/).length * 2;
  return s;
}
function renderChips() {
  const t = tab() || { filter: "all" };
  const c = S.filterCounts;
  const list = [["all", "All", "var(--qt-fg)"], ["folder", "Folders", "var(--k-folder)"], ...Object.entries(KIND).map(([k, v]) => [k, v.label, v.c])];
  $("#chips").innerHTML = list.map(([k, l, col]) => `<button class="chip${t.filter === k ? " on" : ""}${k !== "all" && !c[k] ? " dim" : ""}" data-filter="${k}">
    ${k === "all" ? "" : `<i style="--c:${col}"></i>`}${l}${c[k] ? ` <b>${nice(c[k])}</b>` : ""}</button>`).join("");
}
function renderAll() {
  const t = tab();
  const home = t.path === HOME && !t.search;
  $("#homeView").hidden = !home;
  $("#spacerV").hidden = home;
  $("#colhead").hidden = home;
  $("#filterbar").style.display = home ? "none" : "";
  $("#pane").classList.toggle("grid-mode", S.prefs.view === "grid" && !home);
  $("#pane").classList.toggle("search-mode", !!t.search);
  $("#colhead").classList.toggle("search", !!t.search);
  $("#colhead").innerHTML = t.search
    ? '<button data-sort="name">Name</button><button>Where</button><button data-sort="mtime">Modified</button><button data-sort="size">Size</button>'
    : '<button data-sort="name">Name</button><button data-sort="mtime">Modified</button><button data-sort="type">Type</button><button data-sort="size">Size</button>';
  applyPrefs();
  renderCrumbs();
  renderTabs();
  markSide();
  $("#bBack").disabled = t.hi <= 0;
  $("#bFwd").disabled = t.hi >= t.hist.length - 1;
  $("#bUp").disabled = home || !t.path || (isRoot(t.path) && false);
  $("#q").placeholder = "Search " + (t.path === HOME ? "your files" : (baseName(t.path) || t.path));
  if (!t.search) { $("#q").value = ""; $("#qClear").hidden = true; }
  if (home) { renderHome(); $("#empty").hidden = true; updateStatus(); renderPreview(); return; }
  renderChips();
  layoutRows();
  renderEmpty();
  updateStatus();
  renderPreview();
}
function renderEmpty() {
  const t = tab(), el = $("#empty");
  if (t.view.length || t.loading) { el.hidden = true; return; }
  el.hidden = false;
  if (t.search && !t.search.done) { el.innerHTML = ""; return; }
  const filtered = t.filter !== "all" && (t.search ? t.search.results : t.entries).length;
  el.innerHTML = `<div><div class="mole">${t.search ? "🕳️" : "🦫"}</div>
    <h2>${t.search ? "Nothing dug up" : filtered ? "No " + (KIND[t.filter] || { label: "folders" }).label.toLowerCase() + " here" : "Nothing down here"}</h2>
    <p>${t.search ? `No names match “${esc(t.search.q)}” under ${esc(baseName(t.search.root) || t.search.root)}.` : filtered ? "Try another filter." : "This folder is empty. Drop files in from Windows, or paste with Ctrl+V."}</p>
    ${filtered ? '<button class="qt-btn" data-filter="all">Show everything</button>' : t.search ? '<button class="qt-btn" id="searchUp">Search one level up</button>' : '<button class="qt-btn primary" id="emptyNew">New folder</button>'}</div>`;
}

/* ---------------------------------------------------------------- crumbs -- */
function renderCrumbs() {
  const t = tab(), el = $("#crumbs");
  if (t.path === HOME) { el.innerHTML = `<button class="crumb" data-go="${HOME}">🏠 Home base</button>`; return; }
  const parts = [];
  let p = t.path;
  while (p) { parts.unshift(p); const d = dirName(p); if (!d || d === p) break; p = d; }
  el.innerHTML = parts.map((p, i) => `<button class="crumb" data-go="${esc(p)}" data-drop="${esc(p)}" style="animation-delay:${i * 25}ms">${esc(isRoot(p) ? p.slice(0, 2) : baseName(p))}</button>` +
    `<button class="chev" data-chev="${esc(p)}" title="Folders in ${esc(baseName(p) || p)}">${svg("list").replace(I.list, '<path d="m9 6 6 6-6 6"/>')}</button>`).join("");
  el.classList.toggle("fit", el.scrollWidth <= el.clientWidth);
  el.scrollLeft = el.scrollWidth;
}
function editPath() {
  const pb = $("#pathbar"), inp = $("#pathIn");
  pb.classList.add("editing");
  inp.value = tab().path === HOME ? "" : tab().path;
  inp.focus(); inp.select();
}
function endEditPath() { $("#pathbar").classList.remove("editing"); $("#suggest").hidden = true; }
let sugTimer = 0, sugIdx = -1;
async function suggest() {
  const v = $("#pathIn").value;
  const box = $("#suggest");
  if (!v) { box.hidden = true; return; }
  const list = await api("/api/complete?q=" + enc(v)).catch(() => []);
  sugIdx = -1;
  if (!list.length) { box.hidden = true; return; }
  box.innerHTML = list.map(p => `<button data-sug="${esc(p)}">${esc(p)}</button>`).join("");
  box.hidden = false;
}

/* ---------------------------------------------------------------- rows ---- */
const ROW_H = 38, CELL_H = 166 + 8, CELL_W = 150;
function layoutRows() {
  const t = tab();
  const grid = S.prefs.view === "grid";
  const sc = $("#scroller");
  const cols = grid ? Math.max(1, Math.floor((sc.clientWidth - 20) / CELL_W)) : 1;
  S.cols = cols;
  const rows = Math.ceil(t.view.length / cols);
  $("#spacerV").style.height = (rows * (grid ? CELL_H : ROW_H) + 20) + "px";
  $("#rows").style.setProperty("--cols", cols);
  S.lastRange = null;
  renderRows(true);
}
function renderRows(force) {
  const t = tab();
  if (t.path === HOME && !t.search) return;
  const sc = $("#scroller"), grid = S.prefs.view === "grid";
  const h = grid ? CELL_H : ROW_H, cols = S.cols || 1;
  const top = sc.scrollTop, vh = sc.clientHeight || 800;
  const r0 = Math.max(0, Math.floor(top / h) - 6), r1 = Math.ceil((top + vh) / h) + 6;
  const a = r0 * cols, b = Math.min(t.view.length, r1 * cols);
  const key = a + ":" + b;
  const rowsEl = $("#rows");
  if (!force && S.lastRange === key && !S.dirty) { paintSel(); return; }
  S.lastRange = key; S.dirty = false;
  rowsEl.style.transform = `translateY(${r0 * h}px)`;
  const q = t.search ? t.search.words : null;
  const html = [];
  for (let i = a; i < b; i++) html.push(grid ? cellHtml(t.view[i], i, i - a, q) : rowHtml(t.view[i], i, i - a, q));
  rowsEl.innerHTML = html.join("");
  rowsEl.className = "rows" + (t.enter ? " enter-" + t.enter : "");
  if (t.enter) { const en = t.enter; setTimeout(() => { if (tab() === t && t.enter === en) { t.enter = null; rowsEl.className = "rows"; } }, 700); }
  if (grid) $$("img[data-src]", rowsEl).forEach(img => { img.onload = () => img.classList.add("ok"); img.onerror = () => { img.replaceWith(document.createRange().createContextualFragment(fileIcon(t.view[+img.closest("[data-i]").dataset.i] || { n: "" }))); }; img.src = img.dataset.src; });
  paintSel();
}
function hl(name, words) {
  if (!words || !words.length) return esc(name);
  const low = name.toLowerCase();
  const marks = new Array(name.length).fill(false);
  for (const w of words) { let i = low.indexOf(w); while (w && i >= 0) { for (let k = i; k < i + w.length; k++) marks[k] = true; i = low.indexOf(w, i + w.length); } }
  let out = "", on = false;
  for (let i = 0; i < name.length; i++) { if (marks[i] !== on) { out += marks[i] ? "<mark>" : "</mark>"; on = marks[i]; } out += esc(name[i]); }
  return out + (on ? "</mark>" : "");
}
function rowHtml(e, i, vi, q) {
  const t = tab(), k = kindOf(e), p = pathOf(e, t);
  const cls = "row" + (e.h ? " hid" : "") + (S.cut.has(p.toLowerCase()) ? " cut" : "");
  const loc = t.search ? `<span class="loc" title="${esc(e.p)}">&lrm;${esc(rel(e.p, t.search.root))}&lrm;</span>` : "";
  return `<div class="${cls}" data-i="${i}" draggable="true" style="--i:${Math.min(vi, 30)}">${fileIcon(e)}<span class="nm">${hl(e.n, q)}</span>${loc}
    <span class="mt">${when(e.m)}</span>${t.search ? "" : `<span class="ty">${e.d ? "Folder" : (extOf(e.n).toUpperCase() || TYPE_NAME[k])}</span>`}<span class="sz">${e.d ? "" : human(e.s)}</span></div>`;
}
function cellHtml(e, i, vi, q) {
  const t = tab(), x = extOf(e.n), p = pathOf(e, t);
  const thumb = !e.d && (THUMBABLE.has(x) || (S.boot.video_thumbs && KIND.video.ext.includes(x)));
  const cls = "cell" + (e.h ? " hid" : "") + (S.cut.has(p.toLowerCase()) ? " cut" : "");
  return `<div class="${cls}" data-i="${i}" draggable="true" style="--i:${Math.min(vi, 30)}" title="${esc(e.n)}"><div class="th">${thumb ? `<img alt="" data-src="/api/thumb?s=256&path=${enc(p)}" loading="lazy" draggable="false">${kindOf(e) === "video" ? '<span class="play"></span>' : ""}` : fileIcon(e)}</div>
    <span class="nm">${hl(e.n, q)}</span></div>`;
}
const rel = (p, root) => { const r = root.replace(/[\\/]+$/, ""); return p.toLowerCase().startsWith(r.toLowerCase()) ? (p.slice(r.length).replace(/^[\\/]/, "") || "·") : p; };
function paintSel() {
  const t = tab();
  $$("#rows [data-i]").forEach(n => {
    const i = +n.dataset.i, e = t.view[i];
    if (!e) return;
    n.classList.toggle("sel", t.sel.has(keyOf(e)));
    n.classList.toggle("cur", i === t.cur);
  });
}
function ensureVisible(i) {
  const sc = $("#scroller"), grid = S.prefs.view === "grid";
  const h = grid ? CELL_H : ROW_H, row = Math.floor(i / (S.cols || 1));
  const y = row * h + 6;
  if (y < sc.scrollTop) sc.scrollTop = y - 4;
  else if (y + h > sc.scrollTop + sc.clientHeight) sc.scrollTop = y + h - sc.clientHeight + 10;
}
function selected() {
  const t = tab();
  const list = t.view.filter(e => t.sel.has(keyOf(e)));
  if (!list.length && t.view[t.cur]) list.push(t.view[t.cur]);
  return list;
}
const selPaths = () => selected().map(e => pathOf(e));
function setCur(i, { extend = false, toggle = false } = {}) {
  const t = tab();
  if (!t.view.length) return;
  i = Math.max(0, Math.min(t.view.length - 1, i));
  if (extend && t.anchor >= 0) {
    t.sel.clear();
    const [a, b] = [Math.min(t.anchor, i), Math.max(t.anchor, i)];
    for (let k = a; k <= b; k++) t.sel.add(keyOf(t.view[k]));
  } else if (toggle) {
    const k = keyOf(t.view[i]);
    t.sel.has(k) ? t.sel.delete(k) : t.sel.add(k);
    t.anchor = i;
  } else {
    t.sel.clear(); t.sel.add(keyOf(t.view[i])); t.anchor = i;
  }
  t.cur = i;
  ensureVisible(i);
  renderRows();
  updateStatus();
  schedulePreview();
}
function updateStatus() {
  const t = tab();
  if (t.path === HOME && !t.search) { $("#stCount").textContent = "Home base"; $("#stSel").textContent = ""; }
  else {
    const n = t.view.length, all = (t.search ? t.search.results : t.entries).length;
    $("#stCount").textContent = `${nice(n)} item${n === 1 ? "" : "s"}${n !== all ? ` (of ${nice(all)})` : ""}${t.ms != null && !t.search ? ` · ${t.ms} ms` : ""}`;
    const sel = t.view.filter(e => t.sel.has(keyOf(e)));
    const bytes = sel.reduce((s, e) => s + (e.d ? 0 : e.s), 0);
    $("#stSel").textContent = sel.length > 1 ? `${sel.length} selected · ${human(bytes)}` : sel.length === 1 && !sel[0].d ? human(bytes) : "";
  }
  $("#stUndo").textContent = S.undo ? "Ctrl+Z: undo " + S.undo.toLowerCase() : "";
}

/* ---------------------------------------------------------------- open ---- */
function openEntry(e, newTabToo = false) {
  const p = pathOf(e);
  if (e.d) {
    if (newTabToo) return openTab(p, false), toast("Opened in a new tab");
    return go(p, { dir: "fwd" });
  }
  if (IN_SUITE && !RUN_EXT.has(extOf(e.n))) return suitePeek(e).then(ok => ok || openFile(p));
  openFile(p);
}
/* Inside QT Suite, files open in the suite's quick preview (Peek) instead of their Windows app.
   The hub answers peek-ack, or peek-no when its "Open files in the suite" switch is off. */
const SUITE_ORIGIN = (() => { try { const o = (location.ancestorOrigins || [])[0] || (window.parent !== window ? new URL(document.referrer).origin : ""); return /^http:\/\/(127\.0\.0\.1|localhost):78\d\d$/.test(o) ? o : ""; } catch { return ""; } })();
const IN_SUITE = window.parent !== window && !!SUITE_ORIGIN;
const RUN_EXT = new Set("exe msi lnk url appx msix msixbundle com scr cpl bat cmd vbs vbe wsf reg doc xls ppt xlsx xlsm pptx odt ods odp rtf epub iso img 7z rar gz tgz bz2 xz cab dll sys".split(" "));
let peekSeq = 0;
function suitePeek(e) {
  if (!IN_SUITE) return Promise.resolve(false);
  const t = tab(), p = pathOf(e), id = ++peekSeq;
  const list = t.view.filter(x => !x.d).slice(0, 3000).map(x => pathOf(x));
  const i = t.view.indexOf(e), el = i >= 0 && document.querySelector(`#rows [data-i="${i}"]`);
  const r = el ? el.getBoundingClientRect() : null;
  return new Promise(res => {
    const done = ok => { removeEventListener("message", on); clearTimeout(tm); res(ok); };
    const on = ev => { if (ev.origin === SUITE_ORIGIN && ev.data && ev.data.id === id && /^peek-(ack|no)$/.test(ev.data.qt)) done(ev.data.qt === "peek-ack"); };
    addEventListener("message", on);
    const tm = setTimeout(() => done(false), 500);
    window.parent.postMessage({ qt: "peek", id, path: p, list, rect: r && { x: r.left + Math.min(r.width, 60) / 2 + 20, y: r.top + r.height / 2 } }, SUITE_ORIGIN);
  });
}
function openFile(p, how = "default") { api("/api/open", { path: p, how }).then(() => { if (how === "default") toast("Opening " + baseName(p)); }).catch(fail); }
function goUp() {
  const t = tab();
  if (t.search) { clearSearch(); return; }
  if (t.path === HOME) return;
  const d = dirName(t.path);
  if (!d || d === t.path) return go(HOME, { dir: "back" });
  go(d, { dir: "back", focusName: baseName(t.path) });
}
function back() { const t = tab(); if (t.hi > 0) { t.hi--; go(t.hist[t.hi], { push: false, dir: "back" }); } }
function fwd() { const t = tab(); if (t.hi < t.hist.length - 1) { t.hi++; go(t.hist[t.hi], { push: false, dir: "fwd" }); } }

/* ---------------------------------------------------------------- search -- */
let searchTimer = 0;
function stopSearch(t) { if (t.search && t.search.ctrl) t.search.ctrl.abort(); t.search = null; $("#digging").hidden = true; }
function clearSearch() {
  const t = tab();
  if (!t.search) { $("#q").value = ""; $("#qClear").hidden = true; return; }
  stopSearch(t);
  $("#q").value = ""; $("#qClear").hidden = true;
  t.enter = "same";
  computeView(t); t.sel.clear(); t.cur = -1;
  renderAll();
  $("#pane").focus();
}
async function runSearch(q, rootOverride) {
  const t = tab();
  q = q.trim();
  if (!q) return clearSearch();
  const root = rootOverride || (t.search ? t.search.root : (t.path === HOME ? S.boot.home : t.path));
  if (t.search && t.search.ctrl) t.search.ctrl.abort();
  const ctrl = new AbortController();
  const words = q.toLowerCase().split(/\s+/).filter(w => w && !w.includes(":") && !w.startsWith("*.")).map(w => w.replace(/\*/g, ""));
  t.search = { q, root, results: [], done: false, ctrl, words, rank: true, scanned: 0 };
  t.sel.clear(); t.cur = -1; t.enter = "same";
  computeView(t); renderAll();
  const dig = $("#digging"); dig.hidden = false;
  $("#digText").textContent = "Digging…";
  let buf = "", lastPaint = 0;
  try {
    const r = await fetch(`/api/search?root=${enc(root)}&q=${enc(q)}&hidden=${S.prefs.hidden ? 1 : 0}`, { signal: ctrl.signal });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Search failed");
    const rd = r.body.getReader(), dec = new TextDecoder();
    for (;;) {
      const { value, done } = await rd.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n"); buf = lines.pop();
      for (const ln of lines) {
        if (!ln) continue;
        const o = JSON.parse(ln);
        if (o._p != null) { t.search.scanned = o._p; continue; }
        if (o._done) { t.search.done = true; t.search.info = o; continue; }
        t.search.results.push(o);
      }
      if (tab() === t && performance.now() - lastPaint > 150) {
        lastPaint = performance.now();
        $("#digText").textContent = `${nice(t.search.results.length)} found · ${nice(t.search.scanned)} scanned`;
        repaintSearch(t);
      }
    }
  } catch (e) {
    if (e.name === "AbortError") return;
    toast(e.message, { bad: true });
  }
  if (t.search && t.search.ctrl === ctrl) {
    t.search.done = true;
    const inf = t.search.info || {};
    if (tab() === t) {
      dig.hidden = true;
      repaintSearch(t);
      toast(`${nice(t.search.results.length)} match${t.search.results.length === 1 ? "" : "es"} · ${nice(inf.scanned || t.search.scanned)} items in ${((inf.ms || 0) / 1000).toFixed(1)} s${inf.capped ? " (stopped at 3,000)" : ""}`, { ms: 2200 });
    }
  }
}
function repaintSearch(t) {
  const curKey = t.view[t.cur] ? keyOf(t.view[t.cur]) : null;
  computeView(t);
  if (curKey) t.cur = t.view.findIndex(e => keyOf(e) === curKey);
  if (tab() !== t) return;
  renderChips(); layoutRows(); renderEmpty(); updateStatus(); renderTabs();
}

/* ---------------------------------------------------------------- home ---- */
async function renderHome() {
  const b = S.boot, el = $("#homeView");
  const h = new Date().getHours();
  const hi = h < 5 ? "Up late?" : h < 12 ? "Morning." : h < 17 ? "Afternoon." : "Evening.";
  const pins = S.prefs.pins || [];
  const recent = (S.prefs.recent || []).filter(r => r.kind === "dir").slice(0, 10);
  el.innerHTML = `<div class="qt-eyebrow">${hi}</div>
    <h1 class="qt-display">Dig in, <span class="hl">fast.</span></h1>
    <p class="lede">Type to search everything in your user folder, or pick a spot below. <kbd>Ctrl K</kbd> jumps anywhere.</p>
    <div class="tiles qt-stagger">${[...b.places, ...b.tools].map(p => `<button class="tile qt-card" data-go="${esc(p.path)}" data-drop="${esc(p.path)}">
      <span class="gi" style="--c:${PLACE_COLOR[p.icon] || "var(--qt-chip)"}">${svg(p.icon)}</span><b>${esc(p.name)}</b><span>${esc(p.path)}</span></button>`).join("")}</div>
    <h3>Fresh files <span class="qt-muted" style="letter-spacing:0;text-transform:none">· newest in Downloads, Desktop, VOLT and Beam</span></h3>
    <div class="fresh qt-stagger" id="fresh"><div class="qt-muted">Looking…</div></div>
    <h3>Drives</h3>
    <div class="drivecards qt-stagger">${b.drives.map(d => { const used = d.total ? 1 - d.free / d.total : 0; return `<button class="drivecard qt-card" data-go="${esc(d.path)}">
      <div class="top"><b>${esc(d.path.slice(0, 2))}</b><span class="qt-chip">${esc(d.label)}</span></div>
      <div class="qt-bar"><i data-w="${(used * 100).toFixed(1)}" style="${used > .9 ? "background:var(--qt-bad)" : ""}"></i></div>
      <small>${human(d.free)} free of ${human(d.total)}</small></button>`; }).join("")}</div>
    ${pins.length ? `<h3>Pinned</h3><div class="recents">${pins.map(p => `<button class="qt-btn" data-go="${esc(p)}">${svg("pin")}<span>${esc(baseName(p))}</span></button>`).join("")}</div>` : ""}
    ${recent.length ? `<h3>Been here lately</h3><div class="recents">${recent.map(r => `<button class="qt-btn ghost" data-go="${esc(r.path)}" title="${esc(r.path)}">${svg("folder")}<span>${esc(baseName(r.path) || r.path)}</span></button>`).join("")}</div>` : ""}`;
  requestAnimationFrame(() => $$(".drivecard .qt-bar i", el).forEach(i => (i.style.width = i.dataset.w + "%")));
  try {
    const fresh = await api("/api/fresh?n=12");
    const fe = $("#fresh");
    if (!fe) return;
    S.fresh = fresh;
    fe.innerHTML = fresh.length ? fresh.map((e, i) => {
      const p = join(e.p, e.n), x = extOf(e.n);
      const th = !e.d && (THUMBABLE.has(x) || (S.boot.video_thumbs && KIND.video.ext.includes(x)));
      return `<button class="fcard qt-card" data-fresh="${i}" title="${esc(p)}"><div class="th">${th ? `<img src="/api/thumb?s=256&path=${enc(p)}" alt="" onerror="this.outerHTML='${fileIcon(e).replace(/"/g, "&quot;").replace(/'/g, "\\'")}'">` : fileIcon(e)}</div>
        <b>${esc(e.n)}</b><span>${when(e.m)} · ${e.d ? "folder" : human(e.s)}</span></button>`;
    }).join("") : '<div class="qt-muted">Nothing new.</div>';
  } catch {}
}

/* ---------------------------------------------------------------- preview - */
let pvTimer = 0, pvKey = null;
function schedulePreview() { clearTimeout(pvTimer); pvTimer = setTimeout(renderPreview, 90); }
async function renderPreview() {
  const pv = $("#preview");
  if (!S.prefs.preview) return;
  const t = tab();
  const sel = t.view.filter(e => t.sel.has(keyOf(e)));
  const focus = t.view[t.cur];
  if (t.path === HOME && !t.search) {
    pvKey = "home";
    pv.innerHTML = `<div class="pv"><div class="pv-empty">${fileIcon({ n: "", d: true })}<b>Home base</b><p>Pick a place, or start typing to search.</p></div>${tipsHtml()}</div>`;
    return;
  }
  if (sel.length > 1) {
    const key = "multi:" + sel.length;
    if (pvKey === key) return;
    pvKey = key;
    const bytes = sel.reduce((s, e) => s + (e.d ? 0 : e.s), 0);
    const media = sel.filter(e => ["image", "video"].includes(kindOf(e))).length;
    pv.innerHTML = `<div class="pv"><div class="stack">${sel.slice(0, 3).map(fileIcon).join("")}</div>
      <div class="big">${sel.length} items</div><p class="qt-muted" style="text-align:center;margin:0">${human(bytes)}${sel.some(e => e.d) ? " + folders" : ""}</p>
      <div class="acts">${actBtn("beam", "phone", "Send to phone", "beam")}${media ? actBtn("lens", "lens", "To Lens", "lens") : ""}
        ${actBtn("zip", "zip", "Compress")}${actBtn("rename", "rename", "Rename all")}${actBtn("copypath", "link", "Copy paths")}${actBtn("copy", "copy", "Copy")}${actBtn("cut", "cut", "Cut")}
        ${actBtn("trash", "trash", "Recycle")}</div></div>`;
    return;
  }
  const e = sel[0] || focus;
  if (!e) {
    if (pvKey === "folder:" + t.path) return;
    pvKey = "folder:" + t.path;
    pv.innerHTML = `<div class="pv">${t.search ? `<div class="pv-empty"><div class="ic" style="transform:scale(2.6);margin:0 auto 30px">🔎</div><b>Searching ${esc(baseName(t.search.root) || t.search.root)}</b><p>Tip: <code>*.mp4</code>, <code>kind:image</code>, <code>ext:pdf,docx</code></p></div>`
      : `<div class="pv-empty">${fileIcon({ n: "", d: true })}<b>${esc(baseName(t.path) || t.path)}</b><p>${nice(t.view.filter(x => x.d).length)} folders · ${nice(t.view.filter(x => !x.d).length)} files</p></div>`}${tipsHtml()}</div>`;
    return;
  }
  const p = pathOf(e), key = "one:" + p + e.m;
  if (pvKey === key) return;
  pvKey = key;
  const k = kindOf(e), x = extOf(e.n);
  let stage = "";
  if (e.d) stage = `<div class="stage">${fileIcon(e)}</div>`;
  else if (k === "image" && THUMBABLE.has(x) || x === "svg") stage = `<div class="stage"><img src="${x === "gif" || x === "svg" ? "/api/raw?path=" + enc(p) : "/api/thumb?s=720&path=" + enc(p)}" alt="" data-lb onerror="this.src='/api/raw?path=${enc(p).replace(/'/g, "%27")}';this.onerror=null"></div>`;
  else if (PLAYABLE_V.has(x)) stage = `<div class="stage"><video src="/api/raw?path=${enc(p)}" controls preload="metadata"></video></div>`;
  else if (PLAYABLE_A.has(x)) stage = `<div class="stage audio"><div class="eq"><i></i><i></i><i></i><i></i><i></i></div><audio src="/api/raw?path=${enc(p)}" controls preload="metadata"></audio></div>`;
  else if (x === "pdf") stage = `<div class="stage"><iframe src="/api/raw?path=${enc(p)}#toolbar=0&view=FitH" title="PDF"></iframe></div>`;
  else stage = `<div class="stage" id="pvStage">${fileIcon(e)}</div>`;
  const h = S.boot.handoff || {};
  const acts = [];
  if (e.d) {
    acts.push(actBtn("open", "open", "Open"), actBtn("newtab", "tab", "New tab"), actBtn("beam", "phone", "Send to phone", "beam"),
      actBtn("pin", "pin", (S.prefs.pins || []).some(x => x.toLowerCase() === p.toLowerCase()) ? "Unpin" : "Pin"), actBtn("terminal", "term", "Terminal"), actBtn("reveal", "explorer", "Explorer"));
  } else {
    acts.push(actBtn("open", "open", "Open"), actBtn("beam", "phone", "Send to phone", "beam"));
    if (k === "image" || k === "video") acts.push(actBtn("lens", "lens", "To Lens", "lens"));
    if ((h.pixlab || []).includes("." + x)) acts.push(actBtn("pixlab", "pixlab", "Pixlab", "pixlab"));
    if ((h.inkmotion || []).includes("." + x)) acts.push(actBtn("inkmotion", "inkmotion", k === "image" ? "Trace in Inkmotion" : "Inkmotion", "inkmotion"));
    if (k === "image" || k === "video") acts.push(actBtn("quick", "eye", "Quick look"));
    if (S.boot.code && (k === "code" || TEXTY.has(x))) acts.push(actBtn("code", "code", "VS Code"));
    if (["zip", "apk"].includes(x)) acts.push(actBtn("unzip", "zip", "Extract"));
    acts.push(actBtn("with", "with", "Open with"), actBtn("reveal", "explorer", "Explorer"));
  }
  if (e.p) acts.push(actBtn("locate", "folder", "File location"));
  acts.push(actBtn("copypath", "link", "Copy path"), actBtn("rename", "rename", "Rename"));
  pv.innerHTML = `<div class="pv">${stage}
    <div><h2>${esc(e.n)}</h2></div>
    <div class="kind"><span class="qt-chip"><i class="qt-dot" style="background:${e.d ? "var(--k-folder)" : (KIND[k] || {}).c || "var(--k-other)"}"></i>${e.d ? "Folder" : (x.toUpperCase() || "File")}</span>${e.d ? "" : `<span class="qt-chip">${human(e.s)}</span>`}<span id="pvExtra"></span></div>
    <div class="acts">${acts.join("")}</div>
    <dl class="meta" id="pvMeta"><dt>Modified</dt><dd>${fullDate(e.m)}</dd><dt>Where</dt><dd class="mono">${esc(dirName(p))}</dd></dl>
    <div id="pvMore"></div></div>`;
  $("audio", pv)?.addEventListener("play", () => $(".eq", pv).classList.add("on"));
  $("audio", pv)?.addEventListener("pause", () => $(".eq", pv).classList.remove("on"));
  const myKey = key;
  try {
    const st = await api("/api/stat?path=" + enc(p));
    if (pvKey !== myKey) return;
    const meta = $("#pvMeta");
    let extra = `<dt>Created</dt><dd>${fullDate(st.c)}</dd>`;
    if (st.dims) { extra = `<dt>Size</dt><dd>${st.dims[0]} × ${st.dims[1]} px</dd>` + extra; }
    if (st.dir) extra = `<dt>Inside</dt><dd>${nice(st.dirs)} folders · ${nice(st.files)} files</dd><dt>Total</dt><dd><button class="qt-btn" style="padding:3px 9px;font-size:12px" id="calcSize">Work it out</button></dd>` + extra;
    if (st.readonly) extra += `<dt>Access</dt><dd>Read-only</dd>`;
    meta.insertAdjacentHTML("beforeend", extra);
    if (st.zip) $("#pvMore").innerHTML = `<p class="cutnote">${nice(st.zip.count)} files inside · ${human(st.zip.size)} unpacked</p><ul class="ziplist">${st.zip.names.map(n => `<li>${esc(n)}</li>`).join("")}</ul>`;
    $("#calcSize")?.addEventListener("click", async ev => {
      const b = ev.currentTarget; b.textContent = "Counting…"; b.disabled = true;
      try { const r = await api("/api/dirsize?path=" + enc(p)); b.replaceWith(document.createTextNode(`${human(r.size)} in ${nice(r.files)} files${r.partial ? " (so far)" : ""}`)); } catch (er) { b.textContent = "Couldn't count"; }
    });
  } catch {}
  if (!e.d && (TEXTY.has(x) || (k === "other" && e.s < 512 * 1024)) && !PLAYABLE_A.has(x) && !PLAYABLE_V.has(x)) {
    try {
      const r = await api("/api/text?path=" + enc(p));
      if (pvKey !== myKey || r.binary) return;
      const lines = r.text.split(/\r?\n/).slice(0, 800);
      $("#pvStage").outerHTML = `<pre class="code">${lines.map(l => `<span>${esc(l) || " "}</span>`).join("")}</pre>${r.cut || lines.length >= 800 ? '<p class="cutnote">Showing the start of the file.</p>' : ""}`;
    } catch {}
  }
}
const actBtn = (act, icon, label, cls = "", extra = "") => `<button class="qt-btn ${cls} ${extra}" data-act="${act}">${svg(icon)}${esc(label)}</button>`;
const tipsHtml = () => `<div class="pv-tip"><b>Shortcuts</b><br><kbd>Space</kbd> quick look · <kbd>F2</kbd> rename · <kbd>Del</kbd> recycle<br><kbd>Ctrl C</kbd>/<kbd>X</kbd>/<kbd>V</kbd> works with Windows Explorer too<br><kbd>Ctrl T</kbd> tab · <kbd>Ctrl K</kbd> jump · <kbd>Ctrl Z</kbd> undo<br>Type a name to jump to it.</div>`;

/* ---------------------------------------------------------------- actions - */
async function act(name, list = selected()) {
  const paths = list.map(e => pathOf(e));
  const one = list[0];
  switch (name) {
    case "open": return one && (list.length === 1 ? openEntry(one) : list.forEach(e => !e.d && openFile(pathOf(e))));
    case "newtab": return list.filter(e => e.d).forEach(e => openTab(pathOf(e), false)), toast("Opened in a new tab");
    case "with": return one && openFile(paths[0], "with");
    case "locate": { if (!one) return; return go(dirName(paths[0]), { focusName: one.n }); }
    case "reveal": return openFile(paths[0] || tab().path, "reveal");
    case "terminal": return openFile(one && one.d ? paths[0] : tab().path, "terminal");
    case "code": return openFile(paths[0], "code");
    case "props": return openFile(paths[0] || tab().path, "props");
    case "copypath": {
      const txt = paths.join("\r\n");
      try { await navigator.clipboard.writeText(txt); } catch { await api("/api/clip", { text: txt }); }
      return toast(paths.length > 1 ? `Copied ${paths.length} paths` : "Copied the path");
    }
    case "copy": case "cut": {
      if (!paths.length) return;
      await api("/api/clip", { paths, cut: name === "cut" }).catch(fail);
      S.cut = name === "cut" ? new Set(paths.map(p => p.toLowerCase())) : new Set();
      S.dirty = true; renderRows();
      return toast(`${name === "cut" ? "Cut" : "Copied"} ${paths.length} item${paths.length === 1 ? "" : "s"}. Paste here or in Explorer.`);
    }
    case "paste": return paste();
    case "rename": return list.length > 1 ? renameMany(list) : one && startRename(one);
    case "trash": return trash(list);
    case "zip": return paths.length && api("/api/zip", { paths }).then(trackJob).catch(fail);
    case "unzip": return one && api("/api/unzip", { path: paths[0] }).then(trackJob).catch(fail);
    case "pin": return one && togglePin(paths[0]);
    case "beam": return sendBeam(paths);
    case "lens": return sendBeam(paths.filter((p, i) => ["image", "video"].includes(kindOf(list[i]))), true);
    case "pixlab": case "inkmotion": return handoff(name, paths[0]);
    case "quick": return one && lightbox(tab().view.indexOf(one));
    case "duplicate": return paths.length && api("/api/transfer", { paths, dest: dirName(paths[0]) }).then(trackJob).catch(fail);
    case "newfolder": return newFolder();
    case "newfile": return newFile();
  }
}
function flyTo(from, target, html, color) {
  if (!from || !target || reduced()) return;
  const a = from.getBoundingClientRect(), b = target.getBoundingClientRect();
  const f = document.createElement("div"); f.className = "fly"; f.innerHTML = html; f.style.setProperty("--c", color);
  f.style.left = a.left + a.width / 2 - 17 + "px"; f.style.top = a.top + a.height / 2 - 17 + "px";
  document.body.append(f);
  const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
  f.animate([{ transform: "translate(0,0) scale(.6) rotate(0)", opacity: 0 },
             { transform: `translate(${dx * .35}px, ${dy * .35 - 90}px) scale(1.15) rotate(-12deg)`, opacity: 1, offset: .4 },
             { transform: `translate(${dx}px, ${dy}px) scale(.45) rotate(8deg)`, opacity: .9 }],
            { duration: 720, easing: "cubic-bezier(.5,0,.4,1)" }).onfinish = () => {
    f.remove(); target.classList.remove("bump"); void target.offsetWidth; target.classList.add("bump");
  };
}
async function sendBeam(paths, lens) {
  if (!paths.length) return toast("Pick some files first", { bad: true });
  const src = document.activeElement && document.activeElement.closest && document.activeElement.closest("[data-act], [data-lb]") || $("#rows .sel") || $("#rows .cur");
  flyTo(src, $("#stBeam"), svg(lens ? "lens" : "phone"), lens ? "var(--qt-lens)" : "var(--qt-beam)");
  toast(S.status.beam ? "Sending to Beam…" : "Waking up Beam…", { ms: 1400 });
  try {
    const r = await api("/api/beam", { paths });
    toast(lens ? `${r.count} on the Beam shelf. Save them on the phone and Lens picks them up.` : `${r.count} item${r.count === 1 ? "" : "s"} on the Beam shelf. Grab ${r.count === 1 ? "it" : "them"} on your phone.`, { ms: 4200 });
    pollStatus();
  } catch (e) { fail(e); }
}
function handoff(tool, p) {
  const w = window.open(`/handoff/${tool}?path=${enc(p)}`, "_blank");
  if (!w) toast("Your browser blocked the new window", { bad: true });
  else toast(`Opening ${baseName(p)} in ${tool === "pixlab" ? "Pixlab" : "Inkmotion"}`);
}
function togglePin(p) {
  const pins = S.prefs.pins || (S.prefs.pins = []);
  const i = pins.findIndex(x => x.toLowerCase() === p.toLowerCase());
  if (i >= 0) { pins.splice(i, 1); toast("Unpinned " + baseName(p)); }
  else { pins.push(p); toast("Pinned " + baseName(p)); }
  renderSide(); savePrefs(); pvKey = null; renderPreview();
  if (tab().path === HOME) renderHome();
}
async function paste(dest = tab().path) {
  if (dest === HOME || tab().search && dest === tab().path) return toast("Open a folder to paste into", { bad: true });
  try {
    const r = await api("/api/paste", { dest });
    if (r.saved) { toast("Saved the picture as " + baseName(r.saved)); await refresh(true); flash(baseName(r.saved)); return; }
    S.cut = new Set(); trackJob(r);
  } catch (e) { fail(e); }
}
async function trash(list) {
  if (!list.length) return;
  const names = list.length === 1 ? `“${list[0].n}”` : `${list.length} items`;
  if (!await confirmBox("Move to Recycle Bin?", `${names} will go to the Recycle Bin. You can restore from there.`, "Recycle", true)) return;
  try {
    await api("/api/trash", { paths: list.map(e => pathOf(e)) });
    const t = tab(), keys = new Set(list.map(keyOf));
    const gone = $$("#rows [data-i]").filter(n => { const e = t.view[+n.dataset.i]; return e && keys.has(keyOf(e)); });
    if (gone.length && !reduced()) { gone.forEach((n, k) => { n.style.setProperty("--k", Math.min(k, 12)); n.classList.add("gone"); }); await sleep(260 + Math.min(gone.length, 12) * 18); }
    const first = Math.min(...list.map(e => t.view.indexOf(e)).filter(i => i >= 0));
    const drop = arr => arr.filter(e => !keys.has(e.p ? join(e.p, e.n) : join(t.path, e.n)));
    t.entries = drop(t.entries); if (t.search) t.search.results = drop(t.search.results);
    t.sel.clear(); computeView(t); t.cur = Math.min(first, t.view.length - 1);
    if (t.cur >= 0) t.sel.add(keyOf(t.view[t.cur]));
    layoutRows(); renderChips(); renderEmpty(); updateStatus(); pvKey = null; renderPreview();
    pollJobs();
    toast(`Recycled ${names}`, { action: "Undo", onAction: doUndo, ms: 6000 });
  } catch (e) { fail(e); }
}
async function newFolder() {
  const t = tab();
  if (t.path === HOME || t.search) return toast("Open a folder first", { bad: true });
  try {
    const r = await api("/api/mkdir", { dir: t.path, name: "New folder" });
    await refresh(true);
    const i = t.view.findIndex(e => pathOf(e).toLowerCase() === r.path.toLowerCase());
    if (i >= 0) { setCur(i); startRename(t.view[i], true); }
    pollJobs();
  } catch (e) { fail(e); }
}
async function newFile() {
  const t = tab();
  if (t.path === HOME || t.search) return toast("Open a folder first", { bad: true });
  try {
    const r = await api("/api/newfile", { dir: t.path, name: "New text file.txt" });
    await refresh(true);
    const i = t.view.findIndex(e => pathOf(e).toLowerCase() === r.path.toLowerCase());
    if (i >= 0) { setCur(i); startRename(t.view[i], true); }
  } catch (e) { fail(e); }
}
function startRename(e, fresh) {
  const t = tab(), i = t.view.indexOf(e);
  if (i < 0) return;
  setCur(i); ensureVisible(i); renderRows(true);
  const n = $(`#rows [data-i="${i}"] .nm`);
  if (!n) return;
  const inp = document.createElement("input");
  inp.className = "rn"; inp.value = e.n; inp.spellcheck = false;
  n.replaceWith(inp);
  inp.focus();
  const dot = e.d ? -1 : e.n.lastIndexOf(".");
  inp.setSelectionRange(0, dot > 0 ? dot : e.n.length);
  let done = false;
  const finish = async ok => {
    if (done) return; done = true;
    const name = inp.value.trim();
    if (!ok || !name || name === e.n) { S.dirty = true; renderRows(true); $("#pane").focus(); return; }
    try {
      const r = await api("/api/rename", { path: pathOf(e), name });
      e.n = baseName(r.path);
      computeView(t);
      const j = t.view.indexOf(e);
      t.sel.clear(); if (j >= 0) { t.sel.add(keyOf(e)); t.cur = j; }
      layoutRows(); ensureVisible(j); renderRows(true); flash(e.n);
      pvKey = null; renderPreview(); pollJobs();
    } catch (er) { fail(er); S.dirty = true; renderRows(true); }
    $("#pane").focus();
  };
  inp.addEventListener("keydown", ev => { ev.stopPropagation(); if (ev.key === "Enter") finish(true); if (ev.key === "Escape") finish(false); });
  inp.addEventListener("blur", () => finish(true));
  inp.addEventListener("mousedown", ev => ev.stopPropagation());
  inp.addEventListener("dblclick", ev => ev.stopPropagation());
}
function renameMany(list) {
  const t = tab();
  const stems = list.map(e => e.d ? e.n : e.n.replace(/\.[^.]+$/, ""));
  let pre = stems[0]; for (const x of stems) while (pre && !x.toLowerCase().startsWith(pre.toLowerCase())) pre = pre.slice(0, -1);
  pre = pre.replace(/[\s_(-]+\d*$/, "").trim() || baseName(t.search ? t.search.root : t.path) || "File";
  const m = openModal(`<div class="qt-eyebrow">Rename ${list.length} items</div><h2>Rename all at once</h2>
    <div class="modes"><button class="chip on" data-rmode="num">Number them</button><button class="chip" data-rmode="swap">Find &amp; replace</button></div>
    <div class="rm-f" data-for="num"><input class="qt-input" id="rmBase" value="${esc(pre)}" spellcheck="false" placeholder="New name"><input class="qt-input" id="rmStart" type="number" value="1" min="0" style="width:90px" title="First number"></div>
    <div class="rm-f" data-for="swap" hidden><input class="qt-input" id="rmFind" placeholder="Find" spellcheck="false"><input class="qt-input" id="rmRep" placeholder="Replace with" spellcheck="false"></div>
    <ol class="rm-prev" id="rmPrev"></ol>
    <div class="row2"><button class="qt-btn" data-x>Cancel</button><button class="qt-btn primary" id="rmGo">${svg("rename")}Rename</button></div>`);
  let mode = "num";
  const names = () => {
    if (mode === "num") {
      const base = $("#rmBase").value.trim(), st = Math.max(0, parseInt($("#rmStart").value) || 0);
      const w = String(st + list.length - 1).length;
      return list.map((e, i) => { const x = e.d ? "" : (e.n.match(/\.[^.]+$/) || [""])[0]; return `${base} ${String(st + i).padStart(w, "0")}${x}`; });
    }
    const f = $("#rmFind").value, r = $("#rmRep").value;
    if (!f) return list.map(e => e.n);
    const re = new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    return list.map(e => e.n.replace(re, r));
  };
  const paint = () => {
    const nn = names();
    $("#rmPrev").innerHTML = list.slice(0, 7).map((e, i) => `<li style="--i:${i}"><span>${esc(e.n)}</span><b>${esc(nn[i])}</b></li>`).join("") + (list.length > 7 ? `<li class="more">…and ${list.length - 7} more</li>` : "");
  };
  m.addEventListener("click", ev => { const b = ev.target.closest("[data-rmode]"); if (!b) return; mode = b.dataset.rmode;
    $$("[data-rmode]", m).forEach(x => x.classList.toggle("on", x === b)); $$(".rm-f", m).forEach(f => (f.hidden = f.dataset.for !== mode)); paint(); $(mode === "num" ? "#rmBase" : "#rmFind").focus(); });
  m.addEventListener("input", paint);
  const goNow = async () => {
    const nn = names();
    try {
      const r = await api("/api/renamemany", { items: list.map((e, i) => ({ path: pathOf(e), name: nn[i] })) });
      closeModal();
      await refresh(true);
      t.sel = new Set(r.paths.map(p => (t.search ? p : join(t.path, baseName(p)))));
      renderRows(true); updateStatus();
      r.paths.slice(0, 30).forEach(p => flash(baseName(p)));
      toast(`Renamed ${r.count} item${r.count === 1 ? "" : "s"}`, { action: "Undo", onAction: doUndo });
      pollJobs();
    } catch (e) { m.classList.remove("shake"); void m.offsetWidth; m.classList.add("shake"); fail(e); }
  };
  $("#rmGo").onclick = goNow;
  m.addEventListener("keydown", ev => { if (ev.key === "Enter" && ev.target.matches("input")) goNow(); });
  paint(); setTimeout(() => $("#rmPrev")?.classList.add("settled"), 600); $("#rmBase").focus(); $("#rmBase").select();
}
function flash(name) {
  const t = tab(), i = t.view.findIndex(e => e.n === name);
  if (i < 0) return;
  setTimeout(() => { const n = $(`#rows [data-i="${i}"]`); if (n) { n.classList.remove("landed"); void n.offsetWidth; n.classList.add("landed"); } }, 30);
}
async function doUndo() {
  try {
    const r = await api("/api/undo", {});
    toast(r.msg, { bad: !r.ok && r.msg !== "Nothing to undo" });
    await refresh(true); pollJobs();
  } catch (e) { fail(e); }
}

/* ---------------------------------------------------------------- jobs ---- */
const watching = new Set();
let jobTimer = 0;
function trackJob(j) { if (j && j.id) { watching.add(j.id); pollJobs(); } }
async function pollJobs() {
  clearTimeout(jobTimer);
  let r;
  try { r = await api("/api/jobs"); } catch { return; }
  S.undo = r.undo; updateStatus();
  const dock = $("#jobs");
  const items = [...r.jobs.filter(j => watching.has(j.id)).map(j => ({ ...j, _t: "job" })),
                 ...r.grabs.filter(g => watching.has("v" + g.id)).map(g => ({ ...g, id: "v" + g.id, _t: "volt" }))];
  for (const j of items) {
    let n = dock.querySelector(`[data-job="${j.id}"]`);
    if (!n) {
      n = document.createElement("div"); n.className = "job qt-card" + (j._t === "volt" ? " volt" : ""); n.dataset.job = j.id;
      n.innerHTML = `<div class="h"><span></span><button data-cancel="${j.id}">Stop</button></div><div class="qt-bar"><i></i></div><small></small>`;
      dock.prepend(n);
    }
    const pct = j._t === "volt" ? (j.pct || 0) : (j.total ? Math.min(100, j.done / j.total * 100) : (j.state === "done" ? 100 : 5));
    let rate = "";
    if (j._t === "job" && j.state === "running") {
      const now = performance.now(), l = n._last;
      if (l && now > l.t && j.done >= l.d) { const sp = (j.done - l.d) / ((now - l.t) / 1000); n._sp = n._sp ? n._sp * .7 + sp * .3 : sp; }
      n._last = { t: now, d: j.done };
      if (n._sp > 1e5 && j.total) { const left = (j.total - j.done) / n._sp; rate = ` · ${human(n._sp)}/s${left > 2 ? " · " + (left < 90 ? Math.round(left) + " s" : Math.round(left / 60) + " min") + " left" : ""}`; }
    }
    n.querySelector(".h span").textContent = j._t === "volt" ? "VOLT · " + (j.title || j.url) : j.label;
    n.querySelector("i").style.width = (j.state === "done" ? 100 : pct) + "%";
    n.querySelector("small").textContent = j.state === "error" ? (j.error || "Failed") : j.state === "done" ? "Done" :
      j._t === "volt" ? `${j.state}${j.speed ? " · " + j.speed : ""}${j.eta ? " · " + j.eta + " left" : ""}` : `${human(j.done)} of ${human(j.total)}${rate}${j.current && !rate ? " · " + j.current : ""}`;
    const final = ["done", "error", "cancelled"].includes(j.state);
    if (final && !S.jobsSeen.has(j.id)) {
      S.jobsSeen.add(j.id);
      n.classList.add(j.state === "done" ? "done" : "err");
      n.querySelector("[data-cancel]")?.remove();
      watching.delete(j.id);
      const target = j._t === "volt" ? j.path : (j.result || [])[0];
      if (j.state === "done" && target) {
        const b = document.createElement("button"); b.className = "qt-btn go"; b.textContent = "Show it";
        b.onclick = () => go(dirName(target), { focusName: baseName(target) });
        n.append(b);
        const cur = tab();
        if (cur.path !== HOME && !cur.search && dirName(target).toLowerCase() === cur.path.toLowerCase()) refresh(true).then(() => flash(baseName(target)));
      }
      if (j.state === "error") toast(j.error || "That didn't work", { bad: true });
      setTimeout(() => { n.classList.add("out"); setTimeout(() => n.remove(), 320); }, j.state === "done" ? 6000 : 9000);
    }
  }
  if (watching.size) jobTimer = setTimeout(pollJobs, 450);
}

/* ---------------------------------------------------------------- status -- */
async function pollStatus() {
  try {
    S.status = await api("/api/status");
    $("#stBeam .qt-dot").className = "qt-dot" + (S.status.beam ? " on" : "");
    $("#stVolt .qt-dot").className = "qt-dot" + (S.status.volt ? " on" : "");
    $("#stBeam").title = S.status.beam ? "Beam is running. Click to open the Beam inbox." : "Beam is off. It starts when you send something.";
    $("#stVolt").title = S.status.volt ? "VOLT is running. Click to see its downloads." : "VOLT is off. It starts when you grab a link.";
  } catch {}
}

/* ---------------------------------------------------------------- VOLT ---- */
async function grabLink() {
  let pre = "";
  try { const c = await navigator.clipboard.readText(); if (/^https?:\/\//i.test(c.trim())) pre = c.trim(); } catch {}
  const modal = openModal(`<div class="qt-eyebrow" style="color:var(--qt-volt)">VOLT</div><h2>Grab a link</h2>
    <p>Paste a video, music or image link. VOLT downloads it to <b>${esc(baseName(S.boot.tools.find(t => t.icon === "volt")?.path || "Downloads\\VOLT"))}</b> and Burrow shows you the file.</p>
    <input class="qt-input" id="grabUrl" placeholder="https://…" value="${esc(pre)}" spellcheck="false">
    <div class="modes">${[["video", "Video"], ["audio", "Audio (mp3)"], ["best", "Best quality"]].map(([m, l], i) => `<button class="chip${i ? "" : " on"}" data-mode="${m}">${l}</button>`).join("")}</div>
    <div class="row2"><button class="qt-btn" data-x>Cancel</button><button class="qt-btn volt" id="grabGo">${svg("volt")}Download</button></div>`);
  let mode = "video";
  const inp = $("#grabUrl"); inp.focus(); inp.select();
  modal.addEventListener("click", e => { const m = e.target.closest("[data-mode]"); if (m) { mode = m.dataset.mode; $$("[data-mode]", modal).forEach(b => b.classList.toggle("on", b === m)); } });
  const goNow = async () => {
    const url = inp.value.trim();
    if (!/^https?:\/\//i.test(url)) { modal.classList.remove("shake"); void modal.offsetWidth; modal.classList.add("shake"); return; }
    closeModal();
    try { const g = await api("/api/volt", { url, mode }); trackJob({ id: "v" + g.id }); toast(S.status.volt ? "VOLT is on it" : "Waking up VOLT…"); }
    catch (e) { fail(e); }
  };
  $("#grabGo").onclick = goNow;
  inp.addEventListener("keydown", e => { if (e.key === "Enter") goNow(); });
}

/* ---------------------------------------------------------------- modal --- */
let modalResolve = null;
function openModal(html) {
  const m = $("#modal");
  m.innerHTML = html; m.hidden = false; $("#scrim").hidden = false;
  m.style.animation = "none"; void m.offsetWidth; m.style.animation = "";
  m.querySelectorAll("[data-x]").forEach(b => (b.onclick = () => closeModal(false)));
  return m;
}
function closeModal(v) { $("#modal").hidden = true; $("#scrim").hidden = true; if (modalResolve) { modalResolve(v); modalResolve = null; } $("#pane").focus(); }
function confirmBox(title, text, yes, bad) {
  return new Promise(res => {
    openModal(`<h2>${esc(title)}</h2><p>${esc(text)}</p><div class="row2"><button class="qt-btn" data-x>Cancel</button><button class="qt-btn ${bad ? "danger" : "primary"}" id="yesBtn">${esc(yes)}</button></div>`);
    modalResolve = res;
    $("#yesBtn").onclick = () => closeModal(true);
    $("#yesBtn").focus();
  });
}

/* ---------------------------------------------------------------- menu ---- */
function mi(act, icon, label, key = "", cls = "", color = "") { return { act, icon, label, key, cls, color }; }
function openMenu(x, y, items) {
  const m = $("#menu");
  m.innerHTML = items.map(it => it === "-" ? "<hr>" : typeof it === "string" ? `<div class="lbl">${esc(it)}</div>` :
    `<button data-mact="${it.act}" class="${it.cls}" ${it.color ? `style="--c:${it.color}"` : ""}>${it.color ? '<i class="sw"></i>' : svg(it.icon)}<span>${esc(it.label)}</span>${it.key ? `<span class="k">${esc(it.key)}</span>` : ""}</button>`).join("");
  m.hidden = false;
  m.style.animation = "none";
  const r = { width: m.offsetWidth, height: m.offsetHeight }; // unscaled size (the pop animation shrinks the rect)
  const left = Math.min(x, innerWidth - r.width - 8), top = Math.min(y, innerHeight - r.height - 8);
  m.style.left = Math.max(8, left) + "px"; m.style.top = Math.max(8, top) + "px";
  m.style.setProperty("--ox", (x - left) + "px"); m.style.setProperty("--oy", (y - top) + "px");
  m.style.animation = "none"; void m.offsetWidth; m.style.animation = "";
}
function closeMenu() { $("#menu").hidden = true; }
function itemMenu(x, y) {
  const list = selected();
  if (!list.length) return bgMenu(x, y);
  const one = list.length === 1 ? list[0] : null, k = one ? kindOf(one) : null, ext = one ? "." + extOf(one.n) : "";
  const h = S.boot.handoff || {};
  const media = list.some(e => ["image", "video"].includes(kindOf(e)));
  const items = [];
  items.push(mi("open", "open", "Open", "Enter"));
  if (one && one.p) items.push(mi("locate", "folder", "Open file location"));
  if (list.some(e => e.d)) items.push(mi("newtab", "tab", "Open in new tab", "Ctrl Enter"));
  if (one && !one.d) items.push(mi("with", "with", "Open with…"));
  if (one && k && ["image", "video"].includes(k)) items.push(mi("quick", "eye", "Quick look", "Space"));
  items.push("-", "Send to your tools");
  items.push(mi("beam", "phone", "Send to phone (Beam)", "", "", "var(--qt-beam)"));
  if (media) items.push(mi("lens", "lens", "Send to Lens (phone gallery)", "", "", "var(--qt-lens)"));
  if (one && (h.pixlab || []).includes(ext)) items.push(mi("pixlab", "pixlab", "Open in Pixlab", "", "", "var(--qt-pixlab)"));
  if (one && (h.inkmotion || []).includes(ext)) items.push(mi("inkmotion", "inkmotion", k === "image" ? "Trace over in Inkmotion" : "Open in Inkmotion", "", "", "var(--qt-inkmotion)"));
  if (one && S.boot.code && !one.d) items.push(mi("code", "code", "Edit in VS Code"));
  items.push("-");
  items.push(mi("cut", "cut", "Cut", "Ctrl X"), mi("copy", "copy", "Copy", "Ctrl C"), mi("paste", "paste", "Paste", "Ctrl V"), mi("duplicate", "copy", "Duplicate"));
  items.push(mi("rename", "rename", one ? "Rename" : `Rename ${list.length} items…`, "F2"));
  items.push(mi("zip", "zip", "Compress to .zip"));
  if (one && [".zip", ".apk"].includes(ext)) items.push(mi("unzip", "zip", "Extract here"));
  items.push("-");
  if (one && one.d) items.push(mi("pin", "pin", (S.prefs.pins || []).some(p => p.toLowerCase() === pathOf(one).toLowerCase()) ? "Unpin from sidebar" : "Pin to sidebar", "Ctrl D"));
  items.push(mi("copypath", "link", list.length > 1 ? "Copy paths" : "Copy path", "Ctrl Shift C"), mi("reveal", "explorer", "Show in Explorer"));
  if (one && one.d) items.push(mi("terminal", "term", "Open terminal here"));
  if (one) items.push(mi("props", "props", "Windows properties", "Alt Enter"));
  items.push("-", mi("trash", "trash", "Move to Recycle Bin", "Del", "bad"));
  openMenu(x, y, items);
}
function bgMenu(x, y) {
  const t = tab();
  if (t.path === HOME) return;
  openMenu(x, y, [mi("newfolder", "plus", "New folder", "Ctrl Shift N"), mi("newfile", "file", "New text file"), mi("paste", "paste", "Paste", "Ctrl V"), "-",
    mi("refresh", "undo", "Refresh", "F5"), mi("view", S.prefs.view === "grid" ? "list" : "grid", S.prefs.view === "grid" ? "List view" : "Grid view", "Ctrl G"),
    mi("hidden", "hidden", S.prefs.hidden ? "Hide hidden files" : "Show hidden files", "Ctrl H"), "-",
    mi("pinhere", "pin", (S.prefs.pins || []).some(p => p.toLowerCase() === t.path.toLowerCase()) ? "Unpin this folder" : "Pin this folder"),
    mi("copyhere", "link", "Copy this folder's path"), mi("revealhere", "explorer", "Open in Explorer"), mi("termhere", "term", "Open terminal here"), mi("propshere", "props", "Windows properties")]);
}
function moreMenu(x, y) {
  openMenu(x, y, [mi("view", S.prefs.view === "grid" ? "list" : "grid", S.prefs.view === "grid" ? "List view" : "Grid view", "Ctrl G"),
    mi("hidden", "hidden", S.prefs.hidden ? "Hide hidden files" : "Show hidden files", "Ctrl H"),
    mi("sidebar", "side", S.prefs.sidebar === false ? "Show sidebar" : "Hide sidebar", "Ctrl B"),
    mi("preview", "eye", S.prefs.preview ? "Hide preview" : "Show preview", "Ctrl P"), "-",
    mi("selall", "sel", "Select all", "Ctrl A"), mi("undo", "undo", S.undo ? "Undo " + S.undo.toLowerCase() : "Undo", "Ctrl Z"), "-",
    mi("palette", "eye", "Jump anywhere…", "Ctrl K"), mi("grab", "volt", "Grab a link with VOLT", "Ctrl D", "", "var(--qt-volt)"),
    mi("recycle", "trash", "Open Recycle Bin")]);
}
function sortMenu(x, y) {
  const s = S.prefs.sort;
  openMenu(x, y, ["Sort by", ...[["name", "Name"], ["mtime", "Date modified"], ["size", "Size"], ["type", "Type"]].map(([k, l]) => mi("sort:" + k, s === k ? "sel" : "list", l)), "-",
    mi("sortdir", "undo", S.prefs.desc ? "Ascending" : "Descending")]);
}
async function menuAct(a) {
  closeMenu();
  const t = tab();
  if (a.startsWith("sort:")) { setSort(a.slice(5)); return; }
  switch (a) {
    case "sortdir": S.prefs.desc = !S.prefs.desc; resort(); return;
    case "refresh": return refresh();
    case "view": return toggleView();
    case "hidden": return toggleHidden();
    case "sidebar": S.prefs.sidebar = S.prefs.sidebar === false; applyPrefs(); savePrefs(); setTimeout(layoutRows, 380); return;
    case "preview": return togglePreview();
    case "selall": return selectAll();
    case "undo": return doUndo();
    case "palette": return openPalette();
    case "grab": return grabLink();
    case "recycle": return openFile("shell:RecycleBinFolder");
    case "pinhere": return togglePin(t.path);
    case "copyhere": return act("copypath", [{ n: baseName(t.path), p: dirName(t.path) || t.path, d: true }]);
    case "revealhere": return openFile(t.path, "default");
    case "termhere": return openFile(t.path, "terminal");
    case "propshere": return openFile(t.path, "props");
    default: return act(a);
  }
}
function setSort(k) {
  if (S.prefs.sort === k) S.prefs.desc = !S.prefs.desc;
  else { S.prefs.sort = k; S.prefs.desc = k === "mtime" || k === "size"; }
  if (tab().search) tab().search.rank = false;
  resort();
}
function resort() { const t = tab(); const cur = t.view[t.cur]; computeView(t); t.cur = cur ? t.view.indexOf(cur) : -1; t.enter = "same"; applyPrefs(); layoutRows(); savePrefs(); }
function toggleView() { S.prefs.view = S.prefs.view === "grid" ? "list" : "grid"; tab().enter = "same"; renderAll(); savePrefs(); }
function toggleHidden() { S.prefs.hidden = !S.prefs.hidden; const t = tab(); computeView(t); layoutRows(); renderChips(); renderEmpty(); updateStatus(); savePrefs(); toast(S.prefs.hidden ? "Showing hidden files" : "Hiding hidden files"); }
function togglePreview() { S.prefs.preview = !S.prefs.preview; applyPrefs(); savePrefs(); pvKey = null; if (S.prefs.preview) renderPreview(); setTimeout(layoutRows, 380); }
function selectAll() { const t = tab(); t.view.forEach(e => t.sel.add(keyOf(e))); renderRows(); updateStatus(); schedulePreview(); }

/* ---------------------------------------------------------------- palette - */
let palItems = [], palIdx = 0;
function openPalette() {
  $("#palette").hidden = false; $("#scrim").hidden = false;
  const inp = $("#palIn"); inp.value = ""; inp.focus();
  palFill();
}
function closePalette() { $("#palette").hidden = true; $("#scrim").hidden = true; $("#pane").focus(); }
function fuzzy(text, q) {
  text = text.toLowerCase(); q = q.toLowerCase();
  if (!q) return 1;
  const i = text.indexOf(q);
  if (i >= 0) return 100 - i + (text.startsWith(q) ? 50 : 0);
  let ti = 0, score = 0;
  for (const c of q) { const f = text.indexOf(c, ti); if (f < 0) return 0; score += f === ti ? 3 : 1; ti = f + 1; }
  return score;
}
async function palFill() {
  const q = $("#palIn").value.trim();
  const b = S.boot;
  const src = [
    ...b.places.map(p => ({ g: "Place", t: p.name, s: p.path, icon: p.icon, c: PLACE_COLOR[p.icon], run: nt => nav(p.path, nt) })),
    ...b.tools.map(p => ({ g: "Tool folder", t: p.name, s: p.path, icon: p.icon, c: PLACE_COLOR[p.icon], run: nt => nav(p.path, nt) })),
    ...(S.prefs.pins || []).map(p => ({ g: "Pinned", t: baseName(p), s: p, icon: "pin", c: "var(--qt-burrow)", run: nt => nav(p, nt) })),
    ...b.drives.map(d => ({ g: "Drive", t: d.label + " (" + d.path.slice(0, 2) + ")", s: human(d.free) + " free", icon: "drive", c: "var(--k-doc)", run: nt => nav(d.path, nt) })),
    ...(S.prefs.recent || []).slice(0, 25).map(r => ({ g: r.kind === "dir" ? "Recent folder" : "Recent file", t: baseName(r.path), s: r.path, icon: r.kind === "dir" ? "folder" : "file", run: nt => r.kind === "dir" ? nav(r.path, nt) : openFile(r.path) })),
    { g: "Action", t: "Grab a link with VOLT", s: "Download video, audio or images", icon: "volt", c: "var(--qt-volt)", run: grabLink },
    { g: "Action", t: "New tab", s: "Ctrl T", icon: "tab", run: () => openTab() },
    { g: "Action", t: "New folder", s: "Ctrl Shift N", icon: "plus", run: newFolder },
    { g: "Action", t: S.prefs.hidden ? "Hide hidden files" : "Show hidden files", s: "Ctrl H", icon: "hidden", run: toggleHidden },
    { g: "Action", t: S.prefs.view === "grid" ? "List view" : "Grid view", s: "Ctrl G", icon: "grid", run: toggleView },
    { g: "Action", t: "Open Recycle Bin", s: "", icon: "trash", run: () => openFile("shell:RecycleBinFolder") },
    { g: "Action", t: "Open this folder in Explorer", s: "", icon: "explorer", run: () => tab().path !== HOME && openFile(tab().path) },
    { g: "Action", t: "Open Beam", s: "Phone sharing", icon: "beam", c: "var(--qt-beam)", run: () => api("/api/launch", { tool: "beam" }).then(() => window.open("http://127.0.0.1:7788/", "_blank")).catch(fail) },
  ];
  let list = src.map(x => ({ ...x, sc: Math.max(fuzzy(x.t, q) * 2, fuzzy(x.s || "", q)) })).filter(x => x.sc > 0);
  if (q) list.sort((a, b) => b.sc - a.sc);
  list = list.slice(0, 40);
  if (q && (/^[A-Za-z]:|^[\\/~%]/.test(q))) {
    const sug = await api("/api/complete?q=" + enc(q)).catch(() => []);
    list.unshift({ g: "Go to", t: q, s: "Open this path", icon: "open", c: "var(--qt-burrow)", run: nt => nav(q, nt) },
      ...sug.map(p => ({ g: "Folder", t: baseName(p), s: p, icon: "folder", c: "var(--k-folder)", run: nt => nav(p, nt) })));
  } else if (q) {
    list.push({ g: "Search", t: `Search “${q}”`, s: "in " + (tab().path === HOME ? "your user folder" : tab().path), icon: "eye", c: "var(--qt-burrow)", run: () => { $("#q").value = q; $("#qClear").hidden = false; runSearch(q); } });
  }
  palItems = list; palIdx = 0;
  paintPal();
}
function paintPal() {
  $("#palList").innerHTML = palItems.map((x, i) => `<button class="${i === palIdx ? "on" : ""}" data-pal="${i}"><span class="gi" style="--c:${x.c || "var(--qt-chip)"}">${svg(x.icon)}</span><span class="t">${esc(x.t)}</span><span class="s">${esc(x.s || "")}</span><span class="g">${esc(x.g)}</span></button>`).join("") ||
    '<div class="qt-muted" style="padding:14px">No matches. Try a path like C:\\Users</div>';
  $("#palList .on")?.scrollIntoView({ block: "nearest" });
}
function palRun(i, nt) { const x = palItems[i]; if (!x) return; closePalette(); x.run(nt); }
function nav(p, newTabToo) { if (newTabToo) openTab(p); else go(p); }

/* ---------------------------------------------------------------- lightbox  */
let lbIdx = -1;
function lightbox(i) {
  const t = tab();
  const media = t.view.map((e, k) => [e, k]).filter(([e]) => ["image", "video"].includes(kindOf(e)));
  if (!media.length) return;
  lbIdx = i;
  const e = t.view[i];
  if (!e || !["image", "video"].includes(kindOf(e))) return;
  const p = pathOf(e), x = extOf(e.n);
  const pos = media.findIndex(([, k]) => k === i);
  const lb = $("#lightbox");
  lb.hidden = false;
  const viewable = THUMBABLE.has(x) || x === "svg";
  lb.innerHTML = `<div class="lb-top"><b>${esc(e.n)}</b><button class="qt-btn beam" data-lb="beam">${svg("phone")}Phone</button><button class="qt-btn" data-lb="open">${svg("open")}Open</button><button class="qt-btn" data-lb="x">Close <kbd>Esc</kbd></button></div>
    <div class="lb-stage">${kindOf(e) === "video" ? (PLAYABLE_V.has(x) ? `<video src="/api/raw?path=${enc(p)}" controls autoplay></video>` : `<img src="/api/thumb?s=1024&path=${enc(p)}" alt="">`)
      : viewable ? `<img src="${["gif", "svg", "webp", "png", "jpg", "jpeg"].includes(x) ? "/api/raw?path=" + enc(p) : "/api/thumb?s=1024&path=" + enc(p)}" alt="">` : fileIcon(e)}
      <button class="qt-btn nav l" data-lb="prev" title="Previous (←)">${svg("list").replace(I.list, '<path d="M15 5 8 12l7 7"/>')}</button>
      <button class="qt-btn nav r" data-lb="next" title="Next (→)">${svg("list").replace(I.list, '<path d="m9 5 7 7-7 7"/>')}</button></div>
    <div class="lb-foot">${pos + 1} / ${media.length} · ${human(e.s)} · click the picture for 100%</div>`;
  lb._media = media; lb._pos = pos;
  setCur(i);
}
function lbStep(d) {
  const lb = $("#lightbox"); if (lb.hidden) return;
  const m = lb._media; const pos = (lb._pos + d + m.length) % m.length;
  lightbox(m[pos][1]);
}
function closeLightbox() { const lb = $("#lightbox"); lb.hidden = true; lb.innerHTML = ""; $("#pane").focus(); }

/* ---------------------------------------------------------------- drag/drop */
let dragPaths = null;
function dropTarget(el) { return el.closest("[data-drop], .row, .cell, [data-drop-tab]"); }
function dropPathOf(el) {
  if (el.dataset.drop) return el.dataset.drop;
  if (el.dataset.dropTab != null) { const t = S.tabs[+el.dataset.dropTab]; return t && t.path !== HOME && !t.search ? t.path : null; }
  const e = tab().view[+el.dataset.i];
  return e && e.d ? pathOf(e) : null;
}
let dragTab = -1;
function moveTab(from, to) {
  if (from === to || from < 0 || to < 0) return;
  const el = $("#tabs"), before = new Map($$(".tab", el).map((n, i) => [S.tabs[i].id, n.getBoundingClientRect().left]));
  const active = tab(), [t] = S.tabs.splice(from, 1);
  S.tabs.splice(to, 0, t); S.ti = S.tabs.indexOf(active);
  renderTabs(); savePrefs();
  $$(".tab", el).forEach((n, i) => {
    n.style.animation = "none";
    const dx = (before.get(S.tabs[i].id) ?? 0) - n.getBoundingClientRect().left;
    if (dx && !reduced()) n.animate([{ transform: `translateX(${dx}px)` }, { transform: "none" }], { duration: 260, easing: "cubic-bezier(.34,1.56,.64,1)" });
  });
}
document.addEventListener("dragstart", ev => {
  const tb = ev.target.closest && ev.target.closest(".tab[data-ti]");
  if (tb) { dragTab = +tb.dataset.ti; ev.dataTransfer.effectAllowed = "move"; ev.dataTransfer.setData("application/x-burrow-tab", String(dragTab)); tb.classList.add("lifted"); return; }
  const n = ev.target.closest && ev.target.closest(".row, .cell");
  if (!n) return;
  const t = tab(), e = t.view[+n.dataset.i];
  if (!t.sel.has(keyOf(e))) { t.sel.clear(); t.sel.add(keyOf(e)); t.cur = +n.dataset.i; paintSel(); }
  dragPaths = selPaths();
  const first = t.view[+n.dataset.i] || e, g = document.createElement("div");
  g.className = "ghost"; g.innerHTML = `${fileIcon(first)}<span>${esc(first.n)}</span>${dragPaths.length > 1 ? `<b>${dragPaths.length}</b>` : ""}`;
  if (dragPaths.length > 1) g.classList.add("stack");
  document.body.append(g); ev.dataTransfer.setDragImage(g, 18, 18); setTimeout(() => g.remove(), 0);
  ev.dataTransfer.effectAllowed = "copyMove";
  ev.dataTransfer.setData("application/x-burrow", JSON.stringify(dragPaths));
  ev.dataTransfer.setData("text/plain", dragPaths.join("\r\n"));
  document.body.classList.add("dragging");
});
document.addEventListener("dragend", () => { dragTab = -1; $$(".tab.lifted").forEach(n => n.classList.remove("lifted")); dragPaths = null; document.body.classList.remove("dragging"); $$(".drop-over").forEach(n => n.classList.remove("drop-over")); });
let overEl = null;
document.addEventListener("dragover", ev => {
  if (dragTab >= 0) {
    const over = ev.target.closest && ev.target.closest(".tab[data-ti]");
    if (over) { ev.preventDefault(); const to = +over.dataset.ti; if (to !== dragTab) { moveTab(dragTab, to); dragTab = to; $$(".tab")[to]?.classList.add("lifted"); } }
    return;
  }
  const internal = ev.dataTransfer.types.includes("application/x-burrow");
  const ext = !internal && ev.dataTransfer.types.includes("Files");
  const tgt = dropTarget(ev.target);
  const dp = tgt && dropPathOf(tgt);
  if (overEl && overEl !== tgt) overEl.classList.remove("drop-over");
  if (internal || ext) {
    if (dp && !(internal && dragPaths && dragPaths.some(p => p.toLowerCase() === dp.toLowerCase()))) {
      ev.preventDefault(); tgt.classList.add("drop-over"); overEl = tgt;
      ev.dataTransfer.dropEffect = ev.ctrlKey ? "copy" : ev.shiftKey ? "move" : internal && dragPaths && sameDrive(dragPaths[0], dp) ? "move" : "copy";
      if (ext) $("#pane").classList.remove("ext-over");
    } else if (ext && ev.target.closest("#pane") && tab().path !== HOME && !tab().search) {
      ev.preventDefault(); ev.dataTransfer.dropEffect = "copy";
      $("#pane").classList.add("ext-over"); $("#dropTo").textContent = tab().path;
    }
  }
});
document.addEventListener("dragleave", ev => { if (!ev.relatedTarget || !document.contains(ev.relatedTarget)) $("#pane").classList.remove("ext-over"); });
const sameDrive = (a, b) => (a || "").slice(0, 2).toLowerCase() === (b || "").slice(0, 2).toLowerCase();
document.addEventListener("drop", async ev => {
  ev.preventDefault();
  if (dragTab >= 0) return;
  $("#pane").classList.remove("ext-over");
  $$(".drop-over").forEach(n => n.classList.remove("drop-over"));
  const tgt = dropTarget(ev.target);
  let dest = tgt && dropPathOf(tgt);
  const raw = ev.dataTransfer.getData("application/x-burrow");
  if (raw) {
    if (!dest) { if (tgt && tgt.closest("#pinsSec")) return; return; }
    const paths = JSON.parse(raw);
    const move = ev.ctrlKey ? false : ev.shiftKey ? true : sameDrive(paths[0], dest);
    try { trackJob(await api("/api/transfer", { paths, dest, move })); toast(`${move ? "Moving" : "Copying"} ${paths.length} item${paths.length === 1 ? "" : "s"} to ${baseName(dest) || dest}`); } catch (e) { fail(e); }
    return;
  }
  const entries = [...ev.dataTransfer.items].map(i => i.kind === "file" && i.webkitGetAsEntry ? i.webkitGetAsEntry() : null);
  const files = [...ev.dataTransfer.files];
  if (!files.length) return;
  dest = dest || (tab().path !== HOME && !tab().search ? tab().path : null);
  if (!dest) return toast("Open a folder to drop into", { bad: true });
  if (entries.some(en => en && en.isDirectory)) return uploadTree(entries.filter(Boolean), dest);
  uploadFiles(files.map(f => ({ f, dir: dest })), dest);
});
const readAll = dr => new Promise(res => { const out = []; const step = () => dr.readEntries(b => { if (!b.length) return res(out); out.push(...b); step(); }, () => res(out)); step(); });
const fileOf = en => new Promise((res, rej) => en.file(res, rej));
async function uploadTree(entries, dest) {
  toast("Reading the dropped folder…", { ms: 1200 });
  const items = [];
  for (const en of entries) {
    if (en.isFile) { items.push({ f: await fileOf(en), dir: dest }); continue; }
    let top;
    try { top = (await api("/api/dropdir", { dir: dest, name: en.name })).path; } catch (e) { fail(e); continue; }
    const walk = async (dirEn, rel) => {
      for (const c of await readAll(dirEn.createReader())) {
        if (c.isDirectory) await walk(c, rel ? rel + "/" + c.name : c.name);
        else try { items.push({ f: await fileOf(c), dir: top, rel, noundo: 1 }); } catch {}
      }
    };
    await walk(en, "");
  }
  uploadFiles(items, dest);
}
async function uploadFiles(items, dest) {
  const files = items.map(x => x.f);
  const j = { id: "u" + Date.now(), label: `Copying ${files.length} dropped file${files.length === 1 ? "" : "s"}` };
  const dock = $("#jobs");
  const n = document.createElement("div"); n.className = "job qt-card";
  n.innerHTML = `<div class="h"><span>${esc(j.label)}</span></div><div class="qt-bar"><i></i></div><small></small>`;
  dock.prepend(n);
  const total = files.reduce((s, f) => s + f.size, 0) || 1; let done = 0, ok = 0;
  const t0 = performance.now();
  for (const it of items) {
    const f = it.f;
    n.querySelector("small").textContent = (it.rel ? it.rel + "/" : "") + f.name + (done > 1e6 ? " · " + human(done / ((performance.now() - t0) / 1000)) + "/s" : "");
    try {
      const r = await fetch(`/api/upload?dir=${enc(it.dir)}&name=${enc(f.name)}&mtime=${f.lastModified}${it.rel ? "&rel=" + enc(it.rel) : ""}${it.noundo ? "&noundo=1" : ""}`, { method: "POST", body: f });
      if (!r.ok) throw new Error((await r.json()).error); ok++;
    } catch (e) { toast(f.name + ": " + e.message, { bad: true }); }
    done += f.size; n.querySelector("i").style.width = (done / total * 100) + "%";
  }
  n.classList.add("done"); n.querySelector("small").textContent = `${ok} copied`;
  setTimeout(() => { n.classList.add("out"); setTimeout(() => n.remove(), 320); }, 3000);
  if (tab().path.toLowerCase() === dest.toLowerCase()) await refresh(true);
  pollJobs();
}

/* ---------------------------------------------------------------- events -- */
$("#scroller").addEventListener("scroll", () => { requestAnimationFrame(() => renderRows()); }, { passive: true });
new ResizeObserver(() => { if (tab()) { const was = S.cols; if (S.prefs.view === "grid") { const c = Math.max(1, Math.floor(($("#scroller").clientWidth - 20) / CELL_W)); if (c !== was) layoutRows(); else renderRows(); } else renderRows(); renderCrumbs(); } }).observe($("#scroller"));

$("#rows").addEventListener("mousedown", ev => {
  const n = ev.target.closest("[data-i]");
  if (!n || ev.button === 1) return;
  const i = +n.dataset.i, t = tab();
  if (ev.button === 2) { if (!t.sel.has(keyOf(t.view[i]))) setCur(i); return; }
  if (t.sel.has(keyOf(t.view[i])) && !ev.ctrlKey && !ev.shiftKey && t.sel.size > 1) { S.pendingSingle = i; return; } // allow dragging a multi-selection
  setCur(i, { extend: ev.shiftKey, toggle: ev.ctrlKey });
  $("#pane").focus({ preventScroll: true });
});
$("#rows").addEventListener("mouseup", ev => {
  if (S.pendingSingle != null && ev.button === 0) { const i = S.pendingSingle; S.pendingSingle = null; if (!ev.ctrlKey && !ev.shiftKey) setCur(i); }
});
$("#scroller").addEventListener("mousedown", ev => {
  if (ev.target.closest("[data-i], .home, .empty button, input")) return;
  if (ev.button !== 0) return;
  const t = tab();
  if (!ev.ctrlKey && !ev.shiftKey) { t.sel.clear(); t.cur = -1; paintSel(); updateStatus(); schedulePreview(); }
  $("#pane").focus({ preventScroll: true });
  if (t.path === HOME && !t.search) return;
  if (ev.offsetX > ev.target.clientWidth && ev.target === $("#scroller")) return; // the scrollbar
  startLasso(ev);
});
function startLasso(ev) {
  const t = tab(), sc = $("#scroller"), box = sc.getBoundingClientRect();
  const base = new Set(t.sel), pt = e => ({ x: e.clientX - box.left, y: e.clientY - box.top + sc.scrollTop });
  const a = pt(ev); let b = a, moved = false, lastEv = ev, raf = 0;
  const el = document.createElement("div"); el.className = "lasso"; el.hidden = true; $("#spacerV").append(el);
  const hits = () => {
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
    const out = [], grid = S.prefs.view === "grid";
    if (!grid) {
      const i0 = Math.max(0, Math.floor((y0 - 6) / ROW_H)), i1 = Math.min(t.view.length - 1, Math.floor((y1 - 6) / ROW_H));
      for (let i = i0; i <= i1; i++) out.push(i);
      return out;
    }
    const cols = S.cols || 1, cw = (sc.clientWidth - 20 - 8 * (cols - 1)) / cols;
    const r0 = Math.max(0, Math.floor((y0 - 10) / CELL_H)), r1 = Math.floor((y1 - 10) / CELL_H);
    for (let r = r0; r <= r1; r++) for (let c = 0; c < cols; c++) {
      const i = r * cols + c; if (i >= t.view.length) break;
      const cx = 10 + c * (cw + 8), cy = 10 + r * CELL_H;
      if (cx < x1 && cx + cw > x0 && cy < y1 && cy + CELL_H - 8 > y0) out.push(i);
    }
    return out;
  };
  const paint = () => {
    raf = 0;
    el.style.cssText = `left:${Math.min(a.x, b.x)}px;top:${Math.min(a.y, b.y)}px;width:${Math.abs(b.x - a.x)}px;height:${Math.abs(b.y - a.y)}px`;
    el.hidden = false;
    t.sel = new Set(base);
    const hit = hits();
    for (const i of hit) { const k = keyOf(t.view[i]); lastEv.ctrlKey && base.has(k) ? t.sel.delete(k) : t.sel.add(k); }
    if (hit.length) t.cur = hit[hit.length - 1];
    el.dataset.n = t.sel.size || "";
    renderRows(); updateStatus();
  };
  const move = e => {
    lastEv = e; b = pt(e);
    if (!moved && Math.hypot(b.x - a.x, b.y - a.y) < 5) return;
    moved = true; document.body.classList.add("lassoing");
    if (!raf) raf = setTimeout(paint, 16); // a timer, not rAF: keeps working in a background window
  };
  const scrollTick = setInterval(() => {
    if (!moved) return;
    const y = lastEv.clientY, dy = y < box.top + 30 ? -18 : y > box.bottom - 30 ? 18 : 0;
    if (dy) { sc.scrollTop += dy; b = pt(lastEv); renderRows(); paint(); }
  }, 30);
  const up = () => {
    clearInterval(scrollTick); removeEventListener("mousemove", move); removeEventListener("mouseup", up);
    document.body.classList.remove("lassoing");
    el.classList.add("out"); setTimeout(() => el.remove(), 200);
    if (moved) { t.anchor = t.cur; schedulePreview(); }
  };
  addEventListener("mousemove", move); addEventListener("mouseup", up);
}
$("#rows").addEventListener("dblclick", ev => { const n = ev.target.closest("[data-i]"); if (n) openEntry(tab().view[+n.dataset.i]); });
$("#rows").addEventListener("auxclick", ev => { if (ev.button !== 1) return; const n = ev.target.closest("[data-i]"); if (!n) return; const e = tab().view[+n.dataset.i]; if (e.d) openEntry(e, true); });
$("#pane").addEventListener("contextmenu", ev => {
  if (ev.target.closest("input, .home")) return;
  ev.preventDefault();
  const n = ev.target.closest("[data-i]");
  if (n) itemMenu(ev.clientX, ev.clientY); else { const t = tab(); t.sel.clear(); t.cur = -1; paintSel(); bgMenu(ev.clientX, ev.clientY); }
});
$("#tabs").addEventListener("mousedown", ev => {
  const x = ev.target.closest("[data-close]");
  if (x) { ev.stopPropagation(); return; }
  const tb = ev.target.closest("[data-ti]");
  if (!tb) return;
  if (ev.button === 1) { ev.preventDefault(); closeTab(+tb.dataset.ti); return; }
  if (ev.button === 0) switchTab(+tb.dataset.ti);
});
$("#tabs").addEventListener("click", ev => { const x = ev.target.closest("[data-close]"); if (x) closeTab(+x.dataset.close); });
$("#tabs").addEventListener("dblclick", ev => { if (!ev.target.closest("[data-ti]")) openTab(); });
$("#newTab").onclick = () => openTab(tab().path === HOME ? HOME : tab().path);
$("#bBack").onclick = back; $("#bFwd").onclick = fwd; $("#bUp").onclick = goUp; $("#bRefresh").onclick = () => refresh();
$("#bView").onclick = toggleView; $("#bPreview").onclick = togglePreview; $("#bGrab").onclick = grabLink; $("#bNewFolder").onclick = newFolder;
$("#bMore").onclick = ev => { const r = ev.currentTarget.getBoundingClientRect(); moreMenu(r.right - 240, r.bottom + 6); };
$("#bSort").onclick = ev => { const r = ev.currentTarget.getBoundingClientRect(); sortMenu(r.right - 220, r.bottom + 6); };
$("#cmdkBtn").onclick = openPalette;
$("#stBeam").onclick = () => S.boot.tools.find(t => t.icon === "beam") ? go(S.boot.tools.find(t => t.icon === "beam").path) : toast("Beam inbox not found");
$("#stVolt").onclick = () => S.boot.tools.find(t => t.icon === "volt") ? go(S.boot.tools.find(t => t.icon === "volt").path) : grabLink();
$("#colhead").addEventListener("click", ev => { const b = ev.target.closest("[data-sort]"); if (b) setSort(b.dataset.sort); });
$("#chips").addEventListener("click", ev => {
  const c = ev.target.closest("[data-filter]"); if (!c) return;
  const t = tab(); t.filter = t.filter === c.dataset.filter && c.dataset.filter !== "all" ? "all" : c.dataset.filter;
  t.sel.clear(); t.cur = -1; t.enter = "same"; computeView(t); renderChips(); layoutRows(); renderEmpty(); updateStatus(); pvKey = null; renderPreview();
});
$("#empty").addEventListener("click", ev => {
  if (ev.target.closest("[data-filter]")) { const t = tab(); t.filter = "all"; computeView(t); renderChips(); layoutRows(); renderEmpty(); updateStatus(); }
  if (ev.target.closest("#emptyNew")) newFolder();
  if (ev.target.closest("#searchUp")) { const s = tab().search; const up = dirName(s.root); if (up) runSearch(s.q, up); }
});
$("#homeView").addEventListener("click", ev => { const f = ev.target.closest("[data-fresh]"); if (f) { const e = S.fresh[+f.dataset.fresh]; go(e.p, { focusName: e.n }); } });
$("#homeView").addEventListener("contextmenu", ev => {
  const f = ev.target.closest("[data-fresh]"); if (!f) return;
  ev.preventDefault(); const e = S.fresh[+f.dataset.fresh];
  openMenu(ev.clientX, ev.clientY, [mi("fopen", "open", "Open"), mi("fshow", "folder", "Show in folder"), mi("fbeam", "phone", "Send to phone (Beam)", "", "", "var(--qt-beam)")]);
  $("#menu").onclick = me => { const b = me.target.closest("[data-mact]"); if (!b) return; me.stopPropagation(); closeMenu(); $("#menu").onclick = null;
    const p = join(e.p, e.n); ({ fopen: () => openFile(p), fshow: () => go(e.p, { focusName: e.n }), fbeam: () => sendBeam([p]) })[b.dataset.mact](); };
});

document.addEventListener("click", ev => {
  const m = ev.target.closest("[data-mact]");
  if (m && !$("#menu").onclick) { menuAct(m.dataset.mact); return; }
  if (!ev.target.closest("#menu")) closeMenu();
  const un = ev.target.closest("[data-unpin]");
  if (un) { ev.stopPropagation(); togglePin(un.dataset.unpin); return; }
  const chev = ev.target.closest("[data-chev]");
  if (chev) { crumbMenu(chev); return; }
  const g = ev.target.closest("[data-go]");
  if (g && !ev.target.closest("#rows")) { ev.button === 0 && (ev.ctrlKey ? openTab(g.dataset.go) : go(g.dataset.go)); return; }
  const a = ev.target.closest("[data-act]");
  if (a) { act(a.dataset.act); return; }
  const lb = ev.target.closest("[data-lb]");
  if (lb) {
    const k = lb.dataset.lb, t = tab(), e = t.view[lbIdx];
    if (k === "x") closeLightbox(); else if (k === "prev") lbStep(-1); else if (k === "next") lbStep(1);
    else if (k === "beam" && e) sendBeam([pathOf(e)]); else if (k === "open" && e) openFile(pathOf(e));
    else if (lb.tagName === "IMG" && e) lightbox(t.view.indexOf(e));
    return;
  }
  if (ev.target.matches(".lightbox img")) { ev.target.classList.toggle("zoom"); ev.target.parentElement.classList.toggle("scroll"); return; }
  if (ev.target.matches(".pv .stage img[data-lb]")) { lightbox(tab().cur); return; }
  const pi = ev.target.closest("[data-pal]");
  if (pi) palRun(+pi.dataset.pal, ev.ctrlKey);
  const sg = ev.target.closest("[data-sug]");
  if (sg) { endEditPath(); go(sg.dataset.sug); }
  if (ev.target.id === "scrim") { if (!$("#palette").hidden) closePalette(); else closeModal(false); }
});
document.addEventListener("auxclick", ev => { const g = ev.target.closest("[data-go]"); if (g && ev.button === 1) { ev.preventDefault(); openTab(g.dataset.go, false); toast("Opened in a new tab"); } });
document.addEventListener("contextmenu", ev => {
  if (ev.target.closest("#pane, input, textarea")) return;
  const g = ev.target.closest(".side [data-go], .crumb[data-go]");
  ev.preventDefault();
  if (!g || g.dataset.go === HOME) return;
  const p = g.dataset.go;
  const pinned = (S.prefs.pins || []).some(x => x.toLowerCase() === p.toLowerCase());
  openMenu(ev.clientX, ev.clientY, [mi("s-open", "open", "Open"), mi("s-tab", "tab", "Open in new tab", "Middle click"), mi("s-pin", "pin", pinned ? "Unpin" : "Pin to sidebar"),
    mi("s-paste", "paste", "Paste into"), mi("s-reveal", "explorer", "Open in Explorer"), mi("s-term", "term", "Open terminal here")]);
  $("#menu").onclick = me => { const b = me.target.closest("[data-mact]"); if (!b) return; me.stopPropagation(); closeMenu(); $("#menu").onclick = null;
    ({ "s-open": () => go(p), "s-tab": () => openTab(p), "s-pin": () => togglePin(p), "s-paste": () => paste(p), "s-reveal": () => openFile(p), "s-term": () => openFile(p, "terminal") })[b.dataset.mact](); };
});
async function crumbMenu(chev) {
  const p = chev.dataset.chev;
  chev.classList.add("open");
  try {
    const r = await api("/api/ls?remember=0&path=" + enc(p));
    const dirs = r.entries.filter(e => e.d && (S.prefs.hidden || !e.h)).sort((a, b) => coll.compare(a.n, b.n)).slice(0, 60);
    const rect = chev.getBoundingClientRect();
    openMenu(rect.left, rect.bottom + 6, dirs.length ? dirs.map((e, i) => mi("c" + i, "folder", e.n)) : ["No folders inside"]);
    $("#menu").onclick = me => { const b = me.target.closest("[data-mact]"); if (!b) return; me.stopPropagation(); closeMenu(); $("#menu").onclick = null; go(join(r.path, dirs[+b.dataset.mact.slice(1)].n)); };
  } catch (e) { fail(e); }
  const off = () => { chev.classList.remove("open"); };
  setTimeout(() => document.addEventListener("click", off, { once: true }), 0);
}
// menus that set their own onclick clear it when closed some other way
new MutationObserver(() => { if ($("#menu").hidden) $("#menu").onclick = null; }).observe($("#menu"), { attributes: true, attributeFilter: ["hidden"] });

$("#pathbar").addEventListener("click", ev => { if (!ev.target.closest(".crumb, .chev, .suggest")) editPath(); });
$("#pathIn").addEventListener("keydown", ev => {
  const box = $("#suggest"), btns = $$("button", box);
  if (ev.key === "Escape") { endEditPath(); $("#pane").focus(); }
  else if (ev.key === "ArrowDown" || ev.key === "ArrowUp") { ev.preventDefault(); if (!btns.length) return; sugIdx = (sugIdx + (ev.key === "ArrowDown" ? 1 : -1) + btns.length) % btns.length; btns.forEach((b, i) => b.classList.toggle("on", i === sugIdx)); $("#pathIn").value = btns[sugIdx].dataset.sug; }
  else if (ev.key === "Tab" && btns.length) { ev.preventDefault(); $("#pathIn").value = btns[Math.max(0, sugIdx)].dataset.sug + "\\"; suggest(); }
  else if (ev.key === "Enter") { const v = $("#pathIn").value.trim(); endEditPath(); if (v) { if (/^shell:/i.test(v)) openFile(v); else go(v); } }
});
$("#pathIn").addEventListener("input", () => { clearTimeout(sugTimer); sugTimer = setTimeout(suggest, 120); });
$("#pathIn").addEventListener("blur", () => setTimeout(endEditPath, 150));

$("#q").addEventListener("input", () => {
  const v = $("#q").value;
  $("#qClear").hidden = !v;
  clearTimeout(searchTimer);
  if (!v.trim()) { clearSearch(); return; }
  searchTimer = setTimeout(() => runSearch(v), 260);
});
$("#q").addEventListener("keydown", ev => {
  if (ev.key === "Escape") { ev.preventDefault(); clearSearch(); $("#pane").focus(); }
  if (ev.key === "Enter") { clearTimeout(searchTimer); runSearch($("#q").value); }
  if (ev.key === "ArrowDown") { ev.preventDefault(); $("#pane").focus(); setCur(0); }
});
$("#qClear").onclick = () => { clearSearch(); $("#q").focus(); };
$("#palIn").addEventListener("input", palFill);
$("#palIn").addEventListener("keydown", ev => {
  if (ev.key === "ArrowDown") { ev.preventDefault(); palIdx = Math.min(palItems.length - 1, palIdx + 1); paintPal(); }
  else if (ev.key === "ArrowUp") { ev.preventDefault(); palIdx = Math.max(0, palIdx - 1); paintPal(); }
  else if (ev.key === "Enter") { ev.preventDefault(); palRun(palIdx, ev.ctrlKey); }
  else if (ev.key === "Escape") closePalette();
});

function typeAhead(ch) {
  const t = tab();
  clearTimeout(S.taTimer);
  S.typeahead += ch.toLowerCase();
  S.taTimer = setTimeout(() => (S.typeahead = ""), 800);
  const start = S.typeahead.length === 1 ? t.cur + 1 : Math.max(0, t.cur);
  const n = t.view.length;
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    if (t.view[i].n.toLowerCase().startsWith(S.typeahead)) { setCur(i); return; }
  }
}
document.addEventListener("keydown", ev => {
  const inField = ev.target.closest && ev.target.closest("input, textarea, select");
  const ctrl = ev.ctrlKey || ev.metaKey, k = ev.key;
  if (!$("#lightbox").hidden) {
    if (k === "Escape" || k === " ") { ev.preventDefault(); closeLightbox(); }
    else if (k === "ArrowLeft") lbStep(-1); else if (k === "ArrowRight") lbStep(1);
    return;
  }
  if (!$("#palette").hidden || !$("#modal").hidden) { if (k === "Escape") { closePalette(); closeModal(false); } if (!$("#modal").hidden && k === "Enter" && !inField && $("#yesBtn")) $("#yesBtn").click(); return; }
  if (!$("#menu").hidden && k === "Escape") { closeMenu(); return; }
  // global shortcuts
  if (ctrl && k.toLowerCase() === "k") { ev.preventDefault(); return openPalette(); }
  if (ctrl && k.toLowerCase() === "t") { ev.preventDefault(); return openTab(tab().path === HOME ? HOME : tab().path); }
  if (ctrl && k.toLowerCase() === "w") { ev.preventDefault(); return closeTab(S.ti); }
  if (ctrl && k === "Tab") { ev.preventDefault(); return switchTab((S.ti + (ev.shiftKey ? -1 : 1) + S.tabs.length) % S.tabs.length); }
  if (ctrl && k.toLowerCase() === "f" || (!inField && k === "/")) { ev.preventDefault(); $("#q").focus(); $("#q").select(); return; }
  if (ctrl && k.toLowerCase() === "l" || (ev.altKey && k.toLowerCase() === "d")) { ev.preventDefault(); return editPath(); }
  if (ctrl && k.toLowerCase() === "d") { ev.preventDefault(); const one = selected()[0]; return one && one.d ? togglePin(pathOf(one)) : grabLink(); }
  if (ctrl && k.toLowerCase() === "g") { ev.preventDefault(); return toggleView(); }
  if (ctrl && k.toLowerCase() === "h") { ev.preventDefault(); return toggleHidden(); }
  if (ctrl && k.toLowerCase() === "b") { ev.preventDefault(); return menuAct("sidebar"); }
  if (ctrl && k.toLowerCase() === "p") { ev.preventDefault(); return togglePreview(); }
  if (ctrl && ev.shiftKey && k.toLowerCase() === "n") { ev.preventDefault(); return newFolder(); }
  if (ev.altKey && k === "ArrowLeft") { ev.preventDefault(); return back(); }
  if (ev.altKey && k === "ArrowRight") { ev.preventDefault(); return fwd(); }
  if (ev.altKey && k === "ArrowUp") { ev.preventDefault(); return goUp(); }
  if (k === "F5") { ev.preventDefault(); return refresh(); }
  if (ev.key === "BrowserBack") return back();
  if (inField) return;
  const t = tab();
  if (t.path === HOME && !t.search) {
    if (k.length === 1 && !ctrl && !ev.altKey && /\S/.test(k)) { $("#q").focus(); return; } // typing on home = search
    return;
  }
  const cols = S.prefs.view === "grid" ? (S.cols || 1) : 1;
  const page = Math.max(1, Math.floor($("#scroller").clientHeight / (cols > 1 ? CELL_H : ROW_H))) * cols;
  const mv = (d) => { ev.preventDefault(); setCur(t.cur < 0 ? 0 : t.cur + d, { extend: ev.shiftKey }); };
  if (k === "ArrowDown") return mv(cols);
  if (k === "ArrowUp") return mv(t.cur < 0 ? 0 : -cols);
  if (k === "ArrowRight" && cols > 1) return mv(1);
  if (k === "ArrowLeft" && cols > 1) return mv(-1);
  if (k === "PageDown") return mv(page);
  if (k === "PageUp") return mv(-page);
  if (k === "Home") { ev.preventDefault(); return setCur(0, { extend: ev.shiftKey }); }
  if (k === "End") { ev.preventDefault(); return setCur(t.view.length - 1, { extend: ev.shiftKey }); }
  if (k === "Enter") { ev.preventDefault(); if (ev.altKey) return act("props"); const s = selected(); if (s.length === 1) openEntry(s[0], ctrl); else if (ctrl) act("newtab", s); else act("open", s); return; }
  if (k === "Backspace") { ev.preventDefault(); return goUp(); }
  if (k === "Escape") { if (t.search) return clearSearch(); t.sel.clear(); paintSel(); updateStatus(); schedulePreview(); return; }
  if (k === "F2") { ev.preventDefault(); return act("rename"); }
  if (k === "Delete") { ev.preventDefault(); return act("trash"); }
  if (k === " ") {
    ev.preventDefault(); const e = t.view[t.cur], cur = t.cur;
    const old = () => { if (e && ["image", "video"].includes(kindOf(e))) lightbox(cur); else togglePreview(); };
    if (e && !e.d && IN_SUITE) suitePeek(e).then(ok => ok || old()); else old();
    return;
  }
  if (ctrl && k.toLowerCase() === "a") { ev.preventDefault(); return selectAll(); }
  if (ctrl && ev.shiftKey && k.toLowerCase() === "c") { ev.preventDefault(); return act("copypath"); }
  if (ctrl && k.toLowerCase() === "c") { ev.preventDefault(); return act("copy"); }
  if (ctrl && k.toLowerCase() === "x") { ev.preventDefault(); return act("cut"); }
  if (ctrl && k.toLowerCase() === "v") { ev.preventDefault(); return paste(); }
  if (ctrl && k.toLowerCase() === "z") { ev.preventDefault(); return doUndo(); }
  if (k.length === 1 && !ctrl && !ev.altKey && /\S/.test(k)) typeAhead(k);
});
document.addEventListener("mousedown", ev => { if (ev.button === 3) { ev.preventDefault(); back(); } if (ev.button === 4) { ev.preventDefault(); fwd(); } });
async function watchFolder() {
  const t = tab();
  if (!t || t.path === HOME || t.search || t.loading || document.hidden || $(".rn") || !$("#menu").hidden || !t.loaded) return;
  let sig;
  try { sig = await api("/api/sig?path=" + enc(t.path)); } catch { return; }
  const key = t.path + "|" + sig.m + "|" + sig.n;
  if (t.sigKey && t.sigKey.split("|")[0] === t.path && t.sigKey !== key && tab() === t) {
    const had = new Set(t.entries.map(e => e.n));
    await refresh(true);
    const fresh = t.entries.filter(e => !had.has(e.n)).slice(0, 8);
    fresh.forEach(e => flash(e.n));
  }
  t.sigKey = key;
}
setInterval(watchFolder, 2500);
window.addEventListener("focus", () => { watchFolder(); pollStatus(); });

boot().catch(e => { document.body.insertAdjacentHTML("beforeend", `<div class="qt-toast bad" style="position:fixed;left:20px;bottom:20px">Burrow couldn't start: ${esc(e.message)}</div>`); });

// QT Suite deep links: the hub's Ctrl+K file results ask Burrow to show a file or run a search.
window.addEventListener("message", async ev => {
  if (!/^http:\/\/(127\.0\.0\.1|localhost):7800$/.test(ev.origin) || !ev.data || !/^burrow-(go|search)$/.test(ev.data.qt)) return;
  ev.source && ev.source.postMessage({ qt: "burrow-ack" }, ev.origin);
  for (let i = 0; i < 40 && !tab(); i++) await new Promise(r => setTimeout(r, 100));   // still booting
  try {
    if (ev.data.qt === "burrow-search") {
      await go(HOME);
      $("#q").value = ev.data.q; $("#qClear").hidden = false; runSearch(ev.data.q);
    } else if (ev.data.inside) await go(ev.data.path);
    else {
      const p = String(ev.data.path), cut = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"));
      await go(cut <= 2 ? p.slice(0, cut + 1) : p.slice(0, cut), { focusName: p.slice(cut + 1) });
    }
  } catch (_) {}
});
