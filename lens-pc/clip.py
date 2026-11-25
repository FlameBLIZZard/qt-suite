"""MobileCLIP on the PC: the same two models the Lens phone app uses, so phone and PC photos
share one "meaning" space and one search box finds both.

Preprocessing and tokenising mirror app/lens/data/index/ClipModel.kt and ClipTokenizer.kt exactly.
"""
import json
import os
import re
import shutil
import threading
import unicodedata

import numpy as np

try:
    import onnxruntime as ort
except Exception:  # Lens PC still browses without it, word search is just off
    ort = None

FILES = ("vision.onnx", "text.onnx", "tokenizer.json")
START, END = 49406, 49407
SPLIT = re.compile(r"'s|'t|'re|'ve|'m|'ll|'d|[^\W\d_]+|\d|(?:[^\s\w]|_)+")
MIN_SCORE = 0.17


def _byte_map():
    keep = list(range(33, 127)) + list(range(161, 173)) + list(range(174, 256))
    out, extra = {}, 0
    for b in range(256):
        if b in keep:
            out[b] = chr(b)
        else:
            out[b] = chr(256 + extra)
            extra += 1
    return out


class Tokenizer:
    def __init__(self, path):
        with open(path, encoding="utf-8") as f:
            model = json.load(f)["model"]
        self.vocab = model["vocab"]
        merges = [m if isinstance(m, str) else f"{m[0]} {m[1]}" for m in model["merges"]]
        self.ranks = {m: i for i, m in enumerate(merges)}
        self.bmap = _byte_map()
        self.cache = {}

    def bpe(self, word):
        if word in self.cache:
            return self.cache[word]
        parts = [c + "</w>" if i == len(word) - 1 else c for i, c in enumerate(word)]
        while len(parts) > 1:
            best, at = None, -1
            for i in range(len(parts) - 1):
                r = self.ranks.get(parts[i] + " " + parts[i + 1])
                if r is not None and (best is None or r < best):
                    best, at = r, i
            if at < 0:
                break
            parts[at:at + 2] = [parts[at] + parts[at + 1]]
        ids = [self.vocab[p] for p in parts if p in self.vocab]
        self.cache[word] = ids
        return ids

    def encode(self, text, length=77):
        clean = re.sub(r"\s+", " ", unicodedata.normalize("NFC", text)).lower()
        ids = [START]
        for m in SPLIT.finditer(clean):
            mapped = "".join(self.bmap[b] for b in m.group(0).encode("utf-8"))
            ids += self.bpe(mapped)
        ids = ids[:length - 1] + [END]
        return np.array(ids + [0] * (length - len(ids)), dtype=np.int64)


def normalize(v):
    v = np.asarray(v, dtype=np.float32)
    n = np.linalg.norm(v, axis=-1, keepdims=True)
    return v / np.maximum(n, 1e-9)


class Clip:
    def __init__(self, folder):
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = max(1, min(4, (os.cpu_count() or 4) // 2))
        prov = ["CPUExecutionProvider"]
        self.vision = ort.InferenceSession(os.path.join(folder, "vision.onnx"), opts, providers=prov)
        self.text = ort.InferenceSession(os.path.join(folder, "text.onnx"), opts, providers=prov)
        self.tok = Tokenizer(os.path.join(folder, "tokenizer.json"))
        self.lock = threading.Lock()
        self.text_cache = {}

    def _text(self, s):
        ids = self.tok.encode(s)[None, :]
        return normalize(self.text.run(None, {"input_ids": ids})[0][0])

    def embed_text(self, phrase):
        """Unit-length meaning of a phrase; two wordings averaged, like the phone."""
        q = phrase.strip()
        if q in self.text_cache:
            return self.text_cache[q]
        with self.lock:
            v = normalize(self._text(q) + self._text("a photo of " + q))
        if len(self.text_cache) > 200:
            self.text_cache.clear()
        self.text_cache[q] = v
        return v

    @staticmethod
    def pixels(im):
        """PIL image -> 3x256x256 floats: shortest side to 256, centre crop, 0..1 (no mean/std, as on the phone)."""
        from PIL import Image
        im = im.convert("RGB")
        size = 256
        scale = size / min(im.width, im.height)
        w, h = max(size, round(im.width * scale)), max(size, round(im.height * scale))
        im = im.resize((w, h), Image.BILINEAR)
        x, y = (w - size) // 2, (h - size) // 2
        im = im.crop((x, y, x + size, y + size))
        a = np.asarray(im, dtype=np.float32) / 255.0
        return a.transpose(2, 0, 1)

    def embed_images(self, ims):
        batch = np.stack([self.pixels(im) for im in ims])
        with self.lock:
            out = self.vision.run(None, {"pixel_values": batch})[0]
        return normalize(out)


def quantize(v):
    """Same 8-bit squeeze the phone stores: (int8 values, scale)."""
    peak = max(float(np.max(np.abs(v))), 1e-9)
    step = peak / 127.0
    return np.clip(np.round(v / step), -127, 127).astype(np.int8), step


def find_models(dest):
    """Model files in dest, copied there from a Lens checkout the first time."""
    if all(os.path.isfile(os.path.join(dest, f)) and os.path.getsize(os.path.join(dest, f)) > 0 for f in FILES):
        return dest
    home = os.path.expanduser("~")
    for src in (os.path.join(home, "repos", "lens", "app", "src", "main", "assets", "clip"),
                os.path.join(os.path.dirname(os.path.abspath(__file__)), "clip")):
        if all(os.path.isfile(os.path.join(src, f)) for f in FILES):
            os.makedirs(dest, exist_ok=True)
            for f in FILES:
                shutil.copyfile(os.path.join(src, f), os.path.join(dest, f + ".part"))
                os.replace(os.path.join(dest, f + ".part"), os.path.join(dest, f))
            return dest
    return None


def load(dest):
    if ort is None:
        return None
    folder = find_models(dest)
    if not folder:
        return None
    return Clip(folder)
