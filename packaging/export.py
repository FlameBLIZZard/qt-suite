"""Copy the QT tools from a working folder into this repo, leaving personal data behind.

    python packaging\\export.py --from C:\\path\\to\\QT

Only code and assets are copied: no settings, caches, game lists, notes, APKs or test
fixtures from the working PC. A few defaults that point at one person's drives are made
generic, and the result is scanned for paths, names and addresses that must never ship.
"""
import argparse
import fnmatch
import os
import re
import shutil
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# tool folder -> (globs to skip). Paths are relative to the tool folder, "/" separated.
SKIP_ALWAYS = ["__pycache__", "*.pyc", "*.log", "*.tmp", ".venv", "venv", "node_modules", ".git", "Thumbs.db", "desktop.ini", "*.lnk"]
TOOLS = {
    "suite": ["screens", "tray-menu.png", "tests/run_all.ps1", "defaults/qtopen.ini", "defaults/QTOpen.exe", "start.bat", "make-shortcut.bat"],
    "daily": ["docs", "tests", "start.bat", "make-shortcut.bat"],
    "beam": ["beam.json", "tests", "README.txt", "start.bat", "make-shortcut.bat", "data", "inbox"],
    "launcher": ["data", "tests", "README.txt", "start.bat", "make-shortcut.bat"],
    "volt": ["tests", "README.txt", "CHANGELOG.txt", "start.bat", "downloads", "*.json"],
    "burrow": ["tests", "start.bat", "make-shortcut.bat"],
    "lens-pc": ["tests", "*.mp4", "start.bat", "make-shortcut.bat", "data"],
    "soundboard": ["config.json", "sounds/*", "CHANGES.txt", "run.bat", "requirements.txt"],
    "space-manager": ["tests", "README.md", "SpaceCore.ps1", "SpaceManager.ps1", "Space Manager (classic).bat", "start.bat", "make-shortcut.bat"],
}
# single built files from tools that live in their own repos
FILES = {"inkmotion": ["Inkmotion.html", "inkmotion.ico", "LICENSE"], "pixlab": ["Pixlab.html", "pixlab.ico"]}

# one person's drives -> neutral defaults (the app shows "not set up" until the user picks folders)
PATCHES = {
    "space-manager/core.py": [
        ('"reels_root": os.path.join(HOME, "Curious-Orbit", "reels"),', '"reels_root": "",'),
        ('"reels_archive": r"D:\\20_Projects\\Curious-Orbit\\reels",', '"reels_archive": "",'),
        ('"inbox": r"D:\\00_Inbox",', '"inbox": os.path.join(HOME, "Space Manager Inbox"),'),
        ('"log_dir": r"D:\\99_System\\logs",', '"log_dir": "",'),
    ],
    "space-manager/app.py": [("moves finished Curious-Orbit reel frames from C: to D:", "moves finished video-project frames to another drive")],
    "space-manager/static/space.js": [('reels_root.replace(/\\\\Curious-Orbit\\\\reels$/i, "")', 'reels_root.replace(/\\\\[^\\\\]+\\\\reels$/i, "")')],
    "inkmotion/LICENSE": [(re.compile(r"Copyright \(c\) 2026 .+? and Inkmotion contributors"), "Copyright (c) 2026 FlameBLIZZard and Inkmotion contributors")],
    "launcher/static/app.js": [(re.compile(r"'Good evening'\}, [A-Z][a-z]+`"), "'Good evening'}`")],   # a greeting with a first name in it
}

LEAKS = [r"C:\\\\?Users\\\\?Admin", r"100\.98\.\d+\.\d+", r"DESKTOP-[A-Z0-9]{5,}", r"Operator007",
         r"\d{9,10}:[A-Za-z0-9_-]{30,}", r"Curious-Orbit", r"FlameBLIZZard@", r"@gmail\.com"]
# words that must never ship but shouldn't be written in a public file either (names, labels): one per line, kept out of git
PRIVATE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "private-words.txt")
if os.path.isfile(PRIVATE):
    LEAKS += [re.escape(w.strip()) for w in open(PRIVATE, encoding="utf-8") if w.strip() and not w.startswith("#")]
TEXT = (".py", ".js", ".html", ".css", ".json", ".md", ".txt", ".bat", ".ps1", ".cs", ".svg", ".cjs", ".iss", ".ini")


def skip(rel, rules):
    parts = rel.split("/")
    for g in SKIP_ALWAYS + rules:
        if fnmatch.fnmatch(rel, g) or any(fnmatch.fnmatch(p, g) for p in parts if "/" not in g):
            return True
        if "/" in g and (rel == g or rel.startswith(g.rstrip("*").rstrip("/") + "/") or fnmatch.fnmatch(rel, g)):
            return True
    return False


def copy_tool(src_root, name, rules):
    src, dst = os.path.join(src_root, name), os.path.join(REPO, name)
    if os.path.isdir(dst):
        shutil.rmtree(dst)
    n = 0
    for dp, dns, fns in os.walk(src):
        rel_dir = os.path.relpath(dp, src).replace("\\", "/")
        rel_dir = "" if rel_dir == "." else rel_dir + "/"
        dns[:] = [d for d in dns if not skip(rel_dir + d, rules)]
        for f in fns:
            rel = rel_dir + f
            if skip(rel, rules):
                continue
            out = os.path.join(dst, rel)
            os.makedirs(os.path.dirname(out), exist_ok=True)
            shutil.copy2(os.path.join(dp, f), out)
            n += 1
    return n


def patch():
    for rel, subs in PATCHES.items():
        p = os.path.join(REPO, rel)
        s = open(p, encoding="utf-8").read()
        for old, new in subs:
            if isinstance(old, re.Pattern):
                s, n = old.subn(new, s)
            else:
                n = s.count(old)
                s = s.replace(old, new)
            if not n:
                sys.exit(f"export: {rel} no longer matches {old!r}; update PATCHES")
        open(p, "w", encoding="utf-8", newline="").write(s)


def scan(roots):
    bad = []
    rx = re.compile("|".join(LEAKS), re.I)
    for root in roots:
        for dp, _dn, fns in os.walk(root):
            for f in fns:
                if not (f.lower().endswith(TEXT) or "." not in f):
                    continue
                p = os.path.join(dp, f)
                try:
                    for i, line in enumerate(open(p, encoding="utf-8", errors="ignore"), 1):
                        m = rx.search(line)
                        if m:
                            bad.append(f"{os.path.relpath(p, REPO)}:{i}: {m.group(0)}")
                except OSError:
                    pass
    return bad


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="src", required=True, help="the working QT folder")
    a = ap.parse_args()
    for name, rules in TOOLS.items():
        print(f"{name:14} {copy_tool(a.src, name, rules)} files")
    for name, files in FILES.items():
        d = os.path.join(REPO, name)
        shutil.rmtree(d, ignore_errors=True)
        os.makedirs(d)
        for f in files:
            shutil.copy2(os.path.join(a.src, name, f), d)
        print(f"{name:14} {len(files)} files")
    os.makedirs(os.path.join(REPO, "soundboard", "sounds"), exist_ok=True)
    with open(os.path.join(REPO, "soundboard", "sounds", "README.txt"), "w") as f:
        f.write("Drop your own sound clips here, or add them from Soundboard's window.\n")
    patch()
    bad = scan([os.path.join(REPO, n) for n in list(TOOLS) + list(FILES)])
    if bad:
        print("\nPERSONAL DATA FOUND - fix before publishing:")
        print("\n".join(bad[:80]))
        sys.exit(1)
    print("\nscan: clean")


if __name__ == "__main__":
    main()
