const Q = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
async function api(p, b) { const r = await fetch(p, b === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }); return r.json(); }
const money = n => "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
function every(ms, fn) { fn(); return setInterval(fn, ms); }
