// QT Suite shell layer check: settings, reorder, Today strip, palette extras, split view, activity, shortcuts.
// node suite\tests\shell_test.cjs [port] [shotdir]   Needs NODE_PATH with playwright and CHROME=<Edge path>.
// Run it against a throwaway hub (QT_SUITE_PORT + QT_SUITE_DATA): it changes settings. Never starts or stops tools.
const { chromium } = require("playwright");
const port = process.argv[2] || "7821", shots = process.argv[3];
const base = `http://127.0.0.1:${port}/`;
let fails = 0;
const check = (n, c) => { console.log((c ? "PASS  " : "FAIL  ") + n); if (!c) fails++; };
const shot = async (p, n) => { if (shots) await p.screenshot({ path: `${shots}/${n}.png` }); };
(async () => {
  const exe = process.env.CHROME;
  const b = await chromium.launch(exe ? { executablePath: exe } : {});
  const errs = [];
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  p.on("pageerror", e => errs.push(e.message));
  await p.request.post(base + "api/settings", { data: { order: [], hidden: [], boot: [], motion: "system", rail: "full", launch: "home", glance: true, split: null }, headers: { Origin: base.slice(0, -1) } });
  await p.goto(base); await p.waitForSelector(".tile"); await p.waitForTimeout(1600);
  check("splash came and went", !(await p.$(".splash")));
  await p.waitForSelector("#glance .gcard[data-k]", { timeout: 9000 }).catch(() => {});
  check("Today strip shows cards", (await p.$$("#glance .gcard[data-k]")).length >= 2);
  check("hero has Start my set + Stop all", !!(await p.$("[data-set]")) && !!(await p.$("[data-stopall]")));
  await p.waitForTimeout(1400); await shot(p, "home");

  // settings
  await p.keyboard.press("Control+,"); await p.waitForSelector(".srow");
  check("Ctrl+, opens Settings", (await p.evaluate(() => location.hash)) === "#settings");
  check("settings lists every tool", (await p.$$(".srow")).length >= 12);
  await p.waitForTimeout(700); await shot(p, "settings");
  const first = await p.$eval(".srow", r => r.dataset.id);
  await p.click(`.srow[data-id="${first}"] [data-mv="1"]`); await p.waitForTimeout(500);
  const order1 = await p.$$eval("#nav .nav", n => n.map(x => x.dataset.go));
  check("move down in settings reorders the rail", order1[1] === first);
  await p.click('.srow[data-id="apks"] [data-sw="show"]'); await p.waitForTimeout(900);
  check("hiding takes it off the rail", !(await p.$('#nav .nav[data-go="apks"]')));
  await p.waitForSelector('.srow[data-id="apks"].off'); await p.waitForTimeout(400);
  await p.click('.srow[data-id="apks"] [data-sw="show"]'); await p.waitForTimeout(1500);
  check("showing puts it back", !!(await p.$('#nav .nav[data-go="apks"]')));
  await p.click('.seg[data-k="rail"] [data-v="compact"]'); await p.waitForTimeout(500);
  check("compact rail", (await p.$eval(".rail", r => r.offsetWidth)) < 100);
  await shot(p, "compact");
  await p.click('.seg[data-k="rail"] [data-v="full"]');
  await p.click('.seg[data-k="motion"] [data-v="calm"]'); await p.waitForTimeout(300);
  const calm = await p.evaluate(() => [document.documentElement.className, window.qtMotion, matchMedia("(prefers-reduced-motion: reduce)").matches, document.querySelector('.seg[data-k="motion"] [aria-checked="true"]')?.dataset.v]);
  check("calm motion sets the class + reduced-motion query " + JSON.stringify(calm), calm[0].includes("qt-calm") && calm[2]);
  await p.click('.seg[data-k="motion"] [data-v="system"]'); await p.waitForTimeout(300);
  const saved = await (await p.request.get(base + "api/settings")).json();
  check("settings saved on the server", saved.settings.order[1] === first && saved.settings.rail === "full");

  // drag reorder on the rail
  await p.keyboard.press("Control+0"); await p.waitForTimeout(900);
  const navs = await p.$$("#nav .nav");
  const a = await navs[0].boundingBox(), c = await navs[2].boundingBox();
  const idA = await navs[0].getAttribute("data-go");
  await p.mouse.move(a.x + 40, a.y + a.height / 2); await p.mouse.down();
  for (let i = 1; i <= 14; i++) await p.mouse.move(a.x + 40, a.y + a.height / 2 + (c.y - a.y + 8) * i / 14);
  await p.mouse.up(); await p.waitForTimeout(700);
  const order2 = await p.$$eval("#nav .nav", n => n.map(x => x.dataset.go));
  check("drag on the rail moves the tool", order2.indexOf(idA) === 2);
  check("drop didn't open the tool", (await p.evaluate(() => current)) === "home");
  const tilesOrder = await p.$$eval("#tiles .tile", n => n.map(x => x.dataset.go));
  const railIds = await p.evaluate(ids => window.qtNavIds ? window.qtNavIds(ids) : ids, order2);   // the Files button stands for the file apps
  check("tiles follow the rail order", tilesOrder.join() === railIds.join());

  // palette extras
  await p.keyboard.press("Control+k"); await p.keyboard.type("settin"); await p.waitForTimeout(250);
  check("palette finds Settings", (await p.textContent(".pal-item.on b")).trim() === "Settings");
  await p.keyboard.press("Escape"); await p.waitForTimeout(250);
  await p.keyboard.press("Control+k"); await p.keyboard.type("kharcha"); await p.waitForTimeout(2600);
  check("palette shows a Files section", await p.$$eval(".pal-head", h => h.some(x => x.textContent === "Files")));
  await shot(p, "palette-files");
  await p.keyboard.press("Escape"); await p.waitForTimeout(250);

  // shortcut sheet
  await p.keyboard.press("Shift+Slash"); await p.waitForTimeout(350);
  check("? opens the shortcut sheet", !!(await p.$(".sheet")));
  await shot(p, "sheet");
  await p.keyboard.press("Escape"); await p.waitForTimeout(300);
  check("Esc closes it", !(await p.$(".sheet-wrap")));

  // split view (pixlab + inkmotion are file tools: no servers needed)
  await p.evaluate(() => show("pixlab")); await p.waitForTimeout(600);
  await p.evaluate(() => show("inkmotion")); await p.waitForTimeout(600);
  await p.keyboard.press("Control+Backslash"); await p.waitForTimeout(1000);
  const vis = await p.$$eval("#frames > .view", v => v.filter(x => !x.hidden).map(x => x.dataset.tool));
  check("Ctrl+\\ splits two tools side by side", vis.length === 2 && vis.includes("pixlab") && vis.includes("inkmotion"));
  check("divider is there", !!(await p.$(".divider")));
  await shot(p, "split");
  const dv = await (await p.$(".divider")).boundingBox();
  await p.mouse.move(dv.x + 5, dv.y + 400); await p.mouse.down(); await p.mouse.move(dv.x - 200, dv.y + 400, { steps: 8 }); await p.mouse.up();
  await p.waitForTimeout(500);
  const sp = (await (await p.request.get(base + "api/settings")).json()).settings.split;
  check("dragging the divider saves the ratio", sp && sp.ratio < .45);
  await p.keyboard.press("Control+0"); await p.waitForTimeout(600);
  check("going home closes the split", !(await p.$(".divider")));

  await p.keyboard.press("Control+BracketRight"); await p.waitForTimeout(500);
  check("Ctrl+] goes to the first tool", (await p.evaluate(() => current)) === (await p.$eval("#nav .nav", n => n.dataset.go)));
  await p.keyboard.press("Control+0"); await p.waitForTimeout(600);

  await p.click('#tiles [data-go="pixlab"]', { button: "right" });
  const acts = await p.$$eval(".ctx [data-act]", b => b.map(x => x.dataset.act));
  check("tool menu has move up/down", acts.includes("mvup") || acts.includes("mvdown"));
  await p.keyboard.press("Escape"); await p.waitForTimeout(250);

  await p.click("#act-btn"); await p.waitForTimeout(500);
  check("activity drawer opens", !!(await p.$(".act-drawer")));
  await shot(p, "activity");
  await p.keyboard.press("Escape"); await p.waitForTimeout(300);

  await p.click("[data-stopall]"); await p.waitForTimeout(150);
  check("Stop all asks before stopping", await p.$eval("[data-stopall]", x => x.classList.contains("armed")));

  const ph = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const q = await ph.newPage(); q.on("pageerror", e => errs.push("phone: " + e.message));
  await q.goto(base); await q.waitForSelector(".tile"); await q.waitForTimeout(2800);
  check("phone: settings button in the tab bar", await q.isVisible(".mob-set"));
  await shot(q, "phone-home");
  await q.tap(".mob-set"); await q.waitForSelector(".srow"); await q.waitForTimeout(700);
  await shot(q, "phone-settings");
  check("phone: settings opens", await q.isVisible(".srow"));

  check("no page errors" + (errs.length ? ": " + errs.join(" | ") : ""), !errs.length);
  await b.close();
  console.log(fails ? `${fails} FAILED` : "ALL SHELL CHECKS PASSED");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
