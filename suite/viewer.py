"""QT Suite Peek: open files inside the suite instead of handing them to other apps.

The hub (app.py) sends /api/peek/* here. Everything is read-only except "open in app",
"show in Explorer" and "send to phone". Reads are limited to same-origin requests (the
hub page itself), so other websites can't pull files through it.
"""
import io
import json
import mimetypes
import os
import re
import subprocess
import time
import urllib.parse
import urllib.request
import zipfile
from xml.etree import ElementTree as ET

NOWIN = 0x08000000
for ext, typ in ((".mkv", "video/x-matroska"), (".webp", "image/webp"), (".avif", "image/avif"), (".m4a", "audio/mp4"),
                 (".flac", "audio/flac"), (".opus", "audio/ogg"), (".weba", "audio/webm"), (".md", "text/plain"),
                 (".ts", "text/plain"), (".tsx", "text/plain"), (".jsx", "text/plain"), (".py", "text/plain"),
                 (".woff2", "font/woff2"), (".woff", "font/woff"), (".ttf", "font/ttf"), (".otf", "font/otf"),
                 (".heic", "image/heic"), (".ogv", "video/ogg"), (".mjs", "text/plain"), (".srt", "text/plain"), (".vtt", "text/vtt")):
    mimetypes.add_type(typ, ext)

KINDS = {
    "image": "jpg jpeg png gif webp bmp ico svg avif jfif apng",
    "picture": "heic heif tif tiff psd tga dds pcx ppm",            # Pillow turns these into a PNG/JPEG
    "video": "mp4 webm mov m4v mkv ogv",
    "audio": "mp3 wav flac m4a aac ogg opus weba oga",
    "pdf": "pdf",
    "markdown": "md markdown mdown",
    "table": "csv tsv",
    "json": "json inkm geojson webmanifest",
    "html": "html htm xhtml",
    "font": "ttf otf woff woff2",
    "zip": "zip apk jar xpi crx whl nupkg",
    "docx": "docx",
    "code": ("txt log py pyw js mjs cjs ts tsx jsx css scss less xml yml yaml toml ini cfg conf bat cmd ps1 psm1 sh bash zsh "
             "java kt kts c cc cpp cxx h hpp cs go rs lua gd gdshader gradle properties env gitignore gitattributes editorconfig "
             "pxl srt vtt sql php rb swift dart vue svelte r m mm pl diff patch lock csproj sln vcxproj makefile dockerfile "
             "nfo reg tex bib rst adoc org csv"),
    "media-x": "avi wmv flv 3gp mpg mpeg ts m2ts vob",               # video the browser can't play
}
EXT2KIND = {}
for k, v in KINDS.items():
    for e in v.split():
        EXT2KIND.setdefault(e, k)
NAMED = {"makefile": "code", "dockerfile": "code", "license": "code", "readme": "code", "procfile": "code"}
TEXT_MAX = 2 * 1024 * 1024
SANDBOX = {".html", ".htm", ".xhtml", ".svg", ".xml"}   # never run a file's own scripts on the hub's origin

_start = None
_beam = None
_port_up = None


def init(start, beam_tool, port_up):
    global _start, _beam, _port_up
    _start, _beam, _port_up = start, beam_tool, port_up


def kind_of(path):
    name = os.path.basename(path)
    ext = os.path.splitext(name)[1][1:].lower()
    if not ext:
        return NAMED.get(name.lower(), "other")
    return EXT2KIND.get(ext, "other")


def norm(p):
    p = os.path.expandvars(os.path.expanduser(str(p or "").strip().strip('"')))
    return os.path.abspath(p) if p else ""


def _decode(raw):
    if raw.startswith((b"\xff\xfe", b"\xfe\xff")):
        return raw.decode("utf-16", "replace")
    for enc in ("utf-8-sig", "cp1252"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            pass
    return raw.decode("utf-8", "replace")


def _is_binary(raw):
    return b"\x00" in raw[:8000] and not raw.startswith((b"\xff\xfe", b"\xfe\xff"))


def read_text(path, limit=TEXT_MAX):
    size = os.path.getsize(path)
    with open(path, "rb") as f:
        raw = f.read(limit)
    if _is_binary(raw):
        return None, size > limit
    return _decode(raw), size > limit


def zip_list(path, cap=3000):
    with zipfile.ZipFile(path) as z:
        il = z.infolist()
        rows = [{"n": i.filename, "s": i.file_size, "c": i.compress_size, "d": i.is_dir(),
                 "m": time.mktime(i.date_time + (0, 0, -1)) if i.date_time[0] > 1980 else 0} for i in il[:cap]]
        return {"count": len(il), "size": sum(i.file_size for i in il), "packed": sum(i.compress_size for i in il),
                "rows": rows, "capped": len(il) > cap}


W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def docx_blocks(path, cap=4000):
    """Paragraphs of a Word file as [{"t": "h1".."h4"|"p"|"li", "x": text}] - enough to read it, not to edit it."""
    with zipfile.ZipFile(path) as z:
        root = ET.fromstring(z.read("word/document.xml"))
    out = []
    for p in root.iter(W + "p"):
        style = p.find(f"{W}pPr/{W}pStyle")
        sid = (style.get(W + "val") if style is not None else "") or ""
        text = "".join((t.text or "") if t.tag == W + "t" else ("\t" if t.tag == W + "tab" else "\n")
                       for t in p.iter() if t.tag in (W + "t", W + "tab", W + "br"))
        if not text.strip():
            continue
        m = re.match(r"(?i)heading(\d)|title", sid)
        kind = ("h" + (m.group(1) or "1")) if m else ("li" if p.find(f"{W}pPr/{W}numPr") is not None or "list" in sid.lower() else "p")
        out.append({"t": kind if kind[:1] != "h" or int(kind[1:]) <= 4 else "h4", "x": text})
        if len(out) >= cap:
            break
    return out


def image_dims(path):
    try:
        from PIL import Image
        with Image.open(path) as im:
            return list(im.size)
    except Exception:
        return None


def info(path):
    path = norm(path)
    if not os.path.exists(path):
        return 404, {"error": "That isn't there any more."}
    st = os.stat(path)
    name = os.path.basename(path.rstrip("\\/")) or path
    if os.path.isdir(path):
        return 200, {"path": path, "name": name, "dir": True, "kind": "folder", "m": st.st_mtime}
    k = kind_of(path)
    ext = os.path.splitext(name)[1][1:].lower()
    d = {"path": path, "name": name, "dir": False, "folder": os.path.dirname(path), "kind": k, "ext": ext, "size": st.st_size,
         "m": st.st_mtime, "c": st.st_ctime, "mime": mimetypes.guess_type(path)[0] or ""}
    try:
        if k in ("code", "markdown", "table", "json", "html", "other") and (k != "other" or st.st_size < 4 * 1024 * 1024):
            text, cut = read_text(path)
            if text is None:
                if k != "other":
                    d["kind"] = k = "other"
            else:
                if k == "other":
                    d["kind"] = k = "code"
                d.update(text=text, cut=cut)
        if k == "other":
            with open(path, "rb") as f:
                d["head"] = f.read(512).hex()
        elif k == "zip":
            d["zip"] = zip_list(path)
        elif k == "docx":
            d["blocks"] = docx_blocks(path)
        elif k in ("image", "picture") and ext != "svg":
            d["dims"] = image_dims(path)
    except (zipfile.BadZipFile, KeyError, ET.ParseError):
        d["kind"] = "other"
        d["broken"] = True
        with open(path, "rb") as f:
            d["head"] = f.read(512).hex()
    return 200, d


def places():
    """The usual folders, so each viewer app can show what's in them (OneDrive-moved ones too)."""
    home = os.path.expanduser("~")
    out = []
    for n in ("Pictures", "Videos", "Music", "Documents", "Downloads", "Desktop"):
        for p in (os.path.join(home, "OneDrive", n), os.path.join(home, n)):
            if os.path.isdir(p):
                out.append({"name": n, "path": p})
                break
    shots = os.path.join(next((x["path"] for x in out if x["name"] == "Pictures"), ""), "Screenshots")
    if os.path.isdir(shots):
        out.append({"name": "Screenshots", "path": shots})
    out.append({"name": "QT tools", "path": os.path.dirname(os.path.dirname(os.path.abspath(__file__)))})
    return 200, {"home": home, "places": out}


def natural(s):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", s)]


def near(path, cap=3000):
    """The other files in the same folder, for previous / next."""
    path = norm(path)
    folder = path if os.path.isdir(path) else os.path.dirname(path)
    files, dirs = [], []
    try:
        with os.scandir(folder) as it:
            for de in it:
                try:
                    if de.is_dir():
                        if not de.name.startswith((".", "$")) and not de.stat().st_file_attributes & 2:
                            dirs.append(de.name)
                        continue
                    if not de.is_file():
                        continue
                    st = de.stat()
                    if st.st_file_attributes & 2 or de.name.startswith("~$"):  # hidden / Office lock files
                        continue
                except (OSError, AttributeError):
                    continue
                files.append({"n": de.name, "s": st.st_size, "m": st.st_mtime, "k": kind_of(de.name)})
    except OSError:
        return 404, {"error": "That folder isn't there."}
    files.sort(key=lambda f: natural(f["n"]))
    dirs.sort(key=natural)
    parent = os.path.dirname(folder.rstrip("\\/"))
    return 200, {"dir": folder, "parent": parent if parent and parent != folder else "", "dirs": dirs[:500],
                 "files": files[:cap], "capped": len(files) > cap}


def render(path, size):
    """A picture Edge can't show (HEIC, TIFF, PSD...) or a small strip thumbnail, as JPEG/PNG bytes."""
    from PIL import Image, ImageOps
    path = norm(path)
    with Image.open(path) as im:
        if size and im.format == "JPEG":
            im.draft("RGB", (size * 2, size * 2))   # decode a smaller JPEG straight away: strip thumbs stay quick
        im = ImageOps.exif_transpose(im)
        if size:
            im.thumbnail((size, size))
        alpha = im.mode in ("RGBA", "LA", "P") and ("transparency" in im.info or im.mode != "P")
        buf = io.BytesIO()
        if alpha:
            im.convert("RGBA").save(buf, "PNG", optimize=size and size <= 256)
            return buf.getvalue(), "image/png"
        im.convert("RGB").save(buf, "JPEG", quality=88)
        return buf.getvalue(), "image/jpeg"


def _qt_is_default(path):
    try:
        import defaults
        ext = os.path.splitext(path)[1][1:].lower()
        return bool(ext) and defaults.is_ours(ext)
    except Exception:
        return False


def open_in(path, how):
    path = norm(path)
    if not os.path.exists(path):
        return 404, {"ok": False, "msg": "That isn't there any more."}
    if how == "reveal":
        subprocess.Popen(["explorer", "/select,", path])
    elif how == "with" or _qt_is_default(path):  # QT is this type's default: "Windows app" would just reopen QT
        subprocess.Popen(["rundll32", "shell32.dll,OpenAs_RunDLL", path])
    else:
        os.startfile(path)
    return 200, {"ok": True, "msg": "opened"}


def beam(path):
    path = norm(path)
    if not os.path.isfile(path):
        return 404, {"ok": False, "msg": "That isn't there any more."}
    if not _port_up(7788):
        ok, msg = _start(_beam)
        if not ok:
            return 502, {"ok": False, "msg": "Beam didn't start: " + msg}
    req = urllib.request.Request("http://127.0.0.1:7788/api/pc/share", data=json.dumps({"paths": [path]}).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req, timeout=20) as r:
            json.loads(r.read() or b"{}")
    except Exception as e:
        return 502, {"ok": False, "msg": f"Beam said: {str(e)[:120]}"}
    return 200, {"ok": True, "msg": "On its way to your phone"}


# ------------------------------------------------------------------ routes ---
def get(handler, p, q):
    """Handle GET /api/peek/*. Returns True when it answered."""
    if not p.startswith("/api/peek/"):
        return False
    if handler.headers.get("Sec-Fetch-Site", "same-origin") not in ("same-origin", "none"):
        handler._send(403, {"error": "cross-site"})
        return True
    what = p[10:]
    path = q.get("path", [""])[0]
    try:
        if what == "info":
            handler._send(*info(path))
        elif what == "near":
            handler._send(*near(path))
        elif what == "places":
            handler._send(*places())
        elif what == "raw":
            entry = q.get("entry", [""])[0]
            if entry:
                _zip_entry(handler, norm(path), entry)
            else:
                _raw(handler, norm(path))
        elif what == "render":
            try:
                s = int(q.get("s", ["0"])[0] or 0)
            except ValueError:
                s = 0
            body, ctype = render(path, max(48, min(4096, s)) if s else 0)
            handler._send(200, body, ctype)
        else:
            handler._send(404, {"error": "not found"})
    except (ConnectionError, OSError) as e:
        if isinstance(e, (FileNotFoundError, PermissionError)):
            try:
                handler._send(404 if isinstance(e, FileNotFoundError) else 403,
                              {"error": "That isn't there any more." if isinstance(e, FileNotFoundError) else "Windows says no access."})
            except OSError:
                pass
    except ImportError:
        handler._send(501, {"error": "Pillow isn't installed for the hub's Python."})
    except Exception as e:
        try:
            handler._send(500, {"error": str(e)[:200]})
        except OSError:
            pass
    return True


def post(p, body):
    if p == "/api/peek/open":
        how = body.get("how") if body.get("how") in ("default", "reveal", "with") else "default"
        return open_in(body.get("path"), how)
    if p == "/api/peek/beam":
        return beam(body.get("path"))
    return None


def _safe_headers(path):
    h = {"Accept-Ranges": "bytes", "Cache-Control": "private, max-age=60", "X-Content-Type-Options": "nosniff"}
    if os.path.splitext(path)[1].lower() in SANDBOX:
        h["Content-Security-Policy"] = "sandbox; default-src 'none'; img-src * data: blob:; style-src 'unsafe-inline' *; font-src *"
    return h


def _raw(h, path):
    if not os.path.isfile(path):
        return h._send(404, {"error": "not found"})
    size = os.path.getsize(path)
    ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
    if ctype.startswith("text/") and "charset" not in ctype:
        ctype += "; charset=utf-8"
    start, end, code = 0, size - 1, 200
    rng = h.headers.get("Range")
    if rng and rng.startswith("bytes=") and size:
        a, _, b = rng[6:].split(",")[0].partition("-")
        try:
            if a:
                start, end = int(a), (int(b) if b else size - 1)
            else:
                start, end = max(0, size - int(b)), size - 1
            end = min(end, size - 1)
            code = 206
        except ValueError:
            pass
        if start > end:
            h.send_response(416)
            h.send_header("Content-Range", f"bytes */{size}")
            h.send_header("Content-Length", "0")
            h.end_headers()
            return
    h.send_response(code)
    h.send_header("Content-Type", ctype)
    h.send_header("Content-Length", str(end - start + 1 if size else 0))
    for k, v in _safe_headers(path).items():
        h.send_header(k, v)
    if code == 206:
        h.send_header("Content-Range", f"bytes {start}-{end}/{size}")
    h.end_headers()
    if h.command == "HEAD" or not size:
        return
    with open(path, "rb") as f:
        f.seek(start)
        left = end - start + 1
        while left > 0:
            b = f.read(min(1 << 20, left))
            if not b:
                break
            h.wfile.write(b)
            left -= len(b)


def _zip_entry(h, path, entry):
    with zipfile.ZipFile(path) as z:
        try:
            i = z.getinfo(entry)
        except KeyError:
            return h._send(404, {"error": "not in the zip"})
        if i.file_size > 64 * 1024 * 1024:
            return h._send(413, {"error": "That one's too big to peek at inside the zip. Extract it first."})
        data = z.read(i)
    ctype = mimetypes.guess_type(entry)[0] or "application/octet-stream"
    if ctype.startswith("text/") and "charset" not in ctype:
        ctype += "; charset=utf-8"
    hd = _safe_headers(entry)
    hd.pop("Accept-Ranges", None)
    hd.pop("Cache-Control", None)
    h._send(200, data, ctype, hd)
