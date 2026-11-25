"use strict";
/* Surf in the hub: Ctrl+K items that open web searches, links and bookmarks inside the Suite's own browser.
   Loaded after nova.js. Surf itself is suite/apps/surf.html (static/surf.js), a same-origin "file" tool. */
(() => {
  const palInput = () => document.querySelector(".pal-wrap input");
  function palAdd(fn) {
    const prev = window.qtPalExtra;
    window.qtPalExtra = q => { const out = prev ? prev(q) : []; try { fn(q, palInput() ? palInput().value : q, out); } catch (e) { console.warn(e); } return out; };
  }
  const say = (m, o) => (window.qtToast || window.toast || console.log)(m, o);

  async function openSurf(url) {
    if (typeof show !== "function" || !tools.some(t => t.id === "surf")) return say("Surf isn't in the Suite", { bad: true });
    show("surf");
    for (let n = 0; n < 80; n++) {
      const f = frames.surf && frames.surf.querySelector("iframe");
      let w = null; try { w = f && f.contentWindow; } catch (_) {}
      if (w && w.qtSurf && w.QT_READY) { w.qtSurf.open(url); try { f.focus(); } catch (_) {} return; }
      await new Promise(r => setTimeout(r, 100));
    }
    say("Surf didn't load", { bad: true });
  }
  window.qtOpenSurf = openSurf;

  const BING = "https://www.bing.com/search?q=";
  // sites that show inside Surf (Live or Lite). Google refuses both, so "g" searches Bing in Surf.
  const SITES = {
    g: ["Bing", BING, true], yt: ["YouTube", "https://www.youtube.com/results?search_query="],
    w: ["Wikipedia", "https://en.wikipedia.org/w/index.php?search="], gh: ["GitHub", "https://github.com/search?q="],
    maps: ["Bing Maps", "https://www.bing.com/maps?q="], amz: ["Amazon", "https://www.amazon.in/s?k="],
    ddg: ["DuckDuckGo", "https://html.duckduckgo.com/html/?q="], b: ["Bing", BING],
  };
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } };
  const host = u => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (_) { return u; } };

  palAdd((q, raw, out) => {
    const t = raw.trim();
    if (!t) return;
    const m = /^(\w+)\s+(.+)$/.exec(t);
    if (m && SITES[m[1].toLowerCase()]) {
      const [name, url, swapped] = SITES[m[1].toLowerCase()];
      out.push({ label: `Search ${name} for "${m[2].slice(0, 50)}" in Surf`, sub: swapped ? "inside the Suite (Google won't show inside other apps)" : "inside the Suite",
        fixed: 1099, glyph: "◍", run: () => openSurf(url + encodeURIComponent(m[2])) });
      return;
    }
    const link = /^https?:\/\/\S+$/i.test(t) ? t : (!/\s/.test(t) && /^[\w-]+(\.[\w-]+)*\.[a-z]{2,}(:\d+)?([/?#]\S*)?$/i.test(t) && !/^[a-z]:[\\/]/i.test(t) ? "https://" + t : null);
    if (link) out.push({ label: `Open ${host(link)} in Surf`, sub: link.slice(0, 80), fixed: 1050, glyph: "◍", run: () => openSurf(link) });
    else if (t.length >= 3 && !/^[>=#?]/.test(t) && !/^[a-z]:[\\/]/i.test(t))
      out.push({ label: `Search "${t.slice(0, 50)}" in Surf`, sub: "Bing, inside the Suite", head: "Web", fixed: 0.49, glyph: "◍", run: () => openSurf(BING + encodeURIComponent(t)) });
    // bookmarks saved in Surf
    if (t.length >= 2) {
      const ql = t.toLowerCase();
      (lsGet("qt-surf-bm", []) || []).filter(b => b && b.url && ((b.title || "").toLowerCase().includes(ql) || b.url.toLowerCase().replace(/^https?:\/\/(www\.)?/, "").startsWith(ql)))
        .slice(0, 4).forEach((b, i) => out.push({ label: b.title || host(b.url), sub: b.url.replace(/^https?:\/\//, "").slice(0, 70), head: "Bookmarks", fixed: 2.4 - i * .01, glyph: "★", run: () => openSurf(b.url) }));
    }
  });
})();
