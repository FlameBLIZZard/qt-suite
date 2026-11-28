"""Media: screen recorder (webcam bubble, trim, GIF), batch photo tool, music library + lyrics."""
import hashlib
import json
import os
import re
import subprocess
import threading
import time
import urllib.parse
import urllib.request

import kit
from kit import actions, common, phone, winapi

VIDS = os.path.join(common.HOME, "Videos", "QT Recordings")
CACHE = os.path.join(common.DATA, "cache")
os.makedirs(CACHE, exist_ok=True)


def serve_file(h, f, ctype=None):
    size = os.path.getsize(f)
    rng = h.headers.get("Range", "")
    start, end = 0, size - 1
    if rng.startswith("bytes="):
        a, _, b = rng[6:].partition("-")
        start = int(a or 0)
        end = min(int(b) if b else size - 1, size - 1)
        h.send_response(206)
        h.send_header("Content-Range", f"bytes {start}-{end}/{size}")
    else:
        h.send_response(200)
    import mimetypes
    h.send_header("Content-Type", ctype or mimetypes.guess_type(f)[0] or "application/octet-stream")
    h.send_header("Accept-Ranges", "bytes")
    h.send_header("Content-Length", str(end - start + 1))
    h.end_headers()
    with open(f, "rb") as fh:
        fh.seek(start)
        left = end - start + 1
        while left > 0:
            chunk = fh.read(min(left, 1 << 16))
            if not chunk:
                break
            try:
                h.wfile.write(chunk)
            except OSError:
                return
            left -= len(chunk)


def _allowed_media(p):
    p = os.path.normcase(os.path.abspath(p))
    roots = [VIDS] + music_roots()
    return any(p.startswith(os.path.normcase(os.path.abspath(r)) + os.sep) for r in roots)


@kit.raw_get("/api/kit/media")
def _media(h, q):
    p = (q.get("path") or [""])[0]
    if not p or not os.path.isfile(p) or not _allowed_media(p):
        h.send_response(404)
        h.send_header("Content-Length", "0")
        h.end_headers()
        return
    serve_file(h, p)


# ============================================================ 5. screen recorder ===
REC = {"proc": None, "out": "", "t": 0, "opts": {}, "log": ""}


def dshow_devices():
    exe = common.ffmpeg()
    if not exe:
        return [], []
    code, out = common.run([exe, "-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", "dummy"], timeout=15)
    v, a = [], []
    for m in re.finditer(r'"([^"]+)" \((video|audio)\)', out):
        (v if m.group(2) == "video" else a).append(m.group(1))
    return v, a


_dev_cache = {}


@kit.hub_get("/api/kit/rec")
def _rec(q):
    if "v" not in _dev_cache or (q.get("fresh") or ["0"])[0] == "1":
        _dev_cache["v"], _dev_cache["a"] = dshow_devices()
    p = REC["proc"]
    running = bool(p and p.poll() is None)
    files = []
    if os.path.isdir(VIDS):
        for f in sorted(os.listdir(VIDS), key=lambda f: -os.path.getmtime(os.path.join(VIDS, f)))[:30]:
            fp = os.path.join(VIDS, f)
            if f.lower().endswith((".mp4", ".gif", ".mkv")):
                files.append({"name": f, "path": fp, "size": common.human(os.path.getsize(fp)), "t": os.path.getmtime(fp)})
    wins = [winapi.title(h) for h in winapi.windows()][:40]
    return 200, {"running": running, "out": REC["out"], "secs": int(time.time() - REC["t"]) if running else 0,
                 "cams": _dev_cache["v"], "mics": _dev_cache["a"], "files": files, "folder": VIDS,
                 "windows": [w for w in wins if w and not w.startswith("QT widget")], "phonecam": time.time() - _phonecam_t() < 3,
                 "ffmpeg": bool(common.ffmpeg())}


def _phonecam_t():
    try:
        from kit import phonefx
        return phonefx.CAM["t"]
    except Exception:
        return 0


def rec_start(o):
    exe = common.ffmpeg()
    if not exe:
        return False, "ffmpeg not found"
    if REC["proc"] and REC["proc"].poll() is None:
        return False, "already recording"
    os.makedirs(VIDS, exist_ok=True)
    out = os.path.join(VIDS, time.strftime("rec-%Y%m%d-%H%M%S.mp4"))
    fps = max(10, min(int(o.get("fps") or 30), 60))
    args = [exe, "-hide_banner", "-y", "-f", "gdigrab", "-framerate", str(fps), "-draw_mouse", "1"]
    if o.get("window"):
        args += ["-i", "title=" + str(o["window"])]
    else:
        args += ["-i", "desktop"]
    inputs = 1
    bubble = o.get("bubble") or ""
    if bubble == "phone":
        args += ["-f", "mpjpeg", "-reconnect", "1", "-i", f"http://127.0.0.1:{kit.INFO['port']}/api/kit/cam.mjpg"]
        cam_idx = inputs
        inputs += 1
    elif bubble:
        args += ["-f", "dshow", "-rtbufsize", "64M", "-i", "video=" + bubble]
        cam_idx = inputs
        inputs += 1
    mic = o.get("mic") or ""
    if mic:
        args += ["-f", "dshow", "-i", "audio=" + mic]
        mic_idx = inputs
        inputs += 1
    size = max(120, min(int(o.get("bubble_size") or 260), 600))
    corner = o.get("corner", "br")
    pos = {"br": "W-w-36:H-h-36", "bl": "36:H-h-36", "tr": "W-w-36:36", "tl": "36:36"}.get(corner, "W-w-36:H-h-36")
    if bubble:
        r = size // 2
        fc = (f"[0:v]scale=trunc(iw/2)*2:trunc(ih/2)*2[s];"
              f"[{cam_idx}:v]crop='min(iw,ih)':'min(iw,ih)',scale={size}:{size},format=rgba,"
              f"geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lt(hypot(X-{r},Y-{r}),{r - 2}),255,0)'[cam];"
              f"[s][cam]overlay={pos}:shortest=0,format=yuv420p[v]")
        args += ["-filter_complex", fc, "-map", "[v]"]
    else:
        args += ["-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p", "-map", "0:v"]
    if mic:
        args += ["-map", f"{mic_idx}:a", "-c:a", "aac", "-b:a", "160k"]
    args += ["-c:v", "libx264", "-preset", "ultrafast", "-crf", str(int(o.get("crf") or 23)), "-g", str(fps), "-movflags", "+faststart", out]
    log = open(os.path.join(common.DATA, "rec.log"), "w", encoding="utf-8")
    REC.update(proc=subprocess.Popen(args, stdin=subprocess.PIPE, stdout=log, stderr=log, creationflags=common.NOWIN),
               out=out, t=time.time(), opts=o)
    time.sleep(1.2)
    if REC["proc"].poll() is not None:
        log.close()
        with open(os.path.join(common.DATA, "rec.log"), encoding="utf-8", errors="replace") as f:
            tail = f.read()[-500:]
        return False, "ffmpeg stopped: " + tail
    common.event("rec.start")
    p = common.load("kitprefs", {})
    p["rec"] = {k: v for k, v in o.items() if k != "op"}   # the hotkey reuses the last settings
    common.save("kitprefs", p)
    return True, out


def rec_stop():
    p = REC["proc"]
    if not p or p.poll() is not None:
        return False, "not recording"
    try:
        p.stdin.write(b"q")
        p.stdin.flush()
        p.wait(15)
    except Exception:
        p.terminate()
    secs = int(time.time() - REC["t"])
    if not os.path.exists(REC["out"]) or os.path.getsize(REC["out"]) < 1000:
        with open(os.path.join(common.DATA, "rec.log"), encoding="utf-8", errors="replace") as f:
            return False, "the recording didn't save: " + f.read()[-300:]
    common.event("rec.done", f"{secs} s")
    actions.balloon("Recording saved", os.path.basename(REC["out"]))
    return True, REC["out"]


@kit.hub_post("/api/kit/rec")
def _rec_post(b):
    op = b.get("op")
    if op == "start":
        ok, msg = rec_start(b)
    elif op == "stop":
        ok, msg = rec_stop()
    elif op in ("trim", "gif"):
        ok, msg = _edit(op, b)
    elif op == "open":
        os.makedirs(VIDS, exist_ok=True)
        os.startfile(b.get("path") if b.get("path") and _allowed_media(b["path"]) else VIDS)
        ok, msg = True, ""
    elif op == "del":
        p = b.get("path", "")
        if not _allowed_media(p):
            return 403, {"ok": False}
        from kit import care
        ok, msg = care.recycle([p]) == 0, "moved to Recycle Bin"
    else:
        return 400, {"ok": False}
    return (200 if ok else 400), {"ok": ok, "msg": msg}


def _edit(op, b):
    src = b.get("path", "")
    if not (os.path.isfile(src) and _allowed_media(src)):
        return False, "pick a recording"
    exe = common.ffmpeg()
    a, z = float(b.get("start") or 0), float(b.get("end") or 0)
    base = os.path.splitext(src)[0]
    cut = ["-ss", f"{a:.2f}"] + (["-to", f"{z:.2f}"] if z > a else [])
    if op == "trim":
        out = base + f"-trim{int(a)}-{int(z)}.mp4"
        args = [exe, "-hide_banner", "-y", *cut, "-i", src, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-movflags", "+faststart", out]
    else:
        fps = max(5, min(int(b.get("fps") or 12), 30))
        w = max(160, min(int(b.get("width") or 640), 1600))
        out = base + f"-{int(a)}-{int(z)}.gif"
        args = [exe, "-hide_banner", "-y", *cut, "-i", src, "-vf",
                f"fps={fps},scale={w}:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4", out]
    code, log = common.run(args, timeout=600)
    if code != 0:
        return False, log[-300:]
    common.event("rec." + op)
    return True, out


actions.register("rec.toggle", "Screen recording start / stop",
                 lambda _=None: rec_stop() if REC["proc"] and REC["proc"].poll() is None else rec_start(common.load("kitprefs", {}).get("rec", {})))


# ============================================================== 6. photo batch ===
PHOTO = {"busy": False, "done": 0, "total": 0, "out": "", "errors": []}
IMG_EXT = (".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".tif", ".tiff", ".heic", ".avif")


def _gather(paths):
    out = []
    for p in paths:
        p = str(p).strip().strip('"')
        if os.path.isdir(p):
            for f in sorted(os.listdir(p)):
                if f.lower().endswith(IMG_EXT):
                    out.append(os.path.join(p, f))
        elif os.path.isfile(p) and p.lower().endswith(IMG_EXT):
            out.append(p)
    return out[:5000]


def _name(pattern, src, n, total, ext, exif_date):
    stem = os.path.splitext(os.path.basename(src))[0]
    width = max(2, len(str(total)))
    s = (pattern or "{name}").replace("{name}", stem).replace("{n}", str(n).zfill(width)) \
        .replace("{date}", exif_date or time.strftime("%Y-%m-%d", time.localtime(os.path.getmtime(src))))
    s = re.sub(r'[<>:"/\\|?*]+', "_", s).strip() or stem
    return s + ext


def photo_run(o):
    from PIL import Image, ImageOps
    files = _gather(o.get("paths") or [])
    fmt = (o.get("format") or "same").lower()
    q = max(30, min(int(o.get("quality") or 85), 100))
    maxw, maxh = int(o.get("max_w") or 0), int(o.get("max_h") or 0)
    pct = float(o.get("percent") or 0)
    out_dir = o.get("out") or os.path.join(os.path.dirname(files[0]) if files else common.HOME, "QT batch " + time.strftime("%H%M%S"))
    os.makedirs(out_dir, exist_ok=True)
    PHOTO.update(busy=True, done=0, total=len(files), out=out_dir, errors=[])
    used = set()
    try:
        for i, src in enumerate(files, 1):
            try:
                with Image.open(src) as im:
                    exif_date = ""
                    try:
                        dtv = im.getexif().get(306)
                        if dtv:
                            exif_date = str(dtv)[:10].replace(":", "-")
                    except Exception:
                        pass
                    im = ImageOps.exif_transpose(im)
                    if pct and 0 < pct < 100:
                        im = im.resize((max(1, int(im.width * pct / 100)), max(1, int(im.height * pct / 100))), Image.LANCZOS)
                    elif maxw or maxh:
                        im.thumbnail((maxw or 100000, maxh or 100000), Image.LANCZOS)
                    ext = {"jpg": ".jpg", "png": ".png", "webp": ".webp", "avif": ".avif"}.get(fmt, os.path.splitext(src)[1].lower())
                    if ext == ".jpeg":
                        ext = ".jpg"
                    name = _name(o.get("rename"), src, i, len(files), ext, exif_date)
                    while name.lower() in used or os.path.exists(os.path.join(out_dir, name)):
                        stem, e = os.path.splitext(name)
                        name = stem + "_1" + e
                    used.add(name.lower())
                    kw = {}
                    if ext in (".jpg", ".webp", ".avif"):
                        kw["quality"] = q
                        if im.mode in ("RGBA", "P", "LA"):
                            if ext == ".jpg":
                                bg = Image.new("RGB", im.size, (255, 255, 255))
                                bg.paste(im.convert("RGBA"), mask=im.convert("RGBA").split()[-1])
                                im = bg
                        elif im.mode != "RGB":
                            im = im.convert("RGB")
                    if ext == ".jpg":
                        kw.update(optimize=True, progressive=True)
                    if not o.get("strip", True) and "exif" in im.info:
                        kw["exif"] = im.info["exif"]
                    im.save(os.path.join(out_dir, name), **kw)
            except Exception as e:
                PHOTO["errors"].append(f"{os.path.basename(src)}: {e}")
            PHOTO["done"] = i
        common.event("photos.batch", str(len(files)))
    finally:
        PHOTO["busy"] = False


@kit.hub_get("/api/kit/photos")
def _ph(q):
    paths = [p for p in (q.get("paths") or [""])[0].split("|") if p]
    files = _gather(paths) if paths else []
    size = sum(os.path.getsize(f) for f in files[:5000])
    return 200, dict(PHOTO, count=len(files), size=common.human(size), sample=[os.path.basename(f) for f in files[:6]],
                     pictures=os.path.join(common.HOME, "Pictures"))


@kit.hub_post("/api/kit/photos")
def _ph_post(b):
    if b.get("op") == "open":
        if PHOTO["out"] and os.path.isdir(PHOTO["out"]):
            os.startfile(PHOTO["out"])
        return 200, {"ok": True}
    if PHOTO["busy"]:
        return 409, {"ok": False, "msg": "a batch is already running"}
    if not _gather(b.get("paths") or []):
        return 400, {"ok": False, "msg": "no pictures found there"}
    threading.Thread(target=photo_run, args=(b,), daemon=True).start()
    return 200, {"ok": True}


# ============================================================== 7. music player ===
AUDIO_EXT = (".mp3", ".m4a", ".flac", ".ogg", ".opus", ".wav", ".aac", ".wma")
LIB = {"tracks": None, "t": 0, "busy": False}
NOW = {"state": {}, "t": 0, "box": phone.Mailbox()}


def music_roots():
    p = common.load("kitprefs", {})
    roots = [os.path.join(common.HOME, "Music"), os.path.join(common.HOME, "Downloads")] + list(p.get("music_dirs") or [])
    return [r for r in roots if os.path.isdir(r)]


def _probe(f):
    exe = common.ffmpeg("ffprobe")
    tags, dur = {}, 0
    if exe:
        code, out = common.run([exe, "-v", "quiet", "-print_format", "json", "-show_format", f], timeout=10)
        try:
            j = json.loads(out)["format"]
            tags = {k.lower(): v for k, v in (j.get("tags") or {}).items()}
            dur = float(j.get("duration") or 0)
        except (ValueError, KeyError):
            pass
    stem = os.path.splitext(os.path.basename(f))[0]
    artist, _, title = stem.partition(" - ")
    if not title:
        artist, title = "", stem
    return {"title": tags.get("title") or title.strip(), "artist": tags.get("artist") or tags.get("album_artist") or artist.strip(),
            "album": tags.get("album", ""), "dur": round(dur, 1)}


def scan_library():
    LIB["busy"] = True
    try:
        cache = common.load("musiccache", {})
        out, seen = [], set()
        for root in music_roots():
            deep = os.path.normcase(root) != os.path.normcase(os.path.join(common.HOME, "Downloads"))
            for d, dirs, files in os.walk(root):
                if not deep and d != root:
                    dirs[:] = [x for x in dirs if x.lower() in ("volt", "music", "audio")]
                for fn in files:
                    if not fn.lower().endswith(AUDIO_EXT):
                        continue
                    p = os.path.join(d, fn)
                    try:
                        st = os.stat(p)
                    except OSError:
                        continue
                    key = f"{p}|{st.st_size}|{int(st.st_mtime)}"
                    seen.add(key)
                    meta = cache.get(key) or _probe(p)
                    cache[key] = meta
                    out.append(dict(meta, path=p, id=hashlib.sha1(p.encode()).hexdigest()[:10], added=st.st_mtime))
                    if len(out) > 8000:
                        break
        common.save("musiccache", {k: v for k, v in cache.items() if k in seen})
        out.sort(key=lambda t: (t["artist"].lower(), t["album"].lower(), t["title"].lower()))
        LIB.update(tracks=out, t=time.time())
    finally:
        LIB["busy"] = False


@kit.hub_get("/api/kit/music")
def _music(q):
    if LIB["tracks"] is None and not LIB["busy"]:
        scan_library()
    return 200, {"tracks": LIB["tracks"] or [], "busy": LIB["busy"], "roots": music_roots(), "now": NOW["state"] if time.time() - NOW["t"] < 10 else {}}


@kit.hub_post("/api/kit/music")
def _music_post(b):
    op = b.get("op")
    if op == "rescan":
        threading.Thread(target=scan_library, daemon=True).start()
    elif op == "adddir":
        d = str(b.get("path", "")).strip().strip('"')
        if not os.path.isdir(d):
            return 400, {"ok": False, "msg": "folder not found"}
        p = common.load("kitprefs", {})
        p["music_dirs"] = sorted(set((p.get("music_dirs") or []) + [d]))
        common.save("kitprefs", p)
        threading.Thread(target=scan_library, daemon=True).start()
    elif op == "now":       # the player reports what's playing (mini player + deck read it)
        NOW["state"] = {k: b.get(k) for k in ("id", "title", "artist", "pos", "dur", "playing", "cover")}
        NOW["t"] = time.time()
    elif op == "cmd":       # mini player / tray / deck -> player
        NOW["box"].push("cmd", cmd=str(b.get("cmd", ""))[:20], arg=b.get("arg"))
    return 200, {"ok": True}


@kit.hub_get("/api/kit/music/now")
def _now(q):
    return 200, dict(NOW["state"] if time.time() - NOW["t"] < 10 else {}, live=time.time() - NOW["t"] < 10)


@kit.hub_get("/api/kit/music/cmds")
def _cmds(q):
    after = int((q.get("after") or ["0"])[0] or 0)
    if after < 0 or after > NOW["box"].seq:
        after = NOW["box"].seq
    items, seq = NOW["box"].wait(after, 20)
    return 200, {"items": items, "seq": seq}


@kit.hub_get("/api/kit/lyrics")
def _lyrics(q):
    artist, title = (q.get("artist") or [""])[0], (q.get("title") or [""])[0]
    dur = (q.get("dur") or [""])[0]
    key = hashlib.sha1(f"{artist}|{title}".lower().encode()).hexdigest()[:16]
    cf = os.path.join(CACHE, "lyr-" + key + ".json")
    if os.path.exists(cf):
        with open(cf, encoding="utf-8") as f:
            return 200, json.load(f)
    res = {"synced": "", "plain": "", "found": False}
    try:
        qs = {"track_name": title, "artist_name": artist}
        if dur:
            qs["duration"] = str(int(float(dur)))
        url = "https://lrclib.net/api/get?" + urllib.parse.urlencode(qs) if artist else "https://lrclib.net/api/search?" + urllib.parse.urlencode({"q": title})
        req = urllib.request.Request(url, headers={"User-Agent": "QT-Suite (https://github.com/FlameBLIZZard)"})
        with urllib.request.urlopen(req, timeout=12) as r:
            j = json.load(r)
        if isinstance(j, list):
            j = j[0] if j else {}
        res = {"synced": j.get("syncedLyrics") or "", "plain": j.get("plainLyrics") or "", "found": bool(j.get("syncedLyrics") or j.get("plainLyrics"))}
    except urllib.error.HTTPError as e:
        if e.code != 404:
            return 200, dict(res, err=str(e))
    except Exception as e:
        return 200, dict(res, err=str(e))
    with open(cf, "w", encoding="utf-8") as f:
        json.dump(res, f)
    return 200, res


@kit.raw_get("/api/kit/cover")
def _cover(h, q):
    p = (q.get("path") or [""])[0]
    if not (os.path.isfile(p) and _allowed_media(p)):
        h.send_response(404)
        h.send_header("Content-Length", "0")
        h.end_headers()
        return
    out = os.path.join(CACHE, "cov-" + hashlib.sha1(p.encode()).hexdigest()[:16] + ".jpg")
    if not os.path.exists(out) and not os.path.exists(out + ".none"):
        code, _ = common.run([common.ffmpeg(), "-hide_banner", "-y", "-i", p, "-an", "-vf", "scale=300:-1", "-frames:v", "1", out], timeout=15)
        if code != 0 or not os.path.exists(out):
            open(out + ".none", "w").close()
    if os.path.exists(out):
        return serve_file(h, out, "image/jpeg")
    h.send_response(404)
    h.send_header("Content-Length", "0")
    h.end_headers()


for _c, _l in (("toggle", "Music: play / pause"), ("next", "Music: next song"), ("prev", "Music: previous song")):
    actions.register("music." + _c, _l, lambda _a=None, c=_c: (NOW["box"].push("cmd", cmd=c), (True, c))[1])
