"""Beam Drop: the phone shares a link to Beam, VOLT downloads it on this PC, and the
finished file is shared back through Beam so the phone app can save it.

Flow
  phone  POST /api/drop {url, mode}      -> {id}
  Beam   starts VOLT if needed, asks it to read the link and download it
  phone  GET  /api/drop/<id>             -> {state, pct, ..., files: [{name, size, url}]}
  phone  GET  /f/<item>[/<sub>]          -> the file (Range-capable, same as any Beam share)

VOLT only answers 127.0.0.1, so all VOLT traffic goes through this module.
Pure standard library, like the rest of Beam.
"""
import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

VOLT_PORT = 7777
VOLT_URL = f"http://127.0.0.1:{VOLT_PORT}"
VOLT_DIR = os.environ.get("VOLT_DIR") or os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "volt")
MODES = ("auto", "video", "audio", "best", "original")
FINAL = ("done", "error", "cancelled")

B = None            # the Beam app module (add_item, LOCK, bump, INBOX, new_id, ...)
DROPS = {}          # id -> drop dict
_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
_volt_start_lock = threading.Lock()


def init(beam_module):
    global B
    B = beam_module
    try:
        with open(_path(), encoding="utf-8") as f:
            for d in json.load(f):
                if isinstance(d, dict) and d.get("id"):
                    if d.get("state") not in FINAL:      # Beam restarted mid-drop
                        d.update(state="error", error="Beam was restarted during this drop. Share the link again.")
                    DROPS[d["id"]] = d
    except (OSError, ValueError):
        pass


def _path():
    return os.path.join(B.INBOX, ".beam-drops.json")


def _persist():
    with B.LOCK:
        keep = sorted(DROPS.values(), key=lambda d: -d["created"])[:60]
        data = json.loads(json.dumps(keep))
    try:
        B.save_json(_path(), data)
    except OSError:
        pass


def _set(d, **kw):
    with B.LOCK:
        d.update(kw)
    B.bump()
    if kw.get("state") in FINAL:
        _persist()


# ---------- talking to VOLT ----------
def volt(path, body=None, timeout=30):
    req = urllib.request.Request(VOLT_URL + path, method="POST" if body is not None else "GET",
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json", "Host": f"127.0.0.1:{VOLT_PORT}"})
    try:
        with _opener.open(req, timeout=timeout) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read() or b"{}").get("error")
        except ValueError:
            msg = None
        raise RuntimeError(msg or f"VOLT said {e.code}") from None


def volt_up():
    try:
        return "ytdlp" in volt("/api/status", timeout=3)
    except Exception:
        return False


def volt_python():
    venv = os.path.join(os.environ.get("LOCALAPPDATA", ""), "volt-venv", "Scripts")
    for exe in ("pythonw.exe", "python.exe"):
        p = os.path.join(venv, exe)
        if os.path.exists(p):
            return p
    import importlib.util, sys  # the installed app: VOLT's engine lives in this Python
    if importlib.util.find_spec("yt_dlp") and importlib.util.find_spec("flask"):
        p = os.path.join(os.path.dirname(sys.executable), "pythonw.exe")
        return p if os.path.exists(p) else sys.executable
    return None


def ensure_volt():
    """Start VOLT in the background if it isn't running. Returns True when it answers."""
    if volt_up():
        return True
    with _volt_start_lock:
        if volt_up():
            return True
        py = volt_python()
        app = os.path.join(VOLT_DIR, "app.py")
        if not py or not os.path.exists(app):
            raise RuntimeError("VOLT isn't set up on the PC yet. Run VOLT's start.bat once.")
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) | getattr(subprocess, "DETACHED_PROCESS", 0)
        subprocess.Popen([py, app, "--no-browser"], cwd=VOLT_DIR, creationflags=flags,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, close_fds=True)
        end = time.time() + 40
        while time.time() < end:
            time.sleep(0.6)
            if volt_up():
                return True
    raise RuntimeError("VOLT didn't start on the PC. Open VOLT once on the PC and try again.")


# ---------- drops ----------
URL_RE = re.compile(r"https?://[^\s<>\"']+", re.I)


def extract_url(text):
    """Share sheets send 'Title https://...' or just the link."""
    m = URL_RE.search(text or "")
    if not m:
        return None
    return m.group(0).rstrip(").,;!?»”’")


def pick_mode(kind, want):
    want = want if want in MODES else "auto"
    if kind in ("file", "gallery"):
        return "original"
    if kind == "audio":
        return "mp3"
    # video / playlist
    return {"audio": "mp3", "best": "mp4", "original": "mp4"}.get(want, "phone")


def start(text, want, device):
    url = extract_url(text)
    if not url:
        raise ValueError("That share didn't contain a link.")
    did = B.new_id()
    d = dict(id=did, url=url, want=want if want in MODES else "auto", device=device, state="reading",
             pct=0, title=None, thumb=None, site=None, speed=None, eta=None, error=None, files=[],
             created=time.time(), job=None, mode=None)
    with B.LOCK:
        DROPS[did] = d
    B.bump()
    threading.Thread(target=_run, args=(d,), daemon=True).start()
    return d


def _run(d):
    try:
        ensure_volt()
        info = volt("/api/info", {"url": d["url"]}, timeout=120)
        kind = info.get("kind")
        mode = pick_mode(kind, d["want"])
        _set(d, title=info.get("title"), thumb=info.get("thumb"), site=info.get("site"), mode=mode,
             kind=kind, state="queued")
        playlist = kind == "playlist"
        job = volt("/api/download", {
            "url": info.get("url") or d["url"], "engine": info.get("engine"), "title": info.get("title"),
            "thumb": info.get("thumb"), "count": info.get("count"), "site": info.get("site"), "mode": mode,
            "playlist": playlist, "source": d["device"], "kind": kind})
        _set(d, job=job["id"])
        while True:
            time.sleep(0.7)
            j = next((j for j in volt("/api/jobs") if j["id"] == d["job"]), None)
            if not j:
                raise RuntimeError("The download disappeared from VOLT.")
            st = j["state"]
            if st == "done":
                return _finish(d, j)
            if st in ("error", "cancelled"):
                return _set(d, state=st, error=j.get("error") or ("Cancelled on the PC" if st == "cancelled" else "Failed"))
            _set(d, state=st, pct=j.get("pct") or 0, speed=j.get("speed"), eta=j.get("eta"),
                 item=j.get("item"), items=j.get("items"))
    except Exception as e:
        _set(d, state="error", error=str(e)[:300] or "Failed")


MEDIA_SKIP = (".part", ".ytdl", ".json", ".description")


def _finish(d, j):
    path = j.get("path")
    if not path or not os.path.exists(path):
        return _set(d, state="error", error="VOLT finished but the file isn't there any more.")
    it = B.add_item(path, f"VOLT · {d['device']}", refresh=True)
    files = []
    if os.path.isfile(path):
        files.append({"name": os.path.basename(path), "size": os.path.getsize(path), "url": f"/f/{it['id']}"})
    else:
        for root, _, fs in os.walk(path):
            for fn in sorted(fs):
                if fn.endswith(MEDIA_SKIP) or fn.startswith("."):
                    continue
                full = os.path.join(root, fn)
                rel = os.path.relpath(full, path).replace(os.sep, "/")
                files.append({"name": fn, "size": os.path.getsize(full),
                              "url": f"/f/{it['id']}/" + urllib.parse.quote(rel)})
                if len(files) >= 300:
                    break
    _set(d, state="done", pct=100, files=files, item=it["id"], speed=None, eta=None, name=j.get("name"))


def cancel(did):
    d = DROPS.get(did)
    if not d:
        return False
    if d.get("job") and d["state"] not in FINAL:
        try:
            volt(f"/api/cancel/{d['job']}", {})
        except Exception:
            pass
    if d["state"] not in FINAL:
        _set(d, state="cancelled")
    return True


def remove(did):
    with B.LOCK:
        DROPS.pop(did, None)
    B.bump()
    _persist()


def public(d):
    return {k: v for k, v in d.items() if k != "job"}


def listing():
    with B.LOCK:
        return [public(d) for d in sorted(DROPS.values(), key=lambda d: -d["created"])][:30]
