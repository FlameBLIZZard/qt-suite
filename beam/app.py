"""Beam - send big files between your PC and phone over the same Wi-Fi / LAN.

Pure Python standard library, no installs. Run start.bat (or `python app.py`).
The PC opens http://127.0.0.1:7788 ; phones scan the QR code shown there.

How transfers work
- PC -> phone: the PC *shares* files or folders by path (nothing is copied).
  Phones download them with HTTP Range support, so the phone's download
  manager can pause/resume. Folders download as a streamed ZIP or file by file.
- Phone -> PC: the browser uploads in chunks to a .part file. Every chunk
  is appended at a known offset, so a dropped connection resumes from the
  last byte the PC received, even after the page is reloaded.
"""
import hashlib
import json
import mimetypes
import os
import re
import secrets
import shutil
import socket
import sys
import threading
import time
import urllib.parse
import zipfile
import base64
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import drop  # noqa: E402
import beamext  # noqa: E402  Clipvault + Kharcha link
import pccontrol  # noqa: E402

VERSION = "1.2.0"
HERE = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(HERE, "static")
CONFIG_PATH = os.environ.get("BEAM_CONFIG") or os.path.join(HERE, "beam.json")
BUF = 1 << 20  # 1 MiB I/O buffer

# ---------------------------------------------------------------- config ---


def default_inbox():
    home = os.path.expanduser("~")
    dl = os.path.join(home, "Downloads")
    return os.path.join(dl if os.path.isdir(dl) else home, "Beam")


def load_config():
    cfg = {}
    try:
        with open(CONFIG_PATH, encoding="utf-8") as f:
            cfg = json.load(f)
    except (OSError, ValueError):
        pass
    changed = False
    for k, v in (("port", 7788), ("inbox", default_inbox()),
                 ("key", secrets.token_urlsafe(9)), ("open_browser", True),
                 ("clip_sync", True), ("remote", True), ("vault", True)):
        if k not in cfg:
            cfg[k] = v
            changed = True
    if os.environ.get("BEAM_PORT"):
        cfg["port"] = int(os.environ["BEAM_PORT"])
    if os.environ.get("BEAM_INBOX"):
        cfg["inbox"] = os.environ["BEAM_INBOX"]
    if changed:
        save_json(CONFIG_PATH, cfg)
    return cfg


def save_json(path, data):
    tmp = path + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=1, ensure_ascii=False)
        os.replace(tmp, path)
    except OSError as e:
        print("[beam] could not save", path, e)


CFG = load_config()
INBOX = os.path.abspath(os.path.expandvars(CFG["inbox"]))
PARTS = os.path.join(INBOX, ".beam-parts")
STATE_PATH = os.path.join(INBOX, ".beam-state.json")
os.makedirs(PARTS, exist_ok=True)
if os.name == "nt":
    try:  # hide the bookkeeping folder in Explorer
        import ctypes
        ctypes.windll.kernel32.SetFileAttributesW(PARTS, 0x02)
    except Exception:
        pass

# ----------------------------------------------------------------- state ---

LOCK = threading.RLock()
REV = [1]
REV_COND = threading.Condition(LOCK)
STATE = {"items": [], "notes": []}
ACTIVE = {}  # uid -> live upload progress (not persisted)
UPLOCKS = {}
PC = pccontrol.make_backend()
CLIPS = []      # clipboard history, newest last, memory only (can hold secrets)
CLIP_IMG = {}   # clip id -> bmp bytes
CLIP_STATE = {"ignore_seq": None, "last_text": None}
REMOTE_PEERS = {}  # ws id -> device name


def add_clip(source, text=None, bmp=None):
    with LOCK:
        if text is not None:
            CLIPS[:] = [c for c in CLIPS if c.get("text") != text]
        clip = {"id": new_id(), "from": source, "ts": time.time()}
        if text is not None:
            clip["text"] = text[:100000]
        if bmp is not None:
            CLIP_IMG[clip["id"]] = bmp
            clip["img"] = len(bmp)
        CLIPS.append(clip)
        beamext.save_clip(source, text=text, bmp=bmp)
        while len(CLIPS) > 25:
            old = CLIPS.pop(0)
            CLIP_IMG.pop(old["id"], None)
    bump()
    return clip


def set_pc_clip(text):
    PC.set_clip(text)
    CLIP_STATE["ignore_seq"] = PC.clip_seq()
    CLIP_STATE["last_text"] = text


def clip_watch():
    """Notice when something is copied on the PC and offer it to the phone."""
    seq = PC.clip_seq()
    while True:
        time.sleep(0.6)
        try:
            now = PC.clip_seq()
            if now == seq:
                continue
            seq = now
            if not CFG.get("clip_sync") or now == CLIP_STATE["ignore_seq"]:
                continue
            c = PC.get_clip()
            if c.get("text") and c["text"].strip() and c["text"] != CLIP_STATE["last_text"]:
                CLIP_STATE["last_text"] = c["text"]
                add_clip("PC", text=c["text"])
            elif c.get("bmp") and len(c["bmp"]) < 60 << 20:
                add_clip("PC", bmp=c["bmp"])
        except Exception as e:
            print("[beam] clipboard:", e)
            time.sleep(2)


def remote_cmd(d):
    """One remote-control action from the phone. Returns a small dict."""
    a = d.get("a")
    if a == "m":
        PC.move(int(d.get("x", 0)), int(d.get("y", 0)))
    elif a == "b":
        PC.button(d.get("b", "left"), d.get("s", "click"))
    elif a == "s":
        PC.scroll(int(d.get("y", 0)), int(d.get("x", 0)))
    elif a == "t":
        PC.type_text(str(d.get("t", ""))[:2000])
    elif a == "k":
        PC.key(str(d.get("k", "")), [m for m in d.get("mods", []) if m in ("ctrl", "alt", "shift", "win")])
    elif a == "bright":
        if "v" in d:
            return {"ok": PC.set_brightness(max(0, min(100, int(d["v"]))))}
        return {"v": PC.get_brightness()}
    elif a == "power":
        what = d.get("w")
        if what not in ("lock", "sleep", "shutdown", "restart", "cancel", "monitor_off"):
            return {"error": "bad power action"}
        return {"ok": PC.power(what)}
    elif a == "p":
        return {"pong": True}
    else:
        return {"error": "unknown"}
    return {}


def bump():
    with LOCK:
        REV[0] += 1
        REV_COND.notify_all()


def persist():
    with LOCK:
        data = json.loads(json.dumps(STATE))
    save_json(STATE_PATH, data)


def load_state():
    try:
        with open(STATE_PATH, encoding="utf-8") as f:
            data = json.load(f)
        STATE["items"] = [i for i in data.get("items", []) if os.path.exists(i["path"])]
        STATE["notes"] = data.get("notes", [])[-50:]
    except (OSError, ValueError, KeyError):
        pass


def dir_stats(path, limit=200000):
    total, count = 0, 0
    for root, dirs, files in os.walk(path):
        dirs[:] = [d for d in dirs if d != ".beam-parts"]
        for fn in files:
            try:
                total += os.path.getsize(os.path.join(root, fn))
                count += 1
            except OSError:
                pass
            if count >= limit:
                return total, count
    return total, count


def new_id():
    return secrets.token_hex(5)


def add_item(path, source, refresh=False):
    """Register a file/folder (by path) in the shared list. Returns the item."""
    path = os.path.abspath(path)
    if not os.path.exists(path):
        return None
    with LOCK:
        for it in STATE["items"]:
            if os.path.normcase(it["path"]) == os.path.normcase(path):
                if refresh:
                    refresh_item(it)
                    it["added"] = time.time()
                    bump()
                return it
        it = {"id": new_id(), "path": path, "name": os.path.basename(path.rstrip("\\/")) or path,
              "from": source, "added": time.time()}
        refresh_item(it)
        STATE["items"].append(it)
    bump()
    persist()
    return it


def refresh_item(it):
    p = it["path"]
    if os.path.isdir(p):
        it["kind"] = "dir"
        it["size"], it["count"] = dir_stats(p)
    else:
        it["kind"] = "file"
        try:
            it["size"] = os.path.getsize(p)
        except OSError:
            it["size"] = 0
        it["count"] = 1


def find_item(iid):
    with LOCK:
        for it in STATE["items"]:
            if it["id"] == iid:
                return it
    return None


def public_item(it):
    return {k: it.get(k) for k in ("id", "name", "kind", "size", "count", "from", "added")}


def partials():
    out = []
    try:
        names = os.listdir(PARTS)
    except OSError:
        return out
    for fn in names:
        if not fn.endswith(".json"):
            continue
        uid = fn[:-5]
        try:
            with open(os.path.join(PARTS, fn), encoding="utf-8") as f:
                meta = json.load(f)
            got = os.path.getsize(os.path.join(PARTS, uid + ".part"))
        except (OSError, ValueError):
            continue
        if uid in ACTIVE:
            continue
        out.append({"uid": uid, "rel": meta["rel"], "size": meta["size"], "got": got,
                    "from": meta.get("from", "?"), "ts": meta.get("ts", 0)})
    out.sort(key=lambda m: -m["ts"])
    return out


# --------------------------------------------------------------- helpers ---

SAFE_PART = re.compile(r'[<>:"|?*\x00-\x1f]')


def clean_rel(rel):
    """Turn a client supplied relative path into safe path parts."""
    parts = []
    for p in re.split(r"[\\/]+", rel or ""):
        p = SAFE_PART.sub("_", p).strip().rstrip(". ")
        if p and p not in (".", ".."):
            parts.append(p[:180])
    return parts or ["file"]


def unique_path(path):
    if not os.path.exists(path):
        return path
    base, ext = os.path.splitext(path)
    n = 1
    while os.path.exists(f"{base} ({n}){ext}"):
        n += 1
    return f"{base} ({n}){ext}"


def within(root, sub):
    """Resolve sub inside root; None if it escapes."""
    root = os.path.abspath(root)
    target = os.path.abspath(os.path.join(root, *[p for p in sub.split("/") if p not in ("", ".", "..")]))
    if os.path.normcase(target) == os.path.normcase(root):
        return target
    if not os.path.normcase(target).startswith(os.path.normcase(root.rstrip("\\/") + os.sep)):
        return None
    return target


def lan_ips():
    ips = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ips.append(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if ip not in ips:
                ips.append(ip)
    except OSError:
        pass
    good = [ip for ip in ips if not ip.startswith(("127.", "169.254."))]

    def rank(ip):  # typical home Wi-Fi first, virtual adapters last
        if ip.startswith("192.168."):
            return 0
        if ip.startswith("10."):
            return 1
        if is_tailscale(ip):  # reachable from anywhere on your tailnet
            return 2
        return 3
    return sorted(good, key=rank) or ["127.0.0.1"]


def is_tailscale(ip):
    p = ip.split(".")
    return len(p) == 4 and p[0] == "100" and 64 <= int(p[1]) <= 127


def device_name(ua, local):
    if local:
        return "PC"
    ua = ua or ""
    m = re.search(r"BeamDevice/(\S+)", ua)  # the Beam phone app sends the phone's own name
    if m:
        name = urllib.parse.unquote(m.group(1)).strip()
        if name:
            return name[:40]
    m = re.search(r"Android [\d.]+; ([^;)]+)", ua)
    if m and m.group(1).strip() not in ("K", "wv"):
        return re.sub(r"\s+Build/.*$", "", m.group(1).strip())
    if "iPhone" in ua:
        return "iPhone"
    if "iPad" in ua:
        return "iPad"
    if "Android" in ua or "Mobile" in ua:
        return "Phone"
    if "Windows" in ua:
        return "Windows PC"
    if "Mac OS" in ua:
        return "Mac"
    return "Device"


PICK_LOCK = threading.Lock()


def pick_dialog(kind):
    """Native file/folder picker on the PC (tkinter). Returns a list of paths."""
    with PICK_LOCK:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        root.update()
        try:
            if kind == "folder":
                p = filedialog.askdirectory(parent=root, title="Share a folder with Beam")
                paths = [p] if p else []
            else:
                paths = list(filedialog.askopenfilenames(parent=root, title="Share files with Beam"))
        finally:
            root.destroy()
        return [os.path.normpath(p) for p in paths]


class ZipStream:
    """Write-only, non-seekable file object for zipfile -> socket."""

    def __init__(self, w):
        self.w, self.pos = w, 0

    def write(self, b):
        self.w.write(b)
        self.pos += len(b)
        return len(b)

    def tell(self):
        return self.pos

    def flush(self):
        pass


# --------------------------------------------------------------- handler ---


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "Beam/" + VERSION
    timeout = 120

    def log_message(self, fmt, *args):  # keep the console quiet
        if os.environ.get("BEAM_DEBUG"):
            sys.stderr.write("[http] " + fmt % args + "\n")

    def setup(self):
        super().setup()
        for opt in (socket.SO_SNDBUF, socket.SO_RCVBUF):
            try:
                self.connection.setsockopt(socket.SOL_SOCKET, opt, 4 << 20)
            except OSError:
                pass
        try:
            self.connection.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        except OSError:
            pass

    # ---- plumbing
    @property
    def local(self):
        return self.client_address[0] in ("127.0.0.1", "::1", "::ffff:127.0.0.1")

    def authed(self, query):
        if self.local:
            return True
        key = CFG["key"]
        if query.get("k", [""])[0] == key or self.headers.get("X-Beam-Key") == key:
            return True
        cookie = self.headers.get("Cookie", "")
        return f"beam={key}" in cookie.replace(" ", "")

    def send(self, code, body=b"", ctype="application/json", headers=None):
        if isinstance(body, str):
            body = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def json(self, data, code=200):
        self.send(code, json.dumps(data, ensure_ascii=False))

    def body_json(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > 1 << 20:
            raise ValueError("too big")
        raw = self.rfile.read(n) if n else b"{}"
        return json.loads(raw or b"{}")

    def drain(self):
        n = int(self.headers.get("Content-Length") or 0)
        while n > 0:
            chunk = self.rfile.read(min(n, BUF))
            if not chunk:
                break
            n -= len(chunk)

    # ---- routing
    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        self.route("GET")

    def do_POST(self):
        self.route("POST")

    def do_PUT(self):
        self.route("PUT")

    def do_DELETE(self):
        self.route("DELETE")

    def route(self, method):
        u = urllib.parse.urlsplit(self.path)
        path = urllib.parse.unquote(u.path)
        q = urllib.parse.parse_qs(u.query)
        try:
            if method == "GET" and path in ("/", "/index.html"):
                return self.page(q)
            if method == "GET" and path.startswith("/static/"):
                return self.static(path[8:])
            if method == "GET" and path == "/favicon.ico":
                return self.static("icon.svg")
            if not self.authed(q):
                if method != "GET" or path.startswith("/api/"):
                    self.drain()
                    return self.json({"error": "locked", "hint": "Scan the QR code on the PC again"}, 401)
                return self.send(401, locked_page(), "text/html; charset=utf-8")
            if path == "/api/state":
                return self.api_state(q)
            if path.startswith("/api/up"):
                return self.api_upload(method, path, q)
            if method == "GET" and path.startswith("/api/ls/"):
                return self.api_ls(path[8:])
            if method == "GET" and path.startswith("/f/"):
                return self.download(path[3:], q)
            if method == "GET" and path.startswith("/z/"):
                return self.zip_download(path[3:])
            if path == "/ws/remote":
                return self.ws_remote()
            if path.startswith("/api/drop"):
                return self.api_drop(method, path[9:].strip("/"))
            if beamext.route(self, method, path, q):
                return
            if path.startswith("/api/clip"):
                return self.api_clip(method, path[9:].strip("/"))
            if method == "GET" and path.startswith("/clip/"):
                return self.clip_image(path[6:].split(".")[0])
            if method == "POST" and path == "/api/remote":
                if not CFG.get("remote"):
                    self.drain()
                    return self.json({"error": "Remote control is turned off on the PC"}, 403)
                return self.json(remote_cmd(self.body_json()))
            if method == "POST" and path == "/api/note":
                return self.api_note()
            if method == "DELETE" and path.startswith("/api/note/"):
                return self.api_note_delete(path[10:])
            if method == "DELETE" and path.startswith("/api/item/"):
                return self.api_item_delete(path[10:], q)
            if path.startswith("/api/pc/"):
                if not self.local:
                    self.drain()
                    return self.json({"error": "PC only"}, 403)
                return self.api_pc(method, path[8:])
            self.drain()
            return self.json({"error": "not found"}, 404)
        except (ConnectionError, socket.timeout, TimeoutError):
            self.close_connection = True
        except Exception as e:  # never kill the server thread silently
            import traceback
            traceback.print_exc()
            self.close_connection = True
            try:
                self.json({"error": str(e)}, 500)
            except Exception:
                pass

    # ---- pages
    def page(self, q):
        if not self.local and q.get("k", [""])[0] == CFG["key"]:
            # remember the key in a cookie and drop it from the address bar
            self.send(302, b"", "text/plain", {
                "Location": "/",
                "Set-Cookie": f"beam={CFG['key']}; Path=/; Max-Age=31536000; SameSite=Lax"})
            return
        if not self.authed(q):
            return self.send(401, locked_page(), "text/html; charset=utf-8")
        self.static("index.html")

    def static(self, name):
        full = within(STATIC, name)
        if not full or not os.path.isfile(full):
            return self.json({"error": "not found"}, 404)
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "image/svg+xml"):
            ctype += "; charset=utf-8"
        with open(full, "rb") as f:
            self.send(200, f.read(), ctype)

    # ---- state (long-poll)
    def api_state(self, q):
        since = int(q.get("rev", ["0"])[0] or 0)
        deadline = time.time() + 20
        with LOCK:
            while REV[0] == since and time.time() < deadline:
                REV_COND.wait(deadline - time.time())
            items = [public_item(i) for i in sorted(STATE["items"], key=lambda i: -i["added"])]
            notes = list(reversed(STATE["notes"]))
            active = [dict(v, uid=k) for k, v in ACTIVE.items()]
            clips = list(reversed(CLIPS))
            drops = drop.listing()
            remotes = sorted(set(REMOTE_PEERS.values()))
            rev = REV[0]
        port = self.server.server_address[1]
        ips = lan_ips()
        self.json({
            "rev": rev, "version": VERSION, "you": device_name(self.headers.get("User-Agent"), self.local),
            "local": self.local, "pc": socket.gethostname(), "items": items, "notes": notes,
            "active": active, "partials": partials(), "clips": clips, "remotes": remotes, "drops": drops,
            "settings": {"clip_sync": bool(CFG.get("clip_sync")), "remote": bool(CFG.get("remote"))},
            "inbox": INBOX if self.local else None,
            "urls": [f"http://{ip}:{port}/?k={CFG['key']}" for ip in ips] if self.local else None,
            "tailscale": next((f"http://{ip}:{port}/?k={CFG['key']}" for ip in ips if is_tailscale(ip)), None) if self.local else None,
            "vault": bool(CFG.get("vault", True)),
        })

    # ---- Beam Drop: phone shares a link, VOLT downloads it, the file comes back
    def api_drop(self, method, rest):
        if method == "GET" and rest == "hosts":
            # every address this PC answers on (home Wi-Fi first, Tailscale after), so the
            # phone app can fall back to Tailscale when it's away from home
            return self.json({"hosts": lan_ips(), "port": self.server.server_address[1],
                              "pc": socket.gethostname(), "version": VERSION, "volt": drop.volt_up()})
        if method == "GET" and not rest:
            return self.json({"drops": drop.listing()})
        if method == "POST" and not rest:
            d = self.body_json()
            try:
                it = drop.start(str(d.get("url") or d.get("text") or ""), str(d.get("mode") or "auto"),
                                device_name(self.headers.get("User-Agent"), self.local))
            except ValueError as e:
                return self.json({"error": str(e)}, 400)
            return self.json(drop.public(it))
        if method == "GET" and rest in drop.DROPS:
            return self.json(drop.public(drop.DROPS[rest]))
        if method == "POST" and rest.endswith("/cancel"):
            return self.json({"ok": drop.cancel(rest[:-7])})
        if method == "DELETE" and rest:
            drop.remove(rest)
            return self.json({"ok": True})
        self.drain()
        return self.json({"error": "That drop isn't on the PC any more."}, 404)

    # ---- uploads
    def api_upload(self, method, path, q):
        # POST /api/up            {rel, size, mtime} -> {uid, offset}
        # GET  /api/up/<uid>      -> {offset}
        # PUT  /api/up/<uid>?offset=N  (body = bytes) -> {offset, done}
        # DELETE /api/up/<uid>    cancel and remove the partial file
        rest = path[len("/api/up"):].strip("/")
        if method == "POST" and not rest:
            d = self.body_json()
            rel = "/".join(clean_rel(d.get("rel") or d.get("name")))
            size = int(d.get("size") or 0)
            mtime = str(d.get("mtime") or "")
            uid = hashlib.sha1(f"{rel}|{size}|{mtime}".encode()).hexdigest()[:20]
            part = os.path.join(PARTS, uid + ".part")
            meta_path = os.path.join(PARTS, uid + ".json")
            src = device_name(self.headers.get("User-Agent"), self.local)
            with LOCK:
                if not os.path.exists(part):
                    open(part, "wb").close()
                try:
                    mtime_s = float(mtime) / 1000 if mtime else None
                except ValueError:
                    mtime_s = None
                save_json(meta_path, {"rel": rel, "size": size, "from": src, "ts": time.time(),
                                      "batch": d.get("batch"), "mtime_s": mtime_s})
            got = os.path.getsize(part)
            if size == 0:
                return self.json(self.complete_upload(uid))
            return self.json({"uid": uid, "offset": got})
        if not re.fullmatch(r"[0-9a-f]{20}", rest):
            self.drain()
            return self.json({"error": "bad id"}, 400)
        uid = rest
        part = os.path.join(PARTS, uid + ".part")
        meta_path = os.path.join(PARTS, uid + ".json")
        if not os.path.exists(meta_path):
            self.drain()
            return self.json({"error": "unknown upload", "gone": True}, 404)
        if method == "GET":
            return self.json({"offset": os.path.getsize(part)})
        if method == "DELETE":
            with LOCK:
                ACTIVE.pop(uid, None)
            for p in (part, meta_path):
                try:
                    os.remove(p)
                except OSError:
                    pass
            bump()
            return self.json({"ok": True})
        if method != "PUT":
            self.drain()
            return self.json({"error": "bad method"}, 405)
        with open(meta_path, encoding="utf-8") as f:
            meta = json.load(f)
        offset = int(q.get("offset", ["0"])[0])
        length = int(self.headers.get("Content-Length") or 0)
        lk = UPLOCKS.setdefault(uid, threading.Lock())
        if not lk.acquire(timeout=5):
            self.drain()
            return self.json({"error": "busy", "offset": os.path.getsize(part)}, 409)
        try:
            cur = os.path.getsize(part)
            if offset != cur or offset + length > meta["size"]:
                self.drain()
                return self.json({"error": "offset", "offset": cur}, 409)
            src = meta.get("from", "?")
            with LOCK:
                a = ACTIVE.setdefault(uid, {"rel": meta["rel"], "size": meta["size"], "from": src,
                                            "got": cur, "speed": 0, "t0": time.time(), "b0": cur,
                                            "last": time.time()})
                a["last"] = time.time()
            left = length
            last_bump = time.time()
            with open(part, "r+b") as f:
                f.seek(cur)
                while left > 0:
                    chunk = self.rfile.read(min(left, BUF))
                    if not chunk:
                        break
                    f.write(chunk)
                    left -= len(chunk)
                    a["got"] = cur + (length - left)
                    now = a["last"] = time.time()
                    if now - last_bump > 0.5:
                        dt = now - a["t0"]
                        if dt > 0.4:
                            a["speed"] = int((a["got"] - a["b0"]) / dt)
                        if dt > 4:  # sliding window
                            a["t0"], a["b0"] = now, a["got"]
                        last_bump = now
                        bump()
            got = os.path.getsize(part)
            if left > 0:
                self.close_connection = True
                return
            if got >= meta["size"]:
                return self.json(self.complete_upload(uid))
            return self.json({"offset": got})
        finally:
            lk.release()

    def complete_upload(self, uid):
        part = os.path.join(PARTS, uid + ".part")
        meta_path = os.path.join(PARTS, uid + ".json")
        with open(meta_path, encoding="utf-8") as f:
            meta = json.load(f)
        parts = clean_rel(meta["rel"])
        with LOCK:
            ACTIVE.pop(uid, None)
            UPLOCKS.pop(uid, None)
            batch = meta.get("batch")
            if len(parts) > 1:
                # folder upload: keep the tree; top folder gets one name per batch
                top = parts[0]
                key = f"{batch}|{top}"
                tops = STATE.setdefault("tops", {})
                if key in tops and os.path.isdir(tops[key]):
                    top_path = tops[key]
                else:
                    top_path = unique_path(os.path.join(INBOX, top))
                    tops[key] = top_path
                    if len(tops) > 200:
                        tops.pop(next(iter(tops)))
                dest = os.path.join(top_path, *parts[1:])
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                dest = unique_path(dest)
                shutil.move(part, dest)
                item_path = top_path
            else:
                dest = unique_path(os.path.join(INBOX, parts[0]))
                shutil.move(part, dest)
                item_path = dest
            try:
                os.remove(meta_path)
            except OSError:
                pass
            try:
                if meta.get("mtime_s"):
                    os.utime(dest, (time.time(), meta["mtime_s"]))
            except OSError:
                pass
        add_item(item_path, meta.get("from", "?"), refresh=True)
        return {"done": True, "offset": meta["size"], "name": os.path.basename(dest)}

    # ---- browsing and downloads
    def resolve(self, spec):
        iid, _, sub = spec.partition("/")
        it = find_item(iid)
        if not it:
            return None, None
        if it["kind"] == "file":
            return it, it["path"] if not sub else None
        return it, within(it["path"], sub)

    def api_ls(self, spec):
        it, full = self.resolve(spec)
        if not it or not full or not os.path.isdir(full):
            return self.json({"error": "not found"}, 404)
        entries = []
        try:
            with os.scandir(full) as sc:
                for e in sc:
                    if e.name.startswith(".beam-") or e.name in ("desktop.ini", "Thumbs.db"):
                        continue
                    try:
                        isdir = e.is_dir()
                        st = e.stat()
                    except OSError:
                        continue
                    entries.append({"name": e.name, "dir": isdir, "size": 0 if isdir else st.st_size,
                                    "mtime": st.st_mtime})
        except OSError as ex:
            return self.json({"error": str(ex)}, 500)
        entries.sort(key=lambda e: (not e["dir"], e["name"].lower()))
        return self.json({"item": public_item(it), "entries": entries})

    def download(self, spec, q):
        it, full = self.resolve(spec)
        if not it or not full or not os.path.isfile(full):
            return self.json({"error": "File is gone"}, 404)
        st = os.stat(full)
        size = st.st_size
        etag = f'"{int(st.st_mtime)}-{size}"'
        start, end = 0, size - 1
        code = 200
        rng = self.headers.get("Range")
        if_range = self.headers.get("If-Range")
        if rng and (not if_range or if_range == etag):
            m = re.match(r"bytes=(\d*)-(\d*)$", rng.strip())
            if m:
                a, b = m.groups()
                if a == "" and b:
                    start = max(0, size - int(b))
                else:
                    start = int(a or 0)
                    end = min(int(b), size - 1) if b else size - 1
                if start >= size or start > end:
                    return self.send(416, b"", "text/plain", {"Content-Range": f"bytes */{size}"})
                code = 206
        name = os.path.basename(full)
        ctype = mimetypes.guess_type(name)[0] or "application/octet-stream"
        inline = q.get("inline", ["0"])[0] == "1"
        disp = "inline" if inline else "attachment"
        ascii_name = name.encode("ascii", "replace").decode().replace('"', "'").replace("?", "_")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(end - start + 1 if size else 0))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("ETag", etag)
        self.send_header("Last-Modified", self.date_time_string(st.st_mtime))
        self.send_header("Content-Disposition",
                         f"{disp}; filename=\"{ascii_name}\"; filename*=UTF-8''{urllib.parse.quote(name)}")
        if inline:
            self.send_header("Cache-Control", "private, max-age=3600")
        if code == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        if self.command == "HEAD" or size == 0:
            return
        left = end - start + 1
        with open(full, "rb") as f:
            f.seek(start)
            while left > 0:
                chunk = f.read(min(left, 4 * BUF))
                if not chunk:
                    break
                self.wfile.write(chunk)
                left -= len(chunk)

    def zip_download(self, spec):
        it, full = self.resolve(spec)
        if not it or not full or not os.path.isdir(full):
            return self.json({"error": "Folder is gone"}, 404)
        name = os.path.basename(full.rstrip("\\/")) or "folder"
        self.close_connection = True
        self.send_response(200)
        self.send_header("Content-Type", "application/zip")
        self.send_header("Content-Disposition",
                         f"attachment; filename=\"folder.zip\"; filename*=UTF-8''{urllib.parse.quote(name)}.zip")
        self.send_header("Connection", "close")
        self.end_headers()
        if self.command == "HEAD":
            return
        out = ZipStream(self.wfile)
        with zipfile.ZipFile(out, "w", zipfile.ZIP_STORED, allowZip64=True) as z:
            for root, dirs, files in os.walk(full):
                dirs[:] = sorted(d for d in dirs if d != ".beam-parts")
                for fn in sorted(files):
                    p = os.path.join(root, fn)
                    arc = os.path.join(name, os.path.relpath(p, full)).replace(os.sep, "/")
                    try:
                        st = os.stat(p)
                        zi = zipfile.ZipInfo(arc, time.localtime(max(st.st_mtime, 315532800))[:6])
                        zi.compress_type = zipfile.ZIP_STORED
                        zi.file_size = st.st_size
                        with open(p, "rb") as src, z.open(zi, "w", force_zip64=True) as dst:
                            shutil.copyfileobj(src, dst, 4 * BUF)
                    except OSError:
                        continue

    # ---- clipboard
    def api_clip(self, method, rest):
        # POST /api/clip {text}        phone copied something -> PC clipboard + history
        # POST /api/clip/<id>/apply    put a history entry on the PC clipboard
        # DELETE /api/clip             clear history
        src = device_name(self.headers.get("User-Agent"), self.local)
        if method == "POST" and not rest:
            body = self.body_json()
            text = str(body.get("text", ""))
            if not text.strip():
                return self.json({"error": "Nothing to send"}, 400)
            clip = add_clip(src, text=text)
            applied = False
            # "auto": the phone app noticed a new copy on its own; save it, don't take over the PC clipboard
            if CFG.get("clip_sync") and not self.local and not body.get("auto"):
                try:
                    set_pc_clip(text)
                    applied = True
                except Exception as e:
                    return self.json({"error": f"PC clipboard busy: {e}", "clip": clip}, 500)
            return self.json({"clip": clip, "applied": applied})
        if method == "POST" and rest.endswith("/apply"):
            cid = rest[:-6]
            with LOCK:
                clip = next((c for c in CLIPS if c["id"] == cid), None)
            if not clip or "text" not in clip:
                return self.json({"error": "Only text can go on the PC clipboard"}, 404)
            set_pc_clip(clip["text"])
            return self.json({"ok": True})
        if method == "DELETE":
            with LOCK:
                if rest:
                    CLIPS[:] = [c for c in CLIPS if c["id"] != rest]
                    CLIP_IMG.pop(rest, None)
                else:
                    CLIPS.clear()
                    CLIP_IMG.clear()
            bump()
            return self.json({"ok": True})
        self.drain()
        return self.json({"error": "bad request"}, 400)

    def clip_image(self, cid):
        data = CLIP_IMG.get(cid)
        if not data:
            return self.json({"error": "gone"}, 404)
        self.send(200, data, "image/bmp", {
            "Content-Disposition": f'inline; filename="clipboard-{cid}.bmp"'})

    # ---- remote control over a WebSocket (stdlib only)
    def ws_remote(self):
        if not CFG.get("remote"):
            return self.json({"error": "Remote control is turned off on the PC"}, 403)
        key = self.headers.get("Sec-WebSocket-Key")
        if not key or "websocket" not in (self.headers.get("Upgrade") or "").lower():
            return self.json({"error": "websocket expected"}, 400)
        accept = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest())
        self.send_response(101)
        self.send_header("Upgrade", "websocket")
        self.send_header("Connection", "Upgrade")
        self.send_header("Sec-WebSocket-Accept", accept.decode())
        self.end_headers()
        self.close_connection = True
        self.connection.settimeout(90)
        wid = new_id()
        with LOCK:
            REMOTE_PEERS[wid] = device_name(self.headers.get("User-Agent"), self.local)
        bump()
        try:
            while CFG.get("remote"):
                op, payload = self.ws_read()
                if op is None or op == 8:
                    break
                if op == 9:
                    self.ws_send(payload, 10)
                    continue
                if op != 1:
                    continue
                try:
                    d = json.loads(payload)
                except ValueError:
                    continue
                out = remote_cmd(d)
                if out and d.get("id") is not None:
                    out["id"] = d["id"]
                    self.ws_send(json.dumps(out).encode())
        except (OSError, ValueError):
            pass
        finally:
            with LOCK:
                REMOTE_PEERS.pop(wid, None)
            bump()

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
        if ln > 1 << 20:
            raise ValueError("frame too big")
        mask = r.read(4) if head[1] & 0x80 else None
        data = r.read(ln)
        if mask:
            m = int.from_bytes((mask * (ln // 4 + 1))[:ln], "big")
            data = (int.from_bytes(data, "big") ^ m).to_bytes(ln, "big")
        return op, data

    def ws_send(self, data, op=1):
        n = len(data)
        if n < 126:
            head = bytes([0x80 | op, n])
        elif n < 65536:
            head = bytes([0x80 | op, 126]) + n.to_bytes(2, "big")
        else:
            head = bytes([0x80 | op, 127]) + n.to_bytes(8, "big")
        self.wfile.write(head + data)

    # ---- notes (text / links)
    def api_note(self):
        d = self.body_json()
        text = str(d.get("text", "")).strip()[:20000]
        if not text:
            return self.json({"error": "empty"}, 400)
        note = {"id": new_id(), "text": text, "ts": time.time(),
                "from": device_name(self.headers.get("User-Agent"), self.local)}
        with LOCK:
            STATE["notes"].append(note)
            STATE["notes"] = STATE["notes"][-50:]
        bump()
        persist()
        self.json(note)

    def api_note_delete(self, nid):
        with LOCK:
            STATE["notes"] = [n for n in STATE["notes"] if n["id"] != nid]
        bump()
        persist()
        self.json({"ok": True})

    def api_item_delete(self, iid, q):
        it = find_item(iid)
        if not it:
            return self.json({"ok": True})
        wipe = q.get("files", ["0"])[0] == "1"
        if wipe:
            if not self.local:
                return self.json({"error": "Only the PC can delete files"}, 403)
            inbox = os.path.normcase(INBOX + os.sep)
            if not os.path.normcase(it["path"]).startswith(inbox):
                return self.json({"error": "Only received files can be deleted"}, 403)
            try:
                if os.path.isdir(it["path"]):
                    shutil.rmtree(it["path"])
                else:
                    os.remove(it["path"])
            except OSError as e:
                return self.json({"error": str(e)}, 500)
        with LOCK:
            STATE["items"] = [i for i in STATE["items"] if i["id"] != iid]
        bump()
        persist()
        self.json({"ok": True})

    # ---- PC only
    def api_pc(self, method, what):
        if what in ("pick-files", "pick-folder") and method == "POST":
            try:
                paths = pick_dialog("folder" if what == "pick-folder" else "files")
            except Exception as e:
                return self.json({"error": f"Picker failed: {e}"}, 500)
            items = [public_item(i) for i in (add_item(p, "PC") for p in paths) if i]
            return self.json({"items": items})
        if what == "share" and method == "POST":
            d = self.body_json()
            items = [public_item(i) for i in (add_item(p, "PC", refresh=True) for p in d.get("paths", [])) if i]
            return self.json({"items": items})
        if what.startswith("open/") and method == "POST":
            it = find_item(what[5:])
            target = it["path"] if it else INBOX
            reveal(target)
            return self.json({"ok": True})
        if what == "settings" and method == "POST":
            d = self.body_json()
            for k in ("clip_sync", "remote"):
                if k in d:
                    CFG[k] = bool(d[k])
            save_json(CONFIG_PATH, CFG)
            bump()
            return self.json({"ok": True})
        if what == "inbox" and method == "POST":
            reveal(INBOX, select=False)
            return self.json({"ok": True})
        return self.json({"error": "not found"}, 404)


def reveal(path, select=True):
    try:
        if os.name == "nt":
            import subprocess
            if select and os.path.exists(path):
                subprocess.Popen(["explorer", "/select,", os.path.normpath(path)])
            else:
                os.startfile(path)
        elif sys.platform == "darwin":
            import subprocess
            subprocess.Popen(["open", "-R" if select else "", path])
        else:
            import subprocess
            subprocess.Popen(["xdg-open", path if not select else os.path.dirname(path)])
    except Exception as e:
        print("[beam] could not open", path, e)


def locked_page():
    return """<!doctype html><meta name=viewport content="width=device-width,initial-scale=1">
<title>Beam</title><body style="background:#0b0b0d;color:#eee;font:16px system-ui;display:grid;
place-items:center;min-height:90vh;text-align:center"><div><div style="font-size:48px">&#128274;</div>
<h2>Scan the QR code on your PC</h2><p style="color:#999">This Beam link is missing its key.<br>
Open Beam on the PC and scan the code shown there.</p></div>"""


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = os.name != "nt"  # on Windows reuse lets two servers share a port
    request_queue_size = 64


def tick():
    """Drop stale live-upload entries (client vanished mid-chunk)."""
    while True:
        time.sleep(3)
        with LOCK:
            now = time.time()
            stale = [u for u, a in ACTIVE.items() if now - a.get("last", 0) > 10]
            for u in stale:
                ACTIVE.pop(u, None)
        if stale:
            bump()


def main():
    load_state()
    drop.init(sys.modules[__name__])
    beamext.init(sys.modules[__name__])
    port = int(CFG["port"])
    try:
        srv = Server(("0.0.0.0", port), Handler)
    except OSError:
        print(f"[beam] Port {port} is busy. Beam is probably already running.")
        if CFG.get("open_browser"):
            import webbrowser
            webbrowser.open(f"http://127.0.0.1:{port}/")
        return
    threading.Thread(target=tick, daemon=True).start()
    threading.Thread(target=clip_watch, daemon=True).start()
    print(f"\n  BEAM {VERSION}  -  big file sharing over your Wi-Fi\n")
    print(f"  On this PC : http://127.0.0.1:{port}/")
    for ip in lan_ips():
        print(f"  Phone      : http://{ip}:{port}/?k={CFG['key']}")
    print(f"  Received files go to: {INBOX}")
    print("\n  If the phone can't connect, allow Python through Windows Firewall")
    print("  (Private networks) and make sure both are on the same Wi-Fi.")
    print("  Keep this window open. Close it to stop Beam.\n")
    if CFG.get("open_browser") and not os.environ.get("BEAM_NO_BROWSER"):
        import webbrowser
        threading.Timer(0.6, lambda: webbrowser.open(f"http://127.0.0.1:{port}/")).start()
    try:
        srv.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
