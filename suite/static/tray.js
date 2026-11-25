/* QT Suite tray bridge: the tray menu's "Jump to" switches this window to that tool (tray.py, GET /api/tray/nav). */
(() => {
  let seq = null, timer = 0;
  async function tick() {
    clearTimeout(timer);
    try {
      const j = await (await fetch("/api/tray/nav", { cache: "no-store" })).json();
      if (seq !== null && j.seq > seq && j.id && typeof show === "function") { if (j.id === "search") { if (window.qtPalOpen) window.qtPalOpen(); } else show(j.id); }
      seq = j.seq;
    } catch (e) { /* hub restarting */ }
    timer = setTimeout(tick, document.hidden ? 3000 : 1000);
  }
  addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });
  addEventListener("focus", tick);
  tick();
})();
