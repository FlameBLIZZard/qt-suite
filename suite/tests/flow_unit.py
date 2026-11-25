"""Unit checks for the loop-3 shell additions: "group" / "revive" settings and bringing crashed tools back.
python suite\\tests\\flow_unit.py   (uses a temp settings folder, never touches real tools)"""
import os
import sys
import tempfile
import time

os.environ["QT_SUITE_DATA"] = tempfile.mkdtemp(prefix="qtflow-")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import shell  # noqa: E402

fails = 0


def check(name, ok):
    global fails
    print(("PASS  " if ok else "FAIL  ") + name)
    if not ok:
        fails += 1


TOOL = {"id": "fake", "name": "Fake", "kind": "web", "port": 65001}
up = {"v": False}
starts = []


def fake_start(t):
    starts.append(t["id"])
    up["v"] = True
    return True, "started"


shell.TOOLS, shell._start, shell._port_up = [TOOL], fake_start, (lambda port: up["v"])

s = shell.settings()
check("group defaults on", s["group"] is True)
check("revive defaults off", s["revive"] is False)
s = shell.save({"group": False, "revive": "yes"})
check("group saves a bool", s["group"] is False)
check("revive ignores a non-bool", s["revive"] is False)

# revive off: nothing happens
shell._maybe_revive(TOOL)
time.sleep(2.4)
check("revive off leaves it stopped", starts == [])

# revive on: brought back, logged
shell.save({"revive": True})
shell._maybe_revive(TOOL)
time.sleep(2.6)
check("revive on starts it again", starts == ["fake"])
check("logged as revive", any(e["kind"] == "revive" and e["tool"] == "fake" for e in shell.EVENTS))

# third crash in 10 minutes: gives up
up["v"] = False
shell._maybe_revive(TOOL)
time.sleep(2.6)
up["v"] = False
shell._maybe_revive(TOOL)
time.sleep(0.3)
check("gives up after twice in 10 min", starts == ["fake", "fake"])
check("logged the give-up", any(e["kind"] == "fail" and "kept stopping" in e["msg"] for e in shell.EVENTS))

# someone started it before the 2 s wait ran out: no double start
shell._revived.clear()
up["v"] = False
shell._maybe_revive(TOOL)
up["v"] = True
time.sleep(2.4)
check("no start when it's already back", starts == ["fake", "fake"])

print(f"\n{'ALL PASSED' if not fails else str(fails) + ' FAILED'}")
sys.exit(1 if fails else 0)
