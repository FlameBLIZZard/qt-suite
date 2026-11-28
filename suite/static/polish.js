"use strict";
/* QT Suite polish layer (late 2026 loop): the "What's new" card for this round of fixes, loaded last.
   Uses the What's new styles from spark.css. Seen state: localStorage qt-new-v6 (guide.js already marks it
   seen for brand-new people, so they get the welcome instead). */
(() => {
  const RM = matchMedia("(prefers-reduced-motion: reduce)");
  const anim = (el, kf, o) => (RM.matches || !el || !el.animate) ? null : el.animate(kf, o);
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const NEW = [
    ["⚡", "Snappier hub", "Opening the suite with your tools stopped is about 7x faster, and typing in Ctrl+K no longer holds up the rest of the page.", () => window.qtPalOpen && window.qtPalOpen()],
    ["▶", "Start and stop at a glance", "Start my set and Stop all show how many tools they'd touch, and calm down when there's nothing to do.", null],
    ["▯", "Narrow windows and phones", "Burrow, Lens, Space Manager and Launchpad now fit a phone or half of a split view instead of breaking.", null],
    ["🧰", "Toolkit says what broke", "If part of the Toolkit can't load, its page tells you which part and why, instead of buttons that do nothing.", () => show("kit")],
    ["🔊", "Soundboard only takes sound", "Files that aren't real audio are refused, so you don't get pads that can't play.", () => show("soundboard")],
    ["✨", "More bounce", "Copy buttons stamp, Toolkit icons hop, Remote rows deal in, tab pills squash as they land.", null],
  ];
  function whatsNew(force) {
    if (!force && lsGet("qt-new-v6", false)) return;
    const hero = document.querySelector(".hero"); if (!hero) return;
    document.querySelectorAll(".wn").forEach(w => w.remove());
    const c = document.createElement("section");
    c.className = "wn qt-card nv-wn pl-wn"; c.setAttribute("aria-label", "What's new");
    c.innerHTML = `<div class="wn-head"><span class="wn-tag">NEW</span><h2 class="qt-display">What's new</h2><button class="qt-btn ghost icon" data-wn6="x" aria-label="Got it" title="Got it">✕</button></div>
      <div class="wn-grid">${NEW.map(([ic, t, d, f], i) => `<button class="wn-item" data-wn6="${i}" style="--i:${i}" ${f ? "" : 'data-static="1"'}><i>${ic}</i><b>${esc(t)}</b><small>${esc(d)}</small>${f ? "<em>Show me →</em>" : ""}</button>`).join("")}</div>`;
    hero.after(c);
    c.addEventListener("click", e => {
      const b = e.target.closest("[data-wn6]"); if (!b) return;
      if (b.dataset.wn6 === "x") {
        ["qt-new-v4", "qt-new-v5", "qt-new-v6"].forEach(k => lsSet(k, true));
        const a = anim(c, [{ transform: "none", opacity: 1, height: c.offsetHeight + "px" }, { transform: "scale(.96) translateY(-10px) rotate(-.6deg)", opacity: 0, height: "0px", marginBottom: "-22px" }], { duration: 380, easing: "cubic-bezier(.5,0,.75,0)", fill: "forwards" });
        return a ? a.finished.then(() => c.remove(), () => c.remove()) : c.remove();
      }
      const f = NEW[+b.dataset.wn6][3]; if (f) f();
    });
  }
  window.qtWhatsNew6 = whatsNew;
  // the palette's "What's new" opens this card (round five's card stays reachable as before)
  const prevPal = window.qtPalExtra;
  window.qtPalExtra = q => (prevPal ? prevPal(q) : []).concat([{ label: "What's new: latest fixes and polish", words: "new whats changelog latest fixes polish", glyph: "✨", fixed: 30,
    run: () => { show("home"); setTimeout(() => whatsNew(true), 200); } }]);
  // after nova's round-five check (1.1 s) so this one wins when both are unseen
  setTimeout(() => { if (typeof current !== "undefined" && current === "home") whatsNew(); }, 1400);
})();
