"""QT Suite spark layer (loop 4): the server half of static/spark.js.

GET  /api/spark/store             notes + pins (one JSON file next to settings.json)
POST /api/spark/store             {notes?, pins?} validated and saved
GET  /api/spark/sys               CPU %, memory, uptime, last 60 CPU samples (sampled every second)
POST /api/spark/phone-note        {text} -> Beam note on the phone
POST /api/spark/grab              {url, mode} -> VOLT download started from the suite
GET  /api/spark/grabs             the suite's VOLT grabs with progress
POST /api/spark/extract           {path} unzip next to the archive into a new folder (never overwrites)
GET  /api/spark/downloads         newest files in Downloads
GET  /api/spark/exif?path=        camera facts for a photo (Pillow)
GET  /api/spark/stat?path=        does it exist, is it a folder (pins)
"""
import ctypes
import http.client
import json
import os
import re
import threading
import time
import uuid
import zipfile
from collections import deque
from ctypes import wintypes

import shell

STORE = os.path.join(shell.DATA, "spark.json")
_lock = threading.Lock()
_store = None
_start = None      # app.start
_by_id = None      # app.BY_ID
_port_up = None
HOME = os.path.expanduser("~")


def init(start, by_id, port_up):
    global _start, _by_id, _port_up
    _start, _by_id, _port_up = start, by_id, port_up
    threading.Thread(target=_sampler, daemon=True).start()


# ---------------------------------------------------------------- store ---
def store():
    global _store
    with _lock:
        if _store is None:
            s = {"notes": [], "pins": []}
            try:
                with open(STORE, encoding="utf-8") as f:
                    got = json.load(f)
                if isinstance(got, dict):
                    s.update({k: v for k, v in got.items() if k in s})
            except (OSError, ValueError):
                pass
            _store = s
        return json.loads(json.dumps(_store))


def _clean_notes(v):
    out = []
    for n in v[:60]:
        if not isinstance(n, dict):
            continue
        text = n.get("text") if isinstance(n.get("text"), str) else ""
        nid = n.get("id") if isinstance(n.get("id"), str) and re.fullmatch(r"[\w-]{1,40}", n.get("id")) else uuid.uuid4().hex[:10]
        ts = n.get("ts") if isinstance(n.get("ts"), (int, float)) else time.time()
        out.append({"id": nid, "text": text[:50000], "ts": ts, "pin": bool(n.get("pin"))})
    return out


def _clean_pins(v):
    out, seen = [], set()
    for p in v[:30]:
        path = p.get("path") if isinstance(p, dict) else p
        if not isinstance(path, str) or not re.match(r"^([a-zA-Z]:\\|\\\\)", path) or len(path) > 1000:
            continue
        if path.lower() in seen:
            continue
        seen.add(path.lower())
        name = p.get("name") if isinstance(p, dict) and isinstance(p.get("name"), str) else ""
        out.append({"path": path, "name": (name or os.path.basename(path.rstrip("\\")) or path)[:120]})
    return out


def save_store(patch):
    store()
    clean = {}
    if isinstance(patch.get("notes"), list):
        clean["notes"] = _clean_notes(patch["notes"])
    if isinstance(patch.get("pins"), list):
        clean["pins"] = _clean_pins(patch["pins"])
    with _lock:
        _store.update(clean)
        os.makedirs(shell.DATA, exist_ok=True)
        tmp = STORE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(_store, f, indent=1)
        os.replace(tmp, STORE)
        return json.loads(json.dumps(_store))


# ------------------------------------------------------------- CPU / RAM ---
class _FT(ctypes.Structure):
    _fields_ = [("lo", wintypes.DWORD), ("hi", wintypes.DWORD)]


class _MEM(ctypes.Structure):
    _fields_ = [("dwLength", wintypes.DWORD), ("dwMemoryLoad", wintypes.DWORD), ("ullTotalPhys", ctypes.c_ulonglong),
                ("ullAvailPhys", ctypes.c_ulonglong), ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong), ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]


CPU = deque(maxlen=60)
MEMH = deque(maxlen=60)


def _times():
    i, k, u = _FT(), _FT(), _FT()
    if not ctypes.windll.kernel32.GetSystemTimes(ctypes.byref(i), ctypes.byref(k), ctypes.byref(u)):
        return None
    f = lambda x: (x.hi << 32) | x.lo
    return f(i), f(k), f(u)   # kernel time includes idle


def mem():
    m = _MEM()
    m.dwLength = ctypes.sizeof(_MEM)
    ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m))
    return {"total": m.ullTotalPhys, "used": m.ullTotalPhys - m.ullAvailPhys, "pct": m.dwMemoryLoad}


def _sampler():
    try:
        prev = _times()
    except Exception:
        return
    while True:
        time.sleep(1)
        try:
            now = _times()
            if not now or not prev:
                continue
            idle, kern, user = (now[0] - prev[0], now[1] - prev[1], now[2] - prev[2])
            busy = kern + user
            CPU.append(round(max(0.0, min(100.0, (busy - idle) * 100.0 / busy)) if busy else 0.0, 1))
            MEMH.append(mem()["pct"])
            prev = now
        except Exception:
            pass


def sys_info():
    try:
        m = mem()
    except Exception:
        m = {}
    k32 = ctypes.windll.kernel32
    k32.GetTickCount64.restype = ctypes.c_ulonglong
    return {"cpu": CPU[-1] if CPU else None, "cpuh": list(CPU), "memh": list(MEMH), "mem": m,
            "up": round(k32.GetTickCount64() / 1000), "cores": os.cpu_count()}


# -------------------------------------------------------- local helpers ---
def _local(port, path, body=None, timeout=10, method=None):
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=timeout)
    try:
        data = json.dumps(body).encode() if body is not None else None
        h = {"Host": f"127.0.0.1:{port}"}
        if data is not None:
            h["Content-Type"] = "application/json"
        c.request(method or ("POST" if data is not None else "GET"), path, body=data, headers=h)
        r = c.getresponse()
        raw = r.read()
        try:
            j = json.loads(raw or b"null")
        except ValueError:
            j = None
        if r.status >= 400:
            raise RuntimeError((j or {}).get("error") if isinstance(j, dict) else f"HTTP {r.status}")
        return j
    finally:
        c.close()


def _ensure(tid):
    t = _by_id[tid]
    if _port_up(t["port"]):
        return True, ""
    ok, msg = _start(t)
    if ok and t.get("fallback") and msg != "started":
        for _ in range(60):   # first-run VOLT setup takes a while
            if _port_up(t["port"]):
                return True, ""
            time.sleep(0.5)
    return ok, msg


def phone_note(text):
    text = str(text or "").strip()
    if not text:
        return 400, {"ok": False, "msg": "Nothing to send."}
    ok, msg = _ensure("beam")
    if not ok:
        return 502, {"ok": False, "msg": "Beam didn't start: " + msg}
    try:
        _local(7788, "/api/note", {"text": text[:20000]})
    except Exception as e:
        return 502, {"ok": False, "msg": "Beam said: " + str(e)[:120]}
    return 200, {"ok": True, "msg": "Sent to your phone"}


# ------------------------------------------------------------ VOLT grabs ---
GRABS = {}
URL_RE = re.compile(r"^https?://[^\s/$.?#].[^\s]*$", re.I)


def grab(url, mode):
    url = str(url or "").strip()
    if not URL_RE.match(url) or len(url) > 4000:
        return 400, {"ok": False, "msg": "That doesn't look like a link."}
    mode = mode if mode in ("video", "audio") else "video"
    g = {"id": uuid.uuid4().hex[:8], "url": url, "mode": mode, "state": "starting", "pct": 0, "title": None,
         "path": None, "error": None, "ts": time.time()}
    GRABS[g["id"]] = g
    for old in sorted(GRABS.values(), key=lambda x: x["ts"])[:-12]:
        GRABS.pop(old["id"], None)

    def run():
        try:
            ok, msg = _ensure("volt")
            if not ok:
                raise RuntimeError("VOLT didn't start: " + msg)
            g["state"] = "reading"
            info = _local(7777, "/api/info", {"url": url}, timeout=120) or {}
            kind = info.get("kind")
            m = "mp3" if mode == "audio" or kind == "audio" else "mp4"
            if kind in ("file", "gallery"):
                m = "original"
            g.update(title=info.get("title"), thumb=info.get("thumb"), state="queued", kind=kind)
            job = _local(7777, "/api/download", {
                "url": info.get("url") or url, "engine": info.get("engine"), "title": info.get("title"), "thumb": info.get("thumb"),
                "count": info.get("count"), "site": info.get("site"), "mode": m, "playlist": kind == "playlist",
                "source": "Suite", "kind": kind})
            g["job"] = job["id"]
            while True:
                time.sleep(0.8)
                j = next((j for j in (_local(7777, "/api/jobs") or []) if j.get("id") == g["job"]), None)
                if not j:
                    raise RuntimeError("The download vanished from VOLT.")
                g.update(state=j["state"], pct=j.get("pct") or 0, speed=j.get("speed"), eta=j.get("eta"))
                if j["state"] == "done":
                    g["path"] = j.get("path")
                    return
                if j["state"] in ("error", "cancelled"):
                    g["error"] = j.get("error") or j["state"]
                    return
        except Exception as e:
            g.update(state="error", error=str(e)[:200])
    threading.Thread(target=run, daemon=True).start()
    return 200, {"ok": True, "id": g["id"]}


# --------------------------------------------------------------- extract ---
def _free_name(path):
    if not os.path.exists(path):
        return path
    n = 2
    while os.path.exists(f"{path} ({n})"):
        n += 1
    return f"{path} ({n})"


def extract(path, limit_bytes=4 << 30, limit_files=50000):
    path = os.path.normpath(str(path or ""))
    if not os.path.isfile(path) or not zipfile.is_zipfile(path):
        return 400, {"ok": False, "msg": "That isn't a zip I can open."}
    base = os.path.splitext(path)[0]
    dest = _free_name(base)
    try:
        with zipfile.ZipFile(path) as z:
            infos = z.infolist()
            if len(infos) > limit_files or sum(i.file_size for i in infos) > limit_bytes:
                return 400, {"ok": False, "msg": "That one is too big to unpack here. Use Burrow."}
            os.makedirs(dest)
            root = os.path.realpath(dest)
            n = 0
            for i in infos:
                name = i.filename.replace("/", os.sep).lstrip("\\/")
                out = os.path.realpath(os.path.join(dest, name))
                if not out.startswith(root + os.sep) and out != root:
                    continue   # zip-slip: skip anything that points outside the new folder
                if i.is_dir():
                    os.makedirs(out, exist_ok=True)
                    continue
                os.makedirs(os.path.dirname(out), exist_ok=True)
                with z.open(i) as src, open(out, "xb") as dst:
                    while True:
                        b = src.read(1 << 20)
                        if not b:
                            break
                        dst.write(b)
                n += 1
    except (OSError, zipfile.BadZipFile, RuntimeError) as e:
        return 500, {"ok": False, "msg": "Unpacking stopped: " + str(e)[:160], "dir": dest if os.path.isdir(dest) else None}
    return 200, {"ok": True, "dir": dest, "files": n, "msg": f"Unpacked {n} file{'s' if n != 1 else ''}"}


# ------------------------------------------------------------- downloads ---
SKIP_DL = (".crdownload", ".part", ".tmp", ".partial", ".download", ".ini")


def downloads(n=8):
    d = os.path.join(HOME, "Downloads")
    out = []
    try:
        with os.scandir(d) as it:
            for e in it:
                if e.name.startswith((".", "~$")) or e.name.lower().endswith(SKIP_DL):
                    continue
                try:
                    st = e.stat()
                except OSError:
                    continue
                out.append({"name": e.name, "path": e.path, "isdir": e.is_dir(), "s": None if e.is_dir() else st.st_size, "m": st.st_mtime})
    except OSError:
        return {"dir": d, "files": [], "missing": True}
    out.sort(key=lambda x: -x["m"])
    return {"dir": d, "files": out[:n]}


# ------------------------------------------------------------------ exif ---
TAGS = {271: "make", 272: "model", 306: "taken", 36867: "taken", 33434: "exposure", 33437: "f", 34855: "iso", 37386: "focal",
        42036: "lens", 305: "software", 37385: "flash"}


def exif(path):
    path = os.path.normpath(str(path or ""))
    if not os.path.isfile(path):
        return 404, {"error": "not found"}
    out = {}
    try:
        from PIL import Image
        with Image.open(path) as im:
            out["w"], out["h"] = im.size
            out["mode"] = im.mode
            out["format"] = im.format
            ex = im.getexif()
            data = dict(ex)
            try:
                data.update(ex.get_ifd(0x8769))
            except Exception:
                pass
            for k, name in TAGS.items():
                v = data.get(k)
                if v is None or name in out:
                    continue
                if isinstance(v, bytes):
                    continue
                try:
                    if name == "exposure":
                        v = float(v)
                        v = f"1/{round(1 / v)} s" if 0 < v < 1 else f"{v:g} s"
                    elif name == "f":
                        v = f"f/{float(v):.1f}".replace(".0", "")
                    elif name == "focal":
                        v = f"{float(v):g} mm"
                    elif name == "flash":
                        v = "fired" if int(v) & 1 else "off"
                    else:
                        v = str(v).strip("\x00 ")
                except (TypeError, ValueError, ZeroDivisionError):
                    v = str(v)
                if v:
                    out[name] = v
    except Exception as e:
        out["err"] = str(e)[:120]
    return 200, out


# ---------------------------------------------------------------- routes ---
def route_get(p, q):
    if p == "/api/spark/store":
        return 200, store()
    if p == "/api/spark/sys":
        return 200, sys_info()
    if p == "/api/spark/grabs":
        return 200, {"grabs": sorted(GRABS.values(), key=lambda x: -x["ts"])}
    if p == "/api/spark/downloads":
        return 200, downloads()
    if p == "/api/spark/exif":
        return exif(q.get("path", [""])[0])
    if p == "/api/spark/stat":
        out = []
        for path in q.get("path", [])[:40]:
            out.append({"path": path, "ok": os.path.exists(path), "isdir": os.path.isdir(path)})
        return 200, {"items": out}
    return None


def route_post(p, body):
    if p == "/api/spark/store":
        return 200, save_store(body)
    if p == "/api/spark/phone-note":
        return phone_note(body.get("text"))
    if p == "/api/spark/grab":
        return grab(body.get("url"), body.get("mode"))
    if p == "/api/spark/extract":
        return extract(body.get("path"))
    return None
