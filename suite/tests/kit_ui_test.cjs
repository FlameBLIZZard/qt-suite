// Toolkit UI smoke test: opens every feature panel in a throwaway hub and fails on JS errors.
// node tests/kit_ui_test.cjs [port] [shotsDir]   (needs playwright-core; uses installed Edge)
const { chromium } = require("playwright-core");
const port = process.argv[2] || "7836", shots = process.argv[3] || "";
const F = ["cam","find","clips","deck","mirror","party","arcade","kharcha","subs","splits","cleaner","backup","focus","startup","tm","zones","widgets","wall","skins","recorder","photos","music","games","deals","search","hotkeys","macros","plugins","updates","shares","xp","streak"];
(async () => {
  const b = await chromium.launch({ channel: "msedge", headless: true });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  p.on("pageerror", e => errs.push("pageerror: " + e.message));
  p.on("console", m => { if (m.type() === "error" && !/favicon|ERR_|404|net::|Failed to load resource/.test(m.text())) errs.push("console: " + m.text()); });
  await p.goto(`http://127.0.0.1:${port}/#kit`); await p.waitForTimeout(2500);
  if (shots) await p.screenshot({ path: shots + "/kit-grid.png" });
  const bad = [];
  for (const f of F) {
    const before = errs.length;
    await p.evaluate(id => show("kit/" + id), f);
    try { await p.waitForFunction(() => !document.querySelector("#kit-body .kit-loading"), null, { timeout: 30000 }); } catch { bad.push(f + ": still loading"); }
    await p.waitForTimeout(f === "arcade" ? 300 : 700);
    const err = await p.evaluate(() => { const b = document.querySelector("#kit-body > p.bad"); return b ? b.textContent : ""; });
    if (err) bad.push(f + ": " + err);
    if (errs.length > before) bad.push(f + ": " + errs.slice(before).join(" | "));
    if (shots) await p.screenshot({ path: `${shots}/kit-${f}.png` });
  }
  await p.evaluate(() => show("home")); await p.waitForTimeout(2000);
  const home = await p.evaluate(() => !!document.querySelector("#kit-home .kh"));
  if (!home) bad.push("home: Kharcha card missing");
  if (shots) await p.screenshot({ path: shots + "/kit-home.png" });
  await b.close();
  console.log(bad.length ? "FAIL\n" + bad.join("\n") : "PASS: " + F.length + " panels + Home card");
  process.exit(bad.length ? 1 : 0);
})();
