r"""shell.py checks on throwaway ports only: settings validation, ordering, crash vs planned stop.
python suite\tests\shell_unit.py"""
import os
import socket
import subprocess
import sys
import tempfile
import time

os.environ["QT_SUITE_DATA"] = tempfile.mkdtemp(prefix="qtshell-")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import shell  # noqa: E402

fails = 0


def check(name, cond):
    global fails
    print(("PASS  " if cond else "FAIL  ") + name)
    fails += not cond


def up(port):
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.3):
            return True
    except OSError:
        return False


P = 7831
TOOLS = [{"id": "fake", "name": "Fake", "kind": "web", "port": P, "tag": "t"},
         {"id": "twin", "name": "Twin", "kind": "web", "port": P, "tag": "t"},
         {"id": "file", "name": "File", "kind": "file", "tag": "t"}]
srv = []


def serve():
    srv.append(subprocess.Popen([sys.executable, "-m", "http.server", str(P), "--bind", "127.0.0.1"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
    for _ in range(40):
        if up(P):
            return True, "started"
        time.sleep(0.1)
    return False, "no"


shell._watch_every = 0.3
shell.init(TOOLS, lambda t: serve(), up)
s = shell.save({"order": ["file", "nope"], "hidden": ["twin"], "boot": ["fake", "file"], "motion": "wild", "split": {"a": "fake", "b": "file", "ratio": 3}})
check("unknown ids and bad values are dropped", s["order"] == ["file"] and s["boot"] == ["fake"] and s["motion"] == "system")
check("split ratio is clamped", s["split"]["ratio"] == 0.8)
rows = shell.arrange([dict(id=t["id"]) for t in TOOLS])
check("order + hidden applied", [r["id"] for r in rows] == ["file", "fake"])
check("show_all keeps hidden ones", len(shell.arrange([dict(id=t["id"]) for t in TOOLS], True)) == 3)
r = shell.start_many(["fake", "twin"])
check("start_many starts a shared server once", r["fake"]["ok"] and r["twin"]["msg"] == "shares a server")
time.sleep(1.2)
check("start shows up as a planned 'up'", any(e["kind"] == "up" and e["msg"] == "started from the suite" for e in shell.EVENTS))
srv[-1].kill(); srv[-1].wait()
time.sleep(1.2)
check("an unasked stop is a crash", any(e["kind"] == "crash" for e in shell.EVENTS))
serve(); time.sleep(1.2)
shell.expect("fake", "stop"); srv[-1].kill(); srv[-1].wait(); time.sleep(1.2)
check("a stop the suite asked for is not a crash", shell.EVENTS[-1]["kind"] == "stop")
code, body = shell.route_get("/api/activity", {"since": ["1"]})
check("activity since filters", code == 200 and all(e["id"] > 1 for e in body["events"]))
check("find needs 2+ letters", shell.find("a") == {"files": []})
print("ALL PASSED" if not fails else f"{fails} FAILED")
sys.exit(fails)
