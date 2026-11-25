"""Soundboard: play clips through your mic (via a virtual cable) with hotkeys."""
import ctypes
import json
import math
import os
import queue
import sys
import threading
import time
import traceback
import uuid
import tkinter as tk
from tkinter import filedialog, messagebox, simpledialog, ttk

import keyboard

from engine import Engine, devices_for, hostapi_names, load_audio, refresh_devices
from web import Web

APP_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(APP_DIR, "config.json")
AUDIO_EXT = (".wav", ".mp3", ".ogg", ".flac", ".aif", ".aiff", ".opus")
NONE = "(none)"

BG, PANEL, FG, MUTED, ACCENT = "#16141a", "#221f27", "#fff8ec", "#b6aea3", "#ff5fa2"  # QT Suite: Ink Arcade
GOOD, BAD = "#5dff9c", "#ff5d6c"
INK, CHIP, ON_ACCENT, ACCENT_HI = "#000000", "#2c2833", "#16141a", "#ff8cc0"
PALETTE = ["#ff5d6c", "#ff8a3d", "#ffc93d", "#c6ff3d", "#5dffb0", "#4dc3ff", "#b28bff", "#ff5fa2"]
DISPLAY = "Segoe UI Black"

DEFAULTS = {
    "api": None, "mic": None, "out": None, "mon": None,
    "mic_gain": 100, "sound_gain": 100,
    "mic_to_out": True, "sounds_to_out": True, "sounds_to_mon": True, "mic_to_mon": False,
    "on_top": False, "stop_hotkey": "", "pads": [], "tap_mode": "restart",
}


def mix(c1, c2, t):
    """Blend hex colour c1 toward c2 by t (0..1)."""
    a = [int(c1[i:i + 2], 16) for i in (1, 3, 5)]
    b = [int(c2[i:i + 2], 16) for i in (1, 3, 5)]
    return "#%02x%02x%02x" % tuple(int(x + (y - x) * t) for x, y in zip(a, b))


def rgb(h):
    return [int(h[i:i + 2], 16) for i in (1, 3, 5)]


def hexc(c):
    return "#%02x%02x%02x" % tuple(max(0, min(255, int(round(x)))) for x in c)


def lerp3(a, b, t):
    return [x + (y - x) * t for x, y in zip(a, b)]


WHITE, BLACK = [255, 255, 255], [0, 0, 0]
FRAME_MS = 33  # ~30 fps for the animations


def round_rect(x1, y1, x2, y2, r):
    """Points for a smooth polygon that draws a rounded rectangle."""
    return [x1 + r, y1, x2 - r, y1, x2, y1, x2, y1 + r, x2, y2 - r, x2, y2,
            x2 - r, y2, x1 + r, y2, x1, y2, x1, y2 - r, x1, y1 + r, x1, y1]


class PadView:
    """One pad, drawn on its own canvas so it can animate:
    colour fades, a white flash + press-in when it fires, a progress bar
    while it plays and a breathing outline for loops."""
    H = 92

    def __init__(self, app, parent, pid):
        self.app, self.pid = app, pid
        c = self.c = tk.Canvas(parent, height=self.H, width=160, bg=BG, highlightthickness=0,
                               bd=0, cursor="hand2")
        self.w = 160
        self.fill, self.fg = rgb(BG), rgb(BG)  # new pads fade in from the background
        self.flash = self.kick = self.press = self.press_to = self.bar = self.prog = 0.0
        self.hover = False
        self.drawn = None
        self.shadow = c.create_polygon(0, 0, 0, 0, smooth=True, fill=INK, outline=INK, width=0)
        self.shape = c.create_polygon(0, 0, 0, 0, smooth=True, fill=BG, outline=INK, width=3)
        self.track = c.create_rectangle(0, 0, 0, 0, width=0, fill=BG)
        self.barid = c.create_rectangle(0, 0, 0, 0, width=0, fill=BG)
        self.title = c.create_text(0, 0, text="", fill=BG, font=(DISPLAY, 11), justify="center")
        self.sub = c.create_text(0, 0, text="", fill=BG, font=("Consolas", 8, "bold"))
        c.bind("<Configure>", self.on_size)
        c.bind("<ButtonPress-1>", self.on_down)
        c.bind("<ButtonRelease-1>", lambda e: self.set_press(False))
        c.bind("<Button-2>", lambda e: app.stop_pad(pid))
        c.bind("<Button-3>", lambda e: app.pad_menu(e, pid))
        c.bind("<Enter>", lambda e: self.set_hover(True))
        c.bind("<Leave>", lambda e: (self.set_hover(False), self.set_press(False)))

    def on_size(self, e):
        self.w = e.width
        self.drawn = None

    def on_down(self, _):
        self.set_press(True)
        self.app.trigger_id(self.pid)

    def set_press(self, on):
        self.press_to = 1.0 if on else 0.0

    def set_hover(self, on):
        self.hover = on

    def fire(self):
        self.flash, self.kick = 1.0, 1.0

    def step(self, look, playing, prog, loop, t):
        bg, fg, title, sub = look
        self.fill = lerp3(self.fill, rgb(bg), 0.28)
        self.fg = lerp3(self.fg, rgb(fg), 0.28)
        self.flash = self.flash * 0.8 if self.flash > 0.02 else 0.0
        self.kick = self.kick * 0.72 if self.kick > 0.02 else 0.0
        self.press += (self.press_to - self.press) * 0.5
        self.bar += ((1.0 if playing else 0.0) - self.bar) * 0.3
        if playing:
            self.prog = prog
        fill = lerp3(self.fill, WHITE, 0.5 * self.flash)
        if playing:
            glow = 0.45 + 0.25 * math.sin(t * 5.5) if loop else 0.45
            outline = hexc(lerp3(BLACK, WHITE, glow * self.bar))
        else:
            outline = INK
        push = 5 * max(self.press, self.kick)        # 0 = resting on shadow offset, 5 = pressed flat
        lift = 2 if self.hover and push < 0.5 else 0  # hover lifts the pad a little
        w, h = self.w, self.H
        sx1, sy1, sx2, sy2 = 7, 7, w - 2, h - 2          # shadow block
        x1, y1 = 2 + push - lift, 2 + push - lift
        x2, y2 = w - 7 + push - lift, h - 7 + push - lift
        bx1, bx2 = x1 + 10, x2 - 10
        bar_w = round((bx2 - bx1) * min(1.0, max(0.0, self.prog)))
        key = (w, round(push * 2), lift, hexc(fill), outline, hexc(self.fg), title, sub,
               round(self.bar * 30), bar_w)
        if key == self.drawn:
            return
        self.drawn = key
        c = self.c
        c.coords(self.shadow, *round_rect(sx1, sy1, sx2, sy2, 12))
        c.coords(self.shape, *round_rect(x1, y1, x2, y2, 12))
        c.itemconfig(self.shape, fill=hexc(fill), outline=outline)
        c.coords(self.title, (x1 + x2) / 2, (y1 + y2) / 2 - 7)
        c.itemconfig(self.title, text=title, fill=hexc(self.fg), width=max(40, w - 28))
        c.coords(self.sub, (x1 + x2) / 2, y2 - 17)
        c.itemconfig(self.sub, text=sub, fill=hexc(lerp3(self.fg, fill, 0.3)))
        c.coords(self.track, bx1, y2 - 8, bx2, y2 - 5)
        c.itemconfig(self.track, fill=hexc(lerp3(fill, BLACK, 0.35 * self.bar)))
        c.coords(self.barid, bx1, y2 - 8, bx1 + bar_w, y2 - 5)
        c.itemconfig(self.barid, fill=hexc(lerp3(fill, BLACK, 0.85 * self.bar)))


class App:
    def __init__(self, root):
        self.root = root
        self.engine = Engine()
        self.cfg = self.load_config()
        self.pads = self.cfg["pads"]
        self.cache, self.errors, self.loading = {}, {}, set()
        self.hotkey_handles, self.stop_handle = {}, None
        self.views, self._flash_q, self._playing = {}, [], set()
        self.empty = None
        self.dev_in, self.dev_out = {}, {}
        self.cols = 0
        self._status = ("", True)
        self.warn = ""  # device problem shown as a banner on the web page
        self.meter_val = {"mic": 0.0, "clips": 0.0}
        self._shown_status, self._status_fade = None, 0.0
        self._stop_bg = rgb(mix(PANEL, BAD, 0.45))

        self.build_ui()
        self.populate_devices()
        self.start_engine()
        self.rebuild_pads()
        self.register_hotkeys()
        for p in self.pads:
            self.load_async(p["path"])
        self.web = Web(self)  # QT Suite page + phone control (port 7791)
        self.web_ok = self.web.start()
        self.tick()

    # ------------------------------------------------------------------ config
    def load_config(self):
        cfg = dict(DEFAULTS)
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                cfg.update(json.load(f))
        except Exception:
            pass
        cfg["pads"] = [p for p in cfg.get("pads", []) if isinstance(p, dict) and p.get("path")]
        for p in cfg["pads"]:
            p.setdefault("id", uuid.uuid4().hex)
            p.setdefault("name", os.path.splitext(os.path.basename(p["path"]))[0])
            p.setdefault("hotkey", "")
            p.setdefault("volume", 1.0)
            p.setdefault("loop", False)
        return cfg

    def save(self):
        try:
            tmp = CONFIG_PATH + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(self.cfg, f, indent=2)
            os.replace(tmp, CONFIG_PATH)
        except Exception:
            pass

    # ---------------------------------------------------------------------- UI
    def build_ui(self):
        r = self.root
        r.configure(bg=BG)
        st = ttk.Style()
        st.theme_use("clam")
        st.configure("TCombobox", fieldbackground=PANEL, background=PANEL, foreground=FG,
                     arrowcolor=FG, bordercolor=CHIP, lightcolor=PANEL, darkcolor=PANEL,
                     selectbackground=PANEL, selectforeground=FG)
        st.map("TCombobox", fieldbackground=[("readonly", PANEL)], foreground=[("readonly", FG)],
               selectbackground=[("readonly", PANEL)], selectforeground=[("readonly", FG)])
        st.configure("Vertical.TScrollbar", background=CHIP, troughcolor=BG, bordercolor=BG,
                     arrowcolor=MUTED, lightcolor=CHIP, darkcolor=CHIP)
        st.map("Vertical.TScrollbar", background=[("disabled", BG), ("pressed", ACCENT), ("active", ACCENT_HI)],
               troughcolor=[("disabled", BG)], arrowcolor=[("disabled", BG)],
               lightcolor=[("disabled", BG)], darkcolor=[("disabled", BG)], bordercolor=[("disabled", BG)])
        st.configure("Soundboard.Horizontal.TScale", background=ACCENT, troughcolor="#0f0e12",
                     bordercolor=PANEL, lightcolor=ACCENT, darkcolor=ACCENT)
        st.map("Soundboard.Horizontal.TScale", background=[("active", ACCENT_HI)])
        r.option_add("*TCombobox*Listbox.background", PANEL)
        r.option_add("*TCombobox*Listbox.foreground", FG)
        r.option_add("*TCombobox*Listbox.selectBackground", ACCENT)
        r.option_add("*TCombobox*Listbox.selectForeground", ON_ACCENT)
        r.option_add("*TCombobox*Listbox.font", ("Segoe UI", 9))

        # ---- audio devices ----
        dev = tk.Frame(r, bg=PANEL)
        dev.pack(fill="x", padx=10, pady=(10, 4))
        self.api_var, self.mic_var = tk.StringVar(), tk.StringVar()
        self.out_var, self.mon_var = tk.StringVar(), tk.StringVar()
        self.cb = {}
        fields = [("Driver", self.api_var, "api", 18), ("Your mic", self.mic_var, "mic", 30),
                  ("Send to (virtual mic)", self.out_var, "out", 30),
                  ("Your headphones / speakers", self.mon_var, "mon", 30)]
        for c, (label, var, key, w) in enumerate(fields):
            tk.Label(dev, text=label, bg=PANEL, fg=MUTED, font=("Segoe UI", 8)).grid(
                row=0, column=c, sticky="w", padx=(10, 0), pady=(6, 0))
            cb = ttk.Combobox(dev, textvariable=var, state="readonly", width=w)
            cb.grid(row=1, column=c, sticky="ew", padx=(10, 0), pady=(0, 8))
            cb.bind("<<ComboboxSelected>>", self.on_api_change if key == "api" else self.on_dev_change)
            self.cb[key] = cb
            dev.columnconfigure(c, weight=1 if key != "api" else 0)
        tk.Button(dev, text="↻", command=self.on_refresh, bg=CHIP, fg=FG, bd=0, relief="flat",
                  activebackground=ACCENT, activeforeground=ON_ACCENT, width=3, cursor="hand2").grid(
            row=1, column=len(fields), padx=10, pady=(0, 8))
        self.status_lbl = tk.Label(dev, text="", bg=PANEL, fg=MUTED, anchor="w", font=("Segoe UI", 9))
        self.status_lbl.grid(row=2, column=0, columnspan=len(fields) + 1, sticky="ew", padx=10, pady=(0, 6))

        # ---- mix controls ----
        ctl = tk.Frame(r, bg=PANEL)
        ctl.pack(fill="x", padx=10, pady=4)
        self.v_mic_to_out = tk.BooleanVar(value=self.cfg["mic_to_out"])
        self.v_sounds_to_out = tk.BooleanVar(value=self.cfg["sounds_to_out"])
        self.v_sounds_to_mon = tk.BooleanVar(value=self.cfg["sounds_to_mon"])
        self.v_mic_to_mon = tk.BooleanVar(value=self.cfg["mic_to_mon"])
        self.v_on_top = tk.BooleanVar(value=self.cfg["on_top"])

        left = tk.Frame(ctl, bg=PANEL)
        left.pack(side="left", padx=10, pady=8)
        self.mic_meter = self.slider_row(left, 0, "Mic volume", 0, 200, self.cfg["mic_gain"], self.on_mic_gain)
        self.out_meter = self.slider_row(left, 1, "Clip volume", 0, 150, self.cfg["sound_gain"], self.on_sound_gain)

        mid = tk.Frame(ctl, bg=PANEL)
        mid.pack(side="left", padx=10, pady=8)
        for i, (text, var) in enumerate([
                ("Send my mic", self.v_mic_to_out), ("Send clips to mic", self.v_sounds_to_out),
                ("Hear clips myself", self.v_sounds_to_mon),
                ("Hear my mic myself (use headphones!)", self.v_mic_to_mon),
                ("Keep window on top", self.v_on_top)]):
            tk.Checkbutton(mid, text=text, variable=var, command=self.on_toggles, bg=PANEL, fg=FG,
                           selectcolor=BG, activebackground=PANEL, activeforeground=FG,
                           highlightthickness=0, font=("Segoe UI", 9), anchor="w").grid(
                row=i % 3, column=i // 3, sticky="w", padx=(0, 14))

        right = tk.Frame(ctl, bg=PANEL)
        right.pack(side="right", padx=10, pady=8, before=left)  # packed first so it never gets clipped
        self.stop_all_btn = tk.Button(right, text="■  STOP ALL", command=self.stop_all, bg=BAD, fg=ON_ACCENT,
                                      activebackground="#ff8a94", activeforeground=ON_ACCENT, bd=0,
                                      relief="flat", font=(DISPLAY, 11), padx=18, pady=8,
                                      cursor="hand2")
        self.stop_all_btn.pack(fill="x")
        self.stop_btn = tk.Button(right, command=self.set_stop_hotkey, bg=CHIP, fg=FG, bd=0,
                                  relief="flat", font=("Segoe UI", 8), cursor="hand2", pady=3,
                                  activebackground=ACCENT, activeforeground=ON_ACCENT)
        self.stop_btn.pack(fill="x", pady=(4, 0))
        self.stop_btn.bind("<Button-3>", lambda e: self.clear_stop_hotkey())
        self.refresh_stop_btn()

        # ---- pads ----
        bar = tk.Frame(r, bg=BG)
        bar.pack(fill="x", padx=10, pady=(6, 0))
        for text, cmd in (("＋ Add sounds", self.add_sounds), ("＋ Add folder", self.add_folder)):
            tk.Button(bar, text=text, command=cmd, bg=ACCENT, fg=ON_ACCENT, bd=0, relief="flat",
                      activebackground=ACCENT_HI, activeforeground=ON_ACCENT, font=("Segoe UI", 9, "bold"),
                      padx=12, pady=5, highlightthickness=2, highlightbackground=INK, cursor="hand2").pack(side="left", padx=(0, 6))
        tk.Label(bar, text="Right-click a pad for hotkey, volume, loop…   Middle-click stops it   Esc stops all",
                 bg=BG, fg=MUTED,
                 font=("Segoe UI", 9)).pack(side="left", padx=8)

        wrap = tk.Frame(r, bg=BG)
        wrap.pack(fill="both", expand=True, padx=10, pady=8)
        self.canvas = tk.Canvas(wrap, bg=BG, highlightthickness=0)
        vsb = ttk.Scrollbar(wrap, orient="vertical", command=self.canvas.yview)
        self.canvas.configure(yscrollcommand=vsb.set)
        vsb.pack(side="right", fill="y")
        self.canvas.pack(side="left", fill="both", expand=True)
        self.grid_frame = tk.Frame(self.canvas, bg=BG)
        self.win = self.canvas.create_window((0, 0), window=self.grid_frame, anchor="nw")
        self.canvas.bind("<Configure>", self.on_canvas_configure)
        self.grid_frame.bind("<Configure>", lambda e: self.canvas.configure(scrollregion=self.canvas.bbox("all")))
        r.bind_all("<MouseWheel>", self.on_wheel)

        self.hint = tk.Label(r, text="", bg=BG, fg=MUTED, font=("Segoe UI", 9), anchor="w")
        self.hint.pack(fill="x", padx=12, pady=(0, 8))
        r.attributes("-topmost", bool(self.cfg["on_top"]))
        r.bind("<Escape>", lambda e: self.stop_all())

    def slider_row(self, parent, row, label, lo, hi, val, cmd):
        tk.Label(parent, text=label, bg=PANEL, fg=FG, font=("Segoe UI", 9), width=11, anchor="w").grid(
            row=row, column=0, pady=2)
        sc = ttk.Scale(parent, from_=lo, to=hi, orient="horizontal", length=170,
                       style="Soundboard.Horizontal.TScale", command=lambda v: cmd(int(float(v))))
        sc.set(val)
        sc.grid(row=row, column=1, padx=6)
        sc.bind("<ButtonRelease-1>", lambda e: self.save())
        pct = tk.Label(parent, text="", bg=PANEL, fg=MUTED, font=("Segoe UI", 9), width=5, anchor="e")
        pct.grid(row=row, column=2)
        meter = tk.Canvas(parent, width=90, height=8, bg=BG, highlightthickness=0)
        meter.grid(row=row, column=3, padx=(6, 0))
        meter.fill = meter.create_rectangle(0, 0, 0, 8, width=0, fill=GOOD)
        meter.mark = meter.create_rectangle(0, 0, 0, 8, width=0, fill=BG)
        meter.hold, meter.hold_age = 0.0, 0
        sc.pct = pct
        meter.scale = sc
        cmd(val)
        pct.config(text=f"{val}%")
        meter.pct = pct
        return meter

    # ---- slider / toggle callbacks ----
    def on_mic_gain(self, v):
        self.cfg["mic_gain"] = v
        self.engine.mic_gain = v / 100
        if hasattr(self, "mic_meter"):
            self.mic_meter.pct.config(text=f"{v}%")

    def on_sound_gain(self, v):
        self.cfg["sound_gain"] = v
        self.engine.sound_gain = v / 100
        if hasattr(self, "out_meter"):
            self.out_meter.pct.config(text=f"{v}%")

    def on_toggles(self):
        e, c = self.engine, self.cfg
        e.mic_to_out = c["mic_to_out"] = self.v_mic_to_out.get()
        e.sounds_to_out = c["sounds_to_out"] = self.v_sounds_to_out.get()
        e.sounds_to_mon = c["sounds_to_mon"] = self.v_sounds_to_mon.get()
        e.mic_to_mon = c["mic_to_mon"] = self.v_mic_to_mon.get()
        c["on_top"] = self.v_on_top.get()
        self.root.attributes("-topmost", c["on_top"])
        self.save()

    # ----------------------------------------------------------------- devices
    def populate_devices(self):
        apis = hostapi_names()
        self.cb["api"]["values"] = apis
        api = self.cfg["api"] if self.cfg["api"] in apis else (apis[0] if apis else "")
        self.api_var.set(api)
        self.cfg["api"] = api
        self.fill_device_lists()
        self.on_toggles()

    def fill_device_lists(self):
        if not self.api_var.get():
            return
        ins, outs, def_in, def_out = devices_for(self.api_var.get())
        self.dev_in, self.dev_out = ins, outs
        self.cb["mic"]["values"] = [NONE] + list(ins)
        self.cb["out"]["values"] = [NONE] + list(outs)
        self.cb["mon"]["values"] = [NONE] + list(outs)
        cable = next((n for n in outs if "CABLE Input" in n), None)

        def pick(saved, table, default):
            if saved == NONE:
                return NONE
            if saved in table:
                return saved
            return default if default in table else NONE

        self.mic_var.set(pick(self.cfg["mic"], ins, def_in))
        self.out_var.set(pick(self.cfg["out"], outs, cable))
        self.mon_var.set(pick(self.cfg["mon"], outs, def_out))
        self.remember_devices()

    def remember_devices(self):
        self.cfg["mic"], self.cfg["out"], self.cfg["mon"] = (
            self.mic_var.get(), self.out_var.get(), self.mon_var.get())
        self.cfg["api"] = self.api_var.get()
        self.save()

    def on_api_change(self, _=None):
        self.cfg["api"] = self.api_var.get()
        self.fill_device_lists()
        self.start_engine()

    def on_dev_change(self, _=None):
        self.remember_devices()
        self.start_engine()

    def on_refresh(self):
        self.engine.stop()
        try:
            refresh_devices()
        except Exception:
            pass
        self.populate_devices()
        self.start_engine()

    def start_engine(self):
        def idx(table, var):
            return table.get(var.get()) if var.get() != NONE else None

        mic, out, mon = idx(self.dev_in, self.mic_var), idx(self.dev_out, self.out_var), idx(self.dev_out, self.mon_var)
        out_name = self.out_var.get()
        if "CABLE Input" in out_name:
            self.hint.config(text="In Discord / your game / OBS, set your microphone to:  "
                                  + out_name.replace("CABLE Input", "CABLE Output"))
        elif out_name != NONE:
            self.hint.config(text="In Discord / your game / OBS, set your microphone to the matching "
                                  "OUTPUT of your virtual cable.")
        else:
            self.hint.config(text="No virtual mic selected: clips only play to your headphones (preview mode).")
        self.warn = ""
        if mon is not None and mon == out:
            # opening the cable twice sends every clip into it twice (loud, phasey echo for friends)
            mon = None
            self.warn = ("Your headphones are set to the virtual cable, so you can't hear clips yourself. "
                         "Pick your real headphones or speakers under Audio devices.")
        elif out is not None and mon is None and not any("CABLE" not in n for n in self.dev_out):
            self.warn = "Windows only shows the virtual cable as an output. Plug in or enable your headphones, then Rescan."
        try:
            self.engine.start(mic=mic, out=out, mon=mon)
        except Exception as e:
            self.engine.stop()
            self.set_status(f"Audio failed to start: {e}   (try another Driver or device)", False)
            return
        if out is None and mon is None:
            self.set_status("Pick at least one output device.", False)
            return
        bits = []
        if out is not None:
            bits.append(f"sending to “{out_name}”")
        if mon is not None:
            bits.append("you hear clips on your headphones")
        self.set_status("●  Live  —  " + ", ".join(bits), True)

    def set_status(self, text, ok):
        self._status = (text, ok)  # rendered from tick() (thread-safe)

    # -------------------------------------------------------------------- pads
    def on_canvas_configure(self, e):
        self.canvas.itemconfigure(self.win, width=e.width)
        cols = max(1, e.width // 170)
        if cols != self.cols:
            self.cols = cols
            self.layout_pads()

    def on_wheel(self, e):
        bbox = self.canvas.bbox("all")
        if bbox and bbox[3] > self.canvas.winfo_height():
            self.canvas.yview_scroll(int(-e.delta / 120) * 2, "units")

    def pad_by_id(self, pid):
        return next((p for p in self.pads if p["id"] == pid), None)

    def rebuild_pads(self):
        """Sync pad views with self.pads. Existing pads keep their canvas (and their
        animation state), so only new pads fade in and reordered pads glide colour."""
        ids = {p["id"] for p in self.pads}
        for pid in [k for k in self.views if k not in ids]:
            self.views.pop(pid).c.destroy()
        for p in self.pads:
            if p["id"] not in self.views:
                self.views[p["id"]] = PadView(self, self.grid_frame, p["id"])
        if self.empty is not None:
            self.empty.destroy()
            self.empty = None
        if not self.pads:
            self.empty = tk.Label(self.grid_frame, bg=BG, fg=MUTED, font=("Segoe UI", 12),
                                  text="No sounds yet.\nClick “＋ Add sounds” and pick some .mp3 / .wav files.")
        self.layout_pads()

    def layout_pads(self):
        cols = max(1, self.cols)
        for c in range(30):
            self.grid_frame.columnconfigure(c, weight=0, uniform="")
        for c in range(cols):
            self.grid_frame.columnconfigure(c, weight=1, uniform="pad")
        for i, p in enumerate(self.pads):
            self.views[p["id"]].c.grid(row=i // cols, column=i % cols, sticky="ew", padx=2, pady=2)
        if self.empty:
            self.empty.grid(row=0, column=0, columnspan=cols, pady=60)

    def pad_look(self, i, p, t):
        """-> (background, text colour, title, small line) the pad should be heading toward."""
        col = PALETTE[i % len(PALETTE)]
        if p["path"] in self.errors:
            return mix(BG, BAD, 0.35), "#ffd0d4", "⚠ " + p["name"], "can't load file · right-click"
        if p["path"] in self.loading or p["path"] not in self.cache:
            return PANEL, MUTED, p["name"], "loading" + "." * (int(t * 3) % 4)
        extras = []
        if p["hotkey"]:
            extras.append(p["hotkey"].upper())
        if p["loop"]:
            extras.append("↻ loop")
        if round(p["volume"] * 100) != 100:
            extras.append(f"{round(p['volume'] * 100)}%")
        sub = "   ".join(extras)
        hover = self.views[p["id"]].hover
        if p["id"] in self._playing:
            return mix(col, "#ffffff", 0.18), ON_ACCENT, p["name"], sub
        return mix(BG, col, 0.92 if hover else 0.8), ON_ACCENT, p["name"], sub

    def animate_pads(self, t):
        self._playing = self.engine.playing_ids()
        prog = self.engine.progress()
        q, self._flash_q = self._flash_q, []
        for pid in q:
            v = self.views.get(pid)
            if v:
                v.fire()
        for i, p in enumerate(self.pads):
            v = self.views.get(p["id"])
            if v:
                v.step(self.pad_look(i, p, t), p["id"] in self._playing, prog.get(p["id"], 0.0),
                       p["loop"], t)

    def trigger_id(self, pid):
        pad = self.pad_by_id(pid)
        if pad:
            self.trigger(pad)

    def trigger(self, pad):
        """Play a pad. Safe to call from the hotkey thread (it only queues the flash)."""
        data = self.cache.get(pad["path"])
        if data is None:
            return
        eng = self.engine
        self._flash_q.append(pad["id"])
        if (pad["loop"] or self.cfg.get("tap_mode") == "stop") and eng.is_playing(pad["id"]):
            eng.stop_pad(pad["id"])
            return
        if not eng.play(pad["id"], data, pad["volume"], pad["loop"]):
            self.set_status("Audio isn't running. Pick your devices at the top.", False)

    def stop_pad(self, pid):
        self.engine.stop_pad(pid)

    def stop_all(self):
        self.engine.stop_all()

    def load_async(self, path):
        if path in self.cache or path in self.loading:
            return
        self.loading.add(path)
        self.errors.pop(path, None)

        def work():
            try:
                self.cache[path] = load_audio(path)
            except Exception as e:
                self.errors[path] = str(e)
            finally:
                self.loading.discard(path)

        threading.Thread(target=work, daemon=True).start()

    # --------------------------------------------------------------- add / edit
    def add_pad(self, path):
        self.pads.append({"id": uuid.uuid4().hex, "name": os.path.splitext(os.path.basename(path))[0],
                          "path": path, "hotkey": "", "volume": 1.0, "loop": False})
        self.load_async(path)

    def add_sounds(self):
        paths = filedialog.askopenfilenames(
            title="Add sounds", filetypes=[("Audio", " ".join("*" + e for e in AUDIO_EXT)), ("All files", "*.*")])
        for p in paths:
            self.add_pad(os.path.normpath(p))
        if paths:
            self.rebuild_pads()
            self.save()

    def add_folder(self):
        d = filedialog.askdirectory(title="Add every sound in a folder")
        if not d:
            return
        n = 0
        for name in sorted(os.listdir(d)):
            if name.lower().endswith(AUDIO_EXT):
                self.add_pad(os.path.normpath(os.path.join(d, name)))
                n += 1
        if n:
            self.rebuild_pads()
            self.save()
        else:
            messagebox.showinfo("Soundboard", "No audio files found in that folder.")

    def pad_menu(self, event, pid):
        pad = self.pad_by_id(pid)
        if not pad:
            return
        m = tk.Menu(self.root, tearoff=0, bg=PANEL, fg=FG, activebackground=ACCENT,
                    activeforeground="white", bd=0, font=("Segoe UI", 9))
        if pad["path"] in self.errors:
            m.add_command(label="Try loading again", command=lambda: self.reload(pad))
            m.add_command(label="Locate file…", command=lambda: self.locate(pad))
        else:
            m.add_command(label="Play / restart", command=lambda: self.trigger(pad))
        if self.engine.is_playing(pid):
            m.add_command(label="Stop", command=lambda: self.stop_pad(pid))
        m.add_separator()
        m.add_command(label="Rename…", command=lambda: self.rename(pad))
        m.add_command(label=("Hotkey: " + pad["hotkey"] + "  (change…)") if pad["hotkey"] else "Set hotkey…",
                      command=lambda: self.set_pad_hotkey(pad))
        if pad["hotkey"]:
            m.add_command(label="Clear hotkey", command=lambda: self.assign_hotkey(pad, ""))
        m.add_command(label=f"Volume…  ({round(pad['volume'] * 100)}%)", command=lambda: self.set_volume(pad))
        m._loop = tk.BooleanVar(value=pad["loop"])
        m.add_checkbutton(label="Loop until stopped", variable=m._loop,
                          command=lambda: self.set_loop(pad, m._loop.get()))
        m.add_separator()
        m.add_command(label="Move earlier", command=lambda: self.move(pad, -1))
        m.add_command(label="Move later", command=lambda: self.move(pad, 1))
        m.add_separator()
        m.add_command(label="Remove", command=lambda: self.remove(pad))
        m.tk_popup(event.x_root, event.y_root)

    def reload(self, pad):
        self.cache.pop(pad["path"], None)
        self.load_async(pad["path"])

    def locate(self, pad):
        path = filedialog.askopenfilename(
            title=f"Where is “{pad['name']}”?",
            filetypes=[("Audio", " ".join("*" + e for e in AUDIO_EXT)), ("All files", "*.*")])
        if path:
            self.errors.pop(pad["path"], None)
            pad["path"] = os.path.normpath(path)
            self.load_async(pad["path"])
            self.save()

    def rename(self, pad):
        name = simpledialog.askstring("Rename", "Pad name:", initialvalue=pad["name"], parent=self.root)
        if name and name.strip():
            pad["name"] = name.strip()
            self.rebuild_pads()
            self.save()

    def set_volume(self, pad):
        v = simpledialog.askinteger("Pad volume", "Volume for this pad (0–300 %):", parent=self.root,
                                    initialvalue=round(pad["volume"] * 100), minvalue=0, maxvalue=300)
        if v is not None:
            pad["volume"] = v / 100
            self.engine.set_volume(pad["id"], pad["volume"])
            self.save()

    def set_loop(self, pad, on):
        pad["loop"] = on
        if not on:
            self.engine.stop_pad(pad["id"])
        self.rebuild_pads()
        self.save()

    def move(self, pad, d):
        i = self.pads.index(pad)
        j = i + d
        if 0 <= j < len(self.pads):
            self.pads[i], self.pads[j] = self.pads[j], self.pads[i]
            self.rebuild_pads()
            self.save()

    def remove(self, pad):
        self.engine.stop_pad(pad["id"])
        self.pads.remove(pad)
        self.rebuild_pads()
        self.register_hotkeys()
        self.save()

    # ----------------------------------------------------------------- hotkeys
    def capture_hotkey(self, title, done):
        dlg = tk.Toplevel(self.root)
        dlg.title(title)
        dlg.configure(bg=PANEL)
        dlg.transient(self.root)
        dlg.resizable(False, False)
        tk.Label(dlg, text=f"{title}\n\nPress the key combination now…\n(Esc cancels)", bg=PANEL, fg=FG,
                 font=("Segoe UI", 11), padx=40, pady=8).pack(pady=(16, 0))
        dot = tk.Canvas(dlg, width=44, height=44, bg=PANEL, highlightthickness=0)
        dot.pack(pady=(0, 10))
        ring = dot.create_oval(22, 22, 22, 22, outline=ACCENT, width=2)
        core = dot.create_oval(16, 16, 28, 28, fill=ACCENT, width=0)
        t0 = time.monotonic()
        tk.Button(dlg, text="Cancel", command=dlg.destroy, bg=CHIP, fg=FG, bd=0, padx=14, pady=4,
                  activebackground=ACCENT, activeforeground=ON_ACCENT).pack(pady=(0, 16))
        dlg.geometry("+%d+%d" % (self.root.winfo_rootx() + 220, self.root.winfo_rooty() + 160))
        q = queue.Queue()

        def worker():
            try:
                q.put(keyboard.read_hotkey(suppress=False))
            except Exception:
                q.put(None)

        threading.Thread(target=worker, daemon=True).start()

        def poll():
            if not dlg.winfo_exists():
                return
            try:
                hk = q.get_nowait()
            except queue.Empty:
                # "listening" pulse: a ring that grows and fades out, once a second
                ph = (time.monotonic() - t0) % 1.0
                r = 6 + 14 * ph
                dot.coords(ring, 22 - r, 22 - r, 22 + r, 22 + r)
                dot.itemconfig(ring, outline=mix(ACCENT, PANEL, ph))
                k = 5 + 1.5 * math.sin(ph * 2 * math.pi)
                dot.coords(core, 22 - k, 22 - k, 22 + k, 22 + k)
                dlg.after(FRAME_MS, poll)
                return
            dlg.destroy()
            if hk and hk != "esc":
                done(hk)

        poll()

    def set_pad_hotkey(self, pad):
        self.capture_hotkey(f"Hotkey for “{pad['name']}”", lambda hk: self.assign_hotkey(pad, hk))

    def assign_hotkey(self, pad, hk):
        if hk:
            for other in self.pads:
                if other is not pad and other["hotkey"] == hk:
                    other["hotkey"] = ""
            if self.cfg["stop_hotkey"] == hk:
                self.cfg["stop_hotkey"] = ""
                self.refresh_stop_btn()
        pad["hotkey"] = hk
        self.rebuild_pads()
        self.register_hotkeys()
        self.save()

    def set_stop_hotkey(self):
        def done(hk):
            for p in self.pads:
                if p["hotkey"] == hk:
                    p["hotkey"] = ""
            self.cfg["stop_hotkey"] = hk
            self.refresh_stop_btn()
            self.rebuild_pads()
            self.register_hotkeys()
            self.save()

        self.capture_hotkey("Hotkey for STOP ALL", done)

    def clear_stop_hotkey(self):
        self.cfg["stop_hotkey"] = ""
        self.refresh_stop_btn()
        self.register_hotkeys()
        self.save()

    def refresh_stop_btn(self):
        hk = self.cfg["stop_hotkey"]
        self.stop_btn.config(text=f"Stop-all key: {hk.upper()}" if hk else "Set stop-all hotkey")

    def register_hotkeys(self):
        for h in list(self.hotkey_handles.values()) + ([self.stop_handle] if self.stop_handle else []):
            try:
                keyboard.remove_hotkey(h)
            except Exception:
                pass
        self.hotkey_handles, self.stop_handle = {}, None
        bad = []
        for p in self.pads:
            if p["hotkey"]:
                try:
                    self.hotkey_handles[p["id"]] = keyboard.add_hotkey(p["hotkey"], self.trigger_id, args=(p["id"],))
                except Exception:
                    p["hotkey"] = ""
                    bad.append(p["name"])
        if self.cfg["stop_hotkey"]:
            try:
                self.stop_handle = keyboard.add_hotkey(self.cfg["stop_hotkey"], self.stop_all)
            except Exception:
                self.cfg["stop_hotkey"] = ""
                self.refresh_stop_btn()
                bad.append("stop-all")
        if bad:
            self.set_status("Couldn't register hotkey for: " + ", ".join(bad), False)
            self.save()

    # -------------------------------------------------------------------- loop
    def tick(self):
        try:
            self.frame(time.monotonic())
        except Exception:
            traceback.print_exc()
        self.root.after(FRAME_MS, self.tick)

    def frame(self, t):
        self.web.drain()
        # status line: fades in whenever its text changes
        text, ok = self._status
        if (text, ok) != self._shown_status:
            self._shown_status, self._status_fade = (text, ok), 0.0
            self.status_lbl.config(text=text)
        if self._status_fade < 1.0:
            self._status_fade = min(1.0, self._status_fade + 0.12)
            self.status_lbl.config(fg=mix(PANEL, GOOD if ok else "#ff9ea1", self._status_fade))

        # level meters with a peak-hold tick
        peaks = self.engine.read_peaks()
        for meter, key in ((self.mic_meter, "mic"), (self.out_meter, "clips")):
            p = peaks[key]
            lvl = max(0.0, min(1.0, (20 * math.log10(p + 1e-6) + 60) / 60)) if p > 0 else 0.0
            self.meter_val[key] = max(lvl, self.meter_val[key] * 0.86)
            v = self.meter_val[key]
            if v >= meter.hold:
                meter.hold, meter.hold_age = v, 0
            else:
                meter.hold_age += 1
                if meter.hold_age > 24:  # hold ~0.8 s, then fall
                    meter.hold = max(v, meter.hold - 0.02)
            col = GOOD if v < 0.8 else ("#f5a524" if v < 0.95 else BAD)
            meter.coords(meter.fill, 0, 0, 90 * v, 8)
            meter.itemconfig(meter.fill, fill=col)
            x = 90 * meter.hold
            meter.coords(meter.mark, max(0, x - 2), 0, x, 8)
            meter.itemconfig(meter.mark, fill=BG if meter.hold < 0.02 else mix(BG, "#ffffff", 0.7))

        self.animate_pads(t)

        # STOP ALL glows only while something is playing
        target = rgb(BAD if self._playing else mix(PANEL, BAD, 0.45))
        self._stop_bg = lerp3(self._stop_bg, target, 0.25)
        bg = hexc(self._stop_bg)
        if bg != self.stop_all_btn.cget("bg"):
            self.stop_all_btn.config(bg=bg)

    def on_close(self):
        self.save()
        try:
            keyboard.unhook_all()
        except Exception:
            pass
        self.engine.stop()
        self.root.destroy()


def main():
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(1)
    except Exception:
        pass
    root = tk.Tk()
    root.title("Soundboard")
    root.geometry("1000x700")
    root.minsize(700, 460)
    try:
        app = App(root)
    except Exception:
        err = traceback.format_exc()
        with open(os.path.join(APP_DIR, "soundboard.log"), "w") as f:
            f.write(err)
        messagebox.showerror("Soundboard", "Couldn't start:\n\n" + err[-600:])
        return
    if "--hidden" in sys.argv:
        # started by QT Suite: the suite page is the face; the window can be shown from there.
        # Closing the window then only hides it, so hotkeys and the mic keep running.
        root.withdraw()
        root.protocol("WM_DELETE_WINDOW", root.withdraw)
    else:
        root.protocol("WM_DELETE_WINDOW", app.on_close)
    root.mainloop()


if __name__ == "__main__":
    main()
