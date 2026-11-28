"""PC care: auto-cleaner, scheduled backup, focus mode, startup speed report, folder time machine."""
import ctypes
import datetime as dt
import fnmatch
import hashlib
import json
import os
import re
import shutil
import threading
import time
import winreg
import zipfile

import kit
from kit import actions, common

_jobs_lock = threading.Lock()
BUSY = {}          # job id -> text


def init():
    threading.Thread(target=_scheduler, name="kit-care", daemon=True).start()
    threading.Thread(target=_focus_loop, name="kit-focus", daemon=True).start()
    common.save("hubstart", {"t": time.time()})


def _scheduler():
    time.sleep(20)
    while True:
        try:
            _tick()
        except Exception as e:
            common.event("care.error", str(e))
        time.sleep(60)


def _tick():
    now = time.time()
    for job in common.load("backups", {"jobs": []})["jobs"]:
        if job.get("on", True) and _due(job, now) and job["id"] not in BUSY:
            threading.Thread(target=run_backup, args=(job["id"],), daemon=True).start()
    tm = common.load("timemachine", {"folders": [], "every": 60})
    for f in tm["folders"]:
        if f.get("on", True) and now - f.get("last", 0) >= tm.get("every", 60) * 60 and ("tm:" + f["path"]) not in BUSY:
            threading.Thread(target=snapshot, args=(f["path"],), daemon=True).start()
    cl = common.load("cleaner", {"auto": False, "every_days": 7, "last": 0, "targets": ["temp", "crash", "qtlogs"]})
    if cl.get("auto") and now - cl.get("last", 0) >= cl.get("every_days", 7) * 86400 and "cleaner" not in BUSY:
        threading.Thread(target=clean, args=(cl["targets"], True), daemon=True).start()


def _due(job, now):
    last = job.get("last", 0)
    every = job.get("every", "daily")
    if every == "hourly":
        return now - last >= 3600
    hh, mm = (job.get("at") or "21:00").split(":")[:2]
    today = dt.datetime.now().replace(hour=int(hh), minute=int(mm), second=0, microsecond=0)
    gap = 7 * 86400 if every == "weekly" else 86400
    target = today.timestamp()
    if now < target:
        target -= 86400
    return last < target and now - last >= gap - 3600


# ================================================================ 14. auto-cleaner ===
TEMP = os.environ.get("TEMP", "")
LAD = os.environ.get("LOCALAPPDATA", "")
TARGETS = {
    "temp": ("Temp files older than 2 days", [TEMP], 2, False),
    "wintemp": ("Windows temp", [r"C:\Windows\Temp"], 2, False),
    "crash": ("Crash dumps", [os.path.join(LAD, "CrashDumps")], 0, False),
    "edge": ("Edge cache", [os.path.join(LAD, r"Microsoft\Edge\User Data\Default\Cache\Cache_Data")], 0, False),
    "chrome": ("Chrome cache", [os.path.join(LAD, r"Google\Chrome\User Data\Default\Cache\Cache_Data")], 0, False),
    "thumbs": ("Old thumbnails", [os.path.join(LAD, r"Microsoft\Windows\Explorer")], 0, False),
    "qtlogs": ("QT tool logs older than 14 days", [os.path.join(LAD, "QT Suite"), os.path.join(LAD, "Beam"), os.path.join(LAD, "volt")], 14, False),
    "downloads": ("Downloads older than 60 days (to Recycle Bin)", [os.path.join(common.HOME, "Downloads")], 60, True),
}


def _walk_target(key):
    label, roots, days, recycle = TARGETS[key]
    cutoff = time.time() - days * 86400
    for root in roots:
        if not os.path.isdir(root):
            continue
        if key == "downloads":   # top level only, whole items
            for name in os.listdir(root):
                p = os.path.join(root, name)
                try:
                    st = os.stat(p)
                except OSError:
                    continue
                if st.st_mtime < cutoff and not name.lower().startswith("desktop.ini"):
                    yield p, _size(p)
            continue
        for d, dirs, files in os.walk(root):
            if key == "qtlogs":
                files = [f for f in files if f.lower().endswith((".log", ".log.1", ".log.2", ".txt")) and "log" in f.lower()]
            if key == "thumbs":
                files = [f for f in files if fnmatch.fnmatch(f.lower(), "thumbcache_*.db") or fnmatch.fnmatch(f.lower(), "iconcache_*.db")]
            for f in files:
                p = os.path.join(d, f)
                try:
                    st = os.stat(p)
                except OSError:
                    continue
                if st.st_mtime < cutoff:
                    yield p, st.st_size


def _size(p):
    if os.path.isfile(p):
        return os.path.getsize(p)
    t = 0
    for d, _, fs in os.walk(p):
        for f in fs:
            try:
                t += os.path.getsize(os.path.join(d, f))
            except OSError:
                pass
    return t


def recycle(paths):
    """Send files to the Recycle Bin (undo-able) with SHFileOperationW."""
    class SHFILEOPSTRUCTW(ctypes.Structure):
        _fields_ = [("hwnd", ctypes.c_void_p), ("wFunc", ctypes.c_uint), ("pFrom", ctypes.c_wchar_p), ("pTo", ctypes.c_wchar_p),
                    ("fFlags", ctypes.c_ushort), ("fAnyOperationsAborted", ctypes.c_int), ("hNameMappings", ctypes.c_void_p),
                    ("lpszProgressTitle", ctypes.c_wchar_p)]
    if not paths:
        return 0
    op = SHFILEOPSTRUCTW(None, 3, "\0".join(paths) + "\0\0", None, 0x0040 | 0x0010 | 0x0400 | 0x0004, 0, None, None)
    return ctypes.windll.shell32.SHFileOperationW(ctypes.byref(op))


def recycle_bin():
    class QI(ctypes.Structure):
        _fields_ = [("cbSize", ctypes.c_uint32), ("i64Size", ctypes.c_int64), ("i64NumItems", ctypes.c_int64)]
    q = QI(ctypes.sizeof(QI), 0, 0)
    ctypes.windll.shell32.SHQueryRecycleBinW(None, ctypes.byref(q))
    return q.i64Size, q.i64NumItems


@kit.hub_get("/api/kit/cleaner")
def _cl_get(q):
    cfg = common.load("cleaner", {"auto": False, "every_days": 7, "last": 0, "targets": ["temp", "crash", "qtlogs"]})
    out = []
    if (q.get("scan") or ["0"])[0] == "1":
        for k in TARGETS:
            n = size = 0
            for _, s in _walk_target(k):
                n += 1
                size += s
            out.append({"id": k, "label": TARGETS[k][0], "files": n, "size": size, "human": common.human(size), "recycle": TARGETS[k][3]})
    else:
        out = [{"id": k, "label": v[0], "recycle": v[3]} for k, v in TARGETS.items()]
    rb, rn = recycle_bin()
    return 200, dict(cfg, targets_info=out, busy=BUSY.get("cleaner", ""), recycle_bin={"size": rb, "human": common.human(rb), "items": rn},
                     history=common.load("cleanlog", {"runs": []})["runs"][-8:])


def clean(keys, auto=False):
    BUSY["cleaner"] = "cleaning"
    freed = n = 0
    try:
        for k in keys:
            if k not in TARGETS:
                continue
            items = list(_walk_target(k))
            if TARGETS[k][3]:
                if recycle([p for p, _ in items]) == 0:
                    freed += sum(s for _, s in items)
                    n += len(items)
                continue
            for p, s in items:
                try:
                    os.remove(p)
                    freed += s
                    n += 1
                except OSError:
                    pass
            if k in ("temp", "wintemp"):   # empty folders left behind
                for root in TARGETS[k][1]:
                    for d, dirs, files in os.walk(root, topdown=False):
                        if d != root and not dirs and not files:
                            try:
                                os.rmdir(d)
                            except OSError:
                                pass
        log = common.load("cleanlog", {"runs": []})
        log["runs"].append({"t": time.time(), "freed": freed, "files": n, "auto": auto, "keys": keys})
        log["runs"] = log["runs"][-50:]
        common.save("cleanlog", log)
        cfg = common.load("cleaner", {"auto": False, "every_days": 7, "last": 0, "targets": ["temp", "crash", "qtlogs"]})
        cfg["last"] = time.time()
        common.save("cleaner", cfg)
        common.event("clean.done", common.human(freed))
        if auto and freed > 50 << 20:
            actions.balloon("Auto-cleaner", f"Freed {common.human(freed)} ({n} files)")
        return freed, n
    finally:
        BUSY.pop("cleaner", None)


@kit.hub_post("/api/kit/cleaner")
def _cl_post(b):
    op = b.get("op")
    cfg = common.load("cleaner", {"auto": False, "every_days": 7, "last": 0, "targets": ["temp", "crash", "qtlogs"]})
    if op == "clean":
        keys = [k for k in (b.get("targets") or cfg["targets"]) if k in TARGETS]
        freed, n = clean(keys)
        return 200, {"ok": True, "freed": freed, "human": common.human(freed), "files": n}
    if op == "settings":
        cfg["auto"] = bool(b.get("auto", cfg["auto"]))
        cfg["every_days"] = max(1, min(int(b.get("every_days") or cfg["every_days"]), 60))
        if isinstance(b.get("targets"), list):
            cfg["targets"] = [k for k in b["targets"] if k in TARGETS]
        common.save("cleaner", cfg)
        return 200, {"ok": True}
    if op == "emptybin":
        r = ctypes.windll.shell32.SHEmptyRecycleBinW(None, None, 0x1 | 0x2 | 0x4)
        common.event("clean.bin")
        return 200, {"ok": r in (0, -2147418113)}
    return 400, {"ok": False}


# ============================================================ 15. scheduled backup ===
def _job(jid):
    return next((j for j in common.load("backups", {"jobs": []})["jobs"] if j["id"] == jid), None)


def _save_job(job):
    s = common.load("backups", {"jobs": []})
    s["jobs"] = [job if j["id"] == job["id"] else j for j in s["jobs"]]
    common.save("backups", s)


SKIP_DIRS = {"node_modules", "__pycache__", ".git", ".venv", "venv", "$RECYCLE.BIN", "System Volume Information"}


def _files(src):
    if os.path.isfile(src):
        yield src, os.path.basename(src)
        return
    base = os.path.dirname(src.rstrip("\\/"))
    for d, dirs, files in os.walk(src):
        dirs[:] = [x for x in dirs if x not in SKIP_DIRS and not x.startswith("_backup-")]
        for f in files:
            p = os.path.join(d, f)
            yield p, os.path.relpath(p, base)


def run_backup(jid):
    job = _job(jid)
    if not job:
        return False, "no such job"
    BUSY[jid] = "starting"
    t0 = time.time()
    n = size = 0
    try:
        os.makedirs(job["dest"], exist_ok=True)
        stamp = time.strftime("%Y%m%d-%H%M")
        safe = re.sub(r"[^\w-]+", "-", job["name"]).strip("-") or "backup"
        if job.get("mode", "zip") == "zip":
            out = os.path.join(job["dest"], f"{safe}-{stamp}.zip")
            with zipfile.ZipFile(out + ".part", "w", zipfile.ZIP_DEFLATED, compresslevel=5) as z:
                for src in job["src"]:
                    for p, arc in _files(src):
                        try:
                            z.write(p, arc)
                            n += 1
                            size += os.path.getsize(p)
                        except (OSError, ValueError):
                            pass
                        if n % 200 == 0:
                            BUSY[jid] = f"{n} files"
            os.replace(out + ".part", out)
            olds = sorted(f for f in os.listdir(job["dest"]) if f.startswith(safe + "-") and f.endswith(".zip"))
            for f in olds[:-max(1, int(job.get("keep", 7)))]:
                try:
                    os.remove(os.path.join(job["dest"], f))
                except OSError:
                    pass
            result = out
        else:   # copy: new and changed files only, nothing in the backup is ever deleted
            root = os.path.join(job["dest"], safe)
            for src in job["src"]:
                for p, arc in _files(src):
                    q = os.path.join(root, arc)
                    try:
                        st = os.stat(p)
                        if os.path.exists(q):
                            sq = os.stat(q)
                            if sq.st_size == st.st_size and int(sq.st_mtime) >= int(st.st_mtime):
                                continue
                        os.makedirs(os.path.dirname(q), exist_ok=True)
                        shutil.copy2(p, q)
                        n += 1
                        size += st.st_size
                    except OSError:
                        pass
                    if n and n % 200 == 0:
                        BUSY[jid] = f"{n} files"
            result = root
        job = _job(jid) or job
        job.update(last=time.time(), last_ok=True, last_msg=f"{n} files, {common.human(size)} in {int(time.time() - t0)} s", last_out=result)
        _save_job(job)
        common.event("backup.ok", job["name"])
        return True, job["last_msg"]
    except Exception as e:
        job = _job(jid) or job
        job.update(last=time.time(), last_ok=False, last_msg=str(e)[:200])
        _save_job(job)
        actions.balloon("Backup failed", f"{job['name']}: {e}", warn=True)
        return False, str(e)
    finally:
        BUSY.pop(jid, None)


def _default_dest():
    for d in ("D:\\", "E:\\"):
        if os.path.isdir(d):
            return os.path.join(d, "QT Backups")
    return os.path.join(common.HOME, "QT Backups")


@kit.hub_get("/api/kit/backups")
def _bk_get(q):
    jobs = common.load("backups", {"jobs": []})["jobs"]
    for j in jobs:
        j["busy"] = BUSY.get(j["id"], "")
    return 200, {"jobs": jobs, "default_dest": _default_dest()}


@kit.hub_post("/api/kit/backups")
def _bk_post(b):
    s = common.load("backups", {"jobs": []})
    op = b.get("op")
    if op == "save":
        src = [p for p in (b.get("src") or []) if isinstance(p, str) and os.path.exists(p)]
        if not src:
            return 400, {"ok": False, "msg": "add at least one folder that exists"}
        dest = str(b.get("dest") or _default_dest())
        for p in src:
            if os.path.abspath(dest).lower().startswith(os.path.abspath(p).lower()):
                return 400, {"ok": False, "msg": "the backup can't go inside the folder it backs up"}
        job = {"id": b.get("id") or os.urandom(4).hex(), "name": str(b.get("name") or "Backup")[:40], "src": src, "dest": dest,
               "mode": "copy" if b.get("mode") == "copy" else "zip", "every": b.get("every") if b.get("every") in ("hourly", "daily", "weekly") else "daily",
               "at": b.get("at") if re.fullmatch(r"\d{1,2}:\d{2}", str(b.get("at", ""))) else "21:00", "keep": max(1, min(int(b.get("keep") or 7), 99)),
               "on": bool(b.get("on", True))}
        old = next((j for j in s["jobs"] if j["id"] == job["id"]), None)
        if old:
            job.update({k: old[k] for k in ("last", "last_ok", "last_msg", "last_out") if k in old})
        s["jobs"] = [j for j in s["jobs"] if j["id"] != job["id"]] + [job]
        common.save("backups", s)
        return _bk_get({})
    if op == "del":
        s["jobs"] = [j for j in s["jobs"] if j["id"] != b.get("id")]
        common.save("backups", s)
        return _bk_get({})
    if op == "run":
        if b.get("id") in BUSY:
            return 409, {"ok": False, "msg": "already running"}
        threading.Thread(target=run_backup, args=(b.get("id"),), daemon=True).start()
        return 200, {"ok": True}
    if op == "open":
        j = _job(b.get("id"))
        if j and os.path.isdir(j["dest"]):
            os.startfile(j["dest"])
        return 200, {"ok": True}
    return 400, {"ok": False}


# =================================================================== 16. focus mode ===
FOCUS_DEFAULT = {"on": False, "until": 0, "started": 0, "apps": ["Discord.exe", "steam.exe", "EpicGamesLauncher.exe"], "quiet": True, "minutes": 25,
                 "sites_note": ""}


def focus_state():
    f = common.load("focus", FOCUS_DEFAULT)
    if f["on"] and f["until"] and time.time() > f["until"]:
        focus_stop(done=True)
        f = common.load("focus", FOCUS_DEFAULT)
    return f


def focus_start(minutes=None):
    f = common.load("focus", FOCUS_DEFAULT)
    m = int(minutes or f.get("minutes") or 25)
    f.update(on=True, started=time.time(), until=time.time() + m * 60 if m > 0 else 0, minutes=m, closed=[])
    common.save("focus", f)
    if f.get("quiet"):
        _ping_snooze(m if m > 0 else 240)
    common.event("focus.start", f"{m} min")
    return f


def focus_stop(done=False):
    f = common.load("focus", FOCUS_DEFAULT)
    if not f["on"]:
        return f
    mins = int((time.time() - f["started"]) / 60)
    f.update(on=False, until=0)
    common.save("focus", f)
    if f.get("quiet"):
        _ping_snooze(0)
    common.event("focus.done" if done or mins >= 20 else "focus.stop", f"{mins} min", xp=mins * 2 if done or mins >= 20 else 0)
    if done:
        actions.balloon("Focus done", f"{mins} minutes. Nice work. Take a short break.")
    return f


def _ping_snooze(minutes):
    import urllib.request
    try:
        req = urllib.request.Request("http://127.0.0.1:7788/api/notify/settings", data=json.dumps({"snooze": minutes}).encode(),
                                     headers={"Content-Type": "application/json", "Origin": "http://127.0.0.1:7788"}, method="POST")
        urllib.request.urlopen(req, timeout=3).read()
    except Exception:
        pass


def _focus_loop():
    while True:
        time.sleep(3)
        try:
            f = focus_state()
            if not f["on"] or not f.get("apps"):
                continue
            want = {a.lower() for a in f["apps"]}
            code, out = common.run(["tasklist", "/fo", "csv", "/nh"], timeout=10)
            hits = set()
            for line in out.splitlines():
                parts = line.strip('"').split('","')
                if parts and parts[0].lower() in want:
                    hits.add(parts[0])
            for exe in hits:
                common.run(["taskkill", "/im", exe], timeout=10)       # polite close first
                time.sleep(1.5)
                common.run(["taskkill", "/f", "/im", exe], timeout=10)
                f = common.load("focus", FOCUS_DEFAULT)
                f["closed"] = sorted(set(f.get("closed", []) + [exe]))
                common.save("focus", f)
                actions.balloon("Focus mode", f"Closed {exe}. It can wait.")
        except Exception:
            pass


@kit.hub_get("/api/kit/focus")
def _fo_get(q):
    f = focus_state()
    today0 = dt.datetime.combine(dt.date.today(), dt.time()).timestamp()
    done = [e for e in common.events(today0 - 6 * 86400) if e["k"] == "focus.done"]
    return 200, dict(f, left=max(0, int(f["until"] - time.time())) if f["on"] and f["until"] else None,
                     today=sum(int(e["d"].split()[0]) for e in done if e["t"] >= today0 and e["d"].split()[0].isdigit()),
                     week=sum(int(e["d"].split()[0]) for e in done if e["d"].split()[0].isdigit()))


@kit.hub_post("/api/kit/focus")
def _fo_post(b):
    op = b.get("op")
    if op == "start":
        focus_start(b.get("minutes"))
    elif op == "stop":
        focus_stop()
    elif op == "settings":
        f = common.load("focus", FOCUS_DEFAULT)
        if isinstance(b.get("apps"), list):
            f["apps"] = [re.sub(r"[^\w .()-]", "", str(a))[:60] for a in b["apps"] if str(a).strip()][:30]
        if "quiet" in b:
            f["quiet"] = bool(b["quiet"])
        if b.get("minutes"):
            f["minutes"] = max(0, min(int(b["minutes"]), 600))
        common.save("focus", f)
    return _fo_get({})


def _focus_toggle(_=None):
    if focus_state()["on"]:
        focus_stop()
        return True, "focus off"
    focus_start()
    return True, "focus on"


actions.register("focus.toggle", "Focus mode on / off", _focus_toggle)
actions.register("clean.now", "Run the auto-cleaner now", lambda _=None: (True, "freed " + common.human(clean(common.load("cleaner", {"targets": ["temp"]})["targets"])[0])))


# ======================================================== 17. startup speed report ===
RUN_KEYS = [(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Run", "HKCU"),
            (winreg.HKEY_LOCAL_MACHINE, r"Software\Microsoft\Windows\CurrentVersion\Run", "HKLM"),
            (winreg.HKEY_LOCAL_MACHINE, r"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run", "HKLM32")]
APPROVED = r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved"


def _approved(hive, sub, name):
    try:
        with winreg.OpenKey(hive, APPROVED + "\\" + sub) as k:
            v, _ = winreg.QueryValueEx(k, name)
            return not (v and v[0] & 1)
    except OSError:
        return True


def startup_items():
    out = []
    for hive, path, tag in RUN_KEYS:
        try:
            with winreg.OpenKey(hive, path) as k:
                i = 0
                while True:
                    try:
                        name, val, _ = winreg.EnumValue(k, i)
                    except OSError:
                        break
                    i += 1
                    sub = "Run32" if tag == "HKLM32" else "Run"
                    out.append({"name": name, "cmd": str(val), "where": tag, "on": _approved(hive, sub, name),
                                "can": tag == "HKCU", "kind": "run"})
        except OSError:
            pass
    for tag, folder in (("Startup", os.path.join(os.environ.get("APPDATA", ""), r"Microsoft\Windows\Start Menu\Programs\Startup")),
                        ("All users", os.path.join(os.environ.get("PROGRAMDATA", ""), r"Microsoft\Windows\Start Menu\Programs\StartUp"))):
        if os.path.isdir(folder):
            for f in os.listdir(folder):
                if f.lower() == "desktop.ini":
                    continue
                out.append({"name": f, "cmd": os.path.join(folder, f), "where": tag,
                            "on": _approved(winreg.HKEY_CURRENT_USER, "StartupFolder", f), "can": tag == "Startup", "kind": "folder"})
    for it in out:
        m = re.match(r'\s*"([^"]+)"|\s*(\S+\.exe)', it["cmd"], re.I)
        exe = (m.group(1) or m.group(2)) if m else it["cmd"]
        it["exe"] = os.path.basename(exe)
        try:
            it["mb"] = round(os.path.getsize(exe) / 1048576, 1)
        except OSError:
            it["mb"] = None
    return out


def set_startup(name, kind, on):
    sub = "StartupFolder" if kind == "folder" else "Run"
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, APPROVED + "\\" + sub) as k:
        val = bytes([2 if on else 3] + [0] * 11)
        winreg.SetValueEx(k, name, 0, winreg.REG_BINARY, val)


_boot_cache = {}


@kit.hub_get("/api/kit/startup")
def _su_get(q):
    if not _boot_cache or (q.get("fresh") or ["0"])[0] == "1":
        script = r"""
$o=@{}
$os=Get-CimInstance Win32_OperatingSystem; $o.boot=$os.LastBootUpTime.ToString('o')
try{$e=Get-WinEvent -FilterHashtable @{LogName='System';ProviderName='Microsoft-Windows-Kernel-Boot';Id=30} -MaxEvents 1 -EA Stop; $x=[xml]$e.ToXml(); $o.fw=[int]($x.Event.EventData.Data|?{$_.Name -eq 'LoadOSImageStart'}).'#text'}catch{}
try{$o.logon=(Get-WinEvent -FilterHashtable @{LogName='System';ProviderName='Microsoft-Windows-Winlogon';Id=7001} -MaxEvents 1 -EA Stop).TimeCreated.ToString('o')}catch{}
try{$o.explorer=(Get-Process explorer -EA Stop|Sort StartTime|Select -First 1).StartTime.ToString('o')}catch{}
$o.history=@(Get-WinEvent -FilterHashtable @{LogName='System';ProviderName='Microsoft-Windows-Kernel-General';Id=12} -MaxEvents 10 -EA SilentlyContinue|%{$_.TimeCreated.ToString('o')})
$o.logons=@(Get-WinEvent -FilterHashtable @{LogName='System';ProviderName='Microsoft-Windows-Winlogon';Id=7001} -MaxEvents 12 -EA SilentlyContinue|%{$_.TimeCreated.ToString('o')})
$o|ConvertTo-Json -Compress
"""
        code, out = common.ps(script, timeout=60)
        try:
            _boot_cache.update(json.loads(out.strip().splitlines()[-1]))
        except (ValueError, IndexError):
            _boot_cache.update(err=out[-300:])
    b = dict(_boot_cache)

    def ts(s):
        try:
            return dt.datetime.fromisoformat(s).timestamp()
        except (TypeError, ValueError):
            return None
    boot = ts(b.get("boot"))
    logon = ts(b.get("logon"))
    expl = ts(b.get("explorer"))
    hub = common.load("hubstart", {}).get("t")
    phases = []
    if b.get("fw"):
        phases.append({"name": "Firmware (BIOS) before Windows", "s": round(b["fw"] / 1000, 1)})
    if boot and logon and logon > boot:
        phases.append({"name": "Windows start to sign-in", "s": round(logon - boot, 1), "note": "includes the time you take to type your PIN"})
    if logon and expl and expl >= logon - 5:
        phases.append({"name": "Sign-in to desktop", "s": round(max(0, expl - logon), 1)})
    if hub and boot and hub > boot and hub - (expl or logon or boot) < 600:
        phases.append({"name": "Desktop to QT Suite ready", "s": round(hub - (expl or logon or boot), 1)})
    history = []
    starts = sorted(ts(x) for x in b.get("history", []) if ts(x))
    logons = sorted(ts(x) for x in b.get("logons", []) if ts(x))
    for s0 in starts:
        nxt = next((l for l in logons if l > s0), None)
        if nxt and nxt - s0 < 1800:
            history.append({"t": s0, "s": round(nxt - s0, 1)})
    items = startup_items()
    on = [i for i in items if i["on"]]
    tips = []
    if len(on) > 8:
        tips.append(f"{len(on)} apps start with Windows. Turning off the ones you don't need speeds up sign-in.")
    heavy = [i for i in on if (i.get("mb") or 0) > 80]
    if heavy:
        tips.append("Big programs at startup: " + ", ".join(i["name"] for i in heavy[:4]) + ".")
    if b.get("fw", 0) > 15000:
        tips.append("Your firmware takes %d s before Windows even starts. Turning on Fast Boot in the BIOS usually helps." % (b["fw"] // 1000))
    return 200, {"phases": phases, "total": round(sum(p["s"] for p in phases), 1), "boot": boot, "items": items, "history": history[-10:],
                 "tips": tips, "err": b.get("err")}


@kit.hub_post("/api/kit/startup")
def _su_post(b):
    it = next((i for i in startup_items() if i["name"] == b.get("name") and i["kind"] == b.get("kind")), None)
    if not it or not it["can"]:
        return 403, {"ok": False, "msg": "Only your own startup apps can be switched here. Use Task Manager > Startup for the rest."}
    set_startup(it["name"], it["kind"], bool(b.get("on")))
    common.event("startup.toggle", it["name"])
    return _su_get({})


# ======================================================== 30. folder time machine ===
def tm_store():
    tm = common.load("timemachine", {"folders": [], "every": 60, "store": ""})
    if not tm.get("store"):
        tm["store"] = os.path.join("D:\\" if os.path.isdir("D:\\") else common.DATA, "QT Time Machine")
        common.save("timemachine", tm)
    return tm


def _fid(path):
    return hashlib.sha1(os.path.normcase(os.path.abspath(path)).encode()).hexdigest()[:12]


def _hash(p):
    h = hashlib.sha1()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def snapshot(folder):
    tm = tm_store()
    key = "tm:" + folder
    if key in BUSY:
        return None
    BUSY[key] = "scanning"
    try:
        store = tm["store"]
        fid = _fid(folder)
        sdir = os.path.join(store, "snaps", fid)
        os.makedirs(sdir, exist_ok=True)
        snaps = sorted(f for f in os.listdir(sdir) if f.endswith(".json"))
        prev = {}
        if snaps:
            with open(os.path.join(sdir, snaps[-1]), encoding="utf-8") as f:
                prev = json.load(f)["files"]
        cur, added, changed, copied = {}, 0, 0, 0
        for d, dirs, files in os.walk(folder):
            dirs[:] = [x for x in dirs if x not in SKIP_DIRS]
            for fn in files:
                p = os.path.join(d, fn)
                rel = os.path.relpath(p, folder)
                try:
                    st = os.stat(p)
                except OSError:
                    continue
                if st.st_size > 300 << 20 or len(cur) > 30000:
                    continue
                old = prev.get(rel)
                if old and old["s"] == st.st_size and old["m"] == int(st.st_mtime):
                    cur[rel] = old
                    continue
                try:
                    h = _hash(p)
                except OSError:
                    continue
                obj = os.path.join(store, "objects", h[:2], h)
                if not os.path.exists(obj):
                    os.makedirs(os.path.dirname(obj), exist_ok=True)
                    try:
                        shutil.copy2(p, obj)
                        copied += st.st_size
                    except OSError:
                        continue
                cur[rel] = {"h": h, "s": st.st_size, "m": int(st.st_mtime)}
                if old:
                    changed += 1
                else:
                    added += 1
        removed = len(set(prev) - set(cur))
        if snaps and not (added or changed or removed):
            _mark(folder)
            return {"same": True}
        name = time.strftime("%Y%m%d-%H%M%S") + ".json"
        with open(os.path.join(sdir, name), "w", encoding="utf-8") as f:
            json.dump({"t": time.time(), "folder": folder, "files": cur, "added": added, "changed": changed, "removed": removed}, f)
        _mark(folder)
        common.event("tm.snap", os.path.basename(folder))
        return {"snap": name, "added": added, "changed": changed, "removed": removed, "copied": copied}
    finally:
        BUSY.pop(key, None)


def _mark(folder):
    tm = common.load("timemachine", {"folders": [], "every": 60, "store": ""})
    for f in tm["folders"]:
        if f["path"] == folder:
            f["last"] = time.time()
    common.save("timemachine", tm)


def _snaps(folder):
    tm = tm_store()
    sdir = os.path.join(tm["store"], "snaps", _fid(folder))
    if not os.path.isdir(sdir):
        return sdir, []
    return sdir, sorted(f for f in os.listdir(sdir) if f.endswith(".json"))


@kit.hub_get("/api/kit/tm")
def _tm_get(q):
    tm = tm_store()
    folder = (q.get("folder") or [""])[0]
    if not folder:
        for f in tm["folders"]:
            f["count"] = len(_snaps(f["path"])[1])
            f["busy"] = ("tm:" + f["path"]) in BUSY
        return 200, tm
    sdir, snaps = _snaps(folder)
    snap = (q.get("snap") or [""])[0]
    if not snap:
        out = []
        for s in snaps[-200:]:
            try:
                with open(os.path.join(sdir, s), encoding="utf-8") as f:
                    j = json.load(f)
                out.append({"snap": s, "t": j["t"], "files": len(j["files"]), "added": j["added"], "changed": j["changed"], "removed": j["removed"]})
            except (OSError, ValueError):
                pass
        return 200, {"folder": folder, "snaps": out[::-1]}
    if snap not in snaps:
        return 404, {"ok": False}
    with open(os.path.join(sdir, snap), encoding="utf-8") as f:
        j = json.load(f)
    like = (q.get("q") or [""])[0].lower()
    files = []
    for rel, meta in j["files"].items():
        if like and like not in rel.lower():
            continue
        p = os.path.join(folder, rel)
        try:
            st = os.stat(p)
            now = "same" if st.st_size == meta["s"] and int(st.st_mtime) == meta["m"] else "changed"
        except OSError:
            now = "deleted"
        files.append({"rel": rel, "size": meta["s"], "m": meta["m"], "now": now})
    files.sort(key=lambda x: (x["now"] == "same", x["rel"].lower()))
    return 200, {"folder": folder, "snap": snap, "t": j["t"], "files": files[:2000], "total": len(files)}


@kit.hub_post("/api/kit/tm")
def _tm_post(b):
    tm = tm_store()
    op = b.get("op")
    if op == "add":
        p = str(b.get("path", "")).strip().strip('"')
        if not os.path.isdir(p):
            return 400, {"ok": False, "msg": "that folder doesn't exist"}
        if os.path.abspath(tm["store"]).lower().startswith(os.path.abspath(p).lower()):
            return 400, {"ok": False, "msg": "pick a folder that doesn't contain the time machine store"}
        if p not in [f["path"] for f in tm["folders"]]:
            tm["folders"].append({"path": p, "on": True, "last": 0})
        common.save("timemachine", tm)
        threading.Thread(target=snapshot, args=(p,), daemon=True).start()
    elif op == "del":
        tm["folders"] = [f for f in tm["folders"] if f["path"] != b.get("path")]
        common.save("timemachine", tm)
    elif op == "every":
        tm["every"] = max(10, min(int(b.get("every") or 60), 1440))
        common.save("timemachine", tm)
    elif op == "snap":
        return 200, {"ok": True, "r": snapshot(b.get("path"))}
    elif op == "restore":
        folder, snap, rel = b.get("folder"), b.get("snap"), b.get("rel")
        sdir, snaps = _snaps(folder)
        if snap not in snaps:
            return 404, {"ok": False}
        with open(os.path.join(sdir, snap), encoding="utf-8") as f:
            files = json.load(f)["files"]
        rels = [rel] if rel else list(files)
        to = b.get("to") or "original"
        dest_root = folder if to == "original" else os.path.join(common.HOME, "Desktop", "Restored " + os.path.basename(folder) + " " + snap[:13])
        done = 0
        for r in rels:
            meta = files.get(r)
            if not meta:
                continue
            obj = os.path.join(tm["store"], "objects", meta["h"][:2], meta["h"])
            dest = os.path.normpath(os.path.join(dest_root, r))
            if os.path.commonpath([dest, os.path.normpath(dest_root)]) != os.path.normpath(dest_root):
                continue
            if not os.path.exists(obj):
                continue
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            if to == "original" and os.path.exists(dest):
                try:
                    if _hash(dest) == meta["h"]:
                        continue
                    keep = dest + ".before-restore"
                    shutil.copy2(dest, keep)
                except OSError:
                    pass
            shutil.copy2(obj, dest)
            done += 1
        common.event("tm.restore", str(done))
        return 200, {"ok": True, "restored": done, "to": dest_root}
    return _tm_get({})
