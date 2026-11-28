"""Games: Launchpad playtime + game mode + FPS overlay, Steam/Epic deals, mini arcade, party mode."""
import ctypes
import json
import os
import random
import re
import secrets
import string
import subprocess
import sys
import threading
import time
import urllib.request

import kit
from kit import actions, common, phone

LP = "http://127.0.0.1:7790"


def _lp(path, body=None, timeout=6):
    req = urllib.request.Request(LP + path, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json", "Origin": LP}, method="POST" if body is not None else "GET")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def init():
    threading.Thread(target=_watch_games, name="kit-games", daemon=True).start()
    threading.Thread(target=_watch_deals, name="kit-deals", daemon=True).start()


# ========================================================== 9. launcher + game mode ===
GM = {"game": None, "since": 0, "plan_before": None, "overlay": None, "pm": None}
GM_DEFAULT = {"auto": True, "power": True, "quiet": True, "fps": False, "pause_tools": ["volt"], "fps_corner": "tl"}


def gm_cfg():
    return common.load("gamemode", GM_DEFAULT)


def _active_plan():
    code, out = common.run(["powercfg", "/getactivescheme"], timeout=8)
    m = re.search(r"([0-9a-f-]{36})", out)
    return m.group(1) if m else None


def _fast_plan():
    code, out = common.run(["powercfg", "/list"], timeout=8)
    plans = re.findall(r"([0-9a-f-]{36})\s+\(([^)]+)\)", out)
    for want in ("ultimate", "high performance", "high", "performance"):
        for g, n in plans:
            if want in n.lower():
                return g
    return None


def game_mode_on(game="manual"):
    if GM["game"]:
        return True, "game mode already on"
    cfg = gm_cfg()
    GM.update(game=game, since=time.time())
    if cfg.get("power"):
        GM["plan_before"] = _active_plan()
        fast = _fast_plan()
        if fast and fast != GM["plan_before"]:
            common.run(["powercfg", "/setactive", fast], timeout=8)
    if cfg.get("quiet"):
        from kit import care
        care._ping_snooze(240)
    for tid in cfg.get("pause_tools") or []:
        if tid == "volt":
            try:
                req = urllib.request.Request("http://127.0.0.1:7777/api/queue", data=b'{"pause_all": true}',
                                             headers={"Content-Type": "application/json", "Origin": "http://127.0.0.1:7777"}, method="POST")
                urllib.request.urlopen(req, timeout=3).read()
            except Exception:
                pass
    if cfg.get("fps"):
        fps_start()
    common.event("game.on", game)
    return True, "game mode on"


def game_mode_off():
    if not GM["game"]:
        return True, "game mode already off"
    cfg = gm_cfg()
    if GM.get("plan_before"):
        common.run(["powercfg", "/setactive", GM["plan_before"]], timeout=8)
    if cfg.get("quiet"):
        from kit import care
        care._ping_snooze(0)
    if "volt" in (cfg.get("pause_tools") or []):
        try:
            req = urllib.request.Request("http://127.0.0.1:7777/api/queue", data=b'{"resume_all": true}',
                                         headers={"Content-Type": "application/json", "Origin": "http://127.0.0.1:7777"}, method="POST")
            urllib.request.urlopen(req, timeout=3).read()
        except Exception:
            pass
    fps_stop()
    mins = int((time.time() - GM["since"]) / 60)
    common.event("game.off", f"{GM['game']} {mins} min")
    GM.update(game=None, since=0, plan_before=None)
    return True, "game mode off"


def _watch_games():
    time.sleep(30)
    was = None
    while True:
        try:
            lib = _lp("/api/library", timeout=8)
            run = next((g for g in lib.get("games", []) if g.get("running")), None)
            name = run["name"] if run else None
            if name != was:
                if name and gm_cfg().get("auto") and not GM["game"]:
                    game_mode_on(name)
                    actions.balloon("Game mode", f"{name}: power plan up, notifications quiet.")
                elif not name and GM["game"] and GM["game"] != "manual":
                    game_mode_off()
                was = name
        except Exception:
            pass
        time.sleep(15)


@kit.hub_get("/api/kit/games")
def _games(q):
    try:
        lib = _lp("/api/library")
        stats = _lp("/api/stats?days=7")
        ok = True
    except Exception as e:
        lib, stats, ok = {"games": []}, {"daily": []}, False
    games = [g for g in lib.get("games", []) if g.get("kind") == "game" and not g.get("hidden")]
    games.sort(key=lambda g: -(g.get("last") or 0))
    week = sum(d.get("total", 0) for d in stats.get("daily", []))
    per = {}
    for d in stats.get("daily", []):
        for gid, m in (d.get("games") or {}).items():
            per[gid] = per.get(gid, 0) + m
    return 200, {"ok": ok, "games": [{k: g.get(k) for k in ("id", "name", "source", "minutes", "last", "running", "art")} for g in games],
                 "week_min": round(week), "daily": stats.get("daily", []), "week_per": {k: round(v) for k, v in per.items()},
                 "mode": {"on": bool(GM["game"]), "game": GM["game"], "since": GM["since"]}, "cfg": gm_cfg(),
                 "pm": bool(presentmon()), "fps": fps_status()}


@kit.hub_post("/api/kit/games")
def _games_post(b):
    op = b.get("op")
    if op == "launch":
        try:
            _lp("/api/launch", {"id": b.get("id", "")})
        except Exception as e:
            return 502, {"ok": False, "msg": "Launchpad isn't running: " + str(e)}
        common.event("game.launch", b.get("id", ""))
        return 200, {"ok": True}
    if op == "mode":
        ok, msg = game_mode_on() if b.get("on") else game_mode_off()
        return 200, {"ok": ok, "msg": msg}
    if op == "cfg":
        c = gm_cfg()
        for k in ("auto", "power", "quiet", "fps"):
            if k in b:
                c[k] = bool(b[k])
        if b.get("fps_corner") in ("tl", "tr", "bl", "br"):
            c["fps_corner"] = b["fps_corner"]
        common.save("gamemode", c)
        return 200, {"ok": True}
    if op == "fps":
        ok, msg = fps_start() if b.get("on") else fps_stop()
        return (200 if ok else 400), {"ok": ok, "msg": msg}
    if op == "pm_install":
        threading.Thread(target=install_presentmon, daemon=True).start()
        return 200, {"ok": True}
    return 400, {"ok": False}


actions.register("game.mode", "Game mode on / off", lambda _=None: game_mode_off() if GM["game"] else game_mode_on())


# --------------------------------------------------------------- FPS overlay ---
PM_DIR = os.path.join(common.BIN, "presentmon")
FPS_CSV = os.path.join(common.DATA, "fps.csv")
PMSTATE = {"busy": ""}


def presentmon():
    if not os.path.isdir(PM_DIR):
        return None
    exes = sorted(f for f in os.listdir(PM_DIR) if f.lower().startswith("presentmon") and f.lower().endswith(".exe"))
    return os.path.join(PM_DIR, exes[-1]) if exes else None


def install_presentmon():
    PMSTATE["busy"] = "downloading PresentMon"
    try:
        from kit.phonefx import _gh_latest
        rel = _gh_latest("GameTechDev/PresentMon")
        asset = next(a for a in rel["assets"] if re.search(r"PresentMon.*x64\.exe$", a["name"], re.I) and "service" not in a["name"].lower())
        os.makedirs(PM_DIR, exist_ok=True)
        req = urllib.request.Request(asset["browser_download_url"], headers={"User-Agent": "QT-Suite"})
        with urllib.request.urlopen(req, timeout=120) as r, open(os.path.join(PM_DIR, asset["name"]), "wb") as f:
            f.write(r.read())
    except Exception as e:
        PMSTATE["busy"] = "failed: " + str(e)[:120]
        return
    PMSTATE["busy"] = ""


def fps_status():
    o = GM.get("overlay")
    return {"on": bool(o and o.poll() is None), "busy": PMSTATE["busy"]}


def fps_start():
    exe = presentmon()
    if not exe:
        return False, "Install PresentMon first (Game launcher > FPS overlay)"
    fps_stop()
    try:
        os.remove(FPS_CSV)
    except OSError:
        pass
    # PresentMon needs admin for the ETW trace, so this asks once with a UAC prompt
    params = f'--output_file "{FPS_CSV}" --stop_existing_session --session_name QTSuiteFPS --terminate_on_proc_exit --no_console_stats --v1_metrics'
    params = f'--output_file "{FPS_CSV}" --stop_existing_session --session_name QTSuiteFPS --no_console_stats --v1_metrics'
    r = ctypes.windll.shell32.ShellExecuteW(None, "runas", exe, params, None, 0)
    if r <= 32:
        return False, "PresentMon needs admin; the prompt was cancelled"
    py = sys.executable.replace("python.exe", "pythonw.exe")
    GM["overlay"] = subprocess.Popen([py, os.path.join(common.HERE, "fps_overlay.py"), FPS_CSV, gm_cfg().get("fps_corner", "tl")],
                                     creationflags=common.NOWIN)
    common.event("fps.on")
    return True, "FPS overlay on"


def fps_stop():
    o = GM.get("overlay")
    if o and o.poll() is None:
        o.terminate()
    GM["overlay"] = None
    exe = presentmon()
    if exe:
        # ask PresentMon to stop its own session (works without admin when the session belongs to us)
        common.run([exe, "--terminate_existing_session", "--session_name", "QTSuiteFPS"], timeout=10)
        common.run(["taskkill", "/im", os.path.basename(exe)], timeout=10)
    return True, "FPS overlay off"


actions.register("fps.toggle", "FPS overlay on / off", lambda _=None: fps_stop() if fps_status()["on"] else fps_start())


# =================================================================== 10. deals ===
DEALS = {"t": 0, "data": None, "busy": False}


def _getj(url, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 QT-Suite"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def fetch_deals():
    DEALS["busy"] = True
    out = {"steam": [], "epic": [], "epic_next": [], "cheap": [], "errors": []}
    try:
        try:
            j = _getj("https://store.steampowered.com/api/featuredcategories?cc=in&l=english")
            for it in (j.get("specials") or {}).get("items", [])[:30]:
                out["steam"].append({"name": it.get("name"), "id": it.get("id"), "cut": it.get("discount_percent"),
                                     "was": (it.get("original_price") or 0) / 100, "now": (it.get("final_price") or 0) / 100,
                                     "cur": it.get("currency", "INR"), "img": it.get("header_image") or it.get("large_capsule_image"),
                                     "url": f"https://store.steampowered.com/app/{it.get('id')}/", "ends": it.get("discount_expiration")})
        except Exception as e:
            out["errors"].append("Steam: " + str(e))
        try:
            j = _getj("https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=en-US&country=IN&allowCountries=IN")
            for el in j["data"]["Catalog"]["searchStore"]["elements"]:
                promos = el.get("promotions") or {}
                slug = (el.get("catalogNs", {}).get("mappings") or [{}])
                slug = (slug[0] or {}).get("pageSlug") if slug else None
                slug = slug or el.get("productSlug") or el.get("urlSlug")
                img = next((k["url"] for k in el.get("keyImages", []) if k.get("type") in ("OfferImageWide", "DieselStoreFrontWide", "Thumbnail")), "")
                item = {"name": el.get("title"), "img": img, "url": f"https://store.epicgames.com/p/{slug}" if slug else "https://store.epicgames.com/free-games"}
                now = [o for p in promos.get("promotionalOffers") or [] for o in p.get("promotionalOffers", [])]
                nxt = [o for p in promos.get("upcomingPromotionalOffers") or [] for o in p.get("promotionalOffers", [])]
                if now and any((o.get("discountSetting") or {}).get("discountPercentage") == 0 for o in now):
                    out["epic"].append(dict(item, ends=now[0].get("endDate")))
                elif nxt and any((o.get("discountSetting") or {}).get("discountPercentage") == 0 for o in nxt):
                    out["epic_next"].append(dict(item, starts=nxt[0].get("startDate")))
        except Exception as e:
            out["errors"].append("Epic: " + str(e))
        try:
            j = _getj("https://www.cheapshark.com/api/1.0/deals?sortBy=Deal%20Rating&pageSize=30&storeID=1,7,25")
            stores = {"1": "Steam", "7": "GOG", "25": "Epic"}
            for d in j:
                out["cheap"].append({"name": d.get("title"), "cut": round(float(d.get("savings") or 0)), "now": float(d.get("salePrice") or 0),
                                     "was": float(d.get("normalPrice") or 0), "cur": "USD", "store": stores.get(d.get("storeID"), "Store"),
                                     "img": d.get("thumb"), "rating": d.get("steamRatingPercent"),
                                     "url": f"https://www.cheapshark.com/redirect?dealID={d.get('dealID')}"})
        except Exception as e:
            out["errors"].append("CheapShark: " + str(e))
        DEALS.update(t=time.time(), data=out)
        return out
    finally:
        DEALS["busy"] = False


def _watch_deals():
    time.sleep(90)
    while True:
        try:
            watch = [w.lower() for w in common.load("deals", {"watch": []})["watch"]]
            if watch:
                d = fetch_deals()
                seen = common.load("dealseen", {"ids": []})
                for it in d["steam"] + d["cheap"] + d["epic"]:
                    key = (it["name"] or "") + str(it.get("now"))
                    if any(w in (it["name"] or "").lower() for w in watch) and key not in seen["ids"]:
                        actions.balloon("Game deal", f"{it['name']}: {it.get('cut', 100)}% off" if it.get("cut") else f"{it['name']} is free")
                        seen["ids"] = (seen["ids"] + [key])[-200:]
                        common.save("dealseen", seen)
        except Exception:
            pass
        time.sleep(6 * 3600)


@kit.hub_get("/api/kit/deals")
def _deals(q):
    if not DEALS["data"] or time.time() - DEALS["t"] > 3600 or (q.get("fresh") or ["0"])[0] == "1":
        fetch_deals()
    return 200, dict(DEALS["data"] or {}, t=DEALS["t"], watch=common.load("deals", {"watch": []})["watch"])


@kit.hub_post("/api/kit/deals")
def _deals_post(b):
    s = common.load("deals", {"watch": []})
    if b.get("op") == "watch":
        name = str(b.get("name", "")).strip()[:60]
        if name and name.lower() not in [w.lower() for w in s["watch"]]:
            s["watch"].append(name)
    elif b.get("op") == "unwatch":
        s["watch"] = [w for w in s["watch"] if w != b.get("name")]
    elif b.get("op") == "open":
        url = str(b.get("url", ""))
        if url.startswith("https://"):
            import webbrowser
            webbrowser.open(url)
    common.save("deals", s)
    return 200, {"ok": True, "watch": s["watch"]}


# ============================================ 11 + 29. arcade controllers + party ===
COLORS = ["#c6ff3d", "#4dc3ff", "#ff5fa2", "#ffc93d", "#b28bff", "#5dffb0", "#ff8a3d", "#2ee6d6"]
PARTY = {"room": None, "players": {}, "mode": "pad", "quiz": None, "buzz": [], "lock": threading.Lock(), "t": 0, "taps": {}}
HOME_TOKEN = "home"


def _room():
    if not PARTY["room"]:
        PARTY["room"] = "".join(random.choice("ABCDEFGHJKLMNPQRSTUVWXYZ") for _ in range(4))
    return PARTY["room"]


def _player(token):
    return PARTY["players"].get(token)


def _join(name, token=None):
    with PARTY["lock"]:
        if token and token in PARTY["players"]:
            PARTY["players"][token]["t"] = time.time()
            return PARTY["players"][token], token
        used = {p["slot"] for p in PARTY["players"].values()}
        slot = next((i for i in range(8) if i not in used), None)
        if slot is None:
            return None, None
        token = token or secrets.token_urlsafe(8)
        name = re.sub(r"[^\w .'-]", "", str(name or ""))[:16].strip() or f"Player {slot + 1}"
        PARTY["players"][token] = {"name": name, "slot": slot, "color": COLORS[slot], "score": 0, "t": time.time(),
                                   "x": 0, "y": 0, "a": False, "b": False, "seq": 0, "answer": None, "taps": 0}
        common.event("party.join", name)
        return PARTY["players"][token], token


def _input(p, j):
    try:
        p["x"] = max(-1.0, min(float(j.get("x", 0)), 1.0))
        p["y"] = max(-1.0, min(float(j.get("y", 0)), 1.0))
    except (TypeError, ValueError):
        pass
    p["a"], p["b"] = bool(j.get("a")), bool(j.get("b"))
    if j.get("tap"):
        p["taps"] += 1
    if j.get("answer") is not None and PARTY["quiz"] and p.get("answer") is None:
        p["answer"] = int(j["answer"]) if str(j["answer"]).isdigit() else None
        p["answered_at"] = time.time()
    if j.get("buzz") and p["name"] not in PARTY["buzz"]:
        PARTY["buzz"].append(p["name"])
    p["seq"] += 1
    p["t"] = time.time()


def _guest_state(p):
    q = PARTY["quiz"]
    return {"ok": True, "me": {k: p[k] for k in ("name", "slot", "color", "score")}, "mode": PARTY["mode"],
            "quiz": {"q": q["q"], "options": q["options"], "answered": p.get("answer") is not None, "reveal": q.get("reveal")} if q else None,
            "buzz": PARTY["buzz"][:1]}


@phone.route("POST", "/api/join", party=True)
def _p_join(req):
    j = req.json()
    if str(j.get("room", "")).upper() != PARTY["room"]:
        return 404, {"ok": False, "msg": "That party has ended. Ask for the new QR code."}
    p, token = _join(j.get("name"), j.get("token") if j.get("token") in PARTY["players"] else None)
    if not p:
        return 409, {"ok": False, "msg": "The party is full (8 players)."}
    return 200, dict(_guest_state(p), token=token)


@phone.route("POST", "/api/input", party=True)
def _p_input(req):
    j = req.json()
    p = _player(j.get("token"))
    if not p or str(j.get("room", "")).upper() != PARTY["room"]:
        return 404, {"ok": False}
    _input(p, j)
    return 200, {"ok": True}


@phone.route("GET", "/api/state", party=True)
def _p_state(req):
    p = _player(req.q("token"))
    if not p or req.q("room").upper() != PARTY["room"]:
        return 404, {"ok": False}
    p["t"] = time.time()
    return 200, _guest_state(p)


@phone.route("POST", "/api/pad")
def _home_pad(req):
    """Your own phone (paired with the key) as a controller: always player 1 slot it gets."""
    _room()
    p, token = _join(req.json().get("name") or "You", "home-" + req.ip.replace(".", "-").replace(":", "-"))
    if p:
        _input(p, req.json())
    return 200, dict(_guest_state(p) if p else {"ok": False}, room=PARTY["room"])


@kit.hub_get("/api/kit/party")
def _party(q):
    room = _room()
    now = time.time()
    with PARTY["lock"]:
        for tok in [t for t, p in PARTY["players"].items() if now - p["t"] > 90]:
            PARTY["players"].pop(tok)
        players = sorted(({k: p[k] for k in ("name", "slot", "color", "score", "x", "y", "a", "b", "seq", "taps")}
                          | {"live": now - p["t"] < 5, "answer": p.get("answer"), "answered_at": p.get("answered_at")}
                          for p in PARTY["players"].values()), key=lambda p: p["slot"])
    lan = phone.lan_ip()
    return 200, {"room": room, "players": players, "mode": PARTY["mode"], "quiz": PARTY["quiz"], "buzz": PARTY["buzz"],
                 "join": f"http://{lan}:{phone.PARTY_PORT}/party/{room}", "join_tls": f"https://{lan}:{phone.PORT}/party/{room}",
                 "pad": phone.urls("/pad")}


@kit.hub_post("/api/kit/party")
def _party_post(b):
    op = b.get("op")
    with PARTY["lock"]:
        if op == "mode":
            PARTY["mode"] = b.get("mode") if b.get("mode") in ("pad", "quiz", "tap", "buzz", "lobby") else "pad"
            if PARTY["mode"] != "quiz":
                PARTY["quiz"] = None
            PARTY["buzz"] = []
            for p in PARTY["players"].values():
                p["taps"] = 0
        elif op == "quiz":
            opts = [str(o)[:60] for o in (b.get("options") or [])][:4]
            PARTY["quiz"] = {"q": str(b.get("q", ""))[:200], "options": opts, "answer": int(b.get("answer", 0)), "t": time.time(), "reveal": None}
            PARTY["mode"] = "quiz"
            for p in PARTY["players"].values():
                p["answer"] = None
                p.pop("answered_at", None)
        elif op == "reveal" and PARTY["quiz"]:
            q = PARTY["quiz"]
            q["reveal"] = q["answer"]
            right = sorted((p for p in PARTY["players"].values() if p.get("answer") == q["answer"]), key=lambda p: p.get("answered_at", 0))
            for i, p in enumerate(right):
                p["score"] += max(100, 300 - i * 50)
        elif op == "score":
            for p in PARTY["players"].values():
                if p["name"] == b.get("name"):
                    p["score"] += int(b.get("add", 0))
        elif op == "buzzreset":
            PARTY["buzz"] = []
        elif op == "kick":
            for t in [t for t, p in PARTY["players"].items() if p["name"] == b.get("name")]:
                PARTY["players"].pop(t)
        elif op == "new":
            PARTY.update(room=None, players={}, quiz=None, buzz=[], mode="lobby")
    return _party({})


@kit.hub_get("/api/kit/pads")
def _pads(q):
    """Fast path for arcade games (polled ~30x a second): just the controller state."""
    now = time.time()
    return 200, {"p": [{"slot": p["slot"], "name": p["name"], "color": p["color"], "x": p["x"], "y": p["y"], "a": p["a"], "b": p["b"],
                        "taps": p["taps"], "live": now - p["t"] < 5} for p in PARTY["players"].values()]}
