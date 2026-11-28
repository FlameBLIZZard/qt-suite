"""QT Remote - see and control this PC from your other devices, over Tailscale.

  python app.py [--no-window]

Listens on 127.0.0.1 (the console inside QT Suite) and on this PC's Tailscale address (the
viewer for your laptop, phone or another PC). Any browser is the viewer: open
http://<this-pc>:7802 on the other device, pair once, done. See trust.py for the security model.
"""
import base64
import hashlib
import json
import os
import secrets
import socket
import struct
import subprocess
import sys
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import capture
import control
import trust

VERSION = "1.0.0"
HERE = os.path.dirname(os.path.abspath(__file__))
QT = os.path.dirname(HERE)
PORT = int(os.environ.get("QT_REMOTE_PORT", "7802"))
NOWIN = 0x08000000
PYW = os.path.join(os.path.dirname(sys.executable), "pythonw.exe")
if not os.path.exists(PYW):
    PYW = sys.executable
FAKE_INPUT = os.environ.get("QT_REMOTE_FAKE_INPUT") == "1"  # tests: record input instead of moving the real mouse
NO_PROMPTS = os.environ.get("QT_REMOTE_NO_PROMPTS") == "1"  # tests: no dialogs / strip on screen
STARTUP_LNK = os.path.join(os.environ.get("APPDATA", ""), r"Microsoft\Windows\Start Menu\Programs\Startup",
                           "QT Remote.lnk")
LOCK = threading.RLock()
SESSIONS = {}  # id -> Session
SERVERS = {}  # bind address -> server
DIALOGS = {}  # pairing id -> Popen of the prompt
FAKE_LOG = []
_bar = {"p": None}


def pc_name():
    return os.environ.get("COMPUTERNAME") or socket.gethostname()


def port_up(host, port, timeout=0.5):
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


# ---------------------------------------------------------------- prompts on the PC
def _ask(info):
    """Show the allow prompt; returns 'allow' | 'view' | 'deny'. Blocks until answered."""
    if NO_PROMPTS:
        return None
    p = subprocess.Popen([PYW, os.path.join(HERE, "indicator.py"), "ask", json.dumps(info)], cwd=HERE,
                         creationflags=NOWIN)
    if info.get("id"):
        with LOCK:
            DIALOGS[info["id"]] = p
    try:
        code = p.wait(timeout=info.get("timeout", 110) + 10)
    except subprocess.TimeoutExpired:
        p.kill()
        code = 0
    with LOCK:
        DIALOGS.pop(info.get("id"), None)
    return {10: "allow", 11: "view"}.get(code, "deny")


def decide(rid, how, by):
    r = trust.decide(rid, how, by)
    with LOCK:
        p = DIALOGS.pop(rid, None)
    if p and p.poll() is None:
        p.kill()
    return r


def pair_prompt(r):
    how = _ask({"id": r["id"], "mode": "pair", "name": r["name"], "device": r["who"]["name"],
                "login": r["who"].get("login", ""), "kind": r["who"].get("kind"), "code": r["code"],
                "timeout": trust.PAIR_TTL - 10})
    if how and how != "deny":
        decide(r["id"], how, "on this PC")
    elif how == "deny":
        decide(r["id"], "deny", "on this PC")


def show_bar():
    if NO_PROMPTS:
        return
    with LOCK:
        p = _bar["p"]
        if p and p.poll() is None:
            return
        _bar["p"] = subprocess.Popen([PYW, os.path.join(HERE, "indicator.py"), "bar", str(PORT)], cwd=HERE,
                                     creationflags=NOWIN)


# ---------------------------------------------------------------- sessions
class FakeInput:
    def __getattr__(self, name):
        return lambda *a: FAKE_LOG.append((name,) + a)


def fit(w, h, mw, mh):
    s = min(1.0, mw / w, mh / h)
    return max(2, int(w * s) // 2 * 2), max(2, int(h * s) // 2 * 2)


class Session:
    def __init__(self, handler, dev, who, ip):
        self.id = secrets.token_hex(5)
        self.h = handler
        self.dev, self.who, self.ip = dev, who, ip
        self.name = dev["name"]
        self.view_only = bool(dev.get("view_only"))
        self.started = time.time()
        self.alive = True
        self.send_lock = threading.Lock()
        self.ack = threading.Event()
        self.ack.set()
        self.cfg = {"mon": 0, "maxw": 1920, "maxh": 1080, "q": "balanced", "fps": 30}
        self.force = True
        self.mons = capture.monitors()
        self.input = FakeInput() if FAKE_INPUT else control.Input()
        self.last_activity = time.time()
        self.sent_at = time.time()
        self.clip_from_viewer = None
        self.stats = {"frames": 0, "bytes": 0}

    # -- wire
    def send(self, data, op=1):
        if isinstance(data, dict):
            data = json.dumps(data).encode()
        n = len(data)
        head = bytes([0x80 | op, n]) if n < 126 else (bytes([0x80 | op, 126]) + n.to_bytes(2, "big") if n < 65536
                                                       else bytes([0x80 | op, 127]) + n.to_bytes(8, "big"))
        with self.send_lock:
            self.h.wfile.write(head + data)
            self.h.wfile.flush()

    def close(self, reason="", again=False):
        if not self.alive:
            return
        self.alive = False
        try:
            if reason:
                self.send({"t": "bye", "reason": reason, "again": again})
            self.send(b"\x03\xe8", 8)
        except OSError:
            pass
        try:
            self.h.connection.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass

    def region(self):
        if self.cfg["mon"] == -1:
            x, y, w, h = capture.virtual_screen()
            return {"x": x, "y": y, "w": w, "h": h}
        m = self.mons[self.cfg["mon"]] if 0 <= self.cfg["mon"] < len(self.mons) else self.mons[0]
        return m

    def info(self):
        return {"t": "info", "pc": pc_name(), "mons": [{k: m[k] for k in ("i", "w", "h", "primary", "name")}
                                                      for m in self.mons],
                "mon": self.cfg["mon"], "view_only": self.view_only, "session": self.id,
                "clip_sync": trust.SETTINGS["clip_sync"], "files": trust.SETTINGS["files"] and not self.view_only}

    # -- the picture
    def stream(self):
        g = capture.Grabber()
        prev, desk_at, secure, clip_at, pend_at = None, 0, False, 0, 0
        seq = control.clip_seq() if not FAKE_INPUT else 0
        last_pending = None
        try:
            while self.alive:
                now = time.time()
                if now - pend_at > 1:  # trusted (controlling) devices can approve new devices
                    pend_at = now
                    if not self.view_only:
                        p = [{k: x[k] for k in ("id", "code", "name", "device", "left")} for x in trust.waiting()]
                        sig = [x["id"] for x in p]
                        if sig != last_pending:
                            last_pending = sig
                            self.send({"t": "pending", "list": p})
                if trust.SETTINGS["clip_sync"] and not FAKE_INPUT and now - clip_at > 0.8:
                    clip_at = now
                    s = control.clip_seq()
                    if s != seq:
                        seq = s
                        text = control.get_clip()
                        if text and text != self.clip_from_viewer:
                            self.send({"t": "clip", "text": text[:100000]})
                if not self.ack.wait(0.25):
                    if now - self.sent_at > 25:
                        return self.close("The connection stopped answering.")
                    continue
                if now - desk_at > 1:
                    desk_at = now
                    locked = capture.input_desktop().lower() != "default"
                    if locked != secure:
                        secure = locked
                        self.send({"t": "secure", "on": secure})
                        self.force = True
                if secure:
                    time.sleep(0.5)
                    continue
                r = self.region()
                raw = g.grab(r["x"], r["y"], r["w"], r["h"])
                if raw is None:
                    time.sleep(0.3)
                    continue
                ow, oh = fit(r["w"], r["h"], self.cfg["maxw"], self.cfg["maxh"])
                cmp, im = capture.make_frame(raw, r["w"], r["h"], ow, oh)
                rects = capture.changed_rects(None if self.force else prev, cmp)
                self.force = False
                prev = cmp
                busy = time.time() - self.last_activity < 3
                if not rects:
                    time.sleep(1 / self.cfg["fps"] if busy else 0.08)
                    continue
                self.last_activity = time.time()
                parts = [struct.pack("<BHHH", 1, ow, oh, len(rects))]
                for rc in rects:
                    jpg = capture.encode(im, rc, self.cfg["q"])
                    parts.append(struct.pack("<HHHHI", *rc, len(jpg)))
                    parts.append(jpg)
                blob = b"".join(parts)
                self.ack.clear()
                self.sent_at = time.time()
                self.send(blob, 2)
                self.stats["frames"] += 1
                self.stats["bytes"] += len(blob)
                spent = time.time() - now
                time.sleep(max(0.0, 1 / self.cfg["fps"] - spent))
        except (OSError, ValueError):
            self.close()
        finally:
            g.close()

    # -- what the viewer sends
    def handle(self, d):
        t = d.get("t")
        if t == "ack":
            self.ack.set()
            return
        if t == "cfg":
            c = self.cfg
            if isinstance(d.get("maxw"), (int, float)):
                c["maxw"] = int(min(7680, max(320, d["maxw"])))
            if isinstance(d.get("maxh"), (int, float)):
                c["maxh"] = int(min(4320, max(240, d["maxh"])))
            if d.get("q") in capture.QUALITY:
                c["q"] = d["q"]
            if isinstance(d.get("fps"), int):
                c["fps"] = min(60, max(2, d["fps"]))
            if isinstance(d.get("mon"), int) and -1 <= d["mon"] < len(self.mons):
                if d["mon"] != c["mon"]:
                    c["mon"] = d["mon"]
                    self.send(self.info())
            self.force = True
            return
        if t == "refresh":
            self.mons = capture.monitors()
            self.force = True
            self.send(self.info())
            return
        if t == "approve" and not self.view_only and d.get("how") in ("allow", "view", "deny"):
            decide(str(d.get("id")), d["how"], f"from {self.name}")
            return
        if self.view_only:
            return
        self.last_activity = time.time()
        r = self.region()
        if t == "m":
            x, y = float(d.get("x", 0)), float(d.get("y", 0))
            self.input.move_abs(r["x"] + round(min(1, max(0, x)) * (r["w"] - 1)),
                                r["y"] + round(min(1, max(0, y)) * (r["h"] - 1)))
        elif t == "rel":
            self.input.move_rel(max(-2000, min(2000, int(d.get("dx", 0)))), max(-2000, min(2000, int(d.get("dy", 0)))))
        elif t == "b":
            self.input.button(int(d.get("b", 0)), bool(d.get("d")))
        elif t == "w":
            self.input.wheel(max(-2400, min(2400, int(d.get("dy", 0)))), max(-2400, min(2400, int(d.get("dx", 0)))))
        elif t == "k":
            self.input.key(str(d.get("code", "")), bool(d.get("d")))
        elif t == "txt":
            self.input.text(str(d.get("s", ""))[:2000])
        elif t == "combo" and isinstance(d.get("keys"), list):
            self.input.combo([str(k) for k in d["keys"]])
        elif t == "clip" and trust.SETTINGS["clip_sync"]:
            text = str(d.get("text", ""))[:1000000]
            self.clip_from_viewer = text
            if FAKE_INPUT:
                FAKE_LOG.append(("clip", text))
            else:
                try:
                    control.set_clip(text)
                except OSError:
                    pass


def sessions_public():
    with LOCK:
        return [{"id": s.id, "name": s.name, "device": s.who["name"], "view_only": s.view_only, "since": s.started,
                 "kind": s.who.get("kind"), "frames": s.stats["frames"], "mb": round(s.stats["bytes"] / 1e6, 1)}
                for s in SESSIONS.values()]


def end_sessions(match=lambda s: True, reason="The PC ended the session.", again=False):
    with LOCK:
        hit = [s for s in SESSIONS.values() if match(s)]
    for s in hit:
        s.close(reason, again)
    return len(hit)


# ---------------------------------------------------------------- HTTP
LOCAL_HOSTS = {"127.0.0.1", "localhost"}


def allowed_hosts():
    me = trust.self_info()
    hs = set(LOCAL_HOSTS)
    for k in ("ip", "host", "dns"):
        if me.get(k):
            hs.add(me[k])
    hs.add(pc_name().lower())
    return hs


def autostart_on():
    return os.path.exists(STARTUP_LNK)


def set_autostart(on):
    if not on:
        if os.path.exists(STARTUP_LNK):
            os.remove(STARTUP_LNK)
        return
    ps = ("$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:LNK); $s.TargetPath=$env:PYW; "
          "$s.Arguments=$env:ARGS; $s.WorkingDirectory=$env:DIR; $s.Save()")
    env = dict(os.environ, LNK=STARTUP_LNK, PYW=PYW, ARGS=f'"{os.path.join(HERE, "app.py")}" --no-window', DIR=HERE)
    subprocess.run(["powershell", "-NoProfile", "-Command", ps], env=env, check=True, creationflags=NOWIN, timeout=20)


def addresses():
    me = trust.self_info()
    out = []
    for k in ("host", "dns", "ip"):
        if me.get(k):
            out.append(f"http://{me[k]}:{PORT}/")
    return out


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "QTRemote"
    sys_version = ""

    def log_message(self, *a):
        pass

    # -- helpers
    def _send(self, code, body, ctype="application/json", headers=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode()
        elif isinstance(body, str):
            body = body.encode()
        self.send_response(code)
        if self.command == "POST" and not getattr(self, "_consumed", True) and int(self.headers.get("Content-Length") or 0):
            self.close_connection = True  # request body left unread: never reuse this connection
            self.send_header("Connection", "close")
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _file(self, path, csp=None):
        if not os.path.isfile(path):
            return self._send(404, {"error": "not found"})
        ext = os.path.splitext(path)[1].lower()
        ctype = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
                 ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
                 ".json": "application/json", ".webmanifest": "application/manifest+json"}.get(ext, "application/octet-stream")
        with open(path, "rb") as f:
            data = f.read()
        hd = {}
        if ext == ".html":
            hd["Content-Security-Policy"] = csp or "frame-ancestors 'self'"
        self._send(200, data, ctype, hd)

    def _body(self, cap=1 << 20):
        n = int(self.headers.get("Content-Length") or 0)
        if n > cap:
            raise ValueError("too big")
        self._consumed = True
        try:
            d = json.loads(self.rfile.read(n) or b"{}") if n else {}
        except ValueError:
            d = {}
        return d if isinstance(d, dict) else {}

    def _gate(self):
        """Network + Host checks shared by every request. Sets self.who / self.kind."""
        ip = self.client_address[0]
        self.ip = ip
        host = (self.headers.get("Host") or "").lower()
        hn = host.rsplit(":", 1)[0].strip("[]") if ":" in host else host
        if not trust.SETTINGS.get("allow_lan") and hn not in allowed_hosts():
            self._send(403, {"error": "bad host"})
            return False
        who, err = trust.identify(ip)
        if not who:
            self._send(403, {"error": err})
            return False
        self.who, self.kind = who, who["kind"]
        return True

    def _local_ok(self, post):
        if self.kind != "local":
            return False
        if post:
            return self.headers.get("Origin") in (f"http://127.0.0.1:{PORT}", f"http://localhost:{PORT}")
        return self.headers.get("Sec-Fetch-Site", "same-origin") in ("same-origin", "none")

    def _device(self):
        if trust.limited(self.ip, cap=12):
            return None
        key = self.headers.get("X-Remote-Key") or ""
        dev = trust.check_token(key, self.who) if key else None
        if key and not dev:
            trust.strike(self.ip)
        return dev

    # -- GET
    def do_GET(self):
        if not self._gate():
            return
        u = urllib.parse.urlparse(self.path)
        p, q = u.path, urllib.parse.parse_qs(u.query)
        if p == "/ws":
            return self.ws()
        if p == "/":
            if self.kind == "local" and "view" not in q:
                return self._file(os.path.join(HERE, "static", "console.html"),
                                  "frame-ancestors 'self' http://127.0.0.1:* http://localhost:*")
            return self._file(os.path.join(HERE, "static", "view.html"))
        if p == "/view":
            return self._file(os.path.join(HERE, "static", "view.html"))
        if p == "/theme/qt.css":
            path = os.path.join(QT, "suite", "theme", "qt.css")
            return self._file(path if os.path.exists(path) else os.path.join(HERE, "static", "qt.css"))
        if p == "/icon.svg":
            path = os.path.join(QT, "suite", "icons", "svg", "remote.svg")
            return self._file(path if os.path.exists(path) else os.path.join(HERE, "static", "icon.svg"))
        if p.startswith("/static/"):
            name = os.path.basename(p)
            return self._file(os.path.join(HERE, "static", name))
        if p == "/api/hello":
            dev = self._device()
            return self._send(200, {"pc": pc_name(), "version": VERSION, "kind": self.kind,
                                    "you": self.who["name"], "login": self.who.get("login", ""),
                                    "enabled": trust.SETTINGS["enabled"], "trusted": bool(dev),
                                    "name": dev["name"] if dev else None,
                                    "view_only": bool(dev and dev.get("view_only"))})
        if p.startswith("/api/pair/"):
            r = trust.collect(p.split("/")[3], (q.get("s") or [""])[0])
            return self._send(200, r) if r else self._send(404, {"error": "unknown request"})
        if p == "/api/pending":
            dev = self._device()
            if not dev or dev.get("view_only"):
                return self._send(403, {"error": "not allowed"})
            return self._send(200, trust.waiting())
        if p.startswith("/api/local/"):
            if not self._local_ok(False):
                return self._send(403, {"error": "local only"})
            return self.local_get(p)
        return self._send(404, {"error": "not found"})

    def local_get(self, p):
        if p == "/api/local/state":
            with trust.LOCK:
                lg = list(trust.LOG[-80:])
            return self._send(200, {"settings": trust.SETTINGS, "self": trust.self_info(), "port": PORT,
                                    "pc": pc_name(), "addresses": addresses(), "devices": trust.devices(),
                                    "pending": trust.waiting(), "sessions": sessions_public(), "log": lg[::-1],
                                    "autostart": autostart_on(), "bound": sorted(SERVERS), "version": VERSION})
        if p == "/api/local/fakelog" and FAKE_INPUT:  # tests only
            return self._send(200, [list(x) for x in FAKE_LOG[-200:]])
        if p == "/api/local/indicator":
            return self._send(200, {"sessions": sessions_public()})
        if p == "/api/local/peers":
            ps = trust.peers()
            ths = []
            for x in ps:
                def probe(x=x):
                    x["remote"] = x["online"] and port_up(x["ip"], PORT, 0.8)
                th = threading.Thread(target=probe, daemon=True)
                th.start()
                ths.append(th)
            for th in ths:
                th.join(1.5)
            return self._send(200, ps)
        return self._send(404, {"error": "not found"})

    # -- POST
    def do_POST(self):
        self._consumed = False
        if not self._gate():
            return
        u = urllib.parse.urlparse(self.path)
        p, q = u.path, urllib.parse.parse_qs(u.query)
        if p.startswith("/api/local/"):
            if not self._local_ok(True):
                return self._send(403, {"error": "local only"})
            try:
                return self.local_post(p, self._body())
            except ValueError as e:
                return self._send(400, {"error": str(e)})
        # everything below comes from a viewer: the page must be our own (no cross-site posts)
        origin = self.headers.get("Origin")
        if origin and urllib.parse.urlparse(origin).netloc.lower() != (self.headers.get("Host") or "").lower():
            return self._send(403, {"error": "cross-site"})
        if p == "/api/pair":
            if not trust.SETTINGS["enabled"]:
                return self._send(403, {"error": "Remote connections are turned off on this PC."})
            if trust.limited(self.ip, cap=6):
                return self._send(429, {"error": "Too many tries. Wait a few minutes."})
            trust.strike(self.ip)
            d = self._body(1 << 12)
            r = trust.new_request(str(d.get("name", "")).strip(), self.who, self.ip)
            threading.Thread(target=pair_prompt, args=(r,), daemon=True).start()
            return self._send(200, {"id": r["id"], "secret": r["secret"], "code": r["code"], "ttl": trust.PAIR_TTL})
        if p.startswith("/api/pending/"):
            dev = self._device()
            d = self._body(1 << 12)
            if not dev or dev.get("view_only") or d.get("how") not in ("allow", "view", "deny"):
                return self._send(403, {"error": "not allowed"})
            r = decide(p.split("/")[3], d["how"], f"from {dev['name']}")
            return self._send(200 if r else 404, {"ok": bool(r)})
        if p == "/api/upload":
            return self.upload(q)
        return self._send(404, {"error": "not found"})

    def local_post(self, p, d):
        parts = p.strip("/").split("/")  # api local <what> [id] [action]
        what = parts[2] if len(parts) > 2 else ""
        if what == "settings":
            before = trust.SETTINGS["allow_lan"]
            s = trust.set_settings(d)
            if not s["enabled"]:
                end_sessions(reason="Remote connections were turned off on the PC.")
            if s["allow_lan"] != before:
                threading.Timer(0.3, rebind).start()
            return self._send(200, s)
        if what == "pending" and len(parts) == 5:
            r = decide(parts[3], parts[4], "in QT Suite")
            return self._send(200 if r else 404, {"ok": bool(r)})
        if what == "device" and len(parts) == 5:
            did, act = parts[3], parts[4]
            if act == "remove":
                ok = trust.remove_device(did)
                end_sessions(lambda s: s.dev["id"] == did, "This device was removed from the trusted list.")
                trust.log("remove", "A trusted device was removed")
                return self._send(200, {"ok": ok})
            if act in ("viewonly", "rename"):
                dev = trust.update_device(did, view_only=d.get("on"), name=d.get("name")) if act == "viewonly" \
                    else trust.update_device(did, name=d.get("name"))
                if dev and act == "viewonly":
                    end_sessions(lambda s: s.dev["id"] == did, "The PC changed what this device may do.", again=True)
                return self._send(200 if dev else 404, {"ok": bool(dev)})
        if what == "end" and len(parts) == 4:
            n = end_sessions((lambda s: True) if parts[3] == "all" else (lambda s: s.id == parts[3]))
            if n:
                trust.log("end", f"Ended {n} session{'s' if n > 1 else ''} from this PC")
            return self._send(200, {"ended": n})
        if what == "open":
            url = str(d.get("url", ""))
            pu = urllib.parse.urlparse(url)
            ok_hosts = {x["ip"] for x in trust.peers()} | {x["dns"].lower() for x in trust.peers()} | \
                       {x["name"].lower() for x in trust.peers()}
            if pu.scheme != "http" or (pu.hostname or "") not in ok_hosts or pu.port != PORT:
                return self._send(400, {"error": "Only other Tailscale devices running QT Remote can be opened."})
            open_window(url)
            return self._send(200, {"ok": True})
        if what == "autostart":
            set_autostart(bool(d.get("on")))
            return self._send(200, {"on": autostart_on()})
        if what == "test-prompt":  # Settings: show what the prompt looks like
            threading.Thread(target=_ask, args=({"mode": "pair", "name": "Example laptop", "device": "example",
                                                  "kind": "tailnet", "code": "123456", "timeout": 30},), daemon=True).start()
            return self._send(200, {"ok": True})
        return self._send(404, {"error": "not found"})

    def upload(self, q):
        dev = self._device()
        if not dev or dev.get("view_only") or not trust.SETTINGS["files"]:
            return self._send(403, {"error": "Sending files is not allowed for this device."})
        name = os.path.basename((q.get("name") or ["file"])[0]).strip().strip(".") or "file"
        name = "".join(c for c in name if c not in '<>:"/\\|?*' and ord(c) >= 32)[:150] or "file"
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > (8 << 30):
            return self._send(400, {"error": "bad size"})
        folder = os.environ.get("QT_REMOTE_INBOX") or os.path.join(os.path.expanduser("~"), "Downloads", "From Remote")
        os.makedirs(folder, exist_ok=True)
        base, ext = os.path.splitext(name)
        path, i = os.path.join(folder, name), 1
        while os.path.exists(path):
            path, i = os.path.join(folder, f"{base} ({i}){ext}"), i + 1
        left = n
        self._consumed = True
        try:
            with open(path + ".part", "wb") as f:
                while left:
                    chunk = self.rfile.read(min(left, 1 << 20))
                    if not chunk:
                        raise OSError("cut off")
                    f.write(chunk)
                    left -= len(chunk)
            os.replace(path + ".part", path)
        except OSError:
            try:
                os.remove(path + ".part")
            except OSError:
                pass
            return self._send(500, {"error": "upload failed"})
        trust.log("file", f"{dev['name']} sent {os.path.basename(path)}", self.who["name"])
        return self._send(200, {"ok": True, "name": os.path.basename(path)})

    # -- WebSocket session
    def ws_read(self):
        r = self.rfile
        head = r.read(2)
        if len(head) < 2:
            return None, b""
        op, ln = head[0] & 0x0F, head[1] & 0x7F
        if ln == 126:
            ln = int.from_bytes(r.read(2), "big")
        elif ln == 127:
            ln = int.from_bytes(r.read(8), "big")
        if ln > 4 << 20:
            raise ValueError("frame too big")
        mask = r.read(4) if head[1] & 0x80 else None
        data = r.read(ln)
        if mask:
            m = int.from_bytes((mask * (ln // 4 + 1))[:ln], "big")
            data = (int.from_bytes(data, "big") ^ m).to_bytes(ln, "big") if ln else b""
        return op, data

    def ws(self):
        key = self.headers.get("Sec-WebSocket-Key")
        if not key or "websocket" not in (self.headers.get("Upgrade") or "").lower():
            return self._send(400, {"error": "websocket expected"})
        origin = self.headers.get("Origin") or ""
        if urllib.parse.urlparse(origin).netloc.lower() != (self.headers.get("Host") or "").lower():
            return self._send(403, {"error": "cross-site"})
        accept = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest())
        self.send_response(101)
        self.send_header("Upgrade", "websocket")
        self.send_header("Connection", "Upgrade")
        self.send_header("Sec-WebSocket-Accept", accept.decode())
        self.end_headers()
        self.wfile.flush()
        self.close_connection = True
        self.connection.settimeout(15)
        self.connection.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)

        def say(d, op=1):
            data = json.dumps(d).encode()
            self.wfile.write(bytes([0x80 | op, len(data)]) + data if len(data) < 126 else
                             bytes([0x80 | op, 126]) + len(data).to_bytes(2, "big") + data)
            self.wfile.flush()
        try:
            op, data = self.ws_read()
            hello = json.loads(data) if op == 1 else {}
        except (OSError, ValueError):
            return
        if not trust.SETTINGS["enabled"]:
            return say({"t": "bye", "reason": "Remote connections are turned off on this PC."})
        if trust.limited(self.ip, cap=12):
            return say({"t": "bye", "reason": "Too many wrong keys. Wait a few minutes."})
        dev = trust.check_token(str(hello.get("key", "")), self.who)
        if not dev:
            trust.strike(self.ip)
            return say({"t": "bye", "reason": "This device is not paired with the PC any more.", "unpair": True})
        dev = dict(dev)
        if trust.SETTINGS["ask_each_time"] and self.kind != "local":
            say({"t": "wait", "text": "Waiting for someone at the PC to allow this session..."})
            how = _ask({"mode": "session", "name": dev["name"], "device": self.who["name"],
                        "login": self.who.get("login", ""), "kind": self.kind, "timeout": 60}) or "allow"
            if how == "deny":
                trust.log("deny", f"Session for {dev['name']} was not allowed", self.who["name"])
                return say({"t": "bye", "reason": "The PC did not allow this session."})
            if how == "view":
                dev["view_only"] = True
        trust.touch(next(d for d in trust.DEVICES if d["id"] == dev["id"]))
        s = Session(self, dev, self.who, self.ip)
        c = hello.get("cfg") or {}
        if isinstance(c, dict):
            s.handle(dict(c, t="cfg"))
        with LOCK:
            SESSIONS[s.id] = s
        trust.log("connect", f"{s.name} connected{' (view only)' if s.view_only else ''}", self.who["name"])
        show_bar()
        try:
            s.send(s.info())
            threading.Thread(target=s.stream, daemon=True).start()
            self.connection.settimeout(60)
            while s.alive:
                op, data = self.ws_read()
                if op is None or op == 8:
                    break
                if op == 9:
                    s.send(data, 10)
                    continue
                if op != 1:
                    continue
                try:
                    d = json.loads(data)
                except ValueError:
                    continue
                if isinstance(d, dict):
                    if d.get("t") == "ping":
                        s.send({"t": "pong", "ts": d.get("ts")})
                        continue
                    s.handle(d)
        except (OSError, ValueError):
            pass
        finally:
            s.alive = False
            try:
                s.input.release_all()
            except Exception:
                pass
            with LOCK:
                SESSIONS.pop(s.id, None)
            trust.log("disconnect", f"{s.name} disconnected after {int(time.time() - s.started)} s", self.who["name"])


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False  # on Windows reuse would let a second copy share the port

    def handle_error(self, request, client_address):
        if not isinstance(sys.exc_info()[1], (ConnectionError, TimeoutError)):  # dropped viewers are normal
            super().handle_error(request, client_address)


def serve(addr):
    with LOCK:
        if addr in SERVERS:
            return True
    try:
        srv = Server((addr, PORT), H)
    except OSError:
        return False
    with LOCK:
        SERVERS[addr] = srv
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return True


def unserve(addr):
    with LOCK:
        srv = SERVERS.pop(addr, None)
    if srv:
        srv.shutdown()
        srv.server_close()


def rebind():
    """Listen where the settings say: loopback + Tailscale address, or everywhere when LAN is allowed."""
    if trust.SETTINGS.get("allow_lan"):
        for a in list(SERVERS):
            if a != "0.0.0.0":
                unserve(a)
        serve("0.0.0.0")
        return
    unserve("0.0.0.0")
    serve("127.0.0.1")
    ip = trust.self_info().get("ip")
    for a in list(SERVERS):
        if a not in ("127.0.0.1", ip):
            unserve(a)
    if ip and os.environ.get("QT_REMOTE_NO_TAILNET") != "1":
        serve(ip)


def watch_tailnet():
    while True:
        time.sleep(30)
        try:
            rebind()
        except Exception:
            pass


def open_window(url):
    for edge in (r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
                 r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"):
        if os.path.exists(edge):
            subprocess.Popen([edge, f"--app={url}", "--window-size=1400,880"])
            return
    import webbrowser
    webbrowser.open(url)


def main():
    capture.dpi_aware()
    if port_up("127.0.0.1", PORT):
        if "--no-window" not in sys.argv:
            open_window(f"http://127.0.0.1:{PORT}/")
        return
    rebind()
    if not SERVERS:
        print("QT Remote: port", PORT, "is busy")
        return
    threading.Thread(target=watch_tailnet, daemon=True).start()
    print(f"QT Remote {VERSION} on", ", ".join(f"{a}:{PORT}" for a in SERVERS))
    if "--no-window" not in sys.argv:
        open_window(f"http://127.0.0.1:{PORT}/")
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
