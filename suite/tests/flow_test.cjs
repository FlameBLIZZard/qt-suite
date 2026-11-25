// QT Suite flow layer check (loop 3): Files group, rail footer, title, badges, tile quick actions, recent files,
// Ctrl+E switcher, palette path + Ctrl+Enter, drop on a rail app, motion bits, phone + reduced motion.
// node suite\tests\flow_test.cjs [port]   Needs NODE_PATH with playwright and CHROME=<Edge path>.
// Run it against a throwaway hub (QT_SUITE_PORT + QT_SUITE_DATA). Never starts or stops tools.
const { chromium } = require("playwright");
const path = require("path");
const port = process.argv[2] || "7821";
const base = `http://127.0.0.1:${port}/`;
const SUITE = path.resolve(__dirname, "..");
let fails = 0;
const check = (n, c) => { console.log((c ? "PASS  " : "FAIL  ") + n); if (!c) fails++; };
(async () => {
  const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const errs = [];
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  p.on("pageerror", e => errs.push(e.message));
  await p.request.post(base + "api/settings", { data: { order: [], hidden: [], group: true, revive: false, peek: true, glance: true, rail: "full", motion: "system", split: null }, headers: { Origin: base.slice(0, -1) } });
  await p.goto(base);
  const seed = [
    { path: path.join(SUITE, "tray-menu.png"), name: "tray-menu.png", dir: SUITE },
    { path: path.join(SUITE, "app.py"), name: "app.py", dir: SUITE },
  ];
  await p.evaluate(s => { localStorage.setItem("qt-peek-recent", JSON.stringify(s)); localStorage.setItem("qt-recent", "[]"); sessionStorage.setItem("qt-splashed", "1"); }, seed);
  await p.reload(); await p.waitForSelector(".tile"); await p.waitForTimeout(1500);

  // 1. Files group
  const navIds = await p.$$eval("#nav .nav", n => n.map(x => x.classList.contains("nav-group") ? "G" : x.dataset.go));
  check("file apps fold into one Files button", navIds.filter(x => x === "G").length === 1 && !navIds.includes("pictures") && !navIds.includes("archive"));
  await p.click(".nav-group"); await p.waitForSelector(".nav-fly .fly-item");
  check("Files flyout lists the five apps", (await p.$$(".nav-fly .fly-item")).length === 5);
  await p.keyboard.press("ArrowDown"); await p.keyboard.press("Enter"); await p.waitForTimeout(900);
  check("picking one opens it and lights the Files button", (await p.evaluate(() => current)) === "player" && (await p.$eval(".nav-group", g => g.classList.contains("on") && g.dataset.go === "player")));
  check("flyout closed after picking", !(await p.$(".nav-fly")));
  check("rail footer is one icon row", await p.$eval(".rail-btns", r => r.classList.contains("row") && !!r.querySelector("#refresh")));
  // 2. title
  check("window title follows the tool", (await p.title()) === "Player · QT Suite");
  await p.keyboard.press("Control+0"); await p.waitForTimeout(500);
  check("title back to QT Suite on home", (await p.title()) === "QT Suite");
  // 3. badges: whatever the glance says, the badge matches it
  const gl = await (await p.request.get(base + "api/glance")).json();
  const pingBadge = await p.$eval('#nav .nav[data-go="ping"] .nbadge', x => x.textContent).catch(() => "");
  const unread = gl.phone ? gl.phone.unread : 0;
  check("Ping badge matches unread phone alerts", unread ? pingBadge === (unread > 99 ? "99+" : String(unread)) : pingBadge === "");
  // 4. quick actions
  const web = await p.evaluate(() => tools.filter(t => t.kind === "web").map(t => [t.id, t.status]));
  const on = web.find(x => x[1] === "on"), off = web.find(x => x[1] !== "on");
  if (on) check("running tool tile has restart / stop / pop out", (await p.$$eval(`.tile[data-go="${on[0]}"] .tq`, x => x.map(b => b.dataset.q).join())) === "restart,stop,pop");
  if (off) check("stopped tool tile has start in background", (await p.$$eval(`.tile[data-go="${off[0]}"] .tq`, x => x.map(b => b.dataset.q).join())) === "bgstart");
  // 5. recent files
  check("recent files row on home", (await p.$$(".rf-card")).length === 2);
  await p.click(".rf-card"); await p.waitForSelector(".pk", { timeout: 5000 }).catch(() => {});
  check("a recent file opens in Peek", !!(await p.$(".pk")));
  await p.keyboard.press("Escape"); await p.waitForTimeout(500);
  await p.hover(".rf-card:last-child"); await p.click(".rf-card:last-child .rf-x"); await p.waitForTimeout(600);
  check("forget takes it off the row", (await p.$$(".rf-card")).length === 1);
  // 7. Ctrl+E
  await p.keyboard.press("Control+1"); await p.waitForTimeout(500);
  const first = await p.evaluate(() => current);
  await p.keyboard.press("Control+2"); await p.waitForTimeout(500);
  await p.keyboard.down("Control"); await p.keyboard.press("e"); await p.waitForTimeout(250);
  check("Ctrl+E shows the switcher", !!(await p.$(".mru-wrap")));
  await p.keyboard.up("Control"); await p.waitForTimeout(700);
  check("letting go of Ctrl jumps to the previous tool", (await p.evaluate(() => current)) === first);
  // 8. palette
  await p.keyboard.press("Control+k"); await p.waitForTimeout(250);
  await p.keyboard.type(`"${path.join(SUITE, "app.py")}"`); await p.waitForTimeout(400);
  check("a pasted path is the first palette result", /Peek at app\.py/.test(await p.$eval(".pal-item", x => x.textContent)));
  await p.keyboard.press("Enter"); await p.waitForSelector(".pk", { timeout: 5000 }).catch(() => {});
  check("Enter peeks at the pasted path", !!(await p.$(".pk")));
  await p.keyboard.press("Escape"); await p.waitForTimeout(400);
  const second = await p.evaluate(() => tools.find(t => t.kind === "file" && t.id !== current).id);
  await p.keyboard.press("Control+k"); await p.waitForTimeout(250); await p.keyboard.type(second); await p.waitForTimeout(300);
  await p.keyboard.press("Control+Enter"); await p.waitForTimeout(900);
  check("Ctrl+Enter in the palette opens beside", await p.evaluate(s => document.getElementById("stage").classList.contains("split") && !!document.querySelector(`.view.pane-b[data-tool="${s}"], .view.pane-a[data-tool="${s}"]`), second));
  await p.keyboard.press("Control+\\"); await p.waitForTimeout(400);
  // 10. drop on the Files button
  await p.keyboard.press("Control+0"); await p.waitForTimeout(400);
  await p.evaluate(() => {
    const el = document.querySelector(".nav-group .nm");
    const dt = new DataTransfer(); dt.items.add(new File(["dropped"], "dropped.txt", { type: "text/plain" }));
    el.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true }));
    window.__lbl = el.textContent;
    el.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  check("dragging over the Files button says where it goes", (await p.evaluate(() => window.__lbl)) === "Open in the right app");
  await p.waitForTimeout(2000);
  const cf = p.frames().find(f => f.url().includes("/tool/code"));
  check("dropped text opens in Code, not the hub's Peek", (await p.evaluate(() => current)) === "code" && !(await p.$(".pk")) && !!cf && !!(await cf.$(".pk")));
  // 18. settings switches exist and save
  await p.keyboard.press("Control+,"); await p.waitForSelector('[data-sw="group"]');
  check("Settings has Group file apps + Bring crashed tools back", !!(await p.$('[data-sw="revive"]')));
  await p.click('[data-sw="group"]'); await p.waitForTimeout(900);
  check("turning grouping off puts every app on the rail", !(await p.$(".nav-group")) && !!(await p.$('#nav .nav[data-go="pictures"]')));
  await p.click('[data-sw="group"]'); await p.waitForTimeout(900);
  check("and back on", !!(await p.$(".nav-group")));
  // phone + reduced motion
  const m = await b.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
  const q = await m.newPage(); q.on("pageerror", e => errs.push("phone: " + e.message));
  await q.goto(base); await q.waitForSelector(".tile"); await q.waitForTimeout(800);
  await q.evaluate(() => document.querySelector(".nav-group").scrollIntoView({ inline: "center" }));
  await q.tap(".nav-group"); await q.waitForTimeout(300);
  const fr = await q.$eval(".nav-fly", f => { const r = f.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth; }).catch(() => false);
  check("phone: Files flyout opens on screen", fr);
  check("no page errors", !errs.length);
  if (errs.length) console.log(errs.join("\n"));
  await b.close();
  console.log(fails ? `${fails} FAILED` : "ALL FLOW CHECKS PASSED");
  process.exit(fails ? 1 : 0);
})();
