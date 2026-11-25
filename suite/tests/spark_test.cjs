// QT Suite spark layer (loop 4) UI check.  node suite\tests\spark_test.cjs <port of a THROWAWAY hub (QT_SUITE_DATA temp)>
// Needs NODE_PATH with playwright and CHROME=<Edge path>. Writes notes/pins into the throwaway hub's data and makes
// its own temp fixtures. Never starts a download or sends anything to the phone.
const { chromium } = require("playwright");
const fs = require("fs"), os = require("os"), path = require("path"), zlib = require("zlib");
const port = process.argv[2] || "7821", base = `http://127.0.0.1:${port}/`;
let fails = 0;
const check = (n, c) => { console.log((c ? "PASS  " : "FAIL  ") + n); if (!c) fails++; };

// fixtures: code, markdown, two pictures, a zip, a 70 s sound
const FX = fs.mkdtempSync(path.join(os.tmpdir(), "qt-spark-ui-")) + path.sep;
fs.writeFileSync(FX + "code.py", Array.from({ length: 400 }, (_, i) => i % 7 === 0 ? `def fn_${i}(x):\n    return x  # needle` : `value_${i} = ${i}`).join("\n"));
fs.writeFileSync(FX + "notes.md", "# Guide\n\n" + Array.from({ length: 6 }, (_, i) => `## Section ${i + 1}\n\n${"Lorem ipsum dolor sit amet. ".repeat(120)}\n\n`).join(""));
// 2x2 PNGs (no EXIF; facts still show size)
const png = rgb => { const crc = b => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } let x = 0xffffffff; for (const v of b) x = t[(x ^ v) & 255] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0; };
  const chunk = (ty, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(ty), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(64, 0); ihdr.writeUInt32BE(48, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(64 * 3).map((_, i) => rgb[i % 3])]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.concat(Array(48).fill(row)))), chunk("IEND", Buffer.alloc(0))]); };
fs.writeFileSync(FX + "pic1.png", png([255, 90, 80])); fs.writeFileSync(FX + "pic2.png", png([80, 200, 255]));
// stored zip with one file
const zipOne = (name, data) => { const n = Buffer.from(name), d = Buffer.from(data); const crc = (() => { let c = 0xffffffff; for (const b of d) { c ^= b; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; } return (c ^ 0xffffffff) >>> 0; })();
  const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(d.length, 18); lh.writeUInt32LE(d.length, 22); lh.writeUInt16LE(n.length, 26);
  const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(d.length, 20); ch.writeUInt32LE(d.length, 24); ch.writeUInt16LE(n.length, 28);
  const local = Buffer.concat([lh, n, d]), cen = Buffer.concat([ch, n]);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(cen.length, 12); end.writeUInt32LE(local.length, 16);
  return Buffer.concat([local, cen, end]); };
fs.writeFileSync(FX + "pack.zip", zipOne("readme.txt", "hello"));
const wav = secs => { const n = 8000 * secs, b = Buffer.alloc(44 + n); b.write("RIFF", 0); b.writeUInt32LE(36 + n, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24); b.writeUInt32LE(8000, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write("data", 36); b.writeUInt32LE(n, 40); for (let i = 0; i < n; i++) b[44 + i] = 128 + Math.round(50 * Math.sin(i / 3)); return b; };
fs.writeFileSync(FX + "a.wav", wav(70)); fs.writeFileSync(FX + "b.wav", wav(70));

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME, args: ["--autoplay-policy=no-user-gesture-required"] });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base.slice(0, -1) });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", e => errs.push(e.message));
  await p.goto(base); await p.waitForSelector(".tile"); await p.waitForTimeout(2500);

  // 1 calculator + units
  await p.keyboard.press("Control+k");
  const top = async q => { await p.fill(".pal-wrap input", q); await p.waitForTimeout(250); return (await p.textContent(".pal-item.on b")).trim(); };
  check("calc: 18% of 2400 = 432", (await top("18% of 2400")) === "= 432");
  check("calc: (2+3)*4^2 = 80", (await top("(2+3)*4^2")) === "= 80");
  check("units: 5 km in mi", /^= 3\.1069 mi$/.test(await top("5 km in mi")));
  check("units: 212 f to c", (await top("212 f to c")) === "= 100 °C");
  check("plain words don't become sums", !(await top("burrow")).startsWith("="));
  // 2 link choices
  await p.fill(".pal-wrap input", "https://example.com/video"); await p.waitForTimeout(250);
  const linkItems = await p.$$eval(".pal-item b", x => x.slice(0, 3).map(y => y.textContent));
  check("link: VOLT + phone choices first", linkItems[0] === "Download with VOLT" && linkItems.includes("Send this link to my phone"));
  await p.keyboard.press("Escape"); await p.waitForTimeout(250);

  // 3 notes
  await p.keyboard.press("Control+j"); await p.waitForSelector(".nt-drawer textarea");
  await p.click('.nt-drawer [data-n="new"]'); await p.keyboard.type("Spark test note"); await p.waitForTimeout(1200);
  const st = await (await p.request.get(base + "api/spark/store")).json();
  check("notes: typing saves to the hub", st.notes.some(n => n.text === "Spark test note"));
  await p.keyboard.press("Escape"); await p.waitForTimeout(400);
  check("notes: Esc closes", !(await p.$(".nt-drawer")));

  // 4 meter
  await p.waitForTimeout(2200);
  check("meter: CPU and RAM numbers", /\d+%/.test(await p.textContent('.sysm [data-k="cpu"]')) && /\d+%/.test(await p.textContent('.sysm [data-k="mem"]')));

  // 6-10 viewers
  await p.evaluate(f => qtPeek(f + "code.py"), FX); await p.waitForSelector(".pk-codebox"); await p.waitForTimeout(300);
  await p.keyboard.press("Control+f"); await p.keyboard.type("needle"); await p.waitForTimeout(300);
  check("code: Ctrl+F counts matches", /^1 \/ 58$/.test((await p.textContent(".pk-find-n")).trim()));
  await p.keyboard.press("Escape"); await p.keyboard.press("Control+g"); await p.keyboard.type("300"); await p.keyboard.press("Enter"); await p.waitForTimeout(700);
  check("code: Ctrl+G jumps down", (await p.$eval(".pk-view", v => v.scrollTop)) > 3000);
  await p.evaluate(f => qtPeek(f + "notes.md"), FX); await p.waitForSelector(".pk-toc");
  check("one overlay at a time", (await p.$$(".pk")).length === 1);
  await p.click('.pk-toc [data-k="4"]'); await p.waitForTimeout(900);
  check("markdown: outline jumps + lights up", (await p.textContent(".pk-toc .on")).trim() === "Section 4");
  await p.evaluate(f => qtPeek(f + "pic1.png"), FX); await p.waitForSelector(".pk-canvas img"); await p.waitForTimeout(900);
  await p.keyboard.press("i"); await p.waitForTimeout(700);
  check("pictures: facts panel", /64 × 48/.test(await p.textContent(".pk-facts")));
  await p.keyboard.press("i");
  await p.keyboard.press("s"); await p.waitForTimeout(300);
  const c0 = await p.textContent(".pk-count");
  await p.waitForTimeout(5400);
  check("pictures: slideshow steps on", (await p.textContent(".pk-count")) !== c0 && !!(await p.$(".pk-show")));
  await p.keyboard.press("Escape"); await p.waitForTimeout(300);
  check("pictures: Esc stops the slideshow first", !(await p.$(".pk-show")) && !!(await p.$(".pk")));
  await p.keyboard.press("p"); await p.waitForTimeout(400);
  check("P pins the file to Home", await p.evaluate(() => document.querySelectorAll('[data-list="pins"] .sh-item').length > 0));
  await p.evaluate(f => qtPeek(f + "pack.zip"), FX); await p.waitForSelector('[data-tb="unpack"]');
  await p.click('[data-tb="unpack"]'); await p.waitForTimeout(1000);
  check("archive: unpack makes a folder", fs.existsSync(FX + "pack" + path.sep + "readme.txt"));
  await p.evaluate(() => localStorage.setItem("qt-play-pos", "{}"));
  await p.evaluate(f => qtPeek(f + "a.wav"), FX); await p.waitForSelector("audio"); await p.waitForTimeout(700);
  await p.evaluate(() => { document.querySelector("audio").currentTime = 40; }); await p.waitForTimeout(2600);
  await p.evaluate(f => qtPeek(f + "b.wav"), FX); await p.waitForTimeout(500);
  await p.evaluate(f => qtPeek(f + "a.wav"), FX); await p.waitForTimeout(1500);
  check("player: picks up where it stopped", (await p.$eval("audio", a => a.currentTime)) > 35 && !!(await p.$(".pk-resume")));
  await p.evaluate(() => { const a = document.querySelector("audio"); a.currentTime = a.duration - .5; a.play(); }); await p.waitForTimeout(1500);
  check("player: up next card", ((await p.$eval(".pk-upnext b", e => e.textContent).catch(() => "")) === "b.wav"));
  await p.waitForTimeout(3300);
  check("player: plays the next one", (await p.textContent(".pk-name")) === "b.wav");
  await p.keyboard.press("Escape"); await p.waitForTimeout(400);

  // 11 timer
  await p.click("#timer-btn"); await p.click('.tm-pop [data-m="5"]'); await p.waitForTimeout(1200);
  const tl = (await p.textContent("#timer-btn span")).trim();
  check(`timer: counts down in the rail (${tl})`, /^[45]:\d\d$/.test(tl));
  await p.evaluate(() => { qtTimer.get().end = Date.now() + 600; }); await p.waitForTimeout(1600);
  check("timer: rings with a +5 button", await p.$$eval(".qt-toast", t => t.some(x => /Time's up/.test(x.textContent) && x.querySelector("button"))));
  await p.click(".qt-toast.act .qt-btn"); await p.waitForTimeout(1200);
  check("toast button runs (+5 min)", /^[45]:\d\d$/.test((await p.textContent("#timer-btn span")).trim()));
  await p.evaluate(() => qtTimer.stop(true));
  // 12 history
  await p.click("#act-btn"); await p.waitForTimeout(500);
  check("activity shows recent messages", (await p.$$(".tl-row")).length > 0);
  await p.keyboard.press("Escape");
  // 14 list view
  await p.click('[data-hvb="list"]'); await p.waitForTimeout(600);
  const h = await p.$eval(".tile", t => t.getBoundingClientRect().height);
  check("list view: tiles become rows", h < 80);
  await p.click('[data-hvb="tiles"]'); await p.waitForTimeout(500);
  // 16 clock, 17 hover card, 18 downloads
  check("clock in the greeting", /\d\d:\d\d/.test(await p.textContent(".hclock")));
  await p.hover('#nav .nav[data-go]:not([data-go="files"])'); await p.waitForTimeout(1200);
  check("rail hover card", !!(await p.$(".hc")));
  await p.mouse.move(800, 500); await p.waitForTimeout(500);
  check("downloads column answers", (await (await p.request.get(base + "api/spark/downloads")).json()).files !== undefined);
  // 13 settings extras + backup
  await p.goto(base + "#settings"); await p.waitForSelector("#sx-extras");
  const [dl] = await Promise.all([p.waitForEvent("download"), p.click('[data-bk="export"]')]);
  const bk = JSON.parse(fs.readFileSync(await dl.path(), "utf8"));
  check("backup file has settings + notes", bk.app === "QT Suite" && bk.settings && bk.store.notes.length > 0);
  // 19 shortcuts
  check("? sheet knows Ctrl+J", await p.evaluate(() => (window.qtKeys || []).some(k => k === "Notes")));
  check("no page errors" + (errs.length ? ": " + errs.join(" | ") : ""), !errs.length);
  await b.close();
  fs.rmSync(FX, { recursive: true, force: true });
  console.log(fails ? fails + " FAILED" : "ALL SPARK CHECKS PASSED");
  process.exit(fails);
})();
