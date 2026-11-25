"""Read-only checks for defaults.py (QT as a Windows default viewer). Doesn't register or undo anything."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import defaults  # noqa: E402

bad = []
m = defaults.ext_map()
for risky in "exe bat cmd ps1 py pyw reg js_never doc docx xls xlsx ppt pptx csv html htm rar 7z psd ts lnk".split():
    if risky in m:
        bad.append(f"{risky} must stay out of QT's default list")
for e, app in (("jpg", "pictures"), ("mp4", "player"), ("mp3", "player"), ("pdf", "reader"), ("md", "reader"), ("txt", "code"), ("zip", "archive")):
    if m.get(e) != app:
        bad.append(f".{e} should open in {app}, got {m.get(e)}")
s = defaults.status()
for k in ("on", "exe", "total", "ours", "pct", "apps", "types"):
    if k not in s:
        bad.append("status() missing " + k)
if s.get("total") != len(m):
    bad.append("status total doesn't match the list")
if s.get("on"):
    if not os.path.exists(defaults.EXE):
        bad.append("registered but QTOpen.exe is missing")
    cmd = defaults._get(defaults.HKCU, rf"{defaults.CLASSES}\QTSuite.Code\shell\open\command")
    if not cmd or defaults.EXE not in cmd:
        bad.append("QTSuite.Code doesn't point at QTOpen.exe")
print("ALL PASSED" if not bad else "FAILED:\n  " + "\n  ".join(bad))
sys.exit(1 if bad else 0)
