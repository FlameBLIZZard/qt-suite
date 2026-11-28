"""Routes for Clipvault and the Kharcha PC link, kept out of app.py.

app.py calls route(handler, method, path, q) after the key check; it returns True when it answered.
"""
import json
import os
import time

import dailylink
import kharchasync
import lenslink
import ping  # phone notifications on the PC
import vault

APP = None  # the app module, for CFG / set_pc_clip / lan_ips


def init(app):
    global APP
    APP = app
    vault.init()
    kharchasync.init()
    lenslink.init()
    ping.init()
    ping.toast_hook = ping_toast


def route(h, method, path, q):
    if path == "/daily" or path.startswith("/daily/"):  # Daily dashboard (QT\daily), see dailylink.py
        return dailylink.route(h, method, path, q, APP)
    if method == "GET" and path in ("/notify", "/notify/"):
        h.static("notify.html")
        return True
    if path.startswith("/api/notify"):
        ping.api(h, method, path[11:].strip("/"), q)
        return True
    if method == "GET" and path in ("/kharcha", "/kharcha/"):
        h.static("kharcha.html")
        return True
    if path.startswith("/api/vault"):
        api_vault(h, method, path[10:].strip("/"), q)
        return True
    if path.startswith("/api/lens"):
        lenslink.api(h, method, path[9:].strip("/"), q, APP)
        return True
    if path.startswith("/api/kharcha"):
        api_kharcha(h, method, path[12:].strip("/"), q)
        return True
    return False


def arg(q, k, d=""):
    return q.get(k, [d])[0]


# ---------------------------------------------------------------- Clipvault ---
def api_vault(h, method, rest, q):
    # GET    /api/vault?q=&src=pc|phone&kind=text|image&pinned=1&before=<ts>
    # GET    /api/vault/<id>/img          the screenshot
    # POST   /api/vault/<id>/pin {on}     pin / unpin
    # POST   /api/vault/<id>/apply        put it on the PC clipboard
    # DELETE /api/vault/<id>              forget one
    # DELETE /api/vault?all=1             forget everything not pinned
    # GET    /api/vault?type=link|code|...&since=<ts>   type filter, live "what's new" poll
    # GET    /api/vault/stats             counts for the filter chips
    # GET    /api/vault/latest?src=pc     newest text copy (the phone's "Get PC clipboard")
    # GET    /api/vault/export?fmt=json|txt
    # POST   /api/vault/<id>/bump         copied again from the vault: move to the top
    parts = rest.split("/") if rest else []
    if method == "GET" and not parts:
        def num(k, cast=float):   # junk in the query string means "not given", not a crash
            try:
                return cast(arg(q, k)) if arg(q, k) else None
            except ValueError:
                return None
        res = vault.search(arg(q, "q"), arg(q, "src"), arg(q, "kind"), arg(q, "pinned") == "1",
                           num("before"), max(1, min(200, num("limit", int) or 60)),
                           arg(q, "type"), num("since"))
        res["on"] = bool(APP.CFG.get("vault", True))
        if arg(q, "stats") == "1":
            res["stats"] = vault.stats()
        return h.json(res)
    if method == "GET" and parts == ["stats"]:
        return h.json(vault.stats())
    if method == "GET" and parts == ["latest"]:
        c = vault.latest(arg(q, "src") or None)
        if not c:  # Clipvault paused: fall back to Beam's short in-memory history
            mem = [x for x in reversed(APP.CLIPS) if x.get("text") and (arg(q, "src") != "pc" or x.get("from") == "PC")]
            c = {"text": mem[0]["text"], "src": mem[0]["from"], "last": mem[0]["ts"]} if mem else None
        if not c:
            return h.json({"error": "Nothing copied yet"}, 404)
        return h.json({"clip": c})
    if method == "GET" and parts == ["export"]:
        fmt = "txt" if arg(q, "fmt") == "txt" else "json"
        fn = time.strftime("clipvault-%Y-%m-%d.") + fmt
        return h.send(200, vault.export(fmt), "text/plain; charset=utf-8" if fmt == "txt" else "application/json",
                      {"Content-Disposition": f'attachment; filename="{fn}"'})
    if method == "GET" and len(parts) == 2 and parts[1] == "img":
        p = vault.image_path(parts[0]) if parts[0].isdigit() else None
        if not p or not os.path.isfile(p):
            return h.json({"error": "gone"}, 404)
        with open(p, "rb") as f:
            return h.send(200, f.read(), "image/bmp", {"Cache-Control": "max-age=31536000, immutable"})
    if method == "POST" and len(parts) == 2 and parts[0].isdigit():
        body = h.body_json()
        if parts[1] == "pin":
            vault.pin(parts[0], bool(body.get("on", True)))
            return h.json({"ok": True})
        if parts[1] == "apply":
            c = vault.get(parts[0])
            if not c or "text" not in c:
                return h.json({"error": "Only text can go on the PC clipboard"}, 404)
            APP.set_pc_clip(c["text"])
            return h.json({"ok": True, "clip": vault.bump(parts[0])})
        if parts[1] == "bump":
            return h.json({"clip": vault.bump(parts[0])})
    if method == "DELETE":
        if parts and parts[0].isdigit():
            vault.delete(parts[0])
            return h.json({"ok": True})
        if arg(q, "all") == "1":
            vault.clear(keep_pinned=True)
            return h.json({"ok": True})
    if method == "POST" and parts == ["settings"]:
        body = h.body_json()
        if "on" in body:
            APP.CFG["vault"] = bool(body["on"])
            APP.save_json(APP.CONFIG_PATH, APP.CFG)
        return h.json({"on": bool(APP.CFG.get("vault", True))})
    h.drain()
    return h.json({"error": "bad request"}, 400)


def save_clip(source, text=None, bmp=None):
    if APP and APP.CFG.get("vault", True):
        try:
            vault.add(source, text=text, bmp=bmp)
        except Exception as e:
            print("[beam] clipvault:", e)


# ----------------------------------------------------------- Kharcha link ---
def api_kharcha(h, method, rest, q):
    if method == "POST" and rest == "sync":
        dev = APP.device_name(h.headers.get("User-Agent"), h.local)
        res = kharchasync.sync(h.body_json(), dev)
        port = h.server.server_address[1]
        res["pc"] = APP.socket.gethostname()
        res["urls"] = [f"http://{ip}:{port}/?k={APP.CFG['key']}" for ip in APP.lan_ips()]
        return h.json(res)
    if method == "GET" and not rest:
        snap = kharchasync.snapshot() or {}
        return h.json({"state": snap.get("state"), "at": snap.get("at"), "device": snap.get("device"),
                       "inbox": kharchasync.inbox(), "backups": kharchasync.backups()[:30]})
    if method == "POST" and rest == "add":
        try:
            return h.json({"item": kharchasync.add(h.body_json())})
        except ValueError as e:
            return h.json({"error": str(e)}, 400)
    if method == "DELETE" and rest.startswith("inbox/"):
        kharchasync.drop(rest[6:])
        return h.json({"ok": True})
    if method == "GET" and (rest == "backup" or rest.startswith("backup/")):
        name = rest[7:] or None
        p = kharchasync.backup_path(name)
        if not p:
            return h.json({"error": "No backup yet. Open Kharcha on the phone with PC sync on."}, 404)
        with open(p, encoding="utf-8") as f:
            data = json.load(f)
        if name is None:
            data = data.get("state")
        fn = name or time.strftime("kharcha-backup-%Y-%m-%d.json")
        return h.send(200, json.dumps(data, ensure_ascii=False), "application/json",
                      {"Content-Disposition": f'attachment; filename="{fn}"'})
    h.drain()
    return h.json({"error": "bad request"}, 400)


def ping_toast(n):
    """A new phone notification: show a Windows toast (pingtoast.py, best effort)."""
    try:
        import pingtoast
        pingtoast.show(n)
    except Exception as e:
        print("[beam] ping toast:", e)
