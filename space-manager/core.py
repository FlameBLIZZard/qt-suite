"""Space Manager core: drives, cleanup, "what's big" scans, reels, safe moves. No HTTP here.

Safety rules (every destructive call goes through these):
- Nothing of the person's is ever permanently deleted. Their files only go to the Recycle Bin,
  and only on a drive that has one (otherwise Windows would delete them for good).
- Cleanup deletes only caches and leftovers listed in CATEGORIES, never anything else.
- Emptying the Recycle Bin is its own, separately confirmed action.
- Windows, program, game-install and profile folders are refused (protected()).
- With SPACE_SANDBOX set (tests), every destructive call must stay inside that folder.
"""
import csv
import ctypes
import hashlib
import json
import os
import re
import shutil
import stat as statmod
import subprocess
import threading
import time
import uuid
from ctypes import wintypes

HERE = os.path.dirname(os.path.abspath(__file__))
QT = os.path.dirname(HERE)
DATA = os.environ.get("SPACE_DATA") or os.path.join(os.environ.get("LOCALAPPDATA") or HERE, "SpaceManager")
os.makedirs(DATA, exist_ok=True)
SANDBOX = os.path.abspath(os.environ["SPACE_SANDBOX"]) if os.environ.get("SPACE_SANDBOX") else ""
NOWIN = 0x08000000
L, R, W = os.environ.get("LOCALAPPDATA", ""), os.environ.get("APPDATA", ""), os.environ.get("windir", r"C:\Windows")
HOME = os.path.expanduser("~")
TEMP = os.environ.get("TEMP", os.path.join(L, "Temp"))

DEFAULT_CONFIG = {
    "reels_root": "",   # reel projects on the SSD
    "reels_archive": "",        # where finished reel frames go
    "inbox": os.path.join(HOME, "Space Manager Inbox"),                                       # "Move to D: Inbox" target
    "log_dir": "",                               # log here when D: is plugged in
    "reel_min_age_hrs": 24,                                        # only pre-select reels untouched this long
    "big_file_mb": 50,                                             # files smaller than this are not listed
    "scan_root": "C:\\",
}
CONFIG_PATH = os.path.join(DATA, "config.json")


def load_config():
    c = dict(DEFAULT_CONFIG)
    try:
        with open(CONFIG_PATH, encoding="utf-8") as f:
            c.update({k: v for k, v in json.load(f).items() if k in DEFAULT_CONFIG})
    except (OSError, ValueError):
        pass
    return c


CONFIG = load_config()


def save_config(new):
    for k, v in new.items():
        if k not in DEFAULT_CONFIG:
            continue
        if isinstance(DEFAULT_CONFIG[k], int):
            v = max(1, min(100000, int(v)))
        else:
            v = str(v).strip().strip('"')
        CONFIG[k] = v
    tmp = CONFIG_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({k: CONFIG[k] for k in DEFAULT_CONFIG}, f, indent=1)
    os.replace(tmp, CONFIG_PATH)
    return CONFIG


# ------------------------------------------------------------------ helpers ---
def norm(p):
    p = os.path.expandvars(os.path.expanduser(str(p or "").strip().strip('"')))
    if re.fullmatch(r"[A-Za-z]:", p):
        p += "\\"
    return os.path.abspath(p) if p else ""


def inside(p, root):
    p, root = os.path.normcase(os.path.abspath(p)).rstrip("\\"), os.path.normcase(os.path.abspath(root)).rstrip("\\")
    return p == root or p.startswith(root + "\\")


def is_admin():
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


# --------------------------------------------------------------------- log ---
LOG_LOCK = threading.Lock()


def log_path():
    d = CONFIG["log_dir"] if os.path.isdir(CONFIG["log_dir"]) and not SANDBOX else os.path.join(DATA, "logs")
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, "space-manager-%s.csv" % time.strftime("%Y-%m"))


def log(action, path="", detail="", nbytes=0):
    try:
        with LOG_LOCK:
            p = log_path()
            new = not os.path.exists(p)
            with open(p, "a", newline="", encoding="utf-8-sig" if new else "utf-8") as f:
                w = csv.writer(f)
                if new:
                    w.writerow(["Time", "Action", "Path", "Detail", "Bytes"])
                w.writerow([time.strftime("%Y-%m-%d %H:%M:%S"), action, path, detail, int(nbytes)])
    except OSError:
        pass


FREED_ACTIONS = {"CLEAN", "EMPTY-RECYCLE-BIN", "RECYCLE"}      # space given back on this drive
MOVED_ACTIONS = {"MOVE", "MOVE-REEL-FRAMES"}                  # space moved off to D:


def read_log(limit=300):
    """Newest rows first, plus totals: freed/moved this month and ever (all monthly files)."""
    rows = []
    d = os.path.dirname(log_path())
    files = sorted((f for f in os.listdir(d) if f.startswith("space-manager-") and f.endswith(".csv")), reverse=True)
    month = time.strftime("%Y-%m")
    stats = {"month": {"freed": 0, "moved": 0, "actions": 0}, "ever": {"freed": 0, "moved": 0, "actions": 0}, "since": ""}
    for name in files:
        try:
            with open(os.path.join(d, name), encoding="utf-8-sig", newline="") as f:
                got = list(csv.DictReader(f))
        except OSError:
            continue
        for r in got:
            a = r.get("Action", "")
            try:
                n = int(float(r.get("Bytes") or 0))
            except ValueError:
                n = 0
            key = "freed" if a in FREED_ACTIONS else "moved" if a in MOVED_ACTIONS else None
            if not key:
                continue
            for bucket in ("ever",) + (("month",) if (r.get("Time") or "").startswith(month) else ()):
                stats[bucket][key] += n
                stats[bucket]["actions"] += 1
            t = r.get("Time") or ""
            if t and (not stats["since"] or t < stats["since"]):
                stats["since"] = t
        if len(rows) < limit:
            rows.extend(got[::-1])
    return {"path": log_path(), "rows": rows[:limit], "stats": stats}


# ------------------------------------------------------------------ drives ---
k32 = ctypes.windll.kernel32
sh32 = ctypes.windll.shell32


class SHQUERYRBINFO(ctypes.Structure):
    _fields_ = [("cbSize", wintypes.DWORD), ("i64Size", ctypes.c_longlong), ("i64NumItems", ctypes.c_longlong)]


def recycle_bin(root=None):
    """Size of the Recycle Bin (all drives, or one root like 'C:\\'). None if that drive has no bin."""
    info = SHQUERYRBINFO(cbSize=ctypes.sizeof(SHQUERYRBINFO))
    hr = sh32.SHQueryRecycleBinW(root, ctypes.byref(info))
    if hr != 0:
        return None
    return {"bytes": int(info.i64Size), "count": int(info.i64NumItems)}


_DISK_TYPES = {"at": 0, "map": {}}


def _disk_types():
    """Letter -> 'NVMe SSD' / 'USB Hard drive (HDD)' etc. Asks Windows once every 10 minutes (it's slow)."""
    if time.time() - _DISK_TYPES["at"] < 600:
        return _DISK_TYPES["map"]
    ps = ("$d=@{}; Get-PhysicalDisk | % { $d[[string]$_.DeviceId]=$_ }; "
          "Get-Partition | ? DriveLetter | % { $p=$d[[string]$_.DiskNumber]; if ($p) { "
          "[pscustomobject]@{L=[string]$_.DriveLetter; Bus=[string]$p.BusType; Media=[string]$p.MediaType; Model=$p.FriendlyName} } } | ConvertTo-Json -Compress")
    out = {}
    try:
        r = subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True, text=True, timeout=25, creationflags=NOWIN)
        data = json.loads(r.stdout or "[]")
        for x in data if isinstance(data, list) else [data]:
            media, bus = x.get("Media") or "", x.get("Bus") or ""
            t = "NVMe SSD" if bus == "NVMe" else "SSD" if media == "SSD" else "Hard drive (HDD)" if media == "HDD" or "HDD" in (x.get("Model") or "") else media or "Drive"
            if bus == "USB":
                t = "USB " + t
            out[x["L"].upper()] = {"type": t, "model": x.get("Model") or "", "usb": bus == "USB"}
    except Exception:
        pass
    _DISK_TYPES.update(at=time.time(), map=out)
    return out


def _vol(root):
    name, fs = ctypes.create_unicode_buffer(261), ctypes.create_unicode_buffer(261)
    ok = k32.GetVolumeInformationW(root, name, 261, None, None, None, fs, 261)
    return (name.value, fs.value) if ok else ("", "")


def drive_list():
    mask = k32.GetLogicalDrives()
    types = _disk_types()
    out = []
    for i in range(26):
        if not mask & (1 << i):
            continue
        letter = chr(65 + i)
        root = letter + ":\\"
        if k32.GetDriveTypeW(root) not in (2, 3, 4, 6):  # removable, fixed, network, ramdisk
            continue
        free, total = ctypes.c_ulonglong(), ctypes.c_ulonglong()
        if not k32.GetDiskFreeSpaceExW(root, None, ctypes.byref(total), ctypes.byref(free)) or not total.value:
            continue
        label, fs = _vol(root)
        t = types.get(letter, {})
        rb = recycle_bin(root)
        out.append({"letter": letter, "root": root, "label": label, "fs": fs, "size": total.value, "free": free.value,
                    "type": t.get("type", "Drive"), "model": t.get("model", ""), "usb": t.get("usb", False),
                    "bin": rb["bytes"] if rb else None})
    record_history(out)
    return out


HISTORY_PATH = os.path.join(DATA, "history.json")


def _load_history():
    try:
        with open(HISTORY_PATH, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def record_history(drives):
    """Keeps one free-space reading per drive per day (the latest), for the last 120 days."""
    h = _load_history()
    day = time.strftime("%Y-%m-%d")
    h.setdefault(day, {}).update({d["letter"]: d["free"] for d in drives})
    for k in sorted(h)[:-120]:
        del h[k]
    try:
        with open(HISTORY_PATH + ".tmp", "w", encoding="utf-8") as f:
            json.dump(h, f)
        os.replace(HISTORY_PATH + ".tmp", HISTORY_PATH)
    except OSError:
        pass


def history():
    h = _load_history()
    days = sorted(h)[-60:]
    return [{"day": d, "free": h[d]} for d in days]


# -------------------------------------------------------------------- jobs ---
class Job:
    """A background task with progress the page polls. Cancel sets .cancel."""
    ALL = {}

    def __init__(self, kind, fn, *args):
        self.id = uuid.uuid4().hex[:10]
        self.kind, self.state, self.msg, self.done, self.total = kind, "running", "Starting", 0, 0
        self.result, self.error, self.cancel, self.started = None, None, False, time.time()
        Job.ALL[self.id] = self
        for old in [k for k, j in Job.ALL.items() if j.state != "running" and time.time() - j.started > 3600]:
            Job.ALL.pop(old, None)
        threading.Thread(target=self._run, args=(fn, args), daemon=True).start()

    def _run(self, fn, args):
        try:
            self.result = fn(self, *args)
            self.state = "cancelled" if self.cancel else "done"
        except Exception as e:  # shown to the person as-is
            self.error, self.state = str(e)[:400], "error"

    def view(self):
        return {"id": self.id, "kind": self.kind, "state": self.state, "msg": self.msg, "done": self.done, "total": self.total,
                "result": self.result if self.state != "running" else None, "error": self.error,
                "secs": round(time.time() - self.started, 1)}

    @staticmethod
    def running(kind):
        return next((j for j in Job.ALL.values() if j.kind == kind and j.state == "running"), None)


# ----------------------------------------------------------------- cleanup ---
def _browser_cache_roots():
    roots = []
    for ud in (rf"{L}\Microsoft\Edge\User Data", rf"{L}\BraveSoftware\Brave-Browser\User Data", rf"{L}\Google\Chrome\User Data"):
        try:
            profiles = [e.path for e in os.scandir(ud) if e.is_dir() and re.fullmatch(r"Default|Profile \d+", e.name)]
        except OSError:
            continue
        for p in profiles:
            roots += [os.path.join(p, s) for s in ("Cache", "Code Cache", "GPUCache")]
    return roots


def categories():
    if SANDBOX:  # tests: the same kinds of category, all inside the scratch folder
        s = SANDBOX
        return [
            {"id": "usertemp", "name": "Temporary files", "default": True, "age": 24, "empty_dirs": True, "desc": "Sandbox temp.",
             "roots": [os.path.join(s, "Temp")], "exclude": [os.path.join(s, "Temp", "keep")]},
            {"id": "crash", "name": "Crash dumps and error reports", "default": True, "empty_dirs": True, "desc": "Sandbox dumps.",
             "roots": [os.path.join(s, "CrashDumps")]},
            {"id": "thumbs", "name": "Thumbnail cache", "default": False, "desc": "Sandbox thumbs.",
             "roots": [os.path.join(s, "Explorer")], "include": [r"thumbcache_.*\.db"]},
            {"id": "wintemp", "name": "Windows temp files", "default": True, "admin": True, "desc": "Needs admin.",
             "roots": [os.path.join(s, "WinTemp")]},
        ]
    return [
        {"id": "usertemp", "name": "Temporary files", "default": True, "age": 24, "empty_dirs": True, "icon": "temp",
         "desc": "Your temp folder. Only files older than 1 day, so running apps are not affected.",
         "roots": [TEMP], "exclude": [os.path.join(TEMP, "claude")]},
        {"id": "wintemp", "name": "Windows temp files", "default": True, "age": 24, "empty_dirs": True, "admin": True, "icon": "temp",
         "desc": "The system temp folder. Needs admin.", "roots": [rf"{W}\Temp"]},
        {"id": "winupdate", "name": "Windows Update downloads", "default": True, "age": 72, "empty_dirs": True, "admin": True, "icon": "update",
         "desc": "Installer files for updates that are already installed. Needs admin.", "roots": [rf"{W}\SoftwareDistribution\Download"]},
        {"id": "crash", "name": "Crash dumps and error reports", "default": True, "empty_dirs": True, "icon": "crash",
         "desc": "Left behind when apps or games crash. Only useful for bug reports.",
         "roots": [rf"{L}\CrashDumps", rf"{L}\Microsoft\Windows\WER\ReportArchive", rf"{L}\Microsoft\Windows\WER\ReportQueue"]},
        {"id": "browser", "name": "Browser caches", "default": True, "icon": "browser",
         "desc": "Edge, Brave and Chrome. Close them first. Logins, history and bookmarks are not touched.", "roots": _browser_cache_roots()},
        {"id": "apps", "name": "App caches", "default": True, "icon": "apps",
         "desc": "Discord and the Steam web view. Close them first; files in use are skipped.",
         "roots": [rf"{R}\discord\Cache", rf"{R}\discord\Code Cache", rf"{R}\discord\GPUCache", rf"{L}\Steam\htmlcache"]},
        {"id": "thumbs", "name": "Thumbnail cache", "default": False, "icon": "thumbs",
         "desc": "Explorer rebuilds it. Most of it is locked while Explorer runs, so it is often skipped.",
         "roots": [rf"{L}\Microsoft\Windows\Explorer"], "include": [r"thumbcache_.*\.db", r"iconcache_.*\.db"]},
        {"id": "shader", "name": "GPU shader caches", "default": False, "icon": "gpu",
         "desc": "Rebuilt automatically, but games can stutter for a few minutes afterwards. Only after a driver update or glitches.",
         "roots": [rf"{L}\AMD\DxCache", rf"{L}\AMD\DxcCache", rf"{L}\AMD\VkCache", rf"{L}\D3DSCache", rf"{L}\NVIDIA\DXCache", rf"{L}\NVIDIA\GLCache"]},
        {"id": "dev", "name": "Developer caches", "default": False, "icon": "dev",
         "desc": "pip and npm download caches. Packages download again next time you install them.",
         "roots": [rf"{L}\pip\Cache", rf"{L}\npm-cache"]},
    ]


def _cat_files(cat, job=None):
    """Yields (path, size) of the files a category would delete."""
    cutoff = time.time() - float(cat.get("age", 0)) * 3600
    excl = [os.path.normcase(e) for e in cat.get("exclude", [])]
    inc = [re.compile(p, re.I) for p in cat.get("include", [])]
    for root in cat["roots"]:
        if not root or not os.path.isdir(root):
            continue
        stack = [root]
        while stack:
            if job and job.cancel:
                return
            d = stack.pop()
            if any(os.path.normcase(d) == e or os.path.normcase(d).startswith(e + "\\") for e in excl):
                continue
            try:
                it = list(os.scandir(d))
            except OSError:
                continue
            for e in it:
                try:
                    if e.is_dir(follow_symlinks=False):
                        if not inc and not e.is_symlink():
                            stack.append(e.path)
                        continue
                    if inc and not any(p.fullmatch(e.name) for p in inc):
                        continue
                    st = e.stat(follow_symlinks=False)
                    if st.st_mtime <= cutoff:
                        yield e.path, st.st_size
                except OSError:
                    continue


def last_cleaned():
    """Category name -> {"at", "bytes"} of the newest CLEAN log row for it."""
    out = {}
    try:
        for r in read_log(3000)["rows"]:  # newest first
            if r.get("Action") == "CLEAN" and r.get("Path") and r["Path"] not in out:
                out[r["Path"]] = {"at": r.get("Time", ""), "bytes": int(float(r.get("Bytes") or 0))}
            elif r.get("Action") == "EMPTY-RECYCLE-BIN" and "Recycle Bin" not in out:
                out["Recycle Bin"] = {"at": r.get("Time", ""), "bytes": int(float(r.get("Bytes") or 0))}
    except (OSError, ValueError):
        pass
    return out


def measure_job(job):
    admin, out = is_admin(), []
    cats = categories()
    last = last_cleaned()
    job.total = len(cats) + 1
    for c in cats:
        job.msg = "Measuring " + c["name"].lower()
        row = {"id": c["id"], "name": c["name"], "desc": c["desc"], "icon": c.get("icon", ""), "default": c["default"]}
        if c.get("admin") and not admin:
            row.update(bytes=None, files=0, status="admin")
        else:
            n = b = 0
            for _, size in _cat_files(c, job):
                n += 1
                b += size
            row.update(bytes=b, files=n, status="ready" if b else "clean")
        row["last"] = last.get(c["name"])
        out.append(row)
        job.done += 1
    if not SANDBOX:
        rb = recycle_bin() or {"bytes": 0, "count": 0}
        out.append({"id": "recycle", "name": "Recycle Bin", "icon": "bin", "default": False, "bytes": rb["bytes"], "files": rb["count"],
                    "status": "permanent" if rb["bytes"] else "clean", "last": last.get("Recycle Bin"),
                    "desc": "Permanently deletes everything already in the Recycle Bin on every drive. This one cannot be undone."})
    job.done = job.total
    return {"rows": out, "admin": admin}


def clean_job(job, ids, empty_bin):
    admin, results = is_admin(), []
    cats = [c for c in categories() if c["id"] in ids and (admin or not c.get("admin"))]
    job.total = len(cats) + (1 if empty_bin else 0)
    for c in cats:
        if job.cancel:
            break
        job.msg = "Cleaning " + c["name"].lower()
        freed = deleted = skipped = 0
        for path, size in list(_cat_files(c, job)):
            if SANDBOX and not inside(path, SANDBOX):
                skipped += 1
                continue
            try:
                try:
                    os.remove(path)
                except PermissionError:
                    os.chmod(path, statmod.S_IWRITE)
                    os.remove(path)
                freed += size
                deleted += 1
            except OSError:
                skipped += 1
        if c.get("empty_dirs"):
            dir_cutoff = time.time() - float(c.get("age", 0)) * 3600
            for root in c["roots"]:
                if not os.path.isdir(root):
                    continue
                excl = [os.path.normcase(e) for e in c.get("exclude", [])]
                for d, _, _ in sorted(os.walk(root), key=lambda x: -len(x[0])):
                    nd = os.path.normcase(d)
                    if d == root or any(nd == e or nd.startswith(e + "\\") or e.startswith(nd + "\\") for e in excl):
                        continue
                    try:
                        if os.stat(d).st_mtime > dir_cutoff:
                            continue  # a running app may have just made it
                        os.rmdir(d)  # only succeeds when empty
                    except OSError:
                        pass
        log("CLEAN", c["name"], f"deleted {deleted}, skipped {skipped} in use", freed)
        results.append({"id": c["id"], "name": c["name"], "freed": freed, "deleted": deleted, "skipped": skipped})
        job.done += 1
    if empty_bin and not job.cancel and not SANDBOX:
        job.msg = "Emptying the Recycle Bin"
        before = recycle_bin() or {"bytes": 0, "count": 0}
        sh32.SHEmptyRecycleBinW(None, None, 0x1 | 0x2 | 0x4)  # no confirm UI (we asked), no progress, no sound
        after = recycle_bin() or {"bytes": 0, "count": 0}
        freed = max(0, before["bytes"] - after["bytes"])
        log("EMPTY-RECYCLE-BIN", "", f"{before['count']} items", freed)
        results.append({"id": "recycle", "name": "Recycle Bin", "freed": freed, "deleted": before["count"] - after["count"], "skipped": after["count"]})
        job.done += 1
    return {"results": results, "freed": sum(r["freed"] for r in results)}


# ------------------------------------------------------------- protection ---
GAME_DIRS = [os.path.join(os.environ.get("ProgramFiles(x86)", ""), "Steam"), os.path.join(os.environ.get("ProgramFiles", ""), "HoYoPlay"),
             r"C:\Riot Games", os.path.join(os.environ.get("ProgramFiles", ""), "Epic Games"), os.path.join(os.environ.get("ProgramFiles", ""), "EA Games")]


def protected(path):
    """Reason string when a path must not be moved or recycled, else None."""
    if not path:
        return "No path"
    p = os.path.abspath(path).rstrip("\\")
    if SANDBOX:
        return None if inside(p, SANDBOX) and os.path.normcase(p) != os.path.normcase(SANDBOX) else "Outside the test sandbox."
    if re.fullmatch(r"[A-Za-z]:", p):
        return "That is a whole drive."
    pf, pf86, pd = os.environ.get("ProgramFiles", ""), os.environ.get("ProgramFiles(x86)", ""), os.environ.get("ProgramData", "")
    exact = [W, pf, pf86, pd, r"C:\Users", HOME, os.path.join(HOME, "AppData"), r"C:\Recovery", r"C:\$Recycle.Bin",
             r"C:\System Volume Information", r"C:\Boot", QT, os.path.join(HOME, "OneDrive")]
    if any(s and os.path.normcase(p) == os.path.normcase(s.rstrip("\\")) for s in exact):
        return "This is a Windows, profile or app folder. Move the things inside it instead."
    for s in (W, r"C:\Recovery", r"C:\$Recycle.Bin", r"C:\System Volume Information"):
        if inside(p, s):
            return "This is inside a Windows system folder."
    if re.search(r"\\(\$Recycle\.Bin|System Volume Information)(\\|$)", p, re.I):
        return "System folder."
    for g in GAME_DIRS:
        if g and inside(p, g):
            return "This is a game install. Move or uninstall it from its launcher instead, or the launcher breaks."
    for s in (pf, pf86, pd):
        if s and inside(p, s):
            return "This is an installed program. Uninstall it from Settings > Apps instead."
    appdata = os.path.join(HOME, "AppData")
    if inside(p, appdata) and len(os.path.relpath(p, appdata).split("\\")) <= 2:
        return "This is an app settings folder. Use Clean up for caches instead."
    for lib in ("Desktop", "Documents", "Downloads", "Pictures", "Videos", "Music"):
        if os.path.normcase(p) == os.path.normcase(os.path.join(HOME, lib)):
            return "This is a Windows library folder. Move the things inside it instead."
    if inside(p, QT) and len(os.path.relpath(p, QT).split("\\")) == 1 and not os.path.relpath(p, QT).startswith("_backup"):
        return "This is one of your QT tools."
    return None


def _size_of(path):
    if os.path.isfile(path):
        return os.path.getsize(path)
    total = 0
    for d, _, files in os.walk(path):
        for f in files:
            try:
                total += os.lstat(os.path.join(d, f)).st_size
            except OSError:
                pass
    return total


# ---------------------------------------------------------- recycle / move ---
class SHFILEOPSTRUCTW(ctypes.Structure):
    _fields_ = [("hwnd", ctypes.c_void_p), ("wFunc", ctypes.c_uint), ("pFrom", ctypes.c_wchar_p),
                ("pTo", ctypes.c_wchar_p), ("fFlags", ctypes.c_ushort), ("fAnyOperationsAborted", ctypes.c_int),
                ("hNameMappings", ctypes.c_void_p), ("lpszProgressTitle", ctypes.c_wchar_p)]


def has_bin(path):
    root = os.path.splitdrive(os.path.abspath(path))[0] + "\\"
    return k32.GetDriveTypeW(root) == 3 and recycle_bin(root) is not None


def recycle(paths):
    """Recycle Bin only. Refuses protected paths and drives with no Recycle Bin. Returns per-path results."""
    out = []
    for p in paths:
        p = norm(p)
        why = protected(p)
        if not why and not os.path.lexists(p):
            why = "It isn't there any more."
        if not why and not has_bin(p):
            why = f"{p[:2]} has no Recycle Bin, so Windows would delete this for good. Move it instead."
        if why:
            out.append({"path": p, "ok": False, "msg": why})
            continue
        size = _size_of(p)
        # FOF_ALLOWUNDO keeps it recoverable; FOF_WANTNUKEWARNING makes Windows ask if it is too big for the bin
        op = SHFILEOPSTRUCTW(wFunc=3, pFrom=p + "\0\0", fFlags=0x40 | 0x10 | 0x4000 | 0x4)
        rc = sh32.SHFileOperationW(ctypes.byref(op))
        if rc or op.fAnyOperationsAborted or os.path.lexists(p):
            out.append({"path": p, "ok": False, "msg": "Windows couldn't recycle it. It may be open in another app." if not op.fAnyOperationsAborted else "Cancelled."})
            continue
        log("RECYCLE", p, "", size)
        out.append({"path": p, "ok": True, "bytes": size})
    return out


def unique(dest_dir, name):
    base, ext = os.path.splitext(name)
    cand, n = os.path.join(dest_dir, name), 2
    while os.path.lexists(cand):
        cand = os.path.join(dest_dir, f"{base} ({n}){ext}")
        n += 1
    return cand


def robomove(src, dst, exclude_files=()):
    """Moves a folder tree with robocopy (verified, resumable). Returns robocopy's exit code."""
    cmd = ["robocopy", src, dst, "/MOVE", "/E", "/COPY:DAT", "/DCOPY:T", "/R:1", "/W:1", "/NP", "/NFL", "/NDL", "/NJH", "/NJS"]
    if exclude_files:
        cmd += ["/XF", *exclude_files]
    return subprocess.run(cmd, capture_output=True, creationflags=NOWIN).returncode


def inbox_job(job, paths):
    inbox = CONFIG["inbox"]
    if not os.path.isdir(inbox):
        raise RuntimeError(f"The inbox ({inbox}) isn't there. Is D: plugged in?")
    dest_dir = os.path.join(inbox, "From-Space-Manager-" + time.strftime("%Y-%m-%d"))
    out = []
    job.total = len(paths)
    for p in paths:
        p = norm(p)
        job.msg = "Moving " + os.path.basename(p)
        why = protected(p) or (None if os.path.lexists(p) else "It isn't there any more.")
        if not why and inside(p, inbox):
            why = "It's already in the inbox."
        if why:
            out.append({"path": p, "ok": False, "msg": why})
            job.done += 1
            continue
        os.makedirs(dest_dir, exist_ok=True)
        dest = unique(dest_dir, os.path.basename(p))
        size = _size_of(p)
        if os.path.isdir(p):
            rc = robomove(p, dest)
            if rc >= 8 or os.path.exists(p):
                log("MOVE-PARTIAL", p, f"to {dest} (robocopy {rc})", size)
                out.append({"path": p, "ok": False, "dest": dest, "msg": f"Some files were in use. What moved is in {dest}; the rest is still where it was."})
                job.done += 1
                continue
        else:
            shutil.copy2(p, dest)
            if os.path.getsize(dest) != size:
                os.remove(dest)
                raise RuntimeError(f"Copy of {p} didn't verify, so the original was left alone.")
            os.remove(p)
        log("MOVE", p, f"to {dest}", size)
        out.append({"path": p, "ok": True, "dest": dest, "bytes": size})
        job.done += 1
    return {"results": out, "dest": dest_dir}


# --------------------------------------------------------------- big scan ---
KINDS = {
    "video": {"mp4", "mkv", "mov", "avi", "webm", "m4v", "wmv", "flv", "ts", "mts", "m2ts", "prores"},
    "image": {"jpg", "jpeg", "png", "gif", "webp", "bmp", "tif", "tiff", "heic", "raw", "cr2", "nef", "arw", "dng", "psd", "exr", "avif"},
    "audio": {"mp3", "wav", "flac", "m4a", "aac", "ogg", "opus", "aiff", "wma"},
    "archive": {"zip", "rar", "7z", "tar", "gz", "xz", "bz2", "zst", "cab"},
    "disk image": {"iso", "img", "vhd", "vhdx", "vmdk", "qcow2", "wim", "esd"},
    "installer": {"exe", "msi", "msix", "appx", "apk", "aab"},
    "3d / project": {"blend", "blend1", "fbx", "obj", "glb", "gltf", "uasset", "unitypackage", "aep", "prproj", "drp", "kra", "clip"},
    "game data": {"pak", "pck", "vpk", "bundle", "assets", "bsa", "ba2", "dat", "bin", "blk", "chk"},
    "code / text": {"py", "js", "ts", "json", "html", "css", "md", "txt", "csv", "log", "xml", "yml", "yaml", "java", "kt", "c", "cpp", "h", "cs", "rs", "go"},
    "documents": {"pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "epub"},
    "models / ai": {"safetensors", "ckpt", "gguf", "onnx", "pt", "pth", "bin_model", "h5", "tflite"},
}
EXT_KIND = {e: k for k, exts in KINDS.items() for e in exts}
SKIP_NAMES = {"$recycle.bin", "system volume information", "$windows.~bt", "$windows.~ws", "$winreagent"}
REBUILD = {  # folder name -> (label, how it comes back)
    "node_modules": ("npm packages", "npm install brings it back"),
    "__pycache__": ("Python bytecode", "Python rebuilds it on the next run"),
    ".gradle": ("Gradle cache", "the next Gradle build re-creates it"),
    ".parcel-cache": ("Parcel cache", "rebuilt on the next build"),
    ".turbo": ("Turbo cache", "rebuilt on the next build"),
    ".next": ("Next.js build", "npm run build makes it again"),
    ".venv": ("Python virtual env", "make it again with python -m venv and pip install"),
    "venv": ("Python virtual env", "make it again with python -m venv and pip install"),
}


def _app_owned(path):
    """node_modules/venvs that belong to installed apps or global tools (npm -g, app-bundled Pythons) are not
    'rebuildable' in any simple sense, so they are never suggested."""
    if SANDBOX:
        return False
    for root in (os.path.join(HOME, "AppData"), os.environ.get("ProgramFiles", ""), os.environ.get("ProgramFiles(x86)", ""),
                 os.environ.get("ProgramData", ""), W):
        if root and inside(path, root):
            return True
    return False


class Scan:
    """Result of one whole-tree scan. Folder sizes for every folder >= 1 MB, so drilling in is instant."""
    current = None

    def __init__(self, root):
        self.root, self.at = root, time.time()
        self.dirs = {}        # normcase path -> [size, files, mtime, [child paths], loose_bytes, display path]
        self.big = []         # (size, path, mtime)
        self.kinds = {}       # kind -> [bytes, files]
        self.rebuild = []     # (path, label, how)
        self.files = self.errors = 0
        self.total = 0


def scan_job(job, root):
    root = norm(root)
    if not os.path.isdir(root):
        raise RuntimeError("That folder isn't there.")
    big_min = int(CONFIG["big_file_mb"]) * 1024 * 1024
    s = Scan(root)
    letter = os.path.splitdrive(root)[0]
    free, total = ctypes.c_ulonglong(), ctypes.c_ulonglong()
    if k32.GetDiskFreeSpaceExW(letter + "\\", None, ctypes.byref(total), ctypes.byref(free)):
        used = total.value - free.value
        job.total = used if os.path.normcase(root.rstrip("\\")) == os.path.normcase(letter) else 0
    last = time.time()
    in_rebuild = 0

    def walk(path, depth):
        nonlocal last, in_rebuild
        if job.cancel:
            return 0, 0
        size = files = loose = 0
        children = []
        try:
            entries = list(os.scandir(path))
        except OSError:
            s.errors += 1
            entries = []
        for e in entries:
            try:
                if e.is_dir(follow_symlinks=False):
                    if e.is_junction() or e.is_symlink() or e.name.lower() in SKIP_NAMES:
                        continue
                    nm = e.name.lower()
                    mark = (nm in REBUILD and not in_rebuild and not _app_owned(e.path)
                            and (nm not in ("venv", ".venv") or os.path.exists(os.path.join(e.path, "pyvenv.cfg"))))
                    if mark:
                        in_rebuild += 1
                    cs, cf = walk(e.path, depth + 1)
                    if mark:
                        in_rebuild -= 1
                        if cs >= 1024 * 1024:
                            s.rebuild.append((e.path, *REBUILD[nm]))
                    size += cs
                    files += cf
                    if cs >= 1024 * 1024:
                        children.append(e.path)
                    continue
                st = e.stat(follow_symlinks=False)
            except OSError:
                s.errors += 1
                continue
            n = st.st_size
            size += n
            loose += n
            files += 1
            s.files += 1
            s.total += n
            ext = e.name.rsplit(".", 1)[-1].lower() if "." in e.name else ""
            k = s.kinds.setdefault(EXT_KIND.get(ext, "other"), [0, 0])
            k[0] += n
            k[1] += 1
            if n >= big_min and len(s.big) < 50000:
                s.big.append((n, e.path, int(st.st_mtime)))
        try:
            mt = int(os.stat(path).st_mtime)
        except OSError:
            mt = 0
        if size >= 1024 * 1024 or depth <= 1:
            s.dirs[os.path.normcase(path)] = [size, files, mt, children, loose, path]
        if time.time() - last > 0.25:
            last = time.time()
            job.done, job.msg = s.total, path
        return size, files

    job.msg = root
    walk(root, 0)
    s.big.sort(reverse=True)
    s.rebuild.sort(key=lambda r: -s.dirs.get(os.path.normcase(r[0]), [0])[0])
    job.done = s.total
    if job.cancel:
        return None
    Scan.current = s
    log("SCAN", root, f"{s.files} files, {s.errors} unreadable", s.total)
    return {"root": root, "files": s.files, "bytes": s.total, "errors": s.errors}


def _live_dir(path):
    """Fallback for folders too small to keep from the scan: size their children now."""
    folders, files = [], []
    for e in os.scandir(path):
        try:
            if e.is_dir(follow_symlinks=False):
                if not (e.is_junction() or e.is_symlink()):
                    folders.append({"name": e.name, "path": e.path, "bytes": _size_of(e.path), "mtime": int(e.stat().st_mtime), "protected": protected(e.path)})
            else:
                st = e.stat(follow_symlinks=False)
                files.append({"name": e.name, "path": e.path, "bytes": st.st_size, "mtime": int(st.st_mtime)})
        except OSError:
            pass
    return folders, files


def scan_view(path):
    s = Scan.current
    if not s:
        return None
    path = norm(path) or s.root
    if not inside(path, s.root):
        path = s.root
    node = s.dirs.get(os.path.normcase(path))
    if node:
        size, nfiles, mt, children, loose, disp = node
        folders = []
        for c in children:
            cn = s.dirs.get(os.path.normcase(c))
            if cn:
                folders.append({"name": os.path.basename(c), "path": c, "bytes": cn[0], "files": cn[1], "mtime": cn[2], "kids": bool(cn[3]), "protected": protected(c)})
        folders.sort(key=lambda x: -x["bytes"])
    else:
        folders, _ = _live_dir(path)
        size = sum(f["bytes"] for f in folders)
        loose = nfiles = 0
        folders.sort(key=lambda x: -x["bytes"])
    pre = os.path.normcase(path.rstrip("\\")) + "\\"
    big = [{"name": os.path.basename(p), "path": p, "bytes": n, "mtime": m, "protected": protected(p)} for n, p, m in s.big if os.path.normcase(p).startswith(pre)][:200]
    crumbs, cur = [], path
    while True:
        crumbs.insert(0, {"name": os.path.basename(cur.rstrip("\\")) or cur, "path": cur})
        if os.path.normcase(cur.rstrip("\\")) == os.path.normcase(s.root.rstrip("\\")):
            break
        nxt = os.path.dirname(cur.rstrip("\\"))
        if nxt == cur or not inside(nxt, s.root):
            break
        cur = nxt if not re.fullmatch(r"[A-Za-z]:", nxt) else nxt + "\\"
    return {"root": s.root, "path": path, "bytes": size, "files": nfiles, "loose": loose, "folders": folders[:300],
            "big": big, "crumbs": crumbs, "at": int(s.at), "protected": protected(path)}


def scan_extras():
    s = Scan.current
    if not s:
        return None
    year = time.time() - 365 * 86400
    old = [{"name": os.path.basename(p), "path": p, "bytes": n, "mtime": m, "protected": protected(p)} for n, p, m in s.big if m < year][:200]
    kinds = sorted(({"kind": k, "bytes": v[0], "files": v[1]} for k, v in s.kinds.items()), key=lambda x: -x["bytes"])
    rebuild = []
    for p, label, how in s.rebuild[:300]:
        node = s.dirs.get(os.path.normcase(p))
        if node and os.path.exists(p):
            rebuild.append({"path": p, "label": label, "how": how, "bytes": node[0], "files": node[1], "mtime": node[2],
                            "project": os.path.basename(os.path.dirname(p)), "protected": protected(p)})
    rebuild.sort(key=lambda x: -x["bytes"])
    return {"root": s.root, "bytes": s.total, "kinds": kinds, "old": old, "rebuild": rebuild,
            "old_bytes": sum(x["bytes"] for x in old), "rebuild_bytes": sum(x["bytes"] for x in rebuild)}


def forget(items):
    """Takes removed (path, bytes) out of the scan so the numbers stay honest without rescanning."""
    s = Scan.current
    if not s:
        return
    for p, gone in items:
        np_ = os.path.normcase(os.path.abspath(p))
        if not inside(p, s.root):
            continue
        s.big = [b for b in s.big if not (os.path.normcase(b[1]) == np_ or os.path.normcase(b[1]).startswith(np_ + "\\"))]
        for k in [k for k in s.dirs if k == np_ or k.startswith(np_ + "\\")]:
            del s.dirs[k]
        s.rebuild = [r for r in s.rebuild if not inside(r[0], p)]
        cur = os.path.dirname(np_)
        while gone:
            node = s.dirs.get(cur)
            if node:
                node[0] -= gone
                node[3] = [c for c in node[3] if os.path.normcase(c) != np_]
            nxt = os.path.dirname(cur)
            if nxt == cur:
                break
            cur = nxt
        s.total -= gone or 0


# -------------------------------------------------------------- duplicates ---
def _hash(path, full, job=None):
    h = hashlib.blake2b(digest_size=20)
    with open(path, "rb") as f:
        if not full:
            size = os.fstat(f.fileno()).st_size
            for off in (0, size // 2, max(0, size - 1048576)):
                f.seek(off)
                h.update(f.read(1048576))
            return h.hexdigest()
        while True:
            if job and job.cancel:
                return None
            b = f.read(8 * 1048576)
            if not b:
                return h.hexdigest()
            h.update(b)
            if job:
                job.done += len(b)


def dupes_job(job):
    s = Scan.current
    if not s:
        raise RuntimeError("Scan a folder first.")
    by_size = {}
    for n, p, m in s.big:
        by_size.setdefault(n, []).append((p, m))
    cands = {n: v for n, v in by_size.items() if len(v) > 1}
    job.msg = "Comparing samples"
    groups = []
    for n, items in cands.items():
        part = {}
        for p, m in items:
            try:
                part.setdefault(_hash(p, False), []).append((p, m))
            except OSError:
                pass
        groups += [(n, g) for g in part.values() if len(g) > 1]
    job.total = sum(n * len(g) for n, g in groups)
    job.msg = "Checking every byte"
    out = []
    for n, g in groups:
        full = {}
        for p, m in g:
            if job.cancel:
                return None
            try:
                hx = _hash(p, True, job)
            except OSError:
                continue
            full.setdefault(hx, []).append({"name": os.path.basename(p), "path": p, "mtime": m})
        for v in full.values():
            if len(v) > 1:
                v.sort(key=lambda x: x["mtime"])
                out.append({"bytes": n, "copies": v, "waste": n * (len(v) - 1)})
    out.sort(key=lambda x: -x["waste"])
    return {"groups": out, "waste": sum(x["waste"] for x in out)}


# -------------------------------------------------------------------- reels ---
def _heavy_dirs(reel):
    try:
        return [e.path for e in os.scandir(reel) if e.is_dir() and (e.name == "plates" or e.name.startswith("render"))]
    except OSError:
        return []


def _files_under(d):
    for root, _, files in os.walk(d):
        for f in files:
            yield os.path.join(root, f)


def _find_named(root, name):
    for d, sub, files in os.walk(root):
        sub[:] = [s for s in sub if s != "node_modules"]
        if name in files:
            return True
    return False


def reel_final(reel):
    """post_meta.json "mp4" if present, otherwise the newest daily-co-*.mp4 in a render folder."""
    try:
        with open(os.path.join(reel, "post_meta.json"), encoding="utf-8") as f:
            n = str(json.load(f).get("mp4") or "")
            if n:
                return n
    except (OSError, ValueError, AttributeError):
        pass
    cand = [p for d in _heavy_dirs(reel) for p in _files_under(d) if re.fullmatch(r"daily-co-.*\.mp4", os.path.basename(p), re.I)]
    return os.path.basename(max(cand, key=os.path.getmtime)) if cand else None


def reels_job(job):
    root = CONFIG["reels_root"]
    if not os.path.isdir(root):
        return {"root": root, "rows": [], "missing": True}
    cutoff = time.time() - float(CONFIG["reel_min_age_hrs"]) * 3600
    dirs = sorted((e for e in os.scandir(root) if e.is_dir() and not e.name.startswith("_")), key=lambda e: e.name)
    job.total = len(dirs)
    rows = []
    for e in dirs:
        if job.cancel:
            break
        job.msg = e.name
        final = reel_final(e.path)
        files = [p for d in _heavy_dirs(e.path) for p in _files_under(d)]
        sizes = {}
        for p in files:
            try:
                sizes[p] = os.stat(p)
            except OSError:
                pass
        heavy = sum(st.st_size for p, st in sizes.items() if os.path.basename(p) != final)
        top = []
        try:
            top = [os.stat(x.path) for x in os.scandir(e.path) if x.is_file()]
        except OSError:
            pass
        newest = max([st.st_mtime for st in list(sizes.values()) + top] or [e.stat().st_mtime])
        found = bool(final) and (any(os.path.basename(p) == final for p in files) or _find_named(e.path, final))
        nm = os.path.join(e.path, "node_modules")
        nm_bytes = _size_of(nm) if os.path.isdir(nm) else 0
        row = {"post": e.name, "bytes": heavy, "final": final if found else (final + " (missing)" if final else ""), "mtime": int(newest),
               "node_modules": nm_bytes, "can_move": False, "selected": False}
        if heavy < 200 * 1024 * 1024:
            row["status"] = "Frames already on D:" if os.path.exists(os.path.join(e.path, "_frames-on-D.txt")) else "Small, nothing to move"
            row["tone"] = "ok"
        elif not found:
            row["status"], row["tone"] = "Draft (no final mp4), keep on SSD", "warn"
        else:
            row["can_move"] = True
            if newest > cutoff:
                row["status"], row["tone"] = "Finished today, still editing?", "warn"
            else:
                row["status"], row["tone"], row["selected"] = "Finished, ready to move", "go", True
        rows.append(row)
        job.done += 1
    rows.sort(key=lambda r: (not r["can_move"], r["post"]))  # the ones you can act on come first
    return {"root": root, "archive": CONFIG["reels_archive"], "rows": rows}


def reel_move_job(job, posts):
    root, archive = CONFIG["reels_root"], CONFIG["reels_archive"]
    drive = os.path.splitdrive(archive)[0] + "\\"
    if not os.path.isdir(drive):
        raise RuntimeError(f"{drive} isn't connected.")
    out = []
    job.total = len(posts)
    for post in posts:
        if job.cancel:
            break
        src = os.path.join(root, os.path.basename(post))
        job.msg = "Moving frames of " + post
        final = reel_final(src)
        if not os.path.isdir(src) or not final:
            out.append({"post": post, "ok": False, "msg": "No final mp4, so it's treated as a draft and left alone."})
            job.done += 1
            continue
        moved = nfiles = 0
        problems = []
        for d in _heavy_dirs(src):
            to = os.path.join(archive, post, os.path.basename(d))
            files = [p for p in _files_under(d) if os.path.basename(p) != final]
            size = sum(os.path.getsize(p) for p in files if os.path.exists(p))
            rc = robomove(d, to, [final])
            left = [p for p in _files_under(d) if os.path.basename(p) != final] if os.path.isdir(d) else []
            if rc >= 8 or left:
                problems.append(f"{os.path.basename(d)}: {len(left)} files could not be moved")
            moved += size
            nfiles += len(files)
            log("MOVE-REEL-FRAMES", d, f"to {to}, robocopy {rc}, left {len(left)}", size)
        with open(os.path.join(src, "_frames-on-D.txt"), "w", encoding="utf-8") as f:
            f.write(f"Frames and intermediate renders for this reel were moved to the HDD on {time.strftime('%Y-%m-%d')} to free SSD space:\n"
                    f"  {os.path.join(archive, post)}\nThe final mp4 ({final}) and the project files stay here. Copy the folders back if you need to re-render.\n")
        out.append({"post": post, "ok": not problems, "bytes": moved, "files": nfiles, "msg": "; ".join(problems)})
        job.done += 1
    return {"results": out, "freed": sum(r.get("bytes", 0) for r in out)}


# --------------------------------------------------------------- dashboard ---
def quick_wins():
    """Cheap estimate for the overview: last measured cleanup + last reel scan + last big scan extras."""
    w = {}
    for j in sorted(Job.ALL.values(), key=lambda j: j.started):
        if j.state != "done" or not j.result:
            continue
        if j.kind == "measure":
            w["clean"] = sum(r["bytes"] or 0 for r in j.result["rows"] if r["id"] != "recycle" and r["default"] and r["status"] == "ready")
            w["bin"] = next((r["bytes"] for r in j.result["rows"] if r["id"] == "recycle"), 0)
        elif j.kind == "reels":
            w["reels"] = sum(r["bytes"] for r in j.result["rows"] if r["can_move"])
    x = scan_extras()
    if x:
        w["rebuild"] = x["rebuild_bytes"]
        w["old"] = x["old_bytes"]
        w["scan_root"] = x["root"]
    return w
