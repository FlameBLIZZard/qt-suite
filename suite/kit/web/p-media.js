/* Toolkit panels: screen recorder, batch photos, music player (the player itself lives on after the panel closes). */
(() => {
  const K = window.qtKit, { api, esc, say } = K;

  /* ------------------------------------------------------------- 5. recorder */
  K.panel("recorder", async el => {
    let s = await api("/api/kit/rec"), pick = null;
    const pref = JSON.parse(localStorage.getItem("qt-kit-rec") || "{}");
    const draw = () => {
      el.innerHTML = `<div class="kcols"><section class="kp qt-card"><h3>Record ${s.running ? `<span class="qt-chip bad">● REC ${s.secs}s</span>` : ""}</h3>
        ${s.ffmpeg ? "" : `<p class="bad">ffmpeg isn't installed (winget install Gyan.FFmpeg).</p>`}
        <label class="kfield">What<select id="rw"><option value="">Whole screen</option>${s.windows.map(w => `<option ${pref.window === w ? "selected" : ""}>${esc(w)}</option>`).join("")}</select></label>
        <div class="krow"><label class="kfield grow">Webcam bubble<select id="rb"><option value="">None</option><option value="phone" ${pref.bubble === "phone" ? "selected" : ""}>Phone camera${s.phonecam ? " (live)" : " (start it in Phone webcam)"}</option>
          ${s.cams.map(c => `<option ${pref.bubble === c ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></label>
          <label class="kfield">Corner<select id="rc">${[["br", "Bottom right"], ["bl", "Bottom left"], ["tr", "Top right"], ["tl", "Top left"]].map(([v, l]) => `<option value="${v}" ${pref.corner === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
          <label class="kfield">Size<input type="number" id="rs" value="${pref.bubble_size || 260}" min="120" max="600" step="20"></label></div>
        <div class="krow"><label class="kfield grow">Microphone<select id="rm"><option value="">No sound</option>${s.mics.map(m => `<option ${pref.mic === m ? "selected" : ""}>${esc(m)}</option>`).join("")}</select></label>
          <label class="kfield">FPS<select id="rf">${[15, 24, 30, 60].map(f => `<option ${+(pref.fps || 30) === f ? "selected" : ""}>${f}</option>`).join("")}</select></label></div>
        <div class="krow">${s.running ? `<button class="qt-btn primary" data-stop>■ Stop and save</button>` : `<button class="qt-btn primary" data-start>● Start recording</button>`}
          <span class="kmini">Hotkey Ctrl+Alt+R starts and stops from anywhere.</span></div></section>
        <section class="kp qt-card"><h3>Recordings <button class="qt-btn ghost kbtn-sm" data-folder>Open folder</button></h3>
          ${pick ? `<video id="rv" class="kcam" controls src="/api/kit/media?path=${encodeURIComponent(pick.path)}"></video>
            <div class="krow"><label class="kfield">From (s)<input type="number" id="ta" value="0" step="0.1" min="0"></label><button class="qt-btn kbtn-sm" data-mark="a">Set from here</button>
            <label class="kfield">To (s)<input type="number" id="tz" value="0" step="0.1" min="0"></label><button class="qt-btn kbtn-sm" data-mark="z">Set to here</button></div>
            <div class="krow"><button class="qt-btn" data-trim>Save trimmed MP4</button><button class="qt-btn" data-gif>Export GIF</button>
            <label class="kfield">GIF width<select id="gw"><option>480</option><option selected>640</option><option>800</option><option>1080</option></select></label>
            <label class="kfield">GIF fps<select id="gf"><option>10</option><option selected>12</option><option>15</option><option>24</option></select></label></div>` : ""}
          <div class="klist">${s.files.length ? s.files.map(f => `<div class="kitem"><div class="grow"><b>${esc(f.name)}</b><span>${f.size} · ${new Date(f.t * 1000).toLocaleString()}</span></div>
            ${f.name.endsWith(".gif") ? "" : `<button class="qt-btn kbtn-sm" data-pick="${esc(f.path)}">Trim / GIF</button>`}<button class="qt-btn ghost kbtn-sm" data-openf="${esc(f.path)}">Open</button><button class="qt-btn ghost kbtn-sm" data-del="${esc(f.path)}">✕</button></div>`).join("") : `<div class="kempty">No recordings yet. They go to Videos\\QT Recordings.</div>`}</div></section></div>`;
    };
    draw();
    const opts = () => { const o = { window: el.querySelector("#rw").value, bubble: el.querySelector("#rb").value, corner: el.querySelector("#rc").value, bubble_size: +el.querySelector("#rs").value, mic: el.querySelector("#rm").value, fps: +el.querySelector("#rf").value }; localStorage.setItem("qt-kit-rec", JSON.stringify(o)); return o; };
    el.addEventListener("click", async e => {
      const d = a => e.target.closest(`[data-${a}]`)?.dataset[a];
      try {
        if (e.target.closest("[data-start]")) { const o = opts(); await api("/api/kit/rec", Object.assign({ op: "start" }, o)); s = await api("/api/kit/rec"); draw(); say("Recording. Ctrl+Alt+R or come back here to stop."); }
        if (e.target.closest("[data-stop]")) { const r = await api("/api/kit/rec", { op: "stop" }); s = await api("/api/kit/rec"); pick = s.files[0] || null; draw(); say("Saved " + r.msg.split("\\").pop()); }
        if (e.target.closest("[data-folder]")) api("/api/kit/rec", { op: "open" });
        if (d("openf")) api("/api/kit/rec", { op: "open", path: d("openf") });
        if (d("pick")) { pick = s.files.find(f => f.path === d("pick")); draw(); }
        if (d("del")) { if (!confirm("Move this recording to the Recycle Bin?")) return; await api("/api/kit/rec", { op: "del", path: d("del") }); s = await api("/api/kit/rec"); if (pick && pick.path === d("del")) pick = null; draw(); }
        if (d("mark")) { const v = el.querySelector("#rv"); el.querySelector(d("mark") === "a" ? "#ta" : "#tz").value = v.currentTime.toFixed(1); }
        if (e.target.closest("[data-trim]") || e.target.closest("[data-gif]")) {
          const gif = !!e.target.closest("[data-gif]");
          say(gif ? "Making the GIF..." : "Trimming...");
          const r = await api("/api/kit/rec", { op: gif ? "gif" : "trim", path: pick.path, start: +el.querySelector("#ta").value, end: +el.querySelector("#tz").value, width: +el.querySelector("#gw").value, fps: +el.querySelector("#gf").value });
          say("Saved " + r.msg.split("\\").pop()); s = await api("/api/kit/rec"); draw();
        }
      } catch (err) { say(err.message, { bad: true }); }
    });
    el.addEventListener("loadedmetadata", e => { if (e.target.id === "rv") el.querySelector("#tz").value = e.target.duration.toFixed(1); }, true);
    const t = setInterval(async () => { if (!s.running) return; const x = await api("/api/kit/rec"); const c = el.querySelector(".qt-chip.bad"); if (c) c.textContent = `● REC ${x.secs}s`; if (!x.running) { s = x; draw(); } }, 1000);
    return () => clearInterval(t);
  });

  /* ------------------------------------------------------------- 6. batch photos */
  K.panel("photos", async el => {
    const s0 = await api("/api/kit/photos");
    const pref = JSON.parse(localStorage.getItem("qt-kit-photos") || "{}");
    el.innerHTML = `<div class="kcols"><section class="kp qt-card"><h3>Pictures</h3>
      <label class="kfield">Folders or files (one per line, or drop them here)<textarea id="pp" placeholder="${esc(s0.pictures)}">${esc(pref.paths || "")}</textarea></label>
      <div id="pinfo" class="kmini"></div>
      <h3>Resize</h3><div class="krow"><label class="kfield">Max width<input type="number" id="pw" value="${pref.max_w ?? 1920}" min="0"></label><label class="kfield">Max height<input type="number" id="ph" value="${pref.max_h ?? 1920}" min="0"></label>
        <label class="kfield">or percent<input type="number" id="pc" value="${pref.percent || ""}" min="1" max="99" placeholder="-"></label></div>
      <h3>Convert</h3><div class="krow"><label class="kfield">Format<select id="pf">${["same", "jpg", "webp", "png", "avif"].map(f => `<option ${pref.format === f ? "selected" : ""}>${f}</option>`).join("")}</select></label>
        <label class="kfield">Quality<input type="number" id="pq" value="${pref.quality || 85}" min="30" max="100"></label>
        <label class="krow kmini"><input type="checkbox" id="pst" ${pref.strip !== false ? "checked" : ""}> Remove location and camera data</label></div>
      <h3>Rename</h3><label class="kfield">Pattern ({name} original name, {n} number, {date} date taken)<input class="qt-input" id="pr" value="${esc(pref.rename || "{name}")}"></label>
      <div class="kmini" id="pex"></div>
      <div class="krow"><button class="qt-btn primary" data-go>Process</button><span class="kmini">Originals are never changed. Results go to a new "QT batch" folder next to them.</span></div>
      <div id="pprog"></div></section></div>`;
    const P = () => ({ paths: el.querySelector("#pp").value.split("\n").map(x => x.trim().replace(/^"|"$/g, "")).filter(Boolean), max_w: +el.querySelector("#pw").value, max_h: +el.querySelector("#ph").value,
      percent: +el.querySelector("#pc").value || 0, format: el.querySelector("#pf").value, quality: +el.querySelector("#pq").value, strip: el.querySelector("#pst").checked, rename: el.querySelector("#pr").value });
    let tm = 0;
    const info = async () => {
      const p = P(); localStorage.setItem("qt-kit-photos", JSON.stringify(Object.assign({}, p, { paths: el.querySelector("#pp").value })));
      el.querySelector("#pex").textContent = "Example: " + p.rename.replace("{name}", "IMG_0042").replace("{n}", "01").replace("{date}", new Date().toISOString().slice(0, 10)) + "." + (p.format === "same" ? "jpg" : p.format);
      if (!p.paths.length) { el.querySelector("#pinfo").textContent = ""; return; }
      const r = await api("/api/kit/photos?paths=" + encodeURIComponent(p.paths.join("|")));
      el.querySelector("#pinfo").textContent = r.count ? `${r.count} pictures, ${r.size}: ${r.sample.join(", ")}${r.count > 6 ? "..." : ""}` : "No pictures found there yet";
    };
    el.addEventListener("input", () => { clearTimeout(tm); tm = setTimeout(info, 400); });
    el.addEventListener("dragover", e => e.preventDefault());
    el.addEventListener("drop", e => { e.preventDefault(); const t = e.dataTransfer.getData("text/plain"); if (t) { el.querySelector("#pp").value += (el.querySelector("#pp").value ? "\n" : "") + t; info(); } });
    info();
    let poll = 0;
    el.addEventListener("click", async e => {
      if (e.target.closest("[data-openout]")) return api("/api/kit/photos", { op: "open" });
      if (!e.target.closest("[data-go]")) return;
      try {
        await api("/api/kit/photos", P());
        poll = setInterval(async () => {
          const r = await api("/api/kit/photos"), box = el.querySelector("#pprog"); if (!box) return clearInterval(poll);
          box.innerHTML = `<span class="bar"><i style="width:${r.total ? 100 * r.done / r.total : 0}%"></i></span><div class="krow sp kmini"><span>${r.done} of ${r.total}</span>${r.busy ? "" : `<button class="qt-btn kbtn-sm" data-openout>Open results</button>`}</div>
            ${r.errors.length ? `<div class="bad kmini">${r.errors.slice(0, 5).map(esc).join("<br>")}</div>` : ""}`;
          if (!r.busy) { clearInterval(poll); say(`Done: ${r.done - r.errors.length} pictures saved`); }
        }, 500);
      } catch (err) { say(err.message, { bad: true }); }
    });
    return () => clearInterval(poll);
  });

  /* ------------------------------------------------------------- 7. music player (persistent) */
  const M = window.qtKitMusic = window.qtKitMusic || { tracks: [], q: [], i: -1, audio: null, lyr: [], shuffle: false, repeat: false };
  function ensurePlayer() {
    if (M.audio) return;
    M.audio = new Audio(); M.audio.preload = "auto"; M.audio.crossOrigin = "anonymous";
    M.audio.addEventListener("ended", () => (M.repeat ? (M.audio.currentTime = 0, M.audio.play()) : M.next()));
    M.audio.addEventListener("timeupdate", () => { report(); M.onTime && M.onTime(); });
    M.audio.addEventListener("play", report); M.audio.addEventListener("pause", report);
    let seq = -1;
    (async function cmds() {   // mini player widget, tray, hotkeys and the deck talk to the player through the hub
      for (;;) {
        try {
          const r = await api("/api/kit/music/cmds?after=" + seq); seq = r.seq;
          for (const c of r.items) { if (c.cmd === "toggle") M.toggle(); if (c.cmd === "next") M.next(); if (c.cmd === "prev") M.prev(); if (c.cmd === "seek") M.audio.currentTime = +c.arg || 0; if (c.cmd === "vol") M.audio.volume = Math.max(0, Math.min(1, +c.arg)); }
        } catch { await new Promise(r => setTimeout(r, 3000)); }
      }
    })();
    if ("mediaSession" in navigator) {
      navigator.mediaSession.setActionHandler("nexttrack", () => M.next());
      navigator.mediaSession.setActionHandler("previoustrack", () => M.prev());
    }
  }
  let lastRep = 0;
  function report() {
    const t = M.q[M.i]; if (!t || Date.now() - lastRep < 900) return; lastRep = Date.now();
    api("/api/kit/music", { op: "now", id: t.id, title: t.title, artist: t.artist, pos: M.audio.currentTime, dur: M.audio.duration || t.dur, playing: !M.audio.paused, cover: "/api/kit/cover?path=" + encodeURIComponent(t.path) }).catch(() => {});
  }
  M.playIdx = async function (i) {
    ensurePlayer();
    if (i < 0 || i >= M.q.length) return;
    M.i = i; const t = M.q[i];
    M.audio.src = "/api/kit/media?path=" + encodeURIComponent(t.path);
    try { await M.audio.play(); } catch {}
    lastRep = 0; report();
    api("/api/kit/event", { k: "music.play", d: t.title }).catch(() => {});
    if ("mediaSession" in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: t.album, artwork: [{ src: "/api/kit/cover?path=" + encodeURIComponent(t.path), sizes: "300x300", type: "image/jpeg" }] });
    M.lyr = []; M.plain = ""; M.onTrack && M.onTrack();
    try {
      const l = await api(`/api/kit/lyrics?artist=${encodeURIComponent(t.artist)}&title=${encodeURIComponent(t.title)}&dur=${t.dur || ""}`);
      if (M.q[M.i] !== t) return;
      M.lyr = (l.synced || "").split("\n").map(x => { const m = x.match(/^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/); return m ? { t: +m[1] * 60 + +m[2], s: m[3] } : null; }).filter(Boolean);
      M.plain = l.plain || ""; M.onTrack && M.onTrack();
    } catch {}
  };
  M.play = id => { if (!M.tracks.length) return; M.q = M.tracks.slice(); const i = M.q.findIndex(t => t.id === id); M.playIdx(i < 0 ? 0 : i); };
  M.toggle = () => { ensurePlayer(); if (M.i < 0) return M.play(M.tracks[0] && M.tracks[0].id); M.audio.paused ? M.audio.play() : M.audio.pause(); };
  M.next = () => M.playIdx(M.shuffle ? Math.floor(Math.random() * M.q.length) : (M.i + 1) % Math.max(1, M.q.length));
  M.prev = () => (M.audio && M.audio.currentTime > 4 ? (M.audio.currentTime = 0) : M.playIdx((M.i - 1 + M.q.length) % Math.max(1, M.q.length)));

  K.panel("music", async el => {
    ensurePlayer();
    let lib = await api("/api/kit/music");
    M.tracks = lib.tracks; if (!M.q.length) M.q = M.tracks.slice();
    let filter = "";
    const fmt = s => isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "0:00";
    el.innerHTML = `<div class="kmusic"><section class="kp qt-card kmu-now">
        <div class="kmu-art" id="ma"></div>
        <canvas class="kmu-viz" id="mv" width="600" height="110"></canvas>
        <input type="range" class="kseek" id="mseek" min="0" max="1000" value="0"><div class="krow sp kmini"><span id="mt">0:00</span><span id="md">0:00</span></div>
        <div class="krow" style="justify-content:center"><button class="qt-btn ghost" data-c="shuffle" title="Shuffle">🔀</button><button class="qt-btn" data-c="prev">⏮</button>
          <button class="qt-btn primary" data-c="toggle" id="mpp" style="min-width:70px">▶</button><button class="qt-btn" data-c="next">⏭</button><button class="qt-btn ghost" data-c="repeat" title="Repeat one">🔁</button>
          <button class="qt-btn ghost" data-c="mini" title="Mini player on the desktop (Ctrl+Alt+M)">⧉ Mini</button></div>
        <div class="kmu-lyr" id="ml"><p>Lyrics show here (from lrclib.net).</p></div></section>
      <section class="kp qt-card"><h3>Library <span class="qt-chip">${lib.tracks.length} songs</span><button class="qt-btn ghost kbtn-sm" data-rescan>Rescan</button></h3>
        <input class="qt-input" id="mf" placeholder="Search songs">
        <div class="kmu-list" id="mlist"></div>
        <div class="krow"><input class="qt-input grow" id="mdir" placeholder="Add a music folder"><button class="qt-btn kbtn-sm" data-adddir>Add</button></div>
        <p class="kmini">Looks in ${lib.roots.map(esc).join(", ")}. Songs VOLT downloads land in Downloads, so they show up too.</p></section></div>`;
    const list = () => {
      const f = filter.toLowerCase(), cur = M.q[M.i];
      const rows = M.tracks.filter(t => !f || (t.title + " " + t.artist + " " + t.album).toLowerCase().includes(f)).slice(0, 600);
      el.querySelector("#mlist").innerHTML = rows.length ? rows.map(t => `<button class="kmu-t ${cur && cur.id === t.id ? "on" : ""}" data-id="${t.id}"><div class="grow"><b>${esc(t.title)}</b><span>${esc(t.artist || "Unknown artist")}${t.album ? " · " + esc(t.album) : ""}</span></div><span class="kmini">${fmt(t.dur)}</span></button>`).join("")
        : `<div class="kempty">${lib.busy ? "Scanning..." : "No songs found. Add a folder below or download some with VOLT (mp3)."}</div>`;
    };
    const now = () => {
      const t = M.q[M.i];
      el.querySelector("#ma").innerHTML = t ? `<img src="/api/kit/cover?path=${encodeURIComponent(t.path)}" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'ph',textContent:'🎵'}))"><div><b class="qt-display" style="font-size:20px">${esc(t.title)}</b><div class="qt-muted">${esc(t.artist)}</div><div class="kmini">${esc(t.album)}</div></div>`
        : `<div class="ph">🎵</div><div><b>Nothing playing</b><div class="qt-muted">Pick a song</div></div>`;
      const ly = el.querySelector("#ml");
      ly.innerHTML = M.lyr.length ? M.lyr.map((l, i) => `<p data-i="${i}">${esc(l.s) || "♪"}</p>`).join("") : M.plain ? M.plain.split("\n").map(l => `<p>${esc(l)}</p>`).join("") : `<p>${t ? "No lyrics found for this one." : "Lyrics show here."}</p>`;
      list();
    };
    let lastLine = -1;
    M.onTrack = now;
    M.onTime = () => {
      const a = M.audio, s = el.querySelector("#mseek"); if (!s) return;
      if (!s.matches(":active")) s.value = a.duration ? 1000 * a.currentTime / a.duration : 0;
      el.querySelector("#mt").textContent = fmt(a.currentTime); el.querySelector("#md").textContent = fmt(a.duration);
      el.querySelector("#mpp").textContent = a.paused ? "▶" : "⏸";
      let li = -1; for (let i = 0; i < M.lyr.length; i++) if (M.lyr[i].t <= a.currentTime + 0.25) li = i;
      if (li !== lastLine) { lastLine = li; el.querySelectorAll("#ml p.on").forEach(p => p.classList.remove("on")); const p = el.querySelector(`#ml p[data-i="${li}"]`); if (p) { p.classList.add("on"); p.scrollIntoView({ block: "center", behavior: "smooth" }); } }
    };
    now(); M.onTime();
    // visualizer
    let ctx, an, raf;
    try {
      if (!M.actx) { M.actx = new AudioContext(); M.src = M.actx.createMediaElementSource(M.audio); M.an = M.actx.createAnalyser(); M.an.fftSize = 128; M.src.connect(M.an); M.an.connect(M.actx.destination); }
      an = M.an; ctx = el.querySelector("#mv").getContext("2d");
      const data = new Uint8Array(an.frequencyBinCount), accent = getComputedStyle(document.documentElement).getPropertyValue("--qt-accent").trim() || "#c6ff3d";
      const draw = () => {
        raf = requestAnimationFrame(draw); an.getByteFrequencyData(data);
        const c = ctx.canvas, w = c.width / data.length; ctx.clearRect(0, 0, c.width, c.height);
        for (let i = 0; i < data.length; i++) { const h = Math.max(3, data[i] / 255 * (c.height - 8)); ctx.fillStyle = accent; ctx.fillRect(i * w + 1, c.height - h, w - 3, h); ctx.fillStyle = "#000"; ctx.fillRect(i * w + 1, c.height - h, w - 3, 3); }
      };
      draw();
    } catch {}
    el.addEventListener("click", async e => {
      const id = e.target.closest("[data-id]")?.dataset.id; if (id) { M.q = M.tracks.slice(); M.playIdx(M.q.findIndex(t => t.id === id)); if (M.actx && M.actx.state === "suspended") M.actx.resume(); }
      const c = e.target.closest("[data-c]")?.dataset.c;
      if (c) {
        if (M.actx && M.actx.state === "suspended") M.actx.resume();
        if (c === "toggle") M.toggle(); if (c === "next") M.next(); if (c === "prev") M.prev();
        if (c === "shuffle") { M.shuffle = !M.shuffle; e.target.closest("[data-c]").classList.toggle("primary", M.shuffle); say(M.shuffle ? "Shuffle on" : "Shuffle off"); }
        if (c === "repeat") { M.repeat = !M.repeat; e.target.closest("[data-c]").classList.toggle("primary", M.repeat); say(M.repeat ? "Repeating this song" : "Repeat off"); }
        if (c === "mini") api("/api/kit/widgets", { op: "open", kind: "music" }).then(() => say("Mini player opening on the desktop"));
      }
      if (e.target.closest("[data-rescan]")) { await api("/api/kit/music", { op: "rescan" }); say("Rescanning..."); setTimeout(async () => { lib = await api("/api/kit/music"); M.tracks = lib.tracks; list(); }, 2500); }
      if (e.target.closest("[data-adddir]")) { try { await api("/api/kit/music", { op: "adddir", path: el.querySelector("#mdir").value }); say("Folder added. Scanning..."); setTimeout(async () => { lib = await api("/api/kit/music"); M.tracks = lib.tracks; list(); }, 3000); } catch (err) { say(err.message, { bad: true }); } }
    });
    el.querySelector("#mseek").oninput = e => { if (M.audio.duration) M.audio.currentTime = e.target.value / 1000 * M.audio.duration; };
    el.querySelector("#mf").oninput = e => { filter = e.target.value; list(); };
    return () => { cancelAnimationFrame(raf); M.onTrack = null; M.onTime = null; };
  });
})();
