"use strict";
/* QT Suite flow layer (loop 3): how the tools fit together. Loaded after shell.js; reuses hub.js / hub-plus.js / shell.js globals.
   1 Files group on the rail + tidy rail footer      2 window title follows the tool, Today strip fits one row
   3 rail badges (phone alerts, downloads, budget)   4 quick actions on home tiles
   5 recent files on home                            6 crashed tools come back (shell.py "revive")
   7 Ctrl+E recent-tool switcher                     8 palette: Ctrl+Enter opens beside, paste a path to peek
   9 tray: Search + Settings                         10 drop a file on a rail app opens it there
   11-20 motion (see the bottom half) */
(() => {
  const RM = matchMedia("(prefers-reduced-motion: reduce)");
  const PHONE = matchMedia("(max-width: 600px)");
  const spring = "cubic-bezier(.34,1.8,.5,1)";
  const anim = (el, kf, o) => (RM.matches || !el || !el.animate) ? null : el.animate(kf, o);
  const byId = id => tools.find(t => t.id === id);
  const nav = document.getElementById("nav");
  const S = () => (window.qtS ? window.qtS() : {});
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };

  /* =========================================================================================
     1. FILES GROUP: the five file apps share one rail button with a flyout
     ========================================================================================= */
  const groupOn = () => { const s = S(); return s.group != null ? s.group !== false : lsGet("qt-shell", {}).group !== false; };
  const fileTools = () => tools.filter(t => t.kind === "file" && ["pictures", "player", "reader", "code", "archive"].includes(t.id));
  let lastFile = lsGet("qt-last-file", "");
  function slots() {
    const files = fileTools(), out = [];
    const grouped = groupOn() && files.length > 1;
    let g = null;
    for (const t of tools) {
      if (grouped && files.includes(t)) { if (!g) out.push(g = { group: true, items: files }); }
      else out.push(t);
    }
    return out;
  }
  const groupGo = items => (items.find(t => t.id === current) || items.find(t => t.id === lastFile) || items[0]).id;
  function groupInner(items) {
    const act = items.find(t => t.id === current);
    const ic = act ? `<img class="gl" src="/icons/${act.id}.svg" alt="">`
      : `<span class="gmix">${items.slice(0, 4).map(t => `<img src="/icons/${t.id}.svg" alt="">`).join("")}</span>`;
    return `<span class="ic">${ic}</span><span class="nm">${act ? esc(act.name) : "Files"}</span><span class="gcount" aria-hidden="true">${act ? "▸" : items.length}</span>`;
  }
  renderNav = function () {
    const sl = slots();
    const sig = sl.map(x => x.group ? "G:" + x.items.map(t => t.id).join(",") : x.id).join("|");
    if (nav.dataset.sig === sig && nav.querySelectorAll(".nav").length === sl.length) {
      sl.forEach(x => {
        if (x.group) return paintGroup();
        const n = nav.querySelector(`.nav[data-go="${x.id}"]:not(.nav-group)`); if (!n) return;
        const d = n.querySelector(".qt-dot"), c = "qt-dot " + dotClass(x);
        if (d && d.className !== c) { d.className = c; anim(d, [{ transform: "scale(2.2)" }, { transform: "scale(1)" }], { duration: 450, easing: spring }); }
      });
      return;
    }
    nav.dataset.sig = sig;
    nav.innerHTML = sl.map(x => {
      if (x.group) {
        const go = groupGo(x.items);
        return `<button class="nav nav-group" data-group="files" data-go="${go}" data-tool="${go}" aria-haspopup="menu" title="Files: ${esc(x.items.map(t => t.name).join(", "))}">${groupInner(x.items)}</button>`;
      }
      const i = tools.indexOf(x);
      return `<button class="nav${current === x.id ? " on" : ""}" data-go="${x.id}" data-tool="${x.id}" title="${esc(x.name)} (Ctrl+${i + 1})">
      <span class="ic">${glyph(x)}</span><span class="nm">${esc(x.name)}</span><span class="qt-dot ${dotClass(x)}"></span></button>`;
    }).join("");
    paintGroup();
    movePill();
    document.dispatchEvent(new CustomEvent("qt-nav"));
  };
  function paintGroup() {
    const g = nav.querySelector(".nav-group"); if (!g) return;
    const items = fileTools(), go = groupGo(items);
    const want = (items.some(t => t.id === current) ? current : "") + "|" + go;
    g.dataset.go = go; g.dataset.tool = go;
    g.classList.toggle("on", items.some(t => t.id === current));
    if (g.dataset.paint !== want) {
      const had = g.dataset.paint != null;
      g.dataset.paint = want; g.innerHTML = groupInner(items);
      if (had) anim(g.querySelector(".ic"), [{ transform: "scale(.4) rotate(-30deg)" }, { transform: "scale(1.15) rotate(6deg)", offset: .6 }, { transform: "none" }], { duration: 460, easing: "ease-out" });
    }
  }
  // the nav drop handler (shell.js) gets the group's place expanded back into the file app ids
  window.qtNavIds = ids => {
    const files = fileTools().map(t => t.id), out = [];
    for (const id of ids) {
      if (files.includes(id)) { if (!out.includes(files[0])) out.push(...files); }
      else out.push(id);
    }
    return out;
  };
  document.addEventListener("qt-settings", () => {
    const want = groupOn() ? "1" : "0";
    if (nav.dataset.grouped !== undefined && nav.dataset.grouped !== want) { nav.dataset.sig = ""; renderNav(); }
    nav.dataset.grouped = want;
  });

  /* flyout */
  let fly = null;
  function closeFly() {
    if (!fly) return;
    const f = fly; fly = null;
    nav.querySelector(".nav-group")?.setAttribute("aria-expanded", "false");
    f.classList.add("out"); setTimeout(() => f.remove(), 200);
  }
  function openFly(btn) {
    if (fly) return closeFly();
    const items = fileTools();
    fly = document.createElement("div");
    fly.className = "nav-fly qt-card"; fly.setAttribute("role", "menu"); fly.dataset.tool = btn.dataset.tool;
    fly.innerHTML = `<div class="fly-head"><b>Files</b><span>Opens right here, in Peek</span></div>` +
      items.map((t, i) => {
        const n = tools.indexOf(t) + 1;
        return `<button class="fly-item${t.id === current ? " on" : ""}" role="menuitem" data-go="${t.id}" data-tool="${t.id}" style="--i:${i}">
          <span class="ic"><img src="/icons/${t.id}.svg" alt=""></span><span class="fl"><b>${esc(t.name)}</b><em>${esc(t.tag)}</em></span>${n <= 9 ? `<kbd>Ctrl ${n}</kbd>` : ""}</button>`;
      }).join("") +
      `<button class="fly-pick" data-fly="pick">⌕ Find or drop a file<kbd>Ctrl K</kbd></button>`;
    document.body.append(fly);
    btn.setAttribute("aria-expanded", "true");
    const r = btn.getBoundingClientRect(), fr = { width: fly.offsetWidth, height: fly.offsetHeight };   // offset*: the pop-in scale would shrink a rect
    if (PHONE.matches) {
      fly.style.left = Math.max(8, Math.min(r.left + r.width / 2 - fr.width / 2, innerWidth - fr.width - 8)) + "px";
      fly.style.top = Math.max(8, r.top - fr.height - 10) + "px";
      fly.style.transformOrigin = "50% 100%";
    } else {
      fly.style.left = r.right + 12 + "px";
      fly.style.top = Math.max(8, Math.min(r.top - 10, innerHeight - fr.height - 8)) + "px";
      fly.style.transformOrigin = `0 ${Math.min(fr.height, r.top - parseFloat(fly.style.top) + r.height / 2)}px`;
    }
    (fly.querySelector(".fly-item.on") || fly.querySelector(`.fly-item[data-go="${lastFile}"]`) || fly.querySelector(".fly-item")).focus({ preventScroll: true });
    fly.addEventListener("click", e => {
      if (e.target.closest('[data-fly="pick"]')) { closeFly(); window.qtPalOpen && window.qtPalOpen(); }
    });
  }
  document.addEventListener("click", e => {
    const g = e.target.closest(".nav-group");
    if (!g) return;
    e.stopImmediatePropagation(); e.preventDefault();
    openFly(g);
  }, true);
  document.addEventListener("pointerdown", e => { if (fly && !e.target.closest(".nav-fly, .nav-group")) closeFly(); });
  document.addEventListener("keydown", e => {
    if (!fly) return;
    const items = [...fly.querySelectorAll(".fly-item, .fly-pick")], i = items.indexOf(document.activeElement);
    if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); closeFly(); nav.querySelector(".nav-group")?.focus(); }
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus(); }
  }, true);
  addEventListener("blur", closeFly);
  addEventListener("resize", closeFly);

  /* show(): remember the last file app, keep the group lit, close the flyout */
  const prevShow = show;
  show = function (id) {
    closeFly();
    prevShow(id);
    if (fileTools().some(t => t.id === id)) { lastFile = id; lsSet("qt-last-file", id); }
    paintGroup();
    movePill();
    document.dispatchEvent(new CustomEvent("qt-show", { detail: id }));
  };

  /* tidy rail footer: Activity / Settings / Status become one icon row; Start with Windows lives in Settings */
  const foot = document.querySelector(".rail-foot"), rb = document.querySelector(".rail-btns"), refresh = document.getElementById("refresh");
  if (rb && refresh) {
    rb.classList.add("row");
    refresh.innerHTML = '<i class="rf">↻</i><span>Status</span>';
    refresh.title = "Check status";
    rb.append(refresh);
    foot.querySelector(".auto")?.classList.add("moved");
  }
  // rail list fades at whichever edge has more to scroll to
  function railFade() {
    const top = nav.scrollTop > 2, bot = nav.scrollTop + nav.clientHeight < nav.scrollHeight - 2;
    nav.classList.toggle("fade-top", top); nav.classList.toggle("fade-bot", bot);
  }
  nav.addEventListener("scroll", railFade, { passive: true });
  addEventListener("resize", railFade);
  document.addEventListener("qt-nav", () => setTimeout(railFade, 50));

  /* =========================================================================================
     2. window title + tab icon follow the open tool (taskbar, Alt+Tab)
     ========================================================================================= */
  const fav = document.querySelector('link[rel="icon"]');
  function titleFor(id) {
    const t = byId(id);
    document.title = t ? `${t.name} · QT Suite` : id === "settings" ? "Settings · QT Suite" : "QT Suite";
    if (fav) fav.href = t ? `/icons/${t.id}.svg` : "/icons/suite.svg";
  }
  document.addEventListener("qt-show", e => titleFor(e.detail));
  // split view: the focused pane names the window
  new MutationObserver(() => { const id = document.body.dataset.tool; if (byId(id)) titleFor(id); else if (current === "home") titleFor("home"); })
    .observe(document.body, { attributes: true, attributeFilter: ["data-tool"] });

  /* =========================================================================================
     3. RAIL BADGES: unread phone alerts on Ping, live downloads on VOLT, "!" on Kharcha when over budget
     ========================================================================================= */
  let gl = null;
  async function pollGlance() {
    if (document.hidden && gl) return;
    try { gl = await api("/api/glance"); paintBadges(); } catch (_) {}
  }
  function badgeWant() {
    const w = {};
    if (!gl) return w;
    if (gl.phone && gl.phone.unread) w.ping = { n: gl.phone.unread > 99 ? "99+" : String(gl.phone.unread), k: "hot", tip: `${gl.phone.unread} unread phone alert${gl.phone.unread > 1 ? "s" : ""}` };
    if (gl.downloads && gl.downloads.active) w.volt = { n: "↓" + gl.downloads.active, k: "go", tip: `${gl.downloads.active} downloading now` };
    if (gl.money && gl.money.left != null && gl.money.left < 0) w.kharcha = { n: "!", k: "warn", tip: "Over today's budget" };
    return w;
  }
  function paintBadges() {
    const w = badgeWant();
    nav.querySelectorAll(".nav[data-go]:not(.nav-group)").forEach(n => {
      const id = n.dataset.go, want = w[id];
      let b = n.querySelector(".nbadge");
      if (!want) { if (b) { b.classList.add("out"); setTimeout(() => b.remove(), 220); } return; }
      const grew = !b || (parseInt(want.n.replace(/\D/g, "")) || 0) > (parseInt((b.textContent || "").replace(/\D/g, "")) || 0);
      if (!b || b.classList.contains("out")) { b?.remove(); b = document.createElement("b"); b.className = "nbadge"; n.querySelector(".ic").after(b); }
      b.dataset.k = want.k; b.title = want.tip;
      if (b.textContent !== want.n) {
        b.textContent = want.n;
        if (grew) document.dispatchEvent(new CustomEvent("qt-badge", { detail: b }));
      }
    });
  }
  document.addEventListener("qt-nav", paintBadges);
  setInterval(pollGlance, 30000);
  addEventListener("focus", () => { if (gl && Date.now() - (gl.at || 0) * 1000 > 25000) pollGlance(); });
  pollGlance();

  /* =========================================================================================
     4. QUICK ACTIONS on home tiles: start / stop / restart / pop out without opening the tool
     ========================================================================================= */
  function quickFor(t) {
    const q = [];
    if (t.kind === "web") {
      if (t.status === "on") q.push(["restart", "⟲", "Restart"], ["stop", "■", "Stop" + (sharedWith(t) ? ` (also stops ${sharedWith(t)})` : "")], ["pop", "⧉", "Pop out in its own window"]);
      else q.push(["bgstart", "▶", "Start in the background"]);
    } else if (t.kind === "file") q.push(["pop", "⧉", "Pop out in its own window"]);
    else if (t.kind === "folder") q.push(["folder", "▤", "Open the folder"]);
    return q;
  }
  const sharedWith = t => tools.filter(x => x !== t && x.kind === "web" && t.kind === "web" && x.port === t.port).map(x => x.name).join(", ");
  function paintQuick() {
    document.querySelectorAll("#tiles .tile[data-go]").forEach(tile => {
      const t = byId(tile.dataset.go); if (!t) return;
      const q = quickFor(t), sig = q.map(x => x[0]).join();
      let row = tile.querySelector(".tq-row");
      if (row && row.dataset.sig === sig) return;
      const fresh = !row;
      if (!row) { row = document.createElement("span"); row.className = "tq-row"; tile.append(row); }
      row.dataset.sig = sig;
      row.innerHTML = q.map(([k, ic, tip], i) => `<span class="tq${k === "stop" ? " danger" : ""}" role="button" tabindex="0" data-q="${k}" title="${esc(tip)}" aria-label="${esc(tip)}: ${esc(t.name)}" style="--i:${i}">${ic}</span>`).join("");
      if (!fresh) row.querySelectorAll(".tq").forEach(b => anim(b, [{ transform: "scale(.3) rotate(-40deg)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 380, delay: +b.style.getPropertyValue("--i") * 50, easing: spring, fill: "backwards" }));
    });
  }
  async function quick(k, t, btn) {
    if (k === "bgstart") {
      btn.classList.add("busy");
      document.querySelectorAll(`[data-go="${t.id}"]`).forEach(n => { n.classList.add("booting"); n.dataset.boot = "Starting"; });
      try { await api(`/api/start/${t.id}`, { method: "POST" }); toast(t.name + " is running"); }
      catch (e) { toast(e.message, true); }
      document.querySelectorAll(`[data-go="${t.id}"]`).forEach(n => { n.classList.remove("booting"); delete n.dataset.boot; });
      btn.classList.remove("busy");
      return load(true).catch(() => {});
    }
    if (window.qtToolAct) return window.qtToolAct(k, t);
  }
  const onQuick = e => {
    const b = e.target.closest(".tq"); if (!b) return false;
    e.stopImmediatePropagation(); e.preventDefault();
    if (e.type === "click" || e.key === "Enter" || e.key === " ") {
      const t = byId(b.closest(".tile").dataset.go);
      if (t && !b.classList.contains("busy")) quick(b.dataset.q, t, b);
    }
    return true;
  };
  addEventListener("click", onQuick, true);   // window capture: runs before the tile morph and the open handler
  addEventListener("keydown", e => { if (e.target.closest && e.target.closest(".tq") && (e.key === "Enter" || e.key === " ")) onQuick(e); }, true);
  addEventListener("pointerdown", e => { if (e.target.closest && e.target.closest(".tq")) e.stopPropagation(); }, true);   // no tile drag / splat from the little buttons
  new MutationObserver(paintQuick).observe(document.getElementById("tiles"), { childList: true });
  const prevLoad = load;
  load = async function (force) { const r = await prevLoad(force); paintQuick(); return r; };

  /* =========================================================================================
     5. RECENT FILES on home: the files you opened in Peek lately, one click back in
     ========================================================================================= */
  const rf = document.createElement("section");
  rf.className = "recentf"; rf.id = "recentf"; rf.setAttribute("aria-label", "Recent files"); rf.hidden = true;
  (document.getElementById("glance") || document.querySelector(".hero")).after(rf);
  const extOf = n => { const m = /\.([^.\\/]+)$/.exec(n || ""); return m ? m[1].toLowerCase() : ""; };
  const shortDir = d => String(d || "").replace(/^C:\\Users\\[^\\]+/i, "~");
  function paintRecentFiles(force) {
    const on = window.qtPeekOn ? window.qtPeekOn() : true;
    const list = (window.qtPeekRecent ? window.qtPeekRecent() : []).slice(0, 8);
    rf.hidden = !on || !list.length || current !== "home";
    if (rf.hidden) return;
    const sig = list.map(x => x.path).join("|");
    if (!force && rf.dataset.sig === sig) return;
    rf.dataset.sig = sig;
    rf.innerHTML = `<div class="rf-head"><h2>Pick up where you left off</h2><span class="qt-muted">Files you opened lately</span>
        <button class="qt-btn ghost" data-rf="all" title="Search recent files and everything else (Ctrl+K)">⌕ <span>All recent</span></button></div>
      <div class="rf-row">${list.map((x, i) => {
        const k = window.qtPeekKind ? window.qtPeekKind(x.name) : "", app = window.qtPeekApp ? window.qtPeekApp(x.name) : "code";
        const pic = (k === "image" || k === "picture") && extOf(x.name) !== "ico";
        return `<button class="rf-card qt-card" data-path="${esc(x.path)}" data-tool="${esc(app)}" style="--i:${i}" title="${esc(x.path)}">
          <span class="rf-th">${pic ? `<img loading="lazy" alt="" src="/api/peek/render?s=240&path=${encodeURIComponent(x.path)}" onerror="this.remove()">` : ""}
            <img class="rf-app" src="/icons/${esc(app)}.svg" alt=""><b>${esc(extOf(x.name).slice(0, 5) || "?")}</b></span>
          <span class="rf-nm"><b>${esc(x.name)}</b><small>${esc(shortDir(x.dir))}</small></span>
          <span class="rf-x" role="button" tabindex="-1" data-rf="forget" title="Forget this one" aria-label="Forget ${esc(x.name)}">✕</span></button>`;
      }).join("")}</div>`;
  }
  rf.addEventListener("click", e => {
    if (e.target.closest('[data-rf="all"]')) return window.qtPalOpen && window.qtPalOpen();
    const card = e.target.closest(".rf-card"); if (!card) return;
    if (e.target.closest('[data-rf="forget"]')) {
      e.stopPropagation();
      const keep = window.qtPeekRecent().filter(x => x.path !== card.dataset.path);
      lsSet("qt-peek-recent", keep);
      const a = anim(card, [{ transform: "none", opacity: 1 }, { transform: "scale(.6) rotate(-6deg) translateY(14px)", opacity: 0 }], { duration: 240, easing: "ease-in", fill: "forwards" });
      (a ? a.finished : Promise.resolve()).then(() => paintRecentFiles(true));
      return;
    }
    const r = card.getBoundingClientRect();
    window.qtPeek && window.qtPeek(card.dataset.path, { list: [...rf.querySelectorAll(".rf-card")].map(c => c.dataset.path), from: { x: r.left + r.width / 2, y: r.top + r.height / 2 } });
  });
  addEventListener("qt-peek-close", () => setTimeout(paintRecentFiles, 250));
  addEventListener("storage", e => { if (e.key === "qt-peek-recent") paintRecentFiles(); });
  document.addEventListener("qt-show", e => { if (e.detail === "home") paintRecentFiles(true); else rf.hidden = true; });
  document.addEventListener("qt-settings", () => paintRecentFiles());
  setTimeout(paintRecentFiles, 400);

  /* =========================================================================================
     7. Ctrl+E RECENT-TOOL SWITCHER: hold Ctrl, tap E to step back through the tools you used, let go to jump
        (+ suite shortcuts reach the hub from inside every tool: qt-bridge.js and same-origin frames)
     ========================================================================================= */
  let sw = null;   // { el, ids, sel }
  function mruIds() {
    const rec = lsGet("qt-recent", []).filter(id => byId(id));
    const ids = [];
    const add = id => { if (id && !ids.includes(id)) ids.push(id); };
    add(byId(current) ? current : current === "home" ? "home" : "");
    rec.forEach(add);
    add("home");
    tools.forEach(t => { if (ids.length < 7 && t.kind !== "folder") add(t.id); });
    return ids.slice(0, 8);
  }
  const nameOf = id => id === "home" ? "Home" : (byId(id) || {}).name || id;
  const iconOf = id => id === "home" ? "/icons/suite.svg" : `/icons/${id}.svg`;
  function openSwitcher(back) {
    const ids = mruIds();
    if (ids.length < 2) return toast("Open a couple of tools first");
    const el = document.createElement("div");
    el.className = "mru-wrap";
    el.innerHTML = `<div class="mru qt-card" role="listbox" aria-label="Recent tools" tabindex="-1">
        <div class="mru-row">${ids.map((id, i) => `<button class="mru-item" role="option" data-i="${i}" data-tool="${id === "home" ? "home" : id}" style="--i:${i}">
          <span class="mru-ic"><img src="${iconOf(id)}" alt=""></span><b>${esc(nameOf(id))}</b>${i === 0 ? "<em>now</em>" : ""}</button>`).join("")}<span class="mru-sel"></span></div>
        <div class="mru-foot qt-mono">hold <kbd>Ctrl</kbd> tap <kbd>E</kbd> · let go to jump · <kbd>Shift</kbd> goes back</div></div>`;
    document.body.append(el);
    sw = { el, ids, sel: 0 };
    el.querySelector(".mru").focus({ preventScroll: true });   // pulls focus out of a tool frame so the Ctrl release lands here
    el.addEventListener("click", e => { const b = e.target.closest(".mru-item"); if (b) { sw.sel = +b.dataset.i; commitSwitcher(); } else if (e.target === el) closeSwitcher(); });
    el.addEventListener("mousemove", e => { const b = e.target.closest(".mru-item"); if (b && +b.dataset.i !== sw.sel) { sw.sel = +b.dataset.i; paintSel(); } });
    stepSwitcher(back ? -1 : 1);
  }
  function paintSel(instant) {
    if (!sw) return;
    const items = sw.el.querySelectorAll(".mru-item"), it = items[sw.sel], bar = sw.el.querySelector(".mru-sel");
    items.forEach((b, i) => b.classList.toggle("on", i === sw.sel));
    bar.style.transition = instant ? "none" : "";
    bar.style.transform = `translateX(${it.offsetLeft}px)`; bar.style.width = it.offsetWidth + "px"; bar.dataset.tool = it.dataset.tool;
    bar.setAttribute("data-tool", it.dataset.tool);
  }
  function stepSwitcher(d) { if (!sw) return; sw.sel = (sw.sel + d + sw.ids.length) % sw.ids.length; paintSel(); }
  function closeSwitcher() { if (!sw) return; const el = sw.el; sw = null; el.classList.add("out"); setTimeout(() => el.remove(), 200); }
  function commitSwitcher() {
    if (!sw) return;
    const id = sw.ids[sw.sel], it = sw.el.querySelectorAll(".mru-item")[sw.sel];
    it && it.classList.add("go");
    closeSwitcher();
    if (id !== current) show(id);
  }
  document.addEventListener("keydown", e => {
    if (sw) {
      if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); return closeSwitcher(); }
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); return stepSwitcher(e.key === "ArrowRight" ? 1 : -1); }
      if (e.key === "Enter") { e.preventDefault(); return commitSwitcher(); }
    }
    if (e.ctrlKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === "e") {
      e.preventDefault(); e.stopImmediatePropagation();
      if (document.querySelector(".pal-wrap, .pk")) return;
      return sw ? stepSwitcher(e.shiftKey ? -1 : 1) : openSwitcher(e.shiftKey);
    }
  }, true);
  document.addEventListener("keyup", e => { if (sw && (e.key === "Control" || e.key === "Meta")) commitSwitcher(); });
  addEventListener("blur", () => setTimeout(() => { if (sw && !document.hasFocus()) closeSwitcher(); }, 120));

  // keys passed up from tools on other ports (qt-bridge.js): replay them here as if pressed in the hub
  addEventListener("message", e => {
    const d = e.data;
    if (!d || d.qt !== "key" || !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(e.origin)) return;
    if (!["k", "e", "[", "]", "\\", ","].includes(d.key)) return;
    if (d.key === "e" && sw) return stepSwitcher(d.shift ? -1 : 1);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: d.key, ctrlKey: true, shiftKey: !!d.shift, bubbles: true, cancelable: true }));
  });
  // same-origin tools (Pictures, Inkmotion, ...): the same keys straight from their frames
  document.getElementById("frames").addEventListener("load", e => {
    let w; try { w = e.target.contentWindow; w.document; } catch (_) { return; }
    if (!w || w.__qtFlowKeys) return;
    w.__qtFlowKeys = true;
    w.addEventListener("keydown", ev => {
      if (!ev.ctrlKey || ev.altKey || ev.defaultPrevented) return;
      const k = ev.key.length === 1 ? ev.key.toLowerCase() : "";
      if (!["e", "[", "]", "\\", ","].includes(k)) return;
      ev.preventDefault();
      if (k === "e" && sw) return stepSwitcher(ev.shiftKey ? -1 : 1);
      document.dispatchEvent(new KeyboardEvent("keydown", { key: k, ctrlKey: true, shiftKey: ev.shiftKey, bubbles: true, cancelable: true }));
    });
  }, true);

  /* =========================================================================================
     8. PALETTE: Ctrl+Enter opens a tool beside the one you're in; a pasted path opens straight in Peek
     ========================================================================================= */
  document.addEventListener("keydown", e => {
    if (!document.querySelector(".pal-wrap") || e.key !== "Enter" || !e.ctrlKey) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const c = window.qtPalSel && window.qtPalSel(), t = c && c.tool;
    if (!t) return toast("Ctrl+Enter works on a tool: it opens beside the one you're in", true);
    window.qtPalClose && window.qtPalClose();
    const here = byId(current);
    if (!here || here.kind === "folder") return show(t.id);
    if (here.id === t.id) return toast(`${t.name} is already open`);
    if (PHONE.matches) return show(t.id);
    window.qtAct && window.qtAct("split", t);
  }, true);
  const asPath = q => {
    const s = String(q || "").trim().replace(/^["']|["']$/g, "");
    return /^([a-zA-Z]:[\\/]|\\\\[^\\]+\\)/.test(s) && s.length > 3 ? s.replace(/\//g, "\\") : "";
  };
  const prevExtra = window.qtPalExtra;
  window.qtPalExtra = q => {
    const out = prevExtra ? prevExtra(q) : [];
    const raw = document.querySelector(".pal-wrap input")?.value || q;   // the palette lower-cases q: use what was typed
    const path = asPath(raw);
    if (!path) return out;
    const name = path.replace(/[\\]+$/, "").split("\\").pop() || path;
    out.push({ label: `Peek at ${name}`, sub: "the path you typed", path, fixed: 999, glyph: "👁", words: path,
      run: () => window.qtPeek ? window.qtPeek(path) : null, alt: () => window.qtRevealInBurrow && window.qtRevealInBurrow(path) });
    out.push({ label: `Show ${name} in Burrow`, path, fixed: 998, glyph: "↗", words: path, minor: true, ic: "/icons/burrow.svg",
      run: () => window.qtRevealInBurrow && window.qtRevealInBurrow(path, true) });
    return out;
  };

  /* =========================================================================================
     9. TRAY: "Search" opens the palette (tray.js asks for it; a fresh window comes in on #search)
     ========================================================================================= */
  (function searchRoute() {
    if (location.hash !== "#search") return;
    if (!tools.length || !window.qtPalOpen) return setTimeout(searchRoute, 80);
    history.replaceState(null, "", location.pathname);
    window.qtPalOpen();
  })();

  /* =========================================================================================
     10. DROP A FILE ON A RAIL APP: Pictures, Player, ... (or the Files button) opens it right there
     ========================================================================================= */
  const hasFiles = e => e.dataTransfer && [...(e.dataTransfer.types || [])].includes("Files");
  function dropTarget(e) {
    const n = e.target && e.target.closest && e.target.closest("#nav .nav");
    if (!n) return null;
    if (n.classList.contains("nav-group")) return { el: n, app: "auto" };
    const t = byId(n.dataset.go);
    return t && fileTools().includes(t) ? { el: n, app: t.id } : null;
  }
  let dropEl = null;
  function markDrop(el, label) {
    if (dropEl === el) return;
    if (dropEl) {
      dropEl.classList.remove("drop-on"); dropEl.querySelector(".ic")?.getAnimations().forEach(a => a.cancel());
      const nm = dropEl.querySelector(".nm"); if (nm && nm.dataset.was != null) { nm.textContent = nm.dataset.was; delete nm.dataset.was; }
    }
    dropEl = el;
    document.documentElement.classList.toggle("pk-drag-app", !!el);
    if (el) {
      el.classList.add("drop-on");
      const nm = el.querySelector(".nm"); if (nm) { nm.dataset.was = nm.textContent; nm.textContent = label; } anim(el.querySelector(".ic"), [{ transform: "none" }, { transform: "scale(1.3) rotate(-10deg)" }, { transform: "scale(1.15)" }], { duration: 300, easing: spring, fill: "forwards" }); }
  }
  document.addEventListener("dragover", e => {
    if (!hasFiles(e) || (window.qtPeekOn && !window.qtPeekOn())) return;
    const d = dropTarget(e);
    markDrop(d && d.el, d ? (d.app === "auto" ? "Open in the right app" : `Open in ${byId(d.app).name}`) : "");
    if (d) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }
  }, true);
  document.addEventListener("dragleave", e => { if (!e.relatedTarget || !(e.relatedTarget.closest && e.relatedTarget.closest("#nav"))) markDrop(null); }, true);
  addEventListener("dragend", () => markDrop(null));
  document.addEventListener("drop", e => {
    const d = hasFiles(e) && (!window.qtPeekOn || window.qtPeekOn()) && dropTarget(e);
    markDrop(null);
    if (!d) return;
    e.preventDefault(); e.__qtTaken = true;
    const files = [...e.dataTransfer.files];
    if (!files.length) return;
    const app = d.app === "auto" ? (window.qtPeekApp ? window.qtPeekApp(files[0].name) : "code") : d.app;
    openFilesInApp(byId(app) ? app : fileTools()[0].id, files);
  }, true);
  async function openFilesInApp(app, files) {
    show(app);
    for (let n = 0; n < 60; n++) {
      const f = frames[app] && frames[app].querySelector("iframe");
      let w = null; try { w = f && f.contentWindow; } catch (_) {}
      if (w && w.qtPeekFiles && w.QT_READY) return w.qtPeekFiles(files);
      await new Promise(r => setTimeout(r, 100));
    }
    toast("That app didn't load", true);
  }
  window.qtOpenFilesInApp = openFilesInApp;

  /* =========================================================================================
     11-20. MOTION
     ========================================================================================= */
  const calm = () => RM.matches;

  // 11. Files flyout: the apps fan out of the Files button and fold back into it
  const baseOpenFly = openFly;
  openFly = function (btn) {
    const wasOpen = !!fly;
    baseOpenFly(btn);
    if (wasOpen || !fly || calm()) return;
    const br = btn.getBoundingClientRect();
    fly.querySelectorAll(".fly-item").forEach((it, i) => {
      const r = it.getBoundingClientRect();
      it.style.animation = "none";
      anim(it, [{ transform: `translate(${br.left + 20 - r.left}px, ${br.top + br.height / 2 - r.top - r.height / 2}px) scale(.35) rotate(${-24 + i * 9}deg)`, opacity: 0 },
        { transform: "translate(6px,0) scale(1.04)", opacity: 1, offset: .7 }, { transform: "none", opacity: 1 }],
        { duration: 460, delay: 40 + i * 42, easing: "cubic-bezier(.2,.9,.3,1.1)", fill: "backwards" });
    });
    anim(btn.querySelector(".ic"), [{ transform: "none" }, { transform: "scale(.82,1.15)" }, { transform: "scale(1.12,.9) rotate(-8deg)" }, { transform: "none" }], { duration: 420, easing: "ease-out" });
  };
  const baseCloseFly = closeFly;
  closeFly = function () {
    if (!fly || calm()) return baseCloseFly();
    const btn = nav.querySelector(".nav-group"), br = btn && btn.getBoundingClientRect();
    if (br) fly.querySelectorAll(".fly-item").forEach((it, i) => {
      const r = it.getBoundingClientRect();
      anim(it, [{ transform: "none", opacity: 1 }, { transform: `translate(${br.left + 20 - r.left}px, ${br.top + br.height / 2 - r.top - r.height / 2}px) scale(.3)`, opacity: 0 }],
        { duration: 200, delay: i * 18, easing: "ease-in", fill: "forwards" });
    });
    baseCloseFly();
  };

  // 12. rail badges: squash-bounce when the number grows, and a little "+n" floats off
  document.addEventListener("qt-badge", e => {
    const b = e.detail; if (!b || calm()) return;
    anim(b, [{ transform: "scale(1)" }, { transform: "scale(1.7,.6)" }, { transform: "scale(.8,1.3) translateY(-4px)" }, { transform: "scale(1.1,.9)" }, { transform: "none" }], { duration: 620, easing: "ease-out" });
    const navEl = b.closest(".nav"); if (!navEl) return;
    anim(navEl.querySelector(".ic"), [{ transform: "none" }, { transform: "rotate(-16deg)" }, { transform: "rotate(12deg)" }, { transform: "rotate(-6deg)" }, { transform: "none" }], { duration: 600, easing: "ease-out" });
  });

  // 13. quick actions: a stamp on the tile when the action lands, a shiver when it stops
  const prevQuick = quick;
  quick = async function (k, t, btn) {
    const tile = btn.closest(".tile");
    if (k === "stop" && !calm()) anim(tile, [{ transform: "none" }, { transform: "translateX(-4px) rotate(-.6deg)" }, { transform: "translateX(4px) rotate(.6deg)" }, { transform: "translateX(-2px)" }, { transform: "none" }], { duration: 380 });
    await prevQuick(k, t, btn);
    if (!["bgstart", "restart", "stop"].includes(k) || calm()) return;
    const live = document.querySelector(`#tiles .tile[data-go="${t.id}"]`) || tile;
    const st = document.createElement("span");
    st.className = "tq-stamp" + (k === "stop" ? " off" : "");
    st.textContent = k === "stop" ? "STOPPED" : k === "restart" ? "FRESH" : "ON!";
    live.append(st);
    st.addEventListener("animationend", () => st.remove());
  };

  // 14. recent files: a newly opened file slides in at the front and the rest shuffle along (FLIP)
  const basePaintRecent = paintRecentFiles;
  paintRecentFiles = function (force) {
    const before = new Map([...rf.querySelectorAll(".rf-card")].map(c => [c.dataset.path, c.getBoundingClientRect()]));
    const hadSig = rf.dataset.sig;
    basePaintRecent(force);
    if (!before.size || calm() || rf.hidden || rf.dataset.sig === hadSig && !force) return;
    rf.querySelectorAll(".rf-card").forEach(c => {
      const was = before.get(c.dataset.path);
      c.style.animation = "none";
      if (!was) return anim(c, [{ transform: "translateX(-60px) rotate(-10deg) scale(.7)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 520, easing: spring });
      const n = c.getBoundingClientRect(), dx = was.left - n.left;
      if (dx) anim(c, [{ transform: `translateX(${dx}px)` }, { transform: "none" }], { duration: 480, easing: spring });
    });
  };
  rf.addEventListener("pointerdown", e => {
    const c = e.target.closest(".rf-card"); if (!c || e.target.closest(".rf-x")) return;
    anim(c.querySelector(".rf-th"), [{ transform: "none" }, { transform: "scale(.92,.86)" }, { transform: "scale(1.04)" }, { transform: "none" }], { duration: 380, easing: "ease-out" });
  });

  // 15. switcher: the chosen tool's icon zooms up to fill the screen as you let go
  const baseCommit = commitSwitcher;
  commitSwitcher = function () {
    if (sw && !calm()) {
      const it = sw.el.querySelectorAll(".mru-item")[sw.sel], ic = it && it.querySelector(".mru-ic");
      if (ic && sw.ids[sw.sel] !== current) {
        const r = ic.getBoundingClientRect(), ghost = ic.cloneNode(true);
        ghost.className = "mru-ghost"; ghost.dataset.tool = it.dataset.tool;
        Object.assign(ghost.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
        document.body.append(ghost);
        const s = Math.max(innerWidth, innerHeight) / r.width * 1.4;
        anim(ghost, [{ transform: "none", opacity: 1 }, { transform: `translate(${innerWidth / 2 - r.left - r.width / 2}px, ${innerHeight / 2 - r.top - r.height / 2}px) scale(2.2) rotate(-6deg)`, opacity: 1, offset: .45 },
          { transform: `translate(${innerWidth / 2 - r.left - r.width / 2}px, ${innerHeight / 2 - r.top - r.height / 2}px) scale(${s})`, opacity: 0 }], { duration: 560, easing: "cubic-bezier(.6,0,.3,1)" })
          ?.finished.then(() => ghost.remove(), () => ghost.remove());
        window.qtSkipWipe = true;
      }
    }
    baseCommit();
  };
  const baseStepSw = stepSwitcher;
  stepSwitcher = function (d) {
    baseStepSw(d);
    if (!sw) return;
    const ic = sw.el.querySelectorAll(".mru-item")[sw.sel]?.querySelector(".mru-ic");
    anim(ic, [{ scale: "1 1" }, { scale: "1.2 .8" }, { scale: ".92 1.1" }, { scale: "1 1" }], { duration: 360, easing: "ease-out" });
  };

  // 16. home headline: words drop in with a squash once per session; the highlight gets an ink underline swipe
  (function hero() {
    const h = document.querySelector(".hero h1"); if (!h || h.dataset.split) return;
    h.dataset.split = "1";
    const hl = h.querySelector(".hl");
    if (hl) hl.insertAdjacentHTML("beforeend", '<svg class="hl-swipe" viewBox="0 0 300 20" preserveAspectRatio="none" aria-hidden="true"><path d="M4 13 C 70 4, 150 18, 296 7"/></svg>');
    if (calm() || sessionStorage.getItem("qt-hero")) return;
    sessionStorage.setItem("qt-hero", "1");
    h.classList.add("hero-drop");
    let i = 0;
    const wrap = node => {
      [...node.childNodes].forEach(n => {
        if (n.nodeType === 3 && n.textContent.trim()) {
          const f = document.createDocumentFragment();
          n.textContent.split(/(\s+)/).forEach(w => {
            if (!w.trim()) return f.append(w);
            const s = document.createElement("span"); s.className = "hw"; s.style.setProperty("--w", i++); s.textContent = w; f.append(s);
          });
          n.replaceWith(f);
        } else if (n.nodeType === 1 && !n.matches("svg")) wrap(n);
      });
    };
    wrap(h);
  })();

  // 17. toasts: a fuse burns down along the bottom; the rest of the stack slides into the gap
  const toastBox = document.getElementById("toasts");
  if (toastBox) {
    new MutationObserver(ms => {
      for (const m of ms) m.addedNodes.forEach(n => { if (n.nodeType === 1 && n.classList.contains("qt-toast") && !n.querySelector(".fuse")) {
        const f = document.createElement("i"); f.className = "fuse"; f.style.setProperty("--life", n.classList.contains("act-toast") ? "12s" : "2.4s"); n.append(f);
      } });
    }).observe(toastBox, { childList: true });
    let pos = new Map();
    const snap = () => { pos = new Map([...toastBox.children].map(c => [c, c.getBoundingClientRect().top])); };
    new MutationObserver(ms => {
      if (calm() || !ms.some(m => m.removedNodes.length)) return snap();
      for (const c of toastBox.children) {
        const was = pos.get(c); if (was == null) continue;
        const dy = was - c.getBoundingClientRect().top;
        if (dy) anim(c, [{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 380, easing: spring, composite: "add" });
      }
      snap();
    }).observe(toastBox, { childList: true });
    setInterval(snap, 400);
  }

  // 18. settings switches: the knob squashes as it flies, and a "saved" tick pops beside it
  document.addEventListener("click", e => {
    const s = e.target.closest(".settings .qt-switch[data-sw], .settings .seg [data-v]");
    if (!s || calm()) return;
    const host = s.closest(".sline, .srow, .seg") || s;
    setTimeout(() => {
      const tick = document.createElement("span");
      tick.className = "saved-tick"; tick.textContent = "✓ saved";
      const r = s.getBoundingClientRect();
      Object.assign(tick.style, { left: r.left + r.width / 2 + "px", top: r.top - 6 + "px" });
      document.body.append(tick);
      tick.addEventListener("animationend", () => tick.remove());
    }, 260);
    if (s.classList.contains("qt-switch")) { s.classList.remove("flick"); void s.offsetWidth; s.classList.add("flick"); }
    if (host.classList) { host.classList.remove("pulse"); void host.offsetWidth; host.classList.add("pulse"); }
  });

  // 19. palette: results glide to their new places as you type; no match gives the box a shake
  let palPos = null;
  document.addEventListener("input", e => {
    if (!e.target.closest || !e.target.closest(".pal-in")) return;
    palPos = new Map([...document.querySelectorAll(".pal-item")].map(b => [b.textContent.trim(), b.getBoundingClientRect().top]));
    requestAnimationFrame(() => {
      if (calm() || !palPos) return;
      const items = document.querySelectorAll(".pal-item");
      items.forEach(b => {
        const was = palPos.get(b.textContent.trim());
        b.style.animation = was == null ? "" : "none";
        if (was == null) return;
        const dy = was - b.getBoundingClientRect().top;
        if (Math.abs(dy) > 1) anim(b, [{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 300, easing: "cubic-bezier(.2,.9,.3,1.15)" });
      });
      if (!items.length) anim(document.querySelector(".pal"), [{ transform: "none" }, { transform: "translateX(-7px) rotate(-.5deg)" }, { transform: "translateX(6px) rotate(.5deg)" }, { transform: "translateX(-3px)" }, { transform: "none" }], { duration: 340 });
      palPos = null;
    });
  }, true);

  // 20. rail pill: stretches along the way when it has far to travel, then lands with a squash
  let pillAt = null;
  const baseMovePill = movePill;
  movePill = function () {
    baseMovePill();
    const pill = nav.querySelector(".nav-pill"), on = nav.querySelector(".nav.on");
    if (!pill || !on) { pillAt = null; return; }
    const at = PHONE.matches ? on.offsetLeft : on.offsetTop;
    if (pillAt != null && !calm()) {
      const far = Math.abs(at - pillAt) / (PHONE.matches ? on.offsetWidth : on.offsetHeight);
      if (far > 1.5) {
        const k = Math.min(1.9, 1 + far * .12);
        pill.classList.remove("boing");
        anim(pill, [{ scale: "1 1" }, PHONE.matches ? { scale: `${k} .8`, offset: .3 } : { scale: `.86 ${k}`, offset: .3 }, { scale: "1.08 .86", offset: .75 }, { scale: "1 1" }], { duration: 560, easing: "ease-out" });
      }
    }
    pillAt = at;
  };

  window.qtFlow = { openFly: b => openFly(b), closeFly: () => closeFly(), slots, openSwitcher: b => openSwitcher(b) };
  if (tools.length) { nav.dataset.sig = ""; renderNav(); }
})();
