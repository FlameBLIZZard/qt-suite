"use strict";
/* Runs before everything else: applies the saved look (rail size, motion) before first paint,
   and makes "prefers-reduced-motion" follow the suite's own Motion setting (system / full / calm). */
(() => {
  let s = {};
  try { s = JSON.parse(localStorage.getItem("qt-shell") || "{}"); } catch (_) {}
  const root = document.documentElement;
  root.classList.toggle("qt-compact", s.rail === "compact");
  root.classList.toggle("qt-calm", s.motion === "calm");
  window.qtMotion = s.motion || "system";
  const real = window.matchMedia.bind(window);
  window.matchMedia = q => {
    const mq = real(q);
    if (!/prefers-reduced-motion:\s*reduce/.test(q)) return mq;
    return new Proxy(mq, {
      get(target, k) {
        if (k === "matches") return window.qtMotion === "calm" ? true : window.qtMotion === "full" ? false : target.matches;
        const v = Reflect.get(target, k, target);
        return typeof v === "function" ? v.bind(target) : v;
      }
    });
  };
})();
