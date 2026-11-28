"""Meta: hotkeys, macros, plugins, auto-update, XP + achievements, streak calendar, universal search, share links."""
import datetime as dt
import importlib.util
import json
import math
import os
import re
import secrets
import shutil
import tempfile
import threading
import time
import urllib.request
import zipfile

import kit
from kit import actions, common, phone, winapi

HK = {"mgr": None, "result": {}}
DEFAULT_KEYS = [
    {"id": "k1", "combo": "ctrl+alt+f", "action": {"type": "kit", "name": "focus.toggle"}},
    {"id": "k2", "combo": "ctrl+alt+v", "action": {"type": "kit", "name": "clip.next"}},
    {"id": "k3", "combo": "ctrl+alt+r", "action": {"type": "kit", "name": "rec.toggle"}},
    {"id": "k4", "combo": "ctrl+alt+m", "action": {"type": "kit", "name": "widget.music"}},
    {"id": "k5", "combo": "ctrl+alt+p", "action": {"type": "kit", "name": "music.toggle"}},
    {"id": "k6", "combo": "ctrl+alt+g", "action": {"type": "kit", "name": "game.mode"}},
    {"id": "k7", "combo": "ctrl+alt+left", "action": {"type": "kit", "name": "snap.1"}},
    {"id": "k8", "combo": "ctrl+alt+right", "action": {"type": "kit", "name": "snap.2"}},
    {"id": "k9", "combo": "ctrl+alt+down", "action": {"type": "kit", "name": "snap.3"}},
    {"id": "k10", "combo": "ctrl+alt+up", "action": {"type": "kit", "name": "snap.next_layout"}},
    {"id": "k11", "combo": "ctrl+alt+q", "action": {"type": "tool", "id": "kit"}},
]


def init():
    try:
        if os.environ.get("QT_KIT_NO_HOTKEYS") == "1" or "QT_SUITE_PORT" in os.environ:
            raise RuntimeError("hotkeys off in test hubs")
        HK["mgr"] = winapi.Hotkeys(_fire)
        apply_keys()
    except Exception as e:
        HK["result"] = {"_": str(e)}
    _ensure_sample_plugin()
    threading.Thread(target=_update_loop, name="kit-update", daemon=True).start()
    common.event("suite.open")


# ===================================================================== 32. hotkeys ===
def keys():
    return common.load("hotkeys", {"binds": DEFAULT_KEYS})["binds"]


def apply_keys():
    if HK["mgr"]:
        HK["result"] = HK["mgr"].set({b["id"]: b["combo"] for b in keys() if b.get("on", True)})


def _fire(bid):
    b = next((x for x in keys() if x["id"] == bid), None)
    if b:
        ok, msg = actions.run(b["action"])
        common.event("hotkey", actions.describe(b["action"]))
        if not ok:
            actions.balloon("Hotkey didn't work", msg, warn=True)


@kit.hub_get("/api/kit/hotkeys")
def _hk(q):
    out = []
    for b in keys():
        out.append(dict(b, desc=actions.describe(b["action"]), status=HK["result"].get(b["id"], "off" if not b.get("on", True) else "?")))
    return 200, {"binds": out, "named": actions.named_list(), "macros": [{"id": m["id"], "name": m["name"]} for m in macros()]}


@kit.hub_post("/api/kit/hotkeys")
def _hk_set(b):
    if b.get("op") == "reset":
        common.save("hotkeys", {"binds": DEFAULT_KEYS})
    else:
        out = []
        for x in (b.get("binds") or [])[:60]:
            if not isinstance(x, dict) or not isinstance(x.get("action"), dict):
                continue
            combo = str(x.get("combo", "")).lower().replace(" ", "")
            try:
                winapi.Hotkeys.split(combo)
            except ValueError as e:
                return 400, {"ok": False, "msg": f"{combo or 'empty'}: {e}"}
            out.append({"id": re.sub(r"[^\w-]", "", str(x.get("id") or secrets.token_hex(3)))[:12] or secrets.token_hex(3),
                        "combo": combo, "action": x["action"], "on": bool(x.get("on", True))})
        combos = [o["combo"] for o in out]
        dup = next((c for c in combos if combos.count(c) > 1), None)
        if dup:
            return 400, {"ok": False, "msg": f"{dup} is used twice"}
        common.save("hotkeys", {"binds": out})
    apply_keys()
    return _hk({})


# ====================================================================== 21. macros ===
def macros():
    return common.load("macros", {"items": [
        {"id": "m1", "name": "Morning setup", "steps": [{"type": "tool", "id": "daily"}, {"type": "wait", "ms": 800},
                                                         {"type": "kit", "name": "widget.clock"}, {"type": "kit", "name": "focus.toggle"}]}]})["items"]


def run_macro(mid, depth=0):
    m = next((x for x in macros() if x["id"] == mid), None)
    if not m:
        return False, "no such macro"
    for i, step in enumerate(m["steps"][:200]):
        ok, msg = actions.run(step, depth)
        if not ok:
            return False, f"step {i + 1}: {msg}"
    common.event("macro.run", m["name"])
    return True, f"{m['name']} done ({len(m['steps'])} steps)"


@kit.hub_get("/api/kit/macros")
def _mac(q):
    items = macros()
    for m in items:
        m["descs"] = [actions.describe(s) for s in m["steps"]]
    return 200, {"items": items, "named": actions.named_list()}


@kit.hub_post("/api/kit/macros")
def _mac_set(b):
    op = b.get("op")
    items = macros()
    if op == "save":
        steps = [s for s in (b.get("steps") or []) if isinstance(s, dict) and s.get("type")][:200]
        m = {"id": re.sub(r"[^\w-]", "", str(b.get("id") or ""))[:12] or "m" + secrets.token_hex(3), "name": str(b.get("name") or "Macro")[:40], "steps": steps}
        items = [x for x in items if x["id"] != m["id"]] + [m]
    elif op == "del":
        items = [x for x in items if x["id"] != b.get("id")]
    elif op == "run":
        delay = min(float(b.get("delay") or 0), 10)
        threading.Thread(target=lambda: (time.sleep(delay), run_macro(b.get("id"))), daemon=True).start()
        return 200, {"ok": True}
    elif op == "cursor":
        time.sleep(min(float(b.get("delay") or 3), 10))
        x, y = winapi.cursor()
        return 200, {"ok": True, "x": x, "y": y}
    common.save("macros", {"items": items})
    return _mac({})


# ===================================================================== 22. plugins ===
PLUG_DIR = os.path.join(common.DATA, "..", "plugins")
PLUG_DIR = os.path.normpath(PLUG_DIR)
_plug_mods = {}


def _ensure_sample_plugin():
    d = os.path.join(PLUG_DIR, "hello")
    if os.path.isdir(PLUG_DIR):
        return
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, "plugin.json"), "w", encoding="utf-8") as f:
        json.dump({"name": "Hello plugin", "description": "A sample. Copy this folder to start your own.", "icon": "\U0001f44b",
                   "accent": "#c6ff3d", "entry": "index.html"}, f, indent=1)
    with open(os.path.join(d, "index.html"), "w", encoding="utf-8") as f:
        f.write("""<!doctype html><meta charset=utf-8><link rel=stylesheet href="/theme/qt.css">
<body class="qt" style="padding:28px"><h1 class="qt-display">Hello from a plugin</h1>
<p>This page lives in <code>%LOCALAPPDATA%\\QT Suite\\plugins\\hello</code>. Edit it and press Reload.</p>
<p>A plugin can also have a <code>plugin.py</code> with <code>def handle(path, body)</code>. It is called for
<code>/api/kit/plug/hello/...</code> once you trust the plugin in Toolkit &gt; Plugins.</p>
<button class="qt-btn primary" onclick="fetch('/api/kit/plug/hello/time',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(r=>r.json()).then(j=>out.textContent=JSON.stringify(j))">Ask plugin.py</button>
<pre id=out></pre></body>""")
    with open(os.path.join(d, "plugin.py"), "w", encoding="utf-8") as f:
        f.write("import time\n\n\ndef handle(path, body):\n    return {\"ok\": True, \"path\": path, \"time\": time.ctime()}\n")


def plugins():
    trust = common.load("plugtrust", {"trusted": []})["trusted"]
    out = []
    if os.path.isdir(PLUG_DIR):
        for name in sorted(os.listdir(PLUG_DIR)):
            mf = os.path.join(PLUG_DIR, name, "plugin.json")
            if not re.fullmatch(r"[\w-]{1,40}", name) or not os.path.isfile(mf):
                continue
            try:
                with open(mf, encoding="utf-8") as f:
                    m = json.load(f)
            except (OSError, ValueError):
                m = {"name": name, "error": "plugin.json isn't valid JSON"}
            out.append({"id": name, "name": str(m.get("name") or name)[:40], "description": str(m.get("description", ""))[:200],
                        "icon": str(m.get("icon", "\U0001f9e9"))[:4], "accent": m.get("accent", "#c6ff3d"),
                        "entry": f"/kit-plugins/{name}/{m.get('entry', 'index.html')}", "py": os.path.isfile(os.path.join(PLUG_DIR, name, "plugin.py")),
                        "trusted": name in trust, "error": m.get("error")})
    return out


@kit.hub_get("/api/kit/plugins")
def _plugs(q):
    return 200, {"items": plugins(), "folder": PLUG_DIR}


@kit.hub_post("/api/kit/plugins")
def _plugs_set(b):
    t = common.load("plugtrust", {"trusted": []})
    if b.get("op") == "trust":
        if b.get("on"):
            t["trusted"] = sorted(set(t["trusted"] + [b.get("id")]))
        else:
            t["trusted"] = [x for x in t["trusted"] if x != b.get("id")]
            _plug_mods.pop(b.get("id"), None)
        common.save("plugtrust", t)
    elif b.get("op") == "folder":
        os.makedirs(PLUG_DIR, exist_ok=True)
        os.startfile(PLUG_DIR)
    elif b.get("op") == "reload":
        _plug_mods.clear()
    return _plugs({})


def plugin_file(h, path):
    """GET /kit-plugins/<name>/<file>"""
    rel = path[len("/kit-plugins/"):]
    full = os.path.normpath(os.path.join(PLUG_DIR, rel))
    if os.path.commonpath([full, PLUG_DIR]) != PLUG_DIR or not os.path.isfile(full):
        kit._send(h, 404, {"error": "not found"})
        return
    import mimetypes
    with open(full, "rb") as f:
        kit._send(h, 200, f.read(), mimetypes.guess_type(full)[0] or "application/octet-stream")


def plugin_api(name, sub, body):
    if name not in common.load("plugtrust", {"trusted": []})["trusted"]:
        return 403, {"ok": False, "msg": "Trust this plugin in Toolkit > Plugins first"}
    py = os.path.join(PLUG_DIR, name, "plugin.py")
    if not os.path.isfile(py):
        return 404, {"ok": False}
    mod = _plug_mods.get(name)
    if not mod:
        spec = importlib.util.spec_from_file_location("qtplug_" + name, py)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        _plug_mods[name] = mod
    r = mod.handle(sub, body)
    return 200, r if isinstance(r, (dict, list)) else {"result": str(r)}


# ================================================================= 18. auto-update ===
VERSION_FILE = os.path.join(os.path.dirname(common.HERE), "VERSION")
UPD = {"t": 0, "info": None, "busy": ""}


def local_version():
    for p in (VERSION_FILE, os.path.join(os.path.dirname(os.path.dirname(common.HERE)), "VERSION")):
        try:
            with open(p, encoding="utf-8") as f:
                return f.read().strip()
        except OSError:
            pass
    return "1.0.0"


def _ver(s):
    return tuple(int(x) for x in re.findall(r"\d+", str(s))[:3]) or (0,)


def check_updates():
    from kit.phonefx import _gh_latest
    out = {"t": time.time(), "items": []}
    comps = [("QT Suite", "FlameBLIZZard/qt-suite", local_version(), r"Setup.*\.exe$"),
             ("scrcpy (phone mirror)", "Genymobile/scrcpy", common.load("scrcpy", {}).get("tag"), None),
             ("PresentMon (FPS overlay)", "GameTechDev/PresentMon", _pm_version(), None)]
    for name, repo, have, asset_re in comps:
        it = {"name": name, "repo": repo, "have": have or "not installed"}
        try:
            rel = _gh_latest(repo)
            it.update(latest=rel.get("tag_name"), url=rel.get("html_url"), notes=(rel.get("body") or "")[:600],
                      published=rel.get("published_at"))
            it["newer"] = bool(have) and _ver(rel.get("tag_name")) > _ver(have)
            if asset_re:
                a = next((a for a in rel.get("assets", []) if re.search(asset_re, a["name"], re.I)), None)
                if a:
                    it["asset"] = {"name": a["name"], "url": a["browser_download_url"], "size": a["size"]}
        except urllib.error.HTTPError as e:
            it["err"] = "no releases yet" if e.code == 404 else str(e)
        except Exception as e:
            it["err"] = str(e)[:120]
        out["items"].append(it)
    UPD.update(t=time.time(), info=out)
    return out


def _pm_version():
    from kit.games import presentmon
    p = presentmon()
    m = re.search(r"(\d+\.\d+\.\d+)", os.path.basename(p)) if p else None
    return m.group(1) if m else None


def _update_loop():
    time.sleep(120)
    while True:
        try:
            info = check_updates()
            newer = [i for i in info["items"] if i.get("newer")]
            seen = common.load("updseen", {"seen": []})
            fresh = [i for i in newer if f"{i['name']}{i['latest']}" not in seen["seen"]]
            if fresh:
                actions.balloon("Updates ready", ", ".join(f"{i['name']} {i['latest']}" for i in fresh) + ". Open Toolkit > Updates.")
                seen["seen"] = (seen["seen"] + [f"{i['name']}{i['latest']}" for i in fresh])[-50:]
                common.save("updseen", seen)
        except Exception:
            pass
        time.sleep(24 * 3600)


@kit.hub_get("/api/kit/updates")
def _upd(q):
    if not UPD["info"] or (q.get("fresh") or ["0"])[0] == "1":
        check_updates()
    return 200, dict(UPD["info"], busy=UPD["busy"], version=local_version())


@kit.hub_post("/api/kit/updates")
def _upd_post(b):
    name = b.get("name")
    if name.startswith("scrcpy"):
        from kit.phonefx import install_scrcpy
        threading.Thread(target=install_scrcpy, daemon=True).start()
        return 200, {"ok": True, "msg": "updating scrcpy"}
    if name.startswith("PresentMon"):
        from kit.games import install_presentmon
        threading.Thread(target=install_presentmon, daemon=True).start()
        return 200, {"ok": True, "msg": "updating PresentMon"}
    if name == "QT Suite":
        it = next((i for i in (UPD["info"] or {}).get("items", []) if i["name"] == "QT Suite"), None)
        if not it or not it.get("asset"):
            return 404, {"ok": False, "msg": "no installer in the latest release"}

        def go():
            UPD["busy"] = "downloading " + it["asset"]["name"]
            try:
                dest = os.path.join(common.HOME, "Downloads", it["asset"]["name"])
                req = urllib.request.Request(it["asset"]["url"], headers={"User-Agent": "QT-Suite"})
                with urllib.request.urlopen(req, timeout=300) as r, open(dest + ".part", "wb") as f:
                    shutil.copyfileobj(r, f)
                os.replace(dest + ".part", dest)
                UPD["busy"] = ""
                os.startfile(dest)   # the installer closes the hub itself and asks before replacing anything
            except Exception as e:
                UPD["busy"] = "failed: " + str(e)[:100]
        threading.Thread(target=go, daemon=True).start()
        return 200, {"ok": True, "msg": "downloading the installer; it opens when it's ready"}
    return 400, {"ok": False}


# ======================================================== 25 + 31. XP, streak calendar ===
XP = {"suite.open": 5, "focus.done": 0, "backup.ok": 15, "clean.done": 10, "rec.done": 15, "rec.gif": 10, "rec.trim": 5,
      "photos.batch": 15, "deck.press": 1, "clip.push": 2, "hotkey": 1, "macro.run": 5, "split.add": 10, "tm.snap": 3,
      "tm.restore": 20, "game.on": 5, "party.join": 10, "arcade.win": 15, "arcade.play": 5, "share.make": 5, "mirror.start": 5,
      "find.ring": 5, "widget.open": 3, "wall.on": 5, "snap.zone": 1, "music.play": 1, "deal.watch": 3, "plugin.open": 5, "feature.open": 2}
BADGES = [
    ("first", "Hello, Toolkit", "Open the Toolkit", lambda c, d: c.get("suite.open", 0) >= 1),
    ("focus1", "Deep work", "Finish a focus session", lambda c, d: c.get("focus.done", 0) >= 1),
    ("focus10", "Monk mode", "Finish 10 focus sessions", lambda c, d: c.get("focus.done", 0) >= 10),
    ("backup", "Safety net", "Run a backup", lambda c, d: c.get("backup.ok", 0) >= 1),
    ("clean", "Spring clean", "Run the cleaner", lambda c, d: c.get("clean.done", 0) >= 1),
    ("rec", "Director", "Make a screen recording", lambda c, d: c.get("rec.done", 0) >= 1),
    ("gif", "GIF lord", "Export a GIF", lambda c, d: c.get("rec.gif", 0) >= 1),
    ("photos", "Darkroom", "Batch-process photos", lambda c, d: c.get("photos.batch", 0) >= 1),
    ("deck", "Button masher", "Press 50 stream deck buttons", lambda c, d: c.get("deck.press", 0) >= 50),
    ("party", "Host with the most", "Have 3 friends join a party", lambda c, d: c.get("party.join", 0) >= 3),
    ("arcade", "Arcade champ", "Win an arcade game", lambda c, d: c.get("arcade.win", 0) >= 1),
    ("split", "Fair share", "Split a bill", lambda c, d: c.get("split.add", 0) >= 1),
    ("tm", "Time traveller", "Restore a file from the time machine", lambda c, d: c.get("tm.restore", 0) >= 1),
    ("macro", "Automator", "Run a macro", lambda c, d: c.get("macro.run", 0) >= 1),
    ("streak3", "On a roll", "Use the Suite 3 days in a row", lambda c, d: d >= 3),
    ("streak7", "Week warrior", "7-day streak", lambda c, d: d >= 7),
    ("streak30", "Habit formed", "30-day streak", lambda c, d: d >= 30),
    ("find", "Where did it go", "Ring your phone from the PC", lambda c, d: c.get("find.ring", 0) >= 1),
    ("wall", "Living room", "Turn on a live wallpaper", lambda c, d: c.get("wall.on", 0) >= 1),
    ("explorer", "Explorer", "Open 15 different Toolkit features", lambda c, d: c.get("_features", 0) >= 15),
]


def _streak(days):
    today = dt.date.today()
    n = 0
    d = today if today.isoformat() in days else today - dt.timedelta(days=1)
    while d.isoformat() in days:
        n += 1
        d -= dt.timedelta(days=1)
    best = run = 0
    prev = None
    for k in sorted(days):
        cur = dt.date.fromisoformat(k)
        run = run + 1 if prev and (cur - prev).days == 1 else 1
        best = max(best, run)
        prev = cur
    return n, best


def progress():
    ev = common.events()
    counts, xp, days, feats = {}, 0, {}, set()
    for e in ev:
        k = e["k"]
        counts[k] = counts.get(k, 0) + 1
        xp += e.get("xp", XP.get(k, 1 if k.startswith(("feature.", "find.", "game.")) else 0))
        day = dt.date.fromtimestamp(e["t"]).isoformat()
        days[day] = days.get(day, 0) + 1
        if k == "feature.open":
            feats.add(e.get("d"))
    counts["_features"] = len(feats)
    streak, best = _streak(days)
    level = int(math.sqrt(xp / 40)) + 1
    cur_floor, nxt = 40 * (level - 1) ** 2, 40 * level ** 2
    badges = [{"id": b[0], "name": b[1], "how": b[2], "got": bool(b[3](counts, max(streak, best)))} for b in BADGES]
    return {"xp": xp, "level": level, "into": xp - cur_floor, "need": nxt - cur_floor, "streak": streak, "best": best,
            "days": days, "badges": badges, "counts": counts}


@kit.hub_get("/api/kit/progress")
def _prog(q):
    return 200, progress()


# ========================================================== 28. temporary share links ===
def shares():
    s = common.load("shares", {"items": []})
    now = time.time()
    s["items"] = [i for i in s["items"] if i["exp"] > now and (not i.get("max") or i["count"] < i["max"])]
    return s


def _share_file(req):
    tok = req.path[3:].split("/")[0]
    s = shares()
    it = next((i for i in s["items"] if secrets.compare_digest(i["token"], tok or "-")), None)
    h = req.h
    if not it or not os.path.isfile(it["file"]):
        return h._out(404, "<h1 style='font-family:sans-serif'>This link has expired.</h1>", "text/html")
    if req.path.endswith("/dl") or it.get("direct"):
        it["count"] += 1
        common.save("shares", s)
        size = os.path.getsize(it["file"])
        name = it["name"].replace('"', "")
        h.send_response(200)
        h.send_header("Content-Type", "application/octet-stream")
        h.send_header("Content-Disposition", f'attachment; filename="{name}"')
        h.send_header("Content-Length", str(size))
        h.end_headers()
        with open(it["file"], "rb") as f:
            shutil.copyfileobj(f, h.wfile, 1 << 16)
        return None
    left = int((it["exp"] - time.time()) / 60)
    page = f"""<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>{_e(it['name'])}</title><link rel=stylesheet href="/assets/phone.css"><body class="ph">
<main class="ph-card share"><div class="eyebrow">Shared from QT Suite</div><h1>{_e(it['name'])}</h1>
<p>{common.human(os.path.getsize(it['file']))} &middot; link ends in {left // 60}h {left % 60}m</p>
<a class="ph-btn big" href="/s/{tok}/dl">Download</a></main></body>"""
    return h._out(200, page, "text/html; charset=utf-8")


def _e(s):
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


phone.PUBLIC["/s/"] = _share_file


@kit.hub_get("/api/kit/shares")
def _sh(q):
    s = shares()
    common.save("shares", s)
    ts = phone.tailscale_ip()
    out = []
    for i in s["items"]:
        base = {"lan": f"http://{phone.lan_ip()}:{phone.PARTY_PORT}/s/{i['token']}"}
        if ts:
            base["tailscale"] = f"http://{ts}:{phone.PARTY_PORT}/s/{i['token']}"
        out.append(dict({k: v for k, v in i.items() if k != "file"}, path=i["file"], links=base, left=int(i["exp"] - time.time())))
    return 200, {"items": out, "tailscale": bool(ts)}


@kit.hub_post("/api/kit/shares")
def _sh_set(b):
    s = shares()
    if b.get("op") == "add":
        p = str(b.get("path", "")).strip().strip('"')
        if not os.path.exists(p):
            return 400, {"ok": False, "msg": "file not found"}
        name = os.path.basename(p.rstrip("\\/"))
        if os.path.isdir(p):   # folders go out as a zip made now
            tmp = os.path.join(common.DATA, "share-zips")
            os.makedirs(tmp, exist_ok=True)
            z = os.path.join(tmp, f"{name}-{secrets.token_hex(3)}.zip")
            with zipfile.ZipFile(z, "w", zipfile.ZIP_DEFLATED) as zf:
                for d, _, fs in os.walk(p):
                    for f in fs:
                        fp = os.path.join(d, f)
                        zf.write(fp, os.path.relpath(fp, os.path.dirname(p)))
            p, name = z, name + ".zip"
        mins = max(5, min(int(b.get("minutes") or 60), 7 * 24 * 60))
        s["items"].append({"token": secrets.token_urlsafe(12), "file": p, "name": name, "exp": time.time() + mins * 60,
                           "max": max(0, min(int(b.get("max") or 0), 1000)), "count": 0, "t": time.time()})
        common.event("share.make", name)
    elif b.get("op") == "del":
        s["items"] = [i for i in s["items"] if i["token"] != b.get("token")]
    common.save("shares", s)
    return _sh({})


# ============================================================ 20. universal search ===
@kit.hub_get("/api/kit/search")
def _search(q):
    term = (q.get("q") or [""])[0].strip().lower()
    if len(term) < 2:
        return 200, {"groups": []}
    words = term.split()

    def hit(*texts):
        t = " ".join(str(x or "") for x in texts).lower()
        return all(w in t for w in words)
    groups = []

    def add(name, items):
        if items:
            groups.append({"name": name, "items": items[:8]})
    from kit import money, media, phonefx
    st, _ = money.kharcha()
    if st:
        cats = {c["id"]: c for c in st.get("cats", [])}
        add("Kharcha", [{"title": f"{c.get('emoji', '')} {t.get('note') or cats.get(t.get('cat'), {}).get('name', '')}",
                         "sub": f"₹{t.get('amt')} · " + dt.datetime.fromtimestamp(t['ts'] / 1000).strftime('%d %b'), "go": "kharcha"}
                        for t in sorted(st.get("tx", []), key=lambda t: -t["ts"]) for c in [cats.get(t.get("cat"), {})]
                        if hit(t.get("note"), c.get("name"), t.get("amt"))])
    add("Music", [{"title": t["title"], "sub": t["artist"] or t["album"], "go": "kit/music", "play": t["id"]}
                  for t in (media.LIB["tracks"] or []) if hit(t["title"], t["artist"], t["album"])])
    add("Clipboard stack", [{"title": c["text"][:80], "sub": "from " + c["src"], "go": "kit/clips", "copy": c["id"]}
                            for c in reversed(phonefx._stack()["items"]) if hit(c["text"])])
    add("Stream deck", [{"title": b["label"], "sub": actions.describe(b["action"]), "go": "kit/deck", "run": b["action"]}
                        for b in phonefx.deck()["buttons"] if hit(b["label"])])
    add("Macros", [{"title": m["name"], "sub": f"{len(m['steps'])} steps", "go": "kit/macros", "run": {"type": "macro", "id": m["id"]}}
                   for m in macros() if hit(m["name"])])
    add("Commands", [{"title": n["label"], "sub": "Toolkit command", "run": {"type": "kit", "name": n["name"]}}
                     for n in actions.named_list() if hit(n["label"], n["name"])])
    add("Recordings", [{"title": f, "sub": "Videos\\QT Recordings", "go": "kit/recorder"}
                       for f in (os.listdir(media.VIDS) if os.path.isdir(media.VIDS) else []) if hit(f)])
    try:
        from kit import games
        lib = games._lp("/api/library", timeout=2)
        add("Games", [{"title": g["name"], "sub": f"{g.get('source')} · {round((g.get('minutes') or 0) / 60, 1)} h played", "go": "kit/games",
                       "game": g["id"]} for g in lib.get("games", []) if g.get("kind") == "game" and hit(g["name"])])
    except Exception:
        pass
    add("Backups", [{"title": j["name"], "sub": ", ".join(j["src"])[:80], "go": "kit/backup"}
                    for j in common.load("backups", {"jobs": []})["jobs"] if hit(j["name"], *j["src"])])
    add("Plugins", [{"title": p["name"], "sub": p["description"], "go": "kit/plugins"} for p in plugins() if hit(p["name"], p["description"])])
    for name, fname, field in (("Notes", "spark.json", "notes"), ("To-dos", "nova.json", "todos")):
        try:
            with open(os.path.join(os.path.dirname(common.DATA), fname), encoding="utf-8") as f:
                rows = json.load(f).get(field) or []
            add(name, [{"title": str(r.get("text") or r.get("title") or r.get("body") or "")[:80], "sub": name}
                       for r in rows if isinstance(r, dict) and hit(r.get("text"), r.get("title"), r.get("body"))])
        except (OSError, ValueError):
            pass
    return 200, {"groups": groups}
