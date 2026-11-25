"""PC photo folders for Lens PC: finds photos and videos, makes thumbnails, reads the date taken
and gives each one a MobileCLIP "meaning" so word search covers the PC too.

Everything lives in %LOCALAPPDATA%\\LensPC (pc.db + thumbs\\). Runs in one background thread.
"""
import os
import shutil
import sqlite3
import subprocess
import threading
import time

import numpy as np

try:
    from PIL import Image, ImageOps
    Image.MAX_IMAGE_PIXELS = 300_000_000
    try:
        import pillow_heif
        pillow_heif.register_heif_opener()
    except Exception:
        pass
except Exception:
    Image = None

import clip as cliplib

IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".tif", ".tiff", ".heic", ".heif", ".avif", ".jfif"}
VIDEO_EXT = {".mp4", ".mov", ".mkv", ".webm", ".m4v", ".avi", ".3gp", ".wmv"}
SKIP_DIRS = {"$recycle.bin", "system volume information", "node_modules", ".git", "__pycache__", ".thumbnails",
             "appdata", ".gradle", "venv", ".venv"}
NOWIN = 0x08000000 if os.name == "nt" else 0
THUMB = 384
MIN_SIZE = 8 << 10  # skip icons and tiny UI images

SCHEMA = """
CREATE TABLE IF NOT EXISTS photo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT UNIQUE, folder TEXT, root TEXT, name TEXT,
  size INTEGER, mtime REAL, taken INTEGER, w INTEGER, h INTEGER,
  video INTEGER, duration INTEGER,
  thumb INTEGER DEFAULT 0, vec BLOB, scale REAL DEFAULT 0, seen REAL
);
CREATE INDEX IF NOT EXISTS photo_taken ON photo(taken);
"""


def find_ffmpeg():
    f = shutil.which("ffmpeg")
    if f:
        return f
    base = os.path.join(os.environ.get("LOCALAPPDATA", ""), "Microsoft", "WinGet", "Packages")
    if os.path.isdir(base):
        for d in os.listdir(base):
            if "ffmpeg" in d.lower():
                for root, _dirs, files in os.walk(os.path.join(base, d)):
                    if "ffmpeg.exe" in files:
                        return os.path.join(root, "ffmpeg.exe")
    return None


def exif_taken(im):
    """Date taken from EXIF as ms since epoch (local time), or 0."""
    try:
        ex = im.getexif()
        raw = ex.get_ifd(0x8769).get(36867) or ex.get(306)
        if not raw:
            return 0
        t = time.strptime(str(raw).strip()[:19], "%Y:%m:%d %H:%M:%S")
        return int(time.mktime(t) * 1000)
    except Exception:
        return 0


class PcIndex:
    def __init__(self, data, clip_getter, exclude=()):
        self.data = data
        self.thumbs = os.path.join(data, "pcthumbs")
        os.makedirs(self.thumbs, exist_ok=True)
        self.path = os.path.join(data, "pc.db")
        self.clip_getter = clip_getter
        self.exclude = [os.path.normcase(os.path.abspath(e)) for e in exclude if e]
        self.ffmpeg = find_ffmpeg()
        self.lock = threading.RLock()
        self.kick = threading.Event()
        self.folders = []
        self.progress = {"running": False, "done": 0, "todo": 0, "phase": "idle", "at": 0, "error": None}
        self.version = 0  # bumps when rows change, so search caches reload
        with self.db() as c:
            c.execute("PRAGMA journal_mode=WAL")
            c.executescript(SCHEMA)

    def db(self):
        c = sqlite3.connect(self.path, timeout=15)
        c.row_factory = sqlite3.Row
        return c

    def thumb_path(self, pid):
        return os.path.join(self.thumbs, f"{int(pid)}.jpg")

    # ------------------------------------------------------------ scanning ---
    def set_folders(self, folders):
        self.folders = [os.path.abspath(f) for f in folders if f]
        self.kick.set()

    def start(self):
        threading.Thread(target=self.loop, daemon=True, name="pcindex").start()

    def loop(self):
        while True:
            try:
                self.scan()
            except Exception as e:
                self.progress.update(running=False, phase="idle", error=str(e)[:200])
            self.kick.wait(600)
            self.kick.clear()

    def excluded(self, path):
        n = os.path.normcase(path)
        return any(n == e or n.startswith(e + os.sep) for e in self.exclude)

    def walk(self, root):
        stack = [root]
        while stack:
            d = stack.pop()
            try:
                with os.scandir(d) as it:
                    for e in it:
                        try:
                            if e.is_dir(follow_symlinks=False):
                                if e.name.lower() not in SKIP_DIRS and not e.name.startswith(".") and not self.excluded(e.path):
                                    stack.append(e.path)
                                continue
                            ext = os.path.splitext(e.name)[1].lower()
                            if ext in IMAGE_EXT or ext in VIDEO_EXT:
                                st = e.stat()
                                if st.st_size >= MIN_SIZE or ext in VIDEO_EXT:
                                    yield e.path, st, ext in VIDEO_EXT
                        except OSError:
                            continue
            except OSError:
                continue

    def scan(self):
        folders = list(self.folders)
        self.progress.update(running=True, phase="looking", done=0, todo=0, error=None)
        now = time.time()
        with self.db() as c:
            known = {r["path"]: (r["id"], r["size"], r["mtime"], r["thumb"], r["scale"]) for r in
                     c.execute("SELECT id, path, size, mtime, thumb, scale FROM photo")}
        todo, seen = [], set()
        for root in folders:
            if not os.path.isdir(root):
                continue
            for path, st, video in self.walk(root):
                seen.add(path)
                k = known.get(path)
                if not k or k[1] != st.st_size or abs(k[2] - st.st_mtime) > 1 or not k[3] or (k[4] == 0 and self.clip_getter()):
                    todo.append((path, st, video, root))
        # forget files that are gone or whose folder was removed
        gone = [v[0] for p, v in known.items() if p not in seen]
        if gone:
            with self.lock, self.db() as c:
                c.executemany("DELETE FROM photo WHERE id=?", [(i,) for i in gone])
            for i in gone:
                try:
                    os.remove(self.thumb_path(i))
                except OSError:
                    pass
            self.version += 1
        todo.sort(key=lambda t: -t[1].st_mtime)  # newest first
        self.progress.update(phase="indexing", todo=len(todo), done=0)
        batch = []
        for path, st, video, root in todo:
            batch.append(self.one(path, st, video, root, now))
            self.progress["done"] += 1
            if len(batch) >= 16:
                self.flush(batch)
                batch = []
        self.flush(batch)
        self.progress.update(running=False, phase="idle", at=time.time())

    def one(self, path, st, video, root, now):
        """Read one file. Returns a row dict plus the decoded preview image (for CLIP)."""
        row = {"path": path, "folder": os.path.dirname(path), "root": root, "name": os.path.basename(path),
               "size": st.st_size, "mtime": st.st_mtime, "taken": 0, "w": 0, "h": 0, "video": 1 if video else 0,
               "duration": 0, "seen": now, "img": None}
        try:
            if video:
                row["img"] = self.video_frame(path)
            elif Image is not None:
                with Image.open(path) as im:
                    row["w"], row["h"] = im.size
                    row["taken"] = exif_taken(im)
                    im.draft("RGB", (THUMB * 2, THUMB * 2))
                    im = ImageOps.exif_transpose(im)
                    if im.mode not in ("RGB", "L"):
                        bg = Image.new("RGB", im.size, (34, 31, 39))
                        im = im.convert("RGBA")
                        bg.paste(im, mask=im.split()[-1])
                        im = bg
                    im = im.convert("RGB")
                    im.thumbnail((THUMB * 2, THUMB * 2))
                    row["img"] = im
                    if (im.width > im.height) != (row["w"] > row["h"]):  # EXIF rotation swapped the sides
                        row["w"], row["h"] = row["h"], row["w"]
        except Exception:
            row["img"] = None
        if video and row["img"] is not None:
            row["w"], row["h"] = row["img"].size
        if not row["taken"]:
            row["taken"] = int(st.st_mtime * 1000)
        return row

    def video_frame(self, path):
        if not self.ffmpeg or Image is None:
            return None
        import io
        for seek in ("1", None):
            cmd = [self.ffmpeg, "-v", "error"] + (["-ss", seek] if seek else []) + [
                "-i", path, "-frames:v", "1", "-vf", f"scale={THUMB * 2}:{THUMB * 2}:force_original_aspect_ratio=decrease",
                "-f", "image2pipe", "-vcodec", "mjpeg", "-"]
            try:
                r = subprocess.run(cmd, capture_output=True, timeout=25, creationflags=NOWIN)
                if r.returncode == 0 and r.stdout:
                    im = Image.open(io.BytesIO(r.stdout))
                    im.load()
                    return im.convert("RGB")
            except Exception:
                pass
        return None

    def flush(self, rows):
        if not rows:
            return
        model = self.clip_getter()
        vecs = [None] * len(rows)
        imgs = [(i, r["img"]) for i, r in enumerate(rows) if r["img"] is not None]
        if model and imgs:
            try:
                out = model.embed_images([im for _, im in imgs])
                for (i, _), v in zip(imgs, out):
                    vecs[i] = cliplib.quantize(v)
            except Exception:
                pass
        with self.lock, self.db() as c:
            for r, v in zip(rows, vecs):
                c.execute("""INSERT INTO photo(path,folder,root,name,size,mtime,taken,w,h,video,duration,seen,thumb,vec,scale)
                             VALUES(?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)
                             ON CONFLICT(path) DO UPDATE SET folder=excluded.folder, root=excluded.root, name=excluded.name,
                               size=excluded.size, mtime=excluded.mtime, taken=excluded.taken, w=excluded.w, h=excluded.h,
                               video=excluded.video, seen=excluded.seen,
                               vec=COALESCE(excluded.vec, photo.vec), scale=MAX(excluded.scale, photo.scale)""",
                          (r["path"], r["folder"], r["root"], r["name"], r["size"], r["mtime"], r["taken"], r["w"], r["h"],
                           r["video"], r["duration"], r["seen"], v[0].tobytes() if v else None, float(v[1]) if v else 0.0))
                pid = c.execute("SELECT id FROM photo WHERE path=?", (r["path"],)).fetchone()[0]
                ok = 0
                if r["img"] is not None:
                    try:
                        im = r["img"].copy()
                        im.thumbnail((THUMB, THUMB))
                        tmp = self.thumb_path(pid) + ".tmp"
                        im.save(tmp, "JPEG", quality=82)
                        os.replace(tmp, self.thumb_path(pid))
                        ok = 1
                    except Exception:
                        ok = 0
                c.execute("UPDATE photo SET thumb=? WHERE id=?", (ok or -1, pid))
        for r in rows:
            r["img"] = None
        self.version += 1

    # ------------------------------------------------------------- reading ---
    def rows(self):
        with self.db() as c:
            return [dict(r) for r in c.execute(
                "SELECT id, path, folder, root, name, size, taken, w, h, video, duration, thumb FROM photo")]

    def row(self, pid):
        with self.db() as c:
            r = c.execute("SELECT * FROM photo WHERE id=?", (pid,)).fetchone()
            return dict(r) if r else None

    def vectors(self):
        """(ids, float32 matrix) of every PC photo with a meaning."""
        with self.db() as c:
            rs = c.execute("SELECT id, vec, scale FROM photo WHERE scale > 0 AND vec IS NOT NULL").fetchall()
        if not rs:
            return np.zeros(0, dtype=np.int64), np.zeros((0, 512), dtype=np.float32)
        ids = np.array([r["id"] for r in rs], dtype=np.int64)
        m = np.frombuffer(b"".join(r["vec"] for r in rs), dtype=np.int8).reshape(len(rs), 512).astype(np.float32)
        m *= np.array([r["scale"] for r in rs], dtype=np.float32)[:, None]
        return ids, m

