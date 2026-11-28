// QT Suite guide layer UI check: welcome + tool picker, tour, checklist, Help, doctor, Settings search/comfort, Ctrl+K help, What's this.
// node suite\tests\guide_test.cjs <port of a THROWAWAY hub started with an EMPTY QT_SUITE_DATA>   (NODE_PATH with playwright, CHROME=<Edge>)
// Set SHOTS=<folder> to save screenshots. Never touches Start with Windows (the switch is left as it is).
const { chromium } = require("playwright");
const path = require("path");
const port = process.argv[2] || "7822", base = `http://127.0.0.1:${port}/`;
let fails = 0;
const check = (n, c) => { console.log((c ? "PASS  " : "FAIL  ") + n); if (!c) fails++; };
const shot = async (p, n) => { if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, n + ".png") }); };

(async () => {
  const st0 = await (await fetch(base + "api/guide/state")).json();
  if (!st0.fresh || st0.onboarded) { console.log("FAIL  needs a hub with an empty data folder (fresh=" + st0.fresh + ")"); process.exit(1); }
  const b = await chromium.launch({ executablePath: process.env.CHROME });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base.slice(0, -1) });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", e => errs.push(e.message));
  await p.goto(base + "?guide=1"); await p.waitForSelector(".tile");
  await p.waitForSelector(".gw-wrap", { timeout: 6000 }).catch(() => {});
  check("welcome opens for a new person", !!(await p.$(".gw-wrap")));
  check("old what's new cards stay away for a new person", !(await p.$(".wn")));
  await p.waitForTimeout(700); await shot(p, "g1-hello");
  await p.click('[data-gw="next"]'); await p.waitForTimeout(600);
  const total = await p.$$eval(".gw-tool", x => x.length);
  check("tool picker lists the tools", total >= 10);
  await p.click('[data-pre="files"]'); await p.waitForTimeout(500);
  const on = await p.$$eval(".gw-tool.on", x => x.map(y => y.dataset.pick));
  check("preset Files + media picks its tools", on.includes("burrow") && on.includes("pictures") && !on.includes("beam"));
  await p.click('.gw-tool[data-pick="daily"]'); await p.waitForTimeout(300);
  const picked = await p.$$eval(".gw-tool.on", x => x.map(y => y.dataset.pick));
  check("clicking a card toggles it", picked.includes("daily"));
  check("count follows", (await p.textContent(".gw-count")).startsWith(picked.length + " of"));
  await shot(p, "g2-pick");
  await p.click('[data-gw="next"]'); await p.waitForTimeout(600);
  check("startup step offers to start picked tools", !!(await p.$('[data-opt="boot"]')));
  check("startup step shows switches", !!(await p.$('[data-opt="sfx"]')) && !!(await p.$('[data-motion="calm"]')));
  await p.click('[data-motion="full"]'); await shot(p, "g3-start");
  await p.click('[data-gw="next"]'); await p.waitForTimeout(600);
  await p.keyboard.press("Control+k"); await p.waitForTimeout(500);
  check("trying Ctrl+K on the moves step ticks it", !!(await p.$('.gw-move.done[data-move="k"]')));
  check("Ctrl+K didn't open search under the welcome", !(await p.$(".pal-wrap")));
  await shot(p, "g4-moves");
  await p.click('[data-gw="next"]'); await p.waitForTimeout(900); await shot(p, "g5-done");
  await p.click('[data-gw="tour"]'); await p.waitForTimeout(1200);
  const st = await (await fetch(base + "api/guide/state")).json();
  const set = (await (await fetch(base + "api/settings")).json()).settings;
  check("welcome saved as done", st.onboarded && st.tasks.pick && st.tasks.palette);
  check("unpicked tools are hidden", picked.every(id => !set.hidden.includes(id)) && set.hidden.includes("beam"));
  check("motion choice saved", set.motion === "full");
  const rail = await p.$$eval("#nav .nav[data-go]", x => x.map(y => y.dataset.go));
  check("rail shows only picked tools", !rail.includes("beam") && rail.includes("burrow"));

  // tour
  check("tour starts", !!(await p.$(".gt-tip")));
  await shot(p, "g6-tour1");
  let n = 0;
  while (await p.$(".gt-wrap:not(.out)") && n < 12) { await p.keyboard.press("ArrowRight"); await p.waitForTimeout(650); n++; if (n === 3) await shot(p, "g7-tour3"); }
  check("tour walks to the end with the arrow key", n >= 4 && n <= 8);
  await p.waitForTimeout(500);
  check("tour saved as seen", (await (await fetch(base + "api/guide/state")).json()).tour === true);

  // checklist
  await p.waitForSelector(".gd-ck", { timeout: 3000 }).catch(() => {});
  check("Get set up list on Home", !!(await p.$(".gd-ck")));
  check("picked + search already ticked", (await p.$$eval(".gd-task.done", x => x.length)) >= 2);
  await shot(p, "g8-home");

  // Help via F1, search, doctor
  await p.keyboard.press("F1"); await p.waitForTimeout(700);
  check("F1 opens Help", await p.isVisible(".gd-help"));
  check("Help lists every tool", (await p.$$eval(".gd-tool", x => x.length)) === total);
  await shot(p, "g9-help");
  await p.fill(".gd-search input", "phone"); await p.waitForTimeout(250);
  check("Help search finds the phone answer", await p.isVisible("#faq-phone") && !(await p.isVisible("#faq-uninstall")));
  await p.fill(".gd-search input", "zzqx"); await p.waitForTimeout(250);
  check("Help search says when nothing matches", await p.isVisible(".gd-none"));
  await p.fill(".gd-search input", ""); await p.waitForTimeout(200);
  await p.click('.gd-start [data-gh="doctor"]');
  await p.waitForSelector(".gd-check", { timeout: 30000 }).catch(() => {});
  check("setup check lists results", (await p.$$eval(".gd-check", x => x.length)) >= 6);
  check("setup check looks at the home network", (await p.textContent(".gd-checks")).includes("Home network"));
  await p.click('.gd-tool [data-gh="spot"]'); await p.waitForTimeout(400);
  check("Show me spotlights the tool on the rail", !!(await p.$(".gd-spot .gd-spot-lab")));
  await p.waitForTimeout(3400);
  await p.waitForTimeout(800); await shot(p, "g10-doctor");
  await p.click('[data-gh="diag"]'); await p.waitForTimeout(500);
  await p.waitForFunction(() => window.qtLastDiag, null, { timeout: 30000 }).catch(() => {});
  const clip = await p.evaluate(() => window.qtLastDiag || "");
  if (!clip.startsWith("QT Suite")) console.log("clip:", JSON.stringify(clip.slice(0, 200)));
  check("problem report copied, no user name in it", clip.startsWith("QT Suite") && !clip.toLowerCase().includes("\\users\\" + (process.env.USERNAME || "zz").toLowerCase()));
  check("Help ticked on the list", (await (await fetch(base + "api/guide/state")).json()).tasks.help === true);

  // Settings: search + comfort
  await p.keyboard.press("Control+,"); await p.waitForTimeout(900);
  check("Help and comfort box in Settings", !!(await p.$("#gd-comfort")));
  await p.fill(".settings .gd-search input", "motion"); await p.waitForTimeout(250);
  const vis = await p.$$eval(".settings .sbox", x => x.filter(b => !b.hidden).map(b => b.querySelector("h2").textContent));
  check("setting search narrows to the right box", vis.length >= 1 && vis.some(t => /look/i.test(t)) && !vis.some(t => /windows default/i.test(t)));
  await p.fill(".settings .gd-search input", ""); await p.waitForTimeout(200);
  await p.click('[data-tsz="large"]'); await p.waitForTimeout(200);
  check("text size Large applies", (await p.getAttribute("html", "data-textsize")) === "large");
  await shot(p, "g11-settings");
  await p.click('[data-tsz="normal"]');
  await p.click('[data-gh="settour"]'); await p.waitForTimeout(1100);
  check("Settings tour starts on Settings", !!(await p.$(".gt-tip")) && (await p.textContent(".gt-tip h3")) === "Find a setting");
  await shot(p, "g11b-settour");
  await p.keyboard.press("Escape"); await p.waitForTimeout(400);

  // Ctrl+K knows help
  await p.keyboard.press("Control+0"); await p.waitForTimeout(500);
  await p.keyboard.press("Control+k"); await p.waitForTimeout(300);
  check("Ctrl+K shows try-me hints to a beginner", await p.isVisible(".gd-palhint"));
  await p.fill(".pal-wrap input", "check my setup"); await p.waitForTimeout(350);
  const its = await p.$$eval(".pal-item b", x => x.map(y => y.textContent.trim()));
  check("Ctrl+K: Check my setup", its.includes("Check my setup"));
  await p.fill(".pal-wrap input", "connect my phone"); await p.waitForTimeout(350);
  const its2 = await p.$$eval(".pal-item b", x => x.map(y => y.textContent.trim()));
  check("Ctrl+K answers a question from Help", its2.some(x => x.startsWith("Help: How do I connect my phone")));
  await p.keyboard.press("Escape"); await p.waitForTimeout(300);

  // What's this
  await p.keyboard.press("Shift+F1"); await p.waitForTimeout(300);
  check("What's this? mode", !!(await p.$(".gd-what-band")));
  const tile = await p.$("#tiles .tile"); await tile.scrollIntoViewIfNeeded(); await p.waitForTimeout(200); const bb = await tile.boundingBox();
  await p.mouse.move(bb.x + 30, bb.y + 30); await p.waitForTimeout(400);
  check("pointing at a tile explains it", /tile/i.test(await p.textContent(".gd-what")));
  await shot(p, "g12-whatsthis");
  await p.keyboard.press("Escape"); await p.waitForTimeout(200);
  check("Esc leaves What's this", !(await p.$(".gd-what-band")));

  // hidden tools line + undo
  check("Home says some tools are hidden", await p.isVisible("#gd-hidden"));
  await p.click('[data-gh-hid="show"]'); await p.waitForTimeout(1200);
  check("Show them puts every tool back", (await (await fetch(base + "api/settings")).json()).settings.hidden.length === 0);

  // first-time tip in a file tool (no server start needed)
  await p.click('#nav [data-go="burrow"], #tiles [data-go="pictures"]').catch(() => {});
  await p.waitForTimeout(1600);
  check("first visit to a tool shows one tip", !!(await p.$(".gd-first")));
  await shot(p, "g13-firsttip");

  // dismiss list -> tip of the day
  await p.keyboard.press("Control+0"); await p.waitForTimeout(500);
  if (await p.$('[data-ck="x"]')) await p.click('[data-ck="x"]');
  await p.waitForTimeout(800);
  check("tip of the day once the list is hidden", !!(await p.$(".gd-tipday")));
  await shot(p, "g14-tip");

  check("no page errors", errs.length === 0); if (errs.length) console.log(errs.join("\n"));
  await b.close();
  console.log(fails ? `${fails} failed` : "all passed");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
