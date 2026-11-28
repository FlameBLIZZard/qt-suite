"""Phone link: a small HTTPS server the phone (and friends' phones) talk to.

Listens on 0.0.0.0:7804 (QT_KIT_PHONE_PORT). HTTPS with a self-signed certificate so phone browsers
allow the camera, mic and location. Three kinds of visitor:
  * your phone     https://<pc>:7804/?k=<key>   key from the QR in Toolkit > Phone link, kept in a cookie
  * party guests   https://<pc>:7804/party/<room>  only the party endpoints, room code changes per party
  * share links    https://<pc>:7804/s/<token>    one file, expires (Temporary share links)
"""
import http.cookies
import json
import mimetypes
import os
import secrets
import socket
import ssl
import subprocess
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import common

PORT = int(os.environ.get("QT_KIT_PHONE_PORT", "7804"))
PAGES = os.path.join(common.WEB, "phone")
CERT = os.path.join(common.DATA, "phone-cert.pem")
KEY = os.path.join(common.DATA, "phone-key.pem")

ROUTES = {}         # (method, path) -> fn(req) -> (code, body, ctype?)
PARTY_ROUTES = {}   # same, for guests with a room code
PUBLIC = {}         # path prefix -> fn(req)  (share links)
_state = {"srv": None, "err": "", "seen": {}}


def route(method, path, party=False):
    def deco(fn):
        (PARTY_ROUTES if party else ROUTES)[(method, path)] = fn
        if party:
            ROUTES[(method, path)] = fn
        return fn
    return deco


def cfg():
    c = common.load("phone", {"key": "", "on": True})
    if not c["key"]:
        c["key"] = secrets.token_urlsafe(9)
        common.save("phone", c)
    return c


def new_key():
    c = cfg()
    c["key"] = secrets.token_urlsafe(9)
    common.save("phone", c)
    return c["key"]


def lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return "127.0.0.1"


_ts = {"ip": None, "t": 0}


def tailscale_ip():
    if time.time() - _ts["t"] < 300:
        return _ts["ip"]
    code, out = common.run(["tailscale", "ip", "-4"], timeout=5)
    _ts.update(ip=out.strip().splitlines()[0] if code == 0 and out.strip() else None, t=time.time())
    return _ts["ip"]


def urls(path="/", with_key=True):
    k = cfg()["key"]
    q = ("&" if "?" in path else "?") + "k=" + k if with_key else ""
    out = {"lan": f"https://{lan_ip()}:{PORT}{path}{q}"}
    ts = tailscale_ip()
    if ts:
        out["tailscale"] = f"https://{ts}:{PORT}{path}{q}"
    out["usb"] = f"https://localhost:{PORT}{path}{q}"
    return out


def status():
    seen = {ip: t for ip, t in _state["seen"].items() if time.time() - t < 120}
    return {"on": _state["srv"] is not None, "port": PORT, "err": _state["err"], "urls": urls(),
            "phones": len(seen), "seen": sorted(seen.values(), reverse=True)[:1]}


# ----------------------------------------------------------------------- certificate ---
def _openssl():
    return common.which("openssl", [r"C:\Program Files\Git\usr\bin\openssl.exe", r"C:\Program Files\Git\mingw64\bin\openssl.exe"])


def ensure_cert():
    if os.path.exists(CERT) and os.path.exists(KEY):
        return True
    exe = _openssl()
    if not exe:
        _state["err"] = "openssl not found (comes with Git for Windows)"
        return False
    ips = {"127.0.0.1", lan_ip()}
    ts = tailscale_ip()
    if ts:
        ips.add(ts)
    san = "subjectAltName=DNS:localhost,DNS:" + socket.gethostname() + "," + ",".join("IP:" + i for i in sorted(ips))
    code, out = common.run([exe, "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", KEY, "-out", CERT,
                            "-days", "3650", "-subj", "/CN=QT Suite phone link", "-addext", san], timeout=60)
    if code != 0:
        _state["err"] = "couldn't make the certificate: " + out[-200:]
        return False
    return True


# --------------------------------------------------------------------------- server ---
class Req:
    def __init__(self, h, path, query, body):
        self.h, self.path, self.query, self.body = h, path, query, body
        self.ip = h.client_address[0]

    def json(self):
        try:
            v = json.loads(self.body or b"{}")
            return v if isinstance(v, dict) else {}
        except ValueError:
            return {}

    def q(self, k, d=""):
        return (self.query.get(k) or [d])[0]


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "QTPhone"

    def log_message(self, *a):
        pass

    def _out(self, code, body=b"", ctype="application/json", headers=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode()
        elif isinstance(body, str):
            body = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _authed(self, query):
        key = cfg()["key"]
        if (query.get("k") or [""])[0] == key:
            return True
        c = http.cookies.SimpleCookie(self.headers.get("Cookie", ""))
        return "qtk" in c and secrets.compare_digest(c["qtk"].value, key)

    def _page(self, name, set_cookie=False):
        p = os.path.join(PAGES, os.path.basename(name))
        if not os.path.isfile(p):
            return self._out(404, {"error": "not found"})
        with open(p, "rb") as f:
            data = f.read()
        hdr = {}
        if set_cookie:
            hdr["Set-Cookie"] = f"qtk={cfg()['key']}; Path=/; Max-Age=31536000; Secure; HttpOnly; SameSite=Lax"
        self._out(200, data, mimetypes.guess_type(p)[0] or "application/octet-stream", hdr)

    def _handle(self, method):
        u = urllib.parse.urlparse(self.path)
        path, query = u.path, urllib.parse.parse_qs(u.query)
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(min(n, 8 << 20)) if n else b""
        req = Req(self, path, query, body)
        for pre, fn in PUBLIC.items():
            if path.startswith(pre):
                return fn(req)
        if path.startswith("/assets/"):       # css/js/icons shared by every page
            return self._page(path[8:])
        if path.startswith("/party"):
            fn = PARTY_ROUTES.get((method, path[6:])) if path.startswith("/party/api/") else None
            if fn:
                return self._result(fn(req))
            return self._page("party.html")
        authed = self._authed(query)
        if not authed:
            return self._out(401, "<h1 style='font-family:sans-serif'>Scan the QR code in QT Suite &gt; Toolkit &gt; Phone link.</h1>", "text/html")
        _state["seen"][req.ip] = time.time()
        if path.startswith("/api/"):
            fn = ROUTES.get((method, path))
            if not fn:
                return self._out(404, {"error": "no such endpoint"})
            return self._result(fn(req))
        page = "index.html" if path in ("/", "") else path.strip("/") + ".html"
        return self._page(page, set_cookie=bool(query.get("k")))

    def _result(self, r):
        if r is None:
            return   # the handler wrote the response itself
        code, body = r[0], r[1]
        ctype = r[2] if len(r) > 2 else "application/json"
        hdr = r[3] if len(r) > 3 else None
        return self._out(code, body, ctype, hdr)

    def do_GET(self):
        try:
            self._handle("GET")
        except (ConnectionError, ssl.SSLError):
            pass

    def do_HEAD(self):
        self.do_GET()

    def do_POST(self):
        try:
            self._handle("POST")
        except (ConnectionError, ssl.SSLError):
            pass


class Srv(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False

    def handle_error(self, request, client_address):
        pass


PARTY_PORT = int(os.environ.get("QT_KIT_PARTY_PORT", "7803"))


class PartyH(H):
    """Plain HTTP for friends' phones (no certificate warning): party pages and shared assets only."""

    def _handle(self, method):
        u = urllib.parse.urlparse(self.path)
        if not (u.path.startswith(("/party", "/assets/", "/s/"))):
            return self._out(404, {"error": "not here"})
        return H._handle(self, method)


def _start_party():
    if _state.get("party"):
        return
    try:
        s = Srv(("0.0.0.0", PARTY_PORT), PartyH)
    except OSError as e:
        _state["party_err"] = str(e)
        return
    _state["party"] = s
    threading.Thread(target=s.serve_forever, name="kit-party", daemon=True).start()


def start():
    _start_party()
    if _state["srv"]:
        return True
    if not ensure_cert():
        return False
    try:
        srv = Srv(("0.0.0.0", PORT), H)
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(CERT, KEY)
        srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
    except OSError as e:
        _state["err"] = f"port {PORT} busy: {e}"
        return False
    _state["srv"], _state["err"] = srv, ""
    threading.Thread(target=srv.serve_forever, name="kit-phone", daemon=True).start()
    return True


def stop():
    s = _state["srv"]
    if s:
        _state["srv"] = None
        threading.Thread(target=s.shutdown, daemon=True).start()
        s.server_close()


# ---------------------------------------------------------- PC -> phone command queue ---
class Mailbox:
    """Long-poll queue: the PC pushes commands, phone pages pick them up."""

    def __init__(self):
        self.items, self.cv, self.seq = [], threading.Condition(), 0

    def push(self, what, **data):
        with self.cv:
            self.seq += 1
            self.items.append(dict(data, what=what, id=self.seq, t=time.time()))
            self.items = self.items[-50:]
            self.cv.notify_all()
            return self.seq

    def wait(self, after, timeout=25):
        end = time.time() + timeout
        with self.cv:
            while True:
                new = [i for i in self.items if i["id"] > after and time.time() - i["t"] < 120]
                if new or time.time() >= end:
                    return new, self.seq
                self.cv.wait(max(0.1, end - time.time()))


phone_box = Mailbox()


@route("GET", "/api/hello")
def _hello(req):
    return 200, {"ok": True, "pc": socket.gethostname(), "t": time.time()}


@route("GET", "/api/cmds")
def _cmds(req):
    after = int(req.q("after", "0") or 0)
    if after < 0 or after > phone_box.seq:
        after = phone_box.seq
    items, seq = phone_box.wait(after, 20)
    return 200, {"items": items, "seq": seq}
