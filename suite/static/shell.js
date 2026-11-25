"use strict";
/* QT Suite shell layer (loaded after hub.js and hub-plus.js; uses their globals).
   1 Settings page          2 drag to reorder rail + tiles   3 Start my set / Stop all, shortcut sheet, Ctrl+[ ]
   4 Today strip on home    5 Ctrl+K finds files via Burrow   6 split view   7 activity log + crash alerts
   8-10 motion: tile morph, FLIP drag, odometer numbers, split open, badge + bell, splash */
(() => {
  const RM = matchMedia("(prefers-reduced-motion: reduce)");
  const PHONE = matchMedia("(max-width: 600px)");
  const root = document.documentElement;
  const stage = document.getElementById("stage");
  const byId = id => tools.find(t => t.id === id);
  const post = (p, b) => api(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b || {}) });
  const typing = e => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
  const isTool = id => !!byId(id);
  const spring = "cubic-bezier(.34,1.8,.5,1)";
  const anim = (el, kf, o) => (RM.matches || !el || !el.animate) ? null : el.animate(kf, o);
  window.qtViews = { settings: true };
  let S = { order: [], hidden: [], boot: [], motion: "system", rail: "full", launch: "home", last: "", glance: true, split: null, peek: true };
  window.qtPeekOn = () => S.peek !== false;
  window.qtS = () => S;   // flow.js reads the saved settings (group, revive)
  let allTools = [];   // every tool incl. hidden (settings page)

  /* ---------- settings store ---------- */
  function applyLook() {
    root.classList.toggle("qt-compact", S.rail === "compact");
    root.classList.toggle("qt-calm", S.motion === "calm");
    window.qtMotion = S.motion;
    try { localStorage.setItem("qt-shell", JSON.stringify({ rail: S.rail, motion: S.motion, group: S.group !== false })); } catch (_) {}
    document.dispatchEvent(new CustomEvent("qt-settings"));
    setTimeout(movePill, 260);
  }
  let saveSeq = 0, saving = 0;
  async function saveS(patch) {
    Object.assign(S, patch);
    applyLook();
    const my = ++saveSeq; saving++;
    try { const got = (await post("/api/settings", patch)).settings; if (my === saveSeq) { S = got; applyLook(); } }   // an older answer must not undo a newer click
    catch (e) { toast("Couldn't save: " + e.message, true); }
    finally { saving--; }
    return S;
  }
  async function relayout() {
    document.querySelectorAll("#nav .nav").forEach(n => n.remove());
    lastSig = "";
    await load(true);
    if (current === "home") renderHome();
  }
  function sigNow() { return JSON.stringify(tools.map(t => [t.id, t.status, (t.files || []).length])); }

  /* reorder the live tools array + rail + tiles without rebuilding (no entrance replays) */
  function reorderTo(ids) {
    const rank = new Map(ids.map((id, i) => [id, i]));
    tools.sort((a, b) => (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999));
    const nav = document.getElementById("nav"), tiles = document.getElementById("tiles");
    for (const t of tools) {
      const n = nav.querySelector(`.nav[data-go="${t.id}"]`); if (n) nav.append(n);
      const x = tiles.querySelector(`.tile[data-go="${t.id}"]`); if (x) tiles.append(x);
    }
    tools.forEach((t, i) => { const n = nav.querySelector(`.nav[data-go="${t.id}"]`); if (n) n.title = `${t.name} (Ctrl+${i + 1})`; });
    lastSig = sigNow();
    movePill();
    const hidden = S.order.filter(id => !rank.has(id));
    return saveS({ order: [...ids, ...hidden, ...S.hidden.filter(id => !ids.includes(id) && !hidden.includes(id))] });
  }

  /* ---------- route wrapper: settings view, split view, remember last tool ---------- */
  const prevShow = show;
  show = function (id) {
    if (id === "settings") ensureSettings();
    if (split.on && id !== split.a && id !== split.b) exitSplit();
    prevShow(id);
    if (id === "settings") renderSettings();
    if (split.on) layoutSplit(id);
    if (id === "home") paintGlance(true);
    if (isTool(id) && S.launch === "last") { clearTimeout(show.t); show.t = setTimeout(() => saveS({ last: id }), 600); }
  };

  /* =========================================================================================
     1. SETTINGS
     ========================================================================================= */
  let setEl;
  function ensureSettings() {
    if (setEl) return;
    setEl = frames.settings = document.createElement("section");
    setEl.className = "view panel settings qt-dots";
    setEl.dataset.tool = "home";
    setEl.hidden = true;
    document.getElementById("frames").append(setEl);
  }
  const seg = (k, opts) => `<div class="seg" data-k="${k}" role="radiogroup"><span class="thumb"></span>${opts.map(([v, l]) =>
    `<button role="radio" data-v="${v}" aria-checked="${S[k] === v}">${l}</button>`).join("")}</div>`;
  const sw = (k, on, label, extra = "") => `<button class="qt-switch" role="switch" aria-checked="${!!on}" data-sw="${k}" aria-label="${esc(label)}" ${extra}></button>`;
  const KEYS = [["Ctrl", "K"], "Search tools, actions and files", ["Ctrl", "1-9"], "Jump to a tool", ["Ctrl", "E"], "Recent tools (hold Ctrl, tap E)", ["Ctrl", "0"], "Home",
    ["Ctrl", "["], "Previous tool", ["Ctrl", "]"], "Next tool", ["Ctrl", "\\"], "Split view on or off", ["Ctrl", ","], "Settings",
    ["?"], "This list", ["Shift", "Enter"], "In search: show a file in Burrow", ["Right-click"], "Tool menu (long-press on touch)", ["Drag"], "Reorder the rail or home tiles"];
  window.qtKeys = KEYS;   // spark.js adds its own rows
  const keyRows = () => { let h = ""; for (let i = 0; i < KEYS.length; i += 2) h += `<div class="krow" style="--i:${i / 2}"><span>${KEYS[i].map(k => `<kbd>${esc(k)}</kbd>`).join("")}</span><em>${esc(KEYS[i + 1])}</em></div>`; return h; };

  let renderSeq = 0;
  async function renderSettings() {
    ensureSettings();
    const my = ++renderSeq;
    try {
      const [r, all] = await Promise.all([api("/api/settings"), api("/api/tools?all=1")]);
      if (my !== renderSeq) return;   // a newer render is on its way
      if (!saving) { S = r.settings; applyLook(); }   // a save in flight is newer than this read
      allTools = all;
      setEl.dataset.file = r.data;
    } catch (e) { setEl.innerHTML = `<p class="qt-muted">Couldn't read settings: ${esc(e.message)}</p>`; return; }
    const shared = t => allTools.filter(x => x !== t && x.kind === "web" && t.kind === "web" && x.port === t.port).map(x => x.name);
    let n = 0;
    const rows = allTools.map(t => {
      const num = t.hidden ? "" : ++n;
      const also = shared(t);
      return `<div class="srow${t.hidden ? " off" : ""}" data-id="${t.id}" data-tool="${t.id}">
        <span class="grip" title="Drag to reorder" aria-hidden="true">⠿</span>
        <span class="sic"><img src="/icons/${t.id}.svg" alt=""></span>
        <span class="snm"><b>${esc(t.name)}</b><em>${esc(t.tag)}${also.length ? " · shares a server with " + esc(also.join(", ")) : ""}</em></span>
        <kbd class="snum">${num && num <= 9 ? "Ctrl " + num : num ? "#" + num : "hidden"}</kbd>
        <span class="sopt"><label>${sw("show", !t.hidden, "Show " + t.name)}<span>Show</span></label>
        ${t.kind === "web" ? `<label title="Start ${esc(t.name)} when the suite starts">${sw("boot", t.boot, "Start " + t.name + " with the suite")}<span>Autostart</span></label>` : `<label class="na"><span>opens on demand</span></label>`}</span>
        <span class="sarrows"><button class="qt-btn ghost icon" data-mv="-1" aria-label="Move ${esc(t.name)} up">↑</button><button class="qt-btn ghost icon" data-mv="1" aria-label="Move ${esc(t.name)} down">↓</button></span>
      </div>`;
    }).join("");
    const winOn = document.getElementById("autostart").getAttribute("aria-checked") === "true";
    setEl.innerHTML = `
      <header class="shead"><div class="qt-eyebrow">QT Suite</div><h1 class="qt-display">Settings</h1>
        <p class="lede">Your order, your startup set, your motion. Saved on this PC, so every window agrees.</p></header>
      <section class="sbox qt-card" style="--i:0"><div class="sbh"><h2>Tools</h2><span class="qt-muted">Drag to reorder. Ctrl + number follows this order.</span>
        <button class="qt-btn ghost" data-reset>Reset order</button></div>
        <div class="slist" id="slist">${rows}</div></section>
      <div class="sgrid">
        <section class="sbox qt-card" style="--i:1"><h2>Look and motion</h2>
          <div class="sline"><span><b>Motion</b><em>System follows Windows. Calm turns off the wipes, wobbles and splats.</em></span>${seg("motion", [["system", "System"], ["full", "Full"], ["calm", "Calm"]])}</div>
          <div class="sline"><span><b>Rail</b><em>Compact keeps only the icons.</em></span>${seg("rail", [["full", "Full"], ["compact", "Compact"]])}</div>
          <div class="sline"><span><b>Group file apps</b><em>Pictures, Player, Reader, Code and Archive share one Files button on the rail.</em></span>${sw("group", S.group !== false, "Group file apps")}</div>
          <div class="sline"><span><b>Today strip</b><em>Spend, disk, downloads and phone alerts on Home.</em></span>${sw("glance", S.glance, "Today strip")}</div>
          <div class="sline"><span><b>Open files in the suite</b><em>Pictures, video, music, PDFs, text, code, zips and more open in Peek. Off hands them to their Windows app.</em></span>${sw("peek", S.peek !== false, "Open files in the suite")}</div>
        </section>
        <section class="sbox qt-card" style="--i:2"><h2>Startup</h2>
          <div class="sline"><span><b>Open on</b><em>What a new suite window shows first.</em></span>${seg("launch", [["home", "Home"], ["last", "Last tool"]])}</div>
          <div class="sline"><span><b>Start with Windows</b><em>Runs the suite quietly when you sign in.</em></span>${sw("win", winOn, "Start with Windows")}</div>
          <div class="sline"><span><b>Bring crashed tools back</b><em>When a tool stops on its own, start it again (twice in 10 minutes at most).</em></span>${sw("revive", S.revive, "Bring crashed tools back")}</div>
          <div class="sline"><span><b>Autostart set</b><em>${S.boot.length ? esc(S.boot.map(id => (allTools.find(t => t.id === id) || {}).name).join(", ")) : "None yet. Flip Autostart on a tool above."}</em></span>
            <button class="qt-btn" data-startset ${S.boot.length ? "" : "disabled"}>▶ Start them now</button></div>
        </section>
        <section class="sbox qt-card sdef" style="--i:3" id="sdef"><h2>Windows default apps</h2>
          <div class="sline"><span><b>Open files from Explorer in QT</b><em>Double-click a picture, video, song, PDF, note, text file or zip and it opens in Pictures, Player, Reader, Code or Archive. Programs, Office files and web pages stay where they are.</em></span></div>
          <div class="sline"><span><b>Status</b><em data-defline>Checking...</em></span></div>
          <div class="sline sdef-btns"><button class="qt-btn primary" data-def="on">Add QT to Windows</button>
            <button class="qt-btn" data-def="settings">Pick QT in Windows Settings</button>
            <button class="qt-btn ghost" data-def="off">Undo</button></div>
          <div class="sdef-apps" data-defapps></div>
        </section>
        <section class="sbox qt-card keys" style="--i:4"><h2>Shortcuts</h2><div class="klist">${keyRows()}</div></section>
      </div>
      <p class="qt-muted sfile qt-mono">Saved in ${esc(setEl.dataset.file || "")}</p>`;
    setEl.querySelectorAll(".seg").forEach(s => placeThumb(s, true));
    paintDefaults();
    sortable(setEl.querySelector("#slist"), ".srow", { handle: ".grip", touch: true, onDrop: ids => saveOrderFromSettings(ids) });
  }
  function placeThumb(s, instant) {
    const on = s.querySelector('[aria-checked="true"]'), th = s.querySelector(".thumb");
    if (!on) { th.style.opacity = 0; return; }
    th.style.transition = instant ? "none" : "";
    th.style.opacity = 1; th.style.width = on.offsetWidth + "px"; th.style.transform = `translateX(${on.offsetLeft}px)`;
    if (!instant) anim(th, [{ scale: "1 1" }, { scale: "1.15 .82" }, { scale: ".95 1.06" }, { scale: "1 1" }], { duration: 420, easing: "ease-out" });
  }
  async function saveOrderFromSettings(ids) {
    const visible = ids.filter(id => !S.hidden.includes(id));
    await saveS({ order: ids });
    reorderTo(visible);
    numberRows();
  }
  function numberRows() {
    let n = 0;
    setEl.querySelectorAll(".srow").forEach(r => {
      const k = r.querySelector(".snum"), hid = r.classList.contains("off");
      const num = hid ? 0 : ++n;
      k.textContent = hid ? "hidden" : num <= 9 ? "Ctrl " + num : "#" + num;
    });
  }
  document.addEventListener("click", async e => {
    if (!setEl || !setEl.contains(e.target)) return;
    const segB = e.target.closest(".seg [data-v]");
    if (segB) {
      const s = segB.closest(".seg"), k = s.dataset.k;
      s.querySelectorAll("[data-v]").forEach(b => b.setAttribute("aria-checked", b === segB));
      placeThumb(s);
      await saveS({ [k]: segB.dataset.v });
      if (k === "rail") movePill();
      return;
    }
    const swB = e.target.closest("[data-sw]");
    if (swB) {
      const on = swB.getAttribute("aria-checked") !== "true", k = swB.dataset.sw;
      swB.setAttribute("aria-checked", on);
      const row = swB.closest(".srow"), id = row && row.dataset.id;
      if (k === "win") { document.getElementById("autostart").click(); return; }
      if (k === "glance") { await saveS({ glance: on }); paintGlance(true); return; }
      if (k === "group") { await saveS({ group: on }); await relayout(); return; }
      if (k === "revive") { await saveS({ revive: on }); toast(on ? "Crashed tools come back on their own" : "Crashed tools stay stopped"); return; }
      if (k === "peek") { await saveS({ peek: on }); toast(on ? "Files open in Peek" : "Files open in their Windows app"); return; }
      if (k === "boot") { await saveS({ boot: on ? [...S.boot, id] : S.boot.filter(x => x !== id) }); toast(on ? `${byName(id)} will start with the suite` : `${byName(id)} won't start with the suite`); return renderSettingsSoft(); }
      if (k === "show") {
        if (!on && allTools.filter(t => !t.hidden).length <= 1) { swB.setAttribute("aria-checked", true); return toast("Keep at least one tool on the rail", true); }
        row.classList.toggle("off", !on);
        const nv = document.querySelector(`#nav .nav[data-go="${id}"]`);
        const gone = !on && nv && anim(nv, [{ transform: "none", opacity: 1, height: nv.offsetHeight + "px" }, { transform: "scale(.4) rotate(-8deg)", opacity: 0, height: "0px", paddingBlock: "0px", marginBlock: "-3px" }], { duration: 300, easing: "ease-in", fill: "forwards" });
        await Promise.all([saveS({ hidden: on ? S.hidden.filter(x => x !== id) : [...S.hidden, id] }), gone && gone.finished]);
        const t = allTools.find(x => x.id === id); if (t) t.hidden = !on;
        numberRows();
        await relayout();
        if (on) anim(document.querySelector(`#nav .nav[data-go="${id}"]`), [{ transform: "scale(.3) rotate(10deg)", opacity: 0 }, { transform: "scale(1.12)", opacity: 1, offset: .6 }, { transform: "none" }], { duration: 520, easing: "ease-out" });
        return;
      }
    }
    const mv = e.target.closest("[data-mv]");
    if (mv) {
      const row = mv.closest(".srow"), list = row.parentElement, d = +mv.dataset.mv;
      const sib = d < 0 ? row.previousElementSibling : row.nextElementSibling;
      if (!sib) return;
      flip(list.querySelectorAll(".srow"), () => d < 0 ? list.insertBefore(row, sib) : list.insertBefore(sib, row));
      mv.focus();
      return saveOrderFromSettings([...list.querySelectorAll(".srow")].map(r => r.dataset.id));
    }
    if (e.target.closest("[data-reset]")) { await saveS({ order: [] }); await relayout(); renderSettings(); return toast("Back to the original order"); }
    if (e.target.closest("[data-startset]")) return startSet();
    const def = e.target.closest("[data-def]");
    if (def) {
      const how = def.dataset.def;
      def.disabled = true;
      try {
        const r = await fetch("/api/defaults/" + how, { method: "POST" }).then(r => r.json());
        if (r.ok === false) throw new Error(r.msg || "That didn't work");
        if (how === "on") toast("QT is in Windows now. Pick it for each type in Settings to make it the default");
        if (how === "off") toast("QT is out of Windows' default apps");
        if (how === "settings") toast("In Settings, click each type and choose QT");
      } catch (err) { toast(String(err.message || err), true); }
      def.disabled = false;
      paintDefaults();
    }
  });
  async function paintDefaults() {
    const line = setEl && setEl.querySelector("[data-defline]"), apps = setEl && setEl.querySelector("[data-defapps]");
    if (!line) return;
    let d;
    try { d = await fetch("/api/defaults").then(r => r.json()); } catch (_) { line.textContent = "Couldn't check right now."; return; }
    line.textContent = !d.on ? "Not added to Windows yet."
      : d.ours === d.total ? `QT opens all ${d.total} file types.`
      : `Added. QT opens ${d.ours} of ${d.total} file types (${d.pct}%). Pick it in Windows Settings for the rest.`;
    setEl.querySelector('[data-def="on"]').hidden = d.on;
    setEl.querySelector('[data-def="settings"]').hidden = setEl.querySelector('[data-def="off"]').hidden = !d.on;
    apps.innerHTML = d.on ? d.apps.map(a => `<span class="qt-chip" title="${esc(d.types.filter(t => t.app === a.id).map(t => "." + t.ext + (t.ours ? " (QT)" : " → " + (t.now || "nothing"))).join("\n"))}"><img src="/icons/${a.id}.svg" alt="" width="16" height="16"> ${esc(a.name)} ${a.ours}/${a.total}</span>`).join("") : "";
  }
  addEventListener("focus", () => { if (location.hash === "#settings") paintDefaults(); });   // back from Windows Settings
  const byName = id => (allTools.find(t => t.id === id) || byId(id) || { name: id }).name;
  function renderSettingsSoft() {   // refresh the Autostart summary line only
    const line = [...setEl.querySelectorAll(".sline")].find(l => l.querySelector("[data-startset]"));
    if (!line) return;
    line.querySelector("em").textContent = S.boot.length ? S.boot.map(byName).join(", ") : "None yet. Flip Autostart on a tool above.";
    line.querySelector("[data-startset]").disabled = !S.boot.length;
  }

  /* =========================================================================================
     2. DRAG TO REORDER (rail, home tiles, settings rows) with FLIP motion
     ========================================================================================= */
  function flip(items, mutate) {
    const before = new Map([...items].map(el => [el, el.getBoundingClientRect()]));
    mutate();
    if (RM.matches) return;
    for (const [el, r] of before) {
      const n = el.getBoundingClientRect(), dx = r.left - n.left, dy = r.top - n.top;
      if ((dx || dy) && !el.classList.contains("dragging")) el.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: "none" }], { duration: 380, easing: spring });
    }
  }
  let dragBlockClick = false;
  document.addEventListener("click", e => { if (dragBlockClick) { dragBlockClick = false; e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  function sortable(box, sel, { handle, touch, onDrop, grid }) {
    if (!box || box.dataset.sortable) return;
    box.dataset.sortable = "1";
    box.addEventListener("dragstart", e => e.preventDefault());   // icons are <img>: no native image drag
    box.addEventListener("pointerdown", e => {
      if (e.button) return;
      if (e.pointerType !== "mouse" && !touch) return;
      const item = e.target.closest(sel);
      if (!item || !box.contains(item) || (handle && !e.target.closest(handle))) return;
      if (e.target.closest("button:not(" + sel + "), .qt-switch, input") && !e.target.closest(handle || "#none")) return;
      let ox = e.clientX, oy = e.clientY, live = false;
      const move = ev => {
        const dx = ev.clientX - ox, dy = ev.clientY - oy;
        if (!live) {
          if (Math.hypot(dx, dy) < 7) return;
          live = true; item.classList.add("dragging"); box.classList.add("sorting"); document.body.classList.add("qt-grabbing");
          anim(item, [{ scale: "1" }, { scale: "1.06" }], { duration: 180, easing: spring, fill: "forwards" });
          item.setPointerCapture?.(ev.pointerId);
        }
        ev.preventDefault();
        item.style.transform = `translate(${dx}px,${dy}px) rotate(${Math.max(-4, Math.min(4, dx / 30))}deg)`;
        // which sibling is under the pointer?
        const sibs = [...box.querySelectorAll(sel)].filter(x => x !== item);
        const hit = sibs.find(x => { const r = x.getBoundingClientRect(); return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom; });
        if (!hit) return;
        const r = hit.getBoundingClientRect(), ir = item.getBoundingClientRect();
        const sameRow = Math.abs(r.top - ir.top) < r.height / 2;
        const after = (grid && sameRow) ? ev.clientX > r.left + r.width / 2 : ev.clientY > r.top + r.height / 2;
        if ((after && hit.nextElementSibling === item) || (!after && hit.previousElementSibling === item)) return;
        const pre = item.getBoundingClientRect();
        flip(box.querySelectorAll(sel), () => box.insertBefore(item, after ? hit.nextElementSibling : hit));
        const post2 = item.getBoundingClientRect();
        ox += post2.left - pre.left; oy += post2.top - pre.top;   // keep it under the pointer after the DOM move
        item.style.transform = `translate(${ev.clientX - ox}px,${ev.clientY - oy}px)`;
      };
      const up = () => {
        removeEventListener("pointermove", move); removeEventListener("pointerup", up); removeEventListener("pointercancel", up);
        if (!live) return;
        dragBlockClick = true; setTimeout(() => { dragBlockClick = false; }, 0);
        const from = item.style.transform;
        item.style.transform = "";
        item.getAnimations().forEach(a => a.cancel());
        item.classList.remove("dragging"); box.classList.remove("sorting"); document.body.classList.remove("qt-grabbing");
        anim(item, [{ transform: from + " scale(1.06)" }, { transform: "scale(.94,1.06)", offset: .6 }, { transform: "none" }], { duration: 420, easing: spring });
        onDrop([...box.querySelectorAll(sel)].map(x => x.dataset.id || x.dataset.go));
      };
      addEventListener("pointermove", move, { passive: false }); addEventListener("pointerup", up); addEventListener("pointercancel", up);
    });
  }
  sortable(document.getElementById("nav"), ".nav", { onDrop: ids => reorderTo(window.qtNavIds ? window.qtNavIds(ids) : ids).then(() => toast("Order saved")) });
  sortable(document.getElementById("tiles"), ".tile", { grid: true, onDrop: ids => reorderTo(ids).then(() => toast("Order saved")) });

  /* =========================================================================================
     3. START MY SET / STOP ALL, shortcut sheet, Ctrl+[ ] Ctrl+, Ctrl+\
     ========================================================================================= */
  const hero = document.querySelector(".hero");
  const acts = document.createElement("div");
  acts.className = "hero-acts";
  acts.innerHTML = `<button class="qt-btn primary" data-set>▶ <span>Start my set</span></button><button class="qt-btn" data-stopall>■ <span>Stop all</span></button>`;
  hero.append(acts);
  function bootMark(ids, label) {
    ids.forEach((id, i) => setTimeout(() => document.querySelectorAll(`[data-go="${id}"]`).forEach(n => {
      n.classList.toggle("booting", !!label); if (label) n.dataset.boot = label; else delete n.dataset.boot;
    }), label && !RM.matches ? i * 90 : 0));
  }
  async function startSet() {
    if (!S.boot.length) { toast("Pick your set first: flip Autostart on the tools you want"); return show("settings"); }
    const ids = S.boot.filter(id => byId(id) && byId(id).status !== "on");
    if (!ids.length) return toast("Your set is already running");
    bootMark(ids, "Starting");
    try {
      const r = await post("/api/startall", { ids });
      const bad = Object.entries(r.results).filter(([, v]) => !v.ok);
      toast(bad.length ? `${bad.map(([k]) => byName(k)).join(", ")} didn't start` : `Started ${ids.map(byName).join(", ")}`, !!bad.length);
    } catch (e) { toast(e.message, true); }
    bootMark(ids, null);
    await load(true).catch(() => {});
  }
  let stopArm = 0;
  async function stopAll(btn) {
    const ports = new Set(), list = [];
    for (const t of tools) if (t.kind === "web" && t.status === "on" && !ports.has(t.port)) { ports.add(t.port); list.push(t); }
    if (!list.length) return toast("Nothing is running");
    if (btn && Date.now() - stopArm > 3500) {   // first press arms it
      stopArm = Date.now();
      btn.classList.add("armed"); btn.querySelector("span").textContent = `Stop ${list.length}? Press again`;
      anim(btn, [{ transform: "translateX(0)" }, { transform: "translateX(-5px) rotate(-2deg)" }, { transform: "translateX(5px) rotate(2deg)" }, { transform: "none" }], { duration: 360 });
      setTimeout(() => { if (Date.now() - stopArm >= 3400) { btn.classList.remove("armed"); btn.querySelector("span").textContent = "Stop all"; } }, 3600);
      return;
    }
    stopArm = 0;
    if (btn) { btn.classList.remove("armed"); btn.querySelector("span").textContent = "Stop all"; }
    const ids = tools.filter(t => list.some(x => x.port === t.port && t.kind === "web")).map(t => t.id);
    bootMark(ids, "Stopping");
    const failed = [];
    for (const t of list) { try { await post(`/api/stop/${t.id}`); } catch (e) { failed.push(t.name + ": " + e.message); } }
    bootMark(ids, null);
    if (!RM.matches) document.querySelectorAll(".tile").forEach((x, i) => x.animate([{ filter: "none" }, { filter: "grayscale(1) brightness(.7)" }, { filter: "none" }], { duration: 700, delay: i * 40 }));
    toast(failed.length ? failed.join("; ") : `Stopped ${list.length} tool${list.length > 1 ? "s" : ""}`, !!failed.length);
    await load(true).catch(() => {});
  }
  acts.addEventListener("click", e => {
    if (e.target.closest("[data-set]")) startSet();
    const b = e.target.closest("[data-stopall]"); if (b) stopAll(b);
  });

  /* shortcut sheet */
  let sheet;
  function toggleSheet() {
    if (sheet) { const s = sheet; sheet = null; s.classList.add("out"); return setTimeout(() => s.remove(), 200); }
    sheet = document.createElement("div");
    sheet.className = "sheet-wrap";
    sheet.innerHTML = `<div class="sheet qt-card" role="dialog" aria-label="Keyboard shortcuts"><div class="sbh"><h2 class="qt-display">Shortcuts</h2><kbd>Esc</kbd></div><div class="klist">${keyRows()}</div></div>`;
    sheet.onclick = e => { if (e.target === sheet) toggleSheet(); };
    document.body.append(sheet);
  }
  function cycle(d) {
    const i = tools.findIndex(t => t.id === current);
    const n = tools.length;
    show(tools[((i < 0 ? (d > 0 ? -1 : 0) : i) + d + n) % n].id);
  }
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && sheet) { e.preventDefault(); return toggleSheet(); }
    if (e.ctrlKey && !e.altKey && !e.shiftKey) {
      if (e.key === "[" || e.key === "]") { e.preventDefault(); return cycle(e.key === "]" ? 1 : -1); }
      if (e.key === ",") { e.preventDefault(); return show("settings"); }
      if (e.key === "\\") { e.preventDefault(); return toggleSplit(); }
    }
    if (e.key === "?" && !typing(e) && !e.ctrlKey && !e.altKey && !document.querySelector(".pal-wrap")) { e.preventDefault(); toggleSheet(); }
  });

  /* rail footer: settings + activity buttons */
  const foot = document.querySelector(".rail-foot");
  const railBtns = document.createElement("div");
  railBtns.className = "rail-btns";
  railBtns.innerHTML = `<button class="qt-btn ghost" id="act-btn" title="Activity: starts, stops and crashes"><i class="bell">🔔</i><span>Activity</span><b class="badge" hidden>0</b></button>
    <button class="qt-btn ghost" id="set-btn" title="Settings (Ctrl+,)"><i class="cog">⚙</i><span>Settings</span></button>`;
  foot.insertBefore(railBtns, foot.querySelector("#refresh"));
  railBtns.querySelector("#set-btn").onclick = () => show(current === "settings" ? "home" : "settings");
  const mobSet = document.createElement("button");
  mobSet.className = "nav mob-search mob-set"; mobSet.title = "Settings"; mobSet.innerHTML = '<span class="ic"><i>⚙</i></span><span class="nm">Settings</span>';
  mobSet.onclick = () => show("settings");
  document.getElementById("rail").append(mobSet);

  /* =========================================================================================
     4. TODAY STRIP on home
     ========================================================================================= */
  const strip = document.createElement("section");
  strip.className = "glance"; strip.id = "glance"; strip.setAttribute("aria-label", "Today");
  hero.after(strip);
  let glanceAt = 0, glanceData = null;
  const fmtB = b => b >= 1e12 ? (b / 1e12).toFixed(b >= 1e13 ? 0 : 1) + " TB" : Math.round(b / 1e9) + " GB";
  const money = (cur, v) => cur + Math.round(Math.abs(v)).toLocaleString("en-IN");
  function cards(d) {
    const c = [];
    if (d.money) {
      const m = d.money;
      c.push({ go: "kharcha", k: "money", eye: "Spent today", n: Math.round(m.today || 0), pre: m.cur, sub: m.left == null ? "" : m.left >= 0 ? `${money(m.cur, m.left)} left today` : `${money(m.cur, m.left)} over today`, warn: m.left != null && m.left < 0, stale: m.stale });
    }
    for (const x of (d.disk || []).slice(0, 2)) {
      const used = 1 - x.free / x.size;
      c.push({ go: "space", k: "disk-" + x.letter, eye: `${x.letter}: free`, text: fmtB(x.free), sub: x.type || "", bar: used, warn: x.free / x.size < .1 });
    }
    if (d.downloads) c.push({ go: "volt", k: "dl", eye: d.downloads.active ? "Downloading" : "Downloads today", n: d.downloads.active || d.downloads.today, sub: d.downloads.active ? "in VOLT now" : "VOLT and phone" });
    if (d.phone) c.push({ go: "ping", k: "ping", eye: "Phone alerts", n: d.phone.unread, sub: d.phone.unread ? "unread" : d.phone.linked ? "all caught up" : "phone not linked", hot: d.phone.unread > 0 });
    return c.filter(x => byId(x.go));
  }
  function paintGlance(fetchIfOld) {
    strip.hidden = !S.glance || current !== "home";
    if (strip.hidden) return;
    if (glanceData) drawGlance(glanceData);
    if (fetchIfOld && Date.now() - glanceAt > 20000) fetchGlance();
  }
  async function fetchGlance() {
    glanceAt = Date.now();
    if (!glanceData) strip.innerHTML = `<div class="gcard qt-card ghost"></div>`.repeat(4);
    try { glanceData = await api("/api/glance"); drawGlance(glanceData); }
    catch (_) { if (!glanceData) strip.innerHTML = ""; }
  }
  function drawGlance(d) {
    const list = cards(d);
    if (!list.length) { strip.innerHTML = ""; return; }
    const have = [...strip.querySelectorAll(".gcard[data-k]")].map(x => x.dataset.k).join();
    if (have !== list.map(x => x.k).join()) {
      strip.innerHTML = list.map((x, i) => `<button class="gcard qt-card${x.warn ? " warn" : ""}${x.hot ? " hot" : ""}" data-go="${x.go}" data-tool="${x.go}" data-k="${x.k}" style="--i:${i}">
        <span class="geye"><img src="/icons/${x.go}.svg" alt="">${esc(x.eye)}</span>
        <b class="gnum">${x.text != null ? esc(x.text) : `${x.pre ? `<small>${esc(x.pre)}</small>` : ""}<span class="odo" data-v="0">0</span>`}</b>
        ${x.bar != null ? `<span class="gbar"><i style="--w:${(x.bar * 100).toFixed(1)}%"></i></span>` : ""}
        <span class="gsub">${esc(x.sub)}${x.stale ? ' <em title="Last sync from the phone is old">· old sync</em>' : ""}</span></button>`).join("");
    }
    list.forEach(x => {
      const el = strip.querySelector(`.gcard[data-k="${x.k}"]`);
      if (!el) return;
      el.classList.toggle("warn", !!x.warn); el.classList.toggle("hot", !!x.hot);
      const gs = el.querySelector(".gsub");
      if (gs) { const html = esc(x.sub) + (x.stale ? ' <em title="Last sync from the phone is old">· old sync</em>' : ""); if (gs.innerHTML !== html) gs.innerHTML = html; }
      if (x.text != null) { const g = el.querySelector(".gnum"); if (g.textContent !== x.text) { g.textContent = x.text; anim(g, [{ transform: "translateY(-8px)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 380, easing: spring }); } }
      else odometer(el.querySelector(".odo"), x.n || 0);
      const bar = el.querySelector(".gbar i"); if (bar) bar.style.setProperty("--w", (x.bar * 100).toFixed(1) + "%");
    });
  }
  /* rolling digits: each digit is a column that spins to its value */
  function odometer(el, v) {
    if (!el) return;
    const s = Math.round(v).toLocaleString("en-IN");
    if (el.dataset.v === s) return;
    el.dataset.v = s;
    if (RM.matches) { el.textContent = s; return; }
    el.innerHTML = [...s].map((ch, i) => /\d/.test(ch)
      ? `<span class="dg"><span class="col" style="--d:${ch};--k:${i}">${"0123456789".split("").map(n => `<span>${n}</span>`).join("")}</span></span>` : `<span class="sep">${ch}</span>`).join("");
    requestAnimationFrame(() => el.querySelectorAll(".col").forEach(c => c.classList.add("go")));
  }
  setInterval(() => { if (current === "home" && !document.hidden && S.glance) fetchGlance(); }, 30000);

  /* =========================================================================================
     5. Ctrl+K: files via Burrow, plus shell commands
     ========================================================================================= */
  let fq = "", fres = [], fstate = "", ftimer;
  const kindIcon = f => f.isdir ? "📁" : /\.(png|jpe?g|gif|webp|bmp|heic)$/i.test(f.name) ? "🖼" : /\.(mp4|mkv|mov|webm|avi)$/i.test(f.name) ? "🎞" : /\.(mp3|wav|flac|m4a|ogg)$/i.test(f.name) ? "🎵" : /\.(zip|rar|7z|tar|gz)$/i.test(f.name) ? "🗜" : /\.(apk)$/i.test(f.name) ? "📦" : "📄";
  const shortDir = d => d.replace(/^C:\\Users\\[^\\]+/i, "~");
  window.qtPalExtra = q => {
    const out = [
      { label: "Settings", run: () => show("settings"), words: "settings preferences options order hide autostart motion rail", glyph: "⚙", hint: "Ctrl+," },
      { label: "Keyboard shortcuts", run: toggleSheet, words: "keys shortcuts help cheat sheet", glyph: "⌨", hint: "?", minor: true },
      { label: "Activity log", run: openDrawer, words: "activity log history crash events", glyph: "🔔", minor: true },
      { label: S.boot.length ? `Start my set (${S.boot.map(byName).join(", ")})` : "Start my set", run: startSet, words: "start set autostart boot all", glyph: "▶", minor: true },
      { label: "Stop all running tools", run: () => stopAll(null), words: "stop all quit kill everything", glyph: "■", minor: true },
    ];
    if (split.on) out.push({ label: "Close split view", run: exitSplit, words: "split close single", glyph: "▥", hint: "Ctrl+\\" });
    else if (splitPair()) { const [a, b] = splitPair(); out.push({ label: `Split view: ${a.name} | ${b.name}`, run: () => enterSplit(a.id, b.id), words: "split side by side two", glyph: "▥", hint: "Ctrl+\\" }); }
    q = (q || "").trim();
    if (window.qtPeekRecent && S.peek !== false) {   // files opened in Peek lately (peek.js)
      const ql = q.toLowerCase();
      window.qtPeekRecent().filter(r => !ql || r.name.toLowerCase().includes(ql)).slice(0, q ? 3 : 5).forEach((r, i) =>
        out.push({ label: r.name, path: shortDir(r.dir), head: "Recent files", fixed: q ? 2.5 - i * .01 : undefined, glyph: kindIcon({ name: r.name }),
          words: r.name, run: () => window.qtPeek(r.path), alt: () => revealInBurrow(r.path) }));
    }
    if (q.length >= 2 && q !== fq) { fq = q; fres = []; fstate = "busy"; clearTimeout(ftimer); ftimer = setTimeout(() => findFiles(q), 220); }
    if (q.length < 2) { fq = ""; fres = []; fstate = ""; }
    if (q.length >= 2) {
      if (fstate === "busy" && !fres.length) out.push({ label: "Looking through your files...", head: "Files", fixed: 1, run: () => {}, glyph: "⌕", minor: true });
      if (fstate === "off") out.push({ label: "Start Burrow to search files", head: "Files", fixed: 1, run: () => show("burrow"), glyph: "⌕", minor: true, ic: "/icons/burrow.svg" });
      fres.forEach((f, i) => out.push({ label: f.name, path: shortDir(f.dir), head: "Files", fixed: 2 - i * .01, glyph: kindIcon(f), badge: f.isdir ? "folder" : "",
        run: () => f.isdir ? revealInBurrow(f.path, true) : openFile(f), alt: () => revealInBurrow(f.path) }));
      if (fstate === "done" && fres.length) out.push({ label: `More results for "${q}" in Burrow`, head: "Files", fixed: 1.5, glyph: "↗", minor: true, run: () => burrowSearch(q) });
    }
    return out;
  };
  async function findFiles(q) {
    try {
      const r = await api("/api/find?q=" + encodeURIComponent(q));
      if (q !== fq) return;
      fres = r.files || []; fstate = r.off ? "off" : "done";
    } catch (_) { if (q === fq) { fres = []; fstate = "done"; } }
    window.qtPalRender && window.qtPalRender();
  }
  async function openFile(f) {
    if (S.peek !== false && window.qtPeek) return window.qtPeek(f.path, { list: fres.filter(x => !x.isdir).map(x => x.path) });
    try { await post("/api/open-file", { path: f.path }); toast("Opened " + f.name); }
    catch (e) { toast(e.message, true); }
  }
  /* Burrow deep link: switch to Burrow, then tell it where to go (it answers burrow-ack) */
  function tellBurrow(msg) {
    const el = frames.burrow, f = el && el.querySelector("iframe");
    let tries = 0, acked = false;
    const onAck = e => { if (e.data && e.data.qt === "burrow-ack") acked = true; };
    addEventListener("message", onAck);
    (function send() {
      if (acked || tries++ > 30) return removeEventListener("message", onAck);
      try { (frames.burrow.querySelector("iframe") || f).contentWindow.postMessage(msg, "http://127.0.0.1:7795"); } catch (_) {}
      setTimeout(send, 300);
    })();
  }
  function revealInBurrow(path, inside) { show("burrow"); tellBurrow({ qt: "burrow-go", path, inside: !!inside }); }
  function burrowSearch(q) { show("burrow"); tellBurrow({ qt: "burrow-search", q }); }
  window.qtRevealInBurrow = revealInBurrow;   // Peek's "Show in Burrow"

  /* =========================================================================================
     6. SPLIT VIEW
     ========================================================================================= */
  const split = { on: false, a: "", b: "", ratio: .5, focus: "" };
  let divider;
  function splitPair() {
    const p = S.split; if (p && byId(p.a) && byId(p.b)) return [byId(p.a), byId(p.b)];
    let rec = []; try { rec = JSON.parse(localStorage.getItem("qt-recent") || "[]"); } catch (_) {}
    rec = rec.filter(id => byId(id) && byId(id).kind !== "folder");
    return rec.length >= 2 ? [byId(rec[1]), byId(rec[0])] : null;
  }
  function toggleSplit() {
    if (split.on) return exitSplit();
    if (PHONE.matches) return toast("Split view needs a wider window");
    if (isTool(current)) {
      const p = splitPair(), other = p && p.find(x => x.id !== current);
      if (other) return enterSplit(current, other.id);
    }
    const p = splitPair(); if (p) return enterSplit(p[0].id, p[1].id);
    toast("Open two tools first, then press Ctrl+\\");
  }
  function enterSplit(a, b, ratio) {
    if (PHONE.matches) return toast("Split view needs a wider window");
    if (!byId(a) || !byId(b) || a === b) return;
    Object.assign(split, { on: true, a, b, ratio: ratio || (S.split && S.split.a === a && S.split.b === b ? S.split.ratio : .5), focus: a });
    saveS({ split: { a, b, ratio: split.ratio } });
    window.qtSkipWipe = true;
    show(a);
    if (!RM.matches) {   // panes slide in from the middle
      [frames[a], frames[b]].forEach((el, i) => el && el.animate([{ transform: `translateX(${i ? 40 : -40}px) scale(.97)`, opacity: .3 }, { transform: "none", opacity: 1 }], { duration: 480, easing: spring }));
      divider && divider.animate([{ transform: "scaleY(0)" }, { transform: "scaleY(1.04)", offset: .7 }, { transform: "none" }], { duration: 520, easing: "ease-out" });
    }
    toast(`Split view: ${byId(a).name} | ${byId(b).name}`);
  }
  function exitSplit() {
    if (!split.on) return;
    split.on = false;
    stage.classList.remove("split");
    Object.values(frames).forEach(el => { el.style.left = el.style.right = ""; el.classList.remove("pane-a", "pane-b", "pane-focus"); });
    divider && divider.remove(); divider = null;
    const keep = isTool(current) ? current : split.a;
    Object.entries(frames).forEach(([k, el]) => { el.hidden = k !== current; });
    document.querySelectorAll("#nav .nav").forEach(n => n.classList.toggle("on", n.dataset.go === current));
    movePill();
    return keep;
  }
  function layoutSplit(id) {
    if (!split.on) return;
    const a = byId(split.a), b = byId(split.b);
    if (!frames[b.id]) openTool(b);
    if (!frames[a.id]) openTool(a);
    stage.classList.add("split");
    if (id === a.id || id === b.id) split.focus = id;
    const r = split.ratio * 100;
    frames[a.id].hidden = frames[b.id].hidden = false;
    frames[a.id].classList.add("pane-a"); frames[b.id].classList.add("pane-b");
    frames[a.id].style.left = "0"; frames[a.id].style.right = `calc(${100 - r}% + 5px)`;
    frames[b.id].style.left = `calc(${r}% + 5px)`; frames[b.id].style.right = "0";
    frames[a.id].classList.toggle("pane-focus", split.focus === a.id); frames[b.id].classList.toggle("pane-focus", split.focus === b.id);
    if (!divider) {
      divider = document.createElement("div");
      divider.className = "divider";
      divider.innerHTML = `<span class="grab"></span><div class="dv-btns"><button title="Swap sides" data-dv="swap">⇄</button><button title="Close split view (Ctrl+\\)" data-dv="close">✕</button></div>`;
      stage.append(divider);
      divider.addEventListener("pointerdown", dragDivider);
      divider.addEventListener("dblclick", () => { split.ratio = .5; layoutSplit(); saveS({ split: { a: split.a, b: split.b, ratio: .5 } }); });
      divider.addEventListener("click", e => {
        const k = e.target.closest("[data-dv]"); if (!k) return;
        if (k.dataset.dv === "close") exitSplit();
        else { const { a: x, b: y } = split; Object.values(frames).forEach(el => el.classList.remove("pane-a", "pane-b")); enterSplit(y, x, 1 - split.ratio); }
      });
    }
    divider.style.left = `calc(${r}% - 5px)`;
    document.body.dataset.tool = split.focus;
    document.querySelectorAll("#nav .nav").forEach(n => n.classList.toggle("on", n.dataset.go === split.focus));
    document.querySelectorAll("#nav .nav").forEach(n => n.classList.toggle("in-split", n.dataset.go === split.a || n.dataset.go === split.b));
    movePill();
  }
  function dragDivider(e) {
    if (e.target.closest("[data-dv]") || e.button) return;
    e.preventDefault();
    const shield = document.createElement("div"); shield.className = "shield"; stage.append(shield);   // iframes would swallow the drag
    divider.classList.add("drag");
    const box = stage.getBoundingClientRect();
    const mv = ev => { split.ratio = Math.min(.8, Math.max(.2, (ev.clientX - box.left) / box.width)); layoutSplit(); };
    const up = () => {
      removeEventListener("pointermove", mv); removeEventListener("pointerup", up);
      shield.remove(); divider.classList.remove("drag");
      anim(divider.querySelector(".grab"), [{ scale: "1 1" }, { scale: "2.2 .8" }, { scale: ".9 1.1" }, { scale: "1 1" }], { duration: 450, easing: "ease-out" });
      saveS({ split: { a: split.a, b: split.b, ratio: split.ratio } });
    };
    addEventListener("pointermove", mv); addEventListener("pointerup", up);
  }
  // which pane did you click into? (an iframe takes focus: the window blurs)
  addEventListener("blur", () => setTimeout(() => {
    if (!split.on) return;
    const f = document.activeElement && document.activeElement.closest && document.activeElement.closest(".view");
    if (f && (f.dataset.tool === split.a || f.dataset.tool === split.b) && f.dataset.tool !== split.focus) { split.focus = f.dataset.tool; current = split.focus; layoutSplit(); }
  }, 0));
  PHONE.addEventListener("change", () => { if (PHONE.matches) exitSplit(); });
  window.qtMenuExtra = t => {
    const out = [];
    if (t.kind === "folder") return out;
    const other = isTool(current) && current !== t.id ? byId(current) : null;
    if (split.on && (t.id === split.a || t.id === split.b)) out.push(["unsplit", "Close split view", "▥"]);
    else if (other && other.kind !== "folder") out.push(["split", `Open beside ${other.name}`, "▥"]);
    const i = tools.indexOf(t);
    if (i > 0) out.push(["mvup", "Move up the rail", "↑"]);
    if (i < tools.length - 1) out.push(["mvdown", "Move down the rail", "↓"]);
    return out;
  };
  window.qtAct = async (kind, t) => {
    if (kind === "split") { enterSplit(current, t.id); return true; }
    if (kind === "unsplit") { exitSplit(); return true; }
    if (kind === "mvup" || kind === "mvdown") {
      const ids = tools.map(x => x.id), i = ids.indexOf(t.id), j = i + (kind === "mvup" ? -1 : 1);
      [ids[i], ids[j]] = [ids[j], ids[i]];
      const navs = document.querySelectorAll("#nav .nav, #tiles .tile");
      const before = new Map([...navs].map(el => [el, el.getBoundingClientRect()]));
      await reorderTo(ids);
      if (!RM.matches) for (const [el, r] of before) { const n = el.getBoundingClientRect(), dx = r.left - n.left, dy = r.top - n.top; if (dx || dy) el.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: "none" }], { duration: 420, easing: spring }); }
      return true;
    }
    return false;
  };

  /* =========================================================================================
     7. ACTIVITY LOG + crash alerts
     ========================================================================================= */
  let lastEv = 0, events = [], seenEv = +(localStorage.getItem("qt-act-seen") || 0), drawer, firstPoll = true;
  const actBtn = railBtns.querySelector("#act-btn"), badge = actBtn.querySelector(".badge");
  const ago = t => { const s = Math.max(0, Math.round(Date.now() / 1000 - t)); return s < 50 ? "just now" : s < 3600 ? Math.round(s / 60) + " min ago" : s < 86400 ? Math.round(s / 3600) + " h ago" : new Date(t * 1000).toLocaleDateString(); };
  const evText = e => ({ crash: S.revive ? "stopped on its own. Bringing it back..." : "stopped on its own", up: e.msg === "started from the suite" ? "started" : "came up", stop: "stopped", fail: e.msg && /kept stopping|bring it back/.test(e.msg) ? e.msg : "couldn't start", revive: "is back up (it had crashed)" }[e.kind] || e.kind);
  async function pollActivity() {
    try {
      const r = await api("/api/activity?since=" + lastEv);
      if (r.last < lastEv) { lastEv = 0; events = []; }   // hub restarted: its log starts over
      const fresh = r.events || [];
      if (fresh.length) {
        events.push(...fresh); events = events.slice(-120); lastEv = fresh[fresh.length - 1].id;
        if (!firstPoll) fresh.filter(e => e.kind === "crash" || e.kind === "fail").forEach(crashToast);
        if (!firstPoll) fresh.filter(e => e.kind === "revive").forEach(e => { toast(`${e.name} is back up`); load(true).catch(() => {}); });
        if (!firstPoll && !RM.matches) anim(actBtn.querySelector(".bell"), [{ transform: "none" }, { transform: "rotate(-22deg)" }, { transform: "rotate(18deg)" }, { transform: "rotate(-10deg)" }, { transform: "none" }], { duration: 700, easing: "ease-out" });
        if (drawer) paintDrawer();
      }
      firstPoll = false;
      paintBadge();
    } catch (_) {}
  }
  function paintBadge() {
    const n = events.filter(e => e.id > seenEv && (e.kind === "crash" || e.kind === "fail")).length;
    const was = badge.hidden ? 0 : +badge.textContent;
    badge.hidden = !n; badge.textContent = n;
    if (n > was) anim(badge, [{ transform: "scale(0)" }, { transform: "scale(1.5)" }, { transform: "scale(.85)" }, { transform: "none" }], { duration: 520, easing: "ease-out" });
  }
  function crashToast(e) {
    const t = byId(e.tool);
    const el = document.createElement("div");
    el.className = "qt-toast bad act-toast";
    el.innerHTML = `<img src="/icons/${esc(e.tool)}.svg" alt=""><span><b>${esc(e.name)}</b> ${esc(evText(e))}</span>${t && t.kind === "web" && !(S.revive && e.kind === "crash") ? `<button class="qt-btn">Restart</button>` : ""}<button class="x" aria-label="Dismiss">✕</button>`;
    document.getElementById("toasts").append(el);
    const bye = () => { el.classList.add("out"); setTimeout(() => el.remove(), 320); };
    const tm = setTimeout(bye, 12000);
    el.querySelector(".x").onclick = () => { clearTimeout(tm); bye(); };
    const rb = el.querySelector(".qt-btn");
    if (rb) rb.onclick = async () => {
      rb.disabled = true; rb.textContent = "Starting...";
      try { await post(`/api/start/${t.id}`); toast(t.name + " is back"); } catch (err) { toast(err.message, true); }
      clearTimeout(tm); bye(); load(true).catch(() => {});
    };
  }
  function openDrawer() {
    if (drawer) return closeDrawer();
    drawer = document.createElement("aside");
    drawer.className = "act-drawer qt-card";
    drawer.innerHTML = `<div class="sbh"><h2 class="qt-display">Activity</h2><button class="qt-btn ghost icon" data-close aria-label="Close">✕</button></div><div class="act-list"></div>
      <p class="qt-muted act-foot">Starts, stops and crashes since the suite started. Crashes are tools that stopped without you asking.</p>`;
    document.body.append(drawer);
    drawer.querySelector("[data-close]").onclick = closeDrawer;
    paintDrawer();
    seenEv = lastEv; localStorage.setItem("qt-act-seen", seenEv); paintBadge();
  }
  function closeDrawer() { if (!drawer) return; const d = drawer; drawer = null; d.classList.add("out"); setTimeout(() => d.remove(), 260); }
  function paintDrawer() {
    const list = drawer.querySelector(".act-list");
    list.innerHTML = events.length ? [...events].reverse().map((e, i) => `<div class="act-row k-${e.kind}${e.id > seenEv ? " new" : ""}" style="--i:${Math.min(i, 12)}" data-tool="${esc(e.tool)}">
      <img src="/icons/${esc(e.tool)}.svg" alt=""><span><b>${esc(e.name)}</b> ${esc(evText(e))}</span><time>${ago(e.t)}</time></div>`).join("")
      : `<p class="qt-muted act-empty">Quiet so far. Nothing has started or stopped since the suite opened.</p>`;
  }
  actBtn.onclick = openDrawer;
  document.addEventListener("pointerdown", e => { if (drawer && !e.target.closest(".act-drawer, #act-btn")) closeDrawer(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && drawer) closeDrawer(); });
  setInterval(pollActivity, 5000);
  pollActivity();

  /* =========================================================================================
     8-10. MOTION: tile -> view morph, splash, status-change ripples
     ========================================================================================= */
  // clicking a tile grows an accent card from the tile to fill the stage (instead of the wipe)
  document.addEventListener("click", e => {
    const tile = e.target.closest("#tiles .tile, #glance .gcard");
    if (!tile || RM.matches || dragBlockClick) return;
    const r = tile.getBoundingClientRect(), s = stage.getBoundingClientRect();
    const m = document.createElement("div");
    m.className = "morph"; m.dataset.tool = tile.dataset.tool || tile.dataset.go;
    m.innerHTML = `<img src="/icons/${esc(m.dataset.tool)}.svg" alt="">`;
    Object.assign(m.style, { left: r.left - s.left + "px", top: r.top - s.top + "px", width: r.width + "px", height: r.height + "px" });
    stage.append(m);
    window.qtSkipWipe = true;
    const a = m.animate([
      { left: m.style.left, top: m.style.top, width: m.style.width, height: m.style.height, borderRadius: "18px", opacity: 1 },
      { left: "0px", top: "0px", width: s.width + "px", height: s.height + "px", borderRadius: "0px", opacity: 1, offset: .55 },
      { left: "0px", top: "0px", width: s.width + "px", height: s.height + "px", borderRadius: "0px", opacity: 0 }], { duration: 620, easing: "cubic-bezier(.7,0,.25,1)" });
    m.querySelector("img").animate([{ transform: "scale(1) rotate(0)" }, { transform: "scale(2.4) rotate(-8deg)", offset: .55 }, { transform: "scale(3) rotate(4deg)", opacity: 0 }], { duration: 620, easing: "ease-in-out" });
    a.onfinish = () => m.remove();
  }, true);

  // status dot changed: a ring ripples out of it
  new MutationObserver(ms => {
    if (RM.matches) return;
    for (const m of ms) {
      const d = m.target;
      if (!d.classList || !d.classList.contains("qt-dot") || m.oldValue === d.className) continue;
      const ring = document.createElement("span");
      ring.className = "ring " + (d.classList.contains("on") ? "on" : d.classList.contains("bad") ? "bad" : "");
      d.parentElement.append(ring);
      const dr = d.getBoundingClientRect(), pr = d.parentElement.getBoundingClientRect();
      ring.style.left = dr.left - pr.left + dr.width / 2 + "px"; ring.style.top = dr.top - pr.top + dr.height / 2 + "px";
      ring.addEventListener("animationend", () => ring.remove());
    }
  }).observe(document.getElementById("rail"), { subtree: true, attributes: true, attributeFilter: ["class"], attributeOldValue: true });

  // first open of the session: the logo stamps down and the rail items drop in
  function splash() {
    if (RM.matches || sessionStorage.getItem("qt-splashed")) return;
    sessionStorage.setItem("qt-splashed", "1");
    const sp = document.createElement("div");
    sp.className = "splash";
    sp.innerHTML = `<div class="sp-in"><img src="/icons/suite.svg" alt=""><b class="qt-display">${"SUITE".split("").map((c, i) => `<span style="--i:${i}">${c}</span>`).join("")}</b></div>`;
    document.body.append(sp);
    setTimeout(() => { sp.classList.add("out"); setTimeout(() => sp.remove(), 520); }, 950);
  }
  splash();

  /* ---------- boot: settings, launch view ---------- */
  (async function bootShell() {
    try { S = (await api("/api/settings")).settings; applyLook(); } catch (_) {}
    (function waitTools() {
      if (!tools.length) return setTimeout(waitTools, 60);
      if (!location.hash && S.launch === "last" && isTool(S.last) && current === "home") { window.qtSkipWipe = true; show(S.last); }
      if (location.hash === "#settings" && current !== "settings") show("settings");
      paintGlance(true);
    })();
  })();
})();
