"""
VOLT — local media grabber. Paste a link from (almost) any site, get the file.
Engines: yt-dlp (video/audio, 1800+ sites) -> gallery-dl (image posts/galleries) -> direct HTTP.
Run:  python app.py   ->  opens http://127.0.0.1:7777
"""
import os, sys, re, json, time, uuid, copy, shutil, socket, threading, subprocess, webbrowser
import urllib.request, urllib.parse
from flask import Flask, request, jsonify, send_file, send_from_directory, abort

try:
    import yt_dlp
except ImportError:
    sys.exit('yt-dlp missing. Run:  pip install -U "yt-dlp[default]" flask gallery-dl imageio-ffmpeg')

# Windows: antivirus / indexer briefly locks fresh files -> rename fails (WinError 32).
# Retry renames for a few seconds instead of crashing the download.
def _retry(fn):
    def w(src, dst, *a, **k):
        for i in range(40):
            try:
                return fn(src, dst, *a, **k)
            except PermissionError:
                if i == 39:
                    raise
                time.sleep(0.25)
    return w
os.replace = _retry(os.replace)
os.rename = _retry(os.rename)

VERSION = "3.2"
BASE = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("VOLT_PORT") or 7777)   # VOLT_PORT: sandbox copy for tests
CFG_DIR = os.path.join(os.environ.get("LOCALAPPDATA") or os.path.expanduser("~/.config"), "volt")
CFG_FILE = os.path.join(CFG_DIR, "settings.json")
os.makedirs(CFG_DIR, exist_ok=True)

# save OUTSIDE OneDrive so sync doesn't fight the download for bandwidth
SETTINGS = {"folder": os.path.join(os.path.expanduser("~"), "Downloads", "VOLT"), "cookies": "", "parallel": 3,
            "cover": True, "sponsorblock": False, "limit": 0, "clipwatch": False}
try:
    SETTINGS.update(json.load(open(CFG_FILE, encoding="utf-8")))
except Exception:
    pass

def save_settings():
    tmp = CFG_FILE + ".tmp"   # write then swap: a crash mid-save can't leave a half-written settings file
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(SETTINGS, f, indent=2)
    os.replace(tmp, CFG_FILE)

def dl_dir():
    os.makedirs(SETTINGS["folder"], exist_ok=True)
    return SETTINGS["folder"]

app = Flask(__name__, static_folder=os.path.join(BASE, "static"), static_url_path="/static")

# Only answer requests addressed to this machine. Stops other web pages from talking to
# VOLT through DNS rebinding (they could otherwise change settings or start downloads).
ALLOWED_HOSTS = {f"127.0.0.1:{PORT}", f"localhost:{PORT}", f"[::1]:{PORT}"}

@app.before_request
def _json_object_only():
    """Bodies are always JSON objects here; a list or a scalar is a bad request, not a crash."""
    if request.method == "POST" and request.is_json:
        d = request.get_json(silent=True)
        if request.content_length and not isinstance(d, dict):
            return jsonify(error="Expected a JSON object"), 400


@app.errorhandler(Exception)
def log_crash(e):
    """pythonw has no console: keep a log of server errors so they can be fixed."""
    from werkzeug.exceptions import HTTPException
    if isinstance(e, HTTPException):
        return e
    import traceback
    try:
        with open(os.path.join(CFG_DIR, "errors.log"), "a", encoding="utf-8") as f:
            f.write(time.strftime("\n%Y-%m-%d %H:%M:%S ") + request.path + "\n" + traceback.format_exc())
    except OSError:
        pass
    return jsonify(error="VOLT hit a snag: " + str(e)[:200]), 500


@app.before_request
def only_local():
    if request.host not in ALLOWED_HOSTS:
        abort(403)
    if request.method == "POST" and request.path.startswith("/api/") and not request.is_json:
        abort(415)


# ---------- tools on this machine ----------
def find_ffmpeg():
    p = shutil.which("ffmpeg")
    if p:
        return p
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None

FFMPEG = find_ffmpeg()

def js_runtimes():
    rt = {}
    home = os.path.expanduser("~")
    extra = {"deno": [os.path.join(home, ".deno", "bin", "deno.exe"), os.path.join(home, ".deno", "bin", "deno")]}
    for name in ("deno", "node", "bun"):
        p = shutil.which(name) or next((c for c in extra.get(name, []) if os.path.exists(c)), None)
        if p:
            rt[name] = {"path": p}
    return rt or None

JS_RT = js_runtimes()

try:
    import gallery_dl  # noqa: F401
    GDL = True
except ImportError:
    GDL = False


def imp_target():
    """Browser impersonation (curl_cffi): gets past Cloudflare-style blocks on many sites."""
    try:
        import curl_cffi  # noqa: F401
        from yt_dlp.networking.impersonate import ImpersonateTarget
        return ImpersonateTarget.from_str("chrome")
    except Exception:
        return None

IMP = imp_target()

def needs_imp(e):
    low = str(e).lower()
    return bool(IMP) and any(k in low for k in ("http error 403", "cloudflare", "impersonat", "captcha", "http error 429"))


def base_opts(playlist=False, imp=False):
    o = {"quiet": True, "no_warnings": True, "noprogress": True, "noplaylist": not playlist,
         "socket_timeout": 20}
    if FFMPEG:
        o["ffmpeg_location"] = FFMPEG
    if JS_RT:
        o["js_runtimes"] = JS_RT
    if SETTINGS.get("cookies"):
        o["cookiesfrombrowser"] = (SETTINGS["cookies"],)
    if SETTINGS.get("limit"):
        o["ratelimit"] = int(float(SETTINGS["limit"]) * 1024 * 1024)
    if imp and IMP:
        o["impersonate"] = IMP
    return o


def clean_err(e):
    s = re.sub(r"\x1b\[[0-9;]*m", "", str(e)).replace("ERROR: ", "")
    s = re.sub(r"^\[[^\]]+\] [^:]+: ", "", s)
    s = re.sub(r";? ?please report this issue.*", "", s, flags=re.S | re.I).strip()
    low = s.lower()
    if any(k in low for k in ("sign in", "login", "log in", "private", "cookies", "age-restricted", "members-only")):
        s += "  → Open ⚙ settings and pick a browser you're signed in with (Firefox works best)."
    elif "unsupported url" in low:
        s = "This site isn't supported, or the link doesn't point to any media."
    elif any(k in low for k in NET_ERRS):
        s = "Couldn't reach that site. Check the link and your internet connection."
    elif "http error 404" in low:
        s = "That page doesn't exist any more (404). Check the link."
    elif "http error 403" in low:
        s = "The site refused the download (403). Try again, or open ⚙ settings → Update now."
    return s[:400]

NET_ERRS = ("unable to connect", "getaddrinfo", "name or service not known", "nodename nor servname",
            "timed out", "connection refused", "connection reset", "network is unreachable",
            "failed to resolve", "no address associated", "tunnel connection failed")


def human(n):
    if not n:
        return None
    for u in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.1f} {u}"
        n /= 1024
    return f"{n:.1f} TB"


# ---------- info cache: analyze once, download without re-extracting ----------
CACHE = {}          # url -> (ts, info)
CACHE_TTL = 20 * 60

def cache_put(url, info):
    CACHE[url] = (time.time(), info)
    for k in [k for k, (t, _) in CACHE.items() if time.time() - t > CACHE_TTL]:
        CACHE.pop(k, None)

def cache_get(url):
    v = CACHE.get(url)
    return copy.deepcopy(v[1]) if v and time.time() - v[0] < CACHE_TTL else None


IMG_EXT = {"jpg", "jpeg", "png", "webp", "gif", "avif", "bmp", "heic", "svg"}
VID_EXT = {"mp4", "webm", "mkv", "mov", "m4v", "avi", "flv", "ts", "3gp", "wmv", "mpg", "mpeg"}
AUD_EXT = {"mp3", "m4a", "opus", "ogg", "oga", "wav", "flac", "aac", "wma", "alac"}

def summarize(i, url):
    """Turn a yt-dlp info dict into what the UI needs."""
    if i.get("_type") == "playlist":
        ents = [e for e in (i.get("entries") or []) if e]
        thumb = i.get("thumbnail") or next((t.get("url") for t in (i.get("thumbnails") or [])[::-1]), None)
        if not thumb and ents:
            e0 = ents[0]
            thumb = e0.get("thumbnail") or next((t.get("url") for t in (e0.get("thumbnails") or [])[::-1]), None)
        return dict(kind="playlist", engine="yt-dlp", title=i.get("title") or "Playlist",
                    channel=i.get("uploader") or i.get("channel"), thumb=thumb,
                    count=i.get("playlist_count") or len(ents), site=i.get("extractor_key"),
                    url=i.get("webpage_url") or url)
    fmts = i.get("formats") or [i]
    vid = [f for f in fmts if f.get("vcodec") not in (None, "none") or (f.get("height") and f.get("ext") not in IMG_EXT)]
    aud = [f for f in fmts if f.get("acodec") not in (None, "none")]
    if vid or (not aud and i.get("ext") in VID_EXT):
        kind = "video"
    elif aud or i.get("ext") in AUD_EXT:
        kind = "audio"
    else:
        kind = "file"
    fps_by_h, size_by_h = {}, {}
    fsize = lambda f: f.get("filesize") or f.get("filesize_approx") or (
        int(f["tbr"] * 125 * i["duration"]) if f.get("tbr") and i.get("duration") else 0)
    asize = max((fsize(f) for f in aud if f.get("vcodec") in (None, "none")), default=0)
    for f in vid:
        h = f.get("height")
        if h:
            fps_by_h[h] = max(fps_by_h.get(h, 0), f.get("fps") or 0)
            s = fsize(f)
            if s:   # rough size of the best stream at this height (+ audio when it's video-only)
                s += asize if f.get("acodec") in (None, "none") else 0
                size_by_h[h] = max(size_by_h.get(h, 0), s)
    thumb = i.get("thumbnail") or (i.get("url") if kind == "file" and i.get("ext") in IMG_EXT else None)
    return dict(
        kind=kind, engine="yt-dlp", title=i.get("title") or i.get("id"),
        channel=i.get("channel") or i.get("uploader"), thumb=thumb,
        duration=i.get("duration"), views=i.get("view_count"), site=i.get("extractor_key"),
        heights=[{"h": h, "fps": round(fps_by_h[h]), "size": size_by_h.get(h)} for h in sorted(fps_by_h, reverse=True)],
        asize=asize or None, subs=bool(i.get("subtitles")), ext=i.get("ext"),
        has_list="list=" in url, url=i.get("webpage_url") or url,
    )


def gdl_cmd(*args):
    c = [sys.executable, "-m", "gallery_dl"]
    if SETTINGS.get("cookies"):
        c += ["--cookies-from-browser", SETTINGS["cookies"]]
    return c + list(args)

NOWIN = subprocess.CREATE_NO_WINDOW if sys.platform.startswith("win") else 0

def gdl_probe(url):
    """List a gallery's files without downloading. Returns summary or None."""
    if not GDL:
        return None
    try:
        r = subprocess.run(gdl_cmd("-g", "--range", "1-500", url), capture_output=True, text=True,
                           timeout=60, creationflags=NOWIN, encoding="utf-8", errors="replace")
    except Exception:
        return None
    links = [l.strip().lstrip("| ") for l in r.stdout.splitlines() if l.strip() and not l.startswith("#")]
    if not links:
        return None
    thumb = next((l for l in links if urllib.parse.urlparse(l).path.rsplit(".", 1)[-1].lower() in IMG_EXT), None)
    host = (urllib.parse.urlparse(url).hostname or "gallery").removeprefix("www.")
    title = (urllib.parse.unquote(os.path.basename(urllib.parse.urlparse(links[0]).path)) if len(links) == 1 else
             f"{len(links)}{'+' if len(links) >= 500 else ''} files from {host}")
    return dict(kind="gallery", engine="gallery-dl", title=title or host,
                channel=None, thumb=thumb, count=len(links), site=host, url=url)


def direct_probe(url):
    """Last resort: a plain link to a file."""
    try:
        req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=15) as r:
            ct = r.headers.get("Content-Type", "").split(";")[0].strip().lower()
            size = int(r.headers.get("Content-Length") or 0)
            cd = r.headers.get("Content-Disposition") or ""
    except Exception:
        return None
    if not ct or "text/html" in ct:
        return None
    m = re.search(r"filename\*?=(?:UTF-8'')?\"?([^\";]+)", cd, re.I)
    name = (m and urllib.parse.unquote(m.group(1))) or urllib.parse.unquote(os.path.basename(urllib.parse.urlparse(url).path)) or "download"
    if "." not in name:
        import mimetypes
        name += mimetypes.guess_extension(ct) or ""
    return dict(kind="file", engine="direct", title=name, channel=human(size),
                thumb=url if ct.startswith("image/") else None, site=urllib.parse.urlparse(url).hostname, url=url)


@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.route("/api/status")
def status():
    try:
        free = shutil.disk_usage(dl_dir()).free
    except OSError:
        free = None
    return jsonify(ffmpeg=bool(FFMPEG), js=list(JS_RT.keys()) if JS_RT else [], gallery=GDL,
                   ytdlp=yt_dlp.version.__version__, settings=SETTINGS, free=human(free), free_b=free, version=VERSION,
                   beam=beam_up(), imp=bool(IMP), latest=LATEST.get("ytdlp"), installed=UPDATE.get("new"),
                   paused=GATE.paused, uptime=round(time.time() - STARTED))


def beam_up():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sk:
        sk.settimeout(0.3)
        return sk.connect_ex(("127.0.0.1", 7788)) == 0


@app.route("/api/settings", methods=["POST"])
def settings():
    d = request.json or {}
    if "folder" in d:
        f = os.path.expanduser(str(d["folder"]).strip().strip('"'))
        try:
            os.makedirs(f, exist_ok=True)
        except Exception as e:
            return jsonify(error=f"Can't use that folder: {e}"), 400
        SETTINGS["folder"] = os.path.abspath(f)
    if "cookies" in d:
        SETTINGS["cookies"] = d["cookies"] if d["cookies"] in ("", "firefox", "chrome", "edge", "brave", "opera", "vivaldi", "chromium") else ""
        CACHE.clear()
    if "parallel" in d:
        try:
            SETTINGS["parallel"] = max(1, min(8, int(d["parallel"])))
        except (TypeError, ValueError):
            return jsonify(error="Downloads at once must be a number from 1 to 8."), 400
        GATE.resize(SETTINGS["parallel"])
    if "cover" in d:
        SETTINGS["cover"] = bool(d["cover"])
    for k in ("sponsorblock", "clipwatch"):
        if k in d:
            SETTINGS[k] = bool(d[k])
    if "limit" in d:
        try:
            SETTINGS["limit"] = max(0.0, min(1000.0, float(d["limit"] or 0)))
        except (TypeError, ValueError):
            return jsonify(error="Speed limit must be a number of MB/s (0 = no limit)."), 400
    save_settings()
    return jsonify(settings=SETTINGS)


def normalize_url(url):
    """Add a scheme when missing and reject text that can't be a web address."""
    url = (url or "").strip().strip('"\'<>')
    if not url:
        return None, "Paste a link first."
    if not re.match(r"^[a-z][a-z0-9+.-]*://", url, re.I):
        url = "https://" + url
    pu = urllib.parse.urlparse(url)
    host = pu.hostname or ""
    if pu.scheme.lower() not in ("http", "https") or not host or (
            "." not in host and host != "localhost" and ":" not in host):
        return None, "That doesn't look like a link. Copy the address from your browser and paste it here."
    return url, None


def path_ext(url):
    return urllib.parse.urlparse(url).path.rsplit(".", 1)[-1].lower() if "." in urllib.parse.urlparse(url).path else ""


@app.route("/api/info", methods=["POST"])
def info():
    url, bad = normalize_url((request.json or {}).get("url", ""))
    if bad:
        return jsonify(error=bad), 400
    err = None
    for imp in (False, True):
        if imp and not needs_imp(err):
            break
        try:
            o = base_opts(imp=imp)
            o["extract_flat"] = "in_playlist"   # playlists: list entries fast, resolve on download
            with yt_dlp.YoutubeDL(o) as y:
                i = y.extract_info(url, download=False)
            s = summarize(i, url)
            s["src"] = url          # the link as pasted (keeps &list= for "whole playlist")
            s["imp"] = imp          # the download needs the browser disguise too
            if s["kind"] != "playlist":
                cache_put(s["url"], i)
                cache_put(url, i)
            return jsonify(s)
        except Exception as e:
            err = e
    # plain file links: a direct download keeps the real file name; galleries come next
    ext = path_ext(url)
    probes = (direct_probe, gdl_probe) if ext in IMG_EXT | VID_EXT | AUD_EXT else (gdl_probe, direct_probe)
    for probe in probes:
        s = probe(url)
        if s:
            s["src"] = url
            return jsonify(s)
    return jsonify(error=clean_err(err) if err else "Couldn't find any media at that link."), 400


# ---------- jobs ----------
JOBS = {}
LOCK = threading.RLock()
HIST_FILE = os.path.join(CFG_DIR, "history.json")
FINAL = ("done", "error", "cancelled")
HIST_MAX = 1000
STARTED = time.time()


class Gate:
    """The download queue: N slots (Settings → Downloads at once), first come first served,
    can be paused, and a waiting job can jump to the front."""
    def __init__(self, n):
        self.n, self.busy, self.cv = n, 0, threading.Condition()
        self.paused, self.waiting = False, []

    def resize(self, n):
        with self.cv:
            self.n = n
            self.cv.notify_all()

    def pause(self, on):
        with self.cv:
            self.paused = bool(on)
            self.cv.notify_all()

    def kick(self):
        with self.cv:
            self.cv.notify_all()

    def front(self, jid):
        with self.cv:
            if jid not in self.waiting:
                return False
            self.waiting.remove(jid)
            self.waiting.insert(0, jid)
            self.cv.notify_all()
            return True

    def pos(self, jid):
        try:
            return self.waiting.index(jid) + 1
        except ValueError:
            return None

    def acquire(self, jid, stop):
        """Wait for a free slot in queue order. False when stop() turned true first."""
        with self.cv:
            self.waiting.append(jid)
            try:
                self.cv.wait_for(lambda: stop() or (not self.paused and self.busy < self.n
                                                     and self.waiting[0] == jid))
                if stop():
                    return False
                self.busy += 1
                return True
            finally:
                self.waiting.remove(jid)
                self.cv.notify_all()

    def release(self):
        with self.cv:
            self.busy -= 1
            self.cv.notify_all()

GATE = Gate(SETTINGS.get("parallel", 3))


class Cancelled(Exception):
    pass

def set_job(jid, **kw):
    with LOCK:
        if jid not in JOBS:
            return
        JOBS[jid].update(kw)
        if kw.get("state") in FINAL:
            JOBS[jid]["ended"] = time.time()
        if kw.get("state") in FINAL + ("paused",):
            save_history()


def save_history():
    """Finished, paused and unfinished downloads survive a restart: 'Show in folder' and Retry keep
    working, and anything that was still queued or downloading carries on by itself."""
    with LOCK:
        rows = sorted(JOBS.values(), key=lambda j: -j["created"])
        keep = [{k: v for k, v in j.items() if k not in ("cancel", "_proc", "pausing")}
                for j in rows if j["state"] in FINAL][:HIST_MAX]
        keep += [{k: v for k, v in j.items() if k not in ("cancel", "_proc", "pausing")}
                 for j in rows if j["state"] not in FINAL and j.get("_req")]
    try:
        tmp = HIST_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(keep, f)
        os.replace(tmp, HIST_FILE)
    except OSError:
        pass


PENDING = []   # jobs that were still going when VOLT closed; resume_pending() restarts them

def load_history():
    try:
        for j in json.load(open(HIST_FILE, encoding="utf-8")):
            if not (isinstance(j, dict) and j.get("id") and j.get("state")):
                continue
            j["cancel"] = False
            if j["state"] not in FINAL:
                if not j.get("_req"):
                    continue
                j.update(speed=None, eta=None, bps=0)
                if j["state"] != "paused":
                    j.update(state="queued", resumed=True)
                    PENDING.append(j["id"])
            JOBS[j["id"]] = j
    except Exception:
        pass

load_history()


def resume_pending():
    for jid in PENDING:
        if jid in JOBS and JOBS[jid]["state"] == "queued":
            threading.Thread(target=run_job, args=(jid, JOBS[jid]["_req"]), daemon=True).start()
    PENDING.clear()


REQ_KEYS = ("url", "engine", "title", "thumb", "count", "mode", "height", "playlist", "subs", "start", "end",
            "site", "source", "kind", "abr", "imp")

def new_job(d):
    jid = uuid.uuid4().hex[:10]
    req = {k: d.get(k) for k in REQ_KEYS}
    with LOCK:
        JOBS[jid] = dict(id=jid, state="queued", pct=0, speed=None, eta=None, title=d.get("title") or d["url"],
                         thumb=d.get("thumb"), mode=d.get("mode", "mp4"), height=d.get("height"),
                         url=d["url"], site=d.get("site"), clip=bool(d.get("start") or d.get("end")),
                         source=(str(d.get("source"))[:60] if d.get("source") else None), kind=d.get("kind"),
                         abr=d.get("abr"), item=None, items=None, file=None, name=None, size=None, error=None,
                         created=time.time(), cancel=False, _req=req)
    save_history()
    threading.Thread(target=run_job, args=(jid, req), daemon=True).start()
    return jid


@app.route("/api/download", methods=["POST"])
def download():
    d = request.json or {}
    if not d.get("url"):
        return jsonify(error="No link to download."), 400
    for k in ("start", "end"):
        if d.get(k) not in (None, ""):
            t = parse_time(d[k])
            if t is None:
                return jsonify(error="Clip times look like 1:30 or 75 (seconds)."), 400
            d[k] = t
        else:
            d[k] = None
    if d["start"] is not None and d["end"] is not None and d["end"] <= d["start"]:
        return jsonify(error="The clip has to end after it starts."), 400
    if d.get("abr") not in (None, "", 0, 128, 192, 256, 320):
        return jsonify(error="MP3 quality is 128, 192, 256 or 320 kbps."), 400
    d["abr"] = d.get("abr") or None
    d["imp"] = bool(d.get("imp"))
    if not d.get("force") and not d.get("source"):   # Beam Drop never gets blocked here
        same = ("url", "mode", "height", "start", "end", "playlist", "abr")
        with LOCK:
            dup = next((j for j in JOBS.values() if j["state"] not in FINAL and j.get("_req")
                        and all((j["_req"].get(k) or None) == (d.get(k) or None) for k in same)), None)
        if dup:
            return jsonify(error="That one is already downloading.", dup=dup["id"]), 409
    return jsonify(id=new_job(d))


def parse_time(v):
    """'1:02:03', '2:30', '75', '75.5' -> seconds."""
    if isinstance(v, (int, float)):
        return float(v) if v >= 0 else None
    m = re.fullmatch(r"\s*(?:(\d+):)?(?:(\d+):)?(\d+(?:\.\d+)?)\s*", str(v))
    if not m:
        return None
    a, b, c = m.groups()
    parts = [float(x) for x in (a, b, c) if x is not None]
    sec = 0.0
    for x in parts:
        sec = sec * 60 + x
    return sec


@app.route("/api/retry/<jid>", methods=["POST"])
def retry(jid):
    j = JOBS.get(jid) or abort(404)
    if not j.get("_req"):
        return jsonify(error="Can't retry this one, paste the link again."), 400
    with LOCK:
        part = j.get("_part")
        JOBS.pop(jid, None)
    nid = new_job(dict(j["_req"]))
    if part and os.path.isfile(part):
        set_job(nid, _part=part)   # a direct file link carries on from where it stopped
    save_history()
    return jsonify(id=nid)


TRASH = []   # recently removed rows, so the toast's Undo can bring them back


def stash(rows):
    if rows:
        TRASH.append((time.time(), rows))
        del TRASH[:-5]


@app.route("/api/remove/<jid>", methods=["POST"])
def remove(jid):
    with LOCK:
        j = JOBS.get(jid)
        if j and j["state"] in FINAL:
            stash([JOBS.pop(jid)])
    save_history()
    return jsonify(ok=True)


@app.route("/api/undo", methods=["POST"])
def undo():
    with LOCK:
        while TRASH and time.time() - TRASH[-1][0] > 120:
            TRASH.pop()
        if not TRASH:
            return jsonify(error="Nothing to undo."), 400
        _, rows = TRASH.pop()
        for j in rows:
            JOBS[j["id"]] = j
    save_history()
    return jsonify(restored=len(rows))


@app.route("/api/retry-failed", methods=["POST"])
def retry_failed():
    with LOCK:
        bad = [j for j in JOBS.values() if j["state"] in ("error", "cancelled") and j.get("_req")]
        for j in bad:
            JOBS.pop(j["id"], None)
    ids = [new_job(dict(j["_req"])) for j in sorted(bad, key=lambda j: j["created"])]
    save_history()
    return jsonify(ids=ids)


@app.route("/api/cancel-all", methods=["POST"])
def cancel_all():
    with LOCK:
        act = [j["id"] for j in JOBS.values() if j["state"] not in FINAL]
    for jid in act:
        cancel(jid)
    return jsonify(cancelled=len(act))


def _stopped(jid):
    """Cancelled or paused (or gone): the job should stop and say which."""
    j = JOBS.get(jid)
    if not j:
        return "gone"
    return ("paused" if j.get("pausing") else "cancelled") if j["cancel"] else None


RESTARTING = []

def _halt(jid):
    why = _stopped(jid)
    if why == "paused" and RESTARTING:   # stopped for a restart: the next VOLT carries on with it
        set_job(jid, state="queued", speed=None, eta=None, bps=0)
        save_history()
    elif why == "paused":
        set_job(jid, state="paused", speed=None, eta=None, bps=0)
    elif why == "cancelled":
        set_job(jid, state="cancelled", error=None, speed=None, eta=None, bps=0)
        if jid in JOBS:
            _drop_partial(JOBS[jid])


def run_job(jid, d):
    if not GATE.acquire(jid, lambda: bool(_stopped(jid))):
        return _halt(jid)
    try:
        d = dict(d)
        for attempt in range(4):
            if _stopped(jid):
                return _halt(jid)
            set_job(jid, state="starting", attempt=attempt or None, resumed=None)
            try:
                eng = d.get("engine", "yt-dlp")
                if eng == "gallery-dl":
                    run_gallery(jid, d)
                elif eng == "direct":
                    run_direct(jid, d)
                else:
                    run_ytdlp(jid, d)
                return
            except Exception as e:
                if _stopped(jid):
                    return _halt(jid)
                if attempt < 3 and not d.get("imp") and needs_imp(e) and eng == "yt-dlp":
                    # the site blocked a plain request: try again looking like a real Chrome
                    d["imp"] = True
                    with LOCK:
                        if jid in JOBS:
                            JOBS[jid]["_req"]["imp"] = True
                    continue
                if attempt < 2 and transient(e):
                    # Wi-Fi blips and 5xx hiccups: wait a moment and try again by itself
                    set_job(jid, state="retrying", attempt=attempt + 1, speed=None, eta=None)
                    for _ in range(int(RETRY_WAIT * (attempt + 1) * 10)):
                        if _stopped(jid):
                            return _halt(jid)
                        time.sleep(0.1)
                    continue
                return set_job(jid, state="error", error=clean_err(e))
    finally:
        GATE.release()


RETRY_WAIT = 3.0

def transient(e):
    low = str(e).lower()
    return any(k in low for k in NET_ERRS) or bool(re.search(r"http error 5\d\d|incompleteread|remote end closed", low))


def finish(jid, fp):
    set_job(jid, state="done", pct=100, file=fp, speed=None, eta=None, bps=0,
            name=os.path.basename(fp) if fp else None,
            size=human(os.path.getsize(fp)) if fp and os.path.isfile(fp) else None)


def run_ytdlp(jid, d):
    url, mode, height = d["url"], d.get("mode", "mp4"), d.get("height")
    playlist = bool(d.get("playlist"))
    seen = []

    def hook(p):
        if JOBS[jid]["cancel"]:
            raise Cancelled("Cancelled")
        inf = p.get("info_dict") or {}
        fn = p.get("filename")
        if fn and fn not in seen:
            seen.append(fn)
        parts = len(inf.get("requested_formats") or []) or 1
        part = min(parts - 1, sum(1 for f in seen if inf.get("id", "\0") in f) - 1) if parts > 1 else 0
        n = inf.get("n_entries") or 1
        idx = (inf.get("playlist_index") or 1) if playlist else 1
        if p["status"] == "downloading":
            tot = p.get("total_bytes") or p.get("total_bytes_estimate") or 0
            done = p.get("downloaded_bytes") or 0
            frac = done / tot if tot else (p.get("fragment_index") or 0) / (p.get("fragment_count") or 1e9)
            overall = ((idx - 1) + (max(part, 0) + frac) / parts) / n * 100
            set_job(jid, state="downloading", pct=round(min(overall, 99.5), 1),
                    speed=human(p.get("speed")) and human(p.get("speed")) + "/s", eta=p.get("eta"), bps=p.get("speed") or 0,
                    downloaded=human(done), total=human(tot),
                    item=idx if playlist else None, items=n if playlist else None)

    def pp_hook(p):
        if p["status"] == "started" and p.get("postprocessor") in ("Merger", "FFmpegExtractAudio", "FFmpegVideoRemuxer", "FFmpegEmbedSubtitle"):
            set_job(jid, state="converting" if mode in ("mp3", "audio") else "merging", speed=None, eta=None)
        if p["status"] == "finished" and (p.get("info_dict") or {}).get("filepath"):
            set_job(jid, file=p["info_dict"]["filepath"])

    o = base_opts(playlist, imp=d.get("imp"))
    tmpl = "%(title).150B.%(ext)s"
    if playlist:
        tmpl = os.path.join("%(playlist_title,playlist_id|Playlist).100B", "%(playlist_index)03d - " + tmpl)
    start, end = d.get("start"), d.get("end")
    if start is not None or end is not None:
        tmpl = tmpl.replace(".%(ext)s", " (clip).%(ext)s")
    # each job works in its own folder, then moves finished files out. Parallel jobs on the
    # same link (e.g. MP4 + MP3) would otherwise reuse/delete each other's files.
    work = os.path.join(dl_dir(), ".volt-tmp", jid)
    o.update(progress_hooks=[hook], postprocessor_hooks=[pp_hook],
             paths={"home": work}, outtmpl=tmpl, windowsfilenames=True,
             concurrent_fragment_downloads=8,
             http_chunk_size=10 * 1024 * 1024,  # chunked requests dodge YouTube throttling
             retries=10, fragment_retries=10, ignoreerrors="only_download" if playlist else False)

    hf = f"[height<={int(height)}]" if height else ""
    pps = []
    if mode == "mp3":
        o["format"] = "bestaudio/best"
        if FFMPEG:   # abr: fixed bitrate (128-320 kbps); none = best variable bitrate (V0)
            pps += [{"key": "FFmpegExtractAudio", "preferredcodec": "mp3",
                     "preferredquality": str(int(d["abr"])) if d.get("abr") else "0"}]
    elif mode == "cover":
        # just the cover / thumbnail picture, as a JPG
        o.update(skip_download=True, writethumbnail=True)
        o["outtmpl"] = {"default": tmpl, "thumbnail": tmpl.replace(".%(ext)s", " (cover).%(ext)s")}
        if FFMPEG:
            pps += [{"key": "FFmpegThumbnailsConvertor", "format": "jpg", "when": "before_dl"}]
    elif mode == "audio":
        # original audio stream, no re-encode (usually Opus or AAC) — fastest, lossless vs source
        o["format"] = "bestaudio/best"
        if FFMPEG:
            pps += [{"key": "FFmpegExtractAudio", "preferredcodec": "best"}]
    elif mode == "original":
        o["format"] = "best"
    elif mode == "phone":
        hp = f"[height<={int(height or 1080)}]"
        o["format"] = f"bv*{hp}[vcodec^=avc]+ba[ext=m4a]/b{hp}[vcodec^=avc]/bv*{hp}+ba/b{hp}/b"
        o["format_sort"] = ["vcodec:h264", "res", "fps", "acodec:aac", "ext:mp4:m4a"]
        o["merge_output_format"] = "mp4"
    elif mode == "mkv":
        # absolute best streams, any codec (VP9 / AV1 / Opus), 4K/8K/HDR
        o["format"] = f"bv*{hf}+ba/b{hf}/bv*+ba/b"
        o["format_sort"] = ["res", "fps", "hdr:12", "vbr", "abr"]
        o["merge_output_format"] = "mkv"
        if FFMPEG:   # single-file sources come out as .mp4/.webm otherwise
            pps += [{"key": "FFmpegVideoRemuxer", "preferedformat": "mkv"}]
    else:
        # highest resolution, prefer mp4/m4a streams so it plays everywhere
        o["format"] = f"bv*{hf}+ba/b{hf}/bv*+ba/b"
        o["format_sort"] = ["res", "fps", "ext:mp4:m4a"]
        o["merge_output_format"] = "mp4"
    if not FFMPEG and mode in ("mp4", "mkv", "phone"):
        o["format"] = f"b{hf}/b"  # can't merge without ffmpeg -> single file
    if d.get("subs") and mode in ("mp4", "mkv", "phone") and FFMPEG:
        o.update(writesubtitles=True, writeautomaticsub=False, subtitleslangs=["en.*", "-live_chat"])
        pps += [{"key": "FFmpegEmbedSubtitle", "already_have_subtitle": False}]
    if FFMPEG and SETTINGS.get("sponsorblock") and "youtu" in url and start is None and end is None and mode != "cover":
        # cut sponsor reads, self-promo and "like and subscribe" bits out of YouTube videos
        cats = ["sponsor", "selfpromo", "interaction"]
        pps += [{"key": "SponsorBlock", "categories": cats, "when": "after_filter"},
                {"key": "ModifyChapters", "remove_sponsor_segments": cats}]
    if FFMPEG and mode != "cover":
        pps += [{"key": "FFmpegMetadata", "add_metadata": True}]
    if FFMPEG and SETTINGS.get("cover", True) and mode in ("mp3", "audio", "mp4", "mkv", "phone") and not playlist_too_big(d):
        # cover art: thumbnails show in Explorer, phones and music players
        o["writethumbnail"] = True
        pps += [{"key": "FFmpegThumbnailsConvertor", "format": "jpg", "when": "before_dl"},
                {"key": "EmbedThumbnail", "already_have_thumbnail": False}]
    if start is not None or end is not None:
        from yt_dlp.utils import download_range_func
        o["download_ranges"] = download_range_func(None, [(start or 0, end if end is not None else float("inf"))])
        o["force_keyframes_at_cuts"] = bool(FFMPEG) and mode in ("mp4", "mkv", "phone")
    o["postprocessors"] = pps

    ok = False
    try:
        fp = _ytdlp_go(jid, o, url, playlist)
        ok = True
    finally:
        # paused: keep the half-done files in the job folder, Resume picks up from them
        if ok or _stopped(jid) != "paused":
            moved = move_out(work) if ok or playlist else {}   # keep finished playlist items even on cancel
            shutil.rmtree(work, ignore_errors=True)
            try:
                os.rmdir(os.path.dirname(work))
            except OSError:
                pass
    if playlist:
        dest = os.path.dirname(next(iter(moved.values()))) if moved else dl_dir()
        n = len([f for f in moved.values() if not f.lower().endswith((".jpg", ".webp", ".png"))]) or len(moved)
        if not moved:
            raise RuntimeError("Nothing in that playlist could be downloaded.")
        set_job(jid, state="done", pct=100, file=dest, name=f"{n} item{'s' if n != 1 else ''} → {os.path.basename(dest)}",
                speed=None, eta=None)
    else:
        dest = moved.get(os.path.normcase(os.path.abspath(fp))) if fp else None
        finish(jid, dest or (next(iter(moved.values())) if len(moved) == 1 else None))


JUNK = re.compile(r"(\.part|\.ytdl|\.temp|\.f\d+\.\w+|\.part-Frag\d+)$", re.I)

def move_out(work):
    """Move finished files from a job folder into the download folder; returns {src: dest}."""
    out = {}
    for root, _, files in os.walk(work):
        for f in files:
            src = os.path.join(root, f)
            if JUNK.search(f):
                continue
            dest = os.path.join(dl_dir(), os.path.relpath(src, work))
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            base, ext = os.path.splitext(dest)
            k = 1
            while os.path.exists(dest):
                dest = f"{base} ({k}){ext}"
                k += 1
            shutil.move(src, dest)
            out[os.path.normcase(os.path.abspath(src))] = dest
    return out


def playlist_too_big(d):
    return bool(d.get("playlist")) and (d.get("count") or 0) > 300


def _ytdlp_go(jid, o, url, playlist):
    with yt_dlp.YoutubeDL(o) as y:
        cached = None if playlist else cache_get(url)
        info = None
        if cached:
            try:  # reuse the analyze step's extraction (saves seconds per download)
                info = y.process_ie_result(y.sanitize_info(cached, True), download=True)
            except Cancelled:
                raise
            except Exception:
                info = None
        if info is None:
            info = y.extract_info(url, download=True)
        if playlist:
            return None
        fp = None
        if info.get("requested_downloads"):
            fp = info["requested_downloads"][-1].get("filepath")
        return fp or JOBS[jid].get("file") or y.prepare_filename(info)


def run_gallery(jid, d):
    single = (d.get("count") or 0) == 1
    target = dl_dir() if single else os.path.join(dl_dir(), "Gallery", re.sub(r'[\\/:*?"<>|]+', "_", (d.get("title") or "gallery"))[:80])
    os.makedirs(target, exist_ok=True)
    total = d.get("count") or 0
    proc = subprocess.Popen(gdl_cmd("-D", target, d["url"]), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            text=True, encoding="utf-8", errors="replace", creationflags=NOWIN)
    JOBS[jid]["_proc"] = proc
    n = 0
    set_job(jid, state="downloading", items=total or None, item=0)
    last = None
    for line in proc.stdout:
        if JOBS[jid]["cancel"]:
            proc.kill()
            raise Cancelled()
        if line.strip():
            n += 1
            last = line.strip().lstrip("# ")
            set_job(jid, item=n, pct=round(min(99, n / total * 100), 1) if total else 0)
    proc.wait()
    if JOBS[jid]["cancel"]:
        raise Cancelled()
    if n == 0:
        msg = [l for l in (proc.stderr.read() or "").strip().splitlines() if l.strip()]
        raise RuntimeError(re.sub(r"^\[[^\]]+\]\[\w+\] ", "", msg[-1]) if msg else "Nothing could be downloaded from that link.")
    if single and last and os.path.isfile(last):
        return finish(jid, last)
    set_job(jid, state="done", pct=100, file=target, name=f"{n} file{'s' if n != 1 else ''} → {os.path.basename(target)}")


def run_direct(jid, d):
    url = d["url"]
    part = JOBS[jid].get("_part")
    if part and os.path.isfile(part):   # paused or cut off earlier: carry on from the .part file
        fp = part[:-5]
    else:
        name = re.sub(r'[\\/:*?"<>|]+', "_", d.get("title") or "download")[:150]
        fp = os.path.join(dl_dir(), name)
        base, ext = os.path.splitext(fp)
        k = 1
        while os.path.exists(fp) or os.path.exists(fp + ".part"):
            fp = f"{base} ({k}){ext}"
            k += 1
        part = fp + ".part"
        open(part, "wb").close()
        set_job(jid, _part=part)
    have = os.path.getsize(part)
    hdr = {"User-Agent": "Mozilla/5.0"}
    if have:
        hdr["Range"] = f"bytes={have}-"
    req = urllib.request.Request(url, headers=hdr)
    with urllib.request.urlopen(req, timeout=30) as r:
        resumed = have and r.status == 206
        if not resumed:
            have = 0
        tot = int(r.headers.get("Content-Length") or 0) + have if r.headers.get("Content-Length") else 0
        done, t0 = have, time.time()
        with open(part, "ab" if resumed else "wb") as f:
            while True:
                if JOBS[jid]["cancel"]:
                    f.close()
                    if _stopped(jid) != "paused":
                        os.remove(part)
                    raise Cancelled()
                b = r.read1(1 << 20) if hasattr(r, "read1") else r.read(1 << 18)   # returns early, so Cancel is quick
                if not b:
                    break
                f.write(b)
                done += len(b)
                sp = (done - have) / max(time.time() - t0, 1e-3)
                set_job(jid, state="downloading", pct=round(done / tot * 100, 1) if tot else 0,
                        speed=human(sp) + "/s", eta=int((tot - done) / sp) if tot and sp else None, bps=sp,
                        downloaded=human(done), total=human(tot))
    os.replace(part, fp)
    set_job(jid, _part=None)
    finish(jid, fp)


def public(j):
    out = {k: v for k, v in j.items() if k not in ("file", "cancel", "pausing") and not k.startswith("_")}
    out["retry"] = bool(j.get("_req"))
    if j["state"] == "queued":
        out["pos"] = GATE.pos(j["id"])
        out["held"] = GATE.paused
    out["exists"] = bool(j.get("file")) and os.path.exists(j["file"]) if j["state"] == "done" else None
    out["path"] = j.get("file") if j["state"] == "done" else None
    return out


THUMBS = {}   # url -> (ctype, bytes); small LRU so lists don't refetch

@app.route("/api/thumb")
def thumb():
    """Fetch preview images server-side: many CDNs block hot-linking from other pages."""
    u = request.args.get("u", "")
    if not re.match(r"^https?://", u, re.I):
        abort(400)
    if u in THUMBS:
        ct, data = THUMBS[u]
    else:
        ref = request.args.get("ref") or u
        try:
            req = urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0", "Referer": ref})
            with urllib.request.urlopen(req, timeout=12) as r:
                ct = r.headers.get("Content-Type", "").split(";")[0]
                if not ct.startswith("image/"):
                    abort(415)
                data = r.read(6 * 1024 * 1024 + 1)
        except Exception:
            abort(502)
        if len(data) > 6 * 1024 * 1024:
            abort(413)
        THUMBS[u] = (ct, data)
        while len(THUMBS) > 120:
            THUMBS.pop(next(iter(THUMBS)))
    from flask import Response
    return Response(data, mimetype=ct, headers={"Cache-Control": "max-age=86400"})


@app.route("/api/jobs")
def jobs():
    with LOCK:
        return jsonify([public(j) for j in sorted(JOBS.values(), key=lambda j: -j["created"])])


def _stop(j):
    j["cancel"] = True
    if j.get("_proc"):
        try:
            j["_proc"].kill()
        except Exception:
            pass
    GATE.kick()


@app.route("/api/cancel/<jid>", methods=["POST"])
def cancel(jid):
    j = JOBS.get(jid) or abort(404)
    if j["state"] == "paused":   # nothing running: just bin the half-done file
        j["pausing"] = False
        set_job(jid, state="cancelled", error=None)
        _drop_partial(j)
        return jsonify(ok=True)
    j["pausing"] = False
    _stop(j)
    return jsonify(ok=True)


def _drop_partial(j):
    shutil.rmtree(os.path.join(dl_dir(), ".volt-tmp", j["id"]), ignore_errors=True)
    if j.get("_part") and os.path.isfile(j["_part"]):
        try:
            os.remove(j["_part"])
        except OSError:
            pass


@app.route("/api/pause/<jid>", methods=["POST"])
def pause(jid):
    """Stop a download but keep what it has so far; Resume carries on from there."""
    j = JOBS.get(jid) or abort(404)
    if j["state"] in FINAL or j["state"] == "paused":
        return jsonify(error="That one isn't downloading."), 400
    j["pausing"] = True
    _stop(j)
    return jsonify(ok=True)


@app.route("/api/resume/<jid>", methods=["POST"])
def resume(jid):
    with LOCK:
        j = JOBS.get(jid) or abort(404)
        if j["state"] != "paused":
            return jsonify(error="That one isn't paused."), 400
        j.update(cancel=False, pausing=False, state="queued", error=None)
    save_history()
    threading.Thread(target=run_job, args=(jid, j["_req"]), daemon=True).start()
    return jsonify(ok=True)


@app.route("/api/front/<jid>", methods=["POST"])
def front(jid):
    """A waiting download jumps the queue and starts next."""
    JOBS.get(jid) or abort(404)
    if not GATE.front(jid):
        return jsonify(error="That one isn't waiting in the queue."), 400
    return jsonify(ok=True)


@app.route("/api/queue", methods=["POST"])
def queue():
    """{paused: true} holds every download that hasn't started; running ones carry on."""
    d = request.json or {}
    if "paused" in d:
        GATE.pause(d["paused"])
    if d.get("pause_all") or d.get("resume_all"):
        with LOCK:
            rows = list(JOBS.values())
        for j in rows:
            if d.get("pause_all") and j["state"] not in FINAL + ("paused",):
                j["pausing"] = True
                _stop(j)
            elif d.get("resume_all") and j["state"] == "paused":
                resume(j["id"])
    return jsonify(paused=GATE.paused, waiting=len(GATE.waiting))


@app.route("/api/clear", methods=["POST"])
def clear():
    with LOCK:
        stash([JOBS.pop(k) for k in [k for k, j in JOBS.items() if j["state"] in FINAL]])
    save_history()
    return jsonify(ok=True)


@app.route("/api/file/<jid>")
def get_file(jid):
    j = JOBS.get(jid)
    if not j or not j.get("file") or not os.path.isfile(j["file"]):
        abort(404)
    return send_file(j["file"], as_attachment=True, download_name=os.path.basename(j["file"]))


@app.route("/api/open", methods=["POST"])
def open_folder():
    d = request.json or {}
    jid = d.get("id")
    target = JOBS.get(jid, {}).get("file") if jid else None
    if jid and target and not os.path.exists(target):
        return jsonify(error="That file was moved or deleted."), 404
    try:
        if d.get("play") and target and os.path.isfile(target):
            if sys.platform.startswith("win"):
                os.startfile(target)
            else:
                subprocess.Popen(["open" if sys.platform == "darwin" else "xdg-open", target])
        elif sys.platform.startswith("win"):
            if target and os.path.isfile(target):
                subprocess.Popen(["explorer", "/select,", os.path.normpath(target)])
            else:
                os.startfile(target if target and os.path.isdir(target) else dl_dir())
        elif sys.platform == "darwin":
            subprocess.Popen(["open", "-R", target] if target else ["open", dl_dir()])
        else:
            subprocess.Popen(["xdg-open", target if target and os.path.isdir(target) else dl_dir()])
    except Exception as e:
        return jsonify(error=str(e)), 500
    return jsonify(ok=True)


# ---------- search: type words instead of a link ----------
@app.route("/api/search", methods=["POST"])
def search():
    q = str((request.json or {}).get("q", "")).strip()[:200]
    if not q:
        return jsonify(error="Type something to search for."), 400
    where = (request.json or {}).get("where", "yt")
    prefix = {"yt": "ytsearch12:", "sc": "scsearch12:"}.get(where, "ytsearch12:")
    try:
        o = base_opts(True)
        o["extract_flat"] = "in_playlist"
        with yt_dlp.YoutubeDL(o) as y:
            r = y.extract_info(prefix + q, download=False)
    except Exception as e:
        return jsonify(error=clean_err(e)), 400
    out = []
    for e in r.get("entries") or []:
        if not e:
            continue
        url = e.get("url") or e.get("webpage_url")
        if url and not url.startswith("http") and e.get("ie_key") == "Youtube":
            url = "https://www.youtube.com/watch?v=" + url
        thumbs = e.get("thumbnails") or []
        out.append(dict(title=e.get("title"), url=url, duration=e.get("duration"), views=e.get("view_count"),
                        channel=e.get("channel") or e.get("uploader"),
                        thumb=e.get("thumbnail") or (thumbs[-1].get("url") if thumbs else None)))
    return jsonify(results=out)


# ---------- clipboard watch (Windows): copy a link anywhere, VOLT offers it ----------
CLIPW = {"seq": 0, "url": None, "ts": 0}

def _clip_text():
    import ctypes
    from ctypes import wintypes
    u32, k32 = ctypes.windll.user32, ctypes.windll.kernel32
    u32.GetClipboardData.restype = wintypes.HANDLE
    k32.GlobalLock.restype = ctypes.c_void_p
    k32.GlobalLock.argtypes = [wintypes.HANDLE]
    k32.GlobalUnlock.argtypes = [wintypes.HANDLE]
    if not u32.IsClipboardFormatAvailable(13) or not u32.OpenClipboard(None):
        return None
    try:
        h = u32.GetClipboardData(13)
        p = k32.GlobalLock(h) if h else None
        if not p:
            return None
        try:
            return ctypes.wstring_at(p)[:4000]
        finally:
            k32.GlobalUnlock(h)
    finally:
        u32.CloseClipboard()

def clip_watch():
    if not sys.platform.startswith("win"):
        return
    import ctypes
    seq = ctypes.windll.user32.GetClipboardSequenceNumber()
    while True:
        time.sleep(0.7)
        if not SETTINGS.get("clipwatch"):
            continue
        now = ctypes.windll.user32.GetClipboardSequenceNumber()
        if now == seq:
            continue
        seq = now
        try:
            t = (_clip_text() or "").strip()
        except Exception:
            continue
        m = re.match(r"^https?://\S+$", t)
        if m and t != CLIPW["url"]:
            CLIPW.update(seq=CLIPW["seq"] + 1, url=t, ts=time.time())

@app.route("/api/clipwatch")
def clipwatch():
    # jsonify() refuses a dict plus keywords together, so merge first (this was a 500 on every poll)
    return jsonify(dict(CLIPW, on=bool(SETTINGS.get("clipwatch"))))


@app.route("/api/stats")
def stats():
    n, size, today = 0, 0, 0
    t0 = time.mktime(time.localtime()[:3] + (0, 0, 0, 0, 0, -1))
    with LOCK:
        done = [j for j in JOBS.values() if j["state"] == "done" and j.get("file")]
    for j in done:
        f = j["file"]
        if os.path.isfile(f):
            n += 1
            size += os.path.getsize(f)
        elif os.path.isdir(f):
            for root, _, fs in os.walk(f):
                for x in fs:
                    n += 1
                    size += os.path.getsize(os.path.join(root, x))
        if (j.get("ended") or 0) >= t0:
            today += 1
    return jsonify(files=n, size=human(size) or "0 B", today=today,
                   phone=sum(1 for j in done if j.get("source")))


# ---------- engine updates (sites change often; new yt-dlp fixes them) ----------
UPDATE = {"state": "idle"}
LATEST = {}
# Upgrade only the engines themselves. Their compiled helpers (charset_normalizer, curl_cffi, ...)
# are loaded by the running VOLT, Windows locks those files, and a blanket upgrade used to fail.
ENGINES = ("yt-dlp", "yt-dlp-ejs", "gallery-dl")
WANT = ("yt-dlp[default]", "gallery-dl", "curl_cffi")


def find_uv():
    home = os.path.expanduser("~")
    for p in (shutil.which("uv"), os.path.join(os.environ.get("LOCALAPPDATA", ""), "Microsoft", "WinGet", "Links", "uv.exe"),
              os.path.join(home, ".local", "bin", "uv.exe"), os.path.join(home, ".cargo", "bin", "uv.exe")):
        if p and os.path.isfile(p):
            return p
    return None


def installed_version(pkg="yt-dlp"):
    """What's on disk now (the running VOLT keeps the version it started with until a restart)."""
    try:
        r = subprocess.run([sys.executable, "-c", f"import importlib.metadata as m;print(m.version({pkg!r}))"],
                           capture_output=True, text=True, timeout=30, creationflags=NOWIN)
        return r.stdout.strip() or None
    except Exception:
        return None


def update_engines():
    UPDATE.update(state="updating", error=None, how=None)
    tries = []
    uv = find_uv()
    if uv:
        tries.append(("uv", [uv, "pip", "install", "--python", sys.executable]
                      + [x for p in ENGINES for x in ("--upgrade-package", p)] + list(WANT)))
    tries.append(("pip", [sys.executable, "-m", "pip", "install", "-U", "-q", "--disable-pip-version-check",
                          "--upgrade-strategy", "only-if-needed", "yt-dlp[default]", "gallery-dl", "yt-dlp-ejs"]))
    err = ""
    for how, cmd in tries:
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=600, creationflags=NOWIN,
                               encoding="utf-8", errors="replace")
        except Exception as e:
            err = str(e)
            continue
        if r.returncode == 0:
            UPDATE["how"] = how
            break
        err = ((r.stderr or "") + (r.stdout or "")).strip().splitlines()
        err = (err[-1] if err else f"{how} exited with {r.returncode}")[:300]
    else:
        UPDATE.update(state="failed", error=err or "No installer worked.")
        return
    new = installed_version()
    UPDATE.update(state="done", new=new, restart=bool(new and new != yt_dlp.version.__version__))
    try:
        open(os.path.join(CFG_DIR, "last_update"), "w").write(str(time.time()))
    except OSError:
        pass


@app.route("/api/update", methods=["POST"])
def update():
    if UPDATE["state"] != "updating":
        threading.Thread(target=update_engines, daemon=True).start()
    return jsonify(dict(UPDATE, state="updating"))

@app.route("/api/update")
def update_state():
    return jsonify(dict(UPDATE, loaded=yt_dlp.version.__version__, latest=LATEST.get("ytdlp")))


def check_latest():
    """Newest yt-dlp on PyPI (cached), so the UI can say when an update is waiting."""
    if time.time() - LATEST.get("ts", 0) < 6 * 3600:
        return
    try:
        req = urllib.request.Request("https://pypi.org/pypi/yt-dlp/json", headers={"User-Agent": "VOLT"})
        with urllib.request.urlopen(req, timeout=10) as r:
            LATEST.update(ytdlp=json.load(r)["info"]["version"], ts=time.time())
    except Exception:
        LATEST["ts"] = time.time() - 5 * 3600   # try again in an hour


def busy_jobs():
    with LOCK:
        return [j for j in JOBS.values() if j["state"] not in FINAL + ("paused",)]


def auto_update():
    try:
        last = float(open(os.path.join(CFG_DIR, "last_update")).read())
    except Exception:
        last = 0
    if time.time() - last > 24 * 3600:
        update_engines()
    check_latest()
    # a newer engine is on disk: switch to it as soon as nothing is downloading
    while UPDATE.get("restart"):
        if not busy_jobs():
            return restart_self()
        time.sleep(30)


def restart_self(delay=0.5):
    """Start a fresh VOLT (it waits for this one to free the port) and quit.
    Unfinished downloads are saved and carry on in the new one."""
    RESTARTING.append(time.time())
    save_history()
    args = [sys.executable, os.path.abspath(__file__), "--no-browser", "--wait"]

    def go():
        save_history()
        subprocess.Popen(args, cwd=BASE, creationflags=NOWIN | getattr(subprocess, "DETACHED_PROCESS", 0)
                         | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0), close_fds=True)
        os._exit(0)
    threading.Timer(delay, go).start()


@app.route("/api/restart", methods=["POST"])
def restart():
    n = len(busy_jobs())
    if n and not (request.json or {}).get("force"):
        return jsonify(error=f"{n} download{'s are' if n != 1 else ' is'} still going. They'll carry on after the restart.",
                       busy=n), 409
    RESTARTING.append(time.time())
    for j in busy_jobs():   # stop cleanly so partial files stay; the new VOLT resumes them
        j["pausing"] = True
        _stop(j)
    restart_self(2.0 if n else 0.5)
    return jsonify(ok=True)


def already_running():
    """If VOLT is open in another window, just bring up the page instead of crashing."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sk:
        if sk.connect_ex(("127.0.0.1", PORT)) != 0:
            return False
    try:
        local = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with local.open(f"http://127.0.0.1:{PORT}/api/status", timeout=3) as r:
            return b"ytdlp" in r.read()
    except Exception:
        print(f"  Port {PORT} is used by another program. Close it and run start.bat again.")
        sys.exit(1)


def wait_for_port(t=15):
    """--wait: a restart. Give the old VOLT a moment to let go of the port."""
    end = time.time() + t
    while time.time() < end:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sk:
            if sk.connect_ex(("127.0.0.1", PORT)) != 0:
                return
        time.sleep(0.2)


if __name__ == "__main__":
    if "--wait" in sys.argv:
        wait_for_port()
    if already_running():
        print(f"\n  ⚡ VOLT is already running, opening http://127.0.0.1:{PORT}")
        if "--no-browser" not in sys.argv:
            webbrowser.open(f"http://127.0.0.1:{PORT}")
        sys.exit(0)
    print("\n  ⚡ VOLT %s running at  http://127.0.0.1:%d" % (VERSION, PORT))
    print("  ffmpeg:", FFMPEG or "NOT FOUND (videos limited to single-file formats)")
    print("  JS runtime:", ", ".join(JS_RT) if JS_RT else "none (install Deno for full YouTube support)")
    print("  galleries:", "gallery-dl ready" if GDL else "gallery-dl missing (image posts won't work)")
    print("  saving to:", dl_dir(), "\n")
    resume_pending()
    threading.Thread(target=auto_update, daemon=True).start()
    threading.Thread(target=clip_watch, daemon=True).start()
    if "--no-browser" not in sys.argv:
        threading.Timer(1.0, lambda: webbrowser.open(f"http://127.0.0.1:{PORT}")).start()
    app.run(host="127.0.0.1", port=PORT, threaded=True)
