/* Toolkit panels: snap zones, desktop widgets, live wallpaper, skins + sounds. */
(() => {
  const K = window.qtKit, { api, esc, say } = K;
  const zoneBox = (zones, cls = "") => `<div class="kzone ${cls}">${zones.map((z, i) => `<i data-n="${i + 1}" style="left:${z[0] * 100}%;top:${z[1] * 100}%;width:calc(${z[2] * 100}% - 4px);height:calc(${z[3] * 100}% - 4px)">${i + 1}</i>`).join("")}</div>`;

  K.panel("zones", async el => {
    let s = await api("/api/kit/zones");
    const draw = () => {
      const lay = s.layout === "custom" && s.custom ? s.custom : s.layouts[s.layout].zones;
      el.innerHTML = `<div class="kcols"><section class="kp qt-card"><h3>Move a window</h3>
        <p class="kmini">Click a zone to move <b>${esc(s.target || "the last window you used")}</b> there. Or from any app: Ctrl+Alt+\u2190 zone 1, Ctrl+Alt+\u2192 zone 2, Ctrl+Alt+\u2193 zone 3, Ctrl+Alt+\u2191 next layout. Change keys in Hotkeys (zones 4 to 9 are there too).</p>
        <div data-big>${zoneBox(lay, "big")}</div>
        <label class="kfield">Gap between windows <input type="range" id="zg" min="0" max="30" value="${s.gap}"></label></section>
        <section class="kp qt-card"><h3>Layout</h3><div class="kzl">${Object.entries(s.layouts).map(([k, l]) => `<div data-lay="${k}">${zoneBox(l.zones, s.layout === k ? "on" : "")}<div class="kmini" style="text-align:center;margin-top:4px">${esc(l.name)}</div></div>`).join("")}</div>
        <h3>Custom layout</h3><p class="kmini">One zone per line as left, top, width, height in percent. Example: 0 0 60 100</p>
        <textarea id="zc">${(s.custom || []).map(z => z.map(v => Math.round(v * 100)).join(" ")).join("\n")}</textarea>
        <button class="qt-btn" data-custom>Use custom layout</button></section></div>`;
    };
    draw();
    el.addEventListener("click", async e => {
      try {
        const z = e.target.closest("[data-big] [data-n]");
        if (z) { const r = await api("/api/kit/zones", { op: "snap", n: +z.dataset.n }); say(r.msg); }
        const l = e.target.closest("[data-lay]"); if (l) { s = await api("/api/kit/zones", { layout: l.dataset.lay }); draw(); }
        if (e.target.closest("[data-custom]")) {
          const custom = el.querySelector("#zc").value.split("\n").map(r => r.trim().split(/[\s,]+/).map(v => +v / 100)).filter(r => r.length === 4 && r.every(v => !isNaN(v)));
          if (!custom.length) return say("Add at least one line with four numbers", { bad: true });
          s = await api("/api/kit/zones", { layout: "custom", custom }); draw(); say("Custom layout on");
        }
      } catch (err) { say(err.message, { bad: true }); }
    });
    el.addEventListener("change", async e => { if (e.target.id === "zg") s = await api("/api/kit/zones", { gap: +e.target.value }); });
    const t = setInterval(async () => { const x = await api("/api/kit/zones"); if (x.target !== s.target) { s.target = x.target; const b = el.querySelector(".kmini b"); if (b) b.textContent = x.target || "the last window you used"; } }, 1500);
    return () => clearInterval(t);
  });

  K.panel("widgets", async el => {
    let s = await api("/api/kit/widgets");
    const ICON = { clock: "\ud83d\udd70", sysmon: "\ud83d\udcca", kharcha: "\ud83d\udcb8", music: "\ud83c\udfb5", focus: "\ud83c\udfaf", notes: "\ud83d\udcdd", deck: "\ud83c\udf9b", subs: "\ud83d\udd01" };
    const draw = () => {
      const open = new Set(s.open.map(o => o.kind));
      el.innerHTML = `<div class="kcols"><section class="kp qt-card"><h3>Widgets</h3><div class="kit-grid">${s.kinds.map(k => `<div class="kit-card qt-card" style="cursor:default"><span class="ki">${ICON[k.kind] || "\u2b50"}</span><b>${esc(k.name)}</b>
        <span class="krow">${open.has(k.kind) ? `<span class="qt-chip ok">open</span><button class="qt-btn ghost kbtn-sm" data-close="${k.kind}">Close</button>` : `<button class="qt-btn primary kbtn-sm" data-open="${k.kind}">Put on desktop</button>`}</span></div>`).join("")}</div></section>
        <section class="kp qt-card"><h3>Layout</h3><p class="kmini">Widgets float on top of other windows. Drag them by the title bar. When they're where you like them, save the layout and they come back next time the Suite starts.</p>
        <div class="krow"><button class="qt-btn" data-save>Save layout (${s.open.length} open)</button><button class="qt-btn ghost" data-closeall>Close all</button></div>
        <label class="krow"><button class="qt-switch" role="switch" id="wr" aria-checked="${s.restore}"></button> Bring my widgets back when the Suite starts</label></section></div>`;
    };
    draw();
    el.addEventListener("click", async e => {
      const d = a => e.target.closest(`[data-${a}]`)?.dataset[a];
      try {
        if (d("open")) { s = Object.assign(s, await api("/api/kit/widgets", { op: "open", kind: d("open") })); say("Widget opening"); setTimeout(async () => { s = await api("/api/kit/widgets"); draw(); }, 2500); }
        if (d("close")) { s = await api("/api/kit/widgets", { op: "close", kind: d("close") }); draw(); }
        if (e.target.closest("[data-closeall]")) { s = await api("/api/kit/widgets", { op: "closeall" }); draw(); }
        if (e.target.closest("[data-save]")) { s = await api("/api/kit/widgets", { op: "save" }); draw(); say("Layout saved"); }
        if (e.target.closest("#wr")) { s = await api("/api/kit/widgets", { op: "restore", on: e.target.closest("#wr").getAttribute("aria-checked") !== "true" }); draw(); }
      } catch (err) { say(err.message, { bad: true }); }
    });
  });

  K.panel("wall", async el => {
    let s = await api("/api/kit/wall");
    const draw = () => {
      el.innerHTML = `<div class="kcols"><section class="kp qt-card"><h3>Scenes ${s.running ? `<span class="qt-chip ok">on: ${esc(s.scenes[s.scene] || s.scene)}</span>` : ""}</h3>
        <div class="kit-grid">${Object.entries(s.scenes).filter(([k]) => k !== "video").map(([k, n]) => `<button class="kit-card qt-card" data-scene="${k}" style="padding:8px">
          <iframe src="/kit/wall/index.html?scene=${k}&preview=1" style="width:100%;aspect-ratio:16/9;border:2px solid var(--qt-ink);border-radius:8px;pointer-events:none" loading="lazy"></iframe><b>${esc(n)}</b></button>`).join("")}</div></section>
        <section class="kp qt-card"><h3>Your own video</h3><label class="kfield">Path to an .mp4 or .webm<input class="qt-input" id="wf" value="${esc(s.file || "")}" placeholder="C:\\Users\\you\\Videos\\loop.mp4"></label>
          <button class="qt-btn" data-video>Use this video</button>
          <h3>Off</h3><button class="qt-btn ghost" data-off ${s.running ? "" : "disabled"}>Turn live wallpaper off</button>
          <p class="kmini">The wallpaper runs behind your desktop icons in a light browser window and comes back when the Suite starts. It's muted. Wallpaper Engine users: stop it first, the two fight over the same spot.</p></section></div>`;
    };
    draw();
    el.addEventListener("click", async e => {
      try {
        const sc = e.target.closest("[data-scene]");
        if (sc) { say("Setting the wallpaper..."); const r = await api("/api/kit/wall", { scene: sc.dataset.scene }); say(r.msg); s = await api("/api/kit/wall"); draw(); }
        if (e.target.closest("[data-video]")) { const r = await api("/api/kit/wall", { scene: "video", file: el.querySelector("#wf").value.trim().replace(/^"|"$/g, "") }); say(r.msg); s = await api("/api/kit/wall"); draw(); }
        if (e.target.closest("[data-off]")) { await api("/api/kit/wall", { op: "off" }); s = await api("/api/kit/wall"); draw(); say("Back to your normal wallpaper"); }
      } catch (err) { say(err.message, { bad: true }); }
    });
  });

  K.panel("skins", async el => {
    const cur = localStorage.getItem("qt-kit-skin") || "ink", snd = localStorage.getItem("qt-kit-sound") || "off";
    el.innerHTML = `<div class="kcols"><section class="kp qt-card"><h3>Palette</h3><div class="kit-grid">${Object.entries(K.SKINS).map(([k, sk]) => {
      const v = Object.assign({ "--qt-bg": "#16141a", "--qt-card": "#221f27", "--qt-fg": "#fff8ec", "--qt-ink": "#000" }, sk.vars);
      return `<button class="kit-card qt-card" data-skin="${k}" style="${k === cur ? "outline:3px solid var(--qt-accent);outline-offset:3px" : ""}">
        <span style="display:flex;gap:6px">${["--qt-bg", "--qt-card", "--qt-fg", "--qt-ink"].map(c => `<i style="width:28px;height:28px;border-radius:8px;border:2px solid #000;background:${v[c]}"></i>`).join("")}</span><b>${esc(sk.name)}</b></button>`;
    }).join("")}</div><p class="kmini">Accent colour lives in Settings, Look. Skins change the Suite window; tools inside keep their own look.</p></section>
      <section class="kp qt-card"><h3>Click sounds</h3><div class="kpill">${Object.entries(K.SOUNDS).map(([k, n]) => `<button data-snd="${k}" aria-pressed="${k === snd}">${n}</button>`).join("")}</div>
      <label class="kfield">Volume <input type="range" id="sv" min="0.2" max="3" step="0.1" value="${localStorage.getItem("qt-kit-vol") || 1}"></label></section></div>`;
    el.addEventListener("click", e => {
      const sk = e.target.closest("[data-skin]"); if (sk) { K.applySkin(sk.dataset.skin); K.open("skins"); say("Skin: " + K.SKINS[sk.dataset.skin].name); }
      const so = e.target.closest("[data-snd]");
      if (so) { localStorage.setItem("qt-kit-sound", so.dataset.snd); el.querySelectorAll("[data-snd]").forEach(b => b.setAttribute("aria-pressed", b === so)); K.playSound(so.dataset.snd); }
    });
    el.querySelector("#sv").oninput = e => { localStorage.setItem("qt-kit-vol", e.target.value); K.playSound(); };
  });
})();
