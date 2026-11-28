"""On-screen parts of QT Remote that live on the PC itself (tkinter, own process).

  pythonw indicator.py ask '<json>'   the "allow this device?" prompt. Exit 10 allow, 11 view only, 0 no.
  pythonw indicator.py bar <port>     the "someone is connected" strip at the top of the screen with End.

The strip is hidden from screen capture, so it never covers what the remote device sees."""
import ctypes
import json
import sys
import tkinter as tk
import urllib.request

BG, CARD, FG, MUTED, INK = "#16141a", "#221f27", "#fff8ec", "#b6aea3", "#000000"
ACCENT, BAD, OK = "#ff5ac8", "#ff5d6c", "#5dff9c"
DISPLAY = ("Arial Black", 15)
FONT = ("Segoe UI", 10)
MONO = ("Consolas", 30, "bold")


def _dpi():
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
    except Exception:
        pass


def _icon(win):
    import os
    ico = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "suite", "suite.ico")
    try:
        if os.path.exists(ico):
            win.iconbitmap(ico)
    except tk.TclError:
        pass


def _hwnd(win):
    win.update_idletasks()
    return ctypes.windll.user32.GetAncestor(win.winfo_id(), 2)  # GA_ROOT


def _btn(parent, text, cmd, bg, fg=BG):
    shadow = tk.Frame(parent, bg=INK)
    b = tk.Label(shadow, text=text, bg=bg, fg=fg, font=("Segoe UI Semibold", 11), padx=16, pady=7,
                 highlightthickness=2, highlightbackground=INK, cursor="hand2")
    b.pack(padx=(0, 3), pady=(0, 3))
    b.bind("<Button-1>", lambda e: cmd())
    b.bind("<Enter>", lambda e: b.configure(bg=FG if bg != FG else ACCENT))
    b.bind("<Leave>", lambda e: b.configure(bg=bg))
    return shadow


def ask(info):
    _dpi()
    result = {"code": 0}
    root = tk.Tk()
    root.title("QT Remote")
    _icon(root)
    root.configure(bg=INK)
    root.attributes("-topmost", True)
    root.resizable(False, False)
    card = tk.Frame(root, bg=CARD, padx=26, pady=20, highlightthickness=3, highlightbackground=INK)
    card.pack(padx=(3, 8), pady=(3, 8))
    pairing = info.get("mode", "pair") == "pair"
    tk.Label(card, text="QT REMOTE", bg=CARD, fg=ACCENT, font=("Consolas", 9, "bold")).pack(anchor="w")
    head = f"{info.get('name', 'A device')} wants to {'pair with' if pairing else 'connect to'} this PC"
    tk.Label(card, text=head, bg=CARD, fg=FG, font=DISPLAY, wraplength=430, justify="left").pack(anchor="w", pady=(4, 8))
    who = info.get("device", "")
    if info.get("login"):
        who += f"  ·  {info['login']}"
    via = {"tailnet": "over Tailscale (encrypted)", "lan": "over the local network (NOT encrypted)",
           "local": "from this PC"}.get(info.get("kind"), "")
    tk.Label(card, text=f"Device: {who}\nConnecting {via}", bg=CARD, fg=MUTED, font=FONT, justify="left").pack(anchor="w")
    if pairing:
        tk.Label(card, text="Only allow it if the other screen shows this same code:", bg=CARD, fg=MUTED,
                 font=FONT).pack(anchor="w", pady=(12, 2))
        code = info.get("code", "")
        tk.Label(card, text=f"{code[:3]} {code[3:]}", bg=BG, fg=ACCENT, font=MONO, padx=18, pady=4,
                 highlightthickness=2, highlightbackground=INK).pack(anchor="w")
    left = tk.StringVar(value="")
    tk.Label(card, textvariable=left, bg=CARD, fg=MUTED, font=("Consolas", 9)).pack(anchor="w", pady=(10, 0))
    row = tk.Frame(card, bg=CARD)
    row.pack(anchor="w", pady=(10, 0))

    def done(c):
        result["code"] = c
        root.destroy()
    _btn(row, "Allow control", lambda: done(10), ACCENT).pack(side="left", padx=(0, 10))
    _btn(row, "View only", lambda: done(11), FG).pack(side="left", padx=(0, 10))
    _btn(row, "Don't allow", lambda: done(0), BAD).pack(side="left")
    root.bind("<Escape>", lambda e: done(0))
    root.protocol("WM_DELETE_WINDOW", lambda: done(0))
    secs = [int(info.get("timeout", 110))]

    def tick():
        secs[0] -= 1
        if secs[0] <= 0:
            return done(0)
        left.set(f"Closes by itself in {secs[0]} s (counts as Don't allow)")
        root.after(1000, tick)
    tick()
    root.update_idletasks()
    w, h = root.winfo_width(), root.winfo_height()
    root.geometry(f"+{(root.winfo_screenwidth() - w) // 2}+{(root.winfo_screenheight() - h) // 3}")
    root.lift()
    root.focus_force()
    try:
        ctypes.windll.user32.FlashWindow(_hwnd(root), True)
    except Exception:
        pass
    root.mainloop()
    return result["code"]


def bar(port):
    _dpi()
    base = f"http://127.0.0.1:{port}"
    root = tk.Tk()
    root.overrideredirect(True)
    root.attributes("-topmost", True)
    root.configure(bg=INK)
    inner = tk.Frame(root, bg=CARD, highlightthickness=2, highlightbackground=INK)
    inner.pack(padx=(0, 3), pady=(0, 3))
    dot = tk.Label(inner, text="●", bg=CARD, fg=BAD, font=("Segoe UI", 11))
    dot.pack(side="left", padx=(12, 4), pady=5)
    text = tk.StringVar(value="Remote session")
    tk.Label(inner, textvariable=text, bg=CARD, fg=FG, font=("Segoe UI Semibold", 10)).pack(side="left", pady=5)

    def end():
        try:
            req = urllib.request.Request(base + "/api/local/end/all", data=b"{}", method="POST",
                                         headers={"Origin": base, "Content-Type": "application/json"})
            urllib.request.urlopen(req, timeout=3).read()
        except Exception:
            pass
    b = tk.Label(inner, text="End", bg=BAD, fg=BG, font=("Segoe UI Semibold", 10), padx=12, pady=2, cursor="hand2",
                 highlightthickness=2, highlightbackground=INK)
    b.pack(side="left", padx=10, pady=4)
    b.bind("<Button-1>", lambda e: end())
    empty = [0]
    blink = [True]

    def place():
        root.update_idletasks()
        root.geometry(f"+{(root.winfo_screenwidth() - root.winfo_width()) // 2}+0")

    def poll():
        try:
            d = json.loads(urllib.request.urlopen(base + "/api/local/indicator", timeout=3).read())
            s = d.get("sessions", [])
        except Exception:
            s = []
        if not s:
            empty[0] += 1
            if empty[0] >= 3:
                root.destroy()
                return
        else:
            empty[0] = 0
            names = ", ".join(x["name"] for x in s[:3]) + (f" +{len(s) - 3}" if len(s) > 3 else "")
            ctl = any(not x.get("view_only") for x in s)
            text.set(f"{names} {'is controlling' if ctl else 'is viewing'} this PC")
            place()
        blink[0] = not blink[0]
        dot.configure(fg=BAD if blink[0] else CARD)
        root.after(1000, poll)
    place()
    try:
        ctypes.windll.user32.SetWindowDisplayAffinity(_hwnd(root), 0x11)  # WDA_EXCLUDEFROMCAPTURE
    except Exception:
        pass
    poll()
    root.mainloop()


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "ask":
        sys.exit(ask(json.loads(sys.argv[2])))
    if len(sys.argv) >= 3 and sys.argv[1] == "bar":
        bar(int(sys.argv[2]))
