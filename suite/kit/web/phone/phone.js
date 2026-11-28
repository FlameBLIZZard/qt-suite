/* Shared helpers for the phone pages (served by kit/phone.py). */
const Q = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
async function api(path, body, raw) {
  const opt = body === undefined ? {} : { method: "POST", headers: raw ? {} : { "Content-Type": "application/json" }, body: raw ? body : JSON.stringify(body) };
  const r = await fetch(path, opt);
  let j = {}; try { j = await r.json(); } catch {}
  if (!r.ok) throw new Error(j.msg || j.error || r.statusText);
  return j;
}
function toast(m, ms = 1800) {
  const t = document.createElement("div"); t.className = "toast"; t.textContent = m; document.body.append(t);
  setTimeout(() => t.remove(), ms);
}
function buzz(ms = 25) { try { navigator.vibrate && navigator.vibrate(ms); } catch {} }
// PC -> phone commands (long poll). handlers: {what: fn(item)}
async function listen(handlers) {
  let after = -1;
  for (;;) {
    try {
      const r = await api("/api/cmds?after=" + after);
      if (after >= 0) for (const it of r.items) handlers[it.what] && handlers[it.what](it);
      after = r.seq;
    } catch { await new Promise(r => setTimeout(r, 3000)); }
  }
}
let wakeLock = null;
async function keepAwake() { try { wakeLock = await navigator.wakeLock.request("screen"); } catch {} }
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && wakeLock) keepAwake(); });
