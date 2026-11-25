"""QT Suite tray check (read-only): helpers + the live hub's tray icon and nav endpoint.
python suite\tests\tray_test.py"""
import ctypes, json, os, sys, urllib.request
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import tray  # noqa: E402

fails = 0
def check(name, ok):
    global fails
    print(("PASS  " if ok else "FAIL  ") + name)
    fails += not ok

tools = [{"id": "beam", "kind": "web", "port": 7788, "status": "on"}, {"id": "kharcha", "kind": "web", "port": 7788, "status": "on"},
         {"id": "volt", "kind": "web", "port": 7777, "status": "off"}, {"id": "pixlab", "kind": "file", "status": "on"}]
check("running count: one per port, file tools don't count", tray._running(tools) == 1)
s0 = tray.nav_state()["seq"]; tray._set_nav("volt")
check("nav bumps seq and remembers the tool", tray.nav_state() == {"seq": s0 + 1, "id": "volt"})
check("poke a hub that isn't there says so", tray.poke(7829) is False)
check("colour helper is BGR", tray._rgb("#ff0000") == 0x0000ff)
try:
    nav = json.loads(urllib.request.urlopen("http://127.0.0.1:7800/api/tray/nav", timeout=3).read())
    check("live hub serves /api/tray/nav", "seq" in nav)
    check("live hub has its tray icon window", bool(ctypes.windll.user32.FindWindowW("QTSuiteTray", None)))
except OSError:
    print("SKIP  hub on 7800 isn't running")
print("ALL PASSED" if not fails else f"{fails} FAILED")
sys.exit(1 if fails else 0)
