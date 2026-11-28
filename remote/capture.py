"""Screen capture for QT Remote: GDI BitBlt into a DIB (ctypes only), cursor drawn in,
then a tile diff so only the parts of the screen that changed are sent as JPEG.

Windows only. Pillow + numpy do the image work (both ship with the Suite)."""
import ctypes
import io
import threading
from ctypes import wintypes as W

import numpy as np
from PIL import Image

user32 = ctypes.WinDLL("user32", use_last_error=True)
gdi32 = ctypes.WinDLL("gdi32", use_last_error=True)

SRCCOPY = 0x00CC0020
DI_NORMAL = 0x0003
CURSOR_SHOWING = 0x1


def dpi_aware():
    """Physical pixels everywhere, so capture and mouse coordinates agree on scaled displays."""
    try:
        if user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4)):  # per-monitor v2
            return
    except Exception:
        pass
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
    except Exception:
        try:
            user32.SetProcessDPIAware()
        except Exception:
            pass


class BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [("biSize", W.DWORD), ("biWidth", W.LONG), ("biHeight", W.LONG), ("biPlanes", W.WORD),
                ("biBitCount", W.WORD), ("biCompression", W.DWORD), ("biSizeImage", W.DWORD),
                ("biXPelsPerMeter", W.LONG), ("biYPelsPerMeter", W.LONG), ("biClrUsed", W.DWORD),
                ("biClrImportant", W.DWORD)]


class BITMAPINFO(ctypes.Structure):
    _fields_ = [("bmiHeader", BITMAPINFOHEADER), ("bmiColors", W.DWORD * 3)]


class CURSORINFO(ctypes.Structure):
    _fields_ = [("cbSize", W.DWORD), ("flags", W.DWORD), ("hCursor", W.HANDLE), ("ptScreenPos", W.POINT)]


class ICONINFO(ctypes.Structure):
    _fields_ = [("fIcon", W.BOOL), ("xHotspot", W.DWORD), ("yHotspot", W.DWORD),
                ("hbmMask", W.HBITMAP), ("hbmColor", W.HBITMAP)]


class MONITORINFOEXW(ctypes.Structure):
    _fields_ = [("cbSize", W.DWORD), ("rcMonitor", W.RECT), ("rcWork", W.RECT), ("dwFlags", W.DWORD),
                ("szDevice", W.WCHAR * 32)]


user32.GetDC.restype = W.HDC
user32.GetDC.argtypes = [W.HWND]
user32.ReleaseDC.argtypes = [W.HWND, W.HDC]
user32.GetCursorInfo.argtypes = [ctypes.POINTER(CURSORINFO)]
user32.GetIconInfo.argtypes = [W.HANDLE, ctypes.POINTER(ICONINFO)]
user32.DrawIconEx.argtypes = [W.HDC, ctypes.c_int, ctypes.c_int, W.HANDLE, ctypes.c_int, ctypes.c_int,
                              W.UINT, W.HANDLE, W.UINT]
user32.GetMonitorInfoW.argtypes = [W.HMONITOR, ctypes.POINTER(MONITORINFOEXW)]
user32.OpenInputDesktop.restype = W.HANDLE
user32.OpenInputDesktop.argtypes = [W.DWORD, W.BOOL, W.DWORD]
user32.GetUserObjectInformationW.argtypes = [W.HANDLE, ctypes.c_int, ctypes.c_void_p, W.DWORD,
                                             ctypes.POINTER(W.DWORD)]
user32.CloseDesktop.argtypes = [W.HANDLE]
gdi32.CreateCompatibleDC.restype = W.HDC
gdi32.CreateCompatibleDC.argtypes = [W.HDC]
gdi32.CreateDIBSection.restype = W.HBITMAP
gdi32.CreateDIBSection.argtypes = [W.HDC, ctypes.POINTER(BITMAPINFO), W.UINT, ctypes.POINTER(ctypes.c_void_p),
                                   W.HANDLE, W.DWORD]
gdi32.SelectObject.restype = W.HGDIOBJ
gdi32.SelectObject.argtypes = [W.HDC, W.HGDIOBJ]
gdi32.BitBlt.argtypes = [W.HDC, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, W.HDC,
                         ctypes.c_int, ctypes.c_int, W.DWORD]
gdi32.DeleteObject.argtypes = [W.HGDIOBJ]
gdi32.DeleteDC.argtypes = [W.HDC]

MONENUMPROC = ctypes.WINFUNCTYPE(W.BOOL, W.HMONITOR, W.HDC, ctypes.POINTER(W.RECT), W.LPARAM)


def monitors():
    """[{i, x, y, w, h, primary, name}] in physical pixels, primary first."""
    out = []

    def cb(hmon, _hdc, _rect, _lp):
        mi = MONITORINFOEXW()
        mi.cbSize = ctypes.sizeof(MONITORINFOEXW)
        if user32.GetMonitorInfoW(hmon, ctypes.byref(mi)):
            r = mi.rcMonitor
            out.append({"x": r.left, "y": r.top, "w": r.right - r.left, "h": r.bottom - r.top,
                        "primary": bool(mi.dwFlags & 1), "name": mi.szDevice.replace("\\\\.\\", "")})
        return True
    user32.EnumDisplayMonitors(None, None, MONENUMPROC(cb), 0)
    out.sort(key=lambda m: (not m["primary"], m["x"], m["y"]))
    for i, m in enumerate(out):
        m["i"] = i
    return out


def virtual_screen():
    return (user32.GetSystemMetrics(76), user32.GetSystemMetrics(77),
            user32.GetSystemMetrics(78), user32.GetSystemMetrics(79))  # SM_X/Y/CX/CYVIRTUALSCREEN


def input_desktop():
    """'Default' normally; 'Winlogon' on the lock screen, sign-in or a UAC prompt (those can't be captured)."""
    h = user32.OpenInputDesktop(0, False, 0x0001)  # DESKTOP_READOBJECTS
    if not h:
        return "Winlogon"
    try:
        buf = ctypes.create_unicode_buffer(64)
        n = W.DWORD()
        if user32.GetUserObjectInformationW(h, 2, buf, ctypes.sizeof(buf), ctypes.byref(n)):  # UOI_NAME
            return buf.value
        return "Default"
    finally:
        user32.CloseDesktop(h)


_hot = {}  # cursor handle -> hotspot (GetIconInfo makes bitmaps, so ask once per cursor)
_hot_lock = threading.Lock()


def _hotspot(hcur):
    with _hot_lock:
        if hcur in _hot:
            return _hot[hcur]
        ii = ICONINFO()
        hs = (0, 0)
        if user32.GetIconInfo(hcur, ctypes.byref(ii)):
            hs = (ii.xHotspot, ii.yHotspot)
            for b in (ii.hbmMask, ii.hbmColor):
                if b:
                    gdi32.DeleteObject(b)
        if len(_hot) > 64:
            _hot.clear()
        _hot[hcur] = hs
        return hs


class Grabber:
    """One per session: owns a memory DC + DIB the size of the area being captured."""

    def __init__(self):
        self.mdc = None
        self.bmp = None
        self.bits = ctypes.c_void_p()
        self.size = (0, 0)

    def _alloc(self, w, h):
        self.close()
        sdc = user32.GetDC(None)
        self.mdc = gdi32.CreateCompatibleDC(sdc)
        user32.ReleaseDC(None, sdc)
        bi = BITMAPINFO()
        bi.bmiHeader.biSize = ctypes.sizeof(BITMAPINFOHEADER)
        bi.bmiHeader.biWidth, bi.bmiHeader.biHeight = w, -h  # top-down rows
        bi.bmiHeader.biPlanes, bi.bmiHeader.biBitCount = 1, 32
        self.bmp = gdi32.CreateDIBSection(self.mdc, ctypes.byref(bi), 0, ctypes.byref(self.bits), None, 0)
        if not self.bmp:
            raise OSError("CreateDIBSection failed")
        gdi32.SelectObject(self.mdc, self.bmp)
        self.size = (w, h)

    def grab(self, x, y, w, h, cursor=True):
        """BGRA bytes of the screen area, or None when the desktop can't be read."""
        if (w, h) != self.size:
            self._alloc(w, h)
        sdc = user32.GetDC(None)
        if not sdc:
            return None
        try:
            ok = gdi32.BitBlt(self.mdc, 0, 0, w, h, sdc, x, y, SRCCOPY)
        finally:
            user32.ReleaseDC(None, sdc)
        if not ok:
            return None
        if cursor:
            ci = CURSORINFO()
            ci.cbSize = ctypes.sizeof(CURSORINFO)
            if user32.GetCursorInfo(ctypes.byref(ci)) and ci.flags & CURSOR_SHOWING and ci.hCursor:
                hx, hy = _hotspot(ci.hCursor)
                user32.DrawIconEx(self.mdc, ci.ptScreenPos.x - x - hx, ci.ptScreenPos.y - y - hy,
                                  ci.hCursor, 0, 0, 0, None, DI_NORMAL)
        return ctypes.string_at(self.bits, w * h * 4)

    def close(self):
        if self.bmp:
            gdi32.DeleteObject(self.bmp)
        if self.mdc:
            gdi32.DeleteDC(self.mdc)
        self.mdc = self.bmp = None
        self.size = (0, 0)


TILE = 64
QUALITY = {"speed": (45, 2), "balanced": (68, 2), "sharp": (85, 0)}  # (JPEG quality, chroma subsampling)


def make_frame(bgra, w, h, out_w, out_h):
    """(compare array, PIL RGB image). Full size compares 32-bit pixels; scaled compares RGB."""
    im = Image.frombuffer("RGB", (w, h), bgra, "raw", "BGRX", 0, 1)
    if (out_w, out_h) != (w, h):
        im = im.resize((out_w, out_h), Image.BILINEAR)
        return np.asarray(im), im
    return np.frombuffer(bgra, np.uint32).reshape(h, w), im


def changed_rects(prev, cur, tile=TILE):
    """Rectangles (x, y, w, h) covering every tile that differs. None prev = whole frame."""
    h, w = cur.shape[:2]
    if prev is None or prev.shape != cur.shape:
        return [(0, 0, w, h)]
    diff = prev != cur
    if diff.ndim == 3:
        diff = diff.any(axis=2)
    th, tw = -(-h // tile), -(-w // tile)
    pad = np.zeros((th * tile, tw * tile), bool)
    pad[:h, :w] = diff
    grid = pad.reshape(th, tile, tw, tile).any(axis=(1, 3))
    n = int(grid.sum())
    if not n:
        return []
    if n > 0.6 * th * tw:
        return [(0, 0, w, h)]
    rects, open_runs = [], {}
    for ty in range(th):
        row = grid[ty]
        runs, tx = [], 0
        while tx < tw:
            if row[tx]:
                s = tx
                while tx < tw and row[tx]:
                    tx += 1
                runs.append((s, tx))
            else:
                tx += 1
        nxt = {}
        for r in runs:
            if r in open_runs:  # same span as the row above: grow it down
                nxt[r] = open_runs.pop(r)
                nxt[r][3] += 1
            else:
                nxt[r] = [r[0], ty, r[1] - r[0], 1]
        rects.extend(open_runs.values())
        open_runs = nxt
    rects.extend(open_runs.values())
    out = []
    for tx, ty, tws, ths in rects:
        x, y = tx * tile, ty * tile
        out.append((x, y, min(tws * tile, w - x), min(ths * tile, h - y)))
    return out


def encode(im, rect, quality="balanced"):
    q, sub = QUALITY.get(quality, QUALITY["balanced"])
    x, y, w, h = rect
    buf = io.BytesIO()
    part = im if (x, y, w, h) == (0, 0) + im.size else im.crop((x, y, x + w, y + h))
    part.save(buf, "JPEG", quality=q, subsampling=sub)
    return buf.getvalue()
