/* Ping - the phone's notifications on the PC. Server: beam/ping.py. Phone: PingListener.java. */
(function () {
  const $ = id => document.getElementById(id);
  const S = { v: -1, notes: [], phone: {}, settings: { mute: {}, toast: true }, pending: [] };
  const ui = { filter: "live", app: "", q: "", open: null, drafts: {}, nodes: new Map(), first: true, expanded: new Set() };
  const ICON = {
    x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    reply: '<svg viewBox="0 0 24 24"><path d="M10 8 4 13l6 5"/><path d="M4 13h10a6 6 0 0 1 6 6"/></svg>',
    send: '<svg viewBox="0 0 24 24"><path d="M4 12 20 4l-6 16-3-7z"/></svg>',
    bell: '<svg viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>',
    bellOff: '<svg viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 0 1 9.5-4.9M18 11v5l2 2H8"/><path d="M10 20a2 2 0 0 0 4 0M4 4l16 16"/></svg>',
    open: '<svg viewBox="0 0 24 24"><rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/></svg>',
    copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>',
    all: '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
  };
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  function hi(s) {
    const e = esc(s);
    if (!ui.q) return e;
    const qq = esc(ui.q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return e.replace(new RegExp(qq, "gi"), m => `<mark>${m}</mark>`);
  }
  function ago(ms) {
    const s = Math.round((Date.now() - ms) / 1000);
    if (s < 45) return "now";
    if (s < 3600) return Math.round(s / 60) + "m";
    if (s < 86400) return Math.round(s / 3600) + "h";
    return new Date(ms).toLocaleDateString([], { day: "numeric", month: "short" });
  }
  const clock = ms => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  function dayLabel(ms) {
    const d = new Date(ms), t = new Date();
    const key = x => x.toDateString();
    if (key(d) === key(t)) return "Today";
    t.setDate(t.getDate() - 1);
    if (key(d) === key(t)) return "Yesterday";
    return d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" });
  }
  function hue(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
  function iconHtml(n, big) {
    const letter = esc((n.app || n.pkg || "?").trim().charAt(0).toUpperCase());
    return `<span class="ico${big ? " big" : ""}" style="background-color:hsl(${hue(n.pkg)} 85% 70%);background-image:url('/api/notify/icon/${encodeURIComponent(n.pkg)}?v=${S.iconV || 0}')">${letter}</span>`;
  }

  async function api(path, body, method) {
    const r = await fetch("/api/notify" + path, {
      method: method || (body ? "POST" : "GET"), credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Beam said " + r.status);
    return j;
  }
  let toastT;
  function toast(msg, bad) {
    const t = $("toast");
    t.textContent = msg;
    t.className = "toast" + (bad ? " bad" : "");
    t.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(() => (t.hidden = true), 2600);
  }

  // ---------------------------------------------------------------- data loop
  async function loop() {
    for (;;) {
      try {
        const d = await api(`?v=${S.v}&wait=${ui.first ? 0 : 25}`);
        const before = new Set(S.notes.map(n => n.key + n.when));
        const fresh = d.notes.filter(n => n.live && !n.seen && !before.has(n.key + n.when));
        Object.assign(S, d);
        if (!ui.first && fresh.length) ring();
        ui.first = false;
        render();
      } catch (e) {
        setStatus("bad", "Beam isn't answering. Is it running?");
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  }
  function ring() {
    const b = $("bell");
    b.classList.remove("ring");
    void b.offsetWidth;
    b.classList.add("ring");
  }

  // ---------------------------------------------------------------- render
  function setStatus(cls, text) {
    $("status").className = "status " + cls;
    $("statusText").textContent = text;
  }
  function visible() {
    const q = ui.q.toLowerCase();
    return S.notes.filter(n => {
      if (ui.filter === "live" && !n.live) return false;
      if (ui.app && n.pkg !== ui.app) return false;
      if (S.settings.mute[n.pkg] && ui.app !== n.pkg) return false;
      if (q) {
        const hay = [n.app, n.title, n.text, n.sub, ...(n.lines || []), ...(n.msgs || []).map(m => m.who + " " + m.text)].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }
  function render() {
    const p = S.phone || {};
    if (p.online) setStatus(p.access === false ? "warn" : "live", (p.device || "Phone") + (p.access === false ? " · notification access is off" : " · live"));
    else if (p.seenAgo != null) setStatus("warn", (p.device || "Phone") + " · last seen " + ago(Date.now() - p.seenAgo * 1000) + " ago");
    else setStatus("", "Phone not connected yet");
    $("setup").hidden = !!(p.seenAgo != null || S.notes.length);
    const off = !p.online && p.seenAgo != null;
    $("offline").hidden = !off;
    if (off) $("offlineText").textContent = `Last heard from ${p.device || "your phone"} ${ago(Date.now() - p.seenAgo * 1000)} ago, so this list may be out of date. Away from home Wi-Fi? Turn on Tailscale on the phone.`;
    $("feed").querySelectorAll(".skel").forEach(x => x.remove());
    const unseen = S.notes.filter(n => n.live && !n.seen && !S.settings.mute[n.pkg]).length;
    $("bellCount").hidden = !unseen;
    const label = unseen > 99 ? "99+" : String(unseen);
    if ($("bellCount").textContent !== label) {
      $("bellCount").textContent = label;
      $("bellCount").classList.remove("bump"); void $("bellCount").offsetWidth; $("bellCount").classList.add("bump");
    }
    document.title = (unseen ? `(${unseen}) ` : "") + "Ping · phone notifications";
    $("toastBtn").innerHTML = (S.settings.toast ? ICON.bell : ICON.bellOff) + (S.settings.toast ? "Pop-ups on" : "Pop-ups off");
    $("toastBtn").classList.toggle("on", !!S.settings.toast);
    const snoozed = (S.settings.snooze || 0) * 1000 > Date.now();
    $("snoozeBtn").hidden = !S.settings.toast;
    $("snoozeBtn").textContent = snoozed ? "Quiet until " + clock(S.settings.snooze * 1000) : "Quiet 1h";
    $("snoozeBtn").classList.toggle("on", snoozed);
    $("nLive").textContent = S.notes.filter(n => n.live && !S.settings.mute[n.pkg]).length;
    $("nAll").textContent = S.notes.length;
    renderApps();
    renderFeed();
  }

  function renderApps() {
    const apps = new Map();
    for (const n of S.notes) {
      if (ui.filter === "live" && !n.live) continue;
      const a = apps.get(n.pkg) || { pkg: n.pkg, app: n.app || n.pkg, n: 0, unseen: 0, last: 0, sample: n };
      a.n++;
      if (!n.seen && n.live) a.unseen++;
      a.last = Math.max(a.last, n.when);
      apps.set(n.pkg, a);
    }
    for (const pkg of Object.keys(S.settings.mute)) if (!apps.has(pkg)) {
      const s = S.notes.find(n => n.pkg === pkg);
      if (s) apps.set(pkg, { pkg, app: s.app, n: 0, unseen: 0, last: 0, sample: s });
    }
    const list = [...apps.values()].sort((a, b) => b.last - a.last);
    const total = list.reduce((s, a) => s + (S.settings.mute[a.pkg] ? 0 : a.n), 0);
    $("appList").innerHTML =
      `<button class="app${ui.app ? "" : " on"}" data-app=""><span class="ico all">${ICON.all}</span><span class="nm">All apps</span><span class="ct">${total}</span></button>` +
      list.map(a => {
        const m = !!S.settings.mute[a.pkg];
        return `<button class="app${ui.app === a.pkg ? " on" : ""}${m ? " muted" : ""}" data-app="${esc(a.pkg)}" title="${esc(a.pkg)}">${iconHtml(a.sample)}
          <span class="nm">${esc(a.app)}</span><span class="ct${a.unseen && !m ? " new" : ""}">${a.n}</span>
          <span class="mute" data-mute="${esc(a.pkg)}" title="${m ? "Unmute" : "Mute"} ${esc(a.app)}">${m ? ICON.bellOff : ICON.bell}</span></button>`;
      }).join("");
  }

  function sig(n) {
    return JSON.stringify([n.when, n.title, n.text, n.msgs, n.sent, n.live, n.seen, n.actions, n.reply, n.progress, ui.q, S.iconV, ui.open === n.key, ui.expanded.has(n.key)]);
  }
  function otp(n) {
    const t = [n.title, n.text, ...(n.msgs || []).slice(-1).map(m => m.text)].join(" ");
    if (!/\b(otp|code|passcode|verification|verify|pin|one[- ]time|login)\b/i.test(t)) return "";
    const m = t.match(/(?<![\d₹$.,])\b(\d{4,8})\b(?![.,]\d)/);
    return m ? m[1] : "";
  }
  const QUICK = ["On my way", "Call you in a bit", "Okay 👍", "Can't talk now, will text later"];
  function noteHtml(n) {
    const msgs = (n.msgs || []).slice(ui.expanded.has(n.key) ? -30 : -6);
    const more = (n.msgs || []).length - msgs.length;
    const sent = n.sent || [];
    let body = "";
    if (n.pic) body += `<img class="pic" src="${esc(n.pic)}" alt="" onerror="this.remove()">`;
    if (n.title) body += `<div class="ttl">${hi(n.title)}</div>`;
    if (msgs.length > 1 || sent.length) {
      body += `<div class="msgs">` + (more > 0 ? `<button class="more" data-do="more">${more} earlier message${more > 1 ? "s" : ""}</button>` : "") + msgs.map(m => `<div class="msg">${m.who && m.who !== n.title ? `<i>${esc(m.who)}</i>` : ""}${hi(m.text)}</div>`).join("") +
        sent.map(s => `<div class="msg me ${esc(s.state || "queued")}">${esc(s.text)}<span class="st">${s.state === "ok" ? "Sent · " + clock(s.at) : s.state === "failed" ? "Not sent: " + esc(s.error || "") : "Sending…"}</span></div>`).join("") + `</div>`;
    } else {
      const text = n.lines && n.lines.length ? n.lines.join("\n") : n.text;
      if (text) body += `<div class="txt clamp">${hi(text)}</div>`;
    }
    if (n.progress && n.progress[1] > 0) body += `<div class="prog"><i style="width:${Math.min(100, 100 * n.progress[0] / n.progress[1])}%"></i></div>`;
    const acts = [];
    const code = otp(n);
    if (code) acts.push(`<button class="btn sm code" data-do="copy" data-code="${esc(code)}" title="Copy to the PC clipboard">${ICON.copy}Copy ${esc(code)}</button>`);
    if (n.live && n.reply) acts.push(`<button class="btn sm primary" data-do="compose">${ICON.reply}${esc(n.replyLabel || "Reply")}</button>`);
    if (n.live) (n.actions || []).forEach((a, i) => acts.push(`<button class="btn sm" data-do="action" data-idx="${i}">${esc(a)}</button>`));
    if (n.live) acts.push(`<button class="btn sm ghost" data-do="open" title="Open it on the phone">${ICON.open}Open on phone</button>`);
    const tag = !n.live ? `<span class="tag">gone</span>` : n.quiet ? `<span class="tag" title="Silent on the phone, so no pop-up here">silent</span>` : "";
    return `${iconHtml(n, true)}
      <div class="top"><b>${esc(n.app || n.pkg)}</b>${n.sub ? `<span>${esc(n.sub)}</span>` : ""}<span class="when" title="${new Date(n.when).toLocaleString()}">${ago(n.when)}</span>${tag}</div>
      ${n.live && n.clearable ? `<button class="x" data-do="dismiss" title="Dismiss on the phone">${ICON.x}</button>` : ""}
      <div class="body">${body}</div>
      ${acts.length ? `<div class="acts">${acts.join("")}</div>` : ""}
      ${ui.open === n.key ? `<div class="compose"><textarea rows="1" placeholder="Reply to ${esc(n.title || n.app)}…  (Enter sends, Shift+Enter new line)"></textarea><button class="btn primary" data-do="send">${ICON.send}Send</button></div>
        <div class="quick">${QUICK.map(q => `<button class="chip" data-do="quick">${esc(q)}</button>`).join("")}</div>` : ""}`;
  }

  function renderFeed() {
    const feed = $("feed");
    const list = visible();
    const keep = new Set(list.map(n => n.key));
    const motion = ui.firstPaintDone && !matchMedia("(prefers-reduced-motion: reduce)").matches;
    const before = new Map();
    if (motion) for (const [k, el] of ui.nodes) before.set(k, el.getBoundingClientRect().top);
    for (const [k, el] of ui.nodes) if (!keep.has(k)) {
      ui.nodes.delete(k);
      if (!motion) { el.remove(); continue; }
      // fly out from where it is, without holding up the layout
      const r = el.getBoundingClientRect(), fr = feed.getBoundingClientRect();
      Object.assign(el.style, { position: "absolute", top: r.top - fr.top + "px", left: "0", right: "0", margin: "0" });
      el.classList.add("leaving");
      setTimeout(() => el.remove(), 360);
    }
    feed.querySelectorAll(".day").forEach(d => d.remove());
    let prevDay = "", anchor = null;
    for (const n of list) {
      const day = dayLabel(n.when);
      if (day !== prevDay) {
        prevDay = day;
        const d = document.createElement("div");
        d.className = "day";
        d.textContent = day;
        anchor ? anchor.after(d) : feed.prepend(d);
        anchor = d;
      }
      let el = ui.nodes.get(n.key);
      const s = sig(n);
      if (!el) {
        el = document.createElement("article");
        el.dataset.key = n.key;
        if (!ui.firstPaintDone) el.style.animationDelay = Math.min(ui.nodes.size * 30, 300) + "ms";
        el.classList.add("enter");
        ui.nodes.set(n.key, el);
      }
      if (el._sig !== s) {
        const ta = el.querySelector("textarea");
        if (ta) ui.drafts[n.key] = ta.value;
        el.innerHTML = noteHtml(n);
        el._sig = s;
        const nta = el.querySelector("textarea");
        if (nta) { nta.value = ui.drafts[n.key] || ""; grow(nta); }
      }
      el.className = "note" + (n.live ? "" : " gone") + (!n.seen && n.live ? " unseen" : "") + (el.classList.contains("enter") ? " enter" : "");
      if (anchor ? anchor.nextSibling !== el : feed.firstChild !== el) anchor ? anchor.after(el) : feed.prepend(el);
      anchor = el;
    }
    if (motion) for (const [k, el] of ui.nodes) {
      const was = before.get(k);
      if (was == null) continue;
      const dy = was - el.getBoundingClientRect().top;
      if (Math.abs(dy) < 2) continue;
      el.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 420, easing: "cubic-bezier(.34,1.56,.5,1)" });
    }
    ui.firstPaintDone = true;
    const empty = !list.length;
    $("empty").hidden = !empty;
    if (empty) {
      $("emptyTitle").textContent = ui.q ? "Nothing matches" : ui.app ? "Nothing from this app" : "All quiet";
      $("emptyText").textContent = ui.q ? `No notification has "${ui.q}".` : ui.filter === "live" ? "New phone notifications land here." : "No notifications yet.";
    }
  }
  function grow(ta) { ta.style.height = "auto"; ta.style.height = Math.min(160, ta.scrollHeight + 4) + "px"; }

  // ---------------------------------------------------------------- actions
  const byKey = k => S.notes.find(n => n.key === k);
  async function run(op, key, extra, okMsg) {
    try {
      const { id, offline } = await api("/" + op, Object.assign({ key }, extra || {}));
      if (offline) toast("Your phone is offline. Ping keeps trying for a minute.", true);
      watch(id, okMsg);
    } catch (e) { toast(e.message, true); }
  }
  async function watch(id, okMsg) {
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, i < 5 ? 300 : 1000));
      const r = await api("/cmd/" + id).catch(() => null);
      if (!r) continue;
      if (r.state === "ok") { if (okMsg) toast(okMsg); return; }
      if (r.state === "failed") { toast(r.error || "The phone couldn't do that.", true); return; }
    }
  }
  function send(key, el) {
    const ta = el.querySelector("textarea");
    const text = (ta && ta.value || "").trim();
    if (!text) { if (ta) { ta.classList.remove("shake"); void ta.offsetWidth; ta.classList.add("shake"); } return; }
    const btn = el.querySelector('[data-do="send"]');
    if (btn) {
      const r = btn.getBoundingClientRect(), p = document.createElement("div");
      p.className = "plane"; p.innerHTML = ICON.send;
      Object.assign(p.style, { left: r.left + 14 + "px", top: r.top + r.height / 2 - 10 + "px" });
      document.body.append(p);
      setTimeout(() => p.remove(), 700);
    }
    ui.drafts[key] = "";
    ui.open = null;
    run("reply", key, { text }, "Reply sent from your phone");
  }

  $("feed").addEventListener("click", e => {
    const b = e.target.closest("[data-do]");
    const el = e.target.closest(".note");
    if (!el) return;
    const key = el.dataset.key;
    if (!b) {
      const n = byKey(key);
      if (n && !n.seen) api("/seen", { keys: [key] }).catch(() => {});
      return;
    }
    const n = byKey(key);
    const op = b.dataset.do;
    if (op === "compose") {
      ui.open = ui.open === key ? null : key;
      render();
      const ta = el.querySelector("textarea");
      if (ta) ta.focus();
    } else if (op === "send") send(key, el);
    else if (op === "more") { ui.expanded.add(key); render(); }
    else if (op === "quick") { el.querySelector("textarea").value = b.textContent; send(key, el); }
    else if (op === "copy") {
      const c = b.dataset.code;
      (navigator.clipboard ? navigator.clipboard.writeText(c) : Promise.reject()).catch(() => {
        const t = document.createElement("textarea"); t.value = c; document.body.append(t); t.select(); document.execCommand("copy"); t.remove();
      }).finally(() => { b.classList.add("did"); toast(`Copied ${c}`); });
    }
    else if (op === "dismiss") {
      el.classList.add("leaving");
      run("dismiss", key);
    } else if (op === "action") run("action", key, { idx: +b.dataset.idx, label: b.textContent }, `"${b.textContent.trim()}" done on your phone`);
    else if (op === "open") run("open", key, null, `Opened ${n ? n.app : "it"} on your phone`);
  });
  $("feed").addEventListener("keydown", e => {
    if (e.target.tagName !== "TEXTAREA") return;
    const el = e.target.closest(".note");
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(el.dataset.key, el); }
    if (e.key === "Escape") { ui.open = null; render(); }
  });
  $("feed").addEventListener("input", e => {
    if (e.target.tagName !== "TEXTAREA") return;
    ui.drafts[e.target.closest(".note").dataset.key] = e.target.value;
    grow(e.target);
  });
  $("appList").addEventListener("click", e => {
    const m = e.target.closest("[data-mute]");
    if (m) {
      e.stopPropagation();
      const pkg = m.dataset.mute, on = !S.settings.mute[pkg];
      api("/settings", { mute: { [pkg]: on } }).then(s => { S.settings = s; render(); toast(on ? "Muted. The phone stops sending it." : "Unmuted"); }).catch(err => toast(err.message, true));
      return;
    }
    const a = e.target.closest("[data-app]");
    if (a) { ui.app = a.dataset.app; render(); }
  });
  $("seg").addEventListener("click", e => {
    const b = e.target.closest("button");
    if (!b) return;
    ui.filter = b.dataset.f;
    $("seg").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
    render();
  });
  $("q").addEventListener("input", e => { ui.q = e.target.value.trim(); render(); });
  $("toastBtn").onclick = () => api("/settings", { toast: !S.settings.toast }).then(s => { S.settings = s; render(); });
  $("snoozeBtn").onclick = () => {
    const snoozed = (S.settings.snooze || 0) * 1000 > Date.now();
    api("/settings", { snooze: snoozed ? 0 : 60 }).then(s => { S.settings = s; render(); toast(snoozed ? "Pop-ups are back" : "No pop-ups for an hour"); });
  };
  $("clearBtn").onclick = () => {
    if (!S.notes.some(n => n.live && n.clearable)) return toast("Nothing to clear");
    document.querySelectorAll(".note:not(.gone)").forEach((el, i) => setTimeout(() => el.classList.add("leaving"), i * 40));
    run("dismiss", "*", null, "Cleared on your phone");
  };
  $("seenBtn").onclick = () => api("/seen", { all: true }).catch(() => {});
  $("histBtn").onclick = () => api("/history", null, "DELETE").then(() => toast("History forgotten")).catch(e => toast(e.message, true));
  // ---- keyboard: J/K move, R reply, X dismiss, O open, C copy code, 1-4 buttons, ? help
  let cur = null;
  function focusNote(el) {
    if (cur) cur.classList.remove("focus");
    cur = el;
    if (!el) return;
    el.classList.add("focus");
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    const n = byKey(el.dataset.key);
    if (n && !n.seen && n.live) api("/seen", { keys: [n.key] }).catch(() => {});
  }
  addEventListener("keydown", e => {
    const typing = /INPUT|TEXTAREA/.test(document.activeElement.tagName);
    if (typing || e.ctrlKey || e.altKey || e.metaKey) return;
    const notes = [...$("feed").querySelectorAll(".note")];
    if (cur && !cur.isConnected) cur = null;
    const i = cur ? notes.indexOf(cur) : -1;
    const k = e.key.toLowerCase();
    const click = sel => { const b = cur && cur.querySelector(sel); if (b) { e.preventDefault(); b.click(); } };
    if (k === "j" || e.key === "ArrowDown") { e.preventDefault(); focusNote(notes[Math.min(notes.length - 1, i + 1)]); }
    else if (k === "k" || e.key === "ArrowUp") { e.preventDefault(); focusNote(notes[Math.max(0, i - 1)]); }
    else if (k === "r") click('[data-do="compose"]');
    else if (k === "x" || e.key === "Delete") { const next = notes[i + 1] || notes[i - 1]; click('[data-do="dismiss"]'); setTimeout(() => focusNote(next && next.isConnected ? next : null), 50); }
    else if (k === "o") click('[data-do="open"]');
    else if (k === "c") click('[data-do="copy"]');
    else if (/^[1-4]$/.test(k)) click(`[data-do="action"][data-idx="${+k - 1}"]`);
    else if (e.key === "?") $("keys").hidden = !$("keys").hidden;
  });
  addEventListener("keydown", e => {
    if (e.key === "/" && document.activeElement.tagName !== "INPUT" && document.activeElement.tagName !== "TEXTAREA") { e.preventDefault(); $("q").focus(); }
    if (e.key === "Escape" && document.activeElement === $("q")) { $("q").value = ""; ui.q = ""; $("q").blur(); render(); }
  });
  setInterval(() => !document.hidden && render(), 30000);   // keep "5m" labels fresh
  loop();
})();
