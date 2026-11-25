"""Lens PC - your phone's Lens gallery and your PC photo folders in one place.

Serves http://127.0.0.1:7797 (this PC only). Runs on its own in an Edge app window, or as
a tab in QT Suite. The phone library arrives through Beam (QT\\beam\\lenslink.py) and the
Beam phone app; the Lens phone app itself stays offline.

- One timeline of phone + PC photos and videos, albums, and the people Lens found.
- Word search across both with the same MobileCLIP model the phone uses, plus tags,
  text in photos, names and folders.
- Pull phone originals to the PC (Pictures\\From phone), send PC photos to the phone.
- Photos hidden in Lens never show here.
"""
import json
import mimetypes
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import clip as cliplib  # noqa: E402
import pcindex  # noqa: E402
import phonelib  # noqa: E402
import phonemean  # noqa: E402

VERSION = "1.1.0"
QT = os.path.dirname(HERE)
STATIC = os.path.join(HERE, "static")
PORT = int(os.environ.get("LENSPC_PORT", "7797"))
DATA = os.environ.get("LENSPC_DATA") or phonelib.LENS_PATHS.get("lenspc_data") or os.path.join(os.environ.get("LOCALAPPDATA") or HERE, "LensPC")
os.makedirs(DATA, exist_ok=True)
PREFS_PATH = os.path.join(DATA, "prefs.json")
BEAM_PORT = int(os.environ.get("LENSPC_BEAM_PORT", "7788"))
ORIGINALS = os.environ.get("BEAM_LENS_ORIGINALS") or phonelib.LENS_PATHS.get("originals") or os.path.join(os.path.expanduser("~"), "Pictures", "From phone")
NOWIN = 0x08000000
LOCAL = urllib.request.build_opener(urllib.request.ProxyHandler({}))
for ext, typ in ((".webp", "image/webp"), (".heic", "image/heic"), (".mkv", "video/x-matroska"), (".m4v", "video/mp4")):
    mimetypes.add_type(typ, ext)

try:
    from PIL import Image, ImageOps
except Exception:
    Image = None


# ------------------------------------------------------------------ prefs ---
def default_folders():
    pics = os.path.join(os.path.expanduser("~"), "Pictures")
    return [pics] if os.path.isdir(pics) else []


def load_prefs():
    try:
        with open(PREFS_PATH, encoding="utf-8") as f:
            p = json.load(f)
    except (OSError, ValueError):
        p = {}
    p.setdefault("folders", default_folders())
    return p


def save_prefs():
    tmp = PREFS_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(PREFS, f, indent=1, ensure_ascii=False)
    os.replace(tmp, PREFS_PATH)


PREFS = load_prefs()

# ------------------------------------------------------------------ model ---
CLIP = {"model": None, "state": "loading"}


def load_clip():
    try:
        CLIP["model"] = cliplib.load(os.path.join(DATA, "clip"))
        CLIP["state"] = "ready" if CLIP["model"] else "missing"
    except Exception as e:
        CLIP["state"] = f"failed: {e}"[:120]
    PC.kick.set()  # index with meanings now that the model is here
    MEAN.kick.set()


PHONE = phonelib.PhoneLib()
PC = pcindex.PcIndex(DATA, lambda: CLIP["model"], exclude=[ORIGINALS, os.path.join(os.path.expanduser("~"), "Pictures", "From phone")])
MEAN = phonemean.PhoneMeanings(DATA, PHONE, lambda: CLIP["model"])


# ---------------------------------------------------------------- library ---
LIB = {"sig": None, "items": [], "by": {}}
LIB_LOCK = threading.Lock()


def library():
    """Every visible item, newest first, as dicts with a key 'k' ('p<id>' phone, 'c<id>' PC)."""
    PHONE.refresh()
    sig = (PHONE.version, PC.version)
    if sig == LIB["sig"]:
        return LIB["items"], LIB["by"]
    with LIB_LOCK:
        if sig == LIB["sig"]:
            return LIB["items"], LIB["by"]
        items = []
        for it in PHONE.visible():
            w, h = it["w"] or 0, it["h"] or 0
            if it.get("orient") in (90, 270):
                w, h = h, w
            items.append({"k": f"p{it['id']}", "src": "phone", "t": it["taken"] or 0, "v": it["video"], "w": w, "h": h,
                          "n": it["name"], "a": it["bucket"] or "Phone", "d": it.get("duration") or 0,
                          "saved": bool(it.get("orig") and os.path.exists(it["orig"])), "want": bool(it.get("want"))})
        for r in PC.rows():
            if r["thumb"] == -1 and not r["video"]:
                continue  # unreadable file
            items.append({"k": f"c{r['id']}", "src": "pc", "t": r["taken"] or 0, "v": r["video"], "w": r["w"], "h": r["h"],
                          "n": r["name"], "a": os.path.basename(r["folder"]) or r["folder"], "f": r["folder"], "d": 0})
        items.sort(key=lambda x: -x["t"])
        LIB.update(sig=sig, items=items, by={x["k"]: x for x in items})
        return items, LIB["by"]


VEC = {"sig": None}


def vectors():
    """(keys list, matrix) of every item with a meaning, phone and PC together."""
    PHONE.refresh()
    sig = (PHONE.version, PC.version, MEAN.version)
    if VEC.get("sig") != sig:
        pids, pm = PC.vectors()
        mids, mm = MEAN.vectors()
        keys = ([f"p{i}" for i in PHONE.clip_ids.tolist()] + [f"p{i}" for i in mids.tolist()]
                + [f"c{i}" for i in pids.tolist()])
        mat = np.concatenate([PHONE.clip, mm, pm]) if len(keys) else np.zeros((0, 512), dtype=np.float32)
        VEC.update(sig=sig, keys=keys, mat=mat, pos={k: i for i, k in enumerate(keys)})
    return VEC["keys"], VEC["mat"], VEC["pos"]


def filtered(q):
    items, by = library()
    src, album, person, kind = q.get("src", "all"), q.get("album"), q.get("person"), q.get("kind")
    out = items
    if src in ("phone", "pc"):
        out = [x for x in out if x["src"] == src]
    if album:
        a_src, _, a_name = album.partition(":")
        if a_src == "phone":
            out = [x for x in out if x["src"] == "phone" and x["a"] == a_name]
        else:
            out = [x for x in out if x["src"] == "pc" and x.get("f") == a_name]
    if person:
        pid = int(person)
        out = [x for x in out if x["src"] == "phone" and pid in PHONE.faces.get(int(x["k"][1:]), ())]
    if kind == "video":
        out = [x for x in out if x["v"]]
    elif kind == "photo":
        out = [x for x in out if not x["v"]]
    elif kind == "saved":
        out = [x for x in out if x.get("saved")]
    return out


def search(phrase, pool):
    """Keyword hits (people, tags, text in photo, names, albums) first, then meaning matches."""
    phrase = phrase.strip()
    low = phrase.lower()
    terms = low.split()
    allowed = {x["k"]: x for x in pool}
    hits, seen = [], set()
    people = {pid for pid, p in PHONE.people.items() if p["name"] and low in p["name"].lower()}
    for x in pool:
        k = x["k"]
        why = None
        if x["src"] == "phone":
            iid = int(k[1:])
            if people and people & set(PHONE.faces.get(iid, ())):
                why = "person"
            elif terms and (low in PHONE.labels.get(iid, "").split("|")
                            or all(t in PHONE.labels.get(iid, "").replace("|", " ").split() for t in terms)):
                why = "tag"
            elif len(low) >= 3 and low in PHONE.ocr.get(iid, ""):
                why = "text"
        if not why and (low in x["n"].lower() or low in (x["a"] or "").lower()):
            why = "name"
        if why:
            hits.append((x, why))
            seen.add(k)
    meaning = []
    model = CLIP["model"]
    if model and phrase:
        keys, mat, _ = vectors()
        if len(keys):
            scores = mat @ model.embed_text(phrase)
            best = float(scores.max())
            if best >= cliplib.MIN_SCORE:
                cut = max(cliplib.MIN_SCORE, best - 0.08)
                idx = np.where(scores >= cut)[0]
                idx = idx[np.argsort(-scores[idx])][:800]
                for i in idx:
                    k = keys[i]
                    if k in allowed and k not in seen:
                        meaning.append((allowed[k], "meaning"))
                        seen.add(k)
    return hits + meaning


def similar(key, pool):
    keys, mat, pos = vectors()
    if key not in pos:
        return []
    allowed = {x["k"]: x for x in pool}
    scores = mat @ mat[pos[key]]
    idx = np.argsort(-scores)[:200]
    return [allowed[keys[i]] for i in idx if keys[i] != key and keys[i] in allowed and scores[i] > 0.55]


def compact(x, why=None):
    d = {k: x[k] for k in ("k", "t", "v", "w", "h", "src") if k in x}
    if x.get("saved"):
        d["saved"] = 1
    if x.get("want"):
        d["want"] = 1
    if why:
        d["why"] = why
    return d


# ----------------------------------------------------------------- beam ---
def port_up(port):
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.3):
            return True
    except OSError:
        return False


def beam(path, body=None, timeout=20):
    req = urllib.request.Request(f"http://127.0.0.1:{BEAM_PORT}{path}", method="POST" if body is not None else "GET",
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json"})
    try:
        with LOCAL.open(req, timeout=timeout) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read() or b"{}").get("error")
        except ValueError:
            msg = None
        raise RuntimeError(msg or f"Beam said {e.code}") from None


def ensure_beam():
    if port_up(BEAM_PORT):
        return
    if BEAM_PORT != 7788:
        raise RuntimeError("Beam isn't running")
    exe = shutil.which("pythonw") or sys.executable
    subprocess.Popen([exe, "app.py"], cwd=os.path.join(QT, "beam"), env=dict(os.environ, BEAM_NO_BROWSER="1"),
                     creationflags=NOWIN, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    end = time.time() + 25
    while time.time() < end:
        time.sleep(0.3)
        if port_up(BEAM_PORT):
            return
    raise RuntimeError("Beam didn't start")


def beam_status():
    if not port_up(BEAM_PORT):
        return None
    try:
        return beam("/api/lens/status", timeout=3)
    except Exception:
        return {"old": True}  # an older Beam without the Lens link: needs a restart


def pick_folder():
    ps = ("Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.FolderBrowserDialog; "
          "$d.Description='Pick a photo folder for Lens'; $d.UseDescriptionForTitle=$true; "
          "$f=New-Object System.Windows.Forms.Form; $f.TopMost=$true; "
          "if($d.ShowDialog($f) -eq 'OK'){[Console]::OutputEncoding=[Text.Encoding]::UTF8; $d.SelectedPath}")
    r = subprocess.run(["powershell", "-NoProfile", "-STA", "-Command", ps], capture_output=True, timeout=600,
                       creationflags=NOWIN)
    return r.stdout.decode("utf-8", "replace").strip() or None


# --------------------------------------------------------------- handler ---
def item_path(k):
    """Real file for an item key, or None (phone item not pulled yet)."""
    if k.startswith("c") and k[1:].isdigit():
        r = PC.row(int(k[1:]))
        return r["path"] if r and os.path.isfile(r["path"]) else None
    if k.startswith("p") and k[1:].isdigit():
        it = PHONE.items.get(int(k[1:]))
        if it and int(k[1:]) not in PHONE.hidden and it.get("orig") and os.path.isfile(it["orig"]):
            return it["orig"]
    return None


def thumb_file(k):
    if k.startswith("c") and k[1:].isdigit():
        return PC.thumb_path(int(k[1:]))
    if k.startswith("p") and k[1:].isdigit() and int(k[1:]) not in PHONE.hidden:
        return PHONE.thumb_path(int(k[1:]))
    return None


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def ok_host(self):
        return self.headers.get("Host", "") in {f"127.0.0.1:{PORT}", f"localhost:{PORT}"}

    def ok_site(self):
        return self.headers.get("Sec-Fetch-Site", "same-origin") in ("same-origin", "none")

    def send(self, code, body=b"", ctype="application/json", headers=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode()
        elif isinstance(body, str):
            body = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        h = {"Cache-Control": "no-store"}
        h.update(headers or {})
        for k, v in h.items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def j(self, data, code=200):
        self.send(code, data)

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if not n or n > 4 << 20:
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
            if not self.ok_site():
                return self.send(403, {"error": "cross-site"})
            if p.startswith("/api/"):
                name, _, arg = p[5:].partition("/")
                fn = getattr(self, "get_" + name, None)
                if fn:
                    return fn(urllib.parse.unquote(arg), q)
            return self.send(404, {"error": "not found"})
        except (ConnectionError, socket.timeout):
            self.close_connection = True
        except Exception as e:
            self.j({"error": str(e)[:300]}, 500)

    def do_POST(self):
        if not self.ok_host() or not self.ok_site():
            return self.send(403, {"error": "refused"})
        p = urllib.parse.urlsplit(self.path).path
        fn = getattr(self, "post_" + p[5:].replace("/", "_"), None) if p.startswith("/api/") else None
        try:
            if not fn:
                return self.send(404, {"error": "not found"})
            return fn(self.body())
        except ValueError as e:
            self.j({"error": str(e)}, 400)
        except Exception as e:
            self.j({"error": str(e)[:300]}, 500)

    def static(self, name):
        full = os.path.abspath(os.path.join(STATIC, name))
        if not full.startswith(STATIC + os.sep) or not os.path.isfile(full):
            return self.send(404, {"error": "not found"})
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "image/svg+xml"):
            ctype += "; charset=utf-8"
        with open(full, "rb") as f:
            self.send(200, f.read(), ctype)

    def file(self, path, ctype=None, cache=False):
        size = os.path.getsize(path)
        ctype = ctype or mimetypes.guess_type(path)[0] or "application/octet-stream"
        start, end, code = 0, size - 1, 200
        rng = self.headers.get("Range")
        m = re.match(r"bytes=(\d*)-(\d*)", rng or "")
        if m and size:
            if m.group(1):
                start = int(m.group(1))
                end = int(m.group(2)) if m.group(2) else size - 1
            else:
                start = max(0, size - int(m.group(2) or 0))
            end = min(end, size - 1)
            if start > end:
                return self.send(416, b"", headers={"Content-Range": f"bytes */{size}"})
            code = 206
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "max-age=86400" if cache else "no-store")
        if code == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
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

    # ---- reads
    def get_boot(self, _a, q):
        items, _ = library()
        st = beam_status()
        prog = dict(PC.progress)
        return self.j({
            "version": VERSION, "clip": CLIP["state"],
            "counts": {"phone": sum(1 for x in items if x["src"] == "phone"), "pc": sum(1 for x in items if x["src"] == "pc"),
                       "people": sum(1 for p in PHONE.people.values() if not p["hidden"]),
                       "meanings": int(len(vectors()[0])), "phone_meanings": dict(MEAN.progress)},
            "phone": {"beam": st is not None, "old": bool(st and st.get("old")), "device": (st or {}).get("device"), "last_sync": (st or {}).get("last_sync"),
                      "index": bool(PHONE.labels or PHONE.people or len(PHONE.clip_ids)),
                      "index_at": (st or {}).get("index_at"), "wants": (st or {}).get("wants", 0),
                      "outbox": (st or {}).get("outbox", 0), "originals_dir": ORIGINALS},
            "pc": {"folders": PREFS["folders"], "progress": prog},
        })

    def get_items(self, _a, q):
        pool = filtered(q)
        if q.get("q"):
            res = search(q["q"], pool)
            return self.j({"items": [compact(x, why) for x, why in res], "search": True})
        if q.get("like"):
            return self.j({"items": [compact(x) for x in similar(q["like"], pool)], "search": True})
        return self.j({"items": [compact(x) for x in pool], "search": False})

    def get_thumb(self, k, q):
        p = thumb_file(k)
        if p and os.path.isfile(p):
            return self.file(p, "image/jpeg", cache=True)
        return self.send(404, b"", "text/plain")

    def get_full(self, k, q):
        p = item_path(k)
        if not p:
            return self.j({"error": "not on this PC yet", "pull": k.startswith("p")}, 404)
        ext = os.path.splitext(p)[1].lower()
        if ext in (".heic", ".heif", ".tif", ".tiff") and Image is not None:
            import io
            with Image.open(p) as im:
                im = ImageOps.exif_transpose(im).convert("RGB")
                buf = io.BytesIO()
                im.save(buf, "JPEG", quality=90)
            return self.send(200, buf.getvalue(), "image/jpeg")
        return self.file(p)

    def get_info(self, k, q):
        _, by = library()
        x = by.get(k)
        if not x:
            return self.j({"error": "not found"}, 404)
        d = dict(x)
        if x["src"] == "phone":
            iid = int(k[1:])
            it = PHONE.items.get(iid, {})
            d.update(size=it.get("size"), mime=it.get("mime"), rel=it.get("rel"),
                     tags=[t for t in PHONE.labels.get(iid, "").split("|") if t], text=PHONE.ocr.get(iid, "")[:600],
                     people=[{"id": pid, "name": PHONE.people[pid]["name"]} for pid in PHONE.faces.get(iid, ())
                             if pid in PHONE.people and not PHONE.people[pid]["hidden"]],
                     path=it.get("orig") if d.get("saved") else None)
        else:
            r = PC.row(int(k[1:])) or {}
            d.update(size=r.get("size"), path=r.get("path"), folder=r.get("folder"))
        _, _, pos = vectors()
        d["similar"] = k in pos
        return self.j(d)

    def get_people(self, _a, q):
        ppl = [p for p in PHONE.people.values() if not p["hidden"]]
        ppl.sort(key=lambda p: (p["name"] is None, -p["count"]))
        return self.j({"people": [{"id": p["id"], "name": p["name"], "count": p["count"]} for p in ppl]})

    def get_suggest(self, _a, q):
        """Starting points for the search box: named people and the tags Lens sees most."""
        PHONE.refresh()
        ppl = sorted((p for p in PHONE.people.values() if p["name"] and not p["hidden"]), key=lambda p: -p["count"])[:12]
        counts = {}
        for iid, labels in PHONE.labels.items():
            if iid in PHONE.hidden:
                continue
            for t in set(labels.split("|")):
                if len(t) > 2:
                    counts[t] = counts.get(t, 0) + 1
        tags = sorted(counts, key=lambda t: -counts[t])[:16]
        return self.j({"people": [{"id": p["id"], "name": p["name"], "count": p["count"]} for p in ppl], "tags": tags})

    def get_face(self, pid, q):
        p = PHONE.people.get(int(pid)) if pid.isdigit() else None
        if not p or not p["cover"] or Image is None:
            return self.send(404, b"", "text/plain")
        mid, (l, t, r, b) = p["cover"]
        tp = PHONE.thumb_path(mid)
        if not os.path.isfile(tp):
            return self.send(404, b"", "text/plain")
        import io
        with Image.open(tp) as im:
            w, h = im.size
            cx, cy = (l + r) / 2 * w, (t + b) / 2 * h
            s = max((r - l) * w, (b - t) * h) * 1.6
            box = (int(max(0, cx - s / 2)), int(max(0, cy - s / 2)), int(min(w, cx + s / 2)), int(min(h, cy + s / 2)))
            face = im.crop(box).convert("RGB")
            face.thumbnail((160, 160))
            buf = io.BytesIO()
            face.save(buf, "JPEG", quality=85)
        return self.send(200, buf.getvalue(), "image/jpeg", {"Cache-Control": "max-age=600"})

    def get_albums(self, _a, q):
        items, _ = library()
        albums = {}
        for x in items:
            key = f"phone:{x['a']}" if x["src"] == "phone" else f"pc:{x.get('f')}"
            a = albums.get(key)
            if not a:
                albums[key] = a = {"id": key, "name": x["a"], "src": x["src"], "count": 0, "cover": x["k"], "t": x["t"]}
            a["count"] += 1
        out = sorted(albums.values(), key=lambda a: (-a["t"]))
        return self.j({"albums": out})

    # ---- actions
    def keys(self, d):
        ks = [str(k) for k in (d.get("keys") or []) if re.fullmatch(r"[pc]\d+", str(k))]
        if not ks:
            raise ValueError("Pick some photos first.")
        return ks

    def post_pull(self, d):
        ks = [k for k in self.keys(d) if k.startswith("p") and not item_path(k)]
        if not ks:
            return self.j({"ok": True, "asked": 0})
        ensure_beam()
        r = beam("/api/lens/want", {"ids": [int(k[1:]) for k in ks]})
        return self.j({"ok": True, "asked": len(ks), "waiting": r.get("wants", 0)})

    def post_unpull(self, d):
        ks = [k for k in self.keys(d) if k.startswith("p")]
        if port_up(BEAM_PORT):
            beam("/api/lens/unwant", {"ids": [int(k[1:]) for k in ks]})
        return self.j({"ok": True})

    def post_send(self, d):
        ks = self.keys(d)
        paths = [item_path(k) for k in ks if k.startswith("c")]
        paths = [p for p in paths if p]
        if not paths:
            raise ValueError("Those are already on the phone.")
        ensure_beam()
        r = beam("/api/lens/send", {"paths": paths})
        return self.j({"ok": True, "sent": r.get("added", 0), "waiting": r.get("waiting", 0),
                       "skipped": len(ks) - len(paths)})

    def post_reveal(self, d):
        k = self.keys(d)[0]
        p = item_path(k)
        if not p:
            raise ValueError("That one isn't on this PC yet. Pull it first.")
        subprocess.Popen(["explorer", "/select,", os.path.normpath(p)])
        return self.j({"ok": True})

    def post_open(self, d):
        k = self.keys(d)[0]
        p = item_path(k)
        if not p:
            raise ValueError("That one isn't on this PC yet. Pull it first.")
        os.startfile(p)
        return self.j({"ok": True})

    def post_folders(self, d):
        if d.get("pick"):
            f = pick_folder()
            if not f:
                return self.j({"folders": PREFS["folders"], "cancel": True})
            d = {"add": f}
        folders = list(PREFS["folders"])
        if d.get("add"):
            f = os.path.abspath(str(d["add"]))
            if not os.path.isdir(f):
                raise ValueError("That folder isn't there.")
            if os.path.normcase(f) not in {os.path.normcase(x) for x in folders}:
                folders.append(f)
        if d.get("remove"):
            folders = [x for x in folders if os.path.normcase(x) != os.path.normcase(str(d["remove"]))]
        PREFS["folders"] = folders
        save_prefs()
        PC.set_folders(folders)
        return self.j({"folders": folders})

    def post_rescan(self, d):
        PC.kick.set()
        MEAN.kick.set()
        return self.j({"ok": True})

    def post_beam(self, d):
        ensure_beam()
        return self.j({"ok": True})

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
            subprocess.Popen([edge, f"--app={url}", "--window-size=1400,900"])
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
    PC.set_folders(PREFS["folders"])
    PC.start()
    MEAN.start()
    threading.Thread(target=load_clip, daemon=True).start()
    if "--no-window" not in sys.argv:
        threading.Timer(0.3, open_window, args=(url,)).start()
    print(f"Lens PC {VERSION} on {url}")
    srv.serve_forever()


if __name__ == "__main__":
    main()
