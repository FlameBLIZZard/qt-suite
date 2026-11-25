"""QT Suite nova layer (loop 5): the server half of static/nova.js.

GET  /api/nova/apps              Start menu apps (name + .lnk path), cached for 5 minutes
POST /api/nova/launch            {path} start one of those apps (only paths from the list)
POST /api/nova/web               {url} open an http(s) link in the default browser
GET  /api/nova/store             todos + reminders (nova.json next to settings.json)
POST /api/nova/store             {todos?, reminders?} validated and saved
GET  /api/nova/due?since=        reminders that went off after `since` (the page shows a toast too)
POST /api/nova/shot              {delay} screenshot of every screen -> Pictures\\Screenshots, returns the path
GET  /api/nova/net               download / upload bytes per second (all network adapters)
GET  /api/nova/top               the 10 programs using the most memory
POST /api/nova/kill              {pid, name} end one of them (refuses Windows' own processes and the hub)
GET  /api/nova/clips             the last 25 things copied (memory only, never written to disk)
POST /api/nova/clips             {paused?, clear?}
"""
import csv
import ctypes
import io
import json
import os
import re
import subprocess
import threading
import time
import uuid
import webbrowser
from ctypes import wintypes

import shell

STORE = os.path.join(shell.DATA, "nova.json")
NOWIN = 0x08000000
_lock = threading.Lock()
_store = None
HOME = os.path.expanduser("~")


def init():
    threading.Thread(target=_reminder_loop, name="qt-remind", daemon=True).start()
    threading.Thread(target=_clip_loop, name="qt-clips", daemon=True).start()


# ---------------------------------------------------------------- store ---
def store():
    global _store
    with _lock:
        if _store is None:
            s = {"todos": [], "reminders": []}
            try:
                with open(STORE, encoding="utf-8") as f:
                    got = json.load(f)
                if isinstance(got, dict):
                    s.update({k: v for k, v in got.items() if k in s and isinstance(v, list)})
            except (OSError, ValueError):
                pass
            _store = s
        return json.loads(json.dumps(_store))


def _id(v):
    return v if isinstance(v, str) and re.fullmatch(r"[\w-]{1,40}", v) else uuid.uuid4().hex[:10]


def _clean_todos(v):
    out = []
    for t in v[:200]:
        if not isinstance(t, dict) or not isinstance(t.get("text"), str) or not t["text"].strip():
            continue
        out.append({"id": _id(t.get("id")), "text": t["text"].strip()[:300], "done": bool(t.get("done")),
                    "ts": t["ts"] if isinstance(t.get("ts"), (int, float)) else time.time()})
    return out


def _clean_reminders(v):
    out = []
    for r in v[:100]:
        if not isinstance(r, dict) or not isinstance(r.get("text"), str) or not isinstance(r.get("at"), (int, float)):
            continue
        out.append({"id": _id(r.get("id")), "text": r["text"].strip()[:200] or "Reminder", "at": float(r["at"]),
                    "fired": r["fired"] if isinstance(r.get("fired"), (int, float)) else None})
    out.sort(key=lambda r: r["at"])
    return out


def save_store(body):
    global _store
    store()
    with _lock:
        if isinstance(body.get("todos"), list):
            _store["todos"] = _clean_todos(body["todos"])
        if isinstance(body.get("reminders"), list):
            keep = {r["id"]: r for r in _store["reminders"]}
            new = _clean_reminders(body["reminders"])
            for r in new:  # the page can't un-fire a reminder by sending an old copy
                old = keep.get(r["id"])
                if old and old.get("fired") and r["at"] == old["at"]:
                    r["fired"] = old["fired"]
            # fired ones older than a day fall off
            _store["reminders"] = [r for r in new if not r["fired"] or r["fired"] > time.time() - 86400]
        _write()
        return json.loads(json.dumps(_store))


def _write():
    os.makedirs(os.path.dirname(STORE), exist_ok=True)
    tmp = STORE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(_store, f, ensure_ascii=False, indent=1)
    os.replace(tmp, STORE)


# ------------------------------------------------------------ reminders ---
def due(since):
    return [r for r in store()["reminders"] if r.get("fired") and r["fired"] > since]


def fire_due(now=None):
    """Mark every reminder whose time has come; returns the ones that just went off."""
    now = now or time.time()
    store()
    gone = []
    with _lock:
        for r in _store["reminders"]:
            if not r.get("fired") and r["at"] <= now:
                r["fired"] = now
                gone.append(dict(r))
        if gone:
            _write()
    return gone


def _reminder_loop():
    while True:
        time.sleep(5)
        try:
            for r in fire_due():
                _balloon("Reminder", r["text"])
        except Exception:
            pass


def _balloon(title, msg):
    try:
        import tray
        t = tray._app.get("tray")
        if t and getattr(t, "hwnd", None):
            t.balloon(title, msg)
    except Exception:
        pass


# ----------------------------------------------------------------- apps ---
_apps = {"t": 0, "list": []}


def _menu_dirs():
    return [os.path.join(os.environ.get("APPDATA", ""), r"Microsoft\Windows\Start Menu\Programs"),
            os.path.join(os.environ.get("PROGRAMDATA", r"C:\ProgramData"), r"Microsoft\Windows\Start Menu\Programs")]


SKIP = re.compile(r"uninstall|readme|release notes|help|documentation|website|license|manual|changelog|\bfaq\b", re.I)


def apps():
    if time.time() - _apps["t"] < 300 and _apps["list"]:
        return _apps["list"]
    seen, out = set(), []
    for root in _menu_dirs():
        for dp, _dn, files in os.walk(root):
            for f in files:
                if not f.lower().endswith((".lnk", ".url")):
                    continue
                name = f.rsplit(".", 1)[0]
                if SKIP.search(name) or name.lower() in seen:
                    continue
                seen.add(name.lower())
                folder = os.path.relpath(dp, root)
                out.append({"name": name, "path": os.path.join(dp, f), "folder": "" if folder == "." else folder})
    out.sort(key=lambda a: a["name"].lower())
    _apps.update(t=time.time(), list=out)
    return out


def launch(path):
    if not isinstance(path, str) or path.lower() not in {a["path"].lower() for a in apps()}:
        return 404, {"ok": False, "msg": "That app isn't in the Start menu."}
    os.startfile(path)
    return 200, {"ok": True, "msg": "opened"}


def open_web(url):
    if not isinstance(url, str) or not re.match(r"^https?://[^\s]+$", url) or len(url) > 2000:
        return 400, {"ok": False, "msg": "Only web links."}
    webbrowser.open(url)
    return 200, {"ok": True}


# ----------------------------------------------------------- screenshot ---
def shot_dir():
    pics = os.path.join(HOME, "Pictures")
    try:  # the real Pictures folder (can be moved to OneDrive / D:)
        buf = ctypes.create_unicode_buffer(260)
        if ctypes.windll.shell32.SHGetFolderPathW(None, 0x27, None, 0, buf) == 0 and buf.value:
            pics = buf.value
    except Exception:
        pass
    return os.path.join(pics, "Screenshots")


def shot(delay=0):
    try:
        delay = max(0.0, min(10.0, float(delay or 0)))
    except (TypeError, ValueError):
        delay = 0.0
    try:
        from PIL import ImageGrab
    except ImportError:
        return 500, {"ok": False, "msg": "Screenshots need Pillow (pip install pillow)."}
    time.sleep(delay)
    img = ImageGrab.grab(all_screens=True)
    d = shot_dir()
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, time.strftime("QT %Y-%m-%d %H%M%S") + ".png")
    n = 2
    while os.path.exists(path):
        path = path[:-4].rstrip(" 0123456789()") + f" ({n}).png"
        n += 1
    img.save(path, optimize=False)
    return 200, {"ok": True, "path": path, "w": img.width, "h": img.height, "size": os.path.getsize(path)}


# -------------------------------------------------------------- network ---
class MIB_IFROW(ctypes.Structure):
    _fields_ = [("wszName", wintypes.WCHAR * 256), ("dwIndex", wintypes.DWORD), ("dwType", wintypes.DWORD),
                ("dwMtu", wintypes.DWORD), ("dwSpeed", wintypes.DWORD), ("dwPhysAddrLen", wintypes.DWORD),
                ("bPhysAddr", ctypes.c_ubyte * 8), ("dwAdminStatus", wintypes.DWORD), ("dwOperStatus", wintypes.DWORD),
                ("dwLastChange", wintypes.DWORD), ("dwInOctets", wintypes.DWORD), ("dwInUcastPkts", wintypes.DWORD),
                ("dwInNUcastPkts", wintypes.DWORD), ("dwInDiscards", wintypes.DWORD), ("dwInErrors", wintypes.DWORD),
                ("dwInUnknownProtos", wintypes.DWORD), ("dwOutOctets", wintypes.DWORD), ("dwOutUcastPkts", wintypes.DWORD),
                ("dwOutNUcastPkts", wintypes.DWORD), ("dwOutDiscards", wintypes.DWORD), ("dwOutErrors", wintypes.DWORD),
                ("dwOutQLen", wintypes.DWORD), ("dwDescrLen", wintypes.DWORD), ("bDescr", ctypes.c_ubyte * 256)]


def _if_counters():
    """{index: (in, out)} 32-bit octet counters for every adapter that is up (loopback skipped)."""
    size = wintypes.ULONG(0)
    ip = ctypes.windll.iphlpapi
    ip.GetIfTable(None, ctypes.byref(size), False)
    buf = ctypes.create_string_buffer(size.value)
    if ip.GetIfTable(buf, ctypes.byref(size), False) != 0:
        return {}
    n = ctypes.c_ulong.from_buffer(buf).value
    rows = (MIB_IFROW * n).from_buffer(buf, 4)
    out = {}
    for r in rows:
        if r.dwType == 24 or r.dwOperStatus not in (1, 5):  # loopback / not connected
            continue
        out[(r.dwIndex, bytes(r.bDescr[:r.dwDescrLen]))] = (r.dwInOctets, r.dwOutOctets)
    return out


_net = {"prev": None, "t": 0, "down": 0, "up": 0, "last_ask": 0, "hist": []}


def net():
    _net["last_ask"] = time.time()
    if not _net.get("thread"):
        _net["thread"] = threading.Thread(target=_net_loop, name="qt-net", daemon=True)
        _net["thread"].start()
        time.sleep(1.1)
    return {"down": _net["down"], "up": _net["up"], "hist": _net["hist"][-40:]}


def _net_loop():
    while True:
        try:
            now, cur = time.time(), _if_counters()
            prev, pt = _net["prev"], _net["t"]
            if prev is not None and now > pt:
                din = dout = 0
                for k, (i, o) in cur.items():
                    if k in prev:
                        din += (i - prev[k][0]) % (1 << 32)
                        dout += (o - prev[k][1]) % (1 << 32)
                _net["down"], _net["up"] = int(din / (now - pt)), int(dout / (now - pt))
                _net["hist"] = (_net["hist"] + [[_net["down"], _net["up"]]])[-60:]
            _net["prev"], _net["t"] = cur, now
        except Exception:
            pass
        time.sleep(1 if time.time() - _net["last_ask"] < 30 else 5)


# -------------------------------------------------------- top processes ---
PROTECTED = {"system", "system idle process", "registry", "smss.exe", "csrss.exe", "wininit.exe", "winlogon.exe", "services.exe",
             "lsass.exe", "svchost.exe", "fontdrvhost.exe", "dwm.exe", "memory compression", "secure system", "explorer.exe",
             "sihost.exe", "ctfmon.exe", "msmpeng.exe", "audiodg.exe", "spoolsv.exe", "searchindexer.exe", "lsaiso.exe"}


def _tasklist():
    r = subprocess.run(["tasklist", "/fo", "csv", "/nh"], capture_output=True, text=True, creationflags=NOWIN, timeout=15)
    out = []
    for row in csv.reader(io.StringIO(r.stdout)):
        if len(row) < 5:
            continue
        try:
            mem = int(re.sub(r"[^\d]", "", row[4]) or 0) * 1024
            out.append({"name": row[0], "pid": int(row[1]), "mem": mem})
        except ValueError:
            continue
    return out


def top(n=10):
    by = {}
    for p in _tasklist():  # group by program: 30 msedge.exe rows read as one line
        g = by.setdefault(p["name"].lower(), {"name": p["name"], "pids": [], "mem": 0})
        g["pids"].append(p["pid"])
        g["mem"] += p["mem"]
    rows = sorted(by.values(), key=lambda g: -g["mem"])[:n]
    for g in rows:
        g["count"] = len(g["pids"])
        g["safe"] = g["name"].lower() not in PROTECTED and os.getpid() not in g["pids"]
    return rows


def kill(name, pids):
    if not isinstance(name, str) or name.lower() in PROTECTED:
        return 403, {"ok": False, "msg": "Windows needs that one."}
    live = {p["pid"] for p in _tasklist() if p["name"].lower() == name.lower()}
    want = [p for p in (pids or []) if isinstance(p, int) and p in live and p != os.getpid()]
    if not want:
        return 404, {"ok": False, "msg": "It already closed."}
    args = ["taskkill", "/f"] + sum((["/pid", str(p)] for p in want), [])
    r = subprocess.run(args, capture_output=True, text=True, creationflags=NOWIN, timeout=20)
    left = {p["pid"] for p in _tasklist()} & set(want)
    if left:
        return 500, {"ok": False, "msg": (r.stderr or r.stdout or "It wouldn't close.").strip()[:200]}
    return 200, {"ok": True, "msg": f"Closed {name}", "n": len(want)}


# ------------------------------------------------------------ clipboard ---
_clips = {"list": [], "paused": False, "seq": 0}
CF_UNICODETEXT = 13


def _clip_text():
    u, k = ctypes.windll.user32, ctypes.windll.kernel32
    u.GetClipboardData.restype = ctypes.c_void_p
    k.GlobalLock.restype = ctypes.c_void_p
    k.GlobalLock.argtypes = [ctypes.c_void_p]
    k.GlobalUnlock.argtypes = [ctypes.c_void_p]
    u.RegisterClipboardFormatW.restype = ctypes.c_uint
    # password managers mark their copies as private: leave those alone
    private = [u.RegisterClipboardFormatW(n) for n in ("ExcludeClipboardContentFromMonitorProcessing", "Clipboard Viewer Ignore")]
    hist = u.RegisterClipboardFormatW("CanIncludeInClipboardHistory")
    for _ in range(3):
        if u.OpenClipboard(None):
            break
        time.sleep(0.05)
    else:
        return None
    try:
        if any(u.IsClipboardFormatAvailable(f) for f in private):
            return None
        if u.IsClipboardFormatAvailable(hist):
            h = u.GetClipboardData(hist)
            p = k.GlobalLock(h) if h else None
            if p:
                ok = ctypes.c_uint32.from_address(p).value
                k.GlobalUnlock(h)
                if ok == 0:
                    return None
        if not u.IsClipboardFormatAvailable(CF_UNICODETEXT):
            return None
        h = u.GetClipboardData(CF_UNICODETEXT)
        if not h:
            return None
        p = k.GlobalLock(h)
        try:
            return ctypes.wstring_at(p) if p else None
        finally:
            k.GlobalUnlock(h)
    finally:
        u.CloseClipboard()


def add_clip(text):
    if not isinstance(text, str) or not text.strip() or len(text) > 20000:
        return
    lst = [c for c in _clips["list"] if c["text"] != text]
    lst.insert(0, {"text": text, "ts": time.time()})
    _clips["list"] = lst[:25]


def _clip_loop():
    u = ctypes.windll.user32
    while True:
        time.sleep(1)
        try:
            seq = u.GetClipboardSequenceNumber()
            if seq == _clips["seq"]:
                continue
            _clips["seq"] = seq
            if _clips["paused"]:
                continue
            t = _clip_text()
            if t:
                add_clip(t)
        except Exception:
            pass


def clips():
    return {"paused": _clips["paused"], "items": _clips["list"]}


# ----------------------------------------------------------------- routes ---
def route_get(p, q):
    if p == "/api/nova/apps":
        return 200, {"apps": [{"name": a["name"], "path": a["path"], "folder": a["folder"]} for a in apps()]}
    if p == "/api/nova/store":
        return 200, store()
    if p == "/api/nova/due":
        try:
            since = float((q.get("since") or ["0"])[0])
        except ValueError:
            since = 0
        return 200, {"items": due(since), "now": time.time()}
    if p == "/api/nova/net":
        return 200, net()
    if p == "/api/nova/top":
        return 200, {"items": top()}
    if p == "/api/nova/clips":
        return 200, clips()
    return None


def route_post(p, body):
    if p == "/api/nova/launch":
        return launch(body.get("path"))
    if p == "/api/nova/web":
        return open_web(body.get("url"))
    if p == "/api/nova/store":
        return 200, save_store(body)
    if p == "/api/nova/shot":
        return shot(body.get("delay"))
    if p == "/api/nova/kill":
        return kill(body.get("name"), body.get("pids"))
    if p == "/api/nova/clips":
        if "paused" in body:
            _clips["paused"] = bool(body["paused"])
        if body.get("clear"):
            _clips["list"] = []
        if isinstance(body.get("forget"), (int, float)):
            _clips["list"] = [c for c in _clips["list"] if c["ts"] != body["forget"]]
        return 200, clips()
    return None
