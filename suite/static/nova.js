"use strict";
/* QT Suite nova layer (loop 5). Loaded LAST, after spark.js; reuses hub.js / hub-plus.js / shell.js / flow.js / spark.js globals.
   Server half: nova.py (/api/nova/*).
   1 Start menu apps in Ctrl+K        2 web search prefixes (g, yt, w, gh, maps, amz)   3 colours: swatch + hex / rgb / hsl
   4 text tools on the clipboard (>)  5 generators: password, uuid, dice, coin, lorem   6 world clock + time zone maths
   7 date maths                       8 reminders (tray balloon even with the window shut)  9 screenshots
   10 to-do card on Home              11 network speed in the meter    12 top memory programs + End
   13 QR codes for links and text     14 recent palette searches       15 zen mode (Ctrl+Shift+F)
   16 back / forward between tools    17 Look: Home accent + wallpaper  18 clipboard history (Ctrl+Shift+V)
   19 motion polish                   20 what's new, keys, backup */
(() => {
  const RM = matchMedia("(prefers-reduced-motion: reduce)");
  const spring = "cubic-bezier(.34,1.8,.5,1)";
  const anim = (el, kf, o) => (RM.matches || !el || !el.animate) ? null : el.animate(kf, o);
  const post = (p, b) => api(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b || {}) });
  const typing = e => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };
  const say = (m, o) => (window.qtToast || toast)(m, o);
  const sfx = k => window.qtSfx && window.qtSfx(k);
  const palInput = () => document.querySelector(".pal-wrap input");
  const human = n => n == null ? "" : n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(n < 10240 ? 1 : 0) + " KB" : n < 1073741824 ? (n / 1048576).toFixed(1) + " MB" : (n / 1073741824).toFixed(2) + " GB";
  const rate = n => human(n).replace(/^(\d+) B$/, "$1 B") + "/s";
  const ago = t => { const s = Math.max(0, Date.now() / 1000 - t); return s < 60 ? "just now" : s < 3600 ? Math.floor(s / 60) + " min ago" : s < 86400 ? Math.floor(s / 3600) + " h ago" : Math.floor(s / 86400) + " d ago"; };
  const home = document.getElementById("view-home");
  const hero = home.querySelector(".hero");
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  function palAdd(fn) {
    const prev = window.qtPalExtra;
    window.qtPalExtra = q => { const out = prev ? prev(q) : []; try { fn(q, palInput() ? palInput().value : q, out); } catch (e) { console.warn(e); } return out; };
  }
  function copyText(text, what) {
    return navigator.clipboard.writeText(text).then(() => { say(`Copied ${what || text}`); sfx("pop"); }, e => say("Couldn't copy: " + e.message, { bad: true }));
  }
  const memo = (() => { const m = new Map(); return (k, f) => { if (!m.has(k)) { if (m.size > 60) m.clear(); m.set(k, f()); } return m.get(k); }; })();
  const openWeb = url => post("/api/nova/web", { url }).catch(e => say(e.message, { bad: true }));

  /* shared server store: todos + reminders (nova.py) */
  let nstore = { todos: [], reminders: [] };
  const nReady = api("/api/nova/store").then(s => { nstore = s; document.dispatchEvent(new CustomEvent("qt-nova")); }).catch(() => {});
  let nT = {};
  function saveN(key, now) {
    clearTimeout(nT[key]);
    const go = () => post("/api/nova/store", { [key]: nstore[key] }).then(s => { nstore.reminders = s.reminders; }).catch(e => say("Couldn't save: " + e.message, { bad: true }));
    if (now) return go();
    nT[key] = setTimeout(go, 400);
  }

  /* =========================================================================================
     1. APPS: every Start menu app in Ctrl+K. Type "spot" -> Spotify, Enter opens it.
     ========================================================================================= */
  let appList = [], appT = 0;
  function loadApps() {
    if (Date.now() - appT < 120000) return;
    appT = Date.now();
    api("/api/nova/apps").then(r => { appList = r.apps || []; window.qtPalRender && window.qtPalRender(); }).catch(() => { appT = 0; });
  }
  document.addEventListener("keydown", e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") loadApps(); }, true);
  setTimeout(loadApps, 2500);
  function appScore(name, q) {
    const n = name.toLowerCase();
    if (n.startsWith(q)) return 3;
    if (n.split(/[\s\-_.]+/).some(w => w.startsWith(q))) return 2;
    if (q.length >= 3 && n.includes(q)) return 1;
    return 0;
  }
  palAdd((q, raw, out) => {
    const ql = q.trim().toLowerCase().replace(/^(open|run|launch|start)\s+/, "");
    if (ql.length < 2 || /^[>=#]/.test(ql)) return;
    const hits = appList.map(a => [a, appScore(a.name, ql)]).filter(x => x[1]).sort((a, b) => b[1] - a[1] || a[0].name.length - b[0].name.length).slice(0, 5);
    hits.forEach(([a, s], i) => out.push({ label: a.name, sub: a.folder ? a.folder.replace(/\\/g, " › ") : "App", head: "Apps", fixed: 2.9 + s * .01 - i * .001, glyph: "◧",
      run: () => post("/api/nova/launch", { path: a.path }).then(() => say(`Opening ${a.name}`), e => say(e.message, { bad: true })) }));
  });

  /* =========================================================================================
     2. WEB SEARCH: "g cats", "yt lofi", "w india", "gh pixlab", "maps pune", "amz usb hub" -> default browser
     ========================================================================================= */
  const WEB = {
    g: ["Google", "https://www.google.com/search?q="], yt: ["YouTube", "https://www.youtube.com/results?search_query="],
    w: ["Wikipedia", "https://en.wikipedia.org/w/index.php?search="], gh: ["GitHub", "https://github.com/search?q="],
    maps: ["Google Maps", "https://www.google.com/maps/search/"], amz: ["Amazon", "https://www.amazon.in/s?k="],
    ddg: ["DuckDuckGo", "https://duckduckgo.com/?q="], tr: ["Google Translate", "https://translate.google.com/?sl=auto&tl=en&text="],
  };
  palAdd((q, raw, out) => {
    const m = /^(\w+)\s+(.+)$/.exec(raw.trim());
    if (m && WEB[m[1].toLowerCase()]) {
      const [name, url] = WEB[m[1].toLowerCase()];
      out.push({ label: `Search ${name} for "${m[2].slice(0, 50)}"`, sub: "opens in your browser", fixed: 1100, glyph: "⌕", run: () => openWeb(url + encodeURIComponent(m[2])) });
      return;
    }
    const t = raw.trim();
    if (t.length >= 3 && !/^[>=#]/.test(t) && !/^[a-z]:[\\/]/i.test(t) && !/^https?:/i.test(t))
      out.push({ label: `Search the web for "${t.slice(0, 50)}"`, sub: "g, yt, w, gh, maps, amz, tr before a word pick the site", head: "Web", fixed: 0.5, glyph: "⌕", run: () => openWeb(WEB.g[1] + encodeURIComponent(t)) });
  });

  /* =========================================================================================
     3. COLOURS: "#ff6b4a", "rgb(255 107 74)", "hsl(10 100% 65%)" -> a swatch and every format
     ========================================================================================= */
  function parseColor(s) {
    s = s.trim().toLowerCase();
    let m;
    if ((m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s)) && (s.startsWith("#") || /[a-f]/.test(m[1]) && m[1].length === 6)) {
      let h = m[1]; if (h.length === 3) h = h.replace(/./g, c => c + c);
      return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
    }
    if ((m = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/.exec(s))) return [m[1], m[2], m[3]].map(Number).every(v => v <= 255) ? [+m[1], +m[2], +m[3]] : null;
    if ((m = /^hsla?\(\s*(\d{1,3}(?:\.\d+)?)(?:deg)?[\s,]+(\d{1,3}(?:\.\d+)?)%[\s,]+(\d{1,3}(?:\.\d+)?)%/.exec(s))) {
      const h = +m[1] / 360, sa = +m[2] / 100, l = +m[3] / 100;
      const f = n => { const k = (n + h * 12) % 12, a = sa * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
      return [f(0), f(8), f(4)];
    }
    return null;
  }
  const toHex = c => "#" + c.map(v => v.toString(16).padStart(2, "0")).join("");
  function toHsl([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    let h = 0, s = 0;
    if (d) { s = d / (1 - Math.abs(2 * l - 1)); h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h = Math.round(h * 60 + 360) % 360; }
    return `hsl(${h} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
  }
  const lum = c => { const [r, g, b] = c.map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * r + .7152 * g + .0722 * b; };
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  palAdd((q, raw, out) => {
    const c = parseColor(raw);
    if (!c) return;
    const hex = toHex(c), rgb = `rgb(${c.join(" ")})`, hsl = toHsl(c);
    const sw = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="1.5" y="1.5" width="21" height="21" rx="5" fill="${hex}" stroke="#000" stroke-width="2.5"/></svg>`)}`;
    const onW = contrast(c, [255, 255, 255]).toFixed(1), onB = contrast(c, [0, 0, 0]).toFixed(1);
    [[hex, `text on it: white ${onW}:1 · black ${onB}:1`], [rgb, "rgb"], [hsl, "hsl"]].forEach(([v, sub], i) =>
      out.push({ label: v, sub: sub + " · Enter copies", fixed: 1200 - i, ic: sw, run: () => copyText(v) }));
  });

  /* =========================================================================================
     4. TEXT TOOLS: type ">" in Ctrl+K. They work on what you copied last (or on text after the name).
     ========================================================================================= */
  let lastClips = { items: [], t: 0 };
  function freshClips() {
    if (Date.now() - lastClips.t < 1500) return;
    lastClips.t = Date.now();
    api("/api/nova/clips").then(r => { lastClips = { ...r, t: Date.now() }; window.qtPalRender && window.qtPalRender(); }).catch(() => {});
  }
  const title = s => s.toLowerCase().replace(/(^|[\s\-_(\["'])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
  const b64e = s => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
  const b64d = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s+/g, "")), c => c.charCodeAt(0)));
  const TX = [
    ["upper", "UPPER CASE", s => s.toUpperCase()], ["lower", "lower case", s => s.toLowerCase()], ["title", "Title Case", title],
    ["sentence", "Sentence case", s => s.toLowerCase().replace(/(^\s*|[.!?]\s+)(\p{L})/gu, (m, a, b) => a + b.toUpperCase())],
    ["trim", "Tidy spaces", s => s.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim()],
    ["oneline", "Join into one line", s => s.replace(/\s*\n\s*/g, " ").trim()],
    ["slug", "slug-for-a-url", s => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")],
    ["sort", "Sort lines A-Z", s => s.split(/\r?\n/).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).join("\n")],
    ["unique", "Remove repeated lines", s => [...new Set(s.split(/\r?\n/))].join("\n")],
    ["reverse", "Reverse line order", s => s.split(/\r?\n/).reverse().join("\n")],
    ["json", "Pretty JSON", s => JSON.stringify(JSON.parse(s), null, 2)], ["minify", "Minify JSON", s => JSON.stringify(JSON.parse(s))],
    ["b64", "Base64 encode", b64e], ["unb64", "Base64 decode", b64d],
    ["url", "URL encode", s => encodeURIComponent(s)], ["unurl", "URL decode", s => decodeURIComponent(s.replace(/\+/g, " "))],
    ["count", "Count words + characters", s => `${(s.match(/\S+/g) || []).length} words · ${s.length} characters · ${s.split(/\r?\n/).length} lines`, true],
  ];
  palAdd((q, raw, out) => {
    const t = raw.replace(/^\s+/, "");
    if (!t.startsWith(">")) return;
    freshClips();
    const m = /^>\s*(\S*)\s?([\s\S]*)$/.exec(t), name = (m[1] || "").toLowerCase(), given = m[2];
    const src = given || (lastClips.items[0] || {}).text || "";
    const list = TX.filter(([k, label]) => !name || k.startsWith(name) || label.toLowerCase().includes(name));
    if (!src) return out.push({ label: "Copy some text first", sub: "text tools work on your last copy, or on text typed after the tool's name", fixed: 1300, glyph: "›", run: () => {} });
    list.forEach(([k, label, f, info], i) => {
      let res, bad = false;
      try { res = f(src); } catch (_) { res = "doesn't fit this text"; bad = true; }
      out.push({ label: info ? res : label, sub: bad ? res : info ? "Enter copies" : (res.replace(/\s+/g, " ").slice(0, 70) || "(empty)") + " · Enter copies", fixed: 1300 - i, glyph: "›", badge: k,
        run: () => bad ? say(`${label} doesn't fit this text`, { bad: true }) : copyText(res, info ? "the count" : label.toLowerCase().includes("json") ? "the JSON" : "the result") });
    });
  });

  /* =========================================================================================
     5. GENERATORS: "pw", "pw 24", "uuid", "roll d20", "rand 1-100", "coin", "lorem 2"
     ========================================================================================= */
  const rnd = n => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; };
  function password(n) {
    const sets = ["abcdefghijkmnpqrstuvwxyz", "ABCDEFGHJKLMNPQRSTUVWXYZ", "23456789", "!@#$%^&*-_=+?"], all = sets.join("");
    const a = sets.map(s => s[rnd(s.length)]);
    while (a.length < n) a.push(all[rnd(all.length)]);
    for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
    return a.join("");
  }
  const LOREM = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat".split(" ");
  const lorem = n => Array.from({ length: n }, () => { const w = Array.from({ length: 40 + rnd(30) }, () => LOREM[rnd(LOREM.length)]); w[0] = w[0][0].toUpperCase() + w[0].slice(1); return w.join(" ") + "."; }).join("\n\n");
  palAdd((q, raw, out) => {
    const t = raw.trim().toLowerCase(); let m;
    const push = (label, val, sub) => out.push({ label, sub: (sub || "") + " · Enter copies, type again for a new one", fixed: 1150, glyph: "✦", run: () => copyText(val, label.length > 40 ? "it" : label) });
    if ((m = /^(?:pw|pass|password)(?:\s+(\d{1,3}))?$/.exec(t))) { const n = Math.max(8, Math.min(128, +(m[1] || 20))); const p = memo(t, () => password(n)); push(p, p, `${n} characters, all four kinds`); }
    else if (/^(?:uuid|guid)$/.test(t)) { const u = memo(t, () => crypto.randomUUID()); push(u, u, "random UUID"); }
    else if ((m = /^(?:roll\s+)?(\d{0,2})d(\d{1,4})$/.exec(t))) {
      const n = Math.max(1, Math.min(20, +(m[1] || 1))), s = +m[2]; if (s < 2) return;
      const r = memo(t, () => Array.from({ length: n }, () => 1 + rnd(s)));
      push(n > 1 ? `${r.join(" + ")} = ${r.reduce((a, b) => a + b, 0)}` : String(r[0]), String(r.reduce((a, b) => a + b, 0)), `${n}d${s}`);
    }
    else if ((m = /^(?:rand|random|pick)\s+(-?\d+)\s*(?:-|to|\.\.)\s*(-?\d+)$/.exec(t))) { const a = Math.min(+m[1], +m[2]), b = Math.max(+m[1], +m[2]); const v = memo(t, () => a + rnd(b - a + 1)); push(String(v), String(v), `between ${a} and ${b}`); }
    else if (/^(?:coin|flip|toss)$/.test(t)) { const v = memo(t, () => rnd(2) ? "Heads" : "Tails"); push(v, v, "coin flip"); }
    else if ((m = /^lorem(?:\s+(\d))?$/.exec(t))) { const n = +(m[1] || 1); const v = memo(t, () => lorem(n)); push(`Lorem ipsum, ${n} paragraph${n > 1 ? "s" : ""}`, v, v.slice(0, 50) + "..."); }
  });

  /* =========================================================================================
     6. WORLD CLOCK: "time", "time in tokyo", "tokyo time", "5pm in london" (your 5pm, over there)
     ========================================================================================= */
  const CITY = { london: "Europe/London", uk: "Europe/London", paris: "Europe/Paris", berlin: "Europe/Berlin", amsterdam: "Europe/Amsterdam", rome: "Europe/Rome", madrid: "Europe/Madrid",
    moscow: "Europe/Moscow", istanbul: "Europe/Istanbul", dubai: "Asia/Dubai", uae: "Asia/Dubai", riyadh: "Asia/Riyadh", karachi: "Asia/Karachi", india: "Asia/Kolkata", ist: "Asia/Kolkata",
    mumbai: "Asia/Kolkata", delhi: "Asia/Kolkata", pune: "Asia/Kolkata", bangalore: "Asia/Kolkata", bengaluru: "Asia/Kolkata", kathmandu: "Asia/Kathmandu", dhaka: "Asia/Dhaka",
    bangkok: "Asia/Bangkok", jakarta: "Asia/Jakarta", singapore: "Asia/Singapore", "kuala lumpur": "Asia/Kuala_Lumpur", "hong kong": "Asia/Hong_Kong", beijing: "Asia/Shanghai",
    shanghai: "Asia/Shanghai", china: "Asia/Shanghai", taipei: "Asia/Taipei", seoul: "Asia/Seoul", korea: "Asia/Seoul", tokyo: "Asia/Tokyo", japan: "Asia/Tokyo", sydney: "Australia/Sydney",
    melbourne: "Australia/Melbourne", perth: "Australia/Perth", auckland: "Pacific/Auckland", honolulu: "Pacific/Honolulu", "los angeles": "America/Los_Angeles", la: "America/Los_Angeles",
    "san francisco": "America/Los_Angeles", sf: "America/Los_Angeles", seattle: "America/Los_Angeles", pst: "America/Los_Angeles", denver: "America/Denver", chicago: "America/Chicago",
    texas: "America/Chicago", "new york": "America/New_York", nyc: "America/New_York", ny: "America/New_York", est: "America/New_York", toronto: "America/Toronto", miami: "America/New_York",
    "mexico city": "America/Mexico_City", "sao paulo": "America/Sao_Paulo", "buenos aires": "America/Argentina/Buenos_Aires", cairo: "Africa/Cairo", lagos: "Africa/Lagos",
    nairobi: "Africa/Nairobi", johannesburg: "Africa/Johannesburg", utc: "UTC", gmt: "UTC" };
  const nice = s => s.replace(/\b\w/g, c => c.toUpperCase()).replace(/^(Uk|Uae|Ist|Pst|Est|Utc|Gmt|Nyc|Ny|La|Sf)$/i, x => x.toUpperCase());
  function offsetMin(tz, d = new Date()) {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(d).map(x => [x.type, x.value]));
    return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(d.getTime() / 60000) * 60000) / 60000);
  }
  const diffText = tz => { const m = offsetMin(tz) + new Date().getTimezoneOffset(); if (!m) return "same as you"; const a = Math.abs(m); return `${m > 0 ? "+" : "-"}${Math.floor(a / 60)}h${a % 60 ? " " + (a % 60) + "m" : ""} vs you`; };
  const clockAt = (tz, d = new Date()) => d.toLocaleTimeString("en-IN", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }) + " " + d.toLocaleDateString("en-IN", { timeZone: tz, weekday: "short" });
  function findCity(s) { s = s.trim().toLowerCase().replace(/[?.!]$/, ""); return CITY[s] ? [s, CITY[s]] : null; }
  palAdd((q, raw, out) => {
    const t = raw.trim().toLowerCase(); let m, c;
    if (t === "time" || t === "world clock" || t === "clock") {
      ["london", "new york", "dubai", "singapore", "tokyo"].forEach((k, i) => out.push({ label: `${clockAt(CITY[k])} in ${nice(k)}`, sub: diffText(CITY[k]), fixed: 1150 - i, glyph: "◷", run: () => copyText(`${clockAt(CITY[k])} in ${nice(k)}`) }));
      return;
    }
    if (((m = /^(?:time|clock)\s+(?:in\s+)?(.+)$/.exec(t)) || (m = /^(.+?)\s+time$/.exec(t)) || (m = /^what time is it in\s+(.+)$/.exec(t))) && (c = findCity(m[1]))) {
      const s = `${clockAt(c[1])} in ${nice(c[0])}`;
      return out.push({ label: s, sub: diffText(c[1]) + " · Enter copies", fixed: 1150, glyph: "◷", run: () => copyText(s) });
    }
    if ((m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s+(?:in|to)\s+(.+)$/.exec(t)) && (m[3] || m[2]) && (c = findCity(m[4]))) {
      let h = +m[1] % 12 + (m[3] === "pm" ? 12 : 0); if (!m[3]) h = +m[1];
      const d = new Date(); d.setHours(h, +(m[2] || 0), 0, 0);
      const s = `${d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true })} here = ${clockAt(c[1], d)} in ${nice(c[0])}`;
      out.push({ label: s, sub: diffText(c[1]), fixed: 1150, glyph: "◷", run: () => copyText(s) });
    }
  });

  /* =========================================================================================
     7. DATE MATHS: "days until 25 dec", "days since 2026-01-01", "today + 45 days", "in 3 weeks", "week"
     ========================================================================================= */
  const MON = "jan feb mar apr may jun jul aug sep oct nov dec".split(" ");
  function parseDay(s) {
    s = s.trim().toLowerCase().replace(/(\d)(st|nd|rd|th)\b/, "$1").replace(/,/g, "");
    const now = new Date(); now.setHours(0, 0, 0, 0);
    if (s === "today") return now;
    if (s === "tomorrow") return new Date(now.getTime() + 864e5);
    if (s === "yesterday") return new Date(now.getTime() - 864e5);
    if (s === "christmas" || s === "xmas") s = "25 dec"; if (s === "new year" || s === "new year's") s = "1 jan";
    let m, d, mo, y;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) [y, mo, d] = [+m[1], +m[2] - 1, +m[3]];
    else if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s))) [d, mo, y] = [+m[1], +m[2] - 1, +m[3] < 100 ? 2000 + +m[3] : +m[3]];
    else if ((m = /^(\d{1,2})\s+([a-z]{3})[a-z]*(?:\s+(\d{4}))?$/.exec(s)) && MON.includes(m[2])) [d, mo, y] = [+m[1], MON.indexOf(m[2]), m[3] ? +m[3] : null];
    else if ((m = /^([a-z]{3})[a-z]*\s+(\d{1,2})(?:\s+(\d{4}))?$/.exec(s)) && MON.includes(m[1])) [d, mo, y] = [+m[2], MON.indexOf(m[1]), m[3] ? +m[3] : null];
    else return null;
    const out = new Date(y == null ? now.getFullYear() : y, mo, d);
    if (y == null && out < now) out.setFullYear(out.getFullYear() + 1);   // "25 dec" means the next one
    return isNaN(out) ? null : out;
  }
  const dayStr = d => d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const weekNo = d => { const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7)); return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7); };
  const UNITD = { d: 1, day: 1, days: 1, w: 7, wk: 7, week: 7, weeks: 7, mo: 30.4375, month: 30.4375, months: 30.4375, y: 365.25, yr: 365.25, year: 365.25, years: 365.25 };
  palAdd((q, raw, out) => {
    const t = raw.trim().toLowerCase(); let m, d;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const push = (label, sub) => out.push({ label, sub: (sub || "") + " · Enter copies", fixed: 1140, glyph: "▦", run: () => copyText(label) });
    if ((m = /^(?:days?\s+)?(until|till|to|since|from)\s+(.+)$/.exec(t)) && (d = parseDay(m[2]))) {
      const n = Math.round((d - today) / 864e5), w = Math.floor(Math.abs(n) / 7);
      push(n === 0 ? "That's today" : `${Math.abs(n)} day${Math.abs(n) === 1 ? "" : "s"} ${n > 0 ? "to go" : "ago"}`, `${dayStr(d)}${w ? ` · ${w} week${w > 1 ? "s" : ""} ${Math.abs(n) % 7} days` : ""}`);
    }
    else if ((m = /^(?:(today|now|tomorrow|[\w\s/.-]+?)\s*)?([+-])\s*(\d+)\s*([a-z]+)$/.exec(t)) && UNITD[m[4]] && (d = parseDay(m[1] && m[1] !== "now" ? m[1] : "today"))) {
      const r = new Date(d.getTime() + (m[2] === "-" ? -1 : 1) * Math.round(+m[3] * UNITD[m[4]]) * 864e5);
      push(dayStr(r), `${m[1] || "today"} ${m[2]} ${m[3]} ${m[4]}`);
    }
    else if ((m = /^in\s+(\d+)\s*([a-z]+)$/.exec(t)) && UNITD[m[2]]) push(dayStr(new Date(today.getTime() + Math.round(+m[1] * UNITD[m[2]]) * 864e5)), `${m[1]} ${m[2]} from today`);
    else if (/^(week|week number|which week)$/.test(t)) push(`Week ${weekNo(new Date())} of ${today.getFullYear()}`, dayStr(today));
    else if (/^(date|today|what day is it)$/.test(t)) push(dayStr(today), `week ${weekNo(today)} · day ${Math.round((today - new Date(today.getFullYear(), 0, 1)) / 864e5) + 1} of the year`);
  });

  /* =========================================================================================
     8. REMINDERS: "remind 10m tea", "remind 5:30pm call Ma", "remind tomorrow 9am pay rent".
        nova.py keeps them; a tray balloon goes off even with the window shut. Here: a toast with +5 min.
     ========================================================================================= */
  function parseRemind(t) {
    let m;
    t = t.trim();
    if ((m = /^remind(?:\s+me)?\s+(?:in\s+)?(\d+(?:\.\d+)?)\s*(s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?|d|days?)\b\s*(?:to\s+|about\s+)?(.*)$/i.exec(t))) {
      const mult = /^s/i.test(m[2]) ? 1 : /^m/i.test(m[2]) ? 60 : /^h/i.test(m[2]) ? 3600 : 86400;
      return { at: Date.now() / 1000 + parseFloat(m[1]) * mult, text: m[3].trim() || "Reminder" };
    }
    if ((m = /^remind(?:\s+me)?\s+(?:at\s+)?(tomorrow\s+(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s+(?:to\s+|about\s+)?(.*)$/i.exec(t)) && (m[3] || m[4])) {
      let h = +m[2]; if (h > 23 || +(m[3] || 0) > 59) return null;
      if (m[4]) { h = h % 12 + (m[4].toLowerCase() === "pm" ? 12 : 0); }
      const d = new Date(); d.setHours(h, +(m[3] || 0), 0, 0);
      if (m[1]) d.setDate(d.getDate() + 1); else if (d < new Date()) d.setDate(d.getDate() + 1);
      return { at: d.getTime() / 1000, text: m[5].trim() || "Reminder" };
    }
    return null;
  }
  const whenText = at => { const s = at - Date.now() / 1000; if (s < 0) return "now"; if (s < 3600) return `in ${Math.max(1, Math.round(s / 60))} min`; const d = new Date(at * 1000);
    const day = d.toDateString() === new Date().toDateString() ? "today" : d.toDateString() === new Date(Date.now() + 864e5).toDateString() ? "tomorrow" : d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
    return `${day} at ${d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true })}`; };
  function addReminder(r, quiet) {
    const it = { id: newId(), text: r.text, at: r.at, fired: null };
    nstore.reminders.push(it); nstore.reminders.sort((a, b) => a.at - b.at);
    saveN("reminders", true); paintTodo(); armLocal();
    if (!quiet) say(`I'll remind you ${whenText(r.at)}: ${r.text}`, { icon: "suite", action: ["Undo", () => cancelReminder(it.id)] });
    sfx("pop");
    return it;
  }
  function cancelReminder(id) { nstore.reminders = nstore.reminders.filter(r => r.id !== id); saveN("reminders", true); paintTodo(); armLocal(); }
  window.qtRemind = { add: addReminder, cancel: cancelReminder, parse: parseRemind };
  palAdd((q, raw, out) => {
    const r = /^remind/i.test(raw.trim()) ? parseRemind(raw) : null;
    if (r) out.push({ label: `Remind me ${whenText(r.at)}`, sub: `"${r.text}" · a toast here and a pop-up from the tray`, fixed: 1180, glyph: "⏰", run: () => addReminder(r) });
    else if (/^remi/i.test(raw.trim())) out.push({ label: "remind 10m tea · remind 5:30pm call · remind tomorrow 9am rent", sub: "how to set a reminder", fixed: 1180, glyph: "⏰", run: () => {} });
    const up = nstore.reminders.filter(x => !x.fired);
    if (q && /remind|alarm/.test(q) && up.length) up.slice(0, 3).forEach((x, i) => out.push({ label: x.text, sub: whenText(x.at) + " · Enter cancels it", head: "Reminders", fixed: 2 - i * .01, glyph: "⏰", run: () => { cancelReminder(x.id); say("Reminder cancelled", { action: ["Undo", () => addReminder(x, true)] }); } }));
  });
  // the page's own timers fire on the second; the server's 5 s loop is the backstop (and drives the tray balloon)
  let localT = null, dueSince = Date.now() / 1000 - 5;
  const shown = new Set();
  function ring(r) {
    if (shown.has(r.id)) return;
    shown.add(r.id);
    sfx("done");
    say(`⏰ ${r.text}`, { ms: 20000, icon: "suite", action: ["+5 min", () => addReminder({ text: r.text, at: Date.now() / 1000 + 300 })] });
    const bell = document.querySelector(".td-bell"); if (bell) anim(bell, [{ transform: "rotate(0)" }, { transform: "rotate(-24deg)" }, { transform: "rotate(20deg)" }, { transform: "rotate(-14deg)" }, { transform: "rotate(8deg)" }, { transform: "none" }], { duration: 900 });
    if (document.hidden && "Notification" in window && Notification.permission === "granted") try { new Notification("Reminder", { body: r.text, icon: "/icons/suite.svg" }); } catch (_) {}
  }
  function armLocal() {
    clearTimeout(localT);
    const next = nstore.reminders.filter(r => !r.fired && !shown.has(r.id)).sort((a, b) => a.at - b.at)[0];
    if (!next) return;
    const ms = Math.max(0, next.at * 1000 - Date.now());
    if (ms > 2 ** 31 - 1) return;
    localT = setTimeout(() => { ring(next); next.fired = Date.now() / 1000; paintTodo(); armLocal(); }, ms);
  }
  async function pollDue() {
    try {
      const r = await api("/api/nova/due?since=" + dueSince);
      dueSince = r.now - 1;
      r.items.forEach(x => { ring(x); const mine = nstore.reminders.find(y => y.id === x.id); if (mine) mine.fired = x.fired; });
      if (r.items.length) paintTodo();
    } catch (_) {}
    setTimeout(pollDue, document.hidden ? 15000 : 8000);
  }
  nReady.then(() => { armLocal(); pollDue(); });

  /* =========================================================================================
     9. SCREENSHOTS: Ctrl+K "screenshot" (now) or "screenshot in 5" (time to switch windows).
        Saved in Pictures\Screenshots, opened in Pictures, one tap to the phone.
     ========================================================================================= */
  async function screenshot(delay) {
    delay = Math.max(0, Math.min(10, delay || 0));
    let cd = null;
    if (delay) {
      cd = document.createElement("div"); cd.className = "nv-count"; document.body.append(cd);
      for (let i = delay; i > 0; i--) { cd.textContent = i; anim(cd, [{ transform: "scale(1.6)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], { duration: 300, easing: spring }); sfx("tick"); await new Promise(r => setTimeout(r, 1000)); }
      cd.remove();
    } else await new Promise(r => setTimeout(r, 260));   // let the palette close first
    let r;
    try { r = await post("/api/nova/shot", { delay: 0 }); } catch (e) { return say("Screenshot failed: " + e.message, { bad: true }); }
    const f = document.createElement("div"); f.className = "nv-flash"; document.body.append(f); setTimeout(() => f.remove(), 700);
    sfx("done");
    const name = r.path.split("\\").pop();
    say(`Saved ${name} (${r.w}×${r.h}, ${human(r.size)})`, { ms: 9000, icon: "pictures", action: ["To phone", () => post("/api/peek/beam", { path: r.path }).then(x => say(x.msg || "On its way to your phone"), e => say(e.message, { bad: true }))] });
    if (window.qtPeek) window.qtPeek(r.path, {});
    return r;
  }
  window.qtShot = screenshot;
  palAdd((q, raw, out) => {
    const m = /^(?:screenshot|screen ?shot|snap|capture|grab screen)(?:\s+(?:in\s+)?(\d+)\s*s?(?:ec(?:ond)?s?)?)?$/.exec(raw.trim().toLowerCase());
    if (m) { const d = +(m[1] || 0); out.push({ label: d ? `Screenshot in ${d} seconds` : "Screenshot now", sub: d ? "switch to the window you want; every screen is captured" : "every screen, saved to Pictures\\Screenshots", fixed: 1160, glyph: "⛶", run: () => screenshot(d) });
      if (!d) out.push({ label: "Screenshot in 5 seconds", sub: "time to switch to another window", fixed: 1159, glyph: "⛶", run: () => screenshot(5) }); }
    else out.push({ label: "Screenshot", sub: "of every screen, then open it in Pictures", words: "screenshot capture screen snap print grab", glyph: "⛶", minor: true, run: () => screenshot(5) });
  });

  /* =========================================================================================
     10. TO-DO card on Home: type, Enter, tick. Reminders that are coming up sit at the top as chips.
     ========================================================================================= */
  const td = document.createElement("section");
  td.className = "td qt-card"; td.id = "todo"; td.setAttribute("aria-label", "To-do");
  td.innerHTML = `<div class="td-head"><span class="td-bell" aria-hidden="true">✓</span><h2>To-do</h2><span class="td-n qt-mono"></span>
      <button class="qt-btn ghost" data-td="clear" hidden title="Clear the ticked ones">Clear done</button></div>
    <div class="td-rem"></div>
    <form class="td-add"><input class="qt-input" placeholder="Add a to-do, or 'remind 20m stretch'" maxlength="300" aria-label="New to-do"><button class="qt-btn primary" type="submit" aria-label="Add">＋</button></form>
    <ul class="td-list"></ul>`;
  const shelfEl = document.getElementById("shelf");
  (shelfEl || document.getElementById("recentf") || hero).after(td);
  function paintTodo() {
    const list = td.querySelector(".td-list"), todos = nstore.todos;
    const open = todos.filter(t => !t.done).length, done = todos.length - open;
    td.querySelector(".td-n").textContent = todos.length ? `${open} left` : "";
    td.querySelector('[data-td="clear"]').hidden = !done;
    const sig = todos.map(t => t.id + t.done + t.text).join("|");
    if (list.dataset.sig !== sig) {
      list.dataset.sig = sig;
      list.innerHTML = [...todos].sort((a, b) => a.done - b.done).map((t, i) => `<li class="td-item${t.done ? " done" : ""}" data-id="${t.id}" style="--i:${Math.min(i, 12)}" draggable="${!t.done}">
        <button class="td-box" role="checkbox" aria-checked="${t.done}" aria-label="${esc(t.text)}"></button><span class="td-t">${esc(t.text)}</span>
        <button class="td-x" title="Delete" aria-label="Delete ${esc(t.text)}">✕</button></li>`).join("") || `<li class="td-empty qt-muted">Nothing to do. Nice.</li>`;
    }
    const up = nstore.reminders.filter(r => !r.fired).sort((a, b) => a.at - b.at);
    td.querySelector(".td-rem").innerHTML = up.slice(0, 6).map((r, i) => `<span class="td-chip" style="--i:${i}" title="${esc(new Date(r.at * 1000).toLocaleString("en-IN"))}">⏰ <b>${esc(r.text)}</b> <em>${esc(whenText(r.at))}</em><button data-rm="${r.id}" aria-label="Cancel reminder">✕</button></span>`).join("");
    td.hidden = current !== "home" || !lsGet("qt-todo", true);
  }
  td.querySelector(".td-add").addEventListener("submit", e => {
    e.preventDefault();
    const inp = td.querySelector(".td-add input"), v = inp.value.trim();
    if (!v) return;
    const r = /^remind/i.test(v) ? parseRemind(v) : null;
    if (r) addReminder(r);
    else if (/^remind/i.test(v)) return say("Try 'remind 20m stretch' or 'remind 6pm call'", { bad: true });
    else { nstore.todos.unshift({ id: newId(), text: v, done: false, ts: Date.now() / 1000 }); saveN("todos", true); paintTodo(); sfx("pop");
      const li = td.querySelector(".td-item"); anim(li, [{ transform: "translateY(-12px) scale(.9)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 360, easing: spring }); }
    inp.value = "";
  });
  td.addEventListener("click", e => {
    const rm = e.target.closest("[data-rm]");
    if (rm) { const x = nstore.reminders.find(r => r.id === rm.dataset.rm); cancelReminder(rm.dataset.rm); return x && say("Reminder cancelled", { action: ["Undo", () => addReminder(x, true)] }); }
    if (e.target.closest('[data-td="clear"]')) {
      const before = nstore.todos.slice(); nstore.todos = nstore.todos.filter(t => !t.done); saveN("todos", true); paintTodo();
      return say(`Cleared ${before.length - nstore.todos.length} done`, { action: ["Undo", () => { nstore.todos = before; saveN("todos", true); paintTodo(); }] });
    }
    const li = e.target.closest(".td-item"); if (!li) return;
    const t = nstore.todos.find(x => x.id === li.dataset.id); if (!t) return;
    if (e.target.closest(".td-x")) {
      const i = nstore.todos.indexOf(t);
      const a = anim(li, [{ transform: "none", opacity: 1 }, { transform: "translateX(40px)", opacity: 0 }], { duration: 200, easing: "ease-in", fill: "forwards" });
      (a ? a.finished : Promise.resolve()).then(() => { nstore.todos.splice(i, 1); saveN("todos", true); paintTodo(); });
      return say(`Deleted "${t.text.slice(0, 40)}"`, { action: ["Undo", () => { nstore.todos.splice(i, 0, t); saveN("todos", true); paintTodo(); }] });
    }
    if (e.target.closest(".td-box") || e.target.closest(".td-t")) {
      t.done = !t.done; saveN("todos");
      li.classList.toggle("done", t.done); li.querySelector(".td-box").setAttribute("aria-checked", t.done);
      if (t.done) { burst(li.querySelector(".td-box")); sfx("done"); } else sfx("tick");
      setTimeout(paintTodo, t.done ? 650 : 0);
    }
  });
  td.addEventListener("dblclick", e => {   // double-click text to edit it
    const sp = e.target.closest(".td-t"); if (!sp) return;
    const t = nstore.todos.find(x => x.id === sp.parentElement.dataset.id); if (!t) return;
    sp.contentEditable = "true"; sp.focus(); document.getSelection().selectAllChildren(sp);
    const done = keep => { sp.contentEditable = "false"; const v = sp.textContent.trim(); if (keep && v) { t.text = v.slice(0, 300); saveN("todos", true); } paintTodo(); };
    sp.onkeydown = k => { if (k.key === "Enter") { k.preventDefault(); done(true); } if (k.key === "Escape") { k.stopPropagation(); sp.textContent = t.text; done(false); } };
    sp.onblur = () => done(true);
  });
  // drag to reorder open to-dos
  let dragT = null;
  td.addEventListener("dragstart", e => { const li = e.target.closest(".td-item"); if (!li) return; dragT = li; li.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; });
  td.addEventListener("dragover", e => {
    if (!dragT) return; e.preventDefault();
    const over = e.target.closest(".td-item:not(.done)"); if (!over || over === dragT) return;
    const items = [...over.parentElement.children], before = items.indexOf(over) < items.indexOf(dragT);
    over.parentElement.insertBefore(dragT, before ? over : over.nextSibling);
  });
  td.addEventListener("dragend", () => {
    if (!dragT) return; dragT.classList.remove("dragging"); dragT = null;
    const order = [...td.querySelectorAll(".td-item")].map(x => x.dataset.id);
    nstore.todos.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)); saveN("todos", true);
  });
  function burst(el) {
    if (RM.matches || !el) return;
    const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    for (let i = 0; i < 10; i++) {
      const p = document.createElement("i"); p.className = "nv-bit"; p.style.left = cx + "px"; p.style.top = cy + "px";
      p.style.background = ["var(--qt-accent)", "var(--qt-volt)", "var(--qt-soundboard)", "var(--qt-launchpad)"][i % 4];
      document.body.append(p);
      const a = (i / 10) * Math.PI * 2, d = 26 + Math.random() * 18;
      p.animate([{ transform: "translate(-50%,-50%) scale(1)", opacity: 1 }, { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d}px)) scale(.2) rotate(${a}rad)`, opacity: 0 }], { duration: 520, easing: "cubic-bezier(.2,.9,.3,1)" }).finished.then(() => p.remove());
    }
  }
  window.qtBurst = burst;
  document.addEventListener("qt-nova", paintTodo);
  document.addEventListener("qt-show", e => { if (e.detail === "home") paintTodo(); else td.hidden = true; });
  document.addEventListener("qt-extras", e => { if (e.detail === "qt-todo") paintTodo(); });
  setInterval(() => { if (!td.hidden && nstore.reminders.some(r => !r.fired)) paintTodo(); }, 30000);
  paintTodo();
  palAdd((q, raw, out) => {
    const t = raw.trim();
    if (/^(todo|to-do|task)\s+\S/i.test(t)) {
      const text = t.replace(/^\S+\s+/, "");
      out.push({ label: `Add to-do: "${text.slice(0, 50)}"`, fixed: 1170, glyph: "✓", run: () => { nstore.todos.unshift({ id: newId(), text, done: false, ts: Date.now() / 1000 }); saveN("todos", true); paintTodo(); say("Added to your to-do list", { action: ["Show", () => show("home")] }); } });
    }
    const ql = q.trim().toLowerCase();
    if (ql.length >= 3) nstore.todos.filter(x => !x.done && x.text.toLowerCase().includes(ql)).slice(0, 3).forEach((x, i) =>
      out.push({ label: x.text, sub: "to-do · Enter ticks it", head: "To-do", fixed: 2.1 - i * .01, glyph: "☐", run: () => { x.done = true; saveN("todos", true); paintTodo(); say(`Ticked "${x.text.slice(0, 40)}"`, { action: ["Undo", () => { x.done = false; saveN("todos", true); paintTodo(); }] }); } }));
  });

  /* =========================================================================================
     11. NETWORK speed: a third row in the CPU / RAM meter (down + up, all adapters)
     ========================================================================================= */
  const sm = document.querySelector(".sysm");
  let netT = 0;
  if (sm) {
    const row = document.createElement("div");
    row.className = "sm-row nv-net";
    row.innerHTML = `<span class="sm-k">NET</span><b class="sm-v nv-rates"><span data-k="down">↓ -</span><span data-k="up">↑ -</span></b><canvas width="180" height="34" data-c="net"></canvas>`;
    sm.querySelector(".sm-foot").before(row);
    const cv = row.querySelector("canvas");
    const col = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    function drawNet(h) {
      const g = cv.getContext("2d"), w = cv.width, H = cv.height;
      g.clearRect(0, 0, w, H);
      if (h.length < 2) return;
      const pts = h.slice(-40), mx = Math.max(32768, ...pts.map(p => Math.max(p[0], p[1]))), step = w / 39, off = (40 - pts.length) * step;
      [[0, col("--qt-burrow") || "#2ee6d6"], [1, col("--qt-soundboard") || "#ff5fa2"]].forEach(([k, c]) => {
        g.beginPath(); pts.forEach((p, i) => { const x = off + i * step, y = H - 3 - (Math.sqrt(p[k] / mx)) * (H - 6); i ? g.lineTo(x, y) : g.moveTo(x, y); });
        g.strokeStyle = c; g.lineWidth = k ? 2 : 2.5; g.lineJoin = "round"; g.stroke();
      });
    }
    async function pollNet() {
      clearTimeout(netT);
      row.hidden = !lsGet("qt-net", true);
      if (sm.hidden || row.hidden) { netT = setTimeout(pollNet, 3000); return; }
      try {
        const r = await api("/api/nova/net");
        row.querySelector('[data-k="down"]').textContent = "↓ " + rate(r.down);
        row.querySelector('[data-k="up"]').textContent = "↑ " + rate(r.up);
        drawNet(r.hist || []);
      } catch (_) {}
      netT = setTimeout(pollNet, document.hidden ? 8000 : 2000);
    }
    pollNet();
    document.addEventListener("qt-extras", e => { if (e.detail === "qt-net") pollNet(); });
  }

  /* =========================================================================================
     12. TOP PROGRAMS by memory under the meter's pop-up, with End (press twice; Windows' own ones can't be ended)
     ========================================================================================= */
  new MutationObserver(() => {
    const pop = document.querySelector(".sm-pop");
    if (!pop || pop.querySelector(".nv-top")) return;
    const sec = document.createElement("div");
    sec.className = "nv-top";
    sec.innerHTML = `<div class="qt-eyebrow">Everything on this PC</div><p class="qt-muted nv-load">Looking...</p>`;
    pop.append(sec);
    pop.style.maxHeight = (innerHeight - parseFloat(pop.style.top) - 16) + "px";
    api("/api/nova/top").then(r => {
      const mx = r.items.length ? r.items[0].mem : 1;
      sec.querySelector(".nv-load").remove();
      sec.insertAdjacentHTML("beforeend", r.items.map((p, i) => `<div class="nv-p" style="--i:${i}" data-name="${esc(p.name)}" data-pids="${p.pids.join(",")}">
        <b title="${esc(p.name)}">${esc(p.name.replace(/\.exe$/i, ""))}${p.count > 1 ? ` <small>×${p.count}</small>` : ""}</b><span class="qt-mono">${human(p.mem)}</span>
        ${p.safe ? `<button class="nv-end" title="Close it (unsaved work in it is lost)">End</button>` : `<em title="Windows needs this">sys</em>`}<i style="--w:${Math.max(3, p.mem / mx * 100)}%"></i></div>`).join(""));
    }).catch(e => { sec.querySelector(".nv-load").textContent = e.message; });
  }).observe(document.body, { childList: true });
  document.addEventListener("click", e => {
    const b = e.target.closest(".nv-end"); if (!b) return;
    e.stopPropagation();
    const row = b.closest(".nv-p");
    if (!b.classList.contains("sure")) { b.classList.add("sure"); b.textContent = "Sure?"; setTimeout(() => { b.classList.remove("sure"); b.textContent = "End"; }, 3000); return; }
    b.disabled = true; b.textContent = "...";
    post("/api/nova/kill", { name: row.dataset.name, pids: row.dataset.pids.split(",").map(Number) }).then(r => {
      say(r.msg); sfx("tick");
      const a = anim(row, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateX(30px)" }], { duration: 240, fill: "forwards" });
      (a ? a.finished : Promise.resolve()).then(() => row.remove());
    }, er => { say(er.message, { bad: true }); b.disabled = false; b.textContent = "End"; b.classList.remove("sure"); });
  }, true);

  /* =========================================================================================
     13. QR CODES: "qr <anything>" in Ctrl+K, and every link in the palette gets "Show as QR"
     ========================================================================================= */
  let qrLib = null;
  function loadQr() {
    return qrLib || (qrLib = new Promise((res, rej) => { if (window.qrcode) return res(); const s = document.createElement("script"); s.src = "/qrcode.js"; s.onload = res; s.onerror = () => { qrLib = null; rej(new Error("QR maker missing")); }; document.head.append(s); }));
  }
  async function showQr(text) {
    try { await loadQr(); } catch (e) { return say(e.message, { bad: true }); }
    if (qrcode.stringToBytesFuncs && qrcode.stringToBytesFuncs["UTF-8"]) qrcode.stringToBytes = qrcode.stringToBytesFuncs["UTF-8"];
    let qr;
    try { qr = qrcode(0, text.length > 300 ? "L" : "M"); qr.addData(text); qr.make(); } catch (_) { return say("That's too long for a QR code", { bad: true }); }
    const n = qr.getModuleCount(), px = Math.max(4, Math.floor(320 / (n + 8))), size = (n + 8) * px;
    const wrap = document.createElement("div");
    wrap.className = "nv-qr-wrap";
    wrap.innerHTML = `<div class="nv-qr qt-card" role="dialog" aria-label="QR code"><canvas width="${size}" height="${size}"></canvas>
      <p class="qt-mono">${esc(text.length > 90 ? text.slice(0, 90) + "..." : text)}</p>
      <div class="nv-qr-btns"><button class="qt-btn" data-q="copy">Copy text</button><button class="qt-btn" data-q="png">Save picture</button><button class="qt-btn primary" data-q="x">Done</button></div></div>`;
    document.body.append(wrap);
    const cv = wrap.querySelector("canvas"), g = cv.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, size, size); g.fillStyle = "#16141a";
    const cells = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) cells.push([r, c]);
    if (RM.matches) cells.forEach(([r, c]) => g.fillRect((c + 4) * px, (r + 4) * px, px, px));
    else { // paint in from the centre outwards
      cells.sort((a, b) => Math.hypot(a[0] - n / 2, a[1] - n / 2) - Math.hypot(b[0] - n / 2, b[1] - n / 2));
      let i = 0; const per = Math.ceil(cells.length / 18);
      (function step() { for (let k = 0; k < per && i < cells.length; k++, i++) g.fillRect((cells[i][1] + 4) * px, (cells[i][0] + 4) * px, px, px); if (i < cells.length) requestAnimationFrame(step); })();
    }
    anim(wrap.firstElementChild, [{ transform: "scale(.7) rotate(-4deg)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 380, easing: spring });
    const close = () => { wrap.remove(); document.removeEventListener("keydown", k, true); };
    const k = e => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    document.addEventListener("keydown", k, true);
    wrap.addEventListener("click", e => {
      if (e.target === wrap) return close();
      const b = e.target.closest("[data-q]"); if (!b) return;
      if (b.dataset.q === "x") close();
      if (b.dataset.q === "copy") copyText(text, "the text");
      if (b.dataset.q === "png") { const a = document.createElement("a"); a.href = cv.toDataURL("image/png"); a.download = "qr-code.png"; a.click(); say("Saved qr-code.png to Downloads"); }
    });
  }
  window.qtQr = showQr;
  palAdd((q, raw, out) => {
    const t = raw.trim();
    if (/^qr\s+\S/i.test(t)) out.push({ label: "Show as a QR code", sub: t.slice(3).slice(0, 60), fixed: 1190, glyph: "▣", run: () => showQr(t.slice(3)) });
    else if (/^https?:\/\/\S+$/i.test(t)) out.push({ label: "Show the link as a QR code", sub: "scan it with your phone", fixed: 1040, glyph: "▣", run: () => showQr(t) });
  });

  /* =========================================================================================
     14. RECENT SEARCHES: an empty Ctrl+K shows the last few things you typed and ran
     ========================================================================================= */
  function remember() {
    const inp = palInput(), c = window.qtPalSel && window.qtPalSel();
    if (!inp || !c) return;
    const qv = inp.value.trim();
    if (qv.length < 2 || /^(pw|pass|password|uuid|guid|coin)\b/i.test(qv)) return;   // generators make new values; nothing secret is kept
    const h = lsGet("qt-pal-hist", []).filter(x => x.q.toLowerCase() !== qv.toLowerCase());
    h.unshift({ q: qv, label: String(c.label).slice(0, 80) }); lsSet("qt-pal-hist", h.slice(0, 8));
  }
  document.addEventListener("keydown", e => { if (e.key === "Enter" && document.querySelector(".pal-wrap") && e.target === palInput()) remember(); }, true);
  document.addEventListener("pointerdown", e => { if (e.target.closest(".pal-wrap .pal-item")) remember(); }, true);   // hover already moved the selection
  palAdd((q, raw, out) => {
    if (q) return;
    lsGet("qt-pal-hist", []).slice(0, 4).forEach(h => out.push({ label: h.q, sub: "last time: " + h.label, head: "Recent", glyph: "↺",
      run: () => setTimeout(() => { window.qtPalOpen(); const i = palInput(); if (i) { i.value = h.q; i.dispatchEvent(new Event("input")); } }, 200) }));
  });

  /* =========================================================================================
     15. ZEN MODE (Ctrl+Shift+F): the rail slides away so the tool gets the whole window.
         Nudge the left edge to peek at the rail; Esc or the chip brings it back.
     ========================================================================================= */
  const zchip = document.createElement("button");
  zchip.className = "nv-zen-chip qt-btn"; zchip.type = "button"; zchip.hidden = true; zchip.title = "Leave zen mode (Ctrl+Shift+F)"; zchip.innerHTML = "◐ <span>Zen</span>";
  document.body.append(zchip);
  function zen(on) {
    on = on == null ? !document.body.classList.contains("zen") : on;
    document.body.classList.toggle("zen", on); document.body.classList.remove("zen-peek");
    zchip.hidden = !on; lsSet("qt-zen", on);
    setTimeout(() => { window.movePill && movePill(); dispatchEvent(new Event("resize")); }, 380);
    if (on) say("Zen mode. Ctrl+Shift+F or the chip brings the rail back.", { ms: 3000 });
  }
  zchip.onclick = () => zen(false);
  window.qtZen = zen;
  const zenKey = e => { if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "f") { e.preventDefault(); zen(); } };
  document.addEventListener("keydown", zenKey);
  document.addEventListener("mousemove", e => {
    if (!document.body.classList.contains("zen")) return;
    if (e.clientX <= 4) document.body.classList.add("zen-peek");
    else if (e.clientX > 260 && document.body.classList.contains("zen-peek")) document.body.classList.remove("zen-peek");
  });
  document.getElementById("rail").addEventListener("click", e => { if (e.target.closest("[data-go]") && document.body.classList.contains("zen-peek")) setTimeout(() => document.body.classList.remove("zen-peek"), 200); });
  if (lsGet("qt-zen", false)) zen(true);
  palAdd((q, raw, out) => out.push({ label: document.body.classList.contains("zen") ? "Leave zen mode" : "Zen mode", sub: "hide the rail so the tool fills the window", words: "zen focus fullscreen hide rail distraction", glyph: "◐", hint: "Ctrl+Shift+F", minor: true, run: () => zen() }));

  /* =========================================================================================
     16. BACK + FORWARD between tools: Alt+← / Alt+→ and the mouse's side buttons
     ========================================================================================= */
  const hist = [current], fwd = [];
  let navigating = false;
  document.addEventListener("qt-show", e => {
    if (navigating) { navigating = false; return; }
    if (hist[hist.length - 1] !== e.detail) { hist.push(e.detail); if (hist.length > 40) hist.shift(); fwd.length = 0; }
  });
  function go(dir) {
    const from = dir < 0 ? hist : fwd, to = dir < 0 ? fwd : hist;
    if (dir < 0 ? hist.length < 2 : !fwd.length) return sfx("bad");
    let id;
    if (dir < 0) { to.push(hist.pop()); id = hist[hist.length - 1]; }
    else { id = from.pop(); hist.push(id); }
    if (id !== "home" && id !== "settings" && id !== "search" && !tools.some(t => t.id === id)) return go(dir);
    navigating = true; show(id); sfx("tick");
    const st = document.getElementById("stage");
    anim(st, [{ transform: `translateX(${dir * -18}px)`, opacity: .6 }, { transform: "none", opacity: 1 }], { duration: 260, easing: "cubic-bezier(.2,.9,.2,1)" });
  }
  window.qtBack = () => go(-1); window.qtForward = () => go(1);
  document.addEventListener("keydown", e => { if (e.altKey && !e.ctrlKey && (e.key === "ArrowLeft" || e.key === "ArrowRight") && !typing(e)) { e.preventDefault(); go(e.key === "ArrowLeft" ? -1 : 1); } });
  document.addEventListener("mouseup", e => { if (e.button === 3 || e.button === 4) { e.preventDefault(); go(e.button === 3 ? -1 : 1); } });
  // same-origin tools (Inkmotion, Pixlab, viewers) pass these keys up too
  document.getElementById("frames").addEventListener("load", e => {
    try { e.target.contentWindow.addEventListener("keydown", ev => {
      if (ev.altKey && (ev.key === "ArrowLeft" || ev.key === "ArrowRight") && !/^(INPUT|TEXTAREA)$/.test(ev.target.tagName)) { ev.preventDefault(); go(ev.key === "ArrowLeft" ? -1 : 1); }
      if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey && ev.key.toLowerCase() === "f") { ev.preventDefault(); zen(); }
      if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey && ev.key.toLowerCase() === "v") { ev.preventDefault(); toggleClips(); }
    }, true); } catch (_) {}
  }, true);
  palAdd((q, raw, out) => {
    if (hist.length > 1) { const id = hist[hist.length - 2], t = tools.find(x => x.id === id); out.push({ label: `Back to ${t ? t.name : id === "home" ? "Home" : id}`, words: "back previous last", glyph: "←", hint: "Alt+←", minor: true, run: () => go(-1) }); }
  });

  /* =========================================================================================
     17. LOOK: pick Home's accent colour and its wallpaper (dots, grid, lines, plain) in Settings
     ========================================================================================= */
  const ACC = [["", "Lime"], ["#4dc3ff", "Sky"], ["#ffc93d", "Sun"], ["#ff5fa2", "Bubblegum"], ["#b28bff", "Grape"], ["#5dffb0", "Mint"], ["#ff8a3d", "Tangerine"], ["#2ee6d6", "Aqua"], ["#ff4d5e", "Cherry"]];
  const WALL = [["dots", "Dots"], ["grid", "Grid"], ["lines", "Lines"], ["plain", "Plain"]];
  const lookCss = document.createElement("style"); lookCss.id = "nv-look"; document.head.append(lookCss);
  function applyLook() {
    const a = lsGet("qt-accent", ""), w = lsGet("qt-wall", "dots");
    lookCss.textContent = a ? `body[data-tool="home"], body[data-tool="settings"], body[data-tool="search"] { --qt-accent: ${a}; }` : "";
    home.classList.toggle("qt-dots", w === "dots"); home.dataset.wall = w;
  }
  applyLook();
  function lookBox() {
    const a = lsGet("qt-accent", ""), w = lsGet("qt-wall", "dots");
    return `<section class="sbox qt-card sx-box nv-look" style="--i:3.4" id="nv-look-box"><h2>Look</h2>
      <div class="sline"><span><b>Home accent</b><em>The colour of Home, Settings and Search. Each tool keeps its own.</em></span>
        <div class="nv-sw" role="radiogroup" aria-label="Home accent">${ACC.map(([c, n]) => `<button role="radio" aria-checked="${a === c}" data-acc="${c}" title="${n}" aria-label="${n}" style="--c:${c || "var(--qt-beam)"}"></button>`).join("")}</div></div>
      <div class="sline"><span><b>Home wallpaper</b><em>The pattern behind the tiles.</em></span>
        <div class="sx-seg" role="radiogroup">${WALL.map(([v, l]) => `<button role="radio" data-wall="${v}" aria-checked="${w === v}">${l}</button>`).join("")}</div></div>
    </section>`;
  }
  const NEWX = [["qt-todo", true, "To-do card on Home", "Your list and coming-up reminders under the shelf."], ["qt-net", true, "Network speed in the meter", "Download and upload next to CPU and RAM."]];
  function addBoxes() {
    const set = document.querySelector(".view.settings"), ex = set && set.querySelector("#sx-extras");
    if (!ex || set.querySelector("#nv-look-box")) return;
    ex.insertAdjacentHTML("beforebegin", lookBox());
    const seg = ex.querySelector(".sline:has(.sx-seg)") || ex.lastElementChild;
    seg.insertAdjacentHTML("beforebegin", NEWX.map(([k, d, label, sub]) => `<div class="sline"><span><b>${esc(label)}</b><em>${esc(sub)}</em></span><button class="qt-switch" role="switch" aria-checked="${!!lsGet(k, d)}" data-sx="${k}" aria-label="${esc(label)}"></button></div>`).join("")
      + `<div class="sline"><span><b>Clipboard history</b><em>Keeps your last 25 copies in memory only (Ctrl+Shift+V). Password managers' copies are skipped.</em></span><button class="qt-switch" role="switch" aria-checked="${!clipPaused}" data-clipsw aria-label="Clipboard history"></button></div>`);
  }
  new MutationObserver(addBoxes).observe(document.getElementById("frames"), { childList: true, subtree: true });
  document.addEventListener("click", e => {
    const ac = e.target.closest("[data-acc]");
    if (ac) { ac.parentElement.querySelectorAll("[data-acc]").forEach(b => b.setAttribute("aria-checked", b === ac)); lsSet("qt-accent", ac.dataset.acc); applyLook(); sfx("pop");
      anim(ac, [{ transform: "scale(1.35)" }, { transform: "none" }], { duration: 300, easing: spring }); return; }
    const wl = e.target.closest("[data-wall]");
    if (wl) { wl.parentElement.querySelectorAll("[data-wall]").forEach(b => b.setAttribute("aria-checked", b === wl)); lsSet("qt-wall", wl.dataset.wall); applyLook(); sfx("tick"); return; }
    const cs = e.target.closest("[data-clipsw]");
    if (cs) { const on = cs.getAttribute("aria-checked") !== "true"; cs.setAttribute("aria-checked", on); setClipPause(!on); }
  });

  /* =========================================================================================
     18. CLIPBOARD HISTORY (Ctrl+Shift+V): the last 25 things you copied anywhere on the PC.
         Click copies it back, 📱 sends it to the phone. Memory only; gone when the suite stops.
     ========================================================================================= */
  let cd = null, clipPaused = false, clipQ = "";
  api("/api/nova/clips").then(r => { clipPaused = r.paused; }).catch(() => {});
  function setClipPause(p) { post("/api/nova/clips", { paused: p }).then(r => { clipPaused = r.paused; say(p ? "Clipboard history paused" : "Clipboard history on"); if (cd) paintClips(r); }); }
  async function paintClips(r) {
    if (!cd) return;
    r = r || await api("/api/nova/clips").catch(() => ({ items: [], paused: clipPaused }));
    clipPaused = r.paused; lastClips = { ...r, t: Date.now() };
    const items = r.items.filter(c => !clipQ || c.text.toLowerCase().includes(clipQ));
    cd.querySelector('[data-c="pause"]').textContent = r.paused ? "▶ Resume" : "⏸ Pause";
    const list = cd.querySelector(".cv-list"), sig = r.paused + items.map(c => c.ts).join(",");
    if (list.dataset.sig === sig) return;
    list.dataset.sig = sig;
    list.innerHTML = items.length ? items.map((c, i) => `<div class="cv-item" data-ts="${c.ts}" style="--i:${Math.min(i, 12)}" tabindex="0" role="button" title="Click to copy">
        <span class="cv-t">${esc(c.text.length > 400 ? c.text.slice(0, 400) + "..." : c.text)}</span>
        <span class="cv-meta qt-mono">${ago(c.ts)} · ${c.text.length} chars</span>
        <span class="cv-btns"><button data-c="phone" title="Send to phone">📱</button>${/^https?:\/\/\S+$/.test(c.text.trim()) ? `<button data-c="qr" title="QR code">▣</button>` : ""}<button data-c="forget" title="Forget this one">✕</button></span></div>`).join("")
      : `<p class="qt-muted cv-empty">${r.paused ? "Paused. Nothing new is kept." : clipQ ? "Nothing matches." : "Copy something anywhere on the PC and it shows up here."}</p>`;
  }
  function toggleClips() {
    if (cd) return closeClips();
    cd = document.createElement("aside");
    cd.className = "nt-drawer cv-drawer qt-card"; cd.setAttribute("role", "dialog"); cd.setAttribute("aria-label", "Clipboard history");
    cd.innerHTML = `<div class="sbh"><h2 class="qt-display">Clipboard</h2><span class="qt-mono cv-note">last 25 · memory only</span>
        <button class="qt-btn ghost icon" data-c="close" aria-label="Close (Esc)" title="Close (Esc)">✕</button></div>
      <input class="qt-input cv-q" placeholder="Filter..." aria-label="Filter clipboard history">
      <div class="cv-list"></div>
      <div class="nt-bar"><button class="qt-btn" data-c="pause">⏸ Pause</button><button class="qt-btn ghost" data-c="clear">Clear all</button></div>`;
    document.body.append(cd);
    anim(cd, [{ transform: "translateX(110%) rotate(3deg)" }, { transform: "translateX(-10px)", offset: .7 }, { transform: "none" }], { duration: 460, easing: "cubic-bezier(.2,.9,.2,1)" });
    clipQ = ""; paintClips();
    const q = cd.querySelector(".cv-q"); q.focus();
    q.oninput = () => { clipQ = q.value.trim().toLowerCase(); paintClips(); };
    cd._t = setInterval(() => paintClips(), 1500);
    cd.addEventListener("click", async e => {
      const b = e.target.closest("[data-c]"), it = e.target.closest(".cv-item");
      const item = it && lastClips.items.find(c => String(c.ts) === it.dataset.ts);
      if (b && b.dataset.c === "close") return closeClips();
      if (b && b.dataset.c === "pause") return setClipPause(!clipPaused);
      if (b && b.dataset.c === "clear") { const r = await post("/api/nova/clips", { clear: true }); paintClips(r); return say("Clipboard history cleared"); }
      if (!item) return;
      if (b && b.dataset.c === "forget") { const r = await post("/api/nova/clips", { forget: item.ts }); return paintClips(r); }
      if (b && b.dataset.c === "phone") return post("/api/spark/phone-note", { text: item.text }).then(r => say(r.msg || "Sent to your phone"), er => say(er.message, { bad: true }));
      if (b && b.dataset.c === "qr") return showQr(item.text.trim());
      copyText(item.text, "it"); anim(it, [{ transform: "scale(.96)" }, { transform: "none" }], { duration: 240, easing: spring });
    });
    cd.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.classList.contains("cv-item")) e.target.click(); });
    sfx("open");
  }
  function closeClips() {
    if (!cd) return;
    const d = cd; cd = null; clearInterval(d._t);
    const a = anim(d, [{ transform: "none" }, { transform: "translateX(110%) rotate(3deg)" }], { duration: 260, easing: "ease-in", fill: "forwards" });
    a ? a.finished.then(() => d.remove(), () => d.remove()) : d.remove();
  }
  window.qtClips = { toggle: toggleClips, close: closeClips };
  document.addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "v") { e.preventDefault(); return toggleClips(); }
    if (e.key === "Escape" && cd && !document.querySelector(".pal-wrap, .nv-qr-wrap")) { e.preventDefault(); closeClips(); }
  });
  document.addEventListener("pointerdown", e => { if (cd && !e.target.closest(".cv-drawer, .rail-btns, .qt-toast, .pal-wrap, .nv-qr-wrap")) closeClips(); });
  const rb = document.querySelector(".rail-btns");
  if (rb) {
    const cb = document.createElement("button");
    cb.className = "qt-btn ghost"; cb.id = "clips-btn"; cb.title = "Clipboard history (Ctrl+Shift+V)";
    cb.innerHTML = '<i class="clip">⧉</i><span>Clips</span>';
    cb.onclick = toggleClips;
    const nb = document.getElementById("notes-btn");
    nb ? nb.after(cb) : rb.prepend(cb);
  }
  palAdd((q, raw, out) => {
    out.push({ label: "Clipboard history", sub: "the last 25 things you copied", words: "clipboard history copies paste clips", glyph: "⧉", hint: "Ctrl+Shift+V", minor: !q, run: toggleClips });
    const ql = q.trim().toLowerCase();
    if (ql.length >= 3 && !ql.startsWith(">")) { freshClips(); lastClips.items.filter(c => c.text.toLowerCase().includes(ql)).slice(0, 3).forEach((c, i) =>
      out.push({ label: c.text.replace(/\s+/g, " ").slice(0, 70), sub: "copied " + ago(c.ts) + " · Enter copies it again", head: "Clipboard", fixed: 1.9 - i * .01, glyph: "⧉", run: () => copyText(c.text, "it") })); }
  });

  /* =========================================================================================
     19. MOTION: palette answers pop in, the rail's new buttons wobble on hover, zen slides (CSS in nova.css).
         Here: the palette's top answer gets a soft "ding" scale when it changes.
     ========================================================================================= */
  new MutationObserver(() => {
    const first = document.querySelector(".pal-wrap .pal-item");
    if (!first) return;
    const label = first.textContent.trim().slice(0, 60);
    if (first.dataset.nvSeen === label) return;
    first.dataset.nvSeen = label;
    if (/^[=#›✦◷▦⏰⛶▣]/.test(first.querySelector(".pi").textContent.trim()) || first.querySelector(".pi img[src^='data:']"))
      anim(first, [{ transform: "scale(.97)", filter: "brightness(1.4)" }, { transform: "none", filter: "none" }], { duration: 280, easing: spring });
  }).observe(document.body, { childList: true, subtree: true });

  /* =========================================================================================
     20. SHORTCUTS + WHAT'S NEW (v5) + backup of to-dos and reminders
     ========================================================================================= */
  if (window.qtKeys) window.qtKeys.push(["Ctrl", "Shift", "V"], "Clipboard history", ["Ctrl", "Shift", "F"], "Zen mode: hide the rail", ["Alt", "←"], "Back to the last tool", ["Alt", "→"], "Forward again");
  const TIPS = [["spot", "an app from the Start menu"], ["g cats", "search Google (yt, w, gh, maps, amz, tr)"], ["#ff6b4a", "a colour in every format"], ["> upper", "text tools on your last copy"],
    ["pw 24", "a strong password"], ["time in tokyo", "world clock"], ["days until 25 dec", "date maths"], ["remind 10m tea", "a reminder"], ["screenshot in 5", "a screenshot"], ["qr hello", "a QR code"], ["todo buy milk", "a to-do"]];
  palAdd((q, raw, out) => {
    if (raw.trim() !== "?") return;
    TIPS.forEach(([ex, what], i) => out.push({ label: ex, sub: what, fixed: 1300 - i, glyph: "?", run: () => setTimeout(() => { window.qtPalOpen(); const inp = palInput(); inp.value = ex; inp.dispatchEvent(new Event("input")); }, 200) }));
  });
  const NEW = [
    ["◧", "Apps in Ctrl+K", "Type a few letters of any Start menu app and press Enter. 'g', 'yt' or 'w' before words searches the web.", () => tryPal("spot")],
    ["✦", "Little helpers", "Colours, passwords, dice, world clock, date maths and text tools. Type ? in Ctrl+K for the list.", () => tryPal("?")],
    ["⏰", "Reminders", "'remind 10m tea' in Ctrl+K or the to-do box. The tray pops up even with the window shut.", () => tryPal("remind 10m tea")],
    ["✓", "To-do on Home", "Tick, drag, double-click to edit. Under your pins.", () => { show("home"); setTimeout(() => td.querySelector("input").focus(), 300); }],
    ["⧉", "Clipboard history", "Ctrl+Shift+V shows your last 25 copies. Click one to copy it again.", () => toggleClips()],
    ["⛶", "Screenshots + QR", "'screenshot in 5' captures every screen. 'qr' plus text makes a code for your phone.", () => tryPal("screenshot in 5")],
    ["⇅", "Network + top programs", "The meter shows download and upload. Click it to see and end memory hogs.", null],
    ["◐", "Zen, back, Look", "Ctrl+Shift+F hides the rail, Alt+← goes back, and Settings has Home colours and wallpapers.", () => show("settings")],
  ];
  function tryPal(text) { window.qtPalOpen(); const i = palInput(); if (i) { i.value = text; i.dispatchEvent(new Event("input")); } }
  function whatsNew(force) {
    if (!force && lsGet("qt-new-v5", false)) return;
    if (document.querySelector(".wn")) document.querySelector(".wn").remove();
    const c = document.createElement("section");
    c.className = "wn qt-card nv-wn"; c.setAttribute("aria-label", "What's new");
    c.innerHTML = `<div class="wn-head"><span class="wn-tag">NEW</span><h2 class="qt-display">Round five</h2><button class="qt-btn ghost icon" data-wn5="x" aria-label="Got it" title="Got it">✕</button></div>
      <div class="wn-grid">${NEW.map(([ic, t, d, f], i) => `<button class="wn-item" data-wn5="${i}" style="--i:${i}" ${f ? "" : 'data-static="1"'}><i>${ic}</i><b>${esc(t)}</b><small>${esc(d)}</small>${f ? "<em>Try it →</em>" : ""}</button>`).join("")}</div>`;
    hero.after(c);
    c.addEventListener("click", e => {
      const b = e.target.closest("[data-wn5]"); if (!b) return;
      if (b.dataset.wn5 === "x") {
        lsSet("qt-new-v5", true); lsSet("qt-new-v4", true);
        const a = anim(c, [{ transform: "none", opacity: 1, height: c.offsetHeight + "px" }, { transform: "scale(.96) translateY(-10px)", opacity: 0, height: "0px", marginBottom: "-22px" }], { duration: 360, easing: "cubic-bezier(.5,0,.75,0)", fill: "forwards" });
        return a ? a.finished.then(() => c.remove(), () => c.remove()) : c.remove();
      }
      const f = NEW[+b.dataset.wn5][3]; if (f) f();
    });
  }
  window.qtWhatsNew5 = whatsNew;
  palAdd((q, raw, out) => out.push({ label: "What's new in round five", words: "new whats changelog features help tour round five", glyph: "✨", minor: true, run: () => { show("home"); setTimeout(() => whatsNew(true), 200); } }));
  setTimeout(() => { if (current === "home") whatsNew(); }, 1100);
  // backup: spark's export/import call these so to-dos and reminders travel in the same file
  window.qtBackupExtra = {
    keys: ["qt-pal-hist", "qt-accent", "qt-wall", "qt-todo", "qt-net", "qt-zen"],
    get: () => api("/api/nova/store"),
    set: d => post("/api/nova/store", { todos: d.todos || [], reminders: d.reminders || [] }).then(s => { nstore = s; paintTodo(); armLocal(); }),
  };
})();
