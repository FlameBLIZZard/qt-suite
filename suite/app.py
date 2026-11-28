"""QT Suite - one hub for every tool on this PC.

Serves http://127.0.0.1:7800. It shows each tool with a live status light,
starts tools that are not running, and opens web tools inside the hub (one
window, one look). The shared theme lives in theme/qt.css and is copied into
each tool by sync-theme.py so every tool also works on its own.
"""
import json
import mimetypes
import os
import socket
import subprocess
import sys
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import shell  # settings, order, glance, file search, activity log (shell.py)
import viewer  # Peek: open files inside the suite (viewer.py)
import tray  # notification-area icon + menu (tray.py)
import spark  # loop 4: notes, pins, CPU/RAM, VOLT grabs, unzip, downloads (spark.py)
import nova  # loop 5: apps, reminders, todos, screenshots, network, top apps, clipboard (nova.py)
import web  # Surf web browser: frame check, Lite proxy, pop out (web.py)
import guide  # first-run welcome, tour, help, checklist, setup doctor (guide.py)
import kit  # Toolkit: 32 extra features + phone link (kit/, own files)

HERE = os.path.dirname(os.path.abspath(__file__))
QT = os.path.dirname(HERE)
PORT = int(os.environ.get("QT_SUITE_PORT", "7800"))
LOCAL = os.environ.get("LOCALAPPDATA", "")
NOWIN = 0x08000000  # CREATE_NO_WINDOW
PYW = os.path.join(os.path.dirname(sys.executable), "pythonw.exe")  # same Python as the hub (the installer ships its own)
if not os.path.exists(PYW):
    PYW = "pythonw"
_VENV = os.path.join(LOCAL, "volt-venv", "Scripts", "pythonw.exe")
VOLT_PY = _VENV if os.path.exists(_VENV) else PYW  # dev PCs keep VOLT in its own venv; the installed app bundles its engine

TOOLS = [
    {"id": "daily", "name": "Daily", "kind": "web", "port": 7799, "tag": "Today",
     "blurb": "Today at a glance: spending, new photos, downloads and free disk space.",
     "dir": "daily", "cmd": [PYW, "app.py", "--no-window"]},
    {"id": "beam", "name": "Beam", "kind": "web", "port": 7788, "tag": "LAN share",
     "blurb": "Send files, clipboard and links between this PC and your phone over Wi-Fi.",
     "dir": "beam", "cmd": [PYW, "app.py"], "env": {"BEAM_NO_BROWSER": "1"}},
    {"id": "launchpad", "name": "Launchpad", "kind": "web", "port": 7790, "tag": "Game hub",
     "blurb": "Every game on this PC in one place, with playtime stats.",
     "dir": "launcher", "cmd": [PYW, "app.py", "--no-window"]},
    {"id": "volt", "name": "VOLT", "kind": "web", "port": 7777, "tag": "Downloader",
     "blurb": "Grab video, audio and images from links.",
     "dir": "volt", "cmd": [VOLT_PY, "app.py", "--no-browser"],
     "fallback": "start.bat"},
    {"id": "burrow", "name": "Burrow", "kind": "web", "port": 7795, "tag": "File explorer",
     "blurb": "Fast file explorer with tabs, instant search, previews and one-click send to your tools.",
     "dir": "burrow", "cmd": [PYW, "app.py", "--no-window"]},
    {"id": "lens", "name": "Lens", "kind": "web", "port": 7797, "tag": "Photos",
     "blurb": "Your phone's Lens gallery and your PC photos together: people, word search, pull and send.",
     "dir": "lens-pc", "cmd": [PYW, "app.py", "--no-window"]},
    {"id": "inkmotion", "name": "Inkmotion", "kind": "file", "tag": "Animation",
     "blurb": "Draw, and it moves. Stroke-by-stroke animation.",
     "file": os.path.join("inkmotion", "Inkmotion.html")},
    {"id": "pixlab", "name": "Pixlab", "kind": "file", "tag": "Pixel art",
     "blurb": "Text-first pixel art editor for .pxl sprites.",
     "file": os.path.join("pixlab", "Pixlab.html")},
    {"id": "soundboard", "name": "Soundboard", "kind": "web", "port": 7791, "tag": "Hotkey audio",
     "blurb": "Play clips on hotkeys, routed into your mic.",
     "dir": "soundboard", "cmd": [PYW, "app.py", "--hidden"]},
    {"id": "kharcha", "name": "Kharcha", "kind": "web", "port": 7788, "path": "/kharcha", "tag": "Money",
     "blurb": "Your phone's expenses and savings on the big screen, synced through Beam.",
     "dir": "beam", "cmd": [PYW, "app.py"], "env": {"BEAM_NO_BROWSER": "1"}},
    {"id": "ping", "name": "Ping", "kind": "web", "port": 7788, "path": "/notify", "tag": "Phone alerts",
     "blurb": "Your phone's notifications on the PC. Read, reply, dismiss and tap actions, over Wi-Fi or Tailscale.",
     "dir": "beam", "cmd": [PYW, "app.py"], "env": {"BEAM_NO_BROWSER": "1"}},
    {"id": "remote", "name": "Remote", "kind": "web", "port": 7802, "tag": "Remote desktop",
     "blurb": "See and control this PC from your laptop or phone over Tailscale, and open your other PCs from here.",
     "dir": "remote", "cmd": [PYW, "app.py", "--no-window"]},
    {"id": "space", "name": "Space Manager", "kind": "web", "port": 7793, "tag": "Disk space",
     "blurb": "See what fills C: and D:, clear caches, and move finished reel frames to the HDD.",
     "dir": "space-manager", "cmd": [PYW, "app.py", "--no-window"]},
    # Peek viewer apps: one page (suite\apps\viewer.html) that reads its id from /tool/<id>; files open here, not in other apps
    {"id": "pictures", "name": "Pictures", "kind": "file", "tag": "Photo viewer",
     "blurb": "Photos and pictures, HEIC and TIFF too. Zoom, pan, rotate, step through a folder.",
     "file": os.path.join("suite", "apps", "viewer.html")},
    {"id": "player", "name": "Player", "kind": "file", "tag": "Video + music",
     "blurb": "Play videos and songs right here: speed, loop, frame grab and live bars.",
     "file": os.path.join("suite", "apps", "viewer.html")},
    {"id": "reader", "name": "Reader", "kind": "file", "tag": "PDF + docs",
     "blurb": "Read PDFs, Word files, Markdown notes and try out fonts.",
     "file": os.path.join("suite", "apps", "viewer.html")},
    {"id": "code", "name": "Code", "kind": "file", "tag": "Text + code",
     "blurb": "Text, code, logs, JSON trees, CSV tables and web pages with colours and line numbers.",
     "file": os.path.join("suite", "apps", "viewer.html")},
    {"id": "archive", "name": "Archive", "kind": "file", "tag": "Zip viewer",
     "blurb": "Look inside zip, apk and jar files and peek at what's in them without extracting.",
     "file": os.path.join("suite", "apps", "viewer.html")},
    {"id": "surf", "name": "Surf", "kind": "file", "tag": "Web browser",
     "blurb": "Browse the web without leaving the suite: tabs, bookmarks, history and quick search.",
     "file": os.path.join("suite", "apps", "surf.html")},
    {"id": "apks", "name": "APKs", "kind": "folder", "tag": "Phone apps",
     "blurb": "Kharcha, Lens and Beam for Android. Send them with Beam.",
     "dir": "APKs"},
]
TOOLS = [t for t in TOOLS if t["kind"] != "folder" or os.path.isdir(os.path.join(QT, t["dir"]))]  # no APKs folder in a fresh install
BY_ID = {t["id"]: t for t in TOOLS}
STARTED = {}  # id -> Popen


def port_up(port, timeout=0.25):
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=timeout):
            return True
    except OSError:
        return False


STARTUP_LNK = os.path.join(os.environ.get("APPDATA", ""), r"Microsoft\Windows\Start Menu\Programs\Startup", "QT Suite.lnk")


def set_autostart(on):
    """The person flips this in the suite: a Startup shortcut that runs the hub quietly at sign-in."""
    if not on:
        if os.path.exists(STARTUP_LNK):
            os.remove(STARTUP_LNK)
        return
    pyw = os.path.join(os.path.dirname(sys.executable), "pythonw.exe")
    args = '"' + os.path.join(HERE, "app.py") + '" --no-window'
    exe = os.path.join(QT, "QT Suite.exe")  # installed copy: start through its own launcher
    if os.path.exists(exe):
        pyw, args = exe, "--no-window"
    ps = ("$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:LNK); $s.TargetPath=$env:PYW; "
          "$s.Arguments=$env:ARGS; $s.WorkingDirectory=$env:DIR; $s.IconLocation=$env:ICO; $s.Save()")
    env = dict(os.environ, LNK=STARTUP_LNK, PYW=pyw, ARGS=args, DIR=HERE, ICO=os.path.join(HERE, "suite.ico"))
    subprocess.run(["powershell", "-NoProfile", "-Command", ps], env=env, check=True, creationflags=NOWIN, timeout=20)


def window_open(title):
    """True if a top-level visible window has exactly this title (finds tools started outside the hub)."""
    try:
        import ctypes
        from ctypes import wintypes
        user32 = ctypes.windll.user32
        found = []
        buf = ctypes.create_unicode_buffer(256)

        @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
        def cb(h, _):
            if user32.IsWindowVisible(h):
                user32.GetWindowTextW(h, buf, 256)
                if buf.value == title:
                    found.append(h)
                    return False
            return True
        user32.EnumWindows(cb, 0)
        return bool(found)
    except Exception:
        return False


def status(t):
    if t["kind"] == "web":
        return "on" if port_up(t["port"]) else "off"
    if t["kind"] == "app":
        p = STARTED.get(t["id"])
        return "on" if (p and p.poll() is None) or window_open(t.get("title", t["name"])) else "idle"
    if t["kind"] == "folder":
        d = os.path.join(QT, t["dir"])
        return "on" if os.path.isdir(d) else "off"
    return "on" if os.path.exists(os.path.join(QT, t["file"])) else "off"


def extra(t):
    if t["kind"] == "folder":
        d = os.path.join(QT, t["dir"])
        try:
            files = sorted(f for f in os.listdir(d) if f.lower().endswith(".apk"))
        except OSError:
            files = []
        return {"files": files}
    return {}


def start(t):
    if t["kind"] == "web" and port_up(t["port"]):
        return True, "already running"
    if t["kind"] == "app" and status(t) == "on":
        return True, "already running"
    if t["kind"] == "folder":
        os.startfile(os.path.join(QT, t["dir"]))
        return True, "opened folder"
    cwd = os.path.join(QT, t["dir"])
    cmd = list(t["cmd"])
    if os.path.isabs(cmd[0]) and not os.path.exists(cmd[0]):
        fb = t.get("fallback")
        if not fb:
            return False, "not installed"
        subprocess.Popen(["cmd", "/c", "start", "", fb], cwd=cwd)
        return True, "first run setup started"
    env = dict(os.environ, **t.get("env", {}))
    try:
        STARTED[t["id"]] = subprocess.Popen(cmd, cwd=cwd, env=env, creationflags=NOWIN)
    except OSError as e:
        return False, str(e)
    if t["kind"] == "web":
        for _ in range(40):
            if port_up(t["port"]):
                return True, "started"
            time.sleep(0.15)
        return False, "started but not answering yet"
    return True, "started"


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _host_ok(self):
        return self.headers.get("Host", "") in {f"127.0.0.1:{PORT}", f"localhost:{PORT}"}

    def _send(self, code, body, ctype="application/json", extra_headers=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode()
        elif isinstance(body, str):
            body = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra_headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _file(self, path):
        if not os.path.isfile(path):
            return self._send(404, {"error": "not found"})
        ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
        with open(path, "rb") as f:
            self._send(200, f.read(), ctype)

    def do_GET(self):
        if not self._host_ok():
            return self._send(403, {"error": "bad host"})
        u = urllib.parse.urlparse(self.path)
        p = u.path
        if p == "/api/defaults":  # QT as the Windows default viewer (defaults.py)
            import defaults
            return self._send(200, defaults.status())
        if p == "/api/autostart":
            return self._send(200, {"on": os.path.exists(STARTUP_LNK)})
        if p == "/api/procs":  # suite polish: pid / uptime / memory per running tool (plus.py)
            import plus
            return self._send(200, plus.tool_procs(TOOLS))
        if p == "/api/tray/nav":  # tray menu asks an open window to switch tools (static/tray.js polls)
            return self._send(200, tray.nav_state())
        if kit.get(self, p, urllib.parse.parse_qs(u.query)):  # Toolkit pages + /api/kit/* (kit/__init__.py)
            return
        if viewer.get(self, p, urllib.parse.parse_qs(u.query)):
            return
        if p.startswith("/api/spark/"):  # loop 4 layer: notes, pins, CPU/RAM, VOLT grabs, unzip, downloads (spark.py)
            if self.headers.get("Sec-Fetch-Site", "same-origin") not in ("same-origin", "none"):
                return self._send(403, {"error": "cross-site"})
            r = spark.route_get(p, urllib.parse.parse_qs(u.query))
            if r:
                return self._send(*r)
        if p.startswith("/api/nova/"):  # loop 5 layer (nova.py)
            if self.headers.get("Sec-Fetch-Site", "same-origin") not in ("same-origin", "none"):
                return self._send(403, {"error": "cross-site"})
            r = nova.route_get(p, urllib.parse.parse_qs(u.query))
            if r:
                return self._send(*r)
        if p.startswith("/api/guide/"):  # welcome, tour, help, doctor (guide.py)
            if self.headers.get("Sec-Fetch-Site", "same-origin") not in ("same-origin", "none"):
                return self._send(403, {"error": "cross-site"})
            r = guide.route_get(p, urllib.parse.parse_qs(u.query))
            if r:
                return self._send(*r)
        if p.startswith("/api/web/"):  # Surf browser (web.py)
            if self.headers.get("Sec-Fetch-Site", "same-origin") not in ("same-origin", "none"):
                return self._send(403, {"error": "cross-site"})
            r = web.route_get(p, urllib.parse.parse_qs(u.query))
            if r:
                return self._send(*r)
        r = shell.route_get(p, urllib.parse.parse_qs(u.query))
        if r:
            return self._send(*r)
        if p == "/api/tools":
            return self._send(200, shell.arrange([dict({k: v for k, v in t.items() if k in ("id", "name", "kind", "port", "path", "tag", "blurb")},
                                         status=status(t), **extra(t)) for t in TOOLS], "all=1" in u.query))
        if p.startswith("/tool/"):  # file-based tools served from the hub (Inkmotion)
            t = BY_ID.get(p.split("/")[2])
            if t and t["kind"] == "file":
                return self._file(os.path.join(QT, t["file"]))
            return self._send(404, {"error": "not found"})
        if p.startswith("/theme/"):
            return self._file(os.path.join(HERE, "theme", os.path.basename(p)))
        if p.startswith("/icons/"):  # the shared icon family (suite\icons\make_icons.py)
            return self._file(os.path.join(HERE, "icons", "svg", os.path.basename(p)))
        if p in ("/", "/index.html"):
            p = "/index.html"
        return self._file(os.path.join(HERE, "static", os.path.basename(p)))

    def do_POST(self):
        if not self._host_ok() or self.headers.get("Origin", f"http://127.0.0.1:{PORT}") not in (
                f"http://127.0.0.1:{PORT}", f"http://localhost:{PORT}"):
            return self._send(403, {"error": "bad origin"})
        if self.path == "/api/tray/show":  # a second launch: focus the window instead of opening another
            n = int(self.headers.get("Content-Length") or 0)
            try:
                tid = json.loads(self.rfile.read(min(n, 4096)) or b"{}").get("id") if n else None
            except (ValueError, AttributeError):
                tid = None
            ok_ids = set(BY_ID) | {"help", "settings", "home", "search"}
            tray.show_suite(tid if tid in ok_ids else None)
            return self._send(200, {"ok": True})
        if kit.post(self):  # Toolkit /api/kit/* (kit/__init__.py)
            return
        parts = self.path.strip("/").split("/")
        if self.path.startswith(("/api/settings", "/api/startall", "/api/open-file", "/api/peek/", "/api/spark/", "/api/nova/", "/api/web/", "/api/guide/")):
            n = int(self.headers.get("Content-Length") or 0)
            cap = (4 << 20) if self.path.startswith("/api/spark/") else (1 << 16)   # notes can be long
            try:
                body = json.loads(self.rfile.read(min(n, cap)) or b"{}") if n else {}
            except ValueError:
                body = {}
            body = body if isinstance(body, dict) else {}
            route = guide.route_post if self.path.startswith("/api/guide/") else web.route_post if self.path.startswith("/api/web/") else viewer.post if self.path.startswith("/api/peek/") else nova.route_post if self.path.startswith("/api/nova/") else spark.route_post if self.path.startswith("/api/spark/") else shell.route_post
            r = route(self.path.split("?")[0], body)
            if r:
                return self._send(*r)
        if len(parts) == 3 and parts[0] == "api" and parts[1] in ("start", "stop", "restart") and parts[2] in BY_ID:
            shell.expect(parts[2], parts[1])
        if len(parts) == 3 and parts[:2] == ["api", "start"] and parts[2] in BY_ID:
            ok, msg = start(BY_ID[parts[2]])
            return self._send(200 if ok else 500, {"ok": ok, "msg": msg})
        if len(parts) == 3 and parts[0] == "api" and parts[1] in ("stop", "restart", "folder") and parts[2] in BY_ID:
            import plus  # suite polish: tool menu actions
            t = BY_ID[parts[2]]
            if parts[1] == "folder":
                d = os.path.join(QT, t.get("dir") or os.path.dirname(t.get("file", "")))
                if not os.path.isdir(d):
                    return self._send(404, {"ok": False, "msg": "folder not found"})
                os.startfile(d)
                return self._send(200, {"ok": True, "msg": "opened folder"})
            ok, msg = plus.stop(t, PORT)
            if ok and parts[1] == "restart":
                STARTED.pop(t["id"], None)
                ok, msg = start(t)
                msg = "restarted" if ok else msg
            return self._send(200 if ok else 500, {"ok": ok, "msg": msg})
        if self.path in ("/api/defaults/on", "/api/defaults/off", "/api/defaults/settings"):
            import defaults
            try:
                return self._send(200, getattr(defaults, {"settings": "open_settings"}.get(parts[2], parts[2]))())
            except Exception as e:
                return self._send(500, {"ok": False, "msg": str(e)})
        if self.path in ("/api/autostart/on", "/api/autostart/off"):
            try:
                set_autostart(self.path.endswith("/on"))
                return self._send(200, {"on": os.path.exists(STARTUP_LNK)})
            except Exception as e:
                return self._send(500, {"ok": False, "msg": str(e)})
        if self.path == "/api/quit":
            self._send(200, {"ok": True})
            threading.Timer(0.3, lambda: (tray.remove(), os._exit(0))).start()
            return
        return self._send(404, {"error": "not found"})


def open_window(url):
    for edge in (r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
                 r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"):
        if os.path.exists(edge):
            subprocess.Popen([edge, f"--app={url}", "--window-size=1440,900"])
            return
    import webbrowser
    webbrowser.open(url)


def main():
    url = f"http://127.0.0.1:{PORT}/"
    page = next((a.split("=", 1)[1] for a in sys.argv if a.startswith("--page=")), "")   # e.g. the Start menu's "QT Suite Help"
    page = page if page in set(BY_ID) | {"help", "settings"} else ""
    if page:
        url += "#" + page
    if port_up(PORT):  # already running: just bring up a window
        if "--no-window" not in sys.argv and not tray.poke(PORT, page or None):
            open_window(url)
        return
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), H)
    guide.init(TOOLS, status, VOLT_PY)  # first: it checks whether this is a brand-new user
    shell.init(TOOLS, start, port_up)
    viewer.init(start, BY_ID["beam"], port_up)
    spark.init(start, BY_ID, port_up)
    nova.init()
    web.init(PORT)
    kit.init(PORT)
    shell.boot()
    if "QT_SUITE_PORT" not in os.environ or os.environ.get("QT_SUITE_TRAY") == "1":  # test hubs stay out of the tray
        tray.start(PORT, open_window)
    if "--no-window" not in sys.argv:
        threading.Timer(0.4, open_window, args=(url,)).start()
    srv.serve_forever()


if __name__ == "__main__":
    main()
