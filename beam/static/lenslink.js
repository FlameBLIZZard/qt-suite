/* Lens link card on the Beam page. Only shows inside the Beam phone app (1.3.0+), which does the syncing.
   Lens on the PC: QT\lens-pc. Server side: lenslink.py. */
(function () {
  const N = window.BeamNative;
  if (!N || !N.lensState) return;
  const send = document.querySelector(".card.send");
  if (!send) return;
  const card = document.createElement("section");
  card.className = "card lens-link";
  card.innerHTML = `
    <div class="card-h"><h2>Lens link</h2><span class="hint" id="llHint">Your photos in Lens on the PC</span></div>
    <p class="ll-text" id="llText"></p>
    <div class="ll-bar" id="llBar" hidden><i></i></div>
    <div class="ll-row">
      <button class="btn primary" id="llGo"></button>
      <button class="btn" id="llIndex">Link Lens index</button>
      <button class="btn ghost sm" id="llStop" hidden>Turn off</button>
    </div>`;
  send.after(card);
  const $ = id => card.querySelector("#" + id);
  let pc = null, st = {};

  function ago(ms) {
    if (!ms) return "never";
    const m = Math.round((Date.now() - ms) / 60000);
    return m < 1 ? "just now" : m < 60 ? m + " min ago" : m < 1440 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " days ago";
  }
  function paint() {
    try { st = JSON.parse(N.lensState() || "{}"); } catch (e) { st = {}; }
    if (st.supported === false) {
      $("llText").textContent = "Lens link needs Android 10 or newer.";
      $("llGo").hidden = $("llIndex").hidden = true;
      return;
    }
    let t;
    if (!st.on) t = "Shows every photo and video from this phone in Lens on your PC, with the people, tags and word search Lens found. Lens itself stays offline: Beam carries it. Originals only move when you ask on the PC.";
    else if (st.running) t = st.progress || "Syncing…";
    else t = `${(st.count || 0).toLocaleString()} items · last sync ${ago(st.last)}` + (st.msg ? ` · ${st.msg}` : "");
    if (st.on && !st.index) t += " Link the Lens index (Download › Lens-backup.db) to bring people, tags and word search.";
    if (pc && (pc.wants || pc.outbox) && st.on) t += ` ${pc.wants ? pc.wants + " original(s) asked for." : ""}${pc.outbox ? " " + pc.outbox + " photo(s) from the PC waiting." : ""}`;
    $("llText").textContent = t;
    $("llGo").textContent = !st.on ? "Start" : st.running ? "Syncing…" : "Sync now";
    $("llGo").disabled = !!st.running;
    $("llIndex").textContent = st.index ? "Change Lens index" : "Link Lens index";
    $("llIndex").hidden = !st.on;
    $("llStop").hidden = !st.on;
    $("llBar").hidden = !st.running;
    $("llHint").textContent = st.on ? (st.running ? "Working" : "On") : "Your photos in Lens on the PC";
  }
  $("llGo").onclick = () => { st.on ? N.lensSyncNow(true) : N.lensStart(); setTimeout(paint, 400); };
  $("llIndex").onclick = () => N.lensLinkIndex();
  $("llStop").onclick = () => { N.lensStop(); paint(); };

  // the PC asked for originals, or sent photos: do a quick pass right away while Beam is open
  let lastQuick = 0;
  async function check() {
    try {
      const r = await fetch("/api/lens/status", { credentials: "same-origin" });
      if (r.ok) pc = await r.json();
    } catch (e) { pc = null; }
    if (st.on && !st.running && pc && (pc.wants || pc.outbox) && Date.now() - lastQuick > 10000) {
      lastQuick = Date.now();
      N.lensSyncNow(false);
    }
    paint();
  }
  paint();
  check();
  setInterval(() => (st.running ? paint() : check()), 3000);
  addEventListener("focus", paint);
})();
