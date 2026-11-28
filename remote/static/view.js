// QT Remote viewer: runs in any browser on your other device (laptop, phone, another PC).
(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const KEY = "qtr-key", NAME = "qtr-name", PREF = "qtr-pref";
  const touchy = matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0;
  const pref = Object.assign({ q: "balanced", fit: true, touch: "trackpad", mon: 0 }, JSON.parse(localStorage.getItem(PREF) || "{}"));
  const savePref = () => localStorage.setItem(PREF, JSON.stringify(pref));
  const cv = $("#screen"), g = cv.getContext("2d", { alpha: false }), stage = $("#stage"), wrap = $("#wrap");
  let ws = null, hello = null, info = null, live = false, leaving = false, retries = 0, lastPcClip = "";
  let view = { z: 1, x: 0, y: 0 }; // touch zoom + pan on top of the fit layout
  const st = { frames: 0, bytes: 0, t0: performance.now(), rtt: 0 };
  const held = new Set();

  // ------------------------------------------------------------ small UI helpers
  function toast(msg, opt = {}) {
    const t = document.createElement("div");
    t.className = "qt-toast" + (opt.bad ? " bad" : "");
    t.textContent = msg;
    if (opt.action) {
      const b = document.createElement("button");
      b.className = "qt-btn"; b.textContent = opt.action;
      b.onclick = () => { opt.run(); t.remove(); };
      t.append(b);
    }
    $("#toasts").append(t);
    setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 350); }, opt.ms || 3500);
    return t;
  }
  function gate(title, html) {
    $("#gate").classList.remove("hide");
    stage.classList.add("hide"); $("#tb").classList.add("hide"); $("#pull").classList.add("hide");
    $("#gTitle").textContent = title;
    $("#gBody").innerHTML = html;
  }
  function cover(title, text, buttons = []) {
    const c = $("#cover");
    if (!title) return c.classList.add("hide");
    c.classList.remove("hide");
    $("#cTitle").textContent = title; $("#cText").textContent = text;
    const row = $("#cBtns"); row.innerHTML = "";
    for (const [label, fn, cls] of buttons) {
      const b = document.createElement("button"); b.className = "qt-btn " + (cls || ""); b.textContent = label; b.onclick = fn; row.append(b);
    }
  }
  const guessName = () => {
    const ua = navigator.userAgent;
    if (/iPhone/.test(ua)) return "iPhone";
    if (/iPad/.test(ua)) return "iPad";
    if (/Android/.test(ua)) return /Mobile/.test(ua) ? "Android phone" : "Android tablet";
    if (/Mac/.test(ua)) return "Mac";
    if (/Windows/.test(ua)) return "Windows laptop";
    return "My device";
  };
  const send = (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };

  // ------------------------------------------------------------ hello + pairing
  async function start() {
    const key = localStorage.getItem(KEY);
    try {
      const r = await fetch("/api/hello", { headers: key ? { "X-Remote-Key": key } : {} });
      hello = await r.json();
      if (!r.ok) return gate("Can't connect", `<p>${esc(hello.error || "The PC said no.")}</p>`);
    } catch (_) {
      return gate("Can't reach the PC", `<p>Make sure the PC is on and QT Remote is running, and that Tailscale is connected on this device.</p>
        <button class="qt-btn primary" onclick="location.reload()">Try again</button>`);
    }
    document.title = `${hello.pc} · QT Remote`;
    $("#gWho").innerHTML = `<span class="qt-dot ${hello.kind === "lan" ? "warn" : "on"}"></span>
      ${hello.kind === "tailnet" ? `You are <b>${esc(hello.you)}</b> on Tailscale · encrypted` : hello.kind === "local" ? "This is the PC itself" : "<span class=warn>Plain Wi-Fi: not encrypted</span>"}`;
    if (!hello.enabled) return gate(hello.pc, `<p>Remote connections are turned off on this PC. Turn on <b>Let my devices connect</b> in QT Suite > Remote.</p>`);
    if (hello.trusted) return connect();
    if (key) localStorage.removeItem(KEY);
    pairForm(key ? "This device's key isn't valid on the PC any more (it was removed, or it paired from another Tailscale device). Pair again:" : "");
  }

  function pairForm(note) {
    gate(`Connect to ${hello.pc}`, `
      ${note ? `<p class="warn">${esc(note)}</p>` : `<p>First time on this device. Give it a name, ask to connect, then allow it on the PC.</p>`}
      <label class="small qt-muted" for="nm">This device's name</label>
      <input class="qt-input" id="nm" maxlength="40" value="${esc(localStorage.getItem(NAME) || guessName())}">
      <button class="qt-btn primary" id="ask" style="width:100%">Ask to connect</button>`);
    $("#ask").onclick = askPair;
    $("#nm").onkeydown = (e) => { if (e.key === "Enter") askPair(); };
  }

  async function askPair() {
    const name = ($("#nm").value || guessName()).trim();
    localStorage.setItem(NAME, name);
    let r, d;
    try {
      r = await fetch("/api/pair", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      d = await r.json();
    } catch (_) { return toast("Couldn't reach the PC", { bad: true }); }
    if (!r.ok) return toast(d.error || "The PC said no", { bad: true });
    let left = d.ttl;
    gate(`Allow on ${hello.pc}`, `
      <p>A prompt opened on the PC. Check it shows this code, then press <b>Allow</b> there:</p>
      <div class="code-big" aria-label="${esc(d.code)}">${[...String(d.code)].map((ch, i) => `${i === 3 ? " " : ""}<span class="cd" style="--i:${i}">${esc(ch)}</span>`).join("")}</div>
      <p class="small"><span class="spin"></span> Waiting · <span id="left">${left}</span>s</p>
      <p class="small">Not at the PC? Someone can allow it from QT Suite > Remote, or from another device you already trust.</p>
      <button class="qt-btn ghost" id="cancel">Cancel</button>`);
    let stop = false;
    $("#cancel").onclick = () => { stop = true; pairForm(""); };
    const tick = setInterval(() => { left--; const e = $("#left"); if (e) e.textContent = Math.max(0, left); }, 1000);
    while (!stop) {
      await new Promise((res) => setTimeout(res, 1200));
      let s;
      try { s = await (await fetch(`/api/pair/${d.id}?s=${encodeURIComponent(d.secret)}`)).json(); } catch (_) { continue; }
      if (s.state === "waiting") continue;
      clearInterval(tick);
      if (s.token) { localStorage.setItem(KEY, s.token); toast(s.view_only ? "Paired (view only)" : "Paired"); return connect(); }
      const why = { denied: "The PC didn't allow it.", expired: "Nobody answered in time.", replaced: "A newer request replaced this one." }[s.state] || "Pairing stopped.";
      gate(`Not paired`, `<p>${why}</p><button class="qt-btn primary" id="again">Try again</button>`);
      $("#again").onclick = () => pairForm("");
      return;
    }
    clearInterval(tick);
  }

  // ------------------------------------------------------------ session
  function want() {
    const dpr = window.devicePixelRatio || 1;
    if (!pref.fit) return { maxw: 7680, maxh: 4320 };
    const z = Math.min(view.z, 3);
    return { maxw: Math.round(innerWidth * dpr * z), maxh: Math.round(innerHeight * dpr * z) };
  }
  function connect() {
    leaving = false;
    if (!live) gate(`Connecting to ${hello.pc}`, `<p><span class="spin"></span> Starting the session...</p>`);
    const sock = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
    ws = sock;
    sock.binaryType = "arraybuffer";
    sock.onopen = () => sock.send(JSON.stringify({ t: "hello", key: localStorage.getItem(KEY), cfg: Object.assign({ q: pref.q, mon: pref.mon }, want()) }));
    sock.onmessage = (e) => { if (sock === ws) typeof e.data === "string" ? onJson(JSON.parse(e.data)) : queueFrame(e.data); };
    sock.onclose = () => {
      if (sock !== ws) return; // an older connection finishing after we moved on
      const was = live;
      live = false;
      releaseHeld();
      if (leaving) return;
      if (was || retries) {
        if (retries > 12) return cover("Lost the connection", "The PC stopped answering.", [["Connect again", () => { retries = 0; cover(); connect(); }, "primary"]]);
        retries++;
        cover("Reconnecting...", "The connection dropped. Trying again.", [["Stop", end]]);
        setTimeout(connect, Math.min(8000, 600 * retries));
      } else if (!$("#gate").classList.contains("hide")) {
        gate("Couldn't start the session", `<p>The PC closed the connection.</p><button class="qt-btn primary" onclick="location.reload()">Try again</button>`);
      }
    };
  }

  function onJson(d) {
    if (d.t === "info") {
      info = d; live = true; retries = 0;
      $("#gate").classList.add("hide"); stage.classList.remove("hide"); $("#tb").classList.remove("hide");
      cover();
      document.body.classList.toggle("viewonly", d.view_only);
      $("#pcname").textContent = d.pc + (d.view_only ? " · view only" : "");
      const mon = $("#mon");
      mon.innerHTML = d.mons.map((m) => `<option value="${m.i}">Screen ${m.i + 1}${m.primary ? " (main)" : ""} · ${m.w}x${m.h}</option>`).join("") +
        (d.mons.length > 1 ? `<option value="-1">All screens</option>` : "");
      mon.value = d.mon; mon.classList.toggle("hide", d.mons.length < 2);
      for (const id of ["#bKeys", "#bKbd", "#bTouch", "#bClip"]) $(id).classList.toggle("hide", d.view_only);
      $("#bKbd").classList.toggle("hide", d.view_only || !touchy);
      $("#bTouch").classList.toggle("hide", d.view_only || !touchy);
      $("#bClip").classList.toggle("hide", d.view_only || !d.clip_sync);
      $("#bFile").classList.toggle("hide", !d.files);
      setTouchLabel();
      layout();
      if (touchy && !d.view_only) hint(pref.touch === "trackpad" ? "Drag to move · tap to click · two fingers: scroll / right-click · pinch to zoom · hold to drag"
        : "Tap where you want to click · two fingers: scroll / right-click · pinch to zoom");
      tuckSoon();
      cv.focus();
    } else if (d.t === "wait") {
      gate(`Waiting for ${hello.pc}`, `<p><span class="spin"></span> ${esc(d.text)}</p>`);
    } else if (d.t === "bye") {
      leaving = true;
      if (d.unpair) { localStorage.removeItem(KEY); return pairForm(d.reason); }
      if (d.again) { live = false; toast(d.reason); setTimeout(connect, 400); return; }
      live = false;
      gate("Session ended", `<p>${esc(d.reason || "")}</p><div class="row"><button class="qt-btn primary" id="re">Connect again</button></div>`);
      $("#re").onclick = () => location.reload();
    } else if (d.t === "secure") {
      if (d.on) cover("The PC is on a secure screen", "It is locked, signing in, or showing an admin (UAC) prompt. Windows doesn't let any app show or control those. Unlock it at the PC.", []);
      else cover();
    } else if (d.t === "clip") {
      lastPcClip = d.text;
      $("#clipCopy").disabled = false;
      const short = d.text.length > 40 ? d.text.slice(0, 40) + "..." : d.text;
      toast(`PC copied: ${short}`, { action: "Copy here", run: () => copyLocal(d.text), ms: 5000 });
    } else if (d.t === "pending") {
      renderAsks(d.list);
    } else if (d.t === "pong") {
      st.rtt = Math.round(performance.now() - d.ts);
    }
  }

  // frames: [1][u16 W][u16 H][u16 n] then n x ([u16 x y w h][u32 len][jpeg])
  let chain = Promise.resolve();
  function queueFrame(buf) { chain = chain.then(() => drawFrame(buf)).catch(() => send({ t: "ack" })); }
  async function drawFrame(buf) {
    const dv = new DataView(buf);
    if (dv.getUint8(0) !== 1) return;
    const W = dv.getUint16(1, true), H = dv.getUint16(3, true), n = dv.getUint16(5, true);
    let o = 7;
    const jobs = [];
    for (let i = 0; i < n; i++) {
      const x = dv.getUint16(o, true), y = dv.getUint16(o + 2, true), len = dv.getUint32(o + 8, true);
      o += 12;
      jobs.push(createImageBitmap(new Blob([new Uint8Array(buf, o, len)], { type: "image/jpeg" })).then((b) => ({ x, y, b })));
      o += len;
    }
    const imgs = await Promise.all(jobs);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; layout(); }
    for (const { x, y, b } of imgs) { g.drawImage(b, x, y); b.close(); }
    send({ t: "ack" });
    st.frames++; st.bytes += buf.byteLength;
  }

  // ------------------------------------------------------------ layout + zoom
  function region() {
    if (!info) return { w: cv.width, h: cv.height };
    const m = info.mon === -1 ? null : info.mons[info.mon] || info.mons[0];
    return m ? { w: m.w, h: m.h } : { w: cv.width, h: cv.height };
  }
  function layout() {
    if (!cv.width) return;
    const dpr = window.devicePixelRatio || 1;
    if (!pref.fit) {
      const r = region();
      stage.classList.add("scroll");
      cv.style.width = r.w / dpr + "px"; cv.style.height = r.h / dpr + "px";
      cv.classList.add("pixel");
      $("#bFit").textContent = "Real size";
      return;
    }
    stage.classList.remove("scroll");
    cv.classList.remove("pixel");
    $("#bFit").textContent = "Fit";
    const s = Math.min(innerWidth / cv.width, innerHeight / cv.height);
    const w = cv.width * s, h = cv.height * s;
    cv.style.width = w + "px"; cv.style.height = h + "px";
    const ox = (innerWidth - w) / 2, oy = (innerHeight - h) / 2;
    // keep the zoomed view inside the screen
    const zw = w * view.z, zh = h * view.z;
    view.x = zw <= innerWidth ? (innerWidth - zw) / 2 - ox : Math.min(-ox, Math.max(innerWidth - zw - ox, view.x));
    view.y = zh <= innerHeight ? (innerHeight - zh) / 2 - oy : Math.min(-oy, Math.max(innerHeight - zh - oy, view.y));
    wrap.style.transform = `translate(${ox + view.x}px, ${oy + view.y}px) scale(${view.z})`;
  }
  let cfgT = 0;
  function sendCfgSoon() { clearTimeout(cfgT); cfgT = setTimeout(() => send(Object.assign({ t: "cfg" }, want())), 350); }
  addEventListener("resize", () => { layout(); sendCfgSoon(); });

  // ------------------------------------------------------------ mouse (and pen)
  const norm = (e) => {
    const r = cv.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  let moveQ = null;
  function queueMove(p) {
    if (!moveQ) requestAnimationFrame(() => { if (moveQ) send({ t: "m", x: +moveQ.x.toFixed(5), y: +moveQ.y.toFixed(5) }); moveQ = null; });
    moveQ = p;
  }
  const ro = () => !info || info.view_only;
  cv.addEventListener("contextmenu", (e) => e.preventDefault());
  cv.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "touch") return touchDown(e);
    cv.focus();
    if (ro()) return;
    e.preventDefault();
    cv.setPointerCapture(e.pointerId);
    send(Object.assign({ t: "m" }, norm(e)));
    send({ t: "b", b: e.button, d: 1 });
  });
  cv.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch") return touchMove(e);
    if (!ro()) queueMove(norm(e));
    if (e.clientY < 6 && pref.fit) showTb();
  });
  cv.addEventListener("pointerup", (e) => {
    if (e.pointerType === "touch") return touchUp(e);
    if (ro()) return;
    send(Object.assign({ t: "m" }, norm(e)));
    send({ t: "b", b: e.button, d: 0 });
  });
  cv.addEventListener("pointercancel", (e) => { if (e.pointerType === "touch") touchUp(e, true); });
  cv.addEventListener("auxclick", (e) => e.preventDefault());
  let wheelAcc = 0, wheelX = 0, wheelT = 0;
  cv.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (ro()) return;
    const k = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1;
    wheelAcc += e.deltaY * k * 1.2; wheelX += e.deltaX * k * 1.2;
    if (!wheelT) wheelT = setTimeout(() => {
      send({ t: "w", dy: Math.round(wheelAcc), dx: Math.round(wheelX) });
      wheelAcc = wheelX = 0; wheelT = 0;
    }, 16);
  }, { passive: false });

  // ------------------------------------------------------------ touch: trackpad or direct, pinch zoom, two-finger scroll
  const touches = new Map();
  let gest = null;
  function touchDown(e) {
    e.preventDefault();
    cv.setPointerCapture(e.pointerId);
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now() });
    if (touches.size === 1) {
      gest = { kind: "one", moved: false, t0: performance.now(), drag: false, pressed: false };
      if (!ro() && pref.touch === "trackpad") {
        gest.hold = setTimeout(() => { if (gest && !gest.moved) { gest.drag = true; send({ t: "b", b: 0, d: 1 }); navigator.vibrate?.(25); } }, 450);
      } else if (!ro()) {
        gest.press = setTimeout(() => { if (gest && gest.kind === "one") { const t = [...touches.values()][0]; send(Object.assign({ t: "m" }, norm({ clientX: t.x, clientY: t.y }))); send({ t: "b", b: 0, d: 1 }); gest.pressed = true; } }, 70);
      }
    } else if (touches.size === 2) {
      if (gest) { clearTimeout(gest.hold); clearTimeout(gest.press); if (gest.drag || gest.pressed) send({ t: "b", b: 0, d: 0 }); }
      const [a, b] = [...touches.values()];
      gest = { kind: "two", t0: performance.now(), d0: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2,
               z0: view.z, vx0: view.x, vy0: view.y, mode: null, moved: false };
    }
  }
  function touchMove(e) {
    const t = touches.get(e.pointerId);
    if (!t || !gest) return;
    e.preventDefault();
    const dx = e.clientX - t.x, dy = e.clientY - t.y;
    t.x = e.clientX; t.y = e.clientY;
    if (gest.kind === "one") {
      if (Math.hypot(t.x - t.x0, t.y - t.y0) > 7) { gest.moved = true; clearTimeout(gest.hold); }
      if (ro()) return;
      if (pref.touch === "trackpad") {
        const r = cv.getBoundingClientRect(), k = region().w / r.width * view.z;
        const sp = Math.hypot(dx, dy), acc = 1 + Math.min(1.8, sp / 14);
        if (gest.moved || gest.drag) send({ t: "rel", dx: Math.round(dx * k * acc), dy: Math.round(dy * k * acc) });
      } else {
        if (!gest.pressed && gest.moved) { clearTimeout(gest.press); send(Object.assign({ t: "m" }, norm(e))); send({ t: "b", b: 0, d: 1 }); gest.pressed = true; }
        else if (gest.pressed) queueMove(norm(e));
      }
    } else if (gest.kind === "two" && touches.size === 2) {
      const [a, b] = [...touches.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      if (!gest.mode && Math.abs(d - gest.d0) > 24) gest.mode = "zoom";
      if (!gest.mode && Math.hypot(cx - gest.cx, cy - gest.cy) > 10) gest.mode = view.z > 1.02 ? "pan" : "scroll";
      if (gest.mode) gest.moved = true;
      if (gest.mode === "zoom" && pref.fit) {
        const z = Math.min(5, Math.max(1, gest.z0 * d / gest.d0));
        // zoom around the starting midpoint, then follow the fingers
        const r = wrap.getBoundingClientRect(), base = { x: r.left - view.x, y: r.top - view.y };
        const px = (gest.cx - base.x - gest.vx0) / gest.z0, py = (gest.cy - base.y - gest.vy0) / gest.z0;
        view.z = z; view.x = cx - base.x - px * z; view.y = cy - base.y - py * z;
        layout(); sendCfgSoon();
      } else if (gest.mode === "pan") {
        view.x += dx / 2; view.y += dy / 2; layout();
      } else if (gest.mode === "scroll" && !ro()) {
        gest.acc = (gest.acc || 0) - dy * 2.2;
        if (Math.abs(gest.acc) >= 30) { send({ t: "w", dy: Math.round(gest.acc) }); gest.acc = 0; }
      }
    }
  }
  function touchUp(e, cancel) {
    const t = touches.get(e.pointerId);
    touches.delete(e.pointerId);
    if (!gest || !t) return;
    const quick = performance.now() - gest.t0 < 280;
    if (gest.kind === "one" && touches.size === 0) {
      clearTimeout(gest.hold); clearTimeout(gest.press);
      if (!ro() && !cancel) {
        if (gest.drag || gest.pressed) send({ t: "b", b: 0, d: 0 });
        else if (!gest.moved && quick) {
          if (pref.touch === "direct") send(Object.assign({ t: "m" }, norm(e)));
          send({ t: "b", b: 0, d: 1 }); send({ t: "b", b: 0, d: 0 });
        }
      }
      gest = null;
    } else if (gest.kind === "two") {
      if (touches.size === 0) {
        if (!gest.moved && quick && !ro() && !cancel) { send({ t: "b", b: 2, d: 1 }); send({ t: "b", b: 2, d: 0 }); }
        gest = null;
      }
    }
  }

  // ------------------------------------------------------------ keyboard
  const typing = () => { const a = document.activeElement; return a && (a.id === "clipText" || a.id === "nm" || a.tagName === "SELECT"); };
  let pasteWait = 0;
  addEventListener("keydown", (e) => {
    if (!live || typing() || e.target.id === "kbd" || ro()) return;
    if (e.code === "F11" && !e.ctrlKey) return; // let F11 toggle full screen here
    if (e.ctrlKey && e.code === "KeyV" && info.clip_sync) { // paste: send this device's clipboard first
      pasteWait = setTimeout(() => { pasteWait = 0; sendKey("KeyV", 1); sendKey("KeyV", 0); }, 250);
      return;
    }
    if (!e.code) return;
    e.preventDefault();
    sendKey(e.code, 1);
  });
  addEventListener("keyup", (e) => {
    if (!live || typing() || e.target.id === "kbd" || ro()) return;
    if (e.ctrlKey && e.code === "KeyV" && info.clip_sync) return;
    if (!e.code) return;
    e.preventDefault();
    sendKey(e.code, 0);
  });
  addEventListener("paste", (e) => {
    if (!live || typing() || ro()) return;
    const text = e.clipboardData && e.clipboardData.getData("text/plain");
    e.preventDefault();
    if (pasteWait) { clearTimeout(pasteWait); pasteWait = 0; }
    if (text) send({ t: "clip", text });
    sendKey("KeyV", 1); sendKey("KeyV", 0);
  });
  function sendKey(code, d) {
    if (d) held.add(code); else held.delete(code);
    send({ t: "k", code, d });
  }
  function releaseHeld() { for (const c of held) send({ t: "k", code: c, d: 0 }); held.clear(); }
  addEventListener("blur", releaseHeld);
  document.addEventListener("visibilitychange", () => { if (document.hidden) releaseHeld(); });

  // phone keyboard: a hidden textarea; read what changed and type it on the PC
  const kbd = $("#kbd"), SENT = "__";
  kbd.value = SENT;
  kbd.addEventListener("input", () => {
    const v = kbd.value;
    if (v.length < SENT.length) for (let i = v.length; i < SENT.length; i++) send({ t: "combo", keys: ["Backspace"] });
    else if (v.startsWith(SENT)) { const s = v.slice(SENT.length); if (s) send({ t: "txt", s }); }
    else send({ t: "txt", s: v.replace(/_/g, "") });
    kbd.value = SENT; kbd.setSelectionRange(SENT.length, SENT.length);
  });
  kbd.addEventListener("keydown", (e) => {
    const map = { Enter: "Enter", Tab: "Tab", Escape: "Escape", ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight", ArrowUp: "ArrowUp", ArrowDown: "ArrowDown" };
    if (map[e.key]) { e.preventDefault(); send({ t: "combo", keys: [map[e.key]] }); }
  });

  // ------------------------------------------------------------ toolbar
  let tuckT = 0;
  function showTb() { $("#tb").classList.remove("tuck"); $("#pull").classList.add("hide"); tuckSoon(); }
  function tuckSoon() {
    clearTimeout(tuckT);
    tuckT = setTimeout(() => {
      if ($("#tb").matches(":hover") || !$("#keys").classList.contains("hide") || !$("#clip").classList.contains("hide")) return tuckSoon();
      $("#tb").classList.add("tuck"); $("#pull").classList.remove("hide");
    }, touchy ? 5000 : 3000);
  }
  $("#tb").addEventListener("pointerenter", () => clearTimeout(tuckT));
  $("#tb").addEventListener("pointerleave", tuckSoon);
  $("#pull").onclick = showTb;
  $("#bTuck").onclick = () => { clearTimeout(tuckT); $("#tb").classList.add("tuck"); $("#pull").classList.remove("hide"); };
  $("#q").value = pref.q;
  $("#q").onchange = (e) => { pref.q = e.target.value; savePref(); send({ t: "cfg", q: pref.q }); };
  $("#mon").onchange = (e) => { pref.mon = +e.target.value; savePref(); view = { z: 1, x: 0, y: 0 }; send(Object.assign({ t: "cfg", mon: pref.mon }, want())); };
  $("#bFit").onclick = () => { pref.fit = !pref.fit; savePref(); view = { z: 1, x: 0, y: 0 }; layout(); send(Object.assign({ t: "cfg" }, want())); };
  $("#bFull").onclick = async () => {
    if (document.fullscreenElement) return document.exitFullscreen();
    try { await document.documentElement.requestFullscreen(); await navigator.keyboard?.lock?.(); } catch (_) { /* keyboard lock needs https */ }
  };
  $("#bKbd").onclick = () => { kbd.focus(); kbd.setSelectionRange(SENT.length, SENT.length); };
  function setTouchLabel() { $("#bTouch").textContent = pref.touch === "trackpad" ? "Trackpad" : "Tap mode"; }
  $("#bTouch").onclick = () => { pref.touch = pref.touch === "trackpad" ? "direct" : "trackpad"; savePref(); setTouchLabel();
    hint(pref.touch === "trackpad" ? "Trackpad: drag moves the pointer, tap clicks" : "Tap mode: tap right where you want to click"); };
  $("#bEnd").onclick = end;
  function end() {
    leaving = true; releaseHeld();
    try { ws && ws.close(); } catch (_) { /* gone */ }
    live = false; cover();
    gate("Disconnected", `<p>You left the session.</p><div class="row"><button class="qt-btn primary" id="re">Connect again</button><button class="qt-btn ghost" id="forget">Forget this PC</button></div>`);
    $("#re").onclick = () => location.reload();
    $("#forget").onclick = () => { localStorage.removeItem(KEY); toast("This device's key is gone. Remove it on the PC too."); setTimeout(() => location.reload(), 900); };
  }

  // keys menu
  const KEYS = [
    ["Windows", [["Start menu", ["MetaLeft"]], ["Switch apps", ["AltLeft", "Tab"], "Alt+Tab"], ["Show desktop", ["MetaLeft", "KeyD"], "Win+D"],
      ["File Explorer", ["MetaLeft", "KeyE"], "Win+E"], ["Run", ["MetaLeft", "KeyR"], "Win+R"], ["Task Manager", ["ControlLeft", "ShiftLeft", "Escape"], "Ctrl+Shift+Esc"],
      ["Close window", ["AltLeft", "F4"], "Alt+F4"], ["Snip screen", ["MetaLeft", "ShiftLeft", "KeyS"], "Win+Shift+S"], ["Settings", ["MetaLeft", "KeyI"], "Win+I"]]],
    ["Edit", [["Copy", ["ControlLeft", "KeyC"], "Ctrl+C"], ["Paste", ["ControlLeft", "KeyV"], "Ctrl+V"], ["Cut", ["ControlLeft", "KeyX"], "Ctrl+X"],
      ["Undo", ["ControlLeft", "KeyZ"], "Ctrl+Z"], ["Select all", ["ControlLeft", "KeyA"], "Ctrl+A"], ["Save", ["ControlLeft", "KeyS"], "Ctrl+S"]]],
    ["Keys", [["Esc", ["Escape"]], ["Tab", ["Tab"]], ["Enter", ["Enter"]], ["Backspace", ["Backspace"]], ["Delete", ["Delete"]],
      ["Left", ["ArrowLeft"]], ["Right", ["ArrowRight"]], ["Up", ["ArrowUp"]], ["Down", ["ArrowDown"]], ["Home", ["Home"]], ["End", ["End"]],
      ["Page up", ["PageUp"]], ["Page down", ["PageDown"]], ["Print Screen", ["PrintScreen"]]]],
    ["F keys", Array.from({ length: 12 }, (_, i) => [`F${i + 1}`, [`F${i + 1}`]])],
    ["Media", [["Play / pause", ["MediaPlayPause"]], ["Next track", ["MediaTrackNext"]], ["Volume up", ["AudioVolumeUp"]], ["Volume down", ["AudioVolumeDown"]], ["Mute", ["AudioVolumeMute"]]]],
  ];
  $("#keys").innerHTML = KEYS.map(([hd, items]) => `<div class="hd">${hd}</div>` + items.map(([l, k, kb], i) =>
    `<button role="menuitem" data-k='${JSON.stringify(k)}'>${esc(l)}${kb ? `<kbd>${esc(kb)}</kbd>` : ""}</button>`).join("")).join("") +
    `<div class="hd">Ctrl+Alt+Del</div><p class="small qt-muted" style="margin:2px 10px 8px">Windows only accepts it from a real keyboard. Use Task Manager above, or lock the PC from its Start menu.</p>`;
  function openMenu(btn, menu) {
    const open = menu.classList.contains("hide");
    for (const m of document.querySelectorAll(".menu, .panel")) m.classList.add("hide");
    if (!open) return;
    menu.classList.remove("hide");
    const r = btn.getBoundingClientRect();
    if (menu.classList.contains("menu")) {
      menu.style.left = Math.max(8, Math.min(innerWidth - menu.offsetWidth - 8, r.left)) + "px";
      menu.style.top = r.bottom + 8 + "px";
    }
  }
  $("#bKeys").onclick = () => openMenu($("#bKeys"), $("#keys"));
  $("#keys").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-k]");
    if (!b) return;
    send({ t: "combo", keys: JSON.parse(b.dataset.k) });
    $("#keys").classList.add("hide");
    cv.focus();
  });
  document.addEventListener("pointerdown", (e) => {
    if (!e.target.closest(".menu, .panel, .tb")) for (const m of document.querySelectorAll(".menu, .panel")) m.classList.add("hide");
  }, true);

  // clipboard panel
  $("#bClip").onclick = () => openMenu($("#bClip"), $("#clip"));
  $("#clipX").onclick = () => $("#clip").classList.add("hide");
  $("#clipSend").onclick = () => { const t = $("#clipText").value; if (!t) return; send({ t: "clip", text: t }); toast("On the PC's clipboard"); };
  $("#clipCopy").onclick = () => { if (lastPcClip) copyLocal(lastPcClip); };
  $("#clipCopy").disabled = true;
  async function copyLocal(text) {
    try { await navigator.clipboard.writeText(text); }
    catch (_) {
      const t = document.createElement("textarea"); t.value = text; t.style.position = "fixed"; t.style.opacity = "0";
      document.body.append(t); t.select(); document.execCommand("copy"); t.remove();
    }
    $("#clipText").value = text;
    toast("Copied on this device");
  }

  // files
  $("#bFile").onclick = () => $("#file").click();
  $("#file").onchange = (e) => { upload([...e.target.files]); e.target.value = ""; };
  let dragN = 0;
  addEventListener("dragenter", (e) => { if (live && info.files && e.dataTransfer.types.includes("Files")) { dragN++; $("#drop").classList.remove("hide"); } });
  addEventListener("dragleave", () => { if (--dragN <= 0) { dragN = 0; $("#drop").classList.add("hide"); } });
  addEventListener("dragover", (e) => { if (live) e.preventDefault(); });
  addEventListener("drop", (e) => { e.preventDefault(); dragN = 0; $("#drop").classList.add("hide"); if (live && info.files) upload([...e.dataTransfer.files]); });
  async function upload(files) {
    for (const f of files) {
      const t = toast(`Sending ${f.name}... 0%`, { ms: 600000 });
      const ok = await new Promise((res) => {
        const x = new XMLHttpRequest();
        x.open("POST", `/api/upload?name=${encodeURIComponent(f.name)}`);
        x.setRequestHeader("X-Remote-Key", localStorage.getItem(KEY) || "");
        x.upload.onprogress = (ev) => { if (ev.lengthComputable) t.firstChild.textContent = `Sending ${f.name}... ${Math.round(ev.loaded / ev.total * 100)}%`; };
        x.onload = () => res(x.status === 200 ? JSON.parse(x.responseText) : null);
        x.onerror = () => res(null);
        x.send(f);
      });
      t.remove();
      if (ok) toast(`${ok.name} is in Downloads\\From Remote on the PC`); else toast(`${f.name} didn't send`, { bad: true });
    }
  }

  // other devices asking to pair (only shown to devices that can control)
  function renderAsks(list) {
    $("#asks").innerHTML = list.map((p) => `<div class="card qt-card"><div class="grow"><b>${esc(p.name)}</b> wants to pair
      <div class="small qt-muted">${esc(p.device)} · check its screen shows</div></div><span class="code-big">${esc(p.code.slice(0, 3))} ${esc(p.code.slice(3))}</span>
      <div class="row"><button class="qt-btn primary" data-a="${p.id}" data-how="allow">Allow</button><button class="qt-btn" data-a="${p.id}" data-how="view">View only</button>
      <button class="qt-btn danger" data-a="${p.id}" data-how="deny">No</button></div></div>`).join("");
  }
  $("#asks").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-a]");
    if (!b) return;
    send({ t: "approve", id: b.dataset.a, how: b.dataset.how });
    b.closest(".card").remove();
  });

  // hint + stats
  let hintT = 0;
  function hint(text) {
    const h = $("#hint"); h.textContent = text; h.classList.remove("hide"); h.style.opacity = 1;
    clearTimeout(hintT); hintT = setTimeout(() => { h.style.opacity = 0; setTimeout(() => h.classList.add("hide"), 1000); }, 5000);
  }
  setInterval(() => {
    if (!live) return;
    const s = (performance.now() - st.t0) / 1000;
    $("#stat").textContent = `${Math.round(st.frames / s)} fps · ${Math.round(st.bytes * 8 / s / 1000)} kb/s${st.rtt ? ` · ${st.rtt} ms` : ""}`;
    st.frames = 0; st.bytes = 0; st.t0 = performance.now();
    send({ t: "ping", ts: performance.now() });
  }, 2000);

  window.qtRemote = { state: () => ({ live, info, view, pref, w: cv.width, h: cv.height }) }; // for tests
  start();
})();
