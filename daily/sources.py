"""Where the Daily dashboard gets its numbers. Every reader is read-only and never raises:
each returns {"ok": bool, ...} so one tool being off never blanks the whole page.

  money()      Kharcha: the phone's latest state that Beam keeps (%LOCALAPPDATA%\\Beam\\kharcha\\latest.json)
  photos()     Lens PC (port 7797): phone + PC photos, newest first
  downloads()  VOLT (port 7777) jobs, or its history.json when VOLT is off
  disk()       Space Manager (port 7793) drives, or Windows itself when it is off

Test overrides: DAILY_KHARCHA (latest.json path), DAILY_VOLT_HIST, DAILY_DATA, DAILY_LENS_PORT,
DAILY_VOLT_PORT, DAILY_SPACE_PORT, DAILY_SUITE_PORT, DAILY_NOW (fake "now", seconds).
"""
import ctypes
import json
import os
import shutil
import string
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

LOCAL = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
KHARCHA = os.environ.get("DAILY_KHARCHA") or os.path.join(LOCAL, "Beam", "kharcha", "latest.json")
KHARCHA_INBOX = os.path.join(os.path.dirname(KHARCHA), "inbox.json")
VOLT_HIST = os.environ.get("DAILY_VOLT_HIST") or os.path.join(LOCAL, "VOLT", "history.json")
DATA = os.environ.get("DAILY_DATA") or os.path.join(LOCAL, "QTDaily")
PORTS = {
    "lens": int(os.environ.get("DAILY_LENS_PORT", "7797")),
    "volt": int(os.environ.get("DAILY_VOLT_PORT", "7777")),
    "space": int(os.environ.get("DAILY_SPACE_PORT", "7793")),
    "suite": int(os.environ.get("DAILY_SUITE_PORT", "7800")),
    "beam": int(os.environ.get("DAILY_BEAM_PORT", "7788")),
}
DAY = 86400
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))  # never route localhost via a proxy
LOCK = threading.Lock()


def now():
    v = os.environ.get("DAILY_NOW")
    return float(v) if v else time.time()


def day_start(ts=None, back=0):
    """Local midnight of the day ts falls in, minus `back` days (DST-safe via mktime)."""
    t = time.localtime(ts if ts is not None else now())
    return time.mktime((t.tm_year, t.tm_mon, t.tm_mday - back, 0, 0, 0, 0, 0, -1))


def get(tool, path, timeout=2.5, raw=False):
    port = PORTS[tool]
    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", headers={"Accept": "application/json"})
    with OPENER.open(req, timeout=timeout) as r:
        data = r.read()
        return (data, r.headers.get("Content-Type", "application/octet-stream")) if raw else json.loads(data or b"null")


def post(tool, path, body=None, timeout=15, method="POST"):
    port = PORTS[tool]
    origin = f"http://127.0.0.1:{port}"
    req = urllib.request.Request(origin + path, data=json.dumps(body or {}).encode(), method=method,
                                 headers={"Content-Type": "application/json", "Origin": origin})
    with OPENER.open(req, timeout=timeout) as r:
        return json.loads(r.read() or b"null")


def read_json(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


# ------------------------------------------------------------------ money ---
def _period(ref, start_day):
    """Kharcha's budget month: from startDay to the same day next month (matches period() in Kharcha)."""
    sd = min(28, max(1, int(start_day or 1)))
    t = time.localtime(ref)
    y, m = t.tm_year, t.tm_mon
    if t.tm_mday < sd:
        m -= 1
    a = time.mktime((y, m, sd, 0, 0, 0, 0, 0, -1))
    b = time.mktime((y, m + 1, sd, 0, 0, 0, 0, 0, -1))
    return a, b


def money():
    snap = read_json(KHARCHA)
    if not snap or not isinstance(snap.get("state"), dict):
        return {"ok": False, "why": "nosync", "msg": "Turn on PC sync in Kharcha on the phone (Setup, PC sync)."}
    S = snap["state"]
    st = S.get("settings") or {}
    cats = {c.get("id"): c for c in S.get("cats") or [] if isinstance(c, dict)}
    tx = [t for t in S.get("tx") or [] if isinstance(t, dict) and isinstance(t.get("amt"), (int, float)) and t.get("ts")]
    n = now()
    t0, y0 = day_start(n) * 1000, day_start(n, 1) * 1000
    pa, pb = _period(n, st.get("startDay"))
    pa, pb = pa * 1000, pb * 1000

    def amt(rows):
        return round(sum(r["amt"] for r in rows), 2)

    today = sorted((t for t in tx if t["ts"] >= t0), key=lambda t: -t["ts"])
    yest = [t for t in tx if y0 <= t["ts"] < t0]
    in_p = [t for t in tx if pa <= t["ts"] < pb]
    week = []
    for back in range(6, -1, -1):
        a, b = day_start(n, back) * 1000, day_start(n, back - 1) * 1000
        week.append({"d": a, "v": amt([t for t in tx if a <= t["ts"] < b])})

    # income for the month: same rule as Kharcha's effIncome (salary replaces the plan, extras add on)
    inc = [x for x in S.get("inc") or [] if isinstance(x, dict) and pa <= (x.get("ts") or 0) < pb]
    base = float(st.get("income") or 0)
    salary = sum(x.get("amt") or 0 for x in inc if x.get("kind") == "salary")
    extra = sum(x.get("amt") or 0 for x in inc if x.get("kind") != "salary")
    income = 0 if (not base and not salary) else max(base, salary) + extra
    target = float(st.get("saveTarget") or 0)
    spendable = max(0.0, income - target)
    spent = amt(in_p)
    spent_today = amt(today)
    days_left = max(1, int(-(-(pb - t0) // (DAY * 1000))))
    allow = (spendable - (spent - spent_today)) / days_left if income else None
    by_cat = {}
    for t in today:
        by_cat[t.get("cat")] = by_cat.get(t.get("cat"), 0) + t["amt"]

    def cat(cid):
        c = cats.get(cid) or {}
        return {"id": cid, "name": c.get("name") or "Other", "emoji": c.get("emoji") or "✨"}

    # entries typed on the PC (Daily or Beam's Kharcha page) wait in Beam's inbox until the phone opens Kharcha
    inbox = [x for x in (read_json(KHARCHA_INBOX, []) or []) if isinstance(x, dict) and x.get("kind") == "tx"
             and isinstance(x.get("amt"), (int, float)) and x.get("ts")]
    waiting = [x for x in inbox if x["ts"] >= t0 and x.get("id") not in {t.get("id") for t in tx}]
    if waiting:
        today = sorted(today + [dict(x, pending=True) for x in waiting], key=lambda t: -t["ts"])
        spent_today = round(spent_today + sum(x["amt"] for x in waiting), 2)
    return {
        "ok": True,
        "name": st.get("name") or "",
        "cur": st.get("currency") or "₹",
        "synced": snap.get("at"),
        "device": snap.get("device"),
        "today": spent_today,
        "yesterday": amt(yest),
        "tx": [dict(cat(t.get("cat")), amt=t["amt"], note=(t.get("note") or "")[:80], ts=t["ts"], mode=t.get("mode") or "",
                    pending=bool(t.get("pending")), pid=t.get("id") if t.get("pending") else None)
               for t in today[:12]],
        "count": len(today),
        "stale": not snap.get("at") or snap["at"] < day_start(n),
        "catlist": [{"id": c.get("id"), "name": c.get("name"), "emoji": c.get("emoji")} for c in cats.values() if c.get("id")][:30],
        "cats": sorted((dict(cat(k), amt=round(v, 2)) for k, v in by_cat.items()), key=lambda c: -c["amt"]),
        "week": week,
        "month": {"spent": spent, "income": income, "target": target, "spendable": spendable,
                  "days_left": days_left, "start": pa, "end": pb},
        "allow": None if allow is None else round(allow, 2),
        "left": None if allow is None else round(allow - spent_today, 2),
        "pending": len(inbox),
    }


def add_expense(body):
    """Queue an expense for the phone's Kharcha through Beam (the same inbox Beam's /kharcha page uses)."""
    try:
        amt = round(float(body.get("amt")), 2)
    except (TypeError, ValueError):
        raise ValueError("Type an amount")
    if not 0 < amt < 1e7:
        raise ValueError("Type an amount")
    item = {"kind": "tx", "amt": amt, "cat": str(body.get("cat") or "other")[:40], "note": str(body.get("note") or "")[:80],
            "mode": str(body.get("mode") or "UPI")[:10], "ts": now() * 1000}
    try:
        return post("beam", "/api/kharcha/add", item, timeout=6)
    except urllib.error.HTTPError as e:
        raise ValueError((json.loads(e.read() or b"{}") or {}).get("error") or "Beam said no")
    except OSError:
        raise ValueError("Beam isn't running, so Kharcha can't get it")


def undo_expense(iid):
    if not iid or len(iid) > 40 or not iid.replace("-", "").isalnum():
        raise ValueError("bad id")
    try:
        post("beam", "/api/kharcha/inbox/" + iid, None, timeout=6, method="DELETE")
    except OSError:
        raise ValueError("Beam isn't running")
    return {"ok": True}


# ----------------------------------------------------------------- photos ---
def photos():
    try:
        boot = get("lens", "/api/boot", timeout=4)
        items = get("lens", "/api/items", timeout=6).get("items") or []
    except Exception:
        return {"ok": False, "why": "off", "msg": "Lens PC isn't running."}
    n = now()
    t0, y0, w0 = day_start(n) * 1000, day_start(n, 1) * 1000, day_start(n, 6) * 1000
    items = sorted((i for i in items if i.get("t")), key=lambda i: -i["t"])
    today = [i for i in items if i["t"] >= t0]
    return {
        "ok": True,
        "today": len(today),
        "today_phone": sum(1 for i in today if i.get("src") == "phone"),
        "yesterday": sum(1 for i in items if y0 <= i["t"] < t0),
        "week": sum(1 for i in items if i["t"] >= w0),
        "videos_today": sum(1 for i in today if i.get("v")),
        "total": len(items),
        "counts": boot.get("counts") or {},
        "phone_sync": (boot.get("phone") or {}).get("last_sync"),
        "latest": [{"k": i["k"], "t": i["t"], "v": bool(i.get("v")), "src": i.get("src"), "w": i.get("w"), "h": i.get("h")}
                   for i in items[:12]],
        "memories": memories(items, n),
    }


def memories(items, n):
    """'On this day': photos from today's date in earlier years; if there are none, from a month ago."""
    t = time.localtime(n)
    out, label = [], None
    for back in range(1, 11):
        a = time.mktime((t.tm_year - back, t.tm_mon, t.tm_mday, 0, 0, 0, 0, 0, -1)) * 1000
        hits = [i for i in items if a <= i["t"] < a + DAY * 1000]
        if hits:
            out += [dict(i, ago=f"{back} year{'s' if back > 1 else ''} ago") for i in hits[:6 - len(out)]]
        if len(out) >= 6:
            break
    if out:
        label = "On this day"
    else:
        a = time.mktime((t.tm_year, t.tm_mon - 1, t.tm_mday, 0, 0, 0, 0, 0, -1)) * 1000
        out = [dict(i, ago="a month ago") for i in items if a <= i["t"] < a + DAY * 1000][:6]
        label = "A month ago today" if out else None
    return {"label": label, "items": [{"k": i["k"], "t": i["t"], "v": bool(i.get("v")), "src": i.get("src"), "ago": i["ago"]} for i in out]}


def thumb(k):
    """(bytes, content type) of a Lens thumbnail, or None."""
    if not k or len(k) > 80 or any(c in k for c in "/\\?#&"):
        return None
    with LOCK:
        hit = THUMB_CACHE.get(k)
    if hit:
        return hit
    try:
        r = get("lens", "/api/thumb/" + urllib.parse.quote(k), timeout=6, raw=True)
    except Exception:
        return None
    with LOCK:  # small memory cache: the phone view asks for the same dozen thumbnails on every visit
        THUMB_CACHE[k] = r
        while len(THUMB_CACHE) > 120:
            THUMB_CACHE.pop(next(iter(THUMB_CACHE)))
    return r


THUMB_CACHE = {}


def full(k):
    """The full-size photo from Lens PC (PC photos, and phone photos already pulled to the PC), or None."""
    if not k or len(k) > 80 or any(c in k for c in "/\\?#&"):
        return None
    try:
        data, ctype = get("lens", "/api/full/" + urllib.parse.quote(k), timeout=20, raw=True)
    except Exception:
        return None
    if not ctype.startswith("image/") or len(data) > 60 << 20:
        return None
    return data, ctype


# -------------------------------------------------------------- downloads ---
ACTIVE = ("queued", "starting", "downloading", "merging", "converting")


def downloads():
    live = True
    try:
        jobs = get("volt", "/api/jobs", timeout=3)
    except Exception:
        live, jobs = False, read_json(VOLT_HIST, []) or []
    jobs = [j for j in jobs if isinstance(j, dict)]
    t0 = day_start()
    active = [j for j in jobs if j.get("state") in ACTIVE]
    done = sorted((j for j in jobs if j.get("state") == "done" and (j.get("ended") or j.get("created") or 0) >= t0),
                  key=lambda j: -(j.get("ended") or j.get("created") or 0))
    failed = [j for j in jobs if j.get("state") == "error" and (j.get("ended") or j.get("created") or 0) >= t0]
    recent = sorted((j for j in jobs if j.get("state") == "done"), key=lambda j: -(j.get("ended") or j.get("created") or 0))

    def row(j):
        return {"id": j.get("id"), "title": (j.get("title") or j.get("name") or j.get("url") or "")[:140],
                "state": j.get("state"), "pct": j.get("pct") or 0, "speed": j.get("speed"), "eta": j.get("eta"),
                "size": j.get("size"), "site": j.get("site"), "mode": j.get("mode"), "kind": j.get("kind"),
                "phone": bool(j.get("source")), "at": j.get("ended") or j.get("created"),
                "thumb": bool(live and j.get("thumb")), "turl": j.get("thumb") if live else None}

    return {"ok": True, "live": live, "active": [row(j) for j in active], "today": len(done),
            "failed": len(failed), "phone_today": sum(1 for j in done if j.get("source")),
            "done": [row(j) for j in done[:8]], "last": row(recent[0]) if recent and not done else None,
            "grabs": [g for g in grabs() if g["state"] != "queued"]}


GRABS = {}  # id -> {"url", "state": looking|queued|error, "error", "t"}


def grab(body):
    """Start a VOLT download from a pasted link: look it up, then queue it (same two calls Beam Drop makes)."""
    url = str(body.get("url") or "").strip()
    if not url.startswith(("http://", "https://")) or len(url) > 2000 or any(c in url for c in string.whitespace):
        raise ValueError("Paste a link that starts with http")
    want = "audio" if body.get("mode") == "audio" else "auto"
    gid = "g%x" % int(time.time() * 1000)
    with LOCK:
        for k in [k for k, g in GRABS.items() if time.time() - g["t"] > 3600]:
            GRABS.pop(k, None)
        GRABS[gid] = {"url": url, "state": "looking", "error": None, "t": time.time()}

    def run():
        g = GRABS[gid]
        try:
            try:
                get("volt", "/api/status", timeout=2)
            except Exception:
                r = start_tool("volt")
                if not r.get("ok"):
                    raise RuntimeError(r.get("msg") or "VOLT isn't running")
            info = post("volt", "/api/info", {"url": url}, timeout=120)
            kind = info.get("kind")
            job = {"url": info.get("url") or url, "engine": info.get("engine"), "title": info.get("title"),
                   "thumb": info.get("thumb"), "count": info.get("count"), "site": info.get("site"),
                   "playlist": kind == "playlist", "kind": kind}
            if want == "audio" or kind == "audio":
                job["mode"] = "mp3"
            post("volt", "/api/download", job, timeout=20)
            g.update(state="queued", title=info.get("title"))
        except urllib.error.HTTPError as e:
            try:
                msg = json.loads(e.read() or b"{}").get("error")
            except ValueError:
                msg = None
            g.update(state="error", error=msg or f"VOLT said {e.code}")
        except Exception as e:
            g.update(state="error", error=str(e)[:200] or "Failed")
    threading.Thread(target=run, daemon=True).start()
    return {"ok": True, "id": gid}


def grabs():
    with LOCK:
        return [dict(g, id=k) for k, g in GRABS.items() if time.time() - g["t"] < 600]


def volt_thumb(url):
    if not url or not url.startswith(("http://", "https://")):
        return None
    try:
        return get("volt", "/api/thumb?u=" + urllib.parse.quote(url, safe=""), timeout=14, raw=True)
    except Exception:
        return None


# ------------------------------------------------------------------- disk ---
def _windows_drives():
    out = []
    try:
        mask = ctypes.windll.kernel32.GetLogicalDrives()
        for i in range(26):
            if mask & (1 << i):
                root = chr(65 + i) + ":\\"
                if ctypes.windll.kernel32.GetDriveTypeW(root) == 3:  # fixed disks only
                    try:
                        u = shutil.disk_usage(root)
                        out.append({"letter": root[0], "root": root, "size": u.total, "free": u.free, "label": "", "type": ""})
                    except OSError:
                        pass
    except Exception:
        u = shutil.disk_usage(os.path.abspath(os.sep))
        out.append({"letter": "C", "root": "C:\\", "size": u.total, "free": u.free, "label": "", "type": ""})
    return out


def _morning(drives):
    """Free space at the first look of each day, kept by the dashboard itself (for 'since this morning')."""
    path = os.path.join(DATA, "disk-history.json")
    key = time.strftime("%Y-%m-%d", time.localtime(now()))
    with LOCK:
        hist = read_json(path, {}) or {}
        day = hist.setdefault(key, {})
        changed = False
        for d in drives:
            if d["letter"] not in day:
                day[d["letter"]] = d["free"]
                changed = True
        if changed:
            for old in sorted(hist)[:-30]:
                hist.pop(old, None)
            os.makedirs(DATA, exist_ok=True)
            tmp = path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(hist, f)
            os.replace(tmp, path)
        return dict(day), hist


def disk():
    src = "space"
    extra = {}
    try:
        r = get("space", "/api/drives", timeout=4)
        drives = r.get("drives") or []
        extra = {"bin": r.get("bin"), "wins": r.get("wins"), "history": r.get("history")}
    except Exception:
        src, drives = "windows", _windows_drives()
    if not drives:
        return {"ok": False, "why": "none", "msg": "No drives found."}
    morning, hist = _morning(drives)
    yday = hist.get(time.strftime("%Y-%m-%d", time.localtime(day_start(now(), 1)))) or {}
    rows = []
    for d in drives:
        size, free = d.get("size") or 0, d.get("free") or 0
        rows.append({"letter": d["letter"], "label": d.get("label") or "", "type": d.get("type") or "",
                     "size": size, "free": free, "used_pct": round((size - free) / size * 100, 1) if size else 0,
                     "since_morning": free - morning.get(d["letter"], free),
                     "since_yesterday": (free - yday[d["letter"]]) if d["letter"] in yday else None})
    low = [r for r in rows if r["size"] and (r["free"] / r["size"] < 0.1 or r["free"] < 20 << 30)]
    # last 7 days of free space per drive: our own morning readings, filled in from Space Manager's history
    days = {}
    for h in extra.get("history") or []:
        if isinstance(h, dict) and isinstance(h.get("free"), dict) and h.get("day"):
            days[h["day"]] = dict(h["free"])
    for k, v in hist.items():
        days.setdefault(k, {}).update(v)
    keys = [time.strftime("%Y-%m-%d", time.localtime(day_start(now(), b))) for b in range(6, 0, -1)]
    for r in rows:
        r["trend"] = [days.get(k, {}).get(r["letter"]) for k in keys] + [r["free"]]
    extra.pop("history", None)
    return dict({"ok": True, "src": src, "drives": rows, "low": [r["letter"] for r in low]}, **extra)


# ------------------------------------------------------------------ tools ---
def suite_tools():
    try:
        return {t["id"]: t.get("status") for t in get("suite", "/api/tools", timeout=2)}
    except Exception:
        return None


def start_tool(tid):
    if tid not in ("lens", "volt", "space", "beam", "kharcha"):
        raise ValueError("unknown tool")
    try:
        return post("suite", f"/api/start/{tid}", timeout=20)
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read())
        except Exception:
            return {"ok": False, "msg": f"QT Suite said {e.code}"}
    except Exception:
        return {"ok": False, "msg": "Open QT Suite first, it starts the other tools."}


def everything():
    """All four cards, read in parallel so one slow tool doesn't hold the rest."""
    out = {}
    jobs = {"money": money, "photos": photos, "downloads": downloads, "disk": disk}

    def run(k, fn):
        try:
            out[k] = fn()
        except Exception as e:  # a reader bug must not take the page down
            out[k] = {"ok": False, "why": "error", "msg": str(e)[:200]}
    ts = [threading.Thread(target=run, args=kv, daemon=True) for kv in jobs.items()]
    for t in ts:
        t.start()
    for t in ts:
        t.join(9)
    for k in jobs:
        out.setdefault(k, {"ok": False, "why": "slow", "msg": "Took too long to answer."})
    out["now"] = now()
    out["day"] = day_start() * 1000
    return out
