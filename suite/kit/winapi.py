"""Windows plumbing for the Toolkit (pure ctypes): keys, global hotkeys, windows, clipboard, sound out."""
import ctypes
import threading
import time
from ctypes import wintypes as W

u32 = ctypes.WinDLL("user32", use_last_error=True)
k32 = ctypes.WinDLL("kernel32", use_last_error=True)

# ---------------------------------------------------------------------------- keys ---
ULONG_PTR = ctypes.c_size_t


class KEYBDINPUT(ctypes.Structure):
    _fields_ = [("wVk", W.WORD), ("wScan", W.WORD), ("dwFlags", W.DWORD), ("time", W.DWORD), ("dwExtraInfo", ULONG_PTR)]


class MOUSEINPUT(ctypes.Structure):
    _fields_ = [("dx", W.LONG), ("dy", W.LONG), ("mouseData", W.DWORD), ("dwFlags", W.DWORD), ("time", W.DWORD), ("dwExtraInfo", ULONG_PTR)]


class _U(ctypes.Union):
    _fields_ = [("ki", KEYBDINPUT), ("mi", MOUSEINPUT), ("pad", ctypes.c_byte * 32)]


class INPUT(ctypes.Structure):
    _fields_ = [("type", W.DWORD), ("u", _U)]


KEYUP, UNICODE, EXTENDED = 0x2, 0x4, 0x1
VK = {"ctrl": 0x11, "control": 0x11, "shift": 0x10, "alt": 0x12, "win": 0x5B, "meta": 0x5B, "enter": 0x0D, "return": 0x0D,
      "tab": 0x09, "esc": 0x1B, "escape": 0x1B, "space": 0x20, "backspace": 0x08, "delete": 0x2E, "del": 0x2E, "insert": 0x2D,
      "home": 0x24, "end": 0x23, "pageup": 0x21, "pagedown": 0x22, "left": 0x25, "up": 0x26, "right": 0x27, "down": 0x28,
      "printscreen": 0x2C, "capslock": 0x14, "volumeup": 0xAF, "volumedown": 0xAE, "mute": 0xAD, "playpause": 0xB3,
      "nexttrack": 0xB0, "prevtrack": 0xB1, "stop": 0xB2, "menu": 0x5D, ";": 0xBA, "=": 0xBB, ",": 0xBC, "-": 0xBD,
      ".": 0xBE, "/": 0xBF, "`": 0xC0, "[": 0xDB, "\\": 0xDC, "]": 0xDD, "'": 0xDE}
for i in range(1, 25):
    VK[f"f{i}"] = 0x6F + i
for c in "abcdefghijklmnopqrstuvwxyz0123456789":
    VK[c] = ord(c.upper())
EXT = {0x25, 0x26, 0x27, 0x28, 0x2D, 0x2E, 0x24, 0x23, 0x21, 0x22, 0x5B, 0xAF, 0xAE, 0xAD, 0xB3, 0xB0, 0xB1, 0xB2}


def _send(inputs):
    arr = (INPUT * len(inputs))(*inputs)
    u32.SendInput(len(inputs), arr, ctypes.sizeof(INPUT))


def _key(vk, up=False):
    i = INPUT(type=1)
    i.u.ki = KEYBDINPUT(vk, 0, (KEYUP if up else 0) | (EXTENDED if vk in EXT else 0), 0, 0)
    return i


def parse_combo(s):
    """'ctrl+shift+s' -> [vk...]; raises ValueError for unknown names."""
    out = []
    for part in str(s).lower().replace(" ", "").split("+"):
        if not part:
            continue
        if part not in VK:
            raise ValueError(f"unknown key '{part}'")
        out.append(VK[part])
    if not out:
        raise ValueError("empty key combo")
    return out


def press(combo):
    vks = parse_combo(combo)
    _send([_key(v) for v in vks] + [_key(v, True) for v in reversed(vks)])


def type_text(text):
    seq = []
    for ch in str(text)[:5000]:
        if ch == "\n":
            seq += [_key(0x0D), _key(0x0D, True)]
            continue
        b16 = ch.encode("utf-16-le")
        for code in [int.from_bytes(b16[i:i + 2], "little") for i in range(0, len(b16), 2)]:
            a, b = INPUT(type=1), INPUT(type=1)
            a.u.ki = KEYBDINPUT(0, code, UNICODE, 0, 0)
            b.u.ki = KEYBDINPUT(0, code, UNICODE | KEYUP, 0, 0)
            seq += [a, b]
    for i in range(0, len(seq), 200):
        _send(seq[i:i + 200])
        time.sleep(0.01)


def click(x, y, button="left", double=False):
    u32.SetCursorPos(int(x), int(y))
    down, up = {"left": (0x2, 0x4), "right": (0x8, 0x10), "middle": (0x20, 0x40)}.get(button, (0x2, 0x4))
    seq = []
    for _ in range(2 if double else 1):
        for f in (down, up):
            i = INPUT(type=0)
            i.u.mi = MOUSEINPUT(0, 0, 0, f, 0, 0)
            seq.append(i)
    _send(seq)


def cursor():
    p = W.POINT()
    u32.GetCursorPos(ctypes.byref(p))
    return p.x, p.y


# ------------------------------------------------------------------ global hotkeys ---
MOD = {"alt": 1, "ctrl": 2, "control": 2, "shift": 4, "win": 8}
WM_HOTKEY, WM_APP = 0x0312, 0x8000


class Hotkeys:
    """One thread owns RegisterHotKey + a message loop. set(binds) swaps the whole table."""

    def __init__(self, on_fire):
        self.on_fire = on_fire
        self.tid = None
        self.want = {}
        self.result = {}
        self.ready = threading.Event()
        self.changed = threading.Event()
        threading.Thread(target=self._loop, name="kit-hotkeys", daemon=True).start()
        self.ready.wait(3)

    @staticmethod
    def split(combo):
        mods, vk = 0x4000, None   # MOD_NOREPEAT
        for part in str(combo).lower().replace(" ", "").split("+"):
            if part in MOD:
                mods |= MOD[part]
            elif part in VK:
                if vk is not None:
                    raise ValueError("one main key only")
                vk = VK[part]
            else:
                raise ValueError(f"unknown key '{part}'")
        if vk is None:
            raise ValueError("add a main key, like Ctrl+Alt+M")
        if mods == 0x4000 and not (0x70 <= vk <= 0x87):
            raise ValueError("add Ctrl, Alt, Shift or Win (or use an F key)")
        return mods, vk

    def set(self, binds):
        """binds: {id: combo}. Returns {id: 'ok' | error text}."""
        self.want = dict(binds)
        self.changed.clear()
        u32.PostThreadMessageW(self.tid, WM_APP, 0, 0)
        self.changed.wait(3)
        return dict(self.result)

    def _loop(self):
        self.tid = k32.GetCurrentThreadId()
        msg = W.MSG()
        u32.PeekMessageW(ctypes.byref(msg), None, 0, 0, 0)  # make the queue
        self.ready.set()
        live = {}   # num -> id
        while u32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
            if msg.message == WM_APP:
                for n in list(live):
                    u32.UnregisterHotKey(None, n)
                live.clear()
                res = {}
                for i, (bid, combo) in enumerate(self.want.items()):
                    try:
                        mods, vk = self.split(combo)
                    except ValueError as e:
                        res[bid] = str(e)
                        continue
                    if u32.RegisterHotKey(None, i + 1, mods, vk):
                        live[i + 1] = bid
                        res[bid] = "ok"
                    else:
                        res[bid] = "taken by another app"
                self.result = res
                self.changed.set()
            elif msg.message == WM_HOTKEY and msg.wParam in live:
                bid = live[msg.wParam]
                threading.Thread(target=self.on_fire, args=(bid,), daemon=True).start()


# ------------------------------------------------------------------------ windows ---
class RECT(ctypes.Structure):
    _fields_ = [("l", W.LONG), ("t", W.LONG), ("r", W.LONG), ("b", W.LONG)]


class MONITORINFO(ctypes.Structure):
    _fields_ = [("cbSize", W.DWORD), ("rcMonitor", RECT), ("rcWork", RECT), ("dwFlags", W.DWORD)]


WNDENUMPROC = ctypes.WINFUNCTYPE(W.BOOL, W.HWND, W.LPARAM)
u32.GetForegroundWindow.restype = W.HWND
u32.FindWindowW.restype = W.HWND
u32.MonitorFromWindow.restype = W.HANDLE
u32.SetWindowPos.argtypes = [W.HWND, W.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, W.UINT]


def title(h):
    n = u32.GetWindowTextLengthW(h)
    b = ctypes.create_unicode_buffer(n + 1)
    u32.GetWindowTextW(h, b, n + 1)
    return b.value


def pid_of(h):
    p = W.DWORD()
    u32.GetWindowThreadProcessId(h, ctypes.byref(p))
    return p.value


def windows(visible=True):
    out = []

    def cb(h, _):
        if (not visible or u32.IsWindowVisible(h)) and title(h):
            out.append(h)
        return True
    u32.EnumWindows(WNDENUMPROC(cb), 0)
    return out


def find(part):
    part = part.lower()
    for h in windows():
        if part in title(h).lower():
            return h
    return None


def foreground():
    return u32.GetForegroundWindow()


def work_area(h=None):
    mon = u32.MonitorFromWindow(h or u32.GetForegroundWindow(), 2)
    mi = MONITORINFO()
    mi.cbSize = ctypes.sizeof(MONITORINFO)
    u32.GetMonitorInfoW(mon, ctypes.byref(mi))
    r = mi.rcWork
    return r.l, r.t, r.r - r.l, r.b - r.t


def rect(h):
    r = RECT()
    u32.GetWindowRect(h, ctypes.byref(r))
    return r.l, r.t, r.r - r.l, r.b - r.t


def move(h, x, y, w, hgt):
    u32.ShowWindow(h, 9)  # SW_RESTORE (un-maximise first)
    u32.SetWindowPos(h, None, int(x), int(y), int(w), int(hgt), 0x0004 | 0x0040)  # NOZORDER|SHOWWINDOW


def topmost(h, on=True):
    u32.SetWindowPos(h, W.HWND(-1 if on else -2), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010)


def wait_window(part, secs=8):
    end = time.time() + secs
    while time.time() < end:
        h = find(part)
        if h:
            return h
        time.sleep(0.2)
    return None


def close(h):
    u32.PostMessageW(h, 0x0010, 0, 0)


# ---------------------------------------------------------------------- clipboard ---
k32.GlobalAlloc.restype = W.HGLOBAL
k32.GlobalLock.restype = ctypes.c_void_p
k32.GlobalLock.argtypes = [W.HGLOBAL]
k32.GlobalUnlock.argtypes = [W.HGLOBAL]
u32.GetClipboardData.restype = W.HANDLE
u32.SetClipboardData.argtypes = [W.UINT, W.HANDLE]


def set_clip(text):
    data = (str(text) + "\0").encode("utf-16-le")
    for _ in range(10):
        if u32.OpenClipboard(None):
            break
        time.sleep(0.05)
    else:
        return False
    try:
        u32.EmptyClipboard()
        hg = k32.GlobalAlloc(0x0002, len(data))
        p = k32.GlobalLock(hg)
        ctypes.memmove(p, data, len(data))
        k32.GlobalUnlock(hg)
        u32.SetClipboardData(13, hg)
        return True
    finally:
        u32.CloseClipboard()


def get_clip():
    if not u32.OpenClipboard(None):
        return ""
    try:
        h = u32.GetClipboardData(13)
        if not h:
            return ""
        p = k32.GlobalLock(h)
        try:
            return ctypes.wstring_at(p)
        finally:
            k32.GlobalUnlock(h)
    finally:
        u32.CloseClipboard()


# ------------------------------------------------------- sound out to a named device ---
winmm = ctypes.WinDLL("winmm")


class WAVEFORMATEX(ctypes.Structure):
    _fields_ = [("wFormatTag", W.WORD), ("nChannels", W.WORD), ("nSamplesPerSec", W.DWORD), ("nAvgBytesPerSec", W.DWORD),
                ("nBlockAlign", W.WORD), ("wBitsPerSample", W.WORD), ("cbSize", W.WORD)]


class WAVEHDR(ctypes.Structure):
    pass


WAVEHDR._fields_ = [("lpData", ctypes.c_void_p), ("dwBufferLength", W.DWORD), ("dwBytesRecorded", W.DWORD), ("dwUser", ULONG_PTR),
                    ("dwFlags", W.DWORD), ("dwLoops", W.DWORD), ("lpNext", ctypes.c_void_p), ("reserved", ULONG_PTR)]


class WAVEOUTCAPSW(ctypes.Structure):
    _fields_ = [("wMid", W.WORD), ("wPid", W.WORD), ("vDriverVersion", W.UINT), ("szPname", W.WCHAR * 32),
                ("dwFormats", W.DWORD), ("wChannels", W.WORD), ("wReserved1", W.WORD), ("dwSupport", W.DWORD)]


def out_devices():
    out = []
    for i in range(winmm.waveOutGetNumDevs()):
        c = WAVEOUTCAPSW()
        if winmm.waveOutGetDevCapsW(i, ctypes.byref(c), ctypes.sizeof(c)) == 0:
            out.append((i, c.szPname))
    return out


class PcmOut:
    """16-bit mono PCM to one output device (VB-Cable input, speakers...)."""

    def __init__(self, dev=-1, rate=16000):
        self.h = W.HANDLE()
        fmt = WAVEFORMATEX(1, 1, rate, rate * 2, 2, 16, 0)
        WAVE_MAPPER = 0xFFFFFFFF
        r = winmm.waveOutOpen(ctypes.byref(self.h), W.UINT(WAVE_MAPPER if dev < 0 else dev), ctypes.byref(fmt), 0, 0, 0)
        if r:
            raise OSError(f"waveOutOpen failed ({r})")
        self.bufs = []

    def write(self, pcm):
        # forget headers the device has finished with (WHDR_DONE = 1)
        keep = []
        for hdr, buf in self.bufs:
            if hdr.dwFlags & 1:
                winmm.waveOutUnprepareHeader(self.h, ctypes.byref(hdr), ctypes.sizeof(hdr))
            else:
                keep.append((hdr, buf))
        self.bufs = keep
        if len(self.bufs) > 25:     # more than ~2 s behind: drop to stay live
            return
        buf = ctypes.create_string_buffer(pcm)
        hdr = WAVEHDR()
        hdr.lpData = ctypes.cast(buf, ctypes.c_void_p)
        hdr.dwBufferLength = len(pcm)
        winmm.waveOutPrepareHeader(self.h, ctypes.byref(hdr), ctypes.sizeof(hdr))
        winmm.waveOutWrite(self.h, ctypes.byref(hdr), ctypes.sizeof(hdr))
        self.bufs.append((hdr, buf))

    def close(self):
        winmm.waveOutReset(self.h)
        for hdr, _ in self.bufs:
            winmm.waveOutUnprepareHeader(self.h, ctypes.byref(hdr), ctypes.sizeof(hdr))
        winmm.waveOutClose(self.h)
        self.bufs = []
