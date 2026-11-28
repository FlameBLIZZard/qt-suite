"use strict";
const $ = (s, el = document) => el.querySelector(s);
const PALETTE = ["#ff5d6c", "#ff8a3d", "#ffc93d", "#c6ff3d", "#5dffb0", "#4dc3ff", "#b28bff", "#ff5fa2"];
const TOGGLES = [
  ["mic_to_out", "Send my mic", "Your voice goes out with the clips"],
  ["sounds_to_out", "Send clips to mic", "Friends in Discord or the game hear them"],
  ["sounds_to_mon", "Hear clips myself", "Plays in your headphones too"],
  ["mic_to_mon", "Hear my mic myself", "Use headphones, or it will echo"],
  ["on_top", "Classic window on top", "Only matters if the old window is open"],
];
const local = ["127.0.0.1", "localhost"].includes(location.hostname);
if (!local) document.body.classList.add("remote");
const hasKeys = matchMedia("(hover: hover) and (pointer: fine)").matches;
if (hasKeys) document.body.classList.add("keys");
const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;

let S = null, editing = null, dragging = false, pollMs = local ? 150 : 300;
let holdOrderUntil = 0;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const box = $("#pads");

function toast(msg, bad) {
  const t = document.createElement("div");
  t.className = "qt-toast" + (bad ? " bad" : "");
  t.textContent = msg;
  $("#toasts").append(t);
  setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 320); }, 2200);
}

async function act(op, extra = {}) {
  try {
    const r = await fetch("/api/act", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op, ...extra }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.statusText);
    poll(true);
    return j;
  } catch (e) { toast(e.message, true); throw e; }
}
function vibrate(ms) { try { if (!local && navigator.vibrate) navigator.vibrate(ms); } catch {} }

/* ---------------- pads (keyed: pads keep their element, so only new ones animate in) ---------------- */
function hotkeyLabel(hk) { return hk ? hk.toUpperCase().replace(/\+/g, " + ") : ""; }
function colorFor(id) { let h = 0; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; }
function fmt(sec) { sec = Math.max(0, Math.ceil(sec)); return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0"); }

function padInner(p) {
  return `<span class="fx"></span>
    ${p.loop ? '<span class="badge l">LOOP</span>' : ""}${p.volume !== 100 ? `<span class="badge">${p.volume}%</span>` : ""}
    <span class="kn"></span>
    <span class="nm">${p.state === "error" ? "⚠ " : ""}${esc(p.name)}</span>
    <span class="sub">${p.state === "loading" ? "loading…" : p.state === "error" ? "can't load · hold to fix" : esc(hotkeyLabel(p.hotkey))}</span>
    <span class="tm qt-mono"></span>
    <span class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
    <span class="prog"><i></i></span>`;
}

function positions() { const m = new Map(); for (const el of box.children) if (el.dataset.id) m.set(el, [el.offsetLeft, el.offsetTop]); return m; }
function flip(before, skip) {
  if (calm) return;
  for (const [el, [x, y]] of before) {
    if (el === skip || !el.isConnected) continue;
    const dx = x - el.offsetLeft, dy = y - el.offsetTop;
    if (dx || dy) el.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: "none" }], { duration: 260, easing: "cubic-bezier(.2,.9,.2,1)" });
  }
}

const prog = new Map(); // id -> {p, t, dur, loop, playing}
let prevPlaying = new Set(), lastLocalFire = new Map(), lastCount = null;

function renderPads() {
  $("#count").textContent = S.pads.length ? S.pads.length : "";
  if (lastCount !== null && S.pads.length > lastCount) bump($("#count"));
  lastCount = S.pads.length;
  $("#searchWrap").hidden = S.pads.length < 7;
  $("#randomBtn").hidden = S.pads.length < 2;

  if (!S.pads.length) {
    if (!box.querySelector(".empty")) box.innerHTML = `<div class="empty"><span class="empty-art" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span><b>No sounds yet</b>Add .mp3, .wav or .ogg files and each one becomes a pad.</div>`;
    return;
  }
  box.querySelector(".empty")?.remove();

  const reordering = press && press.drag;
  const els = new Map([...box.querySelectorAll(".pad:not(.gone)")].map(el => [el.dataset.id, el]));
  const before = positions();
  let moved = false;
  S.pads.forEach((p, i) => {
    let el = els.get(p.id);
    const sig = [p.name, p.hotkey, p.loop, p.state, p.volume].join("|");
    if (!el) {
      el = document.createElement("button");
      el.dataset.id = p.id;
      el.style.setProperty("--c", colorFor(p.id));
      el.style.setProperty("--i", Math.min(i, 12));
      el.classList.add("pad", "new");
      el.addEventListener("animationend", ev => { if (ev.animationName === "padIn") el.classList.remove("new"); });
    }
    els.delete(p.id);
    if (el.dataset.sig !== sig) {
      el.dataset.sig = sig;
      el.className = el.className.replace(/\b(ready|loading|error|loop)\b/g, "").trim() + ` ${p.state}${p.loop ? " loop" : ""}`;
      el.title = p.file + (p.dur ? ` · ${fmt(p.dur)}` : "");
      el.innerHTML = padInner(p);
    }
    if (!reordering && Date.now() > holdOrderUntil && box.children[i] !== el) { box.insertBefore(el, box.children[i] || null); moved = true; }
    else if (!el.isConnected) { box.append(el); moved = true; }
  });
  for (const el of els.values()) { // gone from the server: shrink out
    el.classList.add("gone");
    setTimeout(() => el.remove(), calm ? 0 : 320);
  }
  if (moved) flip(before);

  // live bits: playing, time left, flash when fired from a hotkey or another device
  const now = performance.now(), playingNow = new Set();
  for (const p of S.pads) {
    const el = box.querySelector(`.pad[data-id="${p.id}"]`);
    if (!el) continue;
    if (p.playing) {
      playingNow.add(p.id);
      if (!prevPlaying.has(p.id) && now - (lastLocalFire.get(p.id) || 0) > 600) firePad(el);
    } else if (prevPlaying.has(p.id) && el.classList.contains("playing")) {
      el.classList.add("ended"); setTimeout(() => el.classList.remove("ended"), 450);
    }
    el.classList.toggle("playing", p.playing);
    prog.set(p.id, { p: p.progress, t: now, dur: p.dur, loop: p.loop, playing: p.playing });
  }
  prevPlaying = playingNow;
  applyFilter();
}

/* smooth progress bars + time left, between polls */
function animProgress(now) {
  for (const el of box.querySelectorAll(".pad.playing")) {
    const s = prog.get(el.dataset.id); if (!s || !s.playing) continue;
    let p = s.p;
    if (s.dur > 0) { p += (now - s.t) / 1000 / s.dur; p = s.loop ? p % 1 : Math.min(1, p); }
    el.querySelector(".prog i").style.transform = `scaleX(${p.toFixed(4)})`;
    el.querySelector(".tm").textContent = s.loop ? "loop" : s.dur ? "-" + fmt(s.dur * (1 - p)) : "";
  }
}

function firePad(el, x, y) {
  el.classList.remove("fire"); void el.offsetWidth; el.classList.add("fire");
  if (calm) return;
  const fx = el.querySelector(".fx"); if (!fx) return;
  const r = el.getBoundingClientRect();
  const dot = document.createElement("i");
  dot.style.left = (x == null ? r.width / 2 : x - r.left) + "px";
  dot.style.top = (y == null ? r.height / 2 : y - r.top) + "px";
  fx.append(dot);
  dot.addEventListener("animationend", () => dot.remove());
}
function bump(el) { el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump"); }

function playEl(el, x, y) {
  const p = S.pads.find(q => q.id === el.dataset.id); if (!p) return;
  if (p.state === "error") return openEditor(p.id);
  if (p.state === "loading") return toast("Still loading that one…");
  lastLocalFire.set(p.id, performance.now());
  const stopping = p.playing && (p.loop || S.tap_mode === "stop");
  if (stopping) { el.classList.remove("playing"); el.classList.add("ended"); setTimeout(() => el.classList.remove("ended"), 450); }
  else firePad(el, x, y);
  vibrate(stopping ? [8, 40, 8] : 12);
  act("play", { id: p.id }).catch(() => {});
}

/* ---------------- tap / long-press / drag to reorder (mouse) ---------------- */
let press = null;
box.addEventListener("pointerdown", e => {
  const el = e.target.closest(".pad"); if (!el || e.button !== 0 || el.classList.contains("gone")) return;
  press = { el, id: el.dataset.id, x: e.clientX, y: e.clientY, type: e.pointerType, long: false, drag: false, cancel: false };
  el.classList.add("down");
  press.timer = setTimeout(() => {
    if (!press || press.drag || press.cancel) return;
    press.long = true; el.classList.remove("down"); vibrate(20); openEditor(press.id);
  }, 520);
});
addEventListener("pointermove", e => {
  if (!press || press.cancel || press.long) return;
  let dx = e.clientX - press.x, dy = e.clientY - press.y;
  if (!press.drag) {
    if (Math.hypot(dx, dy) < 8) return;
    clearTimeout(press.timer); press.el.classList.remove("down");
    if (press.type !== "mouse" || $("#search").value) { press.cancel = true; return; }
    press.drag = true; press.order = S.pads.map(p => p.id).join();
    press.el.classList.add("dragging"); document.body.classList.add("reordering");
  }
  const el = press.el;
  el.style.pointerEvents = "none";
  const over = document.elementFromPoint(e.clientX, e.clientY)?.closest(".pad");
  el.style.pointerEvents = "";
  if (over && over !== el && !over.classList.contains("gone")) {
    const kids = [...box.children], a = kids.indexOf(el), b = kids.indexOf(over);
    const bx = el.offsetLeft, by = el.offsetTop, before = positions();
    box.insertBefore(el, a < b ? over.nextSibling : over);
    press.x += el.offsetLeft - bx; press.y += el.offsetTop - by;
    dx = e.clientX - press.x; dy = e.clientY - press.y;
    flip(before, el);
  }
  el.style.transform = `translate(${dx}px,${dy}px) rotate(${Math.max(-6, Math.min(6, dx / 30))}deg) scale(1.07)`;
});
function endPress(e, cancelled) {
  if (!press) return;
  const p = press; press = null;
  clearTimeout(p.timer); p.el.classList.remove("down");
  if (p.drag) {
    const el = p.el, from = el.style.transform;
    el.classList.remove("dragging"); el.style.transform = ""; document.body.classList.remove("reordering");
    if (!calm && from) el.animate([{ transform: from }, { transform: "none" }], { duration: 320, easing: "cubic-bezier(.34,1.8,.5,1)" });
    const order = [...box.querySelectorAll(".pad:not(.gone)")].map(x => x.dataset.id);
    if (order.join() !== p.order) { holdOrderUntil = Date.now() + 1200; act("reorder", { order }).catch(() => {}); }
    return;
  }
  if (cancelled || p.long || p.cancel) return;
  if (e.target.closest && e.target.closest(".pad") === p.el) playEl(p.el, e.clientX, e.clientY);
}
addEventListener("pointerup", e => endPress(e, false));
addEventListener("pointercancel", e => endPress(e, true));
box.addEventListener("contextmenu", e => {
  const el = e.target.closest(".pad"); if (!el) return;
  e.preventDefault(); if (press) { clearTimeout(press.timer); press = null; } openEditor(el.dataset.id);
});
box.addEventListener("auxclick", e => { const el = e.target.closest(".pad"); if (el && e.button === 1) act("stop", { id: el.dataset.id }); });
box.addEventListener("keydown", e => { // keyboard users: Enter/Space on a focused pad
  const el = e.target.closest(".pad"); if (!el) return;
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); playEl(el); }
  if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) { e.preventDefault(); openEditor(el.dataset.id); }
});

/* ---------------- search + number keys ---------------- */
function visiblePads() { return [...box.querySelectorAll(".pad:not(.gone):not(.hide)")]; }
function applyFilter() {
  const q = $("#search").value.trim().toLowerCase();
  for (const el of box.querySelectorAll(".pad")) {
    const p = S.pads.find(x => x.id === el.dataset.id);
    const hit = !q || (p && (p.name.toLowerCase().includes(q) || p.hotkey.toLowerCase().includes(q) || p.file.toLowerCase().includes(q)));
    el.classList.toggle("hide", !hit);
  }
  visiblePads().forEach((el, i) => { const k = el.querySelector(".kn"); if (k) k.textContent = i < 10 ? String((i + 1) % 10) : ""; });
  let none = box.querySelector(".nohit");
  if (q && !visiblePads().length) {
    if (!none) { none = document.createElement("div"); none.className = "nohit qt-muted"; box.append(none); }
    none.textContent = `No pad matches “${$("#search").value.trim()}”`;
  } else none?.remove();
}
$("#search").addEventListener("input", applyFilter);
$("#search").addEventListener("keydown", e => {
  if (e.key === "Enter") { const el = visiblePads()[0]; if (el) playEl(el); }
  if (e.key === "Escape") { e.stopPropagation(); e.target.value = ""; applyFilter(); e.target.blur(); }
});

/* ---------------- editor sheet ---------------- */
const pv = new Audio(); pv.preload = "none";
function stopPreview() { pv.pause(); $("#padPreview").classList.remove("on"); $("#padPreview span").textContent = "Preview on this device"; $("#pvBar").style.transform = "scaleX(0)"; }
pv.addEventListener("ended", stopPreview);
pv.addEventListener("error", () => { if (pv.getAttribute("src")) { stopPreview(); toast("Couldn't preview that file here", true); } });
pv.addEventListener("timeupdate", () => { if (pv.duration) $("#pvBar").style.transform = `scaleX(${pv.currentTime / pv.duration})`; });
$("#padPreview").onclick = () => {
  if (!pv.paused) return stopPreview();
  const src = "/api/audio?id=" + encodeURIComponent(editing);
  if (pv.getAttribute("src") !== src) pv.src = src;
  pv.currentTime = 0;
  pv.play().then(() => { $("#padPreview").classList.add("on"); $("#padPreview span").textContent = "Stop preview"; }).catch(() => toast("Couldn't preview that file here", true));
};

function openEditor(id) {
  const p = S.pads.find(x => x.id === id); if (!p) return;
  editing = id;
  $("#sheet").style.setProperty("--c", colorFor(id));
  $("#sheetTitle").textContent = p.name;
  $("#sheetMeta").textContent = p.file + (p.dur ? " · " + fmt(p.dur) : "");
  $("#padName").value = p.name;
  $("#padVol").value = p.volume; setFill($("#padVol")); $("#padVolVal").textContent = p.volume + "%";
  $("#padLoop").setAttribute("aria-checked", p.loop);
  $("#padKey").textContent = p.hotkey ? hotkeyLabel(p.hotkey) : "Set";
  $("#padKeyClear").hidden = !p.hotkey;
  $("#padPreview").hidden = p.state === "error";
  $("#sheet").classList.remove("closing"); $("#sheetBack").classList.remove("closing");
  $("#sheet").hidden = $("#sheetBack").hidden = false;
  if (hasKeys) setTimeout(() => $("#padName").focus(), 60);
  if (p.state === "error") toast("Couldn't load " + p.file + ". Remove it, or put the file back and reopen Soundboard.", true);
}
function closeEditor() {
  if (editing === null) return;
  const name = $("#padName").value.trim(), p = S && S.pads.find(x => x.id === editing);
  if (p && name && name !== p.name) act("pad", { id: editing, name });
  editing = null; stopPreview();
  if (calm) { $("#sheet").hidden = $("#sheetBack").hidden = true; return; }
  $("#sheet").classList.add("closing"); $("#sheetBack").classList.add("closing");
  setTimeout(() => { if (editing === null) $("#sheet").hidden = $("#sheetBack").hidden = true; }, 200);
}
$("#sheetClose").onclick = closeEditor; $("#sheetBack").onclick = closeEditor;
$("#padName").addEventListener("keydown", e => { if (e.key === "Enter") closeEditor(); });
$("#padName").addEventListener("input", e => { $("#sheetTitle").textContent = e.target.value || "Pad"; });
$("#padVol").addEventListener("input", e => { setFill(e.target); $("#padVolVal").textContent = e.target.value + "%"; pv.volume = Math.min(1, e.target.value / 100); });
$("#padVol").addEventListener("change", e => act("pad", { id: editing, volume: +e.target.value }));
$("#padLoop").onclick = e => { const v = e.currentTarget.getAttribute("aria-checked") !== "true"; e.currentTarget.setAttribute("aria-checked", v); act("pad", { id: editing, loop: v }); };
$("#padLeft").onclick = () => { holdOrderUntil = 0; act("move", { id: editing, dir: -1 }); };
$("#padRight").onclick = () => { holdOrderUntil = 0; act("move", { id: editing, dir: 1 }); };
$("#padRemove").onclick = async e => {
  const b = e.currentTarget;
  if (!b.dataset.sure) { b.dataset.sure = 1; b.textContent = "Tap again to remove"; bump(b); setTimeout(() => { delete b.dataset.sure; b.textContent = "Remove"; }, 2500); return; }
  const id = editing; closeEditor();
  box.querySelector(`.pad[data-id="${id}"]`)?.classList.add("gone");
  await act("remove", { id }); toast("Pad removed");
};
$("#padKey").onclick = () => captureKey(hk => act("pad", { id: editing, hotkey: hk }).then(() => { $("#padKey").textContent = hotkeyLabel(hk); $("#padKeyClear").hidden = false; bump($("#padKey")); toast("Hotkey set: " + hotkeyLabel(hk)); }));
$("#padKeyClear").onclick = () => act("pad", { id: editing, hotkey: "" }).then(() => { $("#padKey").textContent = "Set"; $("#padKeyClear").hidden = true; });

/* ---------------- hotkey capture (turns a key press into "ctrl+shift+f1") ---------------- */
let capturing = false;
function captureKey(done) {
  const cap = $("#keycap"); cap.hidden = false; capturing = true; $("#keycapText").textContent = "for example Ctrl + Shift + 1";
  const MOD = { Control: "ctrl", Shift: "shift", Alt: "alt", Meta: "windows" };
  function name(e) {
    if (e.code.startsWith("Numpad")) return "num " + e.code.slice(6).toLowerCase();
    if (e.code.startsWith("Digit")) return e.code.slice(5);
    if (e.code.startsWith("Key")) return e.code.slice(3).toLowerCase();
    if (/^F\d+$/.test(e.key)) return e.key.toLowerCase();
    return ({ " ": "space", ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" }[e.key] || e.key.toLowerCase());
  }
  function onKey(e) {
    e.preventDefault(); e.stopPropagation();
    if (e.key === "Escape") return finish();
    const mods = ["ctrl", "shift", "alt", "windows"].filter(m => e[{ ctrl: "ctrlKey", shift: "shiftKey", alt: "altKey", windows: "metaKey" }[m]]);
    if (MOD[e.key]) { $("#keycapText").textContent = mods.map(m => m.toUpperCase()).join(" + ") + " + …"; return; }
    const hk = [...mods, name(e)].join("+");
    $("#keycapText").textContent = hotkeyLabel(hk); bump($("#keycapText"));
    setTimeout(() => { finish(); done(hk); }, 320);
  }
  function finish() { cap.hidden = true; capturing = false; removeEventListener("keydown", onKey, true); }
  addEventListener("keydown", onKey, true);
}
$("#stopKey").onclick = () => captureKey(hk => act("stop_hotkey", { value: hk }).then(() => toast("Stop-all key: " + hotkeyLabel(hk))));

/* ---------------- mixer, toggles, devices ---------------- */
function setFill(r) { r.style.setProperty("--p", ((r.value - r.min) / (r.max - r.min) * 100) + "%"); }
for (const [id, which, lbl] of [["micGain", "mic", "micVal"], ["clipGain", "clips", "clipVal"]]) {
  const r = $("#" + id);
  r.addEventListener("pointerdown", () => dragging = true);
  r.addEventListener("pointerup", () => dragging = false);
  r.addEventListener("input", () => { setFill(r); $("#" + lbl).textContent = r.value + "%"; });
  r.addEventListener("change", () => { dragging = false; act("gain", { which, value: +r.value }); });
  r.addEventListener("dblclick", () => { r.value = 100; setFill(r); $("#" + lbl).textContent = "100%"; bump($("#" + lbl)); act("gain", { which, value: 100 }); });
}
$("#toggles").innerHTML = TOGGLES.map(([k, t, s]) => `<div class="rowline${k === "on_top" ? " pc-only" : ""}"><span>${t}<small>${s}</small></span>
  <button class="qt-switch" role="switch" aria-checked="false" data-k="${k}" aria-label="${t}"></button></div>`).join("");
const pendingToggle = new Map();
$("#toggles").addEventListener("click", e => {
  const b = e.target.closest(".qt-switch"); if (!b) return;
  const v = b.getAttribute("aria-checked") !== "true";
  b.setAttribute("aria-checked", v); bump(b.closest(".rowline"));
  pendingToggle.set(b.dataset.k, Date.now() + 1500);
  act("toggle", { key: b.dataset.k, value: v }).finally(() => pendingToggle.delete(b.dataset.k));
});
$("#tapMode").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  setSeg($("#tapMode"), b.dataset.v); tapPending = Date.now() + 1500;
  act("tap_mode", { value: b.dataset.v }).then(() => toast(b.dataset.v === "stop" ? "Tapping a playing pad now stops it" : "Tapping a playing pad now restarts it"));
});
let tapPending = 0;
function setSeg(seg, v) {
  const btns = [...seg.querySelectorAll("button")];
  btns.forEach(b => b.setAttribute("aria-checked", b.dataset.v === v));
  const on = btns.find(b => b.dataset.v === v), ink = seg.querySelector("i");
  if (on && ink && on.offsetWidth) { ink.style.width = on.offsetWidth + "px"; ink.style.transform = `translateX(${on.offsetLeft}px)`; }
}
const DEVS = [["api", "Driver", "apis"], ["mic", "Your mic", "ins"], ["out", "Send to (virtual mic)", "outs"], ["mon", "Your headphones / speakers", "outs"]];
function renderDevices() {
  const d = S.devices, dbox = $("#devs");
  const sig = JSON.stringify(d);
  if (dbox.dataset.sig === sig) return;
  dbox.dataset.sig = sig;
  dbox.innerHTML = DEVS.map(([k, label, list]) => `<label>${label}<select data-k="${k}">${d[list].map(o => `<option${o === d[k] ? " selected" : ""}>${esc(o)}</option>`).join("")}</select></label>`).join("");
  const same = d.mon !== "(none)" && d.mon === d.out;
  dbox.querySelector('select[data-k="mon"]')?.classList.toggle("bad", same);
}
$("#devs").addEventListener("change", e => {
  const s = e.target.closest("select"); if (!s) return;
  act("device", { which: s.dataset.k, value: s.value }).then(() => toast("Audio restarted"));
});
$("#refresh").onclick = e => { const b = e.currentTarget; b.classList.add("spin"); act("refresh").then(() => toast("Devices rescanned")).finally(() => setTimeout(() => b.classList.remove("spin"), 500)); };
$("#warnFix").onclick = () => {
  const d = $("#devPanel"); d.open = true;
  d.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "center" });
  d.classList.remove("flash"); void d.offsetWidth; d.classList.add("flash");
};

/* meters: smoothed on every frame with a peak-hold tick */
const MET = { mic: { el: $("#micMeter"), pk: $("#micPk"), v: 0, t: 0, hold: 0, at: 0 }, clips: { el: $("#clipMeter"), pk: $("#clipPk"), v: 0, t: 0, hold: 0, at: 0 } };
function animMeters(now) {
  for (const m of Object.values(MET)) {
    m.v += (m.t - m.v) * (m.t > m.v ? .6 : .18);
    if (m.v >= m.hold) { m.hold = m.v; m.at = now; } else if (now - m.at > 800) m.hold = Math.max(m.v, m.hold - .012);
    m.el.style.transform = `scaleX(${m.v.toFixed(3)})`;
    m.el.classList.toggle("hot", m.v >= .8 && m.v < .95); m.el.classList.toggle("clip", m.v >= .95);
    m.pk.style.left = `calc(${(m.hold * 100).toFixed(1)}% - 3px)`;
    m.pk.style.opacity = m.hold > .02 ? 1 : 0;
  }
}

/* ---------------- state loop ---------------- */
let lastStatus = "";
function render() {
  const st = $("#status");
  st.classList.toggle("bad", !S.status.ok);
  $("#statusDot").className = "qt-dot " + (S.status.ok ? (S.warn ? "warn" : "on") : "bad");
  const text = S.status.text || (S.status.ok ? "Live" : "Not running");
  if (text !== lastStatus) {
    lastStatus = text; const t = $("#statusText");
    t.classList.remove("swap"); void t.offsetWidth; t.classList.add("swap"); t.textContent = text;
  }
  $("#hint").textContent = S.hint;
  const w = $("#warn");
  if (S.warn) { $("#warnText").textContent = S.warn; w.hidden = false; } else w.hidden = true;
  $("#stopAll").classList.toggle("live", S.pads.some(p => p.playing));
  if (!dragging && document.activeElement?.type !== "range") {
    for (const [id, v, lbl] of [["micGain", S.mic_gain, "micVal"], ["clipGain", S.sound_gain, "clipVal"]]) {
      const r = $("#" + id); r.value = v; setFill(r); $("#" + lbl).textContent = v + "%";
    }
  }
  MET.mic.t = S.meters.mic; MET.clips.t = S.meters.clips;
  document.querySelectorAll("#toggles .qt-switch").forEach(b => { if (!(pendingToggle.get(b.dataset.k) > Date.now())) b.setAttribute("aria-checked", !!S.toggles[b.dataset.k]); });
  if (Date.now() > tapPending) setSeg($("#tapMode"), S.tap_mode || "restart");
  $("#stopKey").textContent = S.stop_hotkey ? hotkeyLabel(S.stop_hotkey) : "Set";
  $("#winBtn").textContent = S.window ? "Hide" : "Show";
  renderDevices();
  renderPads();
  document.body.classList.add("ready");
}

function frame(now) { animMeters(now); animProgress(now); requestAnimationFrame(frame); }
requestAnimationFrame(frame);

let polling = false, fails = 0, lastPoll = 0;
async function poll(now) {
  if (polling && !now) return;
  // tucked away (another tab, or hidden inside QT Suite): check in every 2 s instead of 7 times a second
  if (!now && (document.hidden || innerWidth === 0) && Date.now() - lastPoll < 2000) return;
  lastPoll = Date.now();
  polling = true;
  try {
    const r = await fetch("/api/state", { cache: "no-store" });
    if (r.status === 401) { $("#statusText").textContent = "Open this from the link on your PC"; return; }
    const j = await r.json();
    if (j.rev !== -1) { S = j; render(); }
    if (fails >= 3) toast("Back in touch with Soundboard");
    fails = 0; document.body.classList.remove("offline");
  } catch {
    if (++fails === 3) { $("#statusText").textContent = "Soundboard isn't running"; $("#statusDot").className = "qt-dot bad"; document.body.classList.add("offline"); }
  } finally { polling = false; }
}
setInterval(poll, pollMs);
poll();
document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(true); });

/* ---------------- adding sounds ---------------- */
async function upload(files) {
  const list = [...files].filter(f => /\.(wav|mp3|ogg|flac|aiff?|opus)$/i.test(f.name) || f.type.startsWith("audio/"));
  if (!list.length) { nope($("#uploadBtn")); return toast("Those aren't audio files", true); }
  const lbl = $("#uploadBtn span"), btn = $("#uploadBtn");
  btn.classList.add("busy");
  let ok = 0, bad = 0, lastName = "";
  for (let i = 0; i < list.length; i++) {
    lbl.textContent = `Adding ${i + 1}/${list.length}…`;
    btn.style.setProperty("--up", (i / list.length * 100) + "%");
    try {
      const r = await fetch("/api/upload?name=" + encodeURIComponent(list[i].name), { method: "POST", body: list[i] });
      const j = await r.json(); if (!r.ok) throw new Error(j.error);
      ok++; lastName = list[i].name;
    } catch (e) { bad++; toast(e.message, true); }
  }
  btn.classList.remove("busy"); btn.style.removeProperty("--up");
  lbl.textContent = "Add sounds";
  if (ok) toast(ok === 1 ? "Added " + lastName : `Added ${ok} sounds`);
  if (bad) nope(btn);
  poll(true);
}
$("#upload").addEventListener("change", e => { upload(e.target.files); e.target.value = ""; });
$("#addFolder").onclick = () => act("folder_dialog").then(() => toast("Pick a folder in the window on your PC"));
let dragDepth = 0;
addEventListener("dragenter", e => { if (e.dataTransfer?.types.includes("Files")) { dragDepth++; $("#drop").classList.add("on"); } });
addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; $("#drop").classList.remove("on"); } });
addEventListener("dragover", e => e.preventDefault());
addEventListener("drop", e => { e.preventDefault(); dragDepth = 0; $("#drop").classList.remove("on"); if (e.dataTransfer?.files.length) upload(e.dataTransfer.files); });

/* ---------------- stop all, random, keys ---------------- */
function stopAll() {
  const playing = [...box.querySelectorAll(".pad.playing")];
  act("stop_all");
  vibrate([10, 30, 10]);
  const b = $("#stopAll"); bump(b);
  if (!calm) {
    const r = b.getBoundingClientRect(), w = document.createElement("div");
    w.className = "shock"; w.style.left = r.left + r.width / 2 + "px"; w.style.top = r.top + r.height / 2 + "px";
    document.body.append(w); w.addEventListener("animationend", () => w.remove());
  }
  playing.forEach((p, i) => { p.classList.remove("playing"); p.style.setProperty("--d", i * 40 + "ms"); p.classList.add("ended"); setTimeout(() => p.classList.remove("ended"), 500 + i * 40); });
}
$("#stopAll").onclick = stopAll;
async function randomPad() {
  const d = $("#randomBtn .dice"); d.classList.remove("roll"); void d.getBoundingClientRect(); d.classList.add("roll");
  try {
    const j = await act("random");
    const el = box.querySelector(`.pad[data-id="${j.id}"]`);
    if (el) { lastLocalFire.set(j.id, performance.now()); firePad(el); el.scrollIntoView({ block: "nearest", behavior: calm ? "auto" : "smooth" }); }
  } catch {}
}
$("#randomBtn").onclick = randomPad;
addEventListener("keydown", e => {
  if (capturing) return;
  const typing = e.target.closest?.("input, select, textarea") && e.target.type !== "range";
  if (e.key === "Escape") { if (!$("#sheet").hidden) closeEditor(); else stopAll(); return; }
  if (typing || e.ctrlKey || e.altKey || e.metaKey || !$("#sheet").hidden) return;
  if (e.key === "/") { e.preventDefault(); if (!$("#searchWrap").hidden) $("#search").focus(); return; }
  if (/^[0-9]$/.test(e.key) && !e.repeat) {
    const el = visiblePads()[(+e.key + 9) % 10]; if (el) { e.preventDefault(); el.classList.add("down"); setTimeout(() => el.classList.remove("down"), 110); playEl(el); }
    return;
  }
  if ((e.key === "r" || e.key === "R") && !e.repeat && S && S.pads.length > 1) randomPad();
});
$("#winBtn").onclick = () => act("window", { show: !S.window });

/* ---------------- phone link (Wi-Fi and Tailscale) ---------------- */
function drawQR(url) {
  const qr = qrcode(0, "M"); qr.addData(url); qr.make();
  const n = qr.getModuleCount();
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c},${r}h1v1h-1z`;
  const q = $("#qr");
  q.innerHTML = `<svg viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><path d="${d}" fill="#16141a"/></svg>`;
  q.classList.remove("swap"); void q.offsetWidth; q.classList.add("swap");
  $("#link").textContent = url;
  $("#copyLink").onclick = async () => {
    try { await navigator.clipboard.writeText(url); toast("Link copied"); bump($("#copyLink")); } catch { toast("Copy the link by hand", true); }
  };
}
async function showLink() {
  if (!local) return;
  try {
    const j = await (await fetch("/api/link")).json();
    const items = j.items || (j.links || []).map(url => ({ url, kind: "wifi" }));
    if (!items.length) { $("#phone").hidden = true; return; }
    const kinds = [...new Set(items.map(i => i.kind))];
    const tabs = $("#linkTabs");
    if (kinds.length > 1) {
      tabs.hidden = false;
      tabs.innerHTML = kinds.map(k => `<button role="tab" data-v="${k}" aria-checked="false">${k === "wifi" ? "Same Wi-Fi" : "Anywhere (Tailscale)"}</button>`).join("") + "<i></i>";
      tabs.onclick = e => { const b = e.target.closest("button"); if (!b) return; setSeg(tabs, b.dataset.v); drawQR(items.find(i => i.kind === b.dataset.v).url); };
      $("#morePanel").addEventListener("toggle", () => setSeg(tabs, tabs.querySelector('[aria-checked="true"]')?.dataset.v || kinds[0]));
      setSeg(tabs, kinds[0]);
    }
    drawQR(items[0].url);
  } catch { $("#phone").hidden = true; }
}
showLink();
$("#morePanel").addEventListener("toggle", () => setSeg($("#tapMode"), S?.tap_mode || "restart"));

// loop 30: a refused file shakes the button "no" (the server checks the file really is audio)
function nope(el) {
  if (!el || matchMedia("(prefers-reduced-motion: reduce)").matches || !el.animate) return;
  el.animate([{ transform: "none" }, { transform: "translateX(-7px) rotate(-3deg)" }, { transform: "translateX(6px) rotate(2deg)" },
    { transform: "translateX(-4px)" }, { transform: "translateX(2px)" }, { transform: "none" }], { duration: 420, easing: "ease-out" });
  el.animate([{ boxShadow: "0 0 0 0 transparent" }, { boxShadow: "0 0 0 5px var(--qt-bad)" }, { boxShadow: "0 0 0 0 transparent" }], { duration: 600 });
}
