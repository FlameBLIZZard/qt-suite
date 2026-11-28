"""Toolkit core: status, phone link pairing, the action runner."""
import kit
from kit import actions, common, phone


@kit.hub_get("/api/kit/status")
def _status(q):
    return 200, {"ok": True, "errors": kit.INFO["errors"], "phone": phone.status()}


@kit.hub_get("/api/kit/phone")
def _phone(q):
    return 200, phone.status()


@kit.hub_post("/api/kit/phone/newkey")
def _newkey(b):
    phone.new_key()
    return 200, phone.status()


@kit.hub_post("/api/kit/phone/power")
def _power(b):
    c = common.load("phone", {"key": "", "on": True})
    c["on"] = bool(b.get("on"))
    common.save("phone", c)
    if c["on"]:
        phone.start()
    else:
        phone.stop()
    return 200, phone.status()


@kit.hub_get("/api/kit/actions")
def _actions(q):
    return 200, {"named": actions.named_list()}


@kit.hub_post("/api/kit/do")
def _do(b):
    ok, msg = actions.run(b.get("action") or {})
    return (200 if ok else 400), {"ok": ok, "msg": msg}


@kit.hub_get("/api/kit/events")
def _events(q):
    since = float((q.get("since") or ["0"])[0] or 0)
    return 200, {"events": common.events(since)[-500:]}


@kit.hub_post("/api/kit/event")
def _event(b):
    """The page logs UI events (opened a feature, won a game) for XP and the streak calendar."""
    k = str(b.get("k", ""))[:40]
    if not k or not all(c.isalnum() or c in "._-" for c in k):
        return 400, {"ok": False}
    return 200, common.event(k, str(b.get("d", ""))[:120])


def init():
    c = common.load("phone", {"key": "", "on": True})
    if not c.get("on", True):
        import os
        os.environ["QT_KIT_NO_PHONE"] = "1"
