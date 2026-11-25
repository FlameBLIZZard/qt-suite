"use strict";
/* QT Suite Peek: open files inside the suite instead of handing them to other apps.
   window.qtPeek(path, { list, from })   list = paths for previous / next, from = {x, y} the pop grows out of
   window.qtPeekable(name)               false for things you run (exe, lnk, bat) and Office files Peek can't read
   window.qtPeekRecent()                 the last files opened here (Ctrl+K shows them)
   Burrow inside the hub sends {qt:"peek"} messages here; files dropped on the hub open too.
   Server side: viewer.py (/api/peek/*). */
(() => {
  const RM = matchMedia("(prefers-reduced-motion: reduce)");
  const anim = (el, kf, o) => (RM.matches || !el || !el.animate) ? null : el.animate(kf, o);
  const enc = encodeURIComponent;
  const H = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const rawUrl = (p, entry) => "/api/peek/raw?path=" + enc(p) + (entry ? "&entry=" + enc(entry) : "");
  const renderUrl = (p, s) => "/api/peek/render?path=" + enc(p) + (s ? "&s=" + s : "");
  const post = (u, b) => fetch(u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })
    .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.msg || j.error || r.statusText); return j; });
  const getJ = u => fetch(u).then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.statusText); return j; });
  const human = n => n == null ? "" : n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(n < 10240 ? 1 : 0) + " KB" : n < 1073741824 ? (n / 1048576).toFixed(1) + " MB" : (n / 1073741824).toFixed(2) + " GB";
  const when = t => t ? new Date(t * 1000).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  const base = p => String(p).split(/[\\/]/).pop();
  const dirOf = p => { const i = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/")); return i > 2 ? p.slice(0, i) : p.slice(0, i + 1); };
  const shortDir = d => String(d || "").replace(/^C:\\Users\\[^\\]+/i, "~");
  // inside a viewer app (an iframe of the hub, same origin) the hub's toasts and Burrow link are used
  const HUBW = (() => { try { return window.parent !== window && window.parent.qtPeek ? window.parent : null; } catch (_) { return null; } })();
  const IN_APP = !!window.QT_APP;
  const toastP = (m, bad) => { const t = window.toast || (HUBW && HUBW.toast); t ? t(m, bad) : console.log(m); };
  // a toast with a button (spark.js qtToast in the hub); falls back to a plain toast
  const toastA = (m, action) => { const t = window.qtToast || (HUBW && HUBW.qtToast); t ? t(m, { action }) : toastP(m); };
  const canSpark = () => true;   // /api/spark/* lives on the same hub that serves this page

  /* ---------- kinds (mirror of viewer.py, used for the strip, drops and Burrow routing) ---------- */
  const KINDS = {
    image: "jpg jpeg png gif webp bmp ico svg avif jfif apng", picture: "heic heif tif tiff psd tga dds pcx ppm",
    video: "mp4 webm mov m4v mkv ogv", audio: "mp3 wav flac m4a aac ogg opus weba oga", pdf: "pdf", markdown: "md markdown mdown",
    table: "csv tsv", json: "json inkm geojson webmanifest", html: "html htm xhtml", font: "ttf otf woff woff2",
    zip: "zip apk jar xpi crx whl nupkg", docx: "docx", "media-x": "avi wmv flv 3gp mpg mpeg m2ts vob",
    code: "txt log py pyw js mjs cjs ts tsx jsx css scss less xml yml yaml toml ini cfg conf ps1 psm1 sh bash zsh java kt kts c cc cpp cxx h hpp cs go rs lua gd gdshader gradle properties env gitignore gitattributes editorconfig pxl srt vtt sql php rb swift dart vue svelte r m mm pl diff patch lock csproj sln vcxproj nfo tex bib rst adoc org",
  };
  const EXT2 = {};
  Object.entries(KINDS).forEach(([k, v]) => v.split(" ").forEach(e => { EXT2[e] = EXT2[e] || k; }));
  const extOf = n => { const m = /\.([^.\\/]+)$/.exec(n || ""); return m ? m[1].toLowerCase() : ""; };
  const kindOf = n => EXT2[extOf(n)] || "other";
  // things you run, or files Peek can't make sense of: these still go to their Windows app
  const SKIP = new Set("exe msi lnk url appx msix msixbundle com scr cpl bat cmd vbs vbe wsf reg doc xls ppt xlsx xlsm pptx odt ods odp rtf epub iso img 7z rar gz tgz bz2 xz cab dll sys blend psb kra xcf".split(" "));
  window.qtPeekable = n => !SKIP.has(extOf(n));
  // which viewer app owns each kind (the five tiles in the rail)
  const APP = { image: "pictures", picture: "pictures", video: "player", "media-x": "player", audio: "player", pdf: "reader", docx: "reader",
    markdown: "reader", font: "reader", code: "code", json: "code", table: "code", html: "code", other: "code", zip: "archive" };
  const APPNAME = { pictures: "Pictures", player: "Player", reader: "Reader", code: "Code", archive: "Archive" };
  window.qtPeekKind = kindOf;
  window.qtPeekApp = n => APP[kindOf(n)] || "code";
  window.qtPeekKinds = app => Object.keys(KINDS).filter(k => APP[k] === app);
  window.qtPeekExts = app => window.qtPeekKinds(app).flatMap(k => KINDS[k].split(" "));
  const LABEL = { image: "Picture", picture: "Picture", video: "Video", audio: "Audio", pdf: "PDF", markdown: "Markdown", table: "Table", json: "JSON",
    html: "Web page", font: "Font", zip: "Archive", docx: "Word", code: "Text", "media-x": "Video", other: "File", folder: "Folder" };

  /* ---------- recent ---------- */
  const RKEY = "qt-peek-recent";
  const recent = () => { try { return JSON.parse(localStorage.getItem(RKEY) || "[]"); } catch (_) { return []; } };
  window.qtPeekRecent = recent;
  function remember(info) {
    if (!info.path) return;
    const r = recent().filter(x => x.path.toLowerCase() !== info.path.toLowerCase());
    r.unshift({ path: info.path, name: info.name, dir: info.folder || dirOf(info.path), kind: info.kind, t: Date.now() });
    try { localStorage.setItem(RKEY, JSON.stringify(r.slice(0, 20))); } catch (_) {}
  }

  /* ---------- state ---------- */
  let ov = null;          // overlay element
  let st = null;          // { list:[{path,name,blob?,file?}], i, info, cleanup, seq, sub }
  let lastFocus = null;

  /* =========================================================================================
     open / close
     ========================================================================================= */
  window.qtPeek = async function qtPeek(path, opts = {}) {
    const only = opts.only || "";
    const keep = x => !only || x.path === path || (APP[kindOf(x.name)] || "code") === only;
    const items = (opts.list && opts.list.length > 1 ? opts.list : [path]).map(p => typeof p === "string" ? { path: p, name: base(p) } : p).filter(keep);
    let i = items.findIndex(x => x.path && x.path.toLowerCase() === String(path).toLowerCase());
    if (i < 0) { items.unshift({ path, name: base(path) }); i = 0; }
    build(opts.from);
    st = { list: items, i, seq: 0, cleanup: null, only, own: !(opts.list && opts.list.length > 1) };
    await load(0);
    if (st && st.own) siblings(path);   // fill previous / next from the folder
  };
  window.qtPeekFiles = function (files, from) {   // dropped from Windows: no path, read in the page
    const items = [...files].filter(f => f.size >= 0).map(f => ({ path: "", name: f.name, file: f }));
    if (!items.length) return;
    build(from);
    st = { list: items, i: 0, seq: 0, cleanup: null };
    load(0);
  };

  async function siblings(path) {
    try {
      const r = await getJ("/api/peek/near?path=" + enc(path));
      if (!st || st.list.length > 1 || st.list[0].path !== path) return;
      const list = r.files.map(f => ({ path: r.dir.replace(/\\$/, "") + "\\" + f.n, name: f.n, s: f.s, k: f.k }))
        .filter(x => !st.only || x.name.toLowerCase() === base(path).toLowerCase() || (APP[x.k] || "code") === st.only);
      const i = list.findIndex(x => x.name.toLowerCase() === base(path).toLowerCase());
      if (i < 0 || list.length < 2) return;
      st.list = list; st.i = i;
      paintStrip(true); paintCount();
    } catch (_) {}
  }

  function build(from) {
    if (ov) { teardown(); ov.remove(); }   // a new file while one is open: replace the overlay, don't stack them
    else lastFocus = document.activeElement;
    ov = document.createElement("div");
    ov.className = "pk";
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-modal", "true");
    ov.setAttribute("aria-label", "File viewer");
    ov.innerHTML = `<div class="pk-back" data-pk="x"></div>
      <div class="pk-card" tabindex="-1">
        <header class="pk-top">
          <span class="pk-badge"><b></b></span>
          <div class="pk-title"><b class="pk-name"></b><small class="pk-sub"></small></div>
          <div class="pk-tools"></div>
          <div class="pk-acts">
            <button class="qt-btn pk-appbtn" data-pk="app" hidden title="Open in the full viewer app (A)"><img alt=""><span></span></button>
            <button class="qt-btn primary" data-pk="open" title="Open in its Windows app (O)">${ICON.open}<span>Windows app</span></button>
            <button class="qt-btn icon" data-pk="with" title="Open with...">${ICON.with}</button>
            <button class="qt-btn icon" data-pk="burrow" title="Show in Burrow (B)">${ICON.folder}</button>
            <button class="qt-btn icon" data-pk="beam" title="Send to phone">${ICON.phone}</button>
            <button class="qt-btn icon" data-pk="copy" title="Copy path">${ICON.link}</button>
            <button class="qt-btn icon pk-pin" data-pk="pin" title="Pin to Home (P)" hidden>${ICON.pin}</button>
            <button class="qt-btn icon pk-x" data-pk="x" title="Close (Esc)">${ICON.x}</button>
          </div>
        </header>
        <div class="pk-body">
          <button class="pk-nav l" data-pk="prev" title="Previous (←)" aria-label="Previous file">${ICON.left}</button>
          <div class="pk-stage"></div>
          <button class="pk-nav r" data-pk="next" title="Next (→)" aria-label="Next file">${ICON.right}</button>
        </div>
        <footer class="pk-foot"><div class="pk-strip" role="listbox" aria-label="Files in this folder"></div><span class="pk-count qt-mono"></span></footer>
      </div>`;
    document.body.append(ov);
    document.documentElement.classList.add("pk-open");
    const card = ov.querySelector(".pk-card");
    const r = card.getBoundingClientRect();
    const fx = from && from.x != null ? from.x - r.left : r.width / 2, fy = from && from.y != null ? from.y - r.top : r.height / 2;
    card.style.transformOrigin = `${fx}px ${fy}px`;
    anim(card, [{ transform: "scale(.35) rotate(-4deg)", opacity: 0 }, { transform: "scale(1.025, .975) rotate(.4deg)", opacity: 1, offset: .62 }, { transform: "scale(.995, 1.006)", offset: .82 }, { transform: "none" }],
      { duration: 520, easing: "cubic-bezier(.2,.9,.2,1)" });
    anim(ov.querySelector(".pk-back"), [{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: "ease-out" });
    card.focus({ preventScroll: true });
  }

  function teardown() {
    if (st && st.cleanup) { try { st.cleanup(); } catch (_) {} }
    if (st) st.list.forEach(x => x.blob && URL.revokeObjectURL(x.blob));
  }

  function close() {
    if (!ov) return;
    teardown();
    const o = ov; ov = null; st = null;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    document.documentElement.classList.remove("pk-open");
    o.style.pointerEvents = "none";
    const a = anim(o.querySelector(".pk-card"), [{ transform: "none", opacity: 1 }, { transform: "scale(1.03, .96)", offset: .3 }, { transform: "scale(.6) translateY(40px) rotate(3deg)", opacity: 0 }], { duration: 300, easing: "ease-in", fill: "forwards" });
    anim(o.querySelector(".pk-back"), [{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: "forwards" });
    const done = () => o.remove();
    dispatchEvent(new Event("qt-peek-close"));
    a ? (a.finished.then(done, done), setTimeout(done, 450)) : done();
    if (lastFocus && lastFocus.focus) try { lastFocus.focus({ preventScroll: true }); } catch (_) {}
  }
  window.qtPeekClose = close;

  /* =========================================================================================
     loading one file
     ========================================================================================= */
  async function load(dir) {
    if (!st) return;
    const my = ++st.seq;
    const item = st.list[st.i];
    const stage = ov.querySelector(".pk-stage");
    if (st.cleanup) { try { st.cleanup(); } catch (_) {} st.cleanup = null; }
    st.sub = null;
    // slide the old file out
    const old = stage.firstElementChild;
    if (old && dir) {
      const a = anim(old, [{ transform: "none", opacity: 1 }, { transform: `translateX(${-dir * 70}px) skewX(${dir * 5}deg) scale(.96)`, opacity: 0 }], { duration: 150, easing: "ease-in", fill: "forwards" });
      if (a) await Promise.race([a.finished.catch(() => {}), new Promise(r => setTimeout(r, 200))]);   // never wait on a paused page
      if (!st || my !== st.seq) return;
    }
    stage.innerHTML = `<div class="pk-load"><i></i><i></i><i></i></div>`;
    paintHead({ name: item.name, kind: item.k || kindOf(item.name), size: item.s });
    paintStrip(); paintCount();
    let info;
    try { info = item.file ? await fileInfo(item) : await getJ("/api/peek/info?path=" + enc(item.path)); }
    catch (e) { info = { name: item.name, path: item.path, kind: "error", error: e.message }; }
    if (!st || my !== st.seq) return;
    st.info = info;
    if (!item.file && info.kind !== "error") remember(info);
    paintHead(info);
    const view = document.createElement("div");
    view.className = "pk-view pk-" + info.kind;
    stage.replaceChildren(view);
    const oldTools = ov.querySelector(".pk-tools"), tools = oldTools.cloneNode(false);   // fresh node: no listeners left from the last file
    oldTools.replaceWith(tools);
    try { st.cleanup = await (VIEW[info.kind] || VIEW.other)(view, info, tools) || null; }
    catch (e) { view.innerHTML = noPreview(info, "Couldn't show it: " + e.message); }
    if (!st || my !== st.seq) return;
    anim(view, dir ? [{ transform: `translateX(${dir * 80}px) skewX(${-dir * 5}deg) scale(.97)`, opacity: 0 }, { transform: `translateX(${-dir * 6}px) skewX(${dir}deg)`, opacity: 1, offset: .65 }, { transform: "none" }]
      : [{ transform: "translateY(16px) scale(.98)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: dir ? 380 : 420, easing: "cubic-bezier(.2,.9,.2,1)" });
    ov.querySelectorAll(".pk-tools > *").forEach((b, k) => anim(b, [{ transform: "translateY(-10px) scale(.7)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 360, delay: 40 + k * 35, easing: "cubic-bezier(.34,1.8,.5,1)", fill: "backwards" }));
  }

  async function fileInfo(item) {
    const f = item.file, k = kindOf(f.name);
    item.blob = item.blob || URL.createObjectURL(f);
    const info = { name: f.name, path: "", blob: item.blob, kind: k, ext: extOf(f.name), size: f.size, m: f.lastModified / 1000, dropped: true };
    if (["code", "markdown", "table", "json", "html", "other"].includes(k) && f.size < 4 * 1024 * 1024) {
      const buf = new Uint8Array(await f.slice(0, 2 * 1024 * 1024).arrayBuffer());
      if (buf.subarray(0, 8000).includes(0)) { info.kind = "other"; info.head = [...buf.subarray(0, 512)].map(b => b.toString(16).padStart(2, "0")).join(""); }
      else { info.text = new TextDecoder().decode(buf); info.cut = f.size > buf.length; if (k === "other") info.kind = "code"; }
    } else if (k === "other") {
      const buf = new Uint8Array(await f.slice(0, 512).arrayBuffer());
      info.head = [...buf].map(b => b.toString(16).padStart(2, "0")).join("");
    }
    if (["zip", "docx", "picture"].includes(k)) info.needPath = true;
    return info;
  }
  const srcOf = info => info.blob || rawUrl(info.path);

  // colours follow the app that owns the kind (same as --qt-pictures etc. in qt.css)
  const KCOL = { image: "#ffd84d", picture: "#ffd84d", video: "#ff3dd6", "media-x": "#ff3dd6", audio: "#ff3dd6", pdf: "#e8d9b5", markdown: "#e8d9b5", docx: "#e8d9b5",
    font: "#e8d9b5", table: "#a0e8ff", json: "#a0e8ff", code: "#a0e8ff", html: "#a0e8ff", zip: "#d9a066", other: "#b6aea3", error: "#ff5d6c", folder: "#2ee6d6" };
  function paintHead(info) {
    if (!ov) return;
    const k = info.kind || "other";
    ov.dataset.kind = k;
    ov.style.setProperty("--pk", KCOL[k] || KCOL.other);
    const b = ov.querySelector(".pk-badge b"), ext = (info.ext || extOf(info.name) || LABEL[k] || "?").toUpperCase().slice(0, 5);
    if (b.textContent !== ext) { b.textContent = ext; anim(b.parentElement, [{ transform: "scale(.5) rotate(-14deg)" }, { transform: "scale(1.18) rotate(5deg)", offset: .6 }, { transform: "none" }], { duration: 420, easing: "ease-out" }); }
    ov.querySelector(".pk-name").textContent = info.name || "";
    const bits = [];
    if (info.folder || info.path) bits.push(`<span class="qt-mono" title="${H(info.folder || dirOf(info.path))}">${H(shortDir(info.folder || dirOf(info.path)))}</span>`);
    else if (info.dropped) bits.push("<span>Dropped in, not saved anywhere new</span>");
    if (info.size != null) bits.push(`<span>${human(info.size)}</span>`);
    if (info.dims) bits.push(`<span>${info.dims[0]} × ${info.dims[1]}</span>`);
    if (info.m) bits.push(`<span>${when(info.m)}</span>`);
    ov.querySelector(".pk-sub").innerHTML = bits.join("<i>·</i>");
    const noPath = !info.path;
    const app = APP[k === "error" || k === "folder" ? "" : k], ab = ov.querySelector('[data-pk="app"]');
    const appTool = !IN_APP && app && typeof tools !== "undefined" && tools.find(t => t.id === app);
    ab.hidden = !appTool || noPath;
    if (appTool && ab.dataset.app !== app) {
      ab.dataset.app = app; ab.querySelector("img").src = "/icons/" + app + ".svg"; ab.querySelector("span").textContent = APPNAME[app];
      ab.style.setProperty("--c", `var(--qt-${app})`);
    }
    ov.querySelectorAll('[data-pk="open"],[data-pk="with"],[data-pk="burrow"],[data-pk="beam"],[data-pk="copy"]').forEach(x => { x.disabled = noPath; });
    const pins = pinApi(), pb = ov.querySelector('[data-pk="pin"]');
    pb.hidden = !pins || noPath || k === "error";
    if (pins && info.path) { const on = pins.has(info.path); pb.classList.toggle("on", on); pb.title = on ? "Unpin from Home (P)" : "Pin to Home (P)"; }
  }
  const pinApi = () => window.qtPin || (HUBW && HUBW.qtPin) || null;

  function paintCount() {
    if (!ov || !st) return;
    const n = st.list.length;
    ov.querySelector(".pk-count").textContent = n > 1 ? `${st.i + 1} / ${n}` : "";
    ov.querySelectorAll(".pk-nav").forEach(b => { b.hidden = n < 2; });
  }

  function paintStrip(fresh) {
    if (!ov || !st) return;
    const strip = ov.querySelector(".pk-strip");
    const n = st.list.length;
    ov.classList.toggle("pk-solo", n < 2);
    if (n < 2 || n > 600) { strip.innerHTML = ""; return; }
    if (fresh || strip.childElementCount !== n) {
      strip.innerHTML = st.list.map((x, i) => {
        const k = x.k || kindOf(x.name);
        const img = (k === "image" || k === "picture") && x.path && extOf(x.name) !== "ico";
        return `<button class="pk-th" role="option" data-i="${i}" title="${H(x.name)}" style="--c:${KCOL[k] || KCOL.other}">${img ? `<img loading="lazy" alt="" src="${renderUrl(x.path, 112)}" onerror="this.remove()">` : ""}<b>${H((extOf(x.name) || "?").slice(0, 4))}</b>${k === "video" ? "<em>▶</em>" : ""}</button>`;
      }).join("");
      if (fresh) anim(strip, [{ transform: "translateY(30px)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 380, easing: "cubic-bezier(.34,1.6,.5,1)" });
    }
    strip.querySelectorAll(".pk-th.on").forEach(e => e.classList.remove("on"));
    const on = strip.children[st.i];
    if (on) {
      on.classList.add("on"); on.setAttribute("aria-selected", "true");
      on.scrollIntoView({ block: "nearest", inline: "center", behavior: RM.matches ? "auto" : "smooth" });
    }
  }

  function step(d) {
    if (!st || st.list.length < 2) return;
    st.i = (st.i + d + st.list.length) % st.list.length;
    load(d);
  }

  /* =========================================================================================
     views
     ========================================================================================= */
  const tb = (act, label, title, cls = "") => `<button class="qt-btn pk-tb ${cls}" data-tb="${act}" title="${H(title || label)}">${label}</button>`;
  const seg = (k, opts, on) => `<div class="pk-seg" data-seg="${k}">${opts.map(([v, l]) => `<button data-v="${v}" aria-pressed="${v === on}">${l}</button>`).join("")}</div>`;
  function noPreview(info, msg) {
    return `<div class="pk-none"><div class="pk-bigbadge" style="--c:${KCOL[info.kind] || KCOL.other}"><b>${H((info.ext || "?").toUpperCase().slice(0, 5))}</b></div>
      <h2 class="qt-display">${H(msg || "No preview for this one")}</h2>
      <p class="qt-muted">${info.path ? "Open it in its Windows app, or show it in Burrow." : "Drop it into Burrow, or open it from Burrow to see more."}</p>
      ${info.path ? `<div class="pk-none-acts"><button class="qt-btn primary" data-pk="open">${ICON.open}Open in app</button><button class="qt-btn" data-pk="with">${ICON.with}Open with...</button></div>` : ""}</div>`;
  }

  const VIEW = {};

  /* ---------- error ---------- */
  VIEW.error = (v, info) => { v.innerHTML = noPreview({ ...info, kind: "error", ext: "!" }, info.error || "That didn't open"); };
  VIEW.folder = (v, info) => { v.innerHTML = noPreview({ ...info, ext: "DIR" }, "That's a folder"); };

  /* ---------- pictures: fit, zoom around the cursor, drag to pan, rotate ---------- */
  VIEW.image = VIEW.picture = (v, info, tools) => {
    if (info.kind === "picture" && info.needPath) { v.innerHTML = noPreview(info, "This picture needs to be opened from Burrow"); return; }
    const src = info.kind === "picture" ? renderUrl(info.path, 0) : srcOf(info);
    v.innerHTML = `<div class="pk-canvas"><img alt="" draggable="false" src="${H(src)}"></div>`;
    tools.innerHTML = tb("out", "−", "Zoom out (-)") + `<span class="pk-zoom qt-mono">fit</span>` + tb("in", "+", "Zoom in (+)") + tb("fit", "Fit", "Fit (0)") + tb("one", "1:1", "Actual size (1)") + tb("rot", "⟳", "Rotate (R)")
      + (info.path ? tb("info", "ⓘ", "Photo facts: camera, lens, settings (I)", localStorage.getItem("qt-pk-info") === "1" ? "on" : "") : "")
      + (info.path || st.list.length > 1 ? tb("show", "▶ Slideshow", "Slideshow through the pictures here (S)", st.show ? "on" : "") : "");
    const box = v.querySelector(".pk-canvas"), img = box.querySelector("img"), zl = tools.querySelector(".pk-zoom");
    let z = 1, x = 0, y = 0, rot = 0, fitZ = 1;
    const apply = smooth => {
      img.style.transition = smooth && !RM.matches ? "transform .32s cubic-bezier(.34,1.4,.5,1)" : "none";
      img.style.transform = `translate(${x}px, ${y}px) scale(${z}) rotate(${rot}deg)`;
      zl.textContent = Math.abs(z - 1) < .001 ? "fit" : Math.round(z * fitZ * 100) + "%";
      box.classList.toggle("zoomed", z > 1.001);
    };
    const measure = () => {   // how much "fit" already shrank it
      if (!img.naturalWidth) return;
      fitZ = Math.min(1, img.clientWidth / img.naturalWidth || 1);
      if (!info.dims) { info.dims = [img.naturalWidth, img.naturalHeight]; paintHead(info); }
    };
    img.addEventListener("load", () => { measure(); apply(); anim(img, [{ filter: "blur(8px)", opacity: .2, transform: "scale(.94)" }, { filter: "none", opacity: 1, transform: "none" }], { duration: 380, easing: "ease-out" }); });
    img.addEventListener("error", () => { v.innerHTML = noPreview(info, "Edge can't draw this picture"); });
    const zoomAt = (nz, cx, cy, smooth) => {
      nz = Math.max(1, Math.min(40, nz));
      const r = box.getBoundingClientRect();
      const px = (cx ?? r.left + r.width / 2) - r.left - r.width / 2, py = (cy ?? r.top + r.height / 2) - r.top - r.height / 2;
      x = px - (px - x) * nz / z; y = py - (py - y) * nz / z; z = nz;
      if (z === 1) { x = 0; y = 0; }
      apply(smooth);
    };
    box.addEventListener("wheel", e => { e.preventDefault(); zoomAt(z * Math.exp(-e.deltaY * .0016), e.clientX, e.clientY); }, { passive: false });
    box.addEventListener("dblclick", e => { measure(); zoomAt(z > 1.01 ? 1 : Math.max(2, 1 / fitZ), e.clientX, e.clientY, true); });
    let drag = null;
    box.addEventListener("pointerdown", e => { if (z <= 1.001 || e.button) return; drag = { sx: e.clientX - x, sy: e.clientY - y }; box.setPointerCapture(e.pointerId); box.classList.add("grab"); });
    box.addEventListener("pointermove", e => { if (!drag) return; x = e.clientX - drag.sx; y = e.clientY - drag.sy; apply(); });
    const up = () => { drag = null; box.classList.remove("grab"); };
    box.addEventListener("pointerup", up); box.addEventListener("pointercancel", up);
    const act = a => {
      measure();
      if (a === "in") zoomAt(z * 1.5, null, null, true);
      else if (a === "out") zoomAt(z / 1.5, null, null, true);
      else if (a === "fit") zoomAt(1, null, null, true);
      else if (a === "one") zoomAt(1 / fitZ, null, null, true);
      else if (a === "rot") { rot += 90; apply(true); }
      else if (a === "info") { const on = localStorage.getItem("qt-pk-info") !== "1"; try { localStorage.setItem("qt-pk-info", on ? "1" : "0"); } catch (_) {} tools.querySelector('[data-tb="info"]')?.classList.toggle("on", on); facts(on); }
      else if (a === "show") { st.show ? stopShow() : startShow(); }
    };
    tools.onclick = e => { const b = e.target.closest("[data-tb]"); if (b) act(b.dataset.tb); };
    st.keys = e => {
      if (st.show && e.key === " ") { st.showPaused = !st.showPaused; ov.classList.toggle("pk-paused", st.showPaused); tickShow(); return true; }
      const m = { "+": "in", "=": "in", "-": "out", "0": "fit", "1": "one", r: "rot", R: "rot", i: "info", I: "info", s: "show", S: "show" }[e.key];
      if (m && (m !== "info" || info.path) && (m !== "show" || tools.querySelector('[data-tb="show"]'))) { act(m); return true; }
    };
    /* photo facts panel (spark.py /api/spark/exif) */
    async function facts(on) {
      let p = v.querySelector(".pk-facts");
      if (!on) { if (p) { const a2 = anim(p, [{ transform: "none", opacity: 1 }, { transform: "translateX(30px)", opacity: 0 }], { duration: 180, fill: "forwards" }); a2 ? a2.finished.then(() => p.remove(), () => p.remove()) : p.remove(); } return; }
      if (!info.path) return;
      if (!p) { p = document.createElement("aside"); p.className = "pk-facts"; v.append(p); anim(p, [{ transform: "translateX(40px) rotate(2deg)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 340, easing: "cubic-bezier(.34,1.6,.5,1)" }); }
      p.innerHTML = `<div class="qt-eyebrow">Photo facts</div><p class="qt-muted">Reading...</p>`;
      let x = {};
      try { x = await getJ("/api/spark/exif?path=" + enc(info.path)); } catch (_) {}
      if (!p.isConnected) return;
      const cam = [x.make, x.model && x.make && x.model.startsWith(x.make) ? x.model.slice(x.make.length).trim() : x.model].filter(Boolean).join(" ");
      const rows = [["Size", x.w ? `${x.w} × ${x.h} · ${((x.w * x.h) / 1e6).toFixed(1)} MP` : ""], ["File", [human(info.size), x.format].filter(Boolean).join(" · ")],
        ["Taken", x.taken ? x.taken.replace(/^(\d{4}):(\d\d):(\d\d)/, "$1-$2-$3") : ""], ["Camera", cam], ["Lens", x.lens], ["Exposure", [x.exposure, x.f, x.iso ? "ISO " + x.iso : ""].filter(Boolean).join("  ")],
        ["Focal", x.focal], ["Flash", x.flash], ["Made with", x.software]].filter(r => r[1]);
      p.innerHTML = `<div class="qt-eyebrow">Photo facts</div>${rows.map((r, k) => `<div class="pk-fact" style="--i:${k}"><small>${r[0]}</small><b>${H(r[1])}</b></div>`).join("")}${!cam ? '<p class="qt-muted pk-fact-none">No camera details in this one.</p>' : ""}`;
    }
    if (localStorage.getItem("qt-pk-info") === "1" && info.path) facts(true);
    if (st.show) { ov.classList.add("pk-show"); st.sub = stopShow; tickShow(); }
    return () => { st && (st.keys = null); clearTimeout(st && st.showT); };
  };

  /* ---------- slideshow: pictures only, 5 s each, Space pauses, Esc stops ---------- */
  const isPic = x => ["image", "picture"].includes(x.k || kindOf(x.name));
  function startShow() {
    if (!st || !ov) return;
    if (st.list.filter(isPic).length < 2) return toastP("Only one picture in this folder");
    st.show = true; st.showPaused = false;
    ov.classList.add("pk-show"); ov.classList.remove("pk-paused");
    st.sub = stopShow;
    ov.querySelector('[data-tb="show"]')?.classList.add("on");
    try { ov.requestFullscreen && !document.fullscreenElement && ov.requestFullscreen().catch(() => {}); } catch (_) {}
    tickShow();
  }
  function stopShow() {
    if (!st) return;
    st.show = false; clearTimeout(st.showT);
    st.sub = null;
    if (ov) { ov.classList.remove("pk-show", "pk-paused"); ov.querySelector('[data-tb="show"]')?.classList.remove("on"); ov.querySelector(".pk-showbar")?.remove(); }
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }
  function tickShow() {
    clearTimeout(st.showT);
    let bar = ov.querySelector(".pk-showbar");
    if (!bar) { bar = document.createElement("div"); bar.className = "pk-showbar"; bar.innerHTML = "<i></i>"; ov.querySelector(".pk-card").append(bar); }
    const i = bar.querySelector("i");
    i.style.animation = "none"; void i.offsetWidth;
    if (st.showPaused) return;
    i.style.animation = "";
    st.showT = setTimeout(() => {
      if (!st || !st.show) return;
      for (let k = 1; k < st.list.length; k++) { const j = (st.i + k) % st.list.length; if (isPic(st.list[j])) { st.i = j; return load(1); } }
    }, 5000);
  }
  document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement && st && st.show && ov) stopShow(); });

  /* ---------- video ---------- */
  VIEW.video = (v, info, tools) => {
    v.innerHTML = `<video src="${H(srcOf(info))}" controls autoplay playsinline></video>`;
    const vid = v.querySelector("video");
    tools.innerHTML = tb("loop", "⟲ Loop", "Loop") + tb("snap", "📸 Frame", "Copy this frame as a picture") + seg("rate", [[".5", "½×"], ["1", "1×"], ["1.5", "1½×"], ["2", "2×"]], "1");
    vid.addEventListener("error", () => { v.innerHTML = noPreview(info, "Edge can't play this one"); tools.innerHTML = ""; });
    vid.addEventListener("loadedmetadata", () => { if (!info.dims && vid.videoWidth) { info.dims = [vid.videoWidth, vid.videoHeight]; paintHead(info); } });
    tools.onclick = async e => {
      const b = e.target.closest("[data-tb],[data-v]"); if (!b) return;
      if (b.dataset.v) { vid.playbackRate = +b.dataset.v; b.parentElement.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b)); return; }
      if (b.dataset.tb === "loop") { vid.loop = !vid.loop; b.classList.toggle("on", vid.loop); return; }
      if (b.dataset.tb === "snap") {
        try {
          const c = document.createElement("canvas"); c.width = vid.videoWidth; c.height = vid.videoHeight;
          c.getContext("2d").drawImage(vid, 0, 0);
          const blob = await new Promise(r => c.toBlob(r, "image/png"));
          await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
          flash(b, "Copied!"); anim(v, [{ filter: "brightness(2.2)" }, { filter: "none" }], { duration: 300 });
        } catch (er) { toastP("Couldn't copy the frame: " + er.message, true); }
      }
    };
    const mem = mediaMemory(vid, info, tools, v);
    st.keys = e => { if (e.key === " " && !/VIDEO/.test(e.target.tagName)) { vid.paused ? vid.play() : vid.pause(); return true; } return mem.keys(e); };
    vid.focus({ preventScroll: true });
    return () => { mem.stop(); vid.pause(); vid.removeAttribute("src"); vid.load(); st && (st.keys = null); };
  };

  /* ---------- Player: pick up where you stopped, play the next one in the folder, J / L / M keys ---------- */
  const PKEY = "qt-play-pos";
  const fmtT = s => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = String(s % 60).padStart(2, "0"); return h ? `${h}:${String(m).padStart(2, "0")}:${x}` : `${m}:${x}`; };
  function mediaMemory(el, info, tools, v) {
    const key = (info.path || "").toLowerCase();
    const all = () => { try { return JSON.parse(localStorage.getItem(PKEY) || "{}"); } catch (_) { return {}; } };
    const put = m => { const e = Object.entries(m).sort((a, b) => b[1].at - a[1].at).slice(0, 200); try { localStorage.setItem(PKEY, JSON.stringify(Object.fromEntries(e))); } catch (_) {} };
    let lastSave = 0, cd = null;
    const isMedia = x => ["video", "audio"].includes(x.k || kindOf(x.name));
    const nextIdx = () => { if (!st) return -1; for (let j = st.i + 1; j < st.list.length; j++) if (isMedia(st.list[j])) return j; return -1; };
    const auto = () => localStorage.getItem("qt-play-next") !== "0";
    tools.insertAdjacentHTML("beforeend", tb("next", "⏭ Auto-next", "Play the next one in this folder when this ends", auto() ? "on" : ""));
    el.addEventListener("loadedmetadata", () => {
      const s = key && all()[key];
      if (!s || s.t < 15 || !el.duration || s.t > el.duration - 10) return;
      el.currentTime = s.t;
      const chip = document.createElement("div");
      chip.className = "pk-resume";
      chip.innerHTML = `<span>Picked up at <b>${fmtT(s.t)}</b></span><button class="qt-btn pk-tb" data-tb="restart">⟲ Start over</button>`;
      v.append(chip);
      anim(chip, [{ transform: "translate(-50%, 20px) scale(.8)", opacity: 0 }, { transform: "translate(-50%, 0)", opacity: 1 }], { duration: 380, easing: "cubic-bezier(.34,1.8,.5,1)" });
      chip.querySelector("button").onclick = () => { el.currentTime = 0; el.play(); chip.remove(); };
      setTimeout(() => chip.isConnected && chip.classList.add("out"), 6000);
      setTimeout(() => chip.remove(), 6500);
    });
    el.addEventListener("timeupdate", () => {
      if (!key || Date.now() - lastSave < 2000 || !el.duration || el.duration < 60) return;
      lastSave = Date.now();
      const m = all();
      if (el.currentTime > 15 && el.currentTime < el.duration - 10) m[key] = { t: Math.round(el.currentTime), d: Math.round(el.duration), at: Date.now() };
      else delete m[key];
      put(m);
    });
    el.addEventListener("ended", () => {
      const m = all(); if (m[key]) { delete m[key]; put(m); }
      if (el.loop || !auto() || !st) return;
      const j = nextIdx(); if (j < 0) return;
      cd = document.createElement("div");
      cd.className = "pk-upnext";
      cd.innerHTML = `<small>Up next</small><b>${H(st.list[j].name)}</b><i></i><button class="qt-btn pk-tb" data-tb="cancelnext">Stay here</button>`;
      v.append(cd);
      anim(cd, [{ transform: "translate(-50%, 30px) rotate(-3deg)", opacity: 0 }, { transform: "translate(-50%, 0)", opacity: 1 }], { duration: 420, easing: "cubic-bezier(.34,1.8,.5,1)" });
      cd.querySelector("button").onclick = () => { clearTimeout(cd._t); cd.remove(); cd = null; };
      cd._t = setTimeout(() => { if (st && cd) { st.i = j; load(1); } }, 3200);
    });
    tools.addEventListener("click", e => {
      const b = e.target.closest('[data-tb="next"]'); if (!b) return;
      const on = !auto(); try { localStorage.setItem("qt-play-next", on ? "1" : "0"); } catch (_) {}
      b.classList.toggle("on", on);
    });
    return {
      stop: () => { if (cd) clearTimeout(cd._t); },
      keys: e => {
        const k = e.key.toLowerCase();
        if (k === "j" || k === "l") { el.currentTime = Math.max(0, Math.min(el.duration || 0, el.currentTime + (k === "l" ? 10 : -10))); bump(k === "l" ? "+10 s" : "−10 s"); return true; }
        if (k === "m") { el.muted = !el.muted; bump(el.muted ? "muted" : "sound on"); return true; }
      },
    };
    function bump(text) {
      let b = v.querySelector(".pk-bump");
      if (!b) { b = document.createElement("div"); b.className = "pk-bump"; v.append(b); }
      b.textContent = text;
      anim(b, [{ transform: "translate(-50%, -50%) scale(.6)", opacity: 0 }, { transform: "translate(-50%, -50%) scale(1.1)", opacity: 1, offset: .3 }, { transform: "translate(-50%, -50%) scale(1)", opacity: 1, offset: .7 }, { transform: "translate(-50%, -50%) scale(.9)", opacity: 0 }], { duration: 700, easing: "ease-out", fill: "forwards" });
    }
  }
  VIEW["media-x"] = (v, info) => { v.innerHTML = noPreview(info, `Edge can't play .${info.ext} videos`); };

  /* ---------- audio: ink disc + live bars ---------- */
  VIEW.audio = (v, info, tools) => {
    v.innerHTML = `<div class="pk-disc"><div class="pk-vinyl"><span>${H((info.ext || "").toUpperCase())}</span></div></div>
      <canvas class="pk-bars" width="900" height="160"></canvas>
      <div class="pk-aname qt-display">${H(info.name.replace(/\.[^.]+$/, ""))}</div>
      <audio src="${H(srcOf(info))}" controls autoplay></audio>`;
    const au = v.querySelector("audio"), disc = v.querySelector(".pk-disc"), cv = v.querySelector("canvas"), g = cv.getContext("2d");
    let ctx, an, data, raf = 0;
    const sync = () => disc.classList.toggle("on", !au.paused);
    au.addEventListener("play", () => {
      sync();
      if (!ctx) {
        try {
          ctx = new AudioContext(); an = ctx.createAnalyser(); an.fftSize = 128; an.smoothingTimeConstant = .78;
          ctx.createMediaElementSource(au).connect(an); an.connect(ctx.destination); data = new Uint8Array(an.frequencyBinCount);
        } catch (_) { ctx = null; }
      }
      ctx && ctx.resume && ctx.resume();
      cancelAnimationFrame(raf); draw();
    });
    au.addEventListener("pause", sync);
    au.addEventListener("error", () => { v.innerHTML = noPreview(info, "Edge can't play this one"); });
    const col = getComputedStyle(ov).getPropertyValue("--pk").trim() || "#b28bff";
    function draw() {
      raf = requestAnimationFrame(draw);
      const w = cv.width, h = cv.height; g.clearRect(0, 0, w, h);
      const n = 40, bw = w / n;
      if (an && data) an.getByteFrequencyData(data);
      for (let i = 0; i < n; i++) {
        const val = an && data ? data[Math.floor(Math.pow(i / n, 1.7) * data.length * .85)] / 255 : (au.paused ? .05 : .3 + .25 * Math.sin(Date.now() / 200 + i));
        const bh = Math.max(6, val * (h - 14));
        g.fillStyle = "#000"; g.beginPath(); g.roundRect(i * bw + 4 + 4, h - bh + 4 - 4, bw - 8, bh, 5); g.fill();
        g.fillStyle = col; g.strokeStyle = "#000"; g.lineWidth = 2.5; g.beginPath(); g.roundRect(i * bw + 4, h - bh - 4, bw - 8, bh, 5); g.fill(); g.stroke();
      }
      if (au.paused && !RM.matches) { cancelAnimationFrame(raf); }
    }
    draw();
    const mem = mediaMemory(au, info, tools, v);
    st.keys = e => { if (e.key === " ") { au.paused ? au.play() : au.pause(); return true; } return mem.keys(e); };
    return () => { mem.stop(); cancelAnimationFrame(raf); au.pause(); au.removeAttribute("src"); au.load(); ctx && ctx.close(); st && (st.keys = null); };
  };

  /* ---------- PDF: Edge's own reader ---------- */
  VIEW.pdf = (v, info) => { v.innerHTML = `<iframe title="PDF" src="${H(srcOf(info))}#view=FitH"></iframe>`; };

  /* ---------- text / code ---------- */
  VIEW.code = (v, info, tools) => codeView(v, info, tools, info.text, info.ext);
  function codeView(v, info, tools, text, ext, extraTools = "") {
    const lines = text.split(/\r\n|\r|\n/);
    const big = text.length > 400 * 1024;
    tools.innerHTML = extraTools + tb("wrap", "↵ Wrap", "Wrap long lines (W)") + tb("small", "A−", "Smaller text") + tb("big", "A+", "Bigger text") + tb("copy", "Copy all", "Copy the whole text");
    v.innerHTML = `${info.cut ? '<div class="pk-cut">Showing the first 2 MB. Open it in its app for the rest.</div>' : ""}
      <div class="pk-codebox"><pre class="pk-gut" aria-hidden="true">${lines.map((_, i) => i + 1).join("\n")}</pre><pre class="pk-src"><code>${big ? H(text) : highlight(text, ext)}</code></pre></div>
      <div class="pk-stat qt-mono">${lines.length.toLocaleString()} lines · ${(text.match(/\S+/g) || []).length.toLocaleString()} words${big ? " · colours off for big files" : ""}</div>`;
    const box = v.querySelector(".pk-codebox");
    let fs = +(localStorage.getItem("qt-peek-fs") || 13.5);
    const setFs = () => { box.style.setProperty("--fs", fs + "px"); try { localStorage.setItem("qt-peek-fs", fs); } catch (_) {} };
    setFs();
    if (localStorage.getItem("qt-peek-wrap") === "1") { box.classList.add("wrap"); tools.querySelector('[data-tb="wrap"]').classList.add("on"); }
    if (tools._codeH) tools.removeEventListener("click", tools._codeH);   // switching modes calls this again
    tools.addEventListener("click", tools._codeH = async e => {
      const b = e.target.closest("[data-tb]"); if (!b) return;
      const a = b.dataset.tb;
      if (a === "wrap") { const on = box.classList.toggle("wrap"); b.classList.toggle("on", on); try { localStorage.setItem("qt-peek-wrap", on ? "1" : "0"); } catch (_) {} }
      if (a === "small") { fs = Math.max(10, fs - 1); setFs(); }
      if (a === "big") { fs = Math.min(24, fs + 1); setFs(); }
      if (a === "copy") { try { await navigator.clipboard.writeText(text); flash(b, "Copied!"); } catch (er) { toastP("Couldn't copy: " + er.message, true); } }
    });
    st.keys = e => { if (e.key === "w" || e.key === "W") { tools.querySelector('[data-tb="wrap"]').click(); return true; } if (e.key === "/") { finder(v, box, "find"); return true; } };
    st.ctrlKeys = e => { const k = e.key.toLowerCase(); if (k === "f" || k === "g") { finder(v, box, k === "g" ? "line" : "find"); return true; } };
    return () => { st && (st.keys = null, st.ctrlKeys = null); CSS.highlights && (CSS.highlights.delete("pk-find"), CSS.highlights.delete("pk-find-on")); };
  }

  /* ---------- Code: Ctrl+F find (every match lit, Enter steps), Ctrl+G go to a line ---------- */
  function finder(v, box, mode) {
    const host = v.parentElement || v;   // the stage: the bar floats over the code instead of pushing it down
    let bar = host.querySelector(".pk-find");
    const code = box.querySelector(".pk-src code"), gut = box.querySelector(".pk-gut");
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "pk-find";
      bar.innerHTML = `<span class="pk-find-ic">⌕</span><input class="qt-input" spellcheck="false" aria-label="Find"><span class="pk-find-n qt-mono"></span>
        <button class="qt-btn pk-tb" data-f="prev" title="Previous (Shift+Enter)">↑</button><button class="qt-btn pk-tb" data-f="next" title="Next (Enter)">↓</button>
        <button class="qt-btn pk-tb" data-f="case" title="Match case">Aa</button><button class="qt-btn pk-tb" data-f="x" title="Close (Esc)">✕</button>`;
      host.append(bar);
      anim(bar, [{ transform: "translateY(-30px) scale(.9)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 260, easing: "cubic-bezier(.34,1.6,.5,1)" });
      const inp = bar.querySelector("input");
      let ranges = [], at = -1, cs = false;
      const hl = typeof Highlight !== "undefined" && CSS.highlights;
      const scrollTo = r => {
        const rr = r.getBoundingClientRect(), vr = v.getBoundingClientRect();
        v.scrollTo({ top: v.scrollTop + rr.top - vr.top - v.clientHeight / 2.5, left: Math.max(0, v.scrollLeft + rr.left - vr.left - v.clientWidth / 2), behavior: RM.matches ? "auto" : "smooth" });
      };
      const paint = () => {
        bar.querySelector(".pk-find-n").textContent = bar.dataset.mode === "line" ? `of ${gut ? gut.textContent.split("\n").length.toLocaleString() : "?"}` : !inp.value ? "" : ranges.length ? `${at + 1} / ${ranges.length}${ranges.length >= 3000 ? "+" : ""}` : "none";
        bar.classList.toggle("miss", !!inp.value && bar.dataset.mode !== "line" && !ranges.length);
        if (!hl) return;
        CSS.highlights.set("pk-find", new Highlight(...ranges));
        ranges[at] ? CSS.highlights.set("pk-find-on", new Highlight(ranges[at])) : CSS.highlights.delete("pk-find-on");
      };
      const search = () => {
        ranges = []; at = -1;
        const q = inp.value;
        if (q && code) {
          const nodes = [], tw = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
          let all = "", n;
          while ((n = tw.nextNode())) { nodes.push([n, all.length]); all += n.data; }
          const hay = cs ? all : all.toLowerCase(), needle = cs ? q : q.toLowerCase();
          let k = 0, ni = 0;
          const locate = pos => { while (ni < nodes.length - 1 && nodes[ni + 1][1] <= pos) ni++; return [nodes[ni][0], pos - nodes[ni][1]]; };
          while ((k = hay.indexOf(needle, k)) >= 0 && ranges.length < 3000) {
            const r = document.createRange(), s = locate(k), save = ni, e2 = locate(k + needle.length - 1);
            r.setStart(s[0], s[1]); r.setEnd(e2[0], e2[1] + 1); ranges.push(r); ni = save; k += Math.max(1, needle.length);
          }
          const top = v.scrollTop;
          at = ranges.findIndex(r => r.getBoundingClientRect().top >= v.getBoundingClientRect().top + 30 - (top - v.scrollTop));
          if (at < 0 && ranges.length) at = 0;
        }
        paint();
        if (ranges[at]) scrollTo(ranges[at]);
      };
      const stepF = d => { if (!ranges.length) return; at = (at + d + ranges.length) % ranges.length; paint(); scrollTo(ranges[at]); };
      const goLine = () => {
        const n = parseInt(inp.value, 10), total = gut ? gut.textContent.split("\n").length : 0;
        if (!n || !gut) return;
        const ln = Math.max(1, Math.min(total, n)), lh = gut.scrollHeight ? (gut.scrollHeight - 28) / total : 20;
        const top = gut.offsetTop + 14 + (ln - 1) * lh;
        v.scrollTo({ top: top - v.clientHeight / 3, behavior: RM.matches ? "auto" : "smooth" });
        let mark = box.querySelector(".pk-line-mark");
        if (!mark) { mark = document.createElement("div"); mark.className = "pk-line-mark"; box.style.position = "relative"; box.append(mark); }
        mark.style.top = (top - box.offsetTop) + "px"; mark.style.height = lh + "px";
        anim(mark, [{ opacity: 0, transform: "scaleX(.2)" }, { opacity: 1, transform: "none", offset: .3 }, { opacity: 1, offset: .75 }, { opacity: 0 }], { duration: 1600, easing: "ease-out", fill: "forwards" });
        close();
      };
      const close = () => {
        hl && (CSS.highlights.delete("pk-find"), CSS.highlights.delete("pk-find-on"));
        if (st) st.sub = bar._prevSub || null;
        const a = anim(bar, [{ transform: "none", opacity: 1 }, { transform: "translateY(-30px) scale(.9)", opacity: 0 }], { duration: 160, easing: "ease-in", fill: "forwards" });
        a ? a.finished.then(() => bar.remove(), () => bar.remove()) : bar.remove();
        v.focus && v.focus({ preventScroll: true });
      };
      bar._open = m => {
        bar.dataset.mode = m;
        inp.placeholder = m === "line" ? "Go to line" : "Find in this file";
        inp.inputMode = m === "line" ? "numeric" : "text";
        bar.querySelector(".pk-find-ic").textContent = m === "line" ? "#" : "⌕";
        bar.querySelectorAll("[data-f=prev],[data-f=next],[data-f=case]").forEach(b => { b.hidden = m === "line"; });
        if (m === "line") { hl && CSS.highlights.delete("pk-find"); hl && CSS.highlights.delete("pk-find-on"); inp.value = ""; paint(); }
        else search();
        inp.focus(); inp.select();
      };
      inp.addEventListener("input", () => { if (bar.dataset.mode === "find") { clearTimeout(inp._t); inp._t = setTimeout(search, 90); } else paint(); });
      inp.addEventListener("keydown", e => {
        if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); bar.dataset.mode === "line" ? goLine() : stepF(e.shiftKey ? -1 : 1); }
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
        if ((e.ctrlKey || e.metaKey) && /^[fg]$/i.test(e.key)) { e.preventDefault(); e.stopPropagation(); bar._open(e.key.toLowerCase() === "g" ? "line" : "find"); }
      });
      bar.addEventListener("click", e => {
        const b = e.target.closest("[data-f]"); if (!b) return;
        if (b.dataset.f === "x") return close();
        if (b.dataset.f === "case") { cs = !cs; b.classList.toggle("on", cs); return search(); }
        stepF(b.dataset.f === "next" ? 1 : -1);
      });
      bar._prevSub = st ? st.sub : null;
      if (st) st.sub = close;
    }
    bar._open(mode);
  }

  const KW = new Set(("if else elif for while do return function def class import from export default const let var new try catch except finally raise throw with as in of is not and or " +
    "None null nil undefined true false True False this self super async await yield lambda pass break continue switch case public private protected static void int float double bool " +
    "boolean string char long struct enum interface type extends implements package namespace using fn mut impl pub match where func go chan defer select insert update delete create " +
    "table into values set begin end then local function_ echo param foreach readonly typeof instanceof val fun override when object companion").split(" "));
  const HASH = new Set("py pyw sh bash zsh yml yaml toml ini cfg conf ps1 psm1 rb r pl gd gdshader properties env gitignore gitattributes editorconfig makefile dockerfile nfo lock".split(" "));
  const DASH = new Set("lua sql".split(" "));
  function highlight(text, ext) {
    ext = (ext || "").toLowerCase();
    if (["html", "htm", "xml", "svg", "xhtml", "vue", "svelte", "csproj", "vcxproj"].includes(ext)) return hlMarkup(text);
    const line = HASH.has(ext) ? "#[^\\n]*" : DASH.has(ext) ? "--[^\\n]*" : ext === "ini" || ext === "reg" ? ";[^\\n]*" : "\\/\\/[^\\n]*";
    const block = HASH.has(ext) ? (ext.startsWith("py") ? '"""[\\s\\S]*?"""|\'\'\'[\\s\\S]*?\'\'\'' : "<#[\\s\\S]*?#>") : DASH.has(ext) ? "--\\[\\[[\\s\\S]*?\\]\\]|\\/\\*[\\s\\S]*?\\*\\/" : "\\/\\*[\\s\\S]*?\\*\\/";
    const re = new RegExp(`(${block})|(${line})|("(?:\\\\.|[^"\\\\\\n])*"|'(?:\\\\.|[^'\\\\\\n])*'|\`(?:\\\\.|[^\`\\\\])*\`)|(\\b0x[\\da-fA-F]+\\b|\\b\\d[\\d_]*(?:\\.\\d+)?(?:e[+-]?\\d+)?\\b)|([A-Za-z_$][\\w$]*)(?=\\s*\\()|([A-Za-z_$@][\\w$]*)`, "g");
    let out = "", last = 0, m;
    while ((m = re.exec(text))) {
      out += H(text.slice(last, m.index));
      const [t, bc, lc, s, n, fn, w] = m;
      out += bc || lc ? `<i class="c">${H(t)}</i>` : s ? `<i class="s">${H(t)}</i>` : n ? `<i class="n">${H(t)}</i>`
        : fn ? (KW.has(fn) ? `<i class="k">${H(t)}</i>` : `<i class="f">${H(t)}</i>`) : w && KW.has(w) ? `<i class="k">${H(t)}</i>` : w && /^[A-Z][a-z]/.test(w) ? `<i class="t">${H(t)}</i>` : H(t);
      last = re.lastIndex;
    }
    return out + H(text.slice(last));
  }
  function hlMarkup(text) {
    const re = /(<!--[\s\S]*?-->)|(<\/?[\w:.-]+|\/?>|<!DOCTYPE[^>]*>|<\?[\s\S]*?\?>)|([\w:@.-]+)(?==)|("[^"]*"|'[^']*')/gi;
    let out = "", last = 0, m;
    while ((m = re.exec(text))) {
      out += H(text.slice(last, m.index));
      out += m[1] ? `<i class="c">${H(m[0])}</i>` : m[2] ? `<i class="k">${H(m[0])}</i>` : m[3] ? `<i class="f">${H(m[0])}</i>` : `<i class="s">${H(m[0])}</i>`;
      last = re.lastIndex;
    }
    return out + H(text.slice(last));
  }

  /* ---------- web pages: drawn with scripts off, or the source ---------- */
  VIEW.html = (v, info, tools) => {
    const page = () => { st.cleanup && st.cleanup(); tools.innerHTML = seg("mode", [["page", "Page"], ["src", "Source"]], "page"); v.innerHTML = `<iframe sandbox="" title="Page preview" src="${H(srcOf(info))}"></iframe><div class="pk-cut">Scripts are off in this preview.</div>`; };
    const src = () => { st.cleanup = codeView(v, info, tools, info.text || "", info.ext, seg("mode", [["page", "Page"], ["src", "Source"]], "src")); };
    tools.addEventListener("click", e => { const b = e.target.closest("[data-seg=mode] [data-v]"); if (!b || b.getAttribute("aria-pressed") === "true") return; b.dataset.v === "page" ? page() : src(); });
    // a page that is mostly script (an app like Pixlab) shows nothing with scripts off: start on the source
    const t = info.text || "", words = t.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/gi, " ").replace(/\s+/g, " ").trim().length;
    /<script/i.test(t) && words < 300 ? src() : page();
  };

  /* ---------- markdown ---------- */
  VIEW.markdown = (v, info, tools) => {
    const rendered = () => {
      st.keys = null;
      if (tools._codeH) { tools.removeEventListener("click", tools._codeH); tools._codeH = null; }
      tools.innerHTML = seg("mode", [["read", "Read"], ["src", "Source"]], "read") + tb("copy", "Copy", "Copy the markdown");
      v.innerHTML = `<div class="pk-readbar" aria-hidden="true"><i></i></div><article class="pk-md">${md(info.text || "", info.folder || "")}</article>`;
      v.querySelectorAll(".pk-md pre code[data-lang]").forEach(c => { c.innerHTML = highlight(c.textContent, c.dataset.lang); });
      outline();
    };
    /* outline of the headings (3 or more) + a reading-progress bar; the current section lights up */
    const outline = () => {
      const hs = [...v.querySelectorAll(".pk-md h1, .pk-md h2, .pk-md h3")];
      const bar = v.querySelector(".pk-readbar i");
      let toc = null;
      if (hs.length >= 3) {
        v.classList.add("pk-hastoc");
        toc = document.createElement("nav");
        toc.className = "pk-toc"; toc.setAttribute("aria-label", "Outline");
        toc.innerHTML = `<div class="qt-eyebrow">Outline</div>` + hs.map((h, k) => `<button class="l${h.tagName[1]}" data-k="${k}" style="--i:${Math.min(k, 14)}">${H(h.textContent)}</button>`).join("");
        v.prepend(toc);
        toc.onclick = e => {
          const b = e.target.closest("[data-k]"); if (!b) return;
          const h = hs[+b.dataset.k];
          v.scrollTo({ top: v.scrollTop + h.getBoundingClientRect().top - v.getBoundingClientRect().top - 14, behavior: RM.matches ? "auto" : "smooth" });
          anim(h, [{ transform: "translateX(-10px)", color: "var(--pk)" }, { transform: "none" }], { duration: 600, delay: 250, easing: "cubic-bezier(.34,1.6,.5,1)" });
        };
      }
      let raf = 0;
      const onScroll = () => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          const max = v.scrollHeight - v.clientHeight;
          if (bar) bar.style.transform = `scaleX(${max > 4 ? Math.min(1, v.scrollTop / max) : 1})`;
          if (!toc) return;
          const top = v.getBoundingClientRect().top + 90;
          let on = 0; hs.forEach((h, k) => { if (h.getBoundingClientRect().top < top) on = k; });
          const cur = toc.querySelector(".on");
          if (cur && +cur.dataset.k === on) return;
          cur && cur.classList.remove("on");
          const nb = toc.querySelector(`[data-k="${on}"]`); nb.classList.add("on");
          // keep it in sight by scrolling the outline only (scrollIntoView would also move the page)
          if (nb.offsetTop < toc.scrollTop + 30 || nb.offsetTop > toc.scrollTop + toc.clientHeight - 40) toc.scrollTop = nb.offsetTop - toc.clientHeight / 2;
        });
      };
      v.onscroll = onScroll; onScroll();
    };
    const source = () => { v.classList.remove("pk-hastoc"); v.onscroll = null; codeView(v, info, tools, info.text || "", "md", seg("mode", [["read", "Read"], ["src", "Source"]], "src")); };
    tools.addEventListener("click", async e => {
      const b = e.target.closest("[data-seg=mode] [data-v]");
      if (b && b.getAttribute("aria-pressed") !== "true") return b.dataset.v === "read" ? rendered() : source();
      const c = e.target.closest('[data-tb="copy"]');
      if (c) { await navigator.clipboard.writeText(info.text || ""); flash(c, "Copied!"); }
    });
    v.addEventListener("click", e => {
      const a = e.target.closest("a[data-href]"); if (!a) return;
      e.preventDefault();
      const u = a.dataset.href;
      if (/^(https?:|mailto:)/i.test(u)) return window.open(u, "_blank", "noopener");
      if (u.startsWith("#")) { const t = v.querySelector(`[id="${CSS.escape(u.slice(1))}"]`); t && t.scrollIntoView({ behavior: "smooth" }); return; }
      if (info.folder) window.qtPeek(joinPath(info.folder, u.split("#")[0]));
    });
    rendered();
  };
  function joinPath(dir, rel) {
    try { rel = decodeURIComponent(rel); } catch (_) {}
    if (/^[a-z]:[\\/]/i.test(rel)) return rel.replace(/\//g, "\\");
    const parts = dir.replace(/[\\/]+$/, "").split(/[\\/]/);
    rel.split(/[\\/]/).forEach(p => { if (p === "..") parts.length > 1 && parts.pop(); else if (p && p !== ".") parts.push(p); });
    return parts.join("\\");
  }
  function md(src, folder) {
    const L = src.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
    const out = [];
    let i = 0;
    const slug = s => s.toLowerCase().replace(/<[^>]+>/g, "").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-");
    const isTableSep = s => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(s) && s.includes("-");
    const cells = s => s.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map(c => c.trim());
    const listRe = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
    while (i < L.length) {
      const l = L[i];
      let m;
      if (!l.trim()) { i++; continue; }
      if ((m = /^\s*(```+|~~~+)\s*([\w+#-]*)/.exec(l))) {
        const fence = m[1], lang = m[2].toLowerCase(), body = [];
        i++;
        while (i < L.length && !L[i].trim().startsWith(fence)) body.push(L[i++]);
        i++;
        out.push(`<pre><code${lang ? ` data-lang="${H({ js: "js", javascript: "js", python: "py", py: "py", sh: "sh", bash: "sh", shell: "sh", powershell: "ps1", ps1: "ps1", json: "json", html: "html", css: "css", ts: "ts", typescript: "ts", yaml: "yml", yml: "yml", toml: "toml", c: "c", cpp: "cpp", java: "java", kotlin: "kt", go: "go", rust: "rs", sql: "sql", lua: "lua", xml: "xml" }[lang] || lang)}"` : ""}>${H(body.join("\n"))}</code></pre>`);
        continue;
      }
      if ((m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l))) { const h = inl(m[2], folder); out.push(`<h${m[1].length} id="${H(slug(h))}">${h}</h${m[1].length}>`); i++; continue; }
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { out.push("<hr>"); i++; continue; }
      if (/^\s*>/.test(l)) {
        const q = [];
        while (i < L.length && L[i].trim() && /^\s*>?/.test(L[i]) && !(q.length && !/^\s*>/.test(L[i]) && listRe.test(L[i]))) { q.push(L[i].replace(/^\s*> ?/, "")); i++; }
        out.push(`<blockquote>${md(q.join("\n"), folder)}</blockquote>`);
        continue;
      }
      if (l.includes("|") && i + 1 < L.length && isTableSep(L[i + 1])) {
        const head = cells(l), al = cells(L[i + 1]).map(c => c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : "");
        i += 2;
        const rows = [];
        while (i < L.length && L[i].includes("|") && L[i].trim()) rows.push(cells(L[i++]));
        const td = (t, c, k) => `<${t}${al[k] ? ` style="text-align:${al[k]}"` : ""}>${inl(c || "", folder)}</${t}>`;
        out.push(`<div class="pk-tablewrap"><table><thead><tr>${head.map((c, k) => td("th", c, k)).join("")}</tr></thead><tbody>${rows.map(r => `<tr>${head.map((_, k) => td("td", r[k], k)).join("")}</tr>`).join("")}</tbody></table></div>`);
        continue;
      }
      if ((m = listRe.exec(l))) {
        const ind = m[1].length, ordered = /\d/.test(m[2]), items = [];
        let cur = null;
        while (i < L.length) {
          const s = L[i], mm = listRe.exec(s);
          if (mm && mm[1].length <= ind + 1 && mm[1].length >= ind - 1 && /\d/.test(mm[2]) === ordered) { cur = [mm[3]]; items.push(cur); i++; continue; }
          if (!s.trim()) { if (i + 1 < L.length && (/^\s+/.test(L[i + 1]) && L[i + 1].trim())) { cur && cur.push(""); i++; continue; } break; }
          if (cur && (s.search(/\S/) > ind || !listRe.test(s)) && !/^(#{1,6})\s/.test(s) && !/^\s*```/.test(s)) { cur.push(s.slice(Math.min(s.search(/\S/), ind + 2))); i++; continue; }
          break;
        }
        const start = ordered ? parseInt(m[2], 10) : 1;
        out.push(`<${ordered ? "ol" : "ul"}${ordered && start !== 1 ? ` start="${start}"` : ""}>${items.map(it => {
          let first = it[0], box = "";
          const t = /^\[( |x|X)\]\s+(.*)$/.exec(first);
          if (t) { box = `<span class="pk-check${t[1] !== " " ? " done" : ""}">${t[1] !== " " ? "✓" : ""}</span>`; first = t[2]; }
          const rest = it.slice(1).join("\n");
          return `<li${box ? ' class="task"' : ""}>${box}${inl(first, folder)}${rest.trim() ? md(rest, folder) : ""}</li>`;
        }).join("")}</${ordered ? "ol" : "ul"}>`);
        continue;
      }
      const para = [];
      while (i < L.length && L[i].trim() && !/^\s*(```|~~~|#{1,6}\s|>)/.test(L[i]) && !listRe.test(L[i]) && !(L[i].includes("|") && i + 1 < L.length && isTableSep(L[i + 1]))) {
        if (para.length && /^\s*(=+|-+)\s*$/.test(L[i])) { const lv = L[i].trim()[0] === "=" ? 1 : 2; const h = inl(para.join(" "), folder); para.length = 0; out.push(`<h${lv} id="${H(slug(h))}">${h}</h${lv}>`); i++; break; }
        para.push(L[i].replace(/\s{2,}$/, "\u0001"));
        i++;
      }
      if (para.length) out.push(`<p>${inl(para.join(" "), folder).replace(/\u0001/g, "<br>")}</p>`);
    }
    return out.join("\n");
  }
  function inl(s, folder) {
    const keep = [];
    const put = h => "\u0000" + (keep.push(h) - 1) + "\u0000";
    const imgSrc = u => /^(https?:|data:image\/)/i.test(u) ? u : folder ? rawUrl(joinPath(folder, u.split(/[?#]/)[0])) : "";
    s = s.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_, __, c) => put(`<code>${H(c.trim())}</code>`))
      .replace(/!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g, (_, a, u) => put(`<img alt="${H(a)}" src="${H(imgSrc(u))}" loading="lazy">`))
      .replace(/\[([^\]]+)\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g, (_, t, u) => put(`<a href="#" data-href="${H(u)}" title="${H(u)}">${inl(t, folder)}</a>`))
      .replace(/<(https?:\/\/[^>\s]+)>/g, (_, u) => put(`<a href="#" data-href="${H(u)}">${H(u)}</a>`))
      .replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:!?'"])/g, (_, a, u) => a + put(`<a href="#" data-href="${H(u)}">${H(u)}</a>`));
    s = H(s)
      .replace(/\*\*\*([^*]+)\*\*\*/g, "<b><em>$1</em></b>")
      .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a, b) => `<b>${a || b}</b>`)
      .replace(/(^|[^\w*])\*([^*\s][^*]*?)\*(?!\w)/g, "$1<em>$2</em>")
      .replace(/(^|[^\w])_([^_\s][^_]*?)_(?!\w)/g, "$1<em>$2</em>")
      .replace(/~~([^~]+)~~/g, "<del>$1</del>")
      .replace(/==([^=]+)==/g, "<mark>$1</mark>");
    return s.replace(/\u0000(\d+)\u0000/g, (_, k) => keep[+k]);
  }

  /* ---------- tables (CSV / TSV): sort by a column, filter rows ---------- */
  VIEW.table = (v, info, tools) => {
    const text = info.text || "";
    const first = text.slice(0, text.indexOf("\n") + 1 || undefined);
    const sep = info.ext === "tsv" ? "\t" : [",", ";", "\t", "|"].map(c => [c, first.split(c).length]).sort((a, b) => b[1] - a[1])[0][0];
    const rows = parseCsv(text, sep, 20001);
    if (!rows.length) return codeView(v, info, tools, text, "txt");
    const head = rows.shift(), width = Math.max(head.length, ...rows.slice(0, 200).map(r => r.length));
    let sortK = -1, sortD = 1, q = "";
    const bar = () => { st.keys = null; tools.innerHTML = `<input class="qt-input pk-filter" placeholder="Filter rows" aria-label="Filter rows" value="${H(q)}">` + seg("mode", [["grid", "Table"], ["src", "Text"]], "grid"); };
    bar();
    const grid = () => {
      let rs = rows;
      if (q) { const ql = q.toLowerCase(); rs = rs.filter(r => r.some(c => c.toLowerCase().includes(ql))); }
      if (sortK >= 0) {
        const num = rs.slice(0, 50).every(r => !r[sortK] || !isNaN(parseFloat(r[sortK].replace(/[, ]/g, ""))));
        const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
        rs = [...rs].sort((a, b) => sortD * (num ? (parseFloat((a[sortK] || "").replace(/[, ]/g, "")) || 0) - (parseFloat((b[sortK] || "").replace(/[, ]/g, "")) || 0) : coll.compare(a[sortK] || "", b[sortK] || "")));
      }
      const shown = rs.slice(0, 3000);
      v.innerHTML = `<div class="pk-tablewrap pk-grid"><table><thead><tr><th class="rn">#</th>${Array.from({ length: width }, (_, k) => `<th data-k="${k}" class="${k === sortK ? "sorted" : ""}">${H(head[k] ?? "")}<i>${k === sortK ? (sortD > 0 ? "▲" : "▼") : ""}</i></th>`).join("")}</tr></thead>
        <tbody>${shown.map((r, n) => `<tr><td class="rn">${n + 1}</td>${Array.from({ length: width }, (_, k) => `<td>${H(r[k] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
        <div class="pk-stat qt-mono">${rs.length.toLocaleString()} rows${q ? " match" : ""} · ${width} columns${rs.length > shown.length ? " · showing the first 3,000" : ""}${rows.length >= 20000 ? " · file cut at 20,000 rows" : ""}</div>`;
    };
    v.addEventListener("click", e => { const th = e.target.closest("th[data-k]"); if (!th) return; const k = +th.dataset.k; sortD = sortK === k ? -sortD : 1; sortK = k; grid(); });
    tools.addEventListener("input", e => { if (e.target.classList.contains("pk-filter")) { q = e.target.value; clearTimeout(tools._t); tools._t = setTimeout(grid, 120); } });
    tools.addEventListener("click", e => {
      const b = e.target.closest("[data-seg=mode] [data-v]"); if (!b || b.getAttribute("aria-pressed") === "true") return;
      if (b.dataset.v === "src") codeView(v, info, tools, text, "txt", seg("mode", [["grid", "Table"], ["src", "Text"]], "src"));
      else { bar(); grid(); }
    });
    grid();
  };
  function parseCsv(t, sep, cap) {
    const rows = []; let row = [], f = "", q = false;
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"' && !f) q = true;
      else if (c === sep) { row.push(f); f = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && t[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; if (rows.length >= cap) return rows; }
      else f += c;
    }
    if (f || row.length) { row.push(f); rows.push(row); }
    return rows;
  }

  /* ---------- JSON: folding tree or text ---------- */
  VIEW.json = (v, info, tools) => {
    let data;
    try { data = JSON.parse(info.text || ""); } catch (_) { return codeView(v, info, tools, info.text || "", "json"); }
    const tree = () => {
      st.keys = null;
      tools.innerHTML = seg("mode", [["tree", "Tree"], ["src", "Text"]], "tree") + tb("all", "Open all", "Open every branch");
      v.innerHTML = `<div class="pk-jtree"></div>`;
      v.firstChild.append(jnode(null, data, 0));
    };
    const text = () => codeView(v, info, tools, JSON.stringify(data, null, 2), "json", seg("mode", [["tree", "Tree"], ["src", "Text"]], "src"));
    tools.addEventListener("click", e => {
      const b = e.target.closest("[data-seg=mode] [data-v]");
      if (b && b.getAttribute("aria-pressed") !== "true") return b.dataset.v === "tree" ? tree() : text();
      if (e.target.closest('[data-tb="all"]')) { let n = 0; const open = () => { v.querySelectorAll("details:not([open])").forEach(d => { if (n++ < 3000) d.open = true; }); }; open(); open(); open(); }
    });
    tree();
  };
  function jnode(k, val, depth) {
    const key = k == null ? "" : `<span class="jk">${H(k)}</span><span class="jp">: </span>`;
    if (val && typeof val === "object") {
      const arr = Array.isArray(val), ks = arr ? val.map((_, i) => i) : Object.keys(val);
      const d = document.createElement("details");
      d.innerHTML = `<summary>${key}<span class="jb">${arr ? "[" : "{"}</span><span class="jn">${ks.length} ${arr ? (ks.length === 1 ? "item" : "items") : (ks.length === 1 ? "key" : "keys")}</span><span class="jb">${arr ? "]" : "}"}</span></summary>`;
      const kids = document.createElement("div"); kids.className = "jkids"; d.append(kids);
      const fill = () => { if (kids.childElementCount) return; ks.slice(0, 1000).forEach(x => kids.append(jnode(x, val[x], depth + 1))); if (ks.length > 1000) kids.insertAdjacentHTML("beforeend", `<div class="jl jn">... ${ks.length - 1000} more</div>`); };
      d.addEventListener("toggle", () => { if (d.open) { fill(); anim(kids, [{ opacity: 0, transform: "translateY(-6px)" }, { opacity: 1, transform: "none" }], { duration: 220, easing: "ease-out" }); } });
      if (depth < 2 && ks.length < 200) { d.open = true; fill(); }
      return d;
    }
    const el = document.createElement("div"); el.className = "jl";
    const cls = typeof val === "string" ? "s" : typeof val === "number" ? "n" : "k";
    el.innerHTML = `${key}<i class="${cls}">${H(typeof val === "string" ? JSON.stringify(val) : String(val))}</i>`;
    return el;
  }

  /* ---------- fonts ---------- */
  VIEW.font = async (v, info, tools) => {
    const fam = "pk-font-" + Math.random().toString(36).slice(2);
    const face = new FontFace(fam, `url("${srcOf(info)}")`);
    try { await face.load(); document.fonts.add(face); } catch (e) { v.innerHTML = noPreview(info, "That font didn't load"); return; }
    tools.innerHTML = `<input type="range" min="16" max="120" value="56" class="pk-range" aria-label="Sample size">`;
    v.innerHTML = `<div class="pk-fontbox" style="font-family:'${fam}'">
      <div class="pk-aa">Aa</div>
      <div class="pk-sample" contenteditable="true" spellcheck="false" style="font-size:56px">The quick brown fox jumps over the lazy dog</div>
      <div class="pk-glyphs">ABCDEFGHIJKLMNOPQRSTUVWXYZ<br>abcdefghijklmnopqrstuvwxyz<br>0123456789 !?&amp;@#%(){}[]₹$€</div>
      ${[14, 20, 32].map(s => `<p style="font-size:${s}px"><span class="qt-mono">${s}px</span> Pack my box with five dozen liquor jugs.</p>`).join("")}</div>`;
    tools.querySelector("input").addEventListener("input", e => { v.querySelector(".pk-sample").style.fontSize = e.target.value + "px"; });
    return () => document.fonts.delete(face);
  };

  /* ---------- Word ---------- */
  VIEW.docx = (v, info, tools) => {
    if (info.needPath) { v.innerHTML = noPreview(info, "Open Word files from Burrow to read them here"); return; }
    const blocks = info.blocks || [];
    if (!blocks.length) { v.innerHTML = noPreview(info, "No text in this document"); return; }
    const text = blocks.map(b => b.x).join("\n\n");
    tools.innerHTML = tb("copy", "Copy text", "Copy all the text");
    v.innerHTML = `<div class="pk-paper"><div class="pk-note qt-mono">Text only. Pictures, tables and layout are in the real file.</div>${blocks.map(b => {
      const t = b.t === "li" ? "li" : b.t; return t === "li" ? `<p class="li">${H(b.x)}</p>` : `<${t}>${H(b.x).replace(/\n/g, "<br>")}</${t}>`; }).join("")}</div>`;
    tools.onclick = async e => { const b = e.target.closest('[data-tb="copy"]'); if (b) { await navigator.clipboard.writeText(text); flash(b, "Copied!"); } };
  };

  /* ---------- zip: list, filter, peek inside ---------- */
  VIEW.zip = (v, info, tools) => {
    if (info.needPath) { v.innerHTML = noPreview(info, "Open archives from Burrow to look inside"); return; }
    const z = info.zip || { rows: [] };
    const files = z.rows.filter(r => !r.d);
    let q = "";
    const list = () => {
      st.sub = null;
      tools.innerHTML = `<input class="qt-input pk-filter" placeholder="Filter ${files.length.toLocaleString()} files" aria-label="Filter files" value="${H(q)}">` +
        (info.path && canSpark() ? tb("unpack", "⇲ Unpack", "Unpack into a new folder next to this file (U)", "pk-unpack") : "");
      const ql = q.toLowerCase(), rs = files.filter(r => !ql || r.n.toLowerCase().includes(ql)).slice(0, 2500);
      v.innerHTML = `<div class="pk-zsum"><b class="qt-display">${z.count.toLocaleString()}</b><span>files</span><b class="qt-display">${human(z.size)}</b><span>unpacked</span><b class="qt-display">${z.size ? Math.max(0, Math.round(100 - z.packed / z.size * 100)) : 0}%</b><span>squeezed</span></div>
        <div class="pk-zlist">${rs.map((r, i) => { const parts = r.n.split("/"), nm = parts.pop(), k = kindOf(nm);
          return `<button class="pk-zrow" data-n="${H(r.n)}" style="--i:${Math.min(i, 24)};--c:${KCOL[k] || KCOL.other}"><span class="pk-zb">${H((extOf(nm) || "·").slice(0, 4))}</span><span class="pk-zn"><b>${H(nm)}</b>${parts.length ? `<small>${H(parts.join("/"))}/</small>` : ""}</span><span class="qt-mono">${human(r.s)}</span></button>`; }).join("")}
        ${!rs.length ? '<p class="qt-muted" style="padding:20px">Nothing matches.</p>' : ""}</div>${z.capped ? '<div class="pk-cut">Showing the first 3,000 entries.</div>' : ""}`;
      const inp = tools.querySelector("input");
      inp.oninput = () => { q = inp.value; clearTimeout(inp._t); inp._t = setTimeout(() => { list(); const n = tools.querySelector("input"); n.focus(); n.setSelectionRange(q.length, q.length); }, 140); };
    };
    v.addEventListener("click", async e => {
      const r = e.target.closest(".pk-zrow"); if (r) return inner(r.dataset.n);
      if (e.target.closest("[data-zback]")) list();
    });
    const unpack = async b => {
      if (!b || b.disabled) return;
      b.disabled = true; b.classList.add("busy"); b.textContent = "Unpacking...";
      try {
        const r = await post("/api/spark/extract", { path: info.path });
        b.classList.remove("busy"); b.classList.add("pk-ok"); b.textContent = "✓ " + r.files + " files";
        anim(b, [{ transform: "scale(.85)" }, { transform: "scale(1.15) rotate(-3deg)", offset: .5 }, { transform: "none" }], { duration: 380, easing: "ease-out" });
        toastA(`${r.msg} into ${base(r.dir)}`, ["Show", () => { const rev = window.qtRevealInBurrow || (HUBW && HUBW.qtRevealInBurrow); close(); rev ? rev(r.dir, true) : null; }]);
      } catch (er) { b.classList.remove("busy"); b.disabled = false; b.textContent = "⇲ Unpack"; toastP(er.message, true); }
    };
    tools.addEventListener("click", e => { const b = e.target.closest('[data-tb="unpack"]'); if (b) unpack(b); });
    st.keys = e => { if ((e.key === "u" || e.key === "U") && !st.sub) { unpack(tools.querySelector('[data-tb="unpack"]')); return true; } };
    async function inner(name) {
      const k = kindOf(name), u = rawUrl(info.path, name);
      st.sub = list;
      tools.innerHTML = `<button class="qt-btn pk-tb" data-zback2>← All files</button><span class="pk-zpath qt-mono">${H(name)}</span>`;
      tools.querySelector("[data-zback2]").onclick = list;
      const back = `<button class="qt-btn pk-zback" data-zback>← Back to the list</button>`;
      if (k === "image") v.innerHTML = `<div class="pk-inner">${back}<div class="pk-canvas"><img alt="" src="${H(u)}"></div></div>`;
      else if (k === "video") v.innerHTML = `<div class="pk-inner">${back}<video src="${H(u)}" controls autoplay></video></div>`;
      else if (k === "audio") v.innerHTML = `<div class="pk-inner">${back}<audio src="${H(u)}" controls autoplay></audio></div>`;
      else if (k === "pdf") v.innerHTML = `<div class="pk-inner">${back}<iframe title="PDF" src="${H(u)}"></iframe></div>`;
      else {
        const r = await fetch(u);
        if (!r.ok) { const j = await r.json().catch(() => ({})); v.innerHTML = `<div class="pk-inner">${back}${noPreview({ kind: k, ext: extOf(name) }, j.error || "Couldn't read that one")}</div>`; return; }
        const buf = new Uint8Array(await r.arrayBuffer());
        if (buf.subarray(0, 8000).includes(0) && !["code", "markdown", "json", "table"].includes(k)) {
          v.innerHTML = `<div class="pk-inner">${back}${hexHtml([...buf.subarray(0, 512)].map(b => b.toString(16).padStart(2, "0")).join(""))}</div>`; return;
        }
        const text = new TextDecoder().decode(buf.subarray(0, 2 * 1024 * 1024));
        v.innerHTML = `<div class="pk-inner">${back}<div class="pk-innerbox"></div></div>`;
        const box = v.querySelector(".pk-innerbox");
        if (k === "markdown") box.innerHTML = `<article class="pk-md">${md(text, "")}</article>`;
        else box.innerHTML = `<div class="pk-codebox"><pre class="pk-gut" aria-hidden="true">${text.split("\n").map((_, i) => i + 1).join("\n")}</pre><pre class="pk-src"><code>${text.length < 400000 ? highlight(text, extOf(name)) : H(text)}</code></pre></div>`;
      }
      anim(v.querySelector(".pk-inner"), [{ transform: "translateX(60px) scale(.97)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 320, easing: "cubic-bezier(.2,.9,.2,1)" });
    }
    list();
  };

  /* ---------- anything else: facts + the first bytes ---------- */
  function hexHtml(hex) {
    const rows = [];
    for (let o = 0; o < hex.length / 2; o += 16) {
      const bytes = []; for (let k = 0; k < 16 && (o + k) * 2 < hex.length; k++) bytes.push(hex.substr((o + k) * 2, 2));
      rows.push(`<span class="ho">${o.toString(16).padStart(6, "0")}</span>  ${bytes.join(" ").padEnd(47, " ")}  <span class="ha">${H(bytes.map(b => { const c = parseInt(b, 16); return c >= 32 && c < 127 ? String.fromCharCode(c) : "."; }).join(""))}</span>`);
    }
    return `<pre class="pk-hex">${rows.join("\n")}</pre>`;
  }
  VIEW.other = (v, info) => {
    v.innerHTML = noPreview(info, info.broken ? "This file looks damaged" : "No preview for this one") + (info.head ? `<div class="pk-hexwrap"><div class="qt-eyebrow">First bytes</div>${hexHtml(info.head)}</div>` : "");
  };

  /* =========================================================================================
     actions, keys, wiring
     ========================================================================================= */
  function flash(b, text) {
    const old = b.innerHTML;
    b.classList.add("pk-ok"); b.textContent = text;
    anim(b, [{ transform: "scale(.85)" }, { transform: "scale(1.12) rotate(-3deg)", offset: .5 }, { transform: "none" }], { duration: 360, easing: "ease-out" });
    setTimeout(() => { b.innerHTML = old; b.classList.remove("pk-ok"); }, 1300);
  }
  async function doAct(a, btn) {
    const info = st && st.info;
    if (a === "x") return close();
    if (a === "prev") return step(-1);
    if (a === "next") return step(1);
    if (!info || !info.path) return;
    try {
      if (a === "open" || a === "with") { await post("/api/peek/open", { path: info.path, how: a === "with" ? "with" : "default" }); toastP(a === "with" ? "Pick an app" : "Opening " + info.name); }
      if (a === "burrow") {
        const p = info.path, rev = window.qtRevealInBurrow || (HUBW && HUBW.qtRevealInBurrow);
        close(); rev ? rev(p) : toastP("Burrow isn't part of this suite", true);
      }
      if (a === "app") {
        const app = APP[info.kind], list = st.list.filter(x => x.path).map(x => x.path), p = info.path;
        close();
        return openInApp(app, p, list);
      }
      if (a === "copy") { await navigator.clipboard.writeText(info.path); flash(btn, "✓"); }
      if (a === "pin" && pinApi()) {
        const on = pinApi().toggle(info.path, info.name), b = ov && ov.querySelector('[data-pk="pin"]');
        if (b) { b.classList.toggle("on", !!on); anim(b, [{ transform: "scale(.7) rotate(-20deg)" }, { transform: "scale(1.25) rotate(12deg)", offset: .6 }, { transform: "none" }], { duration: 420, easing: "ease-out" }); }
      }
      if (a === "beam") {
        btn.classList.add("pk-fly"); btn.disabled = true;
        try { const r = await post("/api/peek/beam", { path: info.path }); toastP(r.msg || "Sent"); }
        finally { setTimeout(() => { btn.classList.remove("pk-fly"); btn.disabled = false; }, 700); }
      }
    } catch (e) { toastP(e.message, true); }
  }

  /* hub: switch to a viewer app and hand it the file (its page has its own qtPeek) */
  async function openInApp(app, path, list) {
    if (typeof show !== "function") return;
    show(app);
    for (let n = 0; n < 60; n++) {
      const f = frames[app] && frames[app].querySelector("iframe");
      let w = null; try { w = f && f.contentWindow; } catch (_) {}
      if (w && w.qtPeek && w.QT_READY) return w.qtPeek(path, { list, only: app });
      await new Promise(r => setTimeout(r, 100));
    }
    toastP("That app didn't load", true);
  }
  window.qtOpenInApp = openInApp;

  document.addEventListener("click", e => {
    if (!ov || !ov.contains(e.target)) return;
    const b = e.target.closest("[data-pk]");
    if (b && !b.disabled) { e.preventDefault(); return doAct(b.dataset.pk, b); }
    const th = e.target.closest(".pk-th");
    if (th && st) { const i = +th.dataset.i; if (i !== st.i) { const d = i > st.i ? 1 : -1; st.i = i; load(d); } }
  });

  addEventListener("keydown", e => {
    if (!ov || !st) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
    if (e.key === "Escape") {
      e.preventDefault(); e.stopImmediatePropagation();
      if (typing) return e.target.closest(".pk-find") && st.sub ? st.sub() : e.target.blur();
      if (st.sub) return st.sub();
      return close();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { close(); return; }   // let the palette open
    if ((e.ctrlKey || e.metaKey) && !e.altKey && st.ctrlKeys && !typing && st.ctrlKeys(e)) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) { if (e.ctrlKey && /^[0-9[\]\\,]$/.test(e.key)) close(); return; }
    const media = /^(VIDEO|AUDIO)$/.test(e.target.tagName);
    let done = true;
    if (e.key === "ArrowRight" && !media) step(1);
    else if (e.key === "ArrowLeft" && !media) step(-1);
    else if (e.key === "Tab") { trap(e); return; }
    else if (st.keys && st.keys(e)) {}
    else if (e.key === "o" || e.key === "O") doAct("open");
    else if (e.key === "b" || e.key === "B") doAct("burrow");
    else if ((e.key === "p" || e.key === "P") && !ov.querySelector('[data-pk="pin"]').hidden) doAct("pin", ov.querySelector('[data-pk="pin"]'));
    else if ((e.key === "a" || e.key === "A") && !ov.querySelector('[data-pk="app"]').hidden) doAct("app");
    else done = false;
    if (done) { e.preventDefault(); e.stopImmediatePropagation(); }
    else if (e.key.length === 1 && !/^(BUTTON|VIDEO|AUDIO)$/.test(e.target.tagName)) e.stopImmediatePropagation();   // hub shortcuts like ? stay quiet under Peek
  }, true);
  function trap(e) {
    const f = [...ov.querySelectorAll("button:not([disabled]):not([hidden]), input, [tabindex='0'], video, audio, iframe, [contenteditable]")].filter(x => x.offsetParent);
    if (!f.length) return;
    const i = f.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
  }

  /* ---------- Burrow / VOLT (inside the hub) ask to peek; VOLT also asks to show a file in Burrow ---------- */
  addEventListener("message", e => {
    if (!/^http:\/\/(127\.0\.0\.1|localhost):(7795|7777)$/.test(e.origin) || !e.data || typeof e.data.path !== "string") return;
    const reply = m => e.source && e.source.postMessage(Object.assign({ id: e.data.id }, m), e.origin);
    if (e.data.qt === "reveal") {
      const rev = window.qtRevealInBurrow;
      const list = typeof tools !== "undefined" ? tools : [];   // hub.js global
      if (!rev || !list.some(t => t.id === "burrow")) return reply({ qt: "reveal-no" });
      reply({ qt: "reveal-ack" });
      return rev(e.data.path);
    }
    if (e.data.qt !== "peek") return;
    if (window.qtPeekOn && !window.qtPeekOn()) return reply({ qt: "peek-no" });
    reply({ qt: "peek-ack" });
    let from = null;
    const fr = [...document.querySelectorAll("iframe")].find(f => f.contentWindow === e.source);
    if (fr && e.data.rect) { const r = fr.getBoundingClientRect(); from = { x: r.left + e.data.rect.x, y: r.top + e.data.rect.y }; }
    const list = Array.isArray(e.data.list) ? e.data.list.filter(x => typeof x === "string").slice(0, 3000) : null;
    window.qtPeek(e.data.path, { list, from });
  });

  /* ---------- files dropped on the hub itself ---------- */
  let dragN = 0;
  const hasFiles = e => e.dataTransfer && [...(e.dataTransfer.types || [])].includes("Files");
  addEventListener("dragenter", e => { if (!hasFiles(e) || (window.qtPeekOn && !window.qtPeekOn())) return; dragN++; document.documentElement.classList.add("pk-drag"); });
  addEventListener("dragleave", () => { if (dragN && --dragN === 0) document.documentElement.classList.remove("pk-drag"); });
  addEventListener("dragover", e => { if (hasFiles(e) && (!window.qtPeekOn || window.qtPeekOn())) e.preventDefault(); });
  addEventListener("drop", e => {
    dragN = 0; document.documentElement.classList.remove("pk-drag");
    if (e.__qtTaken) return;   // flow.js: dropped on a rail app, which opens it itself
    if (!hasFiles(e) || (window.qtPeekOn && !window.qtPeekOn())) return;
    e.preventDefault();
    window.qtPeekFiles(e.dataTransfer.files, { x: e.clientX, y: e.clientY });
  });

  /* ---------- icons ---------- */
  const sv = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICON = {
    open: sv('<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>'),
    with: sv('<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><path d="M16.5 13v7M13 16.5h7"/>'),
    folder: sv('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
    phone: sv('<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>'),
    link: sv('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
    x: sv('<path d="M6 6l12 12M18 6 6 18"/>'),
    pin: sv('<path d="M9 3h6l-1 6 4 4H6l4-4z"/><path d="M12 13v8"/>'),
    left: sv('<path d="M15 5 8 12l7 7"/>'), right: sv('<path d="m9 5 7 7-7 7"/>'),
  };
})();
