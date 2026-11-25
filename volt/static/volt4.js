/* VOLT 3.2: queue controls, engine update + restart, Peek / Burrow hand-off inside QT Suite, motion.
   Loads after the main script and wraps a few of its globals (draw, updateRow, loadStatus). */
(() => {
  /* ---------- QT Suite bridge: open files in Peek, show them in Burrow ---------- */
  const HUB = (() => {
    try {
      const o = location.ancestorOrigins && location.ancestorOrigins[0];
      if (window.parent !== window && o && /^http:\/\/(127\.0\.0\.1|localhost):78\d\d$/.test(o)) return o;
    } catch (_) {}
    return null;
  })();
  window.voltHub = HUB;
  function askHub(msg, ms = 600) {
    return new Promise(res => {
      if (!HUB) return res(false);
      const id = "v" + Math.random().toString(36).slice(2);
      const on = e => { if (e.origin === HUB && e.data && e.data.id === id) done(/-ack$/.test(e.data.qt || "")); };
      const done = v => { removeEventListener("message", on); clearTimeout(t); res(v); };
      addEventListener("message", on);
      const t = setTimeout(() => done(false), ms);
      try { parent.postMessage(Object.assign({ id }, msg), HUB); } catch (_) { done(false); }
    });
  }
  const isFile = j => j && j.path && j.size && j.exists !== false;
  function launch(btn) {
    const row = btn && btn.closest(".job"); if (!row || RM) return;
    row.classList.remove("launch"); void row.offsetWidth; row.classList.add("launch");
  }
  /* ▶ on a finished row: Peek in the suite (arrows step through your other downloads). Shift+click = Windows app */
  window.voltPlay = (j, btn, ev) => {
    if (!HUB || !isFile(j) || (ev && ev.shiftKey)) return false;
    launch(btn);
    const list = lastJobs.filter(isFile).map(x => x.path);
    const r = btn.getBoundingClientRect();
    askHub({ qt: "peek", path: j.path, list, rect: { x: r.left + r.width / 2, y: r.top + r.height / 2 } }).then(ok => {
      if (!ok) api("/api/open", { id: j.id, play: true }).catch(err => toast(err.message, { bad: true }));
    });
    return true;
  };
  /* folder button: Burrow inside the suite, Explorer otherwise */
  window.voltReveal = (j, btn) => {
    if (!HUB || !j.path || j.exists === false) return false;
    askHub({ qt: "reveal", path: j.path }).then(ok => {
      if (!ok) api("/api/open", { id: j.id }).catch(err => toast(err.message, { bad: true }));
    });
    return true;
  };
  if (HUB) document.documentElement.classList.add("in-suite");

  /* ---------- queue controls ---------- */
  let qHeld = false;
  const holdBtn = $("#holdQ"), resBtn = $("#resumeAll");
  function queueChrome(all) {
    const queued = all.filter(j => j.state === "queued").length;
    const paused = all.filter(j => j.state === "paused").length;
    if (all.some(j => j.state === "queued")) qHeld = all.some(j => j.state === "queued" && j.held);
    holdBtn.hidden = !(queued || qHeld || all.some(j => ACTIVE.includes(j.state)));
    holdBtn.classList.toggle("on", qHeld);
    holdBtn.querySelector("span").textContent = qHeld ? "Queue paused" : "Pause queue";
    holdBtn.title = qHeld ? "Let waiting downloads start again" : "Running downloads finish; nothing new starts until you press again";
    resBtn.hidden = !paused;
    resBtn.textContent = paused > 1 ? `Resume ${paused} paused` : "Resume paused";
  }
  holdBtn.onclick = () => api("/api/queue", { paused: !qHeld }).then(r => {
    qHeld = r.paused; lastSig = ""; poll();
    holdBtn.classList.remove("flip"); void holdBtn.offsetWidth; holdBtn.classList.add("flip");
    toast(r.paused ? "Queue paused: running downloads finish, nothing new starts" : "Queue running again");
  }).catch(e => toast(e.message, { bad: true }));
  resBtn.onclick = () => api("/api/queue", { resume_all: true }).then(() => { zap(); lastSig = ""; poll(); }).catch(e => toast(e.message, { bad: true }));

  const _draw = window.draw;
  window.draw = all => { _draw(all); queueChrome(all); };

  /* rows: history date, queue-place ticker, pause/resume motion */
  const prevPos = {}, prevSt = {};
  const _updateRow = window.updateRow;
  window.updateRow = (el, j) => {
    _updateRow(el, j);
    const s = el.querySelector(".s");
    if (j.ended && s) s.title = (j.state === "done" ? "Finished " : "Ended ") + new Date(j.ended * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
    if (j.state === "queued" && j.pos && prevPos[j.id] && prevPos[j.id] !== j.pos && s) { s.classList.remove("tick-up"); void s.offsetWidth; s.classList.add("tick-up"); }
    prevPos[j.id] = j.pos;
    const pos = j.state === "queued" && j.pos ? String(j.pos) : "";
    if (el.dataset.pos !== pos) {
      el.dataset.pos = pos;
      if (pos && !RM) { el.classList.remove("pos-pop"); void el.offsetWidth; el.classList.add("pos-pop"); }
    }
    const was = prevSt[j.id];
    if (was && was !== j.state && !RM) {
      const k = j.state === "paused" ? "freeze" : was === "paused" ? "kick" : null;
      if (k) { el.classList.remove("freeze", "kick"); void el.offsetWidth; el.classList.add(k); }
    }
    prevSt[j.id] = j.state;
    el.classList.toggle("ok-file", isFile(j));
  };
  document.getElementById("jobs").addEventListener("animationend", e => {
    if (e.target.classList) e.target.classList.remove("freeze", "kick", "lift", "launch", "tick-up", "pos-pop");
  });
  document.getElementById("jobs").addEventListener("click", e => {
    const b = e.target.closest("button[data-front]");
    if (b) { const row = b.closest(".job"); row.classList.remove("lift"); void row.offsetWidth; row.classList.add("lift"); }
  }, true);

  /* ---------- engine: update badge, update + restart ---------- */
  const vnum = v => String(v || "").split(/[.\-]/).map(n => parseInt(n, 10) || 0);
  const newer = (a, b) => { const x = vnum(a), y = vnum(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
  const waiting = s => s && ((s.latest && newer(s.latest, s.ytdlp)) || (s.installed && newer(s.installed, s.ytdlp)));
  function badge() {
    const st = $("#st"); if (!status || !st) return;
    st.querySelector(".updb")?.remove();
    if (!waiting(status)) return;
    const b = document.createElement("button");
    b.className = "updb"; b.type = "button";
    const ready = status.installed && newer(status.installed, status.ytdlp);
    b.innerHTML = `<b></b>${ready ? "restart to update" : "update"}`;
    b.title = ready ? `yt-dlp ${status.installed} is installed: restart VOLT to use it` : `yt-dlp ${status.latest} is out (you have ${status.ytdlp})`;
    b.onclick = () => $("#gear").click();
    st.append(b);
  }
  const _ls = window.loadStatus;
  window.loadStatus = () => _ls().then(r => { badge(); return r; });
  window.loadStatus();

  function fillVer() {
    if (!status) return;
    const ready = status.installed && newer(status.installed, status.ytdlp);
    const avail = status.latest && newer(status.latest, status.ytdlp);
    $("#ver").innerHTML = `yt-dlp ${esc(status.ytdlp)}` +
      (ready ? ` · <b class="vnew">${esc(status.installed)} ready</b>` : avail ? ` · <b class="vnew">${esc(status.latest)} out</b>` : status.latest ? " · up to date" : "") +
      ` · VOLT ${esc(status.version || "")}` + (status.imp ? ` · <span title="Sites that block plain downloads get a request that looks like Chrome">Chrome disguise ✓</span>` : "");
    const b = $("#upd");
    b.classList.remove("busy", "go");
    if (ready) { b.textContent = "Restart VOLT"; b.classList.add("go"); }
    else b.textContent = avail ? `Update to ${status.latest}` : "Update now";
  }
  $("#gear").addEventListener("click", () => setTimeout(fillVer, 0));

  async function doUpdate() {
    const b = $("#upd");
    b.disabled = true; b.classList.add("busy"); b.textContent = "Updating…";
    await api("/api/update", {}).catch(() => {});
    let u;
    for (let i = 0; i < 400; i++) {
      await new Promise(r => setTimeout(r, 1200));
      u = await api("/api/update").catch(() => ({ state: "failed", error: "VOLT stopped answering" }));
      if (u.state !== "updating") break;
    }
    b.disabled = false; b.classList.remove("busy");
    if (u.state === "done" && u.restart) {
      status.installed = u.new; fillVer(); badge();
      b.classList.add("stamp");
      toast(`yt-dlp ${u.new} installed`, { action: "Restart now", ms: 8000, onAction: doRestart });
    } else if (u.state === "done") { fillVer(); toast("Engines are up to date"); }
    else { b.textContent = "Try again"; toast("Update failed: " + (u.error || "check your internet"), { bad: true, ms: 7000 }); }
  }
  async function doRestart(force) {
    try { await api("/api/restart", force ? { force: true } : {}); }
    catch (e) {
      if (e.status === 409) return toast(e.message, { action: "Restart anyway", ms: 7000, onAction: () => doRestart(true) });
      return toast(e.message, { bad: true });
    }
    if ($("#dlg").open) closeDlg();
    const before = status && status.uptime;
    const ov = document.createElement("div");
    ov.className = "recharge";
    ov.innerHTML = `<div class="rc-box"><svg viewBox="0 0 48 64" class="rc-bolt"><defs><clipPath id="rcClip"><path d="M30 2 6 36h15l-4 26 25-36H27z"/></clipPath></defs><path d="M30 2 6 36h15l-4 26 25-36H27z" class="rc-out"/><rect class="rc-fill" x="0" y="0" width="48" height="64" clip-path="url(#rcClip)"/></svg><b>Recharging VOLT</b><span>Downloads carry on by themselves</span></div>`;
    document.body.append(ov);
    requestAnimationFrame(() => ov.classList.add("on"));
    const t0 = Date.now();
    await new Promise(r => setTimeout(r, 1500));
    while (Date.now() - t0 < 40000) {
      try {
        const s = await api("/api/status");
        if (s.uptime != null && (before == null || s.uptime < before)) { ov.classList.add("done"); setTimeout(() => location.reload(), 650); return; }
      } catch (_) {}
      await new Promise(r => setTimeout(r, 700));
    }
    ov.remove(); toast("VOLT didn't come back. Start it from QT Suite or start.bat", { bad: true, ms: 8000 });
  }
  $("#upd").onclick = () => ($("#upd").classList.contains("go") ? doRestart() : doUpdate());
  window.voltRestart = doRestart;

  /* ---------- keyboard: Space pauses/resumes the focused row ---------- */
  $("#jobs").addEventListener("keydown", e => {
    if (e.key !== " " || !e.target.classList.contains("job")) return;
    const b = e.target.querySelector("[data-z],[data-y]"); if (b) { e.preventDefault(); b.click(); }
  });
  const mo = new MutationObserver(() => document.querySelectorAll("#jobs .job:not([tabindex])").forEach(r => r.tabIndex = 0));
  mo.observe($("#jobs"), { childList: true });
})();
