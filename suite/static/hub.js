"use strict";
const $ = (s, el = document) => el.querySelector(s);
const ABBR = { beam: "BM", launchpad: "LP", volt: "VT", inkmotion: "IM", pixlab: "PX", soundboard: "SB", apks: "AP", burrow: "BW", lens: "LN", space: "SM", daily: "DY", ping: "PG", pictures: "PI", player: "PL", reader: "RD", code: "CD", archive: "AR" };
let tools = [];
let current = "home";
const frames = {};      // id -> container element (kept alive so tool state survives switching)

const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function toast(msg, bad) {
  const t = document.createElement("div");
  t.className = "qt-toast" + (bad ? " bad" : "");
  t.textContent = msg;
  $("#toasts").append(t);
  setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 320); }, 2400);
}

async function api(path, opts) {
  const r = await fetch(path, opts);
  let j = {};
  try { j = await r.json(); } catch {}
  if (!r.ok) throw new Error(j.msg || j.error || r.statusText);
  return j;
}

function greet() {
  const h = new Date().getHours();
  $("#greet").textContent = h < 5 ? "Up late" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function dotClass(t) { return t.status === "on" ? "on" : t.status === "idle" ? "" : "bad"; }
function statusText(t) {
  if (t.kind === "web") return t.status === "on" ? "Running" : "Stopped";
  if (t.kind === "app") return t.status === "on" ? "Running" : "Ready";
  if (t.kind === "folder") return (t.files || []).length + " APKs";
  return "Ready";
}

function glyph(t) {
  const abbr = ABBR[t.id] || t.name.slice(0, 2).toUpperCase();
  return `<img class="gl" src="/icons/${t.id}.svg" alt="" onerror="this.replaceWith(document.createTextNode('${abbr}'))">`;
}

function apkIcon(f) {
  const id = (f.match(/^(beam|kharcha|lens)/i) || [])[1];
  return id ? `<img class="gl" src="/icons/${id.toLowerCase()}.svg" alt="">` : esc(f.slice(0, 2).toUpperCase());
}

function renderNav() {
  const nav = $("#nav");
  const items = nav.querySelectorAll(".nav");
  if (items.length === tools.length) {   // already built: just refresh the status dots (pop the ones that changed)
    tools.forEach((t, i) => {
      const d = items[i].querySelector(".qt-dot"), c = "qt-dot " + dotClass(t);
      if (d.className !== c) { d.className = c; d.animate([{ transform: "scale(2.2)" }, { transform: "scale(1)" }], { duration: 450, easing: "cubic-bezier(.34,1.8,.5,1)" }); }
    });
    return;
  }
  nav.innerHTML = tools.map((t, i) => `
    <button class="nav${current === t.id ? " on" : ""}" data-go="${t.id}" data-tool="${t.id}" title="${esc(t.name)} (Ctrl+${i + 1})">
      <span class="ic">${glyph(t)}</span><span class="nm">${esc(t.name)}</span>
      <span class="qt-dot ${dotClass(t)}"></span>
    </button>`).join("");
  movePill();
}

function renderHome() {
  const running = tools.filter(t => t.status === "on" && t.kind !== "folder" && t.kind !== "file").length;
  const apks = (tools.find(t => t.id === "apks") || {}).files || [];
  $("#hero-stats").innerHTML = `
    <div class="hstat qt-card"><b data-n="${tools.length}">0</b><span>tools</span></div>
    <div class="hstat qt-card"><b data-n="${running}">0</b><span>running now</span></div>
    <div class="hstat qt-card"><b data-n="${apks.length}">0</b><span>phone apps</span></div>`;
  countUp($("#hero-stats"));
  $("#tiles").innerHTML = tools.map(t => `
    <button class="tile qt-card" data-go="${t.id}" data-tool="${t.id}">
      <div class="top"><span class="big">${glyph(t)}</span>
        <span class="qt-chip"><span class="qt-dot ${dotClass(t)}"></span>${statusText(t)}</span></div>
      <div><div class="qt-eyebrow">${esc(t.tag)}</div><h2>${esc(t.name)}</h2></div>
      <p>${esc(t.blurb)}</p>
      <div class="go">${t.kind === "web" && t.status !== "on" ? "Start and open" : t.kind === "app" ? "Launch" : "Open"} <i>→</i></div>
    </button>`).join("");
  movePill();
}

function countUp(root) {
  root.querySelectorAll("[data-n]").forEach(b => {
    const n = +b.dataset.n, t0 = performance.now();
    (function step(t) {
      const k = Math.min(1, (t - t0) / 700), e = 1 - Math.pow(1 - k, 3);
      b.textContent = Math.round(n * e);
      if (k < 1) requestAnimationFrame(step);
    })(t0);
  });
}

let lastSig = "";
async function load(force) {
  tools = await api("/api/tools");
  watchHealth();
  const sig = JSON.stringify(tools.map(t => [t.id, t.status, (t.files || []).length]));
  if (!force && sig === lastSig) return;        // nothing changed: don't replay the entrance animations
  const first = !lastSig;
  lastSig = sig;
  renderNav();
  if (current !== "home") return;
  if (first) return renderHome();
  // status changed while home is open: update chips in place, with a little pop
  tools.forEach(t => {
    const tile = document.querySelector(`.tile[data-go="${t.id}"]`);
    if (!tile) return;
    const chip = tile.querySelector(".qt-chip");
    chip.innerHTML = `<span class="qt-dot ${dotClass(t)}"></span>${statusText(t)}`;
    chip.classList.remove("qt-pop"); void chip.offsetWidth; chip.classList.add("qt-pop");
    tile.querySelector(".go").firstChild.textContent =
      (t.kind === "web" && t.status !== "on" ? "Start and open" : t.kind === "app" ? (t.status === "on" ? "Running" : "Launch") : "Open") + " ";
  });
}

function show(id) {
  current = id;
  document.body.dataset.tool = id;
  const home = $("#view-home");
  home.hidden = id !== "home";
  Object.entries(frames).forEach(([k, el]) => { el.hidden = k !== id; });
  if (id === "home") { home.classList.remove("enter"); void home.offsetWidth; home.classList.add("enter"); renderHome(); }
  else openTool(tools.find(t => t.id === id));
  document.querySelectorAll("#nav .nav").forEach(n => n.classList.toggle("on", n.dataset.go === id));
  movePill();
  // slide the new view in from the direction of travel
  const idx = id === "home" ? -1 : tools.findIndex(x => x.id === id);
  document.documentElement.style.setProperty("--dir", idx >= lastIdx ? 1 : -1);
  lastIdx = idx;
}
let lastIdx = -1;

function movePill() {
  const nav = $("#nav"), on = nav.querySelector(".nav.on");
  let pill = nav.querySelector(".nav-pill");
  if (!pill) { pill = document.createElement("span"); pill.className = "nav-pill"; nav.prepend(pill); }
  if (!on) { pill.style.opacity = 0; return; }
  pill.style.opacity = 1;
  pill.style.transform = `translateY(${on.offsetTop}px)`;
  pill.style.height = on.offsetHeight + "px";
  pill.classList.remove("boing"); void pill.offsetWidth; pill.classList.add("boing");
}

function loadFrame(el, t) {
  // go via about:blank so an iframe stuck on a browser error page really reloads
  const f = el.querySelector("iframe");
  f.src = "about:blank";
  setTimeout(() => { f.src = `http://127.0.0.1:${t.port}${t.path || "/"}`; }, 30);
}

function cover(el, title, text, btn) {
  let c = el.querySelector(".cover");
  if (!c) { c = document.createElement("div"); c.className = "cover"; el.append(c); }
  c.innerHTML = `<div class="box">${btn ? "" : '<div class="loader"></div>'}<h2>${esc(title)}</h2><p>${esc(text)}</p>${btn || ""}</div>`;
  return c;
}

async function startTool(t, el) {
  cover(el, "Starting " + t.name, "Waking it up. This takes a second.");
  try {
    const r = await api(`/api/start/${t.id}`, { method: "POST" });
    if (t.kind === "web") {
      if (r.msg === "first run setup started") {
        cover(el, "Setting up " + t.name, "First run installs its engine in a console window. Come back here when it finishes.",
          `<button class="qt-btn primary" data-retry>Try again</button>`);
        return;
      }
      loadFrame(el, t);
      el.querySelector(".cover")?.remove();
      toast(t.name + " is running");
    } else toast(t.name + " launched");
  } catch (e) {
    cover(el, t.name + " didn't start", e.message, `<button class="qt-btn primary" data-retry>Try again</button>`);
  }
  load();
}

function openTool(t) {
  if (!t) return;
  let el = frames[t.id];
  const fresh = !el;
  if (fresh) {
    el = frames[t.id] = document.createElement("section");
    el.className = "view";
    el.dataset.tool = t.id;
    $("#frames").append(el);
    el.addEventListener("click", e => { if (e.target.closest("[data-retry]")) startTool(t, el); });
  }
  el.classList.remove("enter"); void el.offsetWidth; el.classList.add("enter");
  if (!fresh) return;

  if (t.kind === "web") {
    el.innerHTML = `<iframe class="frame" title="${esc(t.name)}" allow="clipboard-read; clipboard-write; fullscreen"></iframe>`;
    if (t.status === "on") loadFrame(el, t);
    else startTool(t, el);
  } else if (t.kind === "file") {
    el.innerHTML = `<iframe class="frame" title="${esc(t.name)}" src="/tool/${t.id}" allow="clipboard-read; clipboard-write; fullscreen"></iframe>`;
    // same-origin tools: listen for the suite shortcuts inside them directly
    el.querySelector("iframe").addEventListener("load", e => {
      try { e.target.contentWindow.addEventListener("keydown", suiteKeys, true); } catch (_) {}
    });
  } else if (t.kind === "app") {
    el.className = "view panel qt-dots qt-stagger enter";
    el.innerHTML = `<div class="qt-eyebrow">${esc(t.tag)}</div><h1 class="qt-display">${esc(t.name)}</h1>
      <p class="lede">${esc(t.blurb)} It runs as its own window so global hotkeys keep working while you game.</p>
      <div class="row"><button class="qt-btn primary" data-launch>Launch ${esc(t.name)}</button></div>`;
    el.querySelector("[data-launch]").onclick = () => startTool(t, el);
  } else if (t.kind === "folder") {
    el.className = "view panel qt-dots qt-stagger enter";
    const files = t.files || [];
    el.innerHTML = `<div class="qt-eyebrow">${esc(t.tag)}</div><h1 class="qt-display">Phone apps</h1>
      <p class="lede">${esc(t.blurb)}</p>
      <div class="apklist">${files.length ? files.map(f => `<div class="apk qt-card"><span class="big">${apkIcon(f)}</span><div><b>${esc(f.replace(/\.apk$/i, ""))}</b><span>.apk</span></div></div>`).join("") : '<p class="qt-muted">No APKs in the folder yet.</p>'}</div>
      <div class="row"><button class="qt-btn primary" data-beam>Send with Beam</button><button class="qt-btn" data-folder>Open folder</button></div>`;
    el.querySelector("[data-folder]").onclick = () => api(`/api/start/apks`, { method: "POST" }).then(() => toast("Opened APKs folder"));
    el.querySelector("[data-beam]").onclick = () => show("beam");
  }
}

document.addEventListener("click", e => {
  const g = e.target.closest("[data-go]");
  if (g) show(g.dataset.go);
});
function goNumber(n) {
  if (n === 0) return show("home");
  if (n >= 1 && n <= tools.length) show(tools[n - 1].id);
}
function suiteKeys(e) {
  if (!e.ctrlKey || e.altKey || e.shiftKey || !/^[0-9]$/.test(e.key)) return;
  e.preventDefault();
  goNumber(+e.key);
}
document.addEventListener("keydown", suiteKeys);
// tools on other ports pass Ctrl+number up through qt-bridge.js
addEventListener("message", e => {
  if (e.data && e.data.qt === "go" && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(e.origin)) goNumber(e.data.n);
  // Daily's "Open" buttons switch the suite to that tool
  if (e.data && e.data.qt === "open" && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(e.origin) && tools.some(t => t.id === e.data.id)) show(e.data.id);
});

// a tool that stops while it's open gets a "start it again" cover instead of a browser error page
function watchHealth() {
  for (const t of tools) {
    const el = frames[t.id];
    if (!el || t.kind !== "web") continue;
    const c = el.querySelector(".cover");
    if (t.status !== "on" && !c) {
      cover(el, t.name + " stopped", "It isn't running any more. Start it again and it'll pick up where it was.",
        `<button class="qt-btn primary" data-retry>Start ${esc(t.name)}</button>`);
    } else if (t.status === "on" && c && c.dataset.down !== undefined) {
      loadFrame(el, t);
      c.remove();
    }
    if (t.status !== "on") el.querySelector(".cover").dataset.down = "";
  }
}
$("#refresh").onclick = async () => {
  const b = $("#refresh"); b.firstChild.textContent = "";
  b.insertAdjacentHTML("afterbegin", '<span class="spin">↻</span>');
  await load(true).catch(() => toast("Hub isn't answering", true));
  b.querySelector(".spin")?.remove(); b.firstChild.textContent = "↻ ";
  toast("Status updated");
};

// start with Windows (the person flips it; the hub makes or removes a Startup shortcut)
api("/api/autostart").then(r => $("#autostart").setAttribute("aria-checked", r.on)).catch(() => {});
$("#autostart").onclick = async () => {
  const b = $("#autostart"), on = b.getAttribute("aria-checked") !== "true";
  b.setAttribute("aria-checked", on);
  try {
    const r = await api(`/api/autostart/${on ? "on" : "off"}`, { method: "POST" });
    b.setAttribute("aria-checked", r.on);
    toast(r.on ? "QT Suite will start with Windows" : "QT Suite won't start with Windows");
  } catch (e) { b.setAttribute("aria-checked", !on); toast(e.message, true); }
};

greet();
load().catch(() => toast("Hub isn't answering", true));
setInterval(() => load().catch(() => {}), 8000);
