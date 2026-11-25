"""Word-search meanings for phone photos, worked out on the PC from Beam's thumbnails.

The Lens phone app saves its own meanings in Lens-backup.db, but only once its word-search pass
has finished and a backup has been written (weekly). Until then phone photos could not be found by
meaning on the PC. This fills the gap: any phone photo the backup has no meaning for gets one from
its thumbnail, with the same model, and the phone's own meaning wins as soon as it arrives.
"""
import os
import sqlite3
import threading
import time

import numpy as np

import clip as cliplib

SCHEMA = """CREATE TABLE IF NOT EXISTS mean(id INTEGER PRIMARY KEY, mtime INTEGER, scale REAL, vec BLOB)"""


class PhoneMeanings:
    def __init__(self, data, phone, clip_getter):
        self.path = os.path.join(data, "phonemean.db")
        self.phone = phone
        self.clip_getter = clip_getter
        self.lock = threading.Lock()
        self.kick = threading.Event()
        self.version = 0
        self.progress = {"running": False, "done": 0, "todo": 0}
        with self.db() as c:
            c.execute("PRAGMA journal_mode=WAL")
            c.execute(SCHEMA)

    def db(self):
        return sqlite3.connect(self.path, timeout=15)

    def start(self):
        threading.Thread(target=self.loop, daemon=True, name="phonemean").start()

    def loop(self):
        while True:
            try:
                self.fill()
            except Exception:
                pass
            self.kick.wait(120)
            self.kick.clear()

    def wanted(self):
        """Visible phone ids with a thumbnail and no meaning from the phone."""
        self.phone.refresh()
        have = set(self.phone.clip_ids.tolist())
        out = []
        for iid in list(self.phone.items):
            if iid in have or iid in self.phone.hidden:
                continue
            p = self.phone.thumb_path(iid)
            try:
                out.append((iid, os.stat(p).st_mtime_ns, p))
            except OSError:
                pass
        return out

    def fill(self):
        model = self.clip_getter()
        if not model:
            return
        want = self.wanted()
        with self.db() as c:
            known = {r[0]: r[1] for r in c.execute("SELECT id, mtime FROM mean")}
        todo = [w for w in want if known.get(w[0]) != w[1]]
        if not todo:
            return
        from PIL import Image
        self.progress.update(running=True, done=0, todo=len(todo))
        batch = []
        for i, (iid, mt, p) in enumerate(todo):
            try:
                with Image.open(p) as im:
                    im.load()
                    batch.append((iid, mt, im.convert("RGB")))
            except Exception:
                batch.append((iid, mt, None))
            if len(batch) >= 16 or i == len(todo) - 1:
                self.flush(model, batch)
                self.progress["done"] = i + 1
                batch = []
                time.sleep(0.02)  # stay polite to the rest of the PC
        self.progress["running"] = False

    def flush(self, model, batch):
        ims = [b for b in batch if b[2] is not None]
        vecs = {}
        if ims:
            try:
                for (iid, _, _), v in zip(ims, model.embed_images([b[2] for b in ims])):
                    vecs[iid] = cliplib.quantize(v)
            except Exception:
                return
        with self.db() as c:
            for iid, mt, _ in batch:
                q = vecs.get(iid)
                c.execute("INSERT OR REPLACE INTO mean(id, mtime, scale, vec) VALUES(?,?,?,?)",
                          (iid, mt, float(q[1]) if q else 0.0, q[0].tobytes() if q else None))
        self.version += 1

    def vectors(self):
        """(ids, float32 matrix) of phone photos that only have a PC-made meaning."""
        have = set(self.phone.clip_ids.tolist())
        with self.db() as c:
            rs = [r for r in c.execute("SELECT id, scale, vec FROM mean WHERE scale > 0 AND vec IS NOT NULL")
                  if r[0] not in have and r[0] not in self.phone.hidden and r[0] in self.phone.items]
        if not rs:
            return np.zeros(0, dtype=np.int64), np.zeros((0, 512), dtype=np.float32)
        ids = np.array([r[0] for r in rs], dtype=np.int64)
        m = np.frombuffer(b"".join(r[2] for r in rs), dtype=np.int8).reshape(len(rs), 512).astype(np.float32)
        m *= np.array([r[1] for r in rs], dtype=np.float32)[:, None]
        return ids, m
