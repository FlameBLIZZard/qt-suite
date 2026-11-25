"""Ping: the phone's notifications on the PC, with replies.

The Beam phone app runs a NotificationListenerService (PingListener.java). It pushes every
notification here and long-polls for commands (reply / dismiss / tap an action / open).
The PC page is static/notify.html at /notify, also a QT Suite tab.

Phone -> PC   POST /api/notify/push      {device, items:[note], gone:[key], snapshot}
              POST /api/notify/icon/<pkg> (body = PNG)
              GET  /api/notify/cmds?wait=25        -> {cmds:[...], mute:[pkg]}
              POST /api/notify/done      {id, ok, error}
PC page       GET  /api/notify?v=N&wait=25         -> {v, notes, phone, settings}
              POST /api/notify/reply     {key, text}  -> {id}
              POST /api/notify/dismiss   {key}         (key "*" = all clearable)
              POST /api/notify/action    {key, idx}
              POST /api/notify/open      {key}
              GET  /api/notify/cmd/<id>             -> {state: queued|sent|ok|failed, error}
              POST /api/notify/seen      {keys|all}
              POST /api/notify/settings  {mute:{pkg:bool}, toast:bool}
              DELETE /api/notify/history            forget everything already gone from the phone
              GET  /api/notify/icon/<pkg>
"""
import json
import os
import re
import threading
import time

ROOT = os.path.join(os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), "Beam", "ping")
ICONS = os.path.join(ROOT, "icons")
PICS = os.path.join(ROOT, "pics")      # contact photos, by content hash
STATE = os.path.join(ROOT, "state.json")
KEEP = 400            # notifications kept (active + history)
ONLINE_S = 45         # phone counts as connected if it called within this many seconds
CMD_TTL = 60          # a command the phone never picked up fails after this
PKG_RE = re.compile(r"^[A-Za-z0-9_.]{1,200}$")

lock = threading.Lock()
changed = threading.Condition(lock)      # page long-poll
cmd_ready = threading.Condition(lock)    # phone long-poll
notes = {}        # key -> note
cmds = []         # queued for the phone
results = {}      # cmd id -> {state, error, at, op, key}
phone = {"seen": 0, "device": "", "access": None, "version": ""}
settings = {"mute": {}, "toast": True, "snooze": 0}
rev = 0
_seq = 0
_dirty = False
toast_hook = None   # set by beamext: called with a note when a new one arrives


def init():
    os.makedirs(ICONS, exist_ok=True)
    os.makedirs(PICS, exist_ok=True)
    global settings
    try:
        with open(STATE, encoding="utf-8") as f:
            d = json.load(f)
        for n in d.get("notes", []):
            n["live"] = False          # unknown until the phone sends its snapshot
            if str(n.get("pic", "")).startswith("data:"):
                n["pic"] = ""
            notes[n["key"]] = n
        settings.update(d.get("settings") or {})
    except (OSError, ValueError):
        pass
    threading.Thread(target=_saver, daemon=True, name="ping-save").start()


def _saver():
    global _dirty
    while True:
        time.sleep(3)
        with lock:
            if not _dirty:
                continue
            _dirty = False
            data = {"notes": sorted(notes.values(), key=lambda n: -n["when"])[:KEEP], "settings": settings}
        tmp = STATE + ".tmp"
        try:
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False)
            os.replace(tmp, STATE)
        except OSError as e:
            print("[beam] ping save:", e)


def _bump():
    """Caller holds the lock."""
    global rev, _dirty
    rev += 1
    _dirty = True
    changed.notify_all()


def _trim():
    if len(notes) <= KEEP:
        return
    gone = sorted((n for n in notes.values() if not n.get("live")), key=lambda n: n["when"])
    for n in gone[:len(notes) - KEEP]:
        notes.pop(n["key"], None)
    _sweep_pics()


def _clean(it):
    """Only keep the fields the page uses, with sane sizes."""
    s = lambda v, n=4000: (str(v) if v is not None else "")[:n]
    msgs = []
    for m in (it.get("msgs") or [])[-30:]:
        if isinstance(m, dict):
            msgs.append({"who": s(m.get("who"), 120), "text": s(m.get("text"), 2000), "at": int(m.get("at") or 0)})
    acts = [s(a, 60) for a in (it.get("actions") or [])[:6]]
    pic = s(it.get("pic"), 60000)
    return {
        "key": s(it.get("key"), 400), "pkg": s(it.get("pkg"), 200), "app": s(it.get("app"), 80),
        "title": s(it.get("title"), 300), "text": s(it.get("text")), "sub": s(it.get("sub"), 200),
        "lines": [s(x, 400) for x in (it.get("lines") or [])[:8]], "msgs": msgs,
        "when": int(it.get("when") or time.time() * 1000), "reply": bool(it.get("reply")),
        "replyLabel": s(it.get("replyLabel"), 60), "actions": acts, "cat": s(it.get("cat"), 40),
        "clearable": bool(it.get("clearable", True)), "group": bool(it.get("group")),
        "pic": _store_pic(pic), "conv": s(it.get("conv"), 200),
        "quiet": bool(it.get("quiet")),
        "progress": it.get("progress") if isinstance(it.get("progress"), list) else None,
    }


def _store_pic(data_url):
    """data:image/jpeg;base64,... -> /api/notify/pic/<hash> (kept on disk, so updates stay small)."""
    if not data_url.startswith("data:image/jpeg;base64,"):
        return ""
    import base64
    import hashlib
    try:
        raw = base64.b64decode(data_url.split(",", 1)[1], validate=True)
    except ValueError:
        return ""
    pid = hashlib.sha1(raw).hexdigest()[:16]
    p = os.path.join(PICS, pid + ".jpg")
    if not os.path.exists(p):
        try:
            with open(p, "wb") as f:
                f.write(raw)
        except OSError:
            return ""
    return "/api/notify/pic/" + pid


def _sweep_pics():
    """Caller holds the lock. Drop photos no kept notification uses."""
    used = {n.get("pic", "").rsplit("/", 1)[-1] for n in notes.values()}
    try:
        for f in os.listdir(PICS):
            if f[:-4] not in used:
                os.remove(os.path.join(PICS, f))
    except OSError:
        pass


def _touch_phone(h, body=None):
    phone["seen"] = time.time()
    if body:
        if body.get("device"):
            phone["device"] = str(body["device"])[:80]
        if "access" in body:
            phone["access"] = bool(body["access"])
        if body.get("version"):
            phone["version"] = str(body["version"])[:20]


def push(body):
    new = []
    with lock:
        _touch_phone(None, body)
        if body.get("snapshot"):
            live = {str(it.get("key")) for it in body.get("items") or []}
            for n in notes.values():
                if n.get("live") and n["key"] not in live:
                    n["live"] = False
        for raw in body.get("items") or []:
            it = _clean(raw)
            if not it["key"] or not it["pkg"]:
                continue
            old = notes.get(it["key"])
            same = old and (old["title"], old["text"], old["msgs"][-1:] if old.get("msgs") else None) == \
                (it["title"], it["text"], it["msgs"][-1:] if it["msgs"] else None)
            if old and it["msgs"]:
                # chat apps only resend the last few messages: keep the thread growing on the PC
                seen_m = {(m["who"], m["text"], m["at"]) for m in it["msgs"]}
                keep = [m for m in old.get("msgs") or [] if (m["who"], m["text"], m["at"]) not in seen_m]
                it["msgs"] = (keep + it["msgs"])[-30:]
            if old and old.get("sent"):
                it["sent"] = old["sent"][-10:]
            it["live"] = True
            it["seen"] = bool(old and old.get("seen") and same)
            it["first"] = old.get("first", it["when"]) if old else it["when"]
            notes[it["key"]] = it
            if not same and not body.get("snapshot") and not it["quiet"] and not settings["mute"].get(it["pkg"]):
                new.append(dict(it))
        for k in body.get("gone") or []:
            n = notes.get(str(k))
            if n:
                n["live"] = False
                n["goneAt"] = int(time.time() * 1000)
        _trim()
        _bump()
        have = {f[:-4] for f in os.listdir(ICONS) if f.endswith(".png")}
        need = sorted({n["pkg"] for n in notes.values() if n["pkg"] not in have})
        toast = settings.get("toast", True) and time.time() > settings.get("snooze", 0)
    if toast and toast_hook:
        for n in new[:3]:
            try:
                toast_hook(n)
            except Exception as e:
                print("[beam] ping toast:", e)
    return {"ok": True, "needIcons": need[:20], "mute": [p for p, v in settings["mute"].items() if v]}


def save_icon(pkg, data):
    if not PKG_RE.match(pkg) or not data.startswith(b"\x89PNG") or len(data) > 300_000:
        return False
    with open(os.path.join(ICONS, pkg + ".png"), "wb") as f:
        f.write(data)
    with lock:
        _bump()
    return True


def icon_path(pkg):
    p = os.path.join(ICONS, pkg + ".png")
    return p if PKG_RE.match(pkg) and os.path.isfile(p) else None


def _phone_view():
    age = time.time() - phone["seen"] if phone["seen"] else None
    return {"online": age is not None and age < ONLINE_S, "seenAgo": None if age is None else int(age),
            "device": phone["device"], "access": phone["access"], "version": phone["version"]}


def view(since, wait):
    deadline = time.time() + max(0, min(wait, 30))
    with lock:
        while rev == since and time.time() < deadline:
            # wake up now and then so the "phone online" light stays honest
            changed.wait(min(5, max(0.05, deadline - time.time())))
        _expire()
        lst = sorted(notes.values(), key=lambda n: -n["when"])
        return {"v": rev, "notes": lst, "phone": _phone_view(), "settings": settings,
                "pending": [dict(r, id=i) for i, r in results.items() if r["state"] in ("queued", "sent")]}


def _expire():
    now = time.time()
    for c in list(cmds):
        if now - c["at"] > CMD_TTL:
            cmds.remove(c)
            results[c["id"]].update(state="failed", error="The phone didn't pick it up. Is Beam running on the phone?")
    for i, r in list(results.items()):
        if r["state"] == "sent" and now - r["at"] > CMD_TTL + 30:
            r.update(state="failed", error="No answer from the phone.")
        if now - r["at"] > 600:
            results.pop(i, None)


def queue(op, key, **extra):
    global _seq
    with lock:
        if key != "*" and key not in notes:
            raise KeyError("That notification is gone.")
        _seq += 1
        cid = f"{int(time.time())}-{_seq}"
        c = dict(extra, id=cid, op=op, key=key, at=time.time())
        cmds.append(c)
        results[cid] = {"state": "queued", "error": "", "at": time.time(), "op": op, "key": key}
        if op == "reply":
            n = notes.get(key)
            if n is not None:   # show it in the thread right away, the phone confirms later
                n.setdefault("sent", []).append({"text": extra.get("text", ""), "at": int(time.time() * 1000), "id": cid})
        cmd_ready.notify_all()
        _bump()
        return cid


def take_cmds(wait, body=None):
    deadline = time.time() + max(0, min(wait, 30))
    with lock:
        _touch_phone(None, body)
        if not phone.get("_online_once"):
            phone["_online_once"] = True
            _bump()
        while not cmds and time.time() < deadline:
            cmd_ready.wait(max(0.05, deadline - time.time()))
            phone["seen"] = time.time()
        out = []
        while cmds:
            c = cmds.pop(0)
            results[c["id"]].update(state="sent", at=time.time())
            out.append({k: v for k, v in c.items() if k != "at"})
        if out:
            _bump()
        return {"cmds": out, "mute": [p for p, v in settings["mute"].items() if v]}


def done(body):
    with lock:
        _touch_phone(None)
        r = results.get(str(body.get("id")))
        if not r:
            return
        r.update(state="ok" if body.get("ok") else "failed", error=str(body.get("error") or "")[:300], at=time.time())
        if r["op"] == "reply":
            n = notes.get(r["key"])
            for s in (n or {}).get("sent", []):
                if s.get("id") == body.get("id"):
                    s["state"] = r["state"]
                    s["error"] = r["error"]
        _bump()


def set_seen(keys=None):
    with lock:
        for n in notes.values():
            if keys is None or n["key"] in keys:
                n["seen"] = True
        _bump()


def set_settings(body):
    with lock:
        for pkg, on in (body.get("mute") or {}).items():
            if PKG_RE.match(pkg):
                if on:
                    settings["mute"][pkg] = True
                else:
                    settings["mute"].pop(pkg, None)
        if "toast" in body:
            settings["toast"] = bool(body["toast"])
            settings["snooze"] = 0
        if "snooze" in body:   # minutes of quiet; 0 ends it
            settings["snooze"] = time.time() + max(0, min(int(body["snooze"] or 0), 24 * 60)) * 60 if body["snooze"] else 0
        _bump()
        return settings


def clear_history():
    with lock:
        for k in [k for k, n in notes.items() if not n.get("live")]:
            notes.pop(k)
        _bump()


# ---------------------------------------------------------------- routes ---
def api(h, method, rest, q):
    arg = lambda k, d="": q.get(k, [d])[0]
    parts = rest.split("/") if rest else []
    if method == "GET" and not parts:
        return h.json(view(int(arg("v", "-1") or -1), float(arg("wait", "0") or 0)))
    if method == "POST" and parts == ["push"]:
        return h.json(push(h.body_json()))
    if method == "GET" and parts == ["cmds"]:
        return h.json(take_cmds(float(arg("wait", "25") or 25),
                                {"device": arg("device"), "access": arg("access", "1") == "1", "version": arg("ver")}))
    if method == "POST" and parts == ["done"]:
        done(h.body_json())
        return h.json({"ok": True})
    if len(parts) == 2 and parts[0] == "icon":
        if method == "GET":
            p = icon_path(parts[1])
            if not p:
                return h.json({"error": "no icon"}, 404)
            with open(p, "rb") as f:
                return h.send(200, f.read(), "image/png", {"Cache-Control": "max-age=86400"})
        if method == "POST":
            n = int(h.headers.get("Content-Length") or 0)
            data = h.rfile.read(n) if 0 < n < 400_000 else b""
            if not data:
                h.drain()
            return h.json({"ok": save_icon(parts[1], data)})
    if method == "GET" and len(parts) == 2 and parts[0] == "pic" and re.match(r"^[0-9a-f]{16}$", parts[1]):
        p = os.path.join(PICS, parts[1] + ".jpg")
        if not os.path.isfile(p):
            return h.json({"error": "gone"}, 404)
        with open(p, "rb") as f:
            return h.send(200, f.read(), "image/jpeg", {"Cache-Control": "max-age=31536000, immutable"})
    if method == "GET" and len(parts) == 2 and parts[0] == "cmd":
        with lock:
            _expire()
            r = results.get(parts[1])
        return h.json(r or {"state": "failed", "error": "unknown"})
    if method == "POST" and parts and parts[0] in ("reply", "dismiss", "action", "open"):
        b = h.body_json()
        key = str(b.get("key") or "")
        extra = {}
        if parts[0] == "reply":
            text = str(b.get("text") or "").strip()
            if not text:
                return h.json({"error": "Type a reply first."}, 400)
            extra["text"] = text[:4000]
        if parts[0] == "action":
            extra["idx"] = int(b.get("idx") or 0)
            extra["label"] = str(b.get("label") or "")[:60]
        try:
            cid = queue(parts[0], key, **extra)
            with lock:
                online = _phone_view()["online"]
            return h.json({"id": cid, "offline": not online})
        except KeyError as e:
            return h.json({"error": str(e.args[0])}, 404)
    if method == "POST" and parts == ["seen"]:
        b = h.body_json()
        set_seen(None if b.get("all") else set(map(str, b.get("keys") or [])))
        return h.json({"ok": True})
    if method == "POST" and parts == ["settings"]:
        return h.json(set_settings(h.body_json()))
    if method == "DELETE" and parts == ["history"]:
        clear_history()
        return h.json({"ok": True})
    h.drain()
    return h.json({"error": "bad request"}, 400)
