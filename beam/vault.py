"""Clipvault: everything ever copied on the PC or the phone, saved and searchable.

Stdlib only (sqlite3 with FTS5). Lives in %LOCALAPPDATA%\\Beam\\clipvault (or ~/.beam/clipvault),
never in the Downloads inbox. Copies that a password manager marks as private are never seen
here: pccontrol skips them before they reach Beam.

Table clips: id, kind ('text' | 'image'), text, img (file name), src (device), ts (first copied),
last (last copied), n (times copied), pinned, type (link | email | phone | code | color | number |
otp | text | image). Same text copied again bumps last/n instead of adding a duplicate.

Search understands a few words besides plain text: from:pc, from:phone, is:pinned, type:link
(or links, code, email, phone, color, number, image).
"""
import hashlib
import json
import os
import re
import sqlite3
import threading
import time

MAX_TEXT = 200_000
MAX_IMAGES = 300          # oldest unpinned screenshots are dropped past this
LOCK = threading.Lock()
DB = None
DIR = None
FTS = False
TYPES = ("link", "email", "phone", "code", "color", "number", "otp", "text", "image")

_URL = re.compile(r"^\s*(https?://|www\.)\S+\s*$", re.I)
_EMAIL = re.compile(r"^\s*[\w.+-]+@[\w-]+(\.[\w-]+)+\s*$")
_PHONE = re.compile(r"^\s*\+?[\d][\d\s().-]{6,}\d\s*$")
_COLOR = re.compile(r"^\s*(#[0-9a-f]{3,8}|rgba?\([\d\s,.%]+\)|hsla?\([\d\s,.%deg]+\))\s*$", re.I)
_NUMBER = re.compile(r"^\s*[-+]?[₹$€£]?\s?[\d,]+(\.\d+)?\s*$")
_OTP = re.compile(r"^\s*\d{4,8}\s*$")
_CODE = re.compile(r"[{};]\s*$|^\s*(def |class |import |from \S+ import|function |const |let |var |#include|SELECT |<\w+[ >]|\$ |PS [A-Z]:\\|git |npm |pip |cd )|=>|\)\s*\{|^\s{2,}\S", re.M)


def classify(text):
    """A rough type for a text copy, for the filter chips and the row badge."""
    if text is None:
        return "image"
    t = text.strip()
    if not t:
        return "text"
    if "\n" not in t:
        if _URL.match(t):
            return "link"
        if _EMAIL.match(t):
            return "email"
        if _COLOR.match(t):
            return "color"
        if _OTP.match(t):
            return "otp"
        if _PHONE.match(t) and sum(ch.isdigit() for ch in t) >= 8:
            return "phone"
        if _NUMBER.match(t):
            return "number"
    if len(_CODE.findall(t)) >= (1 if "\n" not in t else 2):
        return "code"
    return "text"


def default_dir():
    base = os.environ.get("LOCALAPPDATA") or os.path.join(os.path.expanduser("~"), ".beam")
    return os.path.join(base, "Beam", "clipvault")


def init(path=None):
    global DB, DIR, FTS
    DIR = path or os.environ.get("BEAM_VAULT") or default_dir()
    os.makedirs(os.path.join(DIR, "img"), exist_ok=True)
    DB = sqlite3.connect(os.path.join(DIR, "clipvault.db"), check_same_thread=False)
    DB.execute("PRAGMA journal_mode=WAL")
    DB.execute("""CREATE TABLE IF NOT EXISTS clips (
        id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, text TEXT, img TEXT, hash TEXT UNIQUE,
        src TEXT, ts REAL, last REAL, n INTEGER DEFAULT 1, pinned INTEGER DEFAULT 0)""")
    DB.execute("CREATE INDEX IF NOT EXISTS clips_last ON clips(last)")
    cols = [r[1] for r in DB.execute("PRAGMA table_info(clips)")]
    if "type" not in cols:  # added later: backfill the old rows once
        DB.execute("ALTER TABLE clips ADD COLUMN type TEXT")
        for rid, kind, text in DB.execute("SELECT id, kind, text FROM clips").fetchall():
            DB.execute("UPDATE clips SET type = ? WHERE id = ?", (classify(text if kind == "text" else None), rid))
    try:  # trigram index: substring search in any language, fast on big histories
        DB.execute("CREATE VIRTUAL TABLE IF NOT EXISTS clips_fts USING fts5(text, content='clips', content_rowid='id', tokenize='trigram')")
        DB.executescript("""
          CREATE TRIGGER IF NOT EXISTS clips_ai AFTER INSERT ON clips BEGIN INSERT INTO clips_fts(rowid, text) VALUES (new.id, new.text); END;
          CREATE TRIGGER IF NOT EXISTS clips_ad AFTER DELETE ON clips BEGIN INSERT INTO clips_fts(clips_fts, rowid, text) VALUES ('delete', old.id, old.text); END;""")
        FTS = True
    except sqlite3.OperationalError:
        FTS = False
    DB.commit()


def _row(r):
    d = {"id": r[0], "kind": r[1], "src": r[4], "ts": r[5], "last": r[6], "n": r[7], "pinned": bool(r[8]),
         "type": r[9] or ("image" if r[1] == "image" else "text")}
    if r[1] == "text":
        d["text"] = r[2]
    else:
        d["img"] = True
    return d


COLS = "id, kind, text, img, src, ts, last, n, pinned, type"


def add(src, text=None, bmp=None):
    """Save one copy. Returns the stored row (dict) or None."""
    if DB is None:
        return None
    now = time.time()
    if text is not None:
        text = text[:MAX_TEXT]
        if not text.strip():
            return None
        h = "t:" + hashlib.sha1(text.encode("utf-8", "surrogatepass")).hexdigest()
    elif bmp:
        h = "i:" + hashlib.sha1(bmp).hexdigest()
    else:
        return None
    with LOCK:
        cur = DB.execute("SELECT id FROM clips WHERE hash = ?", (h,)).fetchone()
        if cur:
            DB.execute("UPDATE clips SET last = ?, n = n + 1, src = ? WHERE id = ?", (now, src, cur[0]))
            rid = cur[0]
        else:
            img = None
            if bmp:
                img = h[2:18] + ".bmp"
                with open(os.path.join(DIR, "img", img), "wb") as f:
                    f.write(bmp)
            rid = DB.execute("INSERT INTO clips(kind, text, img, hash, src, ts, last, type) VALUES (?,?,?,?,?,?,?,?)",
                             ("text" if text is not None else "image", text, img, h, src, now, now,
                              classify(text))).lastrowid
            if bmp:
                _trim_images()
        DB.commit()
        return _row(DB.execute(f"SELECT {COLS} FROM clips WHERE id = ?", (rid,)).fetchone())


def _trim_images():
    old = DB.execute("SELECT id, img FROM clips WHERE kind = 'image' AND pinned = 0 ORDER BY last DESC LIMIT -1 OFFSET ?", (MAX_IMAGES,)).fetchall()
    for rid, img in old:
        DB.execute("DELETE FROM clips WHERE id = ?", (rid,))
        try:
            os.remove(os.path.join(DIR, "img", img))
        except OSError:
            pass


_WORD = re.compile(r"(?:^|\s)(from|is|type|in):(\w+)", re.I)
_TYPE_ALIAS = {"links": "link", "url": "link", "urls": "link", "emails": "email", "mail": "email",
               "phones": "phone", "numbers": "number", "colors": "color", "colour": "color",
               "images": "image", "img": "image", "pic": "image", "otps": "otp", "codes": "otp"}


def parse_query(q):
    """'from:phone type:link amazon' -> ('amazon', {'src': 'phone', 'type': 'link'})"""
    opts = {}

    def take(m):
        k, v = m.group(1).lower(), m.group(2).lower()
        if k == "from" and v in ("pc", "phone"):
            opts["src"] = v
        elif k == "is" and v in ("pinned", "pin", "starred"):
            opts["pinned"] = True
        elif k in ("type", "is", "in"):
            v = _TYPE_ALIAS.get(v, v)
            if v in TYPES:
                opts["type"] = v
            else:
                return m.group(0)
        else:
            return m.group(0)
        return " "
    rest = _WORD.sub(take, q or "")
    return " ".join(rest.split()), opts


def search(q="", src="", kind="", pinned=False, before=None, limit=60, type="", since=None):
    """Newest first. q matches anywhere in the text (case-insensitive)."""
    if DB is None:
        return {"items": [], "total": 0}
    q, opts = parse_query(q)
    src = opts.get("src", src)
    type = opts.get("type", type)
    pinned = opts.get("pinned", pinned)
    where, args = [], []
    if q:
        if FTS and len(q) >= 3:
            where.append("id IN (SELECT rowid FROM clips_fts WHERE clips_fts MATCH ?)")
            args.append('"' + q.replace('"', '""') + '"')
        else:
            where.append("text LIKE ? ESCAPE '\\'")
            args.append("%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%")
    if src == "pc":
        where.append("src = 'PC'")
    elif src == "phone":
        where.append("src != 'PC'")
    if kind in ("text", "image"):
        where.append("kind = ?")
        args.append(kind)
    if type in TYPES:
        where.append("type = ?")
        args.append(type)
    if pinned:
        where.append("pinned = 1")
    w = (" WHERE " + " AND ".join(where)) if where else ""
    with LOCK:
        total = DB.execute("SELECT COUNT(*) FROM clips" + w, args).fetchone()[0]
        page_w, page_args = w, list(args)
        if before:  # next page: older than the last item already shown
            page_w += (" AND " if page_w else " WHERE ") + "last < ?"
            page_args.append(float(before))
        if since:   # live update: only what changed after the newest item already shown
            page_w += (" AND " if page_w else " WHERE ") + "last > ?"
            page_args.append(float(since))
        rows = DB.execute(f"SELECT {COLS} FROM clips{page_w} ORDER BY last DESC LIMIT ?", page_args + [int(limit)]).fetchall()
    return {"items": [_row(r) for r in rows], "total": total, "all": count(), "parsed": opts}


def count():
    with LOCK:
        return DB.execute("SELECT COUNT(*) FROM clips").fetchone()[0] if DB else 0


def stats():
    """Counts for the filter chips."""
    if DB is None:
        return {}
    with LOCK:
        out = {"all": DB.execute("SELECT COUNT(*) FROM clips").fetchone()[0],
               "pc": DB.execute("SELECT COUNT(*) FROM clips WHERE src = 'PC'").fetchone()[0],
               "pinned": DB.execute("SELECT COUNT(*) FROM clips WHERE pinned = 1").fetchone()[0]}
        out["phone"] = out["all"] - out["pc"]
        for t, n in DB.execute("SELECT type, COUNT(*) FROM clips GROUP BY type"):
            out["t_" + (t or "text")] = n
    return out


def latest(src=None, text_only=True):
    """The newest copy (optionally only from the PC or only from a phone)."""
    if DB is None:
        return None
    where = []
    if text_only:
        where.append("kind = 'text'")
    if src == "pc":
        where.append("src = 'PC'")
    elif src == "phone":
        where.append("src != 'PC'")
    w = (" WHERE " + " AND ".join(where)) if where else ""
    with LOCK:
        r = DB.execute(f"SELECT {COLS} FROM clips{w} ORDER BY last DESC LIMIT 1").fetchone()
    return _row(r) if r else None


def get(rid):
    with LOCK:
        r = DB.execute(f"SELECT {COLS} FROM clips WHERE id = ?", (int(rid),)).fetchone()
    return _row(r) if r else None


def image_path(rid):
    with LOCK:
        r = DB.execute("SELECT img FROM clips WHERE id = ?", (int(rid),)).fetchone()
    return os.path.join(DIR, "img", r[0]) if r and r[0] else None


def pin(rid, on=True):
    with LOCK:
        DB.execute("UPDATE clips SET pinned = ? WHERE id = ?", (1 if on else 0, int(rid)))
        DB.commit()


def bump(rid):
    """Copied again from the vault: move it to the top."""
    with LOCK:
        DB.execute("UPDATE clips SET last = ?, n = n + 1 WHERE id = ?", (time.time(), int(rid)))
        DB.commit()
    return get(rid)


def delete(rid):
    with LOCK:
        r = DB.execute("SELECT img FROM clips WHERE id = ?", (int(rid),)).fetchone()
        DB.execute("DELETE FROM clips WHERE id = ?", (int(rid),))
        DB.commit()
    if r and r[0]:
        try:
            os.remove(os.path.join(DIR, "img", r[0]))
        except OSError:
            pass


def clear(keep_pinned=True):
    with LOCK:
        imgs = DB.execute("SELECT img FROM clips WHERE img IS NOT NULL" + (" AND pinned = 0" if keep_pinned else "")).fetchall()
        DB.execute("DELETE FROM clips" + (" WHERE pinned = 0" if keep_pinned else ""))
        DB.commit()
    for (img,) in imgs:
        try:
            os.remove(os.path.join(DIR, "img", img))
        except OSError:
            pass


def export(fmt="json"):
    """Every text copy, oldest first (images are left out)."""
    with LOCK:
        rows = DB.execute(f"SELECT {COLS} FROM clips WHERE kind = 'text' ORDER BY ts").fetchall()
    items = [_row(r) for r in rows]
    if fmt == "txt":
        out = []
        for c in items:
            out.append(f"── {time.strftime('%Y-%m-%d %H:%M', time.localtime(c['last']))} · {c['src']}"
                       + (" · pinned" if c["pinned"] else "") + (f" · ×{c['n']}" if c["n"] > 1 else ""))
            out.append(c["text"])
            out.append("")
        return "\n".join(out)
    return json.dumps({"exported": time.time(), "items": items}, ensure_ascii=False, indent=1)
