"""Daily on the phone: Beam forwards /daily/... to the Daily dashboard (QT\\daily, 127.0.0.1:7799).

Called from beamext.route after Beam's key check, so only a paired phone gets through.
Open http://<pc>:7788/daily/?k=<key> once on the phone; the key is kept in Beam's cookie.
If Daily isn't running, Beam starts it (pythonw QT\\daily\\app.py --no-window).
"""
import os
import socket
import subprocess
import time
import urllib.error
import urllib.request

PORT = int(os.environ.get("BEAM_DAILY_PORT", "7799"))
DAILY_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "daily")
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def up():
    try:
        with socket.create_connection(("127.0.0.1", PORT), timeout=0.3):
            return True
    except OSError:
        return False


def _pyw():
    import sys
    p = os.path.join(os.path.dirname(sys.executable), "pythonw.exe")
    return p if os.path.exists(p) else "pythonw"


def ensure():
    if up():
        return True
    app = os.path.join(DAILY_DIR, "app.py")
    if not os.path.isfile(app):
        return False
    try:
        subprocess.Popen([_pyw(), app, "--no-window"], cwd=DAILY_DIR, creationflags=0x08000000)
    except OSError:
        return False
    for _ in range(40):
        if up():
            return True
        time.sleep(0.15)
    return False


def route(h, method, path, q, app):
    """Answer /daily and /daily/... Returns True when handled."""
    if path == "/daily":
        h.drain()
        h.send(302, b"", "text/plain", {"Location": "/daily/"})
        return True
    if not path.startswith("/daily/"):
        return False
    key = app.CFG["key"]
    if not h.local and q.get("k", [""])[0] == key:  # first visit with the key: keep it in the cookie, clean the URL
        h.drain()
        h.send(302, b"", "text/plain", {"Location": "/daily/",
                                         "Set-Cookie": f"beam={key}; Path=/; Max-Age=31536000; SameSite=Lax"})
        return True
    if method not in ("GET", "HEAD", "POST"):
        h.drain()
        h.json({"error": "not allowed"}, 405)
        return True
    if not ensure():
        h.drain()
        h.json({"error": "Daily isn't installed on the PC"}, 503)
        return True
    rest = path[6:] or "/"
    qs = h.path.split("?", 1)[1] if "?" in h.path else ""
    url = f"http://127.0.0.1:{PORT}{rest}" + (f"?{qs}" if qs and "k=" not in qs else "")
    body = None
    if method == "POST":
        n = int(h.headers.get("Content-Length") or 0)
        body = h.rfile.read(min(n, 1 << 16)) if n else b"{}"
    req = urllib.request.Request(url, data=body, method=method, headers={"Content-Type": "application/json"} if body else {})
    try:
        with OPENER.open(req, timeout=25) as r:
            data, code, hdrs = r.read(), r.status, r.headers
    except urllib.error.HTTPError as e:
        data, code, hdrs = e.read(), e.code, e.headers
    except OSError as e:
        h.json({"error": f"Daily didn't answer: {e}"}, 502)
        return True
    h.send(code, data, hdrs.get("Content-Type", "application/octet-stream"))
    return True
