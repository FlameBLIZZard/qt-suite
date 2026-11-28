"""Who may connect to QT Remote.

Three locks, all must open:
1. Network: only Tailscale peers (WireGuard: encrypted end to end, every device signed in to
   your tailnet) or this PC itself. Plain Wi-Fi/LAN is refused unless you turn it on.
2. Identity: `tailscale whois` names the device and account behind each connection. By
   default only devices signed in to the same Tailscale account as this PC are allowed.
3. Pairing: a new device asks to pair, both screens show the same 6-digit code, and you allow
   it on the PC (or from a device you already trust). It then gets a long random key that only
   works from that same Tailscale device. Keys are stored here only as SHA-256 hashes."""
import hashlib
import ipaddress
import json
import os
import secrets
import shutil
import subprocess
import threading
import time

NOWIN = 0x08000000
DATA = os.environ.get("QT_REMOTE_DATA") or os.path.join(os.environ.get("LOCALAPPDATA", "."), "QT Remote")
os.makedirs(DATA, exist_ok=True)
LOCK = threading.RLock()
TS_NET4 = ipaddress.ip_network("100.64.0.0/10")
TS_NET6 = ipaddress.ip_network("fd7a:115c:a1e0::/48")

DEFAULTS = {"enabled": True, "same_user": True, "ask_each_time": False, "clip_sync": True,
            "files": True, "allow_lan": False}


def _path(name):
    return os.path.join(DATA, name)


def _load(name, default):
    try:
        with open(_path(name), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def _save(name, obj):
    tmp = _path(name + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=1)
    os.replace(tmp, _path(name))


SETTINGS = dict(DEFAULTS, **_load("settings.json", {}))
DEVICES = _load("trusted.json", [])
LOG = _load("log.json", [])


def set_settings(d):
    with LOCK:
        for k, v in d.items():
            if k in DEFAULTS and isinstance(v, bool):
                SETTINGS[k] = v
        _save("settings.json", SETTINGS)
    return SETTINGS


def log(kind, text, who=""):
    with LOCK:
        LOG.append({"ts": time.time(), "kind": kind, "text": text, "who": who})
        del LOG[:-300]
        _save("log.json", LOG)


# ---------------------------------------------------------------- Tailscale
def ts_exe():
    for p in (os.environ.get("QT_REMOTE_TAILSCALE", ""), r"C:\Program Files\Tailscale\tailscale.exe",
              shutil.which("tailscale") or ""):
        if p and os.path.exists(p):
            return p
    return None


def _ts(*args, timeout=6):
    exe = ts_exe()
    if not exe:
        return None
    try:
        r = subprocess.run([exe, *args], capture_output=True, timeout=timeout, creationflags=NOWIN)
        return json.loads(r.stdout.decode("utf-8", "replace")) if r.returncode == 0 else None
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return None


_status = {"at": 0, "v": None}


def ts_status(max_age=20):
    """Self + peers from `tailscale status --json`, cached. None when Tailscale isn't installed/running."""
    with LOCK:
        if time.time() - _status["at"] < max_age:
            return _status["v"]
    v = _ts("status", "--json")
    with LOCK:
        _status.update(at=time.time(), v=v)
    return v


def self_info():
    s = ts_status() or {}
    me = s.get("Self") or {}
    users = s.get("User") or {}
    user = users.get(str(me.get("UserID"))) or {}
    ips = [ip for ip in me.get("TailscaleIPs") or [] if ":" not in ip]
    return {"running": s.get("BackendState") == "Running", "ip": ips[0] if ips else None,
            "host": (me.get("HostName") or "").lower(), "dns": (me.get("DNSName") or "").rstrip(".").lower(),
            "login": user.get("LoginName", ""), "installed": bool(ts_exe())}


def peers():
    """Other devices on the tailnet (for 'connect to another device')."""
    s = ts_status() or {}
    out = []
    for p in (s.get("Peer") or {}).values():
        ips = [ip for ip in p.get("TailscaleIPs") or [] if ":" not in ip]
        if not ips:
            continue
        out.append({"name": p.get("HostName") or "?", "dns": (p.get("DNSName") or "").rstrip("."),
                    "ip": ips[0], "os": p.get("OS", ""), "online": bool(p.get("Online"))})
    out.sort(key=lambda p: (not p["online"], p["name"].lower()))
    return out


_who = {}


def whois(ip):
    """{'node': stable id, 'name': device, 'login': account, 'os'} for a tailnet address (cached 5 min)."""
    with LOCK:
        hit = _who.get(ip)
        if hit and time.time() - hit[0] < 300:
            return hit[1]
    w = _ts("whois", "--json", ip, timeout=5)
    out = None
    if w and w.get("Node"):
        n, u = w["Node"], w.get("UserProfile") or {}
        hi = n.get("Hostinfo") or {}
        out = {"node": n.get("StableID") or str(n.get("ID")), "name": hi.get("Hostname") or n.get("ComputedName")
               or (n.get("Name") or "").split(".")[0], "login": u.get("LoginName", ""), "os": hi.get("OS", "")}
    with LOCK:
        _who[ip] = (time.time(), out)
    return out


def classify(ip):
    """'local' (this PC over loopback), 'tailnet', or 'lan'."""
    try:
        a = ipaddress.ip_address(ip.split("%")[0])
    except ValueError:
        return "lan"
    if a.is_loopback:
        return "local"
    if getattr(a, "ipv4_mapped", None):
        a = a.ipv4_mapped
    if (a.version == 4 and a in TS_NET4) or (a.version == 6 and a in TS_NET6):
        return "tailnet"
    return "lan"


def identify(ip):
    """Identity of whoever is at the other end, or (None, reason) when they may not connect at all."""
    kind = classify(ip)
    if kind == "local":
        return {"node": "local", "name": "This PC", "login": "", "os": "windows", "kind": kind}, None
    if kind == "lan":
        if not SETTINGS.get("allow_lan"):
            return None, "Only devices on your Tailscale network can connect. Open this page through Tailscale."
        return {"node": "lan:" + ip, "name": ip, "login": "", "os": "", "kind": kind}, None
    w = whois(ip)
    if not w:
        return None, "Tailscale could not say which device this is."
    if SETTINGS.get("same_user"):
        mine = self_info().get("login")
        if mine and w["login"] and w["login"] != mine:
            return None, "This device is signed in to a different Tailscale account."
    return dict(w, kind=kind), None


# ---------------------------------------------------------------- trusted devices
def _hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def public_device(d):
    return {k: d.get(k) for k in ("id", "name", "node_name", "login", "os", "added", "last", "view_only", "kind")}


def devices():
    with LOCK:
        return [public_device(d) for d in DEVICES]


def check_token(token, who):
    """The trusted device for this key, only if it comes from the same Tailscale device it paired from."""
    if not token or not who:
        return None
    h = _hash(token)
    with LOCK:
        for d in DEVICES:
            if secrets.compare_digest(d["hash"], h):
                return d if d.get("node") == who["node"] else None
    return None


def touch(dev):
    with LOCK:
        dev["last"] = time.time()
        _save("trusted.json", DEVICES)


def add_device(name, who, view_only=False):
    token = secrets.token_urlsafe(32)
    dev = {"id": secrets.token_hex(6), "hash": _hash(token), "name": name[:40] or who["name"],
           "node": who["node"], "node_name": who["name"], "login": who.get("login", ""), "os": who.get("os", ""),
           "kind": who.get("kind"), "added": time.time(), "last": None, "view_only": bool(view_only)}
    with LOCK:
        DEVICES[:] = [d for d in DEVICES if d.get("node") != who["node"]]  # one key per device
        DEVICES.append(dev)
        _save("trusted.json", DEVICES)
    return dev, token


def update_device(did, **kw):
    with LOCK:
        for d in DEVICES:
            if d["id"] == did:
                if "view_only" in kw:
                    d["view_only"] = bool(kw["view_only"])
                if kw.get("name"):
                    d["name"] = str(kw["name"])[:40]
                _save("trusted.json", DEVICES)
                return d
    return None


def remove_device(did):
    with LOCK:
        n = len(DEVICES)
        DEVICES[:] = [d for d in DEVICES if d["id"] != did]
        _save("trusted.json", DEVICES)
        return len(DEVICES) < n


# ---------------------------------------------------------------- pairing
PENDING = {}  # id -> request
PAIR_TTL = 120
_fails = {}  # ip -> [timestamps] of bad keys / pair spam


def limited(ip, cap=8, window=600):
    now = time.time()
    with LOCK:
        hits = [t for t in _fails.get(ip, []) if now - t < window]
        _fails[ip] = hits
        return len(hits) >= cap


def strike(ip):
    with LOCK:
        _fails.setdefault(ip, []).append(time.time())


def new_request(name, who, ip):
    with LOCK:
        expire()
        for r in PENDING.values():  # one open request per device
            if r["who"]["node"] == who["node"] and r["state"] == "waiting":
                r["state"] = "replaced"
        rid = secrets.token_hex(6)
        r = {"id": rid, "secret": secrets.token_urlsafe(16), "code": f"{secrets.randbelow(10 ** 6):06d}",
             "name": (name or who["name"])[:40], "who": who, "ip": ip, "at": time.time(), "state": "waiting",
             "token": None, "view_only": False}
        PENDING[rid] = r
    log("pair", f"{r['name']} asked to pair", who["name"])
    return r


def expire():
    now = time.time()
    with LOCK:
        for rid, r in list(PENDING.items()):
            if r["state"] == "waiting" and now - r["at"] > PAIR_TTL:
                r["state"] = "expired"
            if now - r["at"] > PAIR_TTL + 300:
                PENDING.pop(rid, None)


def decide(rid, how, by="this PC"):
    """how: 'allow' | 'view' | 'deny'."""
    with LOCK:
        expire()
        r = PENDING.get(rid)
        if not r or r["state"] != "waiting":
            return None
        if how == "deny":
            r["state"] = "denied"
            log("deny", f"Pairing for {r['name']} was refused ({by})", r["who"]["name"])
            return r
        dev, token = add_device(r["name"], r["who"], view_only=(how == "view"))
        r.update(state="approved", token=token, device=dev["id"], view_only=dev["view_only"])
        log("trust", f"{r['name']} is now trusted{' (view only)' if dev['view_only'] else ''} ({by})", r["who"]["name"])
        return r


def waiting():
    with LOCK:
        expire()
        return [{"id": r["id"], "code": r["code"], "name": r["name"], "device": r["who"]["name"],
                 "login": r["who"].get("login", ""), "os": r["who"].get("os", ""), "kind": r["who"].get("kind"),
                 "at": r["at"], "left": max(0, int(PAIR_TTL - (time.time() - r["at"])))}
                for r in PENDING.values() if r["state"] == "waiting"]


def collect(rid, secret):
    """The pairing device polls this; the key is handed over once, then wiped from memory."""
    with LOCK:
        expire()
        r = PENDING.get(rid)
        if not r or not secrets.compare_digest(r["secret"], secret or ""):
            return None
        out = {"state": r["state"]}
        if r["state"] == "approved" and r["token"]:
            out.update(token=r["token"], device=r["device"], view_only=r["view_only"])
            r["token"] = None
            r["state"] = "collected"
        return out
