"use strict";
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const human = b => {
  if (b == null) return "–";
  const u = ["B", "KB", "MB", "GB", "TB"]; let v = Math.max(0, b), i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return (i === 0 ? v.toFixed(0) : v.toFixed(v >= 100 ? 0 : 1)) + " " + u[i];
};
const nice = n => (n ?? 0).toLocaleString("en-IN");
const day = t => t ? new Date(t * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
const ago = t => {
  const s = Date.now() / 1000 - t;
  return s < 90 ? "just now" : s < 3600 ? Math.round(s / 60) + " min ago" : s < 86400 ? Math.round(s / 3600) + " h ago" : Math.round(s / 86400) + " days ago";
};

let INFO = {};
const S = { tab: "overview", sub: "folders", path: "", view: null, extras: null, dupes: null, sel: new Map(), clean: null, reels: null, wins: {} };

/* toast(msg, bad, {label, fn}) – the optional button stays a little longer so there's time to press it */
function toast(msg, bad, action) {
  const t = document.createElement("div");
  t.className = "qt-toast" + (bad ? " bad" : "") + (action ? " act" : "");
  t.append(document.createTextNode(msg));
  if (action) {
    const b = document.createElement("button");
    b.className = "tbtn"; b.textContent = action.label;
    b.onclick = () => { action.fn(); gone(); };
    t.append(b);
  }
  const gone = () => { if (t.classList.contains("out")) return; t.classList.add("out"); setTimeout(() => t.remove(), 320); };
  let timer = setTimeout(gone, action ? 7000 : bad ? 4200 : 2600);
  t.onmouseenter = () => clearTimeout(timer);
  t.onmouseleave = () => { timer = setTimeout(gone, 1800); };
  $("#toasts").append(t);
  return t;
}
const PREV = {};
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)");
/* Numbers roll up to their value: [data-count] (bytes unless data-fmt="int") */
function countUp(root) {
  $$("[data-count]", root).forEach(el => {
    const to = +el.dataset.count, fmt = el.dataset.fmt === "int" ? v => Math.round(v) : human;
    const key = el.dataset.key, from = key && key in PREV ? PREV[key] : +(el.dataset.from || 0);
    if (key) PREV[key] = to;
    if (REDUCED.matches || !isFinite(to) || to === from) { el.textContent = fmt(to); return; }
    const t0 = performance.now(), dur = 700 + Math.min(500, Math.log10(Math.abs(to - from) + 1) * 40);
    const step = now => {
      const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 4);
      el.textContent = fmt(from + (to - from) * e);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}
async function copyText(s) {
  try { await navigator.clipboard.writeText(s); }
  catch { const ta = Object.assign(document.createElement("textarea"), { value: s }); document.body.append(ta); ta.select(); document.execCommand("copy"); ta.remove(); }
}
const openPlace = what => api("/api/open", { what }).catch(e => toast(e.message, true));

async function api(path, body) {
  const r = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  let j = null;
  try { j = await r.json(); } catch {}
  if (!r.ok) throw new Error((j && j.error) || r.statusText);
  return j;
}

/* Starts (or joins) a background job and polls it. onTick gets every progress view. */
async function job(path, body, onTick) {
  let v = await api(path, body || {});
  while (v.state === "running") {
    onTick && onTick(v);
    await new Promise(r => setTimeout(r, 280));
    v = await api("/api/job?id=" + v.id);
  }
  onTick && onTick(v);
  if (v.state === "error") throw new Error(v.error);
  return v;
}

/* ------------------------------------------------------------------ tabs */
function movePill() {
  const on = $("#tabs button.on"), pill = $(".tab-pill");
  if (!on) return;
  pill.style.width = on.offsetWidth + "px";
  pill.style.transform = `translateX(${on.offsetLeft}px)`;
}
const ORDER = ["overview", "clean", "big", "reels", "activity"];
function go(tab) {
  if (!ORDER.includes(tab)) return;
  document.documentElement.style.setProperty("--dir", ORDER.indexOf(tab) >= ORDER.indexOf(S.tab) ? 1 : -1);
  S.tab = tab;
  $$("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === tab));
  $$(".pane").forEach(p => p.classList.toggle("on", p.id === "p-" + tab));
  movePill();
  try { sessionStorage.setItem("sm-tab", tab); } catch {}
  if (tab === "overview") loadDrives();
  if (tab === "clean" && !S.clean) measure();
  if (tab === "reels" && !S.reels) scanReels();
  if (tab === "activity") loadLog();
  if (tab === "big") { $("#bigPath").focus(); }
  renderSelbar();
}
$("#tabs").addEventListener("click", e => { const b = e.target.closest("button[data-tab]"); if (b) go(b.dataset.tab); });
addEventListener("resize", movePill);

document.addEventListener("click", e => {
  const o = e.target.closest("[data-open]");
  if (o) api("/api/open", { what: o.dataset.open }).catch(er => toast(er.message, true));
  const sc = e.target.closest("[data-scan]");
  if (sc) {
    go("big");
    const root = sc.dataset.scan;
    if (S.view && S.view.root.toLowerCase() === root.toLowerCase()) openDir(root);
    else { $("#bigPath").value = root; startScan(); }
  }
});

/* --------------------------------------------------------------- modal */
function modal(html, setup) {
  const m = $("#modal"), d = $(".dlg", m);
  d.innerHTML = html;
  m.hidden = false;
  return new Promise(res => {
    const close = v => { m.hidden = true; removeEventListener("keydown", key, true); res(v); };
    const key = e => { if (e.key === "Escape") { e.stopPropagation(); close(false); } };
    addEventListener("keydown", key, true);
    m.onclick = e => { if (e.target === m) close(false); };
    $$("[data-x]", d).forEach(b => b.onclick = () => close(b.dataset.x === "ok" ? (setup?.value ? setup.value(d) : true) : false));
    setup?.init && setup.init(d, close);
    ($("[data-focus]", d) || $("[data-x=cancel]", d))?.focus();
  });
}

function itemsHtml(items) {
  const shown = items.slice(0, 10).map(i => `<div><span title="${esc(i.path)}">${esc(i.path)}</span><span>${human(i.bytes)}</span></div>`).join("");
  return `<div class="items">${shown}${items.length > 10 ? `<div><span>and ${items.length - 10} more</span><span></span></div>` : ""}</div>`;
}

function confirmBox({ title, lead, items, total, ok, danger, extra }) {
  return modal(`<h2 id="mTitle">${esc(title)}</h2>${total != null ? `<div class="total" data-count="${total}">${human(total)}</div>` : ""}<p>${lead}</p>
    ${items ? itemsHtml(items) : ""}${extra || ""}
    <div class="btns"><button class="qt-btn" data-x="cancel">Cancel</button><button class="qt-btn ${danger ? "danger" : "primary"}" data-x="ok" data-focus>${esc(ok)}</button></div>`,
    { init: d => { countUp(d); const a = $("#agree", d), b = $("[data-x=ok]", d); if (a) { b.disabled = true; a.onchange = () => b.disabled = !a.checked; } } });
}

function resultBox(title, freed, rows) {
  return modal(`<h2 id="mTitle">${esc(title)}</h2>
    ${freed != null ? `<div class="boom"><span data-count="${freed}">${human(0)}</span><i class="burst" aria-hidden="true">${"<b></b>".repeat(12)}</i></div><p class="boomsub">freed up</p>` : ""}
    <div class="res">${rows.map(r => `<div class="${r.bad ? "bad" : ""}"><span>${esc(r.a)}</span><span>${esc(r.b)}</span></div>`).join("")}</div>
    <div class="btns"><button class="qt-btn primary" data-x="ok" data-focus>Nice</button></div>`, { init: d => setTimeout(() => countUp(d), 180) });
}

/* ------------------------------------------------------------ overview */
function spark(points) {
  if (points.length < 2) return "";
  const w = 120, h = 30, min = Math.min(...points), max = Math.max(...points), span = max - min || 1;
  const xy = points.map((v, i) => [i / (points.length - 1) * w, h - 3 - (v - min) / span * (h - 6)]);
  const d = "M" + xy.map(p => p[0].toFixed(1) + " " + p[1].toFixed(1)).join("L");
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><path class="a" d="${d}L${w} ${h}L0 ${h}Z"/><path class="l" d="${d}"/></svg>`;
}

/* "Full in ~N days" from a least-squares line through the last 30 daily readings. null = not filling up. */
function forecast(hist, letter, free) {
  const pts = hist.slice(-30).map(h => [new Date(h.day).getTime() / 864e5, h.free[letter]]).filter(p => p[1] != null);
  if (pts.length < 5) return null;
  const n = pts.length, mx = pts.reduce((a, p) => a + p[0], 0) / n, my = pts.reduce((a, p) => a + p[1], 0) / n;
  const sxx = pts.reduce((a, p) => a + (p[0] - mx) ** 2, 0);
  if (!sxx) return null;
  const slope = pts.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0) / sxx;  // bytes per day
  if (slope > -64 * 1024 * 1024) return null;                                    // losing less than 64 MB a day = steady
  const days = Math.round(free / -slope), span = Math.round(pts[n - 1][0] - pts[0][0]);
  if (days > 730) return null;
  return { days, span, text: `${human(-slope)}/day · full in ~${days < 60 ? days + " days" : Math.round(days / 30) + " months"}` };
}

async function loadDrives() {
  let r;
  try { r = await api("/api/drives"); } catch (e) { return toast("Couldn't read the drives: " + e.message, true); }
  const hist = r.history;
  $("#drives").innerHTML = r.drives.map(d => {
    const used = d.size - d.free, pct = used / d.size * 100;
    const series = hist.map(h => h.free[d.letter]).filter(v => v != null);
    const weekAgo = hist.filter(h => (Date.now() - new Date(h.day)) / 864e5 <= 7.5).map(h => h.free[d.letter]).find(v => v != null);
    const delta = weekAgo != null ? d.free - weekAgo : 0;
    const trend = Math.abs(delta) < 512 * 1024 * 1024 ? `<span class="trend">steady this week</span>`
      : `<span class="trend ${delta < 0 ? "down" : "up"}">${delta < 0 ? "−" : "+"}${human(Math.abs(delta))} free this week</span>`;
    const cls = d.free / d.size < 0.06 ? "full" : d.free / d.size < 0.15 ? "tight" : "";
    const fc = forecast(hist, d.letter, d.free);
    return `<div class="drive qt-card ${cls}" style="--i:${r.drives.indexOf(d)}">
      <div class="dh"><div class="letter">${d.letter}</div>
        <div class="nm"><b>${esc(d.label || "Local disk")}</b><span>${esc(d.type)} · ${esc(d.fs)}${d.model ? " · " + esc(d.model) : ""}</span></div>
        <div class="pct"><span data-count="${pct.toFixed(0)}" data-fmt="int" data-key="pct-${d.letter}">${pct.toFixed(0)}</span>%</div></div>
      <div class="usage" title="${human(used)} used"><i data-w="${pct.toFixed(2)}"></i></div>
      <div class="nums"><span><b data-count="${d.free}" data-key="free-${d.letter}">${human(d.free)}</b> free</span><span>${human(used)} used of ${human(d.size)}</span></div>
      <div class="foot">${d.bin != null ? `<span>Bin: ${human(d.bin)}</span>` : "<span>No Recycle Bin</span>"}${trend}${spark(series)}</div>
      <div class="dact">${fc ? `<span class="fc ${fc.days < 30 ? "soon" : ""}" title="From the free-space trend of the last ${fc.span} days">${esc(fc.text)}</span>` : `<span class="fc calm">Not filling up</span>`}
        <button class="qt-btn ghost sm" data-scan="${esc(d.root)}">What's big on ${d.letter}: →</button></div>
    </div>`;
  }).join("");
  requestAnimationFrame(() => requestAnimationFrame(() => $$(".usage i").forEach(i => i.style.width = i.dataset.w + "%")));
  countUp($("#drives"));
  S.wins = r.wins; S.bin = r.bin;
  renderWins();
}

function renderWins() {
  const w = S.wins, rows = [
    { ic: "🧹", t: "Caches and temp files", s: "Safe to clear. Apps rebuild them.", v: w.clean, to: () => go("clean") },
    { ic: "🎬", t: "Finished reel frames", s: "Move plates and renders to D:.", v: w.reels, to: () => go("reels") },
    { ic: "📦", t: "Rebuildable folders", s: w.scan_root ? "node_modules, venvs and build caches in " + w.scan_root : "Scan a drive in What's big to find them.", v: w.rebuild, to: () => { go("big"); if (S.view) sub("rebuild"); } },
    { ic: "🕰️", t: "Big files untouched for a year", s: w.scan_root ? "Good candidates for the D: archive." : "Shows up after a scan.", v: w.old, to: () => { go("big"); if (S.view) sub("old"); } },
    { ic: "🗑️", t: "Recycle Bin", s: (S.bin?.count ? nice(S.bin.count) + " items. " : "") + "Emptying it can't be undone.", v: S.bin?.bytes, to: () => go("clean") },
  ];
  $("#winsList").innerHTML = rows.map((r, i) => `<button class="win" data-w="${i}" style="animation-delay:${i * 50}ms">
    <span class="wi">${r.ic}</span><span><b>${esc(r.t)}</b><small>${esc(r.s)}</small></span>
    <span class="amt${r.v == null ? " dim" : ""}"${r.v == null ? "" : ` data-count="${r.v}" data-key="win-${i}"`}>${r.v == null ? "not checked" : human(r.v)}</span><span class="go">→</span></button>`).join("");
  $$("#winsList .win").forEach(b => b.onclick = rows[+b.dataset.w].to);
  countUp($("#winsList"));
}
$("#winsRefresh").onclick = async () => {
  const b = $("#winsRefresh"); b.disabled = true; b.textContent = "Checking…";
  try { await Promise.all([measure(true), scanReels(true)]); await loadDrives(); toast("Quick wins updated"); }
  catch (e) { toast(e.message, true); }
  b.disabled = false; b.textContent = "Check again";
};

/* ------------------------------------------------------------- clean up */
const CAT_IC = { temp: "🌡️", update: "⬇️", crash: "💥", browser: "🌐", apps: "💬", thumbs: "🖼️", gpu: "🎮", dev: "🧰", bin: "🗑️" };
async function measure(quiet) {
  if (!quiet || !S.clean) $("#cleanList").innerHTML = '<div class="skeleton qt-card" style="height:84px"></div>'.repeat(6);
  $("#cleanGo").disabled = true;
  try {
    const v = await job("/api/clean/measure");
    S.clean = v.result;
    S.clean.rows.forEach(r => r.sel = r.default && r.status === "ready");
    renderClean();
  } catch (e) { toast("Measuring failed: " + e.message, true); }
}
function renderClean() {
  const rows = S.clean.rows;
  $("#adminNote").hidden = !rows.some(r => r.status === "admin");
  $("#cleanList").innerHTML = rows.map((r, i) => {
    const can = r.status === "ready" || r.status === "permanent";
    const st = { clean: "clean", admin: "needs admin", permanent: "permanent" }[r.status] || "";
    return `<div class="cat qt-card ${can ? "" : "off"} ${r.sel ? "sel" : ""} ${r.id === "recycle" ? "danger" : ""}" data-i="${i}" style="animation-delay:${i * 35}ms">
      <label class="ck" onclick="event.stopPropagation()"><input type="checkbox" ${r.sel ? "checked" : ""} ${can ? "" : "disabled"} data-i="${i}" aria-label="${esc(r.name)}"><span></span></label>
      <span class="ci">${CAT_IC[r.icon] || "📁"}</span>
      <div><b>${esc(r.name)}${st ? `<span class="st ${r.status}">${st}</span>` : ""}</b><p>${esc(r.desc)}</p>
        ${r.last ? `<p class="last">Last cleaned ${esc(agoStr(r.last.at))}${r.last.bytes ? " · " + human(r.last.bytes) : ""}</p>` : ""}</div>
      <div class="sz"><b${r.bytes == null ? "" : ` data-count="${r.bytes}" data-key="cat-${r.id}"`}>${r.bytes == null ? "–" : human(r.bytes)}</b><span>${r.bytes == null ? "" : nice(r.files) + (r.id === "recycle" ? " items" : " files")}</span></div></div>`;
  }).join("");
  countUp($("#cleanList"));
  updateCleanTotal();
}
$("#cleanList").addEventListener("change", e => {
  const i = e.target.dataset.i; if (i == null) return;
  S.clean.rows[i].sel = e.target.checked;
  e.target.closest(".cat").classList.toggle("sel", e.target.checked);
  updateCleanTotal();
});
$("#cleanList").addEventListener("click", e => {
  const c = e.target.closest(".cat"); if (!c) return;
  const cb = $("input", c); if (cb.disabled) return;
  cb.checked = !cb.checked; cb.dispatchEvent(new Event("change", { bubbles: true }));
});
const agoStr = t => { const d = new Date(String(t).replace(" ", "T")); return isNaN(d) ? t : ago(d.getTime() / 1000); };
/* "Select all" never includes the Recycle Bin: that one is always ticked on its own */
$("#cleanAll").onclick = () => {
  if (!S.clean) return;
  const can = S.clean.rows.filter(r => r.status === "ready");
  const all = can.every(r => r.sel);
  can.forEach(r => r.sel = !all);
  $$("#cleanList .cat").forEach(c => { const r = S.clean.rows[c.dataset.i]; c.classList.toggle("sel", !!r.sel); const cb = $("input", c); if (cb) cb.checked = !!r.sel; });
  updateCleanTotal();
};
function updateCleanTotal() {
  const sel = S.clean.rows.filter(r => r.sel), tot = sel.reduce((a, r) => a + (r.bytes || 0), 0);
  $("#cleanGo").disabled = !sel.length;
  $("#cleanGo").textContent = sel.length ? `Clean ${human(tot)}` : "Clean selected";
  const can = S.clean.rows.filter(r => r.status === "ready");
  $("#cleanAll").textContent = can.length && can.every(r => r.sel) ? "Select none" : "Select all";
  $("#cleanAll").disabled = !can.length;
  const ready = S.clean.rows.filter(r => r.status === "ready" && r.default && r.id !== "recycle").reduce((a, r) => a + r.bytes, 0);
  $("#b-clean").textContent = ready > 100 * 1024 * 1024 ? human(ready) : "";
}
$("#cleanScan").onclick = () => measure();
$("#cleanGo").onclick = async () => {
  const sel = S.clean.rows.filter(r => r.sel), bin = sel.some(r => r.id === "recycle");
  const tot = sel.reduce((a, r) => a + (r.bytes || 0), 0);
  const ok = await confirmBox({
    title: "Clean these up?", total: tot, ok: "Clean now", danger: bin,
    lead: "These caches and leftovers are deleted. Apps make them again when they need them. Anything in use is skipped.",
    items: sel.map(r => ({ path: r.name, bytes: r.bytes })),
    extra: bin ? `<label class="agree"><label class="ck"><input type="checkbox" id="agree"><span></span></label>Also empty the Recycle Bin for good. I know I can't get those files back.</label>` : "",
  });
  if (!ok) return;
  const b = $("#cleanGo"); b.disabled = true; b.textContent = "Cleaning…";
  try {
    const v = await job("/api/clean/run", { ids: sel.map(r => r.id), confirm: "yes", confirm_bin: bin ? "EMPTY" : "" }, v => { b.textContent = v.msg + "…"; });
    const res = v.result.results;
    await resultBox("All clean", v.result.freed, res.map(r => ({ a: r.name, b: `${human(r.freed)}${r.skipped ? ` · ${nice(r.skipped)} in use, skipped` : ""}` })));
  } catch (e) { toast(e.message, true); }
  measure(); loadDrives();
};
$("#adminBtn").onclick = async () => {
  const ok = await confirmBox({ title: "Restart as admin?", ok: "Restart", lead: "Windows will ask for permission. Space Manager restarts with admin rights so it can clean the Windows temp and update folders, then this page reconnects." });
  if (!ok) return;
  try {
    const r = await api("/api/admin", {});
    if (!r.ok) return toast(r.msg, true);
    toast("Restarting with admin rights…");
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 500));
      try { const inf = await api("/api/info"); if (inf.admin) { location.reload(); return; } } catch {}
    }
    toast("It didn't come back. Start Space Manager again.", true);
  } catch (e) { toast(e.message, true); }
};

/* ----------------------------------------------------------- what's big */
function quickRoots() {
  const c = INFO.config || {};
  const roots = [["C:\\", "C:"], ["D:\\", "D:"], [INFO.home, "Home"], [c.reels_root, "Reels"], [INFO.home && INFO.home + "\\Downloads", "Downloads"]];
  $("#quickRoots").innerHTML = roots.filter(r => r[0]).map(r => `<button data-root="${esc(r[0])}"><b>›</b> ${esc(r[1])}</button>`).join("");
}
$("#quickRoots").addEventListener("click", e => { const b = e.target.closest("[data-root]"); if (b) { $("#bigPath").value = b.dataset.root; startScan(); } });
$("#bigScan").onclick = () => startScan();
$("#bigPath").addEventListener("keydown", e => { if (e.key === "Enter") startScan(); });
let scanJob = null;
async function startScan() {
  const root = $("#bigPath").value.trim();
  if (!root) return $("#bigPath").focus();
  $("#bigProg").hidden = false; $("#bigEmpty").hidden = true;
  $("#bigScan").disabled = true;
  const bar = $("#bigProgBar");
  try {
    const v = await job("/api/scan", { root }, v => {
      scanJob = v.id;
      const pct = v.total ? Math.min(99, v.done / v.total * 100) : 0;
      bar.parentElement.classList.toggle("indet", !v.total);
      bar.style.width = pct + "%";
      $("#bigProgTxt").textContent = v.state === "running" ? `Scanning · ${human(v.done)}${v.total ? " of " + human(v.total) : ""} · ${Math.round(v.secs)} s` : "Done";
      $("#bigProgPath").textContent = v.msg;
    });
    if (v.state === "cancelled") { toast("Scan cancelled"); if (!S.view) $("#bigEmpty").hidden = false; }
    else {
      const r = v.result;
      toast(`Scanned ${nice(r.files)} files in ${Math.round(v.secs)} s`);
      S.dupes = null;
      await openDir(r.root, true);
    }
  } catch (e) { toast(e.message, true); if (!S.view) $("#bigEmpty").hidden = false; }
  $("#bigProg").hidden = true; $("#bigScan").disabled = false; scanJob = null;
}
$("#bigCancel").onclick = () => scanJob && api("/api/job/cancel", { id: scanJob });

async function openDir(path, fresh) {
  try { S.view = await api("/api/scan/view?path=" + encodeURIComponent(path || "")); }
  catch (e) { return toast(e.message, true); }
  if (S.path !== S.view.path && S.sub === "folders" && S.q) { S.q = ""; $("#bigFilter").value = ""; }
  S.path = S.view.path;
  if (fresh || !S.extras) S.extras = await api("/api/scan/extras").catch(() => null);
  $("#bigBody").hidden = false; $("#bigEmpty").hidden = true;
  $("#scanInfo").textContent = `${S.view.root} · scanned ${ago(S.view.at)}`;
  $("#b-old").textContent = S.extras?.old.length ? human(S.extras.old_bytes) : "";
  $("#b-rebuild").textContent = S.extras?.rebuild.length ? human(S.extras.rebuild_bytes) : "";
  if (fresh) S.sub = "folders";
  sub(S.sub);
}

function sub(name) {
  S.sub = name;
  $$("#subtabs button").forEach(b => b.classList.toggle("on", b.dataset.sub === name));
  S.sel.clear();
  renderBig();
}
$("#subtabs").addEventListener("click", e => { const b = e.target.closest("[data-sub]"); if (b) sub(b.dataset.sub); });

const KIND_IC = { video: "🎞️", image: "🖼️", audio: "🎵", archive: "🗜️", "disk image": "💿", installer: "📀", "3d / project": "🧊", "game data": "🎮", "code / text": "📄", documents: "📑", "models / ai": "🧠", other: "📄" };
const EXT = {}; ["mp4 mkv mov avi webm m4v wmv flv ts mts:video", "jpg jpeg png gif webp bmp tif tiff heic psd exr raw:image", "mp3 wav flac m4a aac ogg opus:audio",
  "zip rar 7z tar gz xz zst:archive", "iso img vhd vhdx vmdk wim esd:disk image", "exe msi msix apk:installer", "blend fbx obj glb uasset aep prproj drp:3d / project",
  "pak pck vpk bundle assets dat bin blk chk:game data", "safetensors ckpt gguf onnx pt pth:models / ai"].forEach(l => { const [e, k] = l.split(":"); e.split(" ").forEach(x => EXT[x] = k); });
const kindOf = n => EXT[(n.split(".").pop() || "").toLowerCase()] || "other";

function rowHtml(x, i, { dir, max, sub, locked, icon }) {
  const pct = max ? x.bytes / max * 100 : 0;
  const checked = S.sel.has(x.path);
  return `<div class="it ${dir ? "dir" : ""} ${checked ? "sel" : ""}" data-p="${esc(x.path)}" ${dir ? 'data-dir="1"' : ""} style="--i:${Math.min(i, 40)}">
    <span class="fill" data-w="${pct.toFixed(2)}"></span>
    ${locked ? `<span title="${esc(locked)}">🔒</span>` : `<label class="ck"><input type="checkbox" ${checked ? "checked" : ""} aria-label="Select ${esc(x.name)}"><span></span></label>`}
    <span class="ico">${icon || (dir ? "📁" : KIND_IC[kindOf(x.name)])}</span>
    <div class="nm"><b title="${esc(x.path)}">${esc(x.name)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</div>
    <span class="sz">${human(x.bytes)}</span>
    <span class="pc">${max ? (x.bytes / (S.view?.bytes || 1) * 100).toFixed(1) + "%" : ""}</span>
    <span class="dt">${day(x.mtime)}</span>
    <span class="acts"><button class="mini" data-act="reveal" title="Show in Explorer">↗</button>${locked ? "" : `<button class="mini" data-act="inbox" title="Move to D: Inbox">⇥</button><button class="mini bad" data-act="recycle" title="Send to Recycle Bin">🗑</button>`}</span>
  </div>`;
}

/* Filter + sort for every list view. Keeps the original objects, so selection by path still works. */
function shape(arr) {
  const q = (S.q || "").toLowerCase();
  let out = q ? arr.filter(r => (r.name + " " + r.path).toLowerCase().includes(q)) : arr.slice();
  if (S.sort === "name") out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  else if (S.sort === "date") out.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
  else out.sort((a, b) => b.bytes - a.bytes);
  return out;
}
const maxOf = arr => arr.reduce((m, r) => Math.max(m, r.bytes || 0), 0) || 1;
const filteredNote = (shown, all) => S.q && shown < all ? `<div class="fnote qt-muted">Showing ${shown} of ${all} matching “${esc(S.q)}”. <button class="linkbtn" data-clearq>Clear filter</button></div>` : "";

function renderBig() {
  const v = S.view, x = S.extras, list = $("#bigList");
  const crumbs = $("#crumbs");
  crumbs.hidden = S.sub !== "folders";
  $("#listTools").hidden = S.sub === "types";
  S.rows = new Map();
  const reg = arr => arr.forEach(r => S.rows.set(r.path, r));
  if (S.sub === "folders") {
    crumbs.innerHTML = v.crumbs.map((c, i) => `${i ? '<span class="sep">›</span>' : ""}<button data-crumb="${esc(c.path)}">${esc(c.name)}</button>`).join("")
      + `<span class="tot"><b>${human(v.bytes)}</b> · ${nice(v.files)} files${v.loose ? ` · ${human(v.loose)} loose here` : ""}</span>`;
    const allFiles = v.big.filter(f => f.path.toLowerCase().startsWith(v.path.replace(/\\$/, "").toLowerCase() + "\\") && !f.path.slice(v.path.replace(/\\$/, "").length + 1).includes("\\"));
    const folders = shape(v.folders), files = shape(allFiles), max = maxOf(v.folders.concat(allFiles));
    reg(folders); reg(files);
    list.innerHTML = filteredNote(folders.length + files.length, v.folders.length + allFiles.length)
      + (folders.length || files.length ? "" : S.q ? emptyMsg("Nothing matches that filter.") : `<div class="empty"><h2>Nothing big in here</h2><p class="qt-muted">No folders over 1 MB.</p></div>`)
      + folders.map((f, i) => rowHtml(f, i, { dir: true, max, locked: f.protected })).join("")
      + files.map((f, i) => rowHtml(f, i + folders.length, { max, locked: f.protected })).join("");
  } else if (S.sub === "files") {
    const big = shape(v.big); reg(big);
    list.innerHTML = note(`The biggest files anywhere inside <b>${esc(v.path)}</b> (${INFO.config.big_file_mb} MB and up).`) + filteredNote(big.length, v.big.length)
      + (big.length ? big.map((f, i) => rowHtml(f, i, { max: maxOf(v.big), sub: parentOf(f.path), locked: f.protected })).join("") : emptyMsg(S.q ? "Nothing matches that filter." : "No big files here."));
  } else if (S.sub === "old") {
    const old = shape(x.old); reg(old);
    list.innerHTML = note(`Big files nobody has changed in over a year. They're usually safe to archive on D:. <b>${human(x.old_bytes)}</b> in ${x.old.length} files.`) + filteredNote(old.length, x.old.length)
      + (old.length ? old.map((f, i) => rowHtml(f, i, { max: maxOf(x.old), sub: parentOf(f.path), locked: f.protected })).join("") : emptyMsg(S.q ? "Nothing matches that filter." : "Nothing old and big. Tidy!"));
  } else if (S.sub === "rebuild") {
    const rb = shape(x.rebuild.map(r => ({ ...r, name: r.project + " · " + r.label }))); reg(rb);
    list.innerHTML = note(`Package and build folders that tools can make again (node_modules, Python venvs, build caches). The project won't run until you reinstall or rebuild it, so pick ones you're done with, not tools you use every day. <b>${human(x.rebuild_bytes)}</b> in ${x.rebuild.length} folders.`)
      + filteredNote(rb.length, x.rebuild.length)
      + (rb.length ? rb.map((r, i) => rowHtml(r, i, { max: maxOf(x.rebuild), sub: r.how + " — " + r.path, locked: r.protected, icon: "📦" })).join("") : emptyMsg(S.q ? "Nothing matches that filter." : "No rebuildable folders over 1 MB."));
  } else if (S.sub === "dupes") {
    renderDupes(list, reg);
  } else if (S.sub === "types") {
    const max = x.kinds[0]?.bytes || 1;
    list.innerHTML = note(`What fills <b>${esc(x.root)}</b>, by kind of file.`)
      + `<div class="types">${x.kinds.map((k, i) => `<div class="type" style="--i:${i}"><b>${KIND_IC[k.kind] || ""} ${esc(k.kind)}</b><div class="tb"><i data-w="${(k.bytes / max * 100).toFixed(2)}"></i></div><span>${human(k.bytes)}</span><small>${nice(k.files)} files</small></div>`).join("")}</div>`;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => $$("#bigList [data-w]").forEach(i => i.style.width = i.dataset.w + "%")));
  S.cur = -1; S.anchor = null;
  syncAll();
  renderSelbar();
}
/* the header checkbox reflects the rows that are shown and can be selected */
const pickable = () => $$("#bigList .it").filter(r => $("input", r));
function syncAll() {
  const rows = pickable(), n = rows.filter(r => S.sel.has(r.dataset.p)).length, a = $("#bigAll");
  a.disabled = !rows.length; a.checked = rows.length > 0 && n === rows.length; a.indeterminate = n > 0 && n < rows.length;
}
$("#bigAll").onchange = e => {
  pickable().forEach(r => { const p = r.dataset.p; if (e.target.checked) S.sel.set(p, S.rows.get(p)?.bytes || 0); else S.sel.delete(p); r.classList.toggle("sel", e.target.checked); $("input", r).checked = e.target.checked; });
  syncAll(); renderSelbar();
};
let fT;
$("#bigFilter").addEventListener("input", e => { clearTimeout(fT); fT = setTimeout(() => { S.q = e.target.value.trim(); renderBig(); }, 120); });
$("#bigFilter").addEventListener("keydown", e => { if (e.key === "Escape") { e.target.value = ""; S.q = ""; renderBig(); e.target.blur(); } if (e.key === "ArrowDown") { e.preventDefault(); e.target.blur(); moveCur(1); } });
$("#bigSort").addEventListener("click", e => { const b = e.target.closest("[data-sort]"); if (!b) return; S.sort = b.dataset.sort; $$("#bigSort button").forEach(x => x.classList.toggle("on", x === b)); renderBig(); });
$("#bigList").addEventListener("click", e => { if (e.target.closest("[data-clearq]")) { $("#bigFilter").value = ""; S.q = ""; renderBig(); } });

/* keyboard: a cursor row you can move with the arrows */
function moveCur(d) {
  const rows = $$("#bigList .it"); if (!rows.length) return;
  S.cur = Math.max(0, Math.min(rows.length - 1, (S.cur ?? -1) + d));
  rows.forEach((r, i) => r.classList.toggle("cur", i === S.cur));
  rows[S.cur].scrollIntoView({ block: "nearest" });
}
const parentOf = p => p.replace(/\\[^\\]+$/, "");
const note = (html, btn) => `<div class="note qt-card"><p>${html}</p>${btn || ""}</div>`;
const emptyMsg = t => `<div class="empty"><h2>${esc(t)}</h2></div>`;

function renderDupes(list, reg) {
  if (!S.dupes) {
    list.innerHTML = note("Finds files that are exact copies of each other, among the big files from this scan. Every byte is compared, so it can take a minute for videos.",
      `<button class="qt-btn primary" id="dupeGo">Find duplicates</button>`);
    $("#dupeGo").onclick = async () => {
      const b = $("#dupeGo"); b.disabled = true;
      try {
        const v = await job("/api/dupes", {}, v => b.textContent = v.total ? `Checking ${Math.round(v.done / v.total * 100)}%` : v.msg + "…");
        S.dupes = v.result;
        if (S.sub === "dupes") renderBig();
      } catch (e) { toast(e.message, true); b.disabled = false; b.textContent = "Find duplicates"; }
    };
    return;
  }
  const g = S.dupes.groups;
  g.forEach(x => reg(x.copies.map(c => ({ ...c, bytes: x.bytes }))));
  list.innerHTML = note(g.length ? `<b>${human(S.dupes.waste)}</b> is spent on extra copies in ${g.length} groups. The oldest copy is listed first.` : "No duplicate big files. 🎉",
    g.length ? `<button class="qt-btn" id="selExtra">Select extra copies (keep oldest)</button>` : "")
    + g.map((x, gi) => `<div class="group qt-card"><h3><span class="kchip">${x.copies.length} copies</span>${human(x.bytes)} each · ${human(x.waste)} extra</h3>
      ${x.copies.map((c, i) => rowHtml({ ...c, bytes: x.bytes }, gi + i, { sub: parentOf(c.path) + (i === 0 ? "  ·  oldest" : "") })).join("")}</div>`).join("");
  $("#selExtra") && ($("#selExtra").onclick = () => { g.forEach(x => x.copies.slice(1).forEach(c => S.sel.set(c.path, x.bytes))); renderBig(); });
}

$("#crumbs").addEventListener("click", e => { const b = e.target.closest("[data-crumb]"); if (b) openDir(b.dataset.crumb); });
$("#bigList").addEventListener("click", e => {
  const row = e.target.closest(".it"); if (!row) return;
  const p = row.dataset.p, r = S.rows.get(p);
  const act = e.target.closest("[data-act]");
  if (act) { e.stopPropagation(); return doAction(act.dataset.act, [{ path: p, bytes: r?.bytes || 0 }]); }
  if (e.target.closest(".ck")) { S.shift = e.shiftKey; return; }
  S.cur = $$("#bigList .it").indexOf(row); $$("#bigList .it").forEach(x => x.classList.toggle("cur", x === row));
  if (row.dataset.dir && !e.shiftKey && !e.ctrlKey) return openDir(p);
  S.shift = e.shiftKey;
  toggleSel(row);
});
$("#bigList").addEventListener("change", e => {
  const row = e.target.closest(".it"); if (!row || e.target.type !== "checkbox") return;
  const on = e.target.checked, rows = pickable();
  // shift-click selects (or clears) the whole range from the last row you clicked
  const targets = S.shift && S.anchor && rows.includes(S.anchor)
    ? rows.slice(Math.min(rows.indexOf(S.anchor), rows.indexOf(row)), Math.max(rows.indexOf(S.anchor), rows.indexOf(row)) + 1) : [row];
  targets.forEach(r => { const p = r.dataset.p; if (on) S.sel.set(p, S.rows.get(p)?.bytes || 0); else S.sel.delete(p); r.classList.toggle("sel", on); $("input", r).checked = on; });
  S.anchor = row; S.shift = false;
  syncAll(); renderSelbar();
});
function toggleSel(row) {
  const cb = $("input", row); if (!cb) return;
  cb.checked = !cb.checked; cb.dispatchEvent(new Event("change", { bubbles: true }));
}
addEventListener("keydown", e => {
  if (S.tab !== "big" || !$("#modal").hidden || $("#bigBody").hidden) return;
  const tg = e.target.matches ? e.target : document.body;
  if (tg.matches("input:not([type=checkbox]),textarea,select")) return;
  if (tg.matches("button") && (e.key === "Enter" || e.key === " ")) return;
  const rows = $$("#bigList .it"), cur = rows[S.cur];
  if (e.key === "/" ) { e.preventDefault(); $("#bigFilter").focus(); $("#bigFilter").select(); }
  else if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); moveCur(1); }
  else if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); moveCur(-1); }
  else if (e.key === "Home") { e.preventDefault(); S.cur = -1; moveCur(1); }
  else if (e.key === "End") { e.preventDefault(); S.cur = rows.length; moveCur(-1); }
  else if (e.key === "Enter" && cur) { e.preventDefault(); if (cur.dataset.dir) openDir(cur.dataset.p); else api("/api/reveal", { path: cur.dataset.p }).catch(er => toast(er.message, true)); }
  else if (e.key === " " && cur) { e.preventDefault(); S.shift = e.shiftKey; toggleSel(cur); }
  else if (e.key === "Delete") {
    e.preventDefault();
    const items = S.sel.size ? selItems() : cur && $("input", cur) ? [{ path: cur.dataset.p, bytes: S.rows.get(cur.dataset.p)?.bytes || 0 }] : [];
    if (items.length) doAction("recycle", items);  // still goes through the confirm dialog
  }
  else if (e.key === "a" && e.ctrlKey) { e.preventDefault(); const a = $("#bigAll"); a.checked = !a.checked; a.onchange({ target: a }); }
  else if (e.key === "Backspace" && S.sub === "folders" && S.view?.crumbs.length > 1) { e.preventDefault(); openDir(S.view.crumbs.at(-2).path); }
  else if (e.key === "Escape" && S.sel.size) { S.sel.clear(); renderBig(); }
});

function renderSelbar() {
  const on = S.tab === "big" && S.sel.size > 0;
  $("#selbar").hidden = !on;
  if (!on) { S.selN = 0; return; }
  const tot = [...S.sel.values()].reduce((a, b) => a + b, 0), t = $("#selTxt");
  t.textContent = `${S.sel.size} selected · ${human(tot)}`;
  if (S.selN !== S.sel.size) { t.classList.remove("bump"); void t.offsetWidth; t.classList.add("bump"); }
  S.selN = S.sel.size;
}
$("#selClear").onclick = () => { S.sel.clear(); renderBig(); };
const selItems = () => [...S.sel].map(([path, bytes]) => ({ path, bytes }));
$("#selReveal").onclick = () => doAction("reveal", selItems());
$("#selCopy").onclick = async () => { const it = selItems(); await copyText(it.map(i => i.path).join("\r\n")); toast(`Copied ${it.length} path${it.length > 1 ? "s" : ""}`); };
$("#selInbox").onclick = () => doAction("inbox", selItems());
$("#selRecycle").onclick = () => doAction("recycle", selItems());

async function doAction(act, items) {
  if (!items.length) return;
  if (act === "reveal") { for (const i of items.slice(0, 5)) await api("/api/reveal", { path: i.path }).catch(e => toast(e.message, true)); return; }
  const tot = items.reduce((a, i) => a + (i.bytes || 0), 0);
  if (act === "recycle") {
    const ok = await confirmBox({ title: `Recycle ${items.length === 1 ? "this" : items.length + " items"}?`, total: tot, ok: "Send to Recycle Bin", danger: true, items,
      lead: "They go to the Recycle Bin, so you can restore them from there. The space comes back once the bin is emptied. If something is too big for the bin, Windows asks you first." });
    if (!ok) return;
    try {
      const r = await api("/api/recycle", { paths: items.map(i => i.path), confirm: "yes" });
      afterChange(r.results, `${human(r.freed)} sent to the Recycle Bin`, { label: "Open bin", fn: () => openPlace("bin") });
    } catch (e) { toast(e.message, true); }
  } else if (act === "inbox") {
    if (!INFO.inbox_ok) return toast(`The inbox (${INFO.config.inbox}) isn't there. Is D: plugged in?`, true);
    const ok = await confirmBox({ title: `Move ${items.length === 1 ? "this" : items.length + " items"} to D:?`, total: tot, ok: "Move to D: Inbox", items,
      lead: `They go to <b>${esc(INFO.config.inbox)}\\From-Space-Manager-${new Date().toISOString().slice(0, 10)}</b>. Folders are moved with robocopy and checked. Anything in use stays where it is.` });
    if (!ok) return;
    const t = document.createElement("div"); t.className = "qt-toast"; t.textContent = "Moving…"; $("#toasts").append(t);
    try {
      const v = await job("/api/inbox", { paths: items.map(i => i.path), confirm: "yes" }, v => t.textContent = v.msg + "…");
      t.remove();
      afterChange(v.result.results, `Moved ${human(v.result.results.filter(x => x.ok).reduce((a, x) => a + (x.bytes || 0), 0))} to the D: Inbox`,
        { label: "Show", fn: () => api("/api/reveal", { path: v.result.dest }).catch(e => toast(e.message, true)) });
    } catch (e) { t.remove(); toast(e.message, true); }
  }
}
/* rows that were just recycled or moved slide away and fold up before the list is redrawn */
async function vanish(paths) {
  const set = new Set(paths.map(p => p.toLowerCase()));
  const rows = $$("#bigList .it").filter(r => set.has(r.dataset.p.toLowerCase()));
  if (!rows.length || REDUCED.matches) return;
  rows.slice(0, 30).forEach((r, i) => { r.style.setProperty("--h", r.offsetHeight + "px"); r.style.animationDelay = i * 35 + "ms"; r.classList.add("bye"); });
  await new Promise(res => setTimeout(res, 460 + Math.min(rows.length, 30) * 35));
}
async function afterChange(results, okMsg, action) {
  const bad = results.filter(r => !r.ok), good = results.filter(r => r.ok);
  good.forEach(r => S.sel.delete(r.path));
  if (good.length) { await vanish(good.map(r => r.path)); toast(okMsg, false, action); }
  if (bad.length) await resultBox(bad.length === results.length ? "That didn't work" : "Some were left alone", null, bad.map(r => ({ a: r.path, b: r.msg, bad: true })));
  if (S.view) {
    if (S.dupes) S.dupes.groups = S.dupes.groups.map(g => ({ ...g, copies: g.copies.filter(c => !good.some(r => r.path === c.path)) })).filter(g => g.copies.length > 1);
    S.extras = await api("/api/scan/extras").catch(() => S.extras);
    await openDir(S.path, false);  // one redraw with fresh sizes
  }
  loadDrives();
}

/* ---------------------------------------------------------------- reels */
async function scanReels(quiet) {
  if (!quiet || !S.reels) $("#reelList").innerHTML = '<div class="skeleton qt-card" style="height:46px"></div>'.repeat(6);
  try {
    const v = await job("/api/reels/scan", {}, v => { if (!quiet && v.total) $("#reelsSub").textContent = `Checking ${v.msg} (${v.done}/${v.total})…`; });
    S.reels = v.result;
    renderReels();
  } catch (e) { toast("Couldn't check the reels: " + e.message, true); }
}
function renderReels() {
  const r = S.reels;
  $("#reelsSub").innerHTML = r.missing ? `The reels folder <b>${esc(r.root)}</b> isn't there. Change it in Settings.`
    : `Finished reels keep their final mp4 and project files on C:. Their <b>plates</b> and <b>render</b> folders go to <b>${esc(r.archive)}</b>, with a note left behind.`;
  $("#reelList").innerHTML = r.rows.map((x, i) => `<div class="reel ${x.selected ? "sel" : ""}" style="--i:${Math.min(i, 40)}" data-i="${i}">
    <label class="ck"><input type="checkbox" ${x.selected ? "checked" : ""} ${x.can_move ? "" : "disabled"} data-i="${i}" aria-label="${esc(x.post)}"><span></span></label>
    <b>${esc(x.post)}</b><span class="m">${human(x.bytes)}</span><span class="pill ${x.tone}">${esc(x.status)}</span>
    <span class="f" title="${esc(x.final)}">${esc(x.final || "–")}</span><span class="m">${x.node_modules ? human(x.node_modules) : "–"}</span><span class="d">${day(x.mtime)}</span></div>`).join("")
    || emptyMsg("No reels found.");
  updateReels();
}
$("#reelList").addEventListener("change", e => {
  const i = e.target.dataset.i; if (i == null) return;
  S.reels.rows[i].selected = e.target.checked;
  e.target.closest(".reel").classList.toggle("sel", e.target.checked);
  updateReels();
});
$("#reelsAll").onchange = e => { S.reels.rows.forEach(r => { if (r.can_move) r.selected = e.target.checked; }); renderReels(); };
function updateReels() {
  const rows = S.reels.rows, sel = rows.filter(r => r.selected), mov = rows.filter(r => r.can_move);
  const tot = sel.reduce((a, r) => a + r.bytes, 0);
  $("#reelsGo").disabled = !sel.length;
  $("#reelsGo").textContent = sel.length ? `Move ${human(tot)} to D:` : "Move frames to D:";
  const all = $("#reelsAll"); all.checked = mov.length && sel.length === mov.length; all.indeterminate = sel.length > 0 && sel.length < mov.length; all.disabled = !mov.length;
  const ready = rows.filter(r => r.can_move && r.tone === "go").reduce((a, r) => a + r.bytes, 0);
  $("#b-reels").textContent = ready ? human(ready) : "";
}
$("#reelsScan").onclick = () => scanReels();
$("#reelsGo").onclick = async () => {
  const sel = S.reels.rows.filter(r => r.selected), tot = sel.reduce((a, r) => a + r.bytes, 0);
  const editing = sel.filter(r => r.tone === "warn");
  const ok = await confirmBox({ title: `Move frames of ${sel.length} reel${sel.length > 1 ? "s" : ""}?`, total: tot, ok: "Move to D:",
    items: sel.map(r => ({ path: r.post + " · plates + renders", bytes: r.bytes })),
    lead: `Plates and render folders go to <b>${esc(S.reels.archive)}</b>. The final mp4 and project files stay on C:, and each reel gets a _frames-on-D.txt note.`,
    extra: editing.length ? `<div class="warnbox">⚠️ ${editing.map(r => esc(r.post)).join(", ")} changed in the last ${INFO.config.reel_min_age_hrs} h. Make sure you're done editing.</div>` : "" });
  if (!ok) return;
  const b = $("#reelsGo"); b.disabled = true;
  try {
    const v = await job("/api/reels/move", { posts: sel.map(r => r.post), confirm: "yes" }, v => b.textContent = v.msg + "…");
    await resultBox("Frames moved", v.result.freed, v.result.results.map(r => ({ a: r.post, b: r.ok ? `${human(r.bytes)} · ${nice(r.files)} files` : r.msg, bad: !r.ok })));
  } catch (e) { toast(e.message, true); }
  scanReels(); loadDrives();
};

/* ------------------------------------------------------------- activity */
const ACT = { CLEAN: "🧹 Cleaned", "EMPTY-RECYCLE-BIN": "🗑️ Emptied bin", RECYCLE: "🗑️ Recycled", MOVE: "⇥ Moved", "MOVE-PARTIAL": "⚠️ Part moved", "MOVE-REEL-FRAMES": "🎬 Reel frames", SCAN: "◔ Scanned" };
const LOG_KIND = { CLEAN: "freed", "EMPTY-RECYCLE-BIN": "freed", RECYCLE: "freed", MOVE: "moved", "MOVE-REEL-FRAMES": "moved", "MOVE-PARTIAL": "problem", SCAN: "scan" };
async function loadLog() {
  try {
    const r = await api("/api/log?limit=1500");
    S.log = r;
    $("#logPath").textContent = r.path;
    // a server started before this update has no stats yet: show zeros instead of breaking
    const z = { freed: 0, moved: 0, actions: 0 }, st = r.stats || { month: z, ever: z, since: "" }, since = st.since ? new Date(st.since.replace(" ", "T")).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
    const mon = new Date().toLocaleDateString("en-GB", { month: "long" });
    $("#logStats").innerHTML = [
      ["Freed in " + mon, st.month.freed, "🧹"], ["Moved to D: in " + mon, st.month.moved, "⇥"],
      ["Freed in total", st.ever.freed, "✨"], ["Moved in total", st.ever.moved, "📦"],
    ].map(([l, v, ic], i) => `<div class="stat qt-card" style="--i:${i}"><span class="si">${ic}</span><div><b data-count="${v}">${human(v)}</b><small>${esc(l)}</small></div></div>`).join("")
      + (since ? `<p class="since qt-muted">Since ${esc(since)} · ${nice(st.ever.actions)} actions</p>` : "");
    countUp($("#logStats"));
    renderLog();
  } catch (e) { toast(e.message, true); }
}
function renderLog() {
  const k = S.logKind || "all", q = (S.logQ || "").toLowerCase();
  const rows = S.log.rows.filter(x => (k === "all" || LOG_KIND[x.Action] === k || (k === "problem" && /skipped [1-9]|left [1-9]|partial/i.test(x.Detail + x.Action)))
    && (!q || (x.Path + " " + x.Detail + " " + x.Action + " " + x.Time).toLowerCase().includes(q)));
  $("#logCount").textContent = rows.length === S.log.rows.length ? `${nice(rows.length)} entries` : `${nice(rows.length)} of ${nice(S.log.rows.length)}`;
  const shown = rows.slice(0, 400);
  $("#logList").innerHTML = shown.length ? shown.map((x, i) => `<div class="lg k-${LOG_KIND[x.Action] || "other"}" style="--i:${Math.min(i, 40)}"><span class="t">${esc(x.Time)}</span><span class="a">${esc(ACT[x.Action] || x.Action)}</span>
      <div class="p"><div title="${esc(x.Path)}">${esc(x.Path || "–")}</div><small>${esc(x.Detail)}</small></div><span class="b">${+x.Bytes ? human(+x.Bytes) : ""}</span>
      ${x.Path && /^[A-Z]:\\/i.test(x.Path) ? `<button class="mini" data-reveal="${esc(x.Action === "MOVE" ? (x.Detail.match(/^to (.+)$/) || [])[1] || x.Path : x.Path)}" title="Show in Explorer">↗</button>` : "<span></span>"}</div>`).join("")
      + (rows.length > shown.length ? `<p class="fnote qt-muted">${nice(rows.length - shown.length)} older entries hidden. Search to find them.</p>` : "")
    : emptyMsg(S.log.rows.length ? "Nothing matches." : "Nothing yet. Everything Space Manager moves or deletes shows up here.");
}
$("#logKind").addEventListener("click", e => { const b = e.target.closest("[data-k]"); if (!b) return; S.logKind = b.dataset.k; $$("#logKind button").forEach(x => x.classList.toggle("on", x === b)); renderLog(); });
let lT;
$("#logFilter").addEventListener("input", e => { clearTimeout(lT); lT = setTimeout(() => { S.logQ = e.target.value.trim(); renderLog(); }, 120); });
$("#logList").addEventListener("click", e => { const b = e.target.closest("[data-reveal]"); if (b) api("/api/reveal", { path: b.dataset.reveal }).catch(er => toast(er.message, true)); });

/* ------------------------------------------------------------- settings */
$("#settingsBtn").onclick = async () => {
  const c = INFO.config, F = [["scan_root", "Default folder for What's big"], ["inbox", "D: inbox (Move to D:)"], ["reels_root", "Reels folder on C:"],
    ["reels_archive", "Where finished reel frames go"], ["log_dir", "Log folder (when D: is plugged in)"], ["big_file_mb", "Big file threshold (MB)"], ["reel_min_age_hrs", "Don't pre-select reels changed in the last (hours)"]];
  const vals = await modal(`<h2 id="mTitle">Settings</h2><p>Space Manager ${esc(INFO.version)}${INFO.admin ? " · admin" : ""}</p>
    <div class="form">${F.map(([k, l]) => `<label>${esc(l)}<input class="qt-input mono" name="${k}" value="${esc(c[k])}" spellcheck="false"></label>`).join("")}</div>
    <div class="btns"><button class="qt-btn ghost" data-reset>Defaults</button><span class="grow"></span><button class="qt-btn" data-x="cancel">Cancel</button><button class="qt-btn primary" data-x="ok">Save</button></div>`,
    { value: d => Object.fromEntries($$("input", d).map(i => [i.name, i.value])),
      init: d => { $("[data-reset]", d).onclick = () => $$("input", d).forEach(i => i.value = INFO.defaults[i.name]); } });
  if (!vals) return;
  try { INFO.config = await api("/api/config", vals); toast("Saved"); quickRoots(); S.reels = null; } catch (e) { toast(e.message, true); }
};

/* ---------------------------------------------------------------- start */
(async function init() {
  try { INFO = await api("/api/info"); } catch (e) { return toast("Space Manager isn't answering", true); }
  INFO.home = INFO.config.reels_root.replace(/\\[^\\]+\\reels$/i, "");
  if (!/^[A-Z]:\\Users\\[^\\]+$/i.test(INFO.home)) INFO.home = "";
  $("#adminChip").hidden = !INFO.admin;
  $("#sandboxChip").hidden = !INFO.sandbox;
  $("#bigPath").value = INFO.scan?.root || INFO.config.scan_root;
  quickRoots();
  movePill();
  let tab = "overview";
  try { tab = sessionStorage.getItem("sm-tab") || tab; } catch {}
  go(tab);
  if (INFO.scan) openDir(INFO.scan.root, true);
  // fill the quick wins in the background
  const last = await api("/api/last?kind=measure").catch(() => null);
  if (last) { S.clean = last.result; S.clean.rows.forEach(r => r.sel = r.default && r.status === "ready"); renderClean(); }
  else measure(true).then(loadDrives);
  const lr = await api("/api/last?kind=reels").catch(() => null);
  if (lr) { S.reels = lr.result; renderReels(); } else scanReels(true).then(loadDrives);
})();
document.fonts?.ready.then(movePill);
// web fonts arrive late (and the suite may show us while hidden), so follow the tab sizes themselves
if (window.ResizeObserver) { const ro = new ResizeObserver(() => movePill()); $$("#tabs button").forEach(b => ro.observe(b)); }
document.fonts?.addEventListener?.("loadingdone", movePill);
