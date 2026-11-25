"""guide.py unit checks: new-person detection, saved state is validated, the problem report hides names.
python suite\\tests\\guide_unit.py   (uses a temp data folder; touches nothing real)"""
import json
import os
import sys
import tempfile

tmp = tempfile.mkdtemp(prefix="qt-guide-")
os.environ["QT_SUITE_DATA"] = tmp
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import guide  # noqa: E402

fails = 0


def check(name, ok):
    global fails
    print(("PASS  " if ok else "FAIL  ") + name)
    fails += 0 if ok else 1


guide.init([], lambda t: "off", sys.executable)
s = guide.state()
check("empty data folder = new person, welcome not done", s["fresh"] and not s["onboarded"] and s["tasks"] == {})
check("guide.json written at start", os.path.exists(os.path.join(tmp, "guide.json")))
s = guide.save({"onboarded": True, "tasks": {"pick": 1, "bogus": True, "dismissed": False}, "tips": {"beam": True, "x" * 50: True}, "tour": "yes"})
check("only known tasks kept", s["tasks"] == {"pick": True, "dismissed": False})
check("long tip keys refused", list(s["tips"]) == ["beam"])
check("non-bool tour ignored", s["tour"] is False and s["onboarded"] is True)
s = guide.save({"reset": True})
check("reset clears progress", not s["onboarded"] and s["tasks"] == {} and s["tips"] == {})

# someone who used the suite before this layer: settings.json exists, guide.json doesn't
tmp2 = tempfile.mkdtemp(prefix="qt-guide-old-")
with open(os.path.join(tmp2, "settings.json"), "w") as f:
    json.dump({"order": []}, f)
guide.STORE = os.path.join(tmp2, "guide.json"); guide.shell.DATA = tmp2; guide._state = None
s = guide.state()
check("existing user skips the welcome and the checklist", not s["fresh"] and s["onboarded"] and s["tasks"].get("dismissed"))

home = os.path.expanduser("~")
text = guide._scrub(f"path {home}\\QT and {os.environ.get('USERNAME', 'someone')} on {os.environ.get('COMPUTERNAME', 'pc')}")
check("report hides the user folder, name and PC name", home not in text and "%USERPROFILE%" in text
      and (len(os.environ.get("USERNAME", "")) <= 2 or os.environ["USERNAME"].lower() not in text.lower()))
pub = guide.public()
check("public state has version and task ids", "version" in pub and pub["taskIds"][0] == "pick")
print(f"{fails} failed" if fails else "all passed")
sys.exit(1 if fails else 0)
