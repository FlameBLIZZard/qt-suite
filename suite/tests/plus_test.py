"""Checks suite/plus.py on throwaway servers only (never touches the real tools).
python suite\\tests\\plus_test.py"""
import os
import socket
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import plus  # noqa: E402

PORT = 7819
fails = 0


def check(name, cond):
    global fails
    print(("PASS  " if cond else "FAIL  ") + name)
    fails += not cond


def up(port):
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.3):
            return True
    except OSError:
        return False


p = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=0x08000000)
for _ in range(50):
    if up(PORT):
        break
    time.sleep(0.1)
fake = {"id": "fake", "kind": "web", "port": PORT}
try:
    for _ in range(30):  # the listener table can lag a moment behind the socket
        pid = plus.listeners().get(PORT)
        if pid:
            break
        time.sleep(0.1)
    exe = ((plus.proc_info(pid) or {}).get("exe") or "").lower() if pid else ""
    check(f"listener table finds the throwaway server ({pid} vs {p.pid})", pid and "python" in exe)
    info = plus.tool_procs([fake]).get("fake", {})
    check("uptime and memory reported", info.get("pid") == pid and info.get("up") is not None and (info.get("mem") or 0) > 0)
    check("refuses to stop the hub port", plus.stop(dict(fake, port=7800), 7800)[0] is False)
    check("refuses non-web tools", plus.stop({"id": "x", "kind": "file"}, 7800)[0] is False)
    ok, msg = plus.stop(fake, 7800)
    check(f"stops a python server ({msg})", ok and not up(PORT))
    check("stopping again is a no-op", plus.stop(fake, 7800) == (True, "already stopped"))
finally:
    if p.poll() is None:
        p.kill()
print("ALL PASSED" if not fails else f"{fails} FAILED")
sys.exit(fails)
