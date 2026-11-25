/* Daily - today at a glance. Works at http://127.0.0.1:7799/, inside QT Suite, and on the phone at Beam's /daily/. */
"use strict";
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const VIA_BEAM = location.pathname.startsWith("/daily");
const IN_SUITE = window.top !== window.self;
const TOOL_PORT = { kharcha: [7788, "/kharcha"], lens: [7797, "/"], volt: [7777, "/"], space: [7793, "/"] };
const NAMES = { kharcha: "Kharcha", lens: "Lens PC", volt: "VOLT", space: "Space Manager", beam: "Beam" };
const REFRESH = 30000;
let data = null, last = 0, busy = false, cur = "₹";
const seen = {};

/* ---------- formatting ---------- */
function money(v, dec) {
  const n = Math.abs(v || 0);
  const s = n.toLocaleString("en-IN", { maximumFractionDigits: dec ? 2 : 0, minimumFractionDigits: 0 });
  return (v < 0 ? "-" : "") + cur + s;
}
function bytes(b, short) {
  const a = Math.abs(b || 0), u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0, n = a;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  const s = (n >= 100 || i === 0 ? Math.round(n) : n >= 10 ? n.toFixed(1) : n.toFixed(2)).toString().replace(/\.0+$|(\.\d*[1-9])0+$/, "$1");
  return (b < 0 ? "-" : "") + s + (short ? u[i][0] : " " + u[i]);
}
function ago(sec) {
  if (!sec) return "never";
  const d = Math.max(0, Date.now() / 1000 - sec);
  if (d < 60) return "just now";
  if (d < 3600) return Math.round(d / 60) + " min ago";
  if (d < 86400) return Math.round(d / 3600) + " h ago";
  const days = Math.round(d / 86400);
  return days === 1 ? "yesterday" : days + " days ago";
}
const clock = ms => new Date(ms).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
function dayLabel(ms) {
  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  const diff = Math.round((d0 - new Date(ms).setHours(0, 0, 0, 0)) / 864e5);
  if (diff <= 0) return "Today"; if (diff === 1) return "Yday";
  if (diff < 7) return new Date(ms).toLocaleDateString("en-IN", { weekday: "short" });
  return new Date(ms).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

/* ---------- network ---------- */
async function api(path, opts) {
  const r = await fetch("api/" + path, Object.assign({ cache: "no-store" }, opts));
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
  return r.json();
}
function toast(msg, bad) {
  const t = document.createElement("div");
  t.className = "qt-toast" + (bad ? " bad" : "");
  t.textContent = msg;
  $("#toasts").append(t);
  setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 350); }, 3200);
}

/* ---------- count-up ---------- */
function countUp(el, to, fmt) {
  const from = +el.dataset.v || 0;
  el.dataset.v = to;
  if (from === to || matchMedia("(prefers-reduced-motion: reduce)").matches) { el.textContent = fmt(to); return; }
  const t0 = performance.now(), dur = 700;
  const step = now => {
    const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    el.textContent = fmt(from + (to - from) * e);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function setSticker(id, val, fmt, sub, off) {
  const b = $("#s-" + id), card = b.closest(".sticker");
  card.classList.toggle("off", !!off);
  if (off) { b.textContent = "—"; b.dataset.v = 0; }
  else {
    if (+b.dataset.v !== val && b.dataset.v !== undefined) { card.classList.remove("bump"); void card.offsetWidth; card.classList.add("bump"); }
    countUp(b, val, fmt);
  }
  $("#s-" + id + "2").textContent = sub || " ";
}

/* ---------- shared bits ---------- */
function offState(tool, msg, startable = true) {
  return `<div class="empty"><div class="ico">💤</div><p>${esc(msg)}</p>${startable ? `<button class="qt-btn primary" data-start="${tool}">Start ${esc(NAMES[tool])}</button>` : ""}</div>`;
}
function emptyState(ico, msg, extra = "") {
  return `<div class="empty"><div class="ico">${ico}</div><p>${msg}</p>${extra}</div>`;
}

/* ---------- money ---------- */
function renderMoney(m) {
  const el = $("#moneyBody");
  if (!m.ok) {
    setSticker("money", 0, String, "Kharcha not synced", true);
    el.innerHTML = m.why === "nosync" ? emptyState("📲", esc(m.msg)) : offState("beam", m.msg || "Couldn't read Kharcha.", false);
    return;
  }
  cur = m.cur || "₹";
  const left = m.left;
  setSticker("money", m.today, v => money(v), m.stale && !m.count ? "not synced today" : m.count ? `${plural(m.count, "payment")}${left != null ? " · " + money(Math.abs(left)) + (left >= 0 ? " left" : " over") : ""}` :
    left != null ? money(left) + " safe to spend" : "nothing spent yet");
  const max = Math.max(1, ...m.week.map(w => w.v));
  const mo = m.month, pct = mo.spendable ? Math.min(100, mo.spent / mo.spendable * 100) : 0;
  const dayPct = (Date.now() - mo.start) / (mo.end - mo.start) * 100;
  const pill = left == null ? "" : left >= 0
    ? `<span class="pill pop">${money(left)} left today</span>`
    : `<span class="pill bad pop">${money(-left)} over today</span>`;
  const vsY = m.yesterday ? (m.today > m.yesterday ? `more than yesterday's ${money(m.yesterday)}` : `vs ${money(m.yesterday)} yesterday`) : "nothing yesterday";
  el.innerHTML = `
    <div class="big"><div><div class="num" id="mNum" data-v="${+($("#mNum") || {}).dataset?.v || 0}">${money(+($("#mNum") || {}).dataset?.v || 0)}</div><div class="sub">${m.count ? plural(m.count, "payment") + " · " : ""}${vsY}</div></div>${pill}</div>
    ${mo.spendable ? `<div class="month"><div class="row"><span>This month <b>${money(mo.spent)}</b> of ${money(mo.spendable)}</span><span>${plural(mo.days_left, "day")} left</span></div>
      <div class="qt-bar${mo.spent > mo.spendable ? " over" : ""}" title="Month so far: ${Math.round(pct)}% spent, ${Math.round(dayPct)}% of the month gone"><i style="width:0" data-w="${pct}"></i></div></div>` : ""}
    ${m.week.some(w => w.v) ? `<div class="week" aria-label="Last 7 days">${m.week.map((w, i) => `<div class="wk${w.v ? " has" : ""}${i === 6 ? " today" : ""}" data-tip="${dayLabel(w.d)}: ${money(w.v)}"><i data-h="${Math.max(5, w.v / max * 100)}"></i><span>${i === 6 ? "Today" : new Date(w.d).toLocaleDateString("en-IN", { weekday: "narrow" })}</span></div>`).join("")}</div>` : `<div class="sub">No spending in the last 7 days.</div>`}
    ${addForm(m)}
    ${m.tx.length ? `<div class="list">${m.tx.map((t, i) => `<div class="li${t.pending ? " pending" : ""}" style="animation-delay:${i * 40}ms"><div class="em">${esc(t.emoji)}</div><div class="grow"><div class="t">${esc(t.note || t.name)}</div><div class="s">${esc(t.name)} · ${clock(t.ts)}${t.mode ? " · " + esc(t.mode) : ""}${t.pending ? " · ⏳ waiting for the phone" : ""}</div></div><div class="amt">${money(t.amt, true)}</div>${t.pending ? `<button class="qt-btn ghost icon x" data-undo="${esc(t.pid)}" title="Take it back" aria-label="Take it back">✕</button>` : ""}</div>`).join("")}</div>`
      : emptyState("🪙", "No spending logged today. Nice.")}
    <div class="meta"><span class="qt-chip${m.stale ? " warn" : ""}" title="Kharcha sends its data when you open it on the phone">📲 ${m.stale ? "phone last synced " + ago(m.synced) + ", open Kharcha to update" : "synced " + ago(m.synced)}</span>${m.pending ? `<span class="qt-chip">${plural(m.pending, "entry")} waiting for the phone</span>` : ""}</div>`;
  countUp($("#mNum"), m.today, v => money(v));
  requestAnimationFrame(() => requestAnimationFrame(() => {
    el.querySelectorAll("[data-w]").forEach(i => i.style.width = i.dataset.w + "%");
    el.querySelectorAll("[data-h]").forEach(i => i.style.height = i.dataset.h + "%");
  }));
}

let addOpen = false, addCat = null;
function addForm(m) {
  if (!m.catlist || !m.catlist.length) return "";
  if (!addOpen) return `<button class="qt-btn add-btn" data-add-open>＋ Log a payment</button>`;
  addCat = addCat || m.catlist[0].id;
  return `<form class="addf" id="addf" autocomplete="off">
    <div class="addrow"><span class="cur">${esc(cur)}</span><input class="qt-input amt-in" id="a-amt" inputmode="decimal" placeholder="0" aria-label="Amount" required>
      <input class="qt-input" id="a-note" placeholder="What for? (optional)" maxlength="80" aria-label="Note"></div>
    <div class="catpick" role="radiogroup" aria-label="Category">${m.catlist.map(c => `<button type="button" class="cat${c.id === addCat ? " on" : ""}" data-cat="${esc(c.id)}" role="radio" aria-checked="${c.id === addCat}"><span>${esc(c.emoji)}</span>${esc(c.name)}</button>`).join("")}</div>
    <div class="addact"><span class="sub">Goes to Kharcha next time you open it on the phone.</span><button type="button" class="qt-btn" data-add-close>Cancel</button><button class="qt-btn primary">Add</button></div>
  </form>`;
}
async function submitAdd(f) {
  const amt = parseFloat(f.querySelector("#a-amt").value.replace(/[, ]/g, ""));
  if (!(amt > 0)) { f.querySelector("#a-amt").focus(); f.classList.remove("shake"); void f.offsetWidth; f.classList.add("shake"); return; }
  const btn = f.querySelector(".primary"); btn.disabled = true;
  try {
    await api("kharcha/add", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amt, cat: addCat, note: f.querySelector("#a-note").value.trim() }) });
    addOpen = false;
    burst(btn, ["var(--qt-kharcha)", "var(--qt-fg)", "var(--qt-daily)"]);
    toast(`${money(amt, true)} logged. Kharcha gets it on the phone.`);
    load();
  } catch (e) { btn.disabled = false; toast(e.message || "Couldn't add it", true); }
}
document.addEventListener("submit", e => { if (e.target.id === "addf") { e.preventDefault(); submitAdd(e.target); } });

/* ---------- photos ---------- */
function renderPhotos(p) {
  const el = $("#photosBody");
  if (!p.ok) { setSticker("photos", 0, String, "Lens PC is off", true); el.innerHTML = offState("lens", p.msg); return; }
  setSticker("photos", p.today, v => Math.round(v), p.today ? `${p.today_phone} from the phone` : `${p.week} this week`);
  const tilt = [-2.2, 1.4, -1, 2, 1.2, -1.8, 1.6, -.8, 2.2, -1.4, .9, -2];
  const t0 = new Date().setHours(0, 0, 0, 0);
  el.innerHTML = `
    <div class="big"><div><div class="num">${p.today}<small>today</small></div><div class="sub">${p.yesterday} yesterday · ${p.week} this week · ${p.total.toLocaleString("en-IN")} in all</div></div>
      ${p.videos_today ? `<span class="pill dim">🎬 ${plural(p.videos_today, "video")}</span>` : ""}</div>
    ${p.latest.length ? `<div class="shots">${p.latest.map((x, i) => `<button class="shot" style="--r:${tilt[i]}deg;animation-delay:${i * 45}ms" data-k="${esc(x.k)}" data-i="${i}" title="${esc(dayLabel(x.t))}, ${clock(x.t)}"><img alt="" loading="lazy" src="api/thumb/${encodeURIComponent(x.k)}" onload="this.classList.add('in')"><span class="tag${x.t >= t0 ? " new" : ""}">${x.t >= t0 ? "NEW" : esc(dayLabel(x.t))}</span>${x.v ? '<span class="vid"></span>' : ""}</button>`).join("")}</div>`
      : emptyState("📷", "No photos yet. Add a folder in Lens PC, or sync the phone with the Beam app.")}
    ${p.memories && p.memories.items.length ? `<div class="mem"><div class="qt-eyebrow">✨ ${esc(p.memories.label)}</div><div class="memrow">${p.memories.items.map((x, i) => `<button class="shot polaroid" data-set="mem" data-i="${i}" style="--r:${[-4, 3, -2, 4, -3, 2][i]}deg;animation-delay:${300 + i * 70}ms" title="${esc(x.ago)}"><img alt="" loading="lazy" src="api/thumb/${encodeURIComponent(x.k)}" onload="this.classList.add('in')">${x.v ? '<span class="vid"></span>' : ""}<span class="cap">${esc(x.ago)}</span></button>`).join("")}</div></div>` : ""}
    <div class="meta"><span class="qt-chip">📱 ${(p.counts.phone || 0).toLocaleString("en-IN")} phone</span><span class="qt-chip">💻 ${(p.counts.pc || 0).toLocaleString("en-IN")} PC</span><span class="qt-chip" title="The Beam phone app sends the phone's photos">phone sync ${ago(p.phone_sync)}</span></div>`;
}

/* ---------- downloads ---------- */
function jobRow(j, i) {
  const live = j.state !== "done";
  const th = j.turl ? `<img class="th" alt="" loading="lazy" src="api/vthumb?u=${encodeURIComponent(j.turl)}" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'em',textContent:'${j.kind === "audio" || j.mode === "mp3" ? "🎵" : "🎬"}'}))">`
    : `<div class="em">${j.kind === "audio" || j.mode === "mp3" ? "🎵" : j.kind === "image" ? "🖼️" : "🎬"}</div>`;
  return `<div class="li job" style="animation-delay:${i * 40}ms">${th}<div class="grow"><div class="t" title="${esc(j.title)}">${esc(j.title)}</div>
    <div class="s">${live ? `<span class="state ${esc(j.state)}">${esc(j.state)}</span> ${Math.round(j.pct)}%${j.speed ? " · " + esc(j.speed) : ""}${j.eta ? " · " + esc(j.eta) + " left" : ""}`
      : `${esc(j.site || "")}${j.size ? " · " + esc(j.size) : ""}${j.phone ? " · 📲 to phone" : ""} · ${clock(j.at * 1000)}`}</div>
    ${live ? `<div class="qt-bar"><i style="width:${j.pct}%"></i></div>` : ""}</div></div>`;
}
function renderDownloads(d) {
  const el = $("#dlBody");
  if (!d.ok) { setSticker("dl", 0, String, "VOLT is off", true); el.innerHTML = offState("volt", d.msg); return; }
  const act = d.active.length;
  setSticker("dl", d.today, v => Math.round(v), act ? `${act} going now` : d.phone_today ? `${d.phone_today} sent to phone` : d.live ? "VOLT is ready" : "VOLT is off");
  const gr = (d.grabs || []).map((g, i) => `<div class="li job grab ${g.state}" style="animation-delay:${i * 40}ms"><div class="em">${g.state === "error" ? "⚠️" : "🔎"}</div><div class="grow"><div class="t">${esc(g.url)}</div>
    <div class="s">${g.state === "error" ? esc(g.error) : "Looking the link up…"}</div>${g.state === "looking" ? `<div class="qt-bar"><i class="seek"></i></div>` : ""}</div></div>`).join("");
  el.innerHTML = `
    <div class="big"><div><div class="num">${d.today}<small>done today</small></div><div class="sub">${act ? plural(act, "download") + " running" : "Nothing running"}${d.failed ? ` · ${d.failed} failed` : ""}</div></div>
      ${d.live ? `<span class="pill${act ? " warn" : ""}">${act ? "⚡ busy" : "✓ ready"}</span>` : `<button class="qt-btn sm primary" data-start="volt">Start VOLT</button>`}</div>
    ${gr || act || d.done.length ? `<div class="list">${gr}${d.active.concat(d.done).map(jobRow).join("")}</div>`
      : emptyState("⚡", d.last ? `Last one: <b>${esc(d.last.title)}</b>, ${ago(d.last.at)}.` : "Nothing downloaded today.", `<p class="sub">Paste a link above, or share one to <b>Beam Drop</b> on the phone.</p>`)}`;
}
async function submitGrab(f, mode) {
  const inp = f.querySelector("input"), url = inp.value.trim();
  if (!/^https?:\/\/\S+$/.test(url)) { inp.focus(); f.classList.remove("shake"); void f.offsetWidth; f.classList.add("shake"); toast("Paste a link that starts with http", true); return; }
  f.querySelectorAll("button").forEach(b => b.disabled = true);
  try {
    await api("grab", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url, mode }) });
    inp.value = "";
    burst(f.querySelector(".primary"), ["var(--qt-volt)", "var(--qt-fg)", "var(--qt-daily)"]);
    toast(mode === "audio" ? "Grabbing the audio…" : "Grabbing it…");
    setTimeout(load, 600);
  } catch (e) { toast(e.message || "VOLT didn't take it", true); }
  f.querySelectorAll("button").forEach(b => b.disabled = false);
}
document.addEventListener("submit", e => { if (e.target.id === "grabf") { e.preventDefault(); submitGrab(e.target, e.submitter && e.submitter.dataset.mode); } });
document.addEventListener("paste", e => {   // pasting a link anywhere on the page (outside a field) fills the grab box
  if (/INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
  const t = (e.clipboardData && e.clipboardData.getData("text") || "").trim();
  if (/^https?:\/\/\S+$/.test(t)) { const i = $("#grabUrl"); i.value = t; i.focus(); $("#downloads").scrollIntoView({ behavior: "smooth", block: "center" }); }
});

/* ---------- disk ---------- */
function ring(pct, low, label) {
  const r = 34, c = 2 * Math.PI * r;
  return `<div class="ring${low ? " low" : ""}"><svg viewBox="0 0 84 84"><circle class="bd" cx="42" cy="42" r="${r}"/><circle class="trk" cx="42" cy="42" r="${r}"/><circle class="val" cx="42" cy="42" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${c}" data-off="${c * (1 - pct / 100)}"/></svg><b>${label}</b></div>`;
}
function delta(v, what) {
  if (v == null || Math.abs(v) < 64 << 20) return "";
  return `<span class="delta ${v > 0 ? "up" : "down"}">${v > 0 ? "▲ +" : "▼ "}${bytes(v)} ${what}</span>`;
}
// tiny 7-day line of free space (gaps where the dashboard wasn't open that day)
function spark(tr, size) {
  const pts = (tr || []).map((v, i) => [i, v]).filter(p => p[1] != null);
  if (pts.length < 3) return "";   // a line needs a few days to mean anything
  const vals = pts.map(p => p[1]), lo = Math.min(...vals), hi = Math.max(...vals), span = Math.max(hi - lo, size * 0.002);
  const xy = pts.map(([i, v]) => [4 + i * 16, 22 - (v - lo) / span * 16]);
  const d = xy.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join("");
  const [lx, ly] = xy[xy.length - 1];
  return `<svg class="spark" viewBox="0 0 108 26" aria-label="Free space, last 7 days"><title>Free space over the last 7 days</title><path class="ln" pathLength="1" d="${d}"/><circle cx="${lx}" cy="${ly}" r="3.6"/></svg>`;
}
function renderDisk(k) {
  const el = $("#diskBody");
  if (!k.ok) { setSticker("disk", 0, String, "", true); el.innerHTML = offState("space", k.msg); return; }
  const c = k.drives.find(d => d.letter === "C") || k.drives[0];
  $("#strip [data-k=disk] .lbl").textContent = `Free on ${c.letter}:`;
  setSticker("disk", c.free, v => bytes(v), (k.low.length ? "⚠ low: " + k.low.join(", ") : `${Math.round(100 - c.used_pct)}% free`));
  const wins = k.wins ? (k.wins.clean || 0) + (k.wins.reels || 0) : 0;
  el.innerHTML = `<div class="drives">${k.drives.map(d => `
      <div class="drive">${ring(d.used_pct, k.low.includes(d.letter), d.letter)}<div>
        <div class="nm">${d.letter}:${d.label ? `<span>${esc(d.label)}</span>` : ""}${d.type ? `<span>${esc(d.type)}</span>` : ""}</div>
        <div class="fr">${bytes(d.free)} <small>free of ${bytes(d.size)}</small></div>
        <div class="dl2">${delta(d.since_morning, "since this morning") || delta(d.since_yesterday, "since yesterday") || `<span class="delta">no change today</span>`}${spark(d.trend, d.size)}</div>
      </div></div>`).join("")}</div>
    <div class="meta">${k.bin && k.bin.bytes ? `<span class="qt-chip" title="Space Manager can empty it">🗑️ Recycle Bin ${bytes(k.bin.bytes)}</span>` : ""}
      ${wins > 64 << 20 ? `<span class="qt-chip">✨ ${bytes(wins)} easy to free</span>` : ""}
      ${k.src === "windows" ? `<button class="qt-btn sm" data-start="space">Start Space Manager for more</button>` : ""}</div>`;
  requestAnimationFrame(() => requestAnimationFrame(() => el.querySelectorAll("[data-off]").forEach(c => c.style.strokeDashoffset = c.dataset.off)));
}

/* ---------- header ---------- */
// one plain sentence about the day so far
function headline(d) {
  const bits = [], m = d.money, p = d.photos, dl = d.downloads, k = d.disk;
  if (m && m.ok) bits.push(m.today ? `${money(m.today)} spent${m.left != null ? (m.left >= 0 ? `, ${money(m.left)} still safe` : `, ${money(-m.left)} over`) : ""}` : (m.stale ? "no spending synced yet" : "nothing spent yet"));
  if (p && p.ok) bits.push(p.today ? plural(p.today, "new photo") : "no new photos");
  if (dl && dl.ok) bits.push(dl.active.length ? `${plural(dl.active.length, "download")} running` : dl.today ? `${plural(dl.today, "download")} done` : "");
  if (k && k.ok && k.low.length) bits.push(`low space on ${k.low.map(l => l + ":").join(" and ")}`);
  const t = bits.filter(Boolean);
  if (!t.length) return "";
  const s = t.length > 1 ? t.slice(0, -1).join(", ") + " and " + t[t.length - 1] : t[0];
  return s.charAt(0).toUpperCase() + s.slice(1) + ".";
}
function renderTop(d) {
  const h = new Date().getHours();
  const hi = h < 5 ? "Up late" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : h < 22 ? "Good evening" : "Good night";
  const name = d.money && d.money.name ? d.money.name.split(" ")[0] : "";
  $("#hello").innerHTML = `${hi}${name ? `, <em>${esc(name)}</em>` : ""}`;
  $("#date").textContent = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
  const hl = headline(d), he = $("#headline");
  if (he.textContent !== hl) { he.textContent = hl; he.classList.remove("typing"); void he.offsetWidth; if (innerWidth > 520) he.classList.add("typing"); }
  document.body.dataset.sky = h < 5 ? "night" : h < 11 ? "morning" : h < 16 ? "day" : h < 20 ? "evening" : "night";
  document.title = "Daily · " + new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/* ---------- load ---------- */
function cached() {
  try { const c = JSON.parse(localStorage.getItem("daily:last") || "null"); return c && c.data ? c : null; } catch (_) { return null; }
}
function paint(d, manual) {
  data = d;
  renderTop(d);
  const typing = addOpen && document.activeElement && document.activeElement.closest("#addf");
  for (const [fn, x, key] of [[typing ? () => { } : renderMoney, d.money, "money"], [renderPhotos, d.photos, "photos"], [renderDownloads, d.downloads, "dl"], [renderDisk, d.disk, "disk"]]) {
    // only redraw a card when its data changed, so lists don't replay their entrance every refresh
    const sig = JSON.stringify(x) + (key === "money" ? addOpen : "") + new Date().getDate();
    if (!manual && seen[key] === sig) continue;
    seen[key] = sig;
    try { fn(x); } catch (e) { console.error(e); }
  }
}
async function load(manual) {
  if (busy) return;
  busy = true;
  if (manual) { $("#refresh").classList.add("spin"); $("#mark").classList.remove("spin"); void $("#mark").offsetWidth; $("#mark").classList.add("spin"); }
  try {
    const fresh = await api("today");
    last = Date.now();
    paint(fresh, manual);
    try { localStorage.setItem("daily:last", JSON.stringify({ at: last, data: fresh })); } catch (_) { }
    $("#live").className = "qt-chip live";
    if (manual) toast("Up to date");
  } catch (e) {
    $("#live").className = "qt-chip live off";
    // no PC (phone away from Wi-Fi, PC asleep): show the last good copy with its time
    const c = cached();
    if (!data && c) paint(c.data, true);
    $("#liveTxt").textContent = c ? "offline · from " + clock(c.at) : "offline";
    if (manual) toast("Couldn't reach the PC", true);
  } finally {
    busy = false;
    setTimeout(() => $("#refresh").classList.remove("spin"), 600);
    tick();
  }
}
function tick() {
  if (!last) return;
  const s = (Date.now() - last) / 1000;
  if ($("#live").classList.contains("off")) return;
  $("#live").classList.toggle("stale", s > 90);
  $("#liveTxt").textContent = s < 10 ? "live" : "updated " + (s < 60 ? Math.round(s) + "s" : Math.round(s / 60) + "m") + " ago";
}

/* ---------- actions ---------- */
function openTool(id) {
  if (IN_SUITE) { try { window.top.postMessage({ qt: "open", id }, "*"); return; } catch (_) { } }
  if (VIA_BEAM) {
    if (id === "kharcha") { location.href = "/kharcha"; return; }
    toast(NAMES[id] + " opens on the PC");
    return;
  }
  const [port, path] = TOOL_PORT[id];
  window.open(`http://127.0.0.1:${port}${path}`, "_blank");
}
document.addEventListener("click", async e => {
  const o = e.target.closest("[data-open]");
  if (o) return openTool(o.dataset.open);
  const s = e.target.closest("[data-start]");
  if (s) {
    s.disabled = true; s.textContent = "Starting…";
    try {
      const r = await api("start/" + s.dataset.start, { method: "POST" });
      toast(r.ok ? NAMES[s.dataset.start] + " is on" : r.msg || "Couldn't start it", !r.ok);
    } catch (err) { toast("Couldn't start it", true); }
    return load();
  }
  if (e.target.closest("[data-add-open]")) { addOpen = true; renderMoney(data.money); setTimeout(() => $("#a-amt")?.focus(), 30); return; }
  if (e.target.closest("[data-add-close]")) { addOpen = false; renderMoney(data.money); return; }
  const cb = e.target.closest("[data-cat]");
  if (cb) { addCat = cb.dataset.cat; cb.parentElement.querySelectorAll(".cat").forEach(x => { x.classList.toggle("on", x === cb); x.setAttribute("aria-checked", x === cb); }); return; }
  const un = e.target.closest("[data-undo]");
  if (un) {
    un.disabled = true;
    try { await api("kharcha/undo/" + encodeURIComponent(un.dataset.undo), { method: "POST" }); toast("Taken back"); }
    catch (err) { toast(err.message || "Couldn't take it back", true); }
    return load();
  }
  const st = e.target.closest(".sticker");
  if (st) {
    e.preventDefault();
    const card = $("#" + st.dataset.k);
    card.scrollIntoView({ behavior: "smooth", block: "start" });
    card.classList.remove("flash"); void card.offsetWidth; card.classList.add("flash");
    return;
  }
  const sh = e.target.closest(".shot");
  if (sh) { lbSet = sh.dataset.set || "latest"; return openLightbox(+sh.dataset.i); }
});

/* ---------- photo viewer: thumb first, then the full photo; arrows, keys and swipes ---------- */
let lbIdx = -1;
let lbSet = "latest";
function openLightbox(i) {
  const list = (data.photos && (lbSet === "mem" ? data.photos.memories.items : data.photos.latest)) || [];
  if (!list.length) return;
  lbIdx = (i + list.length) % list.length;
  const x = list[lbIdx];
  let lb = $(".lb");
  if (!lb) {
    lb = document.createElement("div");
    lb.className = "lb";
    lb.innerHTML = `<button class="qt-btn icon nav prev" data-lb="-1" aria-label="Previous">‹</button><figure><img alt=""><figcaption></figcaption></figure><button class="qt-btn icon nav next" data-lb="1" aria-label="Next">›</button><button class="qt-btn icon close" data-lb="x" aria-label="Close">✕</button>`;
    lb.addEventListener("click", e => {
      const b = e.target.closest("[data-lb]");
      if (b) { e.stopPropagation(); return b.dataset.lb === "x" ? closeLightbox() : openLightbox(lbIdx + +b.dataset.lb); }
      if (!e.target.closest("figure")) closeLightbox();
    });
    let sx = null;
    lb.addEventListener("touchstart", e => { sx = e.touches[0].clientX; }, { passive: true });
    lb.addEventListener("touchend", e => {
      if (sx == null) return;
      const dx = e.changedTouches[0].clientX - sx; sx = null;
      if (Math.abs(dx) > 50) openLightbox(lbIdx + (dx < 0 ? 1 : -1));
    });
    document.body.append(lb);
  }
  const img = lb.querySelector("img"), fig = lb.querySelector("figure");
  fig.classList.remove("swap"); void fig.offsetWidth; fig.classList.add("swap");
  img.classList.add("soft");
  img.src = "api/thumb/" + encodeURIComponent(x.k);
  lb.querySelector("figcaption").innerHTML = `<b>${x.ago ? esc(x.ago) + " · " + new Date(x.t).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : esc(dayLabel(x.t)) + ", " + clock(x.t)}</b> · ${x.src === "phone" ? "📱 phone" : "💻 PC"}${x.v ? " · 🎬 video" : ""}<span>${lbIdx + 1} / ${list.length}</span>`;
  if (!x.v) {
    const full = new Image(), want = lbIdx;
    full.onload = () => { if (lbIdx === want) { img.src = full.src; img.classList.remove("soft"); } };
    full.onerror = () => { if (lbIdx === want) img.classList.remove("soft"); };   // phone photo not on the PC yet: the sharp thumbnail is the best we have
    full.src = "api/full/" + encodeURIComponent(x.k);
  } else img.classList.remove("soft");
}
function closeLightbox() { const lb = $(".lb"); if (!lb) return; lb.classList.add("out"); setTimeout(() => lb.remove(), 200); lbIdx = -1; }
addEventListener("keydown", e => {
  if ($(".lb")) {
    if (e.key === "Escape") closeLightbox();
    if (e.key === "ArrowRight") openLightbox(lbIdx + 1);
    if (e.key === "ArrowLeft") openLightbox(lbIdx - 1);
    return;
  }
  if ((e.key === "r" || e.key === "R") && !e.ctrlKey && !e.metaKey && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) load(true);
});
$("#refresh").onclick = () => load(true);
$("#mark").onclick = () => load(true);
document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() - last > 10000) load(); });
// every 30 s normally; every 3 s while a download runs or a link is being looked up, so the bars move
const busyNow = () => data && data.downloads && data.downloads.ok && (data.downloads.active.length || (data.downloads.grabs || []).some(g => g.state === "looking"));
setInterval(() => { if (!document.hidden && (busyNow() || Date.now() - last >= REFRESH)) load(); }, 3000);
setInterval(tick, 5000);
{ const c = cached(); if (c && Date.now() - c.at < 864e5) { paint(c.data, true); $("#liveTxt").textContent = "loading…"; } }
load();

/* pull down at the top of the page to refresh (phone) */
(() => {
  let y0 = null, pulled = 0;
  const mark = $("#mark");
  addEventListener("touchstart", e => { y0 = scrollY <= 0 && !$(".lb") ? e.touches[0].clientY : null; pulled = 0; }, { passive: true });
  addEventListener("touchmove", e => {
    if (y0 == null) return;
    pulled = Math.max(0, Math.min(120, e.touches[0].clientY - y0));
    document.body.style.transform = pulled ? `translateY(${pulled * .35}px)` : "";
    mark.style.transform = `rotate(${pulled * 3}deg) scale(${1 + pulled / 400})`;
    document.body.classList.toggle("pull-ready", pulled > 80);
  }, { passive: true });
  addEventListener("touchend", () => {
    if (y0 == null) return;
    document.body.style.transition = "transform .35s var(--qt-spring)";
    document.body.style.transform = ""; mark.style.transform = "";
    setTimeout(() => { document.body.style.transition = ""; }, 400);
    document.body.classList.remove("pull-ready");
    if (pulled > 80) load(true);
    y0 = null;
  });
})();

/* ---------- round 9: microinteractions ---------- */
// ink confetti from a point (a payment logged, a link grabbed)
function burst(el, colors) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches || !el) return;
  const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const cs = colors || ["var(--qt-kharcha)", "var(--qt-daily)", "var(--qt-volt)", "var(--qt-lens)", "var(--qt-space)"];
  for (let i = 0; i < 18; i++) {
    const b = document.createElement("i");
    b.className = "bit";
    const a = Math.random() * Math.PI * 2, d = 50 + Math.random() * 90;
    b.style.cssText = `left:${cx}px;top:${cy}px;background:${cs[i % cs.length]};--x:${Math.cos(a) * d}px;--y:${Math.sin(a) * d - 40}px;--r:${Math.random() * 540 - 270}deg;${i % 3 ? "" : "border-radius:50%;"}`;
    document.body.append(b);
    setTimeout(() => b.remove(), 900);
  }
}
const buzz = () => { try { navigator.vibrate && navigator.vibrate(8); } catch (_) { } };
document.addEventListener("pointerdown", e => { if (e.pointerType === "touch" && e.target.closest(".qt-btn, .sticker, .cat, .shot")) buzz(); });

// cards lean a little toward the mouse (desktop only)
if (matchMedia("(hover: hover) and (pointer: fine)").matches && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
  document.addEventListener("pointermove", e => {
    const c = e.target.closest(".card");
    document.querySelectorAll(".card.lean").forEach(x => { if (x !== c) { x.classList.remove("lean"); x.style.transform = ""; } });
    if (!c || e.target.closest(".shot, .li, input, form")) { if (c) { c.classList.remove("lean"); c.style.transform = ""; } return; }
    const r = c.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
    c.classList.add("lean");
    c.style.transform = `perspective(900px) rotateY(${x * 2.4}deg) rotateX(${-y * 2.4}deg)`;
  });
  document.addEventListener("pointerleave", () => document.querySelectorAll(".card.lean").forEach(x => { x.classList.remove("lean"); x.style.transform = ""; }));
}
