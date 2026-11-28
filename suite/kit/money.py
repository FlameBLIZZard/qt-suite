"""Money: Kharcha widget on Home, subscription tracker, bill splits with UPI links."""
import datetime as dt
import json
import os
import re
import secrets
import time
import urllib.parse

import kit
from kit import common

KH = os.path.join(os.environ.get("LOCALAPPDATA", ""), "Beam", "kharcha", "latest.json")


def kharcha():
    try:
        with open(KH, encoding="utf-8") as f:
            d = json.load(f)
        return d.get("state") or {}, d.get("at", 0)
    except (OSError, ValueError):
        return None, 0


def _month_start(start_day, now=None):
    now = now or dt.datetime.now()
    sd = max(1, min(int(start_day or 1), 28))
    if now.day >= sd:
        return dt.datetime(now.year, now.month, sd)
    y, m = (now.year, now.month - 1) if now.month > 1 else (now.year - 1, 12)
    return dt.datetime(y, m, sd)


# ============================================================ 23. Kharcha widget ===
@kit.hub_get("/api/kit/kharcha")
def _widget(q):
    st, at = kharcha()
    if st is None:
        return 200, {"ok": False, "msg": "No Kharcha data yet. Turn on PC sync in Kharcha (Setup > PC sync)."}
    s = st.get("settings", {})
    cats = {c["id"]: c for c in st.get("cats", [])}
    start = _month_start(s.get("startDay", 1))
    t0 = start.timestamp() * 1000
    tx = [t for t in st.get("tx", []) if t.get("ts", 0) >= t0]
    spent = sum(float(t.get("amt", 0)) for t in tx)
    budget = sum(float(c.get("budget") or 0) for c in cats.values())
    income = float(s.get("income") or 0)
    limit = budget or max(0.0, income - float(s.get("saveTarget") or 0))
    today0 = dt.datetime.combine(dt.date.today(), dt.time()).timestamp() * 1000
    by = {}
    for t in tx:
        by[t.get("cat")] = by.get(t.get("cat"), 0) + float(t.get("amt", 0))
    top = sorted(by.items(), key=lambda kv: -kv[1])[:4]
    nxt = (start.replace(month=start.month % 12 + 1, year=start.year + (start.month == 12)))
    days_left = max(1, (nxt - dt.datetime.now()).days + 1)
    recent = sorted(st.get("tx", []), key=lambda t: -t.get("ts", 0))[:4]
    return 200, {"ok": True, "cur": s.get("currency", "₹"), "spent": round(spent, 2), "limit": round(limit, 2),
                 "today": round(sum(float(t.get("amt", 0)) for t in tx if t.get("ts", 0) >= today0), 2),
                 "left_per_day": round(max(0.0, limit - spent) / days_left, 0) if limit else None, "days_left": days_left,
                 "count": len(tx), "synced": at,
                 "top": [{"name": cats.get(k, {}).get("name", k), "emoji": cats.get(k, {}).get("emoji", ""), "amt": round(v, 2),
                          "budget": cats.get(k, {}).get("budget") or 0} for k, v in top],
                 "recent": [{"amt": t.get("amt"), "note": t.get("note") or cats.get(t.get("cat"), {}).get("name", ""),
                             "emoji": cats.get(t.get("cat"), {}).get("emoji", ""), "ts": t.get("ts")} for t in recent]}


# ======================================================= 12. subscription tracker ===
def _norm(note):
    return re.sub(r"[^a-z]+", " ", str(note or "").lower()).strip()


def detect_subs(st):
    cats = {c["id"]: c for c in st.get("cats", [])}
    groups = {}
    for t in st.get("tx", []):
        key = _norm(t.get("note"))
        is_sub_cat = "subscr" in cats.get(t.get("cat"), {}).get("name", "").lower() or t.get("cat") == "subscriptions"
        if not key and not is_sub_cat:
            continue
        key = key or ("subscription " + str(round(float(t.get("amt", 0)))))
        groups.setdefault(key, []).append(t)
    out = []
    for key, txs in groups.items():
        txs.sort(key=lambda t: t["ts"])
        amts = [float(t.get("amt", 0)) for t in txs]
        is_sub_cat = any("subscr" in cats.get(t.get("cat"), {}).get("name", "").lower() or t.get("cat") == "subscriptions" for t in txs)
        months = {dt.datetime.fromtimestamp(t["ts"] / 1000).strftime("%Y-%m") for t in txs}
        gaps = [(b["ts"] - a["ts"]) / 86400000 for a, b in zip(txs, txs[1:])]
        monthly_gap = gaps and all(24 <= g <= 37 for g in gaps[-3:])
        steady = max(amts) <= min(amts) * 1.2 if amts else False
        if not (is_sub_cat or (len(months) >= 2 and monthly_gap and steady)):
            continue
        last = txs[-1]
        nxt = dt.datetime.fromtimestamp(last["ts"] / 1000) + dt.timedelta(days=30)
        out.append({"id": "auto-" + re.sub(r"\W", "", key)[:20], "name": (last.get("note") or key).strip()[:40] or "Subscription",
                    "amount": round(amts[-1], 2), "cycle": "monthly", "next": nxt.strftime("%Y-%m-%d"), "auto": True,
                    "seen": len(txs), "why": "in Subscriptions" if is_sub_cat else f"paid {len(months)} months in a row"})
    return out


@kit.hub_get("/api/kit/subs")
def _subs(q):
    st, _ = kharcha()
    store = common.load("subs", {"manual": [], "hidden": [], "upi": ""})
    auto = [s for s in (detect_subs(st) if st else []) if s["id"] not in store["hidden"]]
    allx = auto + store["manual"]
    today = dt.date.today()
    for s in allx:
        try:
            d = dt.date.fromisoformat(s["next"])
        except (ValueError, KeyError, TypeError):
            d = today
        step = {"weekly": 7, "monthly": 30, "quarterly": 91, "yearly": 365}.get(s.get("cycle"), 30)
        while d < today:
            d += dt.timedelta(days=step)
        s["next"] = d.isoformat()
        s["in_days"] = (d - today).days
        s["per_month"] = round(float(s.get("amount") or 0) * 30 / step, 2)
    allx.sort(key=lambda s: s["in_days"])
    total = round(sum(s["per_month"] for s in allx), 2)
    return 200, {"subs": allx, "per_month": total, "per_year": round(total * 12, 0), "cur": (st or {}).get("settings", {}).get("currency", "₹"),
                 "hidden": len(store["hidden"])}


@kit.hub_post("/api/kit/subs")
def _subs_set(b):
    store = common.load("subs", {"manual": [], "hidden": [], "upi": ""})
    op = b.get("op")
    if op == "add":
        try:
            amt = float(b.get("amount"))
        except (TypeError, ValueError):
            return 400, {"ok": False, "msg": "amount must be a number"}
        nxt = str(b.get("next") or dt.date.today().isoformat())
        store["manual"].append({"id": "m-" + secrets.token_hex(3), "name": str(b.get("name") or "Subscription")[:40], "amount": amt,
                                "cycle": b.get("cycle") if b.get("cycle") in ("weekly", "monthly", "quarterly", "yearly") else "monthly",
                                "next": nxt[:10], "auto": False})
    elif op == "del":
        sid = str(b.get("id"))
        if sid.startswith("auto-"):
            store["hidden"] = list(set(store["hidden"] + [sid]))
        store["manual"] = [s for s in store["manual"] if s["id"] != sid]
    elif op == "unhide":
        store["hidden"] = []
    common.save("subs", store)
    return _subs({})


def due_soon():
    """Subscriptions due in the next 2 days (Home card + morning reminder)."""
    return [s for s in _subs({})[1]["subs"] if s["in_days"] <= 2]


# ================================================================ 13. bill splits ===
def upi_link(vpa, name, amount, note):
    q = {"pa": vpa, "pn": name or vpa.split("@")[0], "am": f"{amount:.2f}", "cu": "INR", "tn": note[:50]}
    return "upi://pay?" + urllib.parse.urlencode(q, quote_via=urllib.parse.quote)


VPA = re.compile(r"^[\w.\-]{2,256}@[a-zA-Z][\w]{2,64}$")


@kit.hub_get("/api/kit/splits")
def _splits(q):
    s = common.load("splits", {"me": {"vpa": "", "name": ""}, "items": []})
    for it in s["items"]:
        for p in it["people"]:
            p["link"] = upi_link(s["me"]["vpa"], s["me"]["name"], p["share"], it["title"]) if s["me"]["vpa"] and not p.get("me") else ""
    st, _ = kharcha()
    recent = []
    if st:
        cats = {c["id"]: c for c in st.get("cats", [])}
        for t in sorted(st.get("tx", []), key=lambda t: -t.get("ts", 0))[:12]:
            recent.append({"amt": t.get("amt"), "note": t.get("note") or cats.get(t.get("cat"), {}).get("name", ""), "ts": t.get("ts"),
                           "emoji": cats.get(t.get("cat"), {}).get("emoji", "")})
    owed = sum(p["share"] for it in s["items"] for p in it["people"] if not p.get("paid") and not p.get("me"))
    return 200, dict(s, recent=recent, owed=round(owed, 2))


@kit.hub_post("/api/kit/splits")
def _splits_set(b):
    s = common.load("splits", {"me": {"vpa": "", "name": ""}, "items": []})
    op = b.get("op")
    if op == "me":
        vpa = str(b.get("vpa", "")).strip()
        if vpa and not VPA.match(vpa):
            return 400, {"ok": False, "msg": "That doesn't look like a UPI ID (name@bank)"}
        s["me"] = {"vpa": vpa, "name": str(b.get("name", "")).strip()[:40]}
    elif op == "add":
        try:
            total = round(float(b.get("total")), 2)
        except (TypeError, ValueError):
            return 400, {"ok": False, "msg": "total must be a number"}
        names = [str(n).strip()[:30] for n in (b.get("people") or []) if str(n).strip()][:30]
        if not names or total <= 0:
            return 400, {"ok": False, "msg": "add an amount and at least one friend"}
        custom = b.get("shares") if isinstance(b.get("shares"), list) and len(b.get("shares")) == len(names) else None
        count = len(names) + (1 if b.get("include_me", True) else 0)
        each = round(total / count, 2)
        people = [{"name": n, "share": round(float(custom[i]), 2) if custom else each, "paid": False} for i, n in enumerate(names)]
        if b.get("include_me", True):
            people.insert(0, {"name": "You", "share": max(0.0, round(total - sum(p["share"] for p in people), 2)), "paid": True, "me": True})
        s["items"].insert(0, {"id": secrets.token_hex(4), "title": str(b.get("title") or "Split")[:50], "total": total,
                              "t": time.time(), "people": people})
        common.event("split.add", b.get("title", ""))
    elif op == "paid":
        for it in s["items"]:
            if it["id"] == b.get("id"):
                for p in it["people"]:
                    if p["name"] == b.get("name"):
                        p["paid"] = bool(b.get("paid", True))
    elif op == "del":
        s["items"] = [it for it in s["items"] if it["id"] != b.get("id")]
    s["items"] = s["items"][:100]
    common.save("splits", s)
    return _splits({})
