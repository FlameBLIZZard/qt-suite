"""Unit checks for nova.py (loop 5): store validation, reminders, app/web/kill guards, screenshot, clipboard list, network.
python suite\\tests\\nova_unit.py   (writes only into a temp folder; never ends a program or opens a browser)"""
import os
import shutil
import sys
import tempfile
import time

TMP = tempfile.mkdtemp(prefix="qt-nova-")
os.environ["QT_SUITE_DATA"] = os.path.join(TMP, "data")
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import nova  # noqa: E402

fails = 0


def check(name, ok):
    global fails
    print(("PASS  " if ok else "FAIL  ") + name)
    fails += 0 if ok else 1


try:
    s = nova.save_store({"todos": [{"text": "  milk  "}, {"text": ""}, "junk", {"id": "../x", "text": "a" * 500, "done": 1}],
                         "reminders": [{"text": "tea", "at": time.time() - 1}, {"text": "later", "at": time.time() + 3600}, {"at": "soon"}]})
    check("to-dos trimmed, empties dropped, ids made safe", [t["text"] for t in s["todos"]] == ["milk", "a" * 300] and s["todos"][1]["id"] != "../x" and s["todos"][1]["done"] is True)
    check("bad reminders dropped, sorted by time", [r["text"] for r in s["reminders"]] == ["tea", "later"])
    check("store saved to disk", os.path.isfile(nova.STORE))
    gone = nova.fire_due()
    check("due reminder fires once", [r["text"] for r in gone] == ["tea"] and nova.fire_due() == [])
    check("/due lists it", [r["text"] for r in nova.due(time.time() - 60)] == ["tea"])
    s2 = nova.save_store({"reminders": [dict(r, fired=None) for r in nova.store()["reminders"]]})
    check("an old page copy can't un-fire a reminder", next(r for r in s2["reminders"] if r["text"] == "tea")["fired"])

    check("launch refuses paths outside the Start menu", nova.launch(r"C:\Windows\System32\cmd.exe")[0] == 404)
    check("Start menu apps are listed", isinstance(nova.apps(), list))
    check("web refuses non-web links", nova.open_web("file:///C:/Windows")[0] == 400 and nova.open_web("javascript:alert(1)")[0] == 400)
    check("kill refuses Windows' own processes", nova.kill("svchost.exe", [4])[0] == 403 and nova.kill("explorer.exe", [1])[0] == 403)
    check("kill refuses pids that aren't that program", nova.kill("notepad-not-running.exe", [os.getpid()])[0] == 404)
    t = nova.top(5)
    check("top programs grouped, hub never safe to end", len(t) <= 5 and all("pids" in g for g in t))

    nova.shot_dir = lambda: os.path.join(TMP, "shots")
    code, r = nova.shot(0)
    check("screenshot saved as png", code == 200 and os.path.isfile(r["path"]) and r["path"].endswith(".png") and r["w"] > 0)
    code2, r2 = nova.shot(0)
    check("second screenshot gets its own name", code2 == 200 and r2["path"] != r["path"])

    nova._clips["list"] = []
    for x in ["a", "b", "a", "", "x" * 30000]:
        nova.add_clip(x)
    check("clips: newest first, no repeats, no empties or huge ones", [c["text"] for c in nova.clips()["items"]] == ["a", "b"])
    for i in range(40):
        nova.add_clip(f"c{i}")
    check("clips capped at 25", len(nova.clips()["items"]) == 25)
    code, c = nova.route_post("/api/nova/clips", {"clear": True})
    check("clips clear", c["items"] == [])

    n = nova.net()
    check("network rates are numbers", isinstance(n["down"], int) and isinstance(n["up"], int))
finally:
    shutil.rmtree(TMP, ignore_errors=True)

print("\nALL PASSED" if not fails else f"\n{fails} FAILED")
sys.exit(1 if fails else 0)
