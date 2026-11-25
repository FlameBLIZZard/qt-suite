// Surf (suite web browser) UI test. Needs a hub on SURF_HUB (default http://127.0.0.1:7822) and internet.
// node surf_test.cjs [--shots DIR]
const { chromium } = require("playwright");
const path = require("path");
const HUB = process.env.SURF_HUB || "http://127.0.0.1:7822";
const shots = process.argv.includes("--shots") ? process.argv[process.argv.indexOf("--shots") + 1] : null;
let fails = 0;
const ok = (c, m) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) fails++; };

(async () => {
  const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: process.env.SURF_CHANNEL || undefined });
  const p = await b.newPage({ viewport: { width: 1280, height: 820 } });
  const errs = [];
  p.on("pageerror", e => errs.push(e.message));
  await p.goto(HUB + "/tool/surf");
  await p.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith("qt-surf")).forEach(k => localStorage.removeItem(k)));
  await p.reload();
  await p.waitForFunction(() => window.QT_READY);
  ok(await p.locator(".sf-tab").count() === 1, "starts with one tab");
  ok(await p.locator(".sf-d").count() >= 3, "start page shows bookmark dial");
  if (shots) await p.screenshot({ path: path.join(shots, "surf-start.png") });

  // Live: Wikipedia allows framing
  await p.fill("#addr", "en.wikipedia.org/wiki/Cat");
  await p.press("#addr", "Enter");
  await p.waitForFunction(() => document.querySelector("#mode").dataset.m === "live", null, { timeout: 15000 });
  ok(true, "wikipedia opens Live");
  ok(/Cat|wikipedia/.test(await p.locator(".sf-tab.on .t").textContent()), "tab has a title");

  // Lite: Hacker News refuses framing
  await p.keyboard.press("Control+t");
  ok(await p.locator(".sf-tab").count() === 2, "Ctrl+T opens a tab");
  await p.fill("#addr", "news.ycombinator.com");
  await p.press("#addr", "Enter");
  await p.waitForFunction(() => document.querySelector("#mode").dataset.m === "lite", null, { timeout: 15000 });
  ok(true, "hacker news falls back to Lite");
  const lite = await (async () => { for (let i = 0; i < 250; i++) { const f = p.frames().find(f => /\/p\?u=/.test(f.url())); if (f) return f; await p.waitForTimeout(100); } })();
  ok(!!lite, "lite frame exists " + (lite ? "" : JSON.stringify(p.frames().map(f => f.url())) + JSON.stringify(await p.evaluate(() => [...document.querySelectorAll("iframe")].map(f => f.src)))));
  await lite.waitForSelector("a.storylink, .titleline a", { timeout: 15000 });
  ok(true, "lite page rendered");
  if (shots) await p.screenshot({ path: path.join(shots, "surf-lite.png") });
  // a link inside the Lite page goes back through Surf (address bar follows)
  await lite.click("a[href='newest']");
  await p.waitForFunction(() => document.querySelector("#addr").value.includes("/newest"), null, { timeout: 15000 });
  ok(true, "clicking a Lite link updates the address bar");
  await p.waitForFunction(() => !document.querySelector("#back").disabled);
  await p.click("#back");
  await p.waitForFunction(() => /ycombinator\.com\/$/.test(document.querySelector("#addr").value), null, { timeout: 15000 }).catch(async e => { console.log(await p.evaluate(() => [document.querySelector("#addr").value, document.activeElement.id, document.querySelector("#mode").dataset.m])); throw e; });
  ok(true, "back goes to the previous page");

  // bookmarks
  await p.click("#fwd");   // /newest is not in the default bookmarks
  await p.waitForFunction(() => document.querySelector("#addr").value.includes("/newest"), null, { timeout: 15000 });
  const before = await p.locator(".sf-bm").count();
  await p.keyboard.press("Control+d");   // focus may be inside the Lite page: the key comes back by message
  ok(await p.waitForFunction(n => document.querySelectorAll(".sf-bm").length === n, before + 1, { timeout: 3000 }).then(() => true, () => false), "Ctrl+D adds a bookmark");
  ok(await p.locator("#star.on").count() === 1, "star lights up");
  await p.click("#star");
  ok(await p.locator(".sf-bm").count() === before, "star again removes it");

  // history drawer
  await p.keyboard.press("Control+h");
  ok(await p.locator("#drawer:not([hidden]) .sf-di").count() >= 2, "history drawer lists pages");
  await p.keyboard.press("Escape");

  // Lite refuses local addresses (SSRF guard), Live shows them
  const info = await p.evaluate(() => fetch("/api/web/info").then(r => r.json()));
  const r = await p.evaluate(u => fetch(u).then(r => r.status).catch(() => -1), `http://127.0.0.1:${info.lite}/p?u=${encodeURIComponent(HUB + "/api/tools")}`);
  ok(r === 403 || r === -1, "Lite won't fetch local addresses (" + r + ")");

  // close + reopen
  await p.keyboard.press("Control+w");
  ok(await p.waitForFunction(() => document.querySelectorAll(".sf-tab:not(.out)").length === 1, null, { timeout: 3000 }).then(() => true, () => false), "Ctrl+W closes the tab");
  await p.keyboard.press("Control+Shift+t");
  await p.waitForTimeout(500);
  ok(await p.locator(".sf-tab").count() === 2, "Ctrl+Shift+T brings it back");

  // session restores after reload
  await p.waitForTimeout(500);
  await p.reload();
  await p.waitForFunction(() => window.QT_READY);
  ok(await p.locator(".sf-tab").count() === 2, "tabs come back after reload");

  // hub: Ctrl+K "g cats" offers Surf
  await p.goto(HUB + "/");
  await p.waitForTimeout(1500);
  await p.keyboard.press("Control+k");
  await p.keyboard.type("g cats");
  await p.waitForTimeout(400);
  const items = await p.locator(".pal-wrap").innerText();
  ok(/in Surf/.test(items), "Ctrl+K offers 'in Surf' for g cats");
  if (shots) await p.screenshot({ path: path.join(shots, "surf-palette.png") });
  await p.locator(".pal-wrap :text('in Surf')").first().click();
  await p.waitForFunction(() => { const f = frames.surf && frames.surf.querySelector("iframe"); const a = f && f.contentDocument && f.contentDocument.querySelector("#addr"); return a && a.value.includes("bing.com/search?q=cats"); }, null, { timeout: 15000 });
  ok(true, "palette item opens the search in Surf");
  if (shots) await p.screenshot({ path: path.join(shots, "surf-in-suite.png") });

  ok(!errs.length, "no page errors " + errs.join(" | "));
  await b.close();
  console.log(fails ? `${fails} failed` : "all passed");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
