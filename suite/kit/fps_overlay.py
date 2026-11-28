"""Tiny always-on-top, click-through FPS counter. Reads PresentMon's CSV and shows the FPS of the
window in front. Started by games.fps_start: pythonw fps_overlay.py <csv> <corner>"""
import ctypes
import os
import sys
import time
import tkinter as tk
from collections import deque

CSV = sys.argv[1]
CORNER = sys.argv[2] if len(sys.argv) > 2 else "tl"
u32 = ctypes.windll.user32


def fg_pid():
    p = ctypes.c_ulong()
    u32.GetWindowThreadProcessId(u32.GetForegroundWindow(), ctypes.byref(p))
    return p.value


root = tk.Tk()
root.overrideredirect(True)
root.attributes("-topmost", True)
root.configure(bg="#010101")
root.attributes("-transparentcolor", "#010101")
lab = tk.Label(root, text="FPS --", font=("Consolas", 15, "bold"), fg="#c6ff3d", bg="#16141a", padx=10, pady=4,
               highlightthickness=2, highlightbackground="#f0ece4")
lab.pack()
root.update_idletasks()
sw, sh = root.winfo_screenwidth(), root.winfo_screenheight()
x = 16 if CORNER in ("tl", "bl") else sw - 150
y = 16 if CORNER in ("tl", "tr") else sh - 90
root.geometry(f"+{x}+{y}")
hwnd = u32.GetParent(root.winfo_id())
ex = u32.GetWindowLongW(hwnd, -20)
u32.SetWindowLongW(hwnd, -20, ex | 0x80000 | 0x20 | 0x80)   # layered, click-through, no taskbar button

state = {"pos": 0, "cols": None, "frames": deque()}


def tick():
    try:
        if os.path.exists(CSV):
            with open(CSV, encoding="utf-8", errors="replace") as f:
                f.seek(state["pos"])
                data = f.read()
                state["pos"] = f.tell()
            for line in data.splitlines():
                parts = line.split(",")
                if state["cols"] is None:
                    if "ProcessID" in parts:
                        state["cols"] = {c: i for i, c in enumerate(parts)}
                    continue
                c = state["cols"]
                try:
                    pid = int(parts[c["ProcessID"]])
                    ms = float(parts[c.get("MsBetweenPresents", c.get("FrameTime", 0))])
                except (ValueError, IndexError, KeyError):
                    continue
                state["frames"].append((time.time(), pid, ms))
        now = time.time()
        while state["frames"] and now - state["frames"][0][0] > 1.5:
            state["frames"].popleft()
        pid = fg_pid()
        mine = [ms for t, p, ms in state["frames"] if p == pid and ms > 0]
        if mine:
            fps = 1000 / (sum(mine) / len(mine))
            low = 1000 / max(mine)
            lab.config(text=f"FPS {fps:4.0f}  low {low:3.0f}", fg="#c6ff3d" if fps >= 55 else "#ffc93d" if fps >= 30 else "#ff4d5e")
        else:
            lab.config(text="FPS --", fg="#8a8590")
    except Exception:
        pass
    root.after(250, tick)


tick()
root.mainloop()
