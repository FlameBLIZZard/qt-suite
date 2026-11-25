"""QT Suite guide layer: first-run welcome, the guided tour, Help, the setup checklist and the setup doctor.

The server half of static/guide.js. Kept apart from app.py like the other layers.

GET  /api/guide/state      {fresh, onboarded, tour, tasks, tips, version, data, install, user}
POST /api/guide/state      {onboarded?, tour?, tasks?, tips?, reset?} saved in guide.json next to settings.json
GET  /api/guide/doctor     checks: each tool's port, Python, Edge, VOLT engine, ffmpeg, disk, data folder
GET  /api/guide/changelog  CHANGELOG.md from the install folder (Help shows it)
GET  /api/guide/diag       a plain-text report for bug reports with names and paths taken out
POST /api/guide/folder     {which: data|install} show that folder in Explorer
"""
import json
import os
import platform
import shutil
import socket
import subprocess
import sys
import threading
import time

import shell

HERE = os.path.dirname(os.path.abspath(__file__))
QT = os.path.dirname(HERE)
STORE = os.path.join(shell.DATA, "guide.json")
NOWIN = 0x08000000
_lock = threading.Lock()
_state = None
_app = {}          # filled by init(): tools, status, volt_py
TASKS = ("pick", "palette", "tool", "file", "settings", "help")   # the Home checklist, in order
EDGE = (r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe")


def version():
    for p in (os.path.join(QT, "VERSION"), os.path.join(HERE, "VERSION")):
        try:
            with open(p, encoding="utf-8") as f:
                return f.read().strip() or "dev"
        except OSError:
            pass
    return "dev"


def init(tools, status, volt_py):
    """Called once at hub start, before anything else writes to the data folder."""
    _app.update(tools=tools, status=status, volt_py=volt_py)
    state()


def _fresh():
    """No guide.json and none of the other layers' files: someone who has never opened the suite."""
    names = ("settings.json", "spark.json", "nova.json", "tray.json")
    return not any(os.path.exists(os.path.join(shell.DATA, n)) for n in names)


def state():
    global _state
    with _lock:
        if _state is None:
            s = None
            try:
                with open(STORE, encoding="utf-8") as f:
                    got = json.load(f)
                if isinstance(got, dict):
                    s = got
            except (OSError, ValueError):
                pass
            if s is None:
                fresh = _fresh()
                # people who used the suite before this layer existed skip the welcome but can replay it from Help
                s = {"fresh": fresh, "onboarded": not fresh, "tour": not fresh, "tasks": {} if fresh else {"dismissed": True}, "tips": {} if fresh else {t["id"]: True for t in _app.get("tools", [])}, "since": int(time.time())}
                _write(s)
            s.setdefault("tasks", {})
            s.setdefault("tips", {})
            _state = s
        return json.loads(json.dumps(_state))


def _write(s):
    try:
        os.makedirs(shell.DATA, exist_ok=True)
        tmp = STORE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(s, f, indent=1)
        os.replace(tmp, STORE)
    except OSError:
        pass


def save(body):
    global _state
    state()
    with _lock:
        s = _state
        if body.get("reset"):
            s.update(onboarded=False, tour=False, tasks={}, tips={})
        for k in ("onboarded", "tour"):
            if isinstance(body.get(k), bool):
                s[k] = body[k]
        t = body.get("tasks")
        if isinstance(t, dict):
            for k, v in t.items():
                if k in TASKS or k == "dismissed":
                    s["tasks"][k] = bool(v)
        tp = body.get("tips")
        if isinstance(tp, dict):
            for k, v in list(tp.items())[:80]:
                if isinstance(k, str) and len(k) <= 40:
                    s["tips"][k] = bool(v)
        _write(s)
        return json.loads(json.dumps(s))


def public():
    s = state()
    s.update(version=version(), data=shell.DATA, install=QT, taskIds=list(TASKS),
             bundled=os.path.isdir(os.path.join(QT, "runtime")))
    return s


# ---------------------------------------------------------------- doctor ---
def _busy_by_other(port):
    """True when something answers on the port but it is not one of our tools (no HTTP reply we know)."""
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.4) as c:
            c.sendall(b"HEAD / HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n")
            c.settimeout(0.8)
            return not c.recv(12).startswith(b"HTTP/")
    except OSError:
        return False


def _lan_ok():
    """Is there a private (home network) address? The address itself is never shown or logged."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as u:
            u.connect(("192.168.0.1", 9))   # no packet is sent; this only picks the outgoing interface
            ip = u.getsockname()[0]
    except OSError:
        return False
    a = [int(x) for x in ip.split(".")]
    return a[0] == 10 or (a[0] == 172 and 16 <= a[1] <= 31) or (a[0] == 192 and a[1] == 168) or (a[0] == 100 and 64 <= a[1] <= 127)


def _has_module(py, mod):
    py = py.replace("pythonw.exe", "python.exe")
    try:
        r = subprocess.run([py, "-c", f"import {mod}"], capture_output=True, timeout=15, creationflags=NOWIN)
        return r.returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def doctor():
    out = []

    def add(key, label, ok, msg, fix=None, level=None):
        out.append({"key": key, "label": label, "ok": ok, "level": level or ("ok" if ok else "warn"), "msg": msg, "fix": fix})

    add("python", "Python", True, f"{platform.python_version()} ({'bundled with QT Suite' if os.path.isdir(os.path.join(QT, 'runtime')) else 'on this PC'})")
    edge = next((e for e in EDGE if os.path.exists(e)), None)
    add("edge", "Microsoft Edge", bool(edge), "Found. The suite opens in its own Edge window." if edge else
        "Not found. The suite opens in your default browser instead and PDFs open in Windows.")
    try:
        free = shutil.disk_usage(shell.DATA if os.path.isdir(shell.DATA) else os.path.expanduser("~")).free
        gb = free / 1e9
        add("disk", "Free space", gb > 2, f"{gb:.1f} GB free where the suite keeps its data." + ("" if gb > 2 else " Space Manager can help clear some."),
            fix="space" if gb <= 2 else None)
    except OSError:
        pass
    try:
        os.makedirs(shell.DATA, exist_ok=True)
        probe = os.path.join(shell.DATA, ".probe")
        with open(probe, "w") as f:
            f.write("ok")
        os.remove(probe)
        add("data", "Data folder", True, "Writable. Settings, notes and to-dos are kept here.", fix="data")
    except OSError as e:
        add("data", "Data folder", False, f"Can't write there ({e.strerror}). Settings won't stick.", fix="data", level="bad")
    if _lan_ok():
        add("lan", "Home network", True, "Connected, so your phone can reach Beam, Ping and Kharcha on the same Wi-Fi.")
    else:
        add("lan", "Home network", False, "No Wi-Fi or network cable found. Phone tools need this PC and your phone on the same network.")
    vpy = _app.get("volt_py") or sys.executable
    if _has_module(vpy, "yt_dlp"):
        add("volt", "VOLT engine", True, "yt-dlp is ready, so VOLT can download from links.")
    else:
        add("volt", "VOLT engine", False, "yt-dlp is missing. VOLT installs it the first time it starts.", fix="tool:volt")
    ff = shutil.which("ffmpeg")
    add("ffmpeg", "ffmpeg (optional)", bool(ff), "Found. VOLT can join best video with best audio." if ff else
        "Not installed. VOLT still works and picks files that already have sound. Install ffmpeg for the best quality.",
        level="ok" if ff else "info")
    seen = set()
    for t in _app.get("tools", []):
        if t["kind"] != "web" or t["port"] in seen:
            continue
        seen.add(t["port"])
        names = ", ".join(x["name"] for x in _app["tools"] if x["kind"] == "web" and x["port"] == t["port"])
        up = _app["status"](t) == "on"
        if up and _busy_by_other(t["port"]):
            add("port:" + t["id"], names, False, f"Port {t['port']} is used by another program, so {t['name']} can't start.", level="bad")
        elif up:
            add("port:" + t["id"], names, True, f"Running on port {t['port']}.", fix="tool:" + t["id"])
        else:
            add("port:" + t["id"], names, True, f"Not running. Port {t['port']} is free, so it starts when you open it.", fix="start:" + t["id"], level="info")
    return {"checks": out, "at": int(time.time())}


# ---------------------------------------------------------------- diagnostics ---
def _scrub(text):
    home = os.path.expanduser("~")
    user = os.environ.get("USERNAME", "")
    pc = os.environ.get("COMPUTERNAME", "") or platform.node()
    for a, b in ((home, "%USERPROFILE%"), (home.replace("\\", "/"), "%USERPROFILE%")):
        if a:
            text = text.replace(a, b).replace(a.lower(), b)
    for word, tag in ((user, "<user>"), (pc, "<pc>")):
        if word and len(word) > 2:
            import re
            text = re.sub(re.escape(word), tag, text, flags=re.I)
    return text


def diag():
    s = public()
    lines = [f"QT Suite {s['version']}", f"Windows {platform.release()} ({platform.version()}), {platform.machine()}",
             f"Python {platform.python_version()} {'bundled' if s['bundled'] else 'system'}",
             f"Install folder: {QT}", f"Data folder: {shell.DATA}", "", "Tools:"]
    for t in _app.get("tools", []):
        try:
            st = _app["status"](t)
        except Exception:
            st = "?"
        lines.append(f"  {t['name']:<14} {t['kind']:<6} {st}" + (f"  port {t['port']}" if t.get("port") else ""))
    lines += ["", "Checks:"]
    for c in doctor()["checks"]:
        lines.append(f"  [{c['level']:<4}] {c['label']}: {c['msg']}")
    try:
        ev = shell.route_get("/api/activity", {})[1]["events"][-15:]
        if ev:
            lines += ["", "Recent activity:"]
            lines += [f"  {time.strftime('%H:%M:%S', time.localtime(e.get('t', 0)))} {e.get('tool', '')} {e.get('kind', '')} {e.get('msg', '')}" for e in ev]
    except Exception:
        pass
    return _scrub("\n".join(lines))


# ---------------------------------------------------------------- routes ---
def route_get(p, query):
    if p == "/api/guide/state":
        return 200, public()
    if p == "/api/guide/doctor":
        return 200, doctor()
    if p == "/api/guide/changelog":
        for f in (os.path.join(QT, "CHANGELOG.md"), os.path.join(HERE, "CHANGELOG.md")):
            try:
                with open(f, encoding="utf-8") as fh:
                    return 200, {"text": fh.read(20000)}
            except OSError:
                pass
        return 200, {"text": ""}
    if p == "/api/guide/diag":
        return 200, {"text": diag()}
    return None


def route_post(p, body):
    if p == "/api/guide/state":
        save(body)
        return 200, public()
    if p == "/api/guide/folder":
        d = {"data": shell.DATA, "install": QT}.get(body.get("which"))
        if not d:
            return 400, {"ok": False, "msg": "unknown folder"}
        os.makedirs(d, exist_ok=True)
        subprocess.Popen(["explorer", d])
        return 200, {"ok": True}
    return None
