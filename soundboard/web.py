"""Soundboard web control: the QT Suite page (and your phone) drive the same engine.

Runs a small HTTP server inside the Soundboard process on port 7791.
- This PC (127.0.0.1) can use it freely.
- Other devices on your Wi-Fi need the private key from the link shown on the page.
Every change is handed to the Tk thread through a queue, so the engine and the
classic window stay in sync and nothing touches Tk from a server thread.
"""
import json
import mimetypes
import os
import queue
import re
import secrets
import socket
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("SOUNDBOARD_PORT", "7791"))
HERE = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(HERE, "static")
SOUNDS = os.path.join(HERE, "sounds")
MAX_UPLOAD = 200 * 1024 * 1024


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
            if ip not in ips and not ip.startswith("127."):
                ips.append(ip)
    except OSError:
        pass
    for ip in tailscale_ips():
        if ip not in ips:
            ips.append(ip)
    return ips


def is_tailscale(ip):
    try:
        a, b = (int(x) for x in ip.split(".")[:2])
    except ValueError:
        return False
    return a == 100 and 64 <= b <= 127  # Tailscale hands out 100.64.0.0/10


def tailscale_ips():
    """Tailscale's address isn't always reported by gethostname(); ask the CLI if it's installed."""
    import subprocess
    try:
        out = subprocess.run(["tailscale", "ip", "-4"], capture_output=True, text=True, timeout=2,
                             creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)).stdout
        return [l.strip() for l in out.splitlines() if is_tailscale(l.strip())]
    except Exception:
        return []


def looks_like_audio(b):
    """Cheap header check for the formats the board plays (wav/aiff, mp3, ogg/opus, flac)."""
    if len(b) < 64:
        return False
    if b[:4] == b"RIFF" and b[8:12] == b"WAVE":
        return True
    if b[:4] == b"FORM" and b[8:12] in (b"AIFF", b"AIFC"):
        return True
    if b[:4] in (b"OggS", b"fLaC") or b[:3] == b"ID3":
        return True
    return b[0] == 0xFF and (b[1] & 0xE0) == 0xE0   # bare MPEG audio frame


class Web:
    def __init__(self, app):
        self.app = app
        self.q = queue.Queue()
        self.rev = 0
        cfg = app.cfg
        if not cfg.get("web_key"):
            cfg["web_key"] = secrets.token_urlsafe(12)
            app.save()
        self.key = cfg["web_key"]
        self.srv = None
        self.snap = None
        self.last_poll = 0.0

    # ---------------------------------------------------------------- Tk side
    def drain(self):
        """Called every frame on the Tk thread: run queued actions, then refresh the snapshot
        the page reads (Tk widgets are only ever read here, on their own thread)."""
        while True:
            try:
                fn, box, ev = self.q.get_nowait()
            except queue.Empty:
                break
            try:
                box["result"] = fn()
            except Exception as e:  # report back to the page instead of crashing the window
                box["error"] = str(e)
            finally:
                self.rev += 1
                ev.set()
        if self.snap is None or time.time() - self.last_poll < 3:
            try:
                self.snap = self.build_state()
            except Exception:
                pass

    def state(self):
        self.last_poll = time.time()
        return self.snap or {"rev": -1, "pads": [], "loading": True}

    def on_tk(self, fn, timeout=5.0):
        box, ev = {}, threading.Event()
        self.q.put((fn, box, ev))
        if not ev.wait(timeout):
            raise TimeoutError("Soundboard is busy (a dialog may be open on the PC)")
        if "error" in box:
            raise RuntimeError(box["error"])
        return box.get("result")

    def build_state(self):
        a = self.app
        playing = a.engine.playing_ids()
        prog = a.engine.progress()
        pads = []
        for p in a.pads:
            st = "error" if p["path"] in a.errors else ("ready" if p["path"] in a.cache else "loading")
            data = a.cache.get(p["path"])
            dur = round(len(data) / 48000, 2) if data is not None else 0
            pads.append({"id": p["id"], "name": p["name"], "hotkey": p["hotkey"], "volume": round(p["volume"] * 100),
                         "loop": p["loop"], "state": st, "error": a.errors.get(p["path"], ""),
                         "playing": p["id"] in playing, "progress": round(prog.get(p["id"], 0.0), 3),
                         "file": os.path.basename(p["path"]), "dur": dur})
        c = a.cfg
        text, ok = a._status
        return {
            "rev": self.rev, "pads": pads,
            "mic_gain": c["mic_gain"], "sound_gain": c["sound_gain"],
            "toggles": {k: bool(c[k]) for k in ("mic_to_out", "sounds_to_out", "sounds_to_mon", "mic_to_mon", "on_top")},
            "meters": {"mic": round(a.meter_val["mic"], 3), "clips": round(a.meter_val["clips"], 3)},
            "status": {"text": text.replace("●", "").strip(" —-"), "ok": ok},
            "hint": a.hint.cget("text") if hasattr(a, "hint") else "",
            "devices": {
                "api": a.api_var.get(), "mic": a.mic_var.get(), "out": a.out_var.get(), "mon": a.mon_var.get(),
                "apis": list(a.cb["api"]["values"]), "ins": ["(none)"] + list(a.dev_in),
                "outs": ["(none)"] + list(a.dev_out),
            },
            "stop_hotkey": c["stop_hotkey"],
            "tap_mode": c.get("tap_mode", "restart"),
            "warn": getattr(a, "warn", ""),
            "window": a.root.state() != "withdrawn",
        }

    # ---------------------------------------------------------------- actions
    def act(self, d):
        a, op = self.app, d.get("op")
        pad = a.pad_by_id(d.get("id", "")) if d.get("id") else None

        if op == "play":
            # trigger() is thread-safe (the hotkeys call it from their own thread too)
            if pad:
                a.trigger(pad)
            return {}
        if op == "stop":
            a.stop_pad(d["id"])
            return {}
        if op == "stop_all":
            a.stop_all()
            return {}
        if op == "random":
            ready = [p for p in a.pads if p["path"] in a.cache and not p["loop"]] or [p for p in a.pads if p["path"] in a.cache]
            if not ready:
                raise ValueError("No sounds are ready yet")
            p = secrets.choice(ready)
            a.trigger(p)
            return {"id": p["id"], "name": p["name"]}

        def tk_action():
            if op == "gain":
                v = max(0, min(200 if d["which"] == "mic" else 150, int(d["value"])))
                sc = (a.mic_meter if d["which"] == "mic" else a.out_meter).scale
                sc.set(v)  # the slider callback updates engine + cfg + label
                (a.on_mic_gain if d["which"] == "mic" else a.on_sound_gain)(v)
                a.save()
            elif op == "toggle":
                var = {"mic_to_out": a.v_mic_to_out, "sounds_to_out": a.v_sounds_to_out,
                       "sounds_to_mon": a.v_sounds_to_mon, "mic_to_mon": a.v_mic_to_mon, "on_top": a.v_on_top}[d["key"]]
                var.set(bool(d["value"]))
                a.on_toggles()
            elif op == "device":
                which, val = d["which"], d["value"]
                if which == "api":
                    a.api_var.set(val)
                    a.on_api_change()
                else:
                    {"mic": a.mic_var, "out": a.out_var, "mon": a.mon_var}[which].set(val)
                    a.on_dev_change()
            elif op == "refresh":
                a.on_refresh()
            elif op == "pad" and pad:
                if "name" in d and str(d["name"]).strip():
                    pad["name"] = str(d["name"]).strip()[:60]
                if "volume" in d:
                    pad["volume"] = max(0, min(300, int(d["volume"]))) / 100
                    a.engine.set_volume(pad["id"], pad["volume"])
                if "loop" in d:
                    pad["loop"] = bool(d["loop"])
                    if not pad["loop"]:
                        a.engine.stop_pad(pad["id"])
                if "hotkey" in d:
                    a.assign_hotkey(pad, str(d["hotkey"]))
                a.rebuild_pads()
                a.save()
            elif op == "move" and pad:
                a.move(pad, -1 if int(d["dir"]) < 0 else 1)
            elif op == "reorder":
                order = d.get("order", [])
                by = {p["id"]: p for p in a.pads}
                if sorted(order) == sorted(by):
                    a.pads[:] = [by[i] for i in order]
                    a.rebuild_pads()
                    a.save()
            elif op == "remove" and pad:
                a.remove(pad)
            elif op == "reload" and pad:
                a.reload(pad)
            elif op == "stop_hotkey":
                hk = str(d.get("value", ""))
                a.cfg["stop_hotkey"] = hk
                a.register_hotkeys()
                a.refresh_stop_btn()
                a.save()
            elif op == "tap_mode":
                a.cfg["tap_mode"] = "stop" if d.get("value") == "stop" else "restart"
                a.save()
            elif op == "add_dialog":
                a.root.after(10, a.add_sounds)
            elif op == "folder_dialog":
                a.root.after(10, a.add_folder)
            elif op == "quit":
                a.root.after(200, a.on_close)
            elif op == "window":
                if d.get("show"):
                    a.root.deiconify()
                    a.root.lift()
                    a.root.focus_force()
                else:
                    a.root.withdraw()
            else:
                raise ValueError("unknown action")
            return {}

        return self.on_tk(tk_action)

    def add_upload(self, name, data):
        os.makedirs(SOUNDS, exist_ok=True)
        base = re.sub(r'[\\/:*?"<>|]+', "_", os.path.basename(name)).strip() or "sound.wav"
        stem, ext = os.path.splitext(base)
        if ext.lower() not in (".wav", ".mp3", ".ogg", ".flac", ".aif", ".aiff", ".opus"):
            raise ValueError("Not an audio file: " + base)
        if not looks_like_audio(data):   # an empty or garbled upload would only make a pad that can't play
            raise ValueError(base + " isn't a sound file this board can play")
        path, n = os.path.join(SOUNDS, base), 1
        while os.path.exists(path):
            n += 1
            path = os.path.join(SOUNDS, f"{stem} ({n}){ext}")
        with open(path, "wb") as f:
            f.write(data)

        def add():
            self.app.add_pad(os.path.normpath(path))
            self.app.rebuild_pads()
            self.app.save()
        self.on_tk(add)
        return os.path.basename(path)

    # ---------------------------------------------------------------- server
    def start(self):
        web = self

        class H(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *a):
                pass

            def local(self):
                return self.client_address[0] in ("127.0.0.1", "::1")

            def authed(self, q):
                if self.local():
                    return self.headers.get("Host", "").split(":")[0] in ("127.0.0.1", "localhost")
                k = (q.get("k") or [""])[0]
                ck = self.headers.get("Cookie", "")
                return secrets.compare_digest(k, web.key) or f"sbkey={web.key}" in ck

            def send(self, code, body, ctype="application/json", extra=None):
                if isinstance(body, (dict, list)):
                    body = json.dumps(body).encode()
                elif isinstance(body, str):
                    body = body.encode()
                self.send_response(code)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                for k, v in (extra or {}).items():
                    self.send_header(k, v)
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):
                u = urllib.parse.urlparse(self.path)
                q = urllib.parse.parse_qs(u.query)
                if not self.authed(q):
                    return self.send(401, "<h1>Open Soundboard from the link on your PC.</h1>", "text/html; charset=utf-8")
                if u.path == "/api/state":
                    try:
                        return self.send(200, web.state())
                    except Exception as e:
                        return self.send(500, {"error": str(e)})
                if u.path == "/api/link":
                    ips = lan_ips()
                    links = [{"url": f"http://{ip}:{PORT}/?k={web.key}", "kind": "tailscale" if is_tailscale(ip) else "wifi"}
                             for ip in ips]
                    links.sort(key=lambda l: l["kind"] != "wifi")
                    return self.send(200, {"links": [l["url"] for l in links], "items": links})
                if u.path == "/api/audio":
                    # let a phone (or this page) preview a clip on its own speaker, without sending it out
                    pid = (q.get("id") or [""])[0]
                    pad = next((p for p in web.app.pads if p["id"] == pid), None)
                    if not pad or not os.path.isfile(pad["path"]):
                        return self.send(404, {"error": "That sound file is missing"})
                    ctype = mimetypes.guess_type(pad["path"])[0] or "audio/mpeg"
                    with open(pad["path"], "rb") as f:
                        return self.send(200, f.read(), ctype)
                name = "index.html" if u.path in ("/", "/index.html") else u.path.lstrip("/")
                full = os.path.normpath(os.path.join(STATIC, name))
                if not full.startswith(STATIC) or not os.path.isfile(full):
                    return self.send(404, {"error": "not found"})
                ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
                if ctype.startswith("text/") or ctype.endswith("javascript"):
                    ctype += "; charset=utf-8"
                with open(full, "rb") as f:
                    extra = {}
                    if not self.local() and (q.get("k") or [""])[0] == web.key:
                        extra["Set-Cookie"] = f"sbkey={web.key}; Path=/; Max-Age=31536000; SameSite=Lax"
                    self.send(200, f.read(), ctype, extra)

            def do_POST(self):
                u = urllib.parse.urlparse(self.path)
                q = urllib.parse.parse_qs(u.query)
                if not self.authed(q):
                    return self.send(401, {"error": "Open Soundboard from the link on your PC."})
                origin = self.headers.get("Origin")
                if origin and urllib.parse.urlparse(origin).netloc != self.headers.get("Host"):
                    return self.send(403, {"error": "bad origin"})
                n = int(self.headers.get("Content-Length") or 0)
                if n > MAX_UPLOAD:
                    return self.send(413, {"error": "That file is too big (200 MB max)."})
                body = self.rfile.read(n) if n else b""
                try:
                    if u.path == "/api/act":
                        return self.send(200, web.act(json.loads(body or b"{}")) or {})
                    if u.path == "/api/upload":
                        name = urllib.parse.unquote((q.get("name") or ["sound.wav"])[0])
                        return self.send(200, {"name": web.add_upload(name, body)})
                    return self.send(404, {"error": "not found"})
                except Exception as e:
                    return self.send(400, {"error": str(e)})

        try:
            self.srv = ThreadingHTTPServer(("0.0.0.0", PORT), H)
        except OSError:
            return False  # port taken (another Soundboard?) - the window still works
        self.srv.daemon_threads = True
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        return True
