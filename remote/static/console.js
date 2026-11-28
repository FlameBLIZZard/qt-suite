// QT Remote console: runs on this PC (inside QT Suite). Talks only to /api/local/*.
(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ICON = {
    windows: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
    android: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"><rect x="6" y="2.5" width="12" height="19" rx="3"/><path d="M11 18.5h2"/></svg>',
    ios: null, macos: null, linux: null,
  };
  ICON.ios = ICON.android; ICON.macos = ICON.windows; ICON.linux = ICON.windows;
  const icon = (os) => ICON[(os || "").toLowerCase()] || ICON.windows;
  let state = null, lastSig = "", qrFor = "";

  function toast(msg, bad) {
    const t = document.createElement("div");
    t.className = "qt-toast" + (bad ? " bad" : "");
    t.textContent = msg;
    $("#toasts").append(t);
    setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 350); }, 3200);
  }
  async function post(path, body) {
    const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || r.statusText);
    return d;
  }
  const ago = (ts) => {
    if (!ts) return "never";
    const s = Date.now() / 1000 - ts;
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + " min ago";
    if (s < 86400) return Math.floor(s / 3600) + " h ago";
    return Math.floor(s / 86400) + " d ago";
  };
  const when = (ts) => new Date(ts * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  function drawQR(text) {
    if (qrFor === text || typeof qrcode !== "function") return;
    qrFor = text;
    const box = $("#qr");
    box.innerHTML = "";
    if (!text) return;
    const qr = qrcode(0, "M");
    qr.addData(text); qr.make();
    const n = qr.getModuleCount(), px = 6, size = (n + 4) * px;
    const cv = document.createElement("canvas");
    cv.width = cv.height = size;
    const g = cv.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, size, size); g.fillStyle = "#16141a";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) g.fillRect((c + 2) * px, (r + 2) * px, px, px);
    box.append(cv);
  }

  const SETTINGS = [
    ["same_user", "Only my own Tailscale account", "Devices signed in to someone else's Tailscale account are refused, even if your tailnet is shared."],
    ["ask_each_time", "Ask on this PC every time", "Even trusted devices wait for you to press Allow here. Leave off if you want to connect while away."],
    ["clip_sync", "Share the clipboard", "Copied text goes both ways while connected. Passwords copied from password managers never cross."],
    ["files", "Allow sending files", "Devices can drop files onto the screen; they land in Downloads\\From Remote."],
    ["allow_lan", "Also allow plain Wi-Fi (not encrypted)", "Lets devices on your home network connect without Tailscale. Traffic is NOT encrypted. Keep off unless you need it."],
  ];

  function render(s) {
    state = s;
    const sig = JSON.stringify([s.settings, s.devices, s.pending, s.sessions.map((x) => [x.id, x.view_only]), s.addresses, s.self, s.log.length, s.log[0] && s.log[0].ts, s.autostart]);
    // pending countdown updates every poll; the rest only when it changed
    $("#enabled").setAttribute("aria-checked", String(!!s.settings.enabled));
    $("#masterNote").textContent = s.settings.enabled ? (s.sessions.length ? `${s.sessions.length} connected now` : "Only paired devices on your Tailscale")
      : "Off: nobody can connect or pair";
    const pc = $("#pendingCard");
    pc.classList.toggle("hide", !s.pending.length);
    $("#pending").innerHTML = s.pending.map((p) => `
      <div class="item"><div class="ico">${icon(p.os)}</div>
        <div class="grow"><div class="name">${esc(p.name)}</div><div class="meta">${esc(p.device)}${p.login ? " · " + esc(p.login) : ""} · ${p.kind === "lan" ? '<span class="bad">plain Wi-Fi</span>' : "Tailscale"} · ${p.left}s left</div></div>
        <span class="code-big">${esc(p.code.slice(0, 3))} ${esc(p.code.slice(3))}</span>
      </div>
      <div class="row"><button class="qt-btn primary" data-p="${p.id}" data-how="allow">Allow control</button>
        <button class="qt-btn" data-p="${p.id}" data-how="view">View only</button>
        <button class="qt-btn danger" data-p="${p.id}" data-how="deny">Don't allow</button></div>`).join("");
    if (sig === lastSig) return;
    lastSig = sig;

    $("#sessCard").classList.toggle("hide", !s.sessions.length);
    $("#sessions").innerHTML = s.sessions.map((x) => `
      <div class="item"><span class="qt-dot on"></span>
        <div class="grow"><div class="name">${esc(x.name)} ${x.view_only ? '<span class="qt-chip">view only</span>' : '<span class="qt-chip">controlling</span>'}</div>
        <div class="meta">${esc(x.device)} · since ${when(x.since)} · ${x.mb} MB sent</div></div>
        <button class="qt-btn danger" data-end="${x.id}">End</button></div>`).join("");

    const me = s.self || {};
    $("#addrs").innerHTML = s.addresses.length ? s.addresses.map((a) => `<div class="addr"><code title="${esc(a)}">${esc(a)}</code><button class="qt-btn" data-copy="${esc(a)}">Copy</button></div>`).join("")
      : `<div class="empty">No Tailscale address yet. Start Tailscale on this PC and sign in.</div>`;
    drawQR(s.addresses[1] || s.addresses[0] || "");
    const tsOk = me.installed && me.running && me.ip;
    $("#tsText").innerHTML = !me.installed ? '<span class="bad">Tailscale is not installed on this PC.</span> Get it from tailscale.com, sign in, then come back.'
      : !tsOk ? '<span class="warn">Tailscale is installed but not connected.</span> Open it and sign in.'
        : `Encrypted end to end by Tailscale (WireGuard). Signed in as <b>${esc(me.login)}</b>, this PC is <b>${esc(me.ip)}</b>. Nothing is open to the internet or your Wi-Fi.`;
    $("#sub").textContent = `${s.pc} · ${s.bound.length ? "listening on " + s.bound.join(", ") : "not listening"} · port ${s.port}`;

    $("#devices").innerHTML = s.devices.length ? s.devices.map((d) => `
      <div class="item"><div class="ico">${icon(d.os)}</div>
        <div class="grow"><div class="name">${esc(d.name)}</div>
        <div class="meta">${esc(d.node_name)}${d.login ? " · " + esc(d.login) : ""} · paired ${when(d.added)} · last used ${ago(d.last)}</div></div>
        <label class="small qt-muted" style="display:flex;gap:6px;align-items:center">View only
          <button class="qt-switch" role="switch" aria-checked="${!!d.view_only}" data-vo="${d.id}" aria-label="View only for ${esc(d.name)}"></button></label>
        <button class="qt-btn ghost" data-rm="${d.id}" title="Remove ${esc(d.name)}">Remove</button></div>`).join("")
      : `<div class="empty">None yet. Pair a device with the steps on the left.</div>`;

    $("#settings").innerHTML = SETTINGS.map(([k, t, d]) => `
      <div class="set"><div class="grow"><div class="t">${t}</div><div class="d">${d}</div></div>
        <button class="qt-switch" role="switch" data-set="${k}" aria-checked="${!!s.settings[k]}" aria-label="${esc(t)}"></button></div>`).join("") + `
      <div class="set"><div class="grow"><div class="t">Start Remote when I sign in</div><div class="d">So you can reach this PC from elsewhere even if QT Suite isn't open. The PC must be on, awake and unlocked.</div></div>
        <button class="qt-switch" role="switch" id="autostart" aria-checked="${!!s.autostart}" aria-label="Start Remote when I sign in"></button></div>`;

    $("#log").innerHTML = s.log.length ? s.log.map((l) => `<div><time>${when(l.ts)}</time><span class="k">${esc(l.kind)}</span><span>${esc(l.text)}</span></div>`).join("")
      : `<div class="empty">Nothing yet.</div>`;
  }

  async function refresh() {
    try {
      const r = await fetch("/api/local/state");
      if (r.ok) render(await r.json());
    } catch (_) { /* hub shows its own offline cover */ }
  }

  async function peers() {
    const box = $("#peers");
    try {
      const ps = await (await fetch("/api/local/peers")).json();
      box.innerHTML = ps.length ? ps.map((p) => {
        const url = `http://${p.ip}:${state ? state.port : 7802}/`;
        return `<div class="item"><div class="ico">${icon(p.os)}</div>
          <div class="grow"><div class="name">${esc(p.name)}</div><div class="meta"><span class="qt-dot ${p.online ? "on" : ""}" style="display:inline-block;vertical-align:-1px"></span>
          ${p.online ? "online" : "offline"} · ${esc(p.os || "device")} · ${esc(p.ip)}${p.online && !p.remote ? " · no QT Remote there" : ""}</div></div>
          ${p.remote ? `<button class="qt-btn primary" data-open="${esc(url)}">Open</button>` : ""}</div>`;
      }).join("") : `<div class="empty">No other devices on your Tailscale yet.</div>`;
    } catch (_) { box.innerHTML = `<div class="empty">Couldn't ask Tailscale.</div>`; }
  }

  document.addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    try {
      if (b.id === "enabled") { await post("/api/local/settings", { enabled: b.getAttribute("aria-checked") !== "true" }); }
      else if (b.dataset.set) {
        const k = b.dataset.set, on = b.getAttribute("aria-checked") !== "true";
        if (k === "allow_lan" && on && !confirm("Plain Wi-Fi connections are not encrypted, and anyone on your network could try to pair. Turn it on anyway?")) return;
        await post("/api/local/settings", { [k]: on });
      }
      else if (b.id === "autostart") { await post("/api/local/autostart", { on: b.getAttribute("aria-checked") !== "true" }); }
      else if (b.dataset.p) { await post(`/api/local/pending/${b.dataset.p}/${b.dataset.how}`); toast(b.dataset.how === "deny" ? "Refused" : "Paired. That device can connect now."); }
      else if (b.dataset.end) { await post(`/api/local/end/${b.dataset.end}`); toast("Session ended"); }
      else if (b.id === "endAll") { await post("/api/local/end/all"); toast("All sessions ended"); }
      else if (b.dataset.vo) { await post(`/api/local/device/${b.dataset.vo}/viewonly`, { on: b.getAttribute("aria-checked") !== "true" }); }
      else if (b.dataset.rm) {
        if (!confirm("Remove this device? It will need to pair again to connect.")) return;
        await post(`/api/local/device/${b.dataset.rm}/remove`); toast("Removed");
      }
      else if (b.dataset.copy) {
        const t = document.createElement("textarea"); t.value = b.dataset.copy; document.body.append(t); t.select();
        try { await navigator.clipboard.writeText(b.dataset.copy); } catch (_) { document.execCommand("copy"); }
        t.remove(); toast("Copied");
      }
      else if (b.dataset.open) { await post("/api/local/open", { url: b.dataset.open }); toast("Opening..."); }
      else if (b.id === "rescan") { $("#peers").innerHTML = `<div class="empty"><span class="spin"></span> Looking...</div>`; await peers(); }
      else if (b.id === "testPrompt") { await post("/api/local/test-prompt"); toast("Look at the middle of the screen"); }
      else return;
      lastSig = "";
      refresh();
    } catch (err) { toast(err.message || "That didn't work", true); }
  });

  refresh();
  peers();
  setInterval(refresh, 2000);
  setInterval(peers, 30000);
})();
