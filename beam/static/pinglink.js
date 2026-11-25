/* "Notifications to PC" card on the Beam page. Only shows inside the Beam phone app (1.4.0+),
   which runs the notification listener (PingListener.java). PC side: ping.py, /notify. */
(function () {
  const N = window.BeamPing;
  if (!N || !N.state) return;
  const anchor = document.querySelector(".card.lens-link") || document.querySelector(".card.send");
  if (!anchor) return;
  const css = document.createElement("style");
  css.textContent = `
    .ping-card .pg-steps { display: flex; flex-direction: column; gap: 8px; margin: 10px 0 12px; }
    .ping-card .pg-step { display: flex; align-items: center; gap: 10px; font-size: 14px; }
    .ping-card .pg-step i { flex: none; width: 22px; height: 22px; border-radius: 50%; border: 2.5px solid #000; display: grid; place-items: center;
      font: 700 12px var(--qt-mono, monospace); font-style: normal; background: var(--qt-chip, #2c2833); }
    .ping-card .pg-step.done i { background: #ff4d5e; color: #16141a; }
    .ping-card .pg-step.done span { opacity: .7; }
    .ping-card .pg-row { display: flex; flex-wrap: wrap; gap: 8px; }
    .ping-card .pg-live { display: inline-flex; align-items: center; gap: 6px; }
    .ping-card .pg-live b { width: 9px; height: 9px; border-radius: 50%; background: #7d766e; border: 1.5px solid #000; }
    .ping-card .pg-live.on b { background: #5dff9c; animation: pgPulse 2s infinite; }
    .ping-card .btn.pg-primary { background: #ff4d5e; color: #16141a; }
    @keyframes pgPulse { 50% { transform: scale(1.4); } }
    .ping-card .pg-step.done i { animation: pgPop .45s cubic-bezier(.34,1.8,.5,1); }
    @keyframes pgPop { 0% { transform: scale(.3) rotate(-30deg); } }
    .ping-card .btn { transition: transform .18s cubic-bezier(.34,1.8,.5,1), box-shadow .18s; }
    .ping-card .btn:active { transform: translate(3px,3px) scale(.96); box-shadow: 0 0 0 #000; }
    .ping-card.live { border-color: #000; box-shadow: 5px 5px 0 #ff4d5e; transition: box-shadow .4s; }`;
  document.head.appendChild(css);
  const card = document.createElement("section");
  card.className = "card ping-card";
  card.innerHTML = `
    <div class="card-h"><h2>Notifications to PC</h2><span class="hint pg-live" id="pgHint"><b></b><span>Off</span></span></div>
    <p class="ll-text" id="pgText"></p>
    <div class="pg-steps" id="pgSteps"></div>
    <div class="pg-row">
      <button class="btn pg-primary" id="pgGo"></button>
      <button class="btn" id="pgBattery">Keep running</button>
      <button class="btn" id="pgTest">Send a test</button>
      <button class="btn ghost sm" id="pgOff" hidden>Turn off</button>
    </div>`;
  anchor.after(card);
  const $ = id => card.querySelector("#" + id);
  let st = {};
  function ago(ms) {
    if (!ms) return "not yet";
    const s = Math.round((Date.now() - ms) / 1000);
    return s < 60 ? "just now" : s < 3600 ? Math.round(s / 60) + " min ago" : Math.round(s / 3600) + " h ago";
  }
  function paint() {
    try { st = JSON.parse(N.state() || "{}"); } catch (e) { st = {}; }
    const on = st.on && st.access;
    const steps = [
      [st.access, "Allow notification access for Beam"],
      [st.battery, "Let Beam keep running (no battery limits)"],
      [st.pc, "Reach Beam on the PC"],
    ];
    const stepsHtml = on ? "" : steps.map((s, i) => `<div class="pg-step${s[0] ? " done" : ""}"><i>${s[0] ? "✓" : i + 1}</i><span>${s[1]}</span></div>`).join("");
    if ($("pgSteps").innerHTML !== stepsHtml) $("pgSteps").innerHTML = stepsHtml;
    card.classList.toggle("live", !!(on && st.running && st.pc));
    let t;
    if (!on) t = "See and answer this phone's notifications on your PC, in QT Suite › Ping. Uses notification access only (no accessibility), so bank apps like BHIM keep working.";
    else if (!st.running) t = "Waiting for Android to start the listener…";
    else if (!st.pc) t = "Can't reach the PC right now" + (st.error ? ` (${st.error})` : "") + ". It catches up when the PC is back.";
    else t = `Live. ${st.sent || 0} sent this session, last ${ago(st.lastOk)}.` + (st.battery ? "" : " Tap Keep running so Android doesn't pause it.");
    if (on && st.testLast) {
      const [kind, val] = [st.testLast.split(":")[0], st.testLast.slice(st.testLast.indexOf(":") + 1)];
      t += kind === "reply" ? ` Last test: your PC reply "${val}" arrived here ✓` : " Last test: the PC pressed the button ✓";
    }
    $("pgText").textContent = t;
    $("pgGo").textContent = !st.access ? "Turn on" : !st.on ? "Turn on" : "Reconnect";
    $("pgGo").hidden = on && st.running && st.pc;
    $("pgBattery").hidden = !!st.battery;
    $("pgTest").hidden = !on;
    $("pgOff").hidden = !on;
    const h = $("pgHint");
    h.className = "hint pg-live" + (on && st.running && st.pc ? " on" : "");
    h.querySelector("span").textContent = !on ? "Off" : !st.running ? "Starting" : st.pc ? "Live" : "Offline";
  }
  $("pgGo").onclick = () => { N.turnOn(); setTimeout(paint, 600); };
  $("pgBattery").onclick = () => N.keepRunning();
  $("pgTest").onclick = () => { N.test(); setTimeout(paint, 600); };
  $("pgOff").onclick = () => { N.turnOff(); setTimeout(paint, 400); };
  paint();
  setInterval(paint, 2500);
  addEventListener("focus", paint);
  document.addEventListener("visibilitychange", () => !document.hidden && paint());
})();
