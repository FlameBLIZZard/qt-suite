"""The phone side of Lens PC: reads what Beam received from the Beam phone app
(library.db + thumbs) and what the Lens phone app learned (Lens-backup.db: people, tags,
text in photos, word-search meanings, hidden photos).

Nothing here writes to Beam's files. The Lens index is read into memory and closed straight
away, so Beam can swap in a newer copy at any time.
"""
import json
import os
import sqlite3
import threading

import numpy as np

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
LIB = os.path.join(BASE, "library.db")
INDEX = os.path.join(BASE, "Lens-backup.db")
THUMBS = os.path.join(BASE, "thumbs")


def mtime(p):
    try:
        return os.stat(p).st_mtime_ns
    except OSError:
        return 0


class PhoneLib:
    def __init__(self):
        self.lock = threading.Lock()
        self.lib_sig = None
        self.idx_sig = None
        self.items = {}      # id -> dict
        self.hidden = set()
        self.labels = {}     # id -> "dog|grass"
        self.ocr = {}
        self.faces = {}      # mediaId -> [personId]
        self.people = {}     # personId -> {name, hidden, cover:(mediaId, box), count}
        self.clip_ids = np.zeros(0, dtype=np.int64)
        self.clip = np.zeros((0, 512), dtype=np.float32)
        self.version = 0

    def thumb_path(self, iid):
        return os.path.join(THUMBS, f"{int(iid)}.jpg")

    def refresh(self):
        """Reload whatever changed on disk. Cheap when nothing did."""
        lib_sig = (mtime(LIB), mtime(LIB + "-wal"))
        idx_sig = mtime(INDEX)
        if lib_sig == self.lib_sig and idx_sig == self.idx_sig:
            return
        with self.lock:
            if lib_sig != self.lib_sig:
                self.load_lib()
                self.lib_sig = lib_sig
            if idx_sig != self.idx_sig:
                self.load_index()
                self.idx_sig = idx_sig
            self.version += 1

    def load_lib(self):
        items = {}
        if os.path.exists(LIB):
            try:
                c = sqlite3.connect(f"file:{LIB}?mode=ro", uri=True, timeout=5)
                c.row_factory = sqlite3.Row
                for r in c.execute("SELECT * FROM item"):
                    d = dict(r)
                    d["taken"] = d["taken"] or (d["modified"] or 0) * 1000
                    items[d["id"]] = d
                c.close()
            except sqlite3.Error:
                return
        self.items = items

    def load_index(self):
        self.hidden, self.labels, self.ocr, self.faces, self.people = set(), {}, {}, {}, {}
        self.clip_ids, self.clip = np.zeros(0, dtype=np.int64), np.zeros((0, 512), dtype=np.float32)
        if not os.path.exists(INDEX):
            return
        try:
            c = sqlite3.connect(f"file:{INDEX}?mode=ro&immutable=1", uri=True, timeout=5)
            c.row_factory = sqlite3.Row
            tables = {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if "hidden_media" in tables:
                self.hidden = {r[0] for r in c.execute("SELECT mediaId FROM hidden_media")}
            for r in c.execute("SELECT mediaId, labels, ocr FROM indexed_media"):
                if r["labels"]:
                    # Lens stores tags as "|dog|grass|"; keep them as "dog|grass"
                    tags = [t.strip().lower() for t in r["labels"].replace(",", "|").split("|") if t.strip()]
                    if tags:
                        self.labels[r["mediaId"]] = "|".join(tags)
                if r["ocr"]:
                    self.ocr[r["mediaId"]] = r["ocr"]
            persons = {r["id"]: dict(r) for r in c.execute("SELECT id, name, hidden, coverFaceId FROM person")}
            best = {}
            for r in c.execute("SELECT id, mediaId, personId, `left`, top, `right`, bottom, sizePx FROM face WHERE personId IS NOT NULL"):
                if r["mediaId"] in self.hidden:
                    continue
                self.faces.setdefault(r["mediaId"], [])
                if r["personId"] not in self.faces[r["mediaId"]]:
                    self.faces[r["mediaId"]].append(r["personId"])
                box = (r["mediaId"], (r["left"], r["top"], r["right"], r["bottom"]))
                p = persons.get(r["personId"])
                if not p:
                    continue
                if r["id"] == p["coverFaceId"]:
                    best[r["personId"]] = (1e12, box)
                elif best.get(r["personId"], (-1,))[0] < r["sizePx"]:
                    best[r["personId"]] = (r["sizePx"], box)
            counts = {}
            for mid, ps in self.faces.items():
                for pid in ps:
                    counts[pid] = counts.get(pid, 0) + 1
            for pid, p in persons.items():
                if counts.get(pid):
                    self.people[pid] = {"id": pid, "name": p["name"], "hidden": bool(p["hidden"]),
                                        "count": counts[pid], "cover": best.get(pid, (0, None))[1]}
            if "clip_embedding" in tables:
                rs = c.execute("SELECT mediaId, scale, vec FROM clip_embedding WHERE scale > 0").fetchall()
                rs = [r for r in rs if len(r["vec"]) == 512 and r["mediaId"] not in self.hidden]
                if rs:
                    self.clip_ids = np.array([r["mediaId"] for r in rs], dtype=np.int64)
                    m = np.frombuffer(b"".join(r["vec"] for r in rs), dtype=np.int8).reshape(len(rs), 512).astype(np.float32)
                    m *= np.array([r["scale"] for r in rs], dtype=np.float32)[:, None]
                    self.clip = m
            c.close()
        except sqlite3.Error:
            pass

    def visible(self):
        """Phone items to show: everything Beam knows, minus what Lens keeps in Hidden."""
        return [it for iid, it in self.items.items() if iid not in self.hidden]
