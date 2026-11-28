/* Toolkit panels: phone webcam + mic, find my phone, clipboard stack, stream deck, phone mirror. */
(() => {
  const K = window.qtKit, { api, esc, say, qrSvg, ago } = K;
  const qrBlock = async (url, title, note) => `<div class="krow"><span class="kqr">${await qrSvg(url, 4)}</span>
    <div class="grow kfield"><b style="color:var(--qt-fg)">${esc(title)}</b><span>${esc(note)}</span><code>${esc(url.split("?")[0])}</code>
    <span class="krow"><button class="qt-btn kbtn-sm" data-copy="${esc(url)}">Copy link</button></span></div></div>`;
  const wireCopy = el => el.addEventListener("click", e => { const b = e.target.closest("[data-copy]"); if (b) { navigator.clipboard.writeText(b.dataset.copy); say("Link copied"); } });

  /* ------------------------------------------------------------- 1. webcam + mic */
  K.panel("cam", async el => {
    const s = await api("/api/kit/cam");
    el.innerHTML = `<div class="kcols">
      <section class="kp qt-card"><h3>Live view <span class="qt-chip" id="cs">waiting</span></h3>
        <img class="kcam" id="cimg" src="/api/kit/cam.mjpg" alt="Phone camera">
        <div class="krow"><span class="kpill" id="cface"><button data-f="back" aria-pressed="true">Back camera</button><button data-f="front">Front camera</button></span>
          <span class="kpill" id="cq"><button data-q="480">480p</button><button data-q="720" aria-pressed="true">720p</button><button data-q="1080">1080p</button></span>
          <button class="qt-btn ghost kbtn-sm" data-torch>Torch</button></div>
        <div class="kfield">Phone mic level <div class="kmeter"><i id="mlev"></i></div><span id="mdev"></span></div>
      </section>
      <section class="kp qt-card"><h3>1. Open it on the phone</h3><div id="cqr"></div>
        <p class="kmini">On the phone page tap <b>Start camera</b> and/or <b>Start mic</b>. Keep the screen on. Over USB, run Phone mirror's adb or <code>adb reverse tcp:7804 tcp:7804</code> and use the localhost link.</p>
        <h3>2. Use it in other apps</h3>
        <div class="kfield"><b style="color:var(--qt-fg)">As a webcam (Zoom, Meet, Discord)</b>
          <span>OBS's Virtual Camera turns the phone feed into a normal webcam called "OBS Virtual Camera".</span>
          <span class="krow"><button class="qt-btn primary" data-obs>${s.obs.scene ? "Start OBS virtual camera" : "Set up OBS + start"}</button>
          <span class="kmini">${s.obs.installed ? "OBS is installed" : "Install OBS Studio first (obsproject.com)"}</span></span></div>
        <div class="kfield"><b style="color:var(--qt-fg)">As a microphone</b>
          <span>Phone audio plays into the output below. Pick <b>CABLE Input</b>, then choose <b>CABLE Output</b> as the mic in your app.</span>
          <select id="mout">${s.mic.devices.map(d => `<option ${(s.mic.dev || "").startsWith(d.slice(0, 20)) ? "selected" : ""}>${esc(d)}</option>`).join("")}</select></div>
      </section></div>`;
    el.querySelector("#cqr").innerHTML = await qrBlock(s.urls.tailscale && !s.urls.lan ? s.urls.tailscale : s.urls.lan, "Phone camera page", "Scan with the phone. Same Wi-Fi, or Tailscale away from home.");
    wireCopy(el);
    const pick = (box, attr, v) => box.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", b.dataset[attr] === v));
    el.querySelector("#cface").onclick = e => { const b = e.target.closest("button"); if (!b) return; pick(e.currentTarget, "f", b.dataset.f); api("/api/kit/cam/ctl", { facing: b.dataset.f }); };
    el.querySelector("#cq").onclick = e => { const b = e.target.closest("button"); if (!b) return; pick(e.currentTarget, "q", b.dataset.q); api("/api/kit/cam/ctl", { size: +b.dataset.q }); };
    el.querySelector("[data-torch]").onclick = () => api("/api/kit/cam/ctl", { torch: "toggle" });
    el.querySelector("#mout").onchange = e => api("/api/kit/cam/micdev", { name: e.target.value }).then(() => say("Phone mic now plays into " + e.target.value));
    el.querySelector("[data-obs]").onclick = async () => {
      try { if (!s.obs.scene) await api("/api/kit/cam/obs", {}); const r = await api("/api/kit/cam/openobs", { virtual: true }); say(r.msg); } catch (e) { say(e.message, { bad: true }); }
    };
    const t = setInterval(async () => {
      try {
        const x = await api("/api/kit/cam");
        const c = el.querySelector("#cs"); if (!c) return;
        c.textContent = x.live ? `live \u00b7 ${x.fps} fps` : "waiting for the phone"; c.className = "qt-chip" + (x.live ? " ok" : "");
        el.querySelector("#mlev").style.width = (x.mic.live ? x.mic.level * 100 : 0) + "%";
        el.querySelector("#mdev").textContent = x.mic.live ? "Playing into " + x.mic.dev : "Mic not started on the phone";
      } catch {}
    }, 1000);
    return () => { clearInterval(t); const i = el.querySelector("#cimg"); if (i) i.src = ""; };
  });

  /* ------------------------------------------------------------- 2. find my phone */
  K.panel("find", async el => {
    const s = await api("/api/kit/find");
    el.innerHTML = `<div class="kcols">
      <section class="kp qt-card"><h3>Find it</h3>
        <div class="kfield">Phone<select id="fser"><option value="">Phone page only</option>${s.adb.map(d => `<option value="${esc(d.serial)}" selected>${esc(d.model)} (USB / adb)</option>`).join("")}</select></div>
        <div class="krow"><button class="qt-btn primary" data-a="ring">\ud83d\udd14 Ring loudly</button><button class="qt-btn" data-a="stop">Stop ringing</button>
          <button class="qt-btn" data-a="locate">\ud83d\udccd Locate</button><button class="qt-btn" data-a="lock">\ud83d\udd12 Lock</button></div>
        <div class="krow"><input class="qt-input grow" id="fmsg" placeholder="Message to show on the phone, e.g. Please call 98..."><button class="qt-btn" data-a="message">Show message</button></div>
        <p class="kmini">Two ways to reach the phone: over USB/adb (works even with the screen off), and the Find page below (keep it open in the phone browser or add it to the home screen; Android lets a page ring only while it's open).</p>
        <div id="fout" class="kmini"></div>
      </section>
      <section class="kp qt-card"><h3>Where it is</h3><div id="fmap" class="kempty">Press Locate.</div></section>
      <section class="kp qt-card"><h3>Find page for the phone</h3><div id="fqr"></div></section></div>`;
    el.querySelector("#fqr").innerHTML = await qrBlock(s.urls.lan, "Find my phone page", "Open once on the phone and allow location. Then leave it open.");
    wireCopy(el);
    const paint = loc => {
      const m = el.querySelector("#fmap");
      if (!loc) return;
      const d = 0.004;
      m.className = "";
      m.innerHTML = `<iframe class="kmap" loading="lazy" src="https://www.openstreetmap.org/export/embed.html?bbox=${loc.lon - d},${loc.lat - d},${loc.lon + d},${loc.lat + d}&layer=mapnik&marker=${loc.lat},${loc.lon}"></iframe>
        <div class="krow sp kmini"><span>${loc.lat.toFixed(5)}, ${loc.lon.toFixed(5)}${loc.acc ? " \u00b1" + Math.round(loc.acc) + " m" : ""} \u00b7 ${esc(loc.src)} \u00b7 ${ago(loc.t)}${loc.bat != null ? " \u00b7 battery " + Math.round(loc.bat * 100) + "%" : ""}</span>
        <a class="qt-btn kbtn-sm" target="_blank" href="https://www.google.com/maps?q=${loc.lat},${loc.lon}">Open in Maps</a></div>`;
    };
    paint(s.loc);
    let lastT = s.loc ? s.loc.t : 0;
    el.addEventListener("click", async e => {
      const b = e.target.closest("[data-a]"); if (!b) return;
      try {
        const r = await api("/api/kit/find", { what: b.dataset.a, serial: el.querySelector("#fser").value, text: el.querySelector("#fmsg").value });
        el.querySelector("#fout").textContent = "Sent to the phone page" + (r.adb ? " \u00b7 adb: " + r.adb : "");
        say(b.textContent.trim() + " sent");
      } catch (err) { say(err.message, { bad: true }); }
    });
    const t = setInterval(async () => { try { const x = await api("/api/kit/find"); if (x.loc && x.loc.t !== lastT) { lastT = x.loc.t; paint(x.loc); } } catch {} }, 3000);
    return () => clearInterval(t);
  });

  /* ------------------------------------------------------------- 3. clipboard stack */
  K.panel("clips", async el => {
    let s = await api("/api/kit/clips");
    el.innerHTML = `<div class="kcols">
      <section class="kp qt-card"><h3>Stack <span class="qt-chip" id="cn"></span></h3>
        <div class="krow"><button class="qt-btn primary" data-op="next" title="Ctrl+Alt+V from any app">Paste next (Ctrl+Alt+V)</button><button class="qt-btn" data-op="all">Copy all</button>
          <button class="qt-btn" data-op="tophone">Send PC clipboard to phone</button><button class="qt-btn ghost" data-op="clear">Clear</button></div>
        <div class="krow"><input class="qt-input grow" id="cadd" placeholder="Add text to the stack"><button class="qt-btn" data-op="add">Add</button></div>
        <div class="klist" id="cl"></div></section>
      <section class="kp qt-card"><h3>From the phone</h3><div id="cqr"></div>
        <label class="krow"><button class="qt-switch" role="switch" id="cauto" aria-checked="${s.autocopy}"></button> Copy to the PC clipboard as soon as it arrives</label>
        <p class="kmini">Paste next takes the oldest item, puts it on the clipboard and presses Ctrl+V for you, so you can fill a form one field at a time.</p></section></div>`;
    el.querySelector("#cqr").innerHTML = await qrBlock(s.urls.lan, "Clipboard page", "Type or paste on the phone, tap Send.");
    wireCopy(el);
    const draw = () => {
      el.querySelector("#cn").textContent = s.items.length + " items";
      el.querySelector("#cl").innerHTML = s.items.length ? s.items.map((c, i) => `<div class="kitem"><b class="kmini">${i + 1}</b><div class="grow"><b>${esc(c.text.slice(0, 160))}</b>
        <span>${c.src === "phone" ? "\ud83d\udcf1 phone" : "\ud83d\udcbb PC"} \u00b7 ${ago(c.t)}</span></div>
        <button class="qt-btn kbtn-sm" data-copy-id="${c.id}">Copy</button><button class="qt-btn ghost kbtn-sm" data-del="${c.id}">\u2715</button></div>`).join("")
        : `<div class="kempty">Empty. Send text from the phone page, or add it here.</div>`;
    };
    draw();
    el.addEventListener("click", async e => {
      const op = e.target.closest("[data-op]")?.dataset.op;
      const cp = e.target.closest("[data-copy-id]")?.dataset.copyId, del = e.target.closest("[data-del]")?.dataset.del;
      try {
        if (op === "add") { s = await api("/api/kit/clips", { op, text: el.querySelector("#cadd").value }); el.querySelector("#cadd").value = ""; }
        else if (op) { const r = await api("/api/kit/clips", { op }); if (r.items) s = r; else s = await api("/api/kit/clips"); say({ next: "Pasted", all: "All copied", tophone: "Sent to the phone", clear: "Cleared" }[op] || "Done"); }
        if (cp) { s = await api("/api/kit/clips", { op: "copy", id: cp }); say("Copied"); }
        if (del) s = await api("/api/kit/clips", { op: "del", id: del });
        draw();
      } catch (err) { say(err.message, { bad: true }); }
    });
    el.querySelector("#cauto").onclick = async e => { const on = e.currentTarget.getAttribute("aria-checked") !== "true"; e.currentTarget.setAttribute("aria-checked", on); await api("/api/kit/clips", { op: "autocopy", on }); };
    const t = setInterval(async () => { try { const x = await api("/api/kit/clips"); if (JSON.stringify(x.items) !== JSON.stringify(s.items)) { s = x; draw(); } } catch {} }, 2500);
    return () => clearInterval(t);
  });

  /* ------------------------------------------------------------- 4. stream deck */
  K.actionEditor = function (a, named, macros) {
    a = a || { type: "media", key: "playpause" };
    const opt = (v, l) => `<option value="${v}" ${a.type === v ? "selected" : ""}>${l}</option>`;
    return `<div class="kfield">Does<select data-ae="type">${opt("media", "Media key")}${opt("kit", "Toolkit command")}${opt("keys", "Press keys")}${opt("type", "Type text")}${opt("open", "Open file / folder / link")}${opt("run", "Run a program")}${opt("tool", "Open a Suite tool")}${macros ? opt("macro", "Run a macro") : ""}${opt("wait", "Wait")}${opt("click", "Click at a point")}</select></div>
      <div data-ae-body>${aeBody(a, named, macros)}</div>`;
  };
  function aeBody(a, named, macros) {
    const v = k => esc(a[k] ?? "");
    switch (a.type) {
      case "media": return `<select data-ak="key">${["playpause", "next", "prev", "volup", "voldown", "mute"].map(k => `<option ${a.key === k ? "selected" : ""}>${k}</option>`).join("")}</select>`;
      case "kit": return `<select data-ak="name">${named.map(n => `<option value="${n.name}" ${a.name === n.name ? "selected" : ""}>${esc(n.label)}</option>`).join("")}</select>`;
      case "keys": return `<input class="qt-input" data-ak="combo" value="${v("combo")}" placeholder="ctrl+shift+esc">`;
      case "type": return `<textarea data-ak="text" placeholder="Text to type">${v("text")}</textarea>`;
      case "open": return `<input class="qt-input" data-ak="target" value="${v("target")}" placeholder="C:\\path or https://...">`;
      case "run": return `<input class="qt-input" data-ak="path" value="${v("path")}" placeholder="C:\\Program Files\\...\\app.exe"><input class="qt-input" data-ak="args" value="${v("args")}" placeholder="arguments (optional)">`;
      case "tool": return `<input class="qt-input" data-ak="id" value="${v("id")}" placeholder="beam, volt, kit/music, home...">`;
      case "macro": return `<select data-ak="id">${(macros || []).map(m => `<option value="${m.id}" ${a.id === m.id ? "selected" : ""}>${esc(m.name)}</option>`).join("")}</select>`;
      case "wait": return `<input type="number" data-ak="ms" value="${a.ms || 500}" min="0" step="100"> ms`;
      case "click": return `<div class="krow"><input type="number" data-ak="x" value="${a.x || 0}"> <input type="number" data-ak="y" value="${a.y || 0}"><button class="qt-btn kbtn-sm" data-pickpt type="button">Pick in 3 s</button></div>`;
    }
    return "";
  }
  K.readAction = function (box, named, macros, onTypeChange) {
    const type = box.querySelector("[data-ae=type]").value, a = { type };
    box.querySelectorAll("[data-ak]").forEach(i => { a[i.dataset.ak] = i.type === "number" ? +i.value : i.value; });
    return a;
  };
  K.wireActionEditor = function (box, named, macros) {
    box.addEventListener("change", e => { if (e.target.matches("[data-ae=type]")) box.querySelector("[data-ae-body]").innerHTML = aeBody({ type: e.target.value }, named, macros); });
    box.addEventListener("click", async e => {
      if (!e.target.closest("[data-pickpt]")) return;
      say("Move the mouse to the spot. Reading it in 3 seconds...");
      const r = await api("/api/kit/macros", { op: "cursor", delay: 3 });
      box.querySelector("[data-ak=x]").value = r.x; box.querySelector("[data-ak=y]").value = r.y; say(`Got ${r.x}, ${r.y}`);
    });
  };

  K.panel("deck", async el => {
    let d = await api("/api/kit/deck"), sel = 0;
    el.innerHTML = `<div class="kcols">
      <section class="kp qt-card"><h3>Buttons <span class="kmini">click one to edit</span></h3>
        <div class="krow"><span class="kfield">Columns <input type="number" id="dcols" min="2" max="6" value="${d.cols}"></span>
          <button class="qt-btn ghost kbtn-sm" data-reset>Reset to default</button></div>
        <div class="kdeck" id="dg"></div></section>
      <section class="kp qt-card" id="ded"></section>
      <section class="kp qt-card"><h3>On the phone</h3><div id="dqr"></div><p class="kmini">Add it to the phone's home screen (Chrome menu, Add to Home screen) and it opens full screen like an app.</p></section></div>`;
    el.querySelector("#dqr").innerHTML = await qrBlock(d.urls.lan, "Stream deck page", "Scan with your phone.");
    wireCopy(el);
    const grid = () => {
      const g = el.querySelector("#dg"); g.style.setProperty("--cols", d.cols);
      g.innerHTML = d.buttons.map((b, i) => `<button class="kdk${i === sel ? " sel" : ""}" style="--c:${b.color}" data-i="${i}"><span class="e">${esc(b.icon)}</span>${esc(b.label)}</button>`).join("") + `<button class="kdk add" data-add>+ Add</button>`;
      editor();
    };
    const editor = () => {
      const b = d.buttons[sel], box = el.querySelector("#ded");
      if (!b) { box.innerHTML = `<div class="kempty">No buttons. Add one.</div>`; return; }
      box.innerHTML = `<h3>Edit button</h3><div class="krow"><label class="kfield grow">Label<input class="qt-input" data-k="label" value="${esc(b.label)}"></label>
        <label class="kfield" style="width:80px">Icon<input class="qt-input" data-k="icon" value="${esc(b.icon)}"></label><label class="kfield">Colour<input type="color" data-k="color" value="${b.color}"></label></div>
        <div class="ae">${K.actionEditor(b.action, d.named)}</div>
        <div class="krow"><button class="qt-btn primary" data-save>Save</button><button class="qt-btn" data-test>Test on PC</button><button class="qt-btn ghost" data-del>Delete</button>
        <button class="qt-btn ghost kbtn-sm" data-mv="-1">\u2190</button><button class="qt-btn ghost kbtn-sm" data-mv="1">\u2192</button></div>`;
      K.wireActionEditor(box.querySelector(".ae"), d.named);
    };
    const save = async () => { d = Object.assign(await api("/api/kit/deck", { cols: d.cols, buttons: d.buttons }), {}); grid(); };
    el.addEventListener("click", async e => {
      const t = e.target;
      if (t.closest("[data-i]")) { sel = +t.closest("[data-i]").dataset.i; grid(); }
      if (t.closest("[data-add]")) { d.buttons.push({ id: "", label: "New", icon: "\u2b50", color: "#c6ff3d", action: { type: "media", key: "playpause" } }); sel = d.buttons.length - 1; await save(); }
      const box = el.querySelector("#ded");
      if (t.closest("[data-save]") || t.closest("[data-test]")) {
        const b = d.buttons[sel];
        box.querySelectorAll("[data-k]").forEach(i => { b[i.dataset.k] = i.value; });
        b.action = K.readAction(box.querySelector(".ae"));
        if (t.closest("[data-test]")) { try { const r = await api("/api/kit/do", { action: b.action }); say(r.msg); } catch (err) { say(err.message, { bad: true }); } return; }
        await save(); say("Saved. The phone updates by itself.");
      }
      if (t.closest("[data-del]")) { d.buttons.splice(sel, 1); sel = Math.max(0, sel - 1); await save(); }
      if (t.closest("[data-mv]")) { const j = sel + +t.closest("[data-mv]").dataset.mv; if (j >= 0 && j < d.buttons.length) { [d.buttons[sel], d.buttons[j]] = [d.buttons[j], d.buttons[sel]]; sel = j; await save(); } }
      if (t.closest("[data-reset]")) { d = await api("/api/kit/deck/reset", {}); sel = 0; grid(); }
    });
    el.querySelector("#dcols").onchange = e => { d.cols = +e.target.value; save(); };
    grid();
  });

  /* ------------------------------------------------------------- 19. phone mirror */
  K.panel("mirror", async el => {
    const draw = async () => {
      const s = await api("/api/kit/mirror");
      el.innerHTML = `<div class="kcols"><section class="kp qt-card"><h3>Mirror ${s.running ? '<span class="qt-chip ok">running</span>' : ""}</h3>
        ${!s.installed ? `<p>Phone mirror uses <b>scrcpy</b> (free, open source, by Genymobile). It's about 6 MB.</p>
          <button class="qt-btn primary" data-install ${s.busy ? "disabled" : ""}>${s.busy ? esc(s.busy) + "..." : "Download scrcpy"}</button>` : `
          <div class="kfield">Phone<select id="mser">${s.devices.length ? s.devices.map(d => `<option value="${esc(d.serial)}">${esc(d.model)}</option>`).join("") : "<option value=''>No phone found over USB</option>"}</select></div>
          <div class="krow"><label class="kfield">Max size<select id="msize"><option value="0">Full</option><option value="1920">1920</option><option value="1280" selected>1280</option><option value="1024">1024</option><option value="800">800</option></select></label>
          <label class="kfield">Show<select id="mcam"><option value="">Screen</option><option value="back">Back camera (Android 12+)</option><option value="front">Front camera (Android 12+)</option></select></label></div>
          <div class="krow">${[["screen_off", "Turn phone screen off", 0], ["awake", "Keep awake", 1], ["ontop", "Always on top", 0], ["audio", "Phone audio on PC (Android 11+)", 1], ["record", "Record to Videos", 0], ["readonly", "View only", 0]]
            .map(([k, l, on]) => `<label class="krow kmini"><input type="checkbox" data-o="${k}" ${on ? "checked" : ""}> ${l}</label>`).join("")}</div>
          <div class="krow"><button class="qt-btn primary" data-start ${s.devices.length ? "" : "disabled"}>${s.running ? "Restart mirror" : "Start mirror"}</button>${s.running ? `<button class="qt-btn" data-stop>Stop</button>` : ""}
          <span class="kmini">scrcpy ${esc(s.version || "")}</span></div>`}
        </section><section class="kp qt-card"><h3>Tips</h3><ul class="kmini">
          <li>Plug the phone in with USB and turn on USB debugging (Settings, Developer options).</li>
          <li>In the mirror window: right-click is Back, middle-click is Home, Ctrl+Shift+Arrow rotates, drag files in to copy them to the phone.</li>
          <li>Ctrl+C / Ctrl+V share the clipboard both ways.</li><li>Hotkey: bind "Phone mirror on / off" in Hotkeys.</li></ul></section></div>`;
      if (s.busy) setTimeout(() => el.isConnected && draw(), 1500);
    };
    await draw();
    el.addEventListener("click", async e => {
      try {
        if (e.target.closest("[data-install]")) { await api("/api/kit/mirror/install", {}); draw(); }
        if (e.target.closest("[data-stop]")) { await api("/api/kit/mirror/stop", {}); draw(); }
        if (e.target.closest("[data-start]")) {
          const o = { serial: el.querySelector("#mser").value, size: +el.querySelector("#msize").value, camera: el.querySelector("#mcam").value };
          el.querySelectorAll("[data-o]").forEach(c => { o[c.dataset.o] = c.checked; });
          e.target.closest("[data-start]").disabled = true;
          await api("/api/kit/mirror/start", o); say("Mirror started"); draw();
        }
      } catch (err) { say(err.message, { bad: true }); draw(); }
    });
  });
})();
