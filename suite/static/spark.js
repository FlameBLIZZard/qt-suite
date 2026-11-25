"use strict";
/* QT Suite spark layer (loop 4). Loaded LAST, after flow.js; reuses hub.js / hub-plus.js / shell.js / flow.js globals.
   Server half: spark.py (/api/spark/*).
   1 palette calculator + unit converter       2 paste a link: VOLT download dock, send link to phone
   3 notes drawer (Ctrl+J), send a note to phone  4 live CPU / memory meter on home
   5 pinned files + folders shelf on home        (6-10 live in peek.js: Player resume/queue, Code find, unzip, slideshow + photo facts, Markdown outline)
   11 focus timer   12 action toasts + history   13 settings backup   14 home list view   15 UI sounds
   16 flip clock    17 rail hover cards          18 new in Downloads  19 shortcuts + what's new   20 polish */
(() => {
  const RM = matchMedia("(prefers-reduced-motion: reduce)");
  const PHONE = matchMedia("(max-width: 600px)");
  const spring = "cubic-bezier(.34,1.8,.5,1)";
  const anim = (el, kf, o) => (RM.matches || !el || !el.animate) ? null : el.animate(kf, o);
  const byId = id => tools.find(t => t.id === id);
  const post = (p, b) => api(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b || {}) });
  const typing = e => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };
  const base = p => String(p).replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p;
  const shortDir = d => String(d || "").replace(/^C:\\Users\\[^\\]+/i, "~");
  const human = n => n == null ? "" : n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(n < 10240 ? 1 : 0) + " KB" : n < 1073741824 ? (n / 1048576).toFixed(1) + " MB" : (n / 1073741824).toFixed(2) + " GB";
  const ago = t => { const s = Math.max(0, Date.now() / 1000 - t); return s < 60 ? "just now" : s < 3600 ? Math.floor(s / 60) + " min ago" : s < 86400 ? Math.floor(s / 3600) + " h ago" : Math.floor(s / 86400) + " d ago"; };
  const palInput = () => document.querySelector(".pal-wrap input");
  const home = document.getElementById("view-home");
  const hero = home.querySelector(".hero");
  const say = (m, o) => (window.qtToast || toast)(m, o);   // section 12 upgrades toasts
  const sfx = k => window.qtSfx && window.qtSfx(k);       // section 15 sounds (off unless switched on)

  /* shared server store: notes + pins (spark.py), one copy for every window */
  let store = { notes: [], pins: [] };
  const storeReady = api("/api/spark/store").then(s => { store = s; document.dispatchEvent(new CustomEvent("qt-store")); }).catch(() => {});
  let saveT = {};
  function saveStore(key, now) {
    clearTimeout(saveT[key]);
    const go = () => post("/api/spark/store", { [key]: store[key] }).catch(e => say("Couldn't save: " + e.message, { bad: true }));
    if (now) return go();
    saveT[key] = setTimeout(go, 450);
  }

  /* palette helper: chain onto whoever set qtPalExtra before us */
  function palAdd(fn) {
    const prev = window.qtPalExtra;
    window.qtPalExtra = q => { const out = prev ? prev(q) : []; try { fn(q, palInput() ? palInput().value : q, out); } catch (e) { console.warn(e); } return out; };
  }
  function copyText(text, what) {
    return navigator.clipboard.writeText(text).then(() => { say(`Copied ${what || text}`); sfx("pop"); }, e => say("Couldn't copy: " + e.message, { bad: true }));
  }

  /* =========================================================================================
     1. PALETTE CALCULATOR + UNIT CONVERTER: type 12*8, 18% of 2400, 5 km in mi, 72 f to c, 3.2 gb in mb
     ========================================================================================= */
  const FN = { sqrt: Math.sqrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil, sin: x => Math.sin(x), cos: x => Math.cos(x), tan: x => Math.tan(x),
    log: Math.log10, ln: Math.log, exp: Math.exp };
  function calc(src) {
    const s = src.replace(/×/g, "*").replace(/÷/g, "/").replace(/,(?=\d{2,3}\b)/g, "").replace(/\s+/g, "").toLowerCase();
    if (!s || !/[\d)]/.test(s) || !/^[\d.+\-*/^%()a-z]+$/.test(s)) return null;
    let i = 0;
    const peek = () => s[i];
    function num() {
      if (peek() === "(") { i++; const v = expr(); if (s[i] !== ")") throw 0; i++; return v; }
      const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/.exec(s.slice(i));
      if (m) { i += m[0].length; return parseFloat(m[0]); }
      const w = /^[a-z]+/.exec(s.slice(i));
      if (!w) throw 0;
      i += w[0].length;
      if (w[0] === "pi") return Math.PI;
      if (w[0] === "e") return Math.E;
      if (FN[w[0]] && peek() === "(") return FN[w[0]](num());
      throw 0;
    }
    function unary() { if (peek() === "-") { i++; return -unary(); } if (peek() === "+") { i++; return unary(); } return post(num()); }
    function post(v) { while (peek() === "%" ) { i++; v = v / 100; } return v; }
    function pow() { const b = unary(); if (peek() === "^") { i++; return Math.pow(b, pow()); } return b; }
    function term() { let v = pow(); while (peek() === "*" || peek() === "/" || (peek() && /[\d(a-z]/.test(peek()) && s[i - 1] === ")")) { const o = s[i] === "*" || s[i] === "/" ? s[i++] : "*"; const r = pow(); v = o === "*" ? v * r : v / r; } return v; }
    function expr() { let v = term(); while (peek() === "+" || peek() === "-") { const o = s[i++]; const r = term(); v = o === "+" ? v + r : v - r; } return v; }
    try { const v = expr(); if (i !== s.length || !isFinite(v)) return null; return v; } catch (_) { return null; }
  }
  const fmtNum = v => { const r = Math.abs(v) >= 1e15 || (Math.abs(v) < 1e-6 && v !== 0) ? v.toExponential(6) : String(+v.toPrecision(12)); return r; };
  const pretty = v => { const r = fmtNum(v); return /e/.test(r) ? r : Number(r).toLocaleString("en-IN", { maximumFractionDigits: Math.abs(v) < 1 ? 8 : 4 }); };
  // units: [group, factor to the base unit]
  const U = {};
  const unit = (g, f, ...names) => names.forEach(n => { U[n] = [g, f]; });
  unit("len", 1, "m", "meter", "meters", "metre", "metres"); unit("len", 1000, "km", "kms", "kilometer", "kilometers"); unit("len", .01, "cm"); unit("len", .001, "mm");
  unit("len", 1609.344, "mi", "mile", "miles"); unit("len", .3048, "ft", "feet", "foot"); unit("len", .0254, "in", "inch", "inches"); unit("len", .9144, "yd", "yard", "yards");
  unit("mass", 1, "kg", "kgs", "kilo", "kilos"); unit("mass", .001, "g", "gram", "grams"); unit("mass", .45359237, "lb", "lbs", "pound", "pounds"); unit("mass", .028349523, "oz", "ounce", "ounces");
  unit("data", 1, "b", "byte", "bytes"); unit("data", 1024, "kb"); unit("data", 1048576, "mb"); unit("data", 1073741824, "gb"); unit("data", 1099511627776, "tb");
  unit("time", 1, "s", "sec", "secs", "second", "seconds"); unit("time", 60, "min", "mins", "minute", "minutes"); unit("time", 3600, "h", "hr", "hrs", "hour", "hours");
  unit("time", 86400, "d", "day", "days"); unit("time", 604800, "wk", "week", "weeks");
  unit("vol", 1, "l", "liter", "liters", "litre", "litres"); unit("vol", .001, "ml"); unit("vol", 3.785411784, "gal", "gallon", "gallons");
  unit("speed", 1, "kmh", "kph"); unit("speed", 1.609344, "mph"); unit("speed", 3.6, "mps", "m/s");
  unit("temp", 0, "c", "celsius", "°c"); unit("temp", 0, "f", "fahrenheit", "°f"); unit("temp", 0, "k", "kelvin");
  function convert(q) {
    const m = /^\s*(-?[\d.,]+(?:\s*[-+*/^]\s*[\d.]+)*)\s*([a-z°/]+)\s+(?:in|to|as|=)\s+([a-z°/]+)\s*$/i.exec(q);
    if (!m) return null;
    const v = calc(m[1]); const a = U[m[2].toLowerCase()], b = U[m[3].toLowerCase()];
    if (v == null || !a || !b || a[0] !== b[0]) return null;
    if (a[0] === "temp") {
      const f = m[2][0].toLowerCase().replace("°", ""), t = m[3].replace("°", "")[0].toLowerCase();
      const c = f === "c" ? v : f === "f" ? (v - 32) * 5 / 9 : v - 273.15;
      return { v: t === "c" ? c : t === "f" ? c * 9 / 5 + 32 : c + 273.15, from: `${pretty(v)} °${f.toUpperCase()}`, to: t === "k" ? "K" : "°" + t.toUpperCase() };
    }
    return { v: v * a[1] / b[1], from: `${pretty(v)} ${m[2]}`, to: m[3] };
  }
  palAdd((q, raw, out) => {
    const t = raw.trim().replace(/^=/, "");
    if (t.length < 2) return;
    const pc = /^(-?[\d.,]+)\s*%\s*(?:of)\s*(-?[\d.,]+)$/i.exec(t);
    const cv = convert(t);
    let v = null, label = "", sub = "";
    if (pc) { v = parseFloat(pc[1].replace(/,/g, "")) / 100 * parseFloat(pc[2].replace(/,/g, "")); sub = t; }
    else if (cv) { v = cv.v; sub = `${cv.from} in ${cv.to}`; label = ` ${cv.to}`; }
    else if (/[-+*/^%(]|sqrt|pi/.test(t) || raw.trim().startsWith("=")) { v = calc(t); sub = t; }
    if (v == null) return;
    const shown = pretty(v) + label;
    out.push({ label: "= " + shown, sub: sub + " · Enter copies", head: "", fixed: 1200, glyph: "=", calc: true, words: t,
      run: () => copyText(fmtNum(v), shown), alt: () => copyText(sub + " = " + shown) });
  });

  /* =========================================================================================
     2. LINKS: paste a link anywhere (or into Ctrl+K) -> download it with VOLT, send it to the phone, or open it
     ========================================================================================= */
  const URL_RE = /^https?:\/\/[^\s/$.?#][^\s]*$/i;
  palAdd((q, raw, out) => {
    const u = raw.trim();
    if (!URL_RE.test(u)) return;
    let host = ""; try { host = new URL(u).host.replace(/^www\./, ""); } catch (_) {}
    out.push({ label: "Download with VOLT", sub: host, fixed: 1100, ic: "/icons/volt.svg", words: u, tool: byId("volt"), run: () => grab(u, "video") });
    out.push({ label: "Download the sound only (MP3)", sub: host, fixed: 1099, ic: "/icons/volt.svg", words: u, tool: byId("volt"), run: () => grab(u, "audio") });
    out.push({ label: "Send this link to my phone", sub: "lands in Beam on the phone", fixed: 1098, ic: "/icons/beam.svg", words: u, run: () => phoneNote(u) });
    out.push({ label: "Open in the browser", sub: host, fixed: 1097, glyph: "↗", words: u, minor: true, run: () => window.open(u, "_blank", "noopener") });
  });
  // Ctrl+V on the hub (not in a box): a link opens the palette with its choices
  document.addEventListener("paste", e => {
    if (typing(e) || document.querySelector(".pal-wrap, .pk, .nt-drawer")) return;
    const t = (e.clipboardData && e.clipboardData.getData("text") || "").trim();
    if (!URL_RE.test(t) && !(window.qtPeek && /^([a-zA-Z]:[\\/]|\\\\)/.test(t))) return;
    e.preventDefault();
    window.qtPalOpen && window.qtPalOpen();
    const inp = palInput(); if (!inp) return;
    inp.value = t; inp.dispatchEvent(new Event("input"));
  });
  async function phoneNote(text) {
    try { const r = await post("/api/spark/phone-note", { text }); say(r.msg || "Sent to your phone", { icon: "beam" }); sfx("whoosh"); }
    catch (e) { say(e.message, { bad: true }); }
  }
  window.qtPhoneNote = phoneNote;

  /* grab dock: one card per suite download, bottom right, with a progress ring */
  const dock = document.createElement("div");
  dock.className = "gd-dock"; dock.setAttribute("aria-live", "polite");
  document.body.append(dock);
  let grabs = [], grabT = 0, gone = new Set(lsGet("qt-grab-gone", []));
  async function grab(url, mode) {
    try {
      const r = await post("/api/spark/grab", { url, mode });
      gone.delete(r.id);
      say(mode === "audio" ? "Getting the sound from that link" : "VOLT is on it", { icon: "volt" }); sfx("go");
      pollGrabs();
    } catch (e) { say(e.message, { bad: true }); }
  }
  window.qtGrab = grab;
  async function pollGrabs() {
    clearTimeout(grabT);
    try { grabs = (await api("/api/spark/grabs")).grabs || []; } catch (_) { grabs = []; }
    paintDock();
    if (grabs.some(g => !["done", "error", "cancelled"].includes(g.state))) grabT = setTimeout(pollGrabs, 900);
  }
  const STATE = { starting: "Waking VOLT", reading: "Reading the link", queued: "Queued", downloading: "Downloading", processing: "Finishing", done: "Done", error: "Didn't work", cancelled: "Cancelled" };
  function paintDock() {
    const list = grabs.filter(g => !gone.has(g.id)).slice(0, 4);
    const have = new Set(list.map(g => g.id));
    dock.querySelectorAll(".gd").forEach(el => { if (!have.has(el.dataset.id)) { const a = anim(el, [{ transform: "none", opacity: 1 }, { transform: "translateX(120%) rotate(6deg)", opacity: 0 }], { duration: 260, easing: "ease-in", fill: "forwards" }); a ? a.finished.then(() => el.remove(), () => el.remove()) : el.remove(); } });
    list.forEach((g, i) => {
      let el = dock.querySelector(`.gd[data-id="${g.id}"]`);
      const fresh = !el;
      if (fresh) {
        el = document.createElement("div");
        el.className = "gd qt-card"; el.dataset.id = g.id; el.dataset.tool = "volt";
        el.innerHTML = `<svg class="gd-ring" viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="18" class="tr"/><circle cx="22" cy="22" r="18" class="fg"/></svg>
          <img class="gd-ic" src="/icons/volt.svg" alt=""><div class="gd-tx"><b></b><small></small></div><div class="gd-acts"></div>
          <button class="gd-x" title="Hide" aria-label="Hide">✕</button>`;
        dock.append(el);
        anim(el, [{ transform: "translateY(40px) scale(.7) rotate(-4deg)", opacity: 0 }, { transform: "translateY(-4px) scale(1.03)", opacity: 1, offset: .7 }, { transform: "none" }], { duration: 480, easing: "cubic-bezier(.2,.9,.2,1)" });
      }
      const done = g.state === "done", bad = g.state === "error" || g.state === "cancelled";
      el.classList.toggle("done", done); el.classList.toggle("bad", bad);
      el.querySelector(".gd-tx b").textContent = g.title || g.url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60);
      el.querySelector(".gd-tx small").textContent = bad ? (g.error || STATE[g.state]) : done ? (g.path ? base(g.path) : "Saved") :
        `${STATE[g.state] || g.state}${g.pct ? " · " + Math.round(g.pct) + "%" : ""}${g.speed ? " · " + g.speed : ""}${g.eta ? " · " + g.eta + " left" : ""}`;
      const pct = done ? 100 : Math.max(2, Math.min(100, g.pct || 0));
      el.querySelector(".fg").style.strokeDashoffset = String(113.1 * (1 - pct / 100));
      el.classList.toggle("spin", !done && !bad && !g.pct);
      const acts = el.querySelector(".gd-acts"), sig = done ? "done" + (g.path || "") : bad ? "bad" : "";
      if (acts.dataset.sig !== sig) {
        acts.dataset.sig = sig;
        acts.innerHTML = done && g.path ? `<button class="qt-btn" data-g="peek">Open</button><button class="qt-btn ghost" data-g="burrow">Show</button>` : bad ? `<button class="qt-btn" data-g="volt">Open VOLT</button>` : "";
        if (done && !fresh) { sfx("done"); anim(el, [{ transform: "scale(1)" }, { transform: "scale(1.08) rotate(-2deg)" }, { transform: "none" }], { duration: 420, easing: spring }); }
      }
    });
  }
  dock.addEventListener("click", e => {
    const card = e.target.closest(".gd"); if (!card) return;
    const g = grabs.find(x => x.id === card.dataset.id); if (!g) return;
    const b = e.target.closest("[data-g], .gd-x");
    if (!b) return;
    if (b.classList.contains("gd-x")) { gone.add(g.id); lsSet("qt-grab-gone", [...gone].slice(-40)); return paintDock(); }
    if (b.dataset.g === "peek" && g.path) window.qtPeek ? window.qtPeek(g.path) : null;
    if (b.dataset.g === "burrow" && g.path) window.qtRevealInBurrow && window.qtRevealInBurrow(g.path);
    if (b.dataset.g === "volt") show("volt");
  });
  pollGrabs();

  /* =========================================================================================
     3. NOTES (Ctrl+J): a scratchpad drawer, saved on this PC, one tap to the phone
     ========================================================================================= */
  let nd = null, noteId = lsGet("qt-note-on", "");
  const noteTitle = n => (n.text.split("\n").find(l => l.trim()) || "Empty note").replace(/^#+\s*/, "").slice(0, 60);
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  function sortedNotes() { return [...store.notes].sort((a, b) => (b.pin - a.pin) || (b.ts - a.ts)); }
  function openNotes(id, fresh) {
    if (id) noteId = id;
    if (fresh) { const n = { id: newId(), text: "", ts: Date.now() / 1000, pin: false }; store.notes.unshift(n); noteId = n.id; saveStore("notes", true); }
    if (!store.notes.length) { const n = { id: newId(), text: "", ts: Date.now() / 1000, pin: false }; store.notes.push(n); noteId = n.id; }
    if (!store.notes.some(n => n.id === noteId)) noteId = sortedNotes()[0].id;
    lsSet("qt-note-on", noteId);
    if (!nd) {
      nd = document.createElement("aside");
      nd.className = "nt-drawer qt-card"; nd.setAttribute("role", "dialog"); nd.setAttribute("aria-label", "Notes");
      nd.innerHTML = `<div class="sbh"><h2 class="qt-display">Notes</h2><span class="nt-saved qt-mono" aria-live="polite"></span>
          <button class="qt-btn ghost icon" data-n="close" aria-label="Close (Esc)" title="Close (Esc)">✕</button></div>
        <div class="nt-body"><div class="nt-list" role="listbox" aria-label="Your notes"></div>
          <div class="nt-ed"><textarea class="qt-input" spellcheck="true" placeholder="Jot it down. It saves as you type."></textarea>
            <div class="nt-bar"><button class="qt-btn primary" data-n="phone" title="Send this note to your phone (Ctrl+Enter)">📱 To phone</button>
              <button class="qt-btn" data-n="copy">Copy</button><button class="qt-btn ghost" data-n="pin" title="Keep at the top">📌</button>
              <span class="nt-count qt-mono"></span><button class="qt-btn ghost" data-n="del" title="Delete this note">🗑</button></div></div></div>`;
      document.body.append(nd);
      const ta = nd.querySelector("textarea");
      ta.addEventListener("input", () => {
        const n = store.notes.find(x => x.id === noteId); if (!n) return;
        n.text = ta.value; n.ts = Date.now() / 1000;
        nd.querySelector(".nt-saved").textContent = "saving...";
        saveStore("notes"); clearTimeout(ta._t); ta._t = setTimeout(() => { nd && (nd.querySelector(".nt-saved").textContent = "saved ✓"); paintNoteList(); }, 520);
        paintCount();
      });
      ta.addEventListener("keydown", e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); nd.querySelector('[data-n="phone"]').click(); } });
      nd.addEventListener("click", e => {
        const it = e.target.closest(".nt-item");
        if (it) { noteId = it.dataset.id; lsSet("qt-note-on", noteId); return paintNotes(true); }
        const b = e.target.closest("[data-n]"); if (!b) return;
        const n = store.notes.find(x => x.id === noteId);
        if (b.dataset.n === "close") return closeNotes();
        if (b.dataset.n === "new") return openNotes(null, true);
        if (!n) return;
        if (b.dataset.n === "phone") { if (!n.text.trim()) return say("Write something first", { bad: true }); b.classList.add("fly"); setTimeout(() => b.classList.remove("fly"), 700); phoneNote(n.text); }
        if (b.dataset.n === "copy") copyText(n.text, "the note");
        if (b.dataset.n === "pin") { n.pin = !n.pin; saveStore("notes", true); paintNotes(); sfx("tick"); }
        if (b.dataset.n === "del") {
          const i = store.notes.indexOf(n); store.notes.splice(i, 1); saveStore("notes", true);
          say(`Deleted "${noteTitle(n)}"`, { action: ["Undo", () => { store.notes.splice(i, 0, n); noteId = n.id; saveStore("notes", true); nd ? paintNotes(true) : openNotes(n.id); }] });
          if (!store.notes.length) return closeNotes();
          noteId = sortedNotes()[0].id; paintNotes(true);
        }
      });
      anim(nd, [{ transform: "translateX(110%) rotate(3deg)" }, { transform: "translateX(-10px)", offset: .7 }, { transform: "none" }], { duration: 460, easing: "cubic-bezier(.2,.9,.2,1)" });
      sfx("open");
    }
    paintNotes(true);
  }
  function paintCount() {
    const n = store.notes.find(x => x.id === noteId), t = n ? n.text : "";
    nd.querySelector(".nt-count").textContent = `${(t.match(/\S+/g) || []).length} words`;
    nd.querySelector('[data-n="pin"]').classList.toggle("on", !!(n && n.pin));
  }
  function paintNoteList() {
    if (!nd) return;
    nd.querySelector(".nt-list").innerHTML = `<button class="qt-btn nt-new" data-n="new" title="New note">＋ New</button>` + sortedNotes().map((n, i) =>
      `<button class="nt-item${n.id === noteId ? " on" : ""}" role="option" aria-selected="${n.id === noteId}" data-id="${n.id}" style="--i:${Math.min(i, 10)}"><b>${n.pin ? "📌 " : ""}${esc(noteTitle(n))}</b><small>${ago(n.ts)}</small></button>`).join("");
  }
  function paintNotes(focus) {
    if (!nd) return;
    paintNoteList();
    const n = store.notes.find(x => x.id === noteId), ta = nd.querySelector("textarea");
    if (ta.value !== (n ? n.text : "")) { ta.value = n ? n.text : ""; anim(ta, [{ opacity: .3, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 220, easing: "ease-out" }); }
    nd.querySelector(".nt-saved").textContent = "";
    paintCount();
    if (focus) { ta.focus(); }
  }
  function closeNotes() {
    if (!nd) return;
    const d = nd; nd = null;
    Object.values(saveT).forEach(clearTimeout); saveStore("notes", true);
    const a = anim(d, [{ transform: "none" }, { transform: "translateX(110%) rotate(3deg)" }], { duration: 260, easing: "ease-in", fill: "forwards" });
    a ? a.finished.then(() => d.remove(), () => d.remove()) : d.remove();
    setTimeout(() => d.isConnected && d.remove(), 400);
  }
  window.qtNotes = { open: openNotes, close: closeNotes, toggle: () => nd ? closeNotes() : openNotes() };
  document.addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "j") { e.preventDefault(); return nd ? closeNotes() : storeReady.then(() => openNotes()); }
    if (e.key === "Escape" && nd && !document.querySelector(".pal-wrap")) { e.preventDefault(); closeNotes(); }
  });
  document.addEventListener("pointerdown", e => { if (nd && !e.target.closest(".nt-drawer, .rail-btns, .qt-toast, .pal-wrap")) closeNotes(); });
  palAdd((q, raw, out) => {
    out.push({ label: "Notes", sub: store.notes.length ? `${store.notes.length} saved` : "a scratchpad", run: () => openNotes(), words: "notes scratch jot write memo pad", glyph: "✎", hint: "Ctrl+J", minor: !q });
    if (q) out.push({ label: "New note", run: () => openNotes(null, true), words: "new note write jot", glyph: "＋", minor: true });
    const ql = q.trim().toLowerCase();
    if (ql.length >= 2) store.notes.filter(n => n.text.toLowerCase().includes(ql)).slice(0, 3).forEach((n, i) =>
      out.push({ label: noteTitle(n), sub: ago(n.ts), head: "Notes", fixed: 2.2 - i * .01, glyph: "✎", run: () => openNotes(n.id) }));
    if (ql.startsWith("note ") && raw.trim().length > 5) {
      const text = raw.trim().slice(5);
      out.push({ label: `Save note: "${text.slice(0, 40)}"`, fixed: 1050, glyph: "✎", run: () => { store.notes.unshift({ id: newId(), text, ts: Date.now() / 1000, pin: false }); saveStore("notes", true); say("Saved to Notes", { action: ["Open", () => openNotes(store.notes[0].id)] }); } });
      out.push({ label: `Send to phone: "${text.slice(0, 40)}"`, fixed: 1049, ic: "/icons/beam.svg", run: () => phoneNote(text) });
    }
  });
  // rail footer: a Notes button next to Activity / Settings / Status
  const rb = document.querySelector(".rail-btns");
  if (rb) {
    const nb = document.createElement("button");
    nb.className = "qt-btn ghost"; nb.id = "notes-btn"; nb.title = "Notes (Ctrl+J)";
    nb.innerHTML = '<i class="pen">✎</i><span>Notes</span>';
    nb.onclick = () => storeReady.then(() => nd ? closeNotes() : openNotes());
    rb.prepend(nb);
  }

  /* =========================================================================================
     4. LIVE CPU + MEMORY meter on home (sampled every second by spark.py)
     ========================================================================================= */
  const sm = document.createElement("button");
  sm.className = "sysm qt-card"; sm.type = "button"; sm.title = "This PC right now. Click for the busiest tools.";
  sm.innerHTML = `<div class="sm-row"><span class="sm-k">CPU</span><b class="sm-v" data-k="cpu">-</b><canvas width="180" height="34" data-c="cpu"></canvas></div>
    <div class="sm-row"><span class="sm-k">RAM</span><b class="sm-v" data-k="mem">-</b><canvas width="180" height="34" data-c="mem"></canvas></div>
    <small class="sm-foot qt-mono"></small>`;
  const hs = document.getElementById("hero-stats");
  hs.after(sm);
  let sysT = 0, sysOn = false;
  const accent = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  function spark(cv, data, col) {
    const g = cv.getContext("2d"), w = cv.width, h = cv.height;
    g.clearRect(0, 0, w, h);
    if (data.length < 2) return;
    const pts = data.slice(-40), step = w / 39;
    const xy = (v, i) => [i * step + (40 - pts.length) * step, h - 3 - (Math.min(100, v) / 100) * (h - 6)];
    g.beginPath(); pts.forEach((v, i) => { const [x, y] = xy(v, i); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.lineTo(w, h); g.lineTo(xy(pts[0], 0)[0], h); g.closePath(); g.fillStyle = col + "33"; g.fill();
    g.beginPath(); pts.forEach((v, i) => { const [x, y] = xy(v, i); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.strokeStyle = col; g.lineWidth = 2.5; g.lineJoin = "round"; g.stroke();
    const [lx, ly] = xy(pts[pts.length - 1], pts.length - 1);
    g.beginPath(); g.arc(lx - 3, ly, 3.5, 0, 7); g.fillStyle = col; g.fill(); g.lineWidth = 2; g.strokeStyle = "#000"; g.stroke();
  }
  const upText = s => { const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`; };
  async function pollSys() {
    clearTimeout(sysT);
    if (!sysOn) return;
    try {
      const s = await api("/api/spark/sys");
      setV("cpu", s.cpu == null ? "-" : Math.round(s.cpu) + "%", s.cpu > 85);
      setV("mem", s.mem && s.mem.pct != null ? s.mem.pct + "%" : "-", s.mem && s.mem.pct > 88);
      spark(sm.querySelector('[data-c="cpu"]'), s.cpuh || [], accent("--qt-launchpad") || "#4dc3ff");
      spark(sm.querySelector('[data-c="mem"]'), s.memh || [], accent("--qt-inkmotion") || "#b28bff");
      sm.querySelector(".sm-foot").textContent = `${s.cores} cores · ${s.mem ? human(s.mem.used) + " of " + human(s.mem.total) : ""} · on for ${upText(s.up)}`;
    } catch (_) {}
    sysT = setTimeout(pollSys, document.hidden ? 8000 : 2000);
  }
  function setV(k, text, hot) {
    const el = sm.querySelector(`[data-k="${k}"]`);
    el.classList.toggle("hot", !!hot);
    if (el.textContent === text) return;
    el.textContent = text;
    anim(el, [{ transform: "translateY(-6px)", opacity: .2 }, { transform: "none", opacity: 1 }], { duration: 260, easing: "ease-out" });
  }
  function sysVis() { const on = current === "home" && lsGet("qt-sysm", true); sm.hidden = !on; if (on !== sysOn) { sysOn = on; if (on) pollSys(); } }
  document.addEventListener("qt-show", sysVis);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && sysOn) pollSys(); });
  sysVis();
  // click: who is using the memory (the suite's tools)
  sm.addEventListener("click", async () => {
    let pop = document.querySelector(".sm-pop");
    if (pop) return pop.remove();
    let procs = {};
    try { procs = await api("/api/procs"); } catch (_) {}
    const seen = new Set(), rows = Object.entries(procs).filter(([id, p]) => !seen.has(p.pid) && seen.add(p.pid)).sort((a, b) => b[1].mem - a[1].mem).slice(0, 6);
    pop = document.createElement("div");
    pop.className = "sm-pop qt-card";
    pop.innerHTML = `<div class="qt-eyebrow">Suite tools by memory</div>` + (rows.length ? rows.map(([id, p], i) => { const t = byId(id) || { name: id };
      return `<button data-go="${id}" data-tool="${id}" style="--i:${i}"><img src="/icons/${id}.svg" alt=""><b>${esc(t.name)}</b><span class="qt-mono">${human(p.mem)}</span><i style="--w:${Math.min(100, p.mem / rows[0][1].mem * 100)}%"></i></button>`; }).join("")
      : `<p class="qt-muted">No suite tools running.</p>`);
    const r = sm.getBoundingClientRect();
    pop.style.left = Math.min(innerWidth - 300, r.left) + "px"; pop.style.top = r.bottom + 10 + "px";
    document.body.append(pop);
    pop.onclick = e => { const b = e.target.closest("[data-go]"); if (b) { pop.remove(); show(b.dataset.go); } };
    anim(pop, [{ transform: "translateY(-8px) scale(.95)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 240, easing: spring });
  });
  document.addEventListener("pointerdown", e => { const p = document.querySelector(".sm-pop"); if (p && !e.target.closest(".sm-pop, .sysm")) p.remove(); });

  /* =========================================================================================
     5. SHELF on home: pinned files + folders (left), new in Downloads (right, section 18)
     ========================================================================================= */
  const shelf = document.createElement("section");
  shelf.className = "shelf"; shelf.id = "shelf"; shelf.setAttribute("aria-label", "Pinned and new");
  shelf.innerHTML = `<div class="sh-col sh-pins"><div class="rf-head"><h2>Pinned</h2><span class="qt-muted">Files and folders you keep coming back to</span></div><div class="sh-list" data-list="pins"></div></div>
    <div class="sh-col sh-dl" hidden><div class="rf-head"><h2>New in Downloads</h2><button class="qt-btn ghost" data-sh="dlall" title="Open Downloads in Burrow">↗ <span>All</span></button></div><div class="sh-list" data-list="dl"></div></div>`;
  (document.getElementById("recentf") || document.getElementById("glance") || hero).after(shelf);
  const isPinned = p => store.pins.some(x => x.path.toLowerCase() === String(p).toLowerCase());
  const pinIcon = (name, isdir) => isdir ? "📁" : ({ image: "🖼", picture: "🖼", video: "🎞", audio: "🎵", pdf: "📕", markdown: "📝", zip: "🗜", code: "📄", json: "📄", table: "📊" })[window.qtPeekKind ? window.qtPeekKind(name) : ""] || "📄";
  let pinStat = {};
  async function statPins() {
    if (!store.pins.length) return;
    try {
      const r = await api("/api/spark/stat?" + store.pins.map(p => "path=" + encodeURIComponent(p.path)).join("&"));
      r.items.forEach(x => { pinStat[x.path.toLowerCase()] = x; });
      paintShelf(true);
    } catch (_) {}
  }
  function togglePin(path, name) {
    if (!path) return;
    const was = isPinned(path);
    if (was) store.pins = store.pins.filter(x => x.path.toLowerCase() !== path.toLowerCase());
    else store.pins.unshift({ path, name: name || base(path) });
    saveStore("pins", true);
    say(was ? `Unpinned ${name || base(path)}` : `Pinned ${name || base(path)} to Home`, was ? { action: ["Undo", () => togglePin(path, name)] } : { icon: "suite" });
    sfx(was ? "tick" : "pop");
    statPins(); paintShelf(true);
    document.dispatchEvent(new CustomEvent("qt-pins"));
    return !was;
  }
  window.qtPin = { toggle: togglePin, has: isPinned };
  function openPath(path, from, list) {
    const st = pinStat[path.toLowerCase()];
    if (st && !st.ok) return say("That isn't there any more", { bad: true, action: ["Unpin", () => togglePin(path)] });
    if (st && st.isdir) return window.qtRevealInBurrow ? window.qtRevealInBurrow(path, true) : null;
    window.qtPeek ? window.qtPeek(path, { from, list }) : null;
  }
  function paintShelf(force) {
    const pins = shelf.querySelector('[data-list="pins"]');
    const sig = store.pins.map(p => p.path + (pinStat[p.path.toLowerCase()] || {}).ok).join("|");
    shelf.querySelector(".sh-pins").hidden = !store.pins.length;
    paintVis();
    if (!force && pins.dataset.sig === sig) return;
    pins.dataset.sig = sig;
    pins.innerHTML = store.pins.map((p, i) => {
      const st = pinStat[p.path.toLowerCase()] || {};
      return `<button class="sh-item qt-card${st.ok === false ? " gone" : ""}" data-path="${esc(p.path)}" style="--i:${i}" title="${esc(p.path)}" draggable="true">
        <span class="sh-ic">${pinIcon(p.name, st.isdir)}</span><span class="sh-nm"><b>${esc(p.name)}</b><small>${esc(st.ok === false ? "missing" : shortDir(p.path.replace(/\\[^\\]+$/, "")))}</small></span>
        <span class="sh-x" role="button" tabindex="-1" data-sh="unpin" title="Unpin" aria-label="Unpin ${esc(p.name)}">✕</span></button>`;
    }).join("");
  }
  function paintVis() {
    shelf.hidden = current !== "home" || (shelf.querySelector(".sh-pins").hidden && shelf.querySelector(".sh-dl").hidden);
    shelf.classList.toggle("one", shelf.querySelector(".sh-pins").hidden !== shelf.querySelector(".sh-dl").hidden);
  }
  shelf.addEventListener("click", e => {
    const it = e.target.closest(".sh-item"); if (!it) return;
    const path = it.dataset.path;
    if (e.target.closest('[data-sh="unpin"]')) {
      e.stopPropagation();
      const a = anim(it, [{ transform: "none", opacity: 1 }, { transform: "scale(.5) rotate(8deg)", opacity: 0 }], { duration: 220, easing: "ease-in", fill: "forwards" });
      (a ? a.finished : Promise.resolve()).then(() => togglePin(path, it.querySelector("b").textContent));
      return;
    }
    if (it.closest('[data-list="dl"]')) return;   // section 18 handles these
    const r = it.getBoundingClientRect();
    openPath(path, { x: r.left + r.width / 2, y: r.top + r.height / 2 }, store.pins.filter(p => !(pinStat[p.path.toLowerCase()] || {}).isdir).map(p => p.path));
  });
  shelf.addEventListener("contextmenu", e => {
    const it = e.target.closest('[data-list="pins"] .sh-item'); if (!it) return;
    e.preventDefault(); window.qtRevealInBurrow && window.qtRevealInBurrow(it.dataset.path);
  });
  // drag pins to reorder (same FLIP feel as the rail)
  let dragP = null;
  shelf.addEventListener("dragstart", e => { const it = e.target.closest('[data-list="pins"] .sh-item'); if (!it) return; dragP = it; it.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; });
  shelf.addEventListener("dragover", e => {
    if (!dragP) return; e.preventDefault();
    const over = e.target.closest('[data-list="pins"] .sh-item'); if (!over || over === dragP) return;
    const list = over.parentElement, items = [...list.children], before = items.indexOf(over) < items.indexOf(dragP);
    const first = new Map(items.map(x => [x, x.getBoundingClientRect()]));
    list.insertBefore(dragP, before ? over : over.nextSibling);
    items.forEach(x => { const a = first.get(x), b = x.getBoundingClientRect(); if (a.left !== b.left || a.top !== b.top) anim(x, [{ transform: `translate(${a.left - b.left}px, ${a.top - b.top}px)` }, { transform: "none" }], { duration: 220, easing: "cubic-bezier(.2,.9,.2,1)" }); });
  });
  shelf.addEventListener("dragend", () => {
    if (!dragP) return; dragP.classList.remove("dragging"); dragP = null;
    const order = [...shelf.querySelectorAll('[data-list="pins"] .sh-item')].map(x => x.dataset.path.toLowerCase());
    store.pins.sort((a, b) => order.indexOf(a.path.toLowerCase()) - order.indexOf(b.path.toLowerCase()));
    saveStore("pins", true);
  });
  document.addEventListener("qt-store", () => { statPins(); paintShelf(true); });
  document.addEventListener("qt-show", e => { if (e.detail === "home") { paintShelf(); statPins(); } else shelf.hidden = true; });
  // palette: pin a typed path, open pins
  palAdd((q, raw, out) => {
    const t = raw.trim().replace(/^["']|["']$/g, "");
    if (/^([a-zA-Z]:[\\/]|\\\\[^\\]+\\)/.test(t) && t.length > 3) {
      const p = t.replace(/\//g, "\\");
      out.push({ label: isPinned(p) ? `Unpin ${base(p)}` : `Pin ${base(p)} to Home`, path: p, fixed: 997, glyph: "📌", minor: true, run: () => togglePin(p) });
    }
    const ql = q.trim().toLowerCase();
    store.pins.filter(p => ql && p.name.toLowerCase().includes(ql)).slice(0, 3).forEach((p, i) =>
      out.push({ label: p.name, path: shortDir(p.path), head: "Pinned", fixed: 2.4 - i * .01, glyph: "📌", run: () => openPath(p.path), alt: () => window.qtRevealInBurrow && window.qtRevealInBurrow(p.path) }));
  });

  /* =========================================================================================
     11. FOCUS TIMER: a ring in the rail footer. Pick 5-60 min, it counts down, chimes and wiggles when done.
     ========================================================================================= */
  const TKEY = "qt-timer";
  let tm = lsGet(TKEY, null), tmT = 0, tmPop = null;
  const tb2 = document.createElement("button");
  tb2.className = "qt-btn ghost"; tb2.id = "timer-btn"; tb2.title = "Focus timer";
  tb2.innerHTML = `<i class="tmr"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5" class="tr"/><circle cx="12" cy="12" r="9.5" class="fg"/><path d="M12 7.5V12l3 2" class="hand"/></svg></i><span>Timer</span>`;
  if (rb) rb.insertBefore(tb2, rb.children[1] || null);
  const mmss = s => { s = Math.max(0, Math.ceil(s)); const m = Math.floor(s / 60); return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${m}:${String(s % 60).padStart(2, "0")}`; };
  function startTimer(min, label) {
    min = Math.max(1, Math.min(600, Math.round(+min || 25)));
    tm = { end: Date.now() + min * 60000, dur: min * 60000, label: label || "" };
    lsSet(TKEY, tm); closeTmPop(); tickTimer(); sfx("go");
    say(`Timer: ${min} min${label ? ` for ${label}` : ""}`, { icon: "suite" });
  }
  function stopTimer(silent) { tm = null; lsSet(TKEY, null); tickTimer(); if (!silent) sfx("tick"); }
  function tickTimer() {
    clearTimeout(tmT);
    const fg = tb2.querySelector(".fg"), lab = tb2.querySelector("span");
    tb2.classList.toggle("running", !!tm);
    if (!tm) { fg.style.strokeDashoffset = "59.7"; lab.textContent = "Timer"; tb2.title = "Focus timer"; document.title = document.title.replace(/^⏰ |^\d+:\d\d · /, ""); return; }
    const left = (tm.end - Date.now()) / 1000;
    if (left <= 0) return ring();
    fg.style.strokeDashoffset = String(59.7 * (1 - left * 1000 / tm.dur));
    lab.textContent = mmss(left);
    tb2.title = `${tm.label ? tm.label + ": " : ""}${mmss(left)} left. Click to change.`;
    tmT = setTimeout(tickTimer, 1000 - (Date.now() % 1000) + 5);
    if (tmPop) paintTmPop();
  }
  function ring() {
    const label = tm && tm.label;
    stopTimer(true);
    sfx("chime", true);
    tb2.classList.add("ringing"); setTimeout(() => tb2.classList.remove("ringing"), 3200);
    say(`⏰ Time's up${label ? `: ${label}` : ""}`, { ms: 12000, action: ["+5 min", () => startTimer(5, label)] });
    let n = 0; const base0 = document.title;
    const fl = setInterval(() => { document.title = n++ % 2 ? base0 : "⏰ Time's up"; if (n > 11 || document.hasFocus()) { clearInterval(fl); document.title = base0; } }, 700);
    try { if (document.hidden && Notification.permission === "granted") new Notification("Time's up", { body: label || "Your focus timer finished.", icon: "/icons/suite.svg" }); } catch (_) {}
  }
  function paintTmPop() {
    const left = tm ? (tm.end - Date.now()) / 1000 : 0;
    tmPop.innerHTML = tm ? `<div class="qt-eyebrow">${esc(tm.label || "Focus")}</div><div class="tm-big qt-display">${mmss(left)}</div>
        <div class="tm-row"><button class="qt-btn" data-t="+5">+5 min</button><button class="qt-btn" data-t="stop">■ Stop</button></div>`
      : `<div class="qt-eyebrow">Focus timer</div><div class="tm-row tm-presets">${[5, 15, 25, 45, 60].map((m, i) => `<button class="qt-btn${m === 25 ? " primary" : ""}" data-m="${m}" style="--i:${i}">${m}<small>min</small></button>`).join("")}</div>
        <label class="tm-own"><input class="qt-input" type="number" min="1" max="600" placeholder="min" aria-label="Minutes"><input class="qt-input" placeholder="What for? (optional)" aria-label="Label"><button class="qt-btn primary" data-t="go">▶</button></label>`;
  }
  function closeTmPop() { if (!tmPop) return; const p = tmPop; tmPop = null; p.classList.add("out"); setTimeout(() => p.remove(), 200); }
  tb2.onclick = () => {
    if (tmPop) return closeTmPop();
    tmPop = document.createElement("div");
    tmPop.className = "tm-pop qt-card"; tmPop.setAttribute("role", "dialog"); tmPop.setAttribute("aria-label", "Focus timer");
    paintTmPop();
    const r = tb2.getBoundingClientRect();
    tmPop.style.left = Math.max(10, Math.min(innerWidth - 330, r.left)) + "px";
    tmPop.style.bottom = (innerHeight - r.top + 10) + "px";
    document.body.append(tmPop);
    tmPop.addEventListener("click", e => {
      const b = e.target.closest("[data-m],[data-t]"); if (!b) return;
      if (b.dataset.m) return startTimer(+b.dataset.m);
      if (b.dataset.t === "stop") { stopTimer(); return closeTmPop(); }
      if (b.dataset.t === "+5" && tm) { tm.end += 300000; tm.dur += 300000; lsSet(TKEY, tm); tickTimer(); paintTmPop(); }
      if (b.dataset.t === "go") { const [m, l] = tmPop.querySelectorAll("input"); if (+m.value > 0) startTimer(+m.value, l.value.trim()); else m.focus(); }
    });
    tmPop.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.tagName === "INPUT") tmPop.querySelector('[data-t="go"]').click(); });
    try { if (Notification.permission === "default") Notification.requestPermission(); } catch (_) {}
  };
  document.addEventListener("pointerdown", e => { if (tmPop && !e.target.closest(".tm-pop, #timer-btn")) closeTmPop(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && tmPop) closeTmPop(); });
  addEventListener("storage", e => { if (e.key === TKEY) { tm = lsGet(TKEY, null); tickTimer(); } });
  tickTimer();
  palAdd((q, raw, out) => {
    const m = /^(?:timer|focus)\s+(\d{1,3})\s*(?:m|min|mins|minutes)?\s*(.*)$/i.exec(raw.trim());
    if (m) out.push({ label: `Start a ${m[1]} min timer${m[2] ? ` for ${m[2]}` : ""}`, fixed: 1150, glyph: "⏱", run: () => startTimer(+m[1], m[2]) });
    out.push({ label: tm ? `Timer: ${mmss((tm.end - Date.now()) / 1000)} left (stop)` : "Focus timer (25 min)", words: "timer focus pomodoro countdown alarm", glyph: "⏱", minor: true,
      run: () => tm ? stopTimer() : startTimer(25) });
  });
  window.qtTimer = { start: startTimer, stop: stopTimer, get: () => tm };

  /* =========================================================================================
     12. TOASTS that can carry a button (Undo, Open, +5 min), pause on hover, click to dismiss, and a history in Activity
     ========================================================================================= */
  const TLOG = [];
  const plainToast = toast;
  function qtToast(msg, o) {
    if (typeof o === "boolean") o = { bad: o };
    o = o || {};
    TLOG.unshift({ msg: String(msg), bad: !!o.bad, t: Date.now() / 1000, icon: o.icon || "" }); TLOG.length = Math.min(TLOG.length, 40);
    sfx(o.bad ? "bad" : "note");
    const box = document.getElementById("toasts");
    if (!box) return plainToast(msg, o.bad);
    const t = document.createElement("div");
    t.className = "qt-toast" + (o.bad ? " bad" : "") + (o.action ? " act" : "");
    t.setAttribute("role", o.bad ? "alert" : "status");
    t.innerHTML = `${o.icon ? `<img src="/icons/${esc(o.icon)}.svg" alt="">` : ""}<span>${esc(msg)}</span>${o.action ? `<button class="qt-btn">${esc(o.action[0])}</button>` : ""}<i class="tt-bar"></i>`;
    box.append(t);
    while (box.children.length > 4) box.firstElementChild.remove();
    const ms = o.ms || (o.action ? 6000 : 2600);
    t.style.setProperty("--ms", ms + "ms");
    let left = ms, t0 = Date.now(), timer;
    const go = () => { t0 = Date.now(); timer = setTimeout(out, left); t.classList.remove("held"); };
    const out = () => { clearTimeout(timer); if (t.classList.contains("out")) return; t.classList.add("out"); setTimeout(() => t.remove(), 320); };
    t.addEventListener("mouseenter", () => { clearTimeout(timer); left -= Date.now() - t0; t.classList.add("held"); });
    t.addEventListener("mouseleave", go);
    t.addEventListener("click", e => {
      if (o.action && e.target.closest("button")) { try { o.action[1](); } catch (er) { console.warn(er); } }
      out();
    });
    // swipe right to throw it away
    let sx = null;
    t.addEventListener("pointerdown", e => { if (!e.target.closest("button")) sx = e.clientX; });
    t.addEventListener("pointermove", e => {
      if (sx == null) return;
      const dx = Math.max(0, e.clientX - sx);
      if (dx > 6 && !t.hasPointerCapture(e.pointerId)) t.setPointerCapture(e.pointerId);   // only a real drag takes the pointer
      t.style.transform = `translateX(${dx}px) rotate(${dx / 30}deg)`; t.style.opacity = String(1 - dx / 300);
    });
    t.addEventListener("pointerup", e => { if (sx == null) return; const dx = e.clientX - sx; sx = null; if (dx > 80) out(); else { t.style.transform = ""; t.style.opacity = ""; } });
    go();
    return t;
  }
  window.qtToast = qtToast;
  toast = (msg, bad) => qtToast(msg, { bad: !!bad });   // every older toast() call gets history + hover-to-hold too
  // history: a "Messages" list under the Activity drawer
  new MutationObserver(() => {
    const d = document.querySelector(".act-drawer");
    if (!d || d.querySelector(".tl-list") || !TLOG.length) return;
    const sec = document.createElement("div");
    sec.className = "tl-sec";
    sec.innerHTML = `<div class="qt-eyebrow">Messages</div><div class="tl-list">${TLOG.slice(0, 12).map((x, i) => `<div class="tl-row${x.bad ? " bad" : ""}" style="--i:${i}">${x.icon ? `<img src="/icons/${esc(x.icon)}.svg" alt="">` : "<b>•</b>"}<span>${esc(x.msg)}</span><time>${ago(x.t)}</time></div>`).join("")}</div>`;
    d.insertBefore(sec, d.querySelector(".act-foot"));
  }).observe(document.body, { childList: true });

  /* =========================================================================================
     13. SETTINGS: an Extras box (meter, sounds, list view, clock) and Backup (export / import everything as one file)
     ========================================================================================= */
  const EXTRA = [
    ["qt-sysm", true, "CPU and memory on Home", "The live meter next to the numbers at the top."],
    ["qt-clock", true, "Clock on Home", "A ticking clock with the date in the greeting."],
    ["qt-hover", true, "Rail hover cards", "Rest the pointer on a tool in the rail to see how it's doing."],
    ["qt-sfx", false, "Sounds", "Soft clicks and pops when you press things, and a chime for the timer."],
  ];
  function extrasBox() {
    return `<section class="sbox qt-card sx-box" style="--i:3.5" id="sx-extras"><h2>Extras</h2>
      ${EXTRA.map(([k, d, label, sub]) => `<div class="sline"><span><b>${esc(label)}</b><em>${esc(sub)}</em></span><button class="qt-switch" role="switch" aria-checked="${!!lsGet(k, d)}" data-sx="${k}" aria-label="${esc(label)}"></button></div>`).join("")}
      <div class="sline"><span><b>Home layout</b><em>Big tiles, or a tight list that fits everything on one screen.</em></span>
        <div class="sx-seg" role="radiogroup">${[["tiles", "▦ Tiles"], ["list", "☰ List"]].map(([v, l]) => `<button role="radio" data-hv="${v}" aria-checked="${homeView() === v}">${l}</button>`).join("")}</div></div>
    </section>
    <section class="sbox qt-card sx-box" style="--i:3.6" id="sx-backup"><h2>Backup</h2>
      <div class="sline"><span><b>Everything in one file</b><em>Rail order, hidden tools, startup set, notes, pins, recent files, timer and where your videos were up to.</em></span></div>
      <div class="sline sdef-btns"><button class="qt-btn primary" data-bk="export">⇩ Save a backup</button><button class="qt-btn" data-bk="import">⇧ Load a backup</button>
        <input type="file" accept=".json,application/json" hidden data-bk-file></div>
    </section>`;
  }
  const LKEYS = ["qt-peek-recent", "qt-play-pos", "qt-sysm", "qt-clock", "qt-hover", "qt-sfx", "qt-homeview", "qt-peek-fs", "qt-peek-wrap", "qt-play-next", "qt-pk-info", "qt-mru"];
  async function exportAll() {
    const [s, st] = await Promise.all([api("/api/settings"), api("/api/spark/store")]);
    const local = {}; LKEYS.concat(window.qtBackupExtra ? window.qtBackupExtra.keys : []).forEach(k => { const v = localStorage.getItem(k); if (v != null) local[k] = v; });
    const nova = window.qtBackupExtra ? await window.qtBackupExtra.get().catch(() => null) : null;   // to-dos + reminders (nova.js)
    const blob = new Blob([JSON.stringify({ app: "QT Suite", v: 1, at: new Date().toISOString(), settings: s.settings, store: st, local, nova }, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `qt-suite-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    say("Backup saved to your Downloads", { icon: "suite" }); sfx("done");
  }
  async function importAll(file) {
    let d;
    try { d = JSON.parse(await file.text()); } catch (_) { return say("That file isn't a QT backup", { bad: true }); }
    if (!d || d.app !== "QT Suite") return say("That file isn't a QT backup", { bad: true });
    const before = { settings: (await api("/api/settings")).settings, store: JSON.parse(JSON.stringify(store)) };
    try {
      if (d.settings) { const { last, ...rest } = d.settings; await post("/api/settings", rest); }
      if (d.store) { store = await post("/api/spark/store", { notes: d.store.notes || [], pins: d.store.pins || [] }); document.dispatchEvent(new CustomEvent("qt-store")); }
      const xk = window.qtBackupExtra ? window.qtBackupExtra.keys : [];
      Object.entries(d.local || {}).forEach(([k, v]) => { if ((LKEYS.includes(k) || xk.includes(k)) && typeof v === "string") localStorage.setItem(k, v); });
      if (d.nova && window.qtBackupExtra) await window.qtBackupExtra.set(d.nova);
    } catch (e) { return say("Loading stopped: " + e.message, { bad: true }); }
    say(`Loaded the backup from ${String(d.at || "").slice(0, 10) || "a file"}`, { ms: 9000, action: ["Undo", async () => {
      const { last, ...rest } = before.settings; await post("/api/settings", rest);
      store = await post("/api/spark/store", before.store); document.dispatchEvent(new CustomEvent("qt-store")); setTimeout(() => location.reload(), 300);
    }] });
    setTimeout(() => location.reload(), 1800);
  }
  function addSettingsBoxes() {
    const set = document.querySelector(".view.settings");
    const keys = set && set.querySelector(".sbox.keys");
    if (!keys || set.querySelector("#sx-extras")) return;
    keys.insertAdjacentHTML("beforebegin", extrasBox());
  }
  new MutationObserver(addSettingsBoxes).observe(document.getElementById("frames"), { childList: true, subtree: true });
  document.addEventListener("click", e => {
    const s = e.target.closest("[data-sx]");
    if (s) {
      const on = s.getAttribute("aria-checked") !== "true";
      s.setAttribute("aria-checked", on); lsSet(s.dataset.sx, on);
      document.dispatchEvent(new CustomEvent("qt-extras", { detail: s.dataset.sx }));
      if (s.dataset.sx === "qt-sfx" && on) sfx("pop", true);
      return;
    }
    const hv = e.target.closest("[data-hv]");
    if (hv) { hv.parentElement.querySelectorAll("[data-hv]").forEach(b => b.setAttribute("aria-checked", b === hv)); return setHomeView(hv.dataset.hv); }
    const bk = e.target.closest("[data-bk]");
    if (bk && bk.dataset.bk === "export") return exportAll().catch(er => say(er.message, { bad: true }));
    if (bk && bk.dataset.bk === "import") return bk.parentElement.querySelector("[data-bk-file]").click();
  });
  document.addEventListener("change", e => { if (e.target.matches("[data-bk-file]") && e.target.files[0]) { importAll(e.target.files[0]); e.target.value = ""; } });
  document.addEventListener("qt-extras", e => { if (e.detail === "qt-sysm") sysVis(); });

  /* =========================================================================================
     14. HOME LIST VIEW: the same tiles folded into tight rows (toggle on home or in Settings), FLIP between the two
     ========================================================================================= */
  const tilesEl = document.getElementById("tiles");
  function homeView() { return lsGet("qt-homeview", "tiles"); }
  function setHomeView(v, quiet) {
    const items = [...tilesEl.children];
    const first = new Map(items.map(x => [x, x.getBoundingClientRect()]));
    lsSet("qt-homeview", v);
    tilesEl.classList.toggle("as-list", v === "list");
    document.querySelectorAll("[data-hvb]").forEach(b => b.setAttribute("aria-pressed", b.dataset.hvb === v));
    if (quiet || RM.matches || current !== "home") return;
    sfx("tick");
    items.forEach((x, i) => {
      const a = first.get(x), b = x.getBoundingClientRect();
      if (!a.width || !b.width) return;
      anim(x, [{ transform: `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${a.width / b.width}, ${a.height / b.height})`, transformOrigin: "0 0" }, { transform: "none", transformOrigin: "0 0" }],
        { duration: 420, delay: Math.min(i, 12) * 14, easing: "cubic-bezier(.2,.9,.2,1)" });
    });
  }
  const hvt = document.createElement("div");
  hvt.className = "hv-toggle"; hvt.setAttribute("role", "group"); hvt.setAttribute("aria-label", "Home layout");
  hvt.innerHTML = `<button class="qt-btn ghost icon" data-hvb="tiles" title="Tiles" aria-label="Tiles">▦</button><button class="qt-btn ghost icon" data-hvb="list" title="List" aria-label="List">☰</button>`;
  hvt.onclick = e => { const b = e.target.closest("[data-hvb]"); if (b && homeView() !== b.dataset.hvb) setHomeView(b.dataset.hvb); };
  (function placeHv() { const acts = home.querySelector(".hero-acts"); if (!acts) return setTimeout(placeHv, 120); acts.append(hvt); })();
  setHomeView(homeView(), true);

  /* =========================================================================================
     15. SOUNDS (off until switched on in Settings): tiny synth blips, no files
     ========================================================================================= */
  let ac = null;
  const SFX = {   // [freq start, freq end, length s, wave, volume]
    tick: [[1400, 900, .035, "square", .035]], pop: [[520, 980, .07, "sine", .14]], note: [[700, 900, .06, "triangle", .07]],
    go: [[440, 660, .08, "triangle", .1], [660, 990, .09, "triangle", .1, .07]], done: [[660, 660, .08, "triangle", .1], [990, 990, .14, "triangle", .1, .09]],
    bad: [[300, 180, .16, "sawtooth", .06]], whoosh: [[300, 1600, .18, "sine", .06]], open: [[380, 620, .1, "sine", .08]],
    chime: [[880, 880, .5, "sine", .2], [1175, 1175, .5, "sine", .16, .18], [1568, 1568, .9, "sine", .14, .36], [880, 880, .5, "sine", .18, 1.2], [1175, 1175, .5, "sine", .14, 1.38], [1568, 1568, 1, "sine", .12, 1.56]],
  };
  window.qtSfx = (k, force) => {
    if (!force && !lsGet("qt-sfx", false)) return;
    const parts = SFX[k]; if (!parts) return;
    try {
      ac = ac || new AudioContext();
      if (ac.state === "suspended") ac.resume();
      const t0 = ac.currentTime + .01;
      for (const [f0, f1, len, type, vol, at = 0] of parts) {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = type; o.frequency.setValueAtTime(f0, t0 + at); o.frequency.exponentialRampToValueAtTime(f1, t0 + at + len);
        g.gain.setValueAtTime(0, t0 + at); g.gain.linearRampToValueAtTime(vol, t0 + at + .008); g.gain.exponentialRampToValueAtTime(.0001, t0 + at + len);
        o.connect(g).connect(ac.destination); o.start(t0 + at); o.stop(t0 + at + len + .02);
      }
    } catch (_) {}
  };
  document.addEventListener("pointerdown", e => {
    if (!lsGet("qt-sfx", false) || e.button) return;
    if (e.target.closest(".qt-switch")) sfx("pop");
    else if (e.target.closest(".qt-btn, .nav, .tile, .pal-item, .sh-item, .rf-card, .gcard, .tq")) sfx("tick");
  }, true);

  /* =========================================================================================
     16. FLIP CLOCK in the greeting: day, date and a ticking HH:MM whose digits flip over
     ========================================================================================= */
  const greetEl = document.getElementById("greet");
  const clk = document.createElement("span");
  clk.className = "hclock qt-mono"; clk.setAttribute("aria-hidden", "true");
  greetEl.after(clk);
  function paintClock() {
    const on = lsGet("qt-clock", true);
    clk.hidden = !on;
    if (!on) return;
    const d = new Date();
    const date = d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
    const hm = d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
    if (!clk.firstChild) clk.innerHTML = `<span class="hc-date"></span><span class="hc-time"></span>`;
    const dt = clk.querySelector(".hc-date"); if (dt.textContent !== date) dt.textContent = date;
    const tEl = clk.querySelector(".hc-time");
    if (tEl.childElementCount !== hm.length) tEl.innerHTML = [...hm].map(ch => `<b class="${/\d/.test(ch) ? "fd" : "fs"}">${ch}</b>`).join("");
    [...hm].forEach((ch, i) => {
      const b = tEl.children[i];
      if (b.textContent === ch) return;
      b.textContent = ch;
      anim(b, [{ transform: "rotateX(90deg) translateY(-4px)", opacity: .2 }, { transform: "rotateX(-15deg)", opacity: 1, offset: .7 }, { transform: "none" }], { duration: 420, easing: "cubic-bezier(.2,.9,.2,1)" });
    });
    if (typeof greet === "function") greet();
  }
  paintClock();
  setInterval(paintClock, 1000 * 5);
  document.addEventListener("qt-extras", e => { if (e.detail === "qt-clock") paintClock(); });

  /* =========================================================================================
     17. RAIL HOVER CARDS: rest on a tool in the rail -> status, uptime, memory and quick buttons
     ========================================================================================= */
  let hc = null, hcT = 0, hcOut = 0, procCache = { at: 0, d: {} };
  const railNav = document.getElementById("nav");
  async function procs() {
    if (Date.now() - procCache.at > 4000) { try { procCache = { at: Date.now(), d: await api("/api/procs") }; } catch (_) {} }
    return procCache.d;
  }
  const upTxt = s => s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h ${Math.floor(s % 3600 / 60)}m` : `${Math.floor(s / 86400)}d ${Math.floor(s % 86400 / 3600)}h`;
  function hideHc(now) {
    clearTimeout(hcT); clearTimeout(hcOut);
    const go = () => { if (!hc) return; const h = hc; hc = null; h.classList.add("out"); setTimeout(() => h.remove(), 180); };
    now ? go() : (hcOut = setTimeout(go, 160));
  }
  async function showHc(btn) {
    const t = byId(btn.dataset.go); if (!t) return;
    const p = (await procs())[t.id];
    if (!btn.matches(":hover")) return;
    const idx = tools.indexOf(t) + 1;
    const acts = (window.qtActionsFor ? window.qtActionsFor(t) : []).filter(([k]) => ["start", "restart", "pop", "stop"].includes(k)).slice(0, 3);
    const run = t.status === "on";
    const stat = t.kind === "web" ? (run ? "Running" : "Stopped") : t.kind === "file" ? "Ready" : t.kind === "folder" ? `${(t.files || []).length} files` : run ? "Running" : "Ready";
    hideHc(true);
    hc = document.createElement("div");
    hc.className = "hc qt-card"; hc.dataset.tool = t.id; hc.setAttribute("role", "tooltip");
    hc.innerHTML = `<div class="hc-top"><img src="/icons/${t.id}.svg" alt=""><div><b>${esc(t.name)}</b><small>${esc(t.tag || "")}</small></div>${idx <= 9 ? `<kbd>Ctrl ${idx}</kbd>` : ""}</div>
      <div class="hc-stats"><span class="qt-chip"><span class="qt-dot ${dotClass(t)}"></span>${stat}</span>${p ? `<span class="qt-mono">up ${upTxt(p.up)}</span><span class="qt-mono">${human(p.mem)}</span>` : t.port ? `<span class="qt-mono">port ${t.port}</span>` : ""}</div>
      <p>${esc(t.blurb || "")}</p>
      <div class="hc-acts"><button class="qt-btn primary" data-hc="open">${t.kind === "web" && !run ? "Start + open" : "Open"}</button>
        ${current !== "home" && current !== t.id && !PHONE.matches ? `<button class="qt-btn" data-hc="split" title="Open beside ${esc((byId(current) || {}).name || "")}">▥ Beside</button>` : ""}
        ${acts.map(([k, l]) => `<button class="qt-btn ghost icon" data-hc="${k}" title="${esc(l)}">${{ start: "▶", restart: "⟲", pop: "⧉", stop: "■" }[k]}</button>`).join("")}</div>`;
    document.body.append(hc);
    const r = btn.getBoundingClientRect(), h = hc.offsetHeight;
    hc.style.left = (r.right + 12) + "px";
    hc.style.top = Math.max(10, Math.min(innerHeight - h - 10, r.top + r.height / 2 - 34)) + "px";
    hc.style.setProperty("--ay", (r.top + r.height / 2 - parseFloat(hc.style.top)) + "px");
    hc.addEventListener("mouseenter", () => clearTimeout(hcOut));
    hc.addEventListener("mouseleave", () => hideHc());
    hc.addEventListener("click", e => {
      const b = e.target.closest("[data-hc]"); if (!b) return;
      const k = b.dataset.hc; hideHc(true);
      if (k === "open") return show(t.id);
      if (k === "split") return window.qtAct ? window.qtAct("split", t) : show(t.id);
      window.qtToolAct && window.qtToolAct(k, t);
    });
  }
  railNav.addEventListener("pointerover", e => {
    if (e.pointerType !== "mouse" || !lsGet("qt-hover", true) || PHONE.matches) return;
    const btn = e.target.closest(".nav[data-go]");
    if (!btn || !byId(btn.dataset.go) || (hc && hc.dataset.tool === btn.dataset.go)) return;
    clearTimeout(hcT); clearTimeout(hcOut);
    hcT = setTimeout(() => showHc(btn), hc ? 60 : 520);   // once a card is up, moving down the rail swaps quickly
  });
  railNav.addEventListener("pointerleave", () => { clearTimeout(hcT); hideHc(); });
  railNav.addEventListener("pointerdown", () => hideHc(true));
  railNav.addEventListener("scroll", () => hideHc(true), { passive: true });
  document.addEventListener("qt-show", () => hideHc(true));

  /* =========================================================================================
     18. NEW IN DOWNLOADS (right half of the shelf): the newest things in Downloads, peek / pin / phone in one click
     ========================================================================================= */
  const dlCol = shelf.querySelector(".sh-dl"), dlList = shelf.querySelector('[data-list="dl"]');
  let dl = { dir: "", files: [] }, dlT = 0;
  async function pollDl() {
    clearTimeout(dlT);
    if (current !== "home" || document.hidden) return;
    try { dl = await api("/api/spark/downloads"); } catch (_) { dl = { files: [] }; }
    paintDl();
    dlT = setTimeout(pollDl, 30000);
  }
  function paintDl() {
    const list = (dl.files || []).slice(0, 6);
    dlCol.hidden = !list.length || !lsGet("qt-dl", true);
    paintVis();
    const sig = list.map(f => f.path + f.m).join("|");
    if (dlList.dataset.sig === sig) return;
    const old = new Set((dlList.dataset.sig || "").split("|"));
    dlList.dataset.sig = sig;
    const now = Date.now() / 1000;
    dlList.innerHTML = list.map((f, i) => {
      const k = window.qtPeekKind ? window.qtPeekKind(f.name) : "", pic = !f.isdir && (k === "image" || k === "picture") && f.s < 40e6;
      return `<button class="sh-item${old.size > 1 && !old.has(f.path + f.m) ? " fresh" : ""}" data-path="${esc(f.path)}" data-dir="${f.isdir ? 1 : 0}" style="--i:${i}" title="${esc(f.path)}">
        <span class="sh-ic">${pic ? `<img loading="lazy" alt="" src="/api/peek/render?s=96&path=${encodeURIComponent(f.path)}" onerror="this.replaceWith('🖼')">` : pinIcon(f.name, f.isdir)}</span>
        <span class="sh-nm"><b>${esc(f.name)}</b><small>${f.isdir ? "folder" : human(f.s)} · ${ago(f.m)}</small></span>
        ${now - f.m < 600 ? '<em class="sh-new">NEW</em>' : ""}
        <span class="sh-q"><i role="button" tabindex="-1" data-dq="pin" title="Pin to Home">📌</i>${f.isdir ? "" : '<i role="button" tabindex="-1" data-dq="phone" title="Send to phone">📱</i>'}</span></button>`;
    }).join("");
  }
  dlList.addEventListener("click", async e => {
    const it = e.target.closest(".sh-item"); if (!it) return;
    const path = it.dataset.path, q = e.target.closest("[data-dq]");
    if (q) {
      e.stopPropagation();
      if (q.dataset.dq === "pin") return togglePin(path);
      q.classList.add("fly");
      try { const r = await post("/api/peek/beam", { path }); say(r.msg || "Sent", { icon: "beam" }); sfx("whoosh"); } catch (er) { say(er.message, { bad: true }); }
      return setTimeout(() => q.classList.remove("fly"), 700);
    }
    if (it.dataset.dir === "1") return window.qtRevealInBurrow && window.qtRevealInBurrow(path, true);
    const r = it.getBoundingClientRect();
    window.qtPeek && window.qtPeek(path, { from: { x: r.left + r.width / 2, y: r.top + r.height / 2 }, list: (dl.files || []).filter(f => !f.isdir).map(f => f.path) });
  });
  dlList.addEventListener("contextmenu", e => { const it = e.target.closest(".sh-item"); if (!it) return; e.preventDefault(); window.qtRevealInBurrow && window.qtRevealInBurrow(it.dataset.path); });
  shelf.querySelector('[data-sh="dlall"]').onclick = () => dl.dir && window.qtRevealInBurrow && window.qtRevealInBurrow(dl.dir, true);
  document.addEventListener("qt-show", e => { if (e.detail === "home") pollDl(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && current === "home") pollDl(); });
  EXTRA.splice(1, 0, ["qt-dl", true, "New in Downloads on Home", "Your newest downloads beside your pins, with peek, pin and send to phone."]);
  document.addEventListener("qt-extras", e => { if (e.detail === "qt-dl") paintDl(); });
  pollDl();

  /* =========================================================================================
     19. SHORTCUTS + WHAT'S NEW: the ? sheet learns the new keys; a one-time card on Home lists this round's features
     ========================================================================================= */
  if (window.qtKeys) window.qtKeys.push(["Ctrl", "J"], "Notes", ["Ctrl", "V"], "Paste a link: download it or send it to the phone", ["Ctrl", "F"], "In Code: find (Enter steps)", ["Ctrl", "G"], "In Code: go to a line",
    ["S"], "In Pictures: slideshow (Space pauses)", ["I"], "In Pictures: photo facts", ["P"], "In a viewer: pin the file to Home", ["U"], "In Archive: unpack", ["J", "L"], "In Player: back or ahead 10 seconds", ["M"], "In Player: mute");
  const NEW = [
    ["=", "Sums in Ctrl+K", "Type 18% of 2400, 5 km in mi or 72 f to c. Enter copies the answer.", () => { window.qtPalOpen(); const i = palInput(); i.value = "18% of 2400"; i.dispatchEvent(new Event("input")); }],
    ["⇩", "Paste a link", "Ctrl+V a link on Home: download it with VOLT or send it to your phone.", null],
    ["✎", "Notes", "Ctrl+J opens a scratchpad that saves itself. One tap sends a note to your phone.", () => openNotes()],
    ["⏱", "Focus timer", "The clock in the rail footer. It chimes and wiggles when time's up.", () => tb2.click()],
    ["📌", "Pins + new downloads", "Pin files and folders from any viewer (P). Your newest downloads sit beside them.", null],
    ["▶", "Viewer upgrades", "Videos pick up where you stopped, Code finds with Ctrl+F, zips unpack, photos run as a slideshow.", null],
    ["☰", "List view", "The ☰ button next to Stop all folds the tiles into rows.", () => setHomeView("list")],
    ["⚙", "Extras + backup", "Settings has switches for the new bits, sounds, and one-file backup.", () => show("settings")],
  ];
  function whatsNew(force) {
    if (!force && lsGet("qt-new-v4", false)) return;
    if (document.querySelector(".wn")) return;
    const c = document.createElement("section");
    c.className = "wn qt-card"; c.setAttribute("aria-label", "What's new");
    c.innerHTML = `<div class="wn-head"><span class="wn-tag">NEW</span><h2 class="qt-display">Fresh in the suite</h2><button class="qt-btn ghost icon" data-wn="x" aria-label="Got it" title="Got it">✕</button></div>
      <div class="wn-grid">${NEW.map(([ic, t, d, f], i) => `<button class="wn-item" data-wn="${i}" style="--i:${i}" ${f ? "" : 'data-static="1"'}><i>${ic}</i><b>${esc(t)}</b><small>${esc(d)}</small>${f ? "<em>Try it →</em>" : ""}</button>`).join("")}</div>`;
    hero.after(c);
    c.addEventListener("click", e => {
      const b = e.target.closest("[data-wn]"); if (!b) return;
      if (b.dataset.wn === "x") {
        lsSet("qt-new-v4", true);
        const a = anim(c, [{ transform: "none", opacity: 1, height: c.offsetHeight + "px" }, { transform: "scale(.96) translateY(-10px)", opacity: 0, height: "0px", marginBottom: "-22px" }], { duration: 360, easing: "cubic-bezier(.5,0,.75,0)", fill: "forwards" });
        return a ? a.finished.then(() => c.remove(), () => c.remove()) : c.remove();
      }
      const f = NEW[+b.dataset.wn][3]; if (f) f();
    });
  }
  palAdd((q, raw, out) => out.push({ label: "What's new in the suite", words: "new whats changelog features help tour", glyph: "✨", minor: true, run: () => { show("home"); setTimeout(() => whatsNew(true), 200); } }));
  setTimeout(() => { if (current === "home") whatsNew(); }, 900);
})();
