"use strict";
/* QT Suite guide layer (loaded LAST). Beginner guidance + the 20-round loop that grew around it.
   Onboarding: first-run welcome (hello, pick your tools, how it starts, three moves, done), guided tour,
   Help view (#help), Get set up checklist on Home.
   Rounds  1 checklist auto-ticks          2 Help search + Ctrl+K help answers   3 setup doctor + fixes
           4 first-open tool tips          5 tip of the day                      6 What's this? mode (Shift+F1)
           7 Settings search               8 beginner hints in Ctrl+K            9 text size + high contrast
          10 About + copy diagnostics     11 hidden tools strip + undo hide      12 "needs" badges per tool
          13 F1 = help for this tool      14 replay/reset in Settings + what's new for this update
          15-20 motion: welcome steps, tour glide, checklist ring + confetti, help stagger, doctor ticks, tip flip
   Server half: suite/guide.py (/api/guide/*). */
(() => {
  const RM = matchMedia("(prefers-reduced-motion: reduce)");
  const root = document.documentElement;
  const calm = () => RM.matches || root.classList.contains("qt-calm");
  const anim = (el, kf, o) => (calm() || !el || !el.animate) ? null : el.animate(kf, o);
  const spring = "cubic-bezier(.34,1.8,.5,1)";
  const post = (p, b) => api(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b || {}) });
  const typing = e => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };
  const say = (m, o) => (window.qtToast || toast)(m, o);
  const sfx = k => window.qtSfx && window.qtSfx(k);
  const byId = id => tools.find(t => t.id === id);
  const home = document.getElementById("view-home");
  const hero = home.querySelector(".hero");
  const palInput = () => document.querySelector(".pal-wrap input");
  // automated test browsers don't get surprise overlays unless the page asks with ?guide=1
  const AUTO = !navigator.webdriver || /[?&]guide=1/.test(location.search);
  function palAdd(fn) {
    const prev = window.qtPalExtra;
    window.qtPalExtra = q => { const out = prev ? prev(q) : []; try { fn(q, palInput() ? palInput().value : q, out); } catch (e) { console.warn(e); } return out; };
  }
  let G = { onboarded: true, tour: true, tasks: { dismissed: true }, tips: {}, taskIds: [] };
  const ready = api("/api/guide/state").then(s => { G = s; return s; }).catch(() => G);
  async function saveG(patch) { try { G = await post("/api/guide/state", patch); } catch (_) {} return G; }

  /* ------------------------------------------------------------------ tool knowledge ---
     needs: what a tool depends on (round 12). how: two or three beginner steps (Help + first-open tips). */
  const INFO = {
    daily: { needs: [], how: ["Opens on today: spending, new photos, downloads and free disk space.", "Each card jumps to the tool it came from."] },
    beam: { needs: ["phone"], how: ["Open Beam, then scan its QR code with your phone camera to pair.", "Drop files on the page to send them. Your phone's uploads land in Downloads.", "Install the Beam phone app (APKs) for share-to-PC and alerts."] },
    launchpad: { needs: ["games"], how: ["Finds games from Steam, Epic and other launchers on this PC.", "Click a cover to play. Playtime is counted while the suite runs."] },
    volt: { needs: ["net"], how: ["Paste a video, song or image link and press Grab.", "Pick audio-only or a quality, files go to your Downloads.", "Tip: paste a link into Ctrl+K to send it straight to VOLT."] },
    burrow: { needs: [], how: ["Type to search the whole PC instantly. Tabs work like a browser.", "Space previews a file, Enter opens it in the suite."] },
    lens: { needs: ["phone"], how: ["Shows the photos from the Lens phone app next to the ones on this PC.", "Search by words in a photo, or by person."] },
    inkmotion: { needs: [], how: ["Draw on the canvas, every stroke is replayed as animation.", "Export a GIF or MP4 when you like it."] },
    pixlab: { needs: [], how: ["Make pixel art from text-like .pxl files, or draw in the grid.", "Export a PNG sprite sheet at any scale."] },
    soundboard: { needs: ["mic"], how: ["Drop sound files on a pad and give it a hotkey.", "To play into calls, install a virtual audio cable and pick it as the output."] },
    kharcha: { needs: ["phone"], how: ["Shows the spending you log in the Kharcha phone app, synced through Beam.", "Set a monthly budget to see how much is left."] },
    ping: { needs: ["phone"], how: ["Your phone's notifications show up here once the Beam phone app has alert access.", "Reply, dismiss or tap a notification's buttons from the PC."] },
    space: { needs: [], how: ["Scans your drives and shows what takes the room.", "Clear caches and temp files with one click. It asks first."] },
    pictures: { needs: [], how: ["Opens any picture, even HEIC and TIFF. Arrow keys step through the folder.", "S starts a slideshow, I shows photo details."] },
    player: { needs: [], how: ["Plays video and music. J and L skip, M mutes.", "It remembers where you stopped."] },
    reader: { needs: [], how: ["Reads PDFs, Markdown and Word files.", "Markdown gets an outline you can click."] },
    code: { needs: [], how: ["Text and code with colours and line numbers. Ctrl+F finds, Ctrl+G goes to a line.", "JSON opens as a tree, CSV as a table."] },
    archive: { needs: [], how: ["Look inside zip, apk and jar files without unpacking.", "U unpacks the whole thing next to it."] },
    surf: { needs: ["net"], how: ["A small browser inside the suite with tabs and bookmarks.", "Sites that refuse to be framed open in Lite mode or your normal browser."] },
    apks: { needs: ["phone"], how: ["The phone apps that pair with the suite. Send one to your phone with Beam."] },
  };
  const NEED = { phone: ["📱", "Works best with the phone app"], net: ["🌐", "Needs the internet"], games: ["🎮", "Uses games already on this PC"], mic: ["🎙", "Virtual audio cable for calls (optional)"] };
  const needChips = id => ((INFO[id] || {}).needs || []).map(n => `<span class="gd-need" title="${esc(NEED[n][1])}">${NEED[n][0]} <span>${esc(NEED[n][1])}</span></span>`).join("");
  window.qtToolInfo = id => INFO[id];

  const PRESETS = [
    ["all", "Everything", "⚡", null],
    ["basics", "The basics", "🧰", ["daily", "burrow", "volt", "surf", "pictures", "player", "reader", "code", "archive"]],
    ["phone", "Phone + PC", "📱", ["beam", "kharcha", "ping", "lens", "daily", "burrow", "pictures", "player", "apks"]],
    ["files", "Files + media", "🗂", ["burrow", "pictures", "player", "reader", "code", "archive", "space", "surf", "volt"]],
    ["make", "Make stuff", "🎨", ["inkmotion", "pixlab", "soundboard", "volt", "pictures", "player"]],
    ["play", "Games + fun", "🎮", ["launchpad", "soundboard", "player", "volt", "surf"]],
  ];

  /* ===================================================================================
     WELCOME (first run, or replay from Help / Settings / Ctrl+K)
     =================================================================================== */
  let wz = null;
  async function allTools() { try { return await api("/api/tools?all=1"); } catch (_) { return tools.slice(); } }
  async function welcome(opts = {}) {
    if (wz) return;
    const list = (await allTools()).filter(t => t.status !== "off" || t.kind !== "file");
    const hidden = new Set(((window.qtS && window.qtS()) || {}).hidden || []);
    const pick = new Set(list.filter(t => !hidden.has(t.id)).map(t => t.id));
    const winOn = await api("/api/autostart").then(r => r.on).catch(() => false);
    let step = opts.step || 0;
    const ui = { boot: false, win: winOn, sfx: !!lsGet("qt-sfx", false), motion: ((window.qtS && window.qtS()) || {}).motion || "system", tried: false };
    wz = document.createElement("div");
    wz.className = "gw-wrap qt-dots";
    wz.setAttribute("role", "dialog"); wz.setAttribute("aria-modal", "true"); wz.setAttribute("aria-label", "Welcome to QT Suite");
    wz.innerHTML = `<div class="gw qt-card"><div class="gw-top"><img src="/icons/suite.svg" alt=""><span class="qt-eyebrow">Welcome</span>
        <ol class="gw-dots" aria-hidden="true">${[0, 1, 2, 3, 4].map(i => `<li data-d="${i}"></li>`).join("")}</ol>
        <button class="qt-btn ghost icon" data-gw="close" aria-label="Close the welcome" title="Close (Esc)">✕</button></div>
      <div class="gw-body" aria-live="polite"></div><div class="gw-foot"></div></div>`;
    document.body.append(wz);
    const body = wz.querySelector(".gw-body"), foot = wz.querySelector(".gw-foot");
    const count = () => `${pick.size} of ${list.length} on`;
    const card = t => `<button class="gw-tool${pick.has(t.id) ? " on" : ""}" data-pick="${t.id}" data-tool="${t.id}" aria-pressed="${pick.has(t.id)}" style="--i:0">
        <img src="/icons/${t.id}.svg" alt=""><b>${esc(t.name)}</b><em>${esc(t.tag)}</em><small>${esc(t.blurb || "")}</small>
        <span class="gw-needs">${((INFO[t.id] || {}).needs || []).map(n => `<i title="${esc(NEED[n][1])}">${NEED[n][0]}</i>`).join("")}</span><span class="gw-tick" aria-hidden="true">✓</span></button>`;
    const STEPS = [
      () => [`<div class="gw-hello"><h1 class="qt-display">Hi. This is<br><span class="hl">QT Suite.</span></h1>
          <p class="lede">One window for the small tools you use every day. Everything runs on this PC. Nothing goes to the cloud.</p>
          <ul class="gw-what">
            <li style="--i:0"><i>📲</i><b>Phone and PC together</b><span>Send files and links, see your phone's alerts and spending.</span></li>
            <li style="--i:1"><i>🗂</i><b>Your files, opened here</b><span>Find anything fast, then view pictures, video, PDFs, code and zips.</span></li>
            <li style="--i:2"><i>⚡</i><b>Handy extras</b><span>Downloads from links, a sound board, pixel art, animation and more.</span></li>
          </ul></div>`,
        `<button class="qt-btn ghost" data-gw="skip">Skip, I'll look around</button><button class="qt-btn ghost" data-gw="restore" title="Load a QT Suite backup file (settings, notes, to-dos)">⇧ Load my backup</button><input type="file" accept=".json,application/json" data-bk-file hidden><span class="sp"></span><button class="qt-btn primary big" data-gw="next">Set it up · 1 min →</button>`],
      () => [`<div class="gw-h"><h2 class="qt-display">Pick your tools</h2><p class="qt-muted">Only what you pick shows on the rail and Home. Nothing is uninstalled, and Settings can change it any time.</p></div>
          <div class="gw-presets" role="group" aria-label="Quick picks">${PRESETS.map(([k, n, ic]) => `<button class="qt-chip gw-pre" data-pre="${k}">${ic} ${esc(n)}</button>`).join("")}</div>
          <div class="gw-grid">${list.map(card).join("")}</div>
          <p class="gw-legend qt-muted">${Object.values(NEED).map(([i, t]) => `<span>${i} ${esc(t)}</span>`).join("")}</p>`,
        `<button class="qt-btn ghost" data-gw="back">← Back</button><span class="gw-count qt-mono">${count()}</span><span class="sp"></span><button class="qt-btn primary big" data-gw="next">Next →</button>`],
      () => [`<div class="gw-h"><h2 class="qt-display">How it starts</h2><p class="qt-muted">Closing the window keeps the suite in the tray, by the clock. These can all change later in Settings.</p></div>
          <div class="gw-opts">
            <div class="gw-opt" style="--i:0"><i>🪟</i><span><b>Start with Windows</b><em>Runs quietly when you sign in, so your phone can reach it right away.</em></span><button class="qt-switch" role="switch" data-opt="win" aria-checked="${ui.win}" aria-label="Start with Windows"></button></div>
            <div class="gw-opt" style="--i:1"><i>🚀</i><span><b>Start my tools with the suite</b><em>Your picked tools that run in the background (like Beam) start when the suite does, so they're ready.</em></span><button class="qt-switch" role="switch" data-opt="boot" aria-checked="${ui.boot}" aria-label="Start my tools with the suite"></button></div>
            <div class="gw-opt" style="--i:1"><i>🔊</i><span><b>Little sounds</b><em>Soft clicks and pops when things happen.</em></span><button class="qt-switch" role="switch" data-opt="sfx" aria-checked="${ui.sfx}" aria-label="Little sounds"></button></div>
            <div class="gw-opt" style="--i:2"><i>🌀</i><span><b>Motion</b><em>Full is bouncy. Calm keeps things still.</em></span>
              <div class="gw-seg" role="radiogroup">${[["system", "Like Windows"], ["full", "Full"], ["calm", "Calm"]].map(([v, l]) => `<button role="radio" data-motion="${v}" aria-checked="${ui.motion === v}">${l}</button>`).join("")}</div></div>
          </div>`,
        `<button class="qt-btn ghost" data-gw="back">← Back</button><span class="sp"></span><button class="qt-btn primary big" data-gw="next">Next →</button>`],
      () => [`<div class="gw-h"><h2 class="qt-display">Three moves to know</h2><p class="qt-muted">That's really all. Everything else is a click away.</p></div>
          <div class="gw-moves">
            <div class="gw-move${ui.tried ? " done" : ""}" data-move="k" style="--i:0"><span class="gw-keys"><kbd>Ctrl</kbd><kbd>K</kbd></span><b>Search everything</b><em>Tools, actions, files on this PC, sums and links. Try it now.</em><span class="gw-ok">✓ Nice</span></div>
            <div class="gw-move" style="--i:1"><span class="gw-keys"><kbd>Ctrl</kbd><kbd>1</kbd><kbd>…</kbd><kbd>9</kbd></span><b>Jump to a tool</b><em>In the order of the rail. Ctrl + 0 is Home.</em></div>
            <div class="gw-move" style="--i:2"><span class="gw-keys"><kbd>F1</kbd></span><b>Help, any time</b><em>Explains the tool you're in. The ? button on the rail does the same.</em></div>
          </div>`,
        `<button class="qt-btn ghost" data-gw="back">← Back</button><span class="sp"></span><button class="qt-btn primary big" data-gw="next">Next →</button>`],
      () => [`<div class="gw-done"><div class="gw-badge" aria-hidden="true">✓</div><h2 class="qt-display">You're set.</h2>
          <p class="lede">${pick.size} tools are ready. Want a 30-second tour of where things are?</p></div>`,
        `<button class="qt-btn ghost" data-gw="help">Open Help</button><span class="sp"></span><button class="qt-btn" data-gw="finish">Go to Home</button><button class="qt-btn primary big" data-gw="tour">Take the tour →</button>`],
    ];
    let dir = 1;
    function paint() {
      const [b, f] = STEPS[step]();
      const old = body.firstElementChild;
      const put = () => {
        body.innerHTML = b; foot.innerHTML = f;
        wz.querySelectorAll(".gw-dots li").forEach((d, i) => { d.classList.toggle("on", i === step); d.classList.toggle("past", i < step); });
        body.querySelectorAll("[style*='--i']").forEach((el, i) => el.style.setProperty("--i", i));
        // round 15: incoming step springs in from the direction of travel
        anim(body.firstElementChild, [{ transform: `translateX(${dir * 60}px) scale(.96, 1.04)`, opacity: 0 }, { transform: "translateX(0) scale(1.02, .98)", opacity: 1, offset: .65 }, { transform: "none", opacity: 1 }], { duration: 480, easing: "cubic-bezier(.2,.9,.3,1.2)" });
        if (step === 4) cheer(wz.querySelector(".gw-badge"));
        const focus = foot.querySelector(".primary") || foot.querySelector("button");
        focus && focus.focus({ preventScroll: true });
      };
      const a = old && anim(old, [{ transform: "none", opacity: 1 }, { transform: `translateX(${-dir * 50}px) scale(.94, 1.03)`, opacity: 0 }], { duration: 170, easing: "ease-in", fill: "forwards" });
      a ? a.finished.then(put, put) : put();
    }
    async function finish(then) {
      const was = new Set(((window.qtS && window.qtS()) || {}).hidden || []);
      const hide = list.map(t => t.id).filter(id => !pick.has(id));
      const changed = hide.length !== was.size || hide.some(id => !was.has(id));
      lsSet("qt-sfx", ui.sfx);
      // new people don't need the notes about earlier updates
      if (G.fresh) ["qt-new-v4", "qt-new-v5", "qt-new-v6"].forEach(k => lsSet(k, true));
      await saveG({ onboarded: true, tasks: { pick: true } });
      if (window.qtSaveS) {
        const patch = { motion: ui.motion };
        if (changed) patch.hidden = hide;
        if (ui.boot) patch.boot = list.filter(t => t.kind === "web" && pick.has(t.id)).map(t => t.id);
        await window.qtSaveS(patch);
        if (changed && window.qtRelayout) await window.qtRelayout();
      }
      if (ui.win !== winOn) post("/api/autostart/" + (ui.win ? "on" : "off")).then(r => { const s = document.getElementById("autostart"); if (s) s.setAttribute("aria-checked", !!r.on); }).catch(() => {});
      close();
      paintCheck();
      if (then === "tour") setTimeout(tour, 350);
      else if (then === "help") show("help");
      else show("home");
    }
    function close() {
      if (!wz) return;
      const w = wz; wz = null;
      document.removeEventListener("keydown", onKey, true);
      w.classList.add("out"); setTimeout(() => w.remove(), 260);
    }
    function onKey(e) {
      if (!wz) return;
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); return later(); }
      if (step === 3 && e.ctrlKey && (e.key === "k" || e.key === "K")) {
        e.preventDefault(); e.stopPropagation();
        ui.tried = true; const m = body.querySelector('[data-move="k"]');
        if (m && !m.classList.contains("done")) { m.classList.add("done"); anim(m, [{ transform: "scale(1)" }, { transform: "scale(1.06) rotate(-1deg)" }, { transform: "none" }], { duration: 420, easing: spring }); sfx("pop"); saveG({ tasks: { palette: true } }); }
      }
      if (e.key === "Enter" && !typing(e) && !e.target.closest("button")) { e.preventDefault(); go(1); }
    }
    function go(d) {
      if (d > 0 && step === 1 && !pick.size) return say("Pick at least one tool", { bad: true });
      dir = d; step = Math.max(0, Math.min(STEPS.length - 1, step + d)); paint();
    }
    function later() { saveG({ onboarded: true }); if (G.fresh) ["qt-new-v4", "qt-new-v5", "qt-new-v6"].forEach(k => lsSet(k, true)); close(); paintCheck(); }
    document.addEventListener("keydown", onKey, true);
    wz.addEventListener("click", async e => {
      const b = e.target.closest("button"); if (!b) return;
      const g = b.dataset.gw;
      if (g === "next") return go(1);
      if (g === "back") return go(-1);
      if (g === "close" || g === "skip") return later();
      if (g === "restore") {   // spark.js loads the file (its change listener) and reloads the page
        const inp = wz.querySelector("[data-bk-file]");
        await saveG({ onboarded: true, tasks: { pick: true } }); ["qt-new-v4", "qt-new-v5", "qt-new-v6"].forEach(k => lsSet(k, true));
        return inp.click();
      }
      if (g === "finish" || g === "tour" || g === "help") return finish(g);
      if (b.dataset.pick) {
        const id = b.dataset.pick, on = !pick.has(id);
        on ? pick.add(id) : pick.delete(id);
        b.classList.toggle("on", on); b.setAttribute("aria-pressed", on);
        anim(b, [{ transform: "scale(1)" }, { transform: on ? "scale(.92, 1.06)" : "scale(1.04, .94)" }, { transform: "none" }], { duration: 320, easing: spring });
        wz.querySelector(".gw-count").textContent = count(); sfx(on ? "pop" : "tick");
        return;
      }
      if (b.dataset.pre) {
        const p = PRESETS.find(x => x[0] === b.dataset.pre);
        pick.clear(); list.forEach(t => { if (!p[3] || p[3].includes(t.id)) pick.add(t.id); });
        wz.querySelectorAll(".gw-pre").forEach(x => x.classList.toggle("on", x === b));
        wz.querySelectorAll(".gw-tool").forEach((c, i) => {
          const on = pick.has(c.dataset.pick); if (on === c.classList.contains("on")) return;
          c.classList.toggle("on", on); c.setAttribute("aria-pressed", on);
          anim(c, [{ transform: "scale(1)" }, { transform: "scale(.9) rotate(-2deg)" }, { transform: "none" }], { duration: 360, delay: i * 22, easing: spring });
        });
        wz.querySelector(".gw-count").textContent = count(); sfx("pop");
        return;
      }
      if (b.dataset.opt) {
        const on = b.getAttribute("aria-checked") !== "true"; b.setAttribute("aria-checked", on); ui[b.dataset.opt] = on;
        if (b.dataset.opt === "sfx" && on) { lsSet("qt-sfx", true); sfx("pop"); }
        return;
      }
      if (b.dataset.motion) { ui.motion = b.dataset.motion; b.parentElement.querySelectorAll("button").forEach(x => x.setAttribute("aria-checked", x === b)); }
    });
    paint();
  }
  window.qtWelcome = welcome;

  /* little ink confetti (round 17) */
  function cheer(el, n = 18) {
    if (calm() || !el) return;
    const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const cols = ["var(--qt-accent)", "var(--qt-volt)", "var(--qt-soundboard)", "var(--qt-launchpad)", "var(--qt-kharcha)", "var(--qt-inkmotion)"];
    for (let i = 0; i < n; i++) {
      const p = document.createElement("i"); p.className = "gd-bit" + (i % 3 ? "" : " sq");
      p.style.left = cx + "px"; p.style.top = cy + "px"; p.style.background = cols[i % cols.length];
      document.body.append(p);
      const a = (i / n) * Math.PI * 2 + Math.random() * .3, d = 60 + Math.random() * 70;
      p.animate([{ transform: "translate(-50%,-50%) scale(1.2)", opacity: 1 },
        { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d - 20}px)) scale(.9) rotate(${a * 3}rad)`, opacity: 1, offset: .6 },
        { transform: `translate(calc(-50% + ${Math.cos(a) * d * 1.1}px), calc(-50% + ${Math.sin(a) * d + 50}px)) scale(.3) rotate(${a * 5}rad)`, opacity: 0 }],
        { duration: 900 + Math.random() * 300, easing: "cubic-bezier(.2,.8,.4,1)" }).finished.then(() => p.remove(), () => p.remove());
    }
  }
  window.qtCheer = cheer;

  /* ===================================================================================
     TOUR: a spotlight that glides between parts of the window (round 16 motion)
     =================================================================================== */
  const TOUR = [
    ["#nav", "Your tools", "Everything you picked lives on this rail. Click one to open it. Drag to change the order. Right-click for start, stop and more."],
    [".rail .brand", "Home", "Back to this page any time. Ctrl + 0 does it too."],
    ["#tiles", "Tiles", "The dot shows if a tool is running. Tools start on their own the first time you open them."],
    ["#glance", "Today", "A quick look at your day: spending, disk, downloads and phone alerts. Click a card to jump in."],
    [".rail-btns", "The little buttons", "Activity (what started and stopped), Settings, clipboard, status, and Help."],
    [null, "Search everything", "Press Ctrl + K anywhere. Type a tool, a file name, a sum like 12% of 450, or paste a link."],
    ["#gd-help-btn", "Help is here", "Stuck? Press F1 or this button. It explains the tool you're in and checks your setup."],
  ];
  const TOUR_SET = [
    [".settings .shead .gd-search", "Find a setting", "Type a word like motion, sounds or startup and only the matching settings stay."],
    ["#slist", "Your tools", "Show or hide each tool, pick which start with the suite, and drag to change the order."],
    ["#gd-comfort", "Help and comfort", "Bigger text, stronger contrast, tips on or off, and the welcome again."],
    ["#sdef", "Windows default apps", "Let pictures, videos, PDFs and zips from Explorer open in QT. Undo puts everything back."],
    ["#sx-extras", "Extras", "Clock, sounds, meters, and Backup: save every setting and note to one file."],
  ];
  let tr = null;
  async function tour(which) {
    if (tr) return;
    const SET = which === "settings";
    if (SET) { if (current !== "settings") show("settings"); }
    else if (current !== "home") show("home");
    await new Promise(r => setTimeout(r, SET ? 700 : 260));
    const TOUR_ = SET ? TOUR_SET : TOUR;
    let i = 0;
    tr = document.createElement("div");
    tr.className = "gt-wrap";
    tr.innerHTML = `<div class="gt-hole"></div><div class="gt-tip qt-card" role="dialog" aria-live="polite"><div class="gt-n qt-mono"></div><h3 class="qt-display"></h3><p></p>
      <div class="gt-btns"><button class="qt-btn ghost" data-gt="end">Skip tour</button><span class="sp"></span><button class="qt-btn ghost" data-gt="back">←</button><button class="qt-btn primary" data-gt="next">Next →</button></div><i class="gt-arrow"></i></div>`;
    document.body.append(tr);
    const hole = tr.querySelector(".gt-hole"), tip = tr.querySelector(".gt-tip");
    const steps = TOUR_.filter(([sel]) => !sel || (document.querySelector(sel) && document.querySelector(sel).offsetParent));
    function place() {
      const [sel, h, p] = steps[i];
      const el = sel && document.querySelector(sel);
      tip.querySelector(".gt-n").textContent = `${i + 1} / ${steps.length}`;
      tip.querySelector("h3").textContent = h; tip.querySelector("p").textContent = p;
      tip.querySelector('[data-gt="back"]').disabled = i === 0;
      tip.querySelector('[data-gt="next"]').textContent = i === steps.length - 1 ? "Done ✓" : "Next →";
      let r;
      if (el) { el.scrollIntoView({ block: SET ? "center" : "nearest" }); r = el.getBoundingClientRect(); }
      const pad = 8;
      if (r) {
        Object.assign(hole.style, { left: r.left - pad + "px", top: r.top - pad + "px", width: Math.min(r.width + pad * 2, innerWidth - 16) + "px", height: Math.min(r.height + pad * 2, innerHeight - 16) + "px", borderRadius: "16px", opacity: 1 });
      } else {
        Object.assign(hole.style, { left: innerWidth / 2 - 4 + "px", top: innerHeight / 2 - 4 + "px", width: "8px", height: "8px", borderRadius: "50%", opacity: .01 });
      }
      // put the tip beside the spot: right of the rail, else below, else above, else centre
      const tw = tip.offsetWidth || 340, th = tip.offsetHeight || 180;
      let x, y, side;
      if (!r) { x = innerWidth / 2 - tw / 2; y = innerHeight / 2 - th / 2; side = "none"; }
      else if (r.right + tw + 30 < innerWidth && r.width < innerWidth / 2) { x = r.right + 22; y = Math.max(14, Math.min(innerHeight - th - 14, r.top + Math.min(r.height, 200) / 2 - th / 2)); side = "left"; }
      else if (r.bottom + th + 30 < innerHeight) { x = Math.max(14, Math.min(innerWidth - tw - 14, r.left + 20)); y = r.bottom + 22; side = "top"; }
      else { x = Math.max(14, Math.min(innerWidth - tw - 14, r.left + 20)); y = Math.max(14, r.top - th - 22); side = "bottom"; }
      tip.dataset.side = side;
      tip.style.transform = `translate(${x}px, ${y}px)`;
      anim(tip.querySelector("h3"), [{ transform: "translateY(8px) rotate(-2deg)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 380, easing: spring });
      anim(hole, [{ scale: "1 1" }, { scale: "1.04 .97" }, { scale: "1 1" }], { duration: 420, delay: 260, easing: "ease-out" });
      tip.querySelector('[data-gt="next"]').focus({ preventScroll: true });
    }
    function end(done) {
      if (!tr) return;
      const t = tr; tr = null;
      document.removeEventListener("keydown", key, true); removeEventListener("resize", place);
      t.classList.add("out"); setTimeout(() => t.remove(), 260);
      if (!SET) saveG({ tour: true });
      if (done) { say(SET ? "That's Settings. The search box finds the rest." : "Tour done. F1 brings help back any time.", { icon: "suite" }); sfx("done"); }
    }
    function step(d) { if (i + d >= steps.length) return end(true); i = Math.max(0, i + d); place(); }
    function key(e) {
      if (!tr) return;
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); end(false); }
      else if (e.key === "ArrowRight" || (e.key === "Enter" && !e.target.closest("button"))) { e.preventDefault(); step(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
    }
    tr.addEventListener("click", e => { const g = e.target.closest("[data-gt]"); if (!g) return; g.dataset.gt === "end" ? end(false) : step(g.dataset.gt === "next" ? 1 : -1); });
    document.addEventListener("keydown", key, true); addEventListener("resize", place);
    requestAnimationFrame(place);
  }
  window.qtTour = tour;
  function spot(id) {
    let el = document.querySelector(`#nav .nav[data-go="${id}"]`);
    if (!el) el = document.querySelector("#nav .nav-group");   // file apps sit in the Files group
    if (!el) return say("That tool is hidden. Use + Show first.", { bad: true });
    document.querySelectorAll(".gd-spot").forEach(x => x.remove());
    const r = el.getBoundingClientRect(), t = byId(id);
    const s = document.createElement("div"); s.className = "gd-spot";
    s.innerHTML = `<div class="gt-hole" style="left:${r.left - 6}px;top:${r.top - 6}px;width:${r.width + 12}px;height:${r.height + 12}px;border-radius:14px"></div>
      <div class="gd-spot-lab qt-card" style="left:${r.right + 20}px;top:${r.top + r.height / 2}px">👈 ${esc(t ? t.name : "")} lives here${el.classList.contains("nav-group") ? ", inside Files" : ""}</div>`;
    document.body.append(s);
    const bye = () => { s.classList.add("out"); setTimeout(() => s.remove(), 260); removeEventListener("pointerdown", bye, true); };
    setTimeout(() => addEventListener("pointerdown", bye, true), 50); setTimeout(bye, 3200);
  }

  /* ===================================================================================
     HELP VIEW (#help) + rail button + F1 (round 13: opens on the tool you're in)
     =================================================================================== */
  window.qtViews = Object.assign(window.qtViews || {}, { help: true });
  const FAQ = [
    ["start", "How do I open a tool?", "Click it on the rail or Home, or press Ctrl + its number. A tool that isn't running starts by itself, which takes a few seconds the first time.", "open start launch tool run"],
    ["phone", "How do I connect my phone?", "Open Beam and scan its QR code with your phone's camera. Your phone and PC need to be on the same Wi-Fi. For sharing from any app, alerts and spending, install the Beam phone app from the APKs tool.", "phone android connect pair qr wifi beam"],
    ["send", "How do I send a file to my phone?", "Drop it on Beam, or right-click it in Burrow and pick Send to phone. Links pasted into Ctrl+K can go to your phone as a note.", "send file phone share transfer"],
    ["download", "How do I download a video or song from a link?", "Open VOLT and paste the link, or paste it straight into Ctrl+K and pick Download with VOLT. Files land in your Downloads folder.", "download video youtube song music link volt mp3"],
    ["files", "How do I open my files in the suite?", "Search with Ctrl+K or Burrow, then press Enter. Pictures, video, music, PDFs, code and zips open right here. In Settings you can also make QT the Windows app for those files.", "file open view picture pdf default explorer"],
    ["hide", "How do I hide or reorder tools?", "Settings (Ctrl + ,) lists every tool. Switch Show off to hide one, drag the dots to reorder. Or run the welcome again to pick from scratch.", "hide remove reorder order rail tools pick"],
    ["tray", "Where did it go when I closed the window?", "The suite keeps running in the tray, by the clock, so your phone can still reach it. Click the tray icon to bring it back, or right-click it and pick Quit to stop everything.", "close tray quit exit closed gone background"],
    ["start-win", "Can it start when Windows starts?", "Yes. Settings, Startup, Start with Windows. It starts quietly in the tray.", "startup boot windows sign in autostart"],
    ["slow", "A tool says it can't start", "Another program may be using its port. Run Check my setup below: it tells you which port is busy. Restarting the PC usually frees it.", "error port busy start fail broken crash not working"],
    ["data", "Where are my settings and notes kept?", "In your user folder under AppData\\Local\\QT Suite. Settings, Extras has Backup to save them all to one file, and Load to bring them back.", "data settings notes backup where saved folder"],
    ["private", "Does anything go online?", "Only what you ask for: VOLT downloads, Surf pages and web searches. The suite listens on this PC only, and phone tools talk over your own Wi-Fi.", "privacy private online cloud internet tracking safe"],
    ["uninstall", "How do I remove it?", "Windows Settings, Apps, QT Suite, Uninstall. It asks whether to keep your settings and notes.", "uninstall remove delete"],
  ];
  const TIPS = [
    "Type a sum in Ctrl+K, like 18% of 2400 or 5 km in miles.",
    "Paste a link into Ctrl+K to download it with VOLT or send it to your phone.",
    "Hold Ctrl and tap E to flip between recent tools.",
    "Ctrl + \\ puts two tools side by side.",
    "Ctrl + J opens your notes from anywhere in the suite.",
    "Drop a file on a tool's rail button to open it there.",
    "Right-click a tool for restart, stop and open its folder.",
    "Type remind me in 10 min to stretch in Ctrl+K.",
    "Ctrl + Shift + V shows the last things you copied.",
    "Press P in a file preview to pin it to Home.",
    "Shift + F1 turns on What's this: point at anything to learn what it does.",
    "Settings, Extras, Backup saves all your settings and notes to one file.",
  ];
  let helpEl = null;
  function ensureHelp() {
    if (helpEl) return;
    helpEl = frames.help = document.createElement("section");
    helpEl.className = "view panel gd-help qt-dots";
    helpEl.dataset.tool = "home"; helpEl.hidden = true;
    document.getElementById("frames").append(helpEl);
  }
  const prevShow = show;
  show = function (id) {
    if (id === "help") ensureHelp();
    prevShow(id);
    if (id === "help") renderHelp();
    if (id === "settings") task("settings");
    if (id === "help") task("help");
    if (byId(id)) { task("tool"); setTimeout(() => firstTip(id), 900); }
    document.title = id === "help" ? "Help · QT Suite" : document.title;
  };
  let helpFor = null;
  async function renderHelp() {
    await ready;
    const all = await allTools();
    const hid = all.filter(t => t.hidden);
    helpEl.innerHTML = `
      <header class="shead"><div class="qt-eyebrow">QT Suite ${esc(G.version || "")}</div><h1 class="qt-display">Help</h1>
        <p class="lede">New here? Start with the welcome or the tour. Looking for something? Search below.</p>
        <label class="gd-search"><i>⌕</i><input class="qt-input" type="search" placeholder="Search help: phone, download, hide, tray..." aria-label="Search help"><kbd>/</kbd></label></header>
      <div class="gd-start">
        <button class="gd-big qt-card" data-gh="welcome" style="--i:0"><i>👋</i><b>Run the welcome</b><small>Pick your tools again, startup and motion.</small></button>
        <button class="gd-big qt-card" data-gh="tour" style="--i:1"><i>🧭</i><b>Take the tour</b><small>30 seconds, shows where everything is.</small></button>
        <button class="gd-big qt-card" data-gh="doctor" style="--i:2"><i>🩺</i><b>Check my setup</b><small>Finds busy ports and missing pieces.</small></button>
        <button class="gd-big qt-card" data-gh="keys" style="--i:3"><i>⌨</i><b>Shortcuts</b><small>Every key in one list. Or press ?</small></button>
      </div>
      <section class="sbox qt-card gd-doc" id="gd-doctor" hidden><div class="sbh"><h2>Setup check</h2><button class="qt-btn ghost" data-gh="doctor">↻ Again</button></div><div class="gd-checks"></div></section>
      <section class="sbox qt-card gd-steps"><h2>Getting started</h2><ol>
        <li style="--i:0"><b>Open a tool.</b> Click it on the rail. The first start takes a few seconds.</li>
        <li style="--i:1"><b>Connect your phone.</b> Open Beam and scan the QR code with your phone camera, on the same Wi-Fi.</li>
        <li style="--i:2"><b>Find a file.</b> Press Ctrl + K and type part of its name. Enter opens it here.</li>
        <li style="--i:3"><b>Make it yours.</b> Settings (Ctrl + ,) sets the order, what starts with the suite, and the look.</li>
        <li style="--i:4"><b>Close the window when done.</b> The suite stays in the tray. Right-click the tray icon to quit.</li></ol></section>
      <h2 class="gd-sec">Your tools</h2>
      <div class="gd-tools">${all.map((t, i) => `<article class="gd-tool qt-card" id="help-${t.id}" data-tool="${t.id}" data-words="${esc((t.name + " " + t.tag + " " + (t.blurb || "") + " " + ((INFO[t.id] || {}).how || []).join(" ")).toLowerCase())}" style="--i:${i}">
          <header><img src="/icons/${t.id}.svg" alt=""><span><b>${esc(t.name)}</b><em>${esc(t.tag)}</em></span>${t.hidden ? `<button class="qt-btn ghost" data-unhide="${t.id}" title="Show ${esc(t.name)} on the rail">+ Show</button>` : `<span class="gd-tb"><button class="qt-btn ghost" data-gh="spot" data-id="${t.id}" title="Show me where it is" aria-label="Show me where ${esc(t.name)} is">◎</button><button class="qt-btn ghost" data-go="${t.id}">Open →</button></span>`}</header>
          <p>${esc(t.blurb || "")}</p>${((INFO[t.id] || {}).how || []).length ? `<ul>${INFO[t.id].how.map(h => `<li>${esc(h)}</li>`).join("")}</ul>` : ""}
          <div class="gd-needs">${needChips(t.id)}</div></article>`).join("")}</div>
      <h2 class="gd-sec">Questions</h2>
      <div class="gd-faq">${FAQ.map(([k, q, a, w], i) => `<details class="qt-card" id="faq-${k}" data-words="${esc((q + " " + a + " " + w).toLowerCase())}" style="--i:${i}"><summary><b>${esc(q)}</b><i aria-hidden="true">+</i></summary><div><p>${esc(a)}</p></div></details>`).join("")}</div>
      <p class="gd-none qt-muted" hidden>Nothing in Help matches that. Try Ctrl + K, it searches tools, actions and files too.</p>
      <details class="sbox qt-card gd-log" hidden><summary><h2>What changed lately</h2><i aria-hidden="true">+</i></summary><div class="gd-logbody"></div></details>
      <section class="sbox qt-card gd-about"><h2>About this copy</h2>
        <div class="sline"><span><b>Version</b><em class="qt-mono">QT Suite ${esc(G.version || "dev")}</em></span></div>
        <div class="sline"><span><b>Your data</b><em class="qt-mono">${esc(G.data || "")}</em></span><button class="qt-btn" data-gh="data">Open folder</button></div>
        <div class="sline"><span><b>Installed in</b><em class="qt-mono">${esc(G.install || "")}</em></span><button class="qt-btn" data-gh="install">Open folder</button></div>
        <div class="sline"><span><b>Report a problem</b><em>Copies a short report about this copy, with your name and PC name taken out, to paste into a bug report.</em></span><button class="qt-btn" data-gh="diag">Copy report</button></div>
        ${hid.length ? `<div class="sline"><span><b>Hidden tools</b><em>${esc(hid.map(t => t.name).join(", "))}</em></span><button class="qt-btn" data-gh="unhideall">Show all</button></div>` : ""}
      </section>`;
    api("/api/guide/changelog").then(r => {
      const box = helpEl.querySelector(".gd-log"); if (!box || !r.text) return;
      box.querySelector(".gd-logbody").innerHTML = mdLite(r.text); box.hidden = false;
    }).catch(() => {});
    const inp = helpEl.querySelector(".gd-search input");
    inp.addEventListener("input", () => filterHelp(inp.value));
    if (helpFor) { const id = helpFor; helpFor = null; setTimeout(() => focusHelp(id), 120); }
  }
  function mdLite(t) {   // headings + bullets + paragraphs is all a changelog needs
    const out = []; let inList = false;
    t.split(/\r?\n/).slice(0, 160).forEach(line => {
      const h = line.match(/^(#{1,4})\s+(.*)/), li = line.match(/^\s*[-*]\s+(.*)/);
      if (!li && inList) { out.push("</ul>"); inList = false; }
      if (h) { if (h[1].length > 1) out.push(`<h3>${esc(h[2])}</h3>`); }
      else if (li) { if (!inList) { out.push("<ul>"); inList = true; } out.push(`<li>${esc(li[1]).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`(.+?)`/g, "<code>$1</code>")}</li>`); }
      else if (line.trim()) out.push(`<p>${esc(line)}</p>`);
    });
    if (inList) out.push("</ul>");
    return out.join("");
  }
  function filterHelp(q) {
    q = q.trim().toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    let n = 0;
    helpEl.querySelectorAll("[data-words]").forEach(el => {
      const hit = !words.length || words.every(w => el.dataset.words.includes(w));
      el.hidden = !hit; if (hit) n++;
      if (hit && words.length && el.tagName === "DETAILS") el.open = true;
      if (!words.length && el.tagName === "DETAILS") el.open = false;
    });
    helpEl.querySelectorAll(".gd-sec").forEach(h => { const box = h.nextElementSibling; h.hidden = box && ![...box.children].some(c => !c.hidden); });
    helpEl.querySelector(".gd-none").hidden = n > 0;
    ["gd-start", "gd-steps", "gd-about"].forEach(c => { const el = helpEl.querySelector("." + c); if (el) el.hidden = !!words.length; });
  }
  function focusHelp(target) {
    const el = helpEl && helpEl.querySelector(target.startsWith("faq-") ? "#" + target : "#help-" + target);
    if (!el) return;
    if (el.tagName === "DETAILS") el.open = true;
    el.scrollIntoView({ block: "center", behavior: calm() ? "auto" : "smooth" });
    el.classList.remove("gd-flash"); void el.offsetWidth; el.classList.add("gd-flash");
  }
  function openHelp(target) {
    if (target) helpFor = target;
    if (current === "help" && target) return focusHelp(target);
    show("help");
  }
  window.qtHelp = openHelp;
  helpEl = null;
  document.addEventListener("click", async e => {
    const g = e.target.closest("[data-gh]");
    if (g) {
      const k = g.dataset.gh;
      if (k === "welcome") return welcome();
      if (k === "tour") return tour();
      if (k === "settour") return tour("settings");
      if (k === "spot") return spot(g.dataset.id);
      if (k === "keys") return window.qtSheet ? window.qtSheet() : null;
      if (k === "doctor") return runDoctor();
      if (k === "data" || k === "install") return post("/api/guide/folder", { which: k }).catch(er => say(er.message, { bad: true }));
      if (k === "diag") return copyDiag();
      if (k === "unhideall") return unhide(null);
    }
    const u = e.target.closest("[data-unhide]");
    if (u) return unhide(u.dataset.unhide);
  });
  addEventListener("keydown", e => {
    if (e.key === "F1" && !e.shiftKey) { e.preventDefault(); return openHelp(byId(current) ? current : null); }
    if (e.key === "F1" && e.shiftKey) { e.preventDefault(); return whatsThis(); }
    if (e.key === "/" && current === "help" && !typing(e)) { e.preventDefault(); helpEl.querySelector(".gd-search input").focus(); }
  });
  // F1 from inside a tool's frame: the bridge only forwards some keys, so listen for focus coming back too
  window.addEventListener("message", e => { if (e.data && e.data.qt === "help") openHelp(byId(current) ? current : null); });

  // the ? button in the rail's icon row
  function addHelpBtn() {
    const rb = document.querySelector(".rail-btns");
    if (!rb || document.getElementById("gd-help-btn")) return;
    const b = document.createElement("button");
    b.className = "qt-btn ghost"; b.id = "gd-help-btn"; b.title = "Help (F1)"; b.setAttribute("aria-label", "Help");
    b.innerHTML = '<i class="gq">?</i><span>Help</span>';
    b.onclick = () => openHelp(byId(current) ? current : null);
    rb.append(b);
  }
  addHelpBtn(); setTimeout(addHelpBtn, 800);

  /* ---------- round 11: hidden tools ---------- */
  async function unhide(id) {
    const S = (window.qtS && window.qtS()) || { hidden: [] };
    const before = S.hidden.slice();
    const hidden = id ? before.filter(x => x !== id) : [];
    await window.qtSaveS({ hidden }); await window.qtRelayout();
    const t = id && (tools.find(x => x.id === id));
    say(id ? `${t ? t.name : "Tool"} is back on the rail` : "Every tool is back", { action: ["Undo", async () => { await window.qtSaveS({ hidden: before }); await window.qtRelayout(); if (current === "help") renderHelp(); }] });
    if (current === "help") renderHelp();
    paintHidden();
  }
  function paintHidden() {
    let el = document.getElementById("gd-hidden");
    const S = (window.qtS && window.qtS()) || { hidden: [] };
    const n = (S.hidden || []).length;
    if (!n) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement("p"); el.id = "gd-hidden"; el.className = "gd-hid qt-muted"; document.getElementById("tiles").after(el); }
    el.innerHTML = `<span>${n} tool${n > 1 ? "s are" : " is"} hidden.</span><button class="qt-btn ghost" data-gh-hid="show">Show them</button><button class="qt-btn ghost" data-gh-hid="pick">Pick again</button>`;
  }
  document.addEventListener("click", e => {
    const h = e.target.closest("[data-gh-hid]"); if (!h) return;
    if (h.dataset.ghHid === "show") unhide(null); else welcome({ step: 1 });
  });
  document.addEventListener("qt-settings", () => setTimeout(paintHidden, 50));
  document.addEventListener("qt-show", e => { if (e.detail === "home") setTimeout(paintHidden, 50); });

  /* ===================================================================================
     ROUND 3: setup doctor (+ round 19 motion: rows pop in one by one with a tick)
     =================================================================================== */
  async function runDoctor() {
    if (current !== "help") { show("help"); await new Promise(r => setTimeout(r, 200)); }
    const box = helpEl.querySelector("#gd-doctor"), list = box.querySelector(".gd-checks");
    box.hidden = false; box.scrollIntoView({ block: "start", behavior: calm() ? "auto" : "smooth" });
    list.innerHTML = `<div class="gd-wait"><span class="gd-spin"></span> Checking ports, Python, Edge and the VOLT engine...</div>`;
    let r;
    try { r = await api("/api/guide/doctor"); } catch (e) { list.innerHTML = `<p class="qt-muted">Couldn't run the check: ${esc(e.message)}</p>`; return; }
    const bad = r.checks.filter(c => c.level === "bad").length, warn = r.checks.filter(c => c.level === "warn").length;
    list.innerHTML = `<p class="gd-sum ${bad ? "bad" : warn ? "warn" : "ok"}">${bad ? `${bad} thing${bad > 1 ? "s" : ""} need fixing.` : warn ? `Mostly fine, ${warn} to look at.` : "Everything looks good."}</p>` +
      r.checks.map((c, i) => `<div class="gd-check ${c.level}" style="--i:${i}"><i class="gd-ic">${{ ok: "✓", warn: "!", bad: "✕", info: "i" }[c.level]}</i><span><b>${esc(c.label)}</b><em>${esc(c.msg)}</em></span>${fixBtn(c)}</div>`).join("");
    list.querySelectorAll(".gd-check").forEach((el, i) => anim(el, [{ transform: "translateX(-18px) scale(.96)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 380, delay: 60 * i, easing: spring, fill: "backwards" }));
    list.querySelectorAll(".gd-ic").forEach((el, i) => anim(el, [{ transform: "scale(0) rotate(-90deg)" }, { transform: "scale(1.3) rotate(10deg)", offset: .7 }, { transform: "none" }], { duration: 460, delay: 60 * i + 140, easing: "ease-out", fill: "backwards" }));
    if (!bad && !warn) setTimeout(() => cheer(list.querySelector(".gd-sum"), 12), 300);
  }
  const fixBtn = c => {
    if (!c.fix) return "";
    const [k, id] = c.fix.split(":");
    if (k === "start") return `<button class="qt-btn ghost" data-fix="${esc(c.fix)}">Start</button>`;
    if (k === "tool") return `<button class="qt-btn ghost" data-fix="${esc(c.fix)}">Open</button>`;
    if (k === "space") return `<button class="qt-btn ghost" data-fix="tool:space">Free space</button>`;
    if (k === "data") return `<button class="qt-btn ghost" data-gh="data">Open folder</button>`;
    return "";
  };
  document.addEventListener("click", async e => {
    const f = e.target.closest("[data-fix]"); if (!f) return;
    const [k, id] = f.dataset.fix.split(":"), t = byId(id);
    if (!t) return say("That tool is hidden. Show it from Help first.", { bad: true });
    if (k === "tool") return show(id);
    f.disabled = true; f.textContent = "Starting...";
    try { await startTool(t, f); f.textContent = "Started ✓"; } catch (er) { f.textContent = "Couldn't start"; say(er.message, { bad: true }); }
  });
  window.qtDoctor = runDoctor;

  async function copyDiag() {
    try {
      say("Writing the report...", { ms: 1800 });
      const r = await api("/api/guide/diag");
      window.qtLastDiag = r.text;
      try { await navigator.clipboard.writeText(r.text); }
      catch (_) {   // no focus or no permission: the old way still works from a click
        const ta = Object.assign(document.createElement("textarea"), { value: r.text }); ta.style.cssText = "position:fixed;opacity:0";
        document.body.append(ta); ta.select(); const ok = document.execCommand("copy"); ta.remove(); if (!ok) throw new Error("the clipboard is busy");
      }
      say("Report copied. Paste it into your bug report.", { icon: "suite" }); sfx("done");
    } catch (e) { say("Couldn't copy: " + e.message, { bad: true }); }
  }

  /* ===================================================================================
     ROUND 1: Get set up checklist on Home (+ round 17: ring fill, tick pop, confetti)
     =================================================================================== */
  const TASKS = [
    ["pick", "Pick your tools", () => welcome({ step: 1 })],
    ["palette", "Open search with Ctrl + K", () => window.qtPalOpen && window.qtPalOpen()],
    ["tool", "Open any tool", () => { const t = tools.find(x => x.kind !== "folder"); t && show(t.id); }],
    ["file", "Open a file in the suite", () => window.qtPalOpen && (window.qtPalOpen(), setTimeout(() => { const i = palInput(); if (i) { i.value = "."; i.dispatchEvent(new Event("input")); i.select(); } }, 80))],
    ["settings", "Visit Settings", () => show("settings")],
    ["help", "Look around Help", () => show("help")],
  ];
  let ck = null;
  function task(k) {
    if (!G.tasks || G.tasks[k]) return;
    G.tasks[k] = true;
    saveG({ tasks: { [k]: true } }).then(() => paintCheck(k));
  }
  window.qtTask = task;
  function paintCheck(justDone) {
    const show_ = AUTO && G.onboarded && G.tasks && !G.tasks.dismissed && current === "home";
    const done = TASKS.filter(([k]) => G.tasks && G.tasks[k]).length;
    if (!show_ || (done === TASKS.length && !justDone)) { if (ck) { ck.remove(); ck = null; } paintTip(); return; }
    if (!ck) {
      ck = document.createElement("section");
      ck.className = "gd-ck qt-card"; ck.setAttribute("aria-label", "Get set up");
      (document.getElementById("glance") || hero).after(ck);
    }
    const pct = done / TASKS.length, C = 2 * Math.PI * 22;
    ck.innerHTML = `<div class="gd-ring" aria-hidden="true"><svg viewBox="0 0 54 54"><circle cx="27" cy="27" r="22" class="bg"/><circle cx="27" cy="27" r="22" class="fg" style="stroke-dasharray:${C};stroke-dashoffset:${C * (1 - pct)}"/></svg><b class="qt-mono">${done}/${TASKS.length}</b></div>
      <div class="gd-ck-main"><div class="gd-ck-head"><h2 class="qt-display">${done === TASKS.length ? "All set up!" : "Get set up"}</h2><span class="qt-muted">${done === TASKS.length ? "You know your way around. This card goes away now." : "A few first steps. Each one ticks itself."}</span>
        <button class="qt-btn ghost icon" data-ck="x" aria-label="Hide this list" title="Hide this list">✕</button></div>
        <ul>${TASKS.map(([k, label], i) => `<li><button class="gd-task${G.tasks[k] ? " done" : ""}" data-ck="${k}" style="--i:${i}"><i>${G.tasks[k] ? "✓" : i + 1}</i><span>${esc(label)}</span></button></li>`).join("")}</ul></div>`;
    if (justDone) {
      const fg = ck.querySelector(".fg");
      anim(fg, [{ strokeDashoffset: C * (1 - (done - 1) / TASKS.length) }, { strokeDashoffset: C * (1 - pct) }], { duration: 700, easing: "cubic-bezier(.3,1.5,.5,1)" });
      const t = ck.querySelector(`[data-ck="${justDone}"] i`);
      anim(t, [{ transform: "scale(.2) rotate(-120deg)" }, { transform: "scale(1.5) rotate(12deg)", offset: .6 }, { transform: "none" }], { duration: 560, easing: "ease-out" });
      if (done === TASKS.length) { setTimeout(() => cheer(ck.querySelector(".gd-ring"), 26), 300); sfx("done"); setTimeout(() => { saveG({ tasks: { dismissed: true } }); hideCheck(); }, 6000); }
    }
  }
  function hideCheck() {
    if (!ck) return;
    const c = ck; ck = null;
    const a = anim(c, [{ opacity: 1, transform: "none", height: c.offsetHeight + "px" }, { opacity: 0, transform: "scale(.95) translateY(-8px)", height: "0px", marginBottom: "-22px", paddingBlock: "0px" }], { duration: 380, easing: "cubic-bezier(.5,0,.75,0)", fill: "forwards" });
    a ? a.finished.then(() => { c.remove(); paintTip(); }, () => c.remove()) : (c.remove(), paintTip());
  }
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-ck]"); if (!b) return;
    if (b.dataset.ck === "x") { saveG({ tasks: { dismissed: true } }); hideCheck(); say("Hidden. Help has everything it pointed to.", { action: ["Undo", () => { saveG({ tasks: { dismissed: false } }).then(() => paintCheck()); }] }); return; }
    const t = TASKS.find(x => x[0] === b.dataset.ck); if (t) t[2]();
  });
  document.addEventListener("qt-show", e => setTimeout(() => paintCheck(), e.detail === "home" ? 60 : 0));
  // ticks that come from other layers
  new MutationObserver(() => { if (document.querySelector(".pal-wrap")) task("palette"); if (document.querySelector(".pk-wrap, .peek-wrap, .pk")) task("file"); })
    .observe(document.body, { childList: true });
  if (window.qtPeek) { const p = window.qtPeek; window.qtPeek = function () { task("file"); return p.apply(this, arguments); }; }

  /* ===================================================================================
     ROUND 5: tip of the day (+ round 20 motion: card flips to the next tip)
     =================================================================================== */
  let tipEl = null;
  function paintTip() {
    if (!AUTO || current !== "home" || ck || !lsGet("qt-tips", true) || lsGet("qt-tip-off", false)) { if (tipEl) { tipEl.remove(); tipEl = null; } return; }
    const day = Math.floor(Date.now() / 864e5);
    let n = lsGet("qt-tip-n", null);
    if (!n || n.day !== day) { n = { day, i: day % TIPS.length }; lsSet("qt-tip-n", n); }
    if (!tipEl) {
      tipEl = document.createElement("aside");
      tipEl.className = "gd-tipday"; tipEl.setAttribute("aria-label", "Tip");
      const after = document.getElementById("gd-hidden") || document.getElementById("tiles");
      (home.querySelector(".hint") || after).before(tipEl);
    }
    tipEl.innerHTML = `<span class="gd-bulb" aria-hidden="true">💡</span><span class="gd-tipt"><b>Tip</b> ${esc(TIPS[n.i % TIPS.length])}</span><button class="qt-btn ghost icon" data-tip="next" title="Another tip" aria-label="Another tip">↻</button><button class="qt-btn ghost icon" data-tip="off" title="No more tips" aria-label="No more tips">✕</button>`;
  }
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-tip]"); if (!b) return;
    if (b.dataset.tip === "off") { lsSet("qt-tip-off", true); const t = tipEl; tipEl = null; const a = anim(t, [{ opacity: 1 }, { opacity: 0, transform: "translateY(6px)" }], { duration: 220, fill: "forwards" }); a ? a.finished.then(() => t.remove()) : t.remove(); return say("Tips off. Settings, Help and comfort turns them back on."); }
    const n = lsGet("qt-tip-n", { day: 0, i: 0 }); n.i = (n.i + 1) % TIPS.length; lsSet("qt-tip-n", n);
    const t = tipEl.querySelector(".gd-tipt");
    const a = anim(t, [{ transform: "rotateX(0)" }, { transform: "rotateX(90deg)" }], { duration: 160, easing: "ease-in" });
    const swap = () => { t.innerHTML = `<b>Tip</b> ${esc(TIPS[n.i])}`; anim(t, [{ transform: "rotateX(-90deg)" }, { transform: "rotateX(12deg)", offset: .7 }, { transform: "none" }], { duration: 360, easing: "ease-out" }); };
    a ? a.finished.then(swap, swap) : swap();
    anim(b, [{ transform: "rotate(0)" }, { transform: "rotate(-360deg)" }], { duration: 500, easing: spring });
  });

  /* ===================================================================================
     ROUND 4: first time in a tool -> one friendly tip bubble
     =================================================================================== */
  function firstTip(id) {
    if (!AUTO || current !== id || !G.onboarded || (G.tips || {})[id] || !lsGet("qt-tips", true)) return;
    const how = (INFO[id] || {}).how; if (!how || !how.length) return;
    const t = byId(id); if (!t) return;
    G.tips = G.tips || {}; G.tips[id] = true; saveG({ tips: { [id]: true } });
    document.querySelectorAll(".gd-first").forEach(x => x.remove());
    const b = document.createElement("div");
    b.className = "gd-first qt-card"; b.dataset.tool = id; b.setAttribute("role", "status");
    b.innerHTML = `<img src="/icons/${id}.svg" alt=""><div><b>First time in ${esc(t.name)}?</b><p>${esc(how[0])}</p>${how[1] ? `<p class="qt-muted">${esc(how[1])}</p>` : ""}</div>
      <div class="gd-first-btns"><button class="qt-btn primary" data-ft="ok">Got it</button><button class="qt-btn ghost" data-ft="more">More help</button><button class="qt-btn ghost" data-ft="off">No more tips</button></div>`;
    document.getElementById("stage").append(b);
    const gone = () => { const a = anim(b, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(20px) scale(.95)" }], { duration: 220, fill: "forwards" }); a ? a.finished.then(() => b.remove()) : b.remove(); };
    b.addEventListener("click", e => {
      const k = (e.target.closest("[data-ft]") || {}).dataset; if (!k || !k.ft) return;
      if (k.ft === "off") { lsSet("qt-tips", false); say("Tips off. Settings, Help and comfort turns them back on."); }
      if (k.ft === "more") openHelp(id);
      gone();
    });
    const off = ev => { if (ev.detail !== id) { gone(); document.removeEventListener("qt-show", off); } };
    document.addEventListener("qt-show", off);
    setTimeout(() => b.isConnected && !b.matches(":hover") && gone(), 14000);
  }

  /* ===================================================================================
     ROUND 6: What's this? (Shift+F1): point at something, read what it does
     =================================================================================== */
  const WHAT = [
    ["#gd-help-btn", "Help: guides, questions and the setup check. F1 does the same."],
    ["#nav .nav-group", "Files: Pictures, Player, Reader, Code and Archive share this one button. Click for the list."],
    ["#nav .nav", t => { const x = byId(t.dataset.go); return x ? `${x.name}: ${x.blurb} Right-click for start, stop and more.` : ""; }],
    [".rail .brand", "Home: your tools, today's numbers and pinned files. Ctrl + 0."],
    [".rail-btns #refresh", "Status: checks which tools are running right now."],
    [".rail-btns", "Quick buttons: activity log, settings, clipboard history, status and help."],
    ["#tiles .tile", t => { const x = byId(t.dataset.go); return x ? `${x.name} tile. The dot is green when it's running. Click to open, right-click for more.` : ""; }],
    ["#glance .gcard", "A Today card. Click it to open the tool the number came from."],
    ["#glance", "Today strip: spending, free disk, new downloads and phone alerts. Turn it off in Settings."],
    [".sysm", "CPU, memory and network use of this PC right now. Click for the programs using the most."],
    [".gd-ck", "Get set up: first steps that tick themselves as you go."],
    [".gd-tipday", "Tip of the day. ↻ shows another."],
    ["#shelf", "Pinned files and new downloads. Press P in a file preview to pin it."],
    [".hero", "Home's header: greeting, clock and a quick look at your PC."],
    ["#frames iframe", "A tool, running inside the suite. It also works on its own in a browser."],
  ];
  let wt = null;
  function whatsThis() {
    if (wt) return wt.stop();
    const bub = document.createElement("div"); bub.className = "gd-what qt-card"; bub.hidden = true;
    const band = document.createElement("div"); band.className = "gd-what-band"; band.innerHTML = `<b>What's this?</b> Point at anything. Click or Esc to stop.`;
    document.body.append(bub, band); root.classList.add("gd-whatmode");
    let lastEl = null;
    const move = e => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      let hit = null, text = "";
      for (const [sel, t] of WHAT) { const m = el && el.closest(sel); if (m) { hit = m; text = typeof t === "function" ? t(m) : t; if (text) break; } }
      if (!text) { bub.hidden = true; if (lastEl) lastEl.classList.remove("gd-what-on"); lastEl = null; return; }
      if (hit !== lastEl) {
        if (lastEl) lastEl.classList.remove("gd-what-on");
        hit.classList.add("gd-what-on"); lastEl = hit;
        bub.textContent = text; bub.hidden = false;
        anim(bub, [{ transform: "scale(.85) rotate(-3deg)" }, { transform: "scale(1.04) rotate(1deg)", offset: .6 }, { transform: "none" }], { duration: 300, easing: "ease-out" });
      }
      const w = bub.offsetWidth, h = bub.offsetHeight;
      bub.style.left = Math.min(innerWidth - w - 10, e.clientX + 16) + "px";
      bub.style.top = Math.min(innerHeight - h - 10, e.clientY + 18) + "px";
    };
    const stop = () => {
      removeEventListener("mousemove", move, true); removeEventListener("click", clk, true); removeEventListener("keydown", esc_, true);
      if (lastEl) lastEl.classList.remove("gd-what-on");
      root.classList.remove("gd-whatmode"); bub.remove(); band.remove(); wt = null;
    };
    const clk = e => { e.preventDefault(); e.stopPropagation(); stop(); };
    const esc_ = e => { if (e.key === "Escape" || e.key === "F1") { e.preventDefault(); e.stopPropagation(); stop(); } };
    addEventListener("mousemove", move, true); addEventListener("click", clk, true); addEventListener("keydown", esc_, true);
    wt = { stop };
  }
  window.qtWhatsThis = whatsThis;

  /* ===================================================================================
     ROUND 7 + 9 + 14: Settings search, Help and comfort box (text size, contrast, tips, replay)
     =================================================================================== */
  function applyComfort() {
    const z = lsGet("qt-textsize", "normal");
    root.dataset.textsize = z;
    root.classList.toggle("qt-hc", !!lsGet("qt-hc", false));
    setTimeout(() => window.movePill && movePill(), 60);
  }
  applyComfort();
  const swb = (k, on, label) => `<button class="qt-switch" role="switch" aria-checked="${!!on}" data-gc="${k}" aria-label="${esc(label)}"></button>`;
  function comfortBox() {
    const z = lsGet("qt-textsize", "normal");
    return `<section class="sbox qt-card" id="gd-comfort"><h2>Help and comfort</h2>
      <div class="sline"><span><b>Text size</b><em>Makes the whole suite bigger. Tools inside keep their own size.</em></span>
        <div class="gw-seg" role="radiogroup" data-gts>${[["normal", "Normal"], ["large", "Large"], ["larger", "Larger"]].map(([v, l]) => `<button role="radio" data-tsz="${v}" aria-checked="${z === v}">${l}</button>`).join("")}</div></div>
      <div class="sline"><span><b>Stronger contrast</b><em>Brighter grey text and thicker outlines.</em></span>${swb("qt-hc", lsGet("qt-hc", false), "Stronger contrast")}</div>
      <div class="sline"><span><b>Tips</b><em>Tip of the day on Home and a hint the first time you open a tool.</em></span>${swb("qt-tips", lsGet("qt-tips", true) && !lsGet("qt-tip-off", false), "Tips")}</div>
      <div class="sline"><span><b>Getting started</b><em>See the welcome, tour or first-steps list again.</em></span>
        <span class="gd-row"><button class="qt-btn" data-gh="welcome">Welcome</button><button class="qt-btn" data-gh="tour">Tour</button><button class="qt-btn" data-gh="settour">Settings tour</button><button class="qt-btn ghost" data-gc-reset>Reset tips + steps</button></span></div>
    </section>`;
  }
  function addSettingsBits() {
    const set = document.querySelector(".view.settings");
    if (!set || !set.querySelector(".sgrid")) return;
    if (!set.querySelector("#gd-comfort")) set.querySelector(".sgrid").insertAdjacentHTML("afterbegin", comfortBox());
    const head = set.querySelector(".shead");
    if (head && !head.querySelector(".gd-search")) {
      head.insertAdjacentHTML("beforeend", `<label class="gd-search"><i>⌕</i><input class="qt-input" type="search" placeholder="Find a setting: motion, startup, sounds, text size..." aria-label="Find a setting"></label>`);
      const inp = head.querySelector("input");
      inp.addEventListener("input", () => filterSettings(set, inp.value));
      if (filterSettings.last) { inp.value = filterSettings.last; filterSettings(set, inp.value); }
    }
  }
  function filterSettings(set, q) {
    filterSettings.last = q;
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let any = 0;
    set.querySelectorAll(".sbox").forEach(box => {
      const title = (box.querySelector("h2") || {}).textContent || "";
      const titleHit = words.length && words.every(w => title.toLowerCase().includes(w));
      let n = 0;
      box.querySelectorAll(".sline, .srow, .krow").forEach(r => {
        const hit = !words.length || titleHit || words.every(w => r.textContent.toLowerCase().includes(w));
        r.classList.toggle("gd-miss", !hit); if (hit) n++;
        r.classList.toggle("gd-hit", !!words.length && hit && !titleHit);
      });
      box.hidden = !!words.length && !n && !titleHit; if (!box.hidden) any++;
    });
    let none = set.querySelector(".gd-snone");
    if (!none) { none = document.createElement("p"); none.className = "gd-snone qt-muted"; none.textContent = "No setting matches that. Help (F1) may know."; set.querySelector(".sgrid").before(none); }
    none.hidden = !!any || !words.length;
  }
  new MutationObserver(addSettingsBits).observe(document.getElementById("frames"), { childList: true, subtree: true });
  document.addEventListener("click", e => {
    const s = e.target.closest("[data-gc]");
    if (s) {
      const on = s.getAttribute("aria-checked") !== "true"; s.setAttribute("aria-checked", on);
      lsSet(s.dataset.gc, on); if (s.dataset.gc === "qt-tips" && on) lsSet("qt-tip-off", false);
      applyComfort(); return;
    }
    const z = e.target.closest("[data-tsz]");
    if (z) { lsSet("qt-textsize", z.dataset.tsz); z.parentElement.querySelectorAll("button").forEach(b => b.setAttribute("aria-checked", b === z)); applyComfort(); return; }
    if (e.target.closest("[data-gc-reset]")) {
      ["qt-tip-off", "qt-tip-n"].forEach(k => localStorage.removeItem(k)); lsSet("qt-tips", true);
      saveG({ tips: Object.fromEntries(Object.keys(G.tips || {}).map(k => [k, false])), tasks: Object.fromEntries([...TASKS.map(t => [t[0], false]), ["dismissed", false]]) })
        .then(() => say("Tips and first steps are back on Home"));
    }
  });

  /* ===================================================================================
     ROUND 2 + 8: Ctrl+K knows Help: actions, answers to questions, beginner hints
     =================================================================================== */
  palAdd((q, raw, out) => {
    const s = q.trim().toLowerCase();
    const act = [
      ["Help", "help guide how manual docs support f1", "?", () => openHelp(), "F1"],
      ["Take the tour", "tour guide walkthrough show around beginner", "🧭", () => tour()],
      ["Tour of Settings", "tour settings options preferences walkthrough", "⚙", () => tour("settings")],
      ["Run the welcome again", "welcome onboarding setup pick tools first run start over", "👋", () => welcome()],
      ["Pick which tools show", "pick choose tools hide show rail welcome", "✅", () => welcome({ step: 1 })],
      ["Check my setup", "doctor check setup diagnose problem broken port fix troubleshoot", "🩺", runDoctor],
      ["Copy a problem report", "bug report diagnostics copy issue problem", "📋", copyDiag],
      ["What's this? (point at things)", "whats this explain point hover what is", "🔍", whatsThis, "Shift F1"],
    ];
    act.forEach(([label, words, glyph, run, hint]) => { if (s && (label.toLowerCase().includes(s) || words.includes(s) || s.split(/\s+/).every(w => (label + " " + words).toLowerCase().includes(w)))) out.push({ label, words, glyph, run, hint, minor: !s }); });
    if (s.length >= 3) {
      const ws = s.replace(/[?!.]/g, "").split(/\s+/).filter(w => w.length > 2 && !["how", "the", "can", "what", "where", "does", "and", "for", "you", "with"].includes(w));
      if (ws.length) FAQ.forEach(([k, qq, a, w]) => {
        const hay = (qq + " " + w).toLowerCase();
        if (ws.every(x => hay.includes(x))) out.push({ label: "Help: " + qq, words: w, glyph: "💬", run: () => openHelp("faq-" + k), hint: "answer", minor: true });
      });
    }
  });
  // round 8: a first-timer's empty search box shows what it can do
  new MutationObserver(() => {
    const w = document.querySelector(".pal-wrap");
    if (!w || w.dataset.gd || !G.tasks || G.tasks.dismissed) return;
    w.dataset.gd = 1;
    const box = w.querySelector("input"); if (!box) return;
    const h = document.createElement("div"); h.className = "gd-palhint";
    h.innerHTML = ["beam", "12% of 450", "remind me in 10 min tea", "help phone"].map(x => `<button data-try="${esc(x)}">${esc(x)}</button>`).join("") + `<span>try one</span>`;
    box.closest(".pal, .pal-box, .pal-wrap > div")?.insertBefore(h, box.parentElement.nextSibling) || box.after(h);
    const sync = () => { h.hidden = !!box.value; }; box.addEventListener("input", sync); sync();
    h.addEventListener("mousedown", e => { const b = e.target.closest("[data-try]"); if (!b) return; e.preventDefault(); box.value = b.dataset.try; box.dispatchEvent(new Event("input", { bubbles: true })); box.focus(); });
  }).observe(document.body, { childList: true });

  /* ===================================================================================
     ROUND 14: what's new in this update, for people who used the suite before
     =================================================================================== */
  const NEW6 = [
    ["❓", "Help", "F1 or the ? on the rail. Explains the tool you're in.", () => openHelp()],
    ["🧭", "Tour", "A 30-second walk around the window.", () => tour()],
    ["🩺", "Check my setup", "Spots busy ports and missing pieces, with fix buttons.", () => runDoctor()],
    ["🔍", "What's this?", "Shift + F1, then point at anything.", () => whatsThis()],
    ["⚙", "Find a setting", "A search box on top of Settings.", () => show("settings")],
    ["🔠", "Bigger text", "Settings, Help and comfort: text size and contrast.", () => { show("settings"); setTimeout(() => { const el = document.getElementById("gd-comfort"); el && el.scrollIntoView({ block: "center" }); }, 300); }],
  ];
  function whatsNew6(force) {
    if (!AUTO && !force) return;
    if (!force && (lsGet("qt-new-v6", false) || G.fresh)) return;
    if (document.querySelector(".wn")) document.querySelector(".wn").remove();
    const c = document.createElement("section");
    c.className = "wn qt-card gd-wn"; c.setAttribute("aria-label", "What's new");
    c.innerHTML = `<div class="wn-head"><span class="wn-tag">NEW</span><h2 class="qt-display">Help is here</h2><button class="qt-btn ghost icon" data-wn6="x" aria-label="Got it" title="Got it">✕</button></div>
      <div class="wn-grid">${NEW6.map(([ic, t, d], i) => `<button class="wn-item" data-wn6="${i}" style="--i:${i}"><i>${ic}</i><b>${esc(t)}</b><small>${esc(d)}</small><em>Try it →</em></button>`).join("")}</div>`;
    hero.after(c);
    c.addEventListener("click", e => {
      const b = e.target.closest("[data-wn6]"); if (!b) return;
      if (b.dataset.wn6 === "x") {
        ["qt-new-v4", "qt-new-v5", "qt-new-v6"].forEach(k => lsSet(k, true));
        const a = anim(c, [{ transform: "none", opacity: 1, height: c.offsetHeight + "px" }, { transform: "scale(.96) translateY(-10px)", opacity: 0, height: "0px", marginBottom: "-22px" }], { duration: 360, easing: "cubic-bezier(.5,0,.75,0)", fill: "forwards" });
        return a ? a.finished.then(() => c.remove(), () => c.remove()) : c.remove();
      }
      NEW6[+b.dataset.wn6][3]();
    });
  }
  window.qtWhatsNew6 = whatsNew6;
  palAdd((q, raw, out) => out.push({ label: "What's new: Help, tour and setup check", words: "new whats changelog features help tour update", glyph: "✨", minor: true, run: () => { show("home"); setTimeout(() => whatsNew6(true), 200); } }));

  /* ---------- start ---------- */
  ready.then(() => {
    if (!G.onboarded && AUTO) { ["qt-new-v4", "qt-new-v5", "qt-new-v6"].forEach(k => lsSet(k, true)); document.querySelectorAll(".wn").forEach(w => w.remove()); setTimeout(() => welcome(), 500); }
    else setTimeout(() => { if (current === "home" && !lsGet("qt-new-v6", false) && !G.fresh) whatsNew6(); }, 1400);
    paintCheck(); paintHidden();
  });
})();
