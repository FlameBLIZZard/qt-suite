/* Toolkit panels: universal search, hotkeys, macros, plugins, auto-update, share links, achievements, streak calendar. */
(() => {
  const K = window.qtKit, { api, esc, say, qrSvg, ago } = K;

  K.panel("search", async el => {
    el.innerHTML = `<div class="kp qt-card"><input class="qt-input" id="us" placeholder="Search everything: spends, songs, clips, games, notes, macros, commands..." style="font-size:18px;padding:14px">
      <p class="kmini">The same results show up in Ctrl+K under the tool list. Toolkit features match by name too.</p><div id="ur"></div></div>`;
    const inp = el.querySelector("#us"); inp.focus();
    let t = 0, seq = 0;
    inp.oninput = () => { clearTimeout(t); t = setTimeout(run, 220); };
    async function run() {
      const q = inp.value.trim(), my = ++seq, out = el.querySelector("#ur");
      if (q.length < 2) { out.innerHTML = ""; return; }
      const feats = Object.values(K.F).filter(f => (f.name + " " + f.blurb).toLowerCase().includes(q.toLowerCase()));
      const r = await api("/api/kit/search?q=" + encodeURIComponent(q));
      if (my !== seq) return;
      const groups = (feats.length ? [{ name: "Toolkit", items: feats.map(f => ({ title: f.icon + " " + f.name, sub: f.blurb, go: "kit/" + f.id })) }] : []).concat(r.groups);
      out.innerHTML = groups.length ? groups.map((g, gi) => `<h3 class="qt-eyebrow" style="margin:14px 0 6px">${esc(g.name)}</h3><div class="klist">${g.items.map((it, i) => `<button class="kitem" data-hit="${gi}:${i}" style="cursor:pointer;color:var(--qt-fg);font:inherit;text-align:left">
        <div class="grow"><b>${esc(it.title)}</b><span>${esc(it.sub || "")}</span></div><span class="kmini">${it.run ? "Run" : it.copy ? "Copy" : it.game ? "Play" : it.play ? "Play" : "Open"}</span></button>`).join("")}</div>`).join("")
        : `<div class="kempty">Nothing found for "${esc(q)}".</div>`;
      out.onclick = e => { const h = e.target.closest("[data-hit]"); if (!h) return; const [gi, i] = h.dataset.hit.split(":").map(Number); K.runHit(groups[gi].items[i]); };
    }
  });

  K.panel("hotkeys", async el => {
    let s = await api("/api/kit/hotkeys");
    const draw = () => {
      el.innerHTML = `<div class="kp qt-card"><h3>Global hotkeys <span class="kmini">work in every app while the Suite runs</span></h3>
        <div class="klist">${s.binds.map((b, i) => `<div class="kitem" data-i="${i}"><input class="qt-input" data-combo value="${esc(b.combo)}" style="width:180px;font-family:var(--qt-mono)" title="Click, then press the keys">
          <div class="grow ae">${K.actionEditor(b.action, s.named, s.macros)}</div>
          <span class="kmini ${b.status === "ok" ? "ok" : b.status === "off" ? "" : "bad"}">${b.status === "ok" ? "\u2713 active" : esc(b.status)}</span>
          <button class="qt-switch" role="switch" data-on aria-checked="${b.on !== false}" title="On / off"></button><button class="qt-btn ghost kbtn-sm" data-del>\u2715</button></div>`).join("")}</div>
        <div class="krow"><button class="qt-btn" data-add>+ Add hotkey</button><button class="qt-btn primary" data-save>Save</button><button class="qt-btn ghost" data-reset>Reset to defaults</button></div>
        <p class="kmini">Click a key box and press the combo (needs Ctrl, Alt, Shift or Win, or an F key). "Taken by another app" means some other program already owns that combo.</p></div>`;
      el.querySelectorAll(".ae").forEach(a => K.wireActionEditor(a, s.named, s.macros));
    };
    // need the editor helpers from the phone file
    if (!K.actionEditor) await new Promise((res, rej) => { const sc = document.createElement("script"); sc.src = "/kit/p-phone.js"; sc.onload = res; sc.onerror = rej; document.head.append(sc); });
    draw();
    el.addEventListener("keydown", e => {
      if (!e.target.matches("[data-combo]")) return;
      if (e.key === "Tab") return;
      e.preventDefault();
      if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
      const parts = []; if (e.ctrlKey) parts.push("ctrl"); if (e.altKey) parts.push("alt"); if (e.shiftKey) parts.push("shift"); if (e.metaKey) parts.push("win");
      const map = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down", " ": "space", Escape: "esc", PageUp: "pageup", PageDown: "pagedown" };
      parts.push(map[e.key] || e.key.toLowerCase()); e.target.value = parts.join("+");
    });
    const collect = () => [...el.querySelectorAll(".kitem[data-i]")].map(r => ({ id: s.binds[+r.dataset.i].id, combo: r.querySelector("[data-combo]").value, on: r.querySelector("[data-on]").getAttribute("aria-checked") === "true", action: K.readAction(r.querySelector(".ae")) }));
    el.addEventListener("click", async e => {
      try {
        if (e.target.closest("[data-on]")) { const b = e.target.closest("[data-on]"); b.setAttribute("aria-checked", b.getAttribute("aria-checked") !== "true"); }
        if (e.target.closest("[data-del]")) { const i = +e.target.closest("[data-i]").dataset.i; s.binds = collect(); s.binds.splice(i, 1); draw(); }
        if (e.target.closest("[data-add]")) { s.binds = collect(); s.binds.push({ id: "", combo: "ctrl+alt+", action: { type: "kit", name: "focus.toggle" }, on: true }); draw(); }
        if (e.target.closest("[data-save]")) { s = await api("/api/kit/hotkeys", { binds: collect() }); draw(); const bad = s.binds.filter(b => b.status !== "ok" && b.status !== "off"); say(bad.length ? `${bad.length} couldn't be set` : "Hotkeys saved", { bad: !!bad.length }); }
        if (e.target.closest("[data-reset]")) { s = await api("/api/kit/hotkeys", { op: "reset" }); draw(); }
      } catch (err) { say(err.message, { bad: true }); }
    });
  });

  K.panel("macros", async el => {
    if (!K.actionEditor) await new Promise((res, rej) => { const sc = document.createElement("script"); sc.src = "/kit/p-phone.js"; sc.onload = res; sc.onerror = rej; document.head.append(sc); });
    let s = await api("/api/kit/macros"), cur = s.items[0] ? JSON.parse(JSON.stringify(s.items[0])) : null;
    const draw = () => {
      el.innerHTML = `<div class="kcols"><section class="kp qt-card"><h3>Macros</h3><div class="klist">${s.items.map(m => `<div class="kitem"><button class="grow" data-pick="${m.id}" style="all:unset;cursor:pointer;flex:1"><b>${esc(m.name)}</b><span class="kmini">${esc(m.descs.join(" \u2192 "))}</span></button>
          <button class="qt-btn kbtn-sm" data-run="${m.id}">Run</button></div>`).join("") || `<div class="kempty">None yet</div>`}</div>
          <button class="qt-btn" data-new>+ New macro</button><p class="kmini">Run a macro from a hotkey, a stream deck button or Ctrl+K.</p></section>
        <section class="kp qt-card">${cur ? `<label class="kfield">Name<input class="qt-input" id="mn" value="${esc(cur.name)}"></label>
          <div class="klist">${cur.steps.map((st, i) => `<div class="kitem" data-i="${i}"><b class="kmini">${i + 1}</b><div class="grow ae">${K.actionEditor(st, s.named, s.items.filter(m => m.id !== cur.id))}</div>
            <button class="qt-btn ghost kbtn-sm" data-up>\u2191</button><button class="qt-btn ghost kbtn-sm" data-rm>\u2715</button></div>`).join("")}</div>
          <div class="krow"><button class="qt-btn" data-step>+ Step</button><button class="qt-btn primary" data-save>Save</button><button class="qt-btn" data-try>Run in 3 s</button>${cur.id ? `<button class="qt-btn ghost" data-del>Delete</button>` : ""}</div>
          <p class="kmini">"Run in 3 s" gives you time to click into the window the macro should type into.</p>` : `<div class="kempty">Pick or make a macro.</div>`}</section></div>`;
      el.querySelectorAll(".ae").forEach(a => K.wireActionEditor(a, s.named, s.items));
    };
    const collect = () => { if (!cur) return; cur.name = el.querySelector("#mn").value; cur.steps = [...el.querySelectorAll(".kitem[data-i]")].map(r => K.readAction(r.querySelector(".ae"))); };
    draw();
    el.addEventListener("click", async e => {
      const d = a => e.target.closest(`[data-${a}]`)?.dataset[a];
      try {
        if (d("pick")) { cur = JSON.parse(JSON.stringify(s.items.find(m => m.id === d("pick")))); draw(); }
        if (d("run")) { await api("/api/kit/macros", { op: "run", id: d("run") }); say("Running"); }
        if (e.target.closest("[data-new]")) { cur = { id: "", name: "New macro", steps: [{ type: "wait", ms: 500 }] }; draw(); }
        if (e.target.closest("[data-step]")) { collect(); cur.steps.push({ type: "keys", combo: "ctrl+s" }); draw(); }
        if (e.target.closest("[data-rm]")) { collect(); cur.steps.splice(+e.target.closest("[data-i]").dataset.i, 1); draw(); }
        if (e.target.closest("[data-up]")) { collect(); const i = +e.target.closest("[data-i]").dataset.i; if (i) { [cur.steps[i - 1], cur.steps[i]] = [cur.steps[i], cur.steps[i - 1]]; draw(); } }
        if (e.target.closest("[data-save]") || e.target.closest("[data-try]")) {
          collect(); s = await api("/api/kit/macros", Object.assign({ op: "save" }, cur)); cur = JSON.parse(JSON.stringify(s.items.find(m => m.name === cur.name) || s.items.at(-1)));
          if (e.target.closest("[data-try]")) { await api("/api/kit/macros", { op: "run", id: cur.id, delay: 3 }); say("Running in 3 seconds..."); } else say("Saved");
          draw();
        }
        if (e.target.closest("[data-del]")) { if (!confirm("Delete this macro?")) return; s = await api("/api/kit/macros", { op: "del", id: cur.id }); cur = null; draw(); }
      } catch (err) { say(err.message, { bad: true }); }
    });
  });

  K.panel("plugins", async el => {
    let s = await api("/api/kit/plugins"), open = null;
    const draw = () => {
      el.innerHTML = `<div class="kcols"><section class="kp qt-card"><h3>Plugins <button class="qt-btn ghost kbtn-sm" data-folder>Open plugin folder</button><button class="qt-btn ghost kbtn-sm" data-reload>Reload</button></h3>
        <div class="klist">${s.items.map(p => `<div class="kitem"><span class="ki">${esc(p.icon)}</span><div class="grow"><b>${esc(p.name)}</b><span>${esc(p.error || p.description)}</span></div>
          ${p.py ? `<label class="krow kmini" title="Lets its plugin.py run on this PC"><button class="qt-switch" role="switch" data-trust="${p.id}" aria-checked="${p.trusted}"></button> Trust code</label>` : ""}
          <button class="qt-btn kbtn-sm" data-open="${p.id}">Open</button></div>`).join("") || `<div class="kempty">No plugins.</div>`}</div>
        <p class="kmini">A plugin is a folder in <code>${esc(s.folder)}</code> with a <code>plugin.json</code> (name, description, icon, entry) and a web page. Pages load inside the Suite and can use every /api/kit endpoint. An optional <code>plugin.py</code> with <code>handle(path, body)</code> answers <code>/api/kit/plug/&lt;folder&gt;/...</code>, only after you trust it.</p></section>
        ${open ? `<section class="kp qt-card" style="grid-column:1/-1"><h3>${esc(open.name)} <button class="qt-btn ghost kbtn-sm" data-close>Close</button></h3><iframe src="${esc(open.entry)}" style="width:100%;height:560px;border:var(--qt-border);border-radius:12px;background:var(--qt-bg)"></iframe></section>` : ""}</div>`;
    };
    draw();
    el.addEventListener("click", async e => {
      const d = a => e.target.closest(`[data-${a}]`)?.dataset[a];
      if (e.target.closest("[data-folder]")) api("/api/kit/plugins", { op: "folder" });
      if (e.target.closest("[data-reload]")) { s = await api("/api/kit/plugins", { op: "reload" }); draw(); say("Reloaded"); }
      if (d("trust")) { const on = e.target.closest("[data-trust]").getAttribute("aria-checked") !== "true"; if (on && !confirm("Trusting lets this plugin's Python code run on your PC with your permissions. Only trust plugins you wrote or know. Continue?")) return; s = await api("/api/kit/plugins", { op: "trust", id: d("trust"), on }); draw(); }
      if (d("open")) { open = s.items.find(p => p.id === d("open")); api("/api/kit/event", { k: "plugin.open", d: open.id }); draw(); }
      if (e.target.closest("[data-close]")) { open = null; draw(); }
    });
  });

  K.panel("updates", async el => {
    el.innerHTML = `<div class="kempty">Asking GitHub...</div>`;
    let s = await api("/api/kit/updates");
    const draw = () => {
      el.innerHTML = `<div class="kp qt-card"><h3>Versions <button class="qt-btn ghost kbtn-sm" data-fresh>Check now</button><span class="kmini">checked ${ago(s.t)}${s.busy ? " \u00b7 " + esc(s.busy) : ""}</span></h3>
        <div class="klist">${s.items.map(i => `<div class="kitem"><div class="grow"><b>${esc(i.name)} ${i.newer ? '<span class="qt-chip ok">update</span>' : ""}</b>
          <span>You have ${esc(i.have)}${i.latest ? " \u00b7 latest " + esc(i.latest) : ""}${i.err ? " \u00b7 " + esc(i.err) : ""} \u00b7 ${esc(i.repo)}</span></div>
          ${i.url ? `<a class="qt-btn ghost kbtn-sm" href="${esc(i.url)}" target="_blank">Notes</a>` : ""}${i.newer || (i.latest && i.have === "not installed" && i.name !== "QT Suite") ? `<button class="qt-btn primary kbtn-sm" data-up="${esc(i.name)}">${i.have === "not installed" ? "Install" : "Update"}</button>` : ""}</div>`).join("")}</div>
        <p class="kmini">The Suite checks once a day and shows a Windows notification when something's new. Updating QT Suite downloads the installer from its GitHub release and opens it; nothing installs without you clicking through it. yt-dlp updates live in VOLT.</p></div>`;
    };
    draw();
    el.addEventListener("click", async e => {
      try {
        if (e.target.closest("[data-fresh]")) { s = await api("/api/kit/updates?fresh=1"); draw(); }
        const u = e.target.closest("[data-up]"); if (u) { const r = await api("/api/kit/updates", { name: u.dataset.up }); say(r.msg); }
      } catch (err) { say(err.message, { bad: true }); }
    });
  });

  K.panel("shares", async el => {
    let s = await api("/api/kit/shares");
    const fmt = n => n > 86400 ? Math.round(n / 86400) + " d" : n > 3600 ? Math.round(n / 3600) + " h" : Math.max(1, Math.round(n / 60)) + " min";
    const draw = async () => {
      el.innerHTML = `<div class="kcols"><section class="kp qt-card"><h3>New link</h3>
        <label class="kfield">File or folder (folders are zipped)<input class="qt-input" id="sp" placeholder="C:\\Users\\you\\Videos\\clip.mp4"></label>
        <div class="krow"><label class="kfield">Lasts<select id="sm"><option value="15">15 minutes</option><option value="60" selected>1 hour</option><option value="360">6 hours</option><option value="1440">1 day</option><option value="10080">1 week</option></select></label>
          <label class="kfield">Downloads<select id="sx"><option value="0">Unlimited</option><option value="1">1</option><option value="3">3</option><option value="10">10</option></select></label></div>
        <button class="qt-btn primary" data-add>Make link</button>
        <p class="kmini">${s.tailscale ? "Tailscale links work for any device on your tailnet, anywhere. " : "Tailscale is off, so links work on your Wi-Fi only. "}Nothing is uploaded anywhere: the file is served straight from this PC while the Suite runs.</p></section>
        <section class="kp qt-card"><h3>Active links</h3><div class="klist" id="sl"></div></section></div>`;
      const box = el.querySelector("#sl");
      box.innerHTML = s.items.length ? (await Promise.all(s.items.map(async i => { const url = i.links.tailscale || i.links.lan; return `<div class="kitem"><span class="kqr" style="padding:3px">${await qrSvg(url, 2)}</span>
        <div class="grow"><b>${esc(i.name)}</b><span>${fmt(i.left)} left \u00b7 ${i.count}${i.max ? "/" + i.max : ""} downloads</span><span><code>${esc(url)}</code></span></div>
        <button class="qt-btn kbtn-sm" data-copy="${esc(url)}">Copy</button><button class="qt-btn ghost kbtn-sm" data-del="${i.token}">End</button></div>`; }))).join("") : `<div class="kempty">No links right now.</div>`;
    };
    await draw();
    el.addEventListener("click", async e => {
      const d = a => e.target.closest(`[data-${a}]`)?.dataset[a];
      try {
        if (e.target.closest("[data-add]")) { s = await api("/api/kit/shares", { op: "add", path: el.querySelector("#sp").value.trim().replace(/^"|"$/g, ""), minutes: +el.querySelector("#sm").value, max: +el.querySelector("#sx").value }); await draw(); say("Link ready"); }
        if (d("copy")) { navigator.clipboard.writeText(d("copy")); say("Copied"); }
        if (d("del")) { s = await api("/api/kit/shares", { op: "del", token: d("del") }); await draw(); }
      } catch (err) { say(err.message, { bad: true }); }
    });
  });

  const BADGE_ICON = { first: "\ud83d\udc4b", focus1: "\ud83c\udfaf", focus10: "\ud83e\uddd8", backup: "\ud83d\udee1", clean: "\ud83e\uddf9", rec: "\ud83c\udfac", gif: "\ud83c\udf9e", photos: "\ud83d\udcf7", deck: "\ud83c\udf9b", party: "\ud83c\udf89",
    arcade: "\ud83d\udd79", split: "\ud83e\uddfe", tm: "\u231b", macro: "\ud83e\udd16", streak3: "\ud83d\udd25", streak7: "\u26a1", streak30: "\ud83d\udc51", find: "\ud83d\udccd", wall: "\ud83c\udf0a", explorer: "\ud83e\udded" };
  K.panel("xp", async el => {
    const p = await api("/api/kit/progress");
    const got = p.badges.filter(b => b.got).length;
    el.innerHTML = `<div class="kp qt-card"><div class="krow"><div class="kstat"><b>LV ${p.level}</b><span>level</span></div><div class="kstat"><b>${p.xp}</b><span>XP</span></div>
        <div class="kstat"><b>\ud83d\udd25 ${p.streak}</b><span>day streak (best ${p.best})</span></div><div class="kstat"><b>${got}/${p.badges.length}</b><span>badges</span></div></div>
      <div class="kfield">${p.into} / ${p.need} XP to level ${p.level + 1}<span class="bar"><i style="width:${100 * p.into / p.need}%"></i></span></div></div>
      <div class="kp qt-card"><h3>Badges</h3><div class="kbadges">${p.badges.map(b => `<div class="kbadge ${b.got ? "got" : ""}"><span class="e">${BADGE_ICON[b.id] || "\u2b50"}</span><b>${esc(b.name)}</b><span class="kmini">${esc(b.how)}</span></div>`).join("")}</div>
      <p class="kmini">XP comes from finishing focus sessions (2 per minute), backups, recordings, parties, arcade wins and more. Nothing leaves this PC.</p></div>`;
  });

  K.panel("streak", async el => {
    const p = await api("/api/kit/progress");
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const start = new Date(today); start.setDate(start.getDate() - 52 * 7 - start.getDay());
    const cells = [], months = [];
    for (let d = new Date(start), i = 0; d <= today; d.setDate(d.getDate() + 1), i++) {
      const k = d.toLocaleDateString("en-CA"), n = p.days[k] || 0, l = n === 0 ? 0 : n < 3 ? 1 : n < 8 ? 2 : n < 20 ? 3 : 4;
      cells.push(`<i data-l="${l}" class="${+d === +today ? "today" : ""}" title="${d.toDateString()}: ${n} things"></i>`);
      if (d.getDate() === 1) months.push(d.toLocaleDateString(undefined, { month: "short" }));
    }
    const active = Object.keys(p.days).length;
    el.innerHTML = `<div class="kp qt-card"><div class="krow"><div class="kstat"><b>\ud83d\udd25 ${p.streak}</b><span>days in a row</span></div><div class="kstat"><b>${p.best}</b><span>best streak</span></div>
      <div class="kstat"><b>${active}</b><span>active days</span></div></div>
      <div class="kcal">${cells.join("")}</div><p class="kmini">${months.join(" \u00b7 ")}</p>
      <p class="kmini">A day counts when you open the Suite or use any Toolkit feature. Darker squares mean more done that day. Focus sessions count the most.</p></div>`;
  });
})();
