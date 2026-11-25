"""Daily - today at a glance, for QT Suite.

Serves http://127.0.0.1:7799 (this PC only). One page with today's spending (Kharcha, via
Beam's copy of the phone data), new photos (Lens PC), VOLT downloads and free disk space
(Space Manager). Runs on its own in an Edge app window, as a tab in QT Suite, and on the
phone through Beam at /daily/ (beam\\dailylink.py forwards to this server).

Read-only: the only thing it can change is starting a tool that's off, through QT Suite.
Env for tests: DAILY_PORT plus the overrides listed in sources.py.
"""
import json
import mimetypes
import os
import socket
import subprocess
import sys
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import sources  # noqa: E402

VERSION = "1.0.0"
STATIC = os.path.join(HERE, "static")
PORT = int(os.environ.get("DAILY_PORT", "7799"))
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("image/svg+xml", ".svg")
mimetypes.add_type("application/manifest+json", ".webmanifest")


def port_up(port):
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.25):
            return True
    except OSError:
        return False


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def ok_host(self):
        return self.headers.get("Host", "") in {f"127.0.0.1:{PORT}", f"localhost:{PORT}"}

    def ok_site(self):
        # browsers tag every request; anything another website triggers is refused
        return self.headers.get("Sec-Fetch-Site", "same-origin") in ("same-origin", "none")

    def send(self, code, body=b"", ctype="application/json", cache=False):
        if isinstance(body, (dict, list)) or body is None:
            body = json.dumps(body, ensure_ascii=False).encode()
        elif isinstance(body, str):
            body = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "max-age=86400" if cache else "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        if not self.ok_host():
            return self.send(403, {"error": "bad host"})
        u = urllib.parse.urlsplit(self.path)
        p, q = u.path, {k: v[0] for k, v in urllib.parse.parse_qs(u.query).items()}
        if p in ("/", "/index.html"):
            return self.static("index.html")
        if p == "/favicon.ico":
            return self.static("icon.svg")
        if p.startswith("/static/"):
            return self.static(p[8:])
        if not self.ok_site():
            return self.send(403, {"error": "cross-site"})
        try:
            if p == "/api/today":
                return self.send(200, sources.everything())
            if p == "/api/info":
                return self.send(200, {"version": VERSION, "port": PORT})
            if p.startswith("/api/thumb/"):
                r = sources.thumb(urllib.parse.unquote(p[11:]))
                return self.send(200, r[0], r[1], cache=True) if r else self.send(404, b"", "text/plain")
            if p.startswith("/api/full/"):
                r = sources.full(urllib.parse.unquote(p[10:]))
                return self.send(200, r[0], r[1], cache=True) if r else self.send(404, b"", "text/plain")
            if p == "/api/vthumb":
                r = sources.volt_thumb(q.get("u", ""))
                return self.send(200, r[0], r[1], cache=True) if r else self.send(404, b"", "text/plain")
        except (ConnectionError, socket.timeout):
            self.close_connection = True
            return
        except Exception as e:
            return self.send(500, {"error": str(e)[:300]})
        return self.send(404, {"error": "not found"})

    def do_POST(self):
        if not self.ok_host() or not self.ok_site():
            return self.send(403, {"error": "refused"})
        n = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(min(n, 1 << 16)) or b"{}") if n else {}
        except ValueError:
            body = {}
        if not isinstance(body, dict):
            body = {}
        p = urllib.parse.urlsplit(self.path).path
        try:
            if p == "/api/kharcha/add":
                return self.send(200, sources.add_expense(body))
            if p == "/api/grab":
                return self.send(200, sources.grab(body))
            if p.startswith("/api/kharcha/undo/"):
                return self.send(200, sources.undo_expense(p[18:]))
        except ValueError as e:
            return self.send(400, {"error": str(e)})
        if p.startswith("/api/start/"):
            try:
                return self.send(200, sources.start_tool(p[11:]))
            except ValueError as e:
                return self.send(400, {"error": str(e)})
        return self.send(404, {"error": "not found"})

    def static(self, name):
        full = os.path.abspath(os.path.join(STATIC, name))
        if not full.startswith(STATIC + os.sep) or not os.path.isfile(full):
            return self.send(404, {"error": "not found"})
        with open(full, "rb") as f:
            self.send(200, f.read(), mimetypes.guess_type(full)[0] or "application/octet-stream")


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False


def open_window(url):
    for edge in (r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
                 r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"):
        if os.path.exists(edge):
            subprocess.Popen([edge, f"--app={url}", "--window-size=1280,880"])
            return
    import webbrowser
    webbrowser.open(url)


def main():
    url = f"http://127.0.0.1:{PORT}/"
    if port_up(PORT):
        if "--no-window" not in sys.argv:
            open_window(url)
        return
    srv = Server(("127.0.0.1", PORT), H)
    if "--no-window" not in sys.argv:
        threading.Timer(0.3, open_window, args=(url,)).start()
    print(f"Daily {VERSION} on {url}")
    srv.serve_forever()


if __name__ == "__main__":
    main()
