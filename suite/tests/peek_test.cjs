// QT Suite Peek check: quick preview for every kind, stepping, Esc, the five viewer apps, the settings switch.
// node suite\tests\peek_test.cjs [port]   Needs NODE_PATH with playwright and CHROME=<Edge path>, and a throwaway hub
// (QT_SUITE_PORT + QT_SUITE_DATA). Writes sample files in a temp folder only. Never opens anything in Windows apps.
const { chromium } = require("playwright");
const fs = require("fs"), os = require("os"), path = require("path"), zlib = require("zlib");
const port = process.argv[2] || "7823", base = `http://127.0.0.1:${port}/`;
let fails = 0;
const check = (n, c) => { console.log((c ? "PASS  " : "FAIL  ") + n); if (!c) fails++; };

// sample files
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qt-peek-"));
const put = (n, b) => fs.writeFileSync(path.join(dir, n), b);
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");
put("a.png", png); put("b.md", "# Title\n\n- [x] done\n\n| a | b |\n|---|---|\n| 1 | 2 |\n"); put("c.csv", "n,v\nx,2\ny,1\n");
put("d.json", '{"a":[1,2,{"b":null}]}'); put("e.js", "// hi\nconst x = 1;\n"); put("f.bin", Buffer.from([0, 1, 2, 3, 255]));
put("g.html", "<h1>Hi</h1><p>" + "words ".repeat(80) + "</p>");
// tiny stored zip with one text entry
(() => {
  const name = Buffer.from("in.txt"), data = Buffer.from("inside"), crc = zlib.crc32 ? zlib.crc32(data) : 0x2d5c6b7b;
  const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(crc >>> 0, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26);
  const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(crc >>> 0, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28);
  const local = Buffer.concat([lh, name, data]), central = Buffer.concat([ch, name]);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(local.length, 16);
  put("h.zip", Buffer.concat([local, central, end]));
})();
const P = n => path.join(dir, n);

(async () => {
  const exe = process.env.CHROME;
  const b = await chromium.launch(exe ? { executablePath: exe } : {});
  const p = await b.newPage({ viewport: { width: 1400, height: 860 } });
  const errs = []; p.on("pageerror", e => errs.push(e.message));
  await p.goto(base); await p.waitForTimeout(1200);
  await p.evaluate(() => fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ peek: true }) }));

  // API
  const info = await p.evaluate(f => fetch("/api/peek/info?path=" + encodeURIComponent(f)).then(r => r.json()), P("h.zip"));
  check("info lists the zip", info.kind === "zip" && info.zip.count === 1);
  const near = await p.evaluate(f => fetch("/api/peek/near?path=" + encodeURIComponent(f)).then(r => r.json()), P("a.png"));
  check("near lists the folder", near.files.length === 8);
  const cross = await p.evaluate(f => fetch("/api/peek/raw?path=" + encodeURIComponent(f)).then(r => r.headers.get("content-security-policy")), P("g.html"));
  check("web pages are served sandboxed", /sandbox/.test(cross || ""));

  // quick preview of each kind
  const want = { "a.png": "pk-image", "b.md": "pk-markdown", "c.csv": "pk-table", "d.json": "pk-json", "e.js": "pk-code", "f.bin": "pk-other", "g.html": "pk-html", "h.zip": "pk-zip" };
  await p.evaluate(f => qtPeek(f), P("a.png"));
  await p.waitForSelector(".pk .pk-view");
  await p.waitForTimeout(700);
  check("folder strip shows every file", await p.locator(".pk-th").count() === 8);
  for (const [n, cls] of Object.entries(want)) {
    const got = await p.evaluate(async ([f]) => { document.querySelectorAll(".pk-th")[[...document.querySelectorAll(".pk-th")].findIndex(t => t.title === f)].click(); await new Promise(r => setTimeout(r, 700)); return document.querySelector(".pk-view").className; }, [n]);
    check(`${n} opens as ${cls}`, got.includes(cls));
  }
  await p.keyboard.press("ArrowRight"); await p.waitForTimeout(700);
  check("arrow steps to the next file", (await p.textContent(".pk-name")) === "a.png");
  check("md renders a task box", await p.evaluate(async () => { document.querySelectorAll(".pk-th")[1].click(); await new Promise(r => setTimeout(r, 700)); return !!document.querySelector(".pk-md .pk-check.done"); }));
  check("csv sorts by a column", await p.evaluate(async () => { document.querySelectorAll(".pk-th")[2].click(); await new Promise(r => setTimeout(r, 700)); document.querySelector('th[data-k="1"]').click(); return [...document.querySelectorAll(".pk-grid tbody td:nth-child(2)")].map(t => t.textContent).join() === "y,x"; }));
  check("zip entry opens inside", await p.evaluate(async () => { document.querySelectorAll(".pk-th")[7].click(); await new Promise(r => setTimeout(r, 700)); document.querySelector(".pk-zrow").click(); await new Promise(r => setTimeout(r, 700)); return /inside/.test(document.querySelector(".pk-inner").textContent); }));
  await p.keyboard.press("Escape"); await p.waitForTimeout(300);
  check("Esc in a zip entry goes back to the list", await p.locator(".pk-zrow").count() === 1);
  await p.keyboard.press("Escape"); await p.waitForTimeout(700);
  check("Esc closes Peek", await p.locator(".pk").count() === 0);

  // apps
  const ids = await p.evaluate(() => tools.map(t => t.id));
  check("five viewer apps on the rail", ["pictures", "player", "reader", "code", "archive"].every(i => ids.includes(i)));
  await p.evaluate(f => qtPeek(f), P("a.png")); await p.waitForTimeout(800);
  check("preview offers Open in Pictures", await p.evaluate(() => !document.querySelector('[data-pk="app"]').hidden && /Pictures/.test(document.querySelector('[data-pk="app"]').textContent)));
  await p.click('[data-pk="app"]'); await p.waitForTimeout(2500);
  const fr = p.frameLocator('#frames [data-tool="pictures"] iframe');
  check("Pictures app opened the file", (await fr.locator(".pk-name").textContent()) === "a.png");
  check("Pictures app steps through pictures only", (await fr.locator(".pk-th").count()) === 0);
  await p.evaluate(() => frames.pictures.querySelector("iframe").contentWindow.qtPeekClose()); await p.waitForTimeout(800);
  check("Pictures app lists it under Recent", await fr.locator('#recent .va-card').count() >= 1);

  // switch off: Ctrl+K files open in their Windows app again (no overlay); just check the flag reaches the page
  await p.evaluate(() => fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ peek: false }) }));
  const s = await p.evaluate(() => fetch("/api/settings").then(r => r.json()));
  check("settings keep the Peek switch", s.settings.peek === false);
  await p.evaluate(() => fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ peek: true }) }));

  check("no page errors", !errs.length || (console.log(errs.join("\n")), false));
  await b.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(fails ? `${fails} FAILED` : "ALL PASSED");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
