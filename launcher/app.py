"""Launchpad - one animated hub for every game on this PC, with playtime stats.

Pure Python standard library, no installs. Run start.bat (or `pythonw app.py`).
It serves http://127.0.0.1:7790 and opens it as an app window (Edge --app).

What it does
- Scans Steam, Riot, HoYoPlay, TLauncher, Epic, GOG and Ubisoft installs, plus
  any game you add by hand, and launches them through their own launchers.
- Tracks playtime itself: every few seconds it looks at running processes
  (by install folder) and window titles, and logs sessions to
  data/sessions.jsonl. Steam's own lifetime playtime is read from Steam.
- Nothing is ever moved or deleted. The optional "Games folder" only writes
  shortcut files into a folder you pick.
"""
import ctypes
import ctypes.wintypes as wt
import hashlib
import json
import mimetypes
import os
import re
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

VERSION = "1.1.0"
PORT = int(os.environ.get("LAUNCHPAD_PORT", "7790"))
HERE = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(HERE, "static")
DATA = os.environ.get("LAUNCHPAD_DATA") or os.path.join(HERE, "data")
ART_DIR = os.path.join(DATA, "art")
ICON_DIR = os.path.join(DATA, "icons")
STATE_PATH = os.path.join(DATA, "hub.json")
SESSIONS_PATH = os.path.join(DATA, "sessions.jsonl")
POLL_SECONDS = 5
GRACE_POLLS = 3  # a game must be gone this many polls before its session ends
QT_ROOT = os.path.dirname(HERE)

LOCK = threading.RLock()

# ----------------------------------------------------------------- state ---

DEFAULT_SETTINGS = {"show_tools": True, "track": True, "reduce_motion": False, "break_nudge": 0,
                    "accent": "auto", "games_folder": os.path.join(os.path.expanduser("~"), "Desktop", "Games")}


def load_json(path, default):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def save_json(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=1)
    os.replace(tmp, path)


def load_state():
    st = load_json(STATE_PATH, {})
    st.setdefault("settings", {})
    for k, v in DEFAULT_SETTINGS.items():
        st["settings"].setdefault(k, v)
    st.setdefault("overrides", {})   # id -> {fav, hidden, name}
    st.setdefault("custom", [])      # [{id, name, path, args}]
    st.setdefault("active", {})      # id -> {start, last}
    st.setdefault("launches", {})    # id -> last launch ts from the hub
    return st


os.makedirs(ART_DIR, exist_ok=True)
os.makedirs(ICON_DIR, exist_ok=True)
STATE = load_state()


def save_state():
    with LOCK:
        save_json(STATE_PATH, STATE)


def safe_id(gid):
    return re.sub(r"[^a-zA-Z0-9_-]", "_", gid)


def norm(p):
    return os.path.normcase(os.path.normpath(p)) if p else ""

# ------------------------------------------------------------ vdf parser ---


def parse_vdf(text):
    """Minimal Valve KeyValues parser -> nested dicts (keys lowercased)."""
    tokens = re.findall(r'"((?:[^"\\]|\\.)*)"|([{}])', text)
    pos = 0

    def block():
        nonlocal pos
        out = {}
        while pos < len(tokens):
            s, brace = tokens[pos]
            pos += 1
            if brace == "}":
                return out
            key = s.lower()
            if pos < len(tokens) and tokens[pos][1] == "{":
                pos += 1
                out[key] = block()
            elif pos < len(tokens):
                out[key] = tokens[pos][0].replace("\\\\", "\\")
                pos += 1
        return out
    return block()


def read_text(path):
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        return ""

# --------------------------------------------------------------- scanners ---

STEAM_SKIP = {"228980"}             # Steamworks Common Redistributables
STEAM_APPS = {"431960"}             # Wallpaper Engine: an app, not a game


def reg_value(root, path, name):
    try:
        import winreg
        with winreg.OpenKey(root, path) as k:
            return winreg.QueryValueEx(k, name)[0]
    except OSError:
        return None


def reg_subkeys(root, path):
    try:
        import winreg
        with winreg.OpenKey(root, path) as k:
            i = 0
            while True:
                try:
                    yield winreg.EnumKey(k, i)
                except OSError:
                    return
                i += 1
    except OSError:
        return


def find_art(folder):
    """Steam's librarycache keeps art in hashed sub-folders; find by name."""
    want = {"portrait": ("library_600x900.jpg", "library_capsule.jpg"),
            "hero": ("library_hero.jpg",), "logo": ("logo.png",),
            "header": ("library_header.jpg", "header.jpg")}
    found = {}
    for dp, _dn, files in os.walk(folder):
        low = {f.lower(): f for f in files}
        for kind, names in want.items():
            for i, n in enumerate(names):
                if n in low:
                    prev = found.get(kind)
                    if prev is None or prev[0] > i:
                        found[kind] = (i, os.path.join(dp, low[n]))
    return {k: v[1] for k, v in found.items()}


def scan_steam():
    import winreg
    root = reg_value(winreg.HKEY_CURRENT_USER, r"Software\Valve\Steam", "SteamPath")
    if not root or not os.path.isdir(root):
        return []
    root = os.path.normpath(root)
    libs = [root]
    lf = parse_vdf(read_text(os.path.join(root, "steamapps", "libraryfolders.vdf")))
    for v in lf.get("libraryfolders", {}).values():
        if isinstance(v, dict) and v.get("path"):
            libs.append(os.path.normpath(v["path"]))
    # lifetime playtime from every local Steam user
    play = {}
    udir = os.path.join(root, "userdata")
    for user in (os.listdir(udir) if os.path.isdir(udir) else []):
        lc = parse_vdf(read_text(os.path.join(udir, user, "config", "localconfig.vdf")))
        apps = (lc.get("userlocalconfigstore", {}).get("software", {}).get("valve", {})
                .get("steam", {}).get("apps", {}))
        for appid, a in apps.items():
            if not isinstance(a, dict):
                continue
            p = play.setdefault(appid, {"min": 0, "last": 0, "wk2": 0})
            p["min"] += int(a.get("playtime", 0) or 0)
            p["wk2"] += int(a.get("playtime2wks", 0) or 0)
            p["last"] = max(p["last"], int(a.get("lastplayed", 0) or 0))
    games, seen = [], set()
    for lib in dict.fromkeys(libs):
        sa = os.path.join(lib, "steamapps")
        try:
            names = os.listdir(sa)
        except OSError:
            continue
        for fn in names:
            m = re.match(r"appmanifest_(\d+)\.acf$", fn)
            if not m or m.group(1) in STEAM_SKIP or m.group(1) in seen:
                continue
            appid = m.group(1)
            st = parse_vdf(read_text(os.path.join(sa, fn))).get("appstate", {})
            installdir = os.path.join(sa, "common", st.get("installdir", ""))
            if not st.get("installdir") or not os.path.isdir(installdir):
                continue
            seen.add(appid)
            name = re.sub(r"[\u2122\u00ae]", "", st.get("name", appid)).strip()
            p = play.get(appid, {})
            games.append({
                "id": f"steam:{appid}", "name": name, "source": "Steam",
                "kind": "app" if appid in STEAM_APPS else "game",
                "dir": installdir, "size": int(st.get("sizeondisk", 0) or 0),
                "launch": {"url": f"steam://rungameid/{appid}"},
                "store_minutes": p.get("min", 0), "store_last": p.get("last", 0),
                "store_2wk": p.get("wk2", 0),
                "art": find_art(os.path.join(root, "appcache", "librarycache", appid)),
                "track_dirs": [installdir] if appid not in STEAM_APPS else [],
            })
    return games


RIOT_NAMES = {"valorant": ("VALORANT", [r"^VALORANT\s*$"]),
              "league_of_legends": ("League of Legends", [r"^League of Legends \(TM\) Client$"]),
              "bacon": ("Legends of Runeterra", []), "lion": ("2XKO", [])}


def scan_riot():
    meta = r"C:\ProgramData\Riot Games\Metadata"
    inst = load_json(r"C:\ProgramData\Riot Games\RiotClientInstalls.json", {})
    client = inst.get("rc_default") or r"C:\Riot Games\Riot Client\RiotClientServices.exe"
    games = []
    if not os.path.isdir(meta):
        return games
    for d in sorted(os.listdir(meta)):
        m = re.match(r"([a-z_]+)\.live$", d)
        if not m or m.group(1) not in RIOT_NAMES:
            continue
        prod = m.group(1)
        if not os.path.exists(os.path.join(meta, d, d + ".ok")):
            continue  # metadata only, not actually installed
        y = read_text(os.path.join(meta, d, d + ".product_settings.yaml"))
        mm = re.search(r'product_install_full_path:\s*"([^"]+)"', y)
        path = os.path.normpath(mm.group(1)) if mm else ""
        if not path or not os.path.isdir(path):
            continue
        name, titles = RIOT_NAMES[prod]
        ico = os.path.join(meta, d, d + ".ico")
        games.append({
            "id": f"riot:{prod}", "name": name, "source": "Riot", "kind": "game",
            "dir": path, "launch": {"exe": os.path.normpath(client),
                                    "args": f"--launch-product={prod} --launch-patchline=live"},
            "art": {"icon": ico} if os.path.exists(ico) else {},
            "track_dirs": [path], "track_titles": titles,
        })
    return games


def scan_hoyo():
    import winreg
    games = []
    roots = {r"C:\Program Files\HoYoPlay"}
    for key in reg_subkeys(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"):
        loc = reg_value(winreg.HKEY_LOCAL_MACHINE,
                        rf"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\{key}", "InstallLocation")
        if loc and "hoyoplay" in loc.lower():
            roots.add(os.path.normpath(loc))
    known = {"genshinimpact.exe": ("Genshin Impact", r"^Genshin Impact$"),
             "starrail.exe": ("Honkai: Star Rail", r"^Honkai: Star Rail$"),
             "zenlesszonezero.exe": ("Zenless Zone Zero", r"^ZenlessZoneZero$")}
    for r in roots:
        gdir = os.path.join(r, "games")
        for sub in (os.listdir(gdir) if os.path.isdir(gdir) else []):
            full = os.path.join(gdir, sub)
            for f in (os.listdir(full) if os.path.isdir(full) else []):
                if f.lower() in known:
                    name, title = known[f.lower()]
                    games.append({
                        "id": "hoyo:" + f.lower()[:-4], "name": name, "source": "HoYoPlay",
                        "kind": "game", "dir": full,
                        "launch": {"exe": os.path.join(full, f)},
                        "exe": os.path.join(full, f), "art": {},
                        "track_dirs": [full], "track_titles": [title]})
    return games


def scan_tlauncher():
    exe = os.path.join(os.environ.get("APPDATA", ""), ".minecraft", "TLauncher.exe")
    if not os.path.exists(exe):
        return []
    # TLauncher itself lives in .minecraft, so track the game by window title only.
    return [{"id": "mc:tlauncher", "name": "Minecraft", "source": "TLauncher", "kind": "game",
             "dir": os.path.dirname(exe), "launch": {"exe": exe}, "exe": exe, "art": {},
             "track_dirs": [], "track_titles": [r"^Minecraft[\* ]"]}]


def scan_epic():
    games = []
    man = r"C:\ProgramData\Epic\EpicGamesLauncher\Data\Manifests"
    for fn in (os.listdir(man) if os.path.isdir(man) else []):
        if not fn.endswith(".item"):
            continue
        j = load_json(os.path.join(man, fn), {})
        loc = j.get("InstallLocation")
        if not loc or not os.path.isdir(loc) or "games" not in [c.lower() for c in j.get("AppCategories", ["games"])]:
            continue
        exe = os.path.join(loc, j.get("LaunchExecutable", ""))
        games.append({"id": "epic:" + j.get("AppName", fn), "name": j.get("DisplayName", fn),
                      "source": "Epic", "kind": "game", "dir": loc,
                      "launch": {"url": "com.epicgames.launcher://apps/%s?action=launch&silent=true"
                                 % urllib.parse.quote(j.get("AppName", ""))},
                      "exe": exe if os.path.isfile(exe) else None, "art": {}, "track_dirs": [loc]})
    return games


def scan_gog():
    import winreg
    games = []
    base = r"SOFTWARE\WOW6432Node\GOG.com\Games"
    for key in reg_subkeys(winreg.HKEY_LOCAL_MACHINE, base):
        g = lambda n: reg_value(winreg.HKEY_LOCAL_MACHINE, base + "\\" + key, n)
        path, exe = g("path"), g("exe")
        if path and os.path.isdir(path):
            games.append({"id": "gog:" + key, "name": g("gameName") or key, "source": "GOG",
                          "kind": "game", "dir": path,
                          "launch": {"exe": exe, "args": g("launchParam") or ""} if exe else {},
                          "exe": exe, "art": {}, "track_dirs": [path]})
    return games


def scan_ubisoft():
    import winreg
    games = []
    base = r"SOFTWARE\WOW6432Node\Ubisoft\Launcher\Installs"
    for key in reg_subkeys(winreg.HKEY_LOCAL_MACHINE, base):
        path = reg_value(winreg.HKEY_LOCAL_MACHINE, base + "\\" + key, "InstallDir")
        if not path or not os.path.isdir(path) or "steamapps" in path.lower():
            continue  # Steam copies are already listed under Steam
        path = os.path.normpath(path)
        games.append({"id": "ubi:" + key, "name": os.path.basename(path), "source": "Ubisoft",
                      "kind": "game", "dir": path, "launch": {"url": f"uplay://launch/{key}/0"},
                      "art": {}, "track_dirs": [path]})
    return games


def qt_tools():
    """The QT tools, launchable from the Tools shelf."""
    spec = [("suite", "QT Suite", "Every tool in one window", "start.bat", "suite.ico"),
            ("beam", "Beam", "Send big files PC to phone", "start.bat", "beam.ico"),
            ("volt", "Volt", "Local media grabber", "start.bat", "volt.ico"),
            ("burrow", "Burrow", "Fast file explorer", "start.bat", "burrow.ico"),
            ("space-manager", "Space Manager", "See what fills your drives", "start.bat", "space.ico"),
            ("lens-pc", "Lens", "Search your photos and screenshots", "start.bat", "lens.ico"),
            ("soundboard", "Soundboard", "Hotkey sound pads", "run.bat", "soundboard.ico"),
            ("inkmotion", "Inkmotion", "Motion sketch studio", "Inkmotion.html", "inkmotion.ico"),
            ("pixlab", "Pixlab", "Pixel art editor", "Pixlab.html", "pixlab.ico")]
    out = []
    for folder, name, blurb, entry, icon in spec:
        p = os.path.join(QT_ROOT, folder, entry)
        if os.path.exists(p):
            ico = next((os.path.join(QT_ROOT, folder, f) for f in
                        (icon, folder + ".ico", "static/icon.svg") if os.path.exists(os.path.join(QT_ROOT, folder, f))), None)
            out.append({"id": "qt:" + folder, "name": name, "blurb": blurb, "source": "QT tool",
                        "kind": "tool", "dir": os.path.dirname(p), "launch": {"exe": p},
                        "art": {"icon": ico} if ico else {}, "track_dirs": []})
    return out


def custom_games():
    out = []
    for c in STATE["custom"]:
        exe = c.get("path", "")
        d = os.path.dirname(exe)
        shallow = len([x for x in norm(d).split(os.sep) if x]) <= 2
        out.append({"id": c["id"], "name": c.get("name") or os.path.splitext(os.path.basename(exe))[0],
                    "source": "Added", "kind": "game", "dir": d, "exe": exe,
                    "launch": {"exe": exe, "args": c.get("args", "")}, "art": {},
                    "track_dirs": [] if shallow else [d], "track_exes": [exe],
                    "missing": not os.path.exists(exe)})
    return out


SCANNERS = [scan_steam, scan_riot, scan_hoyo, scan_tlauncher, scan_epic, scan_gog, scan_ubisoft]
LIBRARY = {"games": [], "scanned": 0, "errors": []}


def rescan():
    games, errors = [], []
    for fn in SCANNERS:
        try:
            games.extend(fn())
        except Exception as e:  # one broken store must not hide the rest
            errors.append(f"{fn.__name__}: {e}")
    games.extend(custom_games())
    games.extend(qt_tools())
    with LOCK:
        LIBRARY["games"] = games
        LIBRARY["scanned"] = time.time()
        LIBRARY["errors"] = errors
    threading.Thread(target=extract_icons, args=(games,), daemon=True).start()
    return games


def extract_icons(games):
    """Pull the exe icon for non-Steam games once (via .NET, cached as PNG)."""
    todo = []
    for g in games:
        exe = g.get("exe")
        out = os.path.join(ICON_DIR, safe_id(g["id"]) + ".png")
        if exe and os.path.isfile(exe) and not os.path.exists(out):
            todo.append((exe, out))
    if not todo:
        return
    lines = ["Add-Type -AssemblyName System.Drawing"]
    for exe, out in todo:
        lines.append("try { $i=[System.Drawing.Icon]::ExtractAssociatedIcon('%s'); $i.ToBitmap().Save('%s',"
                     "[System.Drawing.Imaging.ImageFormat]::Png) } catch {}"
                     % (exe.replace("'", "''"), out.replace("'", "''")))
    try:
        subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ";".join(lines)],
                       capture_output=True, timeout=60, creationflags=0x08000000)
    except Exception:
        pass


def game_by_id(gid):
    with LOCK:
        for g in LIBRARY["games"]:
            if g["id"] == gid:
                return g
    return None

# --------------------------------------------------------- process watch ---

if sys.platform == "win32":
    _k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    _psapi = ctypes.WinDLL("psapi", use_last_error=True)
    _u32 = ctypes.WinDLL("user32", use_last_error=True)
    _k32.OpenProcess.restype = wt.HANDLE
    _k32.OpenProcess.argtypes = [wt.DWORD, wt.BOOL, wt.DWORD]
    _k32.QueryFullProcessImageNameW.argtypes = [wt.HANDLE, wt.DWORD, wt.LPWSTR, ctypes.POINTER(wt.DWORD)]
    _k32.CloseHandle.argtypes = [wt.HANDLE]
    _EnumWindowsProc = ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)


def running_processes():
    """{pid: exe_path} for every process we may query (no admin needed)."""
    out = {}
    if sys.platform != "win32":
        return out
    arr = (wt.DWORD * 8192)()
    needed = wt.DWORD()
    if not _psapi.EnumProcesses(arr, ctypes.sizeof(arr), ctypes.byref(needed)):
        return out
    buf = ctypes.create_unicode_buffer(1024)
    for pid in arr[: needed.value // ctypes.sizeof(wt.DWORD)]:
        if not pid:
            continue
        h = _k32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
        if not h:
            continue
        size = wt.DWORD(len(buf))
        if _k32.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(size)):
            out[pid] = buf.value
        _k32.CloseHandle(h)
    return out


def window_titles():
    titles = []
    if sys.platform != "win32":
        return titles
    buf = ctypes.create_unicode_buffer(512)

    def cb(hwnd, _):
        if _u32.IsWindowVisible(hwnd):
            n = _u32.GetWindowTextW(hwnd, buf, 512)
            if n:
                titles.append(buf.value)
        return True
    _u32.EnumWindows(_EnumWindowsProc(cb), 0)
    return titles


def detect_running(games, procs, titles):
    paths = [norm(p) for p in procs.values()]
    me = norm(sys.executable)
    running = set()
    for g in games:
        if g.get("kind") == "tool":
            continue
        hit = False
        for d in g.get("track_dirs", []):
            nd = norm(d) + os.sep
            if any(p.startswith(nd) and p != me for p in paths):
                hit = True
                break
        if not hit:
            exes = {norm(e) for e in g.get("track_exes", [])}
            hit = any(p in exes for p in paths)
        if not hit:
            for pat in g.get("track_titles", []):
                if any(re.search(pat, t) for t in titles):
                    hit = True
                    break
        if hit:
            running.add(g["id"])
    return running


MISSES = {}
NUDGED = {}  # gid -> session start already nudged
TOAST_AUMID = r"{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe"


def win_toast(title, body):
    """Quiet Windows toast via PowerShell + WinRT. Best effort, runs in the background."""
    if sys.platform != "win32" or os.environ.get("LAUNCHPAD_NO_TOAST"):
        return
    from xml.sax.saxutils import escape
    x = ('<toast><visual><binding template="ToastGeneric"><text>%s</text><text>%s</text>'
         '<text placement="attribution">Launchpad</text></binding></visual></toast>'
         % (escape(title[:120]), escape(body[:300]))).replace("'", "''")
    ps = ("[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null;"
          "[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null;"
          "$x = New-Object Windows.Data.Xml.Dom.XmlDocument;"
          f"$x.LoadXml('{x}');"
          "$t = New-Object Windows.UI.Notifications.ToastNotification $x;"
          f"[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{TOAST_AUMID}').Show($t)")
    threading.Thread(target=lambda: subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
        creationflags=0x08000000, timeout=20, capture_output=True), daemon=True).start()


def break_nudges(now):
    """Once per session, a gentle 'take a break' toast after N minutes of play (0 = off)."""
    limit = int(STATE["settings"].get("break_nudge") or 0)
    if limit <= 0:
        return []
    out = []
    for gid, a in STATE["active"].items():
        if now - a["start"] >= limit * 60 and NUDGED.get(gid) != a["start"]:
            NUDGED[gid] = a["start"]
            g = game_by_id(gid)
            name = (STATE["overrides"].get(gid, {}).get("name") or (g or {}).get("name") or gid)
            hrs = (now - a["start"]) / 3600
            out.append(name)
            win_toast(f"{name}: {hrs:.1f} h straight".replace(".0 h", " h"),
                      "Good moment for a stretch and some water. Launchpad keeps tracking.")
    return out


def append_session(gid, start, end):
    if end - start < 60:
        return  # ignore blips under a minute
    with LOCK, open(SESSIONS_PATH, "a", encoding="utf-8") as f:
        f.write(json.dumps({"g": gid, "s": int(start), "e": int(end)}) + "\n")


def tracker_tick(now=None):
    now = now or time.time()
    with LOCK:
        games = list(LIBRARY["games"])
    running = detect_running(games, running_processes(), window_titles())
    changed = False
    with LOCK:
        act = STATE["active"]
        for gid in running:
            MISSES.pop(gid, None)
            if gid not in act:
                act[gid] = {"start": now, "last": now}
            act[gid]["last"] = now
            changed = True
        for gid in list(act):
            if gid in running:
                continue
            MISSES[gid] = MISSES.get(gid, 0) + 1
            if MISSES[gid] >= GRACE_POLLS:
                a = act.pop(gid)
                MISSES.pop(gid, None)
                append_session(gid, a["start"], a["last"])
                changed = True
        if changed:
            save_state()
        break_nudges(now)
    return running


def recover_sessions():
    """Close sessions left open by a crash / shutdown at their last heartbeat."""
    with LOCK:
        for gid, a in list(STATE["active"].items()):
            if time.time() - a.get("last", 0) > POLL_SECONDS * GRACE_POLLS * 2:
                append_session(gid, a["start"], a["last"])
                STATE["active"].pop(gid)
        save_state()


def tracker_loop():
    while True:
        try:
            if STATE["settings"].get("track", True):
                tracker_tick()
        except Exception as e:
            print("tracker:", e, file=sys.stderr)
        time.sleep(POLL_SECONDS)

# ------------------------------------------------------------------ stats ---


def read_sessions():
    out = []
    try:
        with open(SESSIONS_PATH, "r", encoding="utf-8") as f:
            for line in f:
                try:
                    s = json.loads(line)
                    if s["e"] > s["s"]:
                        out.append(s)
                except (ValueError, KeyError):
                    pass
    except OSError:
        pass
    now = time.time()
    with LOCK:
        for gid, a in STATE["active"].items():
            out.append({"g": gid, "s": int(a["start"]), "e": int(now), "live": True})
    return out


def day_start(ts):
    lt = time.localtime(ts)
    return time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday, 0, 0, 0, 0, 0, -1))


def compute_stats(days=30):
    sessions = read_sessions()
    now = time.time()
    today0 = day_start(now)
    starts = [today0]
    for _ in range(days - 1):
        starts.insert(0, day_start(starts[0] - 3600 * 12))
    daily = [{"day": time.strftime("%Y-%m-%d", time.localtime(s)), "total": 0, "games": {}} for s in starts]
    heat = [[0] * 24 for _ in range(7)]
    per = {}
    for s in sessions:
        g = per.setdefault(s["g"], {"minutes": 0, "sessions": 0, "longest": 0, "last": 0})
        mins = (s["e"] - s["s"]) / 60
        g["minutes"] += mins
        g["sessions"] += 1
        g["longest"] = max(g["longest"], mins)
        g["last"] = max(g["last"], s["e"])
        t = s["s"]
        while t < s["e"]:  # split across hours (for heatmap) and days
            lt = time.localtime(t)
            nxt = min(s["e"], t - lt.tm_min * 60 - lt.tm_sec + 3600)
            m = (nxt - t) / 60
            heat[lt.tm_wday][lt.tm_hour] += m
            ds = day_start(t)
            for i, st0 in enumerate(starts):
                if abs(st0 - ds) < 3:
                    daily[i]["total"] += m
                    daily[i]["games"][s["g"]] = daily[i]["games"].get(s["g"], 0) + m
            t = nxt
    streak, i = 0, len(daily) - 1
    if daily[i]["total"] < 1:
        i -= 1  # today not played yet doesn't break the streak
    while i >= 0 and daily[i]["total"] >= 1:
        streak += 1
        i -= 1
    week = sum(d["total"] for d in daily[-7:])
    prev_week = sum(d["total"] for d in daily[-14:-7])
    return {"daily": daily, "heat": heat, "per": per, "streak": streak, "week": week,
            "prev_week": prev_week, "sessions": len(sessions),
            "longest": max([(s["e"] - s["s"]) / 60 for s in sessions], default=0),
            "first": min([s["s"] for s in sessions], default=0)}


def library_payload():
    stats = compute_stats()
    with LOCK:
        games = [dict(g) for g in LIBRARY["games"]]
        ov = STATE["overrides"]
        active = dict(STATE["active"])
        launches = dict(STATE["launches"])
        settings = dict(STATE["settings"])
    out = []
    for g in games:
        o = ov.get(g["id"], {})
        p = stats["per"].get(g["id"], {})
        tracked = p.get("minutes", 0)
        total = max(g.get("store_minutes", 0), tracked)
        art = {}
        for kind in ("portrait", "hero", "logo", "header", "icon"):
            if custom_art(g["id"], kind) or g["art"].get(kind):
                art[kind] = f"/art/{urllib.parse.quote(g['id'])}/{kind}"
        if "icon" not in art and os.path.exists(os.path.join(ICON_DIR, safe_id(g["id"]) + ".png")):
            art["icon"] = f"/art/{urllib.parse.quote(g['id'])}/icon"
        out.append({
            "id": g["id"], "name": o.get("name") or g["name"], "source": g["source"],
            "kind": g.get("kind", "game"), "blurb": g.get("blurb", ""),
            "fav": bool(o.get("fav")), "hidden": bool(o.get("hidden")),
            "minutes": round(total), "tracked": round(tracked),
            "store_minutes": g.get("store_minutes", 0), "store_2wk": g.get("store_2wk", 0),
            "sessions": p.get("sessions", 0), "longest": round(p.get("longest", 0)),
            "last": max(g.get("store_last", 0), p.get("last", 0), launches.get(g["id"], 0)),
            "size": g.get("size", 0), "dir": g.get("dir", ""), "art": art,
            "running": g["id"] in active,
            "running_since": active.get(g["id"], {}).get("start"),
            "missing": g.get("missing", False),
        })
    return {"version": VERSION, "games": out, "stats": stats, "settings": settings,
            "scanned": LIBRARY["scanned"], "errors": LIBRARY["errors"],
            "startup": os.path.exists(startup_lnk())}

# ----------------------------------------------------------- art storage ---


def custom_art(gid, kind):
    for ext in (".png", ".jpg", ".webp", ".gif"):
        p = os.path.join(ART_DIR, f"{safe_id(gid)}_{kind}{ext}")
        if os.path.exists(p):
            return p
    return None


def art_path(gid, kind):
    p = custom_art(gid, kind)
    if p:
        return p
    g = game_by_id(gid)
    if g and g["art"].get(kind) and os.path.exists(g["art"][kind]):
        return g["art"][kind]
    if kind == "icon":
        p = os.path.join(ICON_DIR, safe_id(gid) + ".png")
        if os.path.exists(p):
            return p
    return None

# --------------------------------------------------------------- actions ---


def launch(gid):
    g = game_by_id(gid)
    if not g:
        raise ValueError("unknown game")
    L = g.get("launch") or {}
    if L.get("url"):
        os.startfile(L["url"])
    elif L.get("exe"):
        exe = L["exe"]
        if not os.path.exists(exe):
            raise ValueError("launcher not found: " + exe)
        if exe.lower().endswith(".bat"):
            os.startfile(exe, "open", "", os.path.dirname(exe))
        else:
            # ShellExecute, so games that need admin (e.g. Genshin) get the UAC prompt
            os.startfile(exe, "open", L.get("args", ""), os.path.dirname(exe))
    else:
        raise ValueError("no launch method")
    with LOCK:
        STATE["launches"][gid] = time.time()
        save_state()


def startup_lnk():
    return os.path.join(os.environ.get("APPDATA", ""), r"Microsoft\Windows\Start Menu\Programs\Startup",
                        "Launchpad (background).lnk")


def ps_shortcut(lnk, target, args="", workdir="", icon="", desc=""):
    q = lambda s: s.replace("'", "''")
    cmd = ("$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%s');$s.TargetPath='%s';"
           "$s.Arguments='%s';$s.WorkingDirectory='%s';$s.Description='%s';%s$s.Save()"
           % (q(lnk), q(target), q(args), q(workdir), q(desc),
              ("$s.IconLocation='%s';" % q(icon)) if icon else ""))
    subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", cmd],
                   capture_output=True, timeout=30, creationflags=0x08000000, check=True)


def set_startup(on):
    lnk = startup_lnk()
    if on:
        pyw = os.path.join(os.path.dirname(sys.executable), "pythonw.exe")
        ps_shortcut(lnk, pyw if os.path.exists(pyw) else sys.executable,
                    f'"{os.path.join(HERE, "app.py")}" --background', HERE,
                    os.path.join(HERE, "launchpad.ico"), "Launchpad playtime tracker")
    elif os.path.exists(lnk):
        os.remove(lnk)


def guess_exe(d):
    """Biggest .exe near the top of an install folder: almost always the game."""
    best = (0, None)
    skip = re.compile(r"crash|unins|setup|redist|helper|report|launcher|installer|anticheat|be_", re.I)
    for root, dirs, files in os.walk(d):
        if root[len(d):].count(os.sep) > 3:
            dirs[:] = []
            continue
        for f in files:
            if f.lower().endswith(".exe") and not skip.search(f):
                try:
                    sz = os.path.getsize(os.path.join(root, f))
                except OSError:
                    continue
                if sz > best[0]:
                    best = (sz, os.path.join(root, f))
    return best[1]


def build_games_folder(folder):
    """Writes one shortcut per game into `folder`. Never moves game files."""
    os.makedirs(folder, exist_ok=True)
    made = []
    with LOCK:
        games = [g for g in LIBRARY["games"] if g.get("kind") == "game"]
    for g in games:
        name = re.sub(r'[<>:"/\\|?*]', "", (STATE["overrides"].get(g["id"], {}).get("name") or g["name"])).strip()
        L = g.get("launch") or {}
        if L.get("url"):
            path = os.path.join(folder, name + ".url")
            icon = g["art"].get("icon") or g.get("exe") or guess_exe(g.get("dir", "")) or ""
            with open(path, "w", encoding="utf-8") as f:
                f.write("[InternetShortcut]\nURL=%s\n" % L["url"])
                if icon:
                    f.write("IconFile=%s\nIconIndex=0\n" % icon)
        elif L.get("exe"):
            path = os.path.join(folder, name + ".lnk")
            ps_shortcut(path, L["exe"], L.get("args", ""), os.path.dirname(L["exe"]),
                        g["art"].get("icon") or L["exe"], g["name"])
        else:
            continue
        made.append(path)
    return made


def open_window():
    url = f"http://127.0.0.1:{PORT}/"
    for edge in (r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
                 r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"):
        if os.path.exists(edge):
            subprocess.Popen([edge, f"--app={url}", "--window-size=1440,900",
                              f"--user-data-dir={os.path.join(DATA, 'window')}",
                              "--no-first-run", "--disable-features=Translate"])
            return
    import webbrowser
    webbrowser.open(url)

# ------------------------------------------------------------------ http ---


class Handler(BaseHTTPRequestHandler):
    server_version = "Launchpad/" + VERSION

    def log_message(self, *a):
        pass

    def host_ok(self):
        host = (self.headers.get("Host") or "").split(":")[0]
        return host in ("127.0.0.1", "localhost")

    def send_json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_file(self, path, cache=True):
        try:
            with open(path, "rb") as f:
                data = f.read()
        except OSError:
            return self.send_error(404)
        ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
        if path.lower().endswith(".ico"):
            ctype = "image/x-icon"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "max-age=3600" if cache else "no-cache")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if not self.host_ok():
            return self.send_error(403)
        u = urllib.parse.urlparse(self.path)
        p = urllib.parse.unquote(u.path)
        if p == "/api/ping":
            return self.send_json({"app": "launchpad", "version": VERSION})
        if p == "/api/library":
            return self.send_json(library_payload())
        if p == "/api/stats":
            q = urllib.parse.parse_qs(u.query)
            try:
                days = max(7, min(365, int(q.get("days", ["30"])[0])))
            except ValueError:
                days = 30
            st = compute_stats(days)
            st.pop("per", None)
            return self.send_json(st)
        if p.startswith("/art/"):
            parts = p[5:].rsplit("/", 1)
            if len(parts) == 2:
                ap = art_path(parts[0], parts[1])
                if ap:
                    return self.send_file(ap)
            return self.send_error(404)
        rel = "index.html" if p in ("/", "") else p.lstrip("/")
        full = os.path.normpath(os.path.join(STATIC, rel))
        if not full.startswith(STATIC + os.sep) or not os.path.isfile(full):
            return self.send_error(404)
        return self.send_file(full, cache=False)

    def do_POST(self):
        # Host + custom header check: other websites can't drive this API.
        if not self.host_ok() or self.headers.get("X-Launchpad") != "1":
            return self.send_error(403)
        p = urllib.parse.urlparse(self.path).path
        n = int(self.headers.get("Content-Length") or 0)
        if n > 25 * 1024 * 1024:
            return self.send_error(413)
        raw = self.rfile.read(n) if n else b""
        try:
            if p.startswith("/api/art/"):
                gid, kind = urllib.parse.unquote(p[9:]).rsplit("/", 1)
                return self.send_json(self.upload_art(gid, kind, raw))
            body = json.loads(raw or b"{}")
            return self.send_json(self.route(p, body))
        except ValueError as e:
            return self.send_json({"error": str(e)}, 400)
        except Exception as e:
            return self.send_json({"error": f"{type(e).__name__}: {e}"}, 500)

    def upload_art(self, gid, kind, raw):
        if kind not in ("portrait", "hero", "logo") or not game_by_id(gid):
            raise ValueError("bad art target")
        ext = {b"\x89PNG": ".png", b"\xff\xd8\xff": ".jpg", b"RIFF": ".webp", b"GIF8": ".gif"}
        e = next((v for k, v in ext.items() if raw.startswith(k)), None)
        if not e:
            raise ValueError("use a PNG, JPG, WEBP or GIF image")
        old = custom_art(gid, kind)
        if old:
            os.remove(old)
        with open(os.path.join(ART_DIR, f"{safe_id(gid)}_{kind}{e}"), "wb") as f:
            f.write(raw)
        return {"ok": True}

    def route(self, p, b):
        if p == "/api/launch":
            launch(b.get("id", ""))
            return {"ok": True}
        if p == "/api/rescan":
            rescan()
            return library_payload()
        if p == "/api/game":
            gid = b.get("id", "")
            if not game_by_id(gid):
                raise ValueError("unknown game")
            with LOCK:
                o = STATE["overrides"].setdefault(gid, {})
                for k in ("fav", "hidden"):
                    if k in b:
                        o[k] = bool(b[k])
                if "name" in b:
                    o["name"] = str(b["name"]).strip()[:80]
                if b.get("reset_art"):
                    for kind in ("portrait", "hero", "logo"):
                        c = custom_art(gid, kind)
                        if c:
                            os.remove(c)
                save_state()
            return {"ok": True}
        if p == "/api/add":
            path = os.path.normpath(str(b.get("path", "")).strip().strip('"'))
            if not path.lower().endswith((".exe", ".bat", ".lnk", ".url")) or not os.path.isfile(path):
                raise ValueError("Point to an existing .exe (or .lnk / .url) file")
            gid = "exe:" + hashlib.sha1(norm(path).encode()).hexdigest()[:10]
            with LOCK:
                if not any(c["id"] == gid for c in STATE["custom"]):
                    STATE["custom"].append({"id": gid, "path": path, "name": str(b.get("name", "")).strip(),
                                            "args": str(b.get("args", ""))})
                    save_state()
            rescan()
            return {"ok": True, "id": gid}
        if p == "/api/remove":
            gid = b.get("id", "")
            with LOCK:
                STATE["custom"] = [c for c in STATE["custom"] if c["id"] != gid]
                save_state()
            rescan()
            return {"ok": True}
        if p == "/api/open-folder":
            g = game_by_id(b.get("id", ""))
            if g and g.get("dir") and os.path.isdir(g["dir"]):
                os.startfile(g["dir"])
            return {"ok": True}
        if p == "/api/settings":
            with LOCK:
                for k in DEFAULT_SETTINGS:
                    if k in b:
                        STATE["settings"][k] = b[k]
                save_state()
            if "startup" in b:
                set_startup(bool(b["startup"]))
            return library_payload()
        if p == "/api/games-folder":
            folder = os.path.normpath(str(b.get("folder") or STATE["settings"]["games_folder"]))
            made = build_games_folder(folder)
            with LOCK:
                STATE["settings"]["games_folder"] = folder
                save_state()
            os.startfile(folder)
            return {"ok": True, "count": len(made), "folder": folder}
        if p == "/api/quit":
            threading.Thread(target=lambda: (time.sleep(0.3), os._exit(0)), daemon=True).start()
            return {"ok": True}
        raise ValueError("unknown endpoint")


def already_running():
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/api/ping", timeout=1.5) as r:
            return json.load(r).get("app") == "launchpad"
    except Exception:
        return False


def main():
    background = "--background" in sys.argv
    if already_running():
        if not background:
            open_window()
        return
    recover_sessions()
    rescan()
    threading.Thread(target=tracker_loop, daemon=True).start()
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Launchpad {VERSION} on http://127.0.0.1:{PORT}")
    if not background and "--no-window" not in sys.argv:
        threading.Timer(0.4, open_window).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
