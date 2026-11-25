// QT Suite UI check (palette, menu, routes, phone layout).  node suite\tests\ui_test.cjs [port] [shotdir]
// Read-only: never clicks start / stop / restart. Needs NODE_PATH with playwright and CHROME=<Edge path>.
const { chromium } = require("playwright");
const port = process.argv[2] || "7800", shots = process.argv[3];
const base = `http://127.0.0.1:${port}/`;
let fails = 0;
const check = (n, c) => { console.log((c ? "PASS  " : "FAIL  ") + n); if (!c) fails++; };
(async () => {
  const exe = process.env.CHROME;
  const b = await chromium.launch(exe ? { executablePath: exe } : {});
  const errs = [];
  for (const vp of [{ name: "desktop", width: 1400, height: 880 }, { name: "phone", width: 390, height: 844, mobile: true }]) {
    const ctx = await b.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.mobile, hasTouch: !!vp.mobile, deviceScaleFactor: 1, reducedMotion: "reduce" });
    const p = await ctx.newPage();
    p.on("pageerror", e => errs.push(vp.name + ": " + e.message));
    await p.goto(base); await p.waitForSelector(".tile");
    check(`${vp.name}: tiles render`, (await p.$$(".tile")).length >= 8);
    await p.waitForTimeout(900);
    check(`${vp.name}: live uptime on a running tile`, await p.$$eval(".tile .meta", m => m.some(x => /^up /.test(x.textContent))));
    if (!vp.mobile) {
      await p.keyboard.press("Control+k");
      check("palette opens on Ctrl+K", await p.isVisible(".pal"));
      await p.keyboard.type("burr");
      check("palette filters to Burrow first", (await p.textContent(".pal-item.on b")).trim() === "Burrow");
      if (shots) await p.screenshot({ path: shots + "/palette.png" });
      await p.keyboard.press("Escape"); await p.waitForTimeout(300);
      check("palette closes on Esc", !(await p.$(".pal-wrap")));
      await p.click('#tiles [data-go="pixlab"]', { button: "right" });
      const acts = await p.$$eval(".ctx [data-act]", b => b.map(x => x.dataset.act));
      check("right-click menu has pop out + folder", acts.includes("pop") && acts.includes("folder"));
      await p.click('#tiles [data-go="beam"]', { button: "right" });
      const bacts = await p.$$eval(".ctx [data-act]", b => b.map(x => x.textContent));
      check("Beam's stop says it also stops Kharcha", bacts.some(t => /Stop \(also stops .*Kharcha/.test(t)) || !bacts.some(t => /^.Stop/.test(t)));
      if (shots) await p.screenshot({ path: shots + "/menu.png" });
      await p.keyboard.press("Escape"); await p.waitForTimeout(200);
      await p.click('#nav [data-go="pixlab"]'); await p.waitForTimeout(400);
      check("opening a tool sets #pixlab", p.url().endsWith("#pixlab"));
      await p.goBack(); await p.waitForTimeout(400);
      check("Back returns home", await p.evaluate(() => current === "home"));
      await p.goto(base + "#inkmotion"); await p.waitForTimeout(900);
      check("#inkmotion deep link opens Inkmotion", await p.evaluate(() => current === "inkmotion"));
    } else {
      const r = await p.$eval("#rail", e => e.getBoundingClientRect().toJSON());
      check("phone: rail is a bottom bar", r.bottom >= 840 && r.height < 100 && r.width >= 389);
      check("phone: no sideways page scroll", await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      check("phone: tiles one column", await p.$$eval(".tile", t => t[0].getBoundingClientRect().width > 330));
      if (shots) await p.screenshot({ path: shots + "/phone-home.png" });
      await p.tap(".mob-search"); await p.waitForTimeout(200);
      check("phone: search button opens palette", await p.isVisible(".pal"));
      if (shots) await p.screenshot({ path: shots + "/phone-palette.png" });
      await p.keyboard.press("Escape"); await p.waitForTimeout(300);
      await p.tap('#nav [data-go="pixlab"]'); await p.waitForTimeout(700);
      const pill = await p.$eval(".nav-pill", e => e.getBoundingClientRect().toJSON()), on = await p.$eval(".nav.on", e => e.getBoundingClientRect().toJSON());
      check("phone: pill sits on the active tab", Math.abs(pill.left - on.left) < 3 && Math.abs(pill.width - on.width) < 3);
      if (shots) await p.screenshot({ path: shots + "/phone-tool.png" });
    }
    await ctx.close();
  }
  check("no page errors" + (errs.length ? ": " + errs.join(" | ") : ""), !errs.length);
  await b.close();
  console.log(fails ? fails + " FAILED" : "ALL PASSED");
  process.exit(fails);
})();
