"""QT Suite tray icon (Windows notification area).

Runs on its own thread inside the hub (app.py starts it). Pure ctypes, no extra installs.
It only talks to the hub over its own HTTP API, so it never reaches into app.py internals.

  left click            open the Suite window (or bring it to the front)
  right click           Ink Arcade menu: Open, Jump to a tool, Start/stop tools,
                        Start my set, Stop all, Start with Windows, Quit
  a tool crashes        a notification; clicking it opens that tool
  closing the window    the hub (and your tools) keep running here

Hooks in app.py: GET /api/tray/nav (the page's tray.js polls it to switch tools in an open
window) and POST /api/tray/show (a second launch focuses the window instead of opening another).
"""
import ctypes
import json
import os
import threading
import time
import urllib.error
import urllib.request
from ctypes import wintypes as W

HERE = os.path.dirname(os.path.abspath(__file__))
STATE_FILE = os.path.join(os.environ.get("LOCALAPPDATA", HERE), "QT Suite", "tray.json")

# Ink Arcade palette (theme/qt.css)
BG, BG2, CHIP, INK = "#1c1921", "#16141a", "#2c2833", "#000000"
FG, MUTED, DIM, OK, BAD = "#fff8ec", "#b6aea3", "#7d766e", "#5dff9c", "#ff5d6c"
SUITE = "#c6ff3d"
ACCENT = {"beam": "#c6ff3d", "launchpad": "#4dc3ff", "volt": "#ffc93d", "soundboard": "#ff5fa2", "inkmotion": "#b28bff",
          "kharcha": "#5dffb0", "lens": "#ff8a3d", "apks": "#ff8a3d", "pixlab": "#ff6b4a", "burrow": "#2ee6d6",
          "space": "#7d9bff", "daily": "#ff9de2", "ping": "#ff4d5e", "pictures": "#ffd84d", "player": "#ff3dd6",
          "reader": "#e8d9b5", "code": "#a0e8ff", "archive": "#d9a066"}

_nav = {"seq": 0, "id": None}
_lock = threading.Lock()
_app = {}  # port, open_window, hwnd, ...


# ------------------------------------------------------------- hub hooks ---
def nav_state():
    with _lock:
        return dict(_nav)


def _set_nav(tid):
    with _lock:
        _nav["seq"] += 1
        _nav["id"] = tid


def show_suite(tid=None):
    """Bring the Suite window forward (switching to tid), or open one."""
    h = _find_window()
    if h:
        if tid:
            _set_nav(tid)
        if u32.IsIconic(h):
            u32.ShowWindow(h, 9)  # SW_RESTORE
        u32.ShowWindow(h, 5)
        u32.SetForegroundWindow(h)
        return True
    url = f"http://127.0.0.1:{_app.get('port', 7800)}/" + (f"#{tid}" if tid else "")
    opener = _app.get("open_window")
    if opener:
        opener(url)
    return False


def poke(port):
    """Ask a hub that's already running to show its window. False if it didn't answer."""
    try:
        u32.AllowSetForegroundWindow(0xFFFFFFFF)  # ASFW_ANY: let the hub bring its window to the front
    except Exception:
        pass
    try:
        _post(f"http://127.0.0.1:{port}/api/tray/show", {}, port=port, timeout=2)
        return True
    except Exception:
        return False


def remove():
    """Take the icon out of the tray (the hub is quitting)."""
    t = _app.get("tray")
    if t and getattr(t, "hwnd", None):
        t.remove_icon()


def start(port, open_window):
    _app.update(port=port, open_window=open_window)
    threading.Thread(target=_run, name="qt-tray", daemon=True).start()


# ----------------------------------------------------------------- http ---
def _get(path, timeout=3):
    with urllib.request.urlopen(f"http://127.0.0.1:{_app['port']}{path}", timeout=timeout) as r:
        return json.loads(r.read() or b"{}")


def _post(url_or_path, body=None, port=None, timeout=30):
    port = port or _app["port"]
    url = url_or_path if url_or_path.startswith("http") else f"http://127.0.0.1:{port}{url_or_path}"
    data = json.dumps(body or {}).encode()
    req = urllib.request.Request(url, data=data, method="POST", headers={
        "Content-Type": "application/json", "Origin": f"http://127.0.0.1:{port}"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:  # the hub answers failures as JSON with ok/msg
        try:
            return json.loads(e.read() or b"{}")
        except ValueError:
            return {"ok": False, "msg": f"HTTP {e.code}"}


def _tools():
    try:
        return _get("/api/tools")
    except Exception:
        return []


def _running(tools):
    ports, n = set(), 0
    for t in tools:
        if t.get("status") != "on" or t["kind"] not in ("web", "app"):
            continue
        if t["kind"] == "web":
            if t["port"] in ports:
                continue
            ports.add(t["port"])
        n += 1
    return n


# ---------------------------------------------------------------- win32 ---
u32 = ctypes.WinDLL("user32", use_last_error=True)
g32 = ctypes.WinDLL("gdi32")
sh32 = ctypes.WinDLL("shell32")
k32 = ctypes.WinDLL("kernel32")
LRESULT = ctypes.c_ssize_t
WNDPROC = ctypes.WINFUNCTYPE(LRESULT, W.HWND, W.UINT, W.WPARAM, W.LPARAM)

WM_DESTROY, WM_COMMAND, WM_USER, WM_NULL = 0x2, 0x111, 0x400, 0x0
WM_MEASUREITEM, WM_DRAWITEM, WM_TIMER = 0x2C, 0x2B, 0x113
WM_LBUTTONUP, WM_RBUTTONUP, WM_LBUTTONDBLCLK, WM_CONTEXTMENU = 0x202, 0x205, 0x203, 0x7B
WM_TRAY = WM_USER + 20
NIN_BALLOONUSERCLICK = WM_USER + 5
NIM_ADD, NIM_MODIFY, NIM_DELETE = 0, 1, 2
NIF_MESSAGE, NIF_ICON, NIF_TIP, NIF_INFO = 1, 2, 4, 0x10
NIIF_INFO, NIIF_WARNING, NIIF_USER, NIIF_LARGE_ICON = 1, 2, 4, 0x20
MF_STRING, MF_POPUP, MF_SEPARATOR, MF_OWNERDRAW, MF_DISABLED = 0, 0x10, 0x800, 0x100, 0x2
TPM_RIGHTBUTTON, TPM_RETURNCMD, TPM_BOTTOMALIGN, TPM_RIGHTALIGN = 0x2, 0x100, 0x20, 0x8
ODS_SELECTED, ODS_DISABLED = 0x1, 0x4
MIM_BACKGROUND, MIM_APPLYTOSUBMENUS = 0x2, 0x80000000
DT_LEFT, DT_RIGHT, DT_VCENTER, DT_SINGLELINE, DT_CENTER, DT_NOPREFIX, DT_END_ELLIPSIS = 0, 2, 4, 0x20, 1, 0x800, 0x8000
TRANSPARENT = 1


class GUID(ctypes.Structure):
    _fields_ = [("a", ctypes.c_ulong), ("b", ctypes.c_ushort), ("c", ctypes.c_ushort), ("d", ctypes.c_ubyte * 8)]


class NOTIFYICONDATAW(ctypes.Structure):
    _fields_ = [("cbSize", W.DWORD), ("hWnd", W.HWND), ("uID", W.UINT), ("uFlags", W.UINT),
                ("uCallbackMessage", W.UINT), ("hIcon", W.HICON), ("szTip", W.WCHAR * 128),
                ("dwState", W.DWORD), ("dwStateMask", W.DWORD), ("szInfo", W.WCHAR * 256),
                ("uVersion", W.UINT), ("szInfoTitle", W.WCHAR * 64), ("dwInfoFlags", W.DWORD),
                ("guidItem", GUID), ("hBalloonIcon", W.HICON)]


class WNDCLASSW(ctypes.Structure):
    _fields_ = [("style", W.UINT), ("lpfnWndProc", WNDPROC), ("cbClsExtra", ctypes.c_int), ("cbWndExtra", ctypes.c_int),
                ("hInstance", W.HINSTANCE), ("hIcon", W.HICON), ("hCursor", W.HANDLE), ("hbrBackground", W.HBRUSH),
                ("lpszMenuName", W.LPCWSTR), ("lpszClassName", W.LPCWSTR)]


class MEASUREITEMSTRUCT(ctypes.Structure):
    _fields_ = [("CtlType", W.UINT), ("CtlID", W.UINT), ("itemID", W.UINT), ("itemWidth", W.UINT),
                ("itemHeight", W.UINT), ("itemData", ctypes.c_size_t)]


class DRAWITEMSTRUCT(ctypes.Structure):
    _fields_ = [("CtlType", W.UINT), ("CtlID", W.UINT), ("itemID", W.UINT), ("itemAction", W.UINT),
                ("itemState", W.UINT), ("hwndItem", W.HWND), ("hDC", W.HDC), ("rcItem", W.RECT),
                ("itemData", ctypes.c_size_t)]


class MENUINFO(ctypes.Structure):
    _fields_ = [("cbSize", W.DWORD), ("fMask", W.DWORD), ("dwStyle", W.DWORD), ("cyMax", W.UINT),
                ("hbrBack", W.HBRUSH), ("dwContextHelpID", W.DWORD), ("dwMenuData", ctypes.c_size_t)]


class SIZE(ctypes.Structure):
    _fields_ = [("cx", W.LONG), ("cy", W.LONG)]


def _sig(fn, res, *args):
    fn.restype, fn.argtypes = res, list(args)


_sig(u32.DefWindowProcW, LRESULT, W.HWND, W.UINT, W.WPARAM, W.LPARAM)
_sig(u32.CreateWindowExW, W.HWND, W.DWORD, W.LPCWSTR, W.LPCWSTR, W.DWORD, ctypes.c_int, ctypes.c_int, ctypes.c_int,
     ctypes.c_int, W.HWND, W.HMENU, W.HINSTANCE, W.LPVOID)
_sig(u32.RegisterClassW, W.ATOM, ctypes.POINTER(WNDCLASSW))
_sig(u32.LoadImageW, W.HANDLE, W.HINSTANCE, W.LPCWSTR, W.UINT, ctypes.c_int, ctypes.c_int, W.UINT)
_sig(u32.AppendMenuW, W.BOOL, W.HMENU, W.UINT, ctypes.c_size_t, ctypes.c_void_p)
_sig(u32.CreatePopupMenu, W.HMENU)
_sig(u32.DestroyMenu, W.BOOL, W.HMENU)
_sig(u32.SetMenuInfo, W.BOOL, W.HMENU, ctypes.POINTER(MENUINFO))
_sig(u32.TrackPopupMenu, W.BOOL, W.HMENU, W.UINT, ctypes.c_int, ctypes.c_int, ctypes.c_int, W.HWND, W.LPVOID)
_sig(u32.SetForegroundWindow, W.BOOL, W.HWND)
_sig(u32.PostMessageW, W.BOOL, W.HWND, W.UINT, W.WPARAM, W.LPARAM)
_sig(u32.GetCursorPos, W.BOOL, ctypes.POINTER(W.POINT))
_sig(u32.SetTimer, ctypes.c_size_t, W.HWND, ctypes.c_size_t, W.UINT, W.LPVOID)
_sig(u32.FillRect, ctypes.c_int, W.HDC, ctypes.POINTER(W.RECT), W.HBRUSH)
_sig(u32.DrawTextW, ctypes.c_int, W.HDC, W.LPCWSTR, ctypes.c_int, ctypes.POINTER(W.RECT), W.UINT)
_sig(u32.GetDC, W.HDC, W.HWND)
_sig(u32.ReleaseDC, ctypes.c_int, W.HWND, W.HDC)
_sig(u32.IsIconic, W.BOOL, W.HWND)
_sig(u32.ShowWindow, W.BOOL, W.HWND, ctypes.c_int)
_sig(u32.RegisterWindowMessageW, W.UINT, W.LPCWSTR)
_sig(u32.GetMessageW, W.BOOL, ctypes.POINTER(W.MSG), W.HWND, W.UINT, W.UINT)
_sig(u32.TranslateMessage, W.BOOL, ctypes.POINTER(W.MSG))
_sig(u32.DispatchMessageW, LRESULT, ctypes.POINTER(W.MSG))
_sig(u32.IsWindowVisible, W.BOOL, W.HWND)
_sig(u32.GetWindowTextW, ctypes.c_int, W.HWND, W.LPWSTR, ctypes.c_int)
_sig(u32.AllowSetForegroundWindow, W.BOOL, W.DWORD)
_sig(g32.GetTextFaceW, ctypes.c_int, W.HDC, ctypes.c_int, W.LPWSTR)
_sig(g32.CreateSolidBrush, W.HBRUSH, W.COLORREF)
_sig(g32.DeleteObject, W.BOOL, W.HGDIOBJ)
_sig(g32.SelectObject, W.HGDIOBJ, W.HDC, W.HGDIOBJ)
_sig(g32.SetTextColor, W.COLORREF, W.HDC, W.COLORREF)
_sig(g32.SetBkMode, ctypes.c_int, W.HDC, ctypes.c_int)
_sig(g32.ExcludeClipRect, ctypes.c_int, W.HDC, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int)
_sig(g32.CreateFontW, W.HFONT, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, W.DWORD, W.DWORD,
     W.DWORD, W.DWORD, W.DWORD, W.DWORD, W.DWORD, W.DWORD, W.LPCWSTR)
_sig(g32.GetTextExtentPoint32W, W.BOOL, W.HDC, W.LPCWSTR, ctypes.c_int, ctypes.POINTER(SIZE))
_sig(sh32.Shell_NotifyIconW, W.BOOL, W.DWORD, ctypes.POINTER(NOTIFYICONDATAW))
_sig(k32.GetModuleHandleW, W.HMODULE, W.LPCWSTR)


def _find_window():
    """The Suite's own window: a visible top-level window titled 'QT Suite'."""
    found = []
    buf = ctypes.create_unicode_buffer(256)

    @ctypes.WINFUNCTYPE(W.BOOL, W.HWND, W.LPARAM)
    def cb(h, _):
        if u32.IsWindowVisible(h):
            u32.GetWindowTextW(h, buf, 256)
            if buf.value == "QT Suite" or buf.value.startswith("QT Suite - "):
                found.append(h)
                return False
        return True
    u32.EnumWindows(cb, 0)
    return found[0] if found else None


def _rgb(hexs):
    h = hexs.lstrip("#")
    return int(h[0:2], 16) | int(h[2:4], 16) << 8 | int(h[4:6], 16) << 16


class Tray:
    def __init__(self):
        self.items = []      # menu row specs; itemData = index + 1
        self.brushes = {}
        self.fonts = {}
        self.seen = 0        # last activity event id
        self.last_crash = None
        self.tip = "QT Suite"
        self.icon = None
        self.scale = 1.0

    # ---- resources
    def brush(self, c):
        if c not in self.brushes:
            self.brushes[c] = g32.CreateSolidBrush(_rgb(c))
        return self.brushes[c]

    def font(self, kind):
        if kind not in self.fonts:
            s = self.scale
            spec = {"body": (-round(14 * s), 500, "Space Grotesk"), "bold": (-round(14 * s), 700, "Space Grotesk"),
                    "head": (-round(16 * s), 900, "Archivo Black"), "mono": (-round(11 * s), 600, "JetBrains Mono"),
                    "glyph": (-round(12 * s), 700, "Segoe UI Symbol")}[kind]
            f = g32.CreateFontW(spec[0], 0, 0, 0, spec[1], 0, 0, 0, 1, 0, 0, 5, 0, spec[2])  # 5 = CLEARTYPE_QUALITY
            if kind == "head" and not self._face_ok(f, "Archivo Black"):
                f = g32.CreateFontW(spec[0], 0, 0, 0, 900, 0, 0, 0, 1, 0, 0, 5, 0, "Arial Black")
            self.fonts[kind] = f
        return self.fonts[kind]

    def _face_ok(self, f, name):
        dc = u32.GetDC(None)
        old = g32.SelectObject(dc, f)
        buf = ctypes.create_unicode_buffer(64)
        g32.GetTextFaceW(dc, 64, buf)
        g32.SelectObject(dc, old)
        u32.ReleaseDC(None, dc)
        return buf.value.lower() == name.lower()

    def rect(self, dc, l, t, r, b, c):
        u32.FillRect(dc, ctypes.byref(W.RECT(int(l), int(t), int(r), int(b))), self.brush(c))

    def text(self, dc, s, l, t, r, b, color, font, flags=DT_LEFT):
        g32.SelectObject(dc, self.font(font))
        g32.SetTextColor(dc, _rgb(color))
        g32.SetBkMode(dc, TRANSPARENT)
        u32.DrawTextW(dc, s, -1, ctypes.byref(W.RECT(int(l), int(t), int(r), int(b))),
                      flags | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX | DT_END_ELLIPSIS)

    def chip(self, dc, x, y, size, color):
        """A tool's accent square with an ink outline and a hard offset shadow."""
        o = max(2, round(2 * self.scale))
        self.rect(dc, x + o, y + o, x + size + o, y + size + o, INK)
        self.rect(dc, x, y, x + size, y + size, INK)
        self.rect(dc, x + o, y + o, x + size - o, y + size - o, color)

    # ---- tray icon
    def nid(self, flags):
        n = NOTIFYICONDATAW()
        n.cbSize = ctypes.sizeof(NOTIFYICONDATAW)
        n.hWnd, n.uID, n.uFlags = self.hwnd, 1, flags
        n.uCallbackMessage = WM_TRAY
        n.hIcon = self.icon
        n.szTip = self.tip[:127]
        return n

    def add_icon(self):
        n = self.nid(NIF_MESSAGE | NIF_ICON | NIF_TIP)
        sh32.Shell_NotifyIconW(NIM_ADD, ctypes.byref(n))

    def set_tip(self, tip):
        if tip != self.tip:
            self.tip = tip
            n = self.nid(NIF_TIP)
            sh32.Shell_NotifyIconW(NIM_MODIFY, ctypes.byref(n))

    def balloon(self, title, msg, warn=False):
        n = self.nid(NIF_INFO)
        n.szInfoTitle = title[:63]
        n.szInfo = msg[:255]
        n.dwInfoFlags = NIIF_WARNING if warn else (NIIF_USER | NIIF_LARGE_ICON)
        n.hBalloonIcon = self.big_icon
        sh32.Shell_NotifyIconW(NIM_MODIFY, ctypes.byref(n))

    def remove_icon(self):
        n = self.nid(0)
        sh32.Shell_NotifyIconW(NIM_DELETE, ctypes.byref(n))

    # ---- menu
    def build_menu(self):
        tools = _tools()
        try:
            auto = _get("/api/autostart", timeout=2).get("on")
        except Exception:
            auto = None
        self.items = []
        cmds = {}

        def add(menu, spec, cmd=None, sub=None, disabled=False):
            self.items.append(spec)
            data = len(self.items)
            flags = MF_OWNERDRAW | (MF_DISABLED if disabled else 0)
            if spec.get("sep"):
                flags |= MF_SEPARATOR
            if sub:
                u32.AppendMenuW(menu, flags | MF_POPUP, sub, ctypes.c_void_p(data))
                return
            cid = 0
            if cmd:
                cid = 100 + len(cmds)
                cmds[cid] = cmd
            u32.AppendMenuW(menu, flags, cid, ctypes.c_void_p(data))

        n_on = _running(tools)
        root = u32.CreatePopupMenu()
        jump = u32.CreatePopupMenu()
        runm = u32.CreatePopupMenu()
        add(root, {"head": "QT SUITE", "right": f"{n_on} on" if tools else "hub busy"}, disabled=True)
        add(root, {"text": "Open QT Suite", "glyph": "▣", "bold": True, "accent": SUITE}, ("open", None))
        add(root, {"text": "Search", "glyph": "⌕", "accent": SUITE, "right": "Ctrl K"}, ("jump", "search"))
        add(root, {"sep": True})
        for t in tools:
            add(jump, {"text": t["name"], "chip": ACCENT.get(t["id"], SUITE), "tag": t.get("tag", ""),
                       "dot": t.get("status") == "on" and t["kind"] in ("web", "app"), "accent": ACCENT.get(t["id"], SUITE)},
                ("jump", t["id"]))
        add(root, {"text": "Jump to", "glyph": "➜", "sub": True}, sub=jump)
        seen_ports = set()
        for t in tools:
            if t["kind"] not in ("web", "app"):
                continue
            if t["kind"] == "web" and t["port"] in seen_ports:
                continue  # Kharcha and Ping live inside Beam
            if t["kind"] == "web":
                seen_ports.add(t["port"])
            on = t.get("status") == "on"
            act = "stop" if on and t["kind"] == "web" else ("start" if not on else None)
            add(runm, {"text": t["name"], "chip": ACCENT.get(t["id"], SUITE), "state": "on" if on else "off",
                       "hover": act, "accent": BAD if act == "stop" else ACCENT.get(t["id"], SUITE)},
                (act, t["id"]) if act else None, disabled=not act)
        add(root, {"text": "Start / stop", "glyph": "⏻", "sub": True}, sub=runm)
        add(root, {"text": "Start my set", "glyph": "▶", "accent": OK}, ("startset", None))
        add(root, {"text": "Stop all tools", "glyph": "■", "accent": BAD, "right": str(n_on) if n_on else ""},
            ("stopall", None), disabled=not n_on)
        add(root, {"sep": True})
        add(root, {"text": "Settings", "glyph": "⚙", "accent": SUITE}, ("jump", "settings"))
        if auto is not None:
            add(root, {"text": "Start with Windows", "check": bool(auto), "accent": SUITE}, ("autostart", not auto))
        add(root, {"text": "Quit QT Suite", "glyph": "✕", "accent": BAD, "tag": "tools keep running"}, ("quit", None))

        mi = MENUINFO()
        mi.cbSize = ctypes.sizeof(MENUINFO)
        mi.fMask = MIM_BACKGROUND | MIM_APPLYTOSUBMENUS
        mi.hbrBack = self.brush(BG)
        u32.SetMenuInfo(root, ctypes.byref(mi))
        return root, cmds, tools

    def show_menu(self):
        root, cmds, tools = self.build_menu()
        pt = W.POINT()
        u32.GetCursorPos(ctypes.byref(pt))
        u32.SetForegroundWindow(self.hwnd)
        cid = u32.TrackPopupMenu(root, TPM_RIGHTBUTTON | TPM_RETURNCMD | TPM_BOTTOMALIGN | TPM_RIGHTALIGN,
                                 pt.x, pt.y, 0, self.hwnd, None)
        u32.PostMessageW(self.hwnd, WM_NULL, 0, 0)
        u32.DestroyMenu(root)
        if cid in cmds:
            self.run(cmds[cid], tools)

    def measure(self, mis):
        spec = self.items[mis.itemData - 1]
        s = self.scale
        if spec.get("sep"):
            mis.itemWidth, mis.itemHeight = 10, round(9 * s)
            return
        dc = u32.GetDC(self.hwnd)
        size = SIZE()
        label = spec.get("head") or spec.get("text", "")
        g32.SelectObject(dc, self.font("head" if spec.get("head") else ("bold" if spec.get("bold") else "body")))
        g32.GetTextExtentPoint32W(dc, label, len(label), ctypes.byref(size))
        w = size.cx
        extra = spec.get("tag") or spec.get("right") or ""
        if spec.get("state"):
            extra = "start  "
        if extra:
            g32.SelectObject(dc, self.font("mono"))
            g32.GetTextExtentPoint32W(dc, extra, len(extra), ctypes.byref(size))
            w += size.cx + round(18 * s)
        u32.ReleaseDC(self.hwnd, dc)
        mis.itemWidth = int(w + round(64 * s))
        mis.itemHeight = round((40 if spec.get("head") else 32) * s)

    def draw(self, dis):
        spec = self.items[dis.itemData - 1]
        dc, r, s = dis.hDC, dis.rcItem, self.scale
        sel = bool(dis.itemState & ODS_SELECTED) and not (dis.itemState & ODS_DISABLED)
        dead = bool(dis.itemState & ODS_DISABLED) and not spec.get("head")
        self.rect(dc, r.left, r.top, r.right, r.bottom, BG)
        if spec.get("sep"):
            y = (r.top + r.bottom) // 2
            self.rect(dc, r.left + 10 * s, y - 1, r.right - 10 * s, y + 1, CHIP)
            return
        if spec.get("head"):
            self.rect(dc, r.left, r.top, r.right, r.bottom, BG2)
            self.chip(dc, r.left + 12 * s, r.top + 12 * s, round(14 * s), SUITE)
            self.text(dc, spec["head"], r.left + 36 * s, r.top, r.right - 10 * s, r.bottom, FG, "head")
            self.text(dc, spec.get("right", ""), r.left, r.top, r.right - 12 * s, r.bottom, OK if "on" in spec.get("right", "") else DIM, "mono", DT_RIGHT)
            self.rect(dc, r.left, r.bottom - 2, r.right, r.bottom, INK)
            return
        accent = spec.get("accent", SUITE)
        pad, sh = round(5 * s), max(2, round(3 * s))
        if sel:  # the pressed-key look: accent slab with an ink outline and hard shadow
            L, T, R, B = r.left + pad, r.top + 3 * s, r.right - pad - sh, r.bottom - 2 * s - sh
            self.rect(dc, L + sh, T + sh, R + sh, B + sh, INK)
            self.rect(dc, L, T, R, B, INK)
            self.rect(dc, L + 2, T + 2, R - 2, B - 2, accent)
        fg = "#16141a" if sel else (DIM if dead else FG)
        sub_fg = "#16141a" if sel else DIM
        x = r.left + 14 * s
        midy = (r.top + r.bottom - (sh if sel else 0)) // 2
        if spec.get("chip"):
            cs = round(12 * s)
            self.chip(dc, x, midy - cs // 2 - 1, cs, spec["chip"])
        elif spec.get("check") is not None:
            cs = round(13 * s)
            self.rect(dc, x, midy - cs // 2, x + cs, midy + cs - cs // 2, "#16141a" if sel else MUTED)
            self.rect(dc, x + 2, midy - cs // 2 + 2, x + cs - 2, midy + cs - cs // 2 - 2,
                      ("#16141a" if sel else SUITE) if spec["check"] else (accent if sel else BG))
        elif spec.get("glyph"):
            self.text(dc, spec["glyph"], x - 2 * s, r.top, x + 18 * s, r.bottom - (sh if sel else 0),
                      fg if sel else spec.get("accent", MUTED), "glyph", DT_CENTER)
        tx = x + 26 * s
        bottom = r.bottom - (sh if sel else 0)
        self.text(dc, spec["text"], tx, r.top, r.right - 12 * s, bottom, fg, "bold" if spec.get("bold") else "body")
        right_edge = r.right - (30 if spec.get("sub") else 14) * s
        if spec.get("state"):
            on = spec["state"] == "on"
            if sel and spec.get("hover"):
                word, col = spec["hover"], "#16141a"
            else:
                word, col = ("on" if on else "off"), (OK if on else DIM)
            self.text(dc, word, r.left, r.top, right_edge, bottom, col, "mono", DT_RIGHT)
            if spec.get("tag"):
                self.text(dc, spec["tag"], tx, r.top, right_edge - 34 * s, bottom, sub_fg, "mono", DT_RIGHT)
        elif spec.get("tag") or spec.get("right"):
            self.text(dc, spec.get("right") or spec["tag"], r.left, r.top, right_edge, bottom,
                      sub_fg if not spec.get("right") else ("#16141a" if sel else MUTED), "mono", DT_RIGHT)
        if spec.get("dot"):
            d = round(6 * s)
            self.rect(dc, r.left + 6 * s, midy - d // 2, r.left + 6 * s + d // 2 + 1, midy + d // 2, OK)
        if spec.get("sub"):
            self.text(dc, "›", r.right - 26 * s, r.top, r.right - 10 * s, bottom, fg, "head", DT_CENTER)
            g32.ExcludeClipRect(dc, r.left, r.top, r.right, r.bottom)  # keep Windows from drawing its black arrow

    # ---- actions
    def run(self, cmd, tools):
        what, arg = cmd
        if what == "open":
            show_suite()
        elif what == "jump":
            show_suite(arg)
        elif what == "quit":
            self.remove_icon()
            try:
                _post("/api/quit", timeout=3)
            except Exception:
                pass
            os._exit(0)
        else:
            threading.Thread(target=self._work, args=(what, arg, tools), daemon=True).start()

    def _work(self, what, arg, tools):
        names = {t["id"]: t["name"] for t in tools}
        try:
            if what in ("start", "stop"):
                r = _post(f"/api/{what}/{arg}", timeout=40)
                if not r.get("ok", True) and not str(r.get("msg", "")).startswith("SUCCESS"):
                    self.balloon(f"{names.get(arg, arg)} didn't {what}", r.get("msg", "") or "Open the Suite for details.", warn=True)
            elif what == "startset":
                res = _post("/api/startall", {}, timeout=90).get("results", {})
                bad = [f"{names.get(k, k)}: {v.get('msg', '')}" for k, v in res.items() if not v.get("ok")]
                if bad:
                    self.balloon("Some tools didn't start", "; ".join(bad), warn=True)
            elif what == "stopall":
                ports, bad = set(), []
                for t in tools:
                    if t["kind"] == "web" and t.get("status") == "on" and t["port"] not in ports:
                        ports.add(t["port"])
                        try:
                            _post(f"/api/stop/{t['id']}", timeout=20)
                        except Exception as e:
                            bad.append(f"{t['name']}: {e}")
                if bad:
                    self.balloon("Some tools didn't stop", "; ".join(bad), warn=True)
            elif what == "autostart":
                _post(f"/api/autostart/{'on' if arg else 'off'}", timeout=25)
        except Exception as e:
            self.balloon("QT Suite", f"That didn't work: {e}", warn=True)
        self.refresh()

    # ---- background: tooltip + crash notices
    def refresh(self):
        tools = _tools()
        n = _running(tools)
        self.set_tip(f"QT Suite · {n} tool{'s' if n != 1 else ''} running" if tools else "QT Suite")

    def watch(self):
        try:
            self.seen = _get("/api/activity?since=999999999").get("last", 0)
        except Exception:
            pass
        while True:
            time.sleep(4)
            try:
                d = _get(f"/api/activity?since={self.seen}")
                self.seen = d.get("last", self.seen)
                crashes = [e for e in d.get("events", []) if e.get("kind") == "crash"]
                if crashes:
                    e = crashes[-1]
                    self.last_crash = e.get("tool")
                    more = f" (and {len(crashes) - 1} more)" if len(crashes) > 1 else ""
                    self.balloon(f"{e.get('name', 'A tool')} stopped on its own{more}", "Click to open it in QT Suite.", warn=True)
                self.refresh()
            except Exception:
                pass

    def first_run(self):
        try:
            with open(STATE_FILE, encoding="utf-8") as f:
                st = json.load(f)
        except Exception:
            st = {}
        if st.get("welcomed"):
            return
        self.balloon("QT Suite lives down here now", "Closing the window keeps your tools running. "
                     "Click to open, right-click for tools.")
        st["welcomed"] = True
        try:
            os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
            with open(STATE_FILE, "w", encoding="utf-8") as f:
                json.dump(st, f)
        except Exception:
            pass

    # ---- window
    def wndproc(self, hwnd, msg, wp, lp):
        try:
            if msg == WM_TRAY:
                ev = lp & 0xFFFF
                if ev in (WM_LBUTTONUP, WM_LBUTTONDBLCLK):
                    show_suite()
                elif ev in (WM_RBUTTONUP, WM_CONTEXTMENU):
                    self.show_menu()
                elif ev == NIN_BALLOONUSERCLICK:
                    show_suite(self.last_crash)
                    self.last_crash = None
                return 0
            if msg == WM_MEASUREITEM:
                self.measure(ctypes.cast(lp, ctypes.POINTER(MEASUREITEMSTRUCT)).contents)
                return 1
            if msg == WM_DRAWITEM:
                self.draw(ctypes.cast(lp, ctypes.POINTER(DRAWITEMSTRUCT)).contents)
                return 1
            if msg == self.taskbar_created:  # Explorer restarted: put the icon back
                self.add_icon()
                return 0
        except Exception:
            pass
        return u32.DefWindowProcW(hwnd, msg, wp, lp)

    def loop(self):
        try:  # crisp menu on high-DPI screens (this thread only)
            u32.SetThreadDpiAwarenessContext(ctypes.c_void_p(-4))
            self.scale = u32.GetDpiForSystem() / 96
        except Exception:
            self.scale = 1.0
        hinst = k32.GetModuleHandleW(None)
        self._proc = WNDPROC(self.wndproc)
        wc = WNDCLASSW()
        wc.lpfnWndProc = self._proc
        wc.hInstance = hinst
        wc.lpszClassName = "QTSuiteTray"
        u32.RegisterClassW(ctypes.byref(wc))
        self.hwnd = u32.CreateWindowExW(0x80, "QTSuiteTray", "QT Suite tray", 0x80000000, 0, 0, 0, 0, None, None, hinst, None)
        self.taskbar_created = u32.RegisterWindowMessageW("TaskbarCreated")
        ico = os.path.join(HERE, "suite.ico")
        sm = round(16 * self.scale)
        self.icon = u32.LoadImageW(None, ico, 1, sm, sm, 0x10)  # IMAGE_ICON, LR_LOADFROMFILE
        self.big_icon = u32.LoadImageW(None, ico, 1, round(32 * self.scale), round(32 * self.scale), 0x10)
        self.add_icon()
        self.refresh()
        threading.Thread(target=self.watch, name="qt-tray-watch", daemon=True).start()
        threading.Timer(1.5, self.first_run).start()
        msg = W.MSG()
        while u32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
            u32.TranslateMessage(ctypes.byref(msg))
            u32.DispatchMessageW(ctypes.byref(msg))


def _run():
    t = Tray()
    _app["tray"] = t
    import atexit
    atexit.register(lambda: t.remove_icon() if getattr(t, "hwnd", None) else None)
    t.loop()
