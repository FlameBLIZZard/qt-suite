"""Space Manager - the QT Suite disk-space tool.

Serves http://127.0.0.1:7793 (only to this PC). Runs on its own in an Edge app
window, or as a tab inside QT Suite. Standard library only.

  Overview   free space on every drive, Recycle Bin, trend, quick wins
  Clean up   temp files and caches (never the person's own files)
  What's big folder sizes for a whole drive, biggest/old files, rebuildable
             folders (node_modules...), duplicate big files
  Reels      moves finished video-project frames to another drive
  Activity   everything it did, from the CSV log

Every move or delete needs a confirm flag that only the page's confirm dialog sends,
and core.py refuses protected folders. Env for tests: SPACE_PORT, SPACE_DATA, SPACE_SANDBOX.
"""
import ctypes
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

threading.stack_size(64 * 1024 * 1024)  # deep folder trees recurse in the scanner
sys.setrecursionlimit(20000)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import core  # noqa: E402

VERSION = "2.0.0"
HERE = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(HERE, "static")
PORT = int(os.environ.get("SPACE_PORT", "7793"))
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("image/svg+xml", ".svg")


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

    def send(self, code, body=b"", ctype="application/json"):
        if isinstance(body, (dict, list)) or body is None:
            body = json.dumps(body, ensure_ascii=False).encode()
        elif isinstance(body, str):
            body = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        try:
            return json.loads(self.rfile.read(n) or b"{}") if n else {}
        except ValueError:
            return {}

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
        fn = getattr(self, "get_" + p[5:].replace("/", "_"), None) if p.startswith("/api/") else None
        if not fn:
            return self.send(404, {"error": "not found"})
        try:
            return fn(q)
        except Exception as e:
            return self.send(500, {"error": str(e)[:300]})

    def do_POST(self):
        if not self.ok_host() or not self.ok_site():
            return self.send(403, {"error": "refused"})
        p = urllib.parse.urlsplit(self.path).path
        fn = getattr(self, "post_" + p[5:].replace("/", "_"), None) if p.startswith("/api/") else None
        if not fn:
            return self.send(404, {"error": "not found"})
        try:
            return fn(self.body())
        except ValueError as e:
            return self.send(400, {"error": str(e)})
        except Exception as e:
            return self.send(500, {"error": str(e)[:300]})

    def static(self, name):
        full = os.path.abspath(os.path.join(STATIC, name))
        if not core.inside(full, STATIC) or not os.path.isfile(full):
            return self.send(404, {"error": "not found"})
        with open(full, "rb") as f:
            self.send(200, f.read(), mimetypes.guess_type(full)[0] or "application/octet-stream")

    # ------------------------------------------------------------------ GET
    def get_info(self, q):
        self.send(200, {"version": VERSION, "admin": core.is_admin(), "sandbox": bool(core.SANDBOX), "config": core.CONFIG,
                        "defaults": core.DEFAULT_CONFIG, "log": core.log_path(), "inbox_ok": os.path.isdir(core.CONFIG["inbox"]),
                        "scan": core.Scan.current and {"root": core.Scan.current.root, "at": int(core.Scan.current.at)}})

    def get_drives(self, q):
        self.send(200, {"drives": core.drive_list(), "bin": core.recycle_bin() or {"bytes": 0, "count": 0},
                        "history": core.history(), "wins": core.quick_wins()})

    def get_job(self, q):
        j = core.Job.ALL.get(q.get("id", ""))
        self.send(200, j.view()) if j else self.send(404, {"error": "no such job"})

    def get_jobs(self, q):
        self.send(200, [j.view() for j in core.Job.ALL.values() if j.state == "running"])

    def get_scan_view(self, q):
        v = core.scan_view(q.get("path", ""))
        self.send(200, v) if v else self.send(404, {"error": "no scan yet"})

    def get_scan_extras(self, q):
        v = core.scan_extras()
        self.send(200, v) if v else self.send(404, {"error": "no scan yet"})

    def get_log(self, q):
        try:
            limit = max(1, min(5000, int(q.get("limit", 300))))
        except ValueError:
            limit = 300
        self.send(200, core.read_log(limit))

    def get_last(self, q):
        """Latest finished result of a kind (so the page can show it again after a reload)."""
        jobs = [j for j in core.Job.ALL.values() if j.kind == q.get("kind") and j.state == "done"]
        j = max(jobs, key=lambda j: j.started) if jobs else None
        self.send(200, j.view() if j else None)

    # ----------------------------------------------------------------- POST
    def start(self, kind, fn, *args):
        busy = core.Job.running(kind)
        if busy:
            return self.send(200, busy.view())
        self.send(200, core.Job(kind, fn, *args).view())

    def post_job_cancel(self, b):
        j = core.Job.ALL.get(b.get("id", ""))
        if j:
            j.cancel = True
        self.send(200, {"ok": bool(j)})

    def post_clean_measure(self, b):
        self.start("measure", core.measure_job)

    def post_clean_run(self, b):
        if b.get("confirm") != "yes":
            raise ValueError("Not confirmed.")
        ids = [str(i) for i in b.get("ids", []) if i != "recycle"]
        empty_bin = "recycle" in b.get("ids", [])
        if empty_bin and b.get("confirm_bin") != "EMPTY":
            raise ValueError("Emptying the Recycle Bin needs its own confirmation.")
        self.start("clean", core.clean_job, ids, empty_bin)

    def post_scan(self, b):
        root = core.norm(b.get("root") or core.CONFIG["scan_root"])
        if not os.path.isdir(root):
            raise ValueError("That folder isn't there.")
        self.start("scan", core.scan_job, root)

    def post_dupes(self, b):
        self.start("dupes", core.dupes_job)

    def post_reels_scan(self, b):
        self.start("reels", core.reels_job)

    def post_reels_move(self, b):
        if b.get("confirm") != "yes":
            raise ValueError("Not confirmed.")
        self.start("reelmove", core.reel_move_job, [str(x) for x in b.get("posts", [])])

    def post_recycle(self, b):
        if b.get("confirm") != "yes":
            raise ValueError("Not confirmed.")
        res = core.recycle([str(p) for p in b.get("paths", [])][:500])
        core.forget([(r["path"], r["bytes"]) for r in res if r["ok"]])
        self.send(200, {"results": res, "freed": sum(r.get("bytes", 0) for r in res)})

    def post_inbox(self, b):
        if b.get("confirm") != "yes":
            raise ValueError("Not confirmed.")
        paths = [str(p) for p in b.get("paths", [])][:500]

        def run(job, paths):
            r = core.inbox_job(job, paths)
            core.forget([(x["path"], x["bytes"]) for x in r["results"] if x["ok"]])
            return r
        self.start("inbox", run, paths)

    def post_reveal(self, b):
        p = core.norm(b.get("path"))
        if not os.path.lexists(p):
            raise ValueError("It isn't there any more.")
        if os.path.isdir(p):
            os.startfile(p)
        else:
            subprocess.Popen(["explorer", "/select,", p])
        self.send(200, {"ok": True})

    def post_open(self, b):
        what = b.get("what")
        target = {"storage": "ms-settings:storagesense", "apps": "ms-settings:appsfeatures", "log": os.path.dirname(core.log_path()),
                  "inbox": core.CONFIG["inbox"], "bin": "shell:RecycleBinFolder"}.get(what)
        if not target:
            raise ValueError("Unknown place.")
        if what == "bin":
            subprocess.Popen(["explorer", target])
        else:
            os.startfile(target)
        self.send(200, {"ok": True})

    def post_config(self, b):
        self.send(200, core.save_config(b))

    def post_admin(self, b):
        """Restart elevated on the same port (Windows asks first). The page reconnects on its own."""
        if core.is_admin():
            return self.send(200, {"ok": True, "msg": "already admin"})
        pyw = os.path.join(os.path.dirname(sys.executable), "pythonw.exe")
        args = f'"{os.path.join(HERE, "app.py")}" --no-window --take-over'
        rc = ctypes.windll.shell32.ShellExecuteW(None, "runas", pyw if os.path.exists(pyw) else sys.executable, args, HERE, 0)
        if rc <= 32:
            return self.send(200, {"ok": False, "msg": "Windows didn't allow it (the prompt was closed)."})
        self.send(200, {"ok": True})
        threading.Timer(0.4, lambda: os._exit(0)).start()


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False


def open_window(url):
    for edge in (r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
                 r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"):
        if os.path.exists(edge):
            subprocess.Popen([edge, f"--app={url}", "--window-size=1320,860"])
            return
    import webbrowser
    webbrowser.open(url)


def main():
    url = f"http://127.0.0.1:{PORT}/"
    if "--take-over" in sys.argv:  # elevated restart: wait for the old server to let go of the port
        for _ in range(60):
            if not port_up(PORT):
                break
            time.sleep(0.2)
    elif port_up(PORT):
        if "--no-window" not in sys.argv:
            open_window(url)
        return
    srv = Server(("127.0.0.1", PORT), H)
    if "--no-window" not in sys.argv:
        threading.Timer(0.3, open_window, args=(url,)).start()
    print(f"Space Manager {VERSION} on {url}" + (f" (sandbox {core.SANDBOX})" if core.SANDBOX else ""))
    srv.serve_forever()


if __name__ == "__main__":
    main()
