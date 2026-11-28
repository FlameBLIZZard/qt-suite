"""Mouse, keyboard and clipboard for QT Remote (ctypes SendInput, no installs).

Keys arrive as browser KeyboardEvent.code names and go out as hardware scan codes, so the
PC's own keyboard layout decides the character, exactly like a real keyboard."""
import ctypes
import threading
import time
from ctypes import wintypes as W

user32 = ctypes.WinDLL("user32", use_last_error=True)
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)


class KEYBDINPUT(ctypes.Structure):
    _fields_ = [("wVk", W.WORD), ("wScan", W.WORD), ("dwFlags", W.DWORD), ("time", W.DWORD),
                ("dwExtraInfo", ctypes.c_size_t)]


class MOUSEINPUT(ctypes.Structure):
    _fields_ = [("dx", W.LONG), ("dy", W.LONG), ("mouseData", W.DWORD), ("dwFlags", W.DWORD),
                ("time", W.DWORD), ("dwExtraInfo", ctypes.c_size_t)]


class _U(ctypes.Union):
    _fields_ = [("ki", KEYBDINPUT), ("mi", MOUSEINPUT), ("pad", ctypes.c_byte * 32)]


class INPUT(ctypes.Structure):
    _fields_ = [("type", W.DWORD), ("u", _U)]


user32.SendInput.argtypes = [W.UINT, ctypes.POINTER(INPUT), ctypes.c_int]
user32.GetCursorPos.argtypes = [ctypes.POINTER(W.POINT)]

MOVE, ABSOLUTE, VIRTUALDESK = 0x0001, 0x8000, 0x4000
BTN = {0: (0x0002, 0x0004, 0), 1: (0x0020, 0x0040, 0), 2: (0x0008, 0x0010, 0),
       3: (0x0080, 0x0100, 1), 4: (0x0080, 0x0100, 2)}  # browser button numbers -> (down, up, xbutton)
WHEEL, HWHEEL = 0x0800, 0x1000
K_EXT, K_UP, K_UNICODE, K_SCAN = 0x1, 0x2, 0x4, 0x8

# KeyboardEvent.code -> scan code (set 1). 0xE0xx = extended. ("vk", n) = send as a virtual key.
SCAN = {"Escape": 0x01, "Minus": 0x0C, "Equal": 0x0D, "Backspace": 0x0E, "Tab": 0x0F,
        "BracketLeft": 0x1A, "BracketRight": 0x1B, "Enter": 0x1C, "ControlLeft": 0x1D,
        "Semicolon": 0x27, "Quote": 0x28, "Backquote": 0x29, "ShiftLeft": 0x2A, "Backslash": 0x2B,
        "Comma": 0x33, "Period": 0x34, "Slash": 0x35, "ShiftRight": 0x36, "NumpadMultiply": 0x37,
        "AltLeft": 0x38, "Space": 0x39, "CapsLock": 0x3A, "ScrollLock": 0x46,
        "Numpad7": 0x47, "Numpad8": 0x48, "Numpad9": 0x49, "NumpadSubtract": 0x4A, "Numpad4": 0x4B,
        "Numpad5": 0x4C, "Numpad6": 0x4D, "NumpadAdd": 0x4E, "Numpad1": 0x4F, "Numpad2": 0x50,
        "Numpad3": 0x51, "Numpad0": 0x52, "NumpadDecimal": 0x53, "IntlBackslash": 0x56,
        "F11": 0x57, "F12": 0x58,
        "NumpadEnter": 0xE01C, "ControlRight": 0xE01D, "NumpadDivide": 0xE035, "PrintScreen": 0xE037,
        "AltRight": 0xE038, "Home": 0xE047, "ArrowUp": 0xE048, "PageUp": 0xE049, "ArrowLeft": 0xE04B,
        "ArrowRight": 0xE04D, "End": 0xE04F, "ArrowDown": 0xE050, "PageDown": 0xE051, "Insert": 0xE052,
        "Delete": 0xE053, "MetaLeft": 0xE05B, "MetaRight": 0xE05C, "ContextMenu": 0xE05D,
        "AudioVolumeMute": 0xE020, "AudioVolumeDown": 0xE02E, "AudioVolumeUp": 0xE030,
        "MediaPlayPause": 0xE022, "MediaTrackNext": 0xE019, "MediaTrackPrevious": 0xE010, "MediaStop": 0xE024,
        "Pause": ("vk", 0x13), "NumLock": ("vk", 0x90)}
for _i, _c in enumerate("1234567890"):
    SCAN["Digit" + _c] = 0x02 + _i
for _row, _start in (("QWERTYUIOP", 0x10), ("ASDFGHJKL", 0x1E), ("ZXCVBNM", 0x2C)):
    for _i, _c in enumerate(_row):
        SCAN["Key" + _c] = _start + _i
for _i in range(10):
    SCAN[f"F{_i + 1}"] = 0x3B + _i


def _send(*items):
    arr = (INPUT * len(items))(*items)
    return user32.SendInput(len(items), arr, ctypes.sizeof(INPUT))


def _mouse(flags, dx=0, dy=0, data=0):
    i = INPUT(type=0)
    i.u.mi = MOUSEINPUT(dx, dy, data & 0xFFFFFFFF, flags, 0, 0)
    return i


def _key(code, up):
    s = SCAN.get(code)
    if s is None:
        return None
    i = INPUT(type=1)
    if isinstance(s, tuple):
        i.u.ki = KEYBDINPUT(s[1], 0, K_UP if up else 0, 0, 0)
    else:
        flags = K_SCAN | (K_EXT if s > 0xFF else 0) | (K_UP if up else 0)
        i.u.ki = KEYBDINPUT(0, s & 0xFF, flags, 0, 0)
    return i


class Input:
    """One per session. Remembers what is held down so a dropped connection never leaves Ctrl stuck."""

    def __init__(self):
        self.keys = set()
        self.buttons = set()
        self.lock = threading.Lock()

    def move_abs(self, x, y):
        vx, vy = user32.GetSystemMetrics(76), user32.GetSystemMetrics(77)
        vw, vh = max(2, user32.GetSystemMetrics(78)), max(2, user32.GetSystemMetrics(79))
        nx = round((x - vx) * 65535 / (vw - 1))
        ny = round((y - vy) * 65535 / (vh - 1))
        _send(_mouse(MOVE | ABSOLUTE | VIRTUALDESK, max(0, min(65535, nx)), max(0, min(65535, ny))))

    def move_rel(self, dx, dy):
        p = W.POINT()
        user32.GetCursorPos(ctypes.byref(p))
        self.move_abs(p.x + int(dx), p.y + int(dy))

    def button(self, b, down):
        if b not in BTN:
            return
        dn, up, xb = BTN[b]
        with self.lock:
            (self.buttons.add if down else self.buttons.discard)(b)
        _send(_mouse(dn if down else up, data=xb))

    def wheel(self, dy, dx=0):
        out = []
        if dy:
            out.append(_mouse(WHEEL, data=int(-dy)))
        if dx:
            out.append(_mouse(HWHEEL, data=int(dx)))
        if out:
            _send(*out)

    def key(self, code, down):
        i = _key(code, not down)
        if i is None:
            return False
        with self.lock:
            (self.keys.add if down else self.keys.discard)(code)
        _send(i)
        return True

    def combo(self, codes):
        """Press a list of keys in order and release them in reverse (Win+R, Alt+Tab, ...)."""
        codes = [c for c in codes if c in SCAN][:5]
        for c in codes:
            _send(_key(c, False))
        for c in reversed(codes):
            _send(_key(c, True))

    def text(self, s):
        """Typed characters (phone keyboards, emoji). Each UTF-16 unit as a unicode key press."""
        for ch in s[:2000]:
            if ch == "\n":
                self.combo(["Enter"])
                continue
            data = ch.encode("utf-16-le")
            for n in range(0, len(data), 2):
                unit = int.from_bytes(data[n:n + 2], "little")
                a, b = INPUT(type=1), INPUT(type=1)
                a.u.ki = KEYBDINPUT(0, unit, K_UNICODE, 0, 0)
                b.u.ki = KEYBDINPUT(0, unit, K_UNICODE | K_UP, 0, 0)
                _send(a, b)

    def release_all(self):
        with self.lock:
            keys, buttons = list(self.keys), list(self.buttons)
            self.keys.clear()
            self.buttons.clear()
        for c in keys:
            i = _key(c, True)
            if i:
                _send(i)
        for b in buttons:
            _send(_mouse(BTN[b][1], data=BTN[b][2]))


# ---------------------------------------------------------------- clipboard (text only)
CF_UNICODETEXT = 13
user32.OpenClipboard.argtypes = [W.HWND]
user32.GetClipboardData.restype = W.HANDLE
user32.GetClipboardData.argtypes = [W.UINT]
user32.SetClipboardData.restype = W.HANDLE
user32.SetClipboardData.argtypes = [W.UINT, W.HANDLE]
user32.IsClipboardFormatAvailable.argtypes = [W.UINT]
user32.GetClipboardSequenceNumber.restype = W.DWORD
user32.RegisterClipboardFormatW.restype = W.UINT
user32.RegisterClipboardFormatW.argtypes = [W.LPCWSTR]
kernel32.GlobalLock.restype = ctypes.c_void_p
kernel32.GlobalLock.argtypes = [W.HGLOBAL]
kernel32.GlobalUnlock.argtypes = [W.HGLOBAL]
kernel32.GlobalAlloc.restype = W.HGLOBAL
kernel32.GlobalAlloc.argtypes = [W.UINT, ctypes.c_size_t]
# Password managers mark secrets with these formats; Remote never sends those across.
_PRIVATE = [f for f in (user32.RegisterClipboardFormatW(n) for n in (
    "ExcludeClipboardContentFromMonitorProcessing", "Clipboard Viewer Ignore")) if f]
_NOHISTORY = user32.RegisterClipboardFormatW("CanIncludeInClipboardHistory")
_clip_lock = threading.Lock()


def _open():
    for _ in range(25):
        if user32.OpenClipboard(None):
            return True
        time.sleep(0.02)
    return False


def clip_seq():
    return user32.GetClipboardSequenceNumber()


def get_clip():
    """Text on the clipboard, '' if none, None if it is marked private (passwords)."""
    with _clip_lock:
        if not _open():
            return ""
        try:
            if any(user32.IsClipboardFormatAvailable(f) for f in _PRIVATE):
                return None
            if _NOHISTORY and user32.IsClipboardFormatAvailable(_NOHISTORY):
                h = user32.GetClipboardData(_NOHISTORY)
                p = kernel32.GlobalLock(h) if h else None
                try:
                    if p and ctypes.c_uint32.from_address(p).value == 0:
                        return None
                finally:
                    if p:
                        kernel32.GlobalUnlock(h)
            if not user32.IsClipboardFormatAvailable(CF_UNICODETEXT):
                return ""
            h = user32.GetClipboardData(CF_UNICODETEXT)
            if not h:
                return ""
            p = kernel32.GlobalLock(h)
            try:
                return ctypes.wstring_at(p) if p else ""
            finally:
                kernel32.GlobalUnlock(h)
        finally:
            user32.CloseClipboard()


def set_clip(text):
    data = (text + "\0").encode("utf-16-le")
    h = kernel32.GlobalAlloc(0x0002, len(data))
    p = kernel32.GlobalLock(h)
    ctypes.memmove(p, data, len(data))
    kernel32.GlobalUnlock(h)
    with _clip_lock:
        if not _open():
            raise OSError("clipboard busy")
        try:
            user32.EmptyClipboard()
            user32.SetClipboardData(CF_UNICODETEXT, h)
        finally:
            user32.CloseClipboard()
