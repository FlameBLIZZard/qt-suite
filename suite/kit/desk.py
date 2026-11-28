"""Desktop: window snap zones, floating desktop widgets, live wallpapers."""
import ctypes
import os
import subprocess
import threading
import time
from ctypes import wintypes as W

import kit
from kit import actions, common, winapi

u32 = winapi.u32
EDGE = next((p for p in (r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
                         r"C:\Program Files\Microsoft\Edge\Application\msedge.exe") if os.path.exists(p)), None)
LAST = {"fg": None}


def init():
    threading.Thread(target=_track_fg, name="kit-fg", daemon=True).start()
    if common.load("widgets", {"restore": False})["restore"]:
        threading.Timer(15, restore_widgets).start()
    w = common.load("wallpaper", {"on": False})
    if w.get("on"):
        threading.Timer(20, lambda: wall_start(w.get("scene", "ink"), w.get("file", ""))).start()


def _is_ours(h):
    t = winapi.title(h)
    return t.startswith(("QT Suite", "QT widget")) or t in ("", "Program Manager")


def _track_fg():
    """Remember the last window that isn't the Suite, so 'move to zone' from the Suite page knows what to move."""
    while True:
        try:
            h = winapi.foreground()
            if h and not _is_ours(h):
                LAST["fg"] = h
        except Exception:
            pass
        time.sleep(0.4)


# ================================================================ 27. snap zones ===
LAYOUTS = {
    "halves": {"name": "Halves", "zones": [[0, 0, .5, 1], [.5, 0, .5, 1]]},
    "thirds": {"name": "Thirds", "zones": [[0, 0, 1 / 3, 1], [1 / 3, 0, 1 / 3, 1], [2 / 3, 0, 1 / 3, 1]]},
    "focus": {"name": "Big + side", "zones": [[0, 0, 2 / 3, 1], [2 / 3, 0, 1 / 3, .5], [2 / 3, .5, 1 / 3, .5]]},
    "grid": {"name": "Grid 2x2", "zones": [[0, 0, .5, .5], [.5, 0, .5, .5], [0, .5, .5, .5], [.5, .5, .5, .5]]},
    "center": {"name": "Centre stage", "zones": [[.2, 0, .6, 1], [0, 0, .2, 1], [.8, 0, .2, 1]]},
    "wide": {"name": "Ultrawide 3+", "zones": [[0, 0, .25, 1], [.25, 0, .5, 1], [.75, 0, .25, 1]]},
}


def zones_cfg():
    return common.load("zones", {"layout": "focus", "gap": 8, "custom": None})


def snap(n, h=None):
    cfg = zones_cfg()
    lay = cfg.get("custom") if cfg.get("layout") == "custom" and cfg.get("custom") else LAYOUTS.get(cfg["layout"], LAYOUTS["halves"])["zones"]
    n = int(n)
    if not 1 <= n <= len(lay):
        return False, f"this layout has {len(lay)} zones"
    h = h or winapi.foreground()
    if not h or _is_ours(h):
        h = LAST["fg"]
    if not h:
        return False, "no window to move"
    x, y, w, hh = winapi.work_area(h)
    g = int(cfg.get("gap", 8))
    zx, zy, zw, zh = lay[n - 1]
    # DWM adds an invisible border; compensate so zones line up visually
    winapi.move(h, x + zx * w + g / 2 - 7, y + zy * hh + g / 2, zw * w - g + 14, zh * hh - g + 7)
    common.event("snap.zone", str(n))
    return True, f"moved to zone {n}"


for _i in range(1, 10):
    actions.register(f"snap.{_i}", f"Snap window to zone {_i}", lambda _a=None, n=_i: snap(n))


def _cycle_layout(_=None):
    cfg = zones_cfg()
    keys = list(LAYOUTS)
    cfg["layout"] = keys[(keys.index(cfg["layout"]) + 1) % len(keys)] if cfg["layout"] in keys else keys[0]
    common.save("zones", cfg)
    return True, "layout: " + LAYOUTS[cfg["layout"]]["name"]


actions.register("snap.next_layout", "Next snap layout", _cycle_layout)


@kit.hub_get("/api/kit/zones")
def _zones(q):
    cfg = zones_cfg()
    h = LAST["fg"]
    return 200, dict(cfg, layouts=LAYOUTS, target=winapi.title(h)[:80] if h else "")


@kit.hub_post("/api/kit/zones")
def _zones_set(b):
    cfg = zones_cfg()
    if b.get("op") == "snap":
        ok, msg = snap(b.get("n", 1), LAST["fg"])
        return (200 if ok else 400), {"ok": ok, "msg": msg}
    if b.get("layout") in LAYOUTS or b.get("layout") == "custom":
        cfg["layout"] = b["layout"]
    if "gap" in b:
        cfg["gap"] = max(0, min(int(b["gap"]), 40))
    if isinstance(b.get("custom"), list):
        cz = []
        for z in b["custom"][:9]:
            try:
                cz.append([max(0.0, min(float(v), 1.0)) for v in z[:4]])
            except (TypeError, ValueError):
                pass
        cfg["custom"] = cz or None
    common.save("zones", cfg)
    return _zones({})


# ============================================================ 26. desktop widgets ===
WIDGETS = {
    "clock": ("Clock", 260, 150), "sysmon": ("CPU + RAM", 260, 170), "kharcha": ("Kharcha", 280, 230),
    "music": ("Mini player", 320, 150), "focus": ("Focus timer", 240, 170), "notes": ("Sticky note", 280, 260),
    "deck": ("Mini deck", 300, 220), "subs": ("Due soon", 280, 200),
}
PROCS = {}


def _edge_app(url, w, h, x=None, y=None, profile="widgets", extra=()):
    if not EDGE:
        raise OSError("Microsoft Edge not found")
    args = [EDGE, f"--app={url}", f"--window-size={int(w)},{int(h)}", "--no-first-run", "--no-default-browser-check",
            f"--user-data-dir={os.path.join(common.DATA, 'edge-' + profile)}", "--inprivate", "--disable-sync",
            "--disable-features=Translate,msImplicitSignin,msEdgeSidebarV2", *extra]   # InPrivate: no sign-in bubbles in tiny windows
    if x is not None:
        args.append(f"--window-position={int(x)},{int(y)}")
    return subprocess.Popen(args)


def widget_open(kind, x=None, y=None, w=None, h=None, pin=True):
    if kind not in WIDGETS:
        return False, "unknown widget"
    name, dw, dh = WIDGETS[kind]
    wid = "w" + kind
    old = winapi.find(f"QT widget \u00b7 {name}")
    if old:
        winapi.u32.SetForegroundWindow(old)
        return True, "already open"
    if x is None:
        ax, ay, aw, ah = winapi.work_area(u32.GetDesktopWindow())
        keys = list(WIDGETS)   # fixed slot per widget: a column down the right edge, then a second column
        y, col = ay + 24, 0
        for k in keys[:keys.index(kind)]:
            y += WIDGETS[k][2] + 14
            if y + dh > ay + ah - 20:
                y, col = ay + 24, col + 1
        x = ax + aw - (w or dw) - 24 - col * 340
    _edge_app(f"http://127.0.0.1:{kit.INFO['port']}/kit/w/{kind}.html", w or dw, h or dh, x, y)

    def topmost():
        hwnd = winapi.wait_window(f"QT widget \u00b7 {name}", 12)
        if hwnd:
            winapi.topmost(hwnd, pin)
            if x is not None:
                winapi.move(hwnd, x, y, w or dw, h or dh)
    threading.Thread(target=topmost, daemon=True).start()
    common.event("widget.open", kind)
    return True, name + " opened"


def open_widgets():
    out = []
    for k, (name, _, _) in WIDGETS.items():
        h = winapi.find(f"QT widget \u00b7 {name}")
        if h:
            x, y, w, hh = winapi.rect(h)
            out.append({"kind": k, "x": x, "y": y, "w": w, "h": hh})
    return out


def restore_widgets():
    for it in common.load("widgets", {"restore": False, "saved": []}).get("saved", []):
        widget_open(it["kind"], it["x"], it["y"], it["w"], it["h"], it.get("pin", True))
        time.sleep(0.8)


@kit.hub_get("/api/kit/widgets")
def _wg(q):
    cfg = common.load("widgets", {"restore": False, "saved": []})
    return 200, dict(cfg, kinds=[{"kind": k, "name": v[0]} for k, v in WIDGETS.items()], open=open_widgets())


@kit.hub_post("/api/kit/widgets")
def _wg_post(b):
    op = b.get("op")
    cfg = common.load("widgets", {"restore": False, "saved": []})
    if op == "open":
        ok, msg = widget_open(b.get("kind"), pin=b.get("pin", True))
        return (200 if ok else 400), {"ok": ok, "msg": msg}
    if op == "close":
        h = winapi.find(f"QT widget \u00b7 {WIDGETS.get(b.get('kind'), ('?',))[0]}")
        if h:
            winapi.close(h)
    if op == "closeall":
        for k, v in WIDGETS.items():
            h = winapi.find(f"QT widget \u00b7 {v[0]}")
            if h:
                winapi.close(h)
    if op == "pin":
        h = winapi.find(f"QT widget \u00b7 {WIDGETS.get(b.get('kind'), ('?',))[0]}")
        if h:
            winapi.topmost(h, bool(b.get("on")))
    if op == "save":
        cfg["saved"] = open_widgets()
        cfg["restore"] = True
        common.save("widgets", cfg)
    if op == "restore":
        cfg["restore"] = bool(b.get("on"))
        common.save("widgets", cfg)
    time.sleep(0.3)
    return _wg({})


@kit.hub_get("/api/kit/sticky")
def _sticky(q):
    return 200, common.load("sticky", {"text": ""})


@kit.hub_post("/api/kit/sticky")
def _sticky_set(b):
    return 200, common.save("sticky", {"text": str(b.get("text", ""))[:20000]})


actions.register("widget.music", "Open the mini player", lambda _=None: widget_open("music"))
actions.register("widget.clock", "Open the clock widget", lambda _=None: widget_open("clock"))


# ============================================================== 8. live wallpaper ===
WALL = {"hwnd": None, "proc": None}
SCENES = {"ink": "Ink waves", "stars": "Starfield", "blobs": "Lava blobs", "grid": "Synth grid", "rain": "Code rain", "clock": "Big clock", "video": "Your video"}
GWL_STYLE = -16
u32.SetParent.restype = W.HWND
u32.SetParent.argtypes = [W.HWND, W.HWND]
u32.FindWindowExW.restype = W.HWND
u32.FindWindowExW.argtypes = [W.HWND, W.HWND, W.LPCWSTR, W.LPCWSTR]
u32.SendMessageTimeoutW.argtypes = [W.HWND, W.UINT, W.WPARAM, W.LPARAM, W.UINT, W.UINT, ctypes.POINTER(ctypes.c_size_t)]
try:
    _SetWL = u32.SetWindowLongPtrW
    _GetWL = u32.GetWindowLongPtrW
except AttributeError:
    _SetWL, _GetWL = u32.SetWindowLongW, u32.GetWindowLongW
_SetWL.argtypes = [W.HWND, ctypes.c_int, ctypes.c_ssize_t]
_SetWL.restype = ctypes.c_ssize_t
_GetWL.argtypes = [W.HWND, ctypes.c_int]
_GetWL.restype = ctypes.c_ssize_t


def _worker_w():
    """Find the window that sits between the wallpaper and the desktop icons."""
    progman = u32.FindWindowW("Progman", None)
    res = ctypes.c_size_t()
    u32.SendMessageTimeoutW(progman, 0x052C, 0xD, 0x1, 0, 1000, ctypes.byref(res))
    u32.SendMessageTimeoutW(progman, 0x052C, 0, 0, 0, 1000, ctypes.byref(res))
    found = {"w": None}

    def cb(h, _):
        if u32.FindWindowExW(h, None, "SHELLDLL_DefView", None):
            found["w"] = u32.FindWindowExW(None, h, "WorkerW", None)
        return True
    u32.EnumWindows(winapi.WNDENUMPROC(cb), 0)
    if found["w"]:
        return found["w"], "classic"
    child = u32.FindWindowExW(progman, None, "WorkerW", None)   # Windows 11 24H2+: WorkerW lives inside Progman
    if child:
        return child, "progman-child"
    return progman, "progman"


def wall_start(scene="ink", file=""):
    wall_stop()
    if scene not in SCENES:
        scene = "ink"
    url = f"http://127.0.0.1:{kit.INFO['port']}/kit/wall/index.html?scene={scene}"
    sw, sh = u32.GetSystemMetrics(0), u32.GetSystemMetrics(1)
    WALL["proc"] = _edge_app(url, sw, sh, 0, 0, profile="wall", extra=("--autoplay-policy=no-user-gesture-required", "--mute-audio"))
    h = winapi.wait_window("QT wallpaper", 15)
    if not h:
        return False, "the wallpaper window didn't open"
    style = _GetWL(h, GWL_STYLE)
    _SetWL(h, GWL_STYLE, (style & ~0x00CF0000) | 0x40000000)  # drop caption/frame, become a child
    ww, how = _worker_w()
    u32.SetParent(h, ww)
    if how == "progman-child" or how == "progman":
        # put it right above the wallpaper but below the icons
        defview = u32.FindWindowExW(u32.FindWindowW("Progman", None), None, "SHELLDLL_DefView", None)
        u32.SetWindowPos(h, defview or W.HWND(1), 0, 0, sw, sh, 0x0010 | 0x0040)
    else:
        u32.SetWindowPos(h, None, 0, 0, sw, sh, 0x0004 | 0x0010 | 0x0040)
    WALL["hwnd"] = h
    cfg = common.load("wallpaper", {"on": False})
    cfg.update(on=True, scene=scene, file=file or cfg.get("file", ""), how=how)
    common.save("wallpaper", cfg)
    common.event("wall.on", scene)
    return True, f"{SCENES[scene]} is on ({how})"


def wall_stop():
    p = WALL.get("proc")
    h = WALL.get("hwnd") or winapi.find("QT wallpaper")
    if h:
        winapi.close(h)
    if p and p.poll() is None:
        try:
            p.terminate()
        except OSError:
            pass
    WALL.update(hwnd=None, proc=None)
    # repaint the normal wallpaper
    ctypes.windll.user32.SystemParametersInfoW(0x0014, 0, None, 0)
    cfg = common.load("wallpaper", {"on": False})
    if cfg.get("on"):
        cfg["on"] = False
        common.save("wallpaper", cfg)
    return True, "wallpaper off"


@kit.hub_get("/api/kit/wall")
def _wall(q):
    cfg = common.load("wallpaper", {"on": False, "scene": "ink", "file": ""})
    cfg["running"] = bool(WALL.get("hwnd") and u32.IsWindow(WALL["hwnd"]))
    return 200, dict(cfg, scenes=SCENES)


@kit.hub_post("/api/kit/wall")
def _wall_post(b):
    if b.get("op") == "off":
        ok, msg = wall_stop()
    else:
        f = str(b.get("file", ""))
        if b.get("scene") == "video":
            if not (os.path.isfile(f) and f.lower().endswith((".mp4", ".webm", ".mkv", ".mov"))):
                return 400, {"ok": False, "msg": "pick an .mp4 or .webm video"}
            cfg = common.load("wallpaper", {"on": False})
            cfg["file"] = f
            common.save("wallpaper", cfg)
        ok, msg = wall_start(b.get("scene", "ink"), f)
    return (200 if ok else 500), {"ok": ok, "msg": msg}


@kit.raw_get("/api/kit/wall/video")
def _wall_video(h, q):
    """Streams the chosen wallpaper video (only that one file) with Range support."""
    f = common.load("wallpaper", {}).get("file", "")
    if not os.path.isfile(f):
        h.send_response(404)
        h.end_headers()
        return
    size = os.path.getsize(f)
    rng = h.headers.get("Range", "")
    start, end = 0, size - 1
    if rng.startswith("bytes="):
        a, _, bb = rng[6:].partition("-")
        start = int(a or 0)
        end = min(int(bb) if bb else size - 1, size - 1)
        h.send_response(206)
        h.send_header("Content-Range", f"bytes {start}-{end}/{size}")
    else:
        h.send_response(200)
    h.send_header("Content-Type", "video/mp4" if f.lower().endswith(".mp4") else "video/webm")
    h.send_header("Accept-Ranges", "bytes")
    h.send_header("Content-Length", str(end - start + 1))
    h.end_headers()
    with open(f, "rb") as fh:
        fh.seek(start)
        left = end - start + 1
        while left > 0:
            chunk = fh.read(min(left, 1 << 16))
            if not chunk:
                break
            try:
                h.wfile.write(chunk)
            except OSError:
                return
            left -= len(chunk)


actions.register("wall.toggle", "Live wallpaper on / off",
                 lambda _=None: wall_stop() if WALL.get("hwnd") else wall_start(common.load("wallpaper", {}).get("scene", "ink")))
