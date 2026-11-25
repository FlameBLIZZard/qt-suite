"use strict";
/* QT Suite viewer apps: Pictures, Player, Reader, Code, Archive. One page (suite\apps\viewer.html, served at
   /tool/<id>) whose home shows recent files of its kind, a search through Burrow, folder browsing and a drop
   zone. Files open in Peek (peek.js), which fills this app's frame. */
(() => {
  const APP = window.QT_APP;
  const META = {
    pictures: { name: "Pictures", tag: "Photo viewer", lede: "Photos and pictures, HEIC and TIFF too. Wheel to zoom, drag to pan, arrows to step through the folder.",
      start: "Pictures", places: ["Pictures", "Screenshots", "Downloads", "Desktop"], find: "Find pictures on this PC", word: "pictures" },
    player: { name: "Player", tag: "Video + music", lede: "Play videos and songs right here. Speed, loop, grab a frame, and bars that dance to the music.",
      start: "Videos", places: ["Videos", "Music", "Downloads", "Desktop"], find: "Find videos and songs", word: "videos or songs" },
    reader: { name: "Reader", tag: "PDF + docs", lede: "PDFs, Word files and Markdown notes to read, and fonts to try out.",
      start: "Documents", places: ["Documents", "Downloads", "Desktop"], find: "Find PDFs, docs and notes", word: "documents" },
    code: { name: "Code", tag: "Text + code", lede: "Text, code and logs with colours and line numbers. JSON as a tree, CSV as a table you can sort.",
      start: "QT tools", places: ["QT tools", "Documents", "Downloads", "Desktop"], find: "Find text and code files", word: "text or code files" },
    archive: { name: "Archive", tag: "Zip viewer", lede: "Look inside zip, apk and jar files, and peek at what's in them without extracting anything.",
      start: "Downloads", places: ["Downloads", "Documents", "Desktop"], find: "Find zip, apk and jar files", word: "archives" },
  }[APP] || {};
  document.body.dataset.tool = APP;
  document.title = META.name || "Viewer";
  const RM = matchMedia("(prefers-reduced-motion: reduce)");
  const anim = (el, kf, o) => (RM.matches || !el || !el.animate) ? null : el.animate(kf, o);
  const H = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const enc = encodeURIComponent;
  const human = n => n == null ? "" : n < 1024 ? n + " B" : n < 1048576 ? Math.round(n / 1024) + " KB" : n < 1073741824 ? (n / 1048576).toFixed(1) + " MB" : (n / 1073741824).toFixed(2) + " GB";
  const exts = new Set(window.qtPeekExts(APP));
  const mine = n => window.qtPeekApp(n) === APP && (APP !== "code" || window.qtPeekKind(n) !== "other");
  const ext = n => { const m = /\.([^.\\/]+)$/.exec(n); return m ? m[1].toLowerCase() : ""; };
  const isPic = n => ["image", "picture"].includes(window.qtPeekKind(n)) && ext(n) !== "ico";
  const shortDir = d => String(d || "").replace(/^C:\\Users\\[^\\]+/i, "~");
  const getJ = u => fetch(u).then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.statusText); return j; });
  window.toast = window.toast || ((m, bad) => {
    try { if (window.parent !== window && window.parent.toast) return window.parent.toast(m, bad); } catch (_) {}
    const t = document.createElement("div"); t.className = "qt-toast" + (bad ? " bad" : ""); t.textContent = m;
    document.getElementById("toasts").append(t); setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 320); }, 2400);
  });

  const va = document.getElementById("va");
  const chips = [...exts].filter(e => e.length <= 5).slice(0, APP === "code" ? 18 : 30);
  va.innerHTML = `
    <header class="va-head">
      <img class="va-icon" src="/icons/${APP}.svg" alt="">
      <div><div class="qt-eyebrow">${H(META.tag)}</div><h1 class="qt-display">${H(META.name)}</h1><p class="va-lede">${H(META.lede)}</p></div>
    </header>
    <div class="va-formats">${chips.map((e, i) => `<span class="qt-chip" style="--i:${i}">.${H(e)}</span>`).join("")}${exts.size > chips.length ? `<span class="qt-chip" style="--i:${chips.length}">+${exts.size - chips.length} more</span>` : ""}</div>
    <div class="va-bar">
      <label class="va-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>
        <input class="qt-input" id="q" placeholder="${H(META.find)}  ( / )" autocomplete="off" spellcheck="false"></label>
      <button class="qt-btn" id="pick">Pick a file</button>
      <input type="file" id="file" hidden multiple>
    </div>
    <div class="va-results" id="res" hidden></div>
    <section class="va-sec" id="recentSec"><div class="va-sh"><h2>Recent</h2><button class="qt-btn ghost" id="clear">Clear</button></div><div class="va-grid" id="recent"></div></section>
    <section class="va-sec"><div class="va-sh"><h2>Browse</h2><div class="va-places" id="places"></div></div>
      <div class="va-crumb qt-mono" id="crumb"></div><div class="va-dirs" id="dirs"></div><div class="va-grid" id="grid"></div></section>
    <div class="va-dropzone" aria-hidden="true"><div><b class="qt-display">Drop to open</b><span>It opens in ${H(META.name)}, nothing gets copied.</span></div></div>`;

  /* ---------- cards ---------- */
  const card = (f, i) => {
    const pic = isPic(f.name) && f.path;
    return `<button class="va-card qt-card" data-path="${H(f.path)}" style="--i:${Math.min(i, 24)}" title="${H(f.path)}">
      <span class="va-th">${pic ? `<img loading="lazy" alt="" src="/api/peek/render?s=320&path=${enc(f.path)}" onerror="this.remove()">` : ""}<b>${H(ext(f.name).slice(0, 5) || "?")}</b>${window.qtPeekKind(f.name) === "video" ? "<em>▶</em>" : ""}</span>
      <span class="va-nm"><b>${H(f.name)}</b><small>${H(f.sub || shortDir(f.dir || ""))}</small></span></button>`;
  };
  const listOf = box => [...box.querySelectorAll(".va-card")].map(c => c.dataset.path);
  va.addEventListener("click", e => {
    const c = e.target.closest(".va-card");
    if (c) {
      const box = c.parentElement, r = c.getBoundingClientRect();
      anim(c, [{ transform: "scale(.94)" }, { transform: "scale(1.04)" }, { transform: "none" }], { duration: 300, easing: "ease-out" });
      return window.qtPeek(c.dataset.path, { list: listOf(box), only: APP, from: { x: r.left + r.width / 2, y: r.top + r.height / 2 } });
    }
    const d = e.target.closest("[data-dir]");
    if (d) return browse(d.dataset.dir);
  });

  /* ---------- recent ---------- */
  function paintRecent() {
    const r = window.qtPeekRecent().filter(x => mine(x.name)).slice(0, 12);
    document.getElementById("recentSec").hidden = !r.length;
    document.getElementById("recent").innerHTML = r.map((x, i) => card({ path: x.path, name: x.name, dir: x.dir }, i)).join("");
  }
  document.getElementById("clear").onclick = () => {
    const keep = window.qtPeekRecent().filter(x => !mine(x.name));
    try { localStorage.setItem("qt-peek-recent", JSON.stringify(keep)); } catch (_) {}
    const g = document.getElementById("recent");
    const a = anim(g, [{ opacity: 1 }, { opacity: 0, transform: "translateY(10px)" }], { duration: 220, fill: "forwards" });
    (a ? a.finished : Promise.resolve()).then(paintRecent);
  };
  addEventListener("storage", e => { if (e.key === "qt-peek-recent") paintRecent(); });
  addEventListener("focus", paintRecent);
  addEventListener("qt-peek-close", () => setTimeout(paintRecent, 320));

  /* ---------- browse folders ---------- */
  let PLACES = [];
  async function browse(dir) {
    const grid = document.getElementById("grid"), dirs = document.getElementById("dirs"), crumb = document.getElementById("crumb");
    grid.innerHTML = `<div class="pk-load"><i></i><i></i><i></i></div>`;
    document.querySelectorAll("#places [data-dir]").forEach(b => b.classList.toggle("on", b.dataset.dir.toLowerCase() === dir.toLowerCase()));
    try {
      const r = await getJ("/api/peek/near?path=" + enc(dir));
      const files = r.files.filter(f => mine(f.n)).sort((a, b) => APP === "pictures" || APP === "player" ? b.m - a.m : 0);
      crumb.innerHTML = `${r.parent ? `<button class="qt-btn ghost" data-dir="${H(r.parent)}" title="Up a folder">↑</button>` : ""}<span>${H(shortDir(r.dir))}</span><em>${files.length} ${files.length === 1 ? "file" : "files"}${r.files.length > files.length ? ` · ${r.files.length - files.length} other` : ""}</em>`;
      dirs.innerHTML = r.dirs.slice(0, 40).map((d, i) => `<button class="va-dir" data-dir="${H(r.dir.replace(/\\$/, "") + "\\" + d)}" style="--i:${Math.min(i, 20)}">📁 ${H(d)}</button>`).join("") + (r.dirs.length > 40 ? `<span class="qt-muted">+${r.dirs.length - 40} more folders</span>` : "");
      grid.innerHTML = files.slice(0, 400).map((f, i) => card({ path: r.dir.replace(/\\$/, "") + "\\" + f.n, name: f.n, sub: human(f.s) }, i)).join("")
        || `<p class="qt-muted va-empty">No ${H(META.word)} in here. Try a folder above.</p>`;
      try { localStorage.setItem("qt-va-dir-" + APP, r.dir); } catch (_) {}
    } catch (e) { grid.innerHTML = `<p class="qt-muted va-empty">${H(e.message)}</p>`; }
  }
  (async () => {
    try { PLACES = (await getJ("/api/peek/places")).places; } catch (_) {}
    const want = META.places.map(n => PLACES.find(p => p.name === n)).filter(Boolean);
    document.getElementById("places").innerHTML = want.map((p, i) => `<button class="qt-btn va-place" data-dir="${H(p.path)}" style="--i:${i}">${H(p.name)}</button>`).join("");
    let start = ""; try { start = localStorage.getItem("qt-va-dir-" + APP) || ""; } catch (_) {}
    start = start || (want.find(p => p.name === META.start) || want[0] || {}).path;
    if (start) browse(start);
  })();

  /* ---------- search through Burrow ---------- */
  const q = document.getElementById("q"), res = document.getElementById("res");
  let seq = 0, timer;
  q.addEventListener("input", () => {
    clearTimeout(timer);
    const text = q.value.trim();
    if (text.length < 2) { res.hidden = true; res.innerHTML = ""; return; }
    timer = setTimeout(async () => {
      const my = ++seq;
      res.hidden = false;
      res.innerHTML = `<div class="pk-load"><i></i><i></i><i></i></div>`;
      try {
        const extList = [...exts].join(",");
        const r = await getJ("/api/find?n=24&q=" + enc(text + " ext:" + extList));
        if (my !== seq) return;
        if (r.off) { res.innerHTML = `<p class="qt-muted va-empty">Start Burrow to search your files. It does the digging.</p>`; return; }
        const files = (r.files || []).filter(f => !f.isdir && mine(f.name));
        res.innerHTML = files.length ? `<div class="va-grid">${files.map((f, i) => card({ path: f.path, name: f.name, dir: f.dir }, i)).join("")}</div>`
          : `<p class="qt-muted va-empty">Nothing called "${H(text)}" yet.</p>`;
      } catch (e) { if (my === seq) res.innerHTML = `<p class="qt-muted va-empty">${H(e.message)}</p>`; }
    }, 260);
  });
  q.addEventListener("keydown", e => {
    if (e.key === "Enter") { const c = res.querySelector(".va-card"); c && c.click(); }
    if (e.key === "Escape") { q.value = ""; q.dispatchEvent(new Event("input")); q.blur(); }
  });
  addEventListener("keydown", e => {
    if (e.key === "/" && document.activeElement !== q && !document.querySelector(".pk")) { e.preventDefault(); q.focus(); }
  });

  /* ---------- pick / drop ---------- */
  const fi = document.getElementById("file");
  document.getElementById("pick").onclick = () => fi.click();
  fi.onchange = () => { if (fi.files.length) window.qtPeekFiles(fi.files); fi.value = ""; };

  paintRecent();

  /* ---------- opened from Windows (QT is the default app): /tool/<app>?open=<path> ---------- */
  const opened = new URLSearchParams(location.search).get("open");
  if (opened && window.parent === window) {
    const nm = opened.split(/[\\/]/).pop();
    const title = () => { document.title = `${nm} · QT ${META.name || ""}`.trim(); };
    title();
    new MutationObserver(() => {   // stepping with the arrows: keep the window title on the file showing
      const n = document.querySelector(".pk .pk-name");
      if (n && n.textContent) document.title = `${n.textContent} · QT ${META.name || ""}`.trim();
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
    document.documentElement.classList.add("va-solo");
    window.qtPeek(opened, { only: APP }).catch(e => window.toast(String(e.message || e), true));
    addEventListener("qt-peek-close", () => { document.title = `QT ${META.name || "Viewer"}`; history.replaceState(null, "", location.pathname); paintRecent(); });
  }
  window.QT_READY = true;
})();
