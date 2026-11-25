"""Kharcha <-> PC through Beam.

The Kharcha phone app pushes its whole data (one JSON blob, a few hundred KB at most) to the PC and
picks up expenses typed on the PC. One call does both ways:

  POST /api/kharcha/sync  {state, acked: [ids]}  -> {inbox: [...], urls: [...], pc, saved}
       phone sends its data and the ids of PC-added entries it has merged; gets the rest back
  GET  /api/kharcha                                -> {state, at, inbox, backups}   (PC dashboard)
  POST /api/kharcha/add   {kind, amt, cat, note, ts, mode}  -> queue an expense/income for the phone
  DELETE /api/kharcha/inbox/<id>                    -> drop a queued entry before the phone takes it
  GET  /api/kharcha/backup[/<name>]                -> download the latest (or a dated) backup

Files live in %LOCALAPPDATA%\\Beam\\kharcha: latest.json, inbox.json, backups/kharcha-YYYY-MM-DD.json
(one per day, the last 90 kept). Nothing is sent anywhere else.
"""
import json
import os
import secrets
import threading
import time

LOCK = threading.Lock()
DIR = None
KEEP_BACKUPS = 90


def init(path=None):
    global DIR
    base = os.environ.get("LOCALAPPDATA") or os.path.join(os.path.expanduser("~"), ".beam")
    DIR = path or os.environ.get("BEAM_KHARCHA") or os.path.join(base, "Beam", "kharcha")
    os.makedirs(os.path.join(DIR, "backups"), exist_ok=True)


def _read(name, default):
    try:
        with open(os.path.join(DIR, name), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def _write(name, data):
    p = os.path.join(DIR, name)
    with open(p + ".tmp", "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    os.replace(p + ".tmp", p)


def snapshot():
    return _read("latest.json", None)


def inbox():
    return _read("inbox.json", [])


def backups():
    d = os.path.join(DIR, "backups")
    return sorted((f for f in os.listdir(d) if f.endswith(".json")), reverse=True)


def sync(body, device):
    """Phone -> PC: save its data, forget what it merged, hand back what is still waiting."""
    state = body.get("state")
    acked = set(map(str, body.get("acked") or []))
    with LOCK:
        saved = False
        if isinstance(state, dict) and state.get("v") == 1 and isinstance(state.get("tx"), list):
            snap = {"at": time.time(), "device": device, "state": state}
            _write("latest.json", snap)
            day = time.strftime("%Y-%m-%d")
            _write(os.path.join("backups", f"kharcha-{day}.json"), state)
            for old in backups()[KEEP_BACKUPS:]:
                try:
                    os.remove(os.path.join(DIR, "backups", old))
                except OSError:
                    pass
            saved = True
        box = [x for x in inbox() if x["id"] not in acked]
        if acked:
            _write("inbox.json", box)
    return {"saved": saved, "inbox": box}


def add(body):
    kind = "inc" if body.get("kind") == "inc" else "tx"
    try:
        amt = round(float(body.get("amt")), 2)
    except (TypeError, ValueError):
        amt = 0
    if not (0 < amt < 1e9):
        raise ValueError("Type an amount")
    item = {"id": "pc" + secrets.token_hex(5), "kind": kind, "amt": amt,
            "cat": str(body.get("cat") or ("other" if kind == "inc" else "other"))[:40],
            "note": str(body.get("note") or "")[:80], "mode": str(body.get("mode") or "UPI")[:10],
            "ts": float(body.get("ts") or time.time() * 1000), "added": time.time()}
    with LOCK:
        box = inbox()
        box.append(item)
        _write("inbox.json", box)
    return item


def drop(iid):
    with LOCK:
        box = [x for x in inbox() if x["id"] != iid]
        _write("inbox.json", box)


def backup_path(name=None):
    if not name:
        p = os.path.join(DIR, "latest.json")
        return p if os.path.isfile(p) else None
    if "/" in name or "\\" in name or not name.endswith(".json"):
        return None
    p = os.path.join(DIR, "backups", name)
    return p if os.path.isfile(p) else None
