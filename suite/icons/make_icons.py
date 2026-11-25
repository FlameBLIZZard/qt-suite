"""QT Suite icon family ("Ink Arcade"): one glyph per tool on its accent tile.

Writes, for every tool:
  icons/svg/<id>.svg              full desktop icon (tile + ink outline + hard shadow)
  icons/png/<id>-<size>.png       rendered with headless Edge
  icons/ico/<id>.ico              Windows icon (16..256)
  icons/android/<id>/...          adaptive launcher icon (vector foreground + colour background)
Run:  python suite\\icons\\make_icons.py
"""
import os
import subprocess
import tempfile

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
INK = "#16141a"

# Glyphs are drawn in a 100x100 box, kept inside roughly 22..78 so they survive any launcher mask.
# s = stroked paths (ink lines), f = filled paths.
TOOLS = {
    "suite": ("#fff8ec", [], [("M24 24h22v22H24z", "#c6ff3d"), ("M54 24h22v22H54z", "#4dc3ff"), ("M24 54h22v22H24z", "#ff5fa2"), ("M54 54h22v22H54z", "#ffc93d")]),
    "beam": ("#c6ff3d", ["M37 70V30", "M25 42l12-12 12 12", "M63 30v40", "M51 58l12 12 12-12"], []),
    "launchpad": ("#4dc3ff", ["M30 41h40a10 10 0 0 1 9 14l-5 11a7 7 0 0 1-11 2l-6-6H43l-6 6a7 7 0 0 1-11-2l-5-11a10 10 0 0 1 9-14z", "M35 47v10", "M30 52h10"],
                  ["M60 46a3.5 3.5 0 1 0 .1 0z", "M67 53a3.5 3.5 0 1 0 .1 0z"]),
    "volt": ("#ffc93d", [], ["M57 18L28 56h19l-6 27 31-40H53z"]),
    "soundboard": ("#ff5fa2", ["M63 40q7 10 0 20", "M71 32q14 18 0 36"], ["M24 41h11l17-14v46L35 59H24z"]),
    "inkmotion": ("#b28bff", ["M20 64c9-20 16-29 23-29s5 25 14 25 9-19 13-23", "M70 37l9-4-2 10"], []),
    "pixlab": ("#ff6b4a", [], ["M28 28h14v14H28z", "M58 28h14v14H58z", "M43 43h14v14H43z", "M28 58h14v14H28z", "M58 58h14v14H58z"]),
    "kharcha": ("#5dffb0", ["M33 28h34", "M33 41h34", "M45 28c17 0 17 26 0 26h-9l25 22"], []),
    "lens": ("#ff8a3d", ["M50 24a26 26 0 1 0 .1 0z"], ["M50 37a13 13 0 1 0 .1 0z", "M64 30a4 4 0 1 0 .1 0z"]),
    "apks": ("#ff8a3d", ["M38 22h24a6 6 0 0 1 6 6v44a6 6 0 0 1-6 6H38a6 6 0 0 1-6-6V28a6 6 0 0 1 6-6z", "M50 34v22", "M42 49l8 8 8-8"], ["M46 68h8v5h-8z"]),
    "burrow": ("#2ee6d6", ["M18 70h64", "M26 70c0-24 11-36 24-36s24 12 24 36"], ["M40 70c0-12 4-18 10-18s10 6 10 18z"]),
    "space": ("#7d9bff", ["M50 24a26 26 0 1 0 .1 0z"], ["M50 50V24a26 26 0 0 1 24.4 34.9z"]),
    "ping": ("#ff4d5e", ["M31 64V47a19 19 0 0 1 38 0v17l6 7H25z", "M43 78a7 7 0 0 0 14 0"], [("M70 22a8 8 0 1 0 .1 0z", "#fff8ec")]),
    "daily": ("#ff9de2", ["M18 68h64", "M50 24v9", "M24 40l7 6", "M76 40l-7 6"], ["M31 68a19 19 0 0 1 38 0z"]),
}


def glyph(paths_s, paths_f, color=INK):
    out = [f'<path d="{d}" fill="none" stroke="{color}" stroke-width="7.5" stroke-linecap="round" stroke-linejoin="round"/>' for d in paths_s]
    for d in paths_f:
        d, c = d if isinstance(d, tuple) else (d, color)
        out.append(f'<path d="{d}" fill="{c}"/>' + (f'<path d="{d}" fill="none" stroke="{INK}" stroke-width="4"/>' if c != color else ""))
    return "".join(out)


def desktop_svg(acc, s, f):
    # tile with ink outline and a hard offset shadow, glyph slightly scaled into the tile
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
            f'<rect x="10" y="10" width="86" height="86" rx="22" fill="#000"/>'
            f'<rect x="4" y="4" width="86" height="86" rx="22" fill="{acc}" stroke="#000" stroke-width="5"/>'
            f'<g transform="translate(47 47) scale(.86) translate(-50 -50)">{glyph(s, f)}</g></svg>')


def render(svg, size, path):
    """Rasterise an SVG with headless Edge (transparent background)."""
    edge = next(p for p in (r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
                            r"C:\Program Files\Microsoft\Edge\Application\msedge.exe") if os.path.exists(p))
    with tempfile.TemporaryDirectory() as td:
        html = os.path.join(td, "i.html")
        with open(html, "w", encoding="utf-8") as fh:
            fh.write(f'<html><body style="margin:0;background:transparent">'
                     f'<div style="width:{size}px;height:{size}px">{svg.replace("<svg ", f"<svg width={size} height={size} ")}</div></body></html>')
        shot = os.path.join(td, "s.png")
        subprocess.run([edge, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--default-background-color=00000000",
                        f"--window-size={size},{size}", f"--screenshot={shot}", "file:///" + html.replace("\\", "/")],
                       check=True, capture_output=True, timeout=60)
        Image.open(shot).convert("RGBA").crop((0, 0, size, size)).save(path)


def android_xml(acc, s, f):
    # Adaptive icon: 108dp canvas, safe zone 66dp in the middle. Glyph box 0..100 -> 27..81 (scale .54).
    paths = "".join(f'<path android:pathData="{d}" android:strokeColor="{INK}" android:strokeWidth="7.5" '
                    f'android:strokeLineCap="round" android:strokeLineJoin="round" android:fillColor="#00000000"/>' for d in s)
    for d in f:
        d, c = d if isinstance(d, tuple) else (d, INK)
        paths += f'<path android:pathData="{d}" android:fillColor="{c}"' + (f' android:strokeColor="{INK}" android:strokeWidth="4"' if c != INK else "") + "/>"
    fg = ('<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="108dp" android:height="108dp" '
          'android:viewportWidth="108" android:viewportHeight="108">'
          f'<group android:translateX="27" android:translateY="27" android:scaleX=".54" android:scaleY=".54">{paths}</group></vector>\n')
    mono = fg  # Android 13 themed icons reuse the glyph
    launcher = ('<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
                '    <background android:drawable="@color/qt_icon_bg" />\n    <foreground android:drawable="@drawable/ic_qt_fg" />\n'
                '    <monochrome android:drawable="@drawable/ic_qt_fg" />\n</adaptive-icon>\n')
    color = f'<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="qt_icon_bg">{acc}</color>\n</resources>\n'
    return fg, mono, launcher, color


def main(only=None):
    for d in ("svg", "png", "ico", "android"):
        os.makedirs(os.path.join(HERE, d), exist_ok=True)
    for tid, (acc, s, f) in TOOLS.items():
        if only and tid not in only:
            continue
        svg = desktop_svg(acc, s, f)
        with open(os.path.join(HERE, "svg", tid + ".svg"), "w", encoding="utf-8") as fh:
            fh.write(svg)
        big = os.path.join(HERE, "png", f"{tid}-512.png")
        render(svg, 512, big)
        im = Image.open(big)
        for sz in (192, 48):
            im.resize((sz, sz), Image.LANCZOS).save(os.path.join(HERE, "png", f"{tid}-{sz}.png"))
        im.save(os.path.join(HERE, "ico", tid + ".ico"), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
        a = os.path.join(HERE, "android", tid)
        os.makedirs(a, exist_ok=True)
        fg, mono, launcher, color = android_xml(acc, s, f)
        for name, body in (("ic_qt_fg.xml", fg), ("ic_launcher.xml", launcher), ("qt_icon_colors.xml", color)):
            with open(os.path.join(a, name), "w", encoding="utf-8") as fh:
                fh.write(body)
        # legacy square/round PNG launcher icons (pre-Android 8 and some launchers)
        for dens, px in (("mdpi", 48), ("hdpi", 72), ("xhdpi", 96), ("xxhdpi", 144), ("xxxhdpi", 192)):
            im.resize((px, px), Image.LANCZOS).save(os.path.join(a, f"legacy-{dens}.png"))
        print("icon", tid)


if __name__ == "__main__":
    import sys
    main(sys.argv[1:] or None)
