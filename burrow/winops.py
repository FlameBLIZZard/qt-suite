"""Windows-only helpers for Burrow: drives, known folders, Recycle Bin, the real
Windows file clipboard (so Ctrl+C in Burrow pastes in Explorer and back), and
"Open with". Everything degrades to a harmless no-op off Windows."""
import ctypes
import os
import subprocess
import sys

WIN = os.name == "nt"
NOWIN = 0x08000000  # CREATE_NO_WINDOW

if WIN:
    from ctypes import wintypes
    k32 = ctypes.windll.kernel32
    u32 = ctypes.windll.user32
    sh32 = ctypes.windll.shell32
    k32.GlobalAlloc.restype = wintypes.HGLOBAL
    k32.GlobalAlloc.argtypes = [wintypes.UINT, ctypes.c_size_t]
    k32.GlobalLock.restype = ctypes.c_void_p
    k32.GlobalLock.argtypes = [wintypes.HGLOBAL]
    k32.GlobalUnlock.argtypes = [wintypes.HGLOBAL]
    k32.GlobalFree.argtypes = [wintypes.HGLOBAL]
    u32.SetClipboardData.restype = wintypes.HANDLE
    u32.SetClipboardData.argtypes = [wintypes.UINT, wintypes.HANDLE]
    u32.GetClipboardData.restype = wintypes.HANDLE
    u32.GetClipboardData.argtypes = [wintypes.UINT]
    u32.OpenClipboard.argtypes = [wintypes.HWND]
    u32.RegisterClipboardFormatW.restype = wintypes.UINT
    u32.RegisterClipboardFormatW.argtypes = [wintypes.LPCWSTR]
    sh32.DragQueryFileW.restype = wintypes.UINT
    sh32.DragQueryFileW.argtypes = [wintypes.HANDLE, wintypes.UINT, wintypes.LPWSTR, wintypes.UINT]


# ---------------------------------------------------------------- drives ---
DRIVE_KIND = {2: "usb", 3: "disk", 4: "network", 5: "cd", 6: "ram"}


def drives():
    out = []
    if not WIN:
        return [{"path": "/", "label": "Root", "kind": "disk", **_usage("/")}]
    mask = k32.GetLogicalDrives()
    for i in range(26):
        if not mask & (1 << i):
            continue
        root = f"{chr(65 + i)}:\\"
        kind = DRIVE_KIND.get(k32.GetDriveTypeW(root), "disk")
        label = ctypes.create_unicode_buffer(261)
        fs = ctypes.create_unicode_buffer(261)
        old = k32.SetErrorMode(1)  # no "insert a disk" popups
        try:
            ok = k32.GetVolumeInformationW(root, label, 261, None, None, None, fs, 261)
        finally:
            k32.SetErrorMode(old)
        if not ok and kind in ("cd", "usb"):
            continue  # empty card reader / DVD drive
        d = {"path": root, "label": label.value or {"usb": "USB drive", "network": "Network", "cd": "DVD"}.get(kind, "Local Disk"),
             "kind": kind, "fs": fs.value}
        d.update(_usage(root))
        out.append(d)
    return out


def _usage(root):
    try:
        import shutil
        u = shutil.disk_usage(root)
        return {"total": u.total, "free": u.free}
    except OSError:
        return {"total": 0, "free": 0}


def known_folders():
    """Desktop, Downloads... honouring OneDrive / moved folders."""
    home = os.path.expanduser("~")
    names = [("Desktop", "Desktop", "Desktop"), ("Downloads", "{374DE290-123F-4565-9164-39C4925E467B}", "Downloads"),
             ("Documents", "Personal", "Documents"), ("Pictures", "My Pictures", "Pictures"),
             ("Videos", "My Video", "Videos"), ("Music", "My Music", "Music")]
    out = [{"name": "Home", "path": home, "icon": "home"}]
    reg = {}
    if WIN:
        try:
            import winreg
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER,
                                r"Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders") as k:
                for _, val, _ in names:
                    try:
                        reg[val] = os.path.expandvars(winreg.QueryValueEx(k, val)[0])
                    except OSError:
                        pass
        except OSError:
            pass
    for label, val, default in names:
        p = reg.get(val) or os.path.join(home, default)
        if os.path.isdir(p):
            out.append({"name": label, "path": p, "icon": label.lower()})
    return out


# ------------------------------------------------------------ recycle bin ---
class SHFILEOPSTRUCTW(ctypes.Structure):
    _fields_ = [("hwnd", ctypes.c_void_p), ("wFunc", ctypes.c_uint), ("pFrom", ctypes.c_wchar_p),
                ("pTo", ctypes.c_wchar_p), ("fFlags", ctypes.c_ushort), ("fAnyOperationsAborted", ctypes.c_int),
                ("hNameMappings", ctypes.c_void_p), ("lpszProgressTitle", ctypes.c_wchar_p)]


def recycle(paths):
    """Send to the Recycle Bin (recoverable). Returns (ok, message)."""
    paths = [os.path.abspath(p) for p in paths if os.path.exists(p)]
    if not paths:
        return False, "Nothing to remove"
    if not WIN:
        return False, "Recycle Bin is Windows only"
    FO_DELETE, FOF_SILENT, FOF_NOCONFIRMATION, FOF_ALLOWUNDO, FOF_NOERRORUI = 3, 4, 0x10, 0x40, 0x400
    op = SHFILEOPSTRUCTW(wFunc=FO_DELETE, pFrom="\0".join(paths) + "\0\0",
                         fFlags=FOF_SILENT | FOF_NOCONFIRMATION | FOF_ALLOWUNDO | FOF_NOERRORUI)
    rc = sh32.SHFileOperationW(ctypes.byref(op))
    if rc or op.fAnyOperationsAborted:
        return False, f"Windows couldn't recycle that (code {rc}). It may be open in another app."
    left = [p for p in paths if os.path.exists(p)]
    if left:
        return False, f"{len(left)} item(s) are still there. They may be in use."
    return True, "ok"


def _read_i(path):
    """Parse a Recycle Bin $I file -> (original path, deleted unix time) or None."""
    import struct
    try:
        with open(path, "rb") as f:
            b = f.read(4096)
        ver = struct.unpack_from("<q", b, 0)[0]
        ft = struct.unpack_from("<q", b, 16)[0]
        if ver == 2:
            n = struct.unpack_from("<i", b, 24)[0]
            orig = b[28:28 + n * 2].decode("utf-16-le").rstrip("\0")
        else:
            orig = b[24:24 + 520].decode("utf-16-le").split("\0")[0]
        return orig, ft / 1e7 - 11644473600
    except (OSError, ValueError, UnicodeDecodeError, Exception):
        return None


def restore(path, since=0):
    """Put a recycled item back where it was (newest match deleted after `since`).
    Never overwrites: if something new sits at the old path, returns False."""
    if not WIN:
        return False
    path = os.path.abspath(path)
    if os.path.lexists(path):
        return False
    drive = os.path.splitdrive(path)[0] + "\\"
    rb = os.path.join(drive, "$Recycle.Bin")
    best = None
    try:
        sids = [os.path.join(rb, s) for s in os.listdir(rb)]
    except OSError:
        return False
    for sd in sids:
        try:
            names = os.listdir(sd)
        except OSError:
            continue
        for n in names:
            if not n.upper().startswith("$I"):
                continue
            info = _read_i(os.path.join(sd, n))
            if not info or os.path.normcase(info[0]) != os.path.normcase(path) or info[1] < since - 5:
                continue
            r = os.path.join(sd, "$R" + n[2:])
            if os.path.lexists(r) and (best is None or info[1] > best[0]):
                best = (info[1], r, os.path.join(sd, n))
    if not best:
        return False
    os.makedirs(os.path.dirname(path), exist_ok=True)
    os.rename(best[1], path)
    try:
        os.remove(best[2])
    except OSError:
        pass
    return True


# --------------------------------------------------------- file clipboard ---
def _open_clip():
    import time
    for _ in range(20):
        if u32.OpenClipboard(None):
            return True
        time.sleep(0.03)
    return False


def set_clip_files(paths, cut=False):
    """Put files on the Windows clipboard as a real file drop (CF_HDROP)."""
    if not WIN:
        return False
    paths = [os.path.abspath(p) for p in paths]
    data = ("\0".join(paths) + "\0\0").encode("utf-16-le")
    header = 20  # DROPFILES: pFiles, pt.x, pt.y, fNC, fWide
    GMEM_MOVEABLE = 0x2
    h = k32.GlobalAlloc(GMEM_MOVEABLE, header + len(data))
    p = k32.GlobalLock(h)
    ctypes.memset(p, 0, header)
    ctypes.c_uint32.from_address(p).value = header
    ctypes.c_uint32.from_address(p + 16).value = 1  # wide chars
    ctypes.memmove(p + header, data, len(data))
    k32.GlobalUnlock(h)
    eff = k32.GlobalAlloc(GMEM_MOVEABLE, 4)
    pe = k32.GlobalLock(eff)
    ctypes.c_uint32.from_address(pe).value = 2 if cut else 5  # MOVE | COPY+LINK
    k32.GlobalUnlock(eff)
    if not _open_clip():
        k32.GlobalFree(h)
        k32.GlobalFree(eff)
        return False
    try:
        u32.EmptyClipboard()
        u32.SetClipboardData(15, h)  # CF_HDROP
        u32.SetClipboardData(u32.RegisterClipboardFormatW("Preferred DropEffect"), eff)
    finally:
        u32.CloseClipboard()
    return True


def get_clip_files():
    """-> (paths, cut) from the Windows clipboard, or ([], False)."""
    if not WIN or not _open_clip():
        return [], False
    try:
        h = u32.GetClipboardData(15)
        paths = []
        if h:
            n = sh32.DragQueryFileW(h, 0xFFFFFFFF, None, 0)
            for i in range(n):
                ln = sh32.DragQueryFileW(h, i, None, 0)
                buf = ctypes.create_unicode_buffer(ln + 1)
                sh32.DragQueryFileW(h, i, buf, ln + 1)
                paths.append(buf.value)
        cut = False
        he = u32.GetClipboardData(u32.RegisterClipboardFormatW("Preferred DropEffect"))
        if he:
            pe = k32.GlobalLock(he)
            if pe:
                cut = bool(ctypes.c_uint32.from_address(pe).value & 2)
                k32.GlobalUnlock(he)
        return paths, cut
    finally:
        u32.CloseClipboard()


def clip_image():
    """A copied picture (screenshot) as a PIL image, or None."""
    try:
        from PIL import ImageGrab
        im = ImageGrab.grabclipboard()
        return im if im is not None and not isinstance(im, list) else None
    except Exception:
        return None


def set_clip_text(text):
    if not WIN:
        return False
    data = (text + "\0").encode("utf-16-le")
    h = k32.GlobalAlloc(0x2, len(data))
    p = k32.GlobalLock(h)
    ctypes.memmove(p, data, len(data))
    k32.GlobalUnlock(h)
    if not _open_clip():
        k32.GlobalFree(h)
        return False
    try:
        u32.EmptyClipboard()
        u32.SetClipboardData(13, h)  # CF_UNICODETEXT
    finally:
        u32.CloseClipboard()
    return True


# ---------------------------------------------------------------- launch ---
def open_path(path):
    if WIN:
        os.startfile(path)
    else:
        subprocess.Popen(["xdg-open", path])


def open_with(path):
    if WIN:
        subprocess.Popen(["rundll32.exe", "shell32.dll,OpenAs_RunDLL", os.path.normpath(path)])


def reveal(path):
    if WIN:
        if os.path.exists(path) and not path.rstrip("\\").endswith(":"):
            subprocess.Popen(["explorer", "/select,", os.path.normpath(path)])
        else:
            os.startfile(path)


def terminal(folder):
    import shutil
    folder = os.path.normpath(folder)
    wt = shutil.which("wt")
    if wt:
        subprocess.Popen([wt, "-d", folder])
    else:
        subprocess.Popen(["cmd", "/c", "start", "", "powershell", "-NoExit"], cwd=folder)


def properties(path):
    """The real Windows Properties sheet."""
    if not WIN:
        return False

    class SHELLEXECUTEINFOW(ctypes.Structure):
        _fields_ = [("cbSize", ctypes.c_uint32), ("fMask", ctypes.c_ulong), ("hwnd", ctypes.c_void_p),
                    ("lpVerb", ctypes.c_wchar_p), ("lpFile", ctypes.c_wchar_p), ("lpParameters", ctypes.c_wchar_p),
                    ("lpDirectory", ctypes.c_wchar_p), ("nShow", ctypes.c_int), ("hInstApp", ctypes.c_void_p),
                    ("lpIDList", ctypes.c_void_p), ("lpClass", ctypes.c_wchar_p), ("hkeyClass", ctypes.c_void_p),
                    ("dwHotKey", ctypes.c_uint32), ("hIcon", ctypes.c_void_p), ("hProcess", ctypes.c_void_p)]
    sei = SHELLEXECUTEINFOW()
    sei.cbSize = ctypes.sizeof(sei)
    sei.fMask = 0x0000000C  # SEE_MASK_INVOKEIDLIST
    sei.lpVerb = "properties"
    sei.lpFile = os.path.normpath(path)
    sei.nShow = 1
    return bool(sh32.ShellExecuteExW(ctypes.byref(sei)))


def is_hidden(entry_stat):
    attrs = getattr(entry_stat, "st_file_attributes", 0)
    return bool(attrs & 0x2 or attrs & 0x4)  # HIDDEN | SYSTEM


if __name__ == "__main__":
    print(drives())
    print(known_folders())
    print(get_clip_files())
    sys.exit(0)
