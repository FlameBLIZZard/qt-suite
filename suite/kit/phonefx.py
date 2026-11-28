"""Phone features: webcam + mic, find my phone, clipboard stack, stream deck, scrcpy mirror."""
import io
import json
import os
import re
import secrets
import threading
import time
import urllib.request
import zipfile

import kit
from kit import actions, common, phone, winapi

# =============================================================== 1. webcam / mic ===
CAM = {"frame": None, "t": 0, "n": 0, "fps": 0.0, "cv": threading.Condition(), "w": 0, "h": 0}
MIC = {"out": None, "dev": None, "t": 0, "bytes": 0, "lock": threading.Lock(), "level": 0}


@phone.route("POST", "/api/cam/frame")
def _frame(req):
    b = req.body
    if not b.startswith(b"\xff\xd8"):
        return 400, {"ok": False, "msg": "send a JPEG"}
    with CAM["cv"]:
        now = time.time()
        dt = now - CAM["t"] if CAM["t"] else 0
        if 0 < dt < 2:
            CAM["fps"] = CAM["fps"] * 0.85 + (1 / dt) * 0.15
        CAM.update(frame=b, t=now, n=CAM["n"] + 1)
        CAM["cv"].notify_all()
    return 200, {"ok": True, "n": CAM["n"]}


@kit.raw_get("/api/kit/cam.mjpg")
def _mjpg(h, q):
    h.send_response(200)
    h.send_header("Content-Type", "multipart/x-mixed-replace; boundary=qtframe")
    h.send_header("Cache-Control", "no-store")
    h.end_headers()
    last = -1
    idle = time.time()
    while True:
        with CAM["cv"]:
            CAM["cv"].wait_for(lambda: CAM["n"] != last, timeout=5)
            frame, n = CAM["frame"], CAM["n"]
        if n == last or frame is None:
            if time.time() - idle > 600:
                return
            frame = _placeholder()
        else:
            idle = time.time()
        last = n
        try:
            h.wfile.write(b"--qtframe\r\nContent-Type: image/jpeg\r\nContent-Length: " + str(len(frame)).encode() + b"\r\n\r\n" + frame + b"\r\n")
            h.wfile.flush()
        except OSError:
            return


_ph = {}


def _placeholder():
    if "jpg" not in _ph:
        try:
            from PIL import Image, ImageDraw
            im = Image.new("RGB", (640, 360), (22, 20, 26))
            d = ImageDraw.Draw(im)
            d.rectangle([20, 20, 619, 339], outline=(198, 255, 61), width=4)
            d.text((200, 170), "Waiting for the phone camera...", fill=(240, 236, 228))
            buf = io.BytesIO()
            im.save(buf, "JPEG", quality=70)
            _ph["jpg"] = buf.getvalue()
        except Exception:
            _ph["jpg"] = b""
    return _ph["jpg"]


@kit.hub_get("/api/kit/cam.jpg")
def _jpg(q):
    return 200, CAM["frame"] or _placeholder(), "image/jpeg"


@kit.hub_get("/api/kit/cam")
def _cam_status(q):
    live = time.time() - CAM["t"] < 3
    return 200, {"live": live, "fps": round(CAM["fps"], 1) if live else 0, "frames": CAM["n"],
                 "mic": {"live": time.time() - MIC["t"] < 3, "dev": MIC["dev"], "level": MIC["level"],
                         "devices": [n for _, n in winapi.out_devices()]},
                 "obs": _obs_state(), "urls": phone.urls("/cam")}


@kit.hub_post("/api/kit/cam/ctl")
def _cam_ctl(b):
    """Tell the phone page to switch camera / quality / start / stop."""
    keep = {k: b[k] for k in ("facing", "quality", "size", "run", "torch") if k in b}
    phone.phone_box.push("cam", **keep)
    return 200, {"ok": True}


def _mic_dev():
    want = common.load("kitprefs", {}).get("mic_out") or "CABLE Input"
    for i, n in winapi.out_devices():
        if want.lower() in n.lower():
            return i, n
    return -1, "Default speakers"


@phone.route("POST", "/api/mic/pcm")
def _pcm(req):
    with MIC["lock"]:
        if MIC["out"] is None or time.time() - MIC["t"] > 5:
            if MIC["out"]:
                MIC["out"].close()
            i, n = _mic_dev()
            MIC["out"], MIC["dev"] = winapi.PcmOut(i, 16000), n
        MIC["t"] = time.time()
        MIC["bytes"] += len(req.body)
        pcm = req.body[: len(req.body) // 2 * 2]
        if pcm:
            import array
            a = array.array("h", pcm)
            MIC["level"] = round(min(1.0, max(abs(min(a)), abs(max(a))) / 32767), 2)
        MIC["out"].write(pcm)
    return 200, {"ok": True, "dev": MIC["dev"]}


@kit.hub_post("/api/kit/cam/micdev")
def _micdev(b):
    p = common.load("kitprefs", {})
    p["mic_out"] = str(b.get("name", ""))[:60]
    common.save("kitprefs", p)
    with MIC["lock"]:
        if MIC["out"]:
            MIC["out"].close()
        MIC["out"] = None
    return 200, {"ok": True}


OBS_SCENES = os.path.join(os.environ.get("APPDATA", ""), "obs-studio", "basic", "scenes")


def _obs_state():
    return {"installed": os.path.isdir(r"C:\Program Files\obs-studio"),
            "scene": os.path.exists(os.path.join(OBS_SCENES, "QT_Phone_Cam.json"))}


@kit.hub_post("/api/kit/cam/obs")
def _obs(b):
    """Write an OBS scene collection whose only source is the phone camera page."""
    if not os.path.isdir(OBS_SCENES):
        return 404, {"ok": False, "msg": "OBS hasn't been run yet. Open OBS once, then try again."}
    url = f"http://127.0.0.1:{kit.INFO['port']}/kit/cam.html"
    src = {"id": "browser_source", "versioned_id": "browser_source", "name": "Phone camera", "uuid": "8c1f2c7e-5d55-4b1d-9c5e-a10000000001",
           "settings": {"url": url, "width": 1280, "height": 720, "fps": 30, "reroute_audio": False, "shutdown": False}, "enabled": True}
    scene = {"id": "scene", "versioned_id": "scene", "name": "Phone cam", "uuid": "8c1f2c7e-5d55-4b1d-9c5e-a10000000002",
             "settings": {"items": [{"name": "Phone camera", "source_uuid": src["uuid"], "visible": True, "id": 1,
                                     "pos": {"x": 0, "y": 0}, "scale": {"x": 1, "y": 1}, "bounds_type": 2,
                                     "bounds": {"x": 1280, "y": 720}, "bounds_align": 0}], "id_counter": 1}}
    coll = {"name": "QT Phone Cam", "current_scene": "Phone cam", "current_program_scene": "Phone cam",
            "scene_order": [{"name": "Phone cam"}], "sources": [scene, src], "groups": [], "transitions": [],
            "current_transition": "Fade", "transition_duration": 300}
    with open(os.path.join(OBS_SCENES, "QT_Phone_Cam.json"), "w", encoding="utf-8") as f:
        json.dump(coll, f, indent=1)
    return 200, {"ok": True, "msg": "In OBS: Scene Collection > QT Phone Cam, then Start Virtual Camera."}


@kit.hub_post("/api/kit/cam/openobs")
def _openobs(b):
    exe = r"C:\Program Files\obs-studio\bin\64bit\obs64.exe"
    if not os.path.exists(exe):
        return 404, {"ok": False, "msg": "OBS isn't installed"}
    args = [exe, "--collection", "QT Phone Cam", "--scene", "Phone cam"]
    if b.get("virtual", True):
        args.append("--startvirtualcam")
    import subprocess
    subprocess.Popen(args, cwd=os.path.dirname(exe))
    common.event("cam.obs")
    return 200, {"ok": True, "msg": "OBS is starting with the phone camera as a virtual webcam"}


# =============================================================== 2. find my phone ===
FIND = {"loc": None, "rang": 0, "reply": {}}


def _adb_devices():
    exe = common.adb()
    if not exe:
        return []
    code, out = common.run([exe, "devices", "-l"], timeout=8)
    devs = []
    for line in out.splitlines()[1:]:
        m = re.match(r"(\S+)\s+device\b(.*)", line)
        if m:
            model = re.search(r"model:(\S+)", m.group(2))
            devs.append({"serial": m.group(1), "model": (model.group(1) if model else m.group(1)).replace("_", " ")})
    return devs


def _adb(serial, *cmd, timeout=15):
    return common.run([common.adb(), "-s", serial, *cmd], timeout=timeout)


@kit.hub_get("/api/kit/find")
def _find_status(q):
    return 200, {"adb": _adb_devices(), "loc": FIND["loc"], "web": phone.status()["phones"] > 0,
                 "urls": phone.urls("/find")}


@kit.hub_post("/api/kit/find")
def _find(b):
    what, serial = b.get("what"), b.get("serial")
    if what not in ("ring", "stop", "locate", "lock", "message"):
        return 400, {"ok": False, "msg": "unknown"}
    phone.phone_box.push("find", act=what, text=str(b.get("text", ""))[:200])
    out = {"ok": True, "web": True}
    if serial and serial in [d["serial"] for d in _adb_devices()]:
        out["adb"] = _adb_find(serial, what, str(b.get("text", ""))[:200])
    common.event("find." + what)
    return 200, out


RING_FILES = "/system/media/audio/ringtones /product/media/audio/ringtones /system/product/media/audio/ringtones /system/media/audio/alarms"


def _adb_find(serial, what, text=""):
    if what == "ring":
        _adb(serial, "shell", "input", "keyevent", "224")   # wake
        for s in ("3", "4", "2"):
            _adb(serial, "shell", "media", "volume", "--stream", s, "--set", "15")
            _adb(serial, "shell", "cmd", "media_session", "volume", "--stream", s, "--set", "15")
        code, out = _adb(serial, "shell", f"for d in {RING_FILES}; do ls $d/* 2>/dev/null; done | head -40")
        files = [f for f in out.split() if f.lower().endswith((".ogg", ".mp3", ".wav"))]
        pick = next((f for f in files if re.search(r"alarm|ring|bell|loud", f, re.I)), files[0] if files else None)
        if not pick:
            return "no ringtone files found"
        _adb(serial, "shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", "file://" + pick, "-t", "audio/*")
        return "ringing " + os.path.basename(pick)
    if what == "stop":
        _adb(serial, "shell", "input", "keyevent", "86")    # MEDIA_STOP
        _adb(serial, "shell", "input", "keyevent", "4")
        return "stopped"
    if what == "locate":
        code, out = _adb(serial, "shell", "dumpsys", "location")
        best = None
        for m in re.finditer(r"Location\[(\w+) (-?\d+\.\d+),(-?\d+\.\d+).*?(?:hAcc=([\d.]+))?.*?(?:et=\+?([\dhmsd]+))?", out):
            best = best or {"src": "adb " + m.group(1), "lat": float(m.group(2)), "lon": float(m.group(3)),
                            "acc": float(m.group(4)) if m.group(4) else None, "t": time.time()}
            if m.group(1) in ("fused", "gps"):
                best = {"src": "adb " + m.group(1), "lat": float(m.group(2)), "lon": float(m.group(3)),
                        "acc": float(m.group(4)) if m.group(4) else None, "t": time.time()}
                break
        if best:
            FIND["loc"] = best
            return f"{best['lat']:.5f}, {best['lon']:.5f}"
        return "no location yet (turn on Location on the phone)"
    if what == "lock":
        code, out = _adb(serial, "shell", "dumpsys", "power")
        if "mWakefulness=Awake" in out:
            _adb(serial, "shell", "input", "keyevent", "223")   # SLEEP locks a phone with a screen lock
        return "locked"
    if what == "message":
        _adb(serial, "shell", "input", "keyevent", "224")
        _adb(serial, "shell", "cmd", "notification", "post", "-S", "bigtext", "-t", "QT Suite", "qtfind", text or "If found, please call the owner")
        return "message shown"
    return ""


@phone.route("POST", "/api/find/loc")
def _find_loc(req):
    j = req.json()
    try:
        FIND["loc"] = {"src": "phone page", "lat": float(j["lat"]), "lon": float(j["lon"]),
                       "acc": float(j.get("acc") or 0), "t": time.time(), "bat": j.get("bat")}
    except (KeyError, ValueError, TypeError):
        return 400, {"ok": False}
    return 200, {"ok": True}


# =========================================================== 3. clipboard stack ===
def _stack():
    return common.load("clipstack", {"items": []})


def _push_clip(text, src):
    text = str(text)[:20000]
    if not text.strip():
        return None
    s = _stack()
    it = {"id": secrets.token_hex(4), "text": text, "src": src, "t": time.time()}
    s["items"] = (s["items"] + [it])[-60:]
    common.save("clipstack", s)
    common.event("clip.push", src)
    return it


@phone.route("POST", "/api/clip")
def _phone_clip(req):
    it = _push_clip(req.json().get("text", ""), "phone")
    if it and common.load("kitprefs", {}).get("clip_autocopy", True):
        winapi.set_clip(it["text"])
    return 200, {"ok": bool(it)}


@phone.route("GET", "/api/clip/pc")
def _pc_clip(req):
    return 200, {"text": winapi.get_clip()[:20000]}


@kit.hub_get("/api/kit/clips")
def _clips(q):
    p = common.load("kitprefs", {})
    return 200, dict(_stack(), autocopy=p.get("clip_autocopy", True), urls=phone.urls("/clip"))


@kit.hub_post("/api/kit/clips")
def _clips_do(b):
    s = _stack()
    op = b.get("op")
    if op == "add":
        _push_clip(b.get("text", ""), "pc")
    elif op == "copy":
        it = next((i for i in s["items"] if i["id"] == b.get("id")), None)
        if it:
            winapi.set_clip(it["text"])
    elif op == "del":
        s["items"] = [i for i in s["items"] if i["id"] != b.get("id")]
        common.save("clipstack", s)
    elif op == "clear":
        common.save("clipstack", {"items": []})
    elif op == "next":
        return 200, {"ok": paste_next()[0]}
    elif op == "all":
        winapi.set_clip("\n".join(i["text"] for i in s["items"]))
    elif op == "autocopy":
        p = common.load("kitprefs", {})
        p["clip_autocopy"] = bool(b.get("on"))
        common.save("kitprefs", p)
    elif op == "tophone":
        phone.phone_box.push("clip", text=winapi.get_clip()[:20000])
    return _clips({})


def paste_next(_=None):
    """Take the oldest stacked clip, put it on the clipboard and paste it (Ctrl+V)."""
    s = _stack()
    if not s["items"]:
        return False, "clipboard stack is empty"
    it = s["items"].pop(0)
    common.save("clipstack", s)
    winapi.set_clip(it["text"])
    time.sleep(0.05)
    winapi.press("ctrl+v")
    return True, f"pasted ({len(s['items'])} left)"


actions.register("clip.next", "Paste next from clipboard stack", paste_next)


# =============================================================== 4. stream deck ===
DEFAULT_DECK = {"cols": 3, "buttons": [
    {"id": "b1", "label": "Play / pause", "icon": "\u23ef", "color": "#c6ff3d", "action": {"type": "media", "key": "playpause"}},
    {"id": "b2", "label": "Next", "icon": "\u23ed", "color": "#4dc3ff", "action": {"type": "media", "key": "next"}},
    {"id": "b3", "label": "Mute", "icon": "\U0001f507", "color": "#ff5fa2", "action": {"type": "media", "key": "mute"}},
    {"id": "b4", "label": "Vol -", "icon": "\U0001f509", "color": "#b28bff", "action": {"type": "media", "key": "voldown"}},
    {"id": "b5", "label": "Vol +", "icon": "\U0001f50a", "color": "#b28bff", "action": {"type": "media", "key": "volup"}},
    {"id": "b6", "label": "Screenshot", "icon": "\U0001f4f8", "color": "#ffc93d", "action": {"type": "keys", "combo": "win+shift+s"}},
    {"id": "b7", "label": "Focus", "icon": "\U0001f3af", "color": "#5dffb0", "action": {"type": "kit", "name": "focus.toggle"}},
    {"id": "b8", "label": "Show desktop", "icon": "\U0001f5a5", "color": "#2ee6d6", "action": {"type": "keys", "combo": "win+d"}},
    {"id": "b9", "label": "QT Suite", "icon": "\u25a3", "color": "#ff8a3d", "action": {"type": "tool", "id": "home"}},
]}


def deck():
    return common.load("deck", DEFAULT_DECK)


@phone.route("GET", "/api/deck")
def _phone_deck(req):
    d = deck()
    return 200, {"cols": d["cols"], "buttons": [{k: b.get(k) for k in ("id", "label", "icon", "color")} for b in d["buttons"]]}


@phone.route("POST", "/api/deck/press")
def _press(req):
    bid = req.json().get("id")
    b = next((x for x in deck()["buttons"] if x["id"] == bid), None)
    if not b:
        return 404, {"ok": False}
    ok, msg = actions.run(b.get("action") or {})
    common.event("deck.press", b.get("label", ""))
    return 200, {"ok": ok, "msg": msg}


@kit.hub_get("/api/kit/deck")
def _deck_get(q):
    d = deck()
    for b in d["buttons"]:
        b["desc"] = actions.describe(b.get("action") or {})
    return 200, dict(d, urls=phone.urls("/deck"), named=actions.named_list())


@kit.hub_post("/api/kit/deck")
def _deck_set(b):
    cols = int(b.get("cols") or 3)
    out = []
    for x in (b.get("buttons") or [])[:48]:
        if not isinstance(x, dict) or not isinstance(x.get("action"), dict):
            continue
        out.append({"id": re.sub(r"[^\w-]", "", str(x.get("id") or secrets.token_hex(3)))[:12] or secrets.token_hex(3),
                    "label": str(x.get("label", ""))[:30], "icon": str(x.get("icon", ""))[:4],
                    "color": x.get("color") if re.fullmatch(r"#[0-9a-fA-F]{6}", str(x.get("color", ""))) else "#c6ff3d",
                    "action": x["action"]})
    common.save("deck", {"cols": max(2, min(cols, 6)), "buttons": out})
    phone.phone_box.push("deck")
    return _deck_get({})


@kit.hub_post("/api/kit/deck/reset")
def _deck_reset(b):
    common.save("deck", DEFAULT_DECK)
    phone.phone_box.push("deck")
    return _deck_get({})


# ============================================================ 19. phone mirror ===
SCRCPY_DIR = os.path.join(common.BIN, "scrcpy")
MIRROR = {"proc": None, "busy": "", "args": []}


def scrcpy_exe():
    return common.which("scrcpy", [os.path.join(SCRCPY_DIR, "*", "scrcpy.exe"), os.path.join(SCRCPY_DIR, "scrcpy.exe")])


def _gh_latest(repo):
    req = urllib.request.Request(f"https://api.github.com/repos/{repo}/releases/latest",
                                 headers={"User-Agent": "QT-Suite", "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)


def install_scrcpy():
    MIRROR["busy"] = "checking the latest scrcpy release"
    try:
        rel = _gh_latest("Genymobile/scrcpy")
        asset = next(a for a in rel["assets"] if re.search(r"win64.*\.zip$", a["name"]))
        MIRROR["busy"] = f"downloading {asset['name']} ({asset['size'] >> 20} MB)"
        req = urllib.request.Request(asset["browser_download_url"], headers={"User-Agent": "QT-Suite"})
        with urllib.request.urlopen(req, timeout=120) as r:
            data = r.read()
        os.makedirs(SCRCPY_DIR, exist_ok=True)
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            z.extractall(SCRCPY_DIR)
        common.save("scrcpy", {"tag": rel["tag_name"], "t": time.time()})
        MIRROR["busy"] = ""
        return True, rel["tag_name"]
    except Exception as e:
        MIRROR["busy"] = ""
        return False, str(e)


@kit.hub_get("/api/kit/mirror")
def _mirror_status(q):
    p = MIRROR["proc"]
    running = bool(p and p.poll() is None)
    return 200, {"installed": bool(scrcpy_exe()), "version": common.load("scrcpy", {}).get("tag"), "busy": MIRROR["busy"],
                 "running": running, "devices": _adb_devices(), "args": MIRROR["args"] if running else []}


@kit.hub_post("/api/kit/mirror/install")
def _mirror_install(b):
    if MIRROR["busy"]:
        return 409, {"ok": False, "msg": MIRROR["busy"]}
    threading.Thread(target=install_scrcpy, daemon=True).start()
    return 200, {"ok": True}


@kit.hub_post("/api/kit/mirror/start")
def _mirror_start(b):
    exe = scrcpy_exe()
    if not exe:
        return 404, {"ok": False, "msg": "Install scrcpy first"}
    if MIRROR["proc"] and MIRROR["proc"].poll() is None:
        MIRROR["proc"].terminate()
    args = [exe, "--window-title=Phone (QT Suite)"]
    if b.get("serial"):
        args.append("--serial=" + re.sub(r"[^\w.:-]", "", str(b["serial"])))
    size = int(b.get("size") or 1280)
    if size:
        args.append(f"--max-size={size}")
    if b.get("screen_off"):
        args.append("--turn-screen-off")
    if b.get("awake", True):
        args.append("--stay-awake")
    if b.get("ontop"):
        args.append("--always-on-top")
    if not b.get("audio", True):
        args.append("--no-audio")
    if b.get("record"):
        vids = os.path.join(common.HOME, "Videos", "QT Recordings")
        os.makedirs(vids, exist_ok=True)
        args.append("--record=" + os.path.join(vids, time.strftime("phone-%Y%m%d-%H%M%S.mp4")))
    if b.get("camera"):
        args += ["--video-source=camera", "--camera-facing=" + ("front" if b.get("camera") == "front" else "back")]
    if b.get("readonly"):
        args.append("--no-control")
    import subprocess
    env = dict(os.environ, ADB=common.adb() or "adb")
    log = open(os.path.join(common.DATA, "scrcpy.log"), "w", encoding="utf-8")
    MIRROR["proc"] = subprocess.Popen(args, cwd=os.path.dirname(exe), env=env, stdout=log, stderr=log,
                                      creationflags=common.NOWIN)
    MIRROR["args"] = args[1:]
    time.sleep(2.0)
    if MIRROR["proc"].poll() is not None:
        log.close()
        with open(os.path.join(common.DATA, "scrcpy.log"), encoding="utf-8", errors="replace") as f:
            tail = f.read()[-400:]
        return 500, {"ok": False, "msg": "scrcpy stopped: " + tail}
    common.event("mirror.start")
    return 200, {"ok": True}


@kit.hub_post("/api/kit/mirror/stop")
def _mirror_stop(b):
    p = MIRROR["proc"]
    if p and p.poll() is None:
        p.terminate()
    return 200, {"ok": True}


def _mirror_toggle(_=None):
    p = MIRROR["proc"]
    if p and p.poll() is None:
        p.terminate()
        return True, "mirror stopped"
    r = _mirror_start({})
    return r[0] == 200, r[1].get("msg", "mirror started")


actions.register("mirror.toggle", "Phone mirror on / off", _mirror_toggle)
