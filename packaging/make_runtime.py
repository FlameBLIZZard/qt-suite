"""Build build\\app\\runtime: a private copy of Python plus the packages the tools import.

    python packaging\\make_runtime.py [--extra-python C:\\path\\to\\volt-venv\\Scripts\\python.exe]

Run it with the Python you want to ship (3.12 or newer, 64-bit, from python.org). The
packages must already be installed in that Python, or in the extra one, which is a venv
that holds VOLT's engine. Each package is copied file by file from its own install record
(dist-info RECORD), so its licence files come along. Nothing is downloaded.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(REPO, "build", "app", "runtime")

# what the tools import, by distribution name (dependencies are followed automatically)
WANT = ["pillow", "numpy", "sounddevice", "soundfile", "keyboard", "onnxruntime",            # hub, Lens PC, Soundboard
        "flask", "yt-dlp", "yt-dlp-ejs", "gallery-dl", "curl_cffi", "brotli", "mutagen",    # VOLT
        "websockets", "pycryptodomex", "requests", "certifi"]
OPTIONAL = ["pillow-heif"]   # HEIC photos in Burrow / Lens PC when present
NEVER = {"pip", "setuptools", "wheel", "imageio-ffmpeg"}   # ffmpeg is not shipped (see THIRD_PARTY.md)

STDLIB_SKIP = {"test", "idlelib", "ensurepip", "lib2to3", "turtledemo", "site-packages", "__pycache__", "venv"}

LISTER = r"""
import json, sys, importlib.metadata as md, re
want = json.loads(sys.argv[1]); never = set(json.loads(sys.argv[2]))
norm = lambda n: re.sub(r"[-_.]+", "-", n).lower()
dists = {}
for d in md.distributions():
    nm = d.metadata.get("Name")
    if nm and d.files:   # a half-removed old version leaves a dist-info with no metadata
        dists.setdefault(norm(nm), d)
out, todo, seen = {}, [norm(w) for w in want], set()
while todo:
    n = todo.pop()
    if n in seen or n in never: continue
    seen.add(n)
    d = dists.get(n)
    if not d: out[n] = None; continue
    root = str(d.locate_file(""))
    out[n] = {"version": d.version, "root": root, "files": [str(f) for f in (d.files or [])],
              "license": d.metadata.get("License-Expression") or d.metadata.get("License") or ""}
    for r in d.requires or []:
        if "extra ==" in r: continue
        if ";" in r:
            try:
                from packaging.markers import Marker
                if not Marker(r.split(";", 1)[1]).evaluate(): continue
            except Exception:
                if "sys_platform" in r and "win32" not in r: continue
        todo.append(norm(re.split(r"[\s;<>=!~\[(]", r, 1)[0]))
print(json.dumps(out))
"""


def list_dists(python, want):
    r = subprocess.run([python, "-c", LISTER, json.dumps(want), json.dumps(sorted(NEVER))], capture_output=True, text=True, check=True)
    return json.loads(r.stdout)


def copy_stdlib(base):
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    os.makedirs(OUT)
    for f in os.listdir(base):
        p = os.path.join(base, f)
        if os.path.isfile(p) and f.lower().endswith((".exe", ".dll", ".txt")) and f.lower() != "news.txt":
            shutil.copy2(p, OUT)
    shutil.copytree(os.path.join(base, "DLLs"), os.path.join(OUT, "DLLs"), ignore=shutil.ignore_patterns("*_test*", "*.pdb"))
    if os.path.isdir(os.path.join(base, "tcl")):  # Soundboard's classic window uses tkinter
        shutil.copytree(os.path.join(base, "tcl"), os.path.join(OUT, "tcl"), ignore=shutil.ignore_patterns("demos", "*.chm"))
    lib = os.path.join(base, "Lib")
    shutil.copytree(lib, os.path.join(OUT, "Lib"), ignore=lambda d, names: [n for n in names if n in STDLIB_SKIP or (d == lib and n == "site-packages")])
    os.makedirs(os.path.join(OUT, "Lib", "site-packages"))


def copy_dist(info):
    sp = os.path.join(OUT, "Lib", "site-packages")
    n = 0
    for rel in info["files"]:
        if rel.startswith("..") or rel.endswith(".pyc") or "__pycache__" in rel:
            continue   # scripts outside site-packages, caches
        src = os.path.join(info["root"], rel)
        if os.path.isfile(src):
            dst = os.path.join(sp, rel)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(src, dst)
            n += 1
    return n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--extra-python", help="a second Python (venv) to take missing packages from, e.g. VOLT's venv")
    a = ap.parse_args()
    base = sys.base_prefix
    print("Python", sys.version.split()[0], "from", base)
    copy_stdlib(base)
    got = {k: v for k, v in list_dists(sys.executable, WANT + OPTIONAL).items() if v}
    missing = [w for w in WANT if w.lower() not in got and w.lower().replace("_", "-") not in got]
    if a.extra_python and missing:
        more = list_dists(a.extra_python, WANT)
        for k, v in more.items():
            if v and k not in got:
                got[k] = v
    still = [w for w in WANT if not any(k == w.lower().replace("_", "-") for k in got)]
    if still:
        sys.exit("missing packages: " + ", ".join(still))
    manifest = []
    for name, info in sorted(got.items()):
        n = copy_dist(info)
        manifest.append({"name": name, "version": info["version"], "license": info["license"][:120], "files": n})
        print(f"  {name:24} {info['version']:12} {n:5} files  {info['license'][:40]}")
    with open(os.path.join(REPO, "build", "packages.json"), "w") as f:
        json.dump(manifest, f, indent=1)
    # compile once so the first start is quick (and the folder is read-only friendly)
    subprocess.run([os.path.join(OUT, "python.exe"), "-m", "compileall", "-q", "-j", "0", os.path.join(OUT, "Lib")], check=False)
    size = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(OUT) for f in fs)
    print(f"runtime: {size / 1048576:.0f} MB")


if __name__ == "__main__":
    main()
