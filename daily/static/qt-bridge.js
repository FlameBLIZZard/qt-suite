/* QT Suite bridge: lets the suite's shortcuts work while you're inside a tool.
   Ctrl+0..9 inside any tool page is passed to the QT Suite window (when the tool runs inside it).
   Ctrl+K (search), Ctrl+E (recent tools), Ctrl+[ ] (previous / next), Ctrl+\ (split) and Ctrl+, (settings) and F1 (help) are passed
   up too, unless the tool already used that key itself (Launchpad's Ctrl+K search stays Launchpad's).
   Copied into each tool by sync-theme.py, next to qt.css. */
(function () {
  if (window.top === window.self) return;
  addEventListener("keydown", function (e) {
    if (!e.ctrlKey || e.altKey || e.shiftKey || !/^[0-9]$/.test(e.key)) return;
    e.preventDefault();
    try { window.top.postMessage({ qt: "go", n: +e.key }, "*"); } catch (_) { /* not inside the suite */ }
  }, true);
  addEventListener("keydown", function (e) {   // F1 = the suite's Help for this tool
    if (e.key !== "F1" || e.shiftKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
    e.preventDefault();
    try { window.top.postMessage({ qt: "help" }, "*"); } catch (_) {}
  });
  var FWD = { k: 1, e: 1, "[": 1, "]": 1, "\\": 1, ",": 1 };
  addEventListener("keydown", function (e) {   // bubble phase: the tool's own handlers go first
    if (!e.ctrlKey || e.altKey || e.metaKey || e.defaultPrevented) return;
    var k = e.key && e.key.length === 1 ? e.key.toLowerCase() : "";
    if (!FWD[k]) return;
    e.preventDefault();
    try { window.top.postMessage({ qt: "key", key: k, shift: e.shiftKey }, "*"); } catch (_) {}
  });
})();
