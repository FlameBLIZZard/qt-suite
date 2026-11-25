"""Burrow - the QT Suite file explorer.

Serves http://127.0.0.1:7795 (only to this PC). Runs on its own in an Edge app
window, or as a tab inside QT Suite. Standard library + Pillow (thumbnails).

Safety rules baked in
- Nothing is ever overwritten: copies/moves/renames that collide get " (2)".
- Delete always goes to the Recycle Bin. There is no permanent delete.
- Only answers 127.0.0.1 with a matching Host header, and refuses cross-site
  requests, so web pages can't poke it.
"""
import hashlib
import json
import mimetypes
import os
import re
import shutil
import socket
import stat as statmod
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import winops  # noqa: E402

VERSION = "1.1.0"
HERE = os.path.dirname(os.path.abspath(__file__))
QT = os.path.dirname(HERE)
STATIC = os.path.join(HERE, "static")
PORT = int(os.environ.get("BURROW_PORT", "7795"))
DATA = os.environ.get("BURROW_DATA") or os.path.join(os.environ.get("LOCALAPPDATA") or HERE, "Burrow")
PREFS_PATH = os.path.join(DATA, "prefs.json")
THUMBS = os.path.join(DATA, "thumbs")
os.makedirs(THUMBS, exist_ok=True)
NOWIN = winops.NOWIN
BEAM_PORT, VOLT_PORT = 7788, 7777
LOCAL_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))

for ext, typ in ((".mkv", "video/x-matroska"), (".webp", "image/webp"), (".avif", "image/avif"), (".m4a", "audio/mp4"),
                 (".flac", "audio/flac"), (".opus", "audio/ogg"), (".md", "text/markdown"), (".ts", "text/plain"),
                 (".tsx", "text/plain"), (".pxl", "text/plain"), (".inkm", "application/json"), (".heic", "image/heic")):
    mimetypes.add_type(typ, ext)

try:
    from PIL import Image, ImageOps
    Image.MAX_IMAGE_PIXELS = 300_000_000
    try:
        import pillow_heif  # optional
        pillow_heif.register_heif_opener()
    except Exception:
        pass
except Exception:  # Burrow still works, previews just use the full image
    Image = None

IMAGE_EXT = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".ico", ".tif", ".tiff", ".avif", ".heic", ".jfif"}
VIDEO_EXT = {".mp4", ".mkv", ".webm", ".mov", ".avi", ".m4v", ".wmv", ".flv", ".3gp"}
SKIP_DIRS = {"$recycle.bin", "system volume information", "$windows.~bt", "$windows.~ws", "windowsapps",
             "node_modules", ".git", "__pycache__", ".gradle", ".venv", "venv"}


# ------------------------------------------------------------------ prefs ---
PREFS_LOCK = threading.Lock()
DEFAULT_PREFS = {"pins": [], "recent": [], "tabs": [], "active": 0, "view": "list", "sort": "name", "desc": False,
                 "hidden": False, "preview": True, "sidebar": True}


def load_prefs():
    try:
        with open(PREFS_PATH, encoding="utf-8") as f:
            p = json.load(f)
    except (OSError, ValueError):
        p = {}
    return {**DEFAULT_PREFS, **p}


def save_prefs(p):
    with PREFS_LOCK:
        tmp = PREFS_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(p, f, indent=1, ensure_ascii=False)
        os.replace(tmp, PREFS_PATH)


PREFS = load_prefs()


def note_recent(path, kind="dir"):
    with PREFS_LOCK:
        r = [x for x in PREFS.get("recent", []) if os.path.normcase(x["path"]) != os.path.normcase(path)]
        r.insert(0, {"path": path, "kind": kind, "ts": time.time()})
        PREFS["recent"] = r[:40]
    try:
        save_prefs(PREFS)
    except OSError:
        pass


# ---------------------------------------------------------------- helpers ---
def norm(p):
    p = os.path.expandvars(os.path.expanduser(str(p or "").strip().strip('"')))
    if re.fullmatch(r"[A-Za-z]:", p):
        p += "\\"
    return os.path.abspath(p) if p else p


def entry_of(de):
    try:
        st = de.stat(follow_symlinks=False)
    except OSError:
        return None
    try:
        isdir = de.is_dir()
    except OSError:
        isdir = False
    name = de.name
    return {"n": name, "d": isdir, "s": 0 if isdir else st.st_size, "m": int(st.st_mtime),
            "h": winops.is_hidden(st) or name.startswith("."), "l": de.is_symlink() or name.lower().endswith(".lnk")}


def unique(dest_dir, name):
    """'a.txt' -> 'a (2).txt' until free. Never returns an existing path."""
    base, ext = os.path.splitext(name)
    if os.path.isdir(os.path.join(dest_dir, name)):
        base, ext = name, ""
    cand = os.path.join(dest_dir, name)
    n = 2
    while os.path.lexists(cand):
        cand = os.path.join(dest_dir, f"{base} ({n}){ext}")
        n += 1
    return cand


BAD_NAME = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def check_name(name):
    name = (name or "").strip().rstrip(".")
    if not name or BAD_NAME.search(name) or name in (".", ".."):
        raise ValueError('A name can\'t be empty or use < > : " / \\ | ? *')
    if re.fullmatch(r"(con|prn|aux|nul|com\d|lpt\d)(\..*)?", name, re.I):
        raise ValueError("Windows reserves that name. Pick another.")
    return name


def is_inside(child, parent):
    c, p = os.path.normcase(os.path.abspath(child)), os.path.normcase(os.path.abspath(parent))
    return c == p or c.startswith(p.rstrip("\\/") + os.sep)


def human(n):
    for u in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024 or u == "TB":
            return f"{n:.0f} {u}" if u == "B" else f"{n:.1f} {u}"
        n /= 1024


# ------------------------------------------------------------------- jobs ---
JOBS = {}
JOBS_LOCK = threading.Lock()
UNDO = []  # stack of {"label", "steps": [("move", src, dst) | ("rmdir", path) | ("trash", path)]}


def new_job(kind, label, total=0):
    j = {"id": uuid.uuid4().hex[:10], "kind": kind, "label": label, "state": "running", "done": 0, "total": total,
         "files": 0, "error": None, "result": [], "cancel": False, "ts": time.time(), "current": ""}
    with JOBS_LOCK:
        JOBS[j["id"]] = j
        for k in [k for k, v in JOBS.items() if v["state"] != "running" and time.time() - v["ts"] > 600]:
            JOBS.pop(k, None)
    return j


class Cancelled(Exception):
    pass


def tree_size(paths, j=None):
    total = 0
    for p in paths:
        if os.path.isdir(p) and not os.path.islink(p):
            for root, dirs, files in os.walk(p):
                for f in files:
                    try:
                        total += os.lstat(os.path.join(root, f)).st_size
                    except OSError:
                        pass
                if j and j["cancel"]:
                    raise Cancelled
        else:
            try:
                total += os.lstat(p).st_size
            except OSError:
                pass
    return total


def copy_file(src, dst, j):
    with open(src, "rb") as fi, open(dst, "xb") as fo:  # "x": refuse to clobber, ever
        while True:
            if j["cancel"]:
                raise Cancelled
            b = fi.read(1 << 20)
            if not b:
                break
            fo.write(b)
            j["done"] += len(b)
    try:
        shutil.copystat(src, dst)
    except OSError:
        pass
    j["files"] += 1


def copy_any(src, dst, j):
    j["current"] = os.path.basename(src)
    if os.path.isdir(src) and not os.path.islink(src):
        os.makedirs(dst)
        for de in os.scandir(src):
            copy_any(de.path, os.path.join(dst, de.name), j)
        try:
            shutil.copystat(src, dst)
        except OSError:
            pass
    else:
        copy_file(src, dst, j)


def transfer(paths, dest, move, j):
    """Copy or move into dest. Collisions get ' (2)'. Records undo."""
    steps, made = [], []
    try:
        if not os.path.isdir(dest):
            raise ValueError("The destination folder isn't there.")
        paths = [p for p in paths if os.path.lexists(p)]
        for p in paths:
            if os.path.isdir(p) and is_inside(dest, p):
                raise ValueError(f"Can't put {os.path.basename(p)} inside itself.")
        j["total"] = tree_size(paths, j)
        for p in paths:
            if move and os.path.normcase(os.path.dirname(os.path.abspath(p))) == os.path.normcase(os.path.abspath(dest)):
                continue  # already here
            target = unique(dest, os.path.basename(p.rstrip("\\/")))
            if move:
                try:
                    if os.path.splitdrive(p)[0].lower() != os.path.splitdrive(dest)[0].lower():
                        raise OSError("cross drive")
                    os.rename(p, target)  # same drive: instant, nothing copied
                    j["done"] += tree_size([target])
                except OSError:
                    copy_any(p, target, j)
                    ok, msg = winops.recycle([p]) if winops.WIN else (False, "")
                    if not ok and os.path.exists(p):
                        raise RuntimeError(f"Copied, but couldn't remove the original: {msg}")
                steps.append(("move", target, p))
            else:
                copy_any(p, target, j)
                steps.append(("trash", target))
            made.append(target)
        j["state"] = "done"
    except Cancelled:
        j["state"] = "cancelled"
    except Exception as e:
        j["state"], j["error"] = "error", str(e)[:300]
    j["result"] = made
    if steps:
        UNDO.append({"label": ("Move" if move else "Copy") + f" {len(steps)} item(s)", "steps": steps})
    j["ts"] = time.time()


def run_job(kind, label, fn, *args):
    j = new_job(kind, label)
    threading.Thread(target=fn, args=(*args, j), daemon=True).start()
    return j


def zip_job(paths, dest_zip, j):
    try:
        j["total"] = tree_size(paths, j)
        base = os.path.dirname(os.path.abspath(paths[0]))
        with zipfile.ZipFile(dest_zip, "x", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
            for p in paths:
                walk = [(p, [], [os.path.basename(p)])] if os.path.isfile(p) else None
                if walk:
                    z.write(p, os.path.relpath(p, base))
                    j["done"] += os.path.getsize(p)
                    continue
                for root, dirs, files in os.walk(p):
                    if not files and not dirs:
                        z.writestr(os.path.relpath(root, base).replace(os.sep, "/") + "/", "")
                    for f in files:
                        if j["cancel"]:
                            raise Cancelled
                        fp = os.path.join(root, f)
                        j["current"] = f
                        try:
                            z.write(fp, os.path.relpath(fp, base))
                            j["done"] += os.path.getsize(fp)
                        except OSError:
                            pass
        j["state"], j["result"] = "done", [dest_zip]
        UNDO.append({"label": "Compress", "steps": [("trash", dest_zip)]})
    except Cancelled:
        j["state"] = "cancelled"
        winops.recycle([dest_zip])
    except Exception as e:
        j["state"], j["error"] = "error", str(e)[:300]
    j["ts"] = time.time()


def unzip_job(src, dest, j):
    try:
        with zipfile.ZipFile(src) as z:
            infos = z.infolist()
            j["total"] = sum(i.file_size for i in infos)
            os.makedirs(dest)
            for i in infos:
                if j["cancel"]:
                    raise Cancelled
                target = os.path.abspath(os.path.join(dest, i.filename))
                if not is_inside(target, dest):
                    continue  # zip-slip guard
                if i.is_dir():
                    os.makedirs(target, exist_ok=True)
                    continue
                os.makedirs(os.path.dirname(target), exist_ok=True)
                j["current"] = os.path.basename(i.filename)
                with z.open(i) as fi, open(target, "xb") as fo:
                    shutil.copyfileobj(fi, fo, 1 << 20)
                j["done"] += i.file_size
        j["state"], j["result"] = "done", [dest]
        UNDO.append({"label": "Extract", "steps": [("trash", dest)]})
    except Cancelled:
        j["state"] = "cancelled"
    except Exception as e:
        j["state"], j["error"] = "error", str(e)[:300]
    j["ts"] = time.time()


def undo():
    if not UNDO:
        return False, "Nothing to undo"
    u = UNDO.pop()
    problems = 0
    for s in reversed(u["steps"]):
        try:
            if s[0] == "move":
                _, now, before = s
                if os.path.lexists(before):
                    before = unique(os.path.dirname(before), os.path.basename(before))
                if os.path.splitdrive(now)[0].lower() == os.path.splitdrive(before)[0].lower():
                    os.rename(now, before)
                else:
                    j = {"cancel": False, "done": 0, "files": 0, "current": ""}
                    copy_any(now, before, j)
                    winops.recycle([now])
            elif s[0] == "rmdir":
                if os.path.isdir(s[1]) and not os.listdir(s[1]):
                    os.rmdir(s[1])
                else:
                    problems += 1
            elif s[0] == "restore":
                problems += not winops.restore(s[1], s[2])
            elif s[0] == "trash":
                if os.path.lexists(s[1]):
                    ok, _ = winops.recycle([s[1]])
                    problems += not ok
        except OSError:
            problems += 1
    return problems == 0, ("Undid: " + u["label"]) if not problems else "Undid what it could. Something changed since."


# ------------------------------------------------------------------ search ---
KINDS = {
    "image": IMAGE_EXT | {".svg", ".psd", ".raw", ".cr2", ".nef"},
    "video": VIDEO_EXT,
    "audio": {".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg", ".opus", ".wma"},
    "doc": {".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt", ".md", ".odt", ".csv", ".rtf", ".epub"},
    "code": {".py", ".js", ".ts", ".tsx", ".jsx", ".html", ".css", ".json", ".java", ".kt", ".c", ".cpp", ".h", ".cs",
             ".go", ".rs", ".bat", ".ps1", ".sh", ".xml", ".yml", ".yaml", ".toml", ".ini", ".gradle", ".lua", ".gd"},
    "archive": {".zip", ".rar", ".7z", ".tar", ".gz", ".bz2", ".xz", ".iso", ".apk"},
    "app": {".exe", ".msi", ".lnk", ".url", ".appx", ".msix"},
}


def parse_query(q):
    words, exts, kind = [], set(), None
    for w in q.lower().split():
        if w.startswith("kind:") or w.startswith("type:"):
            kind = w.split(":", 1)[1]
        elif w.startswith("ext:"):
            exts |= {"." + e.lstrip(".") for e in w[4:].split(",") if e}
        elif re.fullmatch(r"\*\.[\w]+", w):
            exts.add(w[1:])
        else:
            words.append(w.replace("*", ""))
    return [w for w in words if w], exts, kind


def search_iter(root, q, hidden, deadline, alive):
    """Breadth-first, so close matches show up first. Yields (entry, dir) and progress ticks."""
    words, exts, kind = parse_query(q)
    kexts = KINDS.get(kind) if kind else None
    queue, scanned = [root], 0
    while queue and time.time() < deadline and alive():
        d = queue.pop(0)
        try:
            it = os.scandir(d)
        except OSError:
            continue
        with it:
            for de in it:
                scanned += 1
                name = de.name
                low = name.lower()
                try:
                    isdir = de.is_dir(follow_symlinks=False)
                except OSError:
                    isdir = False
                if isdir:
                    if low in SKIP_DIRS or (not hidden and (low.startswith(".") or low == "appdata")):
                        continue
                    if not hidden:
                        try:
                            if winops.is_hidden(de.stat(follow_symlinks=False)):
                                continue
                        except OSError:
                            continue
                    queue.append(de.path)
                ext = os.path.splitext(low)[1]
                if exts and (isdir or ext not in exts):
                    continue
                if kexts is not None:
                    if kind in ("folder", "dir"):
                        if not isdir:
                            continue
                    elif isdir or ext not in kexts:
                        continue
                if words and not all(w in low for w in words):
                    continue
                if not words and not exts and kexts is None:
                    continue
                e = entry_of(de)
                if e and (hidden or not e["h"]):
                    e["p"] = d
                    yield e
        yield {"_tick": scanned, "dir": d}


# -------------------------------------------------------------- thumbnails ---
THUMB_SEM = threading.Semaphore(4)
FFMPEG = shutil.which("ffmpeg") or next((p for p in (
    os.path.join(os.environ.get("LOCALAPPDATA", ""), "volt-venv", "Scripts", "ffmpeg.exe"),
    os.path.join(QT, "volt", "ffmpeg.exe"), os.path.join(QT, "volt", "bin", "ffmpeg.exe")) if os.path.exists(p)), None)


def thumb_for(path, size):
    st = os.stat(path)
    key = hashlib.sha1(f"{os.path.normcase(path)}|{st.st_mtime_ns}|{st.st_size}|{size}".encode()).hexdigest()
    out = os.path.join(THUMBS, key[:2], key + ".jpg")
    if os.path.exists(out):
        return out
    os.makedirs(os.path.dirname(out), exist_ok=True)
    ext = os.path.splitext(path)[1].lower()
    tmp = out + f".{threading.get_ident()}.tmp"
    with THUMB_SEM:
        if ext in VIDEO_EXT:
            if not FFMPEG:
                return None
            r = subprocess.run([FFMPEG, "-v", "error", "-ss", "2", "-i", path, "-frames:v", "1",
                                "-vf", f"scale={size}:{size}:force_original_aspect_ratio=decrease", "-f", "mjpeg", tmp],
                               creationflags=NOWIN, timeout=20, capture_output=True)
            if r.returncode or not os.path.exists(tmp) or os.path.getsize(tmp) == 0:
                r = subprocess.run([FFMPEG, "-v", "error", "-y", "-i", path, "-frames:v", "1",
                                    "-vf", f"scale={size}:{size}:force_original_aspect_ratio=decrease", "-f", "mjpeg", tmp],
                                   creationflags=NOWIN, timeout=20, capture_output=True)
                if r.returncode or not os.path.exists(tmp):
                    return None
        else:
            if Image is None:
                return None
            with Image.open(path) as im:
                im.draft("RGB", (size, size))
                im = ImageOps.exif_transpose(im)
                im.thumbnail((size, size))
                if im.mode in ("RGBA", "LA", "P"):
                    im = im.convert("RGBA")
                    bg = Image.new("RGB", im.size, (34, 31, 39))
                    bg.paste(im, mask=im.split()[-1])
                    im = bg
                else:
                    im = im.convert("RGB")
                im.save(tmp, "JPEG", quality=82)
    os.replace(tmp, out)
    return out


def image_dims(path):
    if Image is None:
        return None
    try:
        with Image.open(path) as im:
            return list(im.size)
    except Exception:
        return None


# --------------------------------------------------------------- tie-ins ---
def port_up(port):
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.3):
            return True
    except OSError:
        return False


def local_json(port, path, body=None, timeout=30):
    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", method="POST" if body is not None else "GET",
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json"})
    try:
        with LOCAL_OPENER.open(req, timeout=timeout) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read() or b"{}").get("error")
        except ValueError:
            msg = None
        raise RuntimeError(msg or f"said {e.code}") from None


START_LOCK = threading.Lock()


def ensure(port, cwd, cmd, env=None, wait=25):
    if port_up(port):
        return True
    with START_LOCK:
        if port_up(port):
            return True
        if not os.path.exists(cmd[0]) and not shutil.which(cmd[0]):
            raise RuntimeError("not installed")
        subprocess.Popen(cmd, cwd=cwd, env=dict(os.environ, **(env or {})), creationflags=NOWIN,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        end = time.time() + wait
        while time.time() < end:
            time.sleep(0.3)
            if port_up(port):
                return True
    raise RuntimeError("didn't start in time")


def pyw():
    return shutil.which("pythonw") or sys.executable


def ensure_beam():
    return ensure(BEAM_PORT, os.path.join(QT, "beam"), [pyw(), "app.py"], {"BEAM_NO_BROWSER": "1"})


def volt_py():
    venv = os.path.join(os.environ.get("LOCALAPPDATA", ""), "volt-venv", "Scripts")
    for exe in ("pythonw.exe", "python.exe"):
        if os.path.exists(os.path.join(venv, exe)):
            return os.path.join(venv, exe)
    import importlib.util, sys  # the installed app: VOLT's engine lives in this Python
    if importlib.util.find_spec("yt_dlp") and importlib.util.find_spec("flask"):
        p = os.path.join(os.path.dirname(sys.executable), "pythonw.exe")
        return p if os.path.exists(p) else sys.executable
    return None


def ensure_volt():
    py = volt_py()
    if not py and not port_up(VOLT_PORT):
        raise RuntimeError("VOLT isn't set up yet. Open VOLT once from QT Suite.")
    return ensure(VOLT_PORT, os.path.join(QT, "volt"), [py or "", "app.py", "--no-browser"], wait=40)


def volt_folder():
    for p in (os.path.join(os.environ.get("LOCALAPPDATA", ""), "volt", "settings.json"),
              os.path.join(QT, "volt", "settings.json")):
        try:
            with open(p, encoding="utf-8") as f:
                d = json.load(f)
            if d.get("folder"):
                return os.path.expanduser(d["folder"])
        except (OSError, ValueError):
            pass
    return os.path.join(os.path.expanduser("~"), "Downloads", "VOLT")


def beam_inbox():
    try:
        with open(os.path.join(QT, "beam", "beam.json"), encoding="utf-8") as f:
            return os.path.expandvars(json.load(f).get("inbox") or "")
    except (OSError, ValueError):
        return ""


VOLT_GRABS = {}  # our id -> {url, state, job, title, path, error, pct}


def volt_grab(url, mode):
    g = {"id": uuid.uuid4().hex[:8], "url": url, "state": "reading", "pct": 0, "title": None, "thumb": None,
         "job": None, "path": None, "error": None, "mode": mode, "ts": time.time()}
    VOLT_GRABS[g["id"]] = g

    def run():
        try:
            ensure_volt()
            info = local_json(VOLT_PORT, "/api/info", {"url": url}, timeout=120)
            kind = info.get("kind")
            m = {"audio": "mp3", "video": "mp4", "best": "mp4"}.get(mode, "mp4")
            if kind in ("file", "gallery"):
                m = "original"
            elif kind == "audio":
                m = "mp3"
            g.update(title=info.get("title"), thumb=info.get("thumb"), state="queued", kind=kind)
            job = local_json(VOLT_PORT, "/api/download", {
                "url": info.get("url") or url, "engine": info.get("engine"), "title": info.get("title"),
                "thumb": info.get("thumb"), "count": info.get("count"), "site": info.get("site"), "mode": m,
                "playlist": kind == "playlist", "source": "Burrow", "kind": kind})
            g["job"] = job["id"]
            while True:
                time.sleep(0.8)
                j = next((j for j in local_json(VOLT_PORT, "/api/jobs") if j["id"] == g["job"]), None)
                if not j:
                    raise RuntimeError("The download vanished from VOLT.")
                g.update(state=j["state"], pct=j.get("pct") or 0, speed=j.get("speed"), eta=j.get("eta"))
                if j["state"] == "done":
                    g["path"] = j.get("path")
                    return
                if j["state"] in ("error", "cancelled"):
                    g["error"] = j.get("error") or j["state"]
                    return
        except Exception as e:
            g.update(state="error", error=str(e)[:300])
    threading.Thread(target=run, daemon=True).start()
    return g


HANDOFF = {
    "pixlab": (os.path.join(QT, "pixlab", "Pixlab.html"), {".pxl", ".txt"}),
    "inkmotion": (os.path.join(QT, "inkmotion", "Inkmotion.html"), {".inkm", ".json"} | IMAGE_EXT),
}
HANDOFF_JS = """<script>
(async () => {
  const p = new URLSearchParams(location.search).get('path'); if (!p) return;
  const name = p.split(/[\\\\/]/).pop();
  const r = await fetch('/api/raw?path=' + encodeURIComponent(p)); if (!r.ok) return;
  const b = await r.blob(); const f = new File([b], name, { type: b.type || 'application/octet-stream' });
  const go = () => { const dt = new DataTransfer(); dt.items.add(f);
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); document.title = name + ' - ' + document.title; };
  if (document.readyState === 'complete') setTimeout(go, 300); else addEventListener('load', () => setTimeout(go, 300));
})();
</script>"""


# ----------------------------------------------------------------- server ---
class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def ok_host(self):
        return self.headers.get("Host", "") in {f"127.0.0.1:{PORT}", f"localhost:{PORT}"}

    def ok_site(self):
        # browsers tag every request; refuse anything another website triggered
        return self.headers.get("Sec-Fetch-Site", "same-origin") in ("same-origin", "none")

    def send(self, code, body=b"", ctype="application/json", headers=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode()
        elif isinstance(body, str):
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

    def j(self, data, code=200):
        self.send(code, data)

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if not n:
            return {}
        try:
            return json.loads(self.rfile.read(n) or b"{}")
        except ValueError:
            return {}

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        if not self.ok_host():
            return self.send(403, {"error": "bad host"})
        u = urllib.parse.urlsplit(self.path)
        p, q = u.path, {k: v[0] for k, v in urllib.parse.parse_qs(u.query).items()}
        try:
            if p in ("/", "/index.html"):
                return self.static("index.html")
            if p.startswith("/static/"):
                return self.static(p[8:])
            if p == "/favicon.ico":
                return self.static("icon.svg")
            if p.startswith("/handoff/"):
                return self.handoff(p[9:], q)
            if not self.ok_site():
                return self.send(403, {"error": "cross-site"})
            fn = getattr(self, "get_" + p[5:].replace("/", "_"), None) if p.startswith("/api/") else None
            if fn:
                return fn(q)
            return self.send(404, {"error": "not found"})
        except (ConnectionError, socket.timeout):
            self.close_connection = True
        except PermissionError:
            self.j({"error": "Windows says you don't have access to that."}, 403)
        except FileNotFoundError:
            self.j({"error": "That isn't there any more."}, 404)
        except Exception as e:
            self.j({"error": str(e)[:300]}, 500)

    def do_POST(self):
        if not self.ok_host() or not self.ok_site():
            return self.send(403, {"error": "refused"})
        p = urllib.parse.urlsplit(self.path).path
        q = {k: v[0] for k, v in urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query).items()}
        try:
            if p == "/api/upload":
                return self.post_upload(q)
            fn = getattr(self, "post_" + p[5:].replace("/", "_"), None) if p.startswith("/api/") else None
            if not fn:
                return self.send(404, {"error": "not found"})
            return fn(self.body())
        except ValueError as e:
            self.j({"error": str(e)}, 400)
        except PermissionError:
            self.j({"error": "Windows says you don't have access to that."}, 403)
        except FileNotFoundError:
            self.j({"error": "That isn't there any more."}, 404)
        except FileExistsError:
            self.j({"error": "Something with that name is already there."}, 409)
        except Exception as e:
            self.j({"error": str(e)[:300]}, 500)

    # ---- static
    def static(self, name):
        full = os.path.abspath(os.path.join(STATIC, name))
        if not is_inside(full, STATIC) or not os.path.isfile(full):
            return self.send(404, {"error": "not found"})
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "image/svg+xml"):
            ctype += "; charset=utf-8"
        with open(full, "rb") as f:
            self.send(200, f.read(), ctype)

    def handoff(self, tool, q):
        if tool not in HANDOFF:
            return self.send(404, {"error": "unknown tool"})
        html_path, _ = HANDOFF[tool]
        if not os.path.exists(html_path):
            return self.send(404, "<h1>That tool isn't installed</h1>", "text/html; charset=utf-8")
        with open(html_path, encoding="utf-8") as f:
            html = f.read()
        i = html.lower().rfind("</body>")
        html = html[:i] + HANDOFF_JS + html[i:] if i >= 0 else html + HANDOFF_JS
        self.send(200, html, "text/html; charset=utf-8")

    # ---- reading
    def get_boot(self, q):
        places = winops.known_folders()
        extra = [("VOLT downloads", volt_folder(), "volt"), ("Beam inbox", beam_inbox(), "beam"),
                 ("QT tools", QT, "qt")]
        tools = [{"name": n, "path": p, "icon": i} for n, p, i in extra if p and os.path.isdir(p)]
        self.j({"version": VERSION, "places": places, "tools": tools, "drives": winops.drives(), "prefs": PREFS,
                "sep": os.sep, "home": os.path.expanduser("~"), "thumbs": Image is not None, "video_thumbs": bool(FFMPEG),
                "code": bool(shutil.which("code")), "handoff": {k: sorted(v[1]) for k, v in HANDOFF.items() if os.path.exists(v[0])}})

    def get_drives(self, q):
        self.j(winops.drives())

    def get_ls(self, q):
        path = norm(q.get("path"))
        if not os.path.isdir(path):
            if os.path.isfile(path):
                return self.j({"error": "That's a file", "file": path, "parent": os.path.dirname(path)}, 400)
            return self.j({"error": "That folder isn't there."}, 404)
        t0 = time.time()
        out = []
        with os.scandir(path) as it:
            for de in it:
                e = entry_of(de)
                if e:
                    out.append(e)
        parent = os.path.dirname(path.rstrip("\\/")) if path.rstrip("\\/") != os.path.splitdrive(path)[0] else ""
        if q.get("remember", "1") == "1":
            threading.Thread(target=note_recent, args=(path,), daemon=True).start()
        self.j({"path": path, "parent": parent, "entries": out, "ms": int((time.time() - t0) * 1000)})

    def get_complete(self, q):
        """Folder suggestions for the path bar."""
        raw = (q.get("q") or "").strip().strip('"')
        if not raw:
            return self.j([])
        val = norm(raw) if re.match(r"^[A-Za-z]:|^[~%\\/]", raw) else raw
        d, part = (val, "") if raw.endswith(("\\", "/")) else os.path.split(val)
        out = []
        try:
            with os.scandir(d) as it:
                for de in it:
                    if de.is_dir() and de.name.lower().startswith(part.lower()) and not de.name.startswith("$"):
                        out.append(os.path.join(d, de.name))
                        if len(out) >= 12:
                            break
        except OSError:
            pass
        self.j(sorted(out, key=str.lower))

    def get_search(self, q):
        root = norm(q.get("root"))
        text = (q.get("q") or "").strip()
        hidden = q.get("hidden") == "1"
        if not os.path.isdir(root) or not text:
            return self.j({"error": "Nothing to search"}, 400)
        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        alive = [True]
        batch, last, found, t0 = [], time.time(), 0, time.time()
        limit = 3000

        def flush(extra=None):
            lines = [json.dumps(e, ensure_ascii=False) for e in batch]
            if extra:
                lines.append(json.dumps(extra))
            if lines:
                try:
                    self.wfile.write(("\n".join(lines) + "\n").encode())
                    self.wfile.flush()
                except OSError:
                    alive[0] = False
            batch.clear()

        scanned = 0
        for e in search_iter(root, text, hidden, time.time() + 90, lambda: alive[0]):
            if "_tick" in e:
                scanned = e["_tick"]
                if time.time() - last > 0.12:
                    flush({"_p": scanned, "dir": e["dir"]})
                    last = time.time()
                continue
            batch.append(e)
            found += 1
            if found >= limit:
                break
            if time.time() - last > 0.12:
                flush({"_p": scanned})
                last = time.time()
        flush({"_done": True, "scanned": scanned, "found": found, "capped": found >= limit, "ms": int((time.time() - t0) * 1000)})

    def get_raw(self, q):
        path = norm(q.get("path"))
        if not os.path.isfile(path):
            return self.send(404, {"error": "not found"})
        size = os.path.getsize(path)
        ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
        start, end = 0, size - 1
        rng = self.headers.get("Range")
        code = 200
        if rng and rng.startswith("bytes="):
            a, _, b = rng[6:].split(",")[0].partition("-")
            try:
                if a:
                    start, end = int(a), int(b) if b else size - 1
                else:
                    start, end = max(0, size - int(b)), size - 1
                end = min(end, size - 1)
                code = 206
            except ValueError:
                pass
            if start > end:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Cache-Control", "private, max-age=60")
        if code == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        if q.get("dl") == "1":
            self.send_header("Content-Disposition", "attachment; filename*=UTF-8''" + urllib.parse.quote(os.path.basename(path)))
        self.end_headers()
        if self.command == "HEAD":
            return
        with open(path, "rb") as f:
            f.seek(start)
            left = end - start + 1
            while left > 0:
                b = f.read(min(1 << 20, left))
                if not b:
                    break
                self.wfile.write(b)
                left -= len(b)

    def get_thumb(self, q):
        path = norm(q.get("path"))
        size = max(32, min(1024, int(q.get("s") or 256)))
        try:
            t = thumb_for(path, size)
        except Exception:
            t = None
        if not t:
            return self.send(404, {"error": "no thumbnail"})
        with open(t, "rb") as f:
            self.send(200, f.read(), "image/jpeg", {"Cache-Control": "private, max-age=86400"})

    def get_text(self, q):
        path = norm(q.get("path"))
        size = os.path.getsize(path)
        with open(path, "rb") as f:
            raw = f.read(256 * 1024)
        if b"\x00" in raw[:8000] and not raw.startswith((b"\xff\xfe", b"\xfe\xff")):
            return self.j({"binary": True, "size": size})
        for enc in ("utf-8-sig", "utf-16") if raw.startswith((b"\xff\xfe", b"\xfe\xff")) else ("utf-8-sig", "cp1252"):
            try:
                text = raw.decode("utf-16" if raw.startswith((b"\xff\xfe", b"\xfe\xff")) else enc)
                break
            except UnicodeDecodeError:
                continue
        else:
            text = raw.decode("utf-8", "replace")
        self.j({"text": text, "cut": size > len(raw), "size": size})

    def get_stat(self, q):
        path = norm(q.get("path"))
        st = os.stat(path)
        d = {"path": path, "name": os.path.basename(path.rstrip("\\/")) or path, "dir": os.path.isdir(path),
             "size": st.st_size, "m": st.st_mtime, "c": st.st_ctime, "a": st.st_atime,
             "hidden": winops.is_hidden(st), "readonly": not os.access(path, os.W_OK),
             "mime": mimetypes.guess_type(path)[0]}
        ext = os.path.splitext(path)[1].lower()
        if d["dir"]:
            files = dirs = 0
            try:
                with os.scandir(path) as it:
                    for de in it:
                        if de.is_dir():
                            dirs += 1
                        else:
                            files += 1
            except OSError:
                pass
            d.update(files=files, dirs=dirs)
        elif ext in IMAGE_EXT:
            d["dims"] = image_dims(path)
        elif ext in (".zip", ".apk", ".jar"):
            try:
                with zipfile.ZipFile(path) as z:
                    il = z.infolist()
                    d["zip"] = {"count": len(il), "size": sum(i.file_size for i in il),
                                "names": [i.filename for i in il[:120]]}
            except (zipfile.BadZipFile, OSError):
                pass
        self.j(d)

    def get_dirsize(self, q):
        path = norm(q.get("path"))
        total = files = 0
        end = time.time() + 20
        partial = False
        for root, dirs, fs in os.walk(path):
            files += len(fs)
            for f in fs:
                try:
                    total += os.lstat(os.path.join(root, f)).st_size
                except OSError:
                    pass
            if time.time() > end:
                partial = True
                break
        self.j({"size": total, "files": files, "partial": partial})

    def get_jobs(self, q):
        with JOBS_LOCK:
            js = [{k: v for k, v in j.items() if k != "cancel"} for j in JOBS.values()]
        grabs = sorted(VOLT_GRABS.values(), key=lambda g: -g["ts"])[:10]
        self.j({"jobs": sorted(js, key=lambda j: -j["ts"]), "grabs": grabs, "undo": UNDO[-1]["label"] if UNDO else None})

    def get_fresh(self, q):
        """Newest files in Downloads, VOLT and Beam inbox, for the home page."""
        roots = [p["path"] for p in winops.known_folders() if p["name"] in ("Downloads", "Desktop")]
        roots += [volt_folder(), beam_inbox()]
        seen, out = set(), []
        for r in roots:
            if not r or not os.path.isdir(r) or os.path.normcase(r) in seen:
                continue
            seen.add(os.path.normcase(r))
            try:
                with os.scandir(r) as it:
                    for de in it:
                        e = entry_of(de)
                        if e and not e["h"] and not e["n"].lower().endswith((".part", ".crdownload", ".tmp", ".ini", ".lnk", ".url", ".ytdl")):
                            e["p"] = r
                            out.append(e)
            except OSError:
                pass
        out.sort(key=lambda e: -e["m"])
        self.j(out[:int(q.get("n") or 12)])

    def get_sig(self, q):
        """Cheap change check for the open folder (auto-refresh)."""
        path = norm(q.get("path"))
        st = os.stat(path)
        self.j({"m": st.st_mtime_ns, "n": len(os.listdir(path))})

    def get_status(self, q):
        self.j({"beam": port_up(BEAM_PORT), "volt": port_up(VOLT_PORT)})

    # ---- writing
    def post_prefs(self, d):
        for k in DEFAULT_PREFS:
            if k in d:
                PREFS[k] = d[k]
        save_prefs(PREFS)
        self.j({"ok": True})

    def post_open(self, d):
        path = norm(d.get("path"))
        if not os.path.exists(path):
            raise FileNotFoundError
        how = d.get("how") or "default"
        if how == "with":
            winops.open_with(path)
        elif how == "reveal":
            winops.reveal(path)
        elif how == "terminal":
            winops.terminal(path if os.path.isdir(path) else os.path.dirname(path))
        elif how == "code":
            code = shutil.which("code")
            if not code:
                raise ValueError("VS Code isn't installed")
            subprocess.Popen([code, path], creationflags=NOWIN)
        elif how == "props":
            winops.properties(path)
        else:
            winops.open_path(path)
            if os.path.isfile(path):
                threading.Thread(target=note_recent, args=(path, "file"), daemon=True).start()
        self.j({"ok": True})

    def post_mkdir(self, d):
        parent = norm(d.get("dir"))
        name = check_name(d.get("name") or "New folder")
        target = unique(parent, name)
        os.makedirs(target)
        UNDO.append({"label": "New folder", "steps": [("rmdir", target)]})
        self.j({"path": target})

    def post_newfile(self, d):
        parent = norm(d.get("dir"))
        name = check_name(d.get("name") or "New text file.txt")
        target = unique(parent, name)
        open(target, "x").close()
        UNDO.append({"label": "New file", "steps": [("trash", target)]})
        self.j({"path": target})

    def post_rename(self, d):
        src = norm(d.get("path"))
        name = check_name(d.get("name"))
        dst = os.path.join(os.path.dirname(src.rstrip("\\/")), name)
        if os.path.normcase(dst) == os.path.normcase(src):
            if dst != src:  # case-only change
                tmp = unique(os.path.dirname(src), name + ".burrow-tmp")
                os.rename(src, tmp)
                os.rename(tmp, dst)
            return self.j({"path": dst})
        if os.path.lexists(dst):
            raise FileExistsError
        os.rename(src, dst)
        UNDO.append({"label": "Rename", "steps": [("move", dst, src)]})
        self.j({"path": dst})

    def post_trash(self, d):
        paths = [norm(p) for p in d.get("paths", [])]
        for p in paths:
            if re.fullmatch(r"[A-Za-z]:\\?", p) or os.path.normcase(p) in (os.path.normcase(QT), os.path.normcase(HERE)):
                raise ValueError("Burrow won't remove a whole drive or the QT folder.")
        t0 = time.time()
        ok, msg = winops.recycle(paths)
        if not ok:
            return self.j({"error": msg}, 500)
        UNDO.append({"label": f"Recycle {len(paths)} item(s)", "steps": [("restore", p, t0) for p in paths]})
        self.j({"ok": True, "count": len(paths)})

    def post_renamemany(self, d):
        """Rename several at once. All-or-nothing checks first; swaps are fine."""
        items = [(norm(i.get("path")), check_name(i.get("name"))) for i in d.get("items", [])]
        items = [(src, os.path.join(os.path.dirname(src.rstrip("\\/")), name)) for src, name in items]
        items = [(a, b) for a, b in items if a != b]
        if not items:
            return self.j({"ok": True, "count": 0, "paths": []})
        srcs = {os.path.normcase(a) for a, _ in items}
        seen = set()
        for a, b in items:
            k = os.path.normcase(b)
            if k in seen:
                raise ValueError(f"Two items would both be called {os.path.basename(b)}.")
            seen.add(k)
            if not os.path.lexists(a):
                raise FileNotFoundError
            if os.path.lexists(b) and k not in srcs:
                raise FileExistsError
        tmps = []
        for a, b in items:
            t = unique(os.path.dirname(a), os.path.basename(a) + ".burrow-tmp")
            os.rename(a, t)
            tmps.append(t)
        for t, (a, b) in zip(tmps, items):
            os.rename(t, b)
        UNDO.append({"label": f"Rename {len(items)} item(s)", "steps": [("move", b, a) for a, b in items]})
        self.j({"ok": True, "count": len(items), "paths": [b for _, b in items]})

    def post_transfer(self, d):
        paths = [norm(p) for p in d.get("paths", []) if p]
        dest = norm(d.get("dest"))
        move = bool(d.get("move"))
        if not paths:
            raise ValueError("Nothing to paste")
        j = run_job("move" if move else "copy", f"{'Moving' if move else 'Copying'} {len(paths)} item(s)",
                    transfer, paths, dest, move)
        self.j(j)

    def post_paste(self, d):
        """Paste whatever is on the Windows clipboard: files (from Burrow or Explorer) or a picture."""
        dest = norm(d.get("dest"))
        paths, cut = winops.get_clip_files()
        if paths:
            j = run_job("move" if cut else "copy", f"{'Moving' if cut else 'Copying'} {len(paths)} item(s)",
                        transfer, paths, dest, cut)
            if cut:
                winops.set_clip_text("")  # a cut is used up once pasted, like Explorer
            return self.j(dict(j, kind=j["kind"]))
        im = winops.clip_image()
        if im is not None:
            target = unique(dest, time.strftime("Pasted %Y-%m-%d %H%M%S.png"))
            im.save(target, "PNG")
            UNDO.append({"label": "Paste picture", "steps": [("trash", target)]})
            return self.j({"saved": target})
        self.j({"error": "The clipboard has no files or pictures."}, 400)

    def post_clip(self, d):
        paths = [norm(p) for p in d.get("paths", [])]
        if d.get("text"):
            return self.j({"ok": winops.set_clip_text(d["text"])})
        self.j({"ok": winops.set_clip_files(paths, bool(d.get("cut")))})

    def post_zip(self, d):
        paths = [norm(p) for p in d.get("paths", [])]
        if not paths:
            raise ValueError("Nothing to compress")
        parent = os.path.dirname(paths[0].rstrip("\\/"))
        name = (os.path.splitext(os.path.basename(paths[0]))[0] if len(paths) == 1 else os.path.basename(parent) or "Archive") + ".zip"
        self.j(run_job("zip", "Compressing " + name, zip_job, paths, unique(parent, name)))

    def post_unzip(self, d):
        src = norm(d.get("path"))
        dest = unique(os.path.dirname(src), os.path.splitext(os.path.basename(src))[0])
        self.j(run_job("unzip", "Extracting " + os.path.basename(src), unzip_job, src, dest))

    def post_cancel(self, d):
        j = JOBS.get(d.get("id"))
        if j:
            j["cancel"] = True
        self.j({"ok": bool(j)})

    def post_undo(self, d):
        ok, msg = undo()
        self.j({"ok": ok, "msg": msg})

    def post_upload(self, q):
        """Files dropped in from Windows land in the open folder (copied, never overwriting)."""
        dest = norm(q.get("dir"))
        name = check_name(q.get("name"))
        n = int(self.headers.get("Content-Length") or 0)
        if not os.path.isdir(dest):
            raise FileNotFoundError
        if q.get("rel"):  # a file from inside a dropped folder: keep its sub-folders
            sub = os.path.join(dest, *[check_name(x) for x in q["rel"].replace("\\", "/").split("/") if x])
            if not is_inside(sub, dest):
                raise ValueError("bad folder")
            os.makedirs(sub, exist_ok=True)
            dest = sub
        target = unique(dest, name)
        with open(target, "xb") as f:
            left = n
            while left > 0:
                b = self.rfile.read(min(1 << 20, left))
                if not b:
                    break
                f.write(b)
                left -= len(b)
        if left > 0:
            os.remove(target)
            return self.j({"error": "Upload cut short"}, 400)
        try:
            if q.get("mtime"):
                os.utime(target, (time.time(), float(q["mtime"]) / 1000))
        except (OSError, ValueError):
            pass
        if q.get("noundo") != "1":
            UNDO.append({"label": "Drop in", "steps": [("trash", target)]})
        self.j({"path": target})

    def post_dropdir(self, d):
        """Top folder for a folder dragged in from Windows (undo recycles all of it)."""
        parent = norm(d.get("dir"))
        target = unique(parent, check_name(d.get("name")))
        os.makedirs(target)
        UNDO.append({"label": "Drop in folder", "steps": [("trash", target)]})
        self.j({"path": target})

    def post_beam(self, d):
        paths = [norm(p) for p in d.get("paths", []) if os.path.exists(norm(p))]
        if not paths:
            raise ValueError("Nothing to send")
        try:
            ensure_beam()
            r = local_json(BEAM_PORT, "/api/pc/share", {"paths": paths})
        except Exception as e:
            return self.j({"error": f"Beam {e}"}, 502)
        self.j({"ok": True, "count": len(r.get("items", []))})

    def post_volt(self, d):
        url = (d.get("url") or "").strip()
        if not re.match(r"https?://", url):
            raise ValueError("That doesn't look like a link.")
        self.j(volt_grab(url, d.get("mode") or "video"))

    def post_launch(self, d):
        """Start Beam / VOLT, or open the folder for a tool."""
        what = d.get("tool")
        if what == "beam":
            ensure_beam()
        elif what == "volt":
            ensure_volt()
        else:
            raise ValueError("unknown tool")
        self.j({"ok": True})

    def post_quit(self, d):
        self.j({"ok": True})
        threading.Timer(0.3, lambda: os._exit(0)).start()


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False


def open_window(url):
    for edge in (r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
                 r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"):
        if os.path.exists(edge):
            subprocess.Popen([edge, f"--app={url}", "--window-size=1400,880"])
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
    print(f"Burrow {VERSION} on {url}")
    srv.serve_forever()


if __name__ == "__main__":
    main()
