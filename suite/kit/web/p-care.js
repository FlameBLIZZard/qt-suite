/* Toolkit panels: auto-cleaner, scheduled backup, focus mode, startup report, folder time machine. */
(() => {
  const K = window.qtKit, { api, esc, say, ago } = K;
  const when = t => t ? new Date(t * 1000).toLocaleString() : "never";

  K.panel("cleaner", async el => {
    el.innerHTML = `<div class="kempty">Measuring what can be cleaned...</div>`;
    let s = await api("/api/kit/cleaner?scan=1");
    const draw = () => {
      const total = s.targets_info.filter(t => s.targets.includes(t.id)).reduce((a, t) => a + (t.size || 0), 0);
      el.innerHTML = `<div class="kcols"><section class="kp qt-card"><h3>Clean now</h3>
        <div class="klist">${s.targets_info.map(t => `<label class="kitem"><input type="checkbox" data-t="${t.id}" ${s.targets.includes(t.id) ? "checked" : ""}>
          <div class="grow"><b>${esc(t.label)}</b><span>${t.files} files${t.recycle ? " \u00b7 goes to the Recycle Bin, so you can undo" : ""}</span></div><b>${t.human}</b></label>`).join("")}</div>
        <div class="krow"><button class="qt-btn primary" data-clean>Clean selected (${(total / 1048576).toFixed(0)} MB)</button><button class="qt-btn ghost" data-rescan>Measure again</button></div>
        <div class="kitem"><div class="grow"><b>Recycle Bin</b><span>${s.recycle_bin.items} items. Emptying it can't be undone.</span></div><b>${s.recycle_bin.human}</b><button class="qt-btn ghost kbtn-sm" data-bin>Empty</button></div></section>
        <section class="kp qt-card"><h3>Automatic</h3>
          <label class="krow"><button class="qt-switch" role="switch" id="cauto" aria-checked="${s.auto}"></button> Clean the ticked items on a schedule</label>
          <label class="kfield">Every<select id="cdays">${[1, 3, 7, 14, 30].map(d => `<option value="${d}" ${s.every_days === d ? "selected" : ""}>${d === 1 ? "day" : d + " days"}</option>`).join("")}</select></label>
          <p class="kmini">Last run: ${when(s.last)}. It only runs while the Suite is open.</p>
          <h3>History</h3><div class="klist">${s.history.length ? s.history.slice().reverse().map(h => `<div class="kitem"><div class="grow"><b>Freed ${(h.freed / 1048576).toFixed(0)} MB</b><span>${h.files} files \u00b7 ${when(h.t)}${h.auto ? " \u00b7 automatic" : ""}</span></div></div>`).join("") : `<div class="kempty">Nothing yet</div>`}</div></section></div>`;
    };
    draw();
    const sel = () => [...el.querySelectorAll("[data-t]:checked")].map(c => c.dataset.t);
    el.addEventListener("change", async e => {
      if (e.target.matches("[data-t]")) { s.targets = sel(); await api("/api/kit/cleaner", { op: "settings", targets: s.targets }); draw(); }
      if (e.target.id === "cdays") api("/api/kit/cleaner", { op: "settings", every_days: +e.target.value });
    });
    el.addEventListener("click", async e => {
      try {
        if (e.target.closest("[data-clean]")) { e.target.closest("[data-clean]").disabled = true; const r = await api("/api/kit/cleaner", { op: "clean", targets: sel() }); say(`Freed ${r.human} (${r.files} files)`); s = await api("/api/kit/cleaner?scan=1"); draw(); }
        if (e.target.closest("[data-rescan]")) { s = await api("/api/kit/cleaner?scan=1"); draw(); }
        if (e.target.closest("[data-bin]")) { if (!confirm("Empty the Recycle Bin? Those files will be gone for good.")) return; await api("/api/kit/cleaner", { op: "emptybin" }); say("Recycle Bin emptied"); s = await api("/api/kit/cleaner?scan=1"); draw(); }
        if (e.target.closest("#cauto")) { const on = e.target.closest("#cauto").getAttribute("aria-checked") !== "true"; await api("/api/kit/cleaner", { op: "settings", auto: on }); s.auto = on; draw(); }
      } catch (err) { say(err.message, { bad: true }); }
    });
  });

  K.panel("backup", async el => {
    let s = await api("/api/kit/backups"), edit = null;
    const form = j => `<section class="kp qt-card"><h3>${j.id ? "Edit backup" : "New backup"}</h3>
      <label class="kfield">Name<input class="qt-input" id="bn" value="${esc(j.name || "Documents")}"></label>
      <label class="kfield">Folders to back up (one per line)<textarea id="bs" placeholder="C:\\Users\\you\\Documents">${esc((j.src || []).join("\n"))}</textarea></label>
      <label class="kfield">Save backups in<input class="qt-input" id="bd" value="${esc(j.dest || s.default_dest)}"></label>
      <div class="krow"><label class="kfield">Kind<select id="bm"><option value="zip" ${j.mode !== "copy" ? "selected" : ""}>Zip (keeps old versions)</option><option value="copy" ${j.mode === "copy" ? "selected" : ""}>Copy (new + changed files)</option></select></label>
        <label class="kfield">How often<select id="be">${["hourly", "daily", "weekly"].map(x => `<option ${(j.every || "daily") === x ? "selected" : ""}>${x}</option>`).join("")}</select></label>
        <label class="kfield">At<input type="time" id="ba" value="${j.at || "21:00"}"></label><label class="kfield">Keep<input type="number" id="bk" value="${j.keep || 7}" min="1" max="99"></label></div>
      <div class="krow"><button class="qt-btn primary" data-save>Save</button>${j.id ? `<button class="qt-btn ghost" data-cancel>Cancel</button>` : ""}</div>
      <p class="kmini">Copy mode never deletes anything in the backup. Zip mode keeps the newest ${j.keep || 7} zips. Missed a run because the PC was off? It catches up when the Suite starts.</p></section>`;
    const draw = () => {
      el.innerHTML = `<div class="kcols"><section class="kp qt-card"><h3>Backups</h3><div class="klist">${s.jobs.length ? s.jobs.map(j => `<div class="kitem">
        <div class="grow"><b>${esc(j.name)} ${j.busy ? `<span class="qt-chip">${esc(j.busy)}</span>` : ""}</b><span>${j.every}${j.every !== "hourly" ? " at " + j.at : ""} \u00b7 ${j.mode} \u00b7 ${esc(j.src.join(", "))}</span>
        <span class="${j.last_ok === false ? "bad" : ""}">Last: ${when(j.last)}${j.last_msg ? " \u00b7 " + esc(j.last_msg) : ""}</span></div>
        <button class="qt-btn kbtn-sm" data-run="${j.id}">Run now</button><button class="qt-btn ghost kbtn-sm" data-open="${j.id}">Open</button><button class="qt-btn ghost kbtn-sm" data-edit="${j.id}">Edit</button><button class="qt-btn ghost kbtn-sm" data-del="${j.id}">\u2715</button></div>`).join("")
        : `<div class="kempty">No backups yet. Make one on the right.</div>`}</div></section>${form(edit || {})}</div>`;
    };
    draw();
    el.addEventListener("click", async e => {
      const t = e.target, q = a => t.closest(`[data-${a}]`)?.dataset[a];
      try {
        if (t.closest("[data-save]")) {
          s = await api("/api/kit/backups", { op: "save", id: edit && edit.id, name: el.querySelector("#bn").value, src: el.querySelector("#bs").value.split("\n").map(x => x.trim().replace(/^"|"$/g, "")).filter(Boolean),
            dest: el.querySelector("#bd").value, mode: el.querySelector("#bm").value, every: el.querySelector("#be").value, at: el.querySelector("#ba").value, keep: +el.querySelector("#bk").value });
          edit = null; draw(); say("Backup saved");
        }
        if (t.closest("[data-cancel]")) { edit = null; draw(); }
        if (q("run")) { await api("/api/kit/backups", { op: "run", id: q("run") }); say("Backup started"); setTimeout(async () => { s = await api("/api/kit/backups"); draw(); }, 800); }
        if (q("open")) api("/api/kit/backups", { op: "open", id: q("open") });
        if (q("edit")) { edit = s.jobs.find(j => j.id === q("edit")); draw(); }
        if (q("del")) { if (!confirm("Delete this backup job? Backups already made stay where they are.")) return; s = await api("/api/kit/backups", { op: "del", id: q("del") }); draw(); }
      } catch (err) { say(err.message, { bad: true }); }
    });
    const tm = setInterval(async () => { if (s.jobs.some(j => j.busy)) { s = await api("/api/kit/backups"); if (!el.querySelector(":focus")) draw(); } }, 2000);
    return () => clearInterval(tm);
  });

  K.panel("focus", async el => {
    let s = await api("/api/kit/focus");
    const fmt = n => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
    const draw = () => {
      el.innerHTML = `<div class="kcols"><section class="kp qt-card" style="text-align:center">
        <div class="kbig" id="fleft" style="font-size:72px">${s.on ? (s.left != null ? fmt(s.left) : "\u221e") : fmt((s.minutes || 25) * 60)}</div>
        <div class="kpill" style="justify-content:center">${[15, 25, 45, 60, 90, 0].map(m => `<button data-m="${m}" aria-pressed="${s.minutes === m}">${m ? m + " min" : "No limit"}</button>`).join("")}</div>
        <div class="krow" style="justify-content:center">${s.on ? `<button class="qt-btn" data-stop>Stop focus</button>` : `<button class="qt-btn primary" data-start>Start focus</button>`}</div>
        <p class="kmini">Today ${s.today} min \u00b7 this week ${s.week} min \u00b7 hotkey Ctrl+Alt+F</p></section>
        <section class="kp qt-card"><h3>While focusing</h3>
          <label class="krow"><button class="qt-switch" role="switch" id="fq" aria-checked="${s.quiet}"></button> Mute phone notifications on the PC (Ping)</label>
          <label class="kfield">Close these apps if they open (program names)<textarea id="fa">${esc(s.apps.join("\n"))}</textarea></label>
          <button class="qt-btn" data-saveapps>Save list</button>
          ${s.closed && s.closed.length ? `<p class="kmini">Closed this session: ${esc(s.closed.join(", "))}</p>` : ""}
          <p class="kmini">Find a program's name in Task Manager, Details tab. A finished session of 20+ minutes earns XP and lights up the streak calendar.</p></section></div>`;
    };
    draw();
    el.addEventListener("click", async e => {
      const t = e.target;
      try {
        const m = t.closest("[data-m]"); if (m) { s = await api("/api/kit/focus", { op: "settings", minutes: +m.dataset.m || 0 }); if (+m.dataset.m === 0) s.minutes = 0; draw(); }
        if (t.closest("[data-start]")) { s = await api("/api/kit/focus", { op: "start", minutes: s.minutes }); draw(); say("Focus on. You've got this."); }
        if (t.closest("[data-stop]")) { s = await api("/api/kit/focus", { op: "stop" }); draw(); }
        if (t.closest("#fq")) { s = await api("/api/kit/focus", { op: "settings", quiet: t.closest("#fq").getAttribute("aria-checked") !== "true" }); draw(); }
        if (t.closest("[data-saveapps]")) { s = await api("/api/kit/focus", { op: "settings", apps: el.querySelector("#fa").value.split("\n") }); say("Saved"); }
      } catch (err) { say(err.message, { bad: true }); }
    });
    const tm = setInterval(async () => {
      if (!s.on) return;
      s = await api("/api/kit/focus");
      const l = el.querySelector("#fleft"); if (!l) return;
      if (!s.on) { draw(); say("Focus session done!"); } else l.textContent = s.left != null ? fmt(s.left) : "\u221e";
    }, 1000);
    return () => clearInterval(tm);
  });

  K.panel("startup", async el => {
    el.innerHTML = `<div class="kempty">Reading Windows' boot records...</div>`;
    let s = await api("/api/kit/startup");
    const draw = () => {
      const max = Math.max(1, ...s.phases.map(p => p.s));
      el.innerHTML = `<div class="kcols"><section class="kp qt-card"><h3>Last start: ${s.total} s <button class="qt-btn ghost kbtn-sm" data-fresh>Refresh</button></h3>
        ${s.boot ? `<p class="kmini">Booted ${new Date(s.boot * 1000).toLocaleString()}</p>` : ""}
        <div class="klist">${s.phases.map(p => `<div class="kfield"><span class="krow sp"><b style="color:var(--qt-fg)">${esc(p.name)}</b><b style="color:var(--qt-fg)">${p.s} s</b></span>
          <span class="bar"><i style="width:${100 * p.s / max}%"></i></span>${p.note ? `<span class="kmini">${esc(p.note)}</span>` : ""}</div>`).join("") || `<div class="kempty">${esc(s.err || "No boot data")}</div>`}</div>
        ${s.history.length > 1 ? `<h3>Recent starts (power on to sign-in)</h3><div class="kbars">${s.history.map(h => `<div><i style="height:${Math.min(100, h.s / Math.max(...s.history.map(x => x.s)) * 100)}px"></i>${Math.round(h.s)}s</div>`).join("")}</div>` : ""}
        ${s.tips.length ? `<h3>Tips</h3><ul>${s.tips.map(t => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}</section>
        <section class="kp qt-card"><h3>Starts with Windows <span class="qt-chip">${s.items.filter(i => i.on).length} on</span></h3>
        <div class="klist">${s.items.map(i => `<div class="kitem ${i.on ? "" : "done"}"><div class="grow"><b>${esc(i.name)}</b><span>${esc(i.where)} \u00b7 ${esc(i.exe)}${i.mb ? " \u00b7 " + i.mb + " MB" : ""}</span></div>
          ${i.can ? `<button class="qt-switch" role="switch" aria-checked="${i.on}" data-name="${esc(i.name)}" data-kind="${i.kind}"></button>` : `<span class="kmini" title="Needs admin: use Task Manager">system</span>`}</div>`).join("")}</div>
        <p class="kmini">Switching one off is the same as Task Manager's Disable: nothing is deleted, switch it back on any time.</p></section></div>`;
    };
    draw();
    el.addEventListener("click", async e => {
      try {
        if (e.target.closest("[data-fresh]")) { s = await api("/api/kit/startup?fresh=1"); draw(); }
        const sw = e.target.closest("[data-name]");
        if (sw) { s = await api("/api/kit/startup", { name: sw.dataset.name, kind: sw.dataset.kind, on: sw.getAttribute("aria-checked") !== "true" }); draw(); say("Takes effect next time you sign in"); }
      } catch (err) { say(err.message, { bad: true }); }
    });
  });

  K.panel("tm", async el => {
    let s = await api("/api/kit/tm"), folder = null, snap = null, files = null, q = "";
    const draw = async () => {
      let right = `<div class="kempty">Pick a folder on the left to see its history.</div>`;
      if (folder) {
        const h = await api("/api/kit/tm?folder=" + encodeURIComponent(folder));
        right = `<h3>${esc(folder)} <button class="qt-btn kbtn-sm" data-snapnow>Snapshot now</button></h3><div class="klist" style="max-height:220px;overflow:auto">${h.snaps.map(x => `<button class="kitem ${x.snap === snap ? "sel" : ""}" data-snap="${x.snap}" style="cursor:pointer;color:var(--qt-fg);font:inherit;text-align:left">
          <div class="grow"><b>${new Date(x.t * 1000).toLocaleString()}</b><span>${x.files} files \u00b7 +${x.added} new, ${x.changed} changed, ${x.removed} removed</span></div></button>`).join("") || `<div class="kempty">No snapshots yet</div>`}</div>`;
        if (snap) {
          files = await api(`/api/kit/tm?folder=${encodeURIComponent(folder)}&snap=${snap}&q=${encodeURIComponent(q)}`);
          right += `<div class="krow"><input class="qt-input grow" id="tq" placeholder="Filter files" value="${esc(q)}"><button class="qt-btn kbtn-sm" data-restoreall="new">Restore all to Desktop</button>
            <button class="qt-btn ghost kbtn-sm" data-restoreall="original">Restore all in place</button></div>
            <div class="klist" style="max-height:340px;overflow:auto">${files.files.map(f => `<div class="kitem"><div class="grow"><b>${esc(f.rel)}</b><span>${(f.size / 1024).toFixed(1)} KB \u00b7 now: <span class="${f.now === "same" ? "" : f.now === "deleted" ? "bad" : "warnc"}">${f.now}</span></span></div>
            ${f.now !== "same" ? `<button class="qt-btn kbtn-sm" data-rel="${esc(f.rel)}">Restore</button>` : ""}</div>`).join("")}</div><p class="kmini">${files.total} files in this snapshot. Restoring in place keeps the current file next to it as .before-restore.</p>`;
        }
      }
      el.innerHTML = `<div class="kcols"><section class="kp qt-card"><h3>Watched folders</h3>
        <div class="klist">${s.folders.map(f => `<div class="kitem"><button class="grow" data-folder="${esc(f.path)}" style="all:unset;cursor:pointer;flex:1"><b>${esc(f.path)}</b><span class="kmini">${f.count} snapshots \u00b7 last ${f.last ? ago(f.last) : "never"}${f.busy ? " \u00b7 working..." : ""}</span></button>
          <button class="qt-btn ghost kbtn-sm" data-rm="${esc(f.path)}">\u2715</button></div>`).join("") || `<div class="kempty">None yet</div>`}</div>
        <div class="krow"><input class="qt-input grow" id="tadd" placeholder="C:\\Users\\you\\Documents\\Project"><button class="qt-btn primary" data-add>Watch</button></div>
        <label class="kfield">Snapshot every<select id="tevery">${[15, 30, 60, 180, 720, 1440].map(m => `<option value="${m}" ${s.every === m ? "selected" : ""}>${m < 60 ? m + " min" : m / 60 + " h"}</option>`).join("")}</select></label>
        <p class="kmini">Versions are kept in ${esc(s.store)}. Each file is stored once, so unchanged files cost nothing. Files over 300 MB are skipped.</p></section>
        <section class="kp qt-card">${right}</section></div>`;
    };
    await draw();
    el.addEventListener("change", async e => {
      if (e.target.id === "tevery") s = await api("/api/kit/tm", { op: "every", every: +e.target.value });
      if (e.target.id === "tq") { q = e.target.value; draw(); }
    });
    el.addEventListener("click", async e => {
      const t = e.target, d = a => t.closest(`[data-${a}]`)?.dataset[a];
      try {
        if (t.closest("[data-add]")) { s = await api("/api/kit/tm", { op: "add", path: el.querySelector("#tadd").value }); say("Watching. First snapshot is running."); folder = s.folders.at(-1).path; snap = null; await draw(); }
        if (d("rm") !== undefined) { if (!confirm("Stop watching this folder? Saved versions stay on disk.")) return; s = await api("/api/kit/tm", { op: "del", path: d("rm") }); folder = null; await draw(); }
        if (d("folder") !== undefined) { folder = d("folder"); snap = null; q = ""; await draw(); }
        if (d("snap")) { snap = d("snap"); await draw(); }
        if (t.closest("[data-snapnow]")) { const r = await api("/api/kit/tm", { op: "snap", path: folder }); say(r.r && r.r.same ? "No changes since the last snapshot" : "Snapshot saved"); s = await api("/api/kit/tm"); await draw(); }
        if (d("rel")) { const r = await api("/api/kit/tm", { op: "restore", folder, snap, rel: d("rel"), to: "original" }); say(`Restored ${r.restored} file`); await draw(); }
        if (d("restoreall")) { const to = d("restoreall"); if (to === "original" && !confirm("Put every file back the way it was at this snapshot? Current versions are kept as .before-restore.")) return;
          const r = await api("/api/kit/tm", { op: "restore", folder, snap, to }); say(`Restored ${r.restored} files to ${r.to}`); await draw(); }
      } catch (err) { say(err.message, { bad: true }); }
    });
  });
})();
