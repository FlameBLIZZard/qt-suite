"""Shared bits for the Toolkit layer: data folder, JSON stores, tool paths, event log."""
import glob
import json
import os
import shutil
import subprocess
import threading
import time

import shell

DATA = os.path.join(shell.DATA, "kit")
BIN = os.path.join(shell.DATA, "bin")
HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(HERE, "web")
QT = os.path.dirname(os.path.dirname(HERE))
HOME = os.path.expanduser("~")
NOWIN = 0x08000000
os.makedirs(DATA, exist_ok=True)
os.makedirs(BIN, exist_ok=True)

_locks = {}
_cache = {}


def _lock(name):
    return _locks.setdefault(name, threading.Lock())


def load(name, default):
    """Read DATA/<name>.json (cached). Returns a deep copy so callers can't mutate the cache."""
    with _lock(name):
        if name not in _cache:
            v = default
            try:
                with open(os.path.join(DATA, name + ".json"), encoding="utf-8") as f:
                    got = json.load(f)
                if type(got) is type(default):
                    v = got
                    if isinstance(default, dict):
                        v = dict(default, **got)
            except (OSError, ValueError):
                pass
            _cache[name] = v
        return json.loads(json.dumps(_cache[name]))


def save(name, value):
    with _lock(name):
        _cache[name] = json.loads(json.dumps(value))
        p = os.path.join(DATA, name + ".json")
        tmp = p + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(value, f, ensure_ascii=False, indent=1)
        os.replace(tmp, p)
    return value


def which(exe, extra=()):
    p = shutil.which(exe)
    if p:
        return p
    for pat in extra:
        hits = sorted(glob.glob(pat))
        if hits:
            return hits[-1]
    return None


def ffmpeg(name="ffmpeg"):
    return which(name, [os.path.join(os.environ.get("LOCALAPPDATA", ""), r"Microsoft\WinGet\Packages\Gyan.FFmpeg*\*\bin", name + ".exe")])


def adb():
    return which("adb", [os.path.join(HOME, r"Android\Sdk\platform-tools\adb.exe"),
                         os.path.join(BIN, r"scrcpy\*\adb.exe")])


def run(args, timeout=30, **kw):
    """Run a program quietly; returns (code, stdout+stderr text)."""
    try:
        r = subprocess.run(args, capture_output=True, timeout=timeout, creationflags=NOWIN, **kw)
        out = (r.stdout or b"") + (r.stderr or b"")
        return r.returncode, out.decode("utf-8", "replace")
    except subprocess.TimeoutExpired:
        return -1, "timed out"
    except OSError as e:
        return -2, str(e)


def spawn(args, **kw):
    return subprocess.Popen(args, creationflags=NOWIN, stdin=subprocess.DEVNULL,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **kw)


def ps(script, timeout=40):
    return run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], timeout=timeout)


# ------------------------------------------------------------ events / XP feed ---
_ev_lock = threading.Lock()
_listeners = []


def event(kind, detail="", xp=None):
    """Log a Toolkit event (XP, streak calendar). kind like 'focus.done', 'backup.ok'."""
    e = {"t": time.time(), "k": kind, "d": str(detail)[:120]}
    if xp is not None:
        e["xp"] = xp
    with _ev_lock:
        with open(os.path.join(DATA, "events.jsonl"), "a", encoding="utf-8") as f:
            f.write(json.dumps(e, ensure_ascii=False) + "\n")
    for fn in list(_listeners):
        try:
            fn(e)
        except Exception:
            pass
    return e


def events(since=0):
    out = []
    try:
        with open(os.path.join(DATA, "events.jsonl"), encoding="utf-8") as f:
            for line in f:
                try:
                    e = json.loads(line)
                except ValueError:
                    continue
                if e.get("t", 0) >= since:
                    out.append(e)
    except OSError:
        pass
    return out


def human(n):
    n = float(n or 0)
    for u in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024 or u == "TB":
            return f"{n:.0f} {u}" if u == "B" else f"{n:.1f} {u}"
        n /= 1024
