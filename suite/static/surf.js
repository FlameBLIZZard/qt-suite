"use strict";
/* Surf - the QT Suite web browser. Page: suite/apps/surf.html. Server half: suite/web.py.
   Each tab shows a page one of two ways (see web.py):
     LIVE  the real site in a sandboxed iframe (full JavaScript, logins).
     LITE  for sites that refuse to be framed: the hub fetches the page and serves it from its own
           throwaway origin; a small script in it reports clicks and titles back here.
   Stored in this origin's localStorage: qt-surf-bm (bookmarks), qt-surf-hist (history),
   qt-surf-tabs (open tabs), qt-surf-set (engine, bookmarks bar).
   The hub talks to this page through window.qtSurf (open / search), same origin. */
(() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };
  const RM = matchMedia("(prefers-reduced-motion: reduce)");
  const anim = (el, kf, o) => (RM.matches || !el || !el.animate) ? null : el.animate(kf, o);
  const api = (p, o) => fetch(p, o).then(r => r.json().then(j => { if (!r.ok && j.ok === false) throw new Error(j.msg || j.why || r.statusText); return j; }));
  const post = (p, b) => api(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b || {}) });
  const toast = (m, o) => {
    if (parent !== window && parent.qtToast) { try { return parent.qtToast(m, o); } catch (_) {} }
    const t = document.createElement("div"); t.className = "qt-toast" + (o && o.bad ? " bad" : ""); t.textContent = m;
    $("#toasts").append(t); setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 300); }, (o && o.ms) || 2600);
  };
  const host = u => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (_) { return ""; } };
  const START = "surf:start";
  const COLORS = ["#3d8bff", "#c6ff3d", "#ffc93d", "#ff5fa2", "#b28bff", "#5dffb0", "#ff8a3d", "#2ee6d6", "#ff6b4a", "#ffd84d"];
  const tint = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; };

  /* ---------------------------------------------------------------- settings + stores */
  const ENGINES = {
    bing: { name: "Bing", url: "https://www.bing.com/search?q=" },
    ddg: { name: "DuckDuckGo", url: "https://html.duckduckgo.com/html/?q=" },
    wiki: { name: "Wikipedia", url: "https://en.wikipedia.org/w/index.php?search=" },
  };
  const set = Object.assign({ engine: "bing", bar: true }, lsGet("qt-surf-set", {}));
  if (!ENGINES[set.engine]) set.engine = "bing";
  const saveSet = () => lsSet("qt-surf-set", set);
  let bms = lsGet("qt-surf-bm", null);
  if (!Array.isArray(bms)) bms = [
    { url: "https://en.wikipedia.org/", title: "Wikipedia" }, { url: "https://www.bing.com/", title: "Bing" },
    { url: "https://news.ycombinator.com/", title: "Hacker News" }, { url: "https://github.com/FlameBLIZZard", title: "GitHub" },
    { url: "https://www.youtube.com/", title: "YouTube" }, { url: "https://www.reddit.com/", title: "Reddit" },
  ];
  let hist = lsGet("qt-surf-hist", []);
  const saveBms = () => { lsSet("qt-surf-bm", bms); drawBar(); drawStar(); redrawStarts(); };
  let histT = 0;
  const saveHist = () => { clearTimeout(histT); histT = setTimeout(() => lsSet("qt-surf-hist", hist.slice(0, 600)), 300); };
  const isBm = u => bms.some(b => b.url === u);
  function addHist(url, title) {
    if (!/^https?:/.test(url)) return;
    const now = Date.now();
    if (hist[0] && hist[0].url === url) { hist[0].t = now; if (title) hist[0].title = title; }
    else hist.unshift({ url, title: title || host(url), t: now });
    if (hist.length > 600) hist.length = 600;
    saveHist();
  }
  function titleFor(url, title) {
    if (!title) return;
    const h = hist.find(x => x.url === url); if (h) { h.title = title; saveHist(); }
    const b = bms.find(x => x.url === url); if (b && (!b.title || b.title === host(url))) { b.title = title; lsSet("qt-surf-bm", bms); drawBar(); }
  }

  /* ---------------------------------------------------------------- input -> url */
  const norm = u => { try { return new URL(u).href; } catch (_) { return u; } };
  function toUrl(s) { const u = toUrl0(s); return /^https?:/i.test(u) ? norm(u) : u; }
  function toUrl0(s) {
    s = String(s || "").trim();
    if (!s) return START;
    if (s === START) return s;
    if (/^https?:\/\//i.test(s)) return s;
    if (/^(localhost|127\.0\.0\.1|\[::1\]|(\d{1,3}\.){3}\d{1,3})(:\d+)?(\/.*)?$/i.test(s)) return "http://" + s;
    if (!/\s/.test(s) && /^[\w-]+(\.[\w-]+)*\.[a-z]{2,}(:\d+)?([/?#].*)?$/i.test(s)) return "https://" + s;
    return ENGINES[set.engine].url + encodeURIComponent(s);
  }
  const pretty = u => u === START ? "" : u;

  /* ---------------------------------------------------------------- Lite origin */
  let LITE = 0;
  const liteReady = api("/api/web/info").then(r => { LITE = r.lite; }).catch(() => {});
  const liteSrc = (u, k) => `http://127.0.0.1:${LITE}/p?u=${encodeURIComponent(u)}&k=${k}`;
  const frameCache = new Map();   // host -> true (Live ok) / false (needs Lite)
  async function decide(url) {
    const h = host(url);
    if (frameCache.has(h)) return { frame: frameCache.get(h), ok: true };
    const r = await api("/api/web/check?u=" + encodeURIComponent(url)).catch(e => ({ ok: false, why: e.message }));
    if (r.ok) frameCache.set(h, !!r.frame);
    return r;
  }

  /* ---------------------------------------------------------------- tabs */
  const tabs = [];
  let active = null, seq = 0;
  const closed = [];
  const stage = $("#stage"), tabsEl = $("#tabs"), addr = $("#addr");
  const cur = () => tabs.find(t => t.id === active);

  function makeTab(url, { at, bg, restore } = {}) {
    const t = { id: ++seq, url: START, title: "New tab", icon: null, mode: "start", force: null, hist: [], hi: -1, busy: false, nav: 0 };
    t.page = document.createElement("section"); t.page.className = "sf-page"; stage.append(t.page);
    t.el = document.createElement("div"); t.el.className = "sf-tab in"; t.el.setAttribute("role", "tab"); t.el.draggable = true; t.el.dataset.id = t.id;
    t.el.innerHTML = `<span class="fav"></span><span class="t"></span><button class="x" title="Close (Ctrl+W)" aria-label="Close tab">×</button>`;
    const i = at == null ? tabs.length : at;
    tabs.splice(i, 0, t);
    const after = tabs[i + 1];
    after ? tabsEl.insertBefore(t.el, after.el) : tabsEl.append(t.el);
    if (restore) { t.hist = restore.hist || []; t.hi = restore.hi == null ? t.hist.length - 1 : restore.hi; t.title = restore.title || t.title; }
    if (!bg) select(t.id);
    if (restore && t.hist[t.hi]) { t.url = t.hist[t.hi]; drawTab(t); if (!bg) load(t, t.url, { push: false }); else t.lazy = true; }
    else load(t, url || START, { push: true });
    t.el.scrollIntoView({ block: "nearest", inline: "nearest" });
    saveTabs();
    return t;
  }

  function select(id) {
    active = id;
    tabs.forEach(t => { const on = t.id === id; t.el.classList.toggle("on", on); t.el.setAttribute("aria-selected", on); t.page.classList.toggle("on", on); });
    const t = cur();
    if (t && t.lazy) { t.lazy = false; load(t, t.url, { push: false }); }
    drawBarState();
    if (t) { t.el.scrollIntoView({ block: "nearest", inline: "nearest" }); if (t.mode === "start") setTimeout(() => { const i = t.page.querySelector(".sf-big input"); i && document.activeElement !== addr && i.focus(); }, 30); }
    saveTabs();
  }

  function closeTab(id) {
    const i = tabs.findIndex(t => t.id === id);
    if (i < 0) return;
    const t = tabs[i];
    if (t.url !== START) closed.push({ hist: t.hist.slice(), hi: t.hi, title: t.title, at: i });
    if (closed.length > 25) closed.shift();
    tabs.splice(i, 1);
    t.el.classList.add("out");
    setTimeout(() => t.el.remove(), 200);
    t.page.remove();
    if (!tabs.length) return makeTab(START);
    if (active === id) select(tabs[Math.min(i, tabs.length - 1)].id);
    saveTabs();
  }
  function reopen() {
    const c = closed.pop();
    if (!c) return toast("No closed tabs to bring back");
    makeTab(null, { at: Math.min(c.at, tabs.length), restore: c });
  }

  function drawTab(t) {
    const title = t.mode === "start" ? "New tab" : (t.title || host(t.url) || t.url);
    t.el.querySelector(".t").textContent = title;
    t.el.title = title + (t.url !== START ? "\n" + t.url : "");
    t.el.classList.toggle("busy", t.busy);
    favInto(t.el.querySelector(".fav"), t.mode === "start" ? null : t.url, t.icon, title);
  }
  function favInto(el, url, icon, label) {
    const letter = (label || host(url) || "S").replace(/^www\./, "").trim().charAt(0).toUpperCase() || "S";
    el.style.background = url ? tint(host(url)) : "var(--qt-surf, #3d8bff)";
    if (!url) { el.innerHTML = ""; el.textContent = "S"; return; }
    const src = icon || (() => { try { return new URL(url).origin + "/favicon.ico"; } catch (_) { return ""; } })();
    if (el.dataset.src === src && el.querySelector("img")) return;
    el.dataset.src = src;
    el.textContent = letter;
    if (!src || !/^https?:/.test(src)) return;
    const img = new Image(); img.referrerPolicy = "no-referrer"; img.alt = "";
    img.onload = () => { if (el.dataset.src === src && img.naturalWidth > 1) { el.textContent = ""; el.append(img); } };
    img.src = src;
  }

  /* ---------------------------------------------------------------- loading pages */
  const LIVE_SANDBOX = "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads allow-pointer-lock allow-presentation";
  const ALLOW = "fullscreen; autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share";

  async function load(t, url, { push = true, mode } = {}) {
    url = toUrl(url);
    const n = ++t.nav;
    if (push) {
      if (t.hist[t.hi] !== url) { t.hist = t.hist.slice(0, t.hi + 1); t.hist.push(url); t.hi = t.hist.length - 1; if (t.hist.length > 80) { t.hist.shift(); t.hi--; } }
    }
    t.url = url; t.icon = null;
    if (url === START) {
      t.mode = "start"; t.title = "New tab"; t.busy = false;
      drawStart(t); drawTab(t); if (t.id === active) drawBarState(); saveTabs();
      return;
    }
    t.title = host(url); t.busy = true;
    drawTab(t); if (t.id === active) drawBarState();
    let m = mode || t.force;
    let why = "";
    if (!m) {
      const r = await decide(url);
      if (n !== t.nav) return;
      if (!r.ok) return showErr(t, url, r.why);
      m = r.frame ? "live" : "lite";
      why = r.why || "";
      if (r.title) t.title = r.title;
    }
    await liteReady;
    if (n !== t.nav) return;
    if (m === "lite" && !LITE) return showErr(t, url, "Lite mode isn't running. Restart QT Suite to turn it on.");
    t.mode = m; t.why = why;
    let f = t.page.querySelector("iframe");
    if (!f || f.dataset.mode !== m) {
      t.page.innerHTML = "";
      f = document.createElement("iframe");
      f.dataset.mode = m;
      f.setAttribute("sandbox", m === "live" ? LIVE_SANDBOX : LIVE_SANDBOX.replace("allow-same-origin ", ""));
      f.setAttribute("allow", ALLOW);
      f.setAttribute("referrerpolicy", "no-referrer");
      f.title = "Web page";
      f.addEventListener("load", () => {
        if (!t.busy) return;
        t.busy = false; drawTab(t); if (t.id === active) drawBarState();
      });
      t.page.append(f);
    }
    t.page.className = "sf-page " + m + (t.id === active ? " on" : "");
    t.key = "n" + n;
    f.src = m === "live" ? url : liteSrc(url, t.key);
    addHist(url, t.title !== host(url) ? t.title : "");
    drawTab(t); if (t.id === active) drawBarState();
    saveTabs();
  }

  function showErr(t, url, why) {
    t.busy = false; t.mode = "err"; t.title = "Can't open " + (host(url) || "page");
    t.page.innerHTML = `<div class="sf-err"><div class="c"><div class="qt-eyebrow">Surf</div><h2>Can't open that page</h2>
      <p>${esc(why || "The site didn't answer.")}</p><code>${esc(url)}</code>
      <div class="row"><button class="qt-btn primary" data-a="retry">Try again</button><button class="qt-btn" data-a="lite">Try Lite</button>
      <button class="qt-btn" data-a="pop">Pop out</button><button class="qt-btn ghost" data-a="browser">Open in my browser</button></div></div></div>`;
    t.page.className = "sf-page" + (t.id === active ? " on" : "");
    t.page.querySelector(".sf-err").onclick = e => {
      const a = e.target.closest("[data-a]"); if (!a) return;
      if (a.dataset.a === "retry") { frameCache.delete(host(url)); load(t, url, { push: false }); }
      if (a.dataset.a === "lite") load(t, url, { push: false, mode: "lite" });
      if (a.dataset.a === "pop") popOut(url);
      if (a.dataset.a === "browser") inBrowser(url);
    };
    drawTab(t); if (t.id === active) drawBarState();
  }

  const back = t => { if (t && t.hi > 0) { t.hi--; load(t, t.hist[t.hi], { push: false }); } };
  const fwd = t => { if (t && t.hi < t.hist.length - 1) { t.hi++; load(t, t.hist[t.hi], { push: false }); } };
  function reload(t) {
    if (!t) return;
    anim($("#reload svg"), [{ transform: "rotate(0)" }, { transform: "rotate(360deg)" }], { duration: 500, easing: "cubic-bezier(.34,1.6,.5,1)" });
    if (t.mode === "err") frameCache.delete(host(t.url));
    load(t, t.url, { push: false, mode: t.mode === "live" || t.mode === "lite" ? t.mode : undefined });
  }
  const popOut = u => post("/api/web/pop", { url: u }).then(() => toast("Popped out " + host(u)), e => toast(e.message, { bad: true }));
  const inBrowser = u => post("/api/web/browser", { url: u }).then(() => toast("Opened in your browser"), e => toast(e.message, { bad: true }));

  /* ---------------------------------------------------------------- messages from Lite pages */
  addEventListener("message", e => {
    const d = e.data;
    if (!d || d.qtweb !== 1 || e.origin !== "null") return;
    const t = tabs.find(x => { const f = x.page.querySelector("iframe"); return f && f.contentWindow === e.source; });
    if (!t || t.mode !== "lite" || d.k !== t.key) return;
    const okUrl = u => typeof u === "string" && /^https?:\/\//i.test(u) && u.length < 8000;
    if (d.t === "page" && okUrl(d.url)) {
      if (d.url !== t.url) { t.url = d.url; if (t.hist[t.hi] !== d.url) t.hist[t.hi] = d.url; }
      if (d.title) { t.title = String(d.title).slice(0, 300); titleFor(t.url, t.title); addHist(t.url, t.title); }
      if (okUrl(d.icon)) t.icon = d.icon;
      t.busy = false; drawTab(t); if (t.id === active) drawBarState(); saveTabs();
    } else if (d.t === "nav" && okUrl(d.url)) load(t, d.url);
    else if (d.t === "newtab" && okUrl(d.url)) makeTab(d.url, { at: tabs.indexOf(t) + 1, bg: false });
    else if (d.t === "url" && okUrl(d.url)) {
      t.url = d.url; t.hist = t.hist.slice(0, t.hi + 1); t.hist.push(d.url); t.hi = t.hist.length - 1;
      if (d.title) t.title = String(d.title).slice(0, 300);
      addHist(d.url, t.title); drawTab(t); if (t.id === active) drawBarState(); saveTabs();
    } else if (d.t === "key") keys({ key: String(d.key || ""), ctrlKey: !!d.ctrl, metaKey: false, shiftKey: !!d.shift, altKey: !!d.alt, preventDefault() {}, stopImmediatePropagation() {}, synthetic: true });
  });

  /* ---------------------------------------------------------------- toolbar state */
  function drawBarState() {
    const t = cur(); if (!t) return;
    if (document.activeElement !== addr) addr.value = pretty(t.url);
    $("#back").disabled = !(t.hi > 0);
    $("#fwd").disabled = !(t.hi < t.hist.length - 1);
    const mb = $("#mode");
    mb.dataset.m = t.mode;
    mb.textContent = { live: "LIVE", lite: "LITE", start: "START", err: "OOPS" }[t.mode] || "…";
    mb.title = t.mode === "live" ? "Live: the real site. Links you click inside it don't update this bar." :
      t.mode === "lite" ? "Lite: this site won't show inside other pages, so Surf fetched a copy. No logins here; use Pop out for that." : "How this page is shown";
    $("#pop").disabled = !/^https?:/.test(t.url);
    $("#load").className = "sf-load " + (t.busy ? "on" : "done");
    drawStar();
    document.title = t.mode === "start" ? "Surf" : (t.title || "Surf");
  }
  function drawStar() {
    const t = cur(), s = $("#star"); if (!t) return;
    const on = isBm(t.url); s.classList.toggle("on", on); s.hidden = !/^https?:/.test(t.url);
    s.title = on ? "Remove bookmark (Ctrl+D)" : "Bookmark (Ctrl+D)";
  }
  function toggleBm() {
    const t = cur(); if (!t || !/^https?:/.test(t.url)) return;
    const i = bms.findIndex(b => b.url === t.url);
    if (i >= 0) { bms.splice(i, 1); toast("Bookmark removed"); }
    else { bms.unshift({ url: t.url, title: t.title || host(t.url), t: Date.now() }); toast("Bookmarked " + (t.title || host(t.url))); }
    const s = $("#star"); s.classList.remove("boing"); void s.offsetWidth; s.classList.add("boing");
    saveBms();
  }

  /* bookmarks bar */
  function drawBar() {
    const bar = $("#bms");
    $("#sf").classList.toggle("nobar", !set.bar);
    bar.innerHTML = bms.slice(0, 30).map((b, i) => `<button class="sf-bm" data-i="${i}" title="${esc(b.title)}\n${esc(b.url)}"><span class="fav"></span><span>${esc(b.title || host(b.url))}</span></button>`).join("");
    bar.querySelectorAll(".sf-bm").forEach(el => { const b = bms[+el.dataset.i]; favInto(el.querySelector(".fav"), b.url, b.icon, b.title); });
  }
  $("#bms").addEventListener("click", e => { const b = e.target.closest(".sf-bm"); if (b) openUrl(bms[+b.dataset.i].url, e.ctrlKey || e.metaKey); });
  $("#bms").addEventListener("auxclick", e => { const b = e.target.closest(".sf-bm"); if (b && e.button === 1) openUrl(bms[+b.dataset.i].url, true); });
  const openUrl = (u, newTab) => { if (newTab) makeTab(u, { at: tabs.indexOf(cur()) + 1, bg: true }); else load(cur(), u); };

  /* ---------------------------------------------------------------- start page */
  function drawStart(t) {
    const dial = bms.slice(0, 12);
    const recent = hist.filter((h, i, a) => a.findIndex(x => host(x.url) === host(h.url)) === i).slice(0, 6);
    t.page.innerHTML = `<div class="sf-start qt-dots"><div class="in">
      <div class="sf-logo"><img src="/icons/surf.svg" alt=""><h1 class="qt-display">SURF</h1></div>
      <form class="sf-big"><input placeholder="Search ${esc(ENGINES[set.engine].name)} or type a web address" spellcheck="false" autocomplete="off" aria-label="Search">
        <button class="qt-btn primary" type="submit">Go</button></form>
      <div class="sf-eng">${Object.entries(ENGINES).map(([k, e]) => `<button data-eng="${k}" class="${k === set.engine ? "on" : ""}">${esc(e.name)}</button>`).join("")}</div>
      ${dial.length ? `<div class="sf-h">Bookmarks</div><div class="sf-dial">${dial.map((b, i) => `<a class="sf-d" href="${esc(b.url)}" data-i="${i}" style="animation-delay:${i * 30}ms" title="${esc(b.url)}"><span class="fav"></span><span class="n">${esc(b.title || host(b.url))}</span><button class="rm" data-rm="${i}" title="Remove" aria-label="Remove bookmark">×</button></a>`).join("")}</div>` : ""}
      ${recent.length ? `<div class="sf-h">Recently visited</div><div class="sf-rec">${recent.map(h => `<div class="sf-r" data-u="${esc(h.url)}"><span class="fav"></span><span class="l">${esc(h.title || host(h.url))}</span><span class="u">${esc(host(h.url))}</span></div>`).join("")}</div>` : ""}
      <div class="sf-tip"><kbd>Ctrl</kbd>+<kbd>T</kbd> new tab · <kbd>Ctrl</kbd>+<kbd>L</kbd> address · <kbd>Ctrl</kbd>+<kbd>D</kbd> bookmark · <kbd>Ctrl</kbd>+<kbd>H</kbd> history · in the Suite, <kbd>Ctrl</kbd>+<kbd>K</kbd> then <b>g cats</b></div>
    </div></div>`;
    t.page.className = "sf-page" + (t.id === active ? " on" : "");
    t.page.querySelectorAll(".sf-d").forEach(el => { const b = dial[+el.dataset.i]; favInto(el.querySelector(".fav"), b.url, b.icon, b.title); });
    t.page.querySelectorAll(".sf-r").forEach(el => favInto(el.querySelector(".fav"), el.dataset.u, null, el.querySelector(".l").textContent));
    const inp = t.page.querySelector(".sf-big input");
    t.page.querySelector(".sf-big").onsubmit = e => { e.preventDefault(); if (inp.value.trim()) load(t, inp.value); };
    t.page.querySelector(".sf-start").onclick = e => {
      const rm = e.target.closest("[data-rm]");
      if (rm) { e.preventDefault(); e.stopPropagation(); bms.splice(+rm.dataset.rm, 1); saveBms(); return; }
      const eng = e.target.closest("[data-eng]");
      if (eng) { set.engine = eng.dataset.eng; saveSet(); redrawStarts(); addr.placeholder = `Search ${ENGINES[set.engine].name} or type a web address`; return; }
      const d = e.target.closest(".sf-d"); if (d) { e.preventDefault(); return openUrl(d.getAttribute("href"), e.ctrlKey || e.metaKey); }
      const r = e.target.closest(".sf-r"); if (r) return openUrl(r.dataset.u, e.ctrlKey || e.metaKey);
    };
  }
  function redrawStarts() { tabs.filter(t => t.mode === "start").forEach(drawStart); }

  /* ---------------------------------------------------------------- address bar + suggestions */
  const sugg = $("#sugg");
  let sItems = [], sSel = 0;
  function suggest() {
    const q = addr.value.trim(), ql = q.toLowerCase();
    if (!q || document.activeElement !== addr) { sugg.hidden = true; sItems = []; return; }
    const u = toUrl(q), isSearch = u.startsWith(ENGINES[set.engine].url);
    const seen = new Set();
    const pick = (list, kind) => list.filter(x => (x.title || "").toLowerCase().includes(ql) || x.url.toLowerCase().replace(/^https?:\/\/(www\.)?/, "").includes(ql))
      .filter(x => !seen.has(x.url) && seen.add(x.url)).slice(0, kind === "bm" ? 3 : 5).map(x => ({ g: kind === "bm" ? "★" : "↺", l: x.title || host(x.url), u: x.url, go: x.url }));
    sItems = [{ g: isSearch ? "⌕" : "→", l: isSearch ? `Search ${ENGINES[set.engine].name} for "${q}"` : u, u: isSearch ? "" : "Go", go: u }].concat(pick(bms, "bm"), pick(hist, "h"));
    sSel = 0;
    sugg.innerHTML = sItems.map((s, i) => `<div class="sf-sg${i === sSel ? " on" : ""}" data-i="${i}"><span class="g">${s.g}</span><span class="l">${esc(s.l)}</span><span class="u">${esc(s.u)}</span></div>`).join("");
    sugg.hidden = false;
  }
  function markSugg() { sugg.querySelectorAll(".sf-sg").forEach((el, i) => el.classList.toggle("on", i === sSel)); }
  addr.addEventListener("input", suggest);
  addr.addEventListener("focus", () => { addr.select(); });
  addr.addEventListener("blur", () => setTimeout(() => { sugg.hidden = true; drawBarState(); }, 150));
  addr.addEventListener("keydown", e => {
    if (e.key === "Escape") { e.preventDefault(); sugg.hidden = true; addr.value = pretty(cur().url); addr.blur(); return; }
    if (sugg.hidden || !sItems.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); sSel = (sSel + (e.key === "ArrowDown" ? 1 : -1) + sItems.length) % sItems.length; markSugg(); }
  });
  sugg.addEventListener("mousedown", e => { const s = e.target.closest(".sf-sg"); if (s) { e.preventDefault(); go(sItems[+s.dataset.i].go, e.ctrlKey); } });
  $("#addrform").addEventListener("submit", e => {
    e.preventDefault();
    const pickd = !sugg.hidden && sItems[sSel];
    go(pickd ? pickd.go : addr.value, false);
  });
  function go(u, newTab) {
    sugg.hidden = true;
    addr.blur();
    if (newTab) makeTab(u); else load(cur(), u);
  }
  addr.placeholder = `Search ${ENGINES[set.engine].name} or type a web address`;

  /* ---------------------------------------------------------------- mode menu */
  const mm = $("#modemenu");
  $("#mode").addEventListener("click", e => {
    e.stopPropagation();
    const t = cur();
    if (!mm.hidden || !/^https?:/.test(t.url)) { mm.hidden = true; return; }
    mm.innerHTML = `<button data-m="live" class="${t.mode === "live" ? "on" : ""}">Live<small>The real site. Fast, logins work. Some sites refuse.</small></button>
      <button data-m="lite" class="${t.mode === "lite" ? "on" : ""}">Lite<small>Surf fetches a copy. Works on sites that refuse Live, no logins.</small></button>
      <button data-m="auto">Auto<small>Let Surf pick for each site${t.force ? "" : " (now)"}.</small></button><hr>
      <button data-m="pop">Pop out<small>Its own small window with your Edge sign-ins.</small></button>
      <button data-m="browser">Open in my browser</button>`;
    const r = $("#mode").getBoundingClientRect();
    mm.style.left = r.left + "px"; mm.style.top = (r.bottom + 8) + "px";
    mm.hidden = false;
  });
  mm.addEventListener("click", e => {
    const b = e.target.closest("[data-m]"); if (!b) return;
    const t = cur(), m = b.dataset.m; mm.hidden = true;
    if (m === "pop") return popOut(t.url);
    if (m === "browser") return inBrowser(t.url);
    if (m === "auto") { t.force = null; frameCache.delete(host(t.url)); return load(t, t.url, { push: false }); }
    t.force = m; load(t, t.url, { push: false, mode: m });
  });
  document.addEventListener("click", e => { if (!mm.hidden && !mm.contains(e.target)) mm.hidden = true; });

  /* ---------------------------------------------------------------- drawer: bookmarks + history */
  const drawer = $("#drawer");
  let pane = "bm";
  function openDrawer(p) {
    if (p) pane = p;
    drawer.hidden = false;
    drawer.querySelectorAll(".sf-seg button").forEach(b => b.classList.toggle("on", b.dataset.pane === pane));
    $("#dfind").value = ""; drawList(); $("#dfind").focus();
  }
  const closeDrawer = () => { drawer.hidden = true; };
  function dayName(t) {
    const d = new Date(t), now = new Date(), y = new Date(now - 864e5);
    if (d.toDateString() === now.toDateString()) return "Today";
    if (d.toDateString() === y.toDateString()) return "Yesterday";
    return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
  }
  function drawList() {
    const q = $("#dfind").value.trim().toLowerCase();
    const list = (pane === "bm" ? bms : hist).map((x, i) => [x, i]).filter(([x]) => !q || (x.title || "").toLowerCase().includes(q) || x.url.toLowerCase().includes(q)).slice(0, 300);
    let day = "", html = "";
    for (const [x, i] of list) {
      if (pane === "hist") { const dn = dayName(x.t); if (dn !== day) { day = dn; html += `<div class="sf-dday">${esc(dn)}</div>`; } }
      html += `<div class="sf-di" data-i="${i}" title="${esc(x.url)}"><span class="fav"></span><span class="tx"><span class="l">${esc(x.title || host(x.url))}</span><span class="u">${esc(x.url.replace(/^https?:\/\//, ""))}</span></span><button class="rm" data-rm="${i}" aria-label="Remove">×</button></div>`;
    }
    $("#dlist").innerHTML = html || `<div class="sf-empty">${pane === "bm" ? "No bookmarks yet. Press Ctrl+D on a page you like." : q ? "Nothing matches." : "Pages you visit show up here."}</div>`;
    $("#dlist").querySelectorAll(".sf-di").forEach(el => { const x = (pane === "bm" ? bms : hist)[+el.dataset.i]; favInto(el.querySelector(".fav"), x.url, x.icon, x.title); });
    $("#dfoot").innerHTML = pane === "hist" && hist.length ? `<button class="qt-btn danger" data-clear>Clear history</button>` : "";
  }
  drawer.querySelector(".sf-seg").addEventListener("click", e => { const b = e.target.closest("[data-pane]"); if (b) openDrawer(b.dataset.pane); });
  $("#dfind").addEventListener("input", drawList);
  $("#dfind").addEventListener("keydown", e => { if (e.key === "Escape") { e.stopPropagation(); closeDrawer(); } if (e.key === "Enter") { const f = $("#dlist .sf-di"); f && f.click(); } });
  $("#dlist").addEventListener("click", e => {
    const list = pane === "bm" ? bms : hist;
    const rm = e.target.closest("[data-rm]");
    if (rm) { list.splice(+rm.dataset.rm, 1); pane === "bm" ? saveBms() : saveHist(); return drawList(); }
    const it = e.target.closest(".sf-di"); if (!it) return;
    openUrl(list[+it.dataset.i].url, e.ctrlKey || e.metaKey);
    if (!(e.ctrlKey || e.metaKey)) closeDrawer();
  });
  $("#dfoot").addEventListener("click", e => {
    if (!e.target.closest("[data-clear]")) return;
    const keep = hist.slice(); hist = []; lsSet("qt-surf-hist", hist); drawList(); redrawStarts();
    toast("History cleared", { action: { label: "Undo", run: () => { hist = keep; lsSet("qt-surf-hist", hist); drawList(); redrawStarts(); } } });
  });
  $("#menu").onclick = () => drawer.hidden ? openDrawer() : closeDrawer();
  $("#dclose").onclick = closeDrawer;

  /* ---------------------------------------------------------------- tab strip events */
  tabsEl.addEventListener("click", e => {
    const el = e.target.closest(".sf-tab"); if (!el) return;
    if (e.target.closest(".x")) return closeTab(+el.dataset.id);
    select(+el.dataset.id);
  });
  tabsEl.addEventListener("auxclick", e => { const el = e.target.closest(".sf-tab"); if (el && e.button === 1) { e.preventDefault(); closeTab(+el.dataset.id); } });
  tabsEl.addEventListener("mousedown", e => { if (e.button === 1) e.preventDefault(); });
  tabsEl.addEventListener("dblclick", e => { if (e.target === tabsEl) makeTab(START); });
  let dragId = null;
  tabsEl.addEventListener("dragstart", e => { const el = e.target.closest(".sf-tab"); if (!el) return; dragId = +el.dataset.id; el.classList.add("drag"); e.dataTransfer.effectAllowed = "move"; });
  tabsEl.addEventListener("dragend", () => { tabsEl.querySelectorAll(".drag,.over").forEach(x => x.classList.remove("drag", "over")); dragId = null; });
  tabsEl.addEventListener("dragover", e => { if (dragId == null) return; e.preventDefault(); const el = e.target.closest(".sf-tab"); tabsEl.querySelectorAll(".over").forEach(x => x.classList.remove("over")); el && +el.dataset.id !== dragId && el.classList.add("over"); });
  tabsEl.addEventListener("drop", e => {
    if (dragId == null) return; e.preventDefault();
    const el = e.target.closest(".sf-tab"); const from = tabs.findIndex(t => t.id === dragId);
    const to = el ? tabs.findIndex(t => t.id === +el.dataset.id) : tabs.length - 1;
    if (from < 0 || to < 0 || from === to) return;
    const [t] = tabs.splice(from, 1); tabs.splice(to, 0, t);
    tabs.forEach(x => tabsEl.append(x.el));
    anim(t.el, [{ transform: "scale(1.12) rotate(-3deg)" }, { transform: "none" }], { duration: 380, easing: "cubic-bezier(.34,1.8,.5,1)" });
    saveTabs();
  });
  tabsEl.addEventListener("wheel", e => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { tabsEl.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });

  $("#newtab").onclick = () => makeTab(START);
  $("#back").onclick = () => back(cur());
  $("#fwd").onclick = () => fwd(cur());
  $("#reload").onclick = () => reload(cur());
  $("#home").onclick = () => load(cur(), START);
  $("#pop").onclick = () => popOut(cur().url);
  $("#star").onclick = toggleBm;

  /* ---------------------------------------------------------------- keys */
  function keys(e) {
    const k = (e.key || "").toLowerCase(), c = e.ctrlKey || e.metaKey;
    const t = cur();
    const hit = fn => { e.preventDefault(); e.stopImmediatePropagation(); fn(); };
    if (c && !e.altKey && !e.shiftKey && k === "t") return hit(() => makeTab(START));
    if (c && !e.altKey && e.shiftKey && k === "t") return hit(reopen);
    if (c && !e.altKey && !e.shiftKey && k === "w") return hit(() => closeTab(active));
    if (c && !e.altKey && (k === "l")) return hit(() => { addr.focus(); addr.select(); });
    if ((c && !e.altKey && k === "r") || k === "f5") return hit(() => reload(t));
    if (c && !e.altKey && !e.shiftKey && k === "d") return hit(toggleBm);
    if (c && !e.altKey && !e.shiftKey && k === "h") return hit(() => drawer.hidden || pane !== "hist" ? openDrawer("hist") : closeDrawer());
    if (c && e.shiftKey && !e.altKey && k === "o") return hit(() => openDrawer("bm"));
    if (c && e.shiftKey && !e.altKey && k === "b") return hit(() => { set.bar = !set.bar; saveSet(); drawBar(); });
    if (c && (k === "tab" || k === "pagedown" || k === "pageup")) return hit(() => {
      const i = tabs.indexOf(t), d = (k === "pageup" || (k === "tab" && e.shiftKey)) ? -1 : 1;
      select(tabs[(i + d + tabs.length) % tabs.length].id);
    });
    if (e.altKey && !c && k === "arrowleft" && (e.synthetic || !typing(e))) return hit(() => back(t));
    if (e.altKey && !c && k === "arrowright" && (e.synthetic || !typing(e))) return hit(() => fwd(t));
    if (e.altKey && !c && k === "home") return hit(() => load(t, START));
    if (k === "escape" && !drawer.hidden) return hit(closeDrawer);
    if (c && !e.altKey && !e.shiftKey && k === "k" && parent !== window) return hit(() => parent.document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true, cancelable: true })));
  }
  const typing = e => e.target && (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable);
  addEventListener("keydown", keys, true);
  addEventListener("mouseup", e => { if (e.button === 3 || e.button === 4) { e.preventDefault(); e.stopImmediatePropagation(); e.button === 3 ? back(cur()) : fwd(cur()); } }, true);

  /* ---------------------------------------------------------------- session */
  let tabsT = 0;
  function saveTabs() {
    clearTimeout(tabsT);
    tabsT = setTimeout(() => lsSet("qt-surf-tabs", { active: tabs.findIndex(t => t.id === active), tabs: tabs.map(t => { const off = Math.max(0, t.hist.length - 30); return { hist: t.hist.slice(off), hi: Math.max(0, t.hi - off), title: t.title }; }) }), 300);
  }

  /* ---------------------------------------------------------------- hub API */
  window.qtSurf = {
    open(url, o) { o = o || {}; const t = cur(); if (o.newTab === false || (t && t.mode === "start" && t.hist.length <= 1)) load(t, url); else makeTab(url); },
    search(q, o) { this.open(ENGINES[set.engine].url + encodeURIComponent(q), o); },
    engine: () => ENGINES[set.engine].name,
    bookmarks: () => bms.slice(),
  };

  /* ---------------------------------------------------------------- boot */
  drawBar();
  const saved = lsGet("qt-surf-tabs", null);
  const startUrl = new URLSearchParams(location.search).get("u");
  if (saved && Array.isArray(saved.tabs) && saved.tabs.length) {
    saved.tabs.forEach((s, i) => { if (Array.isArray(s.hist) && s.hist.length) makeTab(null, { bg: true, restore: s }); });
    if (!tabs.length) makeTab(START);
    else select(tabs[Math.max(0, Math.min(saved.active, tabs.length - 1))].id);
  } else makeTab(START);
  if (startUrl) window.qtSurf.open(startUrl);
  window.QT_READY = true;
})();
