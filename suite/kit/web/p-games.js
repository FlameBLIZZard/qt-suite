/* Toolkit panels: party mode, mini arcade (phones as controllers), game launcher, deals. */
(() => {
  const K = window.qtKit, { api, esc, say, qrSvg, ago } = K;

  /* ------------------------------------------------------------- shared pad input */
  const keysDown = new Set();
  const kd = e => { if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyA", "KeyS", "KeyD", "Space", "Enter"].includes(e.code)) { keysDown.add(e.code); if (document.querySelector(".karc canvas")) e.preventDefault(); } };
  const ku = e => keysDown.delete(e.code);
  addEventListener("keydown", kd); addEventListener("keyup", ku);
  const kbPads = () => [
    { slot: 100, name: "Keys WASD", color: "#f0ece4", x: (keysDown.has("KeyD") ? 1 : 0) - (keysDown.has("KeyA") ? 1 : 0), y: (keysDown.has("KeyS") ? 1 : 0) - (keysDown.has("KeyW") ? 1 : 0), a: keysDown.has("Space"), live: true, kb: true },
    { slot: 101, name: "Keys arrows", color: "#8a8590", x: (keysDown.has("ArrowRight") ? 1 : 0) - (keysDown.has("ArrowLeft") ? 1 : 0), y: (keysDown.has("ArrowDown") ? 1 : 0) - (keysDown.has("ArrowUp") ? 1 : 0), a: keysDown.has("Enter"), live: true, kb: true }];
  async function pads(useKb) {
    let p = [];
    try { p = (await api("/api/kit/pads")).p.filter(x => x.live); } catch {}
    return useKb ? p.concat(kbPads()) : p;
  }

  /* ------------------------------------------------------------- 29. party mode */
  const QUIZ = [
    ["Which planet has the most moons?", ["Saturn", "Jupiter", "Uranus", "Mars"], 0], ["What's the capital of Australia?", ["Sydney", "Melbourne", "Canberra", "Perth"], 2],
    ["How many bones are in an adult human body?", ["186", "206", "226", "246"], 1], ["Which gas do plants take in?", ["Oxygen", "Nitrogen", "Carbon dioxide", "Helium"], 2],
    ["Who wrote the Harry Potter books?", ["J.K. Rowling", "Roald Dahl", "C.S. Lewis", "J.R.R. Tolkien"], 0], ["What's the fastest land animal?", ["Lion", "Cheetah", "Pronghorn", "Horse"], 1],
    ["How many players in a cricket team on the field?", ["9", "10", "11", "12"], 2], ["Which is the longest river in India?", ["Yamuna", "Godavari", "Ganga", "Narmada"], 2],
    ["What does CPU stand for?", ["Central Processing Unit", "Computer Power Unit", "Core Processing Utility", "Central Program Unit"], 0], ["Which ocean is the largest?", ["Atlantic", "Indian", "Arctic", "Pacific"], 3],
    ["In which year did India win its first cricket World Cup?", ["1975", "1983", "1987", "2011"], 1], ["What's H2O?", ["Salt", "Water", "Hydrogen", "Ozone"], 1],
    ["Which element has the symbol Fe?", ["Fluorine", "Iron", "Lead", "Tin"], 1], ["How many minutes in a day?", ["1240", "1440", "1640", "1840"], 1],
    ["Which game has a Creeper?", ["Fortnite", "Minecraft", "Valorant", "Roblox"], 1], ["Sekiro is set in which country?", ["China", "Korea", "Japan", "Vietnam"], 2],
  ];
  K.panel("party", async el => {
    let p = await api("/api/kit/party"), qi = Math.floor(Math.random() * QUIZ.length), custom = null;
    const draw = async () => {
      const q = p.quiz;
      el.innerHTML = `<div class="kcols"><section class="kp qt-card" id="pstage"><h3>Room ${esc(p.room)} <span class="qt-chip">${p.players.length} / 8 players</span>
          <button class="qt-btn ghost kbtn-sm" data-fs>Full screen</button><button class="qt-btn ghost kbtn-sm" data-new>New party</button></h3>
        <div class="kpill">${[["lobby", "Lobby"], ["quiz", "Quiz"], ["buzz", "Buzzer"], ["tap", "Tap race"], ["pad", "Controllers (arcade)"]].map(([m, l]) => `<button data-mode="${m}" aria-pressed="${p.mode === m}">${l}</button>`).join("")}</div>
        <div id="pbody">${body()}</div>
        <div class="krow">${p.players.map(x => `<span class="kpl" style="--c:${x.color}"><i></i>${esc(x.name)} <b>${x.score}</b>${x.live ? "" : " (away)"}<button class="qt-btn ghost kbtn-sm" data-kick="${esc(x.name)}" title="Remove">✕</button></span>`).join("") || `<span class="kmini">Waiting for friends to scan the code...</span>`}</div></section>
        <section class="kp qt-card"><h3>Friends join here</h3><div class="krow"><span class="kqr">${await qrSvg(p.join, 5)}</span>
          <div class="kfield grow"><b style="color:var(--qt-fg)">Scan with the phone camera</b><span>Same Wi-Fi as this PC. No app, no sign-up. Plain link (no warning): </span><code>${esc(p.join)}</code>
          <span class="kmini">If their browser refuses plain http, use <code>${esc(p.join_tls)}</code> and tap Advanced, Proceed.</span></div></div></section></div>`;
    };
    const body = () => {
      const q = p.quiz;
      if (p.mode === "quiz") {
        const answered = p.players.filter(x => x.answer != null).length;
        return q ? `<h2 class="qt-display" style="margin:6px 0">${esc(q.q)}</h2><div class="kquiz">${q.options.map((o, i) => `<div class="${q.reveal === i ? "right" : ""}" style="border-color:var(--qt-ink)">${"ABCD"[i]}. ${esc(o)}</div>`).join("")}</div>
          <div class="krow"><span class="kmini">${answered} of ${p.players.length} answered</span>${q.reveal == null ? `<button class="qt-btn primary" data-reveal>Reveal answer</button>` : `<button class="qt-btn primary" data-nextq>Next question</button>`}</div>`
          : `<p>Ask a built-in question or write your own.</p><div class="krow"><button class="qt-btn primary" data-nextq>Random question</button></div>
          <div class="kfield">Your own question<input class="qt-input" id="cq" placeholder="Question"><div class="krow">${[0, 1, 2, 3].map(i => `<input class="qt-input grow" id="co${i}" placeholder="Answer ${"ABCD"[i]}${i === 0 ? " (right one)" : ""}">`).join("")}</div>
          <button class="qt-btn" data-ask>Ask it</button></div>`;
      }
      if (p.mode === "buzz") return `<div style="text-align:center;padding:20px"><div class="kbig" style="font-size:54px">${p.buzz.length ? "🔔 " + esc(p.buzz[0]) : "Buzzers ready"}</div>
        <p class="kmini">${p.buzz.slice(1).map(esc).join(", ")}</p><div class="krow" style="justify-content:center"><button class="qt-btn primary" data-buzzreset>Reset buzzers</button>
        ${p.buzz.length ? `<button class="qt-btn" data-pt="${esc(p.buzz[0])}">+100 to ${esc(p.buzz[0])}</button>` : ""}</div></div>`;
      if (p.mode === "tap") {
        const max = Math.max(50, ...p.players.map(x => x.taps));
        return `<p class="kmini">First to 100 taps wins. Press Start to zero the counters.</p><div class="klist">${p.players.map(x => `<div class="kfield"><span class="krow sp"><b style="color:${x.color}">${esc(x.name)}</b><b>${x.taps}</b></span><span class="bar"><i style="width:${100 * x.taps / max}%;background:${x.color}"></i></span></div>`).join("")}</div>
          <button class="qt-btn primary" data-mode="tap">Start / restart</button>`;
      }
      if (p.mode === "pad") return `<p>Phones are now controllers. Open <b>Mini arcade</b> and pick a game; everyone in the party can play.</p><button class="qt-btn primary" data-arcade>Go to the arcade</button>`;
      return `<p>Everyone who scans the QR shows up below with their own colour. Pick a game mode above.</p>`;
    };
    await draw();
    el.addEventListener("click", async e => {
      const d = a => e.target.closest(`[data-${a}]`)?.dataset[a];
      try {
        if (d("mode")) p = await api("/api/kit/party", { op: "mode", mode: d("mode") });
        if (e.target.closest("[data-nextq]")) { const q = QUIZ[qi++ % QUIZ.length]; p = await api("/api/kit/party", { op: "quiz", q: q[0], options: q[1], answer: q[2] }); }
        if (e.target.closest("[data-ask]")) {
          const opts = [0, 1, 2, 3].map(i => el.querySelector("#co" + i).value.trim()).filter(Boolean);
          if (opts.length < 2) return say("Add at least two answers", { bad: true });
          const order = opts.map((o, i) => [o, Math.random(), i]).sort((a, b) => a[1] - b[1]);
          p = await api("/api/kit/party", { op: "quiz", q: el.querySelector("#cq").value, options: order.map(x => x[0]), answer: order.findIndex(x => x[2] === 0) });
        }
        if (e.target.closest("[data-reveal]")) p = await api("/api/kit/party", { op: "reveal" });
        if (e.target.closest("[data-buzzreset]")) p = await api("/api/kit/party", { op: "buzzreset" });
        if (d("pt")) p = await api("/api/kit/party", { op: "score", name: d("pt"), add: 100 });
        if (d("kick")) p = await api("/api/kit/party", { op: "kick", name: d("kick") });
        if (e.target.closest("[data-new]")) { if (!confirm("End this party? Everyone has to scan the new code.")) return; p = await api("/api/kit/party", { op: "new" }); }
        if (e.target.closest("[data-arcade]")) return K.open("arcade");
        if (e.target.closest("[data-fs]")) return el.querySelector("#pstage").requestFullscreen();
        if (e.target.closest("button")) await draw();
      } catch (err) { say(err.message, { bad: true }); }
    });
    let sig = "";
    const t = setInterval(async () => {
      if (el.querySelector("input:focus")) return;
      const x = await api("/api/kit/party"); const s2 = JSON.stringify([x.players.map(y => [y.name, y.score, y.taps, y.answer, y.live]), x.buzz, x.mode, x.quiz && x.quiz.reveal, x.room]);
      if (s2 !== sig) { sig = s2; p = x; const fs = document.fullscreenElement; if (fs) { el.querySelector("#pbody").innerHTML = body(); } else await draw(); }
    }, 700);
    return () => clearInterval(t);
  });

  /* ------------------------------------------------------------- 11. mini arcade */
  const GAMES = {
    pong: { name: "Ink Pong", blurb: "2 players. Tilt the stick up and down.", min: 2 },
    worm: { name: "Worm Brawl", blurb: "Up to 8 worms. Eat dots, don't crash.", min: 1 },
    dodge: { name: "Block Rain", blurb: "Everyone dodges. Last one standing wins.", min: 1 },
  };
  K.panel("arcade", async el => {
    const party = await api("/api/kit/party");
    el.innerHTML = `<div class="kcols"><section class="kp qt-card"><h3>Pick a game</h3><div class="kit-grid">${Object.entries(GAMES).map(([k, g]) => `<button class="kit-card qt-card" data-g="${k}"><b>${g.name}</b><span class="qt-muted">${g.blurb}</span></button>`).join("")}</div>
      <p class="kmini">Controllers: your paired phone (open <b>Pad</b> on it), friends via Party mode, or the keyboard (WASD + Space, arrows + Enter).</p></section>
      <section class="kp qt-card"><h3>Phones as controllers</h3><div class="krow"><span class="kqr">${await qrSvg(party.join, 4)}</span><div class="kfield grow"><span>Friends scan this (Party), you can use your paired phone's pad:</span><code>${esc(party.pad.lan.split("?")[0])}</code>
      <button class="qt-btn kbtn-sm" data-copy="${esc(party.pad.lan)}">Copy pad link</button></div></div></section>
      <section class="kp qt-card karc" id="arc" style="grid-column:1/-1;display:none"><div class="krow sp"><h3 id="atitle"></h3><span class="krow"><button class="qt-btn ghost kbtn-sm" data-fs>Full screen</button><button class="qt-btn ghost kbtn-sm" data-quit>Stop</button></span></div>
        <div style="position:relative"><canvas id="acv" width="1280" height="720"></canvas><div class="over" id="aover"></div></div></section></div>`;
    el.addEventListener("click", e => { const c = e.target.closest("[data-copy]"); if (c) { navigator.clipboard.writeText(c.dataset.copy); say("Copied"); } });
    api("/api/kit/party", { op: "mode", mode: "pad" }).catch(() => {});
    let game = null, raf = 0, polling = 0, P = [];
    const cv = el.querySelector("#acv"), cx = cv.getContext("2d"), W = 1280, H = 720;
    const over = (html) => { el.querySelector("#aover").innerHTML = html ? `<div class="qt-card" style="padding:20px 30px;pointer-events:auto">${html}</div>` : ""; };
    const stop = () => { cancelAnimationFrame(raf); clearInterval(polling); game = null; };
    const win = name => { api("/api/kit/event", { k: "arcade.win", d: name }).catch(() => {}); };
    async function start(id) {
      stop();
      el.querySelector("#arc").style.display = ""; el.querySelector("#atitle").textContent = GAMES[id].name;
      api("/api/kit/event", { k: "arcade.play", d: id }).catch(() => {});
      polling = setInterval(async () => { P = await pads(true); }, 33);
      P = await pads(true);
      game = { id, ...INIT[id]() };
      over(""); let last = performance.now();
      const loop = t => { const dt = Math.min(0.05, (t - last) / 1000); last = t; STEP[id](game, dt); DRAW[id](game); raf = requestAnimationFrame(loop); };
      raf = requestAnimationFrame(loop);
      el.querySelector("#arc").scrollIntoView({ behavior: "smooth", block: "start" });
    }
    const players = n => { const live = P.filter(p => !p.kb || keysDown.size || true); return live.slice(0, n); };
    const text = (s, x, y, size = 40, c = "#fff8ec", al = "center") => { cx.font = `${size}px "Archivo Black", Impact, sans-serif`; cx.fillStyle = c; cx.textAlign = al; cx.fillText(s, x, y); };
    const box = (x, y, w, h, c) => { cx.fillStyle = "#000"; cx.fillRect(x + 5, y + 5, w, h); cx.fillStyle = c; cx.fillRect(x, y, w, h); cx.strokeStyle = "#000"; cx.lineWidth = 3; cx.strokeRect(x, y, w, h); };
    const INIT = {
      pong: () => ({ a: H / 2, b: H / 2, bx: W / 2, by: H / 2, vx: 420, vy: 160, sa: 0, sb: 0, done: null }),
      worm: () => ({ worms: {}, food: Array.from({ length: 10 }, () => [Math.random() * (W - 80) + 40, Math.random() * (H - 80) + 40]), t: 0, done: null, started: false, wait: 3 }),
      dodge: () => ({ ppl: {}, blocks: [], t: 0, rate: 1.2, done: null, wait: 3 }),
    };
    const STEP = {
      pong(g, dt) {
        if (g.done) return;
        const [p1, p2] = [P[0], P[1]];
        if (p1) g.a = Math.max(70, Math.min(H - 70, g.a + p1.y * 620 * dt));
        if (p2) g.b = Math.max(70, Math.min(H - 70, g.b + p2.y * 620 * dt)); else g.b += Math.sign(g.by - g.b) * Math.min(Math.abs(g.by - g.b), 380 * dt);
        g.bx += g.vx * dt; g.by += g.vy * dt;
        if (g.by < 14 || g.by > H - 14) g.vy *= -1;
        const hit = (px, py) => Math.abs(g.bx - px) < 26 && Math.abs(g.by - py) < 72;
        if (g.vx < 0 && hit(50, g.a)) { g.vx = Math.abs(g.vx) * 1.06; g.vy += (g.by - g.a) * 4; K.playSound("blip"); }
        if (g.vx > 0 && hit(W - 50, g.b)) { g.vx = -Math.abs(g.vx) * 1.06; g.vy += (g.by - g.b) * 4; K.playSound("blip"); }
        if (g.bx < -20 || g.bx > W + 20) {
          if (g.bx < 0) g.sb++; else g.sa++;
          Object.assign(g, { bx: W / 2, by: H / 2, vx: (g.bx < 0 ? 1 : -1) * 420, vy: (Math.random() - .5) * 300 });
          if (g.sa >= 5 || g.sb >= 5) { const w = g.sa >= 5 ? (P[0] || {}).name || "Left" : (P[1] || {}).name || "Computer"; g.done = w; over(`<h2 class="qt-display">${esc(w)} wins!</h2><button class="qt-btn primary" data-g="pong">Play again</button>`); win(w); }
        }
      },
      worm(g, dt) {
        if (g.done) return;
        if (g.wait > 0) { g.wait -= dt; return; }
        P.forEach((p, i) => {
          let w = g.worms[p.slot];
          if (!w) w = g.worms[p.slot] = { name: p.name, color: p.color, x: 120 + (i % 4) * 300, y: 140 + Math.floor(i / 4) * 400, ang: 0, body: [], len: 30, alive: true, score: 0 };
          if (!w.alive) return;
          if (Math.hypot(p.x, p.y) > .3) { const want = Math.atan2(p.y, p.x); let d = want - w.ang; d = Math.atan2(Math.sin(d), Math.cos(d)); w.ang += Math.max(-5 * dt, Math.min(5 * dt, d)); }
          const sp = p.a ? 330 : 210; w.x += Math.cos(w.ang) * sp * dt; w.y += Math.sin(w.ang) * sp * dt;
          w.body.unshift([w.x, w.y]); if (w.body.length > w.len) w.body.length = w.len;
          if (w.x < 0 || w.y < 0 || w.x > W || w.y > H) w.alive = false;
          for (const o of Object.values(g.worms)) for (let j = o === w ? 12 : 0; j < o.body.length; j += 2) if (o.alive !== undefined && Math.hypot(o.body[j][0] - w.x, o.body[j][1] - w.y) < 10) { w.alive = false; break; }
          g.food.forEach((f, k) => { if (Math.hypot(f[0] - w.x, f[1] - w.y) < 20) { w.len += 12; w.score++; g.food[k] = [Math.random() * (W - 80) + 40, Math.random() * (H - 80) + 40]; K.playSound("soft"); } });
        });
        const all = Object.values(g.worms), alive = all.filter(w => w.alive);
        if (all.length > 1 && alive.length <= 1 || all.length === 1 && !alive.length) {
          const w = alive[0] || all.sort((a, b) => b.score - a.score)[0]; g.done = w.name;
          over(`<h2 class="qt-display">${esc(w.name)} wins!</h2><p>${all.map(x => esc(x.name) + " " + x.score).join(" · ")}</p><button class="qt-btn primary" data-g="worm">Play again</button>`); win(w.name);
        }
      },
      dodge(g, dt) {
        if (g.done) return;
        if (g.wait > 0) { g.wait -= dt; return; }
        g.t += dt; g.rate = Math.max(.18, 1.2 - g.t / 40);
        if ((g.next = (g.next || 0) - dt) <= 0) { g.next = g.rate; g.blocks.push({ x: Math.random() * (W - 80), y: -60, w: 50 + Math.random() * 90, v: 240 + g.t * 9 }); }
        g.blocks.forEach(b => { b.y += b.v * dt; }); g.blocks = g.blocks.filter(b => b.y < H + 60);
        P.forEach((p, i) => {
          let m = g.ppl[p.slot]; if (!m) m = g.ppl[p.slot] = { name: p.name, color: p.color, x: 200 + i * 120, alive: true, t: 0 };
          if (!m.alive) return;
          m.x = Math.max(20, Math.min(W - 20, m.x + p.x * 560 * dt)); m.t = g.t;
          if (g.blocks.some(b => m.x + 18 > b.x && m.x - 18 < b.x + b.w && H - 70 < b.y + 40 && H - 34 > b.y)) { m.alive = false; K.playSound("wood"); }
        });
        const all = Object.values(g.ppl), alive = all.filter(m => m.alive);
        if (all.length && (all.length > 1 ? alive.length <= 1 : !alive.length)) {
          const w = alive[0] || all.sort((a, b) => b.t - a.t)[0]; g.done = w.name;
          over(`<h2 class="qt-display">${esc(w.name)} survives ${w.t.toFixed(1)} s</h2><button class="qt-btn primary" data-g="dodge">Play again</button>`); win(w.name);
        }
      },
    };
    const bg = () => { cx.fillStyle = "#0f0e12"; cx.fillRect(0, 0, W, H); cx.fillStyle = "#1c1921"; for (let x = 0; x < W; x += 40) for (let y = 0; y < H; y += 40) cx.fillRect(x, y, 2, 2); };
    const DRAW = {
      pong(g) { bg(); cx.fillStyle = "#2c2833"; for (let y = 0; y < H; y += 40) cx.fillRect(W / 2 - 3, y, 6, 22);
        box(36, g.a - 60, 24, 120, (P[0] || {}).color || "#c6ff3d"); box(W - 60, g.b - 60, 24, 120, (P[1] || {}).color || "#ff5fa2"); box(g.bx - 12, g.by - 12, 24, 24, "#fff8ec");
        text(g.sa, W / 2 - 80, 80, 64); text(g.sb, W / 2 + 80, 80, 64); text((P[0] || {}).name || "Player 1", 90, H - 24, 20, "#b6aea3", "left"); text((P[1] || {}).name || "Computer", W - 90, H - 24, 20, "#b6aea3", "right"); },
      worm(g) { bg(); g.food.forEach(f => box(f[0] - 8, f[1] - 8, 16, 16, "#ffc93d"));
        Object.values(g.worms).forEach(w => { cx.lineCap = "round"; cx.lineJoin = "round"; cx.strokeStyle = "#000"; cx.lineWidth = 22; cx.beginPath(); w.body.forEach((b, i) => i ? cx.lineTo(b[0], b[1]) : cx.moveTo(b[0], b[1])); cx.stroke();
          cx.strokeStyle = w.alive ? w.color : "#444"; cx.lineWidth = 15; cx.stroke(); text(w.name + " " + w.score, w.x, w.y - 22, 16, w.alive ? w.color : "#666"); });
        if (g.wait > 0) text(Math.ceil(g.wait), W / 2, H / 2, 120); if (!P.length) text("Waiting for a controller...", W / 2, H / 2, 36, "#b6aea3"); },
      dodge(g) { bg(); g.blocks.forEach(b => box(b.x, b.y, b.w, 40, "#ff5d6c"));
        Object.values(g.ppl).forEach(m => { if (m.alive) box(m.x - 18, H - 70, 36, 36, m.color); else text("✖", m.x, H - 40, 30, "#666"); text(m.name, m.x, H - 82, 15, m.color); });
        text(g.t.toFixed(1) + " s", W - 30, 50, 34, "#fff8ec", "right"); if (g.wait > 0) text(Math.ceil(g.wait), W / 2, H / 2, 120); },
    };
    el.addEventListener("click", e => {
      const g = e.target.closest("[data-g]"); if (g) start(g.dataset.g);
      if (e.target.closest("[data-quit]")) { stop(); el.querySelector("#arc").style.display = "none"; }
      if (e.target.closest("[data-fs]")) el.querySelector("#arc").requestFullscreen();
    });
    return stop;
  });

  /* ------------------------------------------------------------- 9. game launcher */
  K.panel("games", async el => {
    let s = await api("/api/kit/games");
    const h = m => m >= 60 ? (m / 60).toFixed(1) + " h" : Math.round(m) + " min";
    const draw = () => {
      const max = Math.max(1, ...s.daily.map(d => d.total));
      el.innerHTML = `<div class="kcols"><section class="kp qt-card"><h3>Game mode ${s.mode.on ? `<span class="qt-chip ok">on${s.mode.game !== "manual" ? ": " + esc(s.mode.game) : ""}</span>` : ""}</h3>
          <div class="krow">${s.mode.on ? `<button class="qt-btn" data-mode="0">Turn off</button>` : `<button class="qt-btn primary" data-mode="1">Turn on now</button>`}<span class="kmini">Ctrl+Alt+G</span></div>
          ${[["auto", "Turn on by itself when a game starts (from Launchpad's list)"], ["power", "Switch to the High performance power plan"], ["quiet", "Mute phone notifications"], ["fps", "Show the FPS overlay"]]
            .map(([k, l]) => `<label class="krow"><button class="qt-switch" role="switch" data-cfg="${k}" aria-checked="${!!s.cfg[k]}"></button> ${l}</label>`).join("")}
          <p class="kmini">VOLT downloads pause while you play and carry on after.</p>
          <h3>FPS overlay ${s.fps.on ? '<span class="qt-chip ok">on</span>' : ""}</h3>
          ${s.pm ? `<div class="krow"><button class="qt-btn" data-fps="${s.fps.on ? 0 : 1}">${s.fps.on ? "Hide FPS" : "Show FPS now"}</button>
            <label class="kfield">Corner<select id="gc">${[["tl", "Top left"], ["tr", "Top right"], ["bl", "Bottom left"], ["br", "Bottom right"]].map(([v, l]) => `<option value="${v}" ${s.cfg.fps_corner === v ? "selected" : ""}>${l}</option>`).join("")}</select></label></div>
            <p class="kmini">Windows asks for admin once each time (PresentMon reads frame timing from the graphics driver). Works in windowed and borderless games.</p>`
          : `<p class="kmini">The overlay uses Intel's free PresentMon (about 3 MB).</p><button class="qt-btn" data-pm ${s.fps.busy ? "disabled" : ""}>${s.fps.busy ? esc(s.fps.busy) : "Download PresentMon"}</button>`}</section>
        <section class="kp qt-card"><h3>This week: ${h(s.week_min)}</h3><div class="kbars">${s.daily.map(d => `<div><i style="height:${100 * d.total / max}px"></i>${new Date(d.day).toLocaleDateString(undefined, { weekday: "short" })}</div>`).join("")}</div>
          <p class="kmini">Playtime comes from Launchpad, which keeps tracking after its window closes.</p></section>
        <section class="kp qt-card" style="grid-column:1/-1"><h3>Your games ${s.ok ? "" : '<span class="qt-chip bad">Launchpad is off</span><button class="qt-btn kbtn-sm" data-startlp>Start Launchpad</button>'}</h3>
          <div class="kgames">${s.games.map(g => `<button class="kgame" data-play="${esc(g.id)}" title="Play ${esc(g.name)}"><img src="http://127.0.0.1:7790${g.art && g.art.portrait || ""}" onerror="this.style.visibility='hidden'" loading="lazy">
            <div class="in"><b>${esc(g.name)}</b><span class="kmini">${h(g.minutes || 0)}${s.week_per[g.id] ? " · " + h(s.week_per[g.id]) + " this week" : ""}${g.running ? " · playing" : ""}</span></div></button>`).join("") || `<div class="kempty">No games yet.</div>`}</div></section></div>`;
    };
    draw();
    el.addEventListener("click", async e => {
      const d = a => e.target.closest(`[data-${a}]`)?.dataset[a];
      try {
        if (d("play")) { await api("/api/kit/games", { op: "launch", id: d("play") }); say("Launching. Have fun!"); }
        if (d("mode")) { const r = await api("/api/kit/games", { op: "mode", on: d("mode") === "1" }); say(r.msg); }
        if (d("cfg")) await api("/api/kit/games", { op: "cfg", [d("cfg")]: e.target.closest("[data-cfg]").getAttribute("aria-checked") !== "true" });
        if (d("fps")) { const r = await api("/api/kit/games", { op: "fps", on: d("fps") === "1" }); say(r.msg); }
        if (e.target.closest("[data-pm]")) { await api("/api/kit/games", { op: "pm_install" }); say("Downloading PresentMon..."); setTimeout(async () => { s = await api("/api/kit/games"); draw(); }, 4000); }
        if (e.target.closest("[data-startlp]")) { await fetch("/api/start/launchpad", { method: "POST" }); setTimeout(async () => { s = await api("/api/kit/games"); draw(); }, 2500); }
        if (e.target.closest("button")) { s = await api("/api/kit/games"); draw(); }
      } catch (err) { say(err.message, { bad: true }); }
    });
    el.addEventListener("change", e => { if (e.target.id === "gc") api("/api/kit/games", { op: "cfg", fps_corner: e.target.value }); });
  });

  /* ------------------------------------------------------------- 10. deals */
  K.panel("deals", async el => {
    el.innerHTML = `<div class="kempty">Checking Steam, Epic and CheapShark...</div>`;
    let s = await api("/api/kit/deals"), tab = "steam", q = "";
    const card = d => `<button class="kdeal" data-url="${esc(d.url)}">${d.img ? `<img src="${esc(d.img)}" loading="lazy" referrerpolicy="no-referrer">` : ""}<div class="in"><b>${esc(d.name)}</b>
      <span class="krow">${d.cut ? `<span class="cut">-${d.cut}%</span>` : `<span class="cut">FREE</span>`}${d.now != null ? `<b>${d.cur === "USD" ? "$" + d.now.toFixed(2) : "₹" + Math.round(d.now)}</b>` : ""}${d.was ? `<s>${d.cur === "USD" ? "$" + d.was.toFixed(2) : "₹" + Math.round(d.was)}</s>` : ""}</span>
      <span class="kmini">${d.store ? esc(d.store) + " · " : ""}${d.ends ? "ends " + new Date(typeof d.ends === "number" ? d.ends * 1000 : d.ends).toLocaleDateString() : d.starts ? "free from " + new Date(d.starts).toLocaleDateString() : ""}${d.rating ? " · " + d.rating + "% liked" : ""}</span></div></button>`;
    const draw = () => {
      const list = (tab === "epic" ? s.epic.concat(s.epic_next || []) : s[tab] || []).filter(d => !q || d.name.toLowerCase().includes(q));
      el.innerHTML = `<div class="kp qt-card"><div class="krow sp"><div class="kpill">${[["steam", "Steam sale (₹)"], ["epic", "Epic free games"], ["cheap", "Best deals (CheapShark, $)"]].map(([k, l]) => `<button data-tab="${k}" aria-pressed="${tab === k}">${l}</button>`).join("")}</div>
        <span class="krow"><input class="qt-input" id="dq" placeholder="Filter" value="${esc(q)}"><button class="qt-btn ghost kbtn-sm" data-fresh>Refresh</button><span class="kmini">updated ${ago(s.t)}</span></span></div>
        ${s.errors && s.errors.length ? `<p class="bad kmini">${s.errors.map(esc).join("<br>")}</p>` : ""}
        <div class="kdeals">${list.map(card).join("") || `<div class="kempty">Nothing here right now.</div>`}</div></div>
        <div class="kp qt-card"><h3>Watch list</h3><p class="kmini">Get a Windows notification when a game with this name goes on sale (checked every 6 hours).</p>
          <div class="krow">${s.watch.map(w => `<span class="qt-chip">${esc(w)} <button class="qt-btn ghost kbtn-sm" data-unwatch="${esc(w)}">✕</button></span>`).join("")}</div>
          <div class="krow"><input class="qt-input grow" id="dw" placeholder="Elden Ring"><button class="qt-btn" data-watch>Watch</button></div></div>`;
    };
    draw();
    el.addEventListener("click", async e => {
      const d = a => e.target.closest(`[data-${a}]`)?.dataset[a];
      if (d("tab")) { tab = d("tab"); draw(); }
      if (d("url")) api("/api/kit/deals", { op: "open", url: d("url") });
      if (e.target.closest("[data-fresh]")) { s = await api("/api/kit/deals?fresh=1"); draw(); }
      if (e.target.closest("[data-watch]")) { const r = await api("/api/kit/deals", { op: "watch", name: el.querySelector("#dw").value }); s.watch = r.watch; api("/api/kit/event", { k: "deal.watch" }); draw(); }
      if (d("unwatch")) { const r = await api("/api/kit/deals", { op: "unwatch", name: d("unwatch") }); s.watch = r.watch; draw(); }
    });
    el.addEventListener("change", e => { if (e.target.id === "dq") { q = e.target.value.toLowerCase(); draw(); } });
  });
})();
