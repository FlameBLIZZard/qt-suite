"""Copy the shared QT Suite theme (theme/qt.css) into every tool so each one
also looks right when opened on its own. Run after editing theme/qt.css."""
import os
import shutil

HERE = os.path.dirname(os.path.abspath(__file__))
QT = os.path.dirname(HERE)
SRC = os.path.join(HERE, "theme", "qt.css")
TARGETS = [
    "beam/static",
    "launcher/static",
    "volt/static",
    "soundboard/static",
    "burrow/static",
    "lens-pc/static",
    "space-manager/static",
    "daily/static",
    "beam-android/app/src/main/assets",
]

for t in TARGETS:
    d = os.path.join(QT, t)
    if os.path.isdir(d):
        shutil.copyfile(SRC, os.path.join(d, "qt.css"))
        shutil.copyfile(os.path.join(HERE, "theme", "qt-bridge.js"), os.path.join(d, "qt-bridge.js"))
        print("synced", t)
    else:
        print("skipped (missing)", t)
