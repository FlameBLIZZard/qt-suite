"""QT Suite as a Windows default app (Pictures, Player, Reader, Code, Archive).

Everything lives in HKEY_CURRENT_USER and is undone by `off()`:
  Software\\Classes\\QTSuite.<app>            ProgID per viewer, opens with defaults\\QTOpen.exe <app> "%1"
  Software\\Classes\\.<ext>\\OpenWithProgids   so QT shows up in "Open with" for each type
  Software\\QTSuite\\Capabilities             the "QT Suite" page in Settings > Apps > Default apps
  Software\\RegisteredApplications            points Windows at that page
Windows guards real defaults with a UserChoice hash that programs must not forge, so for types
something else already opens, the person picks QT in Settings (open_settings() jumps straight
to QT's page). Types that nothing on the PC opens yet are claimed directly (only those).
What we touched is recorded in %LOCALAPPDATA%\\QT Suite\\defaults.json so off() puts it back.

CLI: python defaults.py on | off | status | settings
"""
import ctypes
import json
import os
import subprocess
import sys
import winreg
from ctypes import wintypes

HERE = os.path.dirname(os.path.abspath(__file__))
BIN = os.path.join(HERE, "defaults")
EXE = os.path.join(BIN, "QTOpen.exe")
SRC = os.path.join(BIN, "QTOpen.cs")
ICO = os.path.join(HERE, "suite.ico")
DATA = os.environ.get("QT_SUITE_DATA") or os.path.join(os.environ.get("LOCALAPPDATA", ""), "QT Suite")
STATE = os.path.join(DATA, "defaults.json")
CSC = r"C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
APPNAME = "QT Suite"
CAPS = r"Software\QTSuite\Capabilities"
HKCU = winreg.HKEY_CURRENT_USER
CLASSES = r"Software\Classes"
NOWIN = 0x08000000

# What each viewer opens. Same scope as Peek: no programs or scripts (bat/ps1/py/reg run when
# double-clicked), no Office (doc/docx/xls/ppt/csv stay with Office), no web pages (stay with the
# browser), no rar/7z, nothing another app on this PC creates (psd, blend, inkm, pxl, gd).
APPS = {
    "pictures": ("Pictures", "Picture", "jpg jpeg jfif png gif webp bmp avif apng heic heif tif tiff tga dds pcx ppm"),
    "player": ("Player", "Video or song", "mp4 webm mov m4v mkv ogv mp3 wav flac m4a aac ogg opus weba oga"),
    "reader": ("Reader", "Document", "pdf md markdown mdown"),
    "code": ("Code", "Text file", "txt log json geojson ini cfg conf toml yml yaml xml srt vtt nfo diff patch "
             "js mjs cjs tsx jsx css scss less java kt c cc cpp h hpp cs go rs lua sql php rb swift dart vue svelte"),
    "archive": ("Archive", "Zip archive", "zip"),
}


def progid(app):
    return f"QTSuite.{app.capitalize()}"


def ext_map():
    return {e: app for app, (_, _, exts) in APPS.items() for e in exts.split()}


# ----------------------------------------------------------------- registry helpers ---
def _set(path, name, value):
    with winreg.CreateKeyEx(HKCU, path, 0, winreg.KEY_WRITE) as k:
        winreg.SetValueEx(k, name, 0, winreg.REG_SZ, value)


def _get(root, path, name=""):
    try:
        with winreg.OpenKey(root, path) as k:
            return winreg.QueryValueEx(k, name)[0]
    except OSError:
        return None


def _del_value(path, name):
    try:
        with winreg.OpenKey(HKCU, path, 0, winreg.KEY_WRITE) as k:
            winreg.DeleteValue(k, name)
    except OSError:
        pass


def _del_tree(path):
    try:
        with winreg.OpenKey(HKCU, path, 0, winreg.KEY_ALL_ACCESS) as k:
            while True:
                try:
                    sub = winreg.EnumKey(k, 0)
                except OSError:
                    break
                _del_tree(path + "\\" + sub)
        winreg.DeleteKey(HKCU, path)
    except OSError:
        pass


def _empty(path):
    try:
        with winreg.OpenKey(HKCU, path) as k:
            n_sub, n_val, _ = winreg.QueryInfoKey(k)
            return n_sub == 0 and n_val == 0
    except OSError:
        return False


def _notify():
    ctypes.windll.shell32.SHChangeNotify(0x08000000, 0, None, None)  # SHCNE_ASSOCCHANGED


_assoc = ctypes.windll.shlwapi.AssocQueryStringW
_assoc.argtypes = [ctypes.c_uint, ctypes.c_uint, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]


def _q(ext, what):
    buf = ctypes.create_unicode_buffer(1024)
    n = wintypes.DWORD(1024)
    ok = _assoc(0x400, what, "." + ext, "open", buf, ctypes.byref(n)) == 0  # ASSOCF_NOTRUNCATE
    return buf.value if ok else ""


_indirect = ctypes.windll.shlwapi.SHLoadIndirectString
_indirect.argtypes = [wintypes.LPCWSTR, wintypes.LPWSTR, ctypes.c_uint, ctypes.c_void_p]
HKCR = winreg.HKEY_CLASSES_ROOT


def _nice(pid):
    """A person-readable name for a ProgID (Store apps keep theirs as ms-resource strings)."""
    if pid.lower().startswith("qtsuite."):
        return "QT " + pid.split(".", 1)[1]
    for raw in (_get(HKCR, pid + r"\Application", "ApplicationName"), _get(HKCR, pid, "FriendlyTypeName"), _get(HKCR, pid)):
        if raw and raw.startswith("@"):
            buf = ctypes.create_unicode_buffer(512)
            raw = buf.value if _indirect(raw, buf, 512, None) == 0 else ""
        if raw:
            return raw
    return "a Store app" if pid.lower().startswith("appx") else pid


def _user_choice(ext):
    return _get(HKCU, rf"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.{ext}\UserChoice", "ProgId") or ""


def current(ext):
    """(progid, app name) Windows opens .ext with right now; '' when nothing does."""
    pid = _q(ext, 20) or _user_choice(ext) or _get(HKCR, "." + ext) or ""   # ASSOCSTR_PROGID
    name = _q(ext, 4) if _q(ext, 1) else ""                                 # FRIENDLYAPPNAME when it has a command
    if not pid:
        return "", name
    if not name or name.lower().startswith("appx") or pid.lower().startswith(("appx", "qtsuite.")):
        name = _nice(pid)
    return pid, name


def is_ours(ext):
    pid, _ = current(ext)
    return pid.lower().startswith("qtsuite.")


def _unclaimed(ext):
    """Nothing on the PC opens this type: no UserChoice, no default ProgID, no other app offering it."""
    if _user_choice(ext) or _get(HKCR, "." + ext) or _q(ext, 1):
        return False
    for sub in ("OpenWithProgids", "OpenWithList"):
        try:
            with winreg.OpenKey(HKCR, rf".{ext}\{sub}") as k:
                n_sub, n_val, _ = winreg.QueryInfoKey(k)
                names = [winreg.EnumValue(k, i)[0] for i in range(n_val)] + [winreg.EnumKey(k, i) for i in range(n_sub)]
                if any(n and not n.lower().startswith("qtsuite.") for n in names):
                    return False
        except OSError:
            pass
    return True


# ----------------------------------------------------------------------- state ---
def _load():
    try:
        with open(STATE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def _save(d):
    os.makedirs(DATA, exist_ok=True)
    with open(STATE + ".tmp", "w", encoding="utf-8") as f:
        json.dump(d, f, indent=1)
    os.replace(STATE + ".tmp", STATE)


# ------------------------------------------------------------------------ build ---
def build_exe(force=False):
    if os.path.exists(EXE) and not force and os.path.getmtime(EXE) >= os.path.getmtime(SRC):
        return EXE
    r = subprocess.run([CSC, "/nologo", "/target:winexe", "/optimize+", f"/win32icon:{ICO}", f"/out:{EXE}",
                        "/r:System.Windows.Forms.dll", SRC], capture_output=True, text=True, creationflags=NOWIN, timeout=90)
    if r.returncode != 0 or not os.path.exists(EXE):
        raise RuntimeError("Couldn't build QTOpen.exe: " + (r.stdout + r.stderr).strip()[-400:])
    return EXE


def _write_ini():
    pyw = os.path.join(os.path.dirname(sys.executable), "pythonw.exe")
    if not os.path.exists(pyw):
        pyw = sys.executable
    with open(os.path.join(BIN, "qtopen.ini"), "w", encoding="utf-8") as f:
        f.write(f"pythonw={pyw}\napp={os.path.join(HERE, 'app.py')}\n")


# --------------------------------------------------------------------- on / off ---
def on():
    build_exe()
    _write_ini()
    st = _load()
    claimed = set(st.get("claimed", []))
    for app, (name, kind, exts) in APPS.items():
        pid = progid(app)
        base = rf"{CLASSES}\{pid}"
        _set(base, "", f"{kind} (QT {name})")
        _set(base, "FriendlyTypeName", f"{kind} (QT {name})")
        _set(base + r"\DefaultIcon", "", f'"{EXE}",0')
        _set(base + r"\shell", "", "open")
        _set(base + r"\shell\open", "FriendlyAppName", f"QT {name}")
        _set(base + r"\shell\open\command", "", f'"{EXE}" {app} "%1"')
        _set(base + r"\Application", "ApplicationName", f"QT {name}")
        _set(base + r"\Application", "ApplicationIcon", f'"{EXE}",0')
        _set(base + r"\Application", "ApplicationCompany", "QT Suite")
    # "Open with" shows the exe's own name, so give the exe its own entry too
    appkey = rf"{CLASSES}\Applications\QTOpen.exe"
    _set(appkey, "FriendlyAppName", APPNAME)
    _set(appkey + r"\shell\open\command", "", f'"{EXE}" code "%1"')
    _set(CAPS, "ApplicationName", APPNAME)
    _set(CAPS, "ApplicationDescription", "Open pictures, videos, songs, PDFs, notes, code and zips in QT Suite's own viewers.")
    _set(CAPS, "ApplicationIcon", f'"{EXE}",0')
    free = {e for e in ext_map() if _unclaimed(e)}   # look before we add ourselves to the lists
    for ext, app in ext_map().items():
        _set(rf"{CLASSES}\.{ext}\OpenWithProgids", progid(app), "")
        _set(CAPS + r"\FileAssociations", "." + ext, progid(app))
        if ext not in claimed and ext in free and _get(HKCU, rf"{CLASSES}\.{ext}") in (None, ""):
            _set(rf"{CLASSES}\.{ext}", "", progid(app))
            claimed.add(ext)
    _set(r"Software\RegisteredApplications", APPNAME, CAPS)
    st.update(on=True, claimed=sorted(claimed), exe=EXE)
    _save(st)
    _notify()
    return status()


def off():
    st = _load()
    for ext, app in ext_map().items():
        pid = progid(app)
        _del_value(rf"{CLASSES}\.{ext}\OpenWithProgids", pid)
        if _get(HKCU, rf"{CLASSES}\.{ext}") == pid:
            _del_value(rf"{CLASSES}\.{ext}", "")
        for sub in (rf"{CLASSES}\.{ext}\OpenWithProgids", rf"{CLASSES}\.{ext}"):
            if _empty(sub):
                _del_tree(sub)
    for app in APPS:
        _del_tree(rf"{CLASSES}\{progid(app)}")
    _del_tree(rf"{CLASSES}\Applications\QTOpen.exe")
    _del_value(r"Software\RegisteredApplications", APPNAME)
    _del_tree(r"Software\QTSuite")
    st.update(on=False, claimed=[])
    _save(st)
    _notify()
    # Types the person had pointed at QT in Settings now have no handler; Windows asks
    # "How do you want to open this?" next time, and their old app is in that list.
    return status()


def status():
    exts = ext_map()
    registered = _get(HKCU, r"Software\RegisteredApplications", APPNAME) == CAPS
    rows = []
    for ext, app in exts.items():
        pid, name = current(ext)
        rows.append({"ext": ext, "app": app, "ours": pid.lower().startswith("qtsuite."), "now": name})
    by_app = {}
    for r in rows:
        a = by_app.setdefault(r["app"], {"id": r["app"], "name": APPS[r["app"]][0], "total": 0, "ours": 0})
        a["total"] += 1
        a["ours"] += r["ours"]
    ours = sum(r["ours"] for r in rows)
    return {"on": registered, "exe": os.path.exists(EXE), "total": len(rows), "ours": ours,
            "pct": round(100 * ours / len(rows)) if rows else 0, "apps": list(by_app.values()), "types": rows}


def open_settings():
    """Settings > Apps > Default apps, opened on QT Suite's own page."""
    os.startfile("ms-settings:defaultapps?registeredAppUser=" + APPNAME.replace(" ", "%20"))
    return {"ok": True}


if __name__ == "__main__":
    cmd = (sys.argv[1:] or ["status"])[0]
    out = {"on": on, "off": off, "status": status, "settings": open_settings}[cmd]()
    if cmd == "status" or cmd in ("on", "off"):
        out = {k: v for k, v in out.items() if k != "types"} | {
            "types": " ".join(("*" if r["ours"] else "") + r["ext"] for r in out["types"])}
    print(json.dumps(out, indent=1))
