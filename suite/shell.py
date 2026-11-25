"""QT Suite shell layer: settings, tool order, start-with-hub set, the home "glance"
strip, file search through Burrow, and an activity log that spots tools that crash.

Kept apart from app.py (like plus.py) so other work on the hub doesn't collide.
app.py calls: arrange(), route_get(), route_post(), expect(), boot().
"""
import http.client
import json
import os
import sys
import threading
import time
import urllib.parse
from collections import deque

HERE = os.path.dirname(os.path.abspath(__file__))
QT = os.path.dirname(HERE)
DATA = os.environ.get("QT_SUITE_DATA") or os.path.join(os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), "QT Suite")
SETTINGS = os.path.join(DATA, "settings.json")
DEFAULTS = {
    "order": [],          # tool ids, first = Ctrl+1; unknown/new tools go after these
    "hidden": [],         # tool ids kept off the rail and home (still in Settings)
    "boot": [],           # web tools the hub starts when it starts
    "motion": "system",   # system | full | calm
    "rail": "full",       # full | compact
    "launch": "home",     # home | last  (what the hub opens on)
    "last": "",           # last tool opened (for launch = last)
    "glance": True,       # show the Today strip on home
    "split": None,        # {"a": id, "b": id, "ratio": 0.5} or None
    "peek": True,         # open files inside the suite (viewer.py) instead of their Windows app
    "group": True,        # rail: fold the file apps (Pictures, Player, ...) into one "Files" button
    "revive": False,      # bring a tool back up when it stops on its own (crash), at most twice in 10 min
}
_lock = threading.Lock()
_settings = None
TOOLS = []          # filled by init()
_start = None       # app.start
_port_up = None


def init(tools, start, port_up):
    global TOOLS, _start, _port_up
    TOOLS, _start, _port_up = tools, start, port_up
    threading.Thread(target=_watch, daemon=True).start()


# ------------------------------------------------------------------ settings ---
def settings():
    global _settings
    with _lock:
        if _settings is None:
            s = dict(DEFAULTS)
            try:
                with open(SETTINGS, encoding="utf-8") as f:
                    got = json.load(f)
                if isinstance(got, dict):
                    s.update({k: v for k, v in got.items() if k in DEFAULTS})
            except (OSError, ValueError):
                pass
            _settings = s
        return dict(_settings)


def save(patch):
    """Merge a validated patch into the settings file. Returns the new settings."""
    ids = {t["id"] for t in TOOLS}
    web = {t["id"] for t in TOOLS if t["kind"] == "web"}
    clean = {}
    for k, v in (patch or {}).items():
        if k in ("order", "hidden", "boot") and isinstance(v, list):
            ok = web if k == "boot" else ids
            seen = []
            for x in v:
                if isinstance(x, str) and x in ok and x not in seen:
                    seen.append(x)
            clean[k] = seen
        elif k == "motion" and v in ("system", "full", "calm"):
            clean[k] = v
        elif k == "rail" and v in ("full", "compact"):
            clean[k] = v
        elif k == "launch" and v in ("home", "last"):
            clean[k] = v
        elif k == "last" and (v in ids or v == "home"):
            clean[k] = v
        elif k in ("glance", "peek", "group", "revive") and isinstance(v, bool):
            clean[k] = v
        elif k == "split":
            if v is None:
                clean[k] = None
            elif isinstance(v, dict) and v.get("a") in ids and v.get("b") in ids and v["a"] != v["b"]:
                r = v.get("ratio", 0.5)
                r = min(0.8, max(0.2, float(r))) if isinstance(r, (int, float)) else 0.5
                clean[k] = {"a": v["a"], "b": v["b"], "ratio": round(r, 3)}
    settings()
    with _lock:
        _settings.update(clean)
        os.makedirs(DATA, exist_ok=True)
        tmp = SETTINGS + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(_settings, f, indent=1)
        os.replace(tmp, SETTINGS)
        return dict(_settings)


def arrange(rows, show_all=False):
    """Put /api/tools rows in the person's order and drop hidden ones (unless show_all)."""
    s = settings()
    rank = {tid: i for i, tid in enumerate(s["order"])}
    base = {t["id"]: i for i, t in enumerate(rows)}
    rows = sorted(rows, key=lambda r: (rank.get(r["id"], 1000 + base[r["id"]])))
    hidden = set(s["hidden"])
    for r in rows:
        r["hidden"] = r["id"] in hidden
        r["boot"] = r["id"] in s["boot"]
    return rows if show_all else [r for r in rows if not r["hidden"]]


# ------------------------------------------------------- start with the hub ---
def boot():
    """Called once when the hub starts: bring up the person's start-with-hub tools."""
    def run():
        time.sleep(1.0)
        done = set()
        for tid in settings()["boot"]:
            t = next((x for x in TOOLS if x["id"] == tid), None)
            if not t or t["kind"] != "web" or t["port"] in done:
                continue
            done.add(t["port"])
            expect(t["id"], "start")
            try:
                _start(t)
            except Exception as e:  # one broken tool must not stop the rest
                log(t["id"], "fail", str(e)[:120])
    threading.Thread(target=run, daemon=True).start()


def start_many(ids):
    out, done = {}, set()
    for tid in ids:
        t = next((x for x in TOOLS if x["id"] == tid), None)
        if not t or t["kind"] != "web":
            continue
        if t["port"] in done:
            out[tid] = {"ok": True, "msg": "shares a server"}
            continue
        done.add(t["port"])
        expect(tid, "start")
        try:
            ok, msg = _start(t)
        except Exception as e:
            ok, msg = False, str(e)
        out[tid] = {"ok": ok, "msg": msg}
    return out


# --------------------------------------------------------------- activity ---
EVENTS = deque(maxlen=200)
_seq = [0]
_expect = {}    # port -> (until, what)
_state = {}     # port -> bool
_watch_every = 4


def log(tid, kind, msg=""):
    t = next((x for x in TOOLS if x["id"] == tid), {"name": tid})
    with _lock:
        _seq[0] += 1
        EVENTS.append({"id": _seq[0], "t": time.time(), "tool": tid, "name": t.get("name", tid), "kind": kind, "msg": msg})


def expect(tid, what):
    """The hub was asked to start/stop/restart this tool: its next change isn't a crash."""
    t = next((x for x in TOOLS if x["id"] == tid), None)
    if t and t.get("port"):
        _expect[t["port"]] = (time.time() + 25, what)


def _owners(port):
    return [t for t in TOOLS if t["kind"] == "web" and t["port"] == port]


def _watch():
    first = True
    while True:
        ports = sorted({t["port"] for t in TOOLS if t["kind"] == "web"})
        for port in ports:
            try:
                up = bool(_port_up(port))
            except Exception:
                continue
            was = _state.get(port)
            _state[port] = up
            if first or was is None or was == up:
                continue
            exp = _expect.get(port)
            planned = exp and exp[0] > time.time()
            lead = _owners(port)[0]
            if up:
                log(lead["id"], "up", "started from the suite" if planned else "started")
            else:
                log(lead["id"], "stop" if planned else "crash", "stopped from the suite" if planned else "stopped on its own")
                if not planned:
                    _maybe_revive(lead)
            if planned and (up or exp[1] == "stop"):
                _expect.pop(port, None)
        first = False
        time.sleep(_watch_every)


_revived = {}   # port -> [times it was brought back]
REVIVE_MAX, REVIVE_WINDOW = 2, 600


def _maybe_revive(t):
    """Settings "Bring crashed tools back": start a tool that stopped on its own, at most twice in 10 minutes."""
    if not settings().get("revive"):
        return
    now = time.time()
    hist = [x for x in _revived.get(t["port"], []) if now - x < REVIVE_WINDOW]
    if len(hist) >= REVIVE_MAX:
        log(t["id"], "fail", "kept stopping, so it stays off for now")
        _revived[t["port"]] = hist
        return
    hist.append(now)
    _revived[t["port"]] = hist

    def run():
        time.sleep(2)
        if _port_up(t["port"]):   # someone already started it
            return
        expect(t["id"], "start")
        try:
            ok, msg = _start(t)
        except Exception as e:
            ok, msg = False, str(e)
        log(t["id"], "revive" if ok else "fail", "brought back" if ok else ("couldn't bring it back: " + str(msg))[:120])
    threading.Thread(target=run, daemon=True).start()


# ------------------------------------------------------------------ glance ---
_glance = {"at": 0, "data": None}


def _local_json(port, path, timeout=2.5):
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=timeout)
    try:
        c.request("GET", path, headers={"Host": f"127.0.0.1:{port}"})
        r = c.getresponse()
        if r.status != 200:
            return None
        return json.loads(r.read() or b"null")
    finally:
        c.close()


def glance():
    """Small numbers for the home strip: today's spend, free disk, downloads, unread phone alerts."""
    if _glance["data"] and time.time() - _glance["at"] < 25:
        return _glance["data"]
    out = {"at": time.time()}
    try:
        if os.path.join(QT, "daily") not in sys.path:
            sys.path.insert(0, os.path.join(QT, "daily"))
        import sources  # Daily's readers: stdlib only, work even when Daily isn't running
        d = {}
        ts = [threading.Thread(target=lambda k=k: d.__setitem__(k, getattr(sources, k)()), daemon=True) for k in ("money", "disk", "downloads")]
        for t in ts:
            t.start()
        for t in ts:
            t.join(6)
        m = d.get("money") or {}
        if m.get("ok"):
            out["money"] = {"cur": m.get("cur", ""), "today": m.get("today", 0), "left": m.get("left"),
                            "spent": (m.get("month") or {}).get("spent"), "stale": bool(m.get("stale"))}
        k = d.get("disk") or {}
        if k.get("ok"):
            out["disk"] = [{"letter": x["letter"], "free": x["free"], "size": x["size"], "type": x.get("type", "")} for x in k.get("drives", [])]
        w = d.get("downloads") or {}
        if w.get("ok"):
            out["downloads"] = {"active": len(w.get("active") or []), "today": w.get("today", 0) + w.get("phone_today", 0)}
    except Exception as e:
        out["err"] = str(e)[:200]
    try:
        if _port_up(7788):
            n = _local_json(7788, "/api/notify?v=0") or {}
            notes = n.get("notes") or []
            out["phone"] = {"unread": sum(1 for x in notes if not x.get("seen") and not x.get("gone")), "total": len(notes),
                            "linked": bool((n.get("phone") or {}).get("device"))}
    except Exception:
        pass
    _glance.update(at=time.time(), data=out)
    return out


# ------------------------------------------------------- files via Burrow ---
BURROW = 7795


def find(q, limit=8, budget=2.2):
    """First few file/folder matches for q under the home folder, streamed from Burrow's search."""
    q = (q or "").strip()
    if len(q) < 2:
        return {"files": []}
    if not _port_up(BURROW):
        return {"files": [], "off": True}
    root = os.path.expanduser("~")
    c = http.client.HTTPConnection("127.0.0.1", BURROW, timeout=budget + 0.5)
    files, t0 = [], time.time()
    try:
        c.request("GET", "/api/search?" + urllib.parse.urlencode({"root": root, "q": q}), headers={"Host": f"127.0.0.1:{BURROW}"})
        r = c.getresponse()
        if r.status != 200:
            return {"files": [], "err": f"Burrow said {r.status}"}
        while len(files) < limit and time.time() - t0 < budget:
            line = r.readline()
            if not line:
                break
            try:
                e = json.loads(line)
            except ValueError:
                continue
            if "n" in e:
                files.append({"name": e["n"], "dir": e.get("p", ""), "path": os.path.join(e.get("p", ""), e["n"]), "isdir": bool(e.get("d")),
                              "size": e.get("s", 0), "m": e.get("m", 0)})
            elif e.get("_done"):
                break
    except OSError as e:
        return {"files": files, "err": str(e)[:120]}
    finally:
        c.close()  # closing the stream tells Burrow to stop searching
    return {"files": files}


def burrow_open(path, how):
    if how not in ("default", "reveal"):
        how = "default"
    c = http.client.HTTPConnection("127.0.0.1", BURROW, timeout=6)
    try:
        body = json.dumps({"path": path, "how": how})
        c.request("POST", "/api/open", body, headers={"Host": f"127.0.0.1:{BURROW}", "Content-Type": "application/json"})
        r = c.getresponse()
        j = json.loads(r.read() or b"{}")
        return r.status == 200, j.get("error", "opened")
    finally:
        c.close()


# ------------------------------------------------------------------ routes ---
def route_get(p, query):
    """(code, body) for shell GET routes, or None."""
    if p == "/api/settings":
        return 200, {"settings": settings(), "tools": [{"id": t["id"], "name": t["name"], "tag": t["tag"], "kind": t["kind"],
                                                       "port": t.get("port")} for t in TOOLS], "data": SETTINGS}
    if p == "/api/glance":
        return 200, glance()
    if p == "/api/find":
        try:
            n = max(1, min(40, int(query.get("n", ["8"])[0])))
        except ValueError:
            n = 8
        return 200, find(query.get("q", [""])[0], limit=n, budget=2.2 if n <= 8 else 3.5)
    if p == "/api/activity":
        try:
            since = int(query.get("since", ["0"])[0])
        except ValueError:
            since = 0
        with _lock:
            ev = [e for e in EVENTS if e["id"] > since]
        return 200, {"events": ev, "last": _seq[0]}
    return None


def route_post(p, body):
    if p == "/api/settings":
        return 200, {"settings": save(body)}
    if p == "/api/startall":
        ids = body.get("ids") if isinstance(body.get("ids"), list) else settings()["boot"]
        return 200, {"results": start_many(ids)}
    if p == "/api/open-file":
        path = body.get("path")
        if not isinstance(path, str) or not os.path.exists(path):
            return 404, {"ok": False, "msg": "That isn't there any more."}
        if not _port_up(BURROW):
            return 503, {"ok": False, "msg": "Burrow isn't running."}
        ok, msg = burrow_open(path, body.get("how", "default"))
        return (200 if ok else 500), {"ok": ok, "msg": msg}
    return None
