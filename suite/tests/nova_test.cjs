// QT Suite nova layer (loop 5) UI check.  node suite\tests\nova_test.cjs <port of a THROWAWAY hub (QT_SUITE_DATA temp)>
// Needs NODE_PATH with playwright and CHROME=<Edge path>. Writes to-dos/reminders into the throwaway hub's data.
// Never opens an app or a web page, never ends a program, never takes a screenshot into Pictures.
const { chromium } = require("playwright");
const port = process.argv[2] || "7821", base = `http://127.0.0.1:${port}/`;
let fails = 0;
const check = (n, c) => { console.log((c ? "PASS  " : "FAIL  ") + n); if (!c) fails++; };

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base.slice(0, -1) });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", e => errs.push(e.message));
  await p.goto(base); await p.waitForSelector(".tile"); await p.waitForTimeout(2600);
  check("what's new (round five) shows on Home", !!(await p.$(".nv-wn")));

  await p.keyboard.press("Control+k");
  const items = async q => { await p.fill(".pal-wrap input", q); await p.waitForTimeout(350); return p.$$eval(".pal-item", x => x.map(y => ({ b: y.querySelector("b").textContent.trim(), em: (y.querySelector("em") || {}).textContent || "" }))); };
  const top = async q => (await items(q))[0] || { b: "", em: "" };
  // 1 apps (listed, not launched)
  const apps = await (await p.request.get(base + "api/nova/apps")).json();
  if (apps.apps.length) { const a = apps.apps.find(x => /^[a-z]{4}/i.test(x.name)) || apps.apps[0]; const its = await items(a.name.slice(0, 5));
    check(`apps: "${a.name.slice(0, 5)}" finds ${a.name}`, its.some(x => x.b === a.name)); }
  // 2 web search (not run)
  check("web: g cats", (await top("g cats")).b === 'Search Google for "cats"');
  // 3 colour
  const col = await items("#ff6b4a");
  check("colour: hex, rgb, hsl", col[0].b === "#ff6b4a" && col[1].b === "rgb(255 107 74)" && col[2].b === "hsl(11 100% 65%)");
  // 4 text tools on given text
  const up = await top("> upper hello world");
  check("text tools: > upper", up.b === "UPPER CASE" && up.em.startsWith("HELLO WORLD"));
  check("text tools: > slug", (await top("> slug Héllo, World!")).em.startsWith("hello-world"));
  check("text tools: > count", /^2 words · 11 characters/.test((await top("> count hello world")).b));
  // 5 generators
  const pw = (await top("pw 24")).b;
  check("password: 24 chars with every kind", pw.length === 24 && /[a-z]/.test(pw) && /[A-Z]/.test(pw) && /\d/.test(pw) && /[^\w]/.test(pw));
  check("uuid", /^[0-9a-f-]{36}$/.test((await top("uuid")).b));
  check("dice: 3d6 adds up", /^\d \+ \d \+ \d = \d+$/.test((await top("3d6")).b));
  // 6 world clock
  check("time in tokyo", / in Tokyo$/.test((await top("time in tokyo")).b));
  check("time: five cities", (await items("time")).filter(x => / in /.test(x.b)).length >= 5);
  // 7 dates
  check("days until", /days to go$/.test((await top("days until 1 jan 2099")).b));
  check("today + 10 days", /\d{4}$/.test((await top("today + 10 days")).b));
  // 8 reminders: set one 2 s out, it toasts
  const rem = await top("remind 2s nova test ping");
  check("remind parses", rem.b === "Remind me in 1 min" && rem.em.includes("nova test ping"));
  await p.keyboard.press("Enter"); await p.waitForTimeout(400);
  let st = await (await p.request.get(base + "api/nova/store")).json();
  check("reminder saved on the hub", st.reminders.some(r => r.text === "nova test ping"));
  await p.waitForTimeout(2600);
  check("reminder rings as a toast with +5 min", await p.$$eval(".qt-toast", ts => ts.some(t => t.textContent.includes("⏰ nova test ping") && t.textContent.includes("+5 min"))));
  // 10 to-do
  await p.fill(".td-add input", "Nova to-do one"); await p.keyboard.press("Enter");
  await p.fill(".td-add input", "Nova to-do two"); await p.keyboard.press("Enter"); await p.waitForTimeout(600);
  check("to-do: two added, newest first", (await p.$$eval(".td-item .td-t", x => x.map(y => y.textContent))).slice(0, 2).join("|") === "Nova to-do two|Nova to-do one");
  await p.click(".td-item:first-child .td-box"); await p.waitForTimeout(1300);
  st = await (await p.request.get(base + "api/nova/store")).json();
  check("to-do: tick saves and sinks to the bottom", st.todos.find(t => t.text === "Nova to-do two").done && (await p.$eval(".td-list", l => l.lastElementChild.textContent.includes("two"))));
  check("to-do: count matches what is left", (await p.textContent(".td-n")) === `${st.todos.filter(t => !t.done).length} left`);
  // 11 network row
  await p.waitForTimeout(1500);
  check("meter: network row", /↓ .+\/s/.test(await p.textContent('.nv-net [data-k="down"]')));
  // 12 top programs
  await p.click(".sysm"); await p.waitForSelector(".nv-p", { timeout: 15000 }).catch(() => {});
  check("meter pop-up lists top programs", (await p.$$(".nv-p")).length >= 3);
  check("Windows' own programs have no End button", await p.$$eval(".nv-p", r => r.filter(x => /^svchost/.test(x.dataset.name)).every(x => !x.querySelector(".nv-end"))));
  await p.mouse.click(700, 880); await p.waitForTimeout(200);
  // 13 QR
  await p.keyboard.press("Control+k"); await items("qr hello from nova"); await p.keyboard.press("Enter");
  await p.waitForSelector(".nv-qr canvas"); await p.waitForTimeout(600);
  const dark = await p.$eval(".nv-qr canvas", c => { const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 50) n++; return n; });
  check("QR code drawn", dark > 500);
  await p.keyboard.press("Escape"); await p.waitForTimeout(200);
  check("QR: Esc closes", !(await p.$(".nv-qr-wrap")));
  // 14 recent searches
  await p.keyboard.press("Control+k"); await p.waitForTimeout(300);
  check("empty palette shows recent searches", await p.$$eval(".pal-head", h => h.some(x => x.textContent === "Recent")));
  await p.keyboard.press("Escape"); await p.waitForTimeout(250);
  // 15 zen
  await p.keyboard.press("Control+Shift+f"); await p.waitForTimeout(500);
  const railX = await p.$eval("#rail", r => r.getBoundingClientRect().right);
  check("zen hides the rail", (await p.$eval("body", x => x.classList.contains("zen"))) && railX <= 0);
  await p.mouse.move(2, 400); await p.waitForTimeout(450);
  check("zen: the left edge peeks the rail", (await p.$eval("#rail", r => r.getBoundingClientRect().left)) >= 0);
  await p.mouse.move(700, 400); await p.keyboard.press("Control+Shift+f"); await p.waitForTimeout(450);
  check("zen off brings it back", !(await p.$eval("body", x => x.classList.contains("zen"))) && (await p.$eval("#rail", r => r.getBoundingClientRect().width)) > 60);
  // 16 back / forward
  await p.evaluate(() => show("settings")); await p.waitForTimeout(500);
  await p.keyboard.press("Alt+ArrowLeft"); await p.waitForTimeout(400);
  check("Alt+← goes back home", await p.evaluate(() => current === "home"));
  await p.keyboard.press("Alt+ArrowRight"); await p.waitForTimeout(500);
  check("Alt+→ goes forward again", await p.evaluate(() => current === "settings"));
  // 17 look
  await p.waitForSelector("#nv-look-box");
  await p.click('[data-acc="#ff5fa2"]'); await p.click('[data-wall="grid"]'); await p.waitForTimeout(200);
  check("Look: accent + wallpaper apply", (await p.textContent("#nv-look")).includes("#ff5fa2") && (await p.$eval("#view-home", h => h.dataset.wall)) === "grid");
  check("Extras gets the new switches", !!(await p.$('[data-sx="qt-todo"]')) && !!(await p.$('[data-sx="qt-net"]')) && !!(await p.$("[data-clipsw]")));
  await p.click('[data-acc=""]'); await p.click('[data-wall="dots"]');
  // 18 clipboard history
  require("child_process").execFileSync("powershell", ["-NoProfile", "-Command", "Set-Clipboard -Value ('nova clip ' + (Get-Date).Ticks)"]); await p.waitForTimeout(1800);
  await p.keyboard.press("Control+Shift+v"); await p.waitForSelector(".cv-drawer"); await p.waitForTimeout(700);
  check("clipboard history lists the copy", await p.$$eval(".cv-item .cv-t", x => x.some(y => y.textContent.startsWith("nova clip "))));
  await p.keyboard.press("Escape"); await p.waitForTimeout(400);
  check("clipboard: Esc closes", !(await p.$(".cv-drawer")));
  // help list
  await p.keyboard.press("Control+k");
  check("? lists the palette tricks", (await items("?")).length >= 10);
  await p.keyboard.press("Escape");

  // phone width: to-do card fits
  await p.evaluate(() => show("home")); await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(600);
  check("phone width: to-do card fits", await p.$eval(".td", e => e.getBoundingClientRect().right <= 392));
  check("no page errors", errs.length === 0);
  if (errs.length) console.log(errs.join("\n"));
  await b.close();
  console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
