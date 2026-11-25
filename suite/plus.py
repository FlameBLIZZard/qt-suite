"""QT Suite extras: which process owns a tool's port, its uptime and memory,
and stop / restart for the tools the hub knows about.

Kept apart from app.py so other work on the hub doesn't collide with it.
Only processes named python*.exe that listen on a known tool port can be
stopped, and never the hub itself.
"""
import ctypes
import os
import subprocess
import time
from ctypes import wintypes

NOWIN = 0x08000000
_k32 = ctypes.windll.kernel32
_iphlp = ctypes.windll.iphlpapi
_psapi = ctypes.windll.psapi

PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
PROCESS_VM_READ = 0x0010
TCP_TABLE_OWNER_PID_LISTENER = 3
AF_INET = 2


class _Row(ctypes.Structure):
    _fields_ = [("state", wintypes.DWORD), ("laddr", wintypes.DWORD), ("lport", wintypes.DWORD),
                ("raddr", wintypes.DWORD), ("rport", wintypes.DWORD), ("pid", wintypes.DWORD)]


def listeners():
    """{port: pid} for every IPv4 TCP listener on this PC."""
    size = wintypes.DWORD(0)
    _iphlp.GetExtendedTcpTable(None, ctypes.byref(size), False, AF_INET, TCP_TABLE_OWNER_PID_LISTENER, 0)
    for _ in range(4):  # the table can grow between the size query and the read: retry with more room
        buf = ctypes.create_string_buffer(size.value + 16384)
        size = wintypes.DWORD(len(buf))
        if not _iphlp.GetExtendedTcpTable(buf, ctypes.byref(size), False, AF_INET, TCP_TABLE_OWNER_PID_LISTENER, 0):
            break
    else:
        return {}
    n = ctypes.cast(buf, ctypes.POINTER(wintypes.DWORD))[0]
    rows = ctypes.cast(ctypes.addressof(buf) + 4, ctypes.POINTER(_Row * n)).contents
    out = {}
    for r in rows:
        port = ((r.lport & 0xFF) << 8) | ((r.lport >> 8) & 0xFF)
        out.setdefault(port, r.pid)
    return out


class _Mem(ctypes.Structure):
    _fields_ = [("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD)] + \
               [(n, ctypes.c_size_t) for n in ("PeakWorkingSetSize", "WorkingSetSize", "QuotaPeakPagedPoolUsage",
                                               "QuotaPagedPoolUsage", "QuotaPeakNonPagedPoolUsage",
                                               "QuotaNonPagedPoolUsage", "PagefileUsage", "PeakPagefileUsage",
                                               "PrivateUsage")]


def proc_info(pid):
    """{'exe', 'started' (unix secs), 'mem' (bytes, private)} or None."""
    h = _k32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ, False, pid)
    if not h:
        h = _k32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
        if not h:
            return None
    try:
        buf = ctypes.create_unicode_buffer(1024)
        n = wintypes.DWORD(1024)
        exe = buf.value if _k32.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(n)) else ""
        c, e, k, u = (wintypes.FILETIME() for _ in range(4))
        started = None
        if _k32.GetProcessTimes(h, ctypes.byref(c), ctypes.byref(e), ctypes.byref(k), ctypes.byref(u)):
            ft = (c.dwHighDateTime << 32) | c.dwLowDateTime
            started = ft / 1e7 - 11644473600
        m = _Mem()
        m.cb = ctypes.sizeof(_Mem)
        mem = m.PrivateUsage if _psapi.GetProcessMemoryInfo(h, ctypes.byref(m), m.cb) else None
        return {"exe": exe, "started": started, "mem": mem}
    finally:
        _k32.CloseHandle(h)


def tool_procs(tools):
    """{tool id: {'pid', 'up' (secs), 'mem'}} for running web tools."""
    lis = listeners()
    now = time.time()
    out = {}
    for t in tools:
        pid = lis.get(t.get("port")) if t["kind"] == "web" else None
        if not pid:
            continue
        info = proc_info(pid) or {}
        out[t["id"]] = {"pid": pid, "up": round(now - info["started"]) if info.get("started") else None,
                        "mem": info.get("mem")}
    return out


def stop(t, hub_port):
    """Stop the process that serves a web tool. Returns (ok, msg)."""
    if t["kind"] != "web":
        return False, "only running web tools can be stopped"
    if t.get("port") == hub_port:
        return False, "that's the hub itself"
    pid = listeners().get(t["port"])
    if not pid:
        return True, "already stopped"
    if pid == os.getpid():
        return False, "that's the hub itself"
    exe = os.path.basename((proc_info(pid) or {}).get("exe", "")).lower()
    if not exe.startswith("python"):
        return False, f"port {t['port']} belongs to {exe or 'another program'}, left alone"
    r = subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True, creationflags=NOWIN, timeout=15)
    for _ in range(30):
        if t["port"] not in listeners():
            return True, "stopped"
        time.sleep(0.1)
    return False, (r.stdout or r.stderr or b"").decode(errors="replace").strip() or "still running"
