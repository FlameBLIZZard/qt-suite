"""Lens link: the phone's photo library on the PC, for Lens PC (QT\\lens-pc).

The Lens phone app is offline on purpose, so the Beam phone app does the moving:
it reads the phone's MediaStore, sends a small thumbnail of every photo and video,
the Lens-backup.db that Lens writes to Downloads (people, tags, text, word-search data),
and full originals only when the PC asks for them.

Files live in %LOCALAPPDATA%\\Beam\\lens (override with BEAM_LENS_DIR):
  library.db        one row per phone item (MediaStore id is the key, the same id Lens uses)
  thumbs/<id>.jpg   ~384 px thumbnails
  Lens-backup.db    the latest Lens index from the phone
Originals land in Pictures\\From phone\\<album>\\ (override with BEAM_LENS_ORIGINALS).

Phone -> PC (key needed)                       PC only (127.0.0.1)
  POST /api/lens/begin {device,total}           POST /api/lens/want {ids:[...]}
  POST /api/lens/items {sid,items:[...]}        POST /api/lens/unwant {ids:[...]}
  POST /api/lens/end   {sid}
  PUT  /api/lens/thumb/<id>?m=<modified>
  PUT  /api/lens/index?m=<lastModifiedMs>
  GET  /api/lens/wants
  PUT  /api/lens/original/<id>
  GET  /api/lens/status                         POST /api/lens/send {paths:[...]}
  GET  /api/lens/outbox                          (PC photos waiting to go to the phone)
  GET  /api/lens/outbox/<id>/file
  POST /api/lens/outbox/<id>/done
"""
import json
import mimetypes
import os
import re
import secrets
import sqlite3
import threading
import time

def _lens_paths():
    """Where Lens keeps its files, from %LOCALAPPDATA%/QT/lens-paths.json (env vars still win)."""
    p = os.path.join(os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), "QT", "lens-paths.json")
    try:
        with open(p, encoding="utf-8-sig") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


LENS_PATHS = _lens_paths()

BASE = os.environ.get("BEAM_LENS_DIR") or LENS_PATHS.get("beam_lens") or os.path.join(
    os.environ.get("LOCALAPPDATA") or os.path.join(os.path.expanduser("~"), ".beam"), "Beam", "lens")
THUMBS = os.path.join(BASE, "thumbs")
INDEX = os.path.join(BASE, "Lens-backup.db")
DB_PATH = os.path.join(BASE, "library.db")
STATE = os.path.join(BASE, "state.json")
OUTBOX = os.path.join(BASE, "outbox.json")
ORIGINALS = os.environ.get("BEAM_LENS_ORIGINALS") or LENS_PATHS.get("originals") or os.path.join(os.path.expanduser("~"), "Pictures", "From phone")

# a dated copy of every Lens index the phone sends (one per day), when a folder is set
HISTORY = os.environ.get("BEAM_LENS_HISTORY") or LENS_PATHS.get("index_history")
KEEP_HISTORY = 60

MAX_THUMB = 3 << 20
MAX_INDEX = 1 << 30
BUF = 1 << 20
LOCK = threading.RLock()
SESSIONS = {}  # sid -> {"seen": set(), "t": time, "device": str}

SCHEMA = """
CREATE TABLE IF NOT EXISTS item (
  id INTEGER PRIMARY KEY,      -- MediaStore _ID (same as Lens mediaId)
  name TEXT, bucket TEXT, rel TEXT, mime TEXT,
  w INTEGER, h INTEGER, size INTEGER,
  taken INTEGER,               -- ms since epoch
  modified INTEGER,            -- s since epoch (MediaStore DATE_MODIFIED)
  duration INTEGER,            -- ms, videos
  orient INTEGER, video INTEGER,
  thumb_m INTEGER DEFAULT -1,  -- modified value of the stored thumbnail
  orig TEXT,                   -- PC path of the pulled original
  want REAL,                   -- when the PC asked for the original
  seen REAL
);
CREATE INDEX IF NOT EXISTS item_taken ON item(taken);
"""


def db():
    c = sqlite3.connect(DB_PATH, timeout=10)
    c.row_factory = sqlite3.Row
    return c


def init():
    os.makedirs(THUMBS, exist_ok=True)
    with LOCK, db() as c:
        c.execute("PRAGMA journal_mode=WAL")
        c.executescript(SCHEMA)


def state():
    try:
        with open(STATE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def set_state(**kw):
    with LOCK:
        s = state()
        s.update(kw)
        tmp = STATE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(s, f)
        os.replace(tmp, STATE)


def thumb_path(iid):
    return os.path.join(THUMBS, f"{int(iid)}.jpg")


def clean(name, fallback="item"):
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", str(name or "")).strip(" .")
    return name[:150] or fallback


def unique(path):
    base, ext = os.path.splitext(path)
    n = 2
    while os.path.exists(path):
        path = f"{base} ({n}){ext}"
        n += 1
    return path


def read_body_to(h, dest, limit):
    """Stream the request body into dest (via a temp file). Returns bytes written."""
    n = int(h.headers.get("Content-Length") or 0)
    if n <= 0 or n > limit:
        h.drain()
        raise ValueError("bad size")
    tmp = dest + f".{secrets.token_hex(4)}.part"
    got = 0
    try:
        with open(tmp, "wb") as f:
            while got < n:
                chunk = h.rfile.read(min(BUF, n - got))
                if not chunk:
                    break
                f.write(chunk)
                got += len(chunk)
        if got != n:
            raise ValueError("upload cut short")
        os.replace(tmp, dest)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    return got


def as_int(v, d=0):
    try:
        return int(v)
    except (TypeError, ValueError):
        return d


# ------------------------------------------------------------------ routes ---
def api(h, method, rest, q, app):
    parts = rest.split("/") if rest else []
    arg = lambda k, d="": q.get(k, [d])[0]  # noqa: E731

    if method == "GET" and parts == ["status"]:
        return h.json(status())

    if method == "POST" and parts == ["begin"]:
        d = h.body_json()
        sid = secrets.token_hex(8)
        dev = app.device_name(h.headers.get("User-Agent"), h.local) if not d.get("device") else str(d["device"])[:60]
        with LOCK:
            for k in [k for k, v in SESSIONS.items() if time.time() - v["t"] > 6 * 3600]:
                SESSIONS.pop(k, None)
            SESSIONS[sid] = {"seen": set(), "t": time.time(), "device": dev}
        set_state(device=dev, sync_started=time.time(), total=as_int(d.get("total")))
        return h.json({"sid": sid})

    if method == "POST" and parts == ["items"]:
        d = h.body_json()
        ses = SESSIONS.get(d.get("sid") or "")
        if not ses:
            return h.json({"error": "sync expired, start again", "restart": True}, 409)
        need, now = [], time.time()
        with LOCK, db() as c:
            for it in d.get("items") or []:
                iid = as_int(it.get("id"), -1)
                if iid < 0:
                    continue
                ses["seen"].add(iid)
                m = as_int(it.get("m"))
                row = c.execute("SELECT thumb_m, orig FROM item WHERE id=?", (iid,)).fetchone()
                c.execute("""INSERT INTO item(id,name,bucket,rel,mime,w,h,size,taken,modified,duration,orient,video,seen)
                             VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                             ON CONFLICT(id) DO UPDATE SET name=excluded.name, bucket=excluded.bucket, rel=excluded.rel,
                               mime=excluded.mime, w=excluded.w, h=excluded.h, size=excluded.size, taken=excluded.taken,
                               modified=excluded.modified, duration=excluded.duration, orient=excluded.orient,
                               video=excluded.video, seen=excluded.seen""",
                          (iid, str(it.get("n") or "")[:255], str(it.get("b") or "")[:255], str(it.get("p") or "")[:400],
                           str(it.get("mt") or "")[:80], as_int(it.get("w")), as_int(it.get("h")), as_int(it.get("s")),
                           as_int(it.get("t")), m, as_int(it.get("d")), as_int(it.get("o")), 1 if it.get("v") else 0, now))
                if not row or row["thumb_m"] != m or not os.path.exists(thumb_path(iid)):
                    need.append(iid)
                if row and row["orig"] and not os.path.exists(row["orig"]):
                    c.execute("UPDATE item SET orig=NULL WHERE id=?", (iid,))
        ses["t"] = now
        return h.json({"need": need})

    if method == "POST" and parts == ["end"]:
        d = h.body_json()
        with LOCK:
            ses = SESSIONS.pop(d.get("sid") or "", None)
        if not ses:
            return h.json({"error": "sync expired"}, 409)
        removed = 0
        if d.get("complete", True) and ses["seen"]:
            with LOCK, db() as c:
                ids = [r[0] for r in c.execute("SELECT id FROM item")]
                gone = [i for i in ids if i not in ses["seen"]]
                for i in gone:
                    c.execute("DELETE FROM item WHERE id=?", (i,))
                    try:
                        os.remove(thumb_path(i))
                    except OSError:
                        pass
                removed = len(gone)
        set_state(last_sync=time.time(), device=ses["device"], count=len(ses["seen"]))
        return h.json({"ok": True, "removed": removed, "wants": wants()})

    if method == "PUT" and len(parts) == 2 and parts[0] == "thumb" and parts[1].isdigit():
        iid = int(parts[1])
        read_body_to(h, thumb_path(iid), MAX_THUMB)
        with LOCK, db() as c:
            c.execute("UPDATE item SET thumb_m=? WHERE id=?", (as_int(arg("m"), 0), iid))
        set_state(last_thumb=time.time())
        return h.json({"ok": True})

    if method == "PUT" and parts == ["index"]:
        tmp = INDEX + ".new"
        read_body_to(h, tmp, MAX_INDEX)
        with open(tmp, "rb") as f:
            ok = f.read(15) == b"SQLite format 3"
        if not ok:
            os.remove(tmp)
            return h.json({"error": "That isn't a Lens backup."}, 400)
        with LOCK:
            os.replace(tmp, INDEX)
        set_state(index_at=time.time(), index_m=as_int(arg("m")))
        keep_history()
        return h.json({"ok": True})

    if method == "GET" and parts == ["wants"]:
        return h.json({"ids": wants()})

    if method == "PUT" and len(parts) == 2 and parts[0] == "original" and parts[1].isdigit():
        iid = int(parts[1])
        with LOCK, db() as c:
            row = c.execute("SELECT name, bucket FROM item WHERE id=?", (iid,)).fetchone()
        if not row:
            h.drain()
            return h.json({"error": "unknown item"}, 404)
        folder = os.path.join(ORIGINALS, clean(row["bucket"], "Phone"))
        os.makedirs(folder, exist_ok=True)
        dest = unique(os.path.join(folder, clean(row["name"], f"{iid}.jpg")))
        read_body_to(h, dest, 64 << 30)
        mt = as_int(arg("t"))
        if mt > 0:
            try:
                os.utime(dest, (mt / 1000, mt / 1000))
            except OSError:
                pass
        with LOCK, db() as c:
            c.execute("UPDATE item SET orig=?, want=NULL WHERE id=?", (dest, iid))
        set_state(last_original=time.time())
        return h.json({"ok": True, "path": dest})

    if method == "POST" and parts in (["want"], ["unwant"]):
        if not h.local:
            h.drain()
            return h.json({"error": "PC only"}, 403)
        ids = [as_int(i, -1) for i in (h.body_json().get("ids") or [])][:5000]
        with LOCK, db() as c:
            for i in ids:
                if parts == ["want"]:
                    c.execute("UPDATE item SET want=? WHERE id=? AND (orig IS NULL OR orig='')", (time.time(), i))
                else:
                    c.execute("UPDATE item SET want=NULL WHERE id=?", (i,))
        if parts == ["want"]:
            set_state(want_at=time.time())
        return h.json({"ok": True, "wants": len(wants())})

    if method == "POST" and parts == ["send"]:
        if not h.local:
            h.drain()
            return h.json({"error": "PC only"}, 403)
        added = []
        with LOCK:
            box = outbox()
            for p in (h.body_json().get("paths") or [])[:2000]:
                p = os.path.abspath(str(p))
                if os.path.isfile(p) and not any(o["path"] == p for o in box):
                    o = {"id": secrets.token_hex(6), "path": p, "name": os.path.basename(p),
                         "size": os.path.getsize(p), "mime": mimetypes.guess_type(p)[0] or "application/octet-stream",
                         "at": time.time()}
                    box.append(o)
                    added.append(o["id"])
            save_outbox(box)
        return h.json({"ok": True, "added": len(added), "waiting": len(box)})

    if method == "GET" and parts == ["outbox"]:
        box = [o for o in outbox() if os.path.isfile(o["path"])]
        return h.json({"items": [{k: o[k] for k in ("id", "name", "size", "mime")} for o in box]})

    if len(parts) == 3 and parts[0] == "outbox":
        with LOCK:
            box = outbox()
            o = next((x for x in box if x["id"] == parts[1]), None)
            if not o:
                h.drain()
                return h.json({"error": "gone"}, 404)
            if method == "POST" and parts[2] == "done":
                save_outbox([x for x in box if x["id"] != o["id"]])
                h.drain()
                set_state(last_sent=time.time())
                return h.json({"ok": True})
        if method == "GET" and parts[2] == "file":
            return send_file(h, o["path"], o["mime"])

    h.drain()
    return h.json({"error": "bad request"}, 400)


def keep_history():
    """Copy the new index to HISTORY/Lens-backup-YYYY-MM-DD.db and keep the last KEEP_HISTORY days."""
    if not HISTORY:
        return
    try:
        import shutil
        os.makedirs(HISTORY, exist_ok=True)
        dest = os.path.join(HISTORY, time.strftime("Lens-backup-%Y-%m-%d.db"))
        shutil.copyfile(INDEX, dest + ".part")
        os.replace(dest + ".part", dest)
        old = sorted(f for f in os.listdir(HISTORY) if re.fullmatch(r"Lens-backup-\d{4}-\d{2}-\d{2}\.db", f))
        for f in old[:-KEEP_HISTORY]:
            os.remove(os.path.join(HISTORY, f))
    except OSError as e:
        print("[beam] lens index history:", e)


def outbox():
    try:
        with open(OUTBOX, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return []


def save_outbox(box):
    tmp = OUTBOX + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(box, f)
    os.replace(tmp, OUTBOX)


def send_file(h, path, mime):
    size = os.path.getsize(path)
    h.send_response(200)
    h.send_header("Content-Type", mime)
    h.send_header("Content-Length", str(size))
    h.send_header("Content-Disposition", "attachment")
    h.end_headers()
    if h.command == "HEAD":
        return
    with open(path, "rb") as f:
        while True:
            b = f.read(BUF)
            if not b:
                break
            h.wfile.write(b)


def wants():
    with LOCK, db() as c:
        rows = c.execute("SELECT id, orig FROM item WHERE want IS NOT NULL ORDER BY want LIMIT 500").fetchall()
        out = []
        for r in rows:
            if r["orig"] and os.path.exists(r["orig"]):
                c.execute("UPDATE item SET want=NULL WHERE id=?", (r["id"],))
            else:
                out.append(r["id"])
        return out


def status():
    with LOCK, db() as c:
        n = c.execute("SELECT COUNT(*) FROM item").fetchone()[0]
        nt = c.execute("SELECT COUNT(*) FROM item WHERE thumb_m >= 0").fetchone()[0]
        no = c.execute("SELECT COUNT(*) FROM item WHERE orig IS NOT NULL").fetchone()[0]
    s = state()
    return {"items": n, "thumbs": nt, "originals": no, "wants": len(wants()), "outbox": len(outbox()), "device": s.get("device"),
            "last_sync": s.get("last_sync"), "index_at": s.get("index_at"), "index_m": s.get("index_m"),
            "index": os.path.exists(INDEX), "dir": BASE, "originals_dir": ORIGINALS, "history_dir": HISTORY}
