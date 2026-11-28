"""QT Suite Toolkit layer: 32 extra features, kept out of the shared files.

Hub hooks (app.py): kit.init(port) at boot, kit.get(handler, path, query) in do_GET, kit.post(handler) in do_POST.
Pages + scripts are in kit/web (served at /kit/...), the phone side in kit/web/phone (served by phone.py on 7804).
Each feature module registers its own routes with @hub_get / @hub_post / @raw_get.
"""
import importlib
import json
import mimetypes
import os
import threading
import traceback

from . import common

GET, POST, RAW = {}, {}, {}
INFO = {"port": 7800, "errors": {}}
MODULES = ["core", "phonefx", "money", "care", "desk", "media", "games", "meta"]


def hub_get(path):
    def deco(fn):
        GET[path] = fn
        return fn
    return deco


def hub_post(path):
    def deco(fn):
        POST[path] = fn
        return fn
    return deco


def raw_get(path):
    def deco(fn):
        RAW[path] = fn
        return fn
    return deco


def init(port=7800):
    INFO["port"] = port
    for m in MODULES:
        try:
            mod = importlib.import_module("kit." + m)
            if hasattr(mod, "init"):
                mod.init()
        except Exception:
            INFO["errors"][m] = traceback.format_exc()[-1500:]
    from . import phone
    if os.environ.get("QT_KIT_NO_PHONE") != "1":
        threading.Thread(target=phone.start, daemon=True).start()


def _send(h, code, body, ctype="application/json"):
    if isinstance(body, (dict, list)):
        body = json.dumps(body).encode()
    elif isinstance(body, str):
        body = body.encode()
    h.send_response(code)
    h.send_header("Content-Type", ctype)
    h.send_header("Content-Length", str(len(body)))
    h.send_header("Cache-Control", "no-store")
    h.end_headers()
    h.wfile.write(body)


def get(h, path, query):
    """True when the Toolkit answered this GET."""
    if path.startswith("/kit/"):
        rel = os.path.normpath(path[5:]).lstrip("\\/")
        full = os.path.join(common.WEB, rel)
        if rel.startswith("..") or not os.path.isfile(full) or os.path.commonpath([full, common.WEB]) != common.WEB:
            _send(h, 404, {"error": "not found"})
            return True
        with open(full, "rb") as f:
            _send(h, 200, f.read(), (mimetypes.guess_type(full)[0] or "application/octet-stream") + ("; charset=utf-8" if full.endswith((".js", ".css", ".html")) else ""))
        return True
    if path.startswith("/kit-plugins/"):
        from . import meta
        meta.plugin_file(h, path)
        return True
    if not path.startswith("/api/kit/"):
        return False
    if h.headers.get("Sec-Fetch-Site", "same-origin") not in ("same-origin", "none"):
        _send(h, 403, {"error": "cross-site"})
        return True
    try:
        if path in RAW:
            RAW[path](h, query)
            return True
        fn = GET.get(path)
        if not fn:
            _send(h, 404, {"error": "no such endpoint"})
            return True
        r = fn(query)
        _send(h, *r)
    except (ConnectionError, OSError) as e:
        if not isinstance(e, ConnectionError):
            try:
                _send(h, 500, {"ok": False, "msg": str(e)})
            except OSError:
                pass
    except Exception as e:
        _send(h, 500, {"ok": False, "msg": f"{type(e).__name__}: {e}"})
    return True


def post(h):
    path = h.path.split("?")[0]
    if not path.startswith("/api/kit/"):
        return False
    n = int(h.headers.get("Content-Length") or 0)
    raw = h.rfile.read(min(n, 4 << 20)) if n else b""
    try:
        body = json.loads(raw or b"{}")
    except ValueError:
        body = {}
    body = body if isinstance(body, dict) else {}
    fn = POST.get(path)
    if path.startswith("/api/kit/plug/"):
        from . import meta
        parts = path.split("/", 5)
        fn = lambda b: meta.plugin_api(parts[4], "/" + (parts[5] if len(parts) > 5 else ""), b)
    if not fn:
        _send(h, 404, {"error": "no such endpoint"})
        return True
    try:
        _send(h, *fn(body))
    except Exception as e:
        _send(h, 500, {"ok": False, "msg": f"{type(e).__name__}: {e}"})
    return True
