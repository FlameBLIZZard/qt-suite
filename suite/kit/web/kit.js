/* QT Suite Toolkit layer (loaded LAST). 32 features in one "Toolkit" view (#kit), panels load on demand.
   Server half: suite/kit/*.py (/api/kit/*), phone pages served by kit/phone.py on :7804 (party + shares on :7803).
   Hooks used: window.qtViews, show(), window.qtPalExtra, window.qtToast. Own CSS: /kit/kit.css. */
(() => {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s), $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const say = (m, o) => (window.qtToast ? window.qtToast(m, o) : console.log(m));
  async function api(path, body) {
    const r = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    let j = {}; try { j = await r.json(); } catch {}
    if (!r.ok) throw new Error(j.msg || j.error || r.statusText);
    return j;
  }
  let qrP = null;
  const qrLib = () => qrP || (qrP = new Promise((res, rej) => { if (window.qrcode) return res(); const s = document.createElement("script"); s.src = "/qrcode.js"; s.onload = res; s.onerror = rej; document.head.append(s); }));
  async function qrSvg(text, cell = 4) {
    await qrLib();
    if (qrcode.stringToBytesFuncs && qrcode.stringToBytesFuncs["UTF-8"]) qrcode.stringToBytes = qrcode.stringToBytesFuncs["UTF-8"];
    const q = qrcode(0, "M"); q.addData(text); q.make();
    return q.createSvgTag(cell, 2);
  }
  const ago = t => { const s = Math.max(0, Date.now() / 1000 - t); return s < 60 ? "just now" : s < 3600 ? Math.round(s / 60) + " min ago" : s < 86400 ? Math.round(s / 3600) + " h ago" : Math.round(s / 86400) + " d ago"; };
  const money = (n, cur = "₹") => cur + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });

  /* ------------------------------------------------------------------ feature list ---- */
  const G = { phone: "Phone", money: "Money", care: "PC care", desk: "Desktop", media: "Media", games: "Games", meta: "Power tools" };
  const F = [
    ["cam", "phone", "Phone webcam + mic", "🎥", "Use your phone's camera as a webcam and its mic as a PC mic.", "phone"],
    ["find", "phone", "Find my phone", "📍", "Ring it, see where it is, lock it.", "phone"],
    ["clips", "phone", "Clipboard stack", "📋", "Send text from the phone, paste it on the PC one by one.", "phone"],
    ["deck", "phone", "Stream deck", "🎛", "Your phone as a grid of buttons that run things on the PC.", "phone"],
    ["mirror", "phone", "Phone mirror", "📱", "See and control the phone on the PC (scrcpy).", "phone"],
    ["party", "phone", "Party mode", "🎉", "Friends scan a QR and their phones become buzzers and pads.", "games"],
    ["arcade", "games", "Mini arcade", "🕹", "Small games for the big screen, phones as controllers.", "games"],
    ["kharcha", "money", "Kharcha on Home", "💸", "This month's spending as a card on Home.", "money"],
    ["subs", "money", "Subscriptions", "🔁", "Spots repeat payments in Kharcha and shows what's due.", "money"],
    ["splits", "money", "Bill splits", "🧾", "Split a bill and send each friend a UPI pay link.", "money"],
    ["cleaner", "care", "Auto-cleaner", "🧹", "Clears temp files, caches and old downloads.", "care"],
    ["backup", "care", "Scheduled backup", "🛡", "Zips or copies your folders on a schedule.", "care"],
    ["focus", "care", "Focus mode", "🎯", "Timer that closes distracting apps and quiets alerts.", "care"],
    ["startup", "care", "Startup report", "⏱", "How long your PC takes to start, and what slows it.", "care"],
    ["tm", "care", "Folder time machine", "⌛", "Keeps every version of a folder. Restore any file.", "care"],
    ["zones", "desk", "Snap zones", "🧱", "Layouts and hotkeys to throw windows into place.", "desk"],
    ["widgets", "desk", "Desktop widgets", "🧷", "Small always-on-top cards: clock, CPU, Kharcha, music.", "desk"],
    ["wall", "desk", "Live wallpaper", "🌊", "Animated scenes or your own video behind the icons.", "desk"],
    ["skins", "desk", "Skins + sounds", "🎨", "Palettes and click sounds for the Suite.", "desk"],
    ["recorder", "media", "Screen recorder", "⏺", "Record with a webcam bubble, trim, export GIFs.", "media"],
    ["photos", "media", "Batch photos", "🖼", "Resize, convert and rename lots of pictures.", "media"],
    ["music", "media", "Music player", "🎵", "Your songs with synced lyrics, a visualizer and a mini player.", "media"],
    ["games", "games", "Game launcher", "🎮", "Playtime, game mode and an FPS overlay.", "games"],
    ["deals", "games", "Steam + Epic deals", "🏷", "Sales in rupees and this week's free games.", "games"],
    ["search", "meta", "Universal search", "🔎", "One box for Kharcha, music, clips, games, notes...", "meta"],
    ["hotkeys", "meta", "Hotkeys", "⌨", "Any action on any key combo, anywhere in Windows.", "meta"],
    ["macros", "meta", "Macros", "🤖", "Chains of steps: open, type, press, wait, click.", "meta"],
    ["plugins", "meta", "Plugin folder", "🧩", "Drop a folder in, get a new tool.", "meta"],
    ["updates", "meta", "Auto-update", "⬆", "Checks GitHub for new versions.", "meta"],
    ["shares", "meta", "Share links", "🔗", "Temporary download links over Tailscale or Wi-Fi.", "meta"],
    ["xp", "meta", "Achievements + XP", "🏆", "Levels and badges for using your tools.", "meta"],
    ["streak", "meta", "Streak calendar", "🔥", "Every day you used the Suite, on one calendar.", "meta"],
  ];
  const byF = Object.fromEntries(F.map(f => [f[0], { id: f[0], group: f[1], name: f[2], icon: f[3], blurb: f[4], file: f[5] }]));
  const PANELS = {}, loaded = {};
  const KIT = window.qtKit = { api, esc, say, qrSvg, ago, money, $, $$, F: byF, panel: (id, p) => { PANELS[id] = p; }, open: id => show(id ? "kit/" + id : "kit"), refreshHome: () => homeCards() };

  function loadFile(name) {
    return loaded[name] || (loaded[name] = new Promise((res, rej) => {
      const s = document.createElement("script"); s.src = `/kit/p-${name}.js?v=${Date.now() % 1e6}`; s.onload = res; s.onerror = () => { loaded[name] = null; rej(new Error("couldn't load " + name)); };
      document.head.append(s);
    }));
  }

  /* ----------------------------------------------------------------------- view ---- */
  window.qtViews = Object.assign(window.qtViews || {}, { kit: true });
  F.forEach(f => { window.qtViews["kit/" + f[0]] = true; });
  let el = null, cur = null, cleanup = null;
  function ensure() {
    if (el) return;
    el = frames.kit = document.createElement("section");
    el.className = "view panel kit-view qt-dots"; el.dataset.tool = "home"; el.hidden = true;
    document.getElementById("frames").append(el);
    el.addEventListener("click", e => {
      const c = e.target.closest("[data-kf]");
      if (c) { e.preventDefault(); show("kit/" + c.dataset.kf); }
      if (e.target.closest("[data-kback]")) { e.preventDefault(); show("kit"); }
    });
  }
  function stopPanel() { if (cleanup) { try { cleanup(); } catch {} cleanup = null; } cur = null; }
  function renderGrid() {
    stopPanel();
    const groups = Object.keys(G).map(g => {
      const items = F.filter(f => f[1] === g);
      return items.length ? `<h2 class="kit-gh qt-eyebrow">${G[g]}</h2><div class="kit-grid">${items.map((f, i) => `
        <button class="kit-card qt-card" data-kf="${f[0]}" style="--i:${i}"><span class="ki">${f[3]}</span>
          <b>${esc(f[2])}</b><span class="qt-muted">${esc(f[4])}</span></button>`).join("")}</div>` : "";
    }).join("");
    el.innerHTML = `<header class="kit-head"><div><div class="qt-eyebrow">QT Suite</div><h1 class="qt-display">Toolkit</h1>
        <p class="qt-muted">32 extra tools. Press Ctrl+K and type a name to jump straight to one. Ctrl+Alt+Q opens this page from any app.</p></div>
        <div class="kit-xp" id="kit-xp"></div></header>
      <div id="kit-broken"></div>
      <div class="kit-link qt-card" id="kit-link"><div class="kl-txt"><b>Phone link</b><span class="qt-muted">Loading...</span></div></div>
      ${groups}`;
    paintXp(); paintLink(); paintBroken();
  }
  // a Toolkit module that failed to import only shows as dead buttons; say which and why
  async function paintBroken() {
    try {
      const st = await api("/api/kit/status"), box = $("#kit-broken", el), bad = Object.entries(st.errors || {});
      if (!box || !bad.length) return;
      const last = t => (String(t).trim().split(/\r?\n/).pop() || "").slice(0, 160);
      box.innerHTML = `<div class="kit-broken qt-card"><b>${bad.length} Toolkit part${bad.length > 1 ? "s" : ""} didn't load</b>
        <span class="qt-muted">Their tools won't answer until this is fixed. Restart QT Suite; if it stays, the line below says what broke.</span>
        ${bad.map(([m, t]) => `<code title="${esc(String(t))}">${esc(m)}: ${esc(last(t))}</code>`).join("")}</div>`;
    } catch {}
  }
  async function paintXp() {
    try {
      const p = await api("/api/kit/progress"), box = $("#kit-xp", el);
      if (!box) return;
      box.innerHTML = `<button class="kxp qt-card" data-kf="xp" title="Achievements"><b class="qt-display">LV ${p.level}</b>
        <span class="bar"><i style="width:0" data-w="${Math.round(100 * p.into / Math.max(1, p.need))}%"></i></span><span>${p.xp} XP · 🔥 ${p.streak} day${p.streak === 1 ? "" : "s"}</span></button>`;
      requestAnimationFrame(() => requestAnimationFrame(() => box.querySelectorAll("[data-w]").forEach(i => { i.style.width = i.dataset.w; })));   // fill from empty
    } catch {}
  }
  KIT.phoneLink = async function (box) {
    try {
      const s = await api("/api/kit/phone");
      const url = s.urls.tailscale || s.urls.lan;
      box.innerHTML = `<div class="kl-qr">${await qrSvg(s.urls.lan, 3)}</div>
        <div class="kl-txt"><b>Phone link ${s.on ? '<span class="qt-chip"><span class="qt-dot on"></span>on</span>' : '<span class="qt-chip bad">off</span>'}</b>
        <span class="qt-muted">Scan with your phone camera on the same Wi-Fi. The first time, Chrome warns about the certificate: tap Advanced, then Proceed. That lock belongs to this PC.</span>
        <span class="kl-urls"><code>${esc(s.urls.lan.split("?")[0])}</code>${s.urls.tailscale ? ` <code title="Works away from home over Tailscale">${esc(s.urls.tailscale.split("?")[0])}</code>` : ""}</span>
        ${s.err ? `<span class="bad">${esc(s.err)}</span>` : ""}
        <span class="kl-act"><button class="qt-btn" data-kcopy="${esc(url)}">Copy link</button><button class="qt-btn ghost" data-knewkey>New key (unpairs phones)</button>
        <span class="qt-muted">${s.phones ? s.phones + " phone connected" : "No phone connected yet"}</span></span></div>`;
      box.onclick = async e => {
        if (e.target.closest("[data-kcopy]")) { navigator.clipboard.writeText(e.target.closest("[data-kcopy]").dataset.kcopy); say("Link copied"); }
        if (e.target.closest("[data-knewkey]")) { await api("/api/kit/phone/newkey", {}); say("New key made. Scan the QR again on your phone."); KIT.phoneLink(box); }
      };
    } catch (e) { box.innerHTML = `<div class="kl-txt"><b>Phone link</b><span class="bad">${esc(e.message)}</span></div>`; }
  };
  const paintLink = () => { const b = $("#kit-link", el); if (b) KIT.phoneLink(b); };

  async function openFeature(id) {
    stopPanel();
    const f = byF[id];
    cur = id;
    el.innerHTML = `<header class="kit-fhead"><button class="qt-btn ghost" data-kback>← Toolkit</button>
      <span class="ki big">${f.icon}</span><div><div class="qt-eyebrow">${esc(G[f.group])}</div><h1 class="qt-display">${esc(f.name)}</h1>
      <p class="qt-muted">${esc(f.blurb)}</p></div></header>
      <div class="kit-body" id="kit-body"><div class="kit-loading"><div class="loader"></div></div></div>`;
    api("/api/kit/event", { k: "feature.open", d: id }).catch(() => {});
    try {
      await loadFile(f.file);
      if (cur !== id) return;
      const body = $("#kit-body", el), p = PANELS[id];
      if (!p) throw new Error("panel missing");
      body.innerHTML = "";
      const c = await p(body, KIT);
      if (cur === id) cleanup = typeof c === "function" ? c : null; else if (typeof c === "function") c();
    } catch (e) {
      const body = $("#kit-body", el);
      if (body) body.innerHTML = `<p class="bad">That didn't load: ${esc(e.message)}</p>`;
    }
  }

  const prevShow = show;
  show = function (id) {
    if (typeof id === "string" && (id === "kit" || id.startsWith("kit/"))) {
      ensure();
      const sub = id.split("/")[1] || null;
      if (current !== "kit") prevShow("kit");
      if (location.hash !== "#" + id) history.replaceState({ id }, "", "#" + id);
      if (sub && byF[sub]) { if (cur !== sub) openFeature(sub); } else renderGrid();
      return;
    }
    if (id !== "kit") stopPanel();
    prevShow(id);
    if (id === "home") setTimeout(homeCards, 60);
  };

  /* --------------------------------------------------------- rail button + palette ---- */
  function railButton() {
    const foot = $(".rail-foot"); if (!foot || $("#kit-rail")) return;
    const b = document.createElement("button");
    b.id = "kit-rail"; b.className = "qt-btn ghost kit-rail"; b.title = "Toolkit: 32 extra tools (Ctrl+Alt+Q from anywhere)";
    b.innerHTML = `<span>🧰</span><span class="nm">Toolkit</span>`;
    b.onclick = () => show("kit");
    foot.prepend(b);
  }
  const prevPal = window.qtPalExtra;
  let searchSeq = 0, lastSearch = { q: "", items: [] }, searchT = 0, searchAbort = null, pendingQ = "";
  window.qtPalExtra = q => {
    const base = prevPal ? prevPal(q) : [];
    const ql = (q || "").toLowerCase().trim();
    const feats = !ql ? [] : F.filter(f => (f[2] + " " + f[4] + " " + f[0]).toLowerCase().includes(ql)).slice(0, 6)
      .map(f => ({ label: f[2], sub: f[4], glyph: f[3], head: "Toolkit", fixed: 50, run: () => show("kit/" + f[0]), words: f[4] }));
    if (!ql || "toolkit extras".includes(ql)) feats.unshift({ label: "Toolkit", sub: "32 extra tools", glyph: "🧰", run: () => show("kit"), words: "toolkit extras more tools", hint: "Ctrl+Alt+Q" });
    if (ql.length >= 3 && ql !== lastSearch.q && ql !== pendingQ) {
      // one search at a time: wait for a typing pause and drop the stale one, so keystrokes can't
      // pile up requests that hold all of the browser's connections to the hub
      const my = ++searchSeq; pendingQ = ql;
      clearTimeout(searchT); if (searchAbort) searchAbort.abort();
      searchT = setTimeout(() => {
        if (my !== searchSeq) return;
        searchAbort = new AbortController();
        fetch("/api/kit/search?q=" + encodeURIComponent(ql), { signal: searchAbort.signal }).then(r => r.json()).then(r => {
          if (my !== searchSeq) return;
          lastSearch = { q: ql, items: (r.groups || []).flatMap(g => g.items.slice(0, 3).map(it => ({ label: it.title, sub: it.sub || "", head: g.name, fixed: 20, run: () => KIT.runHit(it) }))) };
          window.qtPalRender && window.qtPalRender();
        }).catch(() => {}).finally(() => { if (my === searchSeq) pendingQ = ""; });
      }, 220);
    }
    return base.concat(feats, lastSearch.q === ql ? lastSearch.items : []);
  };
  KIT.runHit = async function (it) {
    if (it.run) { try { const r = await api("/api/kit/do", { action: it.run }); say(r.msg || "Done"); } catch (e) { say(e.message, { bad: true }); } return; }
    if (it.copy) { await api("/api/kit/clips", { op: "copy", id: it.copy }); say("Copied"); return; }
    if (it.game) { try { await api("/api/kit/games", { op: "launch", id: it.game }); say("Launching"); } catch (e) { say(e.message, { bad: true }); } return; }
    if (it.go) show(it.go);
    if (it.play) setTimeout(() => window.qtKitMusic && window.qtKitMusic.play(it.play), 700);
  };

  /* ------------------------------------------------------------ Home cards (23, 12) ---- */
  async function homeCards() {
    if (localStorage.getItem("qt-kit-home") === "off") { $("#kit-home")?.remove(); return; }
    const home = $("#view-home"); if (!home || home.hidden) return;
    let box = $("#kit-home");
    if (!box) {
      box = document.createElement("div"); box.id = "kit-home"; box.className = "kit-home";
      const tiles = $("#tiles"); tiles ? tiles.before(box) : home.append(box);
    }
    try {
      const [k, s] = await Promise.all([api("/api/kit/kharcha"), api("/api/kit/subs").catch(() => null)]);
      if (!k.ok) { box.innerHTML = `<button class="kh qt-card" data-kf2="kharcha"><b>💸 Kharcha</b><span class="qt-muted">${esc(k.msg)}</span></button>`; }
      else {
        const pct = k.limit ? Math.min(100, Math.round(100 * k.spent / k.limit)) : 0;
        const due = s ? s.subs.filter(x => x.in_days <= 3) : [];
        box.innerHTML = `<button class="kh qt-card" data-go2="kharcha" title="Open the Kharcha dashboard">
            <div class="kh-top"><span class="qt-eyebrow">💸 This month</span><span class="qt-muted">${k.count} spends · synced ${ago(k.synced)}</span></div>
            <div class="kh-big"><b class="qt-display">${money(k.spent, k.cur)}</b>${k.limit ? `<span class="qt-muted">of ${money(k.limit, k.cur)}</span>` : ""}</div>
            ${k.limit ? `<span class="bar ${pct >= 100 ? "over" : pct >= 80 ? "warn" : ""}"><i style="width:${pct}%"></i></span>` : ""}
            <div class="kh-row"><span>Today <b>${money(k.today, k.cur)}</b></span>${k.left_per_day != null ? `<span>${money(k.left_per_day, k.cur)} a day left for ${k.days_left} days</span>` : ""}</div>
            <div class="kh-cats">${k.top.map(c => `<span class="qt-chip">${c.emoji} ${esc(c.name)} ${money(c.amt, k.cur)}</span>`).join("")}</div>
          </button>
          ${s ? `<button class="kh kh-subs qt-card" data-kf2="subs"><div class="kh-top"><span class="qt-eyebrow">🔁 Subscriptions</span><span class="qt-muted">${money(s.per_month, s.cur)} a month</span></div>
            ${due.length ? due.map(d => `<div class="kh-row"><span>${esc(d.name)}</span><b>${d.in_days === 0 ? "today" : d.in_days === 1 ? "tomorrow" : "in " + d.in_days + " days"} · ${money(d.amount, s.cur)}</b></div>`).join("")
              : `<div class="kh-row qt-muted">${s.subs.length ? "Nothing due in the next 3 days. Next: " + esc(s.subs[0].name) + " in " + s.subs[0].in_days + " days" : "No subscriptions found yet"}</div>`}</button>` : ""}`;
      }
      box.onclick = e => {
        if (e.target.closest("[data-go2]")) show("kharcha");
        const f = e.target.closest("[data-kf2]"); if (f) show("kit/" + f.dataset.kf2);
      };
    } catch (e) { box.innerHTML = ""; }
  }

  /* ------------------------------------------------------- 24. skins + sounds (live) ---- */
  const SKINS = {
    ink: { name: "Ink Arcade", vars: {} },
    paper: { name: "Paper", vars: { "--qt-bg": "#f3ecdf", "--qt-bg2": "#ebe2d2", "--qt-card": "#fffaf0", "--qt-chip": "#efe5d3", "--qt-hover": "#e7dcc8", "--qt-well": "#e2d7c3", "--qt-fg": "#1d1a16", "--qt-muted": "#5f574c", "--qt-dim": "#8f8678" } },
    neon: { name: "Neon night", vars: { "--qt-bg": "#0b0820", "--qt-bg2": "#120d2e", "--qt-card": "#1a1440", "--qt-chip": "#251c57", "--qt-hover": "#251c57", "--qt-well": "#07051a", "--qt-ink": "#ff2bd6", "--qt-fg": "#f4f0ff", "--qt-muted": "#b5a8e8" } },
    forest: { name: "Forest", vars: { "--qt-bg": "#10190f", "--qt-bg2": "#152114", "--qt-card": "#1b2a19", "--qt-chip": "#233722", "--qt-hover": "#233722", "--qt-well": "#0a1209", "--qt-fg": "#eef7e6", "--qt-muted": "#a7bb9c" } },
    sunset: { name: "Sunset", vars: { "--qt-bg": "#22111a", "--qt-bg2": "#2b1520", "--qt-card": "#361a27", "--qt-chip": "#442132", "--qt-hover": "#442132", "--qt-well": "#180b12", "--qt-fg": "#fff1e6", "--qt-muted": "#e0b3a6" } },
    mono: { name: "Mono", vars: { "--qt-bg": "#111111", "--qt-bg2": "#171717", "--qt-card": "#1e1e1e", "--qt-chip": "#2a2a2a", "--qt-hover": "#2a2a2a", "--qt-well": "#0a0a0a", "--qt-fg": "#f5f5f5", "--qt-muted": "#a8a8a8" } },
    soft: { name: "Soft (no hard shadows)", vars: { "--qt-shadow": "0 6px 18px rgba(0,0,0,.35)", "--qt-shadow-sm": "0 3px 10px rgba(0,0,0,.3)", "--qt-line": "1px", "--qt-ink": "#3a3542" } },
  };
  KIT.SKINS = SKINS;
  KIT.applySkin = function (id) {
    const s = SKINS[id] || SKINS.ink, root = document.documentElement;
    Object.values(SKINS).forEach(k => Object.keys(k.vars).forEach(v => root.style.removeProperty(v)));
    Object.entries(s.vars).forEach(([k, v]) => root.style.setProperty(k, v));
    document.body.dataset.kitSkin = id;
    localStorage.setItem("qt-kit-skin", id);
  };
  const SOUNDS = { off: "Off", blip: "Blip", wood: "Wood block", arcade: "Arcade", soft: "Soft pop" };
  KIT.SOUNDS = SOUNDS;
  let actx = null;
  KIT.playSound = function (kind) {
    kind = kind || localStorage.getItem("qt-kit-sound") || "off";
    if (kind === "off") return;
    actx = actx || new AudioContext();
    const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
    const P = { blip: ["square", 880, 1320, .05], wood: ["triangle", 520, 300, .07], arcade: ["square", 440, 1760, .09], soft: ["sine", 660, 520, .08] }[kind] || ["sine", 600, 600, .05];
    o.type = P[0]; o.frequency.setValueAtTime(P[1], t); o.frequency.exponentialRampToValueAtTime(P[2], t + P[3]);
    g.gain.setValueAtTime(.08 * (+(localStorage.getItem("qt-kit-vol") || 1)), t); g.gain.exponentialRampToValueAtTime(.0001, t + P[3] + .05);
    o.connect(g).connect(actx.destination); o.start(t); o.stop(t + P[3] + .06);
  };
  document.addEventListener("pointerdown", e => { if (e.target.closest("button, .qt-btn, [role=switch]")) KIT.playSound(); }, true);

  /* --------------------------------------------------------------------- boot ---- */
  function boot() {
    railButton();
    const sk = localStorage.getItem("qt-kit-skin"); if (sk && sk !== "ink") KIT.applySkin(sk);
    setTimeout(homeCards, 900);
    setInterval(() => { if (current === "home") homeCards(); }, 120000);
    if (window.qtKeys) window.qtKeys.push(["Ctrl", "Alt", "Q"], "Toolkit (works from any app)", ["Ctrl", "Alt", "F"], "Focus mode on or off", ["Ctrl", "Alt", "V"], "Paste next from the clipboard stack");
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
