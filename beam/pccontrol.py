"""Talks to the PC itself: clipboard, mouse/keyboard, volume/media, brightness, power.

Windows uses ctypes only (no installs). Other systems get a FakeBackend that
records calls, which is what the tests use."""
import ctypes
import os
import struct
import subprocess
import sys
import threading
import time

IS_WIN = os.name == "nt"


class _Log(list):
    def append(self, x):
        if os.environ.get("BEAM_FAKE_LOG"):
            print("[fake-pc]", *x, flush=True)
        super().append(x)


class FakeBackend:
    """Records every action. Used off Windows and in tests."""

    def __init__(self):
        self.log = _Log()
        self._clip = ""
        self._seq = 0
        self.brightness = 50

    def clip_seq(self):
        return self._seq

    def get_clip(self):
        return {"text": self._clip} if self._clip else {}

    def set_clip(self, text):
        self._clip = text
        self._seq += 1
        self.log.append(("clip", text))

    def move(self, dx, dy):
        self.log.append(("move", dx, dy))

    def button(self, which, action):
        self.log.append(("button", which, action))

    def scroll(self, dy, dx=0):
        self.log.append(("scroll", dy, dx))

    def type_text(self, text):
        self.log.append(("type", text))

    def key(self, name, mods=()):
        self.log.append(("key", name, tuple(mods)))

    def get_brightness(self):
        return self.brightness

    def set_brightness(self, v):
        self.brightness = v
        self.log.append(("brightness", v))
        return True

    def power(self, what):
        self.log.append(("power", what))
        return True


# ---------------------------------------------------------------- Windows ---

VK = {
    "enter": 0x0D, "backspace": 0x08, "tab": 0x09, "esc": 0x1B, "space": 0x20, "delete": 0x2E,
    "left": 0x25, "up": 0x26, "right": 0x27, "down": 0x28, "home": 0x24, "end": 0x23,
    "pageup": 0x21, "pagedown": 0x22, "win": 0x5B, "ctrl": 0x11, "alt": 0x12, "shift": 0x10,
    "volup": 0xAF, "voldown": 0xAE, "mute": 0xAD, "play": 0xB3, "next": 0xB0, "prev": 0xB1, "stop": 0xB2,
    "f5": 0x74, "f11": 0x7A, "printscreen": 0x2C,
}
for _c in "abcdefghijklmnopqrstuvwxyz":
    VK[_c] = ord(_c.upper())
for _d in "0123456789":
    VK[_d] = ord(_d)
EXTENDED = {0x25, 0x26, 0x27, 0x28, 0x24, 0x23, 0x21, 0x22, 0x2E, 0x5B, 0xAF, 0xAE, 0xAD, 0xB3, 0xB0, 0xB1, 0xB2}


class WinBackend:
    CF_UNICODETEXT = 13
    CF_DIB = 8

    def __init__(self):
        from ctypes import wintypes as W
        self.W = W
        u, k = ctypes.windll.user32, ctypes.windll.kernel32
        self.u, self.k = u, k
        u.OpenClipboard.argtypes = [W.HWND]
        u.GetClipboardData.restype = W.HANDLE
        u.GetClipboardData.argtypes = [W.UINT]
        u.SetClipboardData.restype = W.HANDLE
        u.SetClipboardData.argtypes = [W.UINT, W.HANDLE]
        u.IsClipboardFormatAvailable.argtypes = [W.UINT]
        u.GetClipboardSequenceNumber.restype = W.DWORD
        u.RegisterClipboardFormatW.restype = W.UINT
        u.RegisterClipboardFormatW.argtypes = [W.LPCWSTR]
        # Password managers tag secrets with these so clipboard history apps skip them; Beam does too.
        self.CF_PRIVATE = [f for f in (u.RegisterClipboardFormatW(n) for n in (
            "ExcludeClipboardContentFromMonitorProcessing", "Clipboard Viewer Ignore")) if f]
        self.CF_NOHISTORY = u.RegisterClipboardFormatW("CanIncludeInClipboardHistory")
        k.GlobalLock.restype = ctypes.c_void_p
        k.GlobalLock.argtypes = [W.HGLOBAL]
        k.GlobalUnlock.argtypes = [W.HGLOBAL]
        k.GlobalAlloc.restype = W.HGLOBAL
        k.GlobalAlloc.argtypes = [W.UINT, ctypes.c_size_t]
        k.GlobalSize.restype = ctypes.c_size_t
        k.GlobalSize.argtypes = [W.HGLOBAL]
        u.mouse_event.argtypes = [W.DWORD, W.DWORD, W.DWORD, W.DWORD, ctypes.c_size_t]
        u.keybd_event.argtypes = [W.BYTE, W.BYTE, W.DWORD, ctypes.c_size_t]

        class KEYBDINPUT(ctypes.Structure):
            _fields_ = [("wVk", W.WORD), ("wScan", W.WORD), ("dwFlags", W.DWORD),
                        ("time", W.DWORD), ("dwExtraInfo", ctypes.c_size_t)]

        class MOUSEINPUT(ctypes.Structure):
            _fields_ = [("dx", W.LONG), ("dy", W.LONG), ("mouseData", W.DWORD), ("dwFlags", W.DWORD),
                        ("time", W.DWORD), ("dwExtraInfo", ctypes.c_size_t)]

        class _U(ctypes.Union):
            _fields_ = [("ki", KEYBDINPUT), ("mi", MOUSEINPUT), ("pad", ctypes.c_byte * 32)]

        class INPUT(ctypes.Structure):
            _fields_ = [("type", W.DWORD), ("u", _U)]
        self.KEYBDINPUT, self.INPUT = KEYBDINPUT, INPUT
        u.SendInput.argtypes = [W.UINT, ctypes.POINTER(INPUT), ctypes.c_int]
        self.MONENUMPROC = ctypes.WINFUNCTYPE(W.BOOL, W.HMONITOR, W.HDC, ctypes.POINTER(W.RECT), W.LPARAM)
        u.PostMessageW.argtypes = [W.HWND, W.UINT, W.WPARAM, W.LPARAM]
        self._mon_lock = threading.Lock()

    # ---- clipboard
    def _open(self):
        for _ in range(20):
            if self.u.OpenClipboard(None):
                return True
            time.sleep(0.02)
        return False

    def clip_seq(self):
        return self.u.GetClipboardSequenceNumber()

    def get_clip(self):
        if not self._open():
            return {}
        try:
            if any(self.u.IsClipboardFormatAvailable(f) for f in self.CF_PRIVATE):
                return {"private": True}
            if self.CF_NOHISTORY and self.u.IsClipboardFormatAvailable(self.CF_NOHISTORY):
                h = self.u.GetClipboardData(self.CF_NOHISTORY)
                p = self.k.GlobalLock(h) if h else None
                try:
                    if p and ctypes.c_uint32.from_address(p).value == 0:
                        return {"private": True}
                finally:
                    if p:
                        self.k.GlobalUnlock(h)
            if self.u.IsClipboardFormatAvailable(self.CF_UNICODETEXT):
                h = self.u.GetClipboardData(self.CF_UNICODETEXT)
                if h:
                    p = self.k.GlobalLock(h)
                    try:
                        return {"text": ctypes.wstring_at(p)} if p else {}
                    finally:
                        self.k.GlobalUnlock(h)
            if self.u.IsClipboardFormatAvailable(self.CF_DIB):
                h = self.u.GetClipboardData(self.CF_DIB)
                if h:
                    n = self.k.GlobalSize(h)
                    p = self.k.GlobalLock(h)
                    try:
                        dib = ctypes.string_at(p, n)
                    finally:
                        self.k.GlobalUnlock(h)
                    return {"bmp": dib_to_bmp(dib)}
        finally:
            self.u.CloseClipboard()
        return {}

    def set_clip(self, text):
        data = (text + "\0").encode("utf-16-le")
        h = self.k.GlobalAlloc(0x0002, len(data))  # GMEM_MOVEABLE
        p = self.k.GlobalLock(h)
        ctypes.memmove(p, data, len(data))
        self.k.GlobalUnlock(h)
        if not self._open():
            raise OSError("Clipboard is busy")
        try:
            self.u.EmptyClipboard()
            self.u.SetClipboardData(self.CF_UNICODETEXT, h)
        finally:
            self.u.CloseClipboard()

    # ---- mouse
    def move(self, dx, dy):
        self.u.mouse_event(0x0001, ctypes.c_uint32(dx).value, ctypes.c_uint32(dy).value, 0, 0)

    def button(self, which, action):
        flags = {"left": (0x0002, 0x0004), "right": (0x0008, 0x0010), "middle": (0x0020, 0x0040)}[which]
        if action in ("down", "click"):
            self.u.mouse_event(flags[0], 0, 0, 0, 0)
        if action in ("up", "click"):
            self.u.mouse_event(flags[1], 0, 0, 0, 0)

    def scroll(self, dy, dx=0):
        if dy:
            self.u.mouse_event(0x0800, 0, 0, ctypes.c_uint32(int(dy)).value, 0)
        if dx:
            self.u.mouse_event(0x01000, 0, 0, ctypes.c_uint32(int(dx)).value, 0)

    # ---- keyboard
    def _vk(self, vk, up=False):
        flags = (0x0001 if vk in EXTENDED else 0) | (0x0002 if up else 0)
        self.u.keybd_event(vk, 0, flags, 0)

    def key(self, name, mods=()):
        vk = VK.get(name)
        if vk is None:
            return
        mvk = [VK[m] for m in mods if m in VK]
        for m in mvk:
            self._vk(m)
        self._vk(vk)
        self._vk(vk, True)
        for m in reversed(mvk):
            self._vk(m, True)

    def type_text(self, text):
        inputs = []
        for ch in text.replace("\r\n", "\n"):
            if ch == "\n":
                self.key("enter")
                continue
            code = ch.encode("utf-16-le")
            for i in range(0, len(code), 2):
                unit = int.from_bytes(code[i:i + 2], "little")
                for up in (0, 2):
                    inp = self.INPUT(type=1)
                    inp.u.ki = self.KEYBDINPUT(0, unit, 0x0004 | up, 0, 0)  # KEYEVENTF_UNICODE
                    inputs.append(inp)
            arr = (self.INPUT * len(inputs))(*inputs)
            self.u.SendInput(len(inputs), arr, ctypes.sizeof(self.INPUT))
            inputs = []

    # ---- brightness: DDC/CI for external monitors, WMI for laptop panels
    def _monitors(self):
        from ctypes import wintypes as W

        class PHYS(ctypes.Structure):
            _fields_ = [("h", W.HANDLE), ("desc", W.WCHAR * 128)]
        dx = ctypes.windll.dxva2
        if not getattr(self, "_dx_ready", False):
            dx.GetNumberOfPhysicalMonitorsFromHMONITOR.argtypes = [W.HMONITOR, ctypes.POINTER(W.DWORD)]
            dx.GetPhysicalMonitorsFromHMONITOR.argtypes = [W.HMONITOR, W.DWORD, ctypes.c_void_p]
            for fn in ("GetMonitorBrightness",):
                getattr(dx, fn).argtypes = [W.HANDLE, ctypes.POINTER(ctypes.c_uint32),
                                            ctypes.POINTER(ctypes.c_uint32), ctypes.POINTER(ctypes.c_uint32)]
            dx.SetMonitorBrightness.argtypes = [W.HANDLE, W.DWORD]
            dx.DestroyPhysicalMonitor.argtypes = [W.HANDLE]
            self.u.EnumDisplayMonitors.argtypes = [W.HDC, ctypes.c_void_p, self.MONENUMPROC, W.LPARAM]
            self._dx_ready = True
        handles = []

        def cb(hmon, hdc, rect, data):
            n = W.DWORD()
            if dx.GetNumberOfPhysicalMonitorsFromHMONITOR(hmon, ctypes.byref(n)) and n.value:
                arr = (PHYS * n.value)()
                if dx.GetPhysicalMonitorsFromHMONITOR(hmon, n.value, ctypes.cast(arr, ctypes.c_void_p)):
                    handles.extend(p.h for p in arr)
            return True
        self.u.EnumDisplayMonitors(None, None, self.MONENUMPROC(cb), 0)
        return dx, handles

    def get_brightness(self):
        with self._mon_lock:
            try:
                dx, hs = self._monitors()
                for h in hs:
                    mn, cur, mx = ctypes.c_uint32(), ctypes.c_uint32(), ctypes.c_uint32()
                    ok = dx.GetMonitorBrightness(h, ctypes.byref(mn), ctypes.byref(cur), ctypes.byref(mx))
                    dx.DestroyPhysicalMonitor(h)
                    if ok and mx.value > mn.value:
                        return round(100 * (cur.value - mn.value) / (mx.value - mn.value))
            except Exception:
                pass
        out = ps("(Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness).CurrentBrightness")
        try:
            return int(out.split()[0])
        except (ValueError, IndexError):
            return None

    def set_brightness(self, v):
        ok_any = False
        with self._mon_lock:
            try:
                dx, hs = self._monitors()
                for h in hs:
                    mn, cur, mx = ctypes.c_uint32(), ctypes.c_uint32(), ctypes.c_uint32()
                    if dx.GetMonitorBrightness(h, ctypes.byref(mn), ctypes.byref(cur), ctypes.byref(mx)):
                        val = mn.value + round((mx.value - mn.value) * v / 100)
                        ok_any = bool(dx.SetMonitorBrightness(h, val)) or ok_any
                    dx.DestroyPhysicalMonitor(h)
            except Exception:
                pass
        if not ok_any:
            out = ps(f"$m=Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -EA Stop;"
                     f"Invoke-CimMethod -InputObject $m -MethodName WmiSetBrightness -Arguments @{{Timeout=1;Brightness={int(v)}}} | Out-Null; 'ok'")
            ok_any = "ok" in out
        return ok_any

    # ---- power
    def power(self, what):
        if what == "lock":
            return bool(self.u.LockWorkStation())
        if what == "sleep":
            # SetSuspendState(hibernate=False, force=False, wakeupEventsDisabled=False)
            threading.Timer(1.0, lambda: ctypes.windll.powrprof.SetSuspendState(False, False, False)).start()
            return True
        if what == "monitor_off":
            HWND_BROADCAST, WM_SYSCOMMAND, SC_MONITORPOWER = 0xFFFF, 0x0112, 0xF170
            threading.Timer(0.5, lambda: self.u.PostMessageW(HWND_BROADCAST, WM_SYSCOMMAND, SC_MONITORPOWER, 2)).start()
            return True
        cmds = {"shutdown": ["shutdown", "/s", "/t", "30", "/c", "Beam: shutting down in 30 seconds"],
                "restart": ["shutdown", "/r", "/t", "30", "/c", "Beam: restarting in 30 seconds"],
                "cancel": ["shutdown", "/a"]}
        if what in cmds:
            r = subprocess.run(cmds[what], capture_output=True, creationflags=0x08000000)
            return r.returncode == 0
        return False


def ps(cmd):
    try:
        r = subprocess.run(["powershell", "-NoProfile", "-Command", cmd], capture_output=True, text=True,
                           timeout=8, creationflags=0x08000000)
        return r.stdout.strip()
    except Exception:
        return ""


def dib_to_bmp(dib):
    """CF_DIB clipboard bytes -> a .bmp file browsers can show."""
    hsize, = struct.unpack_from("<I", dib, 0)
    bitcount, = struct.unpack_from("<H", dib, 14)
    compression, = struct.unpack_from("<I", dib, 16)
    clr_used, = struct.unpack_from("<I", dib, 32)
    if bitcount <= 8:
        palette = (clr_used or (1 << bitcount)) * 4
    else:
        palette = clr_used * 4
    if compression == 3 and hsize == 40:  # BI_BITFIELDS masks follow the header
        palette += 12
    offset = 14 + hsize + palette
    return b"BM" + struct.pack("<IHHI", 14 + len(dib), 0, 0, offset) + dib


def make_backend():
    if IS_WIN and not os.environ.get("BEAM_FAKE_PC"):
        try:
            return WinBackend()
        except Exception as e:
            print("[beam] PC control unavailable:", e, file=sys.stderr)
    return FakeBackend()
