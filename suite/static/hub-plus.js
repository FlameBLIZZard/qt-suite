"use strict";
/* QT Suite polish layer (loaded after hub.js; reuses its globals: tools, frames, show, api, toast, load, loadFrame, startTool).
   Kept in its own file so other work on hub.js doesn't collide with it.
   - Ctrl+K command palette          - right-click / long-press tool menu (reload, pop out, restart, stop, folder, copy link)
   - #tool links + back/forward      - live uptime + memory on tiles and nav
   - "hub isn't answering" banner    - phone-width layout (bottom tab bar)
   - motion: ink wipe between views, tile tilt + shine, press splats, booting state, spring menus */
(() => {
  const RM = matchMedia("(prefers-reduced-motion: reduce)");
  const PHONE = matchMedia("(max-width: 600px)");
  const byId = id => tools.find(t => t.id === id);
  const sameServer = (a, b) => a.kind === "web" && b.kind === "web" && a.port === b.port;
  const urlOf = t => t.kind === "web" ? `http://127.0.0.1:${t.port}${t.path || "/"}` : t.kind === "file" ? `${location.origin}/tool/${t.id}` : "";
  let procs = {}, procsAt = Date.now();

  /* ---------- small helpers ---------- */
  const fmtUp = s => s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h ${Math.floor(s % 3600 / 60)}m` : `${Math.floor(s / 86400)}d ${Math.floor(s % 86400 / 3600)}h`;
  const fmtMem = b => b == null ? "" : b < 1 << 30 ? `${Math.round(b / 1048576)} MB` : `${(b / 1073741824).toFixed(1)} GB`;
  function sharers(t) { return tools.filter(x => x !== t && sameServer(x, t)).map(x => x.name); }

  /* ---------- routes: #beam opens Beam, back/forward walk your history ---------- */
  const baseShow = show;
  let routing = false;
  show = function (id) {
    const from = current;
    baseShow(id);
    if (from !== id) wipe();
    if (!routing) {
      const want = id === "home" ? location.pathname : "#" + id;
      if ((id === "home" ? "" : "#" + id) !== location.hash) history.pushState({ id }, "", want);
    }
    markRecent(id);
  };
  addEventListener("popstate", () => {
    const id = location.hash.slice(1) || "home";
    if (id !== "home" && !byId(id) && !(window.qtViews || {})[id]) return;
    routing = true; show(id); routing = false;
  });
  (function firstRoute() {
    const id = location.hash.slice(1);
    if (!id) return;
    if (!tools.length) return setTimeout(firstRoute, 60);
    if ((byId(id) || (window.qtViews || {})[id]) && current !== id) { routing = true; show(id); routing = false; }
  })();

  function markRecent(id) {
    if (id === "home") return;
    try {
      const r = JSON.parse(localStorage.getItem("qt-recent") || "[]").filter(x => x !== id);
      r.unshift(id); localStorage.setItem("qt-recent", JSON.stringify(r.slice(0, 6)));
    } catch (_) {}
  }
  function recent() { try { return JSON.parse(localStorage.getItem("qt-recent") || "[]"); } catch (_) { return []; } }

  /* ---------- tool actions (shared by palette and menu) ---------- */
  async function act(kind, t) {
    const el = frames[t.id];
    try {
      if (kind === "open") return show(t.id);
      if (kind === "reload") {
        if (!el) return show(t.id);
        const f = el.querySelector("iframe");
        if (t.kind === "web") loadFrame(el, t); else if (f) f.src = f.src;
        return toast("Reloaded " + t.name);
      }
      if (kind === "pop") { window.open(urlOf(t), "_blank", "width=1280,height=820"); return; }
      if (kind === "copy") { await navigator.clipboard.writeText(urlOf(t)); return toast("Link copied"); }
      if (kind === "folder") { await api(`/api/folder/${t.id}`, { method: "POST" }); return toast("Opened " + t.name + " folder"); }
      if (kind === "start") return el ? startTool(t, el) : show(t.id);
      if (window.qtAct && await window.qtAct(kind, t) !== false) return;  // shell.js actions (split view, move, ...)
      if (kind === "stop" || kind === "restart") {
        booting(t, kind === "restart" ? "Restarting" : "Stopping");
        const r = await api(`/api/${kind}/${t.id}`, { method: "POST" });
        const also = sharers(t);
        toast(`${t.name} ${r.msg}${also.length ? " (with " + also.join(", ") + ")" : ""}`);
        if (kind === "restart") tools.filter(x => x === t || sameServer(x, t)).forEach(x => frames[x.id] && loadFrame(frames[x.id], x));
      }
    } catch (e) { toast(e.message || "That didn't work", true); }
    finally { booting(t, null); await load(true).catch(() => {}); pollProcs(); }
  }
  window.qtToolAct = act;   // flow.js tile quick actions
  window.qtActionsFor = t => actionsFor(t);
  function actionsFor(t) {
    const a = [["open", "Open", "↗"]];
    if (t.kind === "web" || t.kind === "file") {
      if (frames[t.id]) a.push(["reload", "Reload", "↻"]);
      a.push(["pop", "Pop out in its own window", "⧉"]);
    }
    if (t.kind === "web") {
      if (t.status === "on") {
        const also = sharers(t);
        a.push(["restart", "Restart", "⟲"], ["stop", also.length ? `Stop (also stops ${also.join(", ")})` : "Stop", "■"]);
      } else a.push(["start", "Start", "▶"]);
      a.push(["copy", "Copy link", "⎘"]);
    }
    a.push(["folder", "Open its folder", "▤"]);
    if (window.qtMenuExtra) a.push(...window.qtMenuExtra(t));
    return a;
  }

  /* ---------- booting state on tile + nav while a start/stop runs ---------- */
  function booting(t, label) {
    document.querySelectorAll(`[data-go="${t.id}"]`).forEach(n => {
      n.classList.toggle("booting", !!label);
      if (label) n.dataset.boot = label; else delete n.dataset.boot;
    });
  }
  const baseStart = startTool;
  startTool = async function (t, el) { booting(t, "Starting"); try { return await baseStart(t, el); } finally { booting(t, null); pollProcs(); } };

  /* ---------- live uptime + memory ---------- */
  async function pollProcs() {
    try {
      procs = await api("/api/procs"); procsAt = Date.now();
      online(true);
    } catch (e) { online(!(e instanceof TypeError)); }  // only a network failure means the hub is down (an old hub just lacks /api/procs)
    paintMeta();
  }
  function paintMeta() {
    const dt = Math.round((Date.now() - procsAt) / 1000);
    for (const t of tools) {
      const p = procs[t.id];
      const text = p && t.status === "on" ? `up ${fmtUp((p.up || 0) + dt)}${p.mem ? " · " + fmtMem(p.mem) : ""}` : "";
      const tile = document.querySelector(`.tile[data-go="${t.id}"]`);
      if (tile) {
        let m = tile.querySelector(".meta");
        if (!m) { m = document.createElement("span"); m.className = "meta qt-mono"; tile.querySelector(".top").append(m); }
        if (m.textContent !== text) {
          const minuteChanged = m.textContent.replace(/\d+s/, "") !== text.replace(/\d+s/, "");
          m.textContent = text;
          if (minuteChanged && text && !RM.matches) m.animate([{ transform: "translateY(-6px)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 320, easing: "cubic-bezier(.34,1.8,.5,1)" });
        }
      }
      const nav = document.querySelector(`#nav .nav[data-go="${t.id}"]`);
      if (nav) {
        const i = tools.indexOf(t) + 1;
        nav.title = `${t.name} (Ctrl+${i})${text ? "\n" + text : ""}\nRight-click for more`;
      }
    }
  }
  setInterval(pollProcs, 8000);
  setInterval(paintMeta, 1000);
  pollProcs();
  // renderHome rebuilds the tiles: put the meta lines straight back
  new MutationObserver(() => paintMeta()).observe(document.getElementById("tiles"), { childList: true });

  /* ---------- hub offline banner ---------- */
  let isOnline = true;
  function online(ok) {
    if (ok === isOnline) return;
    isOnline = ok;
    let b = document.getElementById("offline");
    if (!ok) {
      if (!b) {
        b = document.createElement("div"); b.id = "offline"; b.className = "offline";
        b.innerHTML = '<span class="qt-dot bad"></span><b>Hub isn\'t answering.</b><span>Retrying every few seconds. Your open tools keep working.</span>';
        document.body.append(b);
      }
    } else if (b) { b.classList.add("out"); setTimeout(() => b.remove(), 300); load(true).catch(() => {}); toast("Hub is back"); }
  }

  /* ---------- context menu (right-click, or long-press on touch) ---------- */
  let menu;
  function closeMenu() { if (menu) { const m = menu; menu = null; m.classList.add("out"); setTimeout(() => m.remove(), 160); } }
  function openMenu(t, x, y) {
    closeMenu();
    menu = document.createElement("div");
    menu.className = "ctx qt-card"; menu.dataset.tool = t.id; menu.setAttribute("role", "menu");
    menu.innerHTML = `<div class="ctx-head"><img src="/icons/${t.id}.svg" alt=""><b>${esc(t.name)}</b><span class="qt-dot ${dotClass(t)}"></span></div>` +
      actionsFor(t).map(([k, label, ic], i) => `<button role="menuitem" data-act="${k}" style="--i:${i}" class="${k === "stop" ? "danger" : ""}"><i>${ic}</i>${esc(label)}</button>`).join("");
    document.body.append(menu);
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + "px";
    menu.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + "px";
    menu.style.transformOrigin = `${x < innerWidth - r.width ? "left" : "right"} ${y < innerHeight - r.height ? "top" : "bottom"}`;
    menu.onclick = e => { const b = e.target.closest("[data-act]"); if (b) { closeMenu(); act(b.dataset.act, t); } };
    menu.querySelector("[data-act]").focus({ preventScroll: true });
  }
  document.addEventListener("contextmenu", e => {
    const g = e.target.closest("#nav [data-go], #tiles [data-go]");
    if (!g || !byId(g.dataset.go)) return;
    e.preventDefault(); openMenu(byId(g.dataset.go), e.clientX, e.clientY);
  });
  let pressTimer, pressed;
  document.addEventListener("pointerdown", e => {
    if (menu && !e.target.closest(".ctx")) closeMenu();
    if (e.pointerType === "mouse") return;
    const g = e.target.closest("#nav [data-go], #tiles [data-go]");
    if (!g) return;
    pressed = false;
    pressTimer = setTimeout(() => { pressed = true; navigator.vibrate?.(12); openMenu(byId(g.dataset.go), e.clientX, e.clientY); }, 480);
  });
  ["pointerup", "pointercancel", "pointermove"].forEach(ev => document.addEventListener(ev, e => {
    if (ev === "pointermove" && (Math.abs(e.movementX) + Math.abs(e.movementY) < 4)) return;
    clearTimeout(pressTimer);
  }));
  document.addEventListener("click", e => { if (pressed) { pressed = false; e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  addEventListener("blur", closeMenu);
  addEventListener("resize", closeMenu);
  document.addEventListener("keydown", e => {
    if (!menu) return;
    const items = [...menu.querySelectorAll("[data-act]")], i = items.indexOf(document.activeElement);
    if (e.key === "Escape") { closeMenu(); e.preventDefault(); }
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus(); }
  });

  /* ---------- Ctrl+K command palette ---------- */
  let pal, palItems = [], sel = 0;
  function commands() {
    const out = [{ label: "Home", hint: "Ctrl+0", run: () => show("home"), ic: "/icons/suite.svg", words: "home start dashboard" }];
    const rec = recent();
    const order = [...tools].sort((a, b) => ((rec.indexOf(a.id) + 1 || 99) - (rec.indexOf(b.id) + 1 || 99)));
    for (const t of order) {
      const n = tools.indexOf(t) + 1;
      out.push({ label: t.name, sub: t.tag, hint: n <= 9 ? "Ctrl+" + n : "", run: () => show(t.id), ic: `/icons/${t.id}.svg`, words: `${t.name} ${t.tag} ${t.blurb}`, tool: t, dot: dotClass(t) });
    }
    for (const t of tools) for (const [k, label] of actionsFor(t)) {
      if (k === "open") continue;
      out.push({ label: `${label.replace(/ \(also.*\)/, "")}: ${t.name}`, run: () => act(k, t), ic: `/icons/${t.id}.svg`, words: `${label} ${t.name} ${k}`, tool: t, minor: true });
    }
    out.push({ label: "Refresh status", run: () => document.getElementById("refresh").click(), words: "refresh status reload check", ic: "", glyph: "↻", minor: true });
    const as = document.getElementById("autostart");
    out.push({ label: as.getAttribute("aria-checked") === "true" ? "Don't start with Windows" : "Start with Windows", run: () => as.click(), words: "autostart startup windows login boot", glyph: "⏻", minor: true });
    return out;
  }
  function score(c, q) {
    if (!q) return c.minor ? -1 : 100 - out0(c);
    const hay = (c.label + " " + c.words).toLowerCase();
    let s = 0, j = 0, run = 0;
    for (const ch of q) {
      const k = hay.indexOf(ch, j);
      if (k < 0) return -1;
      run = k === j ? run + 1 : 0; s += 1 + run * 2 + (k === 0 || hay[k - 1] === " " ? 4 : 0); j = k + 1;
    }
    if (c.label.toLowerCase().startsWith(q)) s += 30;
    return s - (c.minor ? 6 : 0);
  }
  const out0 = () => 0;
  function renderPal() {
    const q = pal.querySelector("input").value.trim().toLowerCase();
    palItems = commands().concat(window.qtPalExtra ? window.qtPalExtra(q) : []).map(c => [c, c.fixed != null ? (q ? c.fixed : -1) : score(c, q)]).filter(x => x[1] >= 0).sort((a, b) => b[1] - a[1]).map(x => x[0]);
    { const extra = palItems.filter(c => c.head); palItems = palItems.filter(c => !c.head).slice(0, extra.length ? 8 : 12).concat(extra); }
    sel = Math.min(sel, Math.max(0, palItems.length - 1));
    const list = pal.querySelector(".pal-list");
    list.innerHTML = palItems.length ? palItems.map((c, i) => `${c.head && (i === 0 || palItems[i - 1].head !== c.head) ? `<div class="pal-head" style="--i:${i}">${esc(c.head)}</div>` : ""}<button class="pal-item${c.minor ? " minor" : ""}${c.path ? " file" : ""}" data-i="${i}" style="--i:${i}" ${c.tool ? `data-tool="${c.tool.id}"` : ""}>
        <span class="pi">${c.ic ? `<img src="${c.ic}" alt="">` : `<i>${c.glyph || "•"}</i>`}</span>
        <span class="pl"><b>${esc(c.label)}</b>${c.sub ? `<em>${esc(c.sub)}</em>` : ""}${c.path ? `<small>${esc(c.path)}</small>` : ""}</span>
        ${c.dot !== undefined ? `<span class="qt-dot ${c.dot}"></span>` : ""}${c.badge ? `<span class="pb">${esc(c.badge)}</span>` : ""}${c.hint ? `<kbd>${c.hint}</kbd>` : ""}</button>`).join("")
      : `<p class="pal-empty">Nothing matches "${esc(q)}".</p>`;
    list.prepend(Object.assign(document.createElement("span"), { className: "pal-sel" }));
    moveSel(true);
  }
  function moveSel(instant) {
    const item = pal.querySelector(`.pal-item[data-i="${sel}"]`), bar = pal.querySelector(".pal-sel");
    pal.querySelectorAll(".pal-item").forEach(b => b.classList.toggle("on", b === item));
    if (!item) { bar.style.opacity = 0; return; }
    bar.style.opacity = 1;
    bar.style.transition = instant ? "none" : "";
    bar.style.transform = `translateY(${item.offsetTop}px)`; bar.style.height = item.offsetHeight + "px";
    const tid = item.dataset.tool; bar.dataset.tool = tid || ""; if (tid) bar.setAttribute("data-tool", tid); else bar.removeAttribute("data-tool");
    item.scrollIntoView({ block: "nearest" });
  }
  function openPal() {
    if (pal) return pal.querySelector("input").focus();
    closeMenu();
    pal = document.createElement("div");
    pal.className = "pal-wrap";
    pal.innerHTML = `<div class="pal qt-card" role="dialog" aria-label="Command palette">
      <label class="pal-in"><span>⌕</span><input class="qt-input" placeholder="Jump to a tool or run an action..." autocomplete="off" spellcheck="false"><kbd>Esc</kbd></label>
      <div class="pal-list"></div>
      <div class="pal-foot qt-mono"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> run</span><span><kbd>Ctrl</kbd><kbd>Enter</kbd> open beside</span><span>right-click a tool for more</span></div></div>`;
    document.body.append(pal);
    sel = 0; renderPal();
    const inp = pal.querySelector("input");
    inp.focus();
    inp.oninput = () => { sel = 0; renderPal(); };
    pal.onclick = e => {
      const b = e.target.closest(".pal-item");
      if (b) { sel = +b.dataset.i; return runSel(); }
      if (e.target === pal) closePal();
    };
    pal.onmousemove = e => { const b = e.target.closest(".pal-item"); if (b && +b.dataset.i !== sel) { sel = +b.dataset.i; moveSel(); } };
  }
  function closePal() { if (!pal) return; const p = pal; pal = null; p.classList.add("out"); setTimeout(() => p.remove(), 180); }
  function runSel(alt) { const c = palItems[sel]; if (!c) return; closePal(); (alt && c.alt ? c.alt : c.run)(); }
  window.qtPalRender = () => { if (pal) renderPal(); };
  window.qtPalOpen = openPal;
  window.qtPalClose = closePal;
  window.qtPalSel = () => palItems[sel];
  document.addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") { e.preventDefault(); return pal ? closePal() : openPal(); }
    if (!pal) return;
    if (e.key === "Escape") { e.preventDefault(); closePal(); }
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (palItems.length) { sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + palItems.length) % palItems.length; moveSel(); } }
    else if (e.key === "Enter") { e.preventDefault(); runSel(e.shiftKey); }
  });
  // same-origin tools (Inkmotion, Pixlab): Ctrl+K inside them opens the palette too
  document.getElementById("frames").addEventListener("load", e => {
    try { e.target.contentWindow.addEventListener("keydown", ev => { if (ev.ctrlKey && ev.key.toLowerCase() === "k") { ev.preventDefault(); openPal(); } }, true); } catch (_) {}
  }, true);

  /* rail: palette button (always there on phones, where the footer is hidden) */
  const foot = document.querySelector(".rail-foot");
  const kb = document.createElement("button");
  kb.className = "qt-btn ghost palbtn"; kb.title = "Search tools and actions (Ctrl+K)";
  kb.innerHTML = "⌕ <span>Search</span><kbd>Ctrl K</kbd>";
  kb.onclick = openPal;
  foot.prepend(kb);
  const mob = document.createElement("button");
  mob.className = "nav mob-search"; mob.title = "Search (Ctrl+K)"; mob.innerHTML = '<span class="ic"><i>⌕</i></span><span class="nm">Search</span>';
  mob.onclick = openPal;
  document.getElementById("rail").append(mob);

  /* ---------- nav pill that works both up-down (rail) and sideways (phone tab bar) ---------- */
  movePill = function () {
    const nav = document.getElementById("nav"), on = nav.querySelector(".nav.on");
    let pill = nav.querySelector(".nav-pill");
    if (!pill) { pill = document.createElement("span"); pill.className = "nav-pill"; nav.prepend(pill); }
    if (!on) { pill.style.opacity = 0; return; }
    pill.style.opacity = 1;
    pill.style.transform = `translate(${on.offsetLeft}px, ${on.offsetTop}px)`;
    pill.style.width = on.offsetWidth + "px"; pill.style.height = on.offsetHeight + "px";
    pill.classList.remove("boing"); void pill.offsetWidth; pill.classList.add("boing");
    if (PHONE.matches) on.scrollIntoView({ inline: "center", block: "nearest", behavior: RM.matches ? "auto" : "smooth" });
  };
  PHONE.addEventListener("change", () => movePill());
  addEventListener("resize", () => { clearTimeout(movePill.t); movePill.t = setTimeout(movePill, 120); });

  /* ---------- motion: ink wipe between views ---------- */
  const stage = document.getElementById("stage");
  function wipe() {
    if (RM.matches || window.qtSkipWipe) { window.qtSkipWipe = false; return; }
    const w = document.createElement("div");
    w.className = "wipe"; w.style.setProperty("--d", getComputedStyle(document.documentElement).getPropertyValue("--dir") || 1);
    stage.append(w);
    w.addEventListener("animationend", () => w.remove());
  }

  /* ---------- motion: tile tilt + shine that follows the pointer ---------- */
  document.addEventListener("pointermove", e => {
    if (RM.matches || e.pointerType !== "mouse") return;
    const tile = e.target.closest(".tile");
    if (!tile) return;
    const r = tile.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    tile.style.setProperty("--mx", (x * 100).toFixed(1) + "%"); tile.style.setProperty("--my", (y * 100).toFixed(1) + "%");
    tile.style.setProperty("--ry", ((x - .5) * 7).toFixed(2) + "deg"); tile.style.setProperty("--rx", ((.5 - y) * 7).toFixed(2) + "deg");
  });

  /* ---------- motion: ink splat where you press ---------- */
  document.addEventListener("pointerdown", e => {
    if (RM.matches || e.button) return;
    const host = e.target.closest(".tile, .nav, .qt-btn, .pal-item, .ctx button");
    if (!host) return;
    const r = host.getBoundingClientRect(), s = document.createElement("span");
    const size = Math.max(r.width, r.height) * 2.2;
    s.className = "splat";
    s.style.cssText = `left:${e.clientX - r.left}px;top:${e.clientY - r.top}px;width:${size}px;height:${size}px`;
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    host.append(s);
    s.addEventListener("animationend", () => s.remove());
  });

  /* ---------- motion: logo blinks now and then ---------- */
  const logo = document.querySelector(".brand .logo");
  setInterval(() => {
    if (RM.matches || document.hidden || !logo) return;
    logo.animate([{ transform: "none" }, { transform: "rotate(-14deg) scale(1.12)" }, { transform: "rotate(8deg) scale(.96)" }, { transform: "none" }],
      { duration: 700, easing: "cubic-bezier(.34,1.8,.5,1)" });
  }, 14000);

  /* the hint line now mentions the palette */
  const hint = document.querySelector(".hint");
  if (hint && !/Ctrl \+ K/.test(hint.textContent)) hint.textContent += " Ctrl + K searches everything, and right-click a tool for more.";
})();
