// Takes the README screenshots and demo clips from a demo copy of QT Suite (see make_media.ps1).
//   node capture.cjs <hub port> <out folder> <demo home> <json map of real tool port -> demo port>
// Every tool page the hub embeds is routed to its demo copy, so only made-up data shows. Text that could
// identify a PC (its name, its network addresses) is swapped for neutral stand-ins on the way in.
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path"), os = require("os");
const [hubPort, OUT, HOME, mapJson] = process.argv.slice(2);
const MAP = JSON.parse(process.env.QT_MEDIA_MAP || mapJson);
const base = `http://127.0.0.1:${hubPort}/`;
fs.mkdirSync(path.join(OUT, "clips"), { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

// identifying text -> stand-ins
const host = os.hostname();
const ips = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === "IPv4" && !i.internal).map(i => i.address);
const HIDE = (process.env.QT_MEDIA_HIDE || "").split("|").filter(Boolean);   // drive labels and the like
const scrub = s => { let t = s.split(host).join("MY-PC"); HIDE.forEach(w => { t = t.split(w).join("DATA"); }); ips.forEach(ip => { t = t.split(ip).join("192.168.1.20"); }); return t.replace(/\b100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+\b/g, "192.168.1.20"); };

const GAMES = ["Starfall Drift", "Pixel Kart", "Cavern Echoes", "Lumen Tactics", "Harbor Heist", "Moss & Stone"].map((name, i) => ({
  id: "demo:" + i, name, source: ["Steam", "Epic", "GOG"][i % 3], kind: "game", blurb: "", fav: i === 1, hidden: false, minutes: [2140, 860, 415, 1290, 95, 330][i],
  tracked: 0, store_minutes: 0, store_2wk: [240, 60, 0, 120, 0, 30][i], sessions: 4 + i, longest: 90, last: Date.now() / 1000 - i * 86400 * 2, size: (6 + i * 9) * 1e9,
  dir: "D:\\Games\\" + name, art: {}, running: false, running_since: null, missing: false }));

async function setup(ctx) {
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base.slice(0, -1) });
  await ctx.route(/^http:\/\/(127\.0\.0\.1|localhost):\d+\//, async route => { try {
    const u = new URL(route.request().url());
    const demo = MAP[u.port];
    if ((u.port === "7790" || u.port === String(MAP["7790"])) && u.pathname === "/api/library")   // Launchpad: made-up games, not this PC's
      return route.fulfill({ json: { version: "1.1.0", games: GAMES } });
    if (demo) u.port = String(demo);
    if (u.port === String(hubPort) || demo) {
      const r = await route.fetch({ url: u.toString() });
      const ct = r.headers()["content-type"] || "";
      let body = /json|html|javascript|text/.test(ct) ? scrub(await r.text()) : null;
      if (u.port === String(hubPort) && u.pathname === "/api/glance") {   // phone numbers come from this PC's own Beam: show a small made-up count
        const g = JSON.parse(body); g.phone = { unread: 3, total: 5, linked: true }; if (g.money) Object.assign(g.money, { today: 420, left: 1080, spent: 9120, stale: false }); body = JSON.stringify(g);
      }
      return body == null ? route.fulfill({ response: r }) : route.fulfill({ response: r, body });
    }
    return route.continue();
  } catch (_) { route.abort().catch(() => {}); } });
}

const api = (p, b) => fetch(base + p, { method: b ? "POST" : "GET", headers: { "Content-Type": "application/json", Origin: base.slice(0, -1) }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());

async function seed() {
  const P = n => path.join(HOME, n);
  const now = Date.now() / 1000;
  await api("api/spark/store", { notes: [
    { id: "n1", text: "# Groceries\n\n- Oat milk\n- Coffee beans\n- Basil\n- Lemons", ts: now - 600, pin: true },
    { id: "n2", text: "Gift ideas\n\nMum: a plant stand\nRavi: the pixel art book", ts: now - 86400, pin: false },
    { id: "n3", text: "Wi-Fi for guests is on the fridge.", ts: now - 3 * 86400, pin: false }],
    pins: [{ path: P("Pictures\\Trip to the hills"), name: "Trip to the hills" }, { path: P("Downloads\\Weekend trip plan.md"), name: "Weekend trip plan.md" },
      { path: P("Documents\\Ideas.txt"), name: "Ideas.txt" }, { path: P("Music\\Little loop.wav"), name: "Little loop.wav" }] });
  await api("api/nova/store", { todos: [
    { id: "t1", text: "Book the cabin for Saturday", done: false, ts: now - 50 },
    { id: "t2", text: "Send the trip photos to the group", done: false, ts: now - 40 },
    { id: "t3", text: "Renew the bike insurance", done: false, ts: now - 30 },
    { id: "t4", text: "Water the plants", done: true, ts: now - 20 }],
    reminders: [{ id: "r1", text: "Stretch break", at: now + 25 * 60 }, { id: "r2", text: "Call the plumber", at: now + 4 * 3600 }] });
  await api("api/nova/clips", { paused: true, clear: true });   // never show this PC's clipboard
  await api("api/settings", { boot: [] });
}

async function newPage(ctx) {
  const p = await ctx.newPage();
  p.on("pageerror", e => console.log("pageerror:", e.message));
  await p.addInitScript(() => { try { localStorage.setItem("qt-new-v5", "true"); localStorage.setItem("qt-new-v4", "true"); localStorage.setItem("qt-sfx", "false"); } catch (_) {} });
  await p.goto(base); await p.waitForSelector(".tile"); await sleep(2200);
  return p;
}
const shot = (p, name, clip) => p.screenshot({ path: path.join(OUT, name + ".png"), clip }).then(() => console.log("shot", name));
async function pal(p, q, wait = 500) { if (!(await p.$(".pal-wrap"))) { await p.keyboard.press("Control+k"); await sleep(250); } await p.fill(".pal-wrap input", q); await sleep(wait); }
async function typePal(p, q) { if (!(await p.$(".pal-wrap"))) { await p.keyboard.press("Control+k"); await sleep(350); } await p.fill(".pal-wrap input", ""); await p.type(".pal-wrap input", q, { delay: 70 }); await sleep(1300); }
const closeAll = async p => { for (let i = 0; i < 3; i++) { await p.keyboard.press("Escape"); await sleep(150); } };

(async () => {
  await seed();
  const b = await chromium.launch({ executablePath: process.env.CHROME });

  /* ---------------- screenshots (1440x900) ---------------- */
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await setup(ctx);
  const p = await newPage(ctx);
  await shot(p, "home");
  await p.evaluate(() => document.getElementById("todo").scrollIntoView({ block: "center" })); await sleep(500);
  await shot(p, "home-todo");
  await p.evaluate(() => document.querySelector(".stage, #view-home").scrollTo && document.getElementById("view-home").scrollTo(0, 0)); await sleep(300);
  for (const [name, q] of [["palette-colour", "#ff6b4a"], ["palette-time", "time"], ["palette-remind", "remind 6:30pm call Ma"], ["palette-text", "> title the quick brown fox"],
    ["palette-sum", "18% of 2400"], ["palette-help", "?"]]) { await pal(p, q, 700); await shot(p, name); }
  await closeAll(p);
  await p.keyboard.press("Control+j"); await sleep(900); await shot(p, "notes"); await closeAll(p);
  // viewers
  const H = HOME.replace(/\//g, "\\");
  await p.evaluate(f => qtPeek(f), H + "\\Pictures\\Trip to the hills\\Lake at dusk.jpg"); await sleep(1800); await shot(p, "viewer-pictures"); await closeAll(p);
  await p.evaluate(f => qtPeek(f), H + "\\Downloads\\Weekend trip plan.md"); await sleep(1500); await shot(p, "viewer-reader"); await closeAll(p);
  await p.evaluate(f => qtPeek(f), H + "\\Downloads\\bouncing_ball.py"); await sleep(1500); await shot(p, "viewer-code"); await closeAll(p);
  await p.evaluate(f => qtPeek(f), H + "\\Downloads\\monthly-budget.csv"); await sleep(1500); await shot(p, "viewer-table"); await closeAll(p);
  await p.evaluate(f => qtPeek(f), H + "\\Music\\Little loop.wav"); await sleep(1800); await shot(p, "viewer-player"); await closeAll(p);
  await p.evaluate(f => qtPeek(f), H + "\\Downloads\\pixel-icons.zip"); await sleep(1500); await shot(p, "viewer-archive"); await closeAll(p);
  // tools inside the hub
  for (const id of ["burrow", "volt", "space", "daily", "beam", "inkmotion", "pixlab", "kharcha", "surf"]) {
    await p.evaluate(i => show(i), id); await sleep(id === "burrow" ? 4000 : 3200);
    await shot(p, "tool-" + id);
  }
  await p.evaluate(() => show("settings")); await sleep(1200);
  await p.evaluate(() => document.getElementById("nv-look-box") && document.getElementById("nv-look-box").scrollIntoView({ block: "center" })); await sleep(500);
  await shot(p, "settings");
  await p.evaluate(() => show("home")); await sleep(800);
  await p.setViewportSize({ width: 390, height: 844 }); await sleep(900); await shot(p, "phone-home");
  await ctx.close();

  /* ---------------- clips (1280x800 video) ---------------- */
  // clips: Chrome's own screencast (frames + timestamps), stitched by ffmpeg in make_media.ps1
  async function clip(name, fn) {
    const c = await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    await setup(c);
    const q = await newPage(c);
    const dir = path.join(OUT, "clips", "_raw", name); fs.mkdirSync(dir, { recursive: true });
    const cdp = await c.newCDPSession(q);
    const frames = [];
    cdp.on("Page.screencastFrame", f => {
      const file = path.join(dir, String(frames.length).padStart(5, "0") + ".jpg");
      fs.writeFileSync(file, Buffer.from(f.data, "base64"));
      frames.push([file, f.metadata.timestamp]);
      cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
    });
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 88, maxWidth: 1280, maxHeight: 800, everyNthFrame: 1 });
    await sleep(400);
    await fn(q);
    await sleep(600);
    await cdp.send("Page.stopScreencast").catch(() => {});
    // ffconcat list: each frame stays on screen until the next one arrived
    const lines = ["ffconcat version 1.0"];
    frames.forEach(([f, t], i) => { const d = i + 1 < frames.length ? Math.max(0.01, frames[i + 1][1] - t) : 0.5; lines.push(`file '${f.replace(/\\/g, "/")}'`, `duration ${d.toFixed(3)}`); });
    lines.push(`file '${frames[frames.length - 1][0].replace(/\\/g, "/")}'`);
    fs.writeFileSync(path.join(OUT, "clips", "_raw", name + ".ffconcat"), lines.join("\n"));
    await c.close();
    console.log("clip", name, frames.length, "frames");
  }  await clip("palette", async q => {
    for (const t of ["18% of 2400", "5 km in mi", "#ff6b4a", "time in tokyo", "days until 25 dec", "remind 10m tea", "> title the quick brown fox", "pw 24"]) await typePal(q, t);
    await closeAll(q);
  });
  await clip("home", async q => {
    await q.evaluate(() => document.getElementById("todo").scrollIntoView({ block: "center", behavior: "smooth" })); await sleep(900);
    await q.click(".td-add input"); await q.type(".td-add input", "Pick up the new tent", { delay: 60 }); await q.keyboard.press("Enter"); await sleep(900);
    await q.click(".td-item:nth-child(2) .td-box"); await sleep(1300);
    await q.type(".td-add input", "remind 20m stretch", { delay: 60 }); await q.keyboard.press("Enter"); await sleep(1800);
    await q.keyboard.press("Control+j"); await sleep(1600); await closeAll(q); await sleep(500);
    await q.keyboard.press("Control+Shift+f"); await sleep(1400); await q.keyboard.press("Control+Shift+f"); await sleep(1000);
  });
  await clip("viewers", async q => {
    const H2 = HOME.replace(/\//g, "\\");
    await q.evaluate(f => qtPeek(f), H2 + "\\Pictures\\Trip to the hills\\Sunrise ridge.jpg"); await sleep(1500);
    for (let i = 0; i < 4; i++) { await q.keyboard.press("ArrowRight"); await sleep(900); }
    await closeAll(q);
    await q.evaluate(f => qtPeek(f), H2 + "\\Downloads\\Weekend trip plan.md"); await sleep(2000); await closeAll(q);
    await q.evaluate(f => qtPeek(f), H2 + "\\Downloads\\bouncing_ball.py"); await sleep(1200);
    await q.keyboard.press("Control+f"); await q.keyboard.type("bounce", { delay: 80 }); await sleep(1500); await closeAll(q);
  });
  await clip("tools", async q => {
    for (const id of ["burrow", "volt", "space", "daily", "inkmotion", "pixlab", "home"]) { await q.evaluate(i => show(i), id); await sleep(2300); }
  });
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
