"""One action engine for hotkeys, the phone stream deck and macros.

An action is a dict: {"type": ..., ...}
  open   {target}            file, folder or http(s) link
  run    {path, args?}        start a program
  keys   {combo}              e.g. "ctrl+shift+s"
  type   {text}               types the text
  media  {key}                playpause | next | prev | volup | voldown | mute
  tool   {id}                 open a QT Suite tool (or view) in the Suite window
  kit    {name, arg?}         a Toolkit command (see NAMED)
  macro  {id}                 run a saved macro
  wait   {ms}
  click  {x, y, button?}
"""
import os
import shlex
import subprocess
import threading
import time
import webbrowser

from . import common, winapi

NAMED = {}      # name -> (label, fn(arg))
MEDIA = {"playpause": "playpause", "next": "nexttrack", "prev": "prevtrack", "volup": "volumeup",
         "voldown": "volumedown", "mute": "mute", "stop": "stop"}


def register(name, label, fn):
    NAMED[name] = (label, fn)


def named_list():
    return [{"name": k, "label": v[0]} for k, v in sorted(NAMED.items(), key=lambda kv: kv[1][0])]


def describe(a):
    t = a.get("type")
    if t == "open":
        return "Open " + os.path.basename(str(a.get("target", "")).rstrip("\\/")) or str(a.get("target"))
    if t == "run":
        return "Run " + os.path.basename(str(a.get("path", "")))
    if t == "keys":
        return "Press " + str(a.get("combo", "")).upper()
    if t == "type":
        return "Type “" + str(a.get("text", ""))[:24] + "”"
    if t == "media":
        return {"playpause": "Play / pause", "next": "Next track", "prev": "Previous track", "volup": "Volume up",
                "voldown": "Volume down", "mute": "Mute"}.get(a.get("key"), "Media")
    if t == "tool":
        return "Open " + str(a.get("id", ""))
    if t == "kit":
        return NAMED.get(a.get("name"), (a.get("name", "?"),))[0]
    if t == "macro":
        return "Macro"
    if t == "wait":
        return f"Wait {a.get('ms', 0)} ms"
    if t == "click":
        return f"Click {a.get('x')},{a.get('y')}"
    return t or "?"


def run(a, depth=0):
    """Do one action. Returns (ok, message)."""
    if not isinstance(a, dict):
        return False, "bad action"
    t = a.get("type")
    try:
        if t == "open":
            target = str(a.get("target", "")).strip()
            if target.lower().startswith(("http://", "https://")):
                webbrowser.open(target)
            elif os.path.exists(target):
                os.startfile(target)
            else:
                return False, "not found: " + target
        elif t == "run":
            path = str(a.get("path", "")).strip().strip('"')
            if not os.path.exists(path):
                return False, "not found: " + path
            args = shlex.split(str(a.get("args", "")), posix=False)
            subprocess.Popen([path] + args, cwd=os.path.dirname(path) or None)
        elif t == "keys":
            winapi.press(a.get("combo", ""))
        elif t == "type":
            winapi.type_text(a.get("text", ""))
        elif t == "media":
            winapi.press(MEDIA.get(a.get("key"), "playpause"))
        elif t == "tool":
            import tray
            tray.show_suite(str(a.get("id", "")) or None)
        elif t == "kit":
            n = a.get("name")
            if n not in NAMED:
                return False, "unknown command " + str(n)
            r = NAMED[n][1](a.get("arg"))
            if isinstance(r, tuple):
                return r
        elif t == "macro":
            if depth > 3:
                return False, "macros nest too deep"
            from . import meta
            return meta.run_macro(a.get("id"), depth + 1)
        elif t == "wait":
            time.sleep(min(max(float(a.get("ms", 0)), 0), 60000) / 1000)
        elif t == "click":
            winapi.click(a.get("x", 0), a.get("y", 0), a.get("button", "left"), bool(a.get("double")))
        else:
            return False, "unknown action type " + str(t)
    except Exception as e:
        return False, str(e)
    return True, describe(a)


def run_bg(a):
    threading.Thread(target=run, args=(a,), daemon=True).start()


def balloon(title, msg, warn=False):
    try:
        import tray
        t = tray._app.get("tray") if isinstance(getattr(tray, "_app", None), dict) else None
        if t:
            t.balloon(title, msg, warn)
            return True
    except Exception:
        pass
    return False
