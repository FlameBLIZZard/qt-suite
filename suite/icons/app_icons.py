"""Phone-app icon sets from the QT Suite icon family.

python app_icons.py <tool-id> <out-dir>
Writes legacy launcher PNGs (square + round) per density, a full-bleed PWA icon set
(icon.svg, icon-192.png, icon-512.png, icon-maskable-512.png) and the adaptive-icon files.
"""
import os
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import make_icons as M  # noqa: E402


def round_svg(acc, s, f):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
            f'<circle cx="51" cy="51" r="45" fill="#000"/><circle cx="48" cy="48" r="44" fill="{acc}" stroke="#000" stroke-width="5"/>'
            f'<g transform="translate(48 48) scale(.78) translate(-50 -50)">{M.glyph(s, f)}</g></svg>')


def bleed_svg(acc, s, f, pad=.62):
    # full-bleed square (the OS applies its own mask), glyph inside the maskable safe zone
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="{acc}"/>'
            f'<g transform="translate(50 50) scale({pad}) translate(-50 -50)">{M.glyph(s, f)}</g></svg>')


def main(tid, out):
    acc, s, f = M.TOOLS[tid]
    os.makedirs(out, exist_ok=True)
    tmp = os.path.join(out, "_tmp.png")
    M.render(M.desktop_svg(acc, s, f), 512, tmp)
    sq = Image.open(tmp).copy()
    M.render(round_svg(acc, s, f), 512, tmp)
    rd = Image.open(tmp).copy()
    for dens, px in (("mdpi", 48), ("hdpi", 72), ("xhdpi", 96), ("xxhdpi", 144), ("xxxhdpi", 192)):
        d = os.path.join(out, "mipmap-" + dens)
        os.makedirs(d, exist_ok=True)
        sq.resize((px, px), Image.LANCZOS).save(os.path.join(d, "ic_launcher.png"))
        rd.resize((px, px), Image.LANCZOS).save(os.path.join(d, "ic_launcher_round.png"))
    with open(os.path.join(out, "icon.svg"), "w", encoding="utf-8") as fh:
        fh.write(M.desktop_svg(acc, s, f))
    M.render(bleed_svg(acc, s, f, .7), 512, tmp)
    full = Image.open(tmp).copy()
    full.save(os.path.join(out, "icon-512.png"))
    full.resize((192, 192), Image.LANCZOS).save(os.path.join(out, "icon-192.png"))
    M.render(bleed_svg(acc, s, f, .56), 512, tmp)
    Image.open(tmp).save(os.path.join(out, "icon-maskable-512.png"))
    os.remove(tmp)
    print("app icons", tid, "->", out)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
